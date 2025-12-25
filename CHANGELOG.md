# gh-upload-log

## 0.3.1

### Patch Changes

- 9719c35: fix: Gist URL capture and human-readable file size display
  - Fix gist URL not being captured due to empty string interpolation in command-stream template literal
  - Add formatFileSize() function for human-readable file sizes (e.g., "1.90 KB" instead of "0.00 MB")
  - Improve CLI output with better formatting and file info display before upload
  - Add comprehensive tests for formatFileSize function

## 0.3.0

### Minor Changes

- 2cc28d3: feat: Make repository Bun-only
  - Updated README.md to use Bun instead of Node.js/npm/Deno
  - Changed all shebangs from `#!/usr/bin/env node` to `#!/usr/bin/env bun`
  - Updated package.json scripts to use Bun commands
  - Updated CI workflows to only run Bun tests (3 OS matrix: Ubuntu, macOS, Windows)
  - Removed deno.json configuration file
  - Changed engine requirement from Node.js to Bun ≥1.0.0

## 0.2.0

### Minor Changes

- 76ccd16: Complete template feature alignment with manual release support and enhanced CI/CD

  This release implements ALL missing features from the js-ai-driven-development-pipeline-template repository:

  **Manual Release Support**:
  - **Instant releases**: Trigger immediate version bumps and npm publishing via GitHub Actions UI
  - **Changeset PR mode**: Create pull requests with changesets for review before release
  - **workflow_dispatch trigger**: Supports patch, minor, and major version bumps with optional descriptions

  **Enhanced CI/CD**:
  - **PR-scoped validation**: Only validates changesets added by the current PR using git diff, preventing failures when other PRs merge first
  - **Multiple changeset merging**: Automatically merges multiple changesets during release with highest bump type selection and chronological description preservation
  - **Modular release scripts**: Migrated to modular architecture using lino-arguments, command-stream, and use-m
  - **OIDC trusted publishing**: Secure npm publishing without stored tokens

  **New Scripts**:
  - `version-and-commit.mjs` - Unified version bumping and git commits
  - `publish-to-npm.mjs` - OIDC-enabled npm publishing
  - `create-github-release.mjs` - Automated GitHub release creation
  - `format-github-release.mjs` - Release note formatting with PR detection
  - `create-manual-changeset.mjs` - Manual changeset file generation
  - `setup-npm.mjs` - npm OIDC setup for trusted publishing
  - `instant-version-bump.mjs` - Fast-track version bumps without changesets

  These improvements provide complete feature parity with the template repository and enable flexible release workflows.

## 0.1.1

### Patch Changes

- ffde303: **Bug Fix**: Fixed CLI showing "Arguments public and private are mutually exclusive" error on every invocation

  **Root Cause**: The `--public` and `--private` options had default values which caused yargs' `.conflicts()` method to always trigger, preventing the CLI from working at all.

  **Solution**: Removed default values from conflicting CLI options (`--public`/`--private` and `--only-gist`/`--only-repository`). Default behavior is now handled in application code.

  **Impact**: This critical bug prevented the CLI from working at all when installed via npm or bun. Users can now use the tool as intended.

  **Testing**: Added comprehensive integration tests to verify the fix and prevent regression.

  Fixes #6
