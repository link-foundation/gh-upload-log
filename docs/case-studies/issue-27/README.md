# Case Study: Issue #27 - `--public` Reported Success While the Repository Stayed Private

## Summary

Issue [#27](https://github.com/link-foundation/gh-upload-log/issues/27) reported
that `gh-upload-log ... --public` printed a successful public repository upload
even though the target repository remained private.

The investigation showed that two independent problems lined up:

1. Repository uploads used a deterministic name derived from the file path, so
   retrying the same path could collide with an already-existing repository.
2. `uploadAsRepo()` assumed failed `gh` commands would throw. In practice,
   `command-stream` returns a result object with a non-zero `code`, so the code
   continued down the success path after `gh repo create` had already failed.

The implemented fix now treats non-zero command exits as errors and retries
repository creation with a timestamp-suffixed name when GitHub reports that the
generated repository name already exists.

## Issue Details

- Issue URL: https://github.com/link-foundation/gh-upload-log/issues/27
- Title: `I asked for public repository - got private`
- Reporter: `konard`
- Created: `2026-04-24T10:30:06Z`
- Labels: `bug`
- Comments: `0` (see [issue-comments.json](./issue-comments.json))

## Requirements Identified from the Issue

1. Make sure `--public` does not silently leave the user with a private
   repository.
2. Download the issue-related data and store it under `docs/case-studies/issue-27/`.
3. Reconstruct the timeline and root causes.
4. Propose solution options and solution plans.
5. Add extra debug output only if the available evidence is insufficient.
6. Report external upstream issues only if the problem belongs to another
   project.

## Evidence Collected

- [issue-details.json](./issue-details.json): The full issue payload, including
  the original terminal transcript.
- [issue-comments.json](./issue-comments.json): Confirms there were no follow-up
  comments to change the scope.
- [existing-repository.json](./existing-repository.json): Confirms the
  repository mentioned in the issue was still `"private": true` /
  `"visibility": "private"` when investigated on April 24, 2026.
- [reproduction-shell.log](./reproduction-shell.log): A direct `gh repo create`
  reproduction showing that creating the same repository name twice yields
  `GraphQL: Name already exists on this account (createRepository)` and exit
  code `1`.
- [reproduction-command-stream.log](./reproduction-command-stream.log): Shows
  `command-stream` captures the GitHub CLI failure as command output rather than
  throwing by itself.
- [command-stream-nonzero-semantics.log](./command-stream-nonzero-semantics.log):
  Confirms `command-stream` returns a result object containing `code`,
  `stdout`, and `stderr` for non-zero exits.
- [recent-merged-prs.json](./recent-merged-prs.json): Recent merged PR metadata
  used for PR title/description style review.

## Timeline / Sequence of Events

1. `2026-04-24T10:25:24Z`: The repository
   `konard/log-tmp-start-command-logs-isolation-screen-aff5aea4-7175-4b15-9de9-af670855060b`
   was created as a private repository. This is captured in
   [existing-repository.json](./existing-repository.json).
2. `2026-04-24T10:30:06Z`: Issue #27 was opened with a transcript showing
   `gh-upload-log ... --public`, a `GraphQL: Name already exists on this account`
   error, and a false success message claiming a public repository was created.
3. Local reproduction confirmed the same GitHub CLI behavior: the first
   `gh repo create --private` succeeded, the second `gh repo create --public`
   for the same name failed with exit code `1`, and the repository stayed
   private.
4. Code inspection of `src/index.js` showed that `uploadAsRepo()` did not check
   the `code` property returned by `command-stream`, so a failed `gh repo create`
   call still fell through to the success path.

## Root Cause Analysis

### 1. Deterministic repository naming caused collisions

`uploadAsRepo()` derived the repository name directly from the file path via
`generateRepoName(filePath)`. Re-uploading the same file path reused the same
repository name, which is safe only if the previous repository does not already
exist.

### 2. Non-zero command exits were ignored

The integration layer used `command-stream`, which returns a result object even
for failing commands. The captured experiment shows a non-zero result contains a
`code` field instead of triggering an exception automatically. `uploadAsRepo()`
treated `await $...` as throw-on-failure, so it never validated the `gh repo
create` exit status.

### 3. Success output was synthesized after failure

After the failed create call, the code constructed the repository URL locally
from `githubUser` and `repositoryName`, then continued with raw-URL lookup. That
made the CLI print:

- `✅ Repository created (🌐 public)`
- the repository URL
- a tokenized raw URL

even though the remote repository had not been created as public in that run.

## Additional Facts and External References

- GitHub CLI documents that command failures return exit code `1`:
  https://cli.github.com/manual/gh_help_exit-codes
- GitHub CLI supports changing repository visibility with `gh repo edit
--visibility {public,private,internal}`:
  https://cli.github.com/manual/gh_repo_edit
- GitHub CLI repository creation flags are documented here:
  https://cli.github.com/manual/gh_repo_create

## Solution Options Considered

### Option 1: Fail fast on any non-zero `gh` / `git` exit

**Pros**

- Fixes the false-success bug directly.
- Makes command failures visible to the caller.
- Reduces the chance of similar bugs in later command integrations.

**Cons**

- A name collision would become a hard error even when the user simply wanted a
  new repository with the requested visibility.

### Option 2: Retry with a unique repository name when the generated name already exists

**Pros**

- Preserves the user's requested visibility (`--public` stays public).
- Avoids mutating an existing repository that might contain older or private
  data.
- Keeps the default deterministic name in the common non-collision case.

**Cons**

- The repository name becomes non-deterministic in the retry path.

### Option 3: Reuse the existing repository or flip its visibility

**Pros**

- Keeps the original repository URL stable.

**Cons**

- Risky: changing visibility on an existing private repository can expose older
  uploads unexpectedly.
- Semantically ambiguous: a retry should not silently mutate a different
  repository created earlier.
- GitHub CLI requires explicit acceptance of visibility-change consequences,
  which is a strong signal that this should not happen implicitly.

### Option 4: Ask the user for a custom repository name

**Pros**

- Explicit and predictable.

**Cons**

- Worse CLI UX for the common retry case.
- Does not address the false-success bug on its own.

## Implemented Solution

The final change combines Option 1 and Option 2:

1. Added command-result validation so non-zero exits from `split`, `git`, and
   `gh` are treated as failures.
2. Detects the GitHub error text for an existing repository name and retries
   `gh repo create` once with a timestamp-suffixed repository name.
3. Preserves the requested visibility flag during the retry.
4. Added regression tests that simulate:
   - repeated `gh repo create` failure due to name collision
   - successful retry with a unique repository name

## Verification

- `bun test`
- `bun run check`
- New CLI regression tests cover the exact `GraphQL: Name already exists on this account`
  path reported in the issue.

## Upstream Issues

No external issue was filed. The observed behavior is consistent with GitHub
CLI's documented non-zero exit codes and with `command-stream` returning command
results that include a status code. The bug was in this repository's command
handling logic rather than in an upstream project.
