## Summary

`scripts/check-ci-workflows.mjs` (the `Status Gate Coverage` job in `workflows.yml`) crashes with an unhandled `ENOENT` in any repository without a `.github/actions` directory, which is the common case for repositories that adopt the template's CI scripts but have no composite actions:

```
Error: ENOENT: no such file or directory, scandir '.github/actions'
    at readdirSync (node:fs:1956:26)
    at workflowFiles (scripts/check-ci-workflows.mjs:52:10)
```

The job fails with a stack trace instead of a policy result, so a downstream repository either deletes the check or creates an empty directory to work around it.

## Reproduction

```sh
git clone --depth 1 https://github.com/link-foundation/js-ai-driven-development-pipeline-template t && cd t
rm -rf .github/actions
node scripts/check-ci-workflows.mjs; echo "exit=$?"   # stack trace, exit=1
```

Found while porting the script to link-foundation/gh-upload-log#60 (issue link-foundation/gh-upload-log#59).

## Workaround / suggested fix

Skip missing directories in `workflowFiles`:

```js
import { existsSync, readFileSync, readdirSync } from 'node:fs';

function workflowFiles(directory) {
  // Repositories without composite actions have no .github/actions folder.
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap(/* unchanged */);
}
```

plus a test that runs the CLI from a temporary directory containing only `.github/workflows`.

## Minor, same area

`scripts/check-status-gate-covers-all-jobs.mjs` line 8 documents the gate as running `if: always()`, but every gate in the template (correctly) uses `if: >- !cancelled()`, and hive-mind's CI/CD best practices recommend `!cancelled()`. The comment should say `!cancelled()` so copies of it do not reintroduce `always()`.

---
Checked against template `0a62b80` (2026-10-10).
