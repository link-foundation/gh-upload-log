import { $ } from 'command-stream';
console.log('cwd before:', process.cwd());
const dir = `/tmp/cd-cwd-test-${Date.now()}`;
await $`mkdir -p ${dir}`;
const r = await $`cd ${dir} && git init`;
console.log('exit', r.code);
console.log('cwd after:', process.cwd());
