#!/bin/sh
# Creates cp-platform/.env from .env.example and fills every secret with a random value.
# Safe to re-run: secrets you already have are never changed.
#
#   sh scripts/setup-env.sh [admin-email]
#
# Settings can be given as environment variables; they are written to .env every run:
#   WEB_PORT=30000 PUBLIC_URL=https://arena.example.com sh scripts/setup-env.sh me@example.com
# Supported: COMPOSE_PROJECT_NAME WEB_PORT WEB_BIND PUBLIC_URL DB_PORT SERVER_PORT RABBITMQ_PORT
#            RABBITMQ_MANAGEMENT_PORT JUDGE_HOST_WORK_ROOT OFFICIAL_JUDGE_SLOTS
#            INTERNAL_JUDGE_SLOTS JUDGE_MAX_MEMORY_MB JUDGE_LANGUAGES
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env

random_hex() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }

current() { sed -n "s/^$1=\([^ #]*\).*/\1/p" .env | head -n 1; }

# Writes KEY=VALUE, replacing the first existing KEY line (and its inline comment).
set_value() {
  key=$1 value=$2
  if grep -q "^$key=" .env; then
    tmp=$(mktemp)
    awk -v k="$key" -v v="$value" 'BEGIN{done=0} index($0, k"=")==1 && !done {print k"="v; done=1; next} {print}' .env > "$tmp"
    cat "$tmp" > .env && rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

# Sets KEY only when it is empty or still a placeholder. Prints "set KEY" when it did.
fill() {
  case "$(current "$1")" in
    ""|replace-with-*) set_value "$1" "$2"; echo "set $1" ;;
  esac
}

fill DB_PASSWORD "$(random_hex 24)"
fill RABBITMQ_PASSWORD "$(random_hex 24)"
fill WORKER_TOKEN "$(random_hex 32)"
fill BOOTSTRAP_EMAIL "${1:-admin@infom4th.local}"
admin_password="Cp-$(random_hex 8)!9a"
new_admin=0
[ -n "$(fill BOOTSTRAP_PASSWORD "$admin_password")" ] && new_admin=1

for key in COMPOSE_PROJECT_NAME WEB_PORT WEB_BIND PUBLIC_URL DB_PORT SERVER_PORT RABBITMQ_PORT RABBITMQ_MANAGEMENT_PORT \
           JUDGE_HOST_WORK_ROOT OFFICIAL_JUDGE_SLOTS INTERNAL_JUDGE_SLOTS JUDGE_MAX_MEMORY_MB JUDGE_LANGUAGES; do
  eval "value=\${$key:-}"
  if [ -n "$value" ]; then
    set_value "$key" "$value"
    echo "set $key=$value"
  fi
done

# Without an explicit PUBLIC_URL, use this machine's first IP and the website port.
if [ -z "${PUBLIC_URL:-}" ] && { [ -z "$(current PUBLIC_URL)" ] || current PUBLIC_URL | grep -q '^http://localhost'; }; then
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  port=$(current WEB_PORT)
  url="http://${ip:-localhost}"
  [ -n "$port" ] && [ "$port" != "80" ] && url="$url:$port"
  set_value PUBLIC_URL "$url"
  echo "set PUBLIC_URL=$url"
fi
# The browser origin must be allowed; it is the public address.
set_value CORS_ORIGINS "$(current PUBLIC_URL)"

echo
echo "Ready. Start everything with:  docker compose up -d --build"
echo "Website: $(current PUBLIC_URL)"
if [ "$new_admin" = 1 ]; then
  echo "First admin: $(current BOOTSTRAP_EMAIL)  password: $admin_password"
  echo "(Write it down. Change it after signing in, then remove BOOTSTRAP_PASSWORD from .env.)"
fi
