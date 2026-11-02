package com.cpplatform.judging;

import com.cpplatform.common.*;
import com.cpplatform.identity.Actor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import java.util.*;

/** SUPER_ADMIN view of the judge queue and workers, and which languages contestants may use. */
@Service
public class RuntimeAdminService {
    private final Database db;
    public RuntimeAdminService(Database db){this.db=db;}
    private static void requireSuperAdmin(Actor actor){Api.require(actor.superAdmin(),HttpStatus.FORBIDDEN,"Super administrator permission required");}

    public Map<String,Object> judge(Actor actor) {
        requireSuperAdmin(actor);
        return Map.of("jobs",db.jdbc.queryForList("SELECT status,count(*) AS count,min(created_at) AS oldest FROM judging_jobs GROUP BY status"),
                "workers",db.jdbc.queryForList("SELECT id,name,status,capacity,last_heartbeat_at,runtime_manifest::text AS runtime_manifest FROM judge_workers"),
                "unpublishedEvents",db.jdbc.queryForObject("SELECT count(*) FROM judge_outbox WHERE published_at IS NULL",Long.class));
    }
    /** verified_image_id: the image an online official worker verified for this language right now. */
    public List<Map<String,Object>> languages(Actor actor) {
        requireSuperAdmin(actor);
        return db.jdbc.queryForList("SELECT l.code,l.display_name,l.enabled,l.runtime_image_id,l.admin_locked,(SELECT w.runtime_manifest->l.code->>'imageId' FROM judge_workers w WHERE w.status='ONLINE' AND w.last_heartbeat_at>now()-interval '90 seconds' AND w.runtime_manifest->l.code->>'verified'='true' ORDER BY w.runtime_manifest->>'lane'='official' DESC LIMIT 1) AS verified_image_id FROM languages l ORDER BY l.code");
    }
    /** Enabling pins the language to an image an online worker has verified; either way the choice is locked against automatic changes. */
    @Transactional
    public void setLanguage(Actor actor,String language,boolean enabled,String imageId,String reason) {
        requireSuperAdmin(actor);
        if(enabled)Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM judge_workers WHERE status='ONLINE' AND last_heartbeat_at>now()-interval '90 seconds' AND runtime_manifest->?->>'verified'='true' AND runtime_manifest->?->>'imageId'=?)",language,language,imageId),
                HttpStatus.CONFLICT,"Verify this runtime on an online worker first");
        Api.require(db.jdbc.update("UPDATE languages SET enabled=?,runtime_image_id=?,admin_locked=true WHERE code=?",enabled,enabled?imageId:null,language)==1,HttpStatus.NOT_FOUND,"Unknown language");
        db.audit(actor.id(),"LANGUAGE_"+(enabled?"ENABLE":"DISABLE"),"language",null,language+": "+reason);
    }
}
