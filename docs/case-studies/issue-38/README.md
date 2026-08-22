# Case study — issue #38: a changed file was never uploaded again

**Issue:** [link-foundation/gh-upload-log#38](https://github.com/link-foundation/gh-upload-log/issues/38)
**Pull request:** [#39](https://github.com/link-foundation/gh-upload-log/pull/39)
**Reported:** 2026-08-21 · **Analyzed:** 2026-08-22 · **Version affected:** 0.8.3

> Every number in this document was measured, not assumed. The raw measurements
> are the JSON files next to this README, and the scripts that produced them are
> in [`experiments/`](../../../experiments).

## 1. Summary

`gh-upload-log` reported `ℹ️ Repository already exists` for a log file that had
changed, and never uploaded the new content. The link it printed pointed to a
26.8 MB file from an earlier run, while the file on disk was 31 MB. The
deduplication check only compared the **path** of the log, never its
**content**, so any later version of the same path was silently discarded.

The fix makes the stored location content addressed:

```
before: log-home-box-hive-telegram-bot/home-box-hive-telegram-bot.log.txt
after:  home-box/<sha256-16>/hive-telegram-bot.log.txt
```

## 2. Timeline of events

| Time (UTC)          | Event                                                                                                                | Evidence                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 2026-04-25 10:00:28 | `konard/private-logs` created                                                                                        | [`private-logs-repo.json`](./private-logs-repo.json)                                             |
| 2026-08-21 17:24:03 | Only commit ever made to `log-home-box-hive-telegram-bot/`: "Add log file", uploading a **26,797,306 byte** file     | [`folder-commits.json`](./folder-commits.json), [`folder-contents.json`](./folder-contents.json) |
| 2026-08-21 (later)  | User uploads a **30.98 MB** version of the same path → tool prints `ℹ️ Repository already exists`, no commit is made | issue #38 body                                                                                   |
| 2026-08-21 (later)  | User uploads a **31.02 MB** version → same message, again no commit                                                  | issue #38 body                                                                                   |
| 2026-08-21          | User opens the printed raw URL without a token → HTTP 404                                                            | issue #38 body, [`raw-url-probe.json`](./raw-url-probe.json)                                     |
| 2026-08-22          | Root cause reproduced, gist limits and raw URL behavior measured, fix implemented in PR #39                          | this document                                                                                    |

The decisive evidence is `folder-commits.json`: the folder has exactly **one**
commit. The two later uploads produced no commit at all — the content was lost,
not merely overwritten.

## 3. Requirements from the issue

| #   | Requirement (from the issue)                                                                        | Status                                                          |
| --- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| R1  | A file that changed must be uploaded again even if the same path exists                             | Fixed — content hash decides, see §5.1                          |
| R2  | Double-check whether gists really reject files of that size                                         | Measured — they do **not**, see §4.2                            |
| R3  | Use the hash as a sub-folder so several versions of the same path can coexist                       | Implemented — `<directory>/<hash>/`                             |
| R4  | Do not duplicate the path: `log-home-box-hive-telegram-bot/home-box-…` → `home-box/<hash>/file.ext` | Implemented — stored file name is the base name                 |
| R5  | If the same hash + name + path already exists, link to the file that actually exists                | Implemented — the folder listing is checked for the file itself |
| R6  | Find out why the reported raw URL 404s                                                              | Explained — private-repo token expiry, see §4.3                 |
| R7  | Compile all data into `docs/case-studies/issue-38` and do a deep analysis                           | This document                                                   |
| R8  | If data is insufficient, add debug output / verbose mode for the next iteration                     | Added — see §6                                                  |
| R9  | Report issues to other affected projects with reproducible examples                                 | Assessed — none needed, see §7                                  |
| R10 | Apply the fix to the entire codebase, not one place                                                 | Applied to shared, dedicated, dry and fallback paths, see §5.4  |
| R11 | Do everything in this single pull request                                                           | PR #39                                                          |

## 4. Root cause analysis

### 4.1 R1/R3/R4/R5 — path-only deduplication (the actual bug)

Before the fix, `uploadAsSharedRepo()` computed the target folder from the file
path alone:

```js
const repositoryPath = generateRepoName(filePath); // log-home-box-hive-telegram-bot
const existingContents = await getRepositoryFolderContents(/* … */, repositoryPath);
if (existingContents) {
  return buildSharedRepositoryResult({ /* … */ deduplicated: true });
}
```

Three defects follow from those four lines:

1. **Content is never compared.** The folder name is a pure function of the
   path, so the second upload of `/home/box/hive-telegram-bot.log` always finds
   the folder created by the first upload — whatever is inside it. This is the
   reported bug: the 31 MB log was dropped and a link to the 26.8 MB log was
   printed as if it were the new upload.
2. **Only one version can ever exist.** Even a correct overwrite would destroy
   the previous version, and log files are exactly the kind of artifact where
   several versions matter.
3. **A truthy folder is not a valid upload.** Any non-empty listing counted as
   "already uploaded", including a folder left behind by an upload that died
   after the first commit but before pushing the log itself.

The path was also duplicated: the folder was `log-home-box-hive-telegram-bot`
_and_ the file inside it was `home-box-hive-telegram-bot.log.txt` — the full
path appeared twice in the URL, plus a `log-` prefix that carries no
information in a repository that is already called `private-logs`.

### 4.2 R2 — gists do accept files of that size

Measured with [`experiments/gist-size-limit-probe.mjs`](../../../experiments/gist-size-limit-probe.mjs)
against the real API (`gh gist create`), each gist deleted afterwards. Raw
results: [`gist-size-limit-probe-run1.json`](./gist-size-limit-probe-run1.json),
[`run2`](./gist-size-limit-probe-run2.json), [`run3`](./gist-size-limit-probe-run3.json).

| Size                                            | Result                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1, 10, 25, 26, 31, 40, 60, 75, 100, 101, 102 MB | created successfully                                                                      |
| 50 MB                                           | succeeded twice, failed once with `HTTP 504: We couldn't respond to your request in time` |
| 90 MB                                           | failed once with `HTTP 502: Server Error`, succeeded on a later attempt                   |
| 104, 105, 110 MB                                | failed every time with `HTTP 502: Server Error`                                           |

Conclusions:

- The 31 MB file from the issue **would have worked as a gist**. The 25 MB
  threshold in this tool is a self-imposed default (added in issue #19 after
  502s), not an API limit.
- The real API boundary sits at GitHub's documented **100 MB per gist file**;
  everything above ~102 MB failed deterministically, everything below failed
  only intermittently.
- Failures between 26 MB and 102 MB are **transient**, not size related — the
  same size succeeds on retry. Treating a 502/504 as "too big" is wrong.
- Content is not damaged by size: a 31 MB gist downloaded through its raw URL
  was byte-identical to the source (SHA-256 match,
  [`gist-content-integrity-31mb.json`](./gist-content-integrity-31mb.json)).
  Note that the API metadata marks such files `"truncated": true` — that flag
  refers to the 1 MB inline `content` field in the JSON response, not to the
  stored file. GitHub documents this: the Gist API returns up to 1 MB of content
  per file, and files over 10 MB must be fetched via `git_pull_url` or the raw
  URL.

### 4.3 R6 — why the raw URL returned 404

The user reported that both of these 404:

```
https://raw.githubusercontent.com/konard/private-logs/main/log-home-box-hive-telegram-bot/home-box-hive-telegram-bot.log.txt
…same URL…?token=<redacted>
```

Measured ([`raw-url-probe.json`](./raw-url-probe.json)):

| URL                                              | Status          |
| ------------------------------------------------ | --------------- |
| `download_url` from the API (contains `?token=`) | **206** (works) |
| the same URL with the token removed              | **404**         |

So the file is there and reachable; there are two independent reasons for what
the user saw:

1. **Private repositories have no permanent raw URL.** `raw.githubusercontent.com`
   only serves private content with a short-lived signed `token` query
   parameter that GitHub issues in `download_url`. Once it expires the URL
   returns 404 (GitHub answers 404 rather than 403 so unauthenticated clients
   learn nothing about private content). The CLI already warned about this, but
   the warning is easy to miss and the tool offered no way to check.
2. **Even a fresh token pointed at the wrong content**, because of §4.1 — the
   URL belonged to the stale 26.8 MB upload.

This is GitHub behavior, not a bug in this tool. The permanent link for private
uploads is the repository page URL (`/tree/<branch>/<path>`), which requires a
logged-in browser session. Public uploads have stable, token-free raw URLs.

### 4.4 R8 — what made this hard to diagnose

The tool printed `ℹ️ Repository already exists` and nothing else: no content
hash, no folder listing, no indication of _which_ file the message referred to.
Verbose mode did not log the deduplication decision either, so from the output
alone one could not tell "already uploaded" from "silently skipped".

## 5. The fix

### 5.1 Content-addressed paths (R1, R3, R4, R5)

```
<normalized-directory>/<first 16 hex chars of SHA-256>/<base-name>.log.txt
```

- `generateLogDirectorySegment()` normalizes only the **directory**
  (`/home/box` → `home-box`), falling back to `root` for files at the
  filesystem root and shortening deterministically at 200 characters.
- `generateFileContentHash()` streams the file through SHA-256 (constant
  memory, works for multi-GB logs) and keeps 16 hex characters — 64 bits, which
  makes an accidental collision irrelevant at this scale.
- `buildLogRepositoryPath()` joins the two.
- Changed content → different hash → different folder → **a real upload**.
- Identical content → same folder → deduplication, and the printed link points
  at a file that was verified to exist in that folder's listing (R5).
- The stored file keeps its own name, so the path is no longer duplicated and
  the `log-` prefix is gone from the path (R4).

### 5.2 Existence is checked per file, not per folder

`isStoredLogFileName()` matches the exact stored name and the `…​.part-NNN.log.txt`
chunk names. A folder that exists but does not contain the expected file (a
partial upload) is now uploaded again instead of being reported as complete.

### 5.3 Gist limit and transient errors (R2)

- `--gist-limit` / `GH_UPLOAD_LOG_GIST_LIMIT` makes the threshold configurable
  (`25MB`, `100MB`, `1.5GB`, plain numbers mean MB), clamped to the documented
  100 MB maximum via `resolveGistFileLimit()`.
- The default stays at 25 MB: repository mode is what gives the hashed layout,
  stable page URLs and chunking, and it is what the issue asks for. Users who
  prefer a single gist link can now opt in explicitly.
- `isTransientGistError()` recognizes 502/503/504 and the "couldn't respond in
  time" wording, and gist creation retries instead of failing — this is what
  actually caused the 502s that led to the 25 MB default in issue #19.

### 5.4 Applied everywhere (R10)

| Code path                  | Change                                                                   |
| -------------------------- | ------------------------------------------------------------------------ |
| `uploadAsSharedRepo`       | hashed path, per-file existence check, debug output                      |
| `uploadAsDedicatedRepo`    | same hashed path inside the dedicated repository                         |
| `uploadLog` dry mode       | reports the hash and the real target path for both modes                 |
| gist → repository fallback | inherits the repository behavior above                                   |
| `splitFileIntoChunks`      | chunk names derive from the stored file name                             |
| `self-test` cleanup        | refuses to delete the shared `private-logs` / `public-logs` repositories |

### 5.5 Verification (R8 + tests)

- `test/issue-38.test.js` — 12 regression tests: changed content uploads again
  into a new folder, identical content deduplicates without pushing, a folder
  missing the file is uploaded again, the issue's own example maps to
  `home-box/<hash>/hive-telegram-bot.log.txt`, chunk-name matching, gist limit
  parsing/clamping, transient-error detection and gist retry.
- New debug output (verbose mode): content hash, repository path, stored file
  name, the deduplication decision and why, and retry notices.
- `--check-raw-url` performs a ranged `GET` on the produced raw URL and reports
  whether it is actually reachable, with a hint about private-repo tokens.
- `examples/changed-file-reupload.js` demonstrates the whole behavior offline
  in dry mode.

## 6. Existing components and libraries considered

| Option                                                                            | Why it was not used                                                                                                                                                                                              |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`npm/cacache`](https://github.com/npm/cacache) — npm's content-addressable cache | Solves the same _idea_ (SRI-keyed content addressing, dedup), but it owns an on-disk cache layout with its own index; here the "store" is a GitHub repository tree and the path must stay human readable         |
| `git-lfs`                                                                         | Content addressed by design, but requires LFS to be enabled on the shared repositories and quota that private users may not have; also hides the file behind a pointer, breaking the "open the raw URL" workflow |
| `hasha`, `object-hash` and similar hashing helpers                                | Node's built-in `crypto.createHash('sha256')` over a read stream is already streaming and dependency-free; adding a dependency for six lines is not worth it                                                     |
| Git's own object hash (`git hash-object`)                                         | Would require the file to be in a repository before deciding where to put it, i.e. the expensive staging step this fix avoids                                                                                    |
| Multihash / IPFS CIDs                                                             | Standardized content addressing, but produces long base32 names and pulls in a large dependency for no gain inside a GitHub path                                                                                 |

Decision: streaming SHA-256 from `node:crypto`, truncated to 16 hex characters,
matching the tool's existing zero-dependency-for-core-logic style.

## 7. Issues to report to other projects (R9)

None. Each behavior we hit belongs to one of these categories:

- **Documented GitHub behavior** — the private-repo raw URL token expiry (§4.3)
  and the 1 MB inline content / 10 MB API threshold for gists (§4.2). Working
  as designed and documented.
- **Server-side flakiness we can only mitigate** — the intermittent 502/504 on
  large gist creation. It is not deterministic and not reproducible on demand,
  so a bug report would carry no reproducible example; the retry in §5.3 is the
  appropriate workaround. The measured deterministic boundary (~102 MB accepted,
  ≥104 MB rejected) is consistent with the documented 100 MB limit.
- **Bugs in this repository** — everything else, fixed in PR #39.

The `command-stream` `cd`-versus-`cwd` behavior relevant to this codebase was
already reported as
[link-foundation/command-stream#50](https://github.com/link-foundation/command-stream/issues/50)
and is handled here by using the `cwd` option.

## 8. Migration note

Logs uploaded before this change stay where they are, under the old
`log-<flattened-path>/` folders. New uploads use the hashed layout. Nothing is
deleted or rewritten, and the two layouts coexist; the old folders are simply
never written to again.

## 9. Files in this folder

| File                                    | Content                                              |
| --------------------------------------- | ---------------------------------------------------- |
| `issue-details.json`                    | Issue #38 as returned by the API                     |
| `issue-comments.json`                   | Comments on the issue (empty)                        |
| `pr-39.json`                            | The prepared pull request                            |
| `recent-merged-prs.json`                | Recently merged PRs, used to match style/conventions |
| `private-logs-repo.json`                | Metadata of the affected shared repository           |
| `private-logs-root-contents.json`       | Root listing of `konard/private-logs`                |
| `folder-contents.json`                  | The affected folder: one 26,797,306 byte file        |
| `folder-commits.json`                   | The affected folder: exactly one commit              |
| `raw-url-probe.json`                    | Raw URL status with and without the token            |
| `gist-size-limit-probe-run{1,2,3}.json` | Gist creation results per size                       |
| `gist-content-integrity-31mb.json`      | 31 MB gist round-trip, SHA-256 comparison            |

## Sources

- [Repository limits — GitHub Docs](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits)
- [About large files on GitHub — GitHub Docs](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
- [Gists API — up to 1 MB of content per file, `git_pull_url` for files over 10 MB](https://docs.github.com/en/rest/gists/gists)
- [gist restrictions · community discussion #147837](https://github.com/orgs/community/discussions/147837)
- [Raw file URL of a private repository · community discussion #23845](https://github.com/orgs/community/discussions/23845)
- [Accessing raw content of a private repo · community discussion #24744](https://github.com/orgs/community/discussions/24744)
- [npm/cacache — content-addressable cache](https://github.com/npm/cacache)
- [link-foundation/command-stream#50](https://github.com/link-foundation/command-stream/issues/50)
