// command-stream <= 0.11.1 under Bun reports exit code 0 for a child process
// that is given `.run({ stdin })` and exits non-zero (fixed in 0.12.0; Node is
// unaffected). create-github-release.mjs piped its payload that way, so a
// failed `gh api ... --input -` looked like a created release.
//
//   bun experiments/issue-59-command-stream-stdin-exit-code.mjs </dev/null
//   node experiments/issue-59-command-stream-stdin-exit-code.mjs </dev/null
//
// With the installed 0.7.1, Bun prints "stdin 0 capture 2", Node "stdin 2 capture 2".
import { $ } from 'command-stream';

const piped = await $`sh -c ${'cat >/dev/null; exit 2'}`.run({
  stdin: '{}',
  mirror: false,
});
const captured = await $`sh -c ${'exit 2'}`.run({ capture: true });
console.log('stdin', piped.code, 'capture', captured.code);
