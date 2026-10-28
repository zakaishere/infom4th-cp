import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runner import DockerRunner, Execution, InfrastructureError, effective_limit_ms, matches, verdict

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
        # Compile sandbox, then one run sandbox reused (and reset) for both tests.
        self.assertEqual(len(self.removed),2)
        self.assertEqual(len(self.resets),2)
        self.assertEqual(list(self.runner.root.iterdir()),[])
        self.assertNotIn("expected_output",str(result))

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

if __name__=="__main__":
    unittest.main()
