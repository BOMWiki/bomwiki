// @ts-expect-error Browser-native module intentionally has no declarations.
import { cadCapabilityManifest } from '../static/studio-agent-service.js';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { cadUiCapabilityManifest } from '../static/studio-v6-interaction.js';

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

console.log('\nCAD Studio V6 I4 capability and hardening contract');

const live = cadCapabilityManifest({ exactKernel: true, visibleStudio: true });
const headless = cadCapabilityManifest({ exactKernel: false, visibleStudio: false });
const ui = cadUiCapabilityManifest();
const liveExport = new Map<string, any>(live.exports.map((entry: any) => [entry.format, entry]));
const headlessExport = new Map<string, any>(headless.exports.map((entry: any) => [entry.format, entry]));
const liveImport = new Map<string, any>(live.imports.map((entry: any) => [entry.format, entry]));
const headlessImport = new Map<string, any>(headless.imports.map((entry: any) => [entry.format, entry]));
const liveQuery = new Map<string, any>(live.queries.map((entry: any) => [entry.kind, entry]));
const headlessQuery = new Map<string, any>(headless.queries.map((entry: any) => [entry.kind, entry]));
const permissionIds = new Set(live.permissions.map((entry: any) => entry.permission));

check('live V6 advertises exact selected CAD, model render, and both visible subtitle artifacts',
  ['project', 'step', 'stl', 'png', 'webvtt', 'srt'].every((format) => liveExport.get(format)?.state === 'available') &&
  liveExport.get('png')?.permission === 'artifact.render' &&
  liveExport.get('webvtt')?.permission === 'artifact.export-narration' &&
  liveExport.get('srt')?.permission === 'artifact.export-narration',
  live.exports);
check('headless capability discovery fails closed for exact-kernel and visible-Studio artifacts',
  headlessExport.get('project')?.state === 'available' &&
  ['step', 'stl'].every((format) => headlessExport.get(format)?.disabledReasonCode === 'EXACT_KERNEL_ADAPTER_REQUIRED') &&
  ['png', 'webvtt', 'srt'].every((format) => headlessExport.get(format)?.disabledReasonCode === 'VISIBLE_STUDIO_REQUIRED'),
  headless.exports);
check('project and STEP import require visible Studio, explicit project replacement, and the exact kernel where needed',
  ['project', 'step'].every((format) =>
    liveImport.get(format)?.state === 'available' &&
    liveImport.get(format)?.permission === 'project.replace') &&
  ['project', 'step'].every((format) =>
    headlessImport.get(format)?.state === 'disabled' &&
    headlessImport.get(format)?.disabledReasonCode === 'VISIBLE_STUDIO_REQUIRED'),
  { live: live.imports, headless: headless.imports });
check('live V6 advertises exact topology, health, clearance, and interference queries only with a kernel',
  ['geometry.topology', 'geometry.health', 'assembly.clearance', 'assembly.interference']
    .every((kind) => liveQuery.get(kind)?.state === 'available' && headlessQuery.get(kind)?.state === 'disabled'));
check('I4 permissions keep event waits, narration export, and visible launch explicitly least-privilege',
  ['artifact.export-narration', 'ui.wait-events', 'session.launch-visible'].every((permission) => permissionIds.has(permission)) &&
  live.permissions.every((entry: any) => entry.default === 'denied'));
check('I4 UI event manifest advertises only real document, recovery, kernel, render, and artifact producers',
  ['document.changed', 'document.recovered', 'kernel.completed', 'render.completed', 'artifact.completed']
    .every((kind) => ui.eventCapabilities.some((entry: any) => entry.id === kind && entry.state === 'available')));
check('I4 keeps unimplemented kernel-failure and solve-change event producers explicitly disabled',
  ['kernel.progress', 'kernel.failed', 'assembly.solveChanged']
    .every((kind) => ui.eventCapabilities.some((entry: any) => entry.id === kind && entry.state === 'disabled')));

console.log(`\n${passed}/${passed + failed} V6 I4 hardening checks passed`);
if (failed) process.exitCode = 1;
