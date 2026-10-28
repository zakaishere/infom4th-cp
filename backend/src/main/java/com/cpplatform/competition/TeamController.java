package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.util.*;

@RestController
@RequestMapping("/api/teams")
public class TeamController {
    private final Database db;
    public TeamController(Database db){this.db=db;}
    @PostMapping @Transactional @ResponseStatus(HttpStatus.CREATED)
    Object create(Authentication auth,@RequestBody Map<String,Object> body) {
        Actor actor=Actor.of(auth);
        UUID id=db.id("INSERT INTO teams(name,captain_id) VALUES (?,?) RETURNING id",Api.text(body,"name",100),actor.id());
        db.jdbc.update("INSERT INTO team_members(team_id,user_id) VALUES (?,?)",id,actor.id());
        return Map.of("teamId",id,"inviteToken",invite(id));
    }
    private String invite(UUID team) {
        String token=Tokens.random();
        db.jdbc.update("INSERT INTO team_invites VALUES (?,?,now()+interval '7 days')",Tokens.digest(token),team);return token;
    }
    @PostMapping("/{team}/invite") @Transactional
    Object invite(Authentication auth,@PathVariable UUID team) {
        var t=db.one("SELECT captain_id FROM teams WHERE id=? FOR UPDATE",team);
        Api.require(Actor.of(auth).id().equals(t.get("captain_id")),HttpStatus.FORBIDDEN,"Captain access required");
        db.jdbc.update("DELETE FROM team_invites WHERE team_id=?",team);return Map.of("inviteToken",invite(team));
    }
    @PostMapping("/join") @Transactional
    Object join(Authentication auth,@RequestBody Map<String,Object> body) {
        Actor actor=Actor.of(auth);
        var token=db.one("SELECT team_id FROM team_invites WHERE token_digest=? AND expires_at>now()",Tokens.digest(Api.text(body,"inviteToken",100)));
        UUID team=(UUID)token.get("team_id");db.one("SELECT id FROM teams WHERE id=? FOR UPDATE",team);
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM registrations r JOIN competitions c ON c.id=r.competition_id WHERE r.team_id=? AND r.status='APPROVED' AND c.status IN ('SCHEDULED','RUNNING'))",team),HttpStatus.CONFLICT,"Team membership is locked for a contest");
        Api.require(db.jdbc.queryForObject("SELECT count(*) FROM team_members WHERE team_id=?",Long.class,team)<10,HttpStatus.CONFLICT,"Team is full");
        db.jdbc.update("INSERT INTO team_members(team_id,user_id) VALUES (?,?)",team,actor.id());return Map.of("teamId",team);
    }
    @GetMapping
    Object mine(Authentication auth) {
        // Members and whether the team is locked by a scheduled or running registration.
        return db.jdbc.queryForList("SELECT t.id,t.name,t.captain_id,(SELECT string_agg(u.handle,', ' ORDER BY u.handle) FROM team_members x JOIN users u ON u.id=x.user_id WHERE x.team_id=t.id) AS members,"
                +"EXISTS(SELECT 1 FROM registrations r JOIN competitions c ON c.id=r.competition_id WHERE r.team_id=t.id AND r.status='APPROVED' AND c.status IN ('SCHEDULED','RUNNING')) AS locked FROM teams t JOIN team_members m ON m.team_id=t.id WHERE m.user_id=?",Actor.of(auth).id());
    }
}
