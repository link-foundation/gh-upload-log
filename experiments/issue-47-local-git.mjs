// Offline integration fixture: real Git writes, tiny logs and no network access.
import path from 'node:path';
import { createLocalRepositoryStream } from './issue-45-local-git.mjs';

export function createExistingRepositoryStream(
  directory,
  { branch = 'feature/logs', ...options } = {}
) {
  const local = createLocalRepositoryStream(directory, options);
  local.runGit(['checkout', '-q', '-b', branch], local.writer);
  local.runGit(['push', '-q', 'origin', branch], local.writer);
  const commands = [];
  const bind =
    (configuration = {}) =>
    (strings, ...values) => {
      if (!Array.isArray(strings?.raw)) {
        return bind(strings);
      }
      const command = strings.reduce(
        (text, part, index) => text + part + (values[index] ?? ''),
        ''
      );
      commands.push(command);
      if (
        command.startsWith('gh api user ') ||
        command.startsWith('gh repo create ')
      ) {
        throw new Error(`Unexpected installation-token operation: ${command}`);
      }
      if (command.startsWith('gh gist create ')) {
        return {
          code: 1,
          stdout: '',
          stderr: 'Resource not accessible by integration (HTTP 403)',
        };
      }
      if (command.includes('/contents/')) {
        const requestedBranch = values.find((value, index) =>
          strings[index].endsWith('ref=')
        );
        if (requestedBranch !== branch) {
          throw new Error(`Read from wrong branch: ${command}`);
        }
        const listing = local.runGit([
          '--git-dir',
          local.remote,
          'ls-tree',
          '-z',
          '-l',
          requestedBranch,
          `${values[2]}/`,
        ]);
        const files = listing
          .split('\0')
          .filter(Boolean)
          .map((line) => {
            const [metadata, name] = line.split('\t');
            return {
              name: path.posix.basename(name),
              size: Number(metadata.trim().split(/\s+/).pop()),
              download_url: null,
            };
          });
        return files.length
          ? { code: 0, stdout: JSON.stringify(files) }
          : { code: 1, stderr: 'Not Found (HTTP 404)' };
      }
      return local.stream(configuration)(strings, ...values);
    };
  return { ...local, commands, stream: bind() };
}
