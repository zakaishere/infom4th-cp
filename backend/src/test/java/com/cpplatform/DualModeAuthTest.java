package com.cpplatform;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.*;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** With InfoM4th delegated sign-in configured, public registration is closed and
 *  only admin-created non InfoM4th accounts can be added. Legacy/admin-created
 *  accounts must still sign in through the normal /api/auth/login path. */
class DualModeAuthTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PASSWORD = "TestPassword1!";
    static EmbeddedPostgres postgres;
    static ConfigurableApplicationContext context;
    static MockMvc mvc;
    static com.cpplatform.identity.AuthService auth;
    static com.cpplatform.common.Database db;

    @BeforeAll
    static void start() throws Exception {
        postgres = EmbeddedPostgres.builder().setPort(0).setServerConfig("listen_addresses", "127.0.0.1").start();
        context = new SpringApplication(CpPlatformApplication.class).run("--server.port=0",
                "--spring.datasource.url=" + postgres.getJdbcUrl("postgres", "postgres"),
                "--spring.datasource.username=postgres", "--spring.datasource.password=",
                "--cp.dispatch.enabled=false", "--cp.scheduling.enabled=false", "--management.health.rabbit.enabled=false",
                "--management.endpoint.health.group.readiness.include=readinessState,db",
                "--cp.judge.worker-token=" + "w".repeat(40), "--spring.main.banner-mode=off",
                // Unreachable on purpose: only the config flag and local endpoints are exercised.
                "--cp.infom4th.token-url=http://127.0.0.1:59998/token",
                "--cp.infom4th.jwks-url=http://127.0.0.1:59998/jwks.json",
                "--cp.infom4th.issuer=http://localhost:5001",
                "--cp.infom4th.client-id=cp-test",
                "--cp.infom4th.client-secret=test-client-secret-0123456789");
        auth = context.getBean(com.cpplatform.identity.AuthService.class);
        db = context.getBean(com.cpplatform.common.Database.class);
        mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context)
                .addFilters(context.getBean(com.cpplatform.config.RequestSizeFilter.class), context.getBean(FilterChainProxy.class)).build();
    }

    @AfterAll
    static void stop() throws Exception {
        if (context != null) context.close();
        if (postgres != null) postgres.close();
    }

    @Test
    void configReportsDelegatedAuthWhenConfigured() throws Exception {
        mvc.perform(get("/api/auth/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.delegatedAuth").value(true));
    }

    @Test
    void publicRegistrationIsDisabledWhenDelegatedAuthIsOn() throws Exception {
        String key = "pub" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        String body = JSON.writeValueAsString(Map.of("email", key + "@example.test", "handle", key, "password", PASSWORD));
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden());
    }

    @Test
    void adminCreatedNonInfoM4thAccountCanBeCreatedAndSignedIn() throws Exception {
        // Make a super admin directly: public registration is intentionally closed.
        String adminKey = "adm" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        var adminSession = auth.register(Map.of("email", adminKey + "@example.test", "handle", adminKey,
                "displayName", "Admin", "password", PASSWORD));
        UUID adminId = (UUID) adminSession.get("userId");
        db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'SUPER_ADMIN')", adminId);
        String token = (String) adminSession.get("accessToken");

        String key = "fun" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        String email = key + "@example.test";
        String create = JSON.writeValueAsString(Map.of("reason", "dual-mode test",
                "users", List.of(Map.of("email", email, "handle", key, "displayName", "Event buddy",
                        "password", PASSWORD, "role", "PARTICIPANT"))));
        String bulk = mvc.perform(post("/api/admin/users/bulk").header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content(create))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.created").value(1))
                .andReturn().getResponse().getContentAsString();
        assertEquals("CREATED", JSON.readTree(bulk).path("results").path(0).path("status").asText());
        UUID createdId = UUID.fromString(JSON.readTree(bulk).path("results").path(0).path("userId").asText());

        String login = JSON.writeValueAsString(Map.of("email", email, "password", PASSWORD));
        String signedIn = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(login))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertEquals(createdId, UUID.fromString(JSON.readTree(signedIn).get("userId").asText()));
    }
}
