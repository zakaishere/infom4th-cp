package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import java.util.*;

/** Contest announcements from staff and clarification questions from entrants, answered by the jury. */
@Service
public class CommunicationsService {
    private final CommunicationsRepository store;private final CompetitionService contests;private final Permissions access;private final RateLimits limits;
    public CommunicationsService(CommunicationsRepository store,CompetitionService contests,Permissions access,RateLimits limits) {
        this.store=store;this.contests=contests;this.access=access;this.limits=limits;
    }

    public List<Map<String,Object>> announcements(Actor actor,UUID run) {
        contests.runAccess(actor,run,false);return store.announcements(run);
    }
    @Transactional
    public UUID announce(Actor actor,UUID run,String title,String body) {
        access.competition(actor,store.competitionOf(run),false);
        UUID id=store.publishAnnouncement(run,actor.id(),title,body);
        store.runEvent(run,"ANNOUNCEMENT");
        store.audit(actor.id(),"ANNOUNCEMENT_PUBLISH","run",run);return id;
    }
    /** Only entrants ask, once the problems are released, at most 10 questions per 10 minutes. */
    @Transactional
    public UUID ask(Actor actor,UUID run,String question) {
        contests.runAccess(actor,run,true);limits.check("clarification:"+actor.id(),10,600);
        return store.ask(run,store.entryOf(run,actor.id()),actor.id(),question);
    }
    public List<Map<String,Object>> clarifications(Actor actor,UUID run) {
        var r=contests.runAccess(actor,run,false);
        return store.clarifications(run,access.jury(actor,(UUID)r.get("competition_id")),actor.id());
    }
    @Transactional
    public void answer(Actor actor,UUID clarification,String answer,boolean isPublic) {
        var c=store.clarificationRun(clarification);
        Api.require(access.jury(actor,(UUID)c.get("competition_id")),HttpStatus.FORBIDDEN,"Jury permission required");
        store.answer(clarification,actor.id(),answer,isPublic);
        store.runEvent((UUID)c.get("run_id"),"CLARIFICATION_UPDATED");
        store.audit(actor.id(),"CLARIFICATION_ANSWER","clarification",clarification);
    }
}
