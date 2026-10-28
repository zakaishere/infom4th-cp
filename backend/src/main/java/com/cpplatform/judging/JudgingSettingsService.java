package com.cpplatform.judging;

import com.cpplatform.common.*;
import com.cpplatform.identity.Actor;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

/**
 * Administrator judging settings. Values here are desired limits; physical ceilings
 * (JUDGE_MAX_SLOTS, per-slot memory, lane/host memory budgets) are reported by trusted
 * workers from deployment configuration and are only read, never written, by this API.
 */
@Service
public class JudgingSettingsService {
    public static final List<String> LANES=List.of("official","internal");
    private static final Map<String,String> SETTING_COLUMNS=new LinkedHashMap<>();
    static {
        SETTING_COLUMNS.put("officialConcurrencyLimit","official_concurrency_limit");
        SETTING_COLUMNS.put("internalConcurrencyLimit","internal_concurrency_limit");
        SETTING_COLUMNS.put("pendingSubmissionsPerUser","pending_submissions_per_user");
        SETTING_COLUMNS.put("submissionsPerMinute","submissions_per_minute");
        SETTING_COLUMNS.put("maxQueuedSubmissions","max_queued_submissions");
    }
    private static final String ONLINE="w.status<>'OFFLINE' AND w.last_heartbeat_at>now()-interval '90 seconds'";
    private final Database db;private final JudgeService judge;private final ObjectMapper json;
    private final ObjectProvider<AmqpAdmin> broker;private final boolean dispatch;
    public JudgingSettingsService(Database db,JudgeService judge,ObjectMapper json,ObjectProvider<AmqpAdmin> broker,
                                  @Value("${cp.dispatch.enabled:true}") boolean dispatch) {
        this.db=db;this.judge=judge;this.json=json;this.broker=broker;this.dispatch=dispatch;
    }
    private String encode(Object value) {
        try{return json.writeValueAsString(value);}catch(Exception e){throw new IllegalArgumentException("Invalid JSON");}
    }
    /** Admission settings read by SubmissionService on every new submission. */
    public Map<String,Object> settingsRow(){return db.one("SELECT * FROM judging_settings WHERE id=1");}

    public Map<String,Object> settings(Map<String,Object> row) {
        var result=new LinkedHashMap<String,Object>();
        SETTING_COLUMNS.forEach((key,column)->result.put(key,row.get(column)));
        result.put("version",row.get("version"));result.put("updatedAt",row.get("updated_at"));result.put("updatedBy",row.get("updated_by"));
        return result;
    }

    public Map<String,Object> overview() {
        var row=settingsRow();
        var workers=db.jdbc.queryForList("SELECT w.*,("+ONLINE+") AS online,(SELECT count(*) FROM judging_jobs j WHERE j.worker_id=w.id AND j.status='RUNNING') AS running FROM judge_workers w ORDER BY w.lane,w.host_id,w.name");
        var workerViews=workers.stream().map(this::workerView).toList();
        var hosts=hostViews(workers);
        var lanes=new LinkedHashMap<String,Object>();
        for(String lane:LANES)lanes.put(lane,laneView(lane,row,workers,hosts));
        var result=new LinkedHashMap<String,Object>();
        result.put("settings",settings(row));
        result.put("lanes",lanes);
        result.put("workers",workerViews);
        result.put("hosts",hosts);
        result.put("queue",queue());
        result.put("explanation",List.of(
                "A slot is one submission being compiled and run at a time. Slots are not participants and not servers.",
                "Global lane limits cap simultaneous submissions across ALL workers of that lane.",
                "Effective capacity is the minimum of the global limit, the sum of worker limits, and host memory budgets.",
                "Memory budgets are deployment configuration values reported by workers, not measured hardware capacity.",
                "Lowering a limit never stops running submissions; new work starts only once running jobs fall below the limit."));
        return result;
    }

