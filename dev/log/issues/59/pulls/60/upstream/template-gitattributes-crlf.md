## Problem

The template has no `.gitattributes`. The `windows-2025` legs of `release.yml` and `example-app.yml` therefore check out with the runner default `core.autocrlf=true`, which converts every shell script to CRLF:

```
i/lf    w/crlf  attr/    scripts/read-job-cancel-in-progress.sh
i/lf    w/crlf  attr/    scripts/run-with-budget-warning.sh
...
```

On that checkout, running a script stops on its first `set` line:

```
scripts/read-job-cancel-in-progress.sh: line 4: set: pipefail: invalid option name
```

A shebang line that ends in `\r` also makes `env` look for an interpreter whose name ends in a carriage return. The same applies to Windows contributors who run `scripts/*.sh` locally.

We found this in link-foundation/gh-upload-log (issue link-foundation/gh-upload-log#59). Its `windows-2025` test job failed on a shebang check of `.husky/pre-commit` (runs 40081914846 and 40082956431).

## Reproduction (Linux is enough)

`core.autocrlf=true` converts to CRLF on checkout on every platform:

```bash
git -c core.autocrlf=true clone -q https://github.com/link-foundation/js-ai-driven-development-pipeline-template t
cd t
git ls-files --eol -- '*.sh' | head -3
WORKFLOW_FILE=/dev/null bash scripts/read-job-cancel-in-progress.sh
# scripts/read-job-cancel-in-progress.sh: line 4: set: pipefail: invalid option name
```

The script used in gh-upload-log is `experiments/issue-59-crlf-shell-checkout.sh`. Its output against template commit 0a62b80 is stored in `dev/log/issues/59/pulls/60/upstream/template-crlf-shell-checkout-repro.txt`.

## Workaround

Run `git config core.autocrlf false` before checkout. Alternatively, call scripts via `tr -d '\r' < script | bash`.

## Suggested fix

Add a `.gitattributes`:

```gitattributes
# Shell scripts and git hooks must keep LF on every checkout.
*.sh text eol=lf
.husky/** text eol=lf
```

Then add a policy test so a new script can't slip through:

```js
const scripts = execFileSync('git', ['ls-files', '*.sh', '.husky/*'], { encoding: 'utf8' })
  .split('\n').filter(Boolean);
const attributes = execFileSync('git', ['check-attr', 'eol', '--', ...scripts], { encoding: 'utf8' });
for (const script of scripts) {
  expect(attributes).toContain(`${script}: eol: lf\n`);
}
```

gh-upload-log applied this in link-foundation/gh-upload-log#60 (commit 0b720be).
