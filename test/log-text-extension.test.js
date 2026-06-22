/**
 * Tests for browser-viewable uploaded log file names
 */

import { test, assert } from 'test-anywhere';
import fs from 'node:fs';
import path from 'node:path';
import { cwd } from 'node:process';
import {
  splitFileIntoChunks,
  uploadLog,
  generateGistFileName,
  generateUploadedLogFileName,
} from '../src/index.js';

const testDir = path.join(cwd(), 'test', 'fixtures', 'log-text-extension');
fs.mkdirSync(testDir, { recursive: true });

function createCommandResult({ code = 0, stdout = '', stderr = '' } = {}) {
  return {
    code,
    stdout,
    stderr,
  };
}

function buildCommand(strings, values) {
  let command = '';

  for (let index = 0; index < strings.length; index += 1) {
    command += strings[index];
    if (index < values.length) {
      command += String(values[index]);
    }
  }

  return command.trim();
}

function createFakeCommandStream(handler) {
  const commandStream = (optionsOrStrings, ...values) => {
    if (Array.isArray(optionsOrStrings?.raw)) {
      return Promise.resolve(handler(buildCommand(optionsOrStrings, values)));
    }

    return commandStream;
  };

  return commandStream;
}

test('generateGistFileName - returns .log.txt for log input', () => {
  const result = generateGistFileName('/home/user/test.log');
  assert.equal(result, 'home-user-test.log.txt');
});

test('generateGistFileName - does not duplicate .log.txt suffix', () => {
  const result = generateGistFileName('/home/user/test.log.txt');
  assert.equal(result, 'home-user-test.log.txt');
});

test('generateUploadedLogFileName - appends .log.txt for non-log input', () => {
  const result = generateUploadedLogFileName('/var/tmp/app-output');
  assert.equal(result, 'var-tmp-app-output.log.txt');
});

test('splitFileIntoChunks - creates browser-viewable chunk file names', async () => {
  const chunkSourceFile = path.join(testDir, 'chunk-source.log');
  const chunkOutputDir = path.join(testDir, 'chunks');

  fs.writeFileSync(chunkSourceFile, 'x'.repeat(2 * 1024 * 1024));
  fs.rmSync(chunkOutputDir, { recursive: true, force: true });

  const chunks = await splitFileIntoChunks(
    chunkSourceFile,
    chunkOutputDir,
    1024 * 1024
  );

  assert.equal(chunks.length, 2);
  assert.ok(
    chunks.every((chunk) => chunk.endsWith('.log.txt')),
    `Expected all chunk files to end with .log.txt, got: ${chunks.join(', ')}`
  );
  assert.deepEqual(
    chunks.map((chunk) => path.basename(chunk)),
    ['chunk-source.part-00.log.txt', 'chunk-source.part-01.log.txt']
  );
});

test('uploadLog - creates gists with browser-viewable log text filenames', async () => {
  const gistFile = path.join(testDir, 'gist-browser-name.log');
  fs.writeFileSync(gistFile, 'gist browser name\n');

  const commands = [];
  const expectedFileName = generateGistFileName(gistFile);
  const expectedRawUrl = `https://gist.githubusercontent.com/test-user/123/raw/hash/${expectedFileName}`;

  const fakeCommandStream = createFakeCommandStream((command) => {
    commands.push(command);

    if (command.startsWith('gh gist create ')) {
      return createCommandResult({
        stdout: 'https://gist.github.com/test-user/123\n',
      });
    }
    if (
      command ===
      "gh api gists/123 --jq '.files | to_entries | map({filename: .key, raw_url: .value.raw_url})'"
    ) {
      return createCommandResult({
        stdout: JSON.stringify([
          {
            filename: expectedFileName,
            raw_url: expectedRawUrl,
          },
        ]),
      });
    }

    return createCommandResult();
  });

  const result = await uploadLog({
    filePath: gistFile,
    onlyGist: true,
    description: 'browser name',
    commandStreamFactory: () => fakeCommandStream,
  });

  assert.equal(result.type, 'gist');
  assert.equal(result.fileName, expectedFileName);
  assert.equal(result.rawUrl, expectedRawUrl);
  const gistCreateCommand = commands.find((command) =>
    command.startsWith('gh gist create ')
  );
  assert.ok(
    gistCreateCommand?.includes('gh-upload-log-gist-') &&
      gistCreateCommand.includes(expectedFileName),
    `Expected gist creation to use staged ${expectedFileName}, got: ${commands.join('\n')}`
  );
});
