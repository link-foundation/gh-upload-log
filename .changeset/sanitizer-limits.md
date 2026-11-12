---
'gh-upload-file': patch
---

Upgrade `@link-foundation/sensitive-data-sanitizer` to `^0.22.1` so dense base64 logs no longer fail with `ERR_LIMIT`. Bound records by the file size instead of 64 MiB, scan once and count redactions only in changed lines. Split sanitizer limits into `ERR_DETECTOR_LIMIT` (not retryable, exit 65) and `ERR_INPUT_CHANGED` (retryable, exit 75), expose `reason`, `retryable`, `exitCode` and `SANITIZATION_EXIT_CODES`, and report the longest record.
