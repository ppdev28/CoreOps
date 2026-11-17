#!/usr/bin/env bash
# Start the development stack without tying its lifetime to the SSH connection.
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
session=coreops
detach=false
case "${1:-}" in
    --detach) detach=true ;;
    -h|--help)
        echo "Uso: $0 [--detach]"
        echo "Arranca backend y frontend en tmux (sesión coreops)."
        echo "Sin --detach, conecta a la sesión si hay una terminal interactiva."
        exit 0 ;;
    "") ;;
    *) echo "Opción desconocida: $1" >&2; exit 1 ;;
esac
[[ $# -le 1 ]] || { echo "Demasiados argumentos." >&2; exit 1; }

for dependency in tmux go pnpm curl ss; do
    command -v "$dependency" >/dev/null || {
        echo "Falta la dependencia: $dependency" >&2
        exit 1
    }
done

if tmux has-session -t "=$session" 2>/dev/null; then
    owner=$(tmux show-options -qv -t "$session" @coreops-root)
    [[ "$owner" == "$root" ]] || {
        echo "La sesión coreops ya existe y no pertenece a este script/checkout." >&2
        echo "Revísala con: tmux attach -t coreops" >&2
        exit 1
    }
    echo "Reutilizando la sesión coreops; los procesos no se reinician."
else
    [[ -x "$root/frontend/node_modules/.bin/vite" ]] || {
        echo "Instala las dependencias primero: cd '$root/frontend' && pnpm install --frozen-lockfile" >&2
        exit 1
    }
    # Vite's existing /api proxy targets localhost:8082.
    [[ "${COREOPS_PORT:-${CoreOps_PORT:-8082}}" == 8082 ]] || {
        echo "Este launcher requiere COREOPS_PORT=8082, como el proxy Vite." >&2
        exit 1
    }
    for port in 8082 5173; do
        if [[ -n "$(ss -H -ltn "sport = :$port")" ]]; then
            echo "El puerto $port ya está ocupado. No se detendrá ningún proceso." >&2
            exit 1
        fi
    done

    export COREOPS_DATA_DIR="${COREOPS_DATA_DIR:-${CoreOps_DATA_DIR:-$root/backend/data}}"
    if [[ "$COREOPS_DATA_DIR" != /* ]]; then
        export COREOPS_DATA_DIR="$root/backend/$COREOPS_DATA_DIR"
    fi
    export COREOPS_HOST="${COREOPS_HOST:-${CoreOps_HOST:-127.0.0.1}}"
    export COREOPS_PORT=8082

    # Private files transfer the caller's environment even to an existing tmux
    # server. Secrets never appear in pane commands or tmux command arguments.
    umask 077
    runtime=$(mktemp -d /tmp/coreops-dev.XXXXXXXX)
    cleanup() {
        rm -f -- "$runtime/backend.env" "$runtime/frontend.env"
        if ! tmux has-session -t "=$session" 2>/dev/null; then
            rm -rf -- "$runtime"
        fi
    }
    trap cleanup EXIT
    echo "Compilando la API…"
    (cd "$root/backend" && go build -o "$runtime/coreops-api" ./cmd/coreops-api)
    export -p > "$runtime/backend.env"
    cp -- "$runtime/backend.env" "$runtime/frontend.env"

    # Optional local observability defaults, only for the backend. Explicit
    # caller settings win; parse generated KEY=value data without executing it.
    if [[ -f "$root/deploy/observability/generated/coreops.env" ]]; then
        while IFS='=' read -r obs_key obs_value; do
            case "$obs_key" in
                COREOPS_METRICS_TOKEN_FILE|COREOPS_PROMETHEUS_URL|COREOPS_GRAFANA_URL|COREOPS_GRAFANA_PUBLIC_URL|COREOPS_PROMETHEUS_NODE_JOB|COREOPS_PROMETHEUS_API_JOB)
                    if [[ "$obs_key" == COREOPS_METRICS_TOKEN_FILE && -v COREOPS_METRICS_TOKEN ]]; then
                        continue
                    fi
                    if [[ ! -v "$obs_key" ]]; then
                        printf 'export %s=%q\n' "$obs_key" "$obs_value" >> "$runtime/backend.env"
                    fi
                    ;;
            esac
        done < "$root/deploy/observability/generated/coreops.env"
    fi

    backend=$(tmux new-session -d -s "$session" -n dev -x 180 -y 45 \
        -c "$root/backend" -P -F '#{pane_id}' /bin/bash --noprofile --norc)
    tmux set-option -t "$session" @coreops-root "$root"
    tmux set-option -t "$session" @coreops-runtime "$runtime"
    tmux set-option -t "$session" remain-on-exit on
    tmux set-option -t "$session" pane-border-status top
    tmux set-option -t "$session" pane-border-format ' #{pane_title} '
    frontend=$(tmux split-window -h -t "$backend" -c "$root/frontend" \
        -P -F '#{pane_id}' /bin/bash --noprofile --norc)
    tmux select-pane -t "$backend" -T Backend
    tmux select-pane -t "$frontend" -T Frontend

    printf -v backend_command 'source %q && rm -f -- %q && cd -- %q && exec %q' \
        "$runtime/backend.env" "$runtime/backend.env" "$root/backend" "$runtime/coreops-api"
    printf -v frontend_command 'source %q && rm -f -- %q && cd -- %q && exec %q dev --host 0.0.0.0 --port 5173 --strictPort' \
        "$runtime/frontend.env" "$runtime/frontend.env" "$root/frontend" "$(command -v pnpm)"
    tmux send-keys -t "$backend" -l "$backend_command"
    tmux send-keys -t "$backend" Enter
    tmux send-keys -t "$frontend" -l "$frontend_command"
    tmux send-keys -t "$frontend" Enter
fi

ready=false
for ((attempt = 0; attempt < 30; attempt++)); do
    if curl --noproxy '*' -fsS --max-time 1 http://localhost:5173/ >/dev/null 2>&1 \
        && curl --noproxy '*' -fsS --max-time 1 http://localhost:5173/api/v1/health >/dev/null 2>&1; then
        ready=true
        break
    fi
    sleep 1
done
if [[ "$ready" != true ]]; then
    echo "La aplicación no responde. Se conservan los paneles para revisar el error:" >&2
    echo "tmux attach -t coreops" >&2
    exit 1
fi

echo "CoreOps disponible: http://localhost:5173 (también por la IP LAN/Tailscale)."
echo "Terminales: tmux attach -t coreops"
echo "Desconectar sin parar: Ctrl+B, después D."
if [[ "$detach" == false && -t 0 && -t 1 ]]; then
    if [[ -n "${TMUX:-}" ]]; then
        tmux switch-client -t "=$session"
    else
        tmux attach-session -t "=$session"
    fi
fi
