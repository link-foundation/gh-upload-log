---
'gh-upload-log': patch
---

**Bug Fix**: Fixed CLI showing "Arguments public and private are mutually exclusive" error on every invocation

**Root Cause**: The `--public` and `--private` options had default values which caused yargs' `.conflicts()` method to always trigger, preventing the CLI from working at all.

**Solution**: Removed default values from conflicting CLI options (`--public`/`--private` and `--only-gist`/`--only-repository`). Default behavior is now handled in application code.

**Impact**: This critical bug prevented the CLI from working at all when installed via npm or bun. Users can now use the tool as intended.

**Testing**: Added comprehensive integration tests to verify the fix and prevent regression.

Fixes #6
