#!/usr/bin/env bash
# Stops PostgREST and the gateway started by start.sh (by recorded PID — never by pattern).
for n in postgrest gateway; do
  f="${LOCAL_STACK_LOG_DIR:-/tmp}/$n.pid"
  [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true
  rm -f "$f"
done
