---
'gh-upload-log': patch
---

Retry transient shared-repository push failures with exponential backoff and fetch/rebase recovery. Commit and push each log chunk separately, and resume incomplete uploads without treating the first chunk as a complete log. Add `--chunk-size` / `GH_UPLOAD_LOG_CHUNK_SIZE` and the library `chunkSize` option. Split chunks on line boundaries where possible and preserve UTF-8 characters when a line exceeds the byte limit.
