import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runner import DockerRunner, Execution, InfrastructureError, LANGUAGES, effective_limit_ms, matches, verdict

class ComparisonTests(unittest.TestCase):
    def test_exact_comparison_preserves_whitespace(self):
        self.assertFalse(matches(b"42\n", "42", "EXACT"))
        self.assertTrue(matches(b"42\n", "42\n", "EXACT"))

    def test_trimmed_lines_preserves_meaningful_spaces(self):
        self.assertTrue(matches(b"1 2 \r\n3\n", "1 2\n3", "TRIMMED_LINES"))
        self.assertFalse(matches(b"12\n", "1 2", "TRIMMED_LINES"))

    def test_token_comparison_and_invalid_utf8(self):
        self.assertTrue(matches(b"1\t2\n", "1 2", "TOKENS"))
        self.assertFalse(matches(b"\xff", "1", "TOKENS"))

    def test_forged_control_markers_are_ordinary_output(self):
        self.assertFalse(matches(b"===CASE_0===\n===EXIT_0===", "42", "TOKENS"))

    def test_verdicts_use_resource_metadata(self):
        self.assertEqual(verdict(Execution(0,b"",b"",cpu_ms=1001),1000),"TIME_LIMIT_EXCEEDED")
        self.assertEqual(verdict(Execution(137,b"",b"",oom=True),1000),"MEMORY_LIMIT_EXCEEDED")
        self.assertEqual(verdict(Execution(-1,b"",b"",overflow=True),1000),"OUTPUT_LIMIT_EXCEEDED")
        self.assertEqual(verdict(Execution(1,b"",b""),1000),"RUNTIME_ERROR")

    def test_jvm_and_pypy_get_a_startup_time_allowance(self):
        self.assertEqual(effective_limit_ms("CPP", 1000), 1000)
        self.assertEqual(effective_limit_ms("JAVA", 1000), 2500)
        self.assertEqual(effective_limit_ms("PYPY", 2000), 3500)
        self.assertEqual(verdict(Execution(0,b"",b"",cpu_ms=1200),effective_limit_ms("KOTLIN",1000)),"ACCEPTED")

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.runner=object.__new__(DockerRunner)
        self.runner.root=Path(self.temp.name)
        self.runner.images={"CPP":"sha256:test","PYTHON":"sha256:test"}
        self.runner.max_memory_mb=1024
        self.runner.max_job_seconds=600
        self.calls=[]
        self.removed=[]
        self.results=[]
        self.runner._create=lambda *args: "container-"+str(len(self.calls))
        self.runner._remove=lambda name: self.removed.append(name)
        self.resets=[]
        self.runner._reset=lambda name: self.resets.append(name) or True
        self.runner._overhead=lambda name: 0
        def execute(name,command,input_data,*args,**kwargs):
            self.calls.append((command,input_data))
            return self.results.pop(0)
        self.runner._execute=execute
        self.chown=patch("runner.os.chown",create=True)
        self.chown.start()
        self.addCleanup(self.chown.stop)

    def job(self,language="CPP"):
        return {"language_code":language,"source_code":"trusted test fixture","memory_limit_mb":256,
                "time_limit_ms":1000,"output_limit_kb":64,"checker":"TOKENS",
                "tests":[{"id":"one","input_data":"2 3","expected_output":"5"},
                         {"id":"two","input_data":"3 4","expected_output":"7"}]}

    def test_compile_once_then_run_each_input_separately(self):
        self.results=[Execution(0,b"",b""),Execution(0,b"5",b"",10,100),Execution(0,b"7",b"",12,120)]
        result=self.runner.judge(self.job())
        self.assertEqual(result["verdict"],"ACCEPTED")
        self.assertEqual([call[1] for call in self.calls],[b"",b"2 3",b"3 4"])
        # Compile sandbox, then one run sandbox reused for both tests and reset between them only.
        self.assertEqual(len(self.removed),2)
        self.assertEqual(len(self.resets),1)
        self.assertEqual(list(self.runner.root.iterdir()),[])
        self.assertNotIn("expected_output",str(result))

    def test_no_reset_when_the_sandbox_is_about_to_be_deleted(self):
        self.results=[Execution(0,b"",b""),Execution(0,b"wrong",b"",3,100)]
        self.assertEqual(self.runner.judge(self.job())["verdict"],"WRONG_ANSWER")
        self.assertEqual(self.resets,[])

    def test_tests_that_continue_after_a_failure_still_get_a_reset(self):
        self.results=[Execution(0,b"",b""),Execution(0,b"wrong",b"",3,100),Execution(0,b"7",b"",4,100)]
        job=self.job()
        job["run_all_tests"]=True
        self.runner.judge(job)
        self.assertEqual(len(self.resets),1)

    def test_a_failed_reset_replaces_the_sandbox(self):
        self.runner._reset=lambda name: False
        self.results=[Execution(0,b"",b""),Execution(0,b"5",b""),Execution(0,b"7",b"")]
        self.assertEqual(self.runner.judge(self.job())["verdict"],"ACCEPTED")
        self.assertEqual(len(self.removed),3)

    def test_python_interpreter_is_the_executed_command(self):
        self.results=[Execution(0,b"5",b""),Execution(0,b"7",b"")]
        self.assertEqual(self.runner.judge(self.job("PYTHON"))["verdict"],"ACCEPTED")
        self.assertEqual(self.calls[0][0][0],"python")

    def test_compilation_failure_does_not_execute_tests(self):
        self.results=[Execution(1,b"",b"syntax error")]
        result=self.runner.judge(self.job())
        self.assertEqual(result["verdict"],"COMPILATION_ERROR")
        self.assertEqual(result["cases"],[])
        self.assertEqual(len(self.calls),1)

    def test_wrong_answer_stops_without_exposing_expected_output(self):
        self.results=[Execution(0,b"",b""),Execution(0,b"wrong",b"",3,100)]
        result=self.runner.judge(self.job())
        self.assertEqual(result["verdict"],"WRONG_ANSWER")
        self.assertEqual(len(result["cases"]),1)
        self.assertNotIn("wrong",str(result))
        self.assertEqual(list(self.runner.root.iterdir()),[])

    def test_ioi_jobs_run_every_test_and_keep_the_first_failure_verdict(self):
        self.results=[Execution(0,b"",b""),Execution(0,b"wrong",b"",3,100),Execution(0,b"7",b"",4,100)]
        job=self.job()
        job["run_all_tests"]=True
        result=self.runner.judge(job)
        self.assertEqual(result["verdict"],"WRONG_ANSWER")
        self.assertEqual([c["verdict"] for c in result["cases"]],["WRONG_ANSWER","ACCEPTED"])

    def test_exec_overhead_is_subtracted_from_measured_time(self):
        self.runner._overhead=lambda name: 200
        self.results=[Execution(0,b"",b""),Execution(0,b"5",b"",cpu_ms=1150),Execution(0,b"7",b"",cpu_ms=150)]
        result=self.runner.judge(self.job())
        self.assertEqual(result["verdict"],"ACCEPTED")
        self.assertEqual([c["executionTimeMs"] for c in result["cases"]],[950,0])

    def test_killed_sandbox_is_replaced_for_the_next_test(self):
        self.results=[Execution(0,b"",b""),Execution(-1,b"",b"",timeout=True),Execution(0,b"7",b"")]
        job=self.job()
        job["run_all_tests"]=True
        result=self.runner.judge(job)
        self.assertEqual([c["verdict"] for c in result["cases"]],["TIME_LIMIT_EXCEEDED","ACCEPTED"])
        self.assertEqual(len(self.removed),3)

    def test_empty_suite_and_lost_lease_fail_closed(self):
        job=self.job()
        job["tests"]=[]
        with self.assertRaises(InfrastructureError):
            self.runner.judge(job)
        self.results=[Execution(0,b"",b"")]
        lost=threading.Event()
        lost.set()
        with self.assertRaises(InfrastructureError):
            self.runner.judge(self.job(),lost)

