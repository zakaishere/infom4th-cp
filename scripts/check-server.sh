#!/bin/sh
# READ-ONLY pre-flight check for a shared server. It changes nothing: it only looks at
# Docker, ports, disk and memory, and reports anything that could clash with what is
# already running there. Run it before the first `docker compose up`.
#
#   sh scripts/check-server.sh            (reads settings from .env when it exists)
set -u
cd "$(dirname "$0")/.."
problems=0
ok()   { echo "  ok    $*"; }
warn() { echo "  WARN  $*"; problems=$((problems+1)); }
setting() { [ -f .env ] && sed -n "s/^$1=\([^ #]*\).*/\1/p" .env | head -n 1; }

project=$(setting COMPOSE_PROJECT_NAME); project=${project:-cp-platform}
work=$(setting JUDGE_HOST_WORK_ROOT); work=${work:-/var/lib/cp-judge}

echo "Docker"
if ! command -v docker >/dev/null 2>&1; then
  warn "docker is not installed (ask the server admin; do not reinstall Docker on a server that runs other containers)"
else
  if docker info >/dev/null 2>&1; then
    ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) reachable"
    [ "$(docker info --format '{{.CgroupVersion}}' 2>/dev/null)" = "2" ] && ok "cgroup v2" || warn "cgroup v2 is required for judging"
    echo "  info  $(docker ps -q | wc -l | tr -d ' ') containers are running on this server (they are not touched)"
  else
    warn "cannot talk to Docker: add your user to the docker group or ask the admin"
  fi
  docker compose version >/dev/null 2>&1 && ok "docker compose plugin present" || warn "docker compose plugin missing"
fi

echo "Names (project '$project')"
if docker info >/dev/null 2>&1; then
  if docker compose ls -a --format json 2>/dev/null | grep -q "\"Name\":\"$project\""; then
    here=$(pwd -P); command -v cygpath >/dev/null 2>&1 && here=$(cygpath -w "$here")
    if docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Label "com.docker.compose.project.working_dir"}}' | sort -u | grep -qixF "$here"; then
      ok "project '$project' already exists and belongs to this folder (an earlier install)"
    else
      warn "another Compose project is already called '$project'. Set a unique COMPOSE_PROJECT_NAME in .env, or our commands would act on its containers"
    fi
  else
    ok "no other Compose project uses the name '$project'"
  fi
  others=$(docker ps -a --format '{{.Names}}' | grep -E '^cp-judge-' | wc -l | tr -d ' ')
  [ "$others" = "0" ] && ok "no judge sandboxes on this server" || echo "  info  $others judge sandbox container(s) exist (ours or another install's; only a worker's own are ever removed)"
fi

echo "Ports"
for key in WEB_PORT DB_PORT SERVER_PORT RABBITMQ_PORT RABBITMQ_MANAGEMENT_PORT; do
  port=$(setting "$key")
  case $key in WEB_PORT) port=${port:-80};; DB_PORT) port=${port:-5433};; SERVER_PORT) port=${port:-8081};;
    RABBITMQ_PORT) port=${port:-5672};; RABBITMQ_MANAGEMENT_PORT) port=${port:-15672};; esac
  if command -v ss >/dev/null 2>&1 && ss -ltnH "( sport = :$port )" 2>/dev/null | grep -q .; then
    if docker ps --filter "label=com.docker.compose.project=$project" --format '{{.Ports}}' 2>/dev/null | grep -q ":$port->"; then
      ok "$key=$port is used by this platform"
    else
      warn "$key=$port is already in use by something else: choose another number in .env"
    fi
  else
    ok "$key=$port is free"
  fi
done

echo "Disk and memory"
free_gb=$(df -Pk / | awk 'NR==2 {print int($4/1048576)}')
[ "$free_gb" -ge 15 ] && ok "${free_gb} GB free on / (15 GB needed for all languages)" || warn "only ${free_gb} GB free on /; 15 GB needed for all 13 languages (list fewer in JUDGE_LANGUAGES)"
if [ -r /proc/meminfo ]; then
  avail_mb=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  [ -n "$avail_mb" ] && echo "  info  ${avail_mb} MB memory available now; the platform uses up to ~3.5 GB plus 1 GB per judge slot at peak"
fi
if [ -e "$work" ] && [ -n "$(ls -A "$work" 2>/dev/null | grep -v '^\.image-build\.lock$' | grep -v '^job-')" ]; then
  warn "$work already contains other files: set JUDGE_HOST_WORK_ROOT in .env to an empty or new folder"
else
  ok "judge work folder $work is free or ours"
fi

echo
[ "$problems" = 0 ] && echo "No conflicts found." || echo "$problems thing(s) to fix before starting (see WARN lines)."
