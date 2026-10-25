# Issue 61 work plan

Objective: implement and verify every issue requirement in PR 62 on
`issue-61-e9bfba775308`. No sub-issues or issue/PR comments existed at initial review.

- [x] Read issue, sub-issue inventory, conversation comments, inline comments and reviews.
- [x] Check repository guidance, branch, recent merged PR style and release implementation.
- [x] List recent CI runs with timestamps/SHA and preserve both reported failed attempts in ci-logs/.
- [x] Identify causes: six unconditional install attempts; changeset merging precedes checkout reconciliation.
- [x] Add failing minimum regressions for long registry propagation, fresh metadata, permanent errors and rerun recovery.
- [x] Fix bounded install retry policy, retaining original diagnostics and optional verbose logging.
- [x] Reconcile clean release checkout before changeset counting/merging/versioning; recognize version already committed from original source SHA.
- [x] Keep npm publication resumable, run consumer checks and create missing GitHub release for exact version commit.
- [x] Add integration test with local Git origin, simulated publication/install lag and rerun at original SHA.
- [x] Add patch changeset (automatic version trigger); update recovery docs and evidence.
- [x] Run focused tests, full tests, lint/format/docs/workflow checks sequentially within memory headroom; retain logs.
- [x] Review diff for lost behavior and unmet requirements; commit atomic changes after local checks, push only prepared branch.
- [x] Update PR title/body with reproduction, tests, assumptions and Fixes #61; ensure latest main is included.
- [x] Verify current-head CI; preserve and analyze any failed logs by timestamp/SHA; fix and repeat as needed.
- [x] Refresh all feedback, mark PR 62 ready, confirm clean tree.

Implementation CI and requirement evidence are recorded in
`docs/case-studies/issue-61/README.md`. The native goal remains active through
the final current-head CI and clean-tree verification after recording evidence.
