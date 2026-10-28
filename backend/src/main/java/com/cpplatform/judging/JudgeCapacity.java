package com.cpplatform.judging;

import java.util.*;

/**
 * Pure capacity arithmetic shared by claims, worker control and the admin view.
 * Deployment values (JUDGE_SLOTS, JUDGE_MAX_SLOTS, memory budgets) are defaults; an
 * administrator's desired_concurrency overrides them up to ABSOLUTE_MAX and produces
 * warnings, never silent reductions, when it exceeds them or the detected hardware.
 */
public final class JudgeCapacity {
    /** Namespace for pg_advisory_xact_lock(int,int); the second key is hashtext(lane/host). */
    public static final int LOCK_SPACE=72_026;
    /** Sanity cap against typos; each slot is one worker thread and broker connection. */
    public static final int ABSOLUTE_MAX=256;
    private JudgeCapacity() {}
    static int integer(Map<String,Object> row,String key){return ((Number)row.get(key)).intValue();}
    static Integer nullable(Map<String,Object> row,String key){Object v=row.get(key);return v==null?null:((Number)v).intValue();}
    static int memorySlots(Map<String,Object> w){return integer(w,"lane_memory_budget_mb")/Math.max(1,integer(w,"slot_memory_mb"));}
    /** Concurrency this worker may run when online and not draining. */
    public static int workerLimit(Map<String,Object> w) {
        Integer desired=nullable(w,"desired_concurrency");
        if(desired!=null)return desired;
        return Math.max(0,Math.min(Math.min(integer(w,"capacity"),integer(w,"default_concurrency")),memorySlots(w)));
    }
    /** Target sent to the worker scheduler: zero while drained. */
    public static int workerTarget(Map<String,Object> w) {
        return Boolean.TRUE.equals(w.get("drain_requested"))?0:workerLimit(w);
    }
    /** Reasons a worker runs fewer jobs than its limit, plus WARNING items for risky administrator values. */
    public static List<String> workerConstraints(Map<String,Object> w,boolean online,long running) {
        List<String> reasons=new ArrayList<>();
        Integer desired=nullable(w,"desired_concurrency");
        int capacity=integer(w,"capacity"),slot=integer(w,"slot_memory_mb");
        if(!online)reasons.add("OFFLINE: no heartbeat in the last 90 seconds");
        if(Boolean.TRUE.equals(w.get("drain_requested")))reasons.add("DRAINING: administrator paused new work on this worker");
        if(desired==null && memorySlots(w)<Math.min(capacity,integer(w,"default_concurrency")))
            reasons.add("LANE_MEMORY: JUDGE_MEMORY_BUDGET_MB allows only "+memorySlots(w)+" slots of "+slot+" MiB");
        reasons.addAll(warnings(w,workerLimit(w)));
        int limit=workerTarget(w);
        if(running>limit)reasons.add("OVER_TARGET: "+running+" running jobs exceed the new limit "+limit+"; they finish normally and no new work starts until below the limit");
        return reasons;
    }
    /** Advisory checks for a proposed slot count; they never block the administrator. */
    public static List<String> warnings(Map<String,Object> w,int slots) {
        List<String> result=new ArrayList<>();
        int slot=integer(w,"slot_memory_mb");
        Integer cpus=nullable(w,"detected_cpus"),memory=nullable(w,"detected_memory_mb");
        if(slots>integer(w,"capacity"))result.add("WARNING: "+slots+" slots is above this worker's deployment default maximum ("+integer(w,"capacity")+")");
        if(cpus!=null && slots>cpus)result.add("WARNING: "+slots+" slots on "+cpus+" detected CPU cores; parallel runs compete for CPU and time limits become unreliable");
        if(memory!=null && (long)slots*slot>memory)result.add("WARNING: "+slots+" x "+slot+" MiB exceeds the "+memory+" MiB of detected memory; memory-heavy submissions may fail");
        else if((long)slots*slot>integer(w,"lane_memory_budget_mb"))result.add("WARNING: "+slots+" x "+slot+" MiB exceeds JUDGE_MEMORY_BUDGET_MB ("+integer(w,"lane_memory_budget_mb")+" MiB)");
        return result;
    }
}
