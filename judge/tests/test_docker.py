"""Opt-in tests against real Linux Docker; never substitute these with fake verdicts."""
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from runner import DockerRunner,IMAGE_NAMES,LANGUAGES

@unittest.skipUnless(os.getenv("CP_DOCKER_TESTS")=="1","Requires opt-in Linux Docker/cgroup-v2 judge host")
class DockerSandboxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runner=DockerRunner(os.getenv("JUDGE_WORK_ROOT","/judge/work"),os.environ["JUDGE_HOST_WORK_ROOT"],{},1024)
        for language in LANGUAGES:
            if language in os.getenv("JUDGE_LANGUAGES",",".join(LANGUAGES)).split(","):
                cls.runner.verify_runtime(language,os.getenv("JUDGE_IMAGE_"+language,"cp-judge-"+IMAGE_NAMES.get(language,language.lower())+":local"))
    def job(self,source,output="ok",memory=256,limit=500,output_kb=16):
        return {"language_code":"PYTHON","source_code":source,"time_limit_ms":limit,"memory_limit_mb":memory,
                "output_limit_kb":output_kb,"checker":"TOKENS",
                "tests":[{"id":"probe","input_data":"","expected_output":output}]}
    def test_infinite_loop_is_terminated(self):
        self.assertEqual(self.runner.judge(self.job("while True: pass"))["verdict"],"TIME_LIMIT_EXCEEDED")
    def test_output_flood_is_terminated(self):
        self.assertEqual(self.runner.judge(self.job("while True: print('x'*1024)",output_kb=1))["verdict"],"OUTPUT_LIMIT_EXCEEDED")
    def test_actual_cgroup_oom_is_memory_limit(self):
        self.assertEqual(self.runner.judge(self.job("x=bytearray(1024*1024*1024);print(len(x))",memory=64,limit=5000))["verdict"],"MEMORY_LIMIT_EXCEEDED")
    def test_nonroot_readonly_root_and_no_network_route(self):
        source="import os\nassert os.geteuid()==10001\ntry:\n open('/forbidden-write','w')\n raise AssertionError('writable root')\nexcept OSError: pass\nassert len(open('/proc/net/route').read().strip().splitlines())==1\nprint('ok')"
        self.assertEqual(self.runner.judge(self.job(source))["verdict"],"ACCEPTED")
    def test_markers_cannot_forge_acceptance(self):
        self.assertEqual(self.runner.judge(self.job("print('===CASE_0===');print('===EXIT_0===')",output="42"))["verdict"],"WRONG_ANSWER")
    def test_reused_sandbox_leaks_nothing_between_tests(self):
        # Test 1 leaves a file in /tmp and a detached background process; test 2 must see neither.
        source=("import os,time\n"
                "def others():\n"
                "    for p in os.listdir('/proc'):\n"
                "        if p.isdigit() and int(p)!=os.getpid():\n"
                "            try:\n"
                "                if '\\nUid:\\t10001' in open('/proc/'+p+'/status').read(): return True\n"
                "            except OSError: pass\n"
                "    return False\n"
                "if os.path.exists('/tmp/flag') or others(): print('leak')\n"
                "else:\n"
                "    open('/tmp/flag','w').write('x')\n"
                "    if os.fork()==0:\n"
                "        os.close(1); os.close(2); time.sleep(60); os._exit(0)\n"
                "    print('ok')\n")
        job=self.job(source)
        job["tests"]=[{"id":"first","input_data":"","expected_output":"ok"},{"id":"second","input_data":"","expected_output":"ok"}]
        job["run_all_tests"]=True
        result=self.runner.judge(job)
        self.assertEqual([c["verdict"] for c in result["cases"]],["ACCEPTED","ACCEPTED"])
    def test_counters_read_directly_agree_with_inside_the_sandbox(self):
        folder=Path(tempfile.mkdtemp(prefix="job-",dir=self.runner.root))
        name=self.runner._create(folder,self.runner.images["PYTHON"],64,False)
        try:
            direct=self.runner.cgroups.get(name)
            self.assertIsNotNone(direct,"the host cgroup tree should be mounted in compose.yml")
            result=self.runner._execute(name,["python","-c","print(sum(range(3000000)))"],b"",20,1024)
            self.assertGreater(result.cpu_ms,0,"a real program must show CPU use")
            self.assertGreater(result.memory_kb,0)
            cpu,peak,oom=self.runner._metrics(name)
            self.runner.cgroups[name]=None
            inside_cpu,inside_peak,inside_oom=self.runner._metrics(name)
            # The second read is a docker exec, which itself adds a little CPU and memory.
            self.assertLessEqual(cpu,inside_cpu)
            self.assertLess(inside_cpu-cpu,1000)
            self.assertLessEqual(peak,inside_peak)
            self.assertEqual(oom,inside_oom)
        finally:
            self.runner._remove(name)
            shutil.rmtree(folder,ignore_errors=True)
    def test_programs_keep_the_strict_open_file_limit(self):
        source="fs=[]\ntry:\n    for i in range(200): fs.append(open('/dev/null'))\n    print('opened all')\nexcept OSError:\n    print('limited')\n"
        self.assertEqual(self.runner.judge(self.job(source,output="limited"))["verdict"],"ACCEPTED")
