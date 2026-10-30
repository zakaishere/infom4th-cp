package com.cpplatform.judging;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.*;

/** SUPER_ADMIN only: a benchmark uses the same judges as everyone else. */
@RestController
@RequestMapping("/api/admin/benchmark")
public class BenchmarkController {
    private final BenchmarkService benchmarks;
    public BenchmarkController(BenchmarkService benchmarks){this.benchmarks=benchmarks;}
    private static Actor admin(Authentication authentication) {
        Actor actor=Actor.of(authentication);Api.require(actor.superAdmin(),HttpStatus.FORBIDDEN,"Super administrator permission required");return actor;
    }
    @GetMapping
    Object state(Authentication auth){admin(auth);return benchmarks.state();}
    @PostMapping("/problem")
    Object prepare(Authentication auth){return benchmarks.prepare(admin(auth));}
    @PostMapping("/runs") @ResponseStatus(HttpStatus.CREATED)
    Object start(Authentication auth,@RequestBody Map<String,Object> body){return Map.of("runId",benchmarks.start(admin(auth),body));}
    @GetMapping("/runs/{run}")
    Object report(Authentication auth,@PathVariable UUID run){admin(auth);return benchmarks.report(run);}
    @PostMapping("/runs/{run}/cancel")
    Object cancel(Authentication auth,@PathVariable UUID run,@RequestBody Map<String,Object> body) {
        return Map.of("cancelled",benchmarks.cancel(admin(auth),run,Api.optional(body,"reason","Cancelled",2000)));
    }
    @GetMapping("/runs/{run}/report.xlsx")
    ResponseEntity<byte[]> download(Authentication auth,@PathVariable UUID run) {
        admin(auth);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=\"benchmark-"+run.toString().substring(0,8)+".xlsx\"").body(benchmarks.workbook(run));
    }
}
