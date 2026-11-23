import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildChunkFileNamePrefix,
  ensureCommandSucceeded,
  LOG_TEXT_EXTENSION,
} from './common.js';
import { isStoredFileName } from './file-upload.js';
import { pushWithRetry } from './git-push.js';

function localBlobPath(workDir, objectId) {
  return path.join(
    workDir,
    '.git',
    'objects',
    objectId.slice(0, 2),
    objectId.slice(2)
  );
}

export function textPartLayout(fileName, count) {
  const prefix = buildChunkFileNamePrefix(fileName);
  const digits = Math.max(2, String(count - 1).length);
  return {
    indexName: `.${fileName}.index.json`,
    pendingName: `.${fileName}.pending`,
    prefix,
    digits,
    name: (index) =>
      count === 1
        ? fileName
        : `${prefix}${String(index).padStart(digits, '0')}${LOG_TEXT_EXTENSION}`,
  };
}

/**
 * Keep the Git index and trees locally. Each payload exists as just one loose
 * blob, which is discarded after push acknowledgement. Prior blobs are
 * available from the promisor remote and never checked out.
 */
export async function publishTextParts({
  options,
  plan,
  info,
  workDir,
  repositoryPath,
  repositoryName,
  defaultBranch,
  log,
  run,
  input,
  newBranch,
}) {
  const { parts } = plan;
  const layout = textPartLayout(info.fileName, parts.length);
  const names = parts.map((_, index) => layout.name(index));
  const index = Buffer.from(
    `${JSON.stringify(
      {
        version: 1,
        bytes: plan.sanitization.outputBytes,
        sha256: plan.digest,
        parts: {
          prefix: layout.prefix,
          suffix: LOG_TEXT_EXTENSION,
          digits: layout.digits,
          start: 0,
          count: parts.length,
        },
      },
      null,
      2
    )}\n`
  );
  const indexId = createHash('sha1')
    .update(`blob ${index.length}\0`)
    .update(index)
    .digest('hex');
  const relative = (name) => `${repositoryPath}/${name}`;
  const command = async (operation, job) =>
    ensureCommandSucceeded(await job, operation);
  const entries = new Map();
  let hasParent = !newBranch;

  async function loadRemoteIndex() {
    await command('read upload branch tree', run`git read-tree FETCH_HEAD`);
    await command('set upload branch tip', run`git update-ref HEAD FETCH_HEAD`);
    hasParent = true;
    const listing = await command(
      'read previously published parts',
      run`git --literal-pathspecs ls-tree -r -z HEAD -- ${`${repositoryPath}/`}`
    );
    entries.clear();
    for (const entry of listing.stdout.split('\0').filter(Boolean)) {
      const tab = entry.indexOf('\t');
      const [, type, oid] = entry.slice(0, tab).split(' ');
      const name = entry.slice(tab + 1 + repositoryPath.length + 1);
      if (type === 'blob' && !name.includes('/')) {
        entries.set(name, oid);
      }
    }
  }
  if (!newBranch) {
    await loadRemoteIndex();
  }

  async function storeBlob(bytes, expected = undefined) {
    const hashed = await command(
      'store verified upload blob',
      input(bytes)`git hash-object -w --stdin`
    );
    const objectId = hashed.stdout.trim();
    if (
      !/^[a-f0-9]{40}$/.test(objectId) ||
      (expected && expected !== objectId)
    ) {
      throw new Error('Git returned an unexpected upload blob ID');
    }
    return objectId;
  }

  let published = false;
  async function publish(getChanges) {
    let changes;
    async function commit() {
      changes = getChanges();
      let changed = false;
      for (const [name, objectId] of changes) {
        const old = entries.get(name);
        if (old === (objectId || undefined)) {
          continue;
        }
        const file = relative(name);
        await command(
          'stage verified upload change',
          objectId
            ? run`git update-index --add --cacheinfo 100644 ${objectId} ${file}`
            : run`git update-index --force-remove -- ${file}`
        );
        changed = true;
      }
      if (changed) {
        // Porcelain commit reads the working tree to generate status and can
        // fetch the missing blobs from the parent. The index already contains
        // all the entries needed to write the new tree.
        const tree = (
          await command('write upload tree', run`git write-tree --missing-ok`)
        ).stdout.trim();
        const commit = (
          await command(
            'commit verified upload',
            hasParent
              ? run`git commit-tree ${tree} -p HEAD -m "Add log file"`
              : run`git commit-tree ${tree} -m "Add log file"`
          )
        ).stdout.trim();
        await command(
          'set verified upload commit',
          run`git update-ref HEAD ${commit}`
        );
      }
      return changed;
    }
    if (await commit()) {
      await pushWithRetry(run, {
        ...options,
        defaultBranch,
        repositoryName,
        log,
        newBranch,
        async refreshCommit() {
          await loadRemoteIndex();
          return commit();
        },
      });
      published = true;
      hasParent = true;
      newBranch = false;
      for (const [name, objectId] of changes) {
        if (objectId) {
          entries.set(name, objectId);
        } else {
          entries.delete(name);
        }
      }
    }
  }

  const multipart = parts.length > 1;
  const assertLayout = () => {
    const current = entries.get(layout.indexName);
    if (current && (!multipart || current !== indexId)) {
      throw new Error(
        'A concurrent upload published another part layout; retry the upload'
      );
    }
  };
  const pending = multipart
    ? await storeBlob(Buffer.from(`${plan.contentHash}\n`))
    : null;
  let indexNumber = 0;
  for await (const bytes of plan.replay()) {
    const part = parts[indexNumber];
    const name = names[indexNumber];
    indexNumber += 1;
    if (entries.get(name) === part.objectId) {
      log.debug(() => `Chunk ${name} already matches the remote; skipping it`);
      continue;
    }
    assertLayout();
    log.debug(
      () =>
        `→ Committing and pushing chunk ${indexNumber}/${parts.length}: ${name}`
    );
    const objectId = await storeBlob(bytes, part.objectId);
    await publish(() => {
      assertLayout();
      const changes = new Map([[name, objectId]]);
      if (pending && !entries.has(layout.indexName)) {
        changes.set(layout.pendingName, pending);
      }
      return changes;
    });
    await fs.rm(localBlobPath(workDir, objectId), { force: true });
  }

  const uploadedNames = new Set(names);
  const assertParts = () => {
    assertLayout();
    if (!parts.every((part, i) => entries.get(names[i]) === part.objectId)) {
      throw new Error(
        'Published parts changed before the upload index could be confirmed; retry the upload'
      );
    }
  };
  assertParts();
  if (multipart) {
    await storeBlob(index, indexId);
  }
  await publish(() => {
    assertParts();
    const changes = new Map([[layout.pendingName, null]]);
    for (const name of entries.keys()) {
      if (isStoredFileName(name, info) && !uploadedNames.has(name)) {
        changes.set(name, null);
      }
    }
    if (multipart) {
      changes.set(layout.indexName, indexId);
    }
    return changes;
  });
  if (multipart) {
    await fs.rm(localBlobPath(workDir, indexId), { force: true });
    await fs.rm(localBlobPath(workDir, pending), { force: true });
  }
  return {
    names,
    indexName: multipart ? layout.indexName : null,
    deduplicated: !published,
  };
}
