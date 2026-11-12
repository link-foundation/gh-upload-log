---
'gh-upload-file': patch
---

Logs containing a line such as `default = ["macro"]` or `machine learning …` no longer hang during sanitization. sensitive-data-sanitizer 0.22.x treats those lines as the start of a netrc entry that never completes, holds the rest of the file and rescans it on every line, which is quadratic. When a file contains such a line, `gh-upload-log` now sanitizes it in segments. Each cut falls at a line end where the library would release a batch anyway, and never inside a PEM, PuTTY, quoted, wrapped-base64 or genuine netrc record. Files without such a line still use one library pass. Upstream: link-foundation/sensitive-data-sanitizer#176.
