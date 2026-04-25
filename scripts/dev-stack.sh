#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/storage/runtime/dev-stack"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"
STACK_ENV_FILE="$RUNTIME_DIR/stack.env"
API_LINUX_RUN_DIR="${API_LINUX_RUN_DIR:-$HOME/seguimiento-api-run-20260307}"
API_SHADOW_BUILD_TIMEOUT_SECONDS="${API_SHADOW_BUILD_TIMEOUT_SECONDS:-45}"
WORKER_BUILD_TIMEOUT_SECONDS="${WORKER_BUILD_TIMEOUT_SECONDS:-90}"
POSTGRES_HOST_PORT_INPUT="${POSTGRES_HOST_PORT:-}"
REDIS_HOST_PORT_INPUT="${REDIS_HOST_PORT:-}"
DATABASE_URL_INPUT="${DATABASE_URL:-}"
REDIS_URL_INPUT="${REDIS_URL:-}"
NODE_RUNTIME_READY=0

mkdir -p "$RUNTIME_DIR"

ensure_node_runtime() {
  local nvm_candidate
  local latest_node_dir

  if (( NODE_RUNTIME_READY == 1 )); then
    return 0
  fi

  if command -v node >/dev/null 2>&1 && command -v pnpm >/dev/null 2>&1; then
    NODE_RUNTIME_READY=1
    return 0
  fi

  nvm_candidate="${NVM_DIR:-$HOME/.nvm}"
  if [[ -f "$nvm_candidate/nvm.sh" ]]; then
    export NVM_DIR="$nvm_candidate"
    # `wsl.exe bash -lc` does not always load the profile that initializes nvm.
    # Load it here so builds and tmux sessions can resolve the Linux node binary.
    # shellcheck disable=SC1090
    source "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
    nvm use --silent default >/dev/null 2>&1 || true
  fi

  if ! command -v node >/dev/null 2>&1; then
    latest_node_dir="$(
      find "$nvm_candidate/versions/node" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
        | sort -V \
        | tail -n 1
    )"
    if [[ -n "$latest_node_dir" ]] && [[ -d "$latest_node_dir/bin" ]]; then
      export PATH="$latest_node_dir/bin:$PATH"
    fi
  fi

  if command -v node >/dev/null 2>&1 && command -v pnpm >/dev/null 2>&1; then
    NODE_RUNTIME_READY=1
    return 0
  fi

  echo "[error] No se encontro una instalacion Linux de node/pnpm en WSL. Revisa ~/.nvm o instala Node dentro de WSL." >&2
  return 1
}

wrap_command_for_shell() {
  local user_cmd="$1"
  local wrapped_cmd=""

  printf -v wrapped_cmd 'export PATH=%q; ' "$PATH"
  if [[ -n "${NVM_DIR:-}" ]]; then
    printf -v wrapped_cmd '%sexport NVM_DIR=%q; ' "$wrapped_cmd" "$NVM_DIR"
    if [[ -f "$NVM_DIR/nvm.sh" ]]; then
      printf -v wrapped_cmd '%ssource %q >/dev/null 2>&1 || true; nvm use --silent default >/dev/null 2>&1 || true; ' "$wrapped_cmd" "$NVM_DIR/nvm.sh"
    fi
  fi

  printf '%s%s' "$wrapped_cmd" "$user_cmd"
}

load_runtime_stack_env() {
  local line
  local key
  local value

  [[ -f "$STACK_ENV_FILE" ]] || return 0

  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    [[ "$line" == \#* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"

    case "$key" in
      POSTGRES_HOST_PORT)
        [[ -n "$POSTGRES_HOST_PORT_INPUT" ]] || POSTGRES_HOST_PORT="$value"
        ;;
      REDIS_HOST_PORT)
        [[ -n "$REDIS_HOST_PORT_INPUT" ]] || REDIS_HOST_PORT="$value"
        ;;
    esac
  done < "$STACK_ENV_FILE"
}

