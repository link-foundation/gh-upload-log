## Summary

`scripts/install-git-hooks.mjs` (the `prepare` script) runs `execFileSync('npx', ['husky'])`. On Windows, `npx` is `npx.cmd`. Node's `execFile*` does not resolve `.cmd` shims and cannot run them without a shell (see the Node docs, ["Spawning .bat and .cmd files on Windows"](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows)). So on a Windows clone (`.git` present, `CI` unset), `prepare` should throw `spawnSync npx ENOENT`, and `npm install` would fail. The tests cannot catch this: every case in `tests/install-git-hooks.test.js` is registered with `itUnless(sandboxed, noPosixShell)`, so all of them are skipped on Windows. `tests/helpers/skip.js` already records the same limit for `gh.cmd` (`windowsNodeCmd`).

I derived the failure from the Node documentation and the code. I did not run the template's `npx` spawn on a Windows machine. The husky-API replacement below was verified on Windows: the windows-2025 leg of gh-upload-log run [40079978931](https://github.com/link-foundation/gh-upload-log/actions/runs/40079978931) passed all six install-git-hooks tests. One of them, "the script installs husky hooks into a real repository", runs the script in a real `git init` repository and checks `core.hooksPath`.

## Reproduction

```sh
git clone --depth 1 https://github.com/link-foundation/js-ai-driven-development-pipeline-template t && cd t
grep -n "execFileSync('npx'" scripts/install-git-hooks.mjs   # 17: const message = execFileSync('npx', ['husky'], ...)
grep -n "noPosixShell" tests/install-git-hooks.test.js      # every test skipped on win32
# On Windows (PowerShell, no CI variable): npm install  -> prepare -> spawnSync npx ENOENT
```

## Workaround (applied in link-foundation/gh-upload-log#60)

Call husky's API instead of spawning `npx`. husky 9 exports `default (dir = '.husky') => message`, and it returns `''` on success:

```js
const husky = (await import('husky')).default;
const message = husky().trim();
```

Then verify `git config --get core.hooksPath`, as the template already does. gh-upload-log's `test/install-git-hooks.test.js` runs the script in a real `git init` repository with no shell shims, so the same test also runs on the windows-2025 matrix leg. The script also logs each decision when `GIT_HOOKS_VERBOSE=1` is set; this is off by default.

## Suggested fix

Replace the `npx` spawn with the husky import shown above, or with `execFileSync('npx', ['husky'], { shell: process.platform === 'win32' })`. Add at least one install-git-hooks test that does not depend on a POSIX shell, so Windows coverage is not silently zero.

---
Checked against template `0a62b80` (2026-10-10), which is still `main` on 2026-10-24.
