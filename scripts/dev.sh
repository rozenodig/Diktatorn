#!/usr/bin/env bash
# Starts the unpackaged app through LaunchServices instead of as a child of the terminal.
# macOS attributes privacy permissions (Microphone, Input Monitoring, Accessibility) to the
# app that launched a process, so this makes them apply to build/Diktatorn.app only rather
# than to the terminal and everything run in it. Logs are streamed from dist/dev.log.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/build/Diktatorn.app"
LOG="$ROOT/dist/dev.log"

"$ROOT/scripts/dev-bundle.sh"
: >"$LOG"
tail -f "$LOG" &
TAIL_PID=$!
trap 'kill "$TAIL_PID" 2>/dev/null' EXIT

ENV_ARGS=()
[ -n "${DIKTATORN_HELPER_DEBUG:-}" ] && ENV_ARGS+=(--env "DIKTATORN_HELPER_DEBUG=$DIKTATORN_HELPER_DEBUG")
open -n -W -a "$APP" --stdout "$LOG" --stderr "$LOG" ${ENV_ARGS[@]+"${ENV_ARGS[@]}"} --args "$ROOT"
