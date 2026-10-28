package com.cpplatform.identity;

import java.util.Set;
import java.util.UUID;
import org.springframework.security.core.Authentication;

public record Actor(UUID id, Set<String> roles) {
    public static Actor of(Authentication authentication) { return (Actor) authentication.getPrincipal(); }
    public boolean superAdmin() { return roles.contains("SUPER_ADMIN"); }
    public boolean organizer() { return superAdmin() || roles.contains("ADMIN"); }
}
