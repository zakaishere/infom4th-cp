package com.cpplatform.identity;

import com.cpplatform.common.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.util.*;

/** SUPER_ADMIN user administration and the audit log. Judging, contest and problem administration live in their own modules. */
@RestController
public class AdminController {
    private final UserAdminService users;
    public AdminController(UserAdminService users){this.users=users;}

    /** Filtered user list with roles; q matches email, handle or name, role PARTICIPANT means "no staff role". */
    @GetMapping("/api/admin/users")
    Object users(Authentication auth,@RequestParam(defaultValue="0") int offset,@RequestParam(required=false) String q,
                 @RequestParam(required=false) String role,@RequestParam(required=false) String status) {
        return users.users(Actor.of(auth),offset,q,role,status);
    }
    /** One user's profile, activity and every audit entry they made or that concerns them. */
    @GetMapping("/api/admin/users/{id}")
    Object user(Authentication auth,@PathVariable UUID id){return users.user(Actor.of(auth),id);}
    @PutMapping("/api/admin/users/{id}/role")
    Object setRole(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        users.setRole(Actor.of(auth),id,Api.text(body,"role",32),Api.text(body,"reason",2000));return Map.of("ok",true);
    }
    @PutMapping("/api/admin/users/{id}/status")
    Object setStatus(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        users.setStatus(Actor.of(auth),id,Api.text(body,"status",16),Api.text(body,"reason",2000));return Map.of("ok",true);
    }
    @PostMapping("/api/admin/users/bulk")
    Object bulk(Authentication auth,@RequestBody Map<String,Object> body) {
        String reason=Api.text(body,"reason",2000);
        Api.require(body.get("users") instanceof List<?> l && !l.isEmpty() && l.size()<=300,HttpStatus.BAD_REQUEST,"Send 1-300 users");
        return users.bulk(Actor.of(auth),(List<?>)body.get("users"),reason);
    }
    @GetMapping("/api/admin/audit")
    Object audit(Authentication auth,@RequestParam(defaultValue="0") long after,@RequestParam(required=false) String type,
                 @RequestParam(defaultValue="false") boolean latest,@RequestParam(required=false) String actor) {
        return users.audit(Actor.of(auth),after,type,latest,actor);
    }
}
