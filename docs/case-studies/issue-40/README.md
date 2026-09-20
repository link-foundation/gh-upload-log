# Issue #40: relative paths were fixed but never published

Issue: [link-foundation/gh-upload-log#40](https://github.com/link-foundation/gh-upload-log/issues/40)

## Report

On 2026-09-20, a user running `gh-upload-log hive-telegram-bot.log` and
`gh-upload-log ./hive-telegram-bot.log` saw repository-mode uploads fail with
`ENOENT` after git changed the process working directory. The absolute
`~/hive-telegram-bot.log` spelling reached an existing upload. The same install
reported version `0.1.0`.

Those symptoms are the exact behavior fixed by #36 and released in the GitHub
repository as `v0.8.3` on 2026-08-21. The report therefore exposed a delivery
failure rather than a second path-resolution defect.

## Reproduction and evidence

The npm registry still served the unfixed version when the issue was filed:

```text
$ npm view gh-upload-log version
0.8.2
```

GitHub contained two newer releases, but neither existed on npm:

```text
v0.8.3  2026-08-21  relative-path fix from #36
v0.9.0  2026-08-22  content-addressed uploads from #39
```

The published `0.8.2` source still used `cd <workDir> && ...`, which lets
command-stream's `cd` builtin change the host process working directory before
the relative source file is copied. Current source resolves the input to an
absolute path and binds commands with the `cwd` option; its existing regression
tests accept bare, `./`, `../`, `~/`, and absolute forms.

The archived release logs explain why the fix did not reach npm:

- [release run 32512441957](https://github.com/link-foundation/gh-upload-log/actions/runs/32512441957)
  tried to release `0.8.3`. Lines 3841-3846 show `npm@12.0.2` rejecting
  Node 20 with `EBADENGINE`. Lines 3948-3970 show npm publishing fail with
  `E404`, followed by the script printing `Published gh-upload-log@0.8.3`.
- [release run 32588725260](https://github.com/link-foundation/gh-upload-log/actions/runs/32588725260)
  repeated the same false-success sequence for `0.9.0`.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) requires
  npm 11.5.1 or later and Node 22.14 or later. The workflow used Node 20 and its
  npm upgrade did not validate the returned command exit code.

The false success occurred because command-stream represents a failed command
as a result object with a nonzero `code`; awaiting the template tag does not
throw. `publish-to-npm.mjs` only used `try/catch`, so it set the `published`
workflow output after an npm failure. That output then allowed creation of a
GitHub release, making the overall workflow appear successful.

A second reporting defect obscured diagnosis: `src/cli.js` hardcoded
`.version('0.1.0')`, so `--version` could not identify the actual installed
package.

## Fix

- The automatic and manual publishing jobs now use Node 24 and install npm
  `^11.5.1`, satisfying the trusted-publishing runtime requirements without
  drifting to an incompatible future npm major.
- npm setup and publishing validate every command result. Publication retries
  nonzero exits and ultimately fails the workflow; the `published` output is
  written only after a verified zero exit code.
- Release helpers are import-safe and dependency-injected so the failure paths
  can be tested without contacting npm or modifying the machine.
- `gh-upload-log --version` reads the installed `package.json` version.
- `package.json` uses npm's normalized `git+https` repository URL, removing the
  publish-time correction and matching the trusted publisher repository.
- A patch changeset ensures the corrected release flow produces a new npm
  version containing both the earlier relative-path fix and this release fix.

## Regression coverage

`test/release.test.js` verifies that:

1. a nonzero npm publish result is retried and rejected rather than reported as
   success;
2. a later zero result succeeds;
3. both publishing jobs use Node 24 with npm `^11.5.1`; and
4. npm setup rejects `EBADENGINE` instead of silently continuing.

`test/cli.test.js` verifies that `--version` equals `package.json`. Existing CLI
and library tests continue to cover all supported relative-path spellings and
the original working-directory mutation scenario.

The fix is complete when the pull request checks pass and the post-merge release
publishes a version newer than `0.9.0` to npm. Actual registry publication cannot
be performed safely from a pull request because it requires the protected main
branch OIDC identity.
