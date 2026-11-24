package com.cpplatform.identity;

import jakarta.servlet.http.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.client.registration.*;
import org.springframework.security.oauth2.client.web.*;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.authentication.*;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriComponentsBuilder;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * OpenID Connect (OIDC) Authorization Code + PKCE support for InfoM4th SSO.
 * Lazily discovers provider metadata from `cp.infom4th.issuer` so CP still boots
 * cleanly when OIDC is disabled or InfoM4th is starting up.
 */
@Component
public class OidcSupport {
    public static final String SESSION_USER_ID = "cp.userId";
    public static final String SESSION_ID_TOKEN = "cp.idToken";
    public static final String SESSION_POPUP = "cp.oidcPopup";

    private final String issuer;
    private final String clientId;
    private final String clientSecret;
    private final String postLogoutUrl;
    private final String bootstrapAdminSub;
    private final AuthService auth;
    private volatile ClientRegistration cachedRegistration;

    public OidcSupport(
            @Value("${cp.infom4th.issuer:}") String issuer,
            @Value("${cp.infom4th.client-id:}") String clientId,
            @Value("${cp.infom4th.client-secret:}") String clientSecret,
            @Value("${cp.infom4th.post-logout-url:}") String postLogoutUrl,
            @Value("${cp.bootstrap.sub:}") String bootstrapAdminSub,
            AuthService auth) {
        this.issuer = issuer == null ? "" : issuer.trim();
        this.clientId = clientId == null ? "" : clientId.trim();
        this.clientSecret = clientSecret == null ? "" : clientSecret.trim();
        this.postLogoutUrl = postLogoutUrl == null ? "" : postLogoutUrl.trim();
        this.bootstrapAdminSub = bootstrapAdminSub == null ? "" : bootstrapAdminSub.trim();
        this.auth = auth;
    }

    public boolean enabled() {
        return !issuer.isBlank() && !clientId.isBlank() && !clientSecret.isBlank();
    }

    public ClientRegistrationRepository clientRegistrationRepository() {
        return registrationId -> {
            if (!enabled() || !"infom4th".equals(registrationId)) return null;
            return getOrDiscoverRegistration();
        };
    }

    private ClientRegistration getOrDiscoverRegistration() {
        ClientRegistration existing = cachedRegistration;
        if (existing != null) return existing;
        synchronized (this) {
            if (cachedRegistration == null) {
                cachedRegistration = ClientRegistrations.fromIssuerLocation(issuer)
                        .registrationId("infom4th")
                        .clientId(clientId)
                        .clientSecret(clientSecret)
                        .scope("openid", "profile", "email")
                        .build();
            }
            return cachedRegistration;
        }
    }

    public OAuth2AuthorizationRequestResolver authorizationRequestResolver(ClientRegistrationRepository repo) {
        DefaultOAuth2AuthorizationRequestResolver delegate =
                new DefaultOAuth2AuthorizationRequestResolver(repo, "/oauth2/authorization");
        // Enforce PKCE (S256) even on confidential clients per OAuth 2.1.
        delegate.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
        return new OAuth2AuthorizationRequestResolver() {
            @Override
            public OAuth2AuthorizationRequest resolve(HttpServletRequest request) {
                rememberPopup(request);
                return delegate.resolve(request);
            }

            @Override
            public OAuth2AuthorizationRequest resolve(HttpServletRequest request, String clientRegistrationId) {
                rememberPopup(request);
                return delegate.resolve(request, clientRegistrationId);
            }

            private void rememberPopup(HttpServletRequest request) {
                if ("1".equals(request.getParameter("popup"))) {
                    request.getSession(true).setAttribute(SESSION_POPUP, Boolean.TRUE);
                }
            }
        };
    }

    public AuthenticationSuccessHandler successHandler() {
        return (HttpServletRequest request, HttpServletResponse response, Authentication authentication) -> {
            HttpSession session = request.getSession(true);
            boolean popup = Boolean.TRUE.equals(session.getAttribute(SESSION_POPUP));
            session.removeAttribute(SESSION_POPUP);

            if (!(authentication.getPrincipal() instanceof OidcUser oidcUser)) {
                sendResult(response, popup, false, "Unexpected identity response");
                return;
            }
            try {
                UUID userId = auth.resolveOidcUser(
                        oidcUser.getSubject(),
                        oidcUser.getEmail(),
                        Boolean.TRUE.equals(oidcUser.getEmailVerified()),
                        oidcUser.getFullName(),
                        oidcUser.getPreferredUsername(),
                        oidcUser.getPicture(),
                        bootstrapAdminSub
                );
                session.setAttribute(SESSION_USER_ID, userId);
                if (oidcUser.getIdToken() != null) {
                    session.setAttribute(SESSION_ID_TOKEN, oidcUser.getIdToken().getTokenValue());
                }
                sendResult(response, popup, true, null);
            } catch (Exception ex) {
                session.invalidate();
                sendResult(response, popup, false, ex.getMessage() != null ? ex.getMessage() : "Account is not active");
            }
        };
    }

    public AuthenticationFailureHandler failureHandler() {
        return (HttpServletRequest request, HttpServletResponse response, AuthenticationException ex) -> {
            HttpSession session = request.getSession(false);
            boolean popup = session != null && Boolean.TRUE.equals(session.getAttribute(SESSION_POPUP));
            if (session != null) session.removeAttribute(SESSION_POPUP);
            sendResult(response, popup, false, "InfoM4th sign-in could not be completed.");
        };
    }

