import json
import sys
import threading
import time
import unittest
from collections import deque
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker import (Capacity, CapacityBusy, Control, Requeue, SlotConsumer, SlotPool, WorkerUnavailable,
                    detect_hardware, execute, sandbox_owner, settings_from_environment, verify_languages)
from runner import InfrastructureError


def eventually(predicate, timeout=5):
    deadline = time.monotonic()+timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


class CapacityTests(unittest.TestCase):
    def test_target_is_clamped_to_the_trusted_ceiling(self):
        capacity = Capacity(4, 2)
        capacity.update(16)
        self.assertEqual(capacity.limit(), 4)
        with self.assertRaises(ValueError):
            Capacity(257, 1)

    def test_lowering_lets_active_work_finish_and_blocks_new_starts(self):
        capacity = Capacity(4, 3)
        self.assertTrue(all(capacity.try_acquire(slot) for slot in range(3)))
        capacity.update(1)
        self.assertTrue(capacity.snapshot()["overTarget"])
        self.assertFalse(capacity.try_acquire(0))
        capacity.release()
        self.assertFalse(capacity.try_acquire(0))
        capacity.release()
        self.assertFalse(capacity.try_acquire(0))
        capacity.release()
        self.assertTrue(capacity.try_acquire(0))
        self.assertFalse(capacity.eligible(1))

    def test_increasing_enables_more_slots_within_ceiling(self):
        capacity = Capacity(3, 1)
        self.assertTrue(capacity.try_acquire(0))
        self.assertFalse(capacity.try_acquire(1))
        capacity.update(3)
        self.assertTrue(capacity.try_acquire(1))
        self.assertTrue(capacity.try_acquire(2))
        self.assertFalse(capacity.try_acquire(3))

    def test_drain_and_stale_control_stop_new_work(self):
        capacity = Capacity(2, 2)
        capacity.update(2, draining=True)
        self.assertFalse(capacity.try_acquire(0))
        capacity.update(2)
        capacity.mark_stale()
        self.assertFalse(capacity.eligible(0))
        capacity.update(2)
        self.assertTrue(capacity.try_acquire(0))


class FakeApi:
    def __init__(self, responses):
        self.responses = deque(responses)
        self.calls = []

    def post(self, path, body):
        self.calls.append((path, body))
        response = self.responses.popleft()
        if isinstance(response, BaseException):
            raise response
        return response(path, body) if callable(response) else response


class ControlTests(unittest.TestCase):
    def registration(self):
        return {"name": "official-1", "capacity": 4, "defaultConcurrency": 2, "runtimes": {}}

    def test_registration_and_heartbeat_apply_administrator_settings(self):
        capacity = Capacity(4, 2)
        api = FakeApi([{"workerId": "w1", "desiredConcurrency": 3, "draining": False},
                       {"desiredConcurrency": 1, "draining": True, "ok": True}])
        control = Control(api, capacity, self.registration())
        control.register()
        self.assertEqual(capacity.limit(), 3)
        control.tick()
        self.assertEqual(capacity.limit(), 0)
        self.assertEqual(api.calls[1][0], "/workers/w1/heartbeat")
        self.assertEqual(api.calls[1][1]["maxSlots"], 4)

    def test_offline_worker_reregisters_without_sending_desired_capacity(self):
        capacity = Capacity(4, 2)
        api = FakeApi([{"workerId": "w1", "desiredConcurrency": 2},
                       WorkerUnavailable("offline"),
                       {"workerId": "w1", "desiredConcurrency": 3, "draining": True}])
        control = Control(api, capacity, self.registration())
        control.register()
        control.tick()
        self.assertEqual(api.calls[2][0], "/workers")
        self.assertNotIn("desiredConcurrency", api.calls[2][1])
        self.assertTrue(capacity.draining)

    def test_api_failure_keeps_last_limit_then_fails_closed_when_stale(self):
        now = [0.0]
        capacity = Capacity(4, 2)
        api = FakeApi([{"workerId": "w1", "desiredConcurrency": 4}, OSError("down"), OSError("down"),
                       {"desiredConcurrency": 2}])
        control = Control(api, capacity, self.registration(), stale_after=60, clock=lambda: now[0])
        control.register()
        now[0] = 30
        control.tick()
        self.assertEqual(capacity.limit(), 4)
        now[0] = 61
        control.tick()
        self.assertEqual(capacity.limit(), 0)
        control.tick()
        self.assertEqual(capacity.limit(), 2)


