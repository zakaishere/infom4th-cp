"""Linux-only Docker sandbox. Contestant output is data, never a control protocol."""
from __future__ import annotations
import json
import math
import os
import selectors
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

LANGUAGES = {
    "CPP": ("main.cpp", ["g++", "-O2", "-std=c++17", "/work/main.cpp", "-o", "/work/program"], ["/work/program"]),
    "CPP20": ("main.cpp", ["g++", "-O2", "-std=c++20", "/work/main.cpp", "-o", "/work/program"], ["/work/program"]),
    "C": ("main.c", ["gcc", "-O2", "-std=c17", "/work/main.c", "-o", "/work/program"], ["/work/program"]),
    "JAVA": ("Main.java", ["javac", "-J-Xmx512m", "/work/Main.java"],
             ["java", "-XX:+UseSerialGC", "-XX:ActiveProcessorCount=1", "-XX:MaxRAMPercentage=60", "-XX:ReservedCodeCacheSize=32m", "-Xss512k", "-cp", "/work", "Main"]),
    "PYTHON": ("main.py", None, ["python", "-I", "-B", "/work/main.py"]),
    "PYPY": ("main.py", None, ["pypy3", "-I", "-B", "/work/main.py"]),
    "JAVASCRIPT": ("main.js", None, ["node", "--max-old-space-size=512", "/work/main.js"]),
    # The image pre-builds the standard library cache; each compile copies it into the job folder.
    "GO": ("main.go", ["sh", "-c", "cp -r /opt/gocache /work/.gocache && GOCACHE=/work/.gocache GOPATH=/tmp/go go build -p 1 -o /work/program /work/main.go"], ["/work/program"]),
    "RUST": ("main.rs", ["rustc", "-O", "--edition", "2021", "-o", "/work/program", "/work/main.rs"], ["/work/program"]),
    "KOTLIN": ("Main.kt", ["kotlinc", "/work/Main.kt", "-include-runtime", "-d", "/work/main.jar"],
               ["java", "-XX:+UseSerialGC", "-XX:ActiveProcessorCount=1", "-XX:MaxRAMPercentage=60", "-Xss64m", "-jar", "/work/main.jar"]),
    "CSHARP": ("Main.cs", ["mcs", "-optimize+", "-out:/work/main.exe", "/work/Main.cs"], ["mono", "/work/main.exe"]),
    "RUBY": ("main.rb", None, ["ruby", "/work/main.rb"]),
    "PHP": ("main.php", None, ["php", "-d", "memory_limit=-1", "/work/main.php"]),
}
# Languages that share another language's runtime image (default image cp-judge-<name>:local).
IMAGE_NAMES = {"CPP20": "cpp"}
# Extra CPU time for runtimes with heavy startup (JVM, JIT warm-up): limit * factor + extra ms.
# cgroup CPU time counts every thread, so a JVM spends ~0.5-1 s before main() on a small VPS.
TIME_ALLOWANCE = {"JAVA": (1.5, 1000), "KOTLIN": (1.5, 1000), "PYPY": (1.5, 500)}

def effective_limit_ms(language: str, limit_ms: int) -> int:
    factor, extra = TIME_ALLOWANCE.get(language, (1.0, 0))
    return int(limit_ms * factor + extra)

# Wall-clock compile budget; Kotlin and Go need ~20 s on a small, busy VPS.
COMPILE_SECONDS = int(os.getenv("JUDGE_COMPILE_SECONDS", "60"))
VERDICTS = {"ACCEPTED", "WRONG_ANSWER", "TIME_LIMIT_EXCEEDED", "MEMORY_LIMIT_EXCEEDED",
            "RUNTIME_ERROR", "COMPILATION_ERROR", "OUTPUT_LIMIT_EXCEEDED", "JUDGE_ERROR"}

class InfrastructureError(RuntimeError):
    pass

@dataclass
class Execution:
    exit_code: int
    output: bytes
    errors: bytes
    cpu_ms: int = 0
    memory_kb: int = 0
    timeout: bool = False
    overflow: bool = False
    oom: bool = False

def matches(actual: bytes, expected: str, checker: str) -> bool:
    try:
        decoded = actual.decode("utf-8")
    except UnicodeDecodeError:
        return False
    if checker == "EXACT":
        return decoded == expected
    if checker == "TOKENS":
        return decoded.split() == expected.split()
    if checker == "TRIMMED_LINES":
        def normalize(value):
            return "\n".join(line.rstrip() for line in value.replace("\r\n", "\n").split("\n")).strip("\n")
        return normalize(decoded) == normalize(expected)
    raise InfrastructureError("Unsupported output checker")

