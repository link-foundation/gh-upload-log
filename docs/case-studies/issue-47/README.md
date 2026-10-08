# Issue #47: installation-token repository uploads

[Issue #47](https://github.com/link-foundation/gh-upload-log/issues/47) reports
Gist creation returning `Resource not accessible by integration (HTTP 403)`,
followed by repository fallback failing to fetch an authenticated username.
[PR #48](https://github.com/link-foundation/gh-upload-log/pull/48) fixes the
repository target selection and adds regression coverage.

## Evidence and root cause

The reporter's [real workflow log](https://github.com/link-assistant/hive-mind/blob/issue-2613-2efa14ce78a7/docs/case-studies/issue-2613/evidence/formal-job-2613.log#L4331)
records the Gist permission failure and the subsequent `/user` failure at lines
4331–4333. Repeating the whole upload did not grant the installation token access
to either endpoint.

Both repository upload paths previously called `getGitHubUsername()` before
selecting an owner. Shared mode always selected the user's `public-logs` or
`private-logs` repository and could create it. There was no way to select the
existing repository to which the installation token already had write access.

GitHub documents installation-token support for
[repository metadata](https://docs.github.com/en/rest/repos/repos#get-a-repository)
and the [Contents API](https://docs.github.com/en/rest/repos/contents#get-repository-content).
Contents reads accept a `ref` parameter for branch selection.

The first [mocked reproduction](evidence/reproduction-before.txt) produced 20 failing tests, including the exact
`Failed to fetch authenticated GitHub username` error. Local investigation logs
are saved under `ci-logs/issue47-before.log`; the test file was created and run
before changing the upload implementation.

## Implementation and decisions

- CLI `--repository OWNER/REPO` and `--branch BRANCH`, library `repository` and
  `branch`, and `GH_UPLOAD_LOG_REPOSITORY`/`GH_UPLOAD_LOG_BRANCH` select the target.
- Explicit repository mode reads repository metadata, bypasses `/user` and
  repository creation, and uses the existing visibility. The selected branch
  must exist; when omitted, the repository's default branch is used.
- The upload reuses content addressing, sparse checkout, readable chunking,
  resumable markers, and push retries. Contents API reads include a GET `ref`
  parameter, and Git fetch/push use `refs/heads/BRANCH` to avoid revision or tag
  ambiguity. Branch URL characters are escaped.
- Only the disposable checkout receives the `gh` credential helper and the
  `gh-upload-log` author identity. No user identity request is needed, no token
  is written into a remote URL, and unrelated local staged work is untouched.
- Invalid targets fail before upload. Missing or inaccessible repositories and
  branches never trigger implicit creation. Failed pushes remain failures.
- Auto mode retains Gist-first selection and routes fallback to the target.
  Installation permission errors are permanent. Rate-limit 403s remain
  retryable, with bounded 60/120-second waits following GitHub's
  [rate-limit guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#handle-rate-limit-errors-appropriately).
  Tests inject the wait function, including the existing shared-fallback test.
- `GITHUB_REPOSITORY` is selected only by explicitly passing its value. Personal
  shared/dedicated defaults remain available without an explicit target.
- A minor changeset prepares the next automated release.

## Verification

- `test/issue-47.test.js` reproduces Gist 403, a denied user endpoint, successful
  selected-repository writes, selected-branch deduplication, metadata 403/404,
  missing branches, failed pushes, invalid inputs and rate-limit 403 retries.
- `test/cli-repository-target.test.js` checks flags, environment, `.lenv`,
  precedence and early validation.
- `test/issue-47-git.test.js` runs real Git against a temporary bare remote. It
  uploads two small chunks to `feature/logs`, preserves a pre-existing file,
  verifies byte-for-byte reconstruction, leaves `main` unchanged, and deduplicates
  a second upload. Its fixture is retained in
  `experiments/issue-47-local-git.mjs`.
  A second integration forces a concurrent push rejection and verifies the
  retry fetches the selected branch and preserves the other writer's file.
- `bun experiments/issue-47-command-stream.mjs` verifies the actual command
  runner preserves the empty credential-helper reset and `gh` helper arguments.

GitHub API responses are mocked; no installation token was available for a live
upload. The actual Git upload, checkout configuration and branch isolation are
tested locally. Repository permissions and branch protection still apply.

## Initial CI failure

Run [37734729081](https://github.com/link-foundation/gh-upload-log/actions/runs/37734729081)
was created at `2026-10-08T05:54:12Z` for the prepared branch's initial commit
`a62672f7c090e018f8acda216071aa11bf8b6920`. The saved log
`ci-logs/checks-release-37734729081.log` reports `No changeset found in this PR`
at line 236, then exits 1 at line 238. Other checks were skipped by that dependency.
The added changeset addresses this specific failure.

## Final local checks

- `bun test`: 154 pass, 0 fail.
- `bun run check`: ESLint, Prettier and the 1000-line JavaScript limit pass.
- Changeset validation finds one minor release changeset.
- `npm pack --dry-run --json` succeeds.
- `origin/main` is an ancestor of this branch.
