import { setTimeout as sleep } from 'node:timers/promises';
import { ensureCommandSucceeded, getCommandExitCode } from './common.js';

export function isRetryablePushError(errorText = '') {
  // Authentication, permissions and oversized blobs require a user/code fix,
  // even when Git also reports an RPC failure or disconnect.
  if (
    /authentication failed|permission denied|http[ /]*(401|403)|returned error: (401|403)|exceeds github's file size limit|gh001|protected branch|pre-receive hook declined/i.test(
      errorText
    )
  ) {
    return false;
  }
  return /http[ /]*(408|429|5\d\d)|returned error: (408|429|5\d\d)|rpc failed|remote end hung up|unexpected disconnect|connection (reset|closed|timed out)|could not resolve host|failed to connect|non-fast-forward|\(fetch first\)/i.test(
    errorText
  );
}

/** Push one commit, refreshing the remote before bounded exponential retries. */
export async function pushWithRetry($workDir, options) {
  const {
    defaultBranch,
    repositoryName,
    log,
    newBranch = false,
    pushRetries = 2,
    pushRetryDelayMs = 1000,
    sleepFn = sleep,
  } = options;
  if (!Number.isInteger(pushRetries) || pushRetries < 0 || pushRetries > 10) {
    throw new Error('pushRetries must be an integer between 0 and 10');
  }
  if (
    !Number.isFinite(pushRetryDelayMs) ||
    pushRetryDelayMs < 0 ||
    pushRetryDelayMs > 30000
  ) {
    throw new Error('pushRetryDelayMs must be between 0 and 30000');
  }

  let hasRemoteBase = !newBranch;
  for (let attempt = 0; attempt <= pushRetries; attempt += 1) {
    try {
      if (attempt > 0) {
        // Keep the shallow clone's original boundary: fetching new descendants
        // without --depth 1 preserves the common ancestor needed by rebase.
        const fetched =
          await $workDir`git fetch -q --filter=blob:none origin ${defaultBranch}`;
        if (
          getCommandExitCode(fetched) !== 0 &&
          /couldn't find remote ref|could not find remote branch/i.test(
            `${fetched.stderr || ''}${fetched.stdout || ''}`
          )
        ) {
          // A new repository can still be empty after a failed initial push.
          if (hasRemoteBase) {
            ensureCommandSucceeded(
              fetched,
              'refresh shared repository before retry'
            );
          }
        } else {
          ensureCommandSucceeded(
            fetched,
            'refresh shared repository before retry'
          );
          const rebased = hasRemoteBase
            ? await $workDir`git rebase -q FETCH_HEAD`
            : await $workDir`git rebase -q --root --onto FETCH_HEAD`;
          ensureCommandSucceeded(
            rebased,
            'rebase shared repository upload before retry'
          );
          hasRemoteBase = true;
        }
      }
      return ensureCommandSucceeded(
        await $workDir`git push -q -u origin ${defaultBranch}`,
        `push shared repository upload to ${repositoryName}`
      );
    } catch (error) {
      const failure = `${error.message || ''}\n${error.stderr || ''}\n${error.stdout || ''}`;
      if (attempt === pushRetries || !isRetryablePushError(failure)) {
        throw error;
      }
      const delay = Math.min(pushRetryDelayMs * 2 ** attempt, 30000);
      log.debug(() => `Push failure: ${failure.trim()}`);
      log.warn(
        () =>
          `Push attempt ${attempt + 1}/${pushRetries + 1} failed; retrying in ${delay}ms after fetching and rebasing...`
      );
      await sleepFn(delay);
    }
  }
}
