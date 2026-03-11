#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/storage/runtime/dev-stack"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"
API_LINUX_RUN_DIR="${API_LINUX_RUN_DIR:-$HOME/seguimiento-api-run-20260307}"
REDIS_HOST_PORT="${REDIS_HOST_PORT:-16380}"

mkdir -p "$RUNTIME_DIR"

service_pid_file() {
  printf '%s/%s.pid\n' "$RUNTIME_DIR" "$1"
}

service_log_file() {
  printf '%s/%s.log\n' "$RUNTIME_DIR" "$1"
}

service_port() {
  case "$1" in
    api) echo "3001" ;;
    web) echo "3000" ;;
    web_v2) echo "3010" ;;
    worker) echo "" ;;
    *) echo "" ;;
  esac
}

service_command() {
  case "$1" in
    api)
      if use_linux_api_shadow; then
        echo "pnpm start"
      else
        echo "pnpm -C apps/api dev"
      fi
      ;;
    web) echo "pnpm -C apps/web dev" ;;
    web_v2) echo "pnpm -C web-v2 dev" ;;
    worker) echo "pnpm -C apps/worker dev" ;;
    *) return 1 ;;
  esac
}

service_workdir() {
  case "$1" in
    api)
      if use_linux_api_shadow; then
        echo "$API_LINUX_RUN_DIR"
      else
        echo "$ROOT_DIR"
      fi
      ;;
    *)
      echo "$ROOT_DIR"
      ;;
  esac
}

is_pid_alive() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

port_in_use() {
  local port="$1"
  if [[ -z "$port" ]]; then
    return 1
  fi
  ss -ltn | grep -Eq ":${port}[[:space:]]"
}

infra_service_port() {
  case "$1" in
    postgres) echo "5433" ;;
    redis) echo "$REDIS_HOST_PORT" ;;
    *) echo "" ;;
  esac
}

start_infra_service() {
  local name="$1"
  local port
  port="$(infra_service_port "$name")"

  if [[ -n "$port" ]] && port_in_use "$port"; then
    echo "[skip] infra/$name ya esta disponible en el puerto $port"
    return 0
  fi

  echo "[start] infra/$name"
  docker compose -f "$COMPOSE_FILE" up -d "$name"
}

use_linux_api_shadow() {
  [[ "$ROOT_DIR" == /mnt/* ]] && [[ -d "$API_LINUX_RUN_DIR" ]]
}

sync_api_linux_shadow() {
  if ! use_linux_api_shadow; then
    return 0
  fi

  if [[ ! -d "$API_LINUX_RUN_DIR/node_modules" ]]; then
    echo "[warn] api shadow sin node_modules en $API_LINUX_RUN_DIR; se usara arranque normal"
    return 1
  fi

  echo "[build] api"
  (
    cd "$ROOT_DIR"
    pnpm -C apps/api build
  )

  echo "[sync] api -> $API_LINUX_RUN_DIR"
  mkdir -p "$API_LINUX_RUN_DIR"
  rsync -a --delete "$ROOT_DIR/apps/api/dist/" "$API_LINUX_RUN_DIR/dist/"
  rsync -a "$ROOT_DIR/apps/api/package.json" "$API_LINUX_RUN_DIR/package.json"
  rsync -a "$ROOT_DIR/apps/api/tsconfig.json" "$API_LINUX_RUN_DIR/tsconfig.json"
  rsync -a "$ROOT_DIR/apps/api/.env.example" "$API_LINUX_RUN_DIR/.env.example"
  if [[ -f "$ROOT_DIR/apps/api/.env" ]]; then
    rsync -a "$ROOT_DIR/apps/api/.env" "$API_LINUX_RUN_DIR/.env"
  fi
  rsync -a --delete "$ROOT_DIR/apps/api/prisma/" "$API_LINUX_RUN_DIR/prisma/"
  rsync -a --delete "$ROOT_DIR/apps/api/scripts/" "$API_LINUX_RUN_DIR/scripts/"
}

start_service() {
  local name="$1"
  local pid_file
  local log_file
  local port
  local cmd
  local workdir
  pid_file="$(service_pid_file "$name")"
  log_file="$(service_log_file "$name")"
  port="$(service_port "$name")"
  cmd="$(service_command "$name")"
  workdir="$(service_workdir "$name")"

  if [[ -f "$pid_file" ]]; then
    local existing_pid
    existing_pid="$(cat "$pid_file")"
    if [[ -n "$existing_pid" ]] && is_pid_alive "$existing_pid"; then
      echo "[skip] $name ya esta corriendo con PID $existing_pid"
      return 0
    fi
    rm -f "$pid_file"
  fi

  if [[ -n "$port" ]] && port_in_use "$port"; then
    echo "[skip] $name no se inicia porque el puerto $port ya esta ocupado"
    return 0
  fi

  if [[ "$name" == "api" ]]; then
    sync_api_linux_shadow || true
    cmd="$(service_command "$name")"
    workdir="$(service_workdir "$name")"
  fi

  echo "[start] $name"
  nohup bash -lc "cd \"$workdir\" && $cmd" >"$log_file" 2>&1 &
  echo "$!" >"$pid_file"
}

stop_service() {
  local name="$1"
  local pid_file
  pid_file="$(service_pid_file "$name")"

  if [[ ! -f "$pid_file" ]]; then
    echo "[skip] $name no tiene PID gestionado"
    return 0
  fi

  local pid
  pid="$(cat "$pid_file")"
  if [[ -n "$pid" ]] && is_pid_alive "$pid"; then
    echo "[stop] $name (PID $pid)"
    kill "$pid" 2>/dev/null || true
  else
    echo "[skip] $name ya estaba detenido"
  fi

  rm -f "$pid_file"
}

status_service() {
  local name="$1"
  local pid_file
  local port
  pid_file="$(service_pid_file "$name")"
  port="$(service_port "$name")"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && is_pid_alive "$pid"; then
      if [[ -n "$port" ]]; then
        echo "$name: RUNNING pid=$pid port=$port log=$(service_log_file "$name")"
      else
        echo "$name: RUNNING pid=$pid log=$(service_log_file "$name")"
      fi
      return 0
    fi
    echo "$name: STALE_PID pid=$pid"
    return 0
  fi

  if [[ -n "$port" ]] && port_in_use "$port"; then
    echo "$name: RUNNING_EXTERNALLY port=$port"
    return 0
  fi

  echo "$name: STOPPED"
}

case "${1:-up}" in
  up)
    start_infra_service postgres
    start_infra_service redis
    start_service api
    start_service web
    start_service web_v2
    start_service worker
    echo
    "$0" status
    ;;
  down)
    stop_service worker
    stop_service web_v2
    stop_service web
    stop_service api
    docker compose -f "$COMPOSE_FILE" stop redis postgres >/dev/null 2>&1 || true
    ;;
  status)
    echo "== Servicios app =="
    status_service api
    status_service web
    status_service web_v2
    status_service worker
    echo
    echo "== Infra =="
    docker compose -f "$COMPOSE_FILE" ps
    ;;
  *)
    echo "Uso: bash scripts/dev-stack.sh [up|down|status]" >&2
    exit 1
    ;;
esac
