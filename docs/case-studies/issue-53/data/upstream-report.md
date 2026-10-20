Additional reproducible case for the authorization diagnostic (not evidence of a Shields bug): https://github.com/link-foundation/gh-upload-log/issues/53

Our GitHub-hosted release job uses Node 24, npm ^11.5.1, and `id-token: write`. Publishing the newly renamed package with `npm publish <prepared-gh-upload-file-directory> --access public` fails with `E404` on PUT. Public logs: https://github.com/link-foundation/gh-upload-log/actions/runs/38264680940 (2026-10-12). The new package is also absent on GET; the compatibility package `gh-upload-log` exists. We cannot inspect npm account/publisher settings, so we do not claim a registry defect or a verified configuration mismatch.

Read-only reproduction:

```sh
curl -i https://registry.npmjs.org/gh-upload-file/latest
curl -i https://registry.npmjs.org/-/package/gh-upload-file/dist-tags
curl -s https://img.shields.io/npm/v/gh-upload-file.svg
```

The first two return 404; the third renders `package not found`. Static release badges do not query npm, which hid the failed delivery.

Workaround: badge/link to the published compatibility package; an authorized npm maintainer must bootstrap the new name and configure its trusted publisher independently (repository `link-foundation/gh-upload-log`, workflow `release.yml`) before retrying the release. This is a proposed recovery pending account access, not a verified resolution.

Suggested CLI change: when a publish PUT returns E404/E403 in an OIDC environment, preserve the original error but append guidance to check first-publication authorization and per-package trusted-publisher settings. Do not assert a particular cause or print tokens/claims. We added equivalent contextual diagnostics locally. An authenticated settings page could provide the exact rejection reason.
