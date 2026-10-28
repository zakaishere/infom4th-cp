package com.cpplatform.identity;

import com.cpplatform.common.Database;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.util.*;
import java.util.stream.Collectors;

@Component
public class BearerFilter extends OncePerRequestFilter {
    private final Database db; private final String workerToken;
    public BearerFilter(Database db,@Value("${cp.judge.worker-token:}") String workerToken) {
        this.db=db;this.workerToken=workerToken;
        if(!workerToken.isEmpty() && workerToken.length()<32) throw new IllegalArgumentException("WORKER_TOKEN must have at least 32 characters");
    }
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)
            throws ServletException,IOException {
        String header=request.getHeader("Authorization");
        if(header!=null && header.startsWith("Bearer ")) {
            String token=header.substring(7);
            if(request.getRequestURI().startsWith("/internal/judge/")) {
                if(workerToken.length()>=32 && Tokens.equal(token,workerToken))
                    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("judge",null,List.of(new SimpleGrantedAuthority("ROLE_WORKER"))));
            } else if(token.length()<=100) {
                var users=db.jdbc.queryForList("SELECT u.id FROM access_tokens a JOIN refresh_tokens r ON r.id=a.refresh_token_id JOIN users u ON u.id=r.user_id WHERE a.token_digest=? AND a.expires_at>now() AND r.revoked_at IS NULL AND r.expires_at>now() AND u.status='ACTIVE'",Tokens.digest(token));
                if(!users.isEmpty()) {
                    UUID id=(UUID)users.get(0).get("id");
                    Set<String> roles=new HashSet<>(db.jdbc.queryForList("SELECT role_code FROM user_roles WHERE user_id=?",String.class,id));
                    Actor actor=new Actor(id,roles);
                    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(actor,null,roles.stream().map(r->new SimpleGrantedAuthority("ROLE_"+r)).collect(Collectors.toList())));
                }
            }
        }
        chain.doFilter(request,response);
    }
}