class LiveScalingTests(unittest.TestCase):
    def test_admin_increase_starts_new_slot_threads_without_restart(self):
        started, release = [], threading.Event()

        def factory(slot):
            def run():
                started.append(slot)
                release.wait(5)
            return run
        pool = SlotPool(factory)
        capacity = Capacity(256, 2)
        api = FakeApi([{"workerId": "w1", "desiredConcurrency": 2}, {"desiredConcurrency": 40}])
        control = Control(api, capacity, {"name": "w"}, on_change=lambda: pool.ensure(capacity.target))
        control.register()
        self.assertTrue(eventually(lambda: sorted(started) == [0, 1]))
        control.tick()
        self.assertTrue(eventually(lambda: len(started) == 40))
        self.assertEqual(capacity.limit(), 40)
        release.set()
        pool.join()

    def test_hardware_is_reported(self):
        self.assertGreaterEqual(detect_hardware()["detectedCpus"], 1)


class Runner:
    def __init__(self, delay=0):
        self.delay = delay
        self.lock = threading.Lock()
        self.running = 0
        self.peak = 0

    def judge(self, claimed, lost=None):
        with self.lock:
            self.running += 1
            self.peak = max(self.peak, self.running)
        time.sleep(self.delay)
        with self.lock:
            self.running -= 1
        return {"verdict": "ACCEPTED", "cases": []}


def claimed(path, body):
    if path.endswith("/claim"):
        return {"leaseToken": "lease", "jobId": path.split("/")[2]}
    return {"ok": True}


