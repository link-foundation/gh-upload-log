---
"gh-upload-log": minor
---

Add direct raw file URL support for single-file uploads

When uploading a single log file (not split into chunks), the tool now displays a direct link to the raw file content in addition to the repository/gist URL.

For gists:
- Returns the permanent `raw_url` from the GitHub API
- This URL is accessible without authentication (even for secret gists)

For repositories:
- Returns the `download_url` from the GitHub API
- For private repositories, includes a token that enables unauthenticated access
- Displays a warning that the token expires in ~10 minutes for private repos

Example output:
```
✅ Gist created (🔒 private)
🔗 https://gist.github.com/user/abc123
📄 https://gist.githubusercontent.com/user/abc123/raw/hash/file.log
```

This enhancement addresses issue #21 and makes it easier to share direct links to uploaded log files.
