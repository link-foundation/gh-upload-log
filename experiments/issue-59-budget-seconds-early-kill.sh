#!/usr/bin/env bash
# Reproduces template issue #252 in this repository's copy of
# scripts/run-with-budget-warning.sh: bash's SECONDS counts wall-clock second
# boundaries, so `[ "$SECONDS" -ge N ]` can fire after only N-1+e seconds.
# Starting 0.75s into a wall-clock second, a 1.4s command under a 2s budget
# was killed with exit 124 before the fix.
#
# Usage: bash experiments/issue-59-budget-seconds-early-kill.sh [runs]
# Expected after the fix: every run prints exit=0.
set -u
cd "$(dirname "$0")/.." || exit 1
runs="${1:-3}"
for _ in $(seq "${runs}"); do
  while :; do
    ms=$(date +%3N)
    ms=$((10#${ms}))
    [ "${ms}" -ge 750 ] && [ "${ms}" -lt 780 ] && break
  done
  BUDGET_POLL_SECONDS=0.1 BUDGET_GRACE_SECONDS=1 \
    bash scripts/run-with-budget-warning.sh 2 "aligned step" sleep 1.4 > /dev/null 2>&1
  echo "exit=$?"
done
