#!/usr/bin/env bash
# Shows why the 30s per-test timeout lives in the package "test" script and
# not in bunfig.toml (issue #59): Bun 1.4.3 ignores `[test] timeout`, so a
# 6s test still fails at the 5000ms default; only the CLI flag raises it.
#
# Usage: bash experiments/issue-59-bunfig-test-timeout.sh
# Expected: "bunfig" fails after 5000ms, "--timeout 30000" passes.
set -u
dir="$(mktemp -d)"
cd "$dir" || exit 1
cat > slow.test.js <<'JS'
import { test } from 'bun:test';
test('slow', async () => {
  await new Promise((resolve) => setTimeout(resolve, 6000));
});
JS
printf '[test]\ntimeout = 30000\n' > bunfig.toml
echo "bunfig:"; bun test 2>&1 | grep -E 'timed out|^ [0-9]+ (pass|fail)'
rm bunfig.toml
echo "--timeout 30000:"; bun test --timeout 30000 2>&1 | grep -E 'timed out|^ [0-9]+ (pass|fail)'
cd / && rm -rf "$dir"
