# Case Study: Issue #29 - Default Large Log Uploads to Shared `private-logs` / `public-logs` Repositories

## Summary

Issue [#29](https://github.com/link-foundation/gh-upload-log/issues/29)
requested a new default for repository-mode uploads:

1. Files that do not fit in gists should stop creating one repository per log.
2. The previous repository name should become a folder inside
   `{user}/private-logs` or `{user}/public-logs`.
3. The old per-log repository flow should remain available behind an option/env.
4. Uploading the same large log twice should deduplicate instead of pushing a
   duplicate.
5. The repository should use the latest `lino-arguments` release.

The implemented change now routes files larger than 25MB into shared
visibility-specific repositories by default, reuses the old generated
repository name as the folder path, skips duplicate uploads when that folder
already exists, and keeps the previous dedicated-repository behavior behind the
new `shared-repository` toggle / `useSharedRepository` option.

## Issue Details

- Issue URL: https://github.com/link-foundation/gh-upload-log/issues/29
- Title: `By default use special repositories for the user private-logs and public-logs to upload big files`
- Reporter: `konard`
- Created: `2026-04-24T10:36:13Z`
- Labels: `documentation`, `enhancement`
- Comments: `0` (see [issue-comments.json](./issue-comments.json))

## Requirements Identified From The Issue

1. Use `{user}/private-logs` and `{user}/public-logs` by default for large
   repository uploads.
2. Reuse the previous generated repository name as the folder path in the
   shared repository.
3. Keep the old one-repository-per-log behavior available behind option/env.
4. Prevent duplicate uploads when the same large log is already present in the
   selected shared repository.
5. Apply the new shared-repository behavior only to files that do not fit in
   gists.
6. Update `lino-arguments` to the latest available release.
7. Collect issue evidence and solution analysis under
   `docs/case-studies/issue-29/`.

## Evidence Collected

- [issue-details.json](./issue-details.json): Structured issue payload with the
  exact requested behavior.
- [issue-comments.json](./issue-comments.json): Confirms there were no follow-up
  scope changes.
- [recent-merged-prs.json](./recent-merged-prs.json): Used to follow recent PR
  title/description style in this repository.
- [related-pr-28.json](./related-pr-28.json): The most recent closely related
  merged PR, used to preserve repository-upload implementation style.
- [related-code-search.txt](./related-code-search.txt): `gh search code` for
  `"private-logs"` / `"public-logs"` under the `link-foundation` owner. It
  returned no existing implementation to reuse.
- [ci-run-24886438137.log](./ci-run-24886438137.log): The branch CI run after
  the initial commit. It failed only because the PR had no changeset yet, not
  because of a code regression.
- [lino-arguments-package.json](./lino-arguments-package.json): npm registry
  metadata showing `lino-arguments` `0.3.0` as the latest version on
  `2026-04-24`, published on `2026-04-10T22:24:25.006Z`.
- [pr-30-review-comments.json](./pr-30-review-comments.json): Confirms there
  were no inline review comments to address while preparing the update.

## Timeline / Sequence Of Events

1. `2026-04-24T10:36:13Z`: Issue #29 was opened with the new shared-repository
   requirement and the dependency-update request.
2. `2026-04-24T11:09:33Z`: The prepared branch
   `issue-29-ab70a4a6a817` started from a placeholder initial commit.
3. `2026-04-24T11:09:44Z`: CI run `24886438137` started for that placeholder
   commit.
4. `2026-04-24T11:09:52Z`: The same CI run failed in the changeset check
   because the PR had no added changeset file yet.
5. Code inspection confirmed that repository mode still always created a
   dedicated repository derived from the file path, with no shared-repository
   abstraction and no deduplication check.
6. npm registry inspection confirmed the dependency lag:
   `lino-arguments` was pinned at `^0.2.1` locally while `0.3.0` was already
   published.

## Root Cause Analysis

### 1. Repository mode had no shared-storage abstraction

`uploadAsRepo()` treated the generated repository name as the final remote
destination. That made each large log create a brand-new repository even though
the issue now requires a shared storage repository plus a per-log folder path.

### 2. Duplicate detection was impossible in the old model

Because each large upload targeted its own repository, there was no pre-upload
existence check against a shared namespace like `private-logs/log-...`. The
tool always proceeded as if a new upload were required.

### 3. A naive shared-repository implementation could scale poorly

Switching to a shared repository introduces a new performance constraint: a full
clone of a long-lived log repository could become very expensive. The solution
therefore needs to fetch only the relevant path instead of checking out the
entire repository on every upload.

### 4. The CLI/library surface did not expose a compatibility switch

The issue explicitly required the old behavior to remain available via
option/environment variable. That switch did not exist.

### 5. `lino-arguments` was behind the latest available release

`package.json` still referenced `^0.2.1`, while npm registry metadata showed
`0.3.0` as the latest published version.

## Additional Facts And External References

- GitHub CLI repository creation reference:
  https://cli.github.com/manual/gh_repo_create
- GitHub REST API contents reference:
  https://docs.github.com/en/rest/repos/contents
- Git partial clone reference (`--filter=blob:none`):
  https://git-scm.com/docs/git-clone
- npm package page for `lino-arguments`:
  https://www.npmjs.com/package/lino-arguments

These references support the chosen approach:

- `gh repo create` is the correct non-interactive mechanism to bootstrap the
  shared repository when it does not exist yet.
- The GitHub contents API provides a cheap folder-existence check and returns
  `download_url` values that can be reused for dedup results and single-file raw
  links.
- `git fetch --filter=blob:none` allows the code to update a shared repository
  without eagerly downloading unrelated large blobs.

## Solution Options Considered

### Option 1: Keep creating one repository per large log by default

**Pros**

- Simple and already implemented.

**Cons**

- Violates the main issue requirement.
- Keeps creating hundreds or thousands of repositories over time.
- Does not help deduplication.

### Option 2: Use shared repositories but clone the entire repository each time

**Pros**

- Easy to reason about.
- Minimal code complexity.

**Cons**

- Scales poorly as `private-logs` / `public-logs` grow.
- Downloads unrelated log blobs during every upload.

### Option 3: Use shared repositories with metadata checks plus sparse/filtered fetch

**Pros**

- Matches the requested shared storage model.
- Supports deduplication before any local git work starts.
- Avoids pulling unrelated repository content into the working tree.
- Preserves the old repository naming logic as a folder path.

**Cons**

- More implementation complexity than the dedicated-repository model.

## Implemented Solution

The final solution uses Option 3:

1. For files larger than 25MB, `uploadAsRepo()` now defaults to shared
   repositories:
   - private upload -> `{user}/private-logs`
   - public upload -> `{user}/public-logs`
2. The previous generated repository name from `generateRepoName(filePath)`
   becomes the folder path inside the shared repository.
3. Before any git work starts, the code queries
   `repos/{owner}/{repo}/contents/{folder}`:
   - if the folder exists, the upload is treated as a duplicate and the existing
     result is returned
   - if the folder is missing, the upload proceeds
4. Shared-repository updates use:
   - `git init`
   - `git sparse-checkout init --no-cone`
   - `git sparse-checkout add <folder>`
   - `git fetch --depth 1 --filter=blob:none origin <branch>`
5. The legacy dedicated-repository behavior is still available through:
   - CLI: `--no-shared-repository`
   - env: `GH_UPLOAD_LOG_SHARED_REPOSITORY: false`
   - library: `useSharedRepository: false`
6. The new shared-repository mode only applies to files that exceed the gist
   threshold. Small files still default to gist uploads, and forced repository
   uploads for small files continue to use the legacy dedicated-repository path.
7. `lino-arguments` was updated from `^0.2.1` to `^0.3.0`.

## Verification

- Added library-level regression coverage for:
  - default shared-repository routing for large files
  - duplicate detection in shared repositories
  - explicit fallback to legacy dedicated repositories
- Added CLI dry-run coverage for:
  - default shared-repository behavior
  - disabling shared repositories with `--no-shared-repository`
- Updated user-facing documentation in `README.md` and `.lenv.example`.

Validation commands:

- `bun test test/index.test.js test/cli.test.js`
- `bun test`
- `bun run check`

## Residual Risks

1. Concurrent uploads to the same shared repository but different folders can
   still race at push time if two writers update the default branch
   simultaneously. This issue did not request branch-level concurrency control,
   so the current fix focuses on correct default behavior and deduplication.
2. Deduplication is path-based for shared repository folders. If two different
   file paths contain identical content, they are treated as distinct uploads.
   That matches the issue wording, which anchored the new storage layout to the
   previous repository name.

## Upstream Issues

No upstream issue was filed. The requested behavior is a feature change in this
repository rather than a bug in GitHub CLI, Git, or `lino-arguments`.
