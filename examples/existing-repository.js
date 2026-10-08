// Installation-token usage: authenticate gh through GH_TOKEN before running.
// bun examples/existing-repository.js session.log OWNER/REPO feature/logs
import { uploadLog } from '../src/index.js';

const [filePath, repository, branch] = process.argv.slice(2);
if (!filePath || !repository) {
  throw new Error(
    'Usage: bun examples/existing-repository.js FILE OWNER/REPO [BRANCH]'
  );
}
const result = await uploadLog({
  filePath,
  repository,
  branch,
  onlyRepository: true,
  verbose: true,
});
console.log('Uploaded log:', result.url);
