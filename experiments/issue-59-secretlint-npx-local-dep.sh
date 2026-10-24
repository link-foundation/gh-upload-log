#!/usr/bin/env bash
# Reproduces the secretlint "rule module is not found" failure seen when the
# CI secrets scan runs after `bun install` in this repository (issue #59).
#
# Cause: @link-foundation/sensitive-data-sanitizer depends on
# @secretlint/secretlint-rule-preset-recommend@13.0.7, so the preset is in
# ./node_modules. `npm exec -p A -p B` installs only the packages missing
# from the local project into its npx cache folder, so the preset is not
# installed next to secretlint, and secretlint resolves rules relative to
# its own folder.
#
# Usage: bash experiments/issue-59-secretlint-npx-local-dep.sh
# Expected: "with node_modules" exits 2; "with node_modules and NODE_PATH"
# and "without node_modules" exit 0. NODE_PATH is the workaround secretlint's
# maintainers give in secretlint/secretlint#1624, where they declined to
# resolve rules from the linted project.
set -u
cd "$(dirname "$0")/.."
cache="$(mktemp -d)"
scan() {
  env npm_config_cache="$cache" ${2:+NODE_PATH="$2"} npx --yes -p secretlint@13.0.7 \
    -p @secretlint/secretlint-rule-preset-recommend@13.0.7 \
    secretlint "**/*" > "$cache/out.txt" 2>&1
  echo "$1 exit=$?"
  grep -m1 "is not found" "$cache/out.txt" || true
  rm -rf "$cache/_npx"
}
[ -d node_modules ] || bun install --frozen-lockfile > /dev/null
scan "with node_modules"
scan "with node_modules and NODE_PATH" "$PWD/node_modules"
mv node_modules "$cache/node_modules.aside"
scan "without node_modules"
mv "$cache/node_modules.aside" node_modules
rm -rf "$cache"
