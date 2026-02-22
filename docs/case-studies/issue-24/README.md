# Case Study: Issue #24 - Early Failure Without Extra Console Output

## Summary

When `gh-upload-log` is invoked with a file path that does not exist, the CLI prints a
premature `⏳ Uploading 0 B (? private)...` status line (and, in verbose mode, additional
file information lines) before ultimately printing the actual error. The extra output is
misleading and noisy. The tool should detect the missing file early and exit immediately
with only the error message.

## Issue Details

**Issue URL**: https://github.com/link-foundation/gh-upload-log/issues/24
**Title**: We can fail early without no additional console output.
**Reporter**: konard
**Date Reported**: 2026-02-22
**Labels**: bug

## Observed Behaviour (Bug)

```
hive@fd0fd4470ec3:~$ gh-upload-log /home/hive/9900b2fc-1524-4fdc-bc3f-4cbe7c7d1a14.lo
⏳ Uploading 0 B (? private)...

❌ Error: File does not exist: /home/hive/9900b2fc-1524-4fdc-bc3f-4cbe7c7d1a14.lo
```

Three unwanted lines appear before the real error:

1. `⏳ Uploading 0 B (? private)...` — the upload-status line
2. An empty line printed by the `catch` block
3. The actual `❌ Error:` line

## Expected Behaviour

```
hive@fd0fd4470ec3:~$ gh-upload-log /home/hive/9900b2fc-1524-4fdc-bc3f-4cbe7c7d1a14.lo
❌ Error: File does not exist: /home/hive/9900b2fc-1524-4fdc-bc3f-4cbe7c7d1a14.lo
```

Only the error line should appear. No empty leading lines.

---

## Timeline / Sequence of Events

1. **Issue #24 filed** — konard reports that non-existent-file invocations produce noisy
   output before the real error message.
2. **Root-cause analysis** — Traced execution in `src/cli.js` (see section below).
3. **Fix designed** — Two-line addition: an early `fileExists` guard right after the
   `logFile` check, and removal of the spurious blank line in the `catch` block.
4. **Fix implemented and tested** — Unit test added to `test/cli.test.js`.

---

## Root Cause Analysis

### Code Path (before fix)

All references are to `src/cli.js` as it existed before the fix.

```
main()
  │
  ├─ line 129: logFile = config.logFile          // e.g. "/home/hive/…lo"
  ├─ line 131: if (!logFile) → print error, exit  // passes — path was provided
  │
  ├─ line 160: fileSize = 0
  ├─ line 161: if (fileExists(logFile))           // FALSE — file missing
  │              fileSize = getFileSize(logFile)  // skipped
  │
  ├─ line 154: if (options.verbose) …             // verbose prints here if enabled
  │
  ├─ lines 175-177:
  │   console.log(`⏳ Uploading 0 B (? private)...`)  // ← PRINTED EVEN THOUGH FILE MISSING
  │
  ├─ line 179: await uploadLog(options)
  │              └─ uploadLog: if (!fileExists) throw Error("File does not exist: …")
  │
  └─ catch (error):
       line 228: console.error('')          // ← EMPTY LINE printed
       line 229: console.error('❌ Error:', error.message)
```

### Root Causes (two independent defects)

#### Defect 1 — Missing early guard for non-existent file

The CLI already has a guard at line 131 for _no file path provided_, but there is **no
corresponding guard for a file path that does not exist**. The code checks existence at
line 161 only to set `fileSize`; it does not stop execution there.

The `⏳ Uploading …` status line is printed unconditionally at lines 175-177, so it
always appears even when the file is known to be missing.

**Secondary early-print issue in verbose mode** — if `--verbose` is set, lines 169-173
print `📁 <path>` and `📊 0 B` before the error too.

#### Defect 2 — Spurious blank line before the error message

The `catch` block (line 228) always emits `console.error('')` before the error text.
This blank line is unnecessary (the `⏳` line already provides visual separation in the
success path), and looks especially bad when the `⏳` line itself is removed.

### Why the Fix Is Minimal

No changes are needed in `src/index.js`. The `uploadLog`, `determineUploadStrategy`, and
`uploadAsGist`/`uploadAsRepo` functions already guard against missing files internally —
they just throw exceptions. Those internal guards are fine as defensive programming.
The fix belongs purely in the CLI presentation layer (`src/cli.js`).

---

## Similar Places in the Codebase

The issue explicitly asked to _"double check all others similar places in code"_.

### `src/cli.js` — analysed in full

| Location      | Finding                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Lines 131-136 | ✅ Correct — fails early when no file path provided                                            |
| Lines 154-157 | ⚠️ Verbose option print — runs before file check, fixed by moving guard earlier                |
| Lines 161-163 | ⚠️ `fileExists` used only to set size, not to exit — fixed by adding early guard               |
| Lines 169-173 | ⚠️ Verbose file/size print — also premature for missing files; covered by the same early guard |
| Lines 175-177 | ❌ Upload status printed before file is verified to exist — root cause, fixed                  |
| Lines 228-229 | ❌ Blank line before error — unnecessary noise, removed                                        |

### `src/index.js` — no changes needed

| Function                  | Line    | Check                                             |
| ------------------------- | ------- | ------------------------------------------------- |
| `fileExists`              | 94-100  | Helper — correct                                  |
| `getFileSize`             | 108-110 | No guard — expected; only called when file exists |
| `determineUploadStrategy` | 148-149 | ✅ Throws if file missing                         |
| `uploadLog`               | 489-491 | ✅ Throws if file missing                         |
| `uploadAsGist`            | 237-239 | ✅ Throws if no `filePath` option                 |
| `uploadAsRepo`            | 333-335 | ✅ Throws if no `filePath` option                 |

---

## Proposed Solution

### Fix in `src/cli.js`

**1. Add an early existence check** immediately after the `logFile` path validation
(after line 136), so execution stops before any output is printed:

```js
// After: if (!logFile) { ... process.exit(1); }

if (!fileExists(logFile)) {
  console.error(`❌ Error: File does not exist: ${logFile}`);
  process.exit(1);
}
```

This ensures:

- No `⏳ Uploading …` line is ever printed for a missing file.
- No verbose file/size lines are printed for a missing file.
- The error message is consistent with what `uploadLog` would throw.

**2. Remove the blank line before errors in the `catch` block**:

```diff
  } catch (error) {
-   console.error('');
    console.error('❌ Error:', error.message);
```

The blank line was added to visually separate the error from the `⏳ Uploading …` status
line. With the early guard in place that blank separator is no longer needed for the
missing-file case, and in other failure cases (network errors, etc.) the `⏳` line itself
already provides the separation. Removing it makes the output cleaner.

---

## Test Added

A new test was added to `test/cli.test.js`:

```js
test('CLI with non-existent file does not print upload status before error', async () => {
  const result = await runCLI(['/nonexistent/file.log']);
  assert.equal(result.code, 1, 'Should exit with code 1');
  assert.ok(
    !result.output.includes('Uploading'),
    'Should not print uploading status for non-existent file'
  );
  assert.ok(
    !result.output.startsWith('\n'),
    'Should not start output with blank line'
  );
  assert.ok(
    result.output.includes('Error:') &&
      result.output.includes('does not exist'),
    'Should show file not found error'
  );
});
```

---

## References

- GitHub issue: https://github.com/link-foundation/gh-upload-log/issues/24
- Pull request: https://github.com/link-foundation/gh-upload-log/pull/25
- Affected file: `src/cli.js`
- Test file: `test/cli.test.js`
