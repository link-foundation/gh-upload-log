import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, test } from 'test-anywhere';

// Pins the CI/CD best practices adopted in issue #59 so a later workflow
// edit cannot silently reintroduce the false positives and warnings fixed
// there. See dev/log/issues/59/pulls/60/README.md for the evidence.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = path.join(root, '.github', 'workflows');
const workflowFiles = readdirSync(workflowDir).filter((file) =>
  /\.ya?ml$/.test(file)
);

function readWorkflow(file) {
  return readFileSync(path.join(workflowDir, file), 'utf8').replaceAll(
    '\r\n',
    '\n'
  );
}

function listJobBlocks(workflow) {
  const lines = workflow.split('\n');
  const jobsStart = lines.indexOf('jobs:');
  const starts = [];
  for (let index = jobsStart + 1; index < lines.length; index += 1) {
    if (/^ {2}[\w-]+:\s*$/.test(lines[index])) {
      starts.push(index);
    }
  }
  return starts.map((start, position) => ({
    name: lines[start].trim().slice(0, -1),
    block: lines.slice(start, starts[position + 1] ?? lines.length).join('\n'),
  }));
}

function listStepBlocks(jobBlock) {
  const lines = jobBlock.split('\n');
  const starts = [];
  lines.forEach((line, index) => {
    if (/^ {6}- /.test(line)) {
      starts.push(index);
    }
  });
  return starts.map((start, position) =>
    lines.slice(start, starts[position + 1] ?? lines.length).join('\n')
  );
}

// Returns the body of every `run:` script (inline and block scalars).
function listRunScripts(workflow) {
  const scripts = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)(- )?run:\s*(.*)$/);
    if (!match) {
      continue;
    }
    // Sibling keys of the step sit at the key's indent, past any `- `.
    const keyIndent = match[1].length + (match[2] ? 2 : 0);
    if (!/^[|>]/.test(match[3])) {
      scripts.push(match[3]);
      continue;
    }
    const body = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      const indent = line.match(/^\s*/)[0].length;
      if (line.trim() && indent <= keyIndent) {
        index -= 1;
        break;
      }
      body.push(line);
    }
    scripts.push(body.join('\n'));
  }
  return scripts;
}

// Jobs that push the version commit to main keep the checkout credential.
const jobsThatPush = new Set(['release', 'instant-release']);

test('every workflow declares least-privilege permissions', () => {
  for (const file of workflowFiles) {
    assert.match(
      readWorkflow(file),
      /^permissions:\n {2}contents: read$/m,
      `${file} must default to contents: read`
    );
  }
});

