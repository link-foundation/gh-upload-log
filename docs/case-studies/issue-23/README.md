# Case Study: Issue #23 - Handle ENOSPC Errors Gracefully

## Summary

When `gh-upload-log` encounters an ENOSPC (no space left on device) error, it fails with a
generic error message that provides no actionable guidance. This case study traces the root
cause of disk exhaustion in the original incident, analyzes which upload paths actually need
disk space, and documents the fix that provides actionable ENOSPC-specific error handling.

## Issue Details

**Issue URL**: https://github.com/link-foundation/gh-upload-log/issues/23
**Title**: Handle ENOSPC errors gracefully with actionable error messages
**Reporter**: konard
**Date Reported**: 2026-03-28
**Related Issues**:

- [claude-code#16093](https://github.com/anthropics/claude-code/issues/16093) - Infinite logging loop in debug files causes 200GB+ disk usage
- [link-assistant/hive-mind#1212](https://github.com/link-assistant/hive-mind/issues/1212) - ENOSPC error handling in hive-mind

## Observed Behaviour

```
❌ Error uploading log: ENOSPC: no space left on device, write
❌ Error uploading log file: ENOSPC: no space left on device, write
```

The error occurred during a hive-mind solve session where the disk filled up during Claude
Code execution. The user received no guidance on how to resolve the issue.

---

## Timeline / Sequence of Events

1. **Disk fills up** - Claude Code's debug logging system enters an infinite recursive loop
   ([claude-code#16093](https://github.com/anthropics/claude-code/issues/16093)). The
   performance monitor logs operations taking >75ms; when debug log files grow large enough
   that writes themselves exceed 75ms, each log entry triggers another log entry, creating a
   feedback loop that only stops when the disk is completely full.
2. **`~/.claude/debug` grows to tens of GB** - Debug files can accumulate 500+ million
   lines, with 99% being recursive log messages.
3. **`gh-upload-log` is invoked** - The tool attempts to upload a log file from the session.
4. **ENOSPC error occurs** - Depending on the upload strategy:
   - **Gist mode**: `gh gist create` reads the existing file directly and streams it to
     GitHub's API. This path does NOT require additional disk space and may succeed even
     with zero free space.
   - **Repository mode**: Requires creating a temp directory, copying the file, initializing
     a git repo, and creating git objects. This path requires significant additional disk
     space (roughly 2-3x the file size).
5. **Generic error displayed** - The user sees `ENOSPC: no space left on device` with no
   suggestions on how to recover.

---

## Root Cause Analysis

### The Upstream Root Cause: Claude Code Debug Logging Loop

The disk exhaustion was caused by [claude-code#16093](https://github.com/anthropics/claude-code/issues/16093):
a bug in Claude Code's performance monitoring system. The system logs operations taking >75ms.
When debug log files grow large enough that writing to them takes >75ms, the logger logs the
slow append, triggering another log entry. This creates an infinite loop that fills the disk.

After 7 days of normal usage, `~/.claude/debug` can accumulate 42GB+ from fewer than 500
conversations (compared to ~232MB for normal usage - a 180x difference).

### The `gh-upload-log` Error Handling Gap

`gh-upload-log` had no ENOSPC-specific detection. All errors were treated identically with
a generic `❌ Error:` message. Additionally:

1. **No fallback prevention**: When gist upload fails, the code falls back to repository
   mode. But if gist failed due to ENOSPC, repository mode will also fail (it needs MORE
   disk space). This wastes time and produces confusing double errors.
2. **No disk space guidance**: The error message doesn't suggest checking `~/.claude/debug`
   or `/tmp` for large files, even though these are the most common causes.
3. **No gist hint**: When the user forces `--only-repository` for a file small enough
   for a gist (<= 25MB) and ENOSPC occurs, the user isn't told that `--only-gist` could
   work without needing temp disk space. (Note: in auto mode, files ≤25MB already use
   gist by default, so this hint only applies to the forced `--only-repository` case.)

### Key Insight: Gist Uploads Don't Need Extra Disk Space

The `gh gist create` command reads the file directly from its existing path and streams it
to GitHub's API. It does NOT create temporary copies. This means:

- **Files <= 25MB can be uploaded as gists even with zero free disk space**
- Repository uploads always need significant temp space (copy + git objects)

This is the critical insight from the maintainer's comment: "if file already exists we can
upload it, even if we don't have free space on disk."

---

## Disk Write Analysis

| Operation                 | Location                         | Disk Space Needed          |
| ------------------------- | -------------------------------- | -------------------------- |
| `gh gist create`          | `uploadAsGist()`                 | None (reads existing file) |
| `fs.mkdirSync(workDir)`   | `uploadAsRepo()` line 403        | Minimal (directory entry)  |
| `fs.copyFileSync()`       | `uploadAsRepo()` line 407        | Equal to file size         |
| `split` command           | `splitFileIntoChunks()` line 203 | Equal to file size         |
| `git init`                | `uploadAsRepo()` line 431        | ~100KB                     |
| `git add . && git commit` | `uploadAsRepo()` lines 436-437   | ~30-40% of file size       |

**Total for repository mode**: ~2-3x the original file size in temp space.

---

## Solution Implemented

### 1. ENOSPC Detection (`isENOSPC()`)

A helper function that checks for ENOSPC errors via multiple signals:

- `error.code === 'ENOSPC'` (Node.js filesystem errors)
- `error.message` containing 'ENOSPC' or 'no space left on device'
- `error.stderr` containing the same (command-stream errors)

### 2. Structured Error Creation (`createENOSPCError()`)

Creates errors with:

- `error.code = 'ENOSPC'` for programmatic detection
- `error.operation` describing what failed
- `error.originalError` preserving the original error
- Actionable message suggesting disk cleanup paths

### 3. Smart Fallback Prevention

- When gist upload fails with ENOSPC, the code no longer falls back to repository mode
  (which would also fail and needs more space)
- When the user forces `--only-repository` for a file that fits in a gist (<=25MB) and
  ENOSPC occurs, the error message suggests using `--only-gist` instead. (In auto mode,
  files ≤25MB already default to gist, so the hint only applies to forced repo mode.)

### 4. Actionable CLI Output

**Default ENOSPC output** (auto mode or `--only-gist`):

```
❌ Error: No space left on device

Suggestions to free disk space:
  • Check ~/.claude/debug for large debug files
  • Clean /tmp directory: rm -rf /tmp/log-*
  • Check disk usage: df -h && du -sh /tmp ~/.claude
```

**When `--only-repository` is forced** for a file that fits in a gist (≤25MB):

```
❌ Error: No space left on device

Suggestions to free disk space:
  • Check ~/.claude/debug for large debug files
  • Clean /tmp directory: rm -rf /tmp/log-*
  • Check disk usage: df -h && du -sh /tmp ~/.claude

💡 Hint: This file fits in a gist. Try --only-gist to upload
   without requiring temporary disk space.
```

Note: In auto mode, files ≤25MB are uploaded as gists by default (which does not
require extra disk space), so the `--only-gist` hint only appears when the user has
explicitly forced repository mode via `--only-repository`.

---

## Tests Added

- `isENOSPC` - 8 tests covering all detection paths (error code, message, stderr, null,
  non-ENOSPC errors)
- `createENOSPCError` - 2 tests verifying error structure and actionable content
- CLI ENOSPC detection integration test

---

## Related External Issues

### Claude Code #16093 - Infinite Debug Logging Loop

- **URL**: https://github.com/anthropics/claude-code/issues/16093
- **Status**: Known issue with multiple related reports
  ([#9496](https://github.com/anthropics/claude-code/issues/9496),
  [#20848](https://github.com/anthropics/claude-code/issues/20848),
  [#8575](https://github.com/anthropics/claude-code/issues/8575),
  [#22584](https://github.com/anthropics/claude-code/issues/22584))
- **Root cause**: Performance monitor logs slow operations (>75ms). Writing to large debug
  files takes >75ms, triggering recursive logging that fills the disk.
- **Workaround**: Periodically clean `~/.claude/debug` directory.

---

## References

- GitHub issue: https://github.com/link-foundation/gh-upload-log/issues/23
- Pull request: https://github.com/link-foundation/gh-upload-log/pull/26
- Affected files: `src/index.js`, `src/cli.js`
- Test files: `test/index.test.js`, `test/cli.test.js`
- Upstream issue: https://github.com/anthropics/claude-code/issues/16093
