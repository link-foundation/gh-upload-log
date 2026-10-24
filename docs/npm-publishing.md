# npm publication recovery

The release publishes **both** `gh-upload-file` and `gh-upload-log`, with the same
version, runtime code and three CLI commands. The compatibility name continues
to receive releases; it is not deprecated. Existing consumers do not need to
change their installation command.

## Current blocker

On 2026-10-24, `gh-upload-file` returns HTTP 404 and `gh-upload-log` still has
`latest: 0.10.1`. Release run
[39507532219](https://github.com/link-foundation/gh-upload-log/actions/runs/39507532219)
failed with npm E404 for `gh-upload-file@0.12.1`. This session's `npm whoami`
returns ENEEDAUTH, and the repository has no Actions secrets. GitHub repository
permissions do not authorize npm account operations.

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

Use an authorized npm account with 2FA. Bootstrap the current failed release from
an inspected checkout of `main` before merging this PR. This keeps immutable npm
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

Run `bun scripts/check-npm-publishing.mjs` from this PR to verify package existence.
An npm owner can then rerun the failed main release; its publisher resumes missing
versions and verifies each exact version before creating a GitHub release. Verify
both names from that release before merging this PR. Once these prerequisites
are resolved, the reviewed PR's minor changeset prepares the next synchronized
release with sanitization. Neither a dry-run publish nor a successful preflight
proves OIDC authorization or end-user delivery.

Verify both exact versions, both latest tags, a global installation, all three
commands, and the GitHub release. Repeat those checks for the subsequent version
containing this PR. Until actual publication succeeds, issue #56 remains
unfinished and this PR must remain unmerged.

Sources: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[npm trust prerequisites and commands](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
and the existing optional
[package-registry-manager setup tool](https://github.com/link-foundation/package-registry-manager/blob/main/docs/registry-setup.md).
