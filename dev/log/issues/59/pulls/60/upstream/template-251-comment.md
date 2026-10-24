One more file for the job's file list: `.husky/pre-commit` is a shell script without a `.sh` extension, so a `git ls-files '*.sh'` glob skips it. It also has no shebang, and ShellCheck rejects it at error level:

```sh
git clone --depth 1 https://github.com/link-foundation/js-ai-driven-development-pipeline-template t && cd t   # 0a62b80
docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:v0.11.0 .husky/pre-commit
# In .husky/pre-commit line 1:
# npx lint-staged
# ^-- SC2148 (error): Tips depend on target shell and yours is unknown. Add a shebang or a 'shell' directive.
```

**Workaround / fix applied in link-foundation/gh-upload-log#60** (commit 0c66a9b):

- `.husky/pre-commit` starts with `#!/usr/bin/env sh`. husky 9 runs the hook with `sh -e` either way, so this changes nothing at runtime.
- The job lints `git ls-files -z '*.sh' '.husky/*'` with the digest-pinned `koalaman/shellcheck@sha256:61862eba1fcf09a484ebcc6feea46f1782532571a34ed51fedf90dd25f925a8d` (v0.11.0).
- `paths:` includes both `'**.sh'` and `'.husky/**'`.
- A policy test asserts that every tracked shell file has a shebang.