    Map<String,Object> workerView(Map<String,Object> w) {
        boolean online=Boolean.TRUE.equals(w.get("online"));
        long running=((Number)w.get("running")).longValue();
        int effective=online?JudgeCapacity.workerTarget(w):0;
        var v=new LinkedHashMap<String,Object>();
        v.put("id",w.get("id"));v.put("name",w.get("name"));v.put("lane",w.get("lane"));v.put("hostId",w.get("host_id"));
        v.put("status",online?w.get("status"):"OFFLINE");v.put("online",online);v.put("draining",w.get("drain_requested"));
        v.put("lastHeartbeatAt",w.get("last_heartbeat_at"));v.put("registeredAt",w.get("registered_at"));
        v.put("maxConcurrency",w.get("capacity"));
        v.put("defaultConcurrency",w.get("default_concurrency"));
        v.put("configuredConcurrency",w.get("desired_concurrency"));
        v.put("effectiveConcurrency",effective);
        v.put("running",running);
        v.put("availableSlots",Math.max(0,effective-running));
        v.put("overTarget",running>effective);
        v.put("reportedActive",w.get("reported_active"));v.put("reportedTarget",w.get("reported_target"));
        v.put("slotMemoryMb",w.get("slot_memory_mb"));v.put("laneMemoryBudgetMb",w.get("lane_memory_budget_mb"));
        v.put("hostMemoryBudgetMb",w.get("host_memory_budget_mb"));v.put("settingsVersion",w.get("settings_version"));
        v.put("detectedCpus",w.get("detected_cpus"));v.put("detectedMemoryMb",w.get("detected_memory_mb"));
        v.put("absoluteMaxConcurrency",JudgeCapacity.ABSOLUTE_MAX);
        v.put("constraints",JudgeCapacity.workerConstraints(w,online,running));
        v.put("runtimes",runtimes(w.get("runtime_manifest")));
        return v;
    }
    private Map<String,Object> runtimes(Object manifest) {
        var result=new LinkedHashMap<String,Object>();
        try {
            Map<?,?> m=json.readValue(manifest.toString(),Map.class);
            m.forEach((k,value)->{if(value instanceof Map<?,?> r)result.put(k.toString(),Map.of("verified",Boolean.TRUE.equals(r.get("verified")),"imageId",String.valueOf(r.get("imageId"))));});
        } catch(Exception ignored) {}
        return result;
    }

    List<Map<String,Object>> hostViews(List<Map<String,Object>> workers) {
        Map<String,List<Map<String,Object>>> grouped=new TreeMap<>();
        for(var w:workers)grouped.computeIfAbsent((String)w.get("host_id"),k->new ArrayList<>()).add(w);
        List<Map<String,Object>> result=new ArrayList<>();
        grouped.forEach((host,members)->{
            var online=members.stream().filter(w->Boolean.TRUE.equals(w.get("online"))).toList();
            if(online.isEmpty())return;
            long budget=online.stream().mapToLong(w->JudgeCapacity.integer(w,"host_memory_budget_mb")).min().orElse(0);
            long demand=online.stream().mapToLong(w->(long)JudgeCapacity.workerTarget(w)*JudgeCapacity.integer(w,"slot_memory_mb")).sum();
            long reserved=online.stream().mapToLong(w->((Number)w.get("running")).longValue()*JudgeCapacity.integer(w,"slot_memory_mb")).sum();
            var v=new LinkedHashMap<String,Object>();
            v.put("hostId",host);v.put("memoryBudgetMb",budget);v.put("budgetSource","configured (JUDGE_HOST_MEMORY_BUDGET_MB), not measured; advisory");
            v.put("configuredDemandMb",demand);v.put("reservedMb",reserved);v.put("overcommitted",demand>budget);
            v.put("lanes",online.stream().map(w->(String)w.get("lane")).distinct().toList());
            v.put("workers",online.stream().map(w->w.get("name")).toList());
            result.add(v);
        });
        return result;
    }

