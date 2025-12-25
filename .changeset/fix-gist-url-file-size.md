---
'gh-upload-log': patch
---

fix: Gist URL capture and human-readable file size display

- Fix gist URL not being captured due to empty string interpolation in command-stream template literal
- Add formatFileSize() function for human-readable file sizes (e.g., "1.90 KB" instead of "0.00 MB")
- Improve CLI output with better formatting and file info display before upload
- Add comprehensive tests for formatFileSize function
