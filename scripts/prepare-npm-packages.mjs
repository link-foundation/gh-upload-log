#!/usr/bin/env bun

// Prepare one manifest per npm name from a single version and source tree.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeConfig } from 'lino-arguments';

export function preparePackages({ sourceDir = process.cwd(), outputDir } = {}) {
  if (!outputDir) {
    throw new Error('outputDir is required');
  }
  const pkg = JSON.parse(
    fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8')
  );
  const names = [pkg.name, ...(pkg.publishAliases || [])];
  if (
    new Set(names).size !== names.length ||
    names.some((name) => !/^[a-z0-9][a-z0-9._-]*$/.test(name))
  ) {
    throw new Error('Package names must be distinct valid unscoped npm names');
  }
  return names.map((name) => {
    const directory = path.resolve(outputDir, name);
    if (directory === path.resolve(sourceDir)) {
      throw new Error(
        'Output directory must not overwrite the source manifest'
      );
    }
    fs.mkdirSync(directory, { recursive: true });
    for (const file of ['src', 'README.md', 'LICENSE', 'CHANGELOG.md']) {
      fs.cpSync(path.join(sourceDir, file), path.join(directory, file), {
        recursive: true,
      });
    }
    const manifest = { ...pkg, name };
    delete manifest.scripts;
    delete manifest.devDependencies;
    delete manifest['lint-staged'];
    delete manifest.publishAliases;
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    return { name, version: pkg.version, directory };
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const config = makeConfig({
    yargs: ({ yargs }) =>
      yargs.option('output-dir', {
        type: 'string',
        default: 'dist/npm',
        describe: 'Directory for the per-name package manifests',
      }),
  });
  for (const pkg of preparePackages({ outputDir: config.outputDir })) {
    console.log(`${pkg.name}@${pkg.version}: ${pkg.directory}`);
  }
}
