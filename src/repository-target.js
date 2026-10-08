/** Validate an explicitly selected repository before any upload side effects. */
export function resolveRepositoryTarget({ repository, branch } = {}) {
  if (repository === undefined) {
    if (branch !== undefined) {
      throw new Error('branch requires an explicit repository (OWNER/REPO)');
    }
    return null;
  }
  if (
    typeof repository !== 'string' ||
    !/^[a-z\d][a-z\d-]*\/[a-z\d_.-]+$/i.test(repository) ||
    ['.', '..'].includes(repository.split('/')[1])
  ) {
    throw new Error(
      'repository must be an existing GitHub repository in OWNER/REPO format'
    );
  }
  if (branch !== undefined) {
    validateRepositoryBranch(branch);
  }
  const [owner, repositoryName] = repository.split('/');
  return { owner, repositoryName, branch };
}

/** Accept branch names, excluding revision expressions and Git options. */
export function validateRepositoryBranch(branch) {
  if (
    typeof branch !== 'string' ||
    !branch ||
    branch === 'HEAD' ||
    branch === '@' ||
    branch.startsWith('-') ||
    /[\s~^:?*[\\]/.test(branch) ||
    Array.from(branch).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    ) ||
    branch.includes('..') ||
    branch.includes('@{') ||
    branch.endsWith('.') ||
    branch
      .split('/')
      .some((part) => !part || part.startsWith('.') || part.endsWith('.lock'))
  ) {
    throw new Error('branch must be a valid Git branch name');
  }
  return branch;
}
