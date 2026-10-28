# InfoM4th Arena — server setup guide

This guide takes you from this folder on your PC to a running contest platform on the
server, first on `http://SERVER_IP:30000`, then on your subdomain with HTTPS.

```
 visitors ──► (later) nginx on the server :443  arena.example.com
                         │
                         ▼
              port 30000 ── website container (UI + /api proxy)
                                   │
              backend ── PostgreSQL ── RabbitMQ ── 2 judges ──► sandbox containers
              (all inside Docker; only port 30000 is reachable from outside)
```

Everything runs in Docker Compose. You only ever edit **one file: `.env`**.

**Ports:** the platform needs only **30000** (website and API share it). Port **30001** is
not needed; keep it closed or keep it for later. Database, RabbitMQ and the API listen on
the server's localhost only and are never reachable from outside.

---

## Shared server: what this platform can and cannot touch

The server already runs other people's containers. The platform is built so it does not
interfere with them:

- Every `docker compose ...` command in this guide only acts on **this project's**
  containers (database, rabbitmq, backend, web, two judges), as long as you run it inside
  the platform folder and the project name is unique (Part C checks this).
- The judges start short-lived sandbox containers named `cp-judge-<random>`. A judge only
  ever stops or removes sandboxes **it created itself** (by exact name, or after a crash by
  its own owner label, which contains a fingerprint of this installation's secret token).
  It never lists, stops or removes any other container.
- Every service has a memory cap and rotated logs (max 30 MB each), and each sandbox is
  limited to 1 CPU and the problem's memory limit, so the platform cannot eat the host's
  RAM or disk. Database, RabbitMQ and API ports listen on 127.0.0.1 only.
- The first start builds images (CPU and network heavy for 15–30 minutes). Do it at a
  quiet time for the other users of the server.

> **Never run these on a shared server** (they affect *everyone's* containers or data):
> `docker system prune`, `docker container prune`, `docker image prune -a`,
> `docker volume prune`, `docker network prune`, `docker builder prune`,
> `docker rm -f $(docker ps -aq)`, `docker stop $(docker ps -q)`,
> `sudo systemctl restart docker`, reinstalling Docker, `sudo ufw enable` / `ufw reset`.
> Also never add `-v` to `docker compose down` (it deletes the contest database).

---

## Part A — Put the platform in its own Git repository (on your Windows PC)

Do this once. It copies `cp-platform` into a new folder, without build output or secrets.

```powershell
# 1. Copy the project to a new folder (skips node_modules, build output, .env and .local)
robocopy "C:\Users\elham\Documents\GitHub\PFE-problemsolving-platforme\cp-platform" "C:\Users\elham\Documents\GitHub\infom4th-arena" /E /XD node_modules target dist .local __pycache__ /XF .env .env.bak
cd C:\Users\elham\Documents\GitHub\infom4th-arena

# 2. Create the repository and the first commit
git init -b main
git add .
git status            # check: no .env, no node_modules, no target, no .local
git commit -m "InfoM4th Arena: contest platform"
```

3. Create an **empty private** repository on GitHub (github.com → New repository →
   name `infom4th-arena` → Private → do **not** add a README). Then:

```powershell
git remote add origin https://github.com/YOUR_USER/infom4th-arena.git
git push -u origin main
```

(With the GitHub CLI instead: `gh repo create infom4th-arena --private --source . --push`.)

> `.env` (passwords) is ignored by Git on purpose. Never commit it.

---

## Part B — Prepare the server (once)

Connect: `ssh YOUR_USER@SERVER_IP`

### B1. Check the machine

```bash
nproc                         # CPU cores (2+; 4 is good)
free -h                       # RAM (4 GB minimum)
df -h /                       # free disk: you need ~15 GB
stat -fc %T /sys/fs/cgroup    # must print: cgroup2fs
```

If the last line prints `tmpfs`, the server uses old cgroup v1 and judging will refuse to
start: ask your friend (the admin) to enable cgroup v2.

### B2. Docker access

On a server that already runs containers, Docker is installed: **do not install or
upgrade it** (that restarts the Docker engine and with it every container on the server).
You only need permission to use it:

```bash
docker ps                     # works? then skip to B3
```

If it says `permission denied`, ask your friend to run `sudo usermod -aG docker YOUR_USER`,
then log out and in again.

Only on an **empty** server without Docker:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit                          # log out and ssh in again so the group applies
docker run --rm hello-world   # must print "Hello from Docker!"
docker compose version        # must print a version (v2.x)
```

(Note: being in the `docker` group is equivalent to root on that server. The platform
needs it because the judges create sandbox containers.)

### B3. Open port 30000 (if the server has a firewall you control)

```bash
sudo ufw status               # if "inactive", skip this step (do NOT enable it)
sudo ufw allow 30000/tcp      # only adds one rule; changes nothing else
```

If the server sits behind a cloud firewall/security group, your friend must allow
TCP 30000 there (he probably already did when he gave you the ports).

---

## Part C — Install and start the platform

```bash
cd ~
git clone https://github.com/YOUR_USER/infom4th-arena.git
cd infom4th-arena

# Create .env: random secrets, a unique project name and work folder, website on 30000,
# and internal ports moved away from other services (they stay on localhost only).
COMPOSE_PROJECT_NAME=infom4th-arena JUDGE_HOST_WORK_ROOT=/var/lib/infom4th-arena-judge \
WEB_PORT=30000 DB_PORT=35433 SERVER_PORT=38081 RABBITMQ_PORT=35672 RABBITMQ_MANAGEMENT_PORT=35673 \
  sh scripts/setup-env.sh you@yourmail.com

# Read-only safety check: name clashes, ports in use, disk, Docker, cgroup v2.
sh scripts/check-server.sh
```

`check-server.sh` changes nothing. If it prints `WARN`, fix that line in `.env` (for a
port: pick another free number; for the name: another `COMPOSE_PROJECT_NAME`) and run
it again until it says **No conflicts found**.

The script prints the **first admin email and password**. Write the password down now.

Choose the judge size for the server (edit `.env` with `nano .env`):

| Server | `OFFICIAL_JUDGE_SLOTS` | `INTERNAL_JUDGE_SLOTS` | `JUDGE_MAX_MEMORY_MB` |
| --- | --- | --- | --- |
| 2 CPU / 4 GB | 1 | 1 | 768 |
| 4 CPU / 4 GB | 2 | 1 | 768 |
| 4 CPU / 6 GB | 2 | 1 | 1024 |
| 4 CPU / 8 GB | 3 | 1 | 1024 |

(A "slot" is one submission being judged at a time. 100 contestants do not need 100
slots: submissions queue for a few seconds and run in order.)

Start everything:

```bash
docker compose up -d --build
```

**The first start is long** (20–40 minutes): Docker builds the backend and website,
then the judges build the 13 language images (~12 GB) and test each language by
compiling and running real programs. Follow it:

```bash
docker compose ps                         # backend/database/rabbitmq become "healthy"
docker compose logs -f judge-official     # wait for: "Registered as ..."  (Ctrl+C to stop watching)
```

You can already open the website while the judges prepare; submissions wait in the
queue and are judged as soon as the judges are registered.

---

## Part D — First login and checks

1. Open **`http://SERVER_IP:30000`** and sign in with the printed admin login.
2. **Change the admin password**: click your name at the top right → Change password.
   Then remove the startup password from `.env` (it is only used to create the first admin):
   ```bash
   sed -i 's/^BOOTSTRAP_PASSWORD=.*/BOOTSTRAP_PASSWORD=/' .env
   ```
3. Control room → **Judges & capacity**: 2 judges online.
4. Control room → **Languages**: 13 languages "Ready".
5. Test real judging: Control room → **+ New problem** (any A+B problem with a few tests and
   a correct reference solution) → it validates → **+ New contest** → *Create & start now*
   → sign in as a normal user in a private window → submit a correct and a wrong solution.

---

## Part E — The subdomain with nginx and HTTPS

First, whoever controls the domain adds a **DNS record**:

| Type | Name | Value |
| --- | --- | --- |
| A | `arena` (your subdomain) | `SERVER_IP` |

Check it from your PC: `nslookup arena.example.com` must show the server IP (can take
a few minutes up to an hour).

Then pick the case that matches the server.

### Case 1 — your friend already runs nginx (most likely on a shared server)

Send him the file **`deploy/nginx-subdomain.conf`** from this repository with your
subdomain written in it. It forwards the subdomain to `127.0.0.1:30000` and passes the
visitor's address. He installs it and runs `certbot --nginx -d YOUR_SUBDOMAIN` for HTTPS.

### Case 2 — you have sudo and ports 80/443 are free

First make sure nothing else (another nginx, Traefik, Caddy, Apache, a container) already
serves 80/443; if this prints anything, use Case 1 and talk to your friend instead:

```bash
sudo ss -ltnp '( sport = :80 or sport = :443 )'
```

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
cd ~/infom4th-arena
sed -i 's/arena.example.com/YOUR_SUBDOMAIN/g' deploy/nginx-subdomain.conf
sudo cp deploy/nginx-subdomain.conf /etc/nginx/sites-available/cp-arena.conf
sudo ln -s /etc/nginx/sites-available/cp-arena.conf /etc/nginx/sites-enabled/cp-arena.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d YOUR_SUBDOMAIN      # answers: your email, agree, redirect = yes
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp   # only if ufw is active
```

Certbot renews the certificate automatically.

### After the subdomain works (both cases)

Tell the platform its new address, and (optional) stop exposing port 30000 directly so
everyone goes through HTTPS:

```bash
cd ~/infom4th-arena
PUBLIC_URL=https://YOUR_SUBDOMAIN WEB_BIND=127.0.0.1 sh scripts/setup-env.sh
docker compose up -d
```

Only use `WEB_BIND=127.0.0.1` when nginx runs **on the same server**. If your friend's
nginx is on another machine, leave it out (keep `WEB_BIND=0.0.0.0`).

Open `https://YOUR_SUBDOMAIN` — done.

---

## Part F — Everyday commands

Run them **inside `~/infom4th-arena`**: there, `docker compose` only acts on this
platform's containers. Plain `docker` commands (without `compose`) can act on anyone's
containers; use them only to look (`docker ps`, `docker stats`).

| Task | Command |
| --- | --- |
| See what runs | `docker compose ps` |
| Logs (live) | `docker compose logs -f backend` / `judge-official` / `web` |
| Restart everything | `docker compose restart` |
| Stop (data kept) | `docker compose down` |
| Start again | `docker compose up -d` |
| Update to the latest code | `git pull && docker compose up -d --build` |
| Change judge slots | edit `.env`, then `docker compose up -d` (only judges restart) |
| Change judge slots live during a contest | Control room → Judges & capacity → Workers |
| Check every language | `docker compose run --rm --no-deps --entrypoint python judge-official diagnose.py` |
| Disk usage of Docker | `docker system df` |

### Backups

```bash
mkdir -p ~/backups
docker compose exec -T database pg_dump -U cp_app cp_platform | gzip > ~/backups/arena-$(date +%F-%H%M).sql.gz
```

Daily automatic backup at 03:00 (`crontab -e`, add one line):

```
0 3 * * * cd ~/infom4th-arena && docker compose exec -T database pg_dump -U cp_app cp_platform | gzip > ~/backups/arena-$(date +\%F).sql.gz
```

Restore into a fresh install (after `docker compose up -d` once):

```bash
gunzip -c ~/backups/arena-DATE.sql.gz | docker compose exec -T database psql -U cp_app cp_platform
```

Moving to another server = copy `.env` and a backup, clone the repo there, restore,
`docker compose up -d --build`.

---

## Part G — Before each contest

- [ ] `docker compose ps`: everything Up/healthy; both judges online in the Control room.
- [ ] Control room → Languages: the contest's languages are "Ready".
- [ ] Problems are approved (validated by the real judge).
- [ ] Run the contest once as a **rehearsal** or a short "start now" test contest and
      submit right and wrong solutions.
- [ ] `df -h /` shows several GB free.
- [ ] A fresh database backup exists.
- [ ] For many contestants, measure throughput once:
      `python3 scripts/verify-live.py --users 30 --timeout 900` (see README; use a test
      account set on the server, not during a live contest).

---

## Part H — Troubleshooting

| Symptom | Fix |
| --- | --- |
| `permission denied ... docker.sock` | You are not in the `docker` group: ask the admin for `sudo usermod -aG docker YOUR_USER`, then log out and in. |
| Want to remove the platform completely | Inside the folder: `docker compose down` (keeps the data volume), then `docker volume ls` and remove only the volumes starting with your project name, then `docker rmi cp-judge-cpp:local ...` for the language images. Touch nothing else. |
| `port is already allocated` | Another service uses that port. Pick another number for that line (`DB_PORT`, `RABBITMQ_PORT`, ...) in `.env`, then `docker compose up -d`. |
| Website shows "502 Bad Gateway" | The backend is still starting (1–2 min). Check `docker compose logs backend`. |
| Submissions stay "In queue" | Judges not ready yet: `docker compose logs judge-official` and wait for `Registered as`. |
| Judge log: `Language X is NOT available` | That language failed its self-test; the others still work. Read the line above it; often the image build failed (network/disk). Fix, then `docker rmi cp-judge-x:local` and `docker compose restart judge-official judge-internal`. |
| Judge log: `cgroup v2 is required` | The server uses cgroup v1; the admin must enable cgroup v2 (`systemd.unified_cgroup_hierarchy=1`). |
| Disk full | Look first: `docker system df` and `df -h`. Our biggest items are the language images: drop languages you do not use from `JUDGE_LANGUAGES` and remove only their images, e.g. `docker rmi cp-judge-rust:local cp-judge-kotlin:local`. Do **not** prune; that deletes other people's images and cache. |
| Forgot the admin password | Register a normal account on the website, then make it super admin: `docker compose exec database psql -U cp_app cp_platform -c "INSERT INTO user_roles(user_id,role_code) SELECT id,'SUPER_ADMIN' FROM users WHERE email='you@yourmail.com' ON CONFLICT DO NOTHING;"` |
| Login says "too many requests" for everyone | nginx is not sending `X-Forwarded-For`; use `deploy/nginx-subdomain.conf` as is. |

More details: [docs/DEPLOY_VPS.md](docs/DEPLOY_VPS.md) (sizing, languages) and
[docs/OPERATIONS.md](docs/OPERATIONS.md) (judging capacity, recovery).
