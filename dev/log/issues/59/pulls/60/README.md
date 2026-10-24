# Evidence for issue #59 / PR #60

Collected on 2026-10-24. The analysis is in
[docs/case-studies/issue-59](../../../../../../docs/case-studies/issue-59/README.md).
secretlint over this folder is clean (`local-checks/secretlint-dev-log.txt`).

## Issue and pull request

- `issue-59.json`: the issue as returned by `gh issue view --json`.
- `pr-60.json`, `pr-60-review-comments.json`: PR metadata and inline comments
  (none at collection time).

## CI runs (`ci-logs/`)

`run-<id>.log` is `gh run view <id> --log`; `run-<id>.json` is the run metadata.
The `-failed.log` files hold only the failed steps.

| Run                                   | Branch / event         | What it shows                                                        |
| ------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| 37764693617, 37767103591, 39497838727 | PRs                    | `No changeset found`; lint and test skipped behind it                |
| 37771767171, 38264680940, 39507532219 | `main` push            | `npm publish` E404 retried three times; `always-auth` warnings       |
| 40068731692, 40076498726              | PRs                    | `No changeset found`                                                 |
| 40070269183                           | PR (issue 57)          | Windows test killed at Bun's 5000 ms default                         |
| 40071657572                           | `main` push (0c4a219)  | the failure this issue reports: npm owner setup required             |
| 40078460736, 40078460793, 40078460897 | PR #60, first port     | Windows CRLF job split; dependency graph disabled                    |
| 40079080989, 40079081009, 40079081024 | PR #60                 | green after the dependency graph preflight                           |
| 40079978931 … 40079979035             | PR #60 (c49a0e8)       | all four workflows green                                             |
| 40081914846, 40082956431              | PR #60 (Windows)       | CRLF shell scripts (`set: pipefail\r`) and a quoted Windows path     |

## Local checks (`local-checks/`)

- `check.txt`, `check-final.txt`, `bun-test.txt`, `test-final.txt`: `bun run check` and `bun run test`.
- `actionlint.txt`, `zizmor.txt`, `zizmor-pedantic.txt`, `lychee.txt`, `secretlint.txt`, `audit.txt`, `code-scanning-alerts.txt`: tool output.
- `secretlint-npx-repro*.txt`: reproduction of template #256.
- `crlf-shell-checkout-before.txt`, `crlf-shell-checkout-after.txt`: `experiments/issue-59-crlf-shell-checkout.sh` before and after `.gitattributes`.
- `smoke-test-gh-upload-log-0.9.1.txt`, `smoke-test-gh-upload-file-missing.txt`: the registry smoke test against a published version and against the never-published name.

## Releases (`releases/`)

- `v0.9.0-body.md`, `v0.9.0-changelog.md`: the published release body next to its CHANGELOG section, showing the text the old formatter dropped.

## Upstream (`upstream/`)

- `CI-CD-BEST-PRACTICES.md`: the hive-mind document as read.
- `filed.txt`: the template issues and comment filed from this work.
- `template-*.md`: the drafts of those reports; `template-bump-type-default.md` was not filed because template #248 already covers it.
- `template-crlf-shell-checkout-repro.txt`: the CRLF reproduction on the template.
- `template-format-release-notes-helpers.mjs`: the template version compared with ours.
- `template-open-issues/`: the template's open issues that were reviewed and applied here.
