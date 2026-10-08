// Offline integration probe: tiny logs and a temporary bare Git remote only.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnGitSync } from './real-git-test-utils.mjs';

export function createLocalRepositoryStream(
  directory,
  { onPush = () => null, empty = false } = {}
) {
  const remote = path.join(directory, 'remote.git');
  const writer = path.join(directory, 'writer');
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Issue 45 test',
    GIT_AUTHOR_EMAIL: 'issue-45@example.com',
    GIT_COMMITTER_NAME: 'Issue 45 test',
    GIT_COMMITTER_EMAIL: 'issue-45@example.com',
    GIT_TERMINAL_PROMPT: '0',
  };
  const runGit = (args, cwd = directory) => {
    const result = spawnGitSync(args, { cwd, env });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    }
    return result.stdout;
  };
  runGit(['init', '-q', '--bare', '-b', 'main', remote]);
  runGit(['clone', '-q', remote, writer]);
  if (!empty) {
    fs.writeFileSync(path.join(writer, 'seed.txt'), 'seed\n');
    runGit(['add', '.'], writer);
    runGit(['commit', '-q', '-m', 'Seed remote'], writer);
    runGit(['push', '-q', 'origin', 'main'], writer);
  }
  const commands = [];
  const pushes = [];
  let attempts = 0;
  const bind =
    (options = {}) =>
    (strings, ...values) => {
      if (!Array.isArray(strings?.raw)) {
        return bind(strings);
      }
      const command = strings.reduce(
        (text, part, index) =>
          text + part + (index < values.length ? String(values[index]) : ''),
        ''
      );
      commands.push(command);
      if (command.startsWith('gh api user ')) {
        return { code: 0, stdout: 'local-user' };
      }
      if (command.startsWith('gh api ') && command.includes('defaultBranch')) {
        return {
          code: 0,
          stdout: '{"defaultBranch":"main","visibility":"private"}',
        };
      }
      if (command.startsWith('gh api ')) {
        try {
          const listing = runGit([
            '--git-dir',
            remote,
            'ls-tree',
            '-z',
            '-l',
            'main',
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
        } catch {
          return { code: 1, stderr: 'Not Found (HTTP 404)' };
        }
      }
      if (command.startsWith('git remote add ')) {
        runGit(
          ['remote', 'add', 'origin', pathToFileURL(remote).href],
          options.cwd
        );
        return { code: 0, stdout: '' };
      }
      if (command.startsWith('git push ')) {
        attempts += 1;
        const injected = onPush({
          attempt: attempts,
          runGit,
          writer,
          remote,
          workDir: options.cwd,
        });
        if (injected) {
          return injected;
        }
        pushes.push(
          runGit(
            [
              'diff-tree',
              '--root',
              '--no-commit-id',
              '--name-only',
              '-r',
              'HEAD',
            ],
            options.cwd
          )
            .trim()
            .split('\n')
        );
      }
      // Tokenize the static Git template before substituting values, so paths
      // remain single arguments on Windows as well as POSIX. No shell is used.
      const template = strings.reduce(
        (text, part, index) =>
          text + part + (index < values.length ? `__value_${index}__` : ''),
        ''
      );
      const args = Array.from(
        template.matchAll(/"([^"\n]*)"|'([^'\n]*)'|(\S+)/g),
        (match) =>
          (match[1] ?? match[2] ?? match[3]).replace(
            /__value_(\d+)__/g,
            (_placeholder, index) => String(values[Number(index)])
          )
      );
      const result = spawnGitSync(args.slice(1), {
        cwd: options.cwd,
        env,
      });
      return {
        code: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    };
  return {
    stream: bind(),
    commands,
    pushes,
    remote,
    writer,
    runGit,
    get attempts() {
      return attempts;
    },
  };
}
