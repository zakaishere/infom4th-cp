package com.cpplatform.identity;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.interfaces.RSAPublicKey;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/** Verifies the delegated JWT checks without a running InfoM4th: a real RSA keypair
 *  is published as a JWKS from a tiny local HTTP server, and tokens are signed here. */
class InfoM4thAuthServiceTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String ISSUER = "http://localhost:5001";
    private static final String CLIENT = "cp-test";
    private static final String KID = "test-key";
    private static KeyPair pair;
    private static HttpServer server;
    private static InfoM4thAuthService service;

    @BeforeAll
    static void start() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        pair = gen.generateKeyPair();
        RSAPublicKey pub = (RSAPublicKey) pair.getPublic();
        String jwks = JSON.writeValueAsString(Map.of("keys", List.of(Map.of(
                "kty", "RSA", "kid", KID, "use", "sig", "alg", "RS256",
                "n", b64u(pub.getModulus()), "e", b64u(pub.getPublicExponent())))));
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/jwks.json", ex -> {
            byte[] body = jwks.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        server.start();
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        service = new InfoM4thAuthService(base + "/token", base + "/jwks.json", ISSUER, CLIENT,
                "test-client-secret-0123456789", 5, JSON);
    }

    @AfterAll
    static void stop() { if (server != null) server.stop(0); }

    private static String b64u(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String b64u(BigInteger value) {
        byte[] bytes = value.toByteArray();
        if (bytes.length > 1 && bytes[0] == 0) bytes = Arrays.copyOfRange(bytes, 1, bytes.length);
        return b64u(bytes);
    }

    private static String sign(Map<String, Object> claims, String kid, String alg) throws Exception {
        String header = b64u(JSON.writeValueAsString(Map.of("alg", alg, "typ", "JWT", "kid", kid))
                .getBytes(StandardCharsets.UTF_8));
        String payload = b64u(JSON.writeValueAsString(claims).getBytes(StandardCharsets.UTF_8));
        String data = header + "." + payload;
        Signature signer = Signature.getInstance("SHA256withRSA");
        signer.initSign(pair.getPrivate());
        signer.update(data.getBytes(StandardCharsets.US_ASCII));
        return data + "." + b64u(signer.sign());
    }

    private static Map<String, Object> goodClaims() {
        long now = System.currentTimeMillis() / 1000;
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("iss", ISSUER);
        claims.put("sub", "11111111-2222-3333-4444-555555555555");
        claims.put("aud", CLIENT);
        claims.put("iat", now);
        claims.put("exp", now + 900);
        claims.put("email", "alice@example.com");
        claims.put("preferred_username", "alice");
        claims.put("name", "Alice");
        claims.put("email_verified", true);
        return claims;
    }

    @Test
    void verifiesAValidToken() throws Exception {
        var id = service.verifyToken(sign(goodClaims(), KID, "RS256"));
        assertEquals("11111111-2222-3333-4444-555555555555", id.sub());
        assertEquals("alice@example.com", id.email());
        assertEquals("alice", id.username());
        assertEquals("Alice", id.name());
        assertTrue(id.emailVerified());
    }

    @Test
    void rejectsTamperedPayload() throws Exception {
        String token = sign(goodClaims(), KID, "RS256");
        String[] parts = token.split("\\.", -1);
        assertThrows(ResponseStatusException.class,
                () -> service.verifyToken(parts[0] + "." + parts[1] + "x." + parts[2]));
    }

    @Test
    void rejectsWrongIssuer() throws Exception {
        Map<String, Object> claims = goodClaims();
        claims.put("iss", "http://evil.example");
        assertThrows(ResponseStatusException.class, () -> service.verifyToken(sign(claims, KID, "RS256")));
    }

    @Test
    void rejectsWrongAudience() throws Exception {
        Map<String, Object> claims = goodClaims();
        claims.put("aud", "another-client");
        assertThrows(ResponseStatusException.class, () -> service.verifyToken(sign(claims, KID, "RS256")));
    }

    @Test
    void acceptsArrayAudience() throws Exception {
        Map<String, Object> claims = goodClaims();
        claims.put("aud", List.of("another-client", CLIENT));
        assertEquals("alice", service.verifyToken(sign(claims, KID, "RS256")).username());
    }

    @Test
    void rejectsExpiredToken() throws Exception {
        Map<String, Object> claims = goodClaims();
        claims.put("exp", System.currentTimeMillis() / 1000 - 10);
        assertThrows(ResponseStatusException.class, () -> service.verifyToken(sign(claims, KID, "RS256")));
    }

    @Test
    void rejectsUnknownKeyId() throws Exception {
        assertThrows(ResponseStatusException.class, () -> service.verifyToken(sign(goodClaims(), "unknown", "RS256")));
    }

    @Test
    void rejectsNonRs256Algorithm() throws Exception {
        assertThrows(ResponseStatusException.class, () -> service.verifyToken(sign(goodClaims(), KID, "HS256")));
    }

    @Test
    void reportsDisabledWhenUnconfigured() {
        var unconfigured = new InfoM4thAuthService("", "", "", "", "", 5, JSON);
        assertFalse(unconfigured.enabled());
        assertTrue(service.enabled());
    }
}