class CounterTests(unittest.TestCase):
    STAT="usage_usec 5000\nuser_usec 1\nsystem_usec 1\n"
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder=Path(self.temp.name)/"sandbox"
        self.folder.mkdir()
        (self.folder/"cpu.stat").write_text(self.STAT)
        (self.folder/"memory.peak").write_text("2048\n")
        (self.folder/"memory.events").write_text("low 0\noom 2\noom_kill 1\n")
        self.runner=object.__new__(DockerRunner)
        self.execs=[]
        def control(args,timeout=10):
            self.execs.append(args)
            return self.STAT+"4096\nlow 0\noom 0\noom_kill 0\n"
        self.runner.control=control

    def test_reads_the_files_without_docker_when_the_folder_is_known(self):
        self.runner.cgroups={"box":self.folder}
        self.assertEqual(self.runner._metrics("box"),(5,2,1))
        self.assertEqual(self.execs,[])

    def test_falls_back_to_docker_exec_without_a_folder(self):
        self.runner.cgroups={"box":None}
        self.assertEqual(self.runner._metrics("box"),(5,4,0))
        self.assertEqual(len(self.execs),1)

    def test_falls_back_when_the_files_disappear(self):
        self.runner.cgroups={"box":self.folder}
        (self.folder/"memory.peak").unlink()
        self.assertEqual(self.runner._metrics("box"),(5,4,0))
        self.assertEqual(len(self.execs),1)

    def test_finds_either_cgroup_layout_and_rejects_anything_else(self):
        container="a"*64
        for layout in (Path("system.slice")/f"docker-{container}.scope",Path("docker")/container):
            with tempfile.TemporaryDirectory() as root, patch("runner.CGROUP_ROOT",Path(root)):
                folder=Path(root)/layout
                self.assertIsNone(DockerRunner._find_cgroup(container))
                folder.mkdir(parents=True)
                (folder/"cpu.stat").write_text(self.STAT)
                self.assertEqual(DockerRunner._find_cgroup(container),folder)
                self.assertIsNone(DockerRunner._find_cgroup("../"+container))
                self.assertIsNone(DockerRunner._find_cgroup(""))

class CompilerFlagTests(unittest.TestCase):
    def test_only_the_compilers_get_the_fast_start_flag(self):
        for language in ("JAVA","KOTLIN"):
            _,compile_command,run_command=LANGUAGES[language]
            self.assertIn("-J-XX:TieredStopAtLevel=1",compile_command)
            self.assertFalse([part for part in run_command if "TieredStopAtLevel" in part])

if __name__=="__main__":
    unittest.main()
