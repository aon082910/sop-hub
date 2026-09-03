#!/bin/sh
set -e

PUID="${PUID:-99}"
PGID="${PGID:-100}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-sophub}"

mkdir -p "$PGDATA" "$UPLOAD_DIR" /run/postgresql

if [ "$(id -u)" = "0" ]; then
  # PUID/PGID may already exist in the image (e.g. Unraid's default 99/100
  # can collide with a preexisting alpine group) -- reuse the existing
  # group/user by name in that case instead of failing to create a new one.
  GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)
  if [ -z "$GROUP_NAME" ]; then
    GROUP_NAME=appgroup
    addgroup -g "$PGID" "$GROUP_NAME"
  fi
  USER_NAME=$(getent passwd "$PUID" | cut -d: -f1)
  if [ -z "$USER_NAME" ]; then
    USER_NAME=appuser
    adduser -D -H -u "$PUID" -G "$GROUP_NAME" "$USER_NAME"
  fi
  chown -R "$PUID:$PGID" /config /run/postgresql

  export PUID PGID PGDATA UPLOAD_DIR POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
    JWT_SECRET PUBLIC_BASE_URL PORT TZ \
    AI_DEFAULT_PROVIDER OLLAMA_BASE_URL OLLAMA_MODEL \
    ANTHROPIC_API_KEY ANTHROPIC_MODEL OPENAI_API_KEY OPENAI_MODEL \
    CUSTOM_OPENAI_BASE_URL CUSTOM_OPENAI_API_KEY CUSTOM_OPENAI_MODEL
  exec su-exec "$USER_NAME:$GROUP_NAME" "$0" "$@"
fi

export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "Initializing Postgres data directory at $PGDATA..."
  printf '%s' "$POSTGRES_PASSWORD" > /tmp/pgpass
  initdb -D "$PGDATA" -U "$POSTGRES_USER" --pwfile=/tmp/pgpass --auth=trust >/tmp/initdb.log 2>&1
  rm -f /tmp/pgpass
fi

pg_ctl -D "$PGDATA" -l /tmp/postgres.log -o "-c listen_addresses=127.0.0.1 -c logging_collector=off" -w start

# First boot only: the app database itself doesn't exist until we create it
# (initdb only creates the superuser's own default db).
if ! psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" | grep -q 1; then
  createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
fi

node dist/db/migrate.js

node dist/index.js &
NODE_PID=$!

# Stop the app first so it drops its DB connections cleanly, then stop
# Postgres -- the reverse order kills node's connections out from under it.
shutdown() {
  kill -TERM "$NODE_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
  pg_ctl -D "$PGDATA" -m fast stop
  exit 0
}
trap shutdown TERM INT

wait "$NODE_PID"
