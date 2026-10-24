// Reproduces the windows-2025 failure of "release workflow uses an
// OIDC-compatible Node and npm toolchain" (run 40078460736): a Windows
// checkout stores release.yml with CRLF, so a "\n"-based job split finds
// no jobs unless the text is normalised first.
import { readFileSync } from 'node:fs';

const lf = readFileSync('.github/workflows/release.yml', 'utf8').replaceAll(
  '\r\n',
  '\n'
);
const crlf = lf.replaceAll('\n', '\r\n');

function jobs(workflow) {
  return Object.fromEntries(
    workflow
      .slice(workflow.indexOf('\njobs:\n'))
      .split(/\n(?= {2}[\w-]+:\n)/)
      .slice(1)
      .map((block) => [block.trim().split(':')[0], block])
  );
}

console.log('LF jobs:', Object.keys(jobs(lf)).length);
console.log('CRLF jobs (unnormalised):', Object.keys(jobs(crlf)).length);
console.log(
  'CRLF jobs (normalised):',
  Object.keys(jobs(crlf.replaceAll('\r\n', '\n'))).length
);
