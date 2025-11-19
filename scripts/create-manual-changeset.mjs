#!/usr/bin/env node

/**
 * Create a changeset file for manual releases
 * Usage: node scripts/create-manual-changeset.mjs <bump_type> [description]
 */

import { writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';

try {
  // Get bump type from command line arguments
  const bumpType = process.argv[2];
  const description =
    process.argv.slice(3).join(' ') || `Manual ${bumpType} release`;

  if (!bumpType || !['major', 'minor', 'patch'].includes(bumpType)) {
    console.error(
      'Usage: node scripts/create-manual-changeset.mjs <major|minor|patch> [description]'
    );
    process.exit(1);
  }

  // Generate a random changeset ID
  const changesetId = randomBytes(4).toString('hex');
  const changesetFile = `.changeset/manual-release-${changesetId}.md`;

  // Create the changeset file with single quotes to match Prettier config
  const content = `---
'test-anywhere': ${bumpType}
---

${description}
`;

  writeFileSync(changesetFile, content, 'utf-8');

  console.log(`Created changeset: ${changesetFile}`);
  console.log('Content:');
  console.log(content);

  // Format with Prettier
  console.log('\nFormatting with Prettier...');
  execSync(`npx prettier --write "${changesetFile}"`, { stdio: 'inherit' });

  console.log('\n✅ Changeset created and formatted successfully');
} catch (error) {
  console.error('Error creating changeset:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
