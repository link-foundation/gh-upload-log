import fs from 'node:fs';
import { URL } from 'node:url';

const packageJsonUrl = new URL('../package.json', import.meta.url);

/**
 * Version of the package containing this CLI.
 *
 * Reading package.json keeps `gh-upload-log --version` synchronized with the
 * version produced by Changesets instead of requiring a second manual update.
 */
export const PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(packageJsonUrl, 'utf8')
).version;
