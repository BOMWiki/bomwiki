import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createEmptyStudioV5PartProject } from '../static/studio-project-v5.js';

let passed = 0;
let failed = 0;
function check(name: string, condition: unknown, detail?: unknown) {
  if (condition) {
    passed++;
    console.log('  PASS', name);
  } else {
    failed++;
    console.error('  FAIL', name, detail ?? '');
  }
}

const root = await mkdtemp(join(tmpdir(), 'bomwiki-bomcad-'));
const source = join(root, 'source.json');
const txFile = join(root, 'transaction.json');
const output = join(root, 'output.json');
await writeFile(source, JSON.stringify(createEmptyStudioV5PartProject({ projectId: 'project-bomcad-check', name: 'Headless check', units: 'mm' })));
await writeFile(txFile, JSON.stringify({
  transactionId: 'tx-bomcad-create', label: 'Create headless body', expectedRevision: 0, atomic: true,
  operations: [{
    kind: 'feature.extrude',
    input: {
      id: 'feature-headless-body', name: 'Headless body', bodyName: 'Headless body', height: 8,
      sketch: { shapes: [{ kind: 'rect', x: 1, y: 2, w: 30, h: 15 }], z: 0 },
      resultPolicy: { kind: 'new-body', bodyName: 'Headless body' },
    },
  }],
}));

async function bomcad(args: string[]) {
  const child = spawn(process.execPath, ['--experimental-strip-types', 'scripts/bomcad.ts', ...args, '--root', root], {
    cwd: join(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  return { code: child.exitCode, stdout, stderr, json: JSON.parse(stdout) };
}

console.log('\nAgent headless CLI');
const capabilities = await bomcad(['capabilities']);
check('headless capabilities exposes protocol JSON', capabilities.code === 0 && capabilities.json.protocolVersion === 'bomwiki.cad.agent/v1');

const inspect = await bomcad(['inspect', source]);
check('headless inspect reads a canonical project under --root', inspect.code === 0 && inspect.json.result.projectId === 'project-bomcad-check' && inspect.json.result.counts.bodies === 0);

const preview = await bomcad(['preview', source, '--transaction', txFile]);
check('headless preview returns a semantic body creation without writing', preview.code === 0 && preview.json.preview.changeSet.created.some((entry: any) => entry.id === 'body-feature-headless-body'));
const unchanged = JSON.parse(await readFile(source, 'utf8'));
check('headless preview leaves its input project byte state untouched', unchanged.partDefinitions[0].bodies.length === 0);

const applied = await bomcad(['apply', source, '--transaction', txFile, '--out', output]);
const resultProject = JSON.parse(await readFile(output, 'utf8'));
check('headless apply writes a checksummed project with one revision', applied.code === 0 && applied.json.revision === 1 && applied.json.sha256.length === 64);
check('headless apply produces normal editable feature/body structure', resultProject.partDefinitions[0].features[0].id === 'feature-headless-body' && resultProject.partDefinitions[0].bodies[0].id === 'body-feature-headless-body');

const validated = await bomcad(['validate', output]);
check('headless validate reports canonical validity without claiming exact geometry', validated.code === 0 && validated.json.valid === true && validated.json.exactGeometry === false);

const render = await bomcad(['render', output, '--out', join(root, 'render.png')]);
check('headless render refuses to fake a visual without the browser kernel', render.code === 1 && render.json.code === 'EXACT_KERNEL_REQUIRED');

const traversal = await bomcad(['inspect', join(root, '..', 'outside.json')]);
check('headless input traversal is rejected', traversal.code === 1 && ['PATH_OUTSIDE_SCOPE', 'ENOENT'].includes(traversal.json.code));

check('headless commands reserve stderr for diagnostics', [capabilities, inspect, preview, applied, validated].every((result) => result.stderr === ''));

console.log(`\n${passed}/${passed + failed} headless checks passed`);
if (failed) process.exitCode = 1;
