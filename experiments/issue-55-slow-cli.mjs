// A finite startup delay reproduces the CLI harness's implicit five-second limit.
import { setTimeout } from 'node:timers/promises';

console.log('Waiting six seconds before CLI startup');
await setTimeout(6_000);
