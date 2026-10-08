# Issue 37: universal file uploads and both npm names

[Issue](https://github.com/link-foundation/gh-upload-log/issues/37) ·
[Pull request](https://github.com/link-foundation/gh-upload-log/pull/51)

## Problem and reproduction

The original strategy looked only at file size. A four-byte binary input
`[0, 255, 128, 10]` selected a Gist, while repository staging always named
input `.log.txt` and sent it through text-oriented splitting. Package metadata,
the CLI bin, publication checks, and changeset helpers used only `gh-upload-log`.

The initial reproducing tests ran before implementation:

```bash
bun test test/issue-37.test.js test/issue-37-publish.test.js
```

They reported **0 passing, 13 failing** tests. The
[saved output](./reproduction-before.txt) includes `gist !== repo`,
`data.bin.log.txt` instead of `data.bin.gz`, and missing publication functions.

Initial CI also failed before running the tests. Run
[37767103591](https://github.com/link-foundation/gh-upload-log/actions/runs/37767103591)
started at `2026-10-08T10:59:28Z` for commit
`1b9abd97ff5d6f79d54291d6aabeb167bbaa28a4`. The preserved local log
`ci-logs/checks-release-37767103591.log`, lines 239–240, compares that commit
with main `0de1feb4e7d96a316ec32308942f6c4f6ac033c8` and reports
`No changeset found in this PR`. This change adds one minor changeset for the
renamed manifest and makes validation/merging read the manifest name.

## Name investigation and publication

Uncached npm registry requests on `2026-10-08T11:02:57Z`–`11:02:58Z`
returned HTTP 404 for all eight candidates:

| Candidate family | Checked names                                                        |
| ---------------- | -------------------------------------------------------------------- |
| Universal        | `gh-upload`, `ghupload`, `gh_upload`, `gh.upload`                    |
| File-specific    | `gh-upload-file`, `ghuploadfile`, `gh_upload_file`, `gh.upload.file` |

The [recorded responses](./npm-names.json) and
[repeatable probe](../../../experiments/issue-37-name-check.mjs) retain timestamps.
`gh-upload` is lowercase, URL-safe and within npm's length limit. Those syntax
rules and npm's similarity policy are described in the
[package metadata documentation](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)
and [name guidelines](https://docs.npmjs.com/package-name-guidelines/).
A 404 and a successful dry publish do not reserve the name or guarantee the
first real publication passes npm's server-side policy.

The root manifest now uses `gh-upload` and `publishAliases: ['gh-upload-log']`.
The release script copies the same source and version into one manifest per
name. Both expose `gh-upload` and `gh-upload-log` bins. Publishing retains
independent exact-version guards, retries, and recovery when npm has published
but its command acknowledgement failed. No release success output is emitted
until every package is visible through a unique-query, no-cache registry check.
After a successful command, each package has up to 31 visibility attempts,
10 seconds apart. A 404 means absent; registry errors fail the release.

The new name needs an authenticated first publication and its own trusted
publisher setup; npm's
[trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/)
describes the package-specific configuration. No real npm publication was
performed during this issue fix. Before automatic releases, a maintainer can
use the pushed PR manifest with browser approval:

```bash
package-registry-manager setup --repository /path/to/gh-upload-log \
  --registry npm --package gh-upload --ref 51 --execute
```

Select the existing `release.yml` workflow in its reviewed plan. Configure
trust for both package names against that workflow. The bootstrap may publish
the PR's current version, `0.10.1`; the minor changeset plans `0.11.0` for the
merged release. An already-published exact version is skipped on retries.
See [package-registry-manager's setup instructions](https://github.com/link-foundation/package-registry-manager/blob/main/docs/registry-setup.md).

## File format decisions

Classification validates the complete file with a streaming UTF-8 decoder and
a 64KB buffer. ANSI escapes, tabs, CRLF, and a missing final newline remain
text. Invalid UTF-8, NUL, and other binary control bytes select binary handling.
File extensions do not override content. Empty files are text; UTF-16 input
with NUL bytes is archived without conversion.

Text retains the existing Gist threshold, `.log.txt` naming, line-aware
splitting, UTF-8 boundary handling and byte preservation. Binary input always
uses a repository, with a deterministic streaming gzip archive. `onlyGist`
rejects binary input before any GitHub command. `uploadFile` aliases `uploadLog`;
the existing API and environment names remain available.

The chunk limit applies to compressed bytes, including gzip headers/trailers.
An archive is stored as `<original-name>.gz` or numbered
`<original-name>.gz.part-00` files. Part numbering expands beyond 100 parts so
sorting stays correct. Concatenate all parts in filename order before gunzip.
The hash folder still uses the original bytes. Archives retain shared/explicit
repository retries, per-part pushes, pending/completion markers and resumption.
Original byte-size totals cannot establish completion of a gzip upload.

Dry mode hashes and classifies without compressing. Its part count is an
estimate; compression can shrink or expand input. Gzip staging uses bounded
buffers and needs temporary disk space for the archive and its parts.

## Optional image backend investigation

The [gh-upload-image implementation](https://github.com/link-foundation/gh-upload-image)
uses GitHub's undocumented `/upload/policies/assets` web endpoint, followed by
an asset upload. A bounded policy-only probe for a 70-byte PNG, using the
current `gh` authentication and this repository, returned **HTTP 422 with
HTML** at `2026-10-08T11:08:47.227Z`. It uploaded no file.
The [result](./image-policy.json) and
[probe](../../../experiments/issue-37-image-policy.mjs) are preserved.

This does not verify an end-to-end image backend. The optional integration is
therefore deferred; images use the same verified gzip repository path as other
binary inputs. An authenticated GitHub web-session asset flow remains outside
the validated behavior of this change.

## Validation

Automated regressions cover all byte values, archive overhead, hundreds of
ordered parts, deterministic archives, hidden filenames, buffer-boundary UTF-8,
late binary bytes, direct/dry Gist rejection, shared/dedicated mode, archive
deduplication, long text filenames, universal/legacy CLI configuration, changeset merging, partial
publication, delayed registry visibility and release output gating.

The offline real Git scenario interrupts a binary upload, resumes it with a
different chunk size, reconstructs exact bytes from the remote, preserves the
selected branch's existing files and main, and verifies deduplication:

```bash
bun test
bun run check
node experiments/issue-37-git-roundtrip.mjs
node --max-old-space-size=192 experiments/issue-37-archive-roundtrip.mjs
node experiments/issue-37-package-smoke.mjs
```

The finite large-file probe used **104,923,136 random bytes**. Its archived
parts were **104,857,600** and **97,579 bytes**; streamed decompression recovered
the original size and SHA-256. Peak RSS was **88,555,520 bytes** on this Linux
run, with a 192MB V8 heap limit. The
[recorded result](./large-roundtrip.json) is an observation, not a memory
guarantee for other runtimes.

The package smoke probe uses Changesets' planned `0.11.0`, packs and installs
each name independently, imports the public API, and runs both actual installed
bins for version and binary dry mode. Both npm dry-publication checks passed;
see the [artifact results](./package-smoke.json). The previously published
legacy `0.10.1` correctly fails npm's immutable-version dry-publish check, so the
probe uses the planned release version rather than reusing it.

The full local suite reports **181 passing, 0 failing** tests. ESLint,
Prettier, the 1000-line source limit, and frozen Bun installation pass. Existing
large-text tests formerly used sparse NUL-filled fixtures; those now generate
bounded-buffer ASCII text so they continue to test text behavior under the
content-aware strategy. Long text parts now use the same shortened basename as
repository metadata, so deduplication and resume recognize them. A separate
regression failed with the mismatched name before this adjustment.
