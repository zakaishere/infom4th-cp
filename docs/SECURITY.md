# Judge and API security assumptions

The API and original academic project are separate. Contestant code never runs in
the API process. Only the trusted Linux worker has the Docker socket and it must
be treated as a privileged host controller. Do not expose its credential, mount
the socket in the API, or run the worker on an unrelated personal/production host.

Contestant compiler/program processes run as UID/GID 10001 in disposable containers.
A minimal trusted PID 1 runs as root with all capabilities dropped so contestants
cannot kill the keeper to interfere with post-run cgroup accounting. The executed
code has no root identity, capabilities, worker environment, broker credential,
database credential, Docker socket, host process namespace or unrestricted mounts.
Only that submission's source/artifacts directory is mounted. Runtime mounts are
read-only; hidden tests and expected outputs are never written into that directory.
Per-case input is piped over stdin; expected output stays in the trusted worker.

Containers have no network, private cgroup namespace, read-only root, bounded tmpfs,
no-new-privileges, process/file/CPU/memory/swap limits and no core dumps. Default
Docker seccomp/AppArmor policies must remain enabled. The worker enforces wall
deadlines and output limits externally and kills/removes the complete container.
Output is never interpreted as status, exit or resource-control markers.

Resource reporting reads cgroup-v2 cpu.stat, memory.peak and memory.events through a
read-only mount of the host's cgroup tree in the trusted worker, or through a trusted
Docker control channel when that is unavailable. Contestant containers never get this
mount. It shows the worker every container's resource counters on that host, which adds
little to the Docker socket it already holds. The host kernel must expose memory.peak; workers
fail verification if these accounting interfaces are unavailable. Peak memory is the whole case-container peak,
not a fabricated copy of its configured limit. If the kernel kills the container
before accounting can be read, the trusted Docker OOM flag determines MLE and
unavailable metrics are zero; zero must be displayed as unavailable, not as proof
that a program used no memory. Java managed-heap OutOfMemoryError without a kernel
OOM is currently a runtime error, rather than parsed from untrusted stderr.

Docker shares the host kernel. These controls do not make kernel/container escape
impossible. Use a dedicated, patched Linux judge VM/host and assess stronger
isolation such as gVisor or microVMs before accepting arbitrary public code.
Do not enable runtimes until the opt-in Docker tests pass on that exact host.

The worker is trusted to judge correctly. A stolen WORKER_TOKEN permits retrieving
hidden assets and reporting results. Restrict internal routes using network policy,
rotate the credential, use transport security between hosts, and protect worker
administration. Runtime image IDs are captured into each immutable problem version and checked on every claim; changing
a pin is a privileged audited operation and should be rehearsed before a contest.

API access is bearer-only. Every participant identity comes from authentication,
not a request user ID. Refresh/reset credentials are hashed and single-use/rotated.
Public DTOs select statements/samples and safe aggregate results, never hidden
tests, reference code or private diagnostics. Submission source is owner/team/jury
restricted. Problem approvals, publication and resource delegation require backend
checks. Immutable snapshots prevent test edits silently changing a live contest.

Audit tables resist ordinary application mutation, not the database owner.
Per-process admission/auth limits need shared reverse-proxy limits when scaling
API replicas. Application/request limits supplement host quotas and monitoring.

Judging capacity settings are SUPER_ADMIN-only, require a reason and are audited
with previous and new values. They can only lower or redistribute work within
ceilings that trusted workers report from their own deployment configuration
(JUDGE_MAX_SLOTS, per-slot memory, lane and host memory budgets). No admin setting
can name a Docker socket, image, credential, mount or command, and the admin
view never returns contestant source, hidden tests or worker secrets. A worker
clamps any received target to its own ceiling, so a compromised or misconfigured
API cannot make a worker exceed its local limits. Because workers report their own
budgets, a stolen WORKER_TOKEN can still register misleading capacity; protect it
as described above.

The browser UI stores bearer tokens in localStorage, so any script injection
would expose them. Statements are rendered with an escape-first Markdown subset
and no third-party scripts run in the page; keep it that way and serve the UI
with a strict Content-Security-Policy. Arena full screen is a usability
deterrent only. It is not proctoring: contestants can use other devices, and
browsers that refuse full screen are allowed to continue with a visible warning.
