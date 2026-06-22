# Case Study: Issue #33 - Use `.log.txt` for Browser-Viewable Uploaded Logs

## Summary

Issue [#33](https://github.com/link-foundation/gh-upload-log/issues/33)
requested that uploaded log files use `.log.txt` by default instead of `.log`.
The reason is user-facing: raw log links should open natively in browsers
instead of being treated as downloads.

The implemented solution keeps user input paths, repository names, and shared
repository folder paths stable, but stages the actual uploaded log files under
browser-friendly `.log.txt` names for gist uploads, repository uploads, and
repository chunks.

## Issue Details

- Issue URL: https://github.com/link-foundation/gh-upload-log/issues/33
- Title: `Use .log.txt extension by default in all places instead of .log, so it will open natively in browsers (with no fallback to download)`
- Reporter: `konard`
- Created: `2026-06-22T08:15:09Z`
- Labels: `bug`
- Comments: `0` (see [issue-comments.json](./issue-comments.json))

## Requirements Identified From The Issue

1. Use `.log.txt` by default instead of `.log` for uploaded log files.
2. Ensure user-facing links directly referenced by `gh-upload-log` point at
   `.log.txt` files where an uploaded log file is exposed directly.
3. Apply the behavior across the whole codebase, not only one upload path.
4. Collect issue evidence and analysis under `docs/case-studies/issue-33/`.
5. Search for additional facts and existing related implementations.
6. Reconstruct the event timeline, root causes, solution options, and final
   plan.
7. Add debug output only if the available evidence is insufficient.
8. Report upstream issues only if the root cause belongs to another project.

## Evidence Collected

- [issue-details.json](./issue-details.json): Structured issue payload with the
  requested `.log.txt` behavior.
- [issue-comments.json](./issue-comments.json): Confirms there were no
  follow-up scope changes.
- [pr-34.json](./pr-34.json), [pr-34-comments.json](./pr-34-comments.json),
  [pr-34-review-comments.json](./pr-34-review-comments.json), and
  [pr-34-reviews.json](./pr-34-reviews.json): Current PR state and comment
  streams before implementation.
- [recent-merged-prs.json](./recent-merged-prs.json): Recent merged PRs used
  for local style and PR description conventions.
- [related-code-search-log-txt.txt](./related-code-search-log-txt.txt),
  [related-code-search-gist-name.txt](./related-code-search-gist-name.txt), and
  [related-code-search-repo-name.txt](./related-code-search-repo-name.txt):
  `gh search code --owner link-foundation` evidence. The direct searches for
  the local naming helpers returned no reusable implementation outside this
  repository.
- [recent-runs.json](./recent-runs.json): Recent CI runs for branch
  `issue-33-f9f7dc69b691`.
- [ci-logs/checks-and-release-27941129649.log](./ci-logs/checks-and-release-27941129649.log):
  The initial PR CI run. Lines 220-224 show the run failed because no changeset
  had been added yet.

## Timeline / Sequence Of Events

1. `2026-06-22T08:15:09Z`: Issue #33 was opened with the `.log.txt` default
   requirement and the case-study requirement.
2. `2026-06-22T08:55:20Z`: The prepared PR branch
   `issue-33-f9f7dc69b691` received the initial placeholder commit
   `2dda592055c383e575efc6e63af60c4f42bc335c`.
3. `2026-06-22T08:55:32Z`: CI run `27941129649` started for that head SHA.
4. `2026-06-22T08:55:43Z`: The changeset check failed because the PR added
   zero changeset files.
5. Code inspection showed that the generated gist filename was returned in
   metadata but was not passed to `gh gist create`.
6. Code inspection also showed repository uploads staged
   `normalizeFileName(filePath)`, preserving `.log` in single-file raw URLs.
7. Chunk generation used a `.part-00` style suffix without `.txt`, so chunked
   repository files were not browser-friendly either.

## Root Cause Analysis

### 1. Gist metadata did not control the uploaded gist filename

`uploadAsGist()` computed `generateGistFileName(filePath)`, but the command
invoked `gh gist create` with the original file path. GitHub CLI therefore used
the staged path's basename, not the generated name returned by the library.

### 2. Repository staging preserved `.log` filenames

`stageRepositoryFiles()` copied the input file into the temporary repository
using `normalizeFileName(filePath)`. For `/home/user/app.log`, that produced
`home-user-app.log`, and raw repository URLs therefore ended in `.log`.

### 3. Chunked files had no text extension

`splitFileIntoChunks()` generated files like `large.part-00`. Even after the
single-file repository path is fixed, chunked uploads need their own
browser-viewable names because the original staged file is removed after
splitting.

### 4. Existing tests did not assert the actual uploaded filenames

Existing tests covered repository names, shared repository paths, and result
metadata, but they did not verify the name passed to `gh gist create` or the
file names staged inside repository work directories.

### 5. Initial CI was blocked by release process requirements

The initial PR check failed before lint or tests ran. The downloaded CI log
shows `No changeset found in this PR` and `Found 0 changeset file(s) added by
this PR`, so this PR must include exactly one changeset.

## Additional Facts And External References

- GitHub REST repository contents API:
  https://docs.github.com/en/rest/repos/contents. The API returns repository
  file metadata including `download_url`, and GitHub documents that these URLs
  can expire and should be refreshed for each download.
- MDN common media types:
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/MIME_types/Common_types.
  MDN lists `.txt` as `text/plain` and explains that unknown types fall back to
  `application/octet-stream`, which browsers handle cautiously.
- GitHub CLI gist creation help from `gh gist create --help` shows custom
  `--filename` applies to stdin input. For file-path uploads, staging a
  temporary file with the desired basename is the direct way to control the gist
  file name while preserving the existing command-stream pattern.

These facts support making the uploaded file name end in `.log.txt` rather than
only changing printed metadata.

## Solution Options Considered

### Option 1: Change only `generateGistFileName()`

Pros:

- Small change.
- Fixes dry-mode metadata.

Cons:

- Does not affect the actual `gh gist create` filename.
- Does not fix repository raw URLs or chunked upload files.

### Option 2: Mutate or rename the user's input file before upload

Pros:

- Makes downstream tools see the new name.

Cons:

- Surprising and unsafe for user files.
- Could break callers that expect the original path to remain untouched.

### Option 3: Stage uploaded files under `.log.txt` names

Pros:

- Fixes gist, repository, and chunked upload surfaces.
- Preserves user input files.
- Keeps repository names and shared repository paths stable for deduplication.
- Fits the existing temporary-work-directory upload model.

Cons:

- Adds temporary copy work for gist uploads.

## Implemented Solution

The final solution uses Option 3:

1. Added a shared uploaded-log filename helper that converts `.log` to
   `.log.txt`, avoids duplicating `.log.txt`, and appends `.log.txt` for other
   log inputs.
2. Changed `generateGistFileName()` to use that helper.
3. Changed gist uploads to copy the input file into a temporary directory under
   the generated `.log.txt` name before calling `gh gist create`.
4. Changed repository staging to copy files as `.log.txt`, which makes
   repository raw URLs browser-friendly for single-file uploads.
5. Changed chunk splitting to emit chunk files named
   `<base>.part-00.log.txt`, `<base>.part-01.log.txt`, and so on.
6. Left repository names and shared repository folder paths unchanged so
   existing deduplication semantics remain path-compatible.

## Verification

Regression coverage was added for:

- `generateGistFileName('/home/user/test.log')` returning
  `home-user-test.log.txt`.
- Duplicate prevention for inputs already ending in `.log.txt`.
- Appending `.log.txt` for uploaded log inputs that do not already end in
  `.log`.
- Chunked upload file names ending in `.log.txt`.
- Actual gist creation using a staged `.log.txt` file path.
- Shared repository uploads staging `.log.txt` files.
- Dedicated repository uploads staging `.log.txt` files.
- Gist fallback to repository mode staging `.log.txt` files.
- CLI dry-mode verbose output showing the `.log.txt` gist file name.

Validation commands:

- `bun test test/index.test.js test/cli.test.js`
- `bun test`
- `bun run check`
