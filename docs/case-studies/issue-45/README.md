# Issue 45: recovering large shared-repository uploads

Issue: <https://github.com/link-foundation/gh-upload-log/issues/45>

PR: <https://github.com/link-foundation/gh-upload-log/pull/46>

## Root cause and reproduction

Version 0.9.2 committed every chunk in one commit and called `git push` once.
`command-stream` returns a nonzero result for a failed command; the immediate
`ensureCommandSucceeded` call threw on a transient HTTP 408 and deleted the local
work directory. No retry or remote refresh took place.

The first regression run of `test/issue-45.test.js`, before implementation,
produced 11 failures and one passing authentication-failure test. The failures
covered HTTP 408/429/503, RPC disconnects, concurrent push rejection, retry
exhaustion, chunk-by-chunk pushes, partial-upload deduplication, line splitting,
and preservation of UTF-8 characters.

A tiny log and an injected HTTP 408 reproduce the same failure without uploading
a 165 MB file. Two 8-byte chunks reproduce the commit/push sequencing problem.

## Implementation

- Retry transient failures twice, with 1-second and 2-second exponential delays.
  Fetch and rebase before another push; preserve the shallow clone's common
  ancestor. A newly created remote branch uses a root rebase.
- Commit and push one shared-repository chunk at a time. Matching staged files
  are skipped, so an interrupted upload only pushes missing or changed parts.
- Add a hidden pending marker with the first chunk and replace it with a
  completion marker in the last chunk. A partial folder cannot
  satisfy deduplication. Complete legacy chunks without a pending
  marker are recognized by total size. This prevents mixed chunks after a size
  change from satisfying deduplication just because their sizes add up.
- Accept `--chunk-size`, `GH_UPLOAD_LOG_CHUNK_SIZE`, and library `chunkSize` in
  bytes. Validate the 4-byte through 100 MB range and bound retry configuration.
- Split at the last newline within the limit. A longer line is split between
  UTF-8 characters. Preserve CRLF, missing final newlines, and byte ordering.
  A reusable buffer limits splitter memory to one chunk plus four bytes.
- Keep existing single-file deduplication, gist fallback, private/public routing,
  raw URLs, and legacy dedicated-repository creation. Dedicated mode uses the
  readable splitter and chunk limit, but keeps its original single initial push.

## Verification

`test/issue-45.test.js` includes mocked failure tests and real local Git tests.
`experiments/issue-45-local-git.mjs` supplies a reusable temporary bare remote.
The real Git tests exercise concurrent updates after a depth-one fetch, retry
exhaustion followed by resume, a lost acknowledgement after a successful remote
push, and a race to create the first branch. They verify remote bytes and commits,
not just the commands issued. All probe files are tiny and run offline.

`test/cli-chunk-size.test.js` verifies CLI/environment configuration, CLI
precedence, dry-run planning, and validation before any upload starts.

Run:

```bash
bun test
bun run check
```

The release changeset also resolves the draft PR's original CI failure:
run `37558210701`, created `2026-10-07T01:39:46Z` for commit `80aaffaa`,
reported `No changeset found in this PR` at line 235 of its downloaded log.

### CLI test completion investigation

Some full-suite runs stalled in the existing asynchronous CLI test helper.
The opt-in `experiments/issue-45-cli-trace.mjs` preload recorded the affected
Node process reading all 27,262,976 bytes and exiting with status 0 after 365 ms,
while its parent test waited for a `close` event until the 5-second timeout.
Running the Git integration probes in separate Node workers isolates their many
synchronous subprocesses from Bun's CLI process handling. This avoids the
observed interference while preserving the existing CLI helper and its 5-second
bound. The standalone CLI suite had already passed all 24 tests. No upload or
hashing timeout was changed.

## Assumptions and limits

The default 100 MB limit and 25 MB gist threshold stay the same. A pre-upload
chunk count is a minimum estimate because line boundaries can add parts.
Individual lines larger than the requested limit cannot remain whole; preserving
UTF-8 character boundaries and the byte limit takes precedence in that case.
Retries do not bypass authentication, branch protection, or Git's file-size limit.
