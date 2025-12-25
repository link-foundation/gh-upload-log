---
'gh-upload-log': minor
---

Improve changeset CI/CD robustness with PR-scoped validation and multiple changeset merging

This release improves the changeset workflow to prevent false CI failures and handle concurrent PR scenarios:

- **PR-scoped validation**: Only validates changesets added by the current PR using git diff, preventing failures when other PRs merge first
- **Multiple changeset merging**: Automatically merges multiple changesets during release with highest bump type selection and chronological description preservation
- **Better error messages**: Improved debugging information for changeset validation failures

These improvements align with the js-ai-driven-development-pipeline-template repository and follow industry best practices for changesets in CI/CD pipelines.
