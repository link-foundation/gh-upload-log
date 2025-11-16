---
'gh-upload-log': minor
---

**BREAKING CHANGE**: Refactored API to use options-only pattern for all functions. All functions now accept a single options object with `filePath` as a required property instead of separate parameters.

**New features:**
- Integrated `log-lazy` library for efficient lazy evaluation logging
- Added `verbose` option to enable detailed logging output
- Added `logger` option to configure custom logging targets (enables silent mode, custom loggers, etc.)
- Added environment variable support for all CLI options (e.g., `GH_UPLOAD_LOG_PUBLIC`, `GH_UPLOAD_LOG_VERBOSE`)
- Improved logging throughout upload process with debug-level messages
- Prepared infrastructure for future `.lenv` file support using Links Notation

**API Changes:**
- `uploadLog(filePath, options)` → `uploadLog(options)` where options includes `filePath`
- `uploadAsGist(filePath, options)` → `uploadAsGist(options)` where options includes `filePath`
- `uploadAsRepo(filePath, options)` → `uploadAsRepo(options)` where options includes `filePath`
- Parameter renamed: `logTarget` → `logger` for better clarity
- Return value property renamed: `repoName` → `repositoryName` for consistency

**CI/CD improvements:**
- Upgraded to Node.js 20.x minimum requirement (matching Link Foundation standards)
- Updated to test-anywhere 0.7.0 for testing
- Latest runtime versions (Node.js 20.x, Bun latest, Deno v2.x) in CI matrix
- Windows test fixes for all runtimes
- Bun Windows support added to CI
- Complete CI/CD pipeline with changesets and NPM deployment
- Automated release workflow with formatted release notes

**Documentation improvements:**
- Added comprehensive configuration section
- Documented environment variable support
- Updated dependencies list with Link Foundation libraries
- Added .lenv.example template for future configuration support
- Updated Node.js version requirements throughout docs