    Map<String,Object> laneView(String lane,Map<String,Object> settings,List<Map<String,Object>> workers,List<Map<String,Object>> hosts) {
        Integer limit=JudgeCapacity.nullable(settings,lane+"_concurrency_limit");
        var members=workers.stream().filter(w->lane.equals(w.get("lane"))).toList();
        var online=members.stream().filter(w->Boolean.TRUE.equals(w.get("online"))).toList();
        long registered=online.stream().mapToLong(w->JudgeCapacity.integer(w,"capacity")).sum();
        long workerCapacity=online.stream().mapToLong(JudgeCapacity::workerTarget).sum();
        long running=members.stream().mapToLong(w->((Number)w.get("running")).longValue()).sum();
        long effective=limit==null?workerCapacity:Math.min(limit,workerCapacity);
        List<String> constraints=new ArrayList<>();
        if(online.isEmpty())constraints.add("NO_WORKERS: no online "+lane+" worker; submissions stay queued");
        if(limit!=null && limit==0)constraints.add("PAUSED: global limit is 0; no new "+lane+" submissions start");
        if(limit!=null && limit>workerCapacity)constraints.add("WORKER_CAPACITY: limit is "+limit+" but online workers provide only "+workerCapacity+" slots");
        if(limit!=null && limit<workerCapacity)constraints.add("GLOBAL_LIMIT: workers provide "+workerCapacity+" slots; the global limit allows "+limit);
        for(var h:hosts)if(Boolean.TRUE.equals(h.get("overcommitted")) && ((List<?>)h.get("lanes")).contains(lane))
            constraints.add("WARNING: host "+h.get("hostId")+" budget "+h.get("memoryBudgetMb")+" MiB is below configured demand "+h.get("configuredDemandMb")+" MiB");
        long drained=online.stream().filter(w->Boolean.TRUE.equals(w.get("drain_requested"))).count();
        if(drained>0)constraints.add("DRAINING: "+drained+" online worker(s) are drained");
        if(running>effective)constraints.add("OVER_TARGET: "+running+" running exceed the effective capacity "+effective+"; no new work starts until below it");
        var v=new LinkedHashMap<String,Object>();
        v.put("configuredLimit",limit);
        v.put("registeredMaximum",registered);
        v.put("workerCapacity",workerCapacity);
        v.put("effectiveCapacity",effective);
        v.put("running",running);
        v.put("availableSlots",Math.max(0,effective-running));
        v.put("overTarget",running>effective);
        v.put("onlineWorkers",online.size());
        v.put("constraints",constraints);
        return v;
    }

    Map<String,Object> queue() {
        var database=new LinkedHashMap<String,Object>();
        for(String lane:LANES)database.put(lane,new LinkedHashMap<>(Map.of("queued",0L,"retry",0L,"running",0L)));
        for(var r:db.jdbc.queryForList("SELECT CASE WHEN r.kind='OFFICIAL' THEN 'official' ELSE 'internal' END AS lane,j.status,count(*) AS count,min(j.created_at) AS oldest FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id LEFT JOIN contest_runs r ON r.id=s.run_id WHERE j.status IN ('QUEUED','RETRY','RUNNING') GROUP BY 1,2")) {
            @SuppressWarnings("unchecked") var lane=(Map<String,Object>)database.get(r.get("lane"));
            lane.put(r.get("status").toString().toLowerCase(Locale.ROOT),((Number)r.get("count")).longValue());
            if(!"RUNNING".equals(r.get("status")))lane.merge("oldestWaitingCreatedAt",r.get("oldest"),(a,b)->((Comparable<Object>)a).compareTo(b)<=0?a:b);
        }
        var outbox=new LinkedHashMap<String,Object>();
        for(var r:db.jdbc.queryForList("SELECT lower(lane) AS lane,count(*) AS count FROM judge_outbox WHERE published_at IS NULL GROUP BY 1"))outbox.put((String)r.get("lane"),r.get("count"));
        var result=new LinkedHashMap<String,Object>();
        result.put("databaseJobs",database);
        result.put("databaseJobsDescription","Unfinished judging_jobs rows by status (QUEUED, RETRY, RUNNING), including rejudges and laboratory validation.");
        result.put("unpublishedDispatchIntents",outbox);
        result.put("broker",brokerQueues());
        return result;
    }

    private Map<String,Object> brokerQueues() {
        var result=new LinkedHashMap<String,Object>();
        AmqpAdmin admin=dispatch?broker.getIfAvailable():null;
        if(admin==null){result.put("available",false);result.put("reason","Broker dispatch is disabled in this API process");return result;}
        try {
            for(String lane:LANES) {
                long ready=0,consumers=0;
                for(String language:JudgeConfiguration.LANGUAGES) {
                    var info=admin.getQueueInfo("cp.judge."+lane+"."+language);
                    if(info!=null){ready+=info.getMessageCount();consumers+=info.getConsumerCount();}
                }
                result.put(lane,Map.of("readyMessages",ready,"consumers",consumers));
            }
            result.put("available",true);
            result.put("unacknowledgedMessages",null);
            result.put("note","Ready counts come from AMQP queue declarations. Unacknowledged (delivered, not yet acked) counts require the RabbitMQ management API and are not collected.");
        } catch(RuntimeException failure) {
            result.clear();result.put("available",false);result.put("reason","RabbitMQ is unreachable from the API");
        }
        return result;
    }

