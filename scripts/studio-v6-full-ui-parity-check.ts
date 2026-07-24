import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// @ts-ignore Browser-native module intentionally has no declarations.
import { cadCapabilityManifest } from '../static/studio-agent-service.js';
// @ts-ignore Browser-native module intentionally has no declarations.
import { CAD_UI_COMMAND_REGISTRY, CAD_UI_CONTROL_REGISTRY, CAD_UI_EXPANDED_CONTROL_REGISTRY, cadUiFullParityReport } from '../static/studio-v6-ui-registry.js';

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

function parseAttributes(source: string) {
  return Object.fromEntries(
    [...source.matchAll(/\b([a-zA-Z][\w-]*)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
  );
}

function bindingMatches(
  binding: any,
  attributes: Record<string, string>,
) {
  if (binding.kind === 'element-id') return attributes.id === binding.elementId;
  if (binding.kind === 'attribute') return attributes[binding.attribute] === binding.value;
  return false;
}

function datasetProperty(attribute: string) {
  return attribute
    .replace(/^data-/, '')
    .replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function bindingSourceNeedles(binding: any) {
  if (binding.kind === 'element-id') {
    return [
      `id="${binding.elementId}"`,
      `.id = '${binding.elementId}'`,
      `.id = "${binding.elementId}"`,
    ];
  }
  if (binding.kind === 'attribute') {
    const property = datasetProperty(binding.attribute);
    const needles = [
      `${binding.attribute}="${binding.value}"`,
      `.dataset.${property} = '${binding.value}'`,
      `.dataset.${property} = "${binding.value}"`,
      `.setAttribute('${binding.attribute}', '${binding.value}')`,
      `.setAttribute("${binding.attribute}", "${binding.value}")`,
    ];
    if (binding.attribute === 'data-v6-control-id') {
      needles.push(`'${binding.value}'`, `"${binding.value}"`);
    }
    return needles;
  }
  return [];
}

console.log('\nCAD Studio V6 literal full-UI parity inventory');

const engineRoot = fileURLToPath(new URL('../', import.meta.url));
const pageSource = readFileSync(`${engineRoot}/src/render/models.ts`, 'utf8');
const studioSource = readFileSync(`${engineRoot}/static/studio.js`, 'utf8');
const cadPageStart = pageSource.indexOf('export function cadStudioPage');
const cadPageEnd = pageSource.indexOf('/** One pending model submission', cadPageStart);
const cadPageSource = pageSource.slice(cadPageStart, cadPageEnd);
const combinedSource = `${cadPageSource}\n${studioSource}`;

function sourceBlock(source: string, declaration: string, terminator = ']);') {
  const start = source.indexOf(declaration);
  if (start < 0) return '';
  const end = source.indexOf(terminator, start);
  return end < 0 ? source.slice(start) : source.slice(start, end + terminator.length);
}

const observedControlIds = new Set<string>();
const addObservedControlId = (value: string) => {
  if (/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(value)) observedControlIds.add(value);
};
for (const match of combinedSource.matchAll(/data-v6-control-id="([^"]+)"/g)) {
  addObservedControlId(match[1]);
}
for (const match of combinedSource.matchAll(/\.dataset\.v6ControlId\s*=\s*['"]([^'"]+)['"]/g)) {
  addObservedControlId(match[1]);
}
const dynamicBindingSource = sourceBlock(studioSource, 'const V6_DYNAMIC_CONTROL_BINDINGS');
for (const match of dynamicBindingSource.matchAll(/\[\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*\]/g)) {
  addObservedControlId(match[1]);
}
const sketchDimensionSource = sourceBlock(studioSource, 'const dimensionControlIds', '};');
for (const match of sketchDimensionSource.matchAll(/:\s*['"]([^'"]+)['"]/g)) {
  addObservedControlId(match[1]);
}

const ids = CAD_UI_CONTROL_REGISTRY.map((entry: any) => entry.id);
check('the source-owned control registry has unique stable IDs',
  ids.length > 100 && new Set(ids).size === ids.length,
  { count: ids.length, duplicates: ids.filter((id: string, index: number) => ids.indexOf(id) !== index) });

const expandedIds = CAD_UI_EXPANDED_CONTROL_REGISTRY.map((entry: any) => entry.id);
check('dynamic action variants expand into unique literal parity IDs',
  expandedIds.length > ids.length && new Set(expandedIds).size === expandedIds.length,
  {
    baseCount: ids.length,
    expandedCount: expandedIds.length,
    duplicates: expandedIds.filter((id: string, index: number) => expandedIds.indexOf(id) !== index),
  });

const contextualWithoutReason = CAD_UI_EXPANDED_CONTROL_REGISTRY
  .filter((entry: any) => entry.adapter === 'contextual' && !entry.contextualReasonCode)
  .map((entry: any) => entry.id);
check('every contextual control publishes a specific reason',
  contextualWithoutReason.length === 0,
  contextualWithoutReason);

const humanBindingKeys = new Set<string>();
const duplicateBindings: string[] = [];
for (const entry of CAD_UI_EXPANDED_CONTROL_REGISTRY as any[]) {
  for (const binding of entry.humanBindings) {
    if (binding.kind === 'dynamic-family') continue;
    const key = binding.kind === 'element-id'
      ? `id:${binding.elementId}`
      : `${binding.attribute}:${binding.value}`;
    if (humanBindingKeys.has(key)) duplicateBindings.push(key);
    humanBindingKeys.add(key);
  }
}
check('human control bindings are canonical rather than duplicated across semantic IDs',
  duplicateBindings.length === 0,
  duplicateBindings);

const missingSourceBindings: string[] = [];
for (const entry of CAD_UI_EXPANDED_CONTROL_REGISTRY as any[]) {
  for (const binding of entry.humanBindings) {
    if (binding.kind === 'dynamic-family') continue;
    const needles = bindingSourceNeedles(binding);
    if (!needles.some((needle) => combinedSource.includes(needle))) {
      missingSourceBindings.push(`${entry.id}:${needles.join(' OR ')}`);
    }
  }
}
check('every non-dynamic registry binding resolves to production Studio source',
  missingSourceBindings.length === 0,
  missingSourceBindings);

const unresolvedDynamicControlIds = CAD_UI_EXPANDED_CONTROL_REGISTRY
  .filter((entry: any) => entry.humanBindings.some((binding: any) => binding.kind === 'dynamic-family'))
  .map((entry: any) => entry.id);
check('every expanded dynamic-family variant has its own observable production control identity',
  unresolvedDynamicControlIds.length === 0,
  unresolvedDynamicControlIds);

const interactiveTags = [...cadPageSource.matchAll(/<(button|input|select|textarea|canvas|a|summary)\b([^>]*)>/g)]
  .map((match) => ({ tag: match[1], attributes: parseAttributes(match[2]) }))
  .filter(({ tag, attributes }) =>
    !(tag === 'a' && attributes.href?.startsWith('http')) &&
    !(tag === 'canvas' && !attributes.id));

const uncoveredStaticControls = interactiveTags.filter(({ attributes }) =>
  !CAD_UI_CONTROL_REGISTRY.some((entry: any) =>
    entry.humanBindings.some((binding: any) => bindingMatches(binding, attributes))));

check('every static human-operable Studio element resolves to the full-UI registry',
  uncoveredStaticControls.length === 0,
  uncoveredStaticControls.map(({ tag, attributes }) => ({
    tag,
    id: attributes.id,
    data: Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith('data-'))),
    href: attributes.href,
  })));

