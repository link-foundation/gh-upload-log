---
'gh-upload-log': minor
---

feat: Make repository Bun-only

- Updated README.md to use Bun instead of Node.js/npm/Deno
- Changed all shebangs from `#!/usr/bin/env node` to `#!/usr/bin/env bun`
- Updated package.json scripts to use Bun commands
- Updated CI workflows to only run Bun tests (3 OS matrix: Ubuntu, macOS, Windows)
- Removed deno.json configuration file
- Changed engine requirement from Node.js to Bun ≥1.0.0