test('hosted runners are pinned and actions do not run on Node 20', () => {
  for (const file of workflowFiles) {
    const workflow = readWorkflow(file);
    assert.ok(
      !/runs-on:.*-latest|os: \[.*-latest/.test(workflow),
      `${file} must pin runner images`
    );
    // checkout@v4 and setup-node@v4 emitted the Node 20 deprecation
    // warning 30 times per run before issue #59.
    for (const action of ['checkout', 'setup-node']) {
      assert.ok(
        !new RegExp(`actions/${action}@v[1-5]\\b`).test(workflow),
        `${file} must use actions/${action}@v6 or later`
      );
    }
  }
});

test('every job has a timeout and job-level concurrency', () => {
  for (const file of workflowFiles) {
    const workflow = readWorkflow(file);
    assert.ok(
      !/^concurrency:/m.test(workflow),
      `${file}: workflow-level concurrency cancels release runs on main`
    );
    for (const { name, block } of listJobBlocks(workflow)) {
      assert.match(
        block,
        /^ {4}timeout-minutes: \d+$/m,
        `${file}:${name} needs timeout-minutes`
      );
      assert.match(
        block,
        /^ {4}concurrency:$/m,
        `${file}:${name} needs a concurrency group`
      );
    }
  }
});

test('status functions never use always() and run scripts never inline expressions', () => {
  for (const file of workflowFiles) {
    const workflow = readWorkflow(file);
    assert.ok(
      !/always\(\)/.test(workflow.replace(/#.*$/gm, '')),
      `${file}: use !cancelled() so cancellation propagates`
    );
    for (const script of listRunScripts(workflow)) {
      assert.ok(
        !script.includes('${{'),
        `${file}: pass expressions through env:, not inline in run: ${script}`
      );
    }
  }
});

test('only jobs that push keep the checkout credential', () => {
  const persisting = [];
  for (const file of workflowFiles) {
    for (const { name, block } of listJobBlocks(readWorkflow(file))) {
      for (const step of listStepBlocks(block)) {
        if (!/uses: actions\/checkout@/.test(step)) {
          continue;
        }
        const persists = /persist-credentials:\s*true/.test(step);
        const drops = /persist-credentials:\s*false/.test(step);
        assert.ok(persists || drops, `${file}:${name} must be explicit`);
        if (persists) {
          persisting.push(`${file}:${name}`);
        }
      }
    }
  }
  assert.deepEqual(
    persisting.sort(),
    [...jobsThatPush].map((job) => `release.yml:${job}`).sort()
  );
});

test('every workflow has a pipeline-status gate covering all its jobs', () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'scripts', 'check-status-gate-covers-all-jobs.mjs'),
      ...workflowFiles.map((file) => path.join(workflowDir, file)),
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  for (const file of workflowFiles) {
    assert.match(
      readWorkflow(file),
      /pipeline-status:\n(?:.*\n)*? {4}if: >-\n {6}!cancelled\(\)/,
      `${file}: the gate must run when its dependencies fail`
    );
  }
});

test('the run-script parser sees inline expressions', () => {
  const scripts = listRunScripts(
    [
      '      - run: echo "${{ github.head_ref }}"',
      '      - run: |',
      '          echo ok',
      '          echo "${{ inputs.x }}"',
      '        env:',
      '          A: ${{ github.sha }}',
    ].join('\n')
  );
  assert.equal(scripts.length, 2);
  assert.ok(scripts.every((script) => script.includes('${{')));
  assert.ok(!scripts[1].includes('github.sha'));
});

test('the secrets scan runs before dependencies are installed', () => {
  // npm exec skips the preset already in ./node_modules (a transitive
  // dependency here), and secretlint then cannot resolve it from its npx
  // folder. See experiments/issue-59-secretlint-npx-local-dep.sh.
  const lint = listJobBlocks(readWorkflow('release.yml')).find(
    ({ name }) => name === 'lint'
  ).block;
  const scan = lint.indexOf('secretlint "**/*"');
  const install = lint.indexOf('run: bun install');
  assert.ok(scan !== -1 && install !== -1, 'lint must scan and install');
  assert.ok(scan < install, 'run secretlint before bun install');
});

// Principle 17: a required dispatch input without a default makes the
// "Run workflow" form and `gh workflow run` without -f fail before any job
// starts, so every required input must name its default.
test('every required workflow_dispatch input has a default', () => {
  const missing = [];
  for (const file of workflowFiles) {
    const lines = readWorkflow(file).split('\n');
    const start = lines.findIndex((line) => /^ {4}inputs:\s*$/.test(line));
    if (start === -1) {
      continue;
    }
    let input = null;
    const flush = () => {
      if (input?.required && !input.hasDefault) {
        missing.push(`${file}:${input.name}`);
      }
    };
    for (const line of lines.slice(start + 1)) {
      if (!/^ {6}/.test(line) && line.trim() !== '') {
        break;
      }
      const name = line.match(/^ {6}([\w-]+):\s*$/);
      if (name) {
        flush();
        input = { name: name[1], required: false, hasDefault: false };
      } else if (input && /^ {8}required:\s*true\b/.test(line)) {
        input.required = true;
      } else if (input && /^ {8}default:/.test(line)) {
        input.hasDefault = true;
      }
    }
    flush();
  }
  assert.deepEqual(missing, []);
});

test('the pre-commit hook runs lint-staged and prepare verifies it', () => {
  const hook = readFileSync(path.join(root, '.husky', 'pre-commit'), 'utf8');
  assert.match(hook, /^npx lint-staged$/m);
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.prepare, 'node scripts/install-git-hooks.mjs');
  // An ignored file passed by lint-staged must not turn into a warning that
  // --max-warnings 0 then rejects.
  assert.ok(
    pkg['lint-staged']['*.{js,mjs,cjs}'].some((command) =>
      command.includes('--no-warn-ignored')
    )
  );
});

// `eslint .` exits 0 on warnings, so a commit that skipped the hook landed
// what the hook's --max-warnings 0 rejects (template issue #241).
test('CI lint rejects the warnings the pre-commit hook rejects', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.lint, /--max-warnings 0\b/);
  assert.ok(
    pkg['lint-staged']['*.{js,mjs,cjs}'].some((command) =>
      command.includes('--max-warnings 0')
    )
  );
});

// A skipped job never gets matrix values, so a `${{ matrix.* }}` name was
// listed unexpanded, e.g. "Test (Bun on ${{ matrix.os }})" in run
// 37764693617 (template issue #247). GitHub appends the values itself.
test('no job name embeds a matrix expression', () => {
  for (const file of readdirSync(path.join(root, '.github', 'workflows'))) {
    const workflow = readFileSync(
      path.join(root, '.github', 'workflows', file),
      'utf8'
    );
    assert.ok(
      !/^ {4}name:.*\$\{\{\s*matrix\./m.test(workflow),
      `${file} names a job with a matrix expression`
    );
  }
});
