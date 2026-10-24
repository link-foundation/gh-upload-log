## Summary

`release.yml` declares the `bump_type` dispatch input as `required: true` with no `default:`. The template's own [CI/CD best practices](https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md) (principle 17) say: "Every input a workflow is dispatched with by API needs a default ... a `required: true` input without `default:` makes GitHub answer `HTTP 422: Required input '<name>' not provided`, and the run never exists." `release_mode` follows that rule (`default: 'instant'`); `bump_type` does not.

## Reproduction

```sh
git clone --depth 1 https://github.com/link-foundation/js-ai-driven-development-pipeline-template t && cd t
sed -n '12,33p' .github/workflows/release.yml
#      bump_type:
#        description: 'Manual release type'
#        required: true
#        type: choice
#        options:          <- no default:
```

Per principle 17, `gh workflow run release.yml` (no `-f bump_type=...`) is answered with HTTP 422 instead of starting a run. I did not dispatch it against a live repository, because with a default it would publish a real release.

## Workaround (applied in link-foundation/gh-upload-log#60)

Add `default: 'patch'` to `bump_type`, and add a policy test that walks every workflow's `workflow_dispatch.inputs` and fails on any `required: true` input without `default:` (`test/ci-workflow-policy.test.js`, "every required workflow_dispatch input has a default").

## Suggested fix

```yaml
      bump_type:
        description: 'Manual release type'
        required: true
        type: choice
        default: 'patch'
        options:
          - patch
          - minor
          - major
```

Pin it with a test, so a new input cannot reintroduce the 422.

---
Checked against template `0a62b80` (2026-10-10).
