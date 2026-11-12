# Issue 63: sanitization refuses large and dense logs with `ERR_LIMIT`

Issue: https://github.com/link-foundation/gh-upload-log/issues/63

PR: https://github.com/link-foundation/gh-upload-log/pull/64

## Findings and reproduction

`experiments/issue-63-repro.mjs` runs only `withSanitizedUpload` with a no-op
upload and publishes nothing. On `main` (0.13.1, sanitizer 0.12.1),
[reproduction-before.txt](evidence/reproduction-before.txt) shows:

- 4000 dense base64 lines pass. 4200 lines fail with `ERR_LIMIT`, because
  sanitizer 0.12.1 blocks above 4096 base64 candidates.
- A 66 MiB JSONL record fails with the same `ERR_LIMIT`, because gh-upload-log
  passed a fixed `maxRecordBytes` of 64 MiB.
- The message can't tell these two causes apart, and it doesn't say whether
  retrying could help.
- 200000 already-masked lines take 83 s. gh-upload-log passed a callback
  `sanitizer` to count redactions, and the library then re-verified the
  callback output, so every byte was scanned twice by the engine.
  `experiments/issue-63-double-pass.mjs` measured 22.4 s against 7.7 s for one
  pass over 50000 masked lines.

On this branch, [reproduction-after.txt](evidence/reproduction-after.txt) shows
all four cases succeed. The masked log takes 32 s and the 66 MiB record 29 s.

## Requirement inventory

| Issue requirement                        | Implementation                                                                                                                                                  | Verification                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Depend on sanitizer `^0.22.1`            | `package.json`, `bun.lock`, `package-lock.json`                                                                                                                 | Test: 4200 dense base64 lines upload; repro after                                                        |
| Records over 64 MiB are not refused      | `maxRecordBytes` and `maxTotalBytes` equal the scanned file size                                                                                                | Test: a 65 MiB record is sanitized byte-identical; repro after (66 MiB)                                  |
| Distinct code or reason per limit        | `ERR_DETECTOR_LIMIT` (size unchanged) and `ERR_INPUT_CHANGED` (file grew); every error has `reason`, `longestRecordBytes` and `cause.code`                      | Tests for both mappings, for `ENOSPC`, `ERR_AUTH`, `ERR_ENGINE` and `ERR_OUTPUT`, and for unknown errors |
| Deterministic failures are not retryable | `retryable` and `exitCode` per code: 65 (`EX_DATAERR`) for deterministic failures, 75 (`EX_TEMPFAIL`) for retryable ones; exported as `SANITIZATION_EXIT_CODES` | CLI test: exit 65 and "retrying the same file cannot succeed"; issue-55 CLI test updated to 65           |
| Mask-heavy logs are slow                 | One verified library pass. Counts rescan only the input lines the output changed, plus 16 lines of context                                                      | Tests: counts match a whole-text scan; masked logs count 0 regions; 83 s becomes 32 s                    |
| Prepare a release                        | Patch changeset                                                                                                                                                 | CI changeset validation                                                                                  |

## Design decisions and limits

Removing the callback means the library's own findings are no longer visible.
The library reports only its output, so `src/sanitization-summary.js` finds the
regions that changed and counts them:

1. It hashes every line of the input and the verified output.
2. It resyncs the two files within a 4096-line lookahead.
3. It sends only the changed lines to the engine, with up to 16 lines
   (4 KiB) of preceding context.
4. It counts only findings that end after the context, and merges overlapping
   spans the same way the sanitizer does.

The counts are informational. The upload's safety still comes from the single
verified pass.

Once both bounds equal the file size, `ERR_LIMIT` can still mean one of two
things:

- The content reached a findings, registry or projection limit. The same bytes
  always fail again.
- The file grew while it was scanned. Comparing the size after the failure tells
  the two apart.

Engine performance itself is tracked upstream in
[sensitive-data-sanitizer#168](https://github.com/link-foundation/sensitive-data-sanitizer/issues/168).

Upgrading exposed a separate upstream regression. Under Node, sanitizer 0.20.0
through 0.22.1 return `ERR_SANITIZATION` for a line of 8 MiB or more of letters,
because a regex overflows V8's backtracking stack. 0.19.0 works. Bun, the CLI's
runtime, is not affected; see [node-long-line.txt](evidence/node-long-line.txt).
It is reported as
[sensitive-data-sanitizer#170](https://github.com/link-foundation/sensitive-data-sanitizer/issues/170).
The issue-55 streaming test now runs under Bun and asserts bounded RSS.

Memory grows with the longest record. A 70 MiB record peaked at 435 MiB RSS and
a 200 MiB record at 882 MiB (`experiments/issue-63-huge-record.mjs`).
