# Issue #49: slow Windows Git tests block releases

[Issue #49](https://github.com/link-foundation/gh-upload-log/issues/49) reports
a Windows test timeout after merging PR #48. The release workflow waits for
the entire three-platform test matrix, so this failure blocked publication
until the unchanged job was rerun.

## Evidence and root cause

The first attempt of [run 37736901182](https://github.com/link-foundation/gh-upload-log/actions/runs/37736901182/attempts/1)
tested merge commit `0667daee332ad0d1bcac3cf6ec346f5779dfae89`, starting at
2026-10-08 06:18:41 UTC. The original Windows job was `113178393692`.
Downloading logs with `gh run view --attempt 1 --log-failed` preserves the
failure that is hidden by the successful rerun:

- Lines 270–272: neighboring real-Git scenarios took 4605.53 ms, 4930.75 ms,
  and 3821.97 ms.
- Line 285: `error: spawnSync node ETIMEDOUT`.
- Lines 290–291: mixed-chunk resumption failed after 5006.17 ms, with Bun
  reporting its 5000 ms default timeout.
- Lines 297–298: the two issue #47 real-Git tests also took about three seconds.

There were two equal deadlines: a 5000 ms Node worker `spawnSync` timeout
and Bun's implicit 5000 ms test timeout. Git commands inside the worker had
no timeout. This could both reject healthy slow runners and hide the command
responsible for a hang.

The locked `test-anywhere@0.8.49` implementation accepts only `(name, fn)`
and calls the native test runner with those two arguments. Adding a numeric
third argument to its `test()` calls would silently retain Bun's default.
The shared test helper therefore uses Bun's native per-test timeout API, or
Node's native `{ timeout }` option when run under Node.

PR #50's placeholder run `37764693617`, created at 10:37:29 UTC for commit
`41b014388a07807d8c96edd24be1f49a156ed631`, failed independently because it
had no changeset (downloaded log line 238). This fix includes one patch
changeset, as required by the release workflow.

## Fix and audit

`experiments/real-git-test-utils.mjs` defines three finite limits:

| Operation                          | Timeout |
| ---------------------------------- | ------- |
| Individual synchronous Git command | 10 s    |
| Isolated Node Git scenario         | 45 s    |
| Native real-Git test               | 60 s    |

The shorter inner deadlines allow failures to report diagnostics before
the outer test expires. Command timeouts include the Git arguments,
captured stdout/stderr and original error cause. Worker failures include
the scenario identifier and captured command diagnostics.

All four issue #45 scenarios and both issue #47 real-Git tests use the shared
test timeout. Their shared local bare-repository fixture bounds both setup
commands and upload commands. The two-command Git-init test in
`test/path-handling.test.js` also gets the explicit test timeout.
Mock-only tests retain their existing default. No production upload or
retry behavior changes.

## Reproduction and regression coverage

`experiments/issue-49-slow-git.mjs` is an opt-in Node preload that delays the
first Git startup by a finite 5500 ms. It uses tiny logs and local bare
repositories; no GitHub upload or network access is needed.

`test/issue-49.test.js` runs the exact mixed-chunk test in a child Bun runner
with this preload. Before the fix, it fails with both the original
`spawnSync node ETIMEDOUT` and Bun's 5000 ms timeout. The saved output is
[evidence/reproduction-before.txt](evidence/reproduction-before.txt).
After the fix, the same delayed test completes successfully.

Three quick mocked regressions verify named Git timeout diagnostics,
the worker/test deadline ordering, and preservation of failed-worker output.
The regression runner itself has a 70 s subprocess limit below its 75 s
native test limit.

```sh
bun test test/issue-49.test.js
bun test
bun run check
```

Local validation: **158 tests pass**, including the delayed Git regression.
ESLint, Prettier, file-size checks and CI-style changeset validation pass.
The PR test matrix checks the same regression on Ubuntu, macOS and Windows.
