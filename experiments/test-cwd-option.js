import { $ } from 'command-stream';
const dir = `/tmp/cwd-opt-test-${Date.now()}`;
await $`mkdir -p ${dir}`;
const $in = $({ cwd: dir, mirror: false, capture: true });
const r = await $in`pwd`;
console.log('pwd output:', r.stdout.trim());
console.log('process cwd after:', process.cwd());
const g = await $in`git -c init.defaultBranch=main init -q`;
console.log(
  'git init code:',
  g.code,
  JSON.stringify(g.stdout),
  JSON.stringify(g.stderr)
);
const b = await $in`git branch --show-current`;
console.log('branch:', b.stdout.trim());
console.log('process cwd after 2:', process.cwd());
