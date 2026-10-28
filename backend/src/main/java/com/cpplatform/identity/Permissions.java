package com.cpplatform.identity;

import com.cpplatform.common.*;
import org.springframework.stereotype.Component;
import org.springframework.http.HttpStatus;
import java.util.*;

@Component
public class Permissions {
    private final Database db;
    public Permissions(Database db) {this.db=db;}
    public void setter(Actor actor) {
        Api.require(actor.organizer() || actor.roles().contains("MODERATOR"),HttpStatus.FORBIDDEN,"Problem setter permission required");
    }
    public void problemRead(Actor actor,UUID version) {
        setter(actor);
        Api.require(actor.superAdmin() || db.exists("SELECT EXISTS(SELECT 1 FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id=? AND (p.owner_id=? OR EXISTS(SELECT 1 FROM problem_collaborators c WHERE c.problem_id=p.id AND c.user_id=?)))",version,actor.id(),actor.id()),HttpStatus.FORBIDDEN,"Problem access denied");
    }
    public void organizer(Actor actor) { Api.require(actor.organizer(),HttpStatus.FORBIDDEN,"Organizer permission required"); }
    public void problem(Actor actor,UUID version,boolean edit) {
        setter(actor);
        boolean allowed=actor.superAdmin() || db.exists("SELECT EXISTS(SELECT 1 FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id=? AND (p.owner_id=? OR EXISTS(SELECT 1 FROM problem_collaborators c WHERE c.problem_id=p.id AND c.user_id=? AND c.access_level IN ('MANAGER',?))))",
                version,actor.id(),actor.id(),edit?"EDITOR":"REVIEWER");
        Api.require(allowed,HttpStatus.FORBIDDEN,"Problem access denied");
    }
    public void competition(Actor actor,UUID competition,boolean publish) {
        organizer(actor);
        boolean allowed=actor.superAdmin() || db.exists("SELECT EXISTS(SELECT 1 FROM competitions c WHERE c.id=? AND (c.owner_id=? OR EXISTS(SELECT 1 FROM competition_staff s WHERE s.competition_id=c.id AND s.user_id=? AND s.access_level='MANAGER' AND (?=false OR s.can_publish))))",
                competition,actor.id(),actor.id(),publish);
        Api.require(allowed,HttpStatus.FORBIDDEN,"Competition management access denied");
    }
    public boolean jury(Actor actor,UUID competition) {
        return actor.superAdmin() || db.exists("SELECT EXISTS(SELECT 1 FROM competitions c WHERE c.id=? AND (c.owner_id=? OR EXISTS(SELECT 1 FROM competition_staff s WHERE s.competition_id=c.id AND s.user_id=? AND s.access_level IN ('MANAGER','JURY'))))",
                competition,actor.id(),actor.id());
    }
}
