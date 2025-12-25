---
'gh-upload-log': minor
---

Make output more user friendly with cleaner, shorter format and emojis

- Reduced duplicate information (file size, URL were shown multiple times)
- Added colorful emojis for visual clarity: ⏳ (uploading), ✅ (success), 🔍 (dry run), 🔒 (private), 🌐 (public), 🔗 (URL)
- Moved verbose details (strategy, mode, file name) to --verbose mode only
- Output is now short and minimalistic by default while preserving all important information (size, visibility, URL)