const documentOperations = new Set(
  cadCapabilityManifest({ visibleStudio: true }).operations
    .filter((entry: any) => entry.state === 'available')
    .map((entry: any) => entry.kind),
);
const missingDocumentOperations = [...new Set(
  CAD_UI_COMMAND_REGISTRY.flatMap((entry: any) => entry.operationKinds),
)].filter((kind) => !documentOperations.has(kind));
check('every command-registry transaction operation is advertised by the document protocol',
  missingDocumentOperations.length === 0,
  missingDocumentOperations);

const invalidPersistentControlMappings = CAD_UI_EXPANDED_CONTROL_REGISTRY
  .filter((entry: any) => entry.adapter === 'available' && entry.semanticAction === 'document.previewCommit')
  .filter((entry: any) =>
    entry.adapterTool !== 'cad_preview' ||
    entry.completionTool !== 'cad_commit' ||
    entry.permission !== 'project.edit' ||
    !entry.operationKinds.length ||
    entry.operationKinds.some((kind: string) => !documentOperations.has(kind)))
  .map((entry: any) => ({
    id: entry.id,
    adapterTool: entry.adapterTool,
    completionTool: entry.completionTool,
    permission: entry.permission,
    operationKinds: entry.operationKinds,
  }));
const persistentControls = CAD_UI_EXPANDED_CONTROL_REGISTRY
  .filter((entry: any) => entry.adapter === 'available' && entry.semanticAction === 'document.previewCommit');
