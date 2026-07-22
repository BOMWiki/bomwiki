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
const advancedTxFile = join(root, 'advanced-transaction.json');
const output = join(root, 'output.json');
const advancedOutput = join(root, 'advanced-output.json');
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

await writeFile(advancedTxFile, JSON.stringify({
  transactionId: 'tx-bomcad-advanced', label: 'Create advanced headless structure', expectedRevision: 0, atomic: true,
  operations: [
    { kind: 'datum.create', input: { id: 'datum-headless-x', name: 'Headless X', datumKind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [1, 0, 0] } } },
    { kind: 'body.transform', input: { id: 'feature-headless-copy', name: 'Headless linked copy', bodyId: 'body-feature-headless-body', bodyName: 'Headless copy', copy: true, transform: { mode: 'copy', translation: [45, 0, 0] } } },
    { kind: 'pattern.create', input: { id: 'pattern-headless-linear', name: 'Headless linked pattern', kind: 'linear', sourceBodyId: 'body-feature-headless-body', directionDatumId: 'datum-headless-x', count: 3, definition: { spacing: 50 }, outputMode: 'linked' } },
    { kind: 'assembly.create', input: { id: 'assembly-headless', name: 'Headless assembly', occurrenceId: 'occurrence-headless-base', fixed: true } },
    { kind: 'component.duplicate', input: { occurrenceId: 'occurrence-headless-base', id: 'occurrence-headless-second', name: 'Headless second', baseTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 120, 0, 0, 1] } },
    { kind: 'section.create', input: { id: 'section-headless', name: 'Headless section', kind: 'plane', planes: [{ normal: [1, 0, 0], offset: 60 }], cap: true } },
  ],
}));
const advanced = await bomcad(['apply', output, '--transaction', advancedTxFile, '--out', advancedOutput]);
const advancedProject = JSON.parse(await readFile(advancedOutput, 'utf8'));
check('headless adapter replays typed datum, transform, linked pattern, assembly, occurrence, and section operations',
  advanced.code === 0 && advancedProject.rootDocument.kind === 'assembly' &&
  advancedProject.partDefinitions[0].referenceGeometry.length === 1 && advancedProject.partDefinitions[0].bodyPatterns.length === 1 &&
  advancedProject.assemblyDefinitions[0].occurrences.length === 2 && advancedProject.assemblyDefinitions[0].sectionViews.length === 1);

const render = await bomcad(['render', output, '--out', join(root, 'render.png')]);
check('headless render refuses to fake a visual without the browser kernel', render.code === 1 && render.json.code === 'EXACT_KERNEL_REQUIRED');

const traversal = await bomcad(['inspect', join(root, '..', 'outside.json')]);
check('headless input traversal is rejected', traversal.code === 1 && ['PATH_OUTSIDE_SCOPE', 'ENOENT'].includes(traversal.json.code));

check('headless commands reserve stderr for diagnostics', [capabilities, inspect, preview, applied, validated].every((result) => result.stderr === ''));

console.log(`\n${passed}/${passed + failed} headless checks passed`);
if (failed) process.exitCode = 1;
