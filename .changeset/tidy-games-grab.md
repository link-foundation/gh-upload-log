---
'@link-foundation/gh-upload-log': minor
---

**BREAKING CHANGE**: Refactored API to use options-only pattern for all functions. All functions now accept a single options object with `filePath` as a required property instead of separate parameters.

**New features:**
- Integrated `log-lazy` library for efficient lazy evaluation logging
- Added `verbose` option to enable detailed logging output
- Added `logger` option to configure custom logging targets (enables silent mode, custom loggers, etc.)
- Improved logging throughout upload process with debug-level messages

**API Changes:**
- `uploadLog(filePath, options)` → `uploadLog(options)` where options includes `filePath`
- `uploadAsGist(filePath, options)` → `uploadAsGist(options)` where options includes `filePath`
- `uploadAsRepo(filePath, options)` → `uploadAsRepo(options)` where options includes `filePath`
- Parameter renamed: `logTarget` → `logger` for better clarity
- Return value property renamed: `repoName` → `repositoryName` for consistency

**CI/CD improvements:**
- Upgrade CI/CD pipeline with changesets and NPM deployment support
- Latest runtime versions (Node.js 22.x, Bun latest, Deno v2.x)
- Windows test fixes
- Bun Windows support
- Automated release workflow
