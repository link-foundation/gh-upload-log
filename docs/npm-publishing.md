# npm publication recovery

The release publishes **both** `gh-upload-file` and `gh-upload-log`, with the same
version, runtime code and three CLI commands. The compatibility name continues
to receive releases; it is not deprecated. Existing consumers do not need to
change their installation command.

## Current status

Both names were published as **0.13.0** through OIDC on 2026-10-25 and passed
consumer smoke tests. The [0.13.0 GitHub release](https://github.com/link-foundation/gh-upload-log/releases/tag/v0.13.0)
is complete. No further bootstrap is required for these packages.

## Recovering a partial release

A publication can become visible through npm's exact-version endpoint before
its installation metadata or tarball reaches every CDN edge. Consumer tests
allow a shared **25-minute** installation visibility budget for all package
names, matching the publisher's visibility window. Each attempt uses an
isolated npm cache with `--prefer-online`, disables npm's nested fetch retries,
and records the underlying install error. Only registry misses, rate limits,
server failures and network errors are retried. Authentication, integrity,
engine and lifecycle failures stop immediately, and CLI/import failures are
never retried. `SMOKE_TEST_VERBOSE=1` prints commands and output.

Both release jobs preserve their release tools outside the artifact checkout,
then reconcile the clean checkout before installing dependencies,
counting changesets or versioning. On a rerun, the original `GITHUB_SHA` identifies
the first subsequent version commit on main. Recovery checks out that exact
commit and resumes publication, smoke tests and the missing GitHub release
without another bump. Newer changesets and later versions on main remain for
their own runs. If main advanced without changing the version, preparation
incorporates those changes before processing changesets. Existing versions
are verified and skipped rather than republished. GitHub release creation
explicitly targets the selected version commit, including when the tag is missing.
The preserved tools retain the current retry and release logic when recovering
source from before these fixes. Their locked dependencies are installed separately.
Set `RELEASE_RECOVERY_VERBOSE=1` to trace preparation's Git commands.

For release runs using this recovery workflow, rerun the failed release job;
a new push to main also recovers missing artifacts for its current version.
GitHub retains the workflow definition of a historical run, so runs from before
the recovery workflow was introduced still use their original steps. Use the current workflow's `recover` mode with their original source SHA:

```sh
gh workflow run release.yml --ref main -f release_mode=recover -f recovery_sha=ORIGINAL_FULL_WORKFLOW_SHA
```

Recovery requires a committed version after that source SHA and fails without
bumping if none exists. It uses the same tests, preflight, OIDC publisher and
consumer smoke tests as an automatic release.
The completed 0.13.0 release needs no recovery action.

The integration regression runs locally without npm or GitHub write access:

```sh
bun test test/issue-61-release-recovery.test.js
# Optional full trace of the finite local-Git scenario:
RELEASE_RECOVERY_VERBOSE=1 node experiments/issue-61-release-recovery.mjs changeset
```

## Preflight and future package setup

The `Release Preflight` job checks every package name before **either**
automated or manual release versioning, so a missing npm setup cannot consume a
changeset or push a version commit. It runs `node scripts/check-npm-publishing.mjs`
in one of two modes:

- **release** (push to `main`, instant release): fails with an
  `npm owner action required` error annotation that names the missing packages
  and points here. Main run
  [40071657572](https://github.com/link-foundation/gh-upload-log/actions/runs/40071657572)
  is the failure this replaces: it reached the publish step and failed there.
- **report** (pull requests, changeset-PR dispatch): writes the same text as a
  warning annotation and passes, so unrelated pull requests stay green while main
  keeps naming the blocker.

Set `NPM_PREFLIGHT_VERBOSE=1` to log every registry request and response status.
PR CI tests both modes with mock registry responses and does not require npm
account access. The preflight checks existence; npm validates the actual
workflow authorization on publish.

### Alternative: bootstrap with an `NPM_TOKEN` secret

npm trusted publishing (OIDC) can only publish packages that already exist. As
an alternative to the manual first publish below, an npm owner can add a
granular automation token with publish rights as the `NPM_TOKEN` repository
secret. The preflight then passes (missing names are reported as a notice), and
the publish steps pass it to npm as `NODE_AUTH_TOKEN`. After the first
successful release, configure the trusted publishers below and **delete the
secret** so publishing returns to short-lived OIDC credentials.

## Owner procedure

For a future missing package name, use an authorized npm account with 2FA.
Bootstrap the intended release from an inspected checkout of `main`. This keeps immutable npm
versions consistent with their release source; do not publish different source
trees under the same version for the two names. These commands publish code and
modify npm account settings.

```sh
bun install --frozen-lockfile
bun run test
bun run check
bun scripts/prepare-npm-packages.mjs --output-dir dist/npm
npm pack ./dist/npm/gh-upload-file --dry-run
npm pack ./dist/npm/gh-upload-log --dry-run
npm login
npm publish ./dist/npm/gh-upload-file --access public
```

Only first-publish a missing name. If this exact version already exists, inspect
it and skip publication; npm versions are immutable. Configure a trusted publisher
for **each name** on npmjs.com: owner `link-foundation`, repository `gh-upload-log`,
workflow `release.yml`, allowing publication. Leave the environment unset, as the
workflow does not declare an environment. Verify the existing compatibility
package's configuration separately. With npm >=11.15.0, the equivalent is:

```sh
npm trust list gh-upload-file
npm trust github gh-upload-file --repo link-foundation/gh-upload-log --file release.yml --allow-publish
npm trust list gh-upload-log
# Run the next command only if its matching trust configuration is absent:
npm trust github gh-upload-log --repo link-foundation/gh-upload-log --file release.yml --allow-publish
```

Do not replace a matching trust configuration. If it is expired or incorrect,
inspect it and replace it using npm's package settings. An unvalidated new
configuration expires after two days, so complete the first CI publish promptly.

Run `bun scripts/check-npm-publishing.mjs` to verify package existence, then
resume the release workflow. Verify both exact versions, both latest tags,
global installation, all three commands and the GitHub release. Neither a
dry-run publish nor a successful preflight proves OIDC authorization or
end-user delivery.

Sources: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[npm trust prerequisites and commands](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
and the existing optional
[package-registry-manager setup tool](https://github.com/link-foundation/package-registry-manager/blob/main/docs/registry-setup.md).
