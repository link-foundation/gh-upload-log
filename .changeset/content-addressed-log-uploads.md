---
'gh-upload-log': minor
---

Upload a log again when its content changed, even if the same path was uploaded before (#38).

Repository-mode uploads are now content addressed: logs are stored as
`<normalized-directory>/<content-hash>/<file-name>.log.txt` instead of
`log-<flattened-path>/<flattened-path>.log.txt`. A changed file gets a new hash
folder and is uploaded again, identical content is deduplicated and links to the
file that actually exists, and the path is no longer duplicated in the folder and
file names.

- Deduplication now checks that the expected file exists in the folder, so a
  partial upload is retried instead of being reported as complete.
- New `--gist-limit` / `GH_UPLOAD_LOG_GIST_LIMIT` option to configure the gist
  size threshold (clamped to GitHub's documented 100MB per gist file).
- Gist creation retries on transient `502`/`503`/`504` responses instead of failing.
- New `--check-raw-url` / `GH_UPLOAD_LOG_CHECK_RAW_URL` option verifies that the
  reported raw URL is reachable, with a hint about private-repository token expiry.
- Verbose mode reports the content hash, stored file name and deduplication decision.
- `self-test` cleanup refuses to delete the shared `private-logs`/`public-logs`
  repositories.
