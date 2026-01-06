---
'gh-upload-log': minor
---

Fix gist upload failing with HTTP 502 for large files

- Lower gist threshold from 100MB to 25MB to match GitHub's web interface limit and avoid HTTP 502 errors
- Add validation to detect failed gist creation (empty URL in stdout)
- Add automatic fallback from gist to repository mode when gist upload fails
- Add --test and --quick CLI flags for self-testing upload functionality
- Add test file generator script for different file sizes
- Update unit tests for new behavior
