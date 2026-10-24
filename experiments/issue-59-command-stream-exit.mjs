// Does awaiting a failing command-stream command throw? (issue #59)
import { $ } from 'command-stream';
try {
  const result = await $`sh -c "echo boom >&2; exit 3"`;
  console.log(`no throw; code=${result.code}`);
} catch (error) {
  console.log(`threw: ${error.message}`);
}
