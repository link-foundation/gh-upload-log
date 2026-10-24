/**
 * Classify a rejected `git push` so the release picks the only recovery that
 * can work (CI/CD best practices, principles 9 and 10; ported from the
 * pipeline template's push-failure-classifier.mjs).
 *
 * Both rejections print "rejected", but need opposite responses:
 *
 *   lost race (a rebase fixes it)
 *     ! [rejected] main -> main (non-fast-forward)
 *
 *   repository rule (no rebase can ever fix it)
 *     remote: error: GH013: Repository rule violations found for refs/heads/main.
 *     ! [remote rejected] main -> main (push declined due to repository rule violations)
 */

const REPOSITORY_RULE_PATTERNS = [
  'gh006',
  'gh013',
  'repository rule violations',
  'changes must be made through a pull request',
  'protected branch',
  'push declined',
];

const NON_FAST_FORWARD_PATTERNS = [
  '[rejected]',
  'non-fast-forward',
  'fetch first',
  'updates were rejected',
];

function combinedOutput(result) {
  return [result?.stdout || '', result?.stderr || ''].join('\n').toLowerCase();
}

/** Branch protection (GH006) or a repository ruleset (GH013) refused it. */
export function isBlockedByRepositoryRule(result) {
  const output = combinedOutput(result);
  return REPOSITORY_RULE_PATTERNS.some((pattern) => output.includes(pattern));
}

/** The remote branch advanced; only this is fixed by rebasing. */
export function isNonFastForward(result) {
  if (isBlockedByRepositoryRule(result)) {
    return false;
  }
  const output = combinedOutput(result);
  return NON_FAST_FORWARD_PATTERNS.some((pattern) => output.includes(pattern));
}
