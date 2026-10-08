---
'gh-upload': minor
---

Publish gh-upload alongside gh-upload-log with both command names and an uploadFile API alias. Automatically archive binary files with streaming gzip and split oversized archives into parts of at most 100 MB, while retaining readable text uploads, retries and resume support. Verify publication of every package name with uncached npm registry checks before creating a release.
