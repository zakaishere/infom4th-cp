package com.cpplatform.judging;

import com.cpplatform.common.Api;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import java.util.*;

@RestController
@RequestMapping("/internal/judge")
public class JudgeController {
    private final JudgeService judge;
    public JudgeController(JudgeService judge){this.judge=judge;}
    @PostMapping("/workers")
    Object register(@RequestBody Map<String,Object> body){return judge.register(body);}
    @PostMapping("/workers/{worker}/heartbeat")
    Object heartbeat(@PathVariable UUID worker,@RequestBody(required=false) Map<String,Object> body) {
        var control=new LinkedHashMap<String,Object>(judge.heartbeat(worker,body));control.put("ok",true);return control;
    }
    /** 200 claimed, 204 stale/not claimable (acknowledge), 429 capacity full (keep and retry), 409 worker unavailable. */
    @PostMapping("/jobs/{job}/claim")
    ResponseEntity<?> claim(@PathVariable UUID job,@RequestBody Map<String,Object> body) {
        var claimed=judge.claim(job,Api.uuid(body.get("workerId")),Api.number(body,"dispatchSequence",0,0,Integer.MAX_VALUE));
        return claimed.isPresent()?ResponseEntity.ok(claimed.get()):ResponseEntity.noContent().build();
    }
    @PostMapping("/jobs/{job}/heartbeat")
    Object renew(@PathVariable UUID job,@RequestBody Map<String,Object> body) {
        judge.renew(job,Api.uuid(body.get("workerId")),Api.uuid(body.get("leaseToken")));return Map.of("ok",true);
    }
    @PostMapping("/jobs/{job}/complete")
    Object complete(@PathVariable UUID job,@RequestBody Map<String,Object> body) {
        judge.complete(job,Api.uuid(body.get("workerId")),Api.uuid(body.get("leaseToken")),body);return Map.of("ok",true);
    }
}
