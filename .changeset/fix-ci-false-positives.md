---
'gh-upload-file': patch
---

Fix CI/CD false positives, false negatives and warnings: release scripts now fail on any failed git, npm or gh command instead of reporting success, and no longer evaluate code downloaded from unpkg. The workflow adopts the pipeline template's practices (change detection, a pipeline-status gate, release preflight annotations, pinned runners and actions, per-job timeouts and concurrency, secret scanning, actionlint, zizmor, CodeQL and dependency audits), and the lockfiles no longer contain known high or moderate advisories.
