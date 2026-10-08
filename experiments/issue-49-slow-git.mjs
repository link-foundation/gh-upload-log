// Load with Node's --import to simulate a finite slow Windows Git startup.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const originalSpawnSync = childProcess.spawnSync;
let delayed = false;
childProcess.spawnSync = (command, ...args) => {
  if (command === 'git' && !delayed) {
    delayed = true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5500);
  }
  return originalSpawnSync(command, ...args);
};
syncBuiltinESMExports();
