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
    /** Atomic import: invalid tests/references roll back the entire new problem. Unplaced failed/draft attempts are replaced automatically. */
    @Transactional
    public Map<String,Object> importProblem(Actor actor,Map<String,Object> body) {
        access.setter(actor);
        String slug=Api.text(body,"slug",120);
        Api.require(slug.matches("[a-z0-9]+(-[a-z0-9]+)*"),HttpStatus.BAD_REQUEST,"Invalid problem short name");
        // Serialize imports of the same slug, including requests retried after a lost response.
        db.jdbc.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","problem-import:"+slug);
        var existing=db.jdbc.queryForList("""
                SELECT p.id AS problem_id,p.archived_at,v.id,v.status,
                       (SELECT r.status FROM problem_validation_results r WHERE r.problem_version_id=v.id ORDER BY r.created_at DESC LIMIT 1) AS validation_status,
                       EXISTS(SELECT 1 FROM competition_problems cp WHERE cp.problem_id=p.id) AS in_contest,
                       EXISTS(SELECT 1 FROM practice_publications pp WHERE pp.problem_id=p.id AND NOT pp.hidden) AS in_practice,
                       EXISTS(SELECT 1 FROM duel_problems dp WHERE dp.problem_id=p.id AND NOT dp.hidden) AS in_duel
                FROM problems p JOIN problem_versions v ON v.problem_id=p.id
                WHERE p.slug=? ORDER BY v.version_number DESC LIMIT 1
                """,slug);
        String contestFlag=normalizeFlag(body.get("contestFlag"));
        String folder=normalizeFolder(body.get("folder"));
        String[] tags=body.containsKey("tags")?normalizeTags(body.get("tags")):null;
        if(!existing.isEmpty()) {
            var prev=existing.get(0);
            UUID prevProblem=(UUID)prev.get("problem_id");
            UUID prevVersion=(UUID)prev.get("id");
            String prevStatus=String.valueOf(prev.get("status"));
            String prevVal=String.valueOf(prev.get("validation_status"));
            boolean unplaced=!Boolean.TRUE.equals(prev.get("in_contest"))
                    && !Boolean.TRUE.equals(prev.get("in_practice"))
                    && !Boolean.TRUE.equals(prev.get("in_duel"));
            boolean replaceable=unplaced && ("DRAFT".equals(prevStatus)
                    || ("IN_TESTING".equals(prevStatus) && List.of("FAILED","JUDGE_ERROR").contains(prevVal)));
            if(prev.get("archived_at")!=null) {
                access.problem(actor,prevVersion,true);
                String suffix="-deleted-"+UUID.randomUUID().toString().substring(0,6);
                String freed=slug.substring(0,Math.min(slug.length(),120-suffix.length())).replaceAll("-+$","")+suffix;
                db.jdbc.update("UPDATE problems SET slug=? WHERE id=?",freed,prevProblem);
            } else if(replaceable) {
                delete(actor,prevVersion,"Automatically replaced by re-import");
            } else {
                access.problemRead(actor,prevVersion);
                if(contestFlag!=null) db.jdbc.update("UPDATE problems SET contest_flag=? WHERE id=?",contestFlag,prevProblem);
                if(folder!=null) {
                    ensureCollection(actor.id(),folder);
                    db.jdbc.update("UPDATE problems SET folder=? WHERE id=?",folder,prevProblem);
                }
                if(tags!=null && tags.length>0) {
                    db.jdbc.update("UPDATE problems SET tags=?::text[] WHERE id=? AND cardinality(tags)=0",tags,prevProblem);
                    db.jdbc.update("UPDATE practice_publications SET tags=?::text[] WHERE problem_id=? AND cardinality(tags)=0",tags,prevProblem);
                }
                return Map.of("outcome","SKIPPED","versionId",prevVersion);
            }
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
        if(body.get("functionSignature")!=null) fields.put("functionSignature",body.get("functionSignature"));
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
        if(contestFlag!=null) fields.put("contestFlag",contestFlag);
        if(folder!=null) fields.put("folder",folder);
        if(tags!=null && tags.length>0) fields.put("tags",List.of(tags));
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
        String[] tags=body.containsKey("tags")?normalizeTags(body.get("tags")):new String[0];
        String folder=normalizeFolder(body.get("folder"));
        if(folder!=null) ensureCollection(actor.id(),folder);
        UUID problem=db.id("INSERT INTO problems(slug,owner_id,contest_flag,folder,tags) VALUES (?,?,?,?,?::text[]) RETURNING id",slug,actor.id(),normalizeFlag(body.get("contestFlag")),folder,tags);
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
            // Diff instead of delete-then-insert: reference_solutions references
            // (problem_version_id, language_code), so wiping the list always violates that
            // foreign key on any problem that has references. Add what is missing, and only
            // drop a language once its reference solution is gone.
            var wanted=new LinkedHashSet<>(Api.languages(body));
            var current=new LinkedHashSet<>(db.jdbc.queryForList("SELECT language_code FROM problem_version_languages WHERE problem_version_id=?",String.class,version));
            for(String language:wanted) {
                if(!current.contains(language)) {
                    Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM languages WHERE code=? AND enabled)",language),
                            HttpStatus.BAD_REQUEST,"Unknown or disabled language: "+language);
                    db.jdbc.update("INSERT INTO problem_version_languages(problem_version_id,language_code) VALUES (?,?)",version,language);
                }
            }
            for(String language:current) {
                if(wanted.contains(language)) continue;
                Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM reference_solutions WHERE problem_version_id=? AND language_code=?)",version,language),
                        HttpStatus.CONFLICT,"Delete the "+language+" reference solution before removing that language");
                db.jdbc.update("DELETE FROM problem_version_languages WHERE problem_version_id=? AND language_code=?",version,language);
            }
        }
        if(body.containsKey("functionSignature"))
            db.jdbc.update("UPDATE problem_versions SET function_signature=? WHERE id=?",FunctionSignature.normalize(body.get("functionSignature")),version);
        if(body.containsKey("functionSignature") || body.containsKey("languages")) functionLanguages(version);
    }
    /** A function problem may only offer languages the judge can generate a driver for. */
    private void functionLanguages(UUID version) {
        if(signature(version)==null)return;
        for(String language:db.jdbc.queryForList("SELECT language_code FROM problem_version_languages WHERE problem_version_id=? ORDER BY language_code",String.class,version))
            Api.require(FunctionSignature.LANGUAGES.contains(language),HttpStatus.BAD_REQUEST,language+" cannot be offered on a function problem");
    }
    private String signature(UUID version) {
        return (String)db.one("SELECT function_signature FROM problem_versions WHERE id=?",version).get("function_signature");
    }
    private void functionTests(UUID version,List<Map<String,Object>> tests) {
        String signature=signature(version);
        if(signature==null)return;
        for(int i=0;i<tests.size();i++)
            FunctionSignature.checkTest(signature,i,(String)tests.get(i).get("input"),(String)tests.get(i).get("expected"));
    }
    @Transactional
    public UUID cloneVersion(Actor actor,UUID version) {
        access.problem(actor,version,true);
        var old=db.one("SELECT * FROM problem_versions WHERE id=?",version);UUID problem=(UUID)old.get("problem_id");
        db.one("SELECT id FROM problems WHERE id=? FOR UPDATE",problem);
        UUID next=db.id("INSERT INTO problem_versions(problem_id,version_number,title,difficulty,statement_md,input_format_md,output_format_md,constraints_md,explanation_md,setter_notes,time_limit_ms,memory_limit_mb,output_limit_kb,checker,function_signature,created_by) SELECT problem_id,(SELECT max(version_number)+1 FROM problem_versions WHERE problem_id=?),title,difficulty,statement_md,input_format_md,output_format_md,constraints_md,explanation_md,setter_notes,time_limit_ms,memory_limit_mb,output_limit_kb,checker,function_signature,? FROM problem_versions WHERE id=? RETURNING id",problem,actor.id(),version);
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
        functionTests(version,tests);
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
        // The signature may have changed after the tests were saved.
        functionTests(version,db.jdbc.queryForList("SELECT input_data AS input,expected_output AS expected FROM test_cases WHERE problem_version_id=? ORDER BY position",version));
        functionLanguages(version);
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
        db.jdbc.update("UPDATE duel_problems SET hidden=true WHERE problem_id=?",problem);
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
        db.jdbc.update("INSERT INTO practice_publications(problem_id,problem_version_id,published_by,tags) SELECT ?,?,?,p.tags FROM problems p WHERE p.id=? "
                +"ON CONFLICT(problem_id) DO UPDATE SET problem_version_id=excluded.problem_version_id,published_by=excluded.published_by,published_at=now(),hidden=false,"
                +"tags=CASE WHEN cardinality(practice_publications.tags)>0 THEN practice_publications.tags ELSE excluded.tags END",row.get("problem_id"),version,actor.id(),row.get("problem_id"));
        db.audit(actor.id(),"PRACTICE_PUBLISH","problem_version",version,null);
    }
    /** Publishes to practice and, when the bank names a TD, places it there at its position with its topics. */
    @Transactional
    public void publishPractice(Actor actor,UUID version,Map<String,Object> placement) {
        publishPractice(actor,version);
        if(placement.get("mission") instanceof Map<?,?> mission) placeInMission(version,mission,placement);
        if(!(placement.get("td") instanceof Map<?,?> td))return;
        int number=td.get("number") instanceof Number n?Math.max(1,Math.min(99,n.intValue())):1;
        int position=td.get("position") instanceof Number n?Math.max(0,Math.min(999,n.intValue())):0;
        if(placement.get("tags") instanceof List<?> l) {
            var tags=l.stream().map(String::valueOf).limit(8).toArray(String[]::new);
            db.jdbc.update("UPDATE practice_publications SET td_number=?,td_position=?,tags=?::text[] WHERE problem_version_id=?",number,position,tags,version);
        } else {
            db.jdbc.update("UPDATE practice_publications SET td_number=?,td_position=? WHERE problem_version_id=?",number,position,version);
        }
    }
    /** Puts the problem in a mission, creating the mission on first use; an existing mission keeps its title and window. */
    private void placeInMission(UUID version,Map<?,?> mission,Map<String,Object> placement) {
        String slug=String.valueOf(mission.get("slug")),title=String.valueOf(mission.get("title"));
        Api.require(slug.matches("^[a-z0-9][a-z0-9-]{1,63}$"),HttpStatus.BAD_REQUEST,"Invalid mission short name");
        Api.require(!title.isBlank() && title.length()<=120,HttpStatus.BAD_REQUEST,"Invalid mission title");
        String description=mission.get("description")==null?"":String.valueOf(mission.get("description"));
        db.jdbc.update("INSERT INTO missions(slug,title,description) VALUES (?,?,?) ON CONFLICT(slug) DO NOTHING",slug,title,description);
        UUID id=(UUID)db.one("SELECT id FROM missions WHERE slug=?",slug).get("id");
        UUID problem=(UUID)db.one("SELECT problem_id FROM problem_versions WHERE id=?",version).get("problem_id");
        int position=mission.get("position") instanceof Number n?Math.max(0,Math.min(999,n.intValue())):0;
        double weight=mission.get("weight") instanceof Number n?Math.max(0.01,Math.min(1000,n.doubleValue())):10;
        db.jdbc.update("INSERT INTO mission_problems(mission_id,problem_id,position,weight) VALUES (?,?,?,?) ON CONFLICT(problem_id) DO UPDATE SET mission_id=excluded.mission_id,position=excluded.position,weight=excluded.weight",id,problem,position,weight);
        db.jdbc.update("UPDATE practice_publications SET td_number=NULL,td_position=0,hidden=false WHERE problem_id=?",problem);
        if(placement.get("tags") instanceof List<?> l) {
            var tags=l.stream().map(String::valueOf).limit(8).toArray(String[]::new);
            db.jdbc.update("UPDATE practice_publications SET tags=?::text[] WHERE problem_version_id=?",tags,version);
        }
    }
    /** Adds an approved version to the duel pool, or replaces the problem's version there. Independent of practice. */
    @Transactional
    public void publishDuel(Actor actor,UUID version) {
        access.organizer(actor);access.problem(actor,version,false);
        var row=db.one("SELECT problem_id,status FROM problem_versions WHERE id=? FOR UPDATE",version);
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM problems WHERE id=? AND archived_at IS NOT NULL)",row.get("problem_id")),HttpStatus.CONFLICT,"Restore the problem before publishing it");
        Api.require(List.of("APPROVED","PUBLISHED").contains(row.get("status")),HttpStatus.CONFLICT,"Approve the problem first");
        if("APPROVED".equals(row.get("status"))) db.jdbc.update("UPDATE problem_versions SET status='PUBLISHED' WHERE id=?",version);
        db.jdbc.update("INSERT INTO duel_problems(problem_id,problem_version_id,published_by) VALUES (?,?,?) ON CONFLICT(problem_id) DO UPDATE SET problem_version_id=excluded.problem_version_id,published_by=excluded.published_by,published_at=now(),hidden=false",row.get("problem_id"),version,actor.id());
        db.audit(actor.id(),"DUEL_PUBLISH","problem_version",version,null);
    }

    /** Grants or changes a user's access to the problem (EDITOR, REVIEWER or MANAGER); only the owner or a super administrator delegates. */
    @Transactional
    public void grantCollaborator(Actor actor,UUID version,UUID user,String accessLevel,String reason) {
        var p=db.one("SELECT p.id,p.owner_id FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id=?",version);
        Api.require(actor.superAdmin() || actor.id().equals(p.get("owner_id")),HttpStatus.FORBIDDEN,"Only the owner can delegate problem permissions");
        db.jdbc.update("INSERT INTO problem_collaborators(problem_id,user_id,access_level,granted_by) VALUES (?,?,?,?) ON CONFLICT(problem_id,user_id) DO UPDATE SET access_level=excluded.access_level,granted_by=excluded.granted_by",
                p.get("id"),user,accessLevel,actor.id());
        db.audit(actor.id(),"COLLABORATOR_GRANT","problem",(UUID)p.get("id"),reason);
    }
    public Map<String,Object> status(Actor actor,UUID version) {
        access.problemRead(actor,version);
        return db.one("SELECT v.id,v.status,(SELECT r.status FROM problem_validation_results r WHERE r.problem_version_id=v.id ORDER BY r.created_at DESC LIMIT 1) AS validation_status FROM problem_versions v WHERE v.id=?",version);
    }
    static String[] normalizeTags(Object raw) {
        if(raw==null) return new String[0];
        Api.require(raw instanceof List<?>,HttpStatus.BAD_REQUEST,"tags must be a list");
        LinkedHashSet<String> tags=new LinkedHashSet<>();
        for(Object item:(List<?>)raw) {
            String tag=String.valueOf(item).trim().toLowerCase(Locale.ROOT).replaceAll("\\s+"," ");
            if(tag.isEmpty()) continue;
            Api.require(tag.matches("[a-z0-9][a-z0-9 +#.-]{0,23}"),HttpStatus.BAD_REQUEST,"Tags use letters, digits, space, + # . - (max 24 characters)");
            tags.add(tag);
        }
        Api.require(tags.size()<=8,HttpStatus.BAD_REQUEST,"At most 8 tags");
        return tags.toArray(new String[0]);
    }

    static String normalizeFlag(Object raw) {
        if(raw==null) return null;
        String s=String.valueOf(raw).trim();
        if(s.isEmpty()) return null;
        Api.require(s.length()<=32 && s.matches("[A-Za-z0-9 _-]+"),HttpStatus.BAD_REQUEST,"Flag may use letters, digits, spaces, _ or - (max 32 chars)");
        String upper=s.toUpperCase(Locale.ROOT);
        if(upper.equals("CONTEST") || upper.equals("NORMAL") || upper.equals("STANDARD")) return "STANDARD";
        if(upper.equals("BASIC") || upper.equals("WARMUP")) return upper;
        return s;
    }

    /** Bulk-sets or clears the contest pool flag on one or more problems (accepts problem IDs or version IDs). */
    @Transactional
    public int setContestFlags(Actor actor,List<UUID> ids,Object rawFlag) {
        access.organizer(actor);
        String flag=normalizeFlag(rawFlag);
        UUID[] arr=ids.toArray(UUID[]::new);
        int updated=db.jdbc.update("UPDATE problems SET contest_flag=? WHERE NOT system_benchmark AND (id=ANY(?::uuid[]) OR id IN (SELECT problem_id FROM problem_versions WHERE id=ANY(?::uuid[])))",
                flag,arr,arr);
        db.audit(actor.id(),"PROBLEM_FLAG","problem",null,(flag==null?"Cleared flag":("Flagged "+flag))+" ("+updated+" problems)");
        return updated;
    }

    static String normalizeFolder(Object raw) {
        if(raw==null) return null;
        String[] parts=String.valueOf(raw).replace('\\','/').split("/");
        List<String> clean=new ArrayList<>();
        for(String part:parts) {
            String s=part.trim().replaceAll("\\s+"," ");
            if(s.isEmpty()) continue;
            Api.require(s.matches("[A-Za-z0-9 _.-]{1,40}"),HttpStatus.BAD_REQUEST,"Folder names may use letters, digits, spaces, _ . -");
            clean.add(s);
        }
        if(clean.isEmpty()) return null;
        Api.require(clean.size()<=4,HttpStatus.BAD_REQUEST,"Folders may be nested at most 4 levels deep");
        String joined=String.join("/",clean);
        Api.require(joined.length()<=120,HttpStatus.BAD_REQUEST,"Folder path is too long (max 120 chars)");
        return joined;
    }

    private void ensureCollection(UUID userId,String folder) {
        if(folder==null || folder.isBlank()) return;
        db.jdbc.update("INSERT INTO problem_collections(name,created_by) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM problem_collections WHERE lower(name)=lower(?))",
                folder,userId,folder);
    }

    /** Persisted collections plus any distinct problem folder paths, sorted alphabetically with problem counts. */
    public List<Map<String,Object>> collections(Actor actor) {
        access.setter(actor);
        return db.jdbc.queryForList(
                "WITH names AS ("
                +"SELECT name FROM problem_collections "
                +"UNION "
                +"SELECT DISTINCT folder AS name FROM problems WHERE folder IS NOT NULL AND NOT system_benchmark AND archived_at IS NULL"
                +") "
                +"SELECT n.name,(SELECT count(*) FROM problems p WHERE NOT p.system_benchmark AND p.archived_at IS NULL AND (p.folder=n.name OR p.folder LIKE n.name||'/%')) AS problem_count "
                +"FROM names n ORDER BY lower(n.name),n.name");
    }

    @Transactional
    public String createCollection(Actor actor,Object rawName) {
        access.organizer(actor);
        String name=normalizeFolder(rawName);
        Api.require(name!=null,HttpStatus.BAD_REQUEST,"Enter a collection name");
        ensureCollection(actor.id(),name);
        db.audit(actor.id(),"COLLECTION_CREATE","problem",null,name);
        return name;
    }

    @Transactional
    public String renameCollection(Actor actor,Object oldRaw,Object newRaw) {
        access.organizer(actor);
        String from=normalizeFolder(oldRaw),to=normalizeFolder(newRaw);
        Api.require(from!=null && to!=null,HttpStatus.BAD_REQUEST,"Enter both current and new collection names");
        if(from.equals(to)) return to;
        db.jdbc.update("DELETE FROM problem_collections WHERE lower(name)=lower(?)",from);
        ensureCollection(actor.id(),to);
        int exact=db.jdbc.update("UPDATE problems SET folder=? WHERE NOT system_benchmark AND folder=?",to,from);
        int nested=db.jdbc.update("UPDATE problems SET folder=?||substring(folder FROM ?) WHERE NOT system_benchmark AND folder LIKE ?",
                to,from.length()+1,from+"/%");
        for(var sub:db.jdbc.queryForList("SELECT id,name FROM problem_collections WHERE name LIKE ?",from+"/%")) {
            String nextSub=to+((String)sub.get("name")).substring(from.length());
            db.jdbc.update("DELETE FROM problem_collections WHERE id=?",sub.get("id"));
            ensureCollection(actor.id(),nextSub);
        }
        db.audit(actor.id(),"COLLECTION_RENAME","problem",null,from+" -> "+to+" ("+(exact+nested)+" problems)");
        return to;
    }

    @Transactional
    public int deleteCollection(Actor actor,Object rawName) {
        access.organizer(actor);
        String name=normalizeFolder(rawName);
        Api.require(name!=null,HttpStatus.BAD_REQUEST,"Choose a collection to delete");
        db.jdbc.update("DELETE FROM problem_collections WHERE lower(name)=lower(?) OR lower(name) LIKE lower(?)",name,name+"/%");
        int cleared=db.jdbc.update("UPDATE problems SET folder=NULL WHERE NOT system_benchmark AND (folder=? OR folder LIKE ?)",name,name+"/%");
        db.audit(actor.id(),"COLLECTION_DELETE","problem",null,name+" ("+cleared+" problems removed from collection)");
        return cleared;
    }

    /** Bulk-moves problems into a library folder/collection, or unfiles them when folder is null/blank. */
    @Transactional
    public int moveToFolder(Actor actor,List<UUID> ids,Object rawFolder) {
        access.organizer(actor);
        String folder=normalizeFolder(rawFolder);
        if(folder!=null) ensureCollection(actor.id(),folder);
        UUID[] arr=ids.toArray(UUID[]::new);
        int updated=db.jdbc.update("UPDATE problems SET folder=? WHERE NOT system_benchmark AND (id=ANY(?::uuid[]) OR id IN (SELECT problem_id FROM problem_versions WHERE id=ANY(?::uuid[])))",
                folder,arr,arr);
        db.audit(actor.id(),"PROBLEM_MOVE","problem",null,(folder==null?"Removed from collection":("Moved to "+folder))+" ("+updated+" problems)");
        return updated;
    }

    /** Approves every review-ready problem version in the selection that has a passing validation. */
    @Transactional
    public int bulkApprove(Actor actor,List<UUID> versionIds,String reason) {
        access.organizer(actor);
        String note=(reason==null || reason.isBlank())?"Approved in bulk from Problem Bank":reason.trim();
        int count=0;
        for(UUID version:versionIds) {
            var rows=db.jdbc.queryForList("SELECT v.id,v.status FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id=? AND NOT p.system_benchmark AND p.archived_at IS NULL FOR UPDATE",version);
            if(rows.isEmpty()) continue;
            if("READY_FOR_REVIEW".equals(rows.get(0).get("status"))
                    && db.exists("SELECT EXISTS(SELECT 1 FROM problem_validation_results r WHERE r.problem_version_id=? AND r.status='PASSED')",version)) {
                approve(actor,version,note);
                count++;
            }
        }
        return count;
    }

    /** Soft-deletes every selected problem that is not in an active contest. */
    @Transactional
    public int bulkDelete(Actor actor,List<UUID> versionIds,String reason) {
        String note=(reason==null || reason.isBlank())?"Deleted in bulk from Problem Bank":reason.trim();
        int count=0;
        for(UUID version:versionIds.stream().distinct().toList()) {
            var rows=db.jdbc.queryForList("SELECT p.archived_at FROM problems p JOIN problem_versions v ON v.problem_id=p.id WHERE v.id=?",version);
            if(rows.isEmpty() || rows.get(0).get("archived_at")!=null) continue;
            delete(actor,version,note);
            count++;
        }
        return count;
    }

    /** Bulk-updates topic tags on problems (either replacing or merging with existing tags). */
    @Transactional
    public int bulkTags(Actor actor,List<UUID> ids,Object rawTags,boolean append) {
        access.organizer(actor);
        String[] incoming=normalizeTags(rawTags);
        UUID[] arr=ids.toArray(UUID[]::new);
        var problems=db.jdbc.queryForList("SELECT id,tags FROM problems WHERE NOT system_benchmark AND (id=ANY(?::uuid[]) OR id IN (SELECT problem_id FROM problem_versions WHERE id=ANY(?::uuid[]))) FOR UPDATE",arr,arr);
        for(var p:problems) {
            UUID pid=(UUID)p.get("id");
            LinkedHashSet<String> merged=new LinkedHashSet<>();
            if(append && p.get("tags") instanceof java.sql.Array sqlArr) {
                try{Collections.addAll(merged,(String[])sqlArr.getArray());}catch(java.sql.SQLException e){throw new IllegalStateException(e);}
            }
            for(String t:incoming) {
                if(merged.size()>=8) break;
                merged.add(t);
            }
            String[] next=merged.toArray(new String[0]);
            db.jdbc.update("UPDATE problems SET tags=?::text[] WHERE id=?",next,pid);
            db.jdbc.update("UPDATE practice_publications SET tags=?::text[] WHERE problem_id=?",next,pid);
        }
        db.audit(actor.id(),"PROBLEM_TAGS","problem",null,"Updated tags ("+problems.size()+" problems)");
        return problems.size();
    }

    private static String slugifyMission(String text) {
        String slug=java.text.Normalizer.normalize(text.toLowerCase(Locale.ROOT),java.text.Normalizer.Form.NFD)
                .replaceAll("[\\u0300-\\u036f]","").replaceAll("[^a-z0-9]+","-").replaceAll("^-+|-+$","");
        return slug.length()>60?slug.substring(0,60).replaceAll("-+$",""):slug;
    }

    /**
     * Unified bulk assignment from the Problem Bank to any surface:
     * PRACTICE, TD, MISSION, DUEL, CONTEST (attach to existing editable competition), or COLLECTION.
     */
    @Transactional
    public Map<String,Object> assign(Actor actor,Map<String,Object> body) {
        access.organizer(actor);
        Api.require(body.get("versionIds") instanceof List<?> rawList && !rawList.isEmpty() && rawList.size()<=500,HttpStatus.BAD_REQUEST,"Select 1 to 500 problems");
        List<UUID> versionIds=((List<?>)body.get("versionIds")).stream().map(Api::uuid).distinct().toList();
        String surface=Api.text(body,"surface",32).toUpperCase(Locale.ROOT);
        String action=Api.optional(body,"action","add",16).toLowerCase(Locale.ROOT);
        Api.require(List.of("add","remove").contains(action),HttpStatus.BAD_REQUEST,"action must be add or remove");

        if("COLLECTION".equals(surface)) {
            int updated=moveToFolder(actor,versionIds,"remove".equals(action)?null:body.get("collection"));
            return Map.of("updated",updated,"surface",surface,"action",action);
        }
        Api.require(List.of("PRACTICE","TD","MISSION","DUEL","CONTEST").contains(surface),HttpStatus.BAD_REQUEST,"Unknown assignment target: "+surface);

        if("remove".equals(action)) {
            int updated=0;
            for(UUID versionId:versionIds) {
                var row=db.one("SELECT problem_id FROM problem_versions WHERE id=?",versionId);
                UUID problemId=(UUID)row.get("problem_id");
                switch(surface) {
                    case "PRACTICE" -> updated+=db.jdbc.update("UPDATE practice_publications SET hidden=true WHERE problem_id=? AND td_number IS NULL AND NOT EXISTS(SELECT 1 FROM mission_problems mp WHERE mp.problem_id=practice_publications.problem_id)",problemId);
                    case "TD" -> updated+=db.jdbc.update("UPDATE practice_publications SET hidden=true,td_number=NULL,td_position=0 WHERE problem_id=? AND td_number IS NOT NULL",problemId);
                    case "MISSION" -> {
                        int removed=db.jdbc.update("DELETE FROM mission_problems WHERE problem_id=?",problemId);
                        if(removed>0) db.jdbc.update("UPDATE practice_publications SET hidden=true WHERE problem_id=?",problemId);
                        updated+=removed;
                    }
                    case "DUEL" -> updated+=db.jdbc.update("UPDATE duel_problems SET hidden=true WHERE problem_id=?",problemId);
                    default -> Api.require(false,HttpStatus.BAD_REQUEST,"Detach contest problems from the Contest page");
                }
            }
            db.audit(actor.id(),"PROBLEM_UNASSIGN","problem",null,surface+" ("+updated+" problems)");
            return Map.of("updated",updated,"surface",surface,"action",action);
        }

        // Validate/auto-approve versions before placing them on a live surface.
        List<Map<String,Object>> ready=new ArrayList<>();
        for(UUID versionId:versionIds) {
            var row=db.one("SELECT v.id,v.problem_id,v.title,v.status,v.difficulty,p.folder,p.archived_at FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id=? AND NOT p.system_benchmark FOR UPDATE",versionId);
            Api.require(row.get("archived_at")==null,HttpStatus.CONFLICT,"Restore \""+row.get("title")+"\" before assigning it");
            String st=(String)row.get("status");
            if("READY_FOR_REVIEW".equals(st) && db.exists("SELECT EXISTS(SELECT 1 FROM problem_validation_results r WHERE r.problem_version_id=? AND r.status='PASSED')",versionId)) {
                approve(actor,versionId,"Approved during assignment to "+surface.toLowerCase(Locale.ROOT));
                st="APPROVED";
            }
            Api.require(List.of("APPROVED","PUBLISHED").contains(st),HttpStatus.CONFLICT,
                    "\""+row.get("title")+"\" is still "+st.toLowerCase(Locale.ROOT).replace('_',' ')+" — validate it before assigning to "+surface.toLowerCase(Locale.ROOT));
            ready.add(row);
        }

        int updated=0;
        String extraSlug=null;
        switch(surface) {
            case "PRACTICE" -> {
                for(var row:ready) {
                    UUID versionId=(UUID)row.get("id"),problemId=(UUID)row.get("problem_id");
                    publishPractice(actor,versionId);
                    db.jdbc.update("DELETE FROM mission_problems WHERE problem_id=?",problemId);
                    db.jdbc.update("UPDATE practice_publications SET hidden=false,td_number=NULL,td_position=0 WHERE problem_id=?",problemId);
                    updated++;
                }
            }
            case "TD" -> {
                int tdNumber=Api.number(body,"tdNumber",1,1,99);
                int nextPos=((Number)db.one("SELECT coalesce(max(td_position),0) AS n FROM practice_publications WHERE td_number=? AND NOT hidden",tdNumber).get("n")).intValue();
                for(var row:ready) {
                    UUID versionId=(UUID)row.get("id"),problemId=(UUID)row.get("problem_id");
                    var existingTd=db.jdbc.queryForList("SELECT td_number,td_position FROM practice_publications WHERE problem_id=? AND NOT hidden",problemId);
                    int pos=(!existingTd.isEmpty() && Integer.valueOf(tdNumber).equals(existingTd.get(0).get("td_number")))
                            ?((Number)existingTd.get(0).get("td_position")).intValue()
                            :++nextPos;
                    publishPractice(actor,versionId);
                    db.jdbc.update("DELETE FROM mission_problems WHERE problem_id=?",problemId);
                    db.jdbc.update("UPDATE practice_publications SET hidden=false,td_number=?,td_position=? WHERE problem_id=?",tdNumber,Math.min(999,pos),problemId);
                    updated++;
                }
            }
            case "MISSION" -> {
                double weight=body.get("weight") instanceof Number n?n.doubleValue():10.0;
                Api.require(weight>0 && weight<=1000,HttpStatus.BAD_REQUEST,"Points must be between 0 and 1000");
                String slug=body.get("missionSlug")==null?"":String.valueOf(body.get("missionSlug")).trim();
                String title;
                if(!slug.isEmpty()) {
                    var m=db.jdbc.queryForList("SELECT id,slug,title FROM missions WHERE slug=?",slug);
                    Api.require(!m.isEmpty(),HttpStatus.NOT_FOUND,"Mission not found");
                    title=(String)m.get(0).get("title");
                } else {
                    title=Api.text(body,"missionTitle",120);
                    slug=slugifyMission(title);
                    Api.require(slug.length()>=2,HttpStatus.BAD_REQUEST,"Mission title needs at least two letters or digits");
                    String description=Api.optional(body,"missionDescription","",4000);
                    db.jdbc.update("INSERT INTO missions(slug,title,description) VALUES (?,?,?) ON CONFLICT(slug) DO NOTHING",slug,title,description);
                }
                extraSlug=slug;
                UUID missionId=(UUID)db.one("SELECT id FROM missions WHERE slug=?",slug).get("id");
                int nextPos=((Number)db.one("SELECT coalesce(max(position),0) AS n FROM mission_problems WHERE mission_id=?",missionId).get("n")).intValue();
                for(var row:ready) {
                    UUID versionId=(UUID)row.get("id"),problemId=(UUID)row.get("problem_id");
                    var existingPos=db.jdbc.queryForList("SELECT position FROM mission_problems WHERE mission_id=? AND problem_id=?",missionId,problemId);
                    int pos=!existingPos.isEmpty()?((Number)existingPos.get(0).get("position")).intValue():++nextPos;
                    publishPractice(actor,versionId,Map.of("mission",Map.of("slug",slug,"title",title,"position",Math.min(999,pos),"weight",weight)));
                    updated++;
                }
            }
            case "DUEL" -> {
                for(var row:ready) {
                    publishDuel(actor,(UUID)row.get("id"));
                    updated++;
                }
            }
            case "CONTEST" -> {
                UUID competitionId=Api.uuid(body.get("competitionId"));
                access.competition(actor,competitionId,false);
                db.one("SELECT id FROM competitions WHERE id=? FOR UPDATE",competitionId);
                var cv=db.one("SELECT * FROM competition_versions WHERE competition_id=? ORDER BY version_number DESC LIMIT 1",competitionId);
                UUID cvId=(UUID)cv.get("id");
                boolean editable=cv.get("sealed_at")==null
                        || (db.exists("SELECT EXISTS(SELECT 1 FROM contest_runs r WHERE r.competition_version_id=? AND r.kind='OFFICIAL' AND r.status='PENDING' AND r.starts_at>now())",cvId)
                        && !db.exists("SELECT EXISTS(SELECT 1 FROM contest_runs r WHERE r.competition_version_id=? AND r.kind='OFFICIAL' AND (r.status<>'PENDING' OR r.starts_at<=now()))",cvId));
                Api.require(editable,HttpStatus.CONFLICT,"Problems are locked because this contest has already started or finished");
                String scoring=String.valueOf(cv.get("scoring_system"));
                boolean isWarmup="WARMUP".equals(cv.get("contest_format"));
                int maxDays=Math.max(1,(int)Math.ceil(((Number)cv.get("duration_seconds")).doubleValue()/86400.0));
                int slot=((Number)db.one("SELECT coalesce(max(slot),0) AS n FROM competition_problems WHERE competition_version_id=?",cvId).get("n")).intValue();
                var dayPattern=java.util.regex.Pattern.compile("\\bday\\s*(\\d+)\\b",java.util.regex.Pattern.CASE_INSENSITIVE);
                for(var row:ready) {
                    UUID versionId=(UUID)row.get("id"),problemId=(UUID)row.get("problem_id");
                    if(db.exists("SELECT EXISTS(SELECT 1 FROM competition_problems WHERE competition_version_id=? AND problem_id=?)",cvId,problemId)) continue;
                    Api.require(slot<100,HttpStatus.BAD_REQUEST,"A contest can hold at most 100 problems");
                    slot++;
                    String label=slot<=26?String.valueOf((char)('A'+slot-1)):("P"+slot);
                    int mult=switch(String.valueOf(row.get("difficulty"))) {
                        case "EASY" -> 1;
                        case "HARD" -> 3;
                        default -> 2;
                    };
                    Integer pts=switch(scoring) {
                        case "IOI", "ATCODER" -> 100*mult;
                        case "CODEFORCES" -> 500*mult;
                        default -> null;
                    };
                    int relDay=1;
                    if(isWarmup && row.get("folder") instanceof String fl) {
                        var m=dayPattern.matcher(fl);
                        if(m.find()) relDay=Math.min(maxDays,Math.max(1,Integer.parseInt(m.group(1))));
                    }
                    db.jdbc.update("INSERT INTO competition_problems(competition_version_id,slot,label,problem_id,problem_version_id,points,release_day) VALUES (?,?,?,?,?,?,?)",
                            cvId,slot,label,problemId,versionId,pts,relDay);
                    updated++;
                }
            }
        }
        db.audit(actor.id(),"PROBLEM_ASSIGN","problem",null,surface+" ("+updated+" problems)");
        var out=new LinkedHashMap<String,Object>();
        out.put("updated",updated);out.put("surface",surface);out.put("action",action);
        if(extraSlug!=null) out.put("missionSlug",extraSlug);
        return out;
    }

    /** Problems the actor owns or collaborates on (every problem for a super administrator); deleted=true lists the deleted ones instead. */
    public List<Map<String,Object>> list(Actor actor,boolean deleted) {
        access.setter(actor);
        var rows=db.jdbc.queryForList("SELECT p.id,p.slug,p.contest_flag,p.folder,v.id AS version_id,v.title,v.version_number,v.status,v.difficulty,"
                +"CASE WHEN cardinality(p.tags)>0 THEN p.tags ELSE coalesce((SELECT pp.tags FROM practice_publications pp WHERE pp.problem_id=p.id),'{}'::text[]) END AS tags,"
                +"EXISTS(SELECT 1 FROM practice_publications pp WHERE pp.problem_id=p.id AND NOT pp.hidden AND pp.td_number IS NULL AND NOT EXISTS(SELECT 1 FROM mission_problems mp WHERE mp.problem_id=p.id)) AS in_problem_set,"
                +"(SELECT pp.td_number FROM practice_publications pp WHERE pp.problem_id=p.id AND NOT pp.hidden AND pp.td_number IS NOT NULL) AS td_number,"
                +"(SELECT m.slug FROM mission_problems mp JOIN missions m ON m.id=mp.mission_id JOIN practice_publications pp ON pp.problem_id=p.id WHERE mp.problem_id=p.id AND NOT pp.hidden) AS mission_slug,"
                +"(SELECT m.title FROM mission_problems mp JOIN missions m ON m.id=mp.mission_id JOIN practice_publications pp ON pp.problem_id=p.id WHERE mp.problem_id=p.id AND NOT pp.hidden) AS mission_title,"
                +"EXISTS(SELECT 1 FROM duel_problems dp WHERE dp.problem_id=p.id AND NOT dp.hidden) AS in_duel_pool,"
                +"(SELECT count(DISTINCT c.id) FROM competition_problems cp JOIN competition_versions cv ON cv.id=cp.competition_version_id JOIN competitions c ON c.id=cv.competition_id WHERE cp.problem_id=p.id AND c.status<>'ARCHIVED') AS contest_count,"
                +"(SELECT string_agg(DISTINCT c.title, ', ' ORDER BY c.title) FROM competition_problems cp JOIN competition_versions cv ON cv.id=cp.competition_version_id JOIN competitions c ON c.id=cv.competition_id WHERE cp.problem_id=p.id AND c.status<>'ARCHIVED') AS contest_titles,"
                +"(SELECT r.status FROM problem_validation_results r WHERE r.problem_version_id=v.id ORDER BY r.created_at DESC LIMIT 1) AS validation_status,"
                +"p.archived_at AS deleted_at FROM problems p JOIN problem_versions v ON v.problem_id=p.id WHERE NOT p.system_benchmark AND (? OR p.owner_id=? OR EXISTS(SELECT 1 FROM problem_collaborators c WHERE c.problem_id=p.id AND c.user_id=?)) AND (p.archived_at IS NOT NULL)=? ORDER BY p.created_at DESC,v.version_number DESC LIMIT 500",
                actor.superAdmin(),actor.id(),actor.id(),deleted);
        for(var row:rows) if(row.get("tags") instanceof java.sql.Array array) {
            try{row.put("tags",List.of((String[])array.getArray()));}catch(java.sql.SQLException e){throw new IllegalStateException(e);}
        }
        return rows;
    }
    /** Everything a setter edits: the version, its tests with hidden content, reference solutions, validations and languages. */
    public Map<String,Object> detail(Actor actor,UUID version) {
        access.problemRead(actor,version);var result=new LinkedHashMap<>(db.one("SELECT * FROM problem_versions WHERE id=?",version));
        result.put("tests",db.jdbc.queryForList("SELECT t.* FROM test_cases t JOIN test_case_groups g ON g.id=t.group_id WHERE t.problem_version_id=? ORDER BY g.position,t.position",version));
        result.put("references",db.jdbc.queryForList("SELECT * FROM reference_solutions WHERE problem_version_id=?",version));
        result.put("validations",db.jdbc.queryForList("SELECT id,status,report::text AS report,created_at,completed_at FROM problem_validation_results WHERE problem_version_id=? ORDER BY created_at DESC",version));
        result.put("languages",db.jdbc.queryForList("SELECT language_code FROM problem_version_languages WHERE problem_version_id=?",String.class,version));return result;
    }
}