persist_runtime_stack_env() {
  cat >"$STACK_ENV_FILE" <<EOF
POSTGRES_HOST_PORT=$POSTGRES_HOST_PORT
REDIS_HOST_PORT=$REDIS_HOST_PORT
EOF
}

is_wsl() {
  [[ -n "${WSL_DISTRO_NAME:-}" ]] || grep -qi microsoft /proc/version 2>/dev/null
}

host_port_accepts_connections() {
  local port="$1"
  timeout 1 bash -lc "</dev/tcp/127.0.0.1/$port" >/dev/null 2>&1
}

windows_host_port_bindable() {
  local port="$1"
  local output

  if ! command -v powershell.exe >/dev/null 2>&1; then
    return 0
  fi

  output="$(
    powershell.exe -NoProfile -Command "\$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port); try { \$listener.Start(); 'FREE' } catch { 'BUSY' } finally { if (\$listener) { \$listener.Stop() } }" \
      2>/dev/null | tr -d '\r'
  )"
  [[ "$output" == *FREE* ]]
}

host_port_bindable() {
  local port="$1"

  if port_in_use "$port"; then
    return 1
  fi

  if is_wsl; then
    windows_host_port_bindable "$port"
    return $?
  fi

  return 0
}

resolve_host_port() {
  local label="$1"
  shift

  local preferred="$1"
  shift

  local candidate

  for candidate in "$preferred" "$@"; do
    if host_port_accepts_connections "$candidate"; then
      echo "$candidate"
      return 0
    fi

    if host_port_bindable "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done

  echo "$preferred"
  echo "[warn] $label no encontro un puerto host disponible; se intentara con $preferred" >&2
  return 1
}

configure_runtime_ports() {
  local original_postgres_port="$POSTGRES_HOST_PORT"
  local original_redis_port="$REDIS_HOST_PORT"

  # If compose service is already running, keep the current port (avoids port churn under Docker Desktop + WSL2)
  if [[ -z "$POSTGRES_HOST_PORT_INPUT" ]]; then
    if ! POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" REDIS_HOST_PORT="$REDIS_HOST_PORT" docker compose -f "$COMPOSE_FILE" ps --services --status running 2>/dev/null | grep -Fxq "postgres"; then
      POSTGRES_HOST_PORT="$(resolve_host_port "infra/postgres" "$POSTGRES_HOST_PORT" 15433 25433 35433)" || true
    fi
  fi

  if [[ -z "$REDIS_HOST_PORT_INPUT" ]]; then
    if ! POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" REDIS_HOST_PORT="$REDIS_HOST_PORT" docker compose -f "$COMPOSE_FILE" ps --services --status running 2>/dev/null | grep -Fxq "redis"; then
      REDIS_HOST_PORT="$(resolve_host_port "infra/redis" "$REDIS_HOST_PORT" 26380 36380 46380)" || true
    fi
  fi

  if [[ "$POSTGRES_HOST_PORT" != "$original_postgres_port" ]]; then
    echo "[info] infra/postgres usara el puerto host $POSTGRES_HOST_PORT; $original_postgres_port no esta disponible"
  fi

  if [[ "$REDIS_HOST_PORT" != "$original_redis_port" ]]; then
    echo "[info] infra/redis usara el puerto host $REDIS_HOST_PORT; $original_redis_port no esta disponible"
  fi

  persist_runtime_stack_env
}

runtime_database_url() {
  if [[ -n "$DATABASE_URL_INPUT" ]]; then
    echo "$DATABASE_URL_INPUT"
    return 0
  fi

  echo "postgresql://seguimiento:seguimiento@127.0.0.1:${POSTGRES_HOST_PORT}/seguimiento?schema=public"
}

runtime_redis_url() {
  if [[ -n "$REDIS_URL_INPUT" ]]; then
    echo "$REDIS_URL_INPUT"
    return 0
  fi

  echo "redis://127.0.0.1:${REDIS_HOST_PORT}"
}

ensure_node_runtime