    private static long version(Map<String,Object> body) {
        Object v=body.get("version");
        Api.require(v instanceof Number && ((Number)v).longValue()>0,HttpStatus.BAD_REQUEST,"version is required; send the version you last read");
        return ((Number)v).longValue();
    }
    private static Integer limit(Map<String,Object> body,String key,int min,int max) {
        if(body.get(key)==null)return null;
        return Api.number(body,key,0,min,max);
    }

    @Transactional
    public Map<String,Object> update(Actor actor,Map<String,Object> body) {
        long expected=version(body);String reason=Api.text(body,"reason",2000);
        for(String key:body.keySet())Api.require(key.equals("version") || key.equals("reason") || SETTING_COLUMNS.containsKey(key),
                HttpStatus.BAD_REQUEST,"Unknown setting "+key);
        var current=db.one("SELECT * FROM judging_settings WHERE id=1 FOR UPDATE");
        Api.require(((Number)current.get("version")).longValue()==expected,HttpStatus.CONFLICT,
                "Judging settings were changed by another administrator (current version "+current.get("version")+"). Reload and review before saving.");
        var previous=new LinkedHashMap<String,Object>();var next=new LinkedHashMap<String,Object>();
        for(var entry:SETTING_COLUMNS.entrySet()) {
            String key=entry.getKey(),column=entry.getValue();
            if(!body.containsKey(key))continue;
            Object value=switch(key) {
                case "officialConcurrencyLimit","internalConcurrencyLimit" -> laneLimit(key,body);
                case "pendingSubmissionsPerUser" -> Api.number(body,key,0,1,100);
                case "submissionsPerMinute" -> Api.number(body,key,0,1,600);
                default -> Api.number(body,key,0,1,100000);
            };
            Object old=current.get(column)==null?null:((Number)current.get(column)).intValue();
            if(Objects.equals(old,value))continue;
            previous.put(key,old);next.put(key,value);
        }
        Api.require(!next.isEmpty(),HttpStatus.BAD_REQUEST,"No setting changed");
        List<Object> args=new ArrayList<>();StringBuilder sql=new StringBuilder("UPDATE judging_settings SET ");
        for(var e:next.entrySet()){sql.append(SETTING_COLUMNS.get(e.getKey())).append("=?,");args.add(e.getValue());}
        sql.append("version=version+1,updated_at=now(),updated_by=? WHERE id=1 AND version=?");args.add(actor.id());args.add(expected);
        Api.require(db.jdbc.update(sql.toString(),args.toArray())==1,HttpStatus.CONFLICT,"Judging settings changed concurrently; reload and retry");
        db.audit(actor.id(),"JUDGING_SETTINGS_UPDATE","judging_settings",null,reason,encode(Map.of("previous",previous,"new",next)));
        var result=new LinkedHashMap<>(overview());
        List<String> warnings=new ArrayList<>();
        for(String lane:LANES) {
            Object value=next.get(lane+"ConcurrencyLimit");
            @SuppressWarnings("unchecked") var view=(Map<String,Object>)((Map<String,Object>)result.get("lanes")).get(lane);
            if(value instanceof Integer limit && limit>((Number)view.get("workerCapacity")).longValue())
                warnings.add("WARNING: "+lane+" limit "+limit+" is above the "+view.get("workerCapacity")+" slots online workers provide; effective capacity stays "+view.get("effectiveCapacity")+" until workers are raised or added");
        }
        result.put("warnings",warnings);
        return result;
    }
    /** A global limit above current worker capacity is allowed; the response warns and effective capacity stays honest. */
    private Integer laneLimit(String key,Map<String,Object> body){return limit(body,key,0,1024);}

