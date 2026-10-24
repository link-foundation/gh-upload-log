# Issues #55–57: upload sanitization and npm delivery

All work belongs to [PR #58](https://github.com/link-foundation/gh-upload-log/pull/58).
The parent, both native sub-issues, every issue comment, and all three PR feedback
endpoints were read on 2026-10-24. They contained no comments or reviews. The
upstream sanitizer issues [#41](https://github.com/link-foundation/sensitive-data-sanitizer/issues/41)
and [#42](https://github.com/link-foundation/sensitive-data-sanitizer/issues/42)
are closed, with no comments, and their APIs are available in published npm
version 0.12.1. References to start#250 and hive-mind#3740 describe parallel
adoptions, not sub-issues requiring changes to those other repositories here.

## Requirement inventory, possible solutions and chosen plans

| Requirement                                                                       | Options and chosen implementation                                                                                                                         | Verification / status                                                                                                                  |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| #57: read every listed issue and comment, complete both in one PR                 | Read GitHub REST issue/sub-issue and all PR feedback endpoints; keep a single requirement inventory and branch                                            | #55 and #56 are the complete native and prose scope; all work in PR #58                                                                |
| #57: close parent and each required issue independently                           | Add a positive closing keyword for each issue outside examples                                                                                            | PR body must retain `Fixes #55`, `Fixes #56`, `Fixes #57` even while blockers remain explicit                                          |
| #57: explicitly identify already-resolved/nonreproducible work                    | Recheck actual registry/API state rather than relying on historical reports                                                                               | Upstream dependencies are resolved; the local unsanitized upload and npm E404 both reproduce                                           |
| #55: use link-foundation/sensitive-data-sanitizer for every upload                | Caller-specific regexes would retain divergent behavior; instead depend on exact npm 0.12.1 and wrap every public uploader with the shared library        | Regression test inspects actual staged gist and repository bytes for uploadLog/uploadFile/uploadAsGist/uploadAsRepo                    |
| #55: sanitize before anything leaves the machine, including public uploads        | Uploading chunks as they are scanned risks leaking a partially verified file; stage the entire verified output privately, then begin any GitHub operation | Public/private gists, shared/dedicated/existing repos, fallback and dedup paths all pass through the same gate                         |
| #55: streaming for 17–87 MB logs and 15 MB lines                                  | Whole-file string sanitization is unnecessary; use upstream atomic streaming file API with 64 KiB reads and bounded records                               | Finite experiment `experiments/issue-55-streaming.mjs` creates 17/87 MiB files with a 15 MiB line; checks exact expected output hashes |
| #55 / upstream #41: keep non-UTF-8 and binary bytes                               | Rejecting binary input would remove an existing feature; use upstream reversible byte mapping and `allowBinary: true`, then preserve gzip/chunk behavior  | Regression decompresses archive parts and compares every noncredential byte, including NUL, invalid UTF-8 and CRLF                     |
| #55: failure uploads nothing and says why                                         | Continuing with raw input would violate the requirement; propagate safe upstream error codes, destroy private staging, and never enter routing on failure | Malformed local credential YAML yields ERR_AUTH, zero GitHub commands, and a clear CLI error                                           |
| #55: mask credentials only; preserve public account details and all other content | Full publication profile would mask account data; choose `credentialsOnly: true` and complete credential redaction                                        | Exact expected byte comparisons retain github.com/konard, email, account ID and ordinary text                                          |
| #55 / upstream #42: reusable local credential protection                          | Use upstream environment discovery and gh hosts.yml reader rather than duplicating either implementation                                                  | Exact unknown-format environment values and local credential-file values are included; malformed configuration blocks upload           |
| #55: CLI reports counts per rule and complete upload                              | Count original-pass findings by upstream rule plus merged redaction spans and input/output bytes; expose same summary to library callers                  | CLI always prints summary and rule counts, including zero; counts may overlap when multiple detectors identify the same span           |
| #55: preserve complete-file identity and existing routing behavior                | Compute strategy, repository content hash, dedup identity, splitting and gzip from verified bytes; retain original path only for naming                   | Dry mode and real repository tests verify the safe hash and original directory segment; fallback reuses one verified snapshot          |
| #56: diagnose repeated npm E404 since rename                                      | Compare historical release logs and live registry; npm trust requires an existing package                                                                 | Run 39507532219 contains E404 for gh-upload-file@0.12.1; live registry 404; owner access is absent                                     |
| #56.1: first-publish gh-upload-file using an authorized npm account and 2FA       | Token fallback cannot manufacture account authority; provide inspected dual package artifacts and exact owner commands                                    | **Blocked:** npm whoami returns ENEEDAUTH; gh-upload-file remains absent. No publication is claimed                                    |
| #56.2: configure gh-upload-file trusted publisher for repository/release.yml      | npm trust CLI >=11.15.0 or npmjs.com settings; retain tokenless OIDC workflow                                                                             | **Blocked:** package must first exist and the account owner must authorize trust                                                       |
| #56.3: decide compatibility package policy                                        | Deprecation or synchronized alias releases are allowed; retain existing synchronized `gh-upload-log` alias with all three commands                        | Existing dual-package tests validate same version/source/bins and partial-release recovery; no caller migration needed                 |
| #56.4: rerun release or push a changeset and reach users                          | Add one minor changeset for default credential sanitization; retain version visibility checks before GitHub release outputs                               | Changeset prepares both names; actual npm delivery and GitHub release remain **blocked**, not verified by PR tests                     |
| #56: avoid repeated release failures from missing owner setup                     | Add uncached package-existence preflight before versioning in both main and manual release jobs; fail explicitly without consuming changesets             | Mock tests cover absent/existing names, metadata mismatch and registry outages; live preflight fails with owner instructions           |
| Cross-codebase correctness, release preparation and local/CI verification         | Audit upload exports/aliases and all release entry points; use established tests/Changesets rather than a second framework                                | Full local checks, current-head CI and final self-review are recorded in the PR                                                        |

## Research and component comparison

The selected [sanitizer API](https://github.com/link-foundation/sensitive-data-sanitizer/blob/main/docs/API.md)
provides streaming, credentials-only filtering, reversible invalid-byte mapping,
local credential discovery, required Secretlint plus bundled Gitleaks rules,
and residual verification. Reusing it meets the explicit library requirement;
calling Secretlint or Gitleaks directly would require rebuilding streaming,
context, local-secret and verification logic. No cloud detector is needed.
Node's stream/file APIs provide local staging and cleanup without another
package. The upstream custom-sanitizer callback collects original findings;
the streaming file API verifies that callback's output again before publishing
the local copy. Rule hits can overlap and therefore need not sum to merged
redaction spans. No matched values or excerpts are logged.

Streaming retains incomplete logical records (including multiline credentials),
so memory depends on the largest held record. Records above 64 MiB or upstream
finding limits fail closed with ERR_LIMIT, never truncated uploads. Total bytes
are bounded to the source's initial size, preventing an endlessly growing log
from running forever. A new source snapshot is sanitized for each top-level
call; nested routing and retries reuse the verified copy. The original file is
not modified. Binary contents are scanned as reversible plain log bytes before
gzip; encrypted/compressed contents are not recursively decoded by this tool.

[npm documents](https://docs.npmjs.com/cli/v11/commands/npm-trust/) that trust
configuration requires an existing package and authorized account with 2FA.
The E404 mechanism is consistent with this prerequisite; E404 by itself does
not prove which registry authorization check failed. Modern npm and Node are
already configured in this repository. Updating them again or adding blind
retries cannot create the package. The established Changesets, dual-manifest
publisher and uncached exact-version verifier remain useful and are retained.
[Owner recovery](../../npm-publishing.md) describes both npm trust and the
existing package-registry-manager alternative.

## Reproduction and verification

```sh
bun test test/issue-55.test.js test/issue-56.test.js
node --max-old-space-size=640 experiments/issue-55-streaming.mjs
bun scripts/check-npm-publishing.mjs
bun test
bun run check
```

Before implementation, the upload suite had eight failures: uploaded bytes
retained credentials, dry hashes used raw content, and malformed sanitizer
configuration did not block uploads. The release preflight regression failed
because the preflight did not exist. Historical run 39507532219 proves the
actual npm publication failure, including E404 at log lines 5313, 5795 and 6257.
The prepared PR run 40068731692 (2026-10-24 06:04:11 UTC, SHA ba2cadf) failed
only for a missing changeset, at log lines 244–246. This run predates fixes.
Large command logs are preserved locally in `ci-logs/` and
`experiments/output/`; concise durable evidence is recorded below and in the PR.

Local verification on Linux with Bun 1.4.3 and Node 26.12.1 passed all 200 tests,
formatting, lint and the 1,000-line JavaScript file limit. The finite streaming
probe used Node's `--max-old-space-size=640` and checked the SHA-256 of every
output byte against an independently generated expected stream:

| Input  | Largest line | Elapsed  | Input / output bytes    | Merged redactions |
| ------ | ------------ | -------- | ----------------------- | ----------------- |
| 17 MiB | 15 MiB       | 17.790 s | 17,825,792 / 17,825,776 | 1                 |
| 87 MiB | 15 MiB       | 99.627 s | 91,226,112 / 91,226,096 | 1                 |

Both reported one `context` and one `gitleaks/generic-api-key` hit for the same
span. Peak child RSS measured by `resource.getrusage(RUSAGE_CHILDREN)` was
365,264 KiB (about 357 MiB); the process exited successfully. This is bounded
record streaming, not constant memory independent of record size. The 17 MiB /
15 MiB case is also an automated regression on every CI operating system.

The package smoke experiment prepared the planned 0.13.0 for both names, packed
and locally installed each tarball, imported the library, and executed
`gh-upload`, `gh-upload-file` and `gh-upload-log` with the expected version and
binary archive dry-run metadata. Each tarball includes `src/sanitization.js`
and the pinned sanitizer dependency. Both `npm publish --dry-run` checks pass;
these are artifact checks, not claims of npm authorization or publication.

Self-review also caught the file API's symbolic-link refusal, which would have
removed an existing input form. Its regression first reproduced ERR_FILE and
zero uploads. The gate now resolves the target before scanning while retaining
the caller's path for naming; tests verify masked bytes, the link's filename,
and an unchanged source. The upstream API still requires a regular input file.

## Windows CI investigation

Run [40070014299](https://github.com/link-foundation/gh-upload-log/actions/runs/40070014299)
passed on all three operating systems at e51bb97. The subsequent run
[40070269183](https://github.com/link-foundation/gh-upload-log/actions/runs/40070269183),
created at 06:27:18 UTC for 6c8bf0f, passed Linux, macOS, lint and changesets,
but Windows's existing CLI description test hit Bun's implicit 5,000 ms deadline.
Downloaded log lines 2868–2870 record the killed child and timeout. Other Windows
CLI invocations took about 0.4–0.5 seconds; the logs do not establish why this one
process was delayed. They contain no child output from the timed-out test.

The CLI harness had no child deadline or timeout diagnostics, and used the
`test-anywhere` wrapper that drops native timeout settings (already investigated
in issue #49). A finite six-second Node preload reproduces its five-second
failure before the fix. CLI tests now use the established native test helper
with a 20-second deadline. A separate 15-second child deadline kills the process
and waits for closure, retaining command arguments, stdout and stderr in the
error. A regression verifies child termination; the slow-start regression
verifies an actual description upload dry run still completes after six seconds.
This bounds failures and makes a recurring stall diagnosable instead of silently
relying on a global timeout increase or a blind CI retry.

The npm owner criteria remain unfinished. Passing PR CI cannot resolve npm
account setup, prove a release has reached users, or justify merging this PR.