load_runtime_stack_env
POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT_INPUT:-${POSTGRES_HOST_PORT:-5433}}"
REDIS_HOST_PORT="${REDIS_HOST_PORT_INPUT:-${REDIS_HOST_PORT:-16380}}"

service_log_file() {
  printf '%s/%s.log\n' "$RUNTIME_DIR" "$1"
}

service_pid_file() {
  printf '%s/%s.pid\n' "$RUNTIME_DIR" "$1"
}

service_session_name() {
  printf 'seguimiento_%s\n' "$1"
}

service_port() {
  case "$1" in
    api) echo "3001" ;;
    web) echo "3000" ;;
    worker) echo "" ;;
    *) echo "" ;;
  esac
}

service_command() {
  case "$1" in
    api)
      if use_linux_api_shadow; then
        echo "DATABASE_URL=$(runtime_database_url) REDIS_URL=$(runtime_redis_url) pnpm start"
      else
        echo "DATABASE_URL=$(runtime_database_url) REDIS_URL=$(runtime_redis_url) pnpm -C apps/api dev"
      fi
      ;;
    web) echo "pnpm -C web-v2 dev" ;;
    worker) echo "DATABASE_URL=$(runtime_database_url) REDIS_URL=$(runtime_redis_url) node --enable-source-maps $(worker_dist_entry_rel)" ;;
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

service_start_timeout_seconds() {
  case "$1" in
    web) echo "120" ;;
    api) echo "30" ;;
    worker) echo "20" ;;
    *) echo "20" ;;
  esac
}

worker_dist_entry_rel() {
  if [[ -f "$ROOT_DIR/apps/worker/dist/src/main.js" ]]; then
    echo "apps/worker/dist/src/main.js"
    return 0
  fi

  if [[ -f "$ROOT_DIR/apps/worker/dist/apps/worker/src/main.js" ]]; then
    echo "apps/worker/dist/apps/worker/src/main.js"
    return 0
  fi

  echo "apps/worker/dist/src/main.js"
}

port_in_use() {
  local port="$1"
  if [[ -z "$port" ]]; then
    return 1
  fi
  ss -ltn | grep -Eq ":${port}[[:space:]]"
}

tmux_session_exists() {
  local session="$1"
  tmux has-session -t "$session" 2>/dev/null
}

is_pid_alive() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

cleanup_legacy_pid_file() {
  local name="$1"
  local pid_file
  pid_file="$(service_pid_file "$name")"

  if [[ ! -f "$pid_file" ]]; then
    return 0
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && is_pid_alive "$pid"; then
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

wait_for_service_start() {
  local name="$1"
  local session
  local port
  local attempt
  local max_attempts
  session="$(service_session_name "$name")"
  port="$(service_port "$name")"
  max_attempts="$(service_start_timeout_seconds "$name")"

  for attempt in $(seq 1 "$max_attempts"); do
    if ! tmux_session_exists "$session"; then
      return 1
    fi

    if [[ -z "$port" ]] || port_in_use "$port"; then
      return 0
    fi

    sleep 1
  done

  return 1
}

infra_service_port() {
  case "$1" in
    postgres) echo "$POSTGRES_HOST_PORT" ;;
    redis) echo "$REDIS_HOST_PORT" ;;
    *) echo "" ;;
  esac
}

infra_service_compose_name() {
  case "$1" in
    postgres) echo "postgres" ;;
    redis) echo "redis" ;;
    *) echo "" ;;
  esac
}

infra_service_external_container_name() {
  case "$1" in
    redis) echo "seguimiento-redis-temp" ;;
    *) echo "" ;;
  esac
}

