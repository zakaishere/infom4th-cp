package com.cpplatform.laboratory;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.util.*;

@RestController
@RequestMapping("/api/lab/problems")
public class LaboratoryController {
    private final LaboratoryService lab;private final Database db;private final Permissions access;
    public LaboratoryController(LaboratoryService lab,Database db,Permissions access){this.lab=lab;this.db=db;this.access=access;}
    @PostMapping @ResponseStatus(HttpStatus.CREATED)
    Object create(Authentication auth,@RequestBody Map<String,Object> body){return Map.of("versionId",lab.create(Actor.of(auth),body));}
    @GetMapping
    Object list(Authentication auth) {
        Actor actor=Actor.of(auth);access.setter(actor);
        return db.jdbc.queryForList("SELECT p.id,p.slug,v.id AS version_id,v.title,v.version_number,v.status FROM problems p JOIN problem_versions v ON v.problem_id=p.id WHERE ? OR p.owner_id=? OR EXISTS(SELECT 1 FROM problem_collaborators c WHERE c.problem_id=p.id AND c.user_id=?) ORDER BY p.created_at DESC LIMIT 200",
                actor.superAdmin(),actor.id(),actor.id());
    }
    @GetMapping("/{version}")
    Object detail(Authentication auth,@PathVariable UUID version) {
        access.problemRead(Actor.of(auth),version);var result=new LinkedHashMap<>(db.one("SELECT * FROM problem_versions WHERE id=?",version));
        result.put("tests",db.jdbc.queryForList("SELECT t.* FROM test_cases t JOIN test_case_groups g ON g.id=t.group_id WHERE t.problem_version_id=? ORDER BY g.position,t.position",version));
        result.put("references",db.jdbc.queryForList("SELECT * FROM reference_solutions WHERE problem_version_id=?",version));
        result.put("validations",db.jdbc.queryForList("SELECT id,status,report::text AS report,created_at,completed_at FROM problem_validation_results WHERE problem_version_id=? ORDER BY created_at DESC",version));
        result.put("languages",db.jdbc.queryForList("SELECT language_code FROM problem_version_languages WHERE problem_version_id=?",String.class,version));return result;
    }
    @PatchMapping("/{version}")
    Object edit(Authentication auth,@PathVariable UUID version,@RequestBody Map<String,Object> body){lab.edit(Actor.of(auth),version,body);return Map.of("ok",true);}
    @PostMapping("/{version}/clone") @ResponseStatus(HttpStatus.CREATED)
    Object cloneVersion(Authentication auth,@PathVariable UUID version){return Map.of("versionId",lab.cloneVersion(Actor.of(auth),version));}
    @PutMapping("/{version}/tests")
    Object tests(Authentication auth,@PathVariable UUID version,@RequestBody List<Map<String,Object>> body){lab.tests(Actor.of(auth),version,body);return Map.of("ok",true);}
    @PostMapping("/{version}/references") @ResponseStatus(HttpStatus.CREATED)
    Object reference(Authentication auth,@PathVariable UUID version,@RequestBody Map<String,Object> body){return Map.of("referenceId",lab.reference(Actor.of(auth),version,body));}
    @PostMapping("/{version}/validate") @ResponseStatus(HttpStatus.ACCEPTED)
    Object validate(Authentication auth,@PathVariable UUID version){return Map.of("validationId",lab.validate(Actor.of(auth),version));}
    @PostMapping("/{version}/approve")
    Object approve(Authentication auth,@PathVariable UUID version,@RequestBody Map<String,Object> body){lab.approve(Actor.of(auth),version,Api.text(body,"reason",2000));return Map.of("ok",true);}
    @PostMapping("/{version}/publish-practice")
    Object practice(Authentication auth,@PathVariable UUID version){lab.publishPractice(Actor.of(auth),version);return Map.of("ok",true);}
}