class ExecuteTests(unittest.TestCase):
    message = {"jobId": "j1", "dispatchSequence": 0}

    def test_stale_dispatch_is_acknowledged_and_releases_capacity(self):
        capacity = Capacity(1, 1)
        execute(self.message, 0, capacity, FakeApi([None]), lambda: "w", Runner(), threading.Event())
        self.assertEqual(capacity.active, 0)

    def test_capacity_refusal_keeps_the_delivery_and_retries(self):
        capacity = Capacity(1, 1)
        api = FakeApi([CapacityBusy("LANE_LIMIT"), CapacityBusy("LANE_LIMIT"), claimed, claimed])
        execute(self.message, 0, capacity, api, lambda: "w", Runner(), threading.Event(), backoff=lambda: 0)
        self.assertEqual([path for path, _ in api.calls], ["/jobs/j1/claim"]*3+["/jobs/j1/complete"])
        self.assertEqual(capacity.active, 0)

    def test_unavailable_worker_or_ineligible_slot_requeues(self):
        capacity = Capacity(2, 2)
        with self.assertRaises(Requeue):
            execute(self.message, 0, capacity, FakeApi([WorkerUnavailable("drained")]), lambda: "w", Runner(), threading.Event())
        capacity.update(1)
        with self.assertRaises(Requeue):
            execute(self.message, 1, capacity, FakeApi([]), lambda: "w", Runner(), threading.Event())
        self.assertEqual(capacity.active, 0)

    def test_concurrent_slots_never_exceed_the_live_target(self):
        capacity = Capacity(4, 2)
        runner = Runner(delay=0.05)
        api = FakeApi([claimed]*40)
        threads = [threading.Thread(target=execute, args=({"jobId": "j%d" % i, "dispatchSequence": 0}, i % 2,
                                                            capacity, api, lambda: "w", runner, threading.Event()))
                   for i in range(10)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(runner.peak, 2)


class FakeChannel:
    def __init__(self, connection):
        self.connection = connection
        self.is_open = True
        self.consumers = {}
        self.acks, self.nacks, self.cancels = [], [], 0

    def basic_qos(self, prefetch_count):
        self.prefetch = prefetch_count

    def basic_consume(self, queue, callback, auto_ack):
        tag = "consumer-%d" % (len(self.consumers)+self.cancels)
        self.consumers[tag] = callback
        return tag

    def basic_cancel(self, tag):
        del self.consumers[tag]
        self.cancels += 1

    def basic_ack(self, tag):
        self.acks.append(tag)

    def basic_nack(self, tag, requeue):
        self.nacks.append((tag, requeue))


class FakeConnection:
    """Delivers every queued message as soon as a consumer exists, like multi-queue prefetch."""
    def __init__(self, messages):
        self.channel_object = FakeChannel(self)
        self.messages = deque(messages)
        self.is_open = True
        self.delivered = 0

    def channel(self):
        return self.channel_object

    def process_data_events(self, time_limit):
        if self.channel_object.consumers and self.messages:
            callback = next(iter(self.channel_object.consumers.values()))
            while self.messages:
                self.delivered += 1
                callback(self.channel_object, SimpleNamespace(delivery_tag=self.delivered), None,
                         json.dumps(self.messages.popleft()).encode())
        else:
            time.sleep(0.01)

    def close(self):
        self.is_open = False


class SlotConsumerTests(unittest.TestCase):
    def test_lowering_limit_finishes_running_job_and_requeues_reserved_delivery(self):
        capacity, stop = Capacity(2, 1), threading.Event()
        connection = FakeConnection([{"jobId": "a", "dispatchSequence": 0}, {"jobId": "b", "dispatchSequence": 0}])
        started, release, handled = threading.Event(), threading.Event(), []

        def handler(message, slot):
            handled.append(message["jobId"])
            started.set()
            release.wait(5)
        consumer = SlotConsumer(0, ["cp.judge.official.CPP"], lambda: connection, capacity, handler, stop)
        thread = threading.Thread(target=consumer.run)
        thread.start()
        try:
            self.assertTrue(started.wait(5))
            channel = connection.channel_object
            self.assertTrue(eventually(lambda: not channel.consumers), "consumers stay cancelled while busy")
            capacity.update(0)
            release.set()
            self.assertTrue(eventually(lambda: channel.acks == [1] and channel.nacks == [(2, True)]))
            self.assertEqual(handled, ["a"])
            self.assertFalse(connection.is_open)
        finally:
            stop.set()
            release.set()
            capacity.update(0)
            thread.join(5)

    def test_eligible_slot_runs_deliveries_one_at_a_time_and_acks_after_completion(self):
        capacity, stop = Capacity(1, 1), threading.Event()
        connection = FakeConnection([{"jobId": "a", "dispatchSequence": 0}, {"jobId": "b", "dispatchSequence": 0}])
        handled = []

        def handler(message, slot):
            handled.append(message["jobId"])
            if message["jobId"] == "b":
                raise Requeue()
        consumer = SlotConsumer(0, ["q"], lambda: connection, capacity, handler, stop)
        thread = threading.Thread(target=consumer.run)
        thread.start()
        try:
            channel = connection.channel_object
            self.assertTrue(eventually(lambda: channel.acks == [1] and channel.nacks == [(2, True)]))
            self.assertEqual(handled, ["a", "b"])
        finally:
            stop.set()
            thread.join(5)


class EnvironmentTests(unittest.TestCase):
    def test_existing_defaults_are_preserved(self):
        config = settings_from_environment({"WORKER_NAME": "official-1", "JUDGE_SLOTS": "2",
                                            "JUDGE_MAX_MEMORY_MB": "1024", "JUDGE_MEMORY_BUDGET_MB": "2048"})
        self.assertEqual((config["ceiling"], config["initial"], config["hostId"], config["hostBudget"]), (2, 2, "official-1", 2048))

    def test_ceilings_and_host_budget_are_validated(self):
        base = {"WORKER_NAME": "w", "JUDGE_MAX_MEMORY_MB": "1024"}
        with self.assertRaises(ValueError):
            settings_from_environment({**base, "JUDGE_MAX_SLOTS": "4", "JUDGE_SLOTS": "2", "JUDGE_MEMORY_BUDGET_MB": "2048"})
        with self.assertRaises(ValueError):
            settings_from_environment({**base, "JUDGE_MAX_SLOTS": "2", "JUDGE_SLOTS": "3"})
        with self.assertRaises(ValueError):
            settings_from_environment({**base, "JUDGE_MAX_SLOTS": "300", "JUDGE_SLOTS": "1"})
        # Only the slot count is required; blank budgets follow it.
        simple = settings_from_environment({**base, "JUDGE_SLOTS": "8", "JUDGE_MEMORY_BUDGET_MB": "", "JUDGE_HOST_ID": "judge-a", "JUDGE_HOST_MEMORY_BUDGET_MB": ""})
        self.assertEqual((simple["ceiling"], simple["budget"], simple["hostBudget"]), (8, 8192, 8192))
        config = settings_from_environment({**base, "JUDGE_MAX_SLOTS": "16", "JUDGE_SLOTS": "4", "JUDGE_MEMORY_BUDGET_MB": "16384",
                                            "JUDGE_HOST_ID": "judge-a", "JUDGE_HOST_MEMORY_BUDGET_MB": "20480"})
        self.assertEqual((config["ceiling"], config["initial"], config["hostId"]), (16, 4, "judge-a"))


if __name__ == "__main__":
    unittest.main()


class StartupVerificationTests(unittest.TestCase):
    class FlakyRunner:
        def __init__(self, failures):
            self.failures = dict(failures)
            self.calls = []

        def verify_runtime(self, language, image):
            self.calls.append(language)
            if self.failures.get(language, 0) > 0:
                self.failures[language] -= 1
                raise InfrastructureError(language + " failed")
            return {"verified": True, "imageId": "sha256:" + language.lower()}

    def test_one_failing_language_does_not_stop_the_judge(self):
        runner = self.FlakyRunner({"GO": 5})
        result = verify_languages(runner, "CPP,GO,PYTHON")
        self.assertEqual(sorted(result), ["CPP", "PYTHON"])
        self.assertEqual(runner.calls, ["CPP", "GO", "PYTHON", "GO"])

    def test_a_language_that_fails_once_is_retried_at_the_end(self):
        result = verify_languages(self.FlakyRunner({"KOTLIN": 1}), "KOTLIN,CPP")
        self.assertEqual(sorted(result), ["CPP", "KOTLIN"])

    def test_no_working_language_refuses_to_start(self):
        with self.assertRaises(InfrastructureError):
            verify_languages(self.FlakyRunner({"CPP": 9}), "CPP")
        with self.assertRaises(ValueError):
            verify_languages(self.FlakyRunner({}), "CPP,COBOL")

    def test_missing_images_are_built_before_the_self_test(self):
        built = []
        result = verify_languages(self.FlakyRunner({}), "CPP,RUBY", lambda image: built.append(image) or True)
        self.assertEqual(sorted(result), ["CPP", "RUBY"])
        self.assertEqual(built, ["cp-judge-cpp:local", "cp-judge-ruby:local"])

    def test_a_failed_image_build_only_skips_that_language(self):
        def build(image):
            if "rust" in image:
                raise InfrastructureError("Building failed")
            return False
        self.assertEqual(sorted(verify_languages(self.FlakyRunner({}), "CPP,RUST", build)), ["CPP"])


class SharedHostTests(unittest.TestCase):
    def test_owner_label_differs_per_installation_and_worker(self):
        a = sandbox_owner("official-1", "token-of-install-a")
        self.assertEqual(a, sandbox_owner("official-1", "token-of-install-a"))
        self.assertNotEqual(a, sandbox_owner("official-1", "token-of-install-b"))
        self.assertNotEqual(a, sandbox_owner("internal-1", "token-of-install-a"))
        self.assertNotIn("token", a)

    def test_leftover_cleanup_only_targets_this_owner(self):
        from runner import DockerRunner
        runner = object.__new__(DockerRunner)
        runner.owner = "official-1-abc"
        calls = []
        def control(args, timeout=10):
            calls.append(args)
            return "cp-judge-1 cp-judge-2" if args[0] == "ps" else ""
        runner.control = control
        self.assertEqual(runner.remove_leftovers(), 2)
        self.assertIn("label=cp.judge.owner=official-1-abc", calls[0])
        self.assertIn("label=cp.judge.sandbox=true", calls[0])
        self.assertEqual([c[:2] for c in calls[1:]], [["rm", "--force"], ["rm", "--force"]])
        runner.owner = ""
        calls.clear()
        self.assertEqual(runner.remove_leftovers(), 0)
        self.assertEqual(calls, [])
