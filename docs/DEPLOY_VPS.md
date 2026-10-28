# Deploying on a VPS — the short version

The whole platform (database, RabbitMQ, backend, website and the two judges) is one
Docker Compose project. Copy the `cp-platform` folder to any machine with Docker and run:

```sh
cd cp-platform
sh scripts/setup-env.sh you@school.ma   # creates .env with random secrets, prints the admin login
docker compose up -d --build            # everything; the first start builds what it needs
```

Open `http://<server-ip>/` and sign in with the printed admin login. On Windows use
`scripts/setup-env.ps1` and Docker Desktop instead.

**First start takes a while:** the backend and website build in a few minutes, then each
judge builds the language images it is missing (about 15–30 minutes and ~12 GB for all
13 languages, depending on the network) and self-tests every language by compiling and
running real programs. Follow it with `docker compose logs -f judge-official`; contestants
can submit once it prints `Registered as ...`. Later restarts take ~5 minutes (images are
kept). Everything restarts by itself after a reboot.

Everything you normally change lives in **one file: `cp-platform/.env`**. After
editing it, run `docker compose up -d` again; nothing else needs editing.

## 1. Requirements

- Linux with Docker Engine and the Compose plugin (cgroup v2, the default on
  Ubuntu 22.04+ and Debian 12), or Docker Desktop. Install only on a server without Docker
  (on a shared server never reinstall it; see SETUP_SERVER.md):
  `curl -fsSL https://get.docker.com | sh`.
- Disk: about **12 GB** for all 13 language images plus the platform (C/C++ ≈ 2 GB,
  Rust ≈ 1.1 GB, Go ≈ 1.2 GB, PHP/Kotlin/C# ≈ 0.7 GB each, the rest 0.2–0.6 GB). A 60 GB
  SSD is plenty. List fewer languages in `JUDGE_LANGUAGES` to save space.
- RAM: see the slot table below.
- Open the website port (80 by default) in the VPS firewall. Database, broker and API
  ports listen only on 127.0.0.1.

## 2. Settings in `cp-platform/.env`

`setup-env.sh` fills the secrets and the address. The lines you may change:

| Line | What it means | Example |
| --- | --- | --- |
| `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD` | First super admin; remove the password after the first start | `you@school.ma` |
| `PUBLIC_URL`, `CORS_ORIGINS` | The address people open in the browser | `http://203.0.113.10` |
| `WEB_PORT` | Port of the website (UI + API on one address) | `80` |
| **`OFFICIAL_JUDGE_SLOTS`** | **How many contest submissions are judged at the same time** | `2` |
| **`INTERNAL_JUDGE_SLOTS`** | How many practice / problem-testing submissions at the same time | `1` |
| `JUDGE_MAX_MEMORY_MB` | Memory for each slot (problem memory limits must fit inside) | `1024` |
| `JUDGE_LANGUAGES` | Languages offered (missing images are built automatically) | see below |
| `JUDGE_HOST_WORK_ROOT` | Folder on the host used for compiling submissions | `/var/lib/cp-judge` |
| `DB_PASSWORD`, `RABBITMQ_PASSWORD`, `WORKER_TOKEN` | Random secrets (set by the script) | — |

Leave every other judge line empty; it is calculated from the slot counts.

All languages (the default):

```
JUDGE_LANGUAGES=CPP,CPP20,C,JAVA,PYTHON,PYPY,JAVASCRIPT,GO,RUST,KOTLIN,CSHARP,RUBY,PHP
```

### How many slots?

| VPS | `OFFICIAL_JUDGE_SLOTS` | `INTERNAL_JUDGE_SLOTS` | `JUDGE_MAX_MEMORY_MB` |
| --- | --- | --- | --- |
| 2 vCPU / 4 GB (everything on one machine) | 1 | 1 | 768 |
| **4 vCPU / 4 GB** | **2** | **1** | **768** |
| **4 vCPU / 6 GB** | **2** | **1** | **1024** |
| 4 vCPU / 8 GB | 3 | 1 | 1024 |
| 8 vCPU / 16 GB | 5 | 1 | 1024 |
| 16 vCPU / 32 GB (dedicated judge) | 12 | 2 | 1024 |

Rule: (official + internal) slots ≤ CPU cores minus 1 for the database, broker and
website, and slots × `JUDGE_MAX_MEMORY_MB` must fit in RAM with ~1.5 GB spare for the
database, RabbitMQ and backend. More slots than cores makes time limits unreliable.
100 participants do **not** need 100 slots: submissions wait a few seconds in the
queue and run in order. Problem memory limits must be ≤ `JUDGE_MAX_MEMORY_MB`.

## 3. Useful commands

```sh
docker compose ps                         # what is running
docker compose logs -f judge-official     # judge progress and verdict activity
docker compose up -d --build              # apply .env changes / code updates
docker compose down                       # stop (data is kept in Docker volumes)
docker compose exec database pg_dump -U cp_app cp_platform > backup.sql   # backup
```

Moving to another server: copy the folder (with `.env`), restore `backup.sql` with
`docker compose exec -T database psql -U cp_app cp_platform < backup.sql` after the
first start, and run `docker compose up -d --build`.

## 4. Running a contest

- **Control room → + New contest** walks through four steps. At the end choose
  **Create & start now** (the contest opens immediately and ends after its
  duration) or **Create & schedule** (countdown, registration before the start).
- An existing contest can also be started early from its page (**▶ Start now**).
  While it runs: **Pause submissions**, **+10 min**, **End now**, answer questions,
  announce, and rejudge from the live monitor.
- People can register and join while a contest is running.

## 5. Changing the numbers later

- **Planned change:** edit `OFFICIAL_JUDGE_SLOTS` / `INTERNAL_JUDGE_SLOTS` in `.env`,
  then `docker compose up -d` (only the judges restart; contests and
  data are untouched, queued submissions wait).
- **During an event, without restarting:** Control room → Judges & capacity → Workers
  → type a number → Set. This overrides `.env` until you press "reset".

## 6. Adding languages

Available: C++17, C++20, C, Java, Python, PyPy, JavaScript (Node), Go, Rust, Kotlin,
C#, Ruby, PHP. Add the codes to `JUDGE_LANGUAGES` and run `docker compose up -d`; the
judges build any missing image and self-test it (they compile and run a correct and a
wrong program). A language that fails is skipped and logged, never offered to
contestants, while the judge keeps serving the other languages. To rebuild an image
after editing its Dockerfile in `judge/images/`, delete it
(`docker rmi cp-judge-go:local`) and restart the judges, or run `sh scripts/build-runtimes.sh go`.
Problems offer the languages that were ready when the problem was validated;
re-validate a problem to add a newly installed language to it.

Time limits: Java and Kotlin get limit × 1.5 + 1 s and PyPy limit × 1.5 + 0.5 s, because
their startup alone costs that much CPU; every other language uses the exact limit.
Compilation may take up to 60 s (`JUDGE_COMPILE_SECONDS`). To check every language by
hand: `docker compose run --rm --no-deps --entrypoint python judge-official diagnose.py`.
