package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import java.util.*;

@Service
public class TeamService {
    static final int MAX_MEMBERS=10;
    private final TeamRepository teams;
    public TeamService(TeamRepository teams){this.teams=teams;}
    public record Created(UUID teamId,String inviteToken){}

    @Transactional
    public Created create(Actor actor,String name) {
        UUID id=teams.create(name,actor.id());teams.addMember(id,actor.id());
        return new Created(id,issueInvite(id));
    }
    @Transactional
    public String newInvite(Actor actor,UUID team) {
        Api.require(actor.id().equals(teams.lockForUpdate(team)),HttpStatus.FORBIDDEN,"Captain access required");
        return issueInvite(team);
    }
    @Transactional
    public UUID join(Actor actor,String inviteToken) {
        UUID team=teams.teamForInvite(Tokens.digest(inviteToken));teams.lockForUpdate(team);
        Api.require(!teams.locked(team),HttpStatus.CONFLICT,"Team membership is locked for a contest");
        Api.require(teams.memberCount(team)<MAX_MEMBERS,HttpStatus.CONFLICT,"Team is full");
        teams.addMember(team,actor.id());return team;
    }
    public List<Map<String,Object>> mine(Actor actor){return teams.forMember(actor.id());}
    private String issueInvite(UUID team){String token=Tokens.random();teams.replaceInvite(team,Tokens.digest(token));return token;}
}