const requiredPersistentControlIds = [
  'parameter.add',
  'parameter.row.rename',
  'parameter.row.set-value',
  'parameter.row.delete',
  'tree.feature.move-earlier',
  'tree.feature.move-later',
  'tree.feature.rollback-toggle',
  'tree.feature.delete',
  'tree.feature.drag-reorder',
  'tree.inspection.section.toggle',
  'tree.inspection.section.delete',
  'tree.inspection.explode.toggle',
  'tree.inspection.explode.delete',
  'tree.inspection.stage.visibility',
  'tree.inspection.stage.spacing-less',
  'tree.inspection.stage.spacing-more',
  'tree.inspection.measurement.delete',
  'tree.entity.pattern-instance.skip',
  'tree.entity.pattern.visibility',
  'tree.entity.pattern.delete',
  'tree.body.activate',
  'tree.body.visibility',
  'tree.body.rename',
  'tree.body.suppress',
  'tree.body.delete',
  'tree.assembly.occurrence.visibility',
  'tree.assembly.occurrence.suppress',
  'tree.assembly.mate.suppress',
  'tree.assembly.mate.delete',
  'inspector.context.body.rename',
  'inspector.context.body.activate',
  'inspector.context.body.visibility',
  'inspector.context.body.suppress',
  'inspector.context.body.delete',
  'inspector.context.occurrence.visibility',
  'inspector.context.occurrence.suppress',
  'inspector.context.occurrence.delete',
  'inspector.context.mate.suppress',
  'inspector.context.mate.delete',
  'inspector.context.feature.delete',
  'inspector.context.pattern.skip',
  'inspector.context.body.subtract',
  'inspector.context.body.intersect',
  'inspector.context.body.union',
  'inspector.context.feature.pattern-count',
  'inspector.context.feature.pattern-a',
  'inspector.context.feature.pattern-b',
];
const missingRequiredPersistentControlIds = requiredPersistentControlIds
  .filter((id) => !persistentControls.some((entry: any) => entry.id === id));
check('every available persistent control maps to exact preview, commit, permission, and advertised document operations',
  missingRequiredPersistentControlIds.length === 0 && invalidPersistentControlMappings.length === 0,
  { count: persistentControls.length, missingRequiredPersistentControlIds, invalidPersistentControlMappings });

const materializationControls = [
  'tree.entity.pattern-instance.independent',
  'tree.entity.pattern.dissolve',
].map((id) => CAD_UI_EXPANDED_CONTROL_REGISTRY.find((entry: any) => entry.id === id));
check('pattern materialization controls use the kernel-backed semantic tree preview and exact commit path',
  materializationControls.every((entry: any) =>
    entry?.adapter === 'available' &&
    entry.semanticAction === 'tree.invoke' &&
    entry.permission === 'project.edit' &&
    entry.adapterTool === 'cad_ui' &&
    entry.completionTool === 'cad_commit' &&
    entry.operationKinds?.join(',') === 'pattern.materialize'),
  materializationControls);

const projectBoundaryControls = new Map(
  [
    'dialog.template.use',
    'dialog.transition.undo',
    'dialog.transition.close',
    'recovery.entry.restore',
    'welcome.template.starter-plate',
    'welcome.template.electronics-tray',
    'welcome.template.four-hole-plate',
    'welcome.template.turned-knob',
    'welcome.blank-sketch',
  ].map((id) => [id, CAD_UI_EXPANDED_CONTROL_REGISTRY.find((entry: any) => entry.id === id)]),
);
const welcomeTemplateIds = new Map([
  ['welcome.template.starter-plate', 'starter-plate'],
  ['welcome.template.electronics-tray', 'electronics-tray'],
  ['welcome.template.four-hole-plate', 'four-hole-plate'],
  ['welcome.template.turned-knob', 'turned-knob'],
]);
check('project-boundary controls publish explicit typed transition actions and exact welcome-template identities',
  [...projectBoundaryControls.values()].every((entry: any) => entry?.adapter === 'available') &&
  projectBoundaryControls.get('dialog.template.use')?.semanticAction === 'template.use' &&
  projectBoundaryControls.get('dialog.template.use')?.permission === 'project.edit' &&
  projectBoundaryControls.get('dialog.transition.undo')?.semanticAction === 'transition.undo' &&
  projectBoundaryControls.get('dialog.transition.undo')?.permission === 'project.edit' &&
  projectBoundaryControls.get('dialog.transition.close')?.semanticAction === 'transition.dismiss' &&
  projectBoundaryControls.get('recovery.entry.restore')?.semanticAction === 'recovery.restore' &&
  projectBoundaryControls.get('recovery.entry.restore')?.permission === 'project.recover' &&
  projectBoundaryControls.get('welcome.blank-sketch')?.semanticAction === 'project.newBlank' &&
  [...welcomeTemplateIds].every(([id, templateId]) => {
    const entry: any = projectBoundaryControls.get(id);
    return entry?.semanticAction === 'template.use' &&
      entry.permission === 'project.edit' &&
      entry.templateId === templateId;
  }),
  Object.fromEntries(projectBoundaryControls));

