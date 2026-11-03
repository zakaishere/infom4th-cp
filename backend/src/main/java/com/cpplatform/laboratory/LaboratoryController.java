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
    private final LaboratoryService lab;
    public LaboratoryController(LaboratoryService lab){this.lab=lab;}
    @PostMapping @ResponseStatus(HttpStatus.CREATED)
    Object create(Authentication auth,@RequestBody Map<String,Object> body){return Map.of("versionId",lab.create(Actor.of(auth),body));}
    /** One complete draft per transaction; a bank is uploaded as a sequence of these requests. */
    @PostMapping("/import")
    Object importProblem(Authentication auth,@RequestBody Map<String,Object> body){return lab.importProblem(Actor.of(auth),body);}
    @GetMapping("/{version}/status")
    Object status(Authentication auth,@PathVariable UUID version){return lab.status(Actor.of(auth),version);}
    /** deleted=true lists the deleted problems instead (to restore them). */
    @GetMapping
    Object list(Authentication auth,@RequestParam(defaultValue="false") boolean deleted){return lab.list(Actor.of(auth),deleted);}
    @PostMapping("/{version}/delete")
    Object delete(Authentication auth,@PathVariable UUID version,@RequestBody Map<String,Object> body){lab.delete(Actor.of(auth),version,Api.text(body,"reason",2000));return Map.of("ok",true);}
    @PostMapping("/{version}/restore")
    Object restore(Authentication auth,@PathVariable UUID version,@RequestBody Map<String,Object> body){lab.restore(Actor.of(auth),version,Api.text(body,"reason",2000));return Map.of("ok",true);}
    @GetMapping("/{version}")
    Object detail(Authentication auth,@PathVariable UUID version){return lab.detail(Actor.of(auth),version);}
    @PutMapping("/{version}/collaborators/{user}")
    Object collaborator(Authentication auth,@PathVariable UUID version,@PathVariable UUID user,@RequestBody Map<String,Object> body) {
        lab.grantCollaborator(Actor.of(auth),version,user,Api.text(body,"accessLevel",16),Api.optional(body,"reason",null,2000));return Map.of("ok",true);
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
    @PostMapping("/{version}/publish-duel")
    Object duel(Authentication auth,@PathVariable UUID version){lab.publishDuel(Actor.of(auth),version);return Map.of("ok",true);}
}
