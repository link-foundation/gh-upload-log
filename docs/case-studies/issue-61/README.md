# Issue 61: recovering a release after publication

Issue: https://github.com/link-foundation/gh-upload-log/issues/61

PR: https://github.com/link-foundation/gh-upload-log/pull/62

## Findings and reproduction

The issue had no comments or required sub-issues. PR 62 initially had no
conversation comments, inline comments or reviews. Both reported attempts of
run 40084678223 were downloaded into `ci-logs/` before implementation. Relevant
lines are preserved in [release-log-excerpts.txt](evidence/release-log-excerpts.txt).

- [Attempt 2](https://github.com/link-foundation/gh-upload-log/actions/runs/40084678223/attempts/2)
  verified `gh-upload-log@0.13.0` at 09:12:02 UTC and `gh-upload-file@0.13.0` at
  09:12:12 (lines 12090–12091). The install step exhausted six attempts after
  51 seconds (lines 12103–12115), reporting `ETARGET` despite publication.
  The exact-version endpoint and npm's installation metadata become visible
  independently. Install retries also reused npm's normal cache policy and
  retried permanent errors without classification.
- [Attempt 3](https://github.com/link-foundation/gh-upload-log/actions/runs/40084678223/attempts/3)
  began at the original source `3c55c2d`, merged two changesets (lines 1235 and
  1392), then discovered `origin/main` at `6a30745`, version 0.13.0 (lines 3012
  and 3338). Its rebase failed with unstaged changes (lines 3341–3354 and
  3448–3450). Changeset inspection happened before reconciliation, and the
  no-changesets recovery heuristic examined the stale checkout.

Four focused regressions failed before the fix: late install visibility,
permanent failure handling, deadline enforcement and workflow reconciliation
ordering. The [original output](evidence/reproduction-before.txt) contains six
passing tests and those four failures.

## Requirement inventory

| Issue requirement                                                           | Implementation                                                                                                                                                                   | Verification                                                                                                                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retry transient install misses within the publication visibility budget     | Shared 25-minute install deadline; command and sleep limits; finite attempts                                                                                                     | Fake-clock deadline/exhaustion tests; integration exhausts 25 minutes without real sleeps, then recovers after seven misses                                                     |
| Fresh metadata and underlying install errors                                | Isolated cache, `--prefer-online`, no package lock, npm fetch retries disabled; command errors and timeout diagnostics retained in normal logs                                   | Assertions on npm arguments; exact `ETARGET` and permanent error diagnostics; real tarball installation                                                                         |
| Do not retry permanent package/runtime failures indefinitely                | Allowlisted transient registry/network codes; permanent authentication/engine/integrity/lifecycle errors fail immediately; version/bin/import validation outside retry loop      | Permanent-code tests; existing wrong-version, broken-bin and broken-import regressions                                                                                          |
| Reconcile before merging or consuming changesets                            | Clean checkout preparation before installs or changeset inspection; merger inside versioning after remote synchronization                                                        | Workflow ordering assertions; real Git initial runs, dirty checkout rejection and same-version main advancement                                                                 |
| Recognize committed/published versions and resume without bump/conflict     | Original source SHA selects its first subsequent version commit, even if main has later changesets/versions; recovered runs skip bump; publisher skips existing package versions | Both release modes publish two names once; rerun uses detached original SHA, selects 1.1.0 while main is at 1.2.0, makes zero new publications and leaves remote main unchanged |
| Resume smoke checks and missing GitHub release                              | Publish/smoke/release gates accept recovery; no pull after target selection; release payload and notes use exact selected commit                                                 | Missing-artifact decision plus real packing, clean installation, three CLI help checks and import for each name; captured GitHub payload pins 1.1.0's commit/notes              |
| Handle historical workflow definitions                                      | `recover` dispatch takes the original full SHA and uses current workflow code; refuses to invent a version when no subsequent version commit exists                              | Dispatch/gate assertions and integration recovery-only success/refusal                                                                                                          |
| Meaningful integration covering publication, miss and original-run recovery | Reusable finite local-Git scenario in `experiments/issue-61-release-recovery.mjs`, registered in the normal Bun suite                                                            | Tests run on Linux, macOS and Windows in the existing release workflow                                                                                                          |
| Prepare next automatic release                                              | One patch changeset; no manual package version edits                                                                                                                             | Changeset validation and CI's release-versioning dry run                                                                                                                        |

## Design decisions and limits

GitHub reruns retain their original workflow definition. Runs started with the
updated workflow recover directly, including their original older source SHA.
For pre-fix runs, the current workflow also offers `release_mode=recover` and
`recovery_sha`, avoiding the old merge-before-rebase steps. Recovery requires a
committed descendant version and cannot perform a new bump.

Current release tools and their locked dependencies are preserved in a temporary
directory outside the artifact checkout. Otherwise selecting a pre-fix version
would restore the broken smoke tester and release creator. The integration
fixture has no historical release scripts and executes the preserved publisher,
smoke tester and GitHub release creator after installing their dependencies.

The selected version commit stays checked out through package preparation,
consumer checks and GitHub release creation. Pulling main at publication time
would substitute later source under an immutable version, so the release job
no longer pulls after target selection. Version push retries still rebase on a
concurrent non-fast-forward update and retain repository-rule diagnostics.

The integration fixture uses real local Git, the production changeset merger,
package preparation/publishing decisions, npm packing, clean npm installs,
Node CLI execution/imports and release creation code. Version transformation,
registry visibility and GitHub API writes are simulated. The original package
source is tiny and has no dependencies; this is a regression test of release
orchestration, not a live npm publication test. Every worker, npm/Git command
and native test has a finite deadline and Node workers use a 128 MiB heap.

The reported 0.13.0 artifacts and GitHub release were already complete when the
issue was filed. This change requires no owner bootstrap, republishes nothing,
and does not merge PR 62 or publish its next version during verification.

## Local verification

- `bun run test`: 336 tests pass across 39 files (109.47 seconds).
- `bun test test/issue-61-release-recovery.test.js`: both changeset and instant
  lifecycles pass with real consumer installations and separate locked tool
  dependencies (13.14 seconds in the final focused run).
- `bun run check`: lint with zero warnings, formatting, file-size and required
  documentation checks pass.
- `node scripts/check-ci-workflows.mjs` and the all-workflow status-gate coverage
  check pass.
- `node scripts/smoke-test-package.mjs --package-version 0.13.0`: live npm
  installation, all three bin help commands and library import pass for both
  published names.

## CI verification

All four workflows passed for implementation commit
`4003e97a9e6842a71aaf9bc38bce972c57fbaeef`, committed at 09:46:17 UTC on
2026-10-25. These runs began at 09:46:28 UTC, after that commit:

- [Checks and release](https://github.com/link-foundation/gh-upload-log/actions/runs/40182033601):
  Linux and macOS each passed 336 tests. Windows passed 333 tests with three
  existing Bash-specific skips and zero failures. Both new release lifecycle
  tests passed on every OS. Changeset validation, the versioning dry run,
  preflight, lint and the final status gate passed.
- [Workflows](https://github.com/link-foundation/gh-upload-log/actions/runs/40182033582):
  actionlint, ShellCheck, zizmor and status-gate coverage passed.
- [Security](https://github.com/link-foundation/gh-upload-log/actions/runs/40182033551):
  both CodeQL analyses, dependency review and both lockfile audits passed.
- [Broken Link Checker](https://github.com/link-foundation/gh-upload-log/actions/runs/40182033539):
  link checks and its status gate passed.

The [test log excerpts](evidence/ci-verification.txt) preserve test results and
both integration scenarios on each OS. Full downloaded logs remain in
`ci-logs/checks-release-40182033601.log`. The branch includes current main;
the complete PR diff was reviewed and all issue/PR feedback endpoints remained
empty. PR 62 is ready for review and remains unmerged.