    @Transactional
    public Map<String,Object> updateWorker(Actor actor,UUID worker,Map<String,Object> body,boolean versioned) {
        long expected=versioned?version(body):0;String reason=Api.text(body,"reason",2000);
        for(String key:body.keySet())Api.require(Set.of("version","reason","desiredConcurrency","draining").contains(key),HttpStatus.BAD_REQUEST,"Unknown setting "+key);
        var located=db.one("SELECT lane,host_id FROM judge_workers WHERE id=?",worker);
        // Same lock order as claims: lane, host, then the worker row.
        judge.lock("lane:"+located.get("lane"));judge.lock("host:"+located.get("host_id"));
        var w=db.one("SELECT w.*,("+ONLINE+") AS online FROM judge_workers w WHERE w.id=? FOR UPDATE",worker);
        if(versioned)Api.require(((Number)w.get("settings_version")).longValue()==expected,HttpStatus.CONFLICT,
                "Worker settings were changed by another administrator (current version "+w.get("settings_version")+"). Reload and review before saving.");
        Integer desired=JudgeCapacity.nullable(w,"desired_concurrency");boolean drain=Boolean.TRUE.equals(w.get("drain_requested"));
        var previous=new LinkedHashMap<String,Object>();var next=new LinkedHashMap<String,Object>();
        if(body.containsKey("desiredConcurrency")) {
            // Fully administrator-set: any value up to the absolute cap; risks are reported as warnings.
            Integer value=body.get("desiredConcurrency")==null?null:Api.number(body,"desiredConcurrency",0,1,JudgeCapacity.ABSOLUTE_MAX);
            if(!Objects.equals(desired,value)){previous.put("desiredConcurrency",desired);next.put("desiredConcurrency",value);desired=value;}
        }
        if(body.containsKey("draining")) {
            Api.require(body.get("draining") instanceof Boolean,HttpStatus.BAD_REQUEST,"draining must be true or false");
            boolean value=(Boolean)body.get("draining");
            if(value!=drain){previous.put("draining",drain);next.put("draining",value);drain=value;}
        }
        if(next.isEmpty())return withWarnings(workerViewById(worker),List.of());
        var proposed=new LinkedHashMap<>(w);proposed.put("desired_concurrency",desired);proposed.put("drain_requested",drain);
        List<String> warnings=new ArrayList<>(JudgeCapacity.warnings(proposed,JudgeCapacity.workerLimit(proposed)));
        if(JudgeCapacity.workerTarget(proposed)>JudgeCapacity.workerTarget(w))hostWarning(proposed).ifPresent(warnings::add);
        int updated=db.jdbc.update("UPDATE judge_workers SET desired_concurrency=?,drain_requested=?,status=CASE WHEN status='OFFLINE' THEN 'OFFLINE' WHEN ? THEN 'DRAINING' ELSE 'ONLINE' END,settings_version=settings_version+1 WHERE id=? AND settings_version=?",
                desired,drain,drain,worker,w.get("settings_version"));
        Api.require(updated==1,HttpStatus.CONFLICT,"Worker settings changed concurrently; reload and retry");
        db.audit(actor.id(),"WORKER_SETTINGS_UPDATE","worker",worker,reason,encode(Map.of("worker",w.get("name"),"previous",previous,"new",next,"warnings",warnings)));
        return withWarnings(workerViewById(worker),warnings);
    }
    private static Map<String,Object> withWarnings(Map<String,Object> view,List<String> warnings) {
        var result=new LinkedHashMap<>(view);result.put("warnings",warnings);return result;
    }
    /** Warns when the combined configured demand of a host exceeds its configured memory budget. */
    private Optional<String> hostWarning(Map<String,Object> proposed) {
        UUID id=(UUID)proposed.get("id");
        var peers=db.jdbc.queryForList("SELECT w.* FROM judge_workers w WHERE w.host_id=? AND w.id<>? AND "+ONLINE,proposed.get("host_id"),id);
        long budget=JudgeCapacity.integer(proposed,"host_memory_budget_mb");
        long demand=(long)JudgeCapacity.workerTarget(proposed)*JudgeCapacity.integer(proposed,"slot_memory_mb");
        StringBuilder detail=new StringBuilder(proposed.get("name")+": "+JudgeCapacity.workerTarget(proposed)+" x "+proposed.get("slot_memory_mb")+" MiB");
        for(var p:peers) {
            budget=Math.min(budget,JudgeCapacity.integer(p,"host_memory_budget_mb"));
            int target=JudgeCapacity.workerTarget(p);demand+=(long)target*JudgeCapacity.integer(p,"slot_memory_mb");
            detail.append(", ").append(p.get("name")).append(": ").append(target).append(" x ").append(p.get("slot_memory_mb")).append(" MiB");
        }
        return demand>budget?Optional.of("WARNING: host "+proposed.get("host_id")+" budget is "+budget+" MiB (JUDGE_HOST_MEMORY_BUDGET_MB); configured workers now need "+demand+" MiB ("+detail+")"):Optional.empty();
    }
    Map<String,Object> workerViewById(UUID worker) {
        return workerView(db.one("SELECT w.*,("+ONLINE+") AS online,(SELECT count(*) FROM judging_jobs j WHERE j.worker_id=w.id AND j.status='RUNNING') AS running FROM judge_workers w WHERE w.id=?",worker));
    }
}
