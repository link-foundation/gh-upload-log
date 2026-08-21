---
'gh-upload-log': patch
---

Accept every log file path form (bare relative, `./`, `../`, `~/`, absolute) by resolving paths to absolute before use, run git commands with command-stream's `cwd` option instead of a `cd` prefix that changed the process working directory, and initialize temporary repositories with `git -c init.defaultBranch=<branch> init -q` so the "Using 'master' as the name for the initial branch" hint and other command noise are no longer printed.
