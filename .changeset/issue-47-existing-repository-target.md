---
'gh-upload-log': minor
---

Add explicit existing repository and branch targets for installation-token uploads without querying the authenticated user or creating repositories. Keep repository reads scoped to the selected branch and distinguish permanent Gist permission failures from retryable rate limits.
