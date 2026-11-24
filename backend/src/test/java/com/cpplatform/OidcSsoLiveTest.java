package com.cpplatform;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.net.*;
import java.net.http.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Live cross-app OIDC SSO integration test against a running InfoM4th IdP.
 * Activated only when system property `live.idp.cookie` is provided.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT)
class OidcSsoLiveTest {
    private static EmbeddedPostgres pg;

    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) throws Exception {
        if (System.getProperty("live.idp.cookie", "").isBlank()) return;
        pg = EmbeddedPostgres.builder().start();
        r.add("server.port", () -> System.getProperty("live.cp.port", "8199"));
        r.add("spring.datasource.url", () -> pg.getJdbcUrl("postgres", "postgres"));
        r.add("spring.datasource.username", () -> "postgres");
        r.add("spring.datasource.password", () -> "postgres");
        r.add("cp.dispatch.enabled", () -> "false");
        r.add("cp.scheduling.enabled", () -> "false");
        r.add("cp.infom4th.issuer", () -> System.getProperty("live.idp.issuer"));
        r.add("cp.infom4th.client-id", () -> System.getProperty("live.cp.clientId"));
        r.add("cp.infom4th.client-secret", () -> System.getProperty("live.cp.clientSecret"));
        r.add("cp.infom4th.post-logout-url", () -> "http://127.0.0.1:" + System.getProperty("live.cp.port", "8199") + "/");
    }

    private static String extractCookie(HttpResponse<?> res, String name) {
        for (String h : res.headers().allValues("set-cookie")) {
            String first = h.split(";")[0];
            if (first.startsWith(name + "=")) return first;
        }
        return null;
    }

    @Test
    void fullLiveOidcPopupSsoWithInfom4th() throws Exception {
        String idpCookie = System.getProperty("live.idp.cookie", "");
        Assumptions.assumeFalse(idpCookie.isBlank(), "Set -Dlive.idp.cookie to run live OIDC SSO test");
        String expectedEmail = System.getProperty("live.idp.email", "live.student@infom4th.test");
        String base = "http://127.0.0.1:" + port;

        HttpClient http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();

        // 1. /api/auth/config reports OIDC enabled
        HttpResponse<String> cfgRes = http.send(HttpRequest.newBuilder(URI.create(base + "/api/auth/config")).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, cfgRes.statusCode(), cfgRes.body());
        assertTrue(cfgRes.body().contains("\"oidc\":true"), cfgRes.body());

        // 2. Start OIDC popup flow on CP
        HttpResponse<String> startRes = http.send(HttpRequest.newBuilder(URI.create(base + "/oauth2/authorization/infom4th?popup=1")).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(302, startRes.statusCode(), startRes.body());
        String cpSessionCookie = extractCookie(startRes, "CP_SESSION");
        assertNotNull(cpSessionCookie, "Missing CP_SESSION cookie");
        String authorizeUrl = startRes.headers().firstValue("location").orElseThrow();
        assertTrue(authorizeUrl.contains("/api/auth/oauth2/authorize"), authorizeUrl);
        assertTrue(authorizeUrl.contains("code_challenge_method=S256"), "Missing PKCE S256: " + authorizeUrl);

        // 3. Follow redirect to live InfoM4th IdP with existing IdP session cookie -> Silent SSO!
        HttpResponse<String> authzRes = http.send(HttpRequest.newBuilder(URI.create(authorizeUrl))
                .header("Cookie", idpCookie)
                .header("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
                .GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(302, authzRes.statusCode(), authzRes.body());
        String callbackUrl = authzRes.headers().firstValue("location").orElseThrow();
        assertTrue(callbackUrl.startsWith(base + "/login/oauth2/code/infom4th?"), callbackUrl);

        // 4. Follow callback to CP -> Spring exchanges code + PKCE, verifies JWKS, sets BFF cookie, returns popup HTML
        HttpResponse<String> cbRes = http.send(HttpRequest.newBuilder(URI.create(callbackUrl))
                .header("Cookie", cpSessionCookie)
                .GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, cbRes.statusCode(), cbRes.body());
        String rotatedSession = extractCookie(cbRes, "CP_SESSION");
        if (rotatedSession != null) cpSessionCookie = rotatedSession;
        assertTrue(cbRes.body().contains("BroadcastChannel('cp-auth')"), cbRes.body());
        assertTrue(cbRes.body().contains("ok: true"), cbRes.body());

        // 5. Call /api/me using ONLY the HttpOnly CP_SESSION cookie (zero Bearer header!)
        HttpResponse<String> meRes = http.send(HttpRequest.newBuilder(URI.create(base + "/api/me"))
                .header("Cookie", cpSessionCookie)
                .GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, meRes.statusCode(), meRes.body());
        assertTrue(meRes.body().contains(expectedEmail), meRes.body());
        assertTrue(meRes.body().contains("\"is_idp\":true"), meRes.body());
        String xsrfCookie = extractCookie(meRes, "XSRF-TOKEN");

        // 6. Verify local password login bypass is blocked (401) for this InfoM4th user
        HttpResponse<String> bypassRes = http.send(HttpRequest.newBuilder(URI.create(base + "/api/auth/login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"" + expectedEmail + "\",\"password\":\"Live-Sso-Password-123!\"}"))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(401, bypassRes.statusCode(), bypassRes.body());

        // 7. Verify CSRF protection: POST /api/auth/logout without X-XSRF-TOKEN is rejected (403)
        HttpResponse<String> noCsrfRes = http.send(HttpRequest.newBuilder(URI.create(base + "/api/auth/logout"))
                .header("Cookie", cpSessionCookie)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{}"))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, noCsrfRes.statusCode(), "Expected CSRF 403 without X-XSRF-TOKEN, got: " + noCsrfRes.statusCode());

        // 8. Logout WITH X-XSRF-TOKEN succeeds, invalidates CP_SESSION, and returns OIDC endSessionUrl
        assertNotNull(xsrfCookie, "Missing XSRF-TOKEN cookie");
        String xsrfValue = xsrfCookie.substring("XSRF-TOKEN=".length());
        HttpResponse<String> logoutRes = http.send(HttpRequest.newBuilder(URI.create(base + "/api/auth/logout"))
                .header("Cookie", cpSessionCookie + "; " + xsrfCookie)
                .header("X-XSRF-TOKEN", xsrfValue)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{}"))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, logoutRes.statusCode(), logoutRes.body());
        assertTrue(logoutRes.body().contains("/api/auth/oauth2/end-session"), logoutRes.body());

        // 9. Session is now dead (401 on /api/me)
        HttpResponse<String> deadRes = http.send(HttpRequest.newBuilder(URI.create(base + "/api/me"))
                .header("Cookie", cpSessionCookie)
                .GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(401, deadRes.statusCode(), deadRes.body());

        if (pg != null) pg.close();
    }
}
