#!/usr/bin/env bash
# Reproduce what windows-2025 runners do (core.autocrlf=true): without a
# .gitattributes rule, shell scripts and the husky hook are checked out with
# CRLF, and sh then fails on the carriage returns.
#
# Usage: bash experiments/issue-59-crlf-shell-checkout.sh [repository-path]
set -euo pipefail

repository="$(cd "${1:-.}" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git -c core.autocrlf=true clone -q "$repository" "$work/clone"
cd "$work/clone"
git ls-files --eol -- '*.sh' '.husky/*'
printf 'first line of scripts/read-job-cancel-in-progress.sh: '
head -n 1 scripts/read-job-cancel-in-progress.sh | od -c | head -n 1
for script in scripts/read-job-cancel-in-progress.sh .husky/pre-commit; do
  if [ "$(head -c 2 "$script")" = '#!' ] && head -n 1 "$script" | grep -q $'\r$'; then
    echo "$script: shebang line ends in CR, so env looks for an interpreter named with a trailing CR"
  else
    echo "$script: LF shebang"
  fi
done
if WORKFLOW_FILE=/dev/null bash scripts/read-job-cancel-in-progress.sh >"$work/out" 2>"$work/err"; then
  echo 'bash scripts/read-job-cancel-in-progress.sh: OK'
else
  echo "bash scripts/read-job-cancel-in-progress.sh: FAILED: $(head -n 1 "$work/err")"
fi
