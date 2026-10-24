## Summary

The lint job's secrets scan

```sh
npx --yes -p secretlint@13.0.7 -p @secretlint/secretlint-rule-preset-recommend@13.0.7 secretlint "**/*"
```

runs **after** the dependency install. In any repository generated from this template that already has `@secretlint/secretlint-rule-preset-recommend` in `node_modules` (directly or transitively, e.g. through `@link-foundation/sensitive-data-sanitizer`), the step fails with exit code 2:

```
Error: Failed to load secretlint's rule module: "@secretlint/secretlint-rule-preset-recommend" is not found.
cwd: /home/runner/work/<repo>/<repo>
baseDir:
```

The template itself passes only because it does not depend on the preset.

## Root cause

- `npm exec -p A -p B` installs into its npx cache folder only the packages that are **not already present in the local project** ([npm exec docs](https://docs.npmjs.com/cli/v11/commands/npm-exec#description)). The preset is present locally, so only `secretlint` lands in `~/.npm/_npx/<hash>/node_modules`.
- secretlint resolves rule modules with `require.resolve(name)` from its own install folder (`@secretlint/resolver`), never from the project, so it cannot see the preset in `./node_modules`.

## Reproduction (standalone)

```sh
mkdir sl-min && cd sl-min
echo '{ "name": "sl-min", "private": true, "dependencies": { "@secretlint/secretlint-rule-preset-recommend": "13.0.7" } }' > package.json
echo '{"rules":[{"id":"@secretlint/secretlint-rule-preset-recommend"}]}' > .secretlintrc.json
echo hello > a.txt
npm install
export npm_config_cache="$(mktemp -d)"   # empty cache, as on a CI runner
npx --yes -p secretlint@13.0.7 -p @secretlint/secretlint-rule-preset-recommend@13.0.7 secretlint a.txt; echo "exit=$?"   # exit=2, "is not found"
rm -rf node_modules "$npm_config_cache"/_npx
npx --yes -p secretlint@13.0.7 -p @secretlint/secretlint-rule-preset-recommend@13.0.7 secretlint a.txt; echo "exit=$?"   # exit=0
```

Found in link-foundation/gh-upload-log#60 (issue link-foundation/gh-upload-log#59); repro script: `experiments/issue-59-secretlint-npx-local-dep.sh` in that PR.

## Workarounds

1. `NODE_PATH="$PWD/node_modules" npx --yes -p secretlint@13.0.7 -p @secretlint/secretlint-rule-preset-recommend@13.0.7 secretlint "**/*"`: secretlint's maintainers give this workaround in secretlint/secretlint#1624, and verified here it loads the preset (a fake `ghp_` token is reported, exit 1).
2. Run the secrets scan before the dependency install step (`node_modules` does not exist yet, so npm installs both packages into the npx folder). This also scans the tree before any install script runs. secretlint 13 needs Node >= 22, so add `actions/setup-node` first if the job does not have it yet. link-foundation/gh-upload-log#60 uses this one.

## Suggested fix

Move `Check for secrets` above `npm install`/`bun install` in the lint job, and add a test that pins the order, e.g.:

```js
const lint = getJobBlock(readWorkflow('release.yml'), 'lint');
expect(lint.indexOf('secretlint "**/*"')).toBeLessThan(lint.indexOf('run: npm install'));
```

Alternatively, add `secretlint` and the preset as exact-pinned devDependencies and run the local binary, so the lockfile pins both and they always resolve from the same tree.

No secretlint report was filed: the same resolution anchor was reported in secretlint/secretlint#1624, and the maintainers closed it as intended behavior (rules resolve from where secretlint is installed, not from the linted project); the fix PRs secretlint/secretlint#1625 and secretlint/secretlint#1626 were closed. npm documents that `npm exec` only installs packages missing from the local project ([docs](https://docs.npmjs.com/cli/v11/commands/npm-exec#description)). Both tools behave as documented, so the fix belongs in this workflow.

---
Checked against template `0a62b80` (2026-10-10).
