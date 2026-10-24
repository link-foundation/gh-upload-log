## Summary

`scripts/use-module.mjs` fetches `https://unpkg.com/use-m/use.js` (**no version, no integrity check**) and `eval`s it. Eight scripts load it; `setup-npm.mjs`, `version-and-commit.mjs` and `publish-to-npm.mjs` run in the `release` and `instant-release` jobs (`release.yml` lines 541-544 and 688-691: `contents: write`, `id-token: write` for npm OIDC publishing) next to a persisted checkout credential. `use-m` then resolves `command-stream` and other packages at runtime, again without the lockfile.

So the code that pushes to `main` and publishes to npm is whatever unpkg serves for the `latest` tag of `use-m`, and of each package it loads, at the time of the run. A compromised or mistaken `use-m` publish, or an unpkg incident, runs arbitrary code with publish rights. It also makes releases non-reproducible: the same commit can behave differently on a re-run. #151 (one `use-m`/Node change broke every script at once) and #161 (a CDN blip kills release scripts) were both consequences of runtime fetching; their fixes kept the unpinned URL and the `eval`, so the supply-chain exposure remains.

## Reproduction

```sh
git clone --depth 1 https://github.com/link-foundation/js-ai-driven-development-pipeline-template t && cd t
grep -n "USE_M_URL =\|await eval" scripts/use-module.mjs
# 38:export const USE_M_URL = 'https://unpkg.com/use-m/use.js';
# 150:    const evaluated = await eval(source);
grep -l "use-module" scripts/*.mjs   # 8 scripts; setup-npm, version-and-commit and publish-to-npm run in the release jobs
```

## Workaround (applied in link-foundation/gh-upload-log#60)

Declare the helpers (`command-stream`, `lino-arguments`, ...) as dependencies, install with the lockfile (`npm ci` / `bun install --frozen-lockfile`) before the scripts run, and use static `import { $ } from 'command-stream'`. A test asserts that no script contains `unpkg.com/use-m`. Every command result is then checked explicitly, because `command-stream` resolves (does not throw) on a non-zero exit.

## Suggested fix

Either:

1. Use static imports resolved from the lockfile (preferred: integrity hashes, Dependabot/`npm audit` coverage, offline re-runs). Keep `bootstrap-dependencies.mjs` only for scripts that genuinely run before installation.
2. Or, if `use-m` must stay, pin it to an exact version URL (`https://unpkg.com/use-m@<x.y.z>/use.js`), verify a SHA-384 of the fetched source before `eval`, and pin every `use('pkg@x.y.z')` spec; add a test that rejects unpinned specs, like the `npx -p` pin check in `scripts/check-ci-workflows.mjs`.

---
Checked against template `0a62b80` (2026-10-10).
