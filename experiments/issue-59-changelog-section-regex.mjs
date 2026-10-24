// Shows why create-github-release.mjs no longer builds a RegExp from the
// version: `## 1.0.1` also matches the start of `## 1.0.10`, so releasing
// 1.0.1 published the 1.0.10 notes. Run: node experiments/issue-59-changelog-section-regex.mjs
import { extractChangelogSection } from '../scripts/format-release-notes-helpers.mjs';

const changelog = [
  '## 1.0.10',
  '',
  '- 1111111: Newer',
  '',
  '## 1.0.1',
  '',
  '- 2222222: Fixes issue ## 2 of the list',
].join('\n');

const version = '1.0.1';
const match = changelog.match(
  new RegExp(`## ${version}[\\s\\S]*?(?=## \\d|$)`)
);
console.log(
  'old:',
  JSON.stringify(match[0].replace(`## ${version}`, '').trim())
);
console.log(
  'new:',
  JSON.stringify(extractChangelogSection(changelog, version))
);