start_infra_service() {
  local name="$1"
  local port
  local compose_name
  port="$(infra_service_port "$name")"
  compose_name="$(infra_service_compose_name "$name")"

  # Check by docker container status (reliable across Docker Desktop + WSL2)
  if [[ -n "$compose_name" ]] && POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" REDIS_HOST_PORT="$REDIS_HOST_PORT" docker compose -f "$COMPOSE_FILE" ps --services --status running 2>/dev/null | grep -Fxq "$compose_name"; then
    echo "[skip] infra/$name ya esta corriendo (compose)"
    return 0
  fi

  if [[ -n "$port" ]] && (port_in_use "$port" || host_port_accepts_connections "$port"); then
    echo "[skip] infra/$name ya esta disponible en el puerto $port"
    return 0
  fi

  echo "[start] infra/$name"
  POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" REDIS_HOST_PORT="$REDIS_HOST_PORT" docker compose -f "$COMPOSE_FILE" up -d "$name"
}

stop_infra_service() {
  local name="$1"
  local compose_name
  local external_name
  compose_name="$(infra_service_compose_name "$name")"
  external_name="$(infra_service_external_container_name "$name")"

  if [[ -n "$compose_name" ]]; then
    POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" REDIS_HOST_PORT="$REDIS_HOST_PORT" docker compose -f "$COMPOSE_FILE" stop "$compose_name" >/dev/null 2>&1 || true
  fi

  if [[ -n "$external_name" ]] && docker ps --format '{{.Names}}' | grep -Fxq "$external_name"; then
    echo "[stop] infra/$name externo ($external_name)"
    docker stop "$external_name" >/dev/null 2>&1 || true
  fi
}

