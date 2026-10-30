package com.cpplatform.config;

import com.cpplatform.identity.*;
import org.springframework.context.annotation.*;
import org.springframework.boot.ApplicationRunner;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.web.*;
import org.springframework.security.web.authentication.*;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.web.cors.*;
import java.util.*;

@Configuration
@EnableAsync
public class SecurityConfiguration {
    @Bean SecurityFilterChain securityFilterChain(HttpSecurity http,BearerFilter bearer,
            @Value("${cp.cors-origins:http://localhost:3000}") String origins) throws Exception {
        CorsConfiguration cors=new CorsConfiguration();
        cors.setAllowedOrigins(Arrays.asList(origins.split(",")));
        cors.setAllowedMethods(List.of("GET","POST","PUT","PATCH","DELETE","OPTIONS"));
        cors.setAllowedHeaders(List.of("Authorization","Content-Type","Idempotency-Key"));
        cors.setAllowCredentials(false);
        UrlBasedCorsConfigurationSource source=new UrlBasedCorsConfigurationSource();source.registerCorsConfiguration("/**",cors);
        return http.csrf(AbstractHttpConfigurer::disable).httpBasic(AbstractHttpConfigurer::disable).formLogin(AbstractHttpConfigurer::disable)
                .cors(c->c.configurationSource(source))
                .sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(a->a
                    // Error pages keep the real status; denying them turned every failure into 401.
                    .dispatcherTypeMatchers(jakarta.servlet.DispatcherType.ERROR).permitAll()
                    .requestMatchers("/actuator/health","/actuator/health/**").permitAll()
                    .requestMatchers("/api/time").permitAll()
                    .requestMatchers("/api/auth/register","/api/auth/login","/api/auth/refresh","/api/auth/forgot-password","/api/auth/reset-password").permitAll()
                    .requestMatchers("/internal/judge/**").hasRole("WORKER")
                    .requestMatchers("/api/**").authenticated().anyRequest().denyAll())
                .exceptionHandling(e->e.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
                .addFilterBefore(bearer,UsernamePasswordAuthenticationFilter.class).build();
    }
    @Bean FilterRegistrationBean<BearerFilter> disableContainerRegistration(BearerFilter filter) {
        FilterRegistrationBean<BearerFilter> registration=new FilterRegistrationBean<>(filter);registration.setEnabled(false);return registration;
    }
    @Bean ApplicationRunner bootstrap(AuthService auth,@Value("${cp.bootstrap.email:}") String email,
                                     @Value("${cp.bootstrap.password:}") String password) {
        return args->{if(!email.isBlank()) auth.bootstrap(email,password);};
    }
}
