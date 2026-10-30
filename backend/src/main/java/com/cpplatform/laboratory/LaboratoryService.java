package com.cpplatform.laboratory;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import java.util.*;

@Service
public class LaboratoryService {
    private final Database db; private final Permissions access;
    public LaboratoryService(Database db,Permissions access) {this.db=db;this.access=access;}
    /** Atomic import: invalid tests/references roll back the entire new problem. Existing slugs are never edited. */
    @Transactional
    public Map<String,Object> importProblem(Actor actor,Map<String,Object> body) {
        access.setter(actor);
        String slug=Api.text(body,"slug",120);
        Api.require(slug.matches("[a-z0-9]+(-[a-z0-9]+)*"),HttpStatus.BAD_REQUEST,"Invalid problem short name");
        // Serialize imports of the same slug, including requests retried after a lost response.
        db.jdbc.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","problem-import:"+slug);
        var existing=db.jdbc.queryForList("SELECT v.id FROM problems p JOIN problem_versions v ON v.problem_id=p.id WHERE p.slug=? ORDER BY v.version_number DESC LIMIT 1",slug);
        if(!existing.isEmpty()) {
            UUID version=(UUID)existing.get(0).get("id");
            access.problemRead(actor,version);
            return Map.of("outcome","SKIPPED","versionId",version);
        }
        var fields=new LinkedHashMap<String,Object>();
        fields.put("slug",slug);fields.put("title",Api.text(body,"title",255));
        fields.put("statement",Api.text(body,"statement",262144));
        for(String key:List.of("inputFormat","outputFormat","constraints","explanation","setterNotes")) {
            Object value=body.getOrDefault(key,"");
            Api.require(value instanceof String && ((String)value).length()<=262144,HttpStatus.BAD_REQUEST,"Invalid "+key);
            fields.put(key,value);
        }
        String difficulty=Api.optional(body,"difficulty","MEDIUM",16),checker=Api.optional(body,"checker","TOKENS",32);
        Api.require(List.of("EASY","MEDIUM","HARD").contains(difficulty),HttpStatus.BAD_REQUEST,"Invalid difficulty");
        Api.require(List.of("EXACT","TRIMMED_LINES","TOKENS").contains(checker),HttpStatus.BAD_REQUEST,"Invalid checker");
        fields.put("difficulty",difficulty);fields.put("checker",checker);
        fields.put("timeLimitMs",Api.number(body,"timeLimitMs",2000,1,60000));
        fields.put("memoryLimitMb",Api.number(body,"memoryLimitMb",256,16,4096));
        fields.put("outputLimitKb",Api.number(body,"outputLimitKb",1024,1,65536));
        Object rawLanguages=body.get("languages");
        Api.require(rawLanguages instanceof List<?> && !((List<?>)rawLanguages).isEmpty() && ((List<?>)rawLanguages).size()<=16
                && ((List<?>)rawLanguages).stream().allMatch(l->l instanceof String && ((String)l).matches("[A-Z][A-Z0-9_]{0,23}")),HttpStatus.BAD_REQUEST,"Invalid languages");
        var languages=Api.languages(body);fields.put("languages",languages);
        Object rawTests=body.get("tests"),rawReference=body.get("reference");
        Api.require(rawTests instanceof List<?>,HttpStatus.BAD_REQUEST,"Tests are required");
        var suite=new ArrayList<Map<String,Object>>();
        for(Object value:(List<?>)rawTests) {
            Api.require(value instanceof Map<?,?>,HttpStatus.BAD_REQUEST,"Invalid test case");
            var test=(Map<?,?>)value;
            Api.require(test.get("input") instanceof String && test.get("expected") instanceof String && test.get("sample") instanceof Boolean,HttpStatus.BAD_REQUEST,"Test input, expected output and sample flag are required");
            suite.add(Map.of("input",test.get("input"),"expected",test.get("expected"),"sample",test.get("sample")));
        }
        Api.require(suite.stream().anyMatch(t->Boolean.TRUE.equals(t.get("sample"))) && suite.stream().anyMatch(t->Boolean.FALSE.equals(t.get("sample"))),HttpStatus.BAD_REQUEST,"Sample and hidden tests are required");
        Api.require(rawReference instanceof Map<?,?>,HttpStatus.BAD_REQUEST,"A reference solution is required");
        var reference=new LinkedHashMap<String,Object>();
        ((Map<?,?>)rawReference).forEach((key,value)->reference.put(String.valueOf(key),value));
        String language=Api.text(reference,"language",24);
        Api.require(languages.contains(language),HttpStatus.BAD_REQUEST,"Reference language must be allowed for the problem");
        Api.text(reference,"sourceCode",262144);
        reference.put("label",Api.optional(reference,"label","Main solution",100));
        reference.put("expectedVerdict","ACCEPTED");
        UUID version=create(actor,fields);
        tests(actor,version,suite);reference(actor,version,reference);
        db.audit(actor.id(),"PROBLEM_IMPORT","problem_version",version,"Problem bank import");
        return Map.of("outcome","IMPORTED","versionId",version);
    }
    @Transactional
    public UUID create(Actor actor,Map<String,Object> body) {
        access.setter(actor);
        String slug=Api.text(body,"slug",120);
        Api.require(slug.matches("[a-z0-9]+(-[a-z0-9]+)*"),HttpStatus.BAD_REQUEST,"Short name may contain lowercase letters, digits and single dashes");
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM problems WHERE slug=?)",slug),HttpStatus.CONFLICT,
                "A problem with the short name \""+slug+"\" already exists. Choose another short name, or delete the old problem in the Problem lab.");
        UUID problem=db.id("INSERT INTO problems(slug,owner_id) VALUES (?,?) RETURNING id",slug,actor.id());
        UUID version=db.id("INSERT INTO problem_versions(problem_id,version_number,title,created_by) VALUES (?,1,?,?) RETURNING id",
                problem,Api.text(body,"title",255),actor.id());
        edit(actor,version,body);db.audit(actor.id(),"PROBLEM_CREATE","problem",problem,null);return version;
    }
    @Transactional
    public void edit(Actor actor,UUID version,Map<String,Object> body) {
        access.problem(actor,version,true);
        var row=db.one("SELECT sealed_at FROM problem_versions WHERE id=? FOR UPDATE",version);
        Api.require(row.get("sealed_at")==null,HttpStatus.CONFLICT,"Clone a sealed version before editing");
        Map<String,String> fields=Map.of("title","title","statement","statement_md","inputFormat","input_format_md",
                "outputFormat","output_format_md","constraints","constraints_md","explanation","explanation_md","setterNotes","setter_notes",
                "difficulty","difficulty","checker","checker");
        for(var field:fields.entrySet()) if(body.containsKey(field.getKey())) {
            String value=String.valueOf(body.get(field.getKey()));
            Api.require(value.length()<=262144,HttpStatus.BAD_REQUEST,"Field too large");
            db.jdbc.update("UPDATE problem_versions SET "+field.getValue()+"=? WHERE id=?",value,version);
        }
        for(var field:Map.of("timeLimitMs","time_limit_ms","memoryLimitMb","memory_limit_mb","outputLimitKb","output_limit_kb").entrySet())
            if(body.containsKey(field.getKey())) db.jdbc.update("UPDATE problem_versions SET "+field.getValue()+"=? WHERE id=?",
                    Api.number(body,field.getKey(),0,1,65536),version);
        if(body.containsKey("languages")) {
            db.jdbc.update("DELETE FROM problem_version_languages WHERE problem_version_id=?",version);
            for(String language:Api.languages(body)) db.jdbc.update("INSERT INTO problem_version_languages VALUES (?,?)",version,language);
        }
    }
    @Transactional
    public UUID cloneVersion(Actor actor,UUID version) {
        access.problem(actor,version,true);
        var old=db.one("SELECT * FROM problem_versions WHERE id=?",version);UUID problem=(UUID)old.get("problem_id");
        db.one("SELECT id FROM problems WHERE id=? FOR UPDATE",problem);
        UUID next=db.id("INSERT INTO problem_versions(problem_id,version_number,title,difficulty,statement_md,input_format_md,output_format_md,constraints_md,explanation_md,setter_notes,time_limit_ms,memory_limit_mb,output_limit_kb,checker,created_by) SELECT problem_id,(SELECT max(version_number)+1 FROM problem_versions WHERE problem_id=?),title,difficulty,statement_md,input_format_md,output_format_md,constraints_md,explanation_md,setter_notes,time_limit_ms,memory_limit_mb,output_limit_kb,checker,? FROM problem_versions WHERE id=? RETURNING id",problem,actor.id(),version);
        db.jdbc.update("INSERT INTO problem_version_languages SELECT ?,language_code FROM problem_version_languages WHERE problem_version_id=?",next,version);
        for(var group:db.jdbc.queryForList("SELECT * FROM test_case_groups WHERE problem_version_id=?",version)) {
            UUID id=db.id("INSERT INTO test_case_groups(problem_version_id,name,position) VALUES (?,?,?) RETURNING id",next,group.get("name"),group.get("position"));
            db.jdbc.update("INSERT INTO test_cases(problem_version_id,group_id,position,is_sample,input_data,expected_output,explanation_md) SELECT ?,?,position,is_sample,input_data,expected_output,explanation_md FROM test_cases WHERE group_id=?",next,id,group.get("id"));
        }
        db.jdbc.update("INSERT INTO reference_solutions(problem_version_id,label,language_code,source_code,expected_verdict,created_by) SELECT ?,label,language_code,source_code,expected_verdict,? FROM reference_solutions WHERE problem_version_id=?",next,actor.id(),version);
        return next;
    }
    @Transactional
    public void tests(Actor actor,UUID version,List<Map<String,Object>> tests) {
        access.problem(actor,version,true);
        var row=db.one("SELECT sealed_at FROM problem_versions WHERE id=? FOR UPDATE",version);
        Api.require(row.get("sealed_at")==null,HttpStatus.CONFLICT,"Version is sealed");
        Api.require(!tests.isEmpty() && tests.size()<=200,HttpStatus.BAD_REQUEST,"Supply 1-200 test cases");
        long total=0;for(var test:tests) {
            for(String field:List.of("input","expected")) {
                Api.require(test.get(field) instanceof String,HttpStatus.BAD_REQUEST,"Test input and expected output are required");
                total+=((String)test.get(field)).getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
            }
        }
        Api.require(total<=16*1024*1024,HttpStatus.BAD_REQUEST,"Test suite exceeds 16 MiB");
        db.jdbc.update("DELETE FROM test_cases WHERE problem_version_id=?",version);
        db.jdbc.update("DELETE FROM test_case_groups WHERE problem_version_id=?",version);
        UUID group=db.id("INSERT INTO test_case_groups(problem_version_id,name,position) VALUES (?,'Main',0) RETURNING id",version);
        for(int i=0;i<tests.size();i++) {
            var test=tests.get(i);
            db.jdbc.update("INSERT INTO test_cases(problem_version_id,group_id,position,is_sample,input_data,expected_output) VALUES (?,?,?,?,?,?)",
                    version,group,i,Boolean.TRUE.equals(test.get("sample")),test.get("input"),test.get("expected"));
        }
    }
    @Transactional
    public UUID reference(Actor actor,UUID version,Map<String,Object> body) {
        access.problem(actor,version,true);
        return db.id("INSERT INTO reference_solutions(problem_version_id,label,language_code,source_code,expected_verdict,created_by) VALUES (?,?,?,?,?,?) RETURNING id",
                version,Api.text(body,"label",100),Api.text(body,"language",24),Api.text(body,"sourceCode",262144),
                Api.text(body,"expectedVerdict",32),actor.id());
    }
    public void runtimes(UUID version) {
        var languages=db.jdbc.queryForList("SELECT l.code FROM problem_version_languages p JOIN languages l ON l.code=p.language_code WHERE p.problem_version_id=? AND l.enabled AND EXISTS(SELECT 1 FROM judge_workers w WHERE w.status='ONLINE' AND w.runtime_manifest->>'lane'='internal' AND w.last_heartbeat_at>now()-interval '90 seconds' AND w.runtime_manifest->l.code->>'verified'='true' AND w.runtime_manifest->l.code->>'imageId'=coalesce((SELECT image_id FROM problem_runtime_pins pin WHERE pin.problem_version_id=p.problem_version_id AND pin.language_code=l.code),l.runtime_image_id))",String.class,version);
        long required=db.jdbc.queryForObject("SELECT count(*) FROM problem_version_languages WHERE problem_version_id=?",Long.class,version);
        Api.require(required>0 && languages.size()==required,HttpStatus.CONFLICT,"A required language has no enabled, verified, online worker");
    }
    @Transactional
    public UUID validate(Actor actor,UUID version) {
        access.problem(actor,version,true);var row=db.one("SELECT * FROM problem_versions WHERE id=? FOR UPDATE",version);
        Api.require("DRAFT".equals(row.get("status")),HttpStatus.CONFLICT,"Clone this version to validate new content");
        Api.require(!((String)row.get("statement_md")).isBlank(),HttpStatus.CONFLICT,"A statement is required");
        Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM test_cases WHERE problem_version_id=? AND is_sample)",version)
                && db.exists("SELECT EXISTS(SELECT 1 FROM test_cases WHERE problem_version_id=? AND NOT is_sample)",version),
                HttpStatus.CONFLICT,"Sample and hidden tests are required");
        var refs=db.jdbc.queryForList("SELECT * FROM reference_solutions WHERE problem_version_id=?",version);
        Api.require(refs.stream().anyMatch(r->"ACCEPTED".equals(r.get("expected_verdict"))),HttpStatus.CONFLICT,"An accepted reference solution is required");
        runtimes(version);
        db.jdbc.update("INSERT INTO problem_runtime_pins(problem_version_id,language_code,image_id) SELECT p.problem_version_id,p.language_code,l.runtime_image_id FROM problem_version_languages p JOIN languages l ON l.code=p.language_code WHERE p.problem_version_id=?",version);
        db.jdbc.update("UPDATE problem_versions SET status='IN_TESTING',sealed_at=now() WHERE id=?",version);
        UUID validation=db.id("INSERT INTO problem_validation_results(problem_version_id,requested_by,status) VALUES (?,?,'PENDING') RETURNING id",version,actor.id());
        for(var ref:refs) {
            UUID submission=db.id("INSERT INTO submissions(context,submitted_by,problem_version_id,language_code,source_code,idempotency_key,validation_id,reference_solution_id) VALUES ('LABORATORY',?,?,?,?,?,?,?) RETURNING id",
                    actor.id(),version,ref.get("language_code"),ref.get("source_code"),UUID.randomUUID(),validation,ref.get("id"));
            db.jdbc.update("INSERT INTO judging_jobs(submission_id,problem_version_id,priority) VALUES (?,?,0)",submission,version);
        }
        db.audit(actor.id(),"PROBLEM_VALIDATE","problem_version",version,null);return validation;
    }
    @Transactional
    public void approve(Actor actor,UUID version,String reason) {
        access.organizer(actor);access.problem(actor,version,false);
        // Never approved, so it can never reach Practice either.
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM problems p JOIN problem_versions v ON v.problem_id=p.id WHERE v.id=? AND p.system_benchmark)",version),HttpStatus.CONFLICT,"The benchmark problem cannot be approved");
        db.one("SELECT id FROM problem_versions WHERE id=? FOR UPDATE",version);
        Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM problem_versions v WHERE v.id=? AND v.status='READY_FOR_REVIEW' AND EXISTS(SELECT 1 FROM problem_validation_results p WHERE p.problem_version_id=v.id AND p.status='PASSED'))",version),
                HttpStatus.CONFLICT,"A passing validation and review-ready version are required");
        db.jdbc.update("UPDATE problem_versions SET status='APPROVED' WHERE id=?",version);
        db.jdbc.update("INSERT INTO problem_reviews(problem_version_id,reviewer_id,decision,reason) VALUES (?,?,'APPROVED',?)",version,actor.id(),reason);
        db.audit(actor.id(),"PROBLEM_APPROVE","problem_version",version,reason);
    }
    /**
     * Deletes a problem from the lab (all its versions). History stays intact: submissions,
     * finished contests and their scoreboards keep referring to it, so this is a soft delete
     * (problems.archived_at). Refused while a contest that has not finished uses the problem.
     * The short name gets a suffix so the same name can be reused for a new problem.
     */
    @Transactional
    public void delete(Actor actor,UUID version,String reason) {
        access.problem(actor,version,true);
        var p=db.one("SELECT p.id,p.slug,p.archived_at FROM problems p JOIN problem_versions v ON v.problem_id=p.id WHERE v.id=? FOR UPDATE OF p",version);
        Api.require(p.get("archived_at")==null,HttpStatus.CONFLICT,"The problem is already deleted");
        UUID problem=(UUID)p.get("id");
        var contests=db.jdbc.queryForList("SELECT DISTINCT c.title FROM competition_problems cp JOIN competition_versions cv ON cv.id=cp.competition_version_id "
                +"JOIN competitions c ON c.id=cv.competition_id WHERE cp.problem_id=? AND c.status NOT IN ('FINISHED','ARCHIVED') ORDER BY 1",String.class,problem);
        Api.require(contests.isEmpty(),HttpStatus.CONFLICT,"Used by a contest that has not finished: "+String.join(", ",contests)+". Remove it from that contest first.");
        db.jdbc.update("UPDATE practice_publications SET hidden=true WHERE problem_id=?",problem);
        String suffix="-deleted-"+UUID.randomUUID().toString().substring(0,6);
        String slug=((String)p.get("slug"));
        slug=slug.substring(0,Math.min(slug.length(),120-suffix.length())).replaceAll("-+$","")+suffix;
        db.jdbc.update("UPDATE problems SET archived_at=now(),slug=? WHERE id=?",slug,problem);
        db.audit(actor.id(),"PROBLEM_DELETE","problem",problem,reason);
    }
    /** Brings a deleted problem back to the lab. Its practice publication stays hidden until shown again. */
    @Transactional
    public void restore(Actor actor,UUID version,String reason) {
        access.problem(actor,version,true);
        var p=db.one("SELECT p.id,p.archived_at FROM problems p JOIN problem_versions v ON v.problem_id=p.id WHERE v.id=? FOR UPDATE OF p",version);
        Api.require(p.get("archived_at")!=null,HttpStatus.CONFLICT,"The problem is not deleted");
        db.jdbc.update("UPDATE problems SET archived_at=NULL WHERE id=?",p.get("id"));
        db.audit(actor.id(),"PROBLEM_RESTORE","problem",(UUID)p.get("id"),reason);
    }
    @Transactional
    public void publishPractice(Actor actor,UUID version) {
        access.organizer(actor);access.problem(actor,version,false);
        var row=db.one("SELECT problem_id,status FROM problem_versions WHERE id=? FOR UPDATE",version);
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM problems WHERE id=? AND archived_at IS NOT NULL)",row.get("problem_id")),HttpStatus.CONFLICT,"Restore the problem before publishing it");
        Api.require(List.of("APPROVED","PUBLISHED").contains(row.get("status")),HttpStatus.CONFLICT,"Approve the problem first");
        if("APPROVED".equals(row.get("status"))) db.jdbc.update("UPDATE problem_versions SET status='PUBLISHED' WHERE id=?",version);
        db.jdbc.update("INSERT INTO practice_publications(problem_id,problem_version_id,published_by) VALUES (?,?,?) ON CONFLICT(problem_id) DO UPDATE SET problem_version_id=excluded.problem_version_id,published_by=excluded.published_by,published_at=now()",row.get("problem_id"),version,actor.id());
        db.audit(actor.id(),"PRACTICE_PUBLISH","problem_version",version,null);
    }
}