const semanticSurfaceControls = new Map(
  ['app.exit', 'viewport.canvas', 'sketch.canvas']
    .map((id) => [id, CAD_UI_EXPANDED_CONTROL_REGISTRY.find((entry: any) => entry.id === id)]),
);
check('application exit and both modeling canvases publish complete coordinate-free semantic adapters',
  [...semanticSurfaceControls.values()].every((entry: any) => entry?.adapter === 'available' && entry.adapterTool === 'cad_ui') &&
  semanticSurfaceControls.get('app.exit')?.semanticAction === 'application.navigate' &&
  semanticSurfaceControls.get('app.exit')?.permission === 'ui.navigate' &&
  ['selection.set', 'viewport.setCamera', 'viewport.fitSelection'].every((kind) =>
    semanticSurfaceControls.get('viewport.canvas')?.semanticActions?.includes(kind)) &&
  semanticSurfaceControls.get('viewport.canvas')?.permissions?.join(',') === 'ui.select,ui.navigate' &&
  ['sketch.setTool', 'command.setInput', 'command.clearInput'].every((kind) =>
    semanticSurfaceControls.get('sketch.canvas')?.semanticActions?.includes(kind)) &&
  semanticSurfaceControls.get('sketch.canvas')?.permissions?.join(',') === 'ui.command-draft' &&
  !/pointer|clientX|clientY|selector|coordinate/i.test(JSON.stringify(Object.fromEntries(semanticSurfaceControls))),
  Object.fromEntries(semanticSurfaceControls));

const importControls = ['project.open', 'welcome.open']
  .map((id) => CAD_UI_EXPANDED_CONTROL_REGISTRY.find((entry: any) => entry.id === id));
check('both normal project-open controls use the bounded host-file import adapter and explicit replace authority',
  importControls.every((entry: any) =>
    entry?.adapter === 'available' &&
    entry.semanticAction === 'artifact.import' &&
    entry.permission === 'project.replace' &&
    entry.adapterTool === 'cad_artifact'),
  importControls);

const inspectorCommandControls = CAD_UI_EXPANDED_CONTROL_REGISTRY
  .filter((entry: any) => entry.parentControlId === 'inspector.context' && entry.semanticAction === 'command.open' && entry.adapter === 'available');
const advertisedCommandIds = new Set(CAD_UI_COMMAND_REGISTRY.map((entry: any) => entry.id));
const invalidInspectorCommandMappings = inspectorCommandControls
  .filter((entry: any) =>
    entry.permission !== 'ui.command-draft' ||
    (!advertisedCommandIds.has(entry.commandId) &&
      !['selected-mate-kind', 'selected-feature-kind', 'selected-sketch-role'].includes(entry.commandResolver)))
  .map((entry: any) => ({
    id: entry.id,
    commandId: entry.commandId,
    commandResolver: entry.commandResolver,
    permission: entry.permission,
  }));
check('every available inspector command redirect resolves to an advertised normal command with draft authority',
  inspectorCommandControls.length === 10 && invalidInspectorCommandMappings.length === 0,
  { count: inspectorCommandControls.length, invalidInspectorCommandMappings });

const createBodyControl = CAD_UI_EXPANDED_CONTROL_REGISTRY.find((entry: any) => entry.id === 'body.create');
check('create-body control opens the released normal extrude command in new-body mode',
  createBodyControl?.adapter === 'available' &&
  createBodyControl?.semanticAction === 'control.invoke' &&
  createBodyControl?.permission === 'ui.command-draft' &&
  createBodyControl?.commandId === 'model.extrude' &&
  createBodyControl?.operationKinds?.includes('feature.extrude'),
  createBodyControl);

const report = cadUiFullParityReport({ observedControlIds: [...observedControlIds] });
check('the parity report reaches the fixed denominator with zero missing or orphan controls',
  report.denominator === CAD_UI_EXPANDED_CONTROL_REGISTRY.length &&
  report.commandDenominator === CAD_UI_COMMAND_REGISTRY.length &&
  report.commandFieldDenominator === CAD_UI_COMMAND_REGISTRY.reduce((count: number, entry: any) => count + entry.fields.length, 0) &&
  report.commandFieldDenominator > report.commandDenominator &&
  report.covered > 0 &&
  report.accounted === report.denominator &&
  report.coveragePercent === 100 &&
  report.directCoveragePercent < 100 &&
  report.missing === 0 &&
  report.missingAdapterIds.length === 0 &&
  report.commandFieldCovered === report.commandDenominator &&
  report.missingFieldCoverageIds.length === 0 &&
  report.observedOrphanIds.length === 0 &&
  report.complete === true,
  report);

console.log(`  INFO registry controls ${report.denominator}, commands ${report.commandDenominator}, typed command fields ${report.commandFieldDenominator}, available ${report.covered}, contextual ${report.contextual}, accounted ${report.accounted}, missing ${report.missing}, coverage ${report.coveragePercent}%`);
console.log(`\n${passed}/${passed + failed} V6 full-UI inventory checks passed`);
if (failed) process.exitCode = 1;
