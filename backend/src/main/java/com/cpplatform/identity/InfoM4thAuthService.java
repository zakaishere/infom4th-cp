package com.cpplatform.identity;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;

/**
 * Delegated identity: exchange an InfoM4th email/password for an RS256 access token
 * and verify it against InfoM4th's published JWKS. Uses only the JDK (java.security +
 * java.net.http) plus the already-present Jackson, so the offline build needs no new
 * JWT/OAuth jars. Token verification happens once, at login; CP then signs its own
 * opaque session tokens (AuthService.issue) and the rest of the app is unchanged.
 */
@Service
public class InfoM4thAuthService {
    private final String tokenUrl, jwksUrl, issuer, clientId, clientSecret;
    private final int timeoutSeconds;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newHttpClient();

    private volatile Cache cache = new Cache(0, Map.of());

    public InfoM4thAuthService(
            @Value("${cp.infom4th.token-url:}") String tokenUrl,
            @Value("${cp.infom4th.jwks-url:}") String jwksUrl,
            @Value("${cp.infom4th.issuer:}") String issuer,
            @Value("${cp.infom4th.client-id:}") String clientId,
            @Value("${cp.infom4th.client-secret:}") String clientSecret,
            @Value("${cp.infom4th.timeout-seconds:5}") int timeoutSeconds,
            ObjectMapper json) {
        this.tokenUrl = blankToEmpty(tokenUrl);
        this.jwksUrl = blankToEmpty(jwksUrl);
        this.issuer = blankToEmpty(issuer);
        this.clientId = blankToEmpty(clientId);
        this.clientSecret = blankToEmpty(clientSecret);
        this.timeoutSeconds = Math.max(1, timeoutSeconds);
        this.json = json;
    }

    private static String blankToEmpty(String v) { return v == null || v.isBlank() ? "" : v.trim(); }

    /** The verified identity we care about, extracted from a valid InfoM4th JWT. */
    public record Identity(String sub, String email, String username, String name, boolean emailVerified) {}

    /** True when the IdP is configured. Callers gate the delegated login on this. */
    public boolean enabled() {
        return !tokenUrl.isEmpty() && !jwksUrl.isEmpty() && !issuer.isEmpty() && !clientId.isEmpty();
    }

    /** Exchange credentials at InfoM4th and return the verified identity. */
    public Identity exchangeAndVerify(String email, String password) {
        if (!enabled()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Delegated sign-in is not configured");
        String body;
        try {
            String payload = json.writeValueAsString(Map.of(
                    "grant_type", "password", "client_id", clientId, "client_secret", clientSecret,
                    "email", email, "password", password));
            HttpRequest request = HttpRequest.newBuilder(URI.create(tokenUrl))
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(payload))
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            int status = response.statusCode();
            if (status == 400 || status == 401 || status == 403) {
                // Never reveal whether the email exists in InfoM4th.
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
            }
            if (status < 200 || status >= 300) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Identity provider unavailable");
            }
            body = response.body();
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Identity provider unavailable");
        }

        JsonNode token;
        try { token = json.readTree(body); }
        catch (Exception e) { throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Identity provider returned an invalid response"); }
        if (token == null || !token.path("access_token").isTextual()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Identity provider returned no token");
        }
        return verifyToken(token.get("access_token").asText());
    }

    /** Verify an RS256 JWT from InfoM4th (signature, issuer, audience and expiry). */
    public Identity verifyToken(String token) {
        String[] parts = token == null ? new String[0] : token.split("\\.", -1);
        if (parts.length != 3) throw invalid();
        JsonNode header, claims;
        try {
            header = json.readTree(decode(parts[0]));
            claims = json.readTree(decode(parts[1]));
        } catch (Exception e) { throw invalid(); }
        if (header == null || claims == null) throw invalid();
        if (!"RS256".equals(header.path("alg").asText())) throw invalid();

        String kid = header.path("kid").asText("");
        PublicKey key = key(kid);
        try {
            Signature verifier = Signature.getInstance("SHA256withRSA");
            verifier.initVerify(key);
            verifier.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
            if (!verifier.verify(Base64.getUrlDecoder().decode(parts[2]))) throw invalid();
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw invalid();
        }

        if (issuer.isEmpty() || !issuer.equals(claims.path("iss").asText())) throw invalid();
        JsonNode aud = claims.path("aud");
        boolean audienceOk = aud.isArray()
                ? containsText(aud, clientId)
                : clientId.equals(aud.asText());
        if (!audienceOk) throw invalid();
        long exp = claims.path("exp").asLong(0);
        if (exp <= Instant.now().getEpochSecond()) throw invalid();
        String sub = claims.path("sub").asText("");
        if (sub.isBlank()) throw invalid();

        String email = claims.path("email").asText("");
        String username = claims.path("preferred_username").asText("");
        String name = claims.path("name").asText("");
        boolean verified = claims.path("email_verified").asBoolean(false);
        return new Identity(sub, email, username, name, verified);
    }

    private static boolean containsText(JsonNode array, String value) {
        for (JsonNode n : array) if (value.equals(n.asText())) return true;
        return false;
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid identity token");
    }

    private static byte[] decode(String segment) {
        return Base64.getUrlDecoder().decode(segment);
    }

    private static BigInteger toBigInteger(String base64Url) {
        return new BigInteger(1, Base64.getUrlDecoder().decode(base64Url));
    }

    private record Cache(long at, Map<String, PublicKey> keys) {}

    /** Resolve the signing key for a kid, refreshing the cached JWKS once on a miss. */
    private PublicKey key(String kid) {
        Cache snapshot = cache;
        PublicKey key = snapshot.keys().get(kid);
        if (key != null) return key;
        // Unknown kid (or cold cache): refetch and try again.
        snapshot = refresh();
        key = snapshot.keys().get(kid);
        if (key == null) throw invalid();
        return key;
    }

    private Cache refresh() {
        JsonNode set;
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(jwksUrl))
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .header("Accept", "application/json")
                    .GET().build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Identity provider unavailable");
            }
            set = json.readTree(response.body());
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Identity provider unavailable");
        }
        if (set == null || !set.path("keys").isArray()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Identity provider published no keys");
        }
        java.util.Map<String, PublicKey> keys = new java.util.HashMap<>();
        for (JsonNode jwk : set.get("keys")) {
            if (!"RSA".equals(jwk.path("kty").asText())) continue;
            String id = jwk.path("kid").asText("");
            if (id.isEmpty() || !jwk.path("n").isTextual() || !jwk.path("e").isTextual()) continue;
            try {
                PublicKey pub = KeyFactory.getInstance("RSA").generatePublic(
                        new RSAPublicKeySpec(toBigInteger(jwk.get("n").asText()), toBigInteger(jwk.get("e").asText())));
                keys.put(id, pub);
            } catch (Exception ignored) {
                // Skip a malformed key; a valid one may still be present.
            }
        }
        if (keys.isEmpty()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Identity provider published no usable keys");
        Cache fresh = new Cache(System.currentTimeMillis(), java.util.Map.copyOf(keys));
        cache = fresh;
        return fresh;
    }
}
