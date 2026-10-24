---
'gh-upload-file': patch
---

Fix CI/CD false positives, false negatives and warnings: release scripts now fail on any failed git, npm or gh command instead of reporting success, and no longer evaluate code downloaded from unpkg. GitHub release notes are published as Changesets wrote them (nested lists, later entries and text after `---` are no longer dropped, every entry's pull request is linked), the npm badges no longer render as "badge not found", and a release reads exactly its own CHANGELOG.md section. The workflow adopts the pipeline template's practices (change detection, a pipeline-status gate, release preflight annotations, pinned runners and actions, per-job timeouts and concurrency, secret scanning, Markdown link checking, documentation and file-size checks, actionlint, ShellCheck, zizmor, CodeQL and dependency audits), and the lockfiles no longer contain known high or moderate advisories.
