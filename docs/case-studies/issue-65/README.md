# Issue 65: sanitization hangs on logs containing `default = [...]`

Issue: https://github.com/link-foundation/gh-upload-log/issues/65

PR: https://github.com/link-foundation/gh-upload-log/pull/66

Upstream: https://github.com/link-foundation/sensitive-data-sanitizer/issues/176

## Root cause

`releaseBoundary` and `advanceCredentials` in
`@link-foundation/sensitive-data-sanitizer` `src/stream.js` are unchanged from
0.22.1 through 0.22.3 and `main` at 661d706. The library opens a netrc block
on any line that matches this pattern:

```js
/^\s*(?:machine\s+\S+|default)(?:\s|$)/;
```

It closes the block only when a complete
`(machine <host>|default) login <user> password <value>` entry follows it.

Both `default = ["macro"]` (a Cargo features table) and
`machine learning is fun` open a block that never closes. From then on the
library releases nothing more. For every following line it slices the held
text from the start of the block and runs a regex over it. Each scan is
therefore O(lines × held bytes), and the held text grows to cover the rest of
the file.

## Reproduction

`experiments/issue-65-netrc-bench.mjs` compares plain logs with the same logs
prefixed by `default = ["macro"]`, through `sanitizeFileToFile` and through
`withSanitizedUpload`. Nothing is uploaded.

On `main`, [benchmark-before.txt](evidence/benchmark-before.txt) shows the time
growing by about 4× for every doubling of the input. At 32000 lines, a plain
log takes 0.9 s and the triggered log takes 27.6 s.

The regression test takes 64000 lines. Without the fix it times out after 30 s
([regression-test-before.txt](evidence/regression-test-before.txt)).

With the fix, `withSanitizedUpload` is linear again
([benchmark-after.txt](evidence/benchmark-after.txt)): 1.6 s for the triggered
log at 32000 lines. The `sanitizeFileToFile` column is the library alone, so it
still shows the upstream behaviour.

## Requirement inventory

| Issue requirement                                        | Where                                                                                    | Verification                                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `gh-upload-log` must not hang on `default = [...]`       | `src/sanitization-segments.js`, used by `withSanitizedUpload`                            | `test/issue-65.test.js`: 66000 lines with two trigger kinds finish in a few seconds; times out without the fix |
| Do not treat `default = …` / `machine <word> …` as netrc | `advanceNetrc` tracks the token sequence and drops it on the first token that breaks it  | Unit test covers `default = ["macro"]`, `default LocaleContext`, `machine learning`, and genuine entries       |
| No re-scanning of the whole pending buffer               | Cuts keep the library's held span under about 64 KiB per segment                         | Benchmark after                                                                                                |
| Regression test with a timeout                           | `test/issue-65.test.js` (30 s test timeout, 25 s assertion)                              | Fails before, passes after                                                                                     |
| Fix the sanitizer state machine and release it           | Reported as sensitive-data-sanitizer#176, with the proposed token-sequence fix and tests | **Blocked upstream.** No release with the fix exists yet (latest is 0.22.3)                                    |
| Bump the sanitizer dependency once it is fixed           | Not done, because no fixed release exists                                                | **Blocked upstream** on the item above                                                                         |

## Design

`sanitizeFileInSegments` first reads the file once, line by line, and decides
where to cut it. A cut is allowed only after a line that matched the library's
netrc start pattern, at least 64 KiB later, and at a line end where the library
would release a batch anyway:

- no open `"` or `'` quote (the library's own quote rules);
- not inside a PEM private key or a PuTTY key block;
- not after a line that may be wrapped base64;
- not inside a genuine `machine … login … password …` entry that could still
  complete.

Each segment then goes through `sanitizeStream`. The output is written in
order to the private temporary file. Each cut costs about 2 ms
(`experiments/issue-65-call-overhead.mjs`), and cuts are at least 64 KiB apart.

The scan that chooses cuts reads about 33 MiB/s: 50 MiB in 1.5 s
(`experiments/issue-65-scan-cost.mjs`).

Files without a trigger line produce no cuts. They still get exactly one
`sanitizeFileToFile` call, as before. The last segment keeps the original size
bound, so a file that grows during the scan still fails with
`ERR_INPUT_CHANGED` instead of being silently truncated.

A test compares the segmented output with the single library pass, byte for
byte, on a mixed log. The log contains tokens, `password=`, a multi-line netrc
entry, invalid UTF-8 and both trigger kinds. Another test checks that no cut
lands inside a PEM key, a multi-line quoted value or a netrc entry.

## Limits

- If a quote stays open for the rest of the file, no cut is allowed after it.
  This happens with an unmatched `"`, or a `'` that follows a non-letter. The
  library holds that text as one record anyway, so a trigger after it still
  costs quadratic time in the library. Only the upstream fix removes that case.
- Set `DEBUG=gh-upload:segments` to print the chosen cut offsets.
- Remove the workaround once a sanitizer release fixes #176 and
  `gh-upload-log` depends on it.