def verdict(execution: Execution, limit_ms: int) -> str:
    if execution.overflow:
        return "OUTPUT_LIMIT_EXCEEDED"
    if execution.oom:
        return "MEMORY_LIMIT_EXCEEDED"
    if execution.timeout or execution.cpu_ms > limit_ms:
        return "TIME_LIMIT_EXCEEDED"
    if execution.exit_code:
        return "RUNTIME_ERROR"
    return "ACCEPTED"

class DockerRunner:
    def __init__(self, work_root: str, host_work_root: str, images: dict[str, str],
                 max_memory_mb: int = 1024, max_job_seconds: int = 600):
        self.root = Path(work_root).resolve()
        self.host_root = Path(host_work_root)
        self.images = images
        self.max_memory_mb = max_memory_mb
        self.max_job_seconds = max_job_seconds
        self.active: set[str] = set()
        self.lock = threading.Lock()
        # Identifies this installation's worker on a shared Docker host. Leftover cleanup only
        # ever touches sandboxes carrying exactly this owner label (see remove_leftovers).
        self.owner = ""
        self.root.mkdir(parents=True, exist_ok=True)
        if os.name != "posix":
            raise InfrastructureError("Judge execution requires Linux")
        info = self.control(["info", "--format", "{{json .}}"], 15)
        try:
            info = json.loads(info)
            if info.get("OSType") != "linux" or str(info.get("CgroupVersion")) != "2":
                raise InfrastructureError("A Linux Docker engine with cgroup v2 is required")
        except (ValueError, AttributeError) as error:
            raise InfrastructureError("Cannot verify Docker isolation") from error

    def control(self, args: list[str], timeout: float = 10) -> str:
        try:
            result = subprocess.run(["docker", *args], capture_output=True, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise InfrastructureError("Docker control operation failed") from error
        if result.returncode:
            raise InfrastructureError("Docker control operation rejected")
        if len(result.stdout) > 2 * 1024 * 1024:
            raise InfrastructureError("Oversized Docker control response")
        return result.stdout.decode("utf-8", errors="replace").strip()

    def _create(self, folder: Path, image: str, memory_mb: int, writable: bool) -> str:
        name = "cp-judge-" + uuid.uuid4().hex
        host_folder = self.host_root / folder.name
        try:
            self.control(["run", "-d", "--init", "--name", name, "--label", "cp.judge.sandbox=true",
                      "--label", f"cp.judge.owner={self.owner}",
                      "--network", "none", "--cgroupns", "private", "--read-only", "--cap-drop", "ALL",
                      "--security-opt", "no-new-privileges:true", "--pids-limit", "128",
                      "--memory", f"{memory_mb}m", "--memory-swap", f"{memory_mb}m",
                      "--cpus", "1", "--ulimit", "core=0",
                      # Compilers (no contestant code runs) open many files; programs get 64.
                      "--ulimit", "nofile=1024:1024" if writable else "nofile=64:64",
                      "--ipc", "none", "--shm-size", "16m",
                      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777",
                      "--mount", f"type=bind,src={host_folder},dst=/work" + ("" if writable else ",readonly"),
                      "--workdir", "/work", "--user", "0:0", "--env", "HOME=/tmp",
                      "--entrypoint", "/bin/sleep", image, "infinity"], 20)
        except Exception:
            try:
                self.control(["rm", "--force", name], 10)
            except InfrastructureError:
                pass
            raise
        # PID 1 is Docker's init (it reaps zombies) running a trusted root sleep with no
        # capabilities. Every compiler/program runs as UID 10001 and cannot kill the keeper
        # or change read-only cgroups.
        with self.lock:
            self.active.add(name)
        return name

    def _remove(self, name: str):
        try:
            self.control(["rm", "--force", name], 10)
        finally:
            with self.lock:
                self.active.discard(name)

    def remove_leftovers(self) -> int:
        """Removes sandboxes this same worker left behind when it crashed or was killed.
        Only containers labelled cp.judge.sandbox=true AND this worker's exact owner label
        are matched; other containers on the host are never listed, stopped or removed."""
        if not self.owner:
            return 0
        names = self.control(["ps", "-a", "--filter", "label=cp.judge.sandbox=true",
                              "--filter", f"label=cp.judge.owner={self.owner}", "--format", "{{.Names}}"], 30).split()
        for name in names:
            if name.startswith("cp-judge-"):
                self.control(["rm", "--force", name], 20)
        return len(names)

    def cancel(self):
        with self.lock:
            names = list(self.active)
        for name in names:
            try:
                self.control(["kill", name], 5)
            except InfrastructureError:
                pass

    def _metrics(self, name: str) -> tuple[int, int, int]:
        # Collected by the trusted worker, outside contestant stdout/stderr, in one exec
        # (each docker exec round trip costs ~0.1-0.3 s).
        raw = self.control(["exec", "--user", "0:0", name, "cat", "/sys/fs/cgroup/cpu.stat",
                            "/sys/fs/cgroup/memory.peak", "/sys/fs/cgroup/memory.events"])
        def values(lines):
            return {line.split()[0]: int(line.split()[1]) for line in lines if len(line.split()) == 2}
        try:
            lines = raw.splitlines()
            peak = next(int(line) for line in lines if line.strip().isdigit())
            counters = values(lines)
            return counters["usage_usec"] // 1000, math.ceil(peak / 1024), counters["oom_kill"]
        except (ValueError, KeyError, IndexError) as error:
            raise InfrastructureError("Cgroup resource accounting unavailable") from error

    def _execute(self, name: str, command: list[str], input_data: bytes, wall_seconds: float,
                 output_limit: int, file_limit: int = 16 * 1024 * 1024,
                 cancelled: threading.Event | None = None) -> Execution:
        baseline_cpu, _, baseline_oom = self._metrics(name)
        process = subprocess.Popen(
            ["docker", "exec", "-i", "--user", "10001:10001", name,
             "prlimit", f"--fsize={file_limit}", "--", *command],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        selector = selectors.DefaultSelector()
        buffers = {"stdout": bytearray(), "stderr": bytearray()}
        selector.register(process.stdout, selectors.EVENT_READ, "stdout")
        selector.register(process.stderr, selectors.EVENT_READ, "stderr")
        position = 0
        if input_data:
            os.set_blocking(process.stdin.fileno(), False)
            selector.register(process.stdin, selectors.EVENT_WRITE, "stdin")
        else:
            process.stdin.close()
        deadline = time.monotonic() + wall_seconds
        timed_out = overflow = False
        try:
            while selector.get_map():
                if cancelled is not None and cancelled.is_set():
                    raise InfrastructureError("Lease lost during execution")
                if time.monotonic() >= deadline:
                    timed_out = True
                    break
                for key, _ in selector.select(timeout=min(0.05, max(0, deadline-time.monotonic()))):
                    if key.data == "stdin":
                        try:
                            written = os.write(key.fileobj.fileno(), input_data[position:position+65536])
                            position += written
                            if position >= len(input_data):
                                selector.unregister(key.fileobj)
                                key.fileobj.close()
                        except (BrokenPipeError, OSError):
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                        continue
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        key.fileobj.close()
                    else:
                        remaining = max(0, output_limit-sum(len(b) for b in buffers.values()))
                        buffers[key.data].extend(chunk[:remaining])
                        if len(chunk) > remaining:
                            overflow = True
                            break
                if overflow:
                    break
            if timed_out or overflow:
                # Stop the local exec client first: while it is blocked on a full output pipe,
                # the Docker daemon cannot complete the kill below.
                process.kill()
                process.wait(timeout=5)
                cpu, peak, oom = self._metrics(name)
                # Kill the entire cgroup/container, including forked descendants.
                self.control(["kill", name], 20)
                return Execution(process.returncode or -1, bytes(buffers["stdout"]), bytes(buffers["stderr"]),
                                 cpu_ms=max(0, cpu-baseline_cpu), memory_kb=peak,
                                 timeout=timed_out, overflow=overflow, oom=oom>baseline_oom)
            code = process.wait(timeout=max(0.1, deadline-time.monotonic()))
            try:
                cpu, peak, oom = self._metrics(name)
            except InfrastructureError:
                state = json.loads(self.control(["inspect", name, "--format", "{{json .State}}"]))
                if state.get("OOMKilled"):
                    return Execution(code, bytes(buffers["stdout"]), bytes(buffers["stderr"]), oom=True)
                raise
            return Execution(code, bytes(buffers["stdout"]), bytes(buffers["stderr"]),
                             max(0, cpu-baseline_cpu), peak, oom=oom > baseline_oom)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
            self.control(["kill", name], 20)
            return Execution(-1, b"", b"", timeout=True)
        finally:
            selector.close()
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream and not stream.closed:
                    stream.close()

    def judge(self, job: dict, cancelled: threading.Event | None = None) -> dict:
        language = job["language_code"]
        if language not in self.images or language not in LANGUAGES:
            raise InfrastructureError("Runtime not verified")
        tests = job.get("tests", [])
        if not tests:
            raise InfrastructureError("Empty test suite")
        memory = int(job["memory_limit_mb"])
        if memory > self.max_memory_mb or memory < 16:
            raise InfrastructureError("Job exceeds worker memory budget")
        filename, compile_command, run_command = LANGUAGES[language]
        started = time.monotonic()
        folder = Path(tempfile.mkdtemp(prefix="job-", dir=self.root))
        os.chmod(folder, 0o700)
        os.chown(folder, 10001, 10001)
        source = folder / filename
        source.write_text(job["source_code"], encoding="utf-8")
        os.chown(source, 10001, 10001)
        cases = []
        compile_seconds = tests_seconds = 0.0

        def timings():
            return {"compileMs": int(compile_seconds*1000), "testsMs": int(tests_seconds*1000),
                    "totalMs": int((time.monotonic()-started)*1000)}
        try:
            if compile_command:
                name = self._create(folder, self.images[language], self.max_memory_mb, True)
                try:
                    phase = time.monotonic()
                    compiled = self._execute(name, compile_command, b"", COMPILE_SECONDS, 65536, 64*1024*1024, cancelled)
                    compile_seconds = time.monotonic()-phase
                finally:
                    self._remove(name)
                if compiled.timeout or compiled.overflow or compiled.oom or compiled.exit_code:
                    return {"verdict": "COMPILATION_ERROR", "cases": [], "executionTimeMs": compiled.cpu_ms,
                            "peakMemoryKb": compiled.memory_kb, "timings": timings(),
                            "compilerOutput": (compiled.errors + compiled.output).decode("utf-8", errors="replace")[:16000]}
            # One read-only sandbox runs every test; it is reset between tests and replaced
            # whenever it was killed (timeout, output overflow, out of memory).
            name = None
            overhead = 0
            try:
                for test in tests:
                    if cancelled is not None and cancelled.is_set():
                        raise InfrastructureError("Lease lost")
                    if time.monotonic()-started > self.max_job_seconds:
                        raise InfrastructureError("Whole-job budget exhausted")
                    if name is None:
                        name = self._create(folder, self.images[language], memory, False)
                        overhead = self._overhead(name)
                    phase = time.monotonic()
                    result = self._execute(name, run_command, test["input_data"].encode("utf-8"),
                                           2*effective_limit_ms(language, int(job["time_limit_ms"]))/1000 + 1,
                                           int(job["output_limit_kb"])*1024, cancelled=cancelled)
                    tests_seconds += time.monotonic()-phase
                    result.cpu_ms = max(0, result.cpu_ms - overhead)
                    if result.timeout or result.overflow or result.oom or not self._reset(name):
                        self._remove(name)
                        name = None
                    if self._record(cases, test, result, job) and not job.get("run_all_tests"):
                        break
            finally:
                if name is not None:
                    self._remove(name)
            failures = [case["verdict"] for case in cases if case["verdict"] != "ACCEPTED"]
            peak = max((case["peakMemoryKb"] for case in cases), default=0)
            cpu = max((case["executionTimeMs"] for case in cases), default=0)
            # The first failing test decides the verdict.
            return {"verdict": failures[0] if failures else "ACCEPTED", "cases": cases,
                    "executionTimeMs": cpu, "peakMemoryKb": peak, "timings": timings()}
        finally:
            shutil.rmtree(folder)

    def _overhead(self, name: str) -> int:
        """CPU that `docker exec` itself charges to the sandbox cgroup (runc init), measured
        with an empty program and subtracted from each test so time limits stay fair."""
        try:
            return self._execute(name, ["true"], b"", 10, 1024).cpu_ms
        except InfrastructureError:
            return 0

    def _reset(self, name: str) -> bool:
        """Kills leftover contestant processes and empties /tmp so tests stay independent."""
        try:
            self.control(["exec", "--user", "10001:10001", name, "sh", "-c",
                          "kill -9 -1 2>/dev/null; rm -rf /tmp/* /tmp/.[!.]* 2>/dev/null; true"], 10)
            return True
        except InfrastructureError:
            return False

    @staticmethod
    def _record(cases: list, test: dict, result: Execution, job: dict) -> bool:
        """Appends one test result; returns True when the test failed."""
        status = verdict(result, effective_limit_ms(job["language_code"], int(job["time_limit_ms"])))
        if status == "ACCEPTED" and not matches(result.output, test["expected_output"], job["checker"]):
            status = "WRONG_ANSWER"
        cases.append({"id": test["id"], "verdict": status,
                      "executionTimeMs": result.cpu_ms, "peakMemoryKb": result.memory_kb})
        return status != "ACCEPTED"

    def image_exists(self, image: str) -> bool:
        try:
            self.control(["image", "inspect", image, "--format", "{{.Id}}"], 15)
            return True
        except InfrastructureError:
            return False

    def ensure_image(self, image: str, dockerfiles: Path) -> bool:
        """Builds a missing standard runtime image (cp-judge-<name>:local) from
        judge/images/<name>.Dockerfile. Returns True when it had to build. Workers sharing
        a host take a file lock in the shared work folder, so each image is built once."""
        if self.image_exists(image):
            return False
        name = image.removeprefix("cp-judge-").removesuffix(":local")
        dockerfile = dockerfiles / (name + ".Dockerfile")
        if not image.startswith("cp-judge-") or not image.endswith(":local") or not dockerfile.is_file():
            raise InfrastructureError(f"Image {image} is missing and has no Dockerfile to build it from")
        import fcntl
        with open(self.root / ".image-build.lock", "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if self.image_exists(image):
                return False
            try:
                result = subprocess.run(["docker", "build", "-f", str(dockerfile), "-t", image, str(dockerfiles)],
                                        capture_output=True, timeout=3600, check=False)
            except (OSError, subprocess.TimeoutExpired) as error:
                raise InfrastructureError(f"Building {image} failed") from error
            if result.returncode:
                tail = result.stderr.decode("utf-8", errors="replace").strip().splitlines()[-3:]
                raise InfrastructureError(f"Building {image} failed: " + " | ".join(tail))
        return True

    def verify_runtime(self, language: str, image: str) -> dict:
        image_id = self.control(["image", "inspect", image, "--format", "{{.Id}}"])
        if not image_id.startswith("sha256:"):
            raise InfrastructureError("An immutable local image ID is required")
        self.images[language] = image_id
        sources = {
            "CPP": "#include <iostream>\nint main(){long a,b;std::cin>>a>>b;std::cout<<a+b<<\"\\n\";}",
            "CPP20": "#include <iostream>\nint main(){long a,b;std::cin>>a>>b;auto s=a+b;std::cout<<s<<\"\\n\";}",
            "C": "#include <stdio.h>\nint main(){long a,b;scanf(\"%ld%ld\",&a,&b);printf(\"%ld\\n\",a+b);}",
            "JAVA": "import java.util.*; public class Main {public static void main(String[] a){Scanner s=new Scanner(System.in);System.out.println(s.nextLong()+s.nextLong());}}",
            "PYTHON": "a,b=map(int,input().split());print(a+b)",
            "PYPY": "a,b=map(int,input().split());print(a+b)",
            "JAVASCRIPT": "const [a,b]=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(a+b);",
            "GO": "package main\nimport \"fmt\"\nfunc main(){var a,b int64;fmt.Scan(&a,&b);fmt.Println(a+b)}",
            "RUST": "use std::io::*;fn main(){let mut s=String::new();stdin().read_to_string(&mut s).unwrap();let v:Vec<i64>=s.split_whitespace().map(|x|x.parse().unwrap()).collect();println!(\"{}\",v[0]+v[1]);}",
            "KOTLIN": "fun main(){val(a,b)=readLine()!!.trim().split(\" \").map{it.toLong()};println(a+b)}",
            "CSHARP": "using System;class P{static void Main(){var p=Console.ReadLine().Split(' ');Console.WriteLine(long.Parse(p[0])+long.Parse(p[1]));}}",
            "RUBY": "a,b=STDIN.read.split.map(&:to_i);puts a+b",
            "PHP": "<?php [$a,$b]=array_map('intval',preg_split('/\\s+/',trim(stream_get_contents(STDIN))));echo $a+$b,\"\\n\";",
        }
        # One compilation, every test run: two correct answers, then one deliberately wrong
        # expected output that must be rejected.
        job = {"language_code": language, "source_code": sources[language], "memory_limit_mb": 256,
               "time_limit_ms": 2000, "output_limit_kb": 64, "checker": "TOKENS", "run_all_tests": True,
               "tests": [{"id": str(uuid.uuid4()), "input_data": "2 3\n", "expected_output": "5\n"},
                         {"id": str(uuid.uuid4()), "input_data": "-3 10\n", "expected_output": "7\n"},
                         {"id": str(uuid.uuid4()), "input_data": "2 3\n", "expected_output": "99\n"}]}
        self.last_result = self.judge(job)
        verdicts = [case["verdict"] for case in self.last_result["cases"]]
        if verdicts != ["ACCEPTED", "ACCEPTED", "WRONG_ANSWER"] or self.last_result["verdict"] != "WRONG_ANSWER":
            raise InfrastructureError(f"{language}: self-test failed ({self.last_result['verdict']}, tests {verdicts})")
        return {"verified": True, "imageId": image_id, "accounting": "cgroup-v2"}
