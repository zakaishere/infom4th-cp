"""RabbitMQ consumers with a live, administrator-controlled execution limit.

Deployment configuration supplies defaults (JUDGE_SLOTS, JUDGE_MAX_SLOTS, per-slot memory
and memory budgets). The backend heartbeat reply carries the administrator's desired
concurrency and drain state; the worker applies it without restarting, starting more slot
threads when needed, up to the MAX_SLOTS sanity cap. Lowering the limit never interrupts
running submissions.
"""
import concurrent.futures
import json
import logging
import os
import random
import signal
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path
from runner import DockerRunner, InfrastructureError, LANGUAGES, IMAGE_NAMES

LOG = logging.getLogger("cp.judge")
MAX_SLOTS = 256  # sanity cap: one thread and one broker connection per slot


class CapacityBusy(Exception):
    """The job is claimable but no capacity is free (HTTP 429). Keep the delivery and retry."""


class WorkerUnavailable(Exception):
    """The backend considers this worker offline or draining (HTTP 409)."""


class Requeue(Exception):
    """Return the delivery to RabbitMQ unexecuted so another slot or worker can take it."""


class Api:
    def __init__(self, url, token):
        self.url = url.rstrip("/")
        self.token = token
        if len(token) < 32:
            raise ValueError("WORKER_TOKEN must contain at least 32 characters")

    def post(self, path, body):
        request = urllib.request.Request(self.url+"/internal/judge"+path,
                    data=json.dumps(body).encode(), method="POST",
                    headers={"Authorization": "Bearer "+self.token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = response.read(32*1024*1024+1)
        except urllib.error.HTTPError as error:
            if error.code == 429:
                raise CapacityBusy(error.read(2048).decode("utf-8", "replace")) from None
            if error.code == 409:
                raise WorkerUnavailable(error.read(2048).decode("utf-8", "replace")) from None
            raise
        if len(raw) > 32*1024*1024:
            raise InfrastructureError("Oversized API response")
        return json.loads(raw) if raw else None


class Capacity:
    """Live execution limit shared by all slot threads of this process.

    target is the administrator's desired concurrency clamped to the trusted ceiling;
    active counts submissions that hold a claimed lease. A slot may start new work only
    while active < target, so lowering target lets running jobs finish and blocks new
    starts until concurrency falls below the new limit.
    """

    def __init__(self, ceiling, target):
        if not 1 <= ceiling <= MAX_SLOTS:
            raise ValueError("Slot ceiling must be between 1 and %d" % MAX_SLOTS)
        self.ceiling = ceiling
        self.target = max(0, min(ceiling, target))
        self.active = 0
        self.draining = False
        self.stale = False
        self.condition = threading.Condition()

    def update(self, target, draining=False):
        with self.condition:
            requested = int(target)
            if requested > self.ceiling:
                LOG.warning("Backend target %d exceeds the trusted ceiling %d; using the ceiling", requested, self.ceiling)
            self.target = max(0, min(self.ceiling, requested))
            self.draining = bool(draining)
            self.stale = False
            self.condition.notify_all()

    def mark_stale(self):
        """Control state is too old to trust: start nothing new until the backend answers."""
        with self.condition:
            self.stale = True
            self.condition.notify_all()

    def limit(self):
        return 0 if self.draining or self.stale else self.target

    def eligible(self, slot):
        with self.condition:
            return slot < self.limit()

    def try_acquire(self, slot):
        with self.condition:
            if slot < self.limit() and self.active < self.limit():
                self.active += 1
                return True
            return False

    def release(self):
        with self.condition:
            self.active -= 1
            self.condition.notify_all()

    def wait(self, timeout):
        with self.condition:
            self.condition.wait(timeout)

    def snapshot(self):
        with self.condition:
            return {"active": self.active, "target": self.limit(), "maxSlots": self.ceiling,
                    "draining": self.draining, "stale": self.stale, "overTarget": self.active > self.limit()}


class Control:
    """Registration plus the bounded heartbeat control exchange."""

    def __init__(self, api, capacity, registration, stale_after=60, clock=time.monotonic, on_change=lambda: None):
        self.api = api
        self.capacity = capacity
        self.registration = registration
        self.stale_after = stale_after
        self.clock = clock
        self.worker = None
        self.last_success = clock()
        self.on_change = on_change

    def apply(self, reply):
        if reply and "desiredConcurrency" in reply:
            self.capacity.update(reply["desiredConcurrency"], reply.get("draining", False))
            self.on_change()
        self.last_success = self.clock()

    def register(self):
        reply = self.api.post("/workers", self.registration)
        self.worker = reply["workerId"]
        self.apply(reply)
        LOG.info("Registered as %s: %s", self.worker, self.capacity.snapshot())

    def tick(self):
        try:
            self.apply(self.api.post("/workers/"+self.worker+"/heartbeat", self.capacity.snapshot()))
        except WorkerUnavailable:
            # Marked offline after an outage. Re-registering keeps the saved admin settings.
            try:
                self.register()
            except Exception:
                LOG.warning("Worker re-registration failed")
                self.check_stale()
        except Exception:
            LOG.warning("Worker heartbeat failed; keeping the last known limit")
            self.check_stale()

    def check_stale(self):
        if self.clock()-self.last_success > self.stale_after:
            self.capacity.mark_stale()


def execute(message, slot, capacity, api, worker_id, runner, stop, backoff=lambda: random.uniform(1.0, 3.0)):
    """Claim and judge one delivery. Returns normally to acknowledge; raises Requeue to return it."""
    job_id = message["jobId"]
    while True:
        if stop.is_set():
            raise Requeue()
        if not capacity.try_acquire(slot):
            if not capacity.eligible(slot):
                raise Requeue()
            capacity.wait(0.5)
            continue
        try:
            claimed = api.post("/jobs/"+job_id+"/claim",
                               {"workerId": worker_id(), "dispatchSequence": message["dispatchSequence"]})
        except CapacityBusy:
            # Global lane, worker or host capacity is full; keep the delivery and retry.
            capacity.release()
            stop.wait(backoff())
            continue
        except WorkerUnavailable:
            capacity.release()
            raise Requeue()
        except BaseException:
            capacity.release()
            raise
        try:
            if not claimed:
                return  # stale or duplicate dispatch; recovery covers abandoned jobs
            run_claimed(job_id, claimed, api, worker_id(), runner)
            return
        finally:
            capacity.release()


def run_claimed(job_id, claimed, api, worker, runner):
    lease = claimed["leaseToken"]
    done, lost = threading.Event(), threading.Event()

    def renew():
        while not done.wait(15):
            try:
                api.post("/jobs/"+job_id+"/heartbeat", {"workerId": worker, "leaseToken": lease})
            except Exception:
                lost.set()
                return
    renewer = threading.Thread(target=renew, daemon=True)
    renewer.start()
    try:
        try:
            result = runner.judge(claimed, lost)
        except Exception:
            LOG.warning("Infrastructure failure for job %s", job_id)
            result = {"verdict": "JUDGE_ERROR"}
        if lost.is_set():
            raise InfrastructureError("Lease lost before completion")
        result.update({"workerId": worker, "leaseToken": lease})
        api.post("/jobs/"+job_id+"/complete", result)
    finally:
        done.set()
        renewer.join(timeout=2)


class SlotConsumer:
    """One execution slot: at most one submission running and one delivery reserved.

    The slot subscribes to its lane's language queues only while it is idle and eligible,
    cancels its consumers as soon as a delivery arrives, and requeues reserved deliveries
    when it becomes ineligible. Results are acknowledged only after they are persisted.
    """

    def __init__(self, slot, queues, connect, capacity, handler, stop):
        self.slot = slot
        self.queues = queues
        self.connect = connect
        self.capacity = capacity
        self.handler = handler
        self.stop = stop

    def run(self):
        while not self.stop.is_set():
            if not self.capacity.eligible(self.slot):
                self.capacity.wait(1)
                continue
            try:
                self.session()
            except Exception:
                LOG.warning("RabbitMQ consumer for slot %d reconnecting", self.slot)
                self.stop.wait(5)

    def session(self):
        connection = self.connect()
        channel = connection.channel()
        channel.basic_qos(prefetch_count=1)
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        pending, tags, running = deque(), [], None

        def received(ch, method, properties, body):
            try:
                if len(body) > 1024:
                    raise ValueError("Oversized dispatch")
                pending.append((method.delivery_tag, json.loads(body)))
            except Exception:
                ch.basic_nack(method.delivery_tag, requeue=False)
        try:
            while not self.stop.is_set() and connection.is_open:
                eligible = self.capacity.eligible(self.slot)
                if running is None and pending and eligible:
                    tag, message = pending.popleft()
                    running = (tag, executor.submit(self.handler, message, self.slot))
                idle = running is None and not pending
                if idle and eligible and not tags:
                    tags.extend(channel.basic_consume(queue, received, auto_ack=False) for queue in self.queues)
                elif tags and not (idle and eligible):
                    for consumer in tags:
                        channel.basic_cancel(consumer)  # pika requeues undispatched deliveries
                    tags.clear()
                connection.process_data_events(time_limit=0.5)
                if running is not None and running[1].done():
                    self.settle(channel, *running)
                    running = None
                if running is None and not eligible:
                    break
        finally:
            if running is not None:
                # Never abandon a started submission: wait for it, then settle if still connected.
                concurrent.futures.wait([running[1]])
                self.settle(channel, *running)
            executor.shutdown(wait=True)
            if channel.is_open:
                for tag, _ in pending:
                    channel.basic_nack(tag, requeue=True)
            pending.clear()
            if connection.is_open:
                connection.close()

    @staticmethod
    def settle(channel, tag, future):
        if not channel.is_open:
            LOG.warning("Channel closed before acknowledgement; RabbitMQ redelivers and claims are idempotent")
            return
        try:
            future.result()
            channel.basic_ack(tag)
        except Requeue:
            channel.basic_nack(tag, requeue=True)
        except Exception:
            LOG.warning("Delivery interrupted; lease recovery will redispatch")
            channel.basic_nack(tag, requeue=False)


class SlotPool:
    """Starts slot threads on demand so an administrator can raise concurrency live."""

    def __init__(self, factory):
        self.factory = factory
        self.threads = []
        self.lock = threading.Lock()

    def ensure(self, count):
        with self.lock:
            while len(self.threads) < min(count, MAX_SLOTS):
                thread = threading.Thread(target=self.factory(len(self.threads)), daemon=False)
                self.threads.append(thread)
                thread.start()

    def join(self):
        index = 0
        while True:
            with self.lock:
                if index >= len(self.threads):
                    return
                thread = self.threads[index]
            thread.join()
            index += 1


def detect_hardware():
    """CPU cores and memory visible to this worker, reported so admins see risky settings."""
    result = {"detectedCpus": os.cpu_count() or 1}
    try:
        with open("/proc/meminfo", encoding="ascii") as meminfo:
            for line in meminfo:
                if line.startswith("MemTotal:"):
                    result["detectedMemoryMb"] = int(line.split()[1]) // 1024
                    break
    except OSError:
        pass
    return result


def _number(env, key, default):
    """Integer setting; a missing or blank value means "use the default"."""
    value = str(env.get(key, "")).strip()
    return int(value) if value else default


def settings_from_environment(env):
    """Validates deployment defaults; administrators can later set any slot count up to MAX_SLOTS."""
    max_memory = _number(env, "JUDGE_MAX_MEMORY_MB", 1024)
    initial = _number(env, "JUDGE_SLOTS", 2)
    ceiling = _number(env, "JUDGE_MAX_SLOTS", initial)
    if not 1 <= ceiling <= MAX_SLOTS:
        raise ValueError("JUDGE_MAX_SLOTS must be between 1 and %d" % MAX_SLOTS)
    if not 1 <= initial <= ceiling:
        raise ValueError("JUDGE_SLOTS (initial concurrency) must be between 1 and JUDGE_MAX_SLOTS")
    if max_memory < 1:
        raise ValueError("JUDGE_MAX_MEMORY_MB must be positive")
    # Budgets are optional: by default they follow the slot count.
    budget = _number(env, "JUDGE_MEMORY_BUDGET_MB", ceiling*max_memory)
    if ceiling*max_memory > budget:
        raise ValueError("JUDGE_MAX_SLOTS x JUDGE_MAX_MEMORY_MB exceeds JUDGE_MEMORY_BUDGET_MB")
    lane = env.get("JUDGE_LANE", "official")
    if lane not in ("official", "internal"):
        raise ValueError("JUDGE_LANE must be official or internal")
    host = env.get("JUDGE_HOST_ID", "").strip()
    if host:
        # Without an explicit host budget, the machine's RAM is the honest shared limit.
        default_host = max(budget, detect_hardware().get("detectedMemoryMb", budget))
        host_budget = max(budget, _number(env, "JUDGE_HOST_MEMORY_BUDGET_MB", default_host))
    else:
        # Without a shared host identity the backend can only protect this process's own budget.
        LOG.warning("JUDGE_HOST_ID is unset; host-wide memory overcommit protection is not active")
        host, host_budget = env["WORKER_NAME"], budget
    return {"ceiling": ceiling, "initial": initial, "maxMemoryMb": max_memory, "budget": budget,
            "lane": lane, "hostId": host, "hostBudget": host_budget}


def sandbox_owner(worker_name: str, worker_token: str) -> str:
    """Owner label value: the worker name plus a fingerprint of this installation's secret
    token, so two platform installations on one Docker host never claim each other's sandboxes."""
    import hashlib
    return worker_name + "-" + hashlib.sha256(worker_token.encode("utf-8")).hexdigest()[:12]


def verify_languages(runner, configured: str, build=None) -> dict:
    """Self-tests every configured language. A language that fails is skipped (and retried
    once at the end, when the machine is quieter) so one bad runtime never takes the whole
    judge down; the judge only refuses to start when no language works. `build(image)`
    creates a missing runtime image first (it returns True when it built one)."""
    languages = [language.strip() for language in configured.split(",") if language.strip()]
    for language in languages:
        if language not in LANGUAGES:
            raise ValueError("Unsupported runtime: "+language)
    verified, failed = {}, []
    for attempt in (1, 2):
        for language in (languages if attempt == 1 else failed[:]):
            image = os.getenv("JUDGE_IMAGE_"+language, "cp-judge-"+IMAGE_NAMES.get(language, language.lower())+":local")
            try:
                if build is not None:
                    LOG.info("Checking image for %s (%s); a missing image is built now, which can take minutes", language, image)
                    if build(image):
                        LOG.info("Built %s", image)
                verified[language] = runner.verify_runtime(language, image)
                LOG.info("Verified %s (%s)", language, image)
                if language in failed:
                    failed.remove(language)
            except InfrastructureError as error:
                LOG.error("Language %s is NOT available (attempt %d): %s", language, attempt, error)
                if language not in failed:
                    failed.append(language)
        if not failed:
            break
    if not verified:
        raise InfrastructureError("No configured language passed its self-test")
    if failed:
        LOG.error("Serving without: %s. Check their images (scripts/build-runtimes.sh) and restart.", ", ".join(failed))
    return verified


def main():
    import pika
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    config = settings_from_environment(os.environ)
    api = Api(os.environ["API_URL"], os.environ["WORKER_TOKEN"])
    runner = DockerRunner(os.getenv("JUDGE_WORK_ROOT", "/judge/work"),
                          os.environ["JUDGE_HOST_WORK_ROOT"], {}, config["maxMemoryMb"])
    runner.owner = sandbox_owner(os.environ["WORKER_NAME"], os.environ["WORKER_TOKEN"])
    removed = runner.remove_leftovers()
    if removed:
        LOG.warning("Removed %d sandbox container(s) left by a previous run of this worker", removed)
    runtimes = {"maxMemoryMb": config["maxMemoryMb"], "lane": config["lane"]}
    # Missing language images are built from judge/images on first start (JUDGE_BUILD_IMAGES=false
    # disables this, for hosts that receive prebuilt images).
    build = None
    if os.getenv("JUDGE_BUILD_IMAGES", "true").lower() != "false":
        dockerfiles = Path(__file__).resolve().parent / "images"
        build = lambda image: runner.ensure_image(image, dockerfiles)  # noqa: E731
    runtimes.update(verify_languages(runner, os.getenv("JUDGE_LANGUAGES", "CPP,C,JAVA,PYTHON"), build))
    capacity = Capacity(MAX_SLOTS, config["initial"])
    stop = threading.Event()
    pool = SlotPool(lambda slot: SlotConsumer(slot, queues, connect, capacity, handler, stop).run)
    control = Control(api, capacity, {
        "name": os.environ["WORKER_NAME"], "capacity": config["ceiling"], "defaultConcurrency": config["initial"],
        "hostId": config["hostId"], "hostMemoryBudgetMb": config["hostBudget"],
        "laneMemoryBudgetMb": config["budget"], "runtimes": runtimes, **detect_hardware()},
        on_change=lambda: pool.ensure(capacity.target))
    interval = max(1, int(os.getenv("JUDGE_CONTROL_INTERVAL_SECONDS", "5")))

    def heartbeat():
        while not stop.wait(interval):
            control.tick()

    def shutdown(*_):
        stop.set()
        runner.cancel()
        with capacity.condition:
            capacity.condition.notify_all()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    def connect():
        parameters = pika.URLParameters(os.environ["RABBITMQ_URL"])
        parameters.heartbeat = 30
        parameters.blocked_connection_timeout = 30
        return pika.BlockingConnection(parameters)

    queues = ["cp.judge."+config["lane"]+"."+language for language in runner.images]

    def handler(message, slot):
        return execute(message, slot, capacity, api, lambda: control.worker, runner, stop)
    control.register()
    threading.Thread(target=heartbeat, daemon=True).start()
    pool.ensure(capacity.target)
    pool.join()


if __name__ == "__main__":
    main()