    public String buildEndSessionUrl(String idToken, String fallbackPostLogoutUri) {
        if (!enabled() || idToken == null || idToken.isBlank()) return null;
        try {
            ClientRegistration reg = getOrDiscoverRegistration();
            Object endSession = reg.getProviderDetails().getConfigurationMetadata().get("end_session_endpoint");
            if (!(endSession instanceof String endpoint) || endpoint.isBlank()) return null;
            String postLogout = !postLogoutUrl.isBlank() ? postLogoutUrl : fallbackPostLogoutUri;
            UriComponentsBuilder builder = UriComponentsBuilder.fromUriString(endpoint)
                    .queryParam("id_token_hint", idToken);
            if (postLogout != null && !postLogout.isBlank()) {
                builder.queryParam("post_logout_redirect_uri", postLogout);
            }
            return builder.build().toUriString();
        } catch (Exception ignored) {
            return null;
        }
    }

    private void sendResult(HttpServletResponse response, boolean popup, boolean ok, String error) throws IOException {
        if (popup) {
            response.setStatus(ok ? HttpServletResponse.SC_OK : HttpServletResponse.SC_BAD_REQUEST);
            response.setContentType("text/html; charset=utf-8");
            response.setHeader("Cache-Control", "no-store");
            String escapedError = error == null ? "null" : "\"" + error.replace("\\", "\\\\").replace("\"", "\\\"").replace("<", "\\u003c") + "\"";
            String safeSubtitle = ok
                    ? "Returning you to InfoM4th Arena…"
                    : (error != null ? error : "Please close this window and try again.")
                        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
            String title = ok ? "Signed in with InfoM4th" : "Sign-in could not be completed";
            String accent = ok ? "#35c7e8" : "#ff6b8b";
            String accentDim = ok ? "rgba(53,199,232,0.14)" : "rgba(255,107,139,0.14)";
            String iconSvg = ok
                    ? "<svg width=\"32\" height=\"32\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#35c7e8\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20 6 9 17l-5-5\"/></svg>"
                    : "<svg width=\"32\" height=\"32\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#ff6b8b\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M18 6 6 18\"/><path d=\"m6 6 12 12\"/></svg>";
            String bar = ok ? "<div class=\"bar\"><i></i></div>" : "";
            response.getWriter().write("""
                    <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
                    <title>%s — InfoM4th Arena</title>
                    <style>
                      *{box-sizing:border-box;margin:0;padding:0}
                      body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
                        background:radial-gradient(circle at top,rgba(53,199,232,0.14),transparent 55%%),#07111a;
                        color:#eaf6fb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
                      .card{width:100%%;max-width:390px;background:rgba(12,24,36,0.92);border:1px solid rgba(53,199,232,0.28);
                        border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,0.5),0 0 32px %s;padding:32px 26px 28px;text-align:center}
                      .brand{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:700;letter-spacing:.18em;
                        text-transform:uppercase;color:#8ab8c9;margin-bottom:22px}
                      .brand b{color:#35c7e8}
                      .badge{width:60px;height:60px;margin:0 auto 18px;border-radius:14px;display:flex;align-items:center;
                        justify-content:center;background:%s;border:1px solid %s}
                      h1{font-size:19px;font-weight:700;margin-bottom:8px;color:#fff}
                      p{font-size:14px;line-height:1.5;color:#9ec3d1;margin-bottom:22px}
                      .bar{height:4px;border-radius:999px;background:#132838;overflow:hidden;margin-bottom:20px}
                      .bar>i{display:block;height:100%%;width:100%%;background:%s;transform-origin:left;animation:f .6s ease forwards}
                      @keyframes f{from{transform:scaleX(.1)}to{transform:scaleX(1)}}
                      .btn{padding:10px 18px;border-radius:10px;background:transparent;border:1px solid #284b61;color:#cfeaf4;
                        font:inherit;font-size:13px;font-weight:600;cursor:pointer}
                      .btn:hover{border-color:%s;color:#fff}
                    </style></head>
                    <body>
                      <main class="card">
                        <div class="brand">INFO<b>M4TH</b> &middot; ARENA</div>
                        <div class="badge">%s</div>
                        <h1>%s</h1>
                        <p>%s</p>
                        %s
                        <button type="button" class="btn" onclick="window.close()">Close window</button>
                      </main>
                      <script>
                      (function () {
                        var data = { ok: %s, error: %s };
                        try { var ch = new BroadcastChannel('cp-auth'); ch.postMessage(data); ch.close(); } catch (e) {}
                        try { if (window.opener && !window.opener.closed) window.opener.postMessage(data, window.location.origin); } catch (e) {}
                        setTimeout(function () {
                          window.close();
                          setTimeout(function () { window.location.replace('/'); }, 500);
                        }, 350);
                      })();
                      </script>
                    </body></html>
                    """.formatted(title, accentDim, accentDim, accent, accent, accent, iconSvg, title, safeSubtitle, bar, ok ? "true" : "false", escapedError));
            return;
        }
        if (ok) {
            response.sendRedirect("/");
        } else {
            String msg = URLEncoder.encode(error != null ? error : "Sign-in failed", StandardCharsets.UTF_8);
            response.sendRedirect("/#/?error=" + msg);
        }
    }
}
