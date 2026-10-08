// Pack and install both names locally; no npm publication or GitHub upload.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { preparePackages } from '../scripts/prepare-npm-packages.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-37-smoke-'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(
    result.status,
    0,
    `${command}: ${result.stdout}${result.stderr}`
  );
  return result.stdout;
}
try {
  // Use the actual planned release version so the legacy package's immutable
  // current version does not make npm's dry-publish precheck reject the probe.
  const releasePlan = path.join(directory, 'release-plan.json');
  run(
    'node',
    [
      path.resolve('node_modules/@changesets/cli/bin.js'),
      'status',
      '--output',
      path.relative(process.cwd(), releasePlan),
    ],
    process.cwd()
  );
  const plannedVersion = JSON.parse(
    fs.readFileSync(releasePlan, 'utf8')
  ).releases.find((release) => release.name === 'gh-upload').newVersion;
  const packages = preparePackages({
    outputDir: path.join(directory, 'packages'),
  });
  const results = [];
  for (const pkg of packages) {
    const manifestPath = path.join(pkg.directory, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    pkg.version = manifest.version = plannedVersion;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const [packed] = JSON.parse(
      run('npm', ['pack', '--json', '--ignore-scripts'], pkg.directory)
    );
    assert.equal(packed.name, pkg.name);
    assert.equal(packed.version, pkg.version);
    assert.ok(packed.files.some((file) => file.path === 'src/file-upload.js'));
    assert.ok(
      !packed.files.some(
        (file) =>
          file.path.startsWith('test/') || file.path.startsWith('experiments/')
      )
    );
    run(
      'npm',
      [
        'publish',
        '--dry-run',
        '--ignore-scripts',
        '--access',
        'public',
        '--json',
      ],
      pkg.directory
    );
    const consumer = path.join(directory, `consumer-${pkg.name}`);
    fs.mkdirSync(consumer);
    fs.writeFileSync(
      path.join(consumer, 'package.json'),
      '{"private":true,"type":"module"}\n'
    );
    run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        path.join(pkg.directory, packed.filename),
      ],
      consumer
    );
    const importCode = `import assert from 'node:assert/strict'; import { uploadFile, uploadLog, detectFileType } from '${pkg.name}'; assert.equal(uploadFile, uploadLog); assert.equal(typeof detectFileType, 'function');`;
    run('node', ['--input-type=module', '-e', importCode], consumer);
    fs.writeFileSync(
      path.join(consumer, 'data.bin'),
      Buffer.from([0, 255, 128])
    );
    for (const bin of ['gh-upload', 'gh-upload-log']) {
      const binPath = path.join(consumer, 'node_modules', '.bin', bin);
      assert.equal(run(binPath, ['--version'], consumer).trim(), pkg.version);
      const output = run(
        binPath,
        ['data.bin', '--dry-mode', '--verbose'],
        consumer
      );
      assert.match(output, /Archive: gzip/);
      assert.match(output, /data\.bin\.gz/);
    }
    results.push({
      name: pkg.name,
      version: pkg.version,
      packedFiles: packed.files.length,
      unpackedSize: packed.unpackedSize,
      bins: ['gh-upload', 'gh-upload-log'],
      importPassed: true,
      dryPublishPassed: true,
    });
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
