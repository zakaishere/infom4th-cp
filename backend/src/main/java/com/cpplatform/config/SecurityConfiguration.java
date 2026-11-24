package com.cpplatform.config;

import com.cpplatform.identity.*;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.context.annotation.*;
import org.springframework.boot.ApplicationRunner;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.web.*;
import org.springframework.security.web.authentication.*;
import org.springframework.security.web.csrf.*;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.web.cors.*;
import java.util.*;

@Configuration
@EnableAsync
public class SecurityConfiguration {
    @Bean ClientRegistrationRepository clientRegistrationRepository(OidcSupport oidc) {
        return oidc.clientRegistrationRepository();
    }

    @Bean SecurityFilterChain securityFilterChain(HttpSecurity http, BearerFilter bearer, OidcSupport oidc,
            ClientRegistrationRepository registrations,
            @Value("${cp.cors-origins:http://localhost:3000}") String origins) throws Exception {
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOrigins(Arrays.asList(origins.split(",")));
        cors.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cors.setAllowedHeaders(List.of("Authorization", "Content-Type", "Idempotency-Key", "X-XSRF-TOKEN"));
        cors.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cors);

        CookieCsrfTokenRepository csrfRepo = CookieCsrfTokenRepository.withHttpOnlyFalse();
        csrfRepo.setCookiePath("/");
        CsrfTokenRequestAttributeHandler csrfHandler = new CsrfTokenRequestAttributeHandler();
        csrfHandler.setCsrfRequestAttributeName(null);

        http.csrf(csrf -> csrf
                        .csrfTokenRepository(csrfRepo)
                        .csrfTokenRequestHandler(csrfHandler)
                        .ignoringRequestMatchers(
                                // Stateless machine/bearer clients and OIDC back-channel logout do not use cookies.
                                req -> isStatelessOrPublicAuth(req)
                        ))
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .cors(c -> c.configurationSource(source))
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
                .authorizeHttpRequests(a -> a
                        .dispatcherTypeMatchers(jakarta.servlet.DispatcherType.ERROR).permitAll()
                        .requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
                        .requestMatchers("/api/time").permitAll()
                        .requestMatchers("/oauth2/**", "/login/oauth2/**", "/logout/connect/back-channel/**").permitAll()
                        .requestMatchers("/api/auth/config", "/api/auth/register", "/api/auth/login", "/api/auth/logout",
                                "/api/auth/infom4th", "/api/auth/refresh", "/api/auth/forgot-password", "/api/auth/reset-password").permitAll()
                        .requestMatchers("/internal/judge/**").hasRole("WORKER")
                        .requestMatchers("/api/**").authenticated()
                        .anyRequest().denyAll())
                .exceptionHandling(e -> e.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
                .addFilterAfter(new OncePerRequestFilter() {
                    @Override
                    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
                            throws ServletException, IOException {
                        // Force Spring Security 6's DeferredCsrfToken to materialize so the XSRF-TOKEN
                        // cookie is always written on GET requests for the SPA before any POST/PUT/DELETE.
                        CsrfToken token = (CsrfToken) req.getAttribute(CsrfToken.class.getName());
                        if (token != null) token.getToken();
                        chain.doFilter(req, res);
                    }
                }, CsrfFilter.class)
                .addFilterBefore(bearer, UsernamePasswordAuthenticationFilter.class);

        if (oidc.enabled()) {
            http.oauth2Login(oauth -> oauth
                    .clientRegistrationRepository(registrations)
                    .authorizationEndpoint(a -> a.authorizationRequestResolver(oidc.authorizationRequestResolver(registrations)))
                    .successHandler(oidc.successHandler())
                    .failureHandler(oidc.failureHandler()))
                .oidcLogout(logout -> logout
                    .clientRegistrationRepository(registrations)
                    .backChannel(Customizer.withDefaults()));
        }
        return http.build();
    }

    private static boolean isStatelessOrPublicAuth(HttpServletRequest req) {
        String uri = req.getRequestURI();
        if (uri.startsWith("/internal/judge/") || uri.startsWith("/logout/connect/back-channel/")) return true;
        String authz = req.getHeader("Authorization");
        if (authz != null && authz.startsWith("Bearer ")) return true;
        // Public unauthenticated auth endpoints (no existing session cookie) do not need a prior CSRF token.
        if (req.getSession(false) == null && (uri.equals("/api/auth/login") || uri.equals("/api/auth/register")
                || uri.equals("/api/auth/infom4th") || uri.equals("/api/auth/refresh")
                || uri.equals("/api/auth/forgot-password") || uri.equals("/api/auth/reset-password"))) {
            return true;
        }
        return false;
    }

    @Bean FilterRegistrationBean<BearerFilter> disableContainerRegistration(BearerFilter filter) {
        FilterRegistrationBean<BearerFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean ApplicationRunner bootstrap(AuthService auth, @Value("${cp.bootstrap.email:}") String email,
                                     @Value("${cp.bootstrap.password:}") String password,
                                     @Value("${cp.bootstrap.sub:}") String sub) {
        return args -> {
            if (!email.isBlank()) auth.bootstrap(email, password);
            if (!sub.isBlank()) auth.bootstrapDelegatedAdmin(sub);
        };
    }
}
