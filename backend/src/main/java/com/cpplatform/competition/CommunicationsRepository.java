package com.cpplatform.competition;

import com.cpplatform.common.*;
import org.springframework.stereotype.Repository;
import java.util.*;

/** Announcements and clarifications of a contest run, and the run events that tell browsers to refresh them. */
@Repository
class CommunicationsRepository {
    private final Database db;
    CommunicationsRepository(Database db){this.db=db;}

    UUID competitionOf(UUID run){return (UUID)db.one("SELECT competition_id FROM contest_runs WHERE id=?",run).get("competition_id");}
    List<Map<String,Object>> announcements(UUID run) {
        return db.jdbc.queryForList("SELECT id,title,body_md,published_at FROM announcements WHERE run_id=? AND published_at<=now() ORDER BY published_at",run);
    }
    UUID publishAnnouncement(UUID run,UUID author,String title,String body) {
        return db.id("INSERT INTO announcements(run_id,author_id,title,body_md,published_at) VALUES (?,?,?,?,now()) RETURNING id",run,author,title,body);
    }
    UUID entryOf(UUID run,UUID user){return (UUID)db.one("SELECT entry_id FROM run_entry_members WHERE run_id=? AND user_id=?",run,user).get("entry_id");}
    UUID ask(UUID run,UUID entry,UUID user,String question) {
        return db.id("INSERT INTO clarifications(run_id,entry_id,asked_by,question) VALUES (?,?,?,?) RETURNING id",run,entry,user,question);
    }
    /** Public clarifications, plus every one for the jury, plus the user's own entry's. */
    List<Map<String,Object>> clarifications(UUID run,boolean jury,UUID user) {
        return db.jdbc.queryForList("SELECT c.id,c.entry_id,c.question,c.answer,c.is_public,c.created_at,c.answered_at FROM clarifications c WHERE c.run_id=? AND (c.is_public OR ? OR EXISTS(SELECT 1 FROM run_entry_members m WHERE m.entry_id=c.entry_id AND m.user_id=?)) ORDER BY c.created_at DESC LIMIT 200",
                run,jury,user);
    }
    /** The run and competition a clarification belongs to. */
    Map<String,Object> clarificationRun(UUID clarification) {
        return db.one("SELECT c.run_id,r.competition_id FROM clarifications c JOIN contest_runs r ON r.id=c.run_id WHERE c.id=?",clarification);
    }
    void answer(UUID clarification,UUID user,String answer,boolean isPublic) {
        db.jdbc.update("UPDATE clarifications SET answer=?,answered_by=?,answered_at=now(),is_public=? WHERE id=?",answer,user,isPublic,clarification);
    }
    void runEvent(UUID run,String kind){db.jdbc.update("INSERT INTO run_events(run_id,kind) VALUES (?,?)",run,kind);}
    void audit(UUID actor,String action,String type,UUID id){db.audit(actor,action,type,id,null);}
}