status_infra_service() {
  local name="$1"
  local port
  local compose_name
  local external_name
  port="$(infra_service_port "$name")"
  compose_name="$(infra_service_compose_name "$name")"
  external_name="$(infra_service_external_container_name "$name")"

  if [[ -n "$compose_name" ]] && POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" REDIS_HOST_PORT="$REDIS_HOST_PORT" docker compose -f "$COMPOSE_FILE" ps --services --status running 2>/dev/null | grep -Fxq "$compose_name"; then
    echo "infra/$name: RUNNING compose port=$port"
    return 0
  fi

  if [[ -n "$external_name" ]] && docker ps --format '{{.Names}}' | grep -Fxq "$external_name"; then
    echo "infra/$name: RUNNING external=$external_name port=$port"
    return 0
  fi

  if [[ -n "$port" ]] && (port_in_use "$port" || host_port_accepts_connections "$port"); then
    echo "infra/$name: RUNNING_EXTERNALLY port=$port"
    return 0
  fi

  echo "infra/$name: STOPPED"
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
  if ! (
    cd "$ROOT_DIR"
    if [[ "$API_SHADOW_BUILD_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] && (( API_SHADOW_BUILD_TIMEOUT_SECONDS > 0 )); then
      timeout "${API_SHADOW_BUILD_TIMEOUT_SECONDS}"s pnpm -C apps/api build
    else
      pnpm -C apps/api build
    fi
  ); then
    echo "[warn] build de api fallo o excedio ${API_SHADOW_BUILD_TIMEOUT_SECONDS}s; se reutiliza el ultimo dist sincronizado en $API_LINUX_RUN_DIR"
    return 0
  fi

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

build_worker_runtime() {
  echo "[build] worker"
  if ! (
    cd "$ROOT_DIR"
    if [[ "$WORKER_BUILD_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] && (( WORKER_BUILD_TIMEOUT_SECONDS > 0 )); then
      timeout "${WORKER_BUILD_TIMEOUT_SECONDS}"s pnpm -C apps/worker build
    else
      pnpm -C apps/worker build
    fi
  ); then
    echo "[warn] build de worker fallo o excedio ${WORKER_BUILD_TIMEOUT_SECONDS}s; se intentara reutilizar el ultimo dist local"
  fi

  [[ -f "$ROOT_DIR/$(worker_dist_entry_rel)" ]]
}

start_service() {
  local name="$1"
  local session
  local log_file
  local port
  local cmd
  local wrapped_cmd
  local launch_cmd
  local workdir
  session="$(service_session_name "$name")"
  log_file="$(service_log_file "$name")"
  port="$(service_port "$name")"
  cmd="$(service_command "$name")"
  workdir="$(service_workdir "$name")"

  cleanup_legacy_pid_file "$name"

  if tmux_session_exists "$session"; then
    echo "[skip] $name ya esta corriendo en tmux/$session"
    return 0
  fi

  if [[ -n "$port" ]] && port_in_use "$port"; then
    echo "[skip] $name no se inicia porque el puerto $port ya esta ocupado"
    return 0
  fi

  if [[ "$name" == "api" ]]; then
    sync_api_linux_shadow || true
    cmd="$(service_command "$name")"
    workdir="$(service_workdir "$name")"
  elif [[ "$name" == "worker" ]]; then
    if ! build_worker_runtime; then
      echo "[warn] worker sin dist utilizable; se omite arranque"
      return 0
    fi
    cmd="$(service_command "$name")"
  fi

  echo "[start] $name"
  : >"$log_file"
  wrapped_cmd="$(wrap_command_for_shell "$cmd")"
  printf -v launch_cmd 'bash -lc %q' "$wrapped_cmd"
  tmux new-session -d -s "$session" -c "$workdir" "$launch_cmd"
  if tmux_session_exists "$session"; then
    tmux pipe-pane -o -t "$session" "cat >> \"$log_file\"" || true
  fi

  if wait_for_service_start "$name"; then
    local pane_pid
    pane_pid="$(tmux display-message -p -t "$session" '#{pane_pid}')"
    if [[ -n "$pane_pid" ]]; then
      echo "$pane_pid" >"$(service_pid_file "$name")"
    fi
    return 0
  fi

  echo "[warn] $name no confirmo arranque estable; revisa $log_file"
  if tmux_session_exists "$session"; then
    tmux capture-pane -pt "$session" -S -40 >>"$log_file" 2>/dev/null || true
  fi
}

stop_service() {
  local name="$1"
  local session
  session="$(service_session_name "$name")"

  if tmux_session_exists "$session"; then
    echo "[stop] $name (tmux/$session)"
    tmux kill-session -t "$session"
  else
    echo "[skip] $name no tiene sesion tmux activa"
  fi

  cleanup_legacy_pid_file "$name"
}

status_service() {
  local name="$1"
  local session
  local port
  local pane_pid
  session="$(service_session_name "$name")"
  port="$(service_port "$name")"

  if tmux_session_exists "$session"; then
    pane_pid="$(tmux display-message -p -t "$session" '#{pane_pid}')"
    if [[ -n "$pane_pid" ]]; then
      echo "$pane_pid" >"$(service_pid_file "$name")"
    fi
    if [[ -n "$port" ]]; then
      echo "$name: RUNNING tmux=$session pid=${pane_pid:-unknown} port=$port log=$(service_log_file "$name")"
    else
      echo "$name: RUNNING tmux=$session pid=${pane_pid:-unknown} log=$(service_log_file "$name")"
    fi
    return 0
  fi

  rm -f "$(service_pid_file "$name")"

  if [[ -n "$port" ]] && port_in_use "$port"; then
    echo "$name: RUNNING_EXTERNALLY port=$port"
    return 0
  fi

  echo "$name: STOPPED"
}

case "${1:-up}" in
  up)
    configure_runtime_ports
    start_infra_service postgres
    start_infra_service redis
    start_service api
    start_service web
    start_service worker
    echo
    "$0" status
    ;;
  down)
    stop_service worker
    stop_service web
    stop_service api
    stop_infra_service redis
    stop_infra_service postgres
    ;;
  status)
    echo "== Servicios app =="
    status_service api
    status_service web
    status_service worker
    echo
    echo "== Infra =="
    status_infra_service postgres
    status_infra_service redis
    echo
    echo "== Docker compose =="
    POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" REDIS_HOST_PORT="$REDIS_HOST_PORT" docker compose -f "$COMPOSE_FILE" ps
    ;;
  *)
    echo "Uso: bash scripts/dev-stack.sh [up|down|status]" >&2
    exit 1
    ;;
esac
