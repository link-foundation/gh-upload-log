---
'gh-upload-log': minor
---

Handle ENOSPC (no space left on device) errors gracefully with actionable error messages, disk cleanup suggestions, and smart fallback prevention. Gist uploads can work without extra disk space; the tool now suggests --only-gist when appropriate.
