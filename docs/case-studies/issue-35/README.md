# Case Study: Issue #35 - Not All Paths Are Accepted And The `master` Branch Hint Is Shown

## Summary

Issue [#35](https://github.com/link-foundation/gh-upload-log/issues/35) reported
two defects observed in one terminal session:

1. `gh-upload-log` printed git's `hint: Using 'master' as the name for the
initial branch …` advice block (plus other unrelated command noise) on every
   repository-mode upload.
2. Only absolute paths worked. `gh-upload-log hive-telegram-bot.log` and
   `gh-upload-log ./hive-telegram-bot.log` both failed with
   `ENOENT: no such file or directory, copyfile 'hive-telegram-bot.log' -> …`,
   while `gh-upload-log /home/box/hive-telegram-bot.log` succeeded.

Both defects have a single, shared trigger: the repository upload ran its git
commands as `` $`cd ${workDir} && …` ``. command-stream's virtual `cd` builtin
calls `process.chdir()`, so the _host process_ was moved into the temporary
directory; every later relative path resolved against `/tmp/log-…` instead of
the user's directory. The `hint:` block came from the plain `git init` executed
by that same command.

The fix resolves every user-supplied path to an absolute path at each entry
point, replaces every `cd <dir> && …` prefix with command-stream's
non-mutating `cwd` option, and initializes temporary repositories with
`git -c init.defaultBranch=<branch> init -q`.

## Issue Details

- Issue URL: https://github.com/link-foundation/gh-upload-log/issues/35
- Title: `Not all paths are accepted and master branch hint is shown`
- Reporter: `konard` (Konstantin Diachenko)
- Created: `2026-08-21T17:47:14Z`
- Labels: `bug`
- Comments: `0` (see [issue-comments.json](./issue-comments.json))
- Pull request: https://github.com/link-foundation/gh-upload-log/pull/36

## Requirements Identified From The Issue

| #   | Requirement                                                                                                                                                             | Where it is addressed                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The `hint: Using 'master' as the name for the initial branch …` block must not be shown                                                                                 | `initializeGitRepository()` in `src/repository-upload.js`                                                                                                           |
| R2  | All path forms must be accepted (bare relative, `./`, `../`, `~/`, absolute)                                                                                            | `resolveLogFilePath()` in `src/common.js`, applied in `src/cli.js`, `src/index.js`, `src/repository-upload.js`                                                      |
| R3  | Collect all issue data under `docs/case-studies/issue-35/` and do a deep analysis (timeline, requirements, root causes, solutions, existing libraries, online research) | This document and the files next to it                                                                                                                              |
| R4  | Add debug output / verbose mode if the available data is not enough to find the root cause                                                                              | Existing `--verbose` retained; all command output is now mirrored **only** in verbose mode, and the reproduction experiments in `experiments/` capture the evidence |
| R5  | Report the problem upstream if another project is involved, with reproducible example, workaround and fix suggestion                                                    | [link-foundation/command-stream#197](https://github.com/link-foundation/command-stream/issues/197)                                                                  |
| R6  | Apply the requirements to the **entire** codebase, not just the first place found                                                                                       | Swept `src/` for `cd ` prefixes and raw path usage; fixed the CLI, both upload strategies, and the gist path                                                        |
| R7  | Do everything in the single pull request #36                                                                                                                            | All commits land on `issue-35-069f665c81ce`                                                                                                                         |

Two secondary defects visible in the reported transcript were fixed as part of
R1, because the issue asks for the hint output to disappear and these lines are
the same class of unwanted noise:

- A bare `konard` line printed before the upload — the mirrored stdout of
  `gh api user --jq .login`.
- `Initialized empty Git repository in …`, `From https://github.com/…`,
  `Reset branch 'main'`, `[main abdf5da] Add log file`, `To https://…` — the
  mirrored output of `git init` / `fetch` / `checkout` / `commit` / `push`.

## Evidence Collected

- [issue-details.json](./issue-details.json) — full issue payload.
- [issue-comments.json](./issue-comments.json) — empty; the scope never changed
  after the report.
- [reported-terminal-transcript.log](./reported-terminal-transcript.log) — the
  terminal session from the issue body, extracted verbatim.
- [pr-36.json](./pr-36.json) — the draft pull request created for this issue.
- [recent-merged-prs.json](./recent-merged-prs.json) — recent merged PRs, used
  to follow this repository's title/description style.
- [repro-cd-mutates-cwd.log](./repro-cd-mutates-cwd.log) — output of
  `experiments/test-cd-cwd.js`: proves both defects at once.
- [repro-cwd-option-fix.log](./repro-cwd-option-fix.log) — output of
  `experiments/test-cwd-option.js`: proves the chosen fix works.

### Reproduction of the working-directory defect

`experiments/test-cd-cwd.js` (recorded in
[repro-cd-mutates-cwd.log](./repro-cd-mutates-cwd.log)):

```
cwd before: /tmp/gh-issue-solver-1787334486952
hint: Using 'master' as the name for the initial branch. This default branch name
…
Initialized empty Git repository in /tmp/cd-cwd-test-1787335480978/.git/
exit 0
cwd after: /tmp/cd-cwd-test-1787335480978
```

One `` $`cd ${dir} && git init` `` produces **both** reported symptoms: the
advice block, and a permanently changed `process.cwd()`.

### Reproduction of the fix

`experiments/test-cwd-option.js` (recorded in
[repro-cwd-option-fix.log](./repro-cwd-option-fix.log)):

```
pwd output: /tmp/cwd-opt-test-1787335481086
process cwd after: /tmp/gh-issue-solver-1787334486952
git init code: 0 "" ""
branch: main
process cwd after 2: /tmp/gh-issue-solver-1787334486952
```

The command runs in the target directory, the host process stays where it was,
and `git -c init.defaultBranch=main init -q` produces no output at all.

## Timeline / Sequence Of Events

Reconstructed from the reported transcript. `$workDir` is the temporary
directory such as `/tmp/log-hive-telegram-bot-1787332985826`.

| Step | Event                                                                                                                                            | Consequence                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | User runs `gh-upload-log hive-telegram-bot.log` from `/home/box`                                                                                 | `config.logFile` is the relative string `hive-telegram-bot.log`                                                                                          |
| 2    | `fileExists('hive-telegram-bot.log')` is checked                                                                                                 | Passes — cwd is still `/home/box`                                                                                                                        |
| 3    | `⏳ Uploading 25.55 MB (🔒 private)...` is printed                                                                                               | Size read successfully, still from `/home/box`                                                                                                           |
| 4    | `getGitHubUsername()` runs `gh api user --jq .login` with mirroring on                                                                           | Stray `konard` line in the output                                                                                                                        |
| 5    | `uploadAsSharedRepo()` creates `$workDir` and runs `` $`cd ${workDir} && git init` ``                                                            | git prints the `master` advice block (**R1 symptom**) and command-stream's `cd` calls `process.chdir($workDir)`                                          |
| 6    | `git remote add` / `sparse-checkout` / `fetch` / `checkout` run, each mirrored                                                                   | `From https://github.com/konard/private-logs`, `Reset branch 'main'` noise                                                                               |
| 7    | `stageRepositoryFiles()` calls `fs.copyFileSync('hive-telegram-bot.log', …)`                                                                     | Resolves against the _new_ cwd `$workDir` → `ENOENT … copyfile` (**R2 symptom**)                                                                         |
| 8    | User retries with `./hive-telegram-bot.log`                                                                                                      | Same failure; additionally the generated names become `log-.-hive-telegram-bot` / `.-hive-telegram-bot.log.txt` — a different identity for the same file |
| 9    | User retries with `/home/box/hive-telegram-bot.log`                                                                                              | Succeeds: an absolute path is immune to the cwd change                                                                                                   |
| 10   | Issue #35 filed at `2026-08-21T17:47:14Z`                                                                                                        | —                                                                                                                                                        |
| 11   | Branch `issue-35-069f665c81ce` and draft PR #36 opened                                                                                           | —                                                                                                                                                        |
| 12   | Root cause reproduced with `experiments/test-cd-cwd.js`                                                                                          | Confirms cwd mutation + hint                                                                                                                             |
| 13   | Fix implemented, regression tests added, upstream issue [command-stream#197](https://github.com/link-foundation/command-stream/issues/197) filed | —                                                                                                                                                        |

## Root Cause Analysis

### RC1 — `git init` prints the default-branch advice when `init.defaultBranch` is unset (R1)

`uploadAsRepo()`/`uploadAsSharedRepo()` ran a bare `git init`. Since Git 2.28,
`git init` prints a multi-line `hint:` block whenever `init.defaultBranch` is
not configured. The container in the report had no global git config, so the
block appeared on every run. `git init -q` does **not** suppress it — `-q`
silences the "Initialized empty Git repository" line only; the advice is
suppressed by configuring `init.defaultBranch`. The dedicated
`advice.defaultBranchName` knob that existed in early drafts of the feature is
not a reliable option (see [Additional Facts](#additional-facts-and-external-references)).

### RC2 — `cd <dir> && …` moves the host process, breaking every relative path (R2)

command-stream implements `cd` as a virtual builtin
(`node_modules/command-stream/src/commands/$.cd.mjs`):

```js
export default async function cd({ args }) {
  const target = args[0] || process.env.HOME || process.env.USERPROFILE || '/';
  try {
    process.chdir(target);   // mutates the host process
```

`ProcessRunner._runSubshell()` saves and restores `process.cwd()` around
subshells, but a top-level `cd X && …` sequence is not a subshell, so the change
is permanent for the rest of the process lifetime. Everything that ran after the
first git command therefore resolved relative paths against the temporary
directory:

- `fs.copyFileSync(filePath, …)` in `stageRepositoryFiles()` → the reported
  `ENOENT … copyfile`.
- `splitFileIntoChunks()` and `getFileSize()` for large files would fail the
  same way.

### RC3 — Generated identities depended on the spelling of the path (R2, secondary)

`generateRepoName()` / `generateUploadedLogFileName()` normalized the raw
string, so `./hive-telegram-bot.log` produced `log-.-hive-telegram-bot`, while
`/home/box/hive-telegram-bot.log` produced `log-home-box-hive-telegram-bot`.
The same file uploaded from two different spellings would land in two different
folders of the shared repository and defeat deduplication.

### RC4 — Command output was mirrored unconditionally (R1, secondary)

`getCommandStream()` returns a `$` that mirrors output by default. Only a few
call sites opted out with `$({ mirror: false })`, so `gh api user`, `git fetch`,
`git checkout`, `git commit` and `git push` leaked their output into a CLI whose
normal mode is a three-line summary.

### RC5 — Absolute-path-derived names can exceed platform limits (introduced by the fix)

Resolving paths to absolute makes generated names longer. A deeply nested log
file could produce a repository name above GitHub's 100-character limit or a
file name above the 255-byte path-component limit of common filesystems. This
was addressed pre-emptively rather than left as a latent bug.

## Additional Facts And External References

- Git suppresses the initial-branch advice once `init.defaultBranch` is set;
  the hint text itself documents this
  ([actions/checkout#427](https://github.com/actions/checkout/issues/427),
  [Is Ray, Not Array: "Git init Shows a master Branch Hint?"](https://israynotarray.com/en/git/2026/01/22/git-default-branch-master-to-main/)).
- The `advice.defaultBranchName` setting appeared in review iterations of the
  original feature ([git/git#921](https://github.com/git/git/pull/921)) but is
  not the supported way to silence the hint today; setting
  `init.defaultBranch` is. Using `git -c init.defaultBranch=<name>` applies it
  for a single invocation without writing to the user's global config.
- command-stream's `cd`-versus-cwd behavior is known upstream:
  [link-foundation/command-stream#50](https://github.com/link-foundation/command-stream/issues/50)
  documents `cd X && …` as _the workaround_ for directory context, without
  mentioning that it leaks into the host process. Reported as
  [command-stream#197](https://github.com/link-foundation/command-stream/issues/197).
- GitHub repository names are limited to 100 characters of ASCII letters,
  digits, `.`, `-` and `_`
  ([GitHub Docs: Repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits),
  [github/docs#44518](https://github.com/github/docs/issues/44518)).
  Individual path components are limited to 255 bytes on ext4/APFS/NTFS.

### Existing components and libraries considered

| Need                                                       | Candidate                                                                                                               | Decision                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tilde (`~`) expansion                                      | [`untildify`](https://www.npmjs.com/package/untildify), [`expand-tilde`](https://github.com/jonschlinkert/expand-tilde) | **Not adopted.** Both are thin wrappers over `os.homedir()`; `untildify`'s own docs note it predates `os.homedir()`. Adding a dependency for six lines is not worth it in a CLI that already ships `node:os`. |
| Absolute path resolution                                   | `node:path` `path.resolve()`                                                                                            | **Adopted.** Handles `.`, `..`, and already-absolute inputs, including Windows drive letters.                                                                                                                 |
| Running a command in a directory without `chdir`           | command-stream `$({ cwd })` option                                                                                      | **Adopted.** Already a dependency; verified non-mutating in `experiments/test-cwd-option.js`.                                                                                                                 |
| Alternative shell wrappers with scoped cwd (`execa`, `zx`) | `execa` (`cwd` option), `zx` (`$.cwd`)                                                                                  | **Not adopted.** The repository is standardized on command-stream, which offers the same capability; swapping shell libraries would be a much larger change for no additional benefit.                        |
| Deterministic name shortening                              | `node:crypto` `createHash('sha1')`                                                                                      | **Adopted.** A truncating hash keeps names stable across runs, which is required for shared-repository deduplication; a random suffix or timestamp would break it.                                            |

## Solution Options Considered

### R1 — Remove the `master` hint

| Option                                                      | Assessment                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git config --global init.defaultBranch main` from the tool | Rejected: mutates the user's machine-wide git configuration.                                                                                                                                                            |
| `git init -q`                                               | Rejected: `-q` does not suppress the advice block, only the "Initialized empty Git repository" line.                                                                                                                    |
| Redirect stderr / filter output                             | Rejected: hides genuine errors and is brittle across git locales.                                                                                                                                                       |
| **`git -c init.defaultBranch=<branch> init -q`**            | **Chosen.** Per-invocation, no global state, and it makes the initial branch deterministic instead of locale/version dependent. Followed by `git branch -M <branch>` for git versions that ignore `init.defaultBranch`. |

### R2 — Accept all paths

| Option                                                               | Assessment                                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Document "absolute paths only"                                       | Rejected: the issue explicitly requires all paths to be accepted.                                                                            |
| `process.chdir()` back after each command                            | Rejected: fragile, racy with concurrent work, and still leaves a window where relative paths resolve wrongly.                                |
| Resolve the path once at the entry point                             | Necessary but not sufficient — a future `cd` would still corrupt anything else that uses relative paths.                                     |
| **Resolve the path once _and_ stop mutating the cwd (`$({ cwd })`)** | **Chosen.** Defense in depth: even if a command leaks a `chdir`, the upload uses absolute paths; and no command in `src/` leaks one anymore. |

### R4 — Diagnosability

The verbose flag already existed. Rather than adding new debug output that would
be noise in the normal path, mirroring of command output was made conditional on
`verbose`, so `--verbose` now shows _more_ than before relative to the quiet
default, and the two `experiments/` scripts capture the root-cause evidence
reproducibly.

## Implemented Solution

1. **`src/common.js`**
   - `resolveLogFilePath(filePath)` — validates the input, expands a leading
     `~`/`~/` via `os.homedir()`, and returns `path.resolve(...)`.
   - `createWorkDirPath(prefix, timestamp)` — builds the temporary directory
     path in one place.
   - `shortenGeneratedName(name, maxLength)` with
     `MAX_REPOSITORY_NAME_LENGTH = 100` and
     `MAX_UPLOADED_FILE_NAME_LENGTH = 200` — deterministic sha1-prefixed
     shortening that keeps the tail of the path (the most identifying part).
   - `normalizeFileName()` also strips a Windows drive colon (`C:` → `C`).
2. **`src/repository-upload.js`**
   - `createWorkDirRunner($, workDir, verbose)` returns
     `$({ cwd: workDir, mirror: Boolean(verbose), capture: true })`; every
     `` $`cd ${workDir} && …` `` was replaced with `` $workDir`…` ``.
   - `initializeGitRepository($workDir, branchName)` runs
     `git -c init.defaultBranch=<branch> init -q` and then
     `git branch -M <branch>`.
   - Both upload strategies resolve `options.filePath` before use.
   - `gh api` lookups take a pre-bound quiet runner; git commands use `-q`.
3. **`src/index.js`** — `determineUploadStrategy()`, `uploadAsGist()` and
   `uploadLog()` resolve the path and pass the resolved options downstream.
4. **`src/cli.js`** — resolves the path before the existence check, so
   `~/app.log` (quoted, therefore unexpanded by the shell) no longer reports
   "File does not exist".
5. **`src/self-test.js`** — uses `os.tmpdir()` instead of a hardcoded `/tmp`.

## Verification

- `test/path-handling.test.js` (new). Verified to fail on the unfixed code:
  - _"accepts a relative path even when the working directory changes"_ — the
    fake command stream calls `process.chdir()` on every command, exactly like
    command-stream's `cd`; without the path resolution the upload fails.
  - _"runs git commands through the cwd option instead of `cd`"_ — fails when
    commands are `cd`-prefixed.
  - _"initializes git without the master branch hint"_ — fails on a bare
    `git init`.
  - Plus unit tests for `resolveLogFilePath` (`app.log`, `./app.log`,
    `../logs/app.log`, `~`, `~/app.log`, absolute, empty), identical names for
    every spelling of one path, name-length limits, and a real `git` execution
    asserting no `hint:` and no `master` in the output.
- `test/cli.test.js` — new cases for a bare relative path, a `./` path, a
  quoted `~/` path, and an assertion that CLI output never contains `hint:`.
- `test/index.test.js` — expectations updated to absolute-path-derived names
  and to the quiet git commands.
- Full suite: `bun test` → 87 pass, 0 fail.
- `bun run check` (eslint + prettier + file-size) passes.

## Residual Risks

- **Name change for existing uploads.** Folder and file names are now derived
  from the absolute path, so a log previously uploaded as
  `log-hive-telegram-bot` becomes `log-home-box-hive-telegram-bot`. Existing
  shared-repository folders are not migrated; the first upload after this
  change creates the new folder. This is the same identity the absolute-path
  invocation already produced in the reported transcript, so it is the more
  correct of the two behaviors.
- **Very long paths** now hit `shortenGeneratedName`, which trades readability
  for a stable 8-character hash prefix.
- **command-stream's `cd`** still mutates the host process; this repository no
  longer uses it, but a future contributor could reintroduce it. The
  `test/path-handling.test.js` assertion that no command starts with `cd `
  guards against that.

## Upstream Issues

- [link-foundation/command-stream#197](https://github.com/link-foundation/command-stream/issues/197)
  — `cd` builtin changes the host process working directory and never restores
  it. Includes a reproducible example, the real-world impact from this issue,
  the `$({ cwd })` workaround, and three concrete fix proposals.
