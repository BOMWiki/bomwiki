// @ts-expect-error Browser-native module intentionally has no declarations.
import * as interactionTools from '../static/studio-v6-interaction.js';

const {
  CAD_UI_ACTION_KINDS,
  CAD_UI_COMMAND_CAPABILITIES,
  CAD_UI_EVENT_KINDS,
  CadStudioInteractionRuntime,
  CadUiError,
  buildCadUiCommandTransaction,
  cadUiCapabilityManifest,
} = interactionTools;

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

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

console.log('\nCAD Studio V6 semantic interaction runtime');

const entities = new Set(['body:body-shaft', 'feature:feature-shaft', 'occurrence:occurrence-shaft']);
const faceRef = {
  owner: { kind: 'body', id: 'body-shaft' },
  stableId: 'face:shaft-end',
  topologySignature: { kind: 'face', p: [0, 0, 15], n: [0, 0, 1] },
  expectedGeometry: 'plane',
};
const visibleState: any = {
  activeDocument: { kind: 'part', id: 'part-v6-i0' },
  workspaceId: 'solid',
  selection: [],
  tree: {
    expanded: [],
    sections: [
      { sectionId: 'origin', expanded: true, visible: true },
      { sectionId: 'datums', expanded: true, visible: true },
    ],
  },
  panels: [
    { panelId: 'model-tree', open: true },
    { panelId: 'inspector', open: false },
    { panelId: 'project', open: false },
    { panelId: 'history', open: true },
    { panelId: 'diagnostics', open: false },
  ],
  viewport: {
    viewId: 'iso',
    camera: { position: [30, 30, 30], target: [0, 0, 0], up: [0, 1, 0], projection: 'perspective' },
    displayMode: 'shaded-edges',
    framedEntities: [],
    renderState: 'idle',
    renderedDocumentRevision: 7,
    renderedKernelRevision: 7,
    renderedUiRevision: 0,
  },
  connection: { clientLabel: 'I0 test agent', mode: 'preview-required', paused: false },
};
const narration: any[] = [];
const delays: number[] = [];
const settlements: any[] = [];
const actionContexts: any[] = [];
let documentRevision = 7;
let renderSerial = 0;
let now = Date.UTC(2026, 6, 23, 0, 0, 0);

function restoreScope(target: any, source: any, scope: string) {
  if (scope === 'workspace') target.workspaceId = source.workspaceId;
  if (scope === 'selection') target.selection = structuredClone(source.selection);
  if (scope === 'tree') target.tree = structuredClone(source.tree);
  if (scope === 'panels') target.panels = structuredClone(source.panels);
  if (scope === 'viewport') target.viewport = structuredClone(source.viewport);
  if (scope === 'command') target.activeCommand = structuredClone(source.activeCommand);
  if (scope === 'preview') target.preview = structuredClone(source.preview);
}

const adapter = {
  snapshot: () => structuredClone(visibleState),
  validateAction(action: any) {
    const entity = action.entity?.owner || action.entity;
    if (entity && !entities.has(`${entity.kind}:${entity.id}`)) {
      throw new CadUiError('SELECTION_AMBIGUOUS', 'Unknown test entity.');
    }
  },
  applyAction(action: any, context: any) {
    actionContexts.push({ kind: action.kind, ...structuredClone(context) });
    if (action.kind === 'workspace.activate') visibleState.workspaceId = action.workspaceId;
    if (action.kind === 'selection.set') visibleState.selection = [structuredClone(action.entity)];
    if (action.kind === 'selection.add' && !visibleState.selection.some((entry: any) => JSON.stringify(entry) === JSON.stringify(action.entity))) {
      visibleState.selection.push(structuredClone(action.entity));
    }
    if (action.kind === 'selection.remove') {
      visibleState.selection = visibleState.selection.filter((entry: any) => JSON.stringify(entry) !== JSON.stringify(action.entity));
    }
    if (action.kind === 'selection.clear') visibleState.selection = [];
    if (action.kind === 'tree.reveal') visibleState.tree.revealed = structuredClone(action.entity);
    if (action.kind === 'tree.expand' && !visibleState.tree.expanded.some((entry: any) => entry.kind === action.entity.kind && entry.id === action.entity.id)) {
      visibleState.tree.expanded.push(structuredClone(action.entity));
    }
    if (action.kind === 'tree.collapse') {
      visibleState.tree.expanded = visibleState.tree.expanded.filter((entry: any) => entry.kind !== action.entity.kind || entry.id !== action.entity.id);
    }
    if (action.kind === 'tree.setSectionExpanded') {
      visibleState.tree.sections = visibleState.tree.sections.map((entry: any) =>
        entry.sectionId === action.sectionId ? { ...entry, expanded: action.expanded } : entry);
    }
    if (action.kind === 'inspector.showEntity') {
      visibleState.selection = [structuredClone(action.entity)];
      visibleState.panels = visibleState.panels.map((panel: any) =>
        panel.panelId === 'inspector' ? { panelId: 'inspector', open: true, target: structuredClone(action.entity) } : panel);
    }
    if (action.kind === 'viewport.standardView') visibleState.viewport.viewId = action.viewId;
    if (action.kind === 'viewport.fitAll') visibleState.viewport.viewId = 'fit';
    if (action.kind === 'viewport.fitSelection') {
      visibleState.viewport.viewId = 'fit-selection';
      visibleState.viewport.framedEntities = visibleState.selection.map((entry: any) => structuredClone(entry.owner || entry));
    }
    if (action.kind === 'viewport.setCamera') {
      visibleState.viewport.camera = structuredClone(action.camera);
      delete visibleState.viewport.viewId;
    }
    if (action.kind === 'viewport.setDisplayMode') visibleState.viewport.displayMode = action.displayModeId;
    if (action.kind === 'viewport.activateSection') visibleState.viewport.activeSectionId = action.sectionId;
    if (action.kind === 'viewport.activateExplodedView') visibleState.viewport.activeExplodedViewId = action.explodedViewId;
    if (action.kind === 'viewport.clearInspectionView') {
      delete visibleState.viewport.activeSectionId;
      delete visibleState.viewport.activeExplodedViewId;
    }
    if (action.kind === 'panel.open' || action.kind === 'panel.close') {
      visibleState.panels = visibleState.panels.map((panel: any) =>
        panel.panelId === action.panelId ? { ...panel, open: action.kind === 'panel.open' } : panel);
    }
    if (action.kind === 'history.showRevision') visibleState.history = { visibleRevision: action.revision };
    if (action.kind === 'diagnostics.show') {
      visibleState.panels = visibleState.panels.map((panel: any) =>
        panel.panelId === 'diagnostics' ? { ...panel, open: true } : panel);
    }
    if (action.kind === 'presentation.focusAction') visibleState.focusedActionId = action.actionId;
    return { applied: action.kind };
  },
  restoreSnapshot(snapshot: any, { scopes = [] }: any) {
    for (const scope of scopes) restoreScope(visibleState, snapshot, scope);
  },
  waitForSettled(action: any, { targetUiRevision }: any) {
    renderSerial++;
    visibleState.viewport.renderedUiRevision = targetUiRevision;
    const result = {
      actionKind: action.kind,
      renderSerial,
      renderedDocumentRevision: documentRevision,
      renderedUiRevision: targetUiRevision,
      renderState: 'idle',
    };
    settlements.push(result);
    return result;
  },
  showNarration(cue: any) {
    narration.push({ phase: 'show', cue });
  },
  completeNarration(cue: any) {
    narration.push({ phase: 'complete', cue });
  },
};

const runtime = new CadStudioInteractionRuntime({
  projectId: () => 'project-v6-i0',
  documentRevision: () => documentRevision,
  adapter,
  now: () => now++,
  delay: async (ms: number) => { delays.push(ms); },
});
const permissions = ['ui.read', 'ui.select', 'ui.navigate', 'ui.present-demo', 'ui.present-narration'];

const manifest = cadUiCapabilityManifest();
check('manifest has a stable V6 UI profile and deterministic hash',
  manifest.profile === 'bomwiki.cad.agentic-ui/v1' &&
  manifest.manifestHash === cadUiCapabilityManifest().manifestHash &&
  manifest.actions.some((entry: any) => entry.id === 'viewport.fitAll' && entry.state === 'available'));
const compactManifest = runtime.capabilities();
const selectedManifestSchemas = runtime.capabilities({
  detail: 'schemas',
  controlIds: ['assembly.component-transform'],
  commandIds: ['assembly.component-transform'],
  actionIds: ['command.open', 'command.setInput'],
});
let invalidCapabilityError: any = null;
try {
  runtime.capabilities({ detail: 'schemas', actionIds: ['pointer.click'] });
} catch (error) {
  invalidCapabilityError = error;
}
check('semantic UI discovery defaults to a compact complete summary and loads only selected full schemas',
  compactManifest.uiCapabilityDiscovery?.detail === 'summary' &&
  compactManifest.controls.length === 0 &&
  compactManifest.commands.length === manifest.commands.length &&
  compactManifest.actions.length === manifest.actions.length &&
  compactManifest.commands.every((entry: any) => Array.isArray(entry.fieldIds) && !('fields' in entry)) &&
  compactManifest.actions.every((entry: any) => !('inputSchema' in entry)) &&
  Buffer.byteLength(JSON.stringify(compactManifest)) < 35_000 &&
  selectedManifestSchemas.controls.map((entry: any) => entry.id).join(',') === 'assembly.component-transform' &&
  selectedManifestSchemas.commands.map((entry: any) => entry.id).join(',') === 'assembly.component-transform' &&
  selectedManifestSchemas.actions.map((entry: any) => entry.id).join(',') === 'command.open,command.setInput' &&
  selectedManifestSchemas.commands[0].fields.length > 0 &&
  selectedManifestSchemas.actions.every((entry: any) => entry.inputSchema),
  {
    compactBytes: Buffer.byteLength(JSON.stringify(compactManifest)),
    selectedBytes: Buffer.byteLength(JSON.stringify(selectedManifestSchemas)),
  });
check('semantic UI capability discovery fails closed for an unadvertised action ID',
  invalidCapabilityError instanceof CadUiError &&
  invalidCapabilityError.code === 'INVALID_CAPABILITY_QUERY' &&
  /pointer\.click/.test(invalidCapabilityError.message || ''),
  invalidCapabilityError);
check('manifest defines every specified action union member with a closed schema and explicit release state',
  manifest.actions.length === CAD_UI_ACTION_KINDS.length &&
  CAD_UI_ACTION_KINDS.every((kind: string) => manifest.actions.some((entry: any) =>
    entry.id === kind && ['available', 'disabled'].includes(entry.state) && entry.inputSchema?.additionalProperties === false)));
check('project-boundary actions are closed, released, and permission-separated from ordinary navigation',
  manifest.actions.find((entry: any) => entry.id === 'template.use')?.permission === 'project.edit' &&
  manifest.actions.find((entry: any) => entry.id === 'project.newBlank')?.permission === 'project.edit' &&
  manifest.actions.find((entry: any) => entry.id === 'recovery.restore')?.permission === 'project.recover' &&
  manifest.actions.find((entry: any) => entry.id === 'transition.undo')?.permission === 'project.edit' &&
  manifest.actions.find((entry: any) => entry.id === 'transition.dismiss')?.permission === 'ui.navigate' &&
  manifest.actions.find((entry: any) => entry.id === 'application.navigate')?.permission === 'ui.navigate' &&
  manifest.actions.find((entry: any) => entry.id === 'template.use')?.inputSchema?.required?.join(',') === 'kind,templateId' &&
  manifest.actions.find((entry: any) => entry.id === 'recovery.restore')?.inputSchema?.required?.join(',') === 'kind,snapshotId');
const selectionSignatureSchemas = manifest.actions
  .find((entry: any) => entry.id === 'selection.set')
  ?.inputSchema?.properties?.entity?.oneOf?.[1]?.properties?.topologySignature?.oneOf;
check('subshape topology signatures are closed typed face, edge, and vertex unions',
  Array.isArray(selectionSignatureSchemas) &&
  selectionSignatureSchemas.map((entry: any) => entry.properties?.kind?.const).join(',') === 'face,edge,vertex' &&
  selectionSignatureSchemas.every((entry: any) => entry.additionalProperties === false));
check('manifest defines every specified event union member without implying unreleased producers',
  manifest.events.length === CAD_UI_EVENT_KINDS.length &&
  CAD_UI_EVENT_KINDS.every((kind: string) => manifest.events.includes(kind)) &&
  manifest.eventCapabilities.some((entry: any) => entry.id === 'render.completed' && entry.state === 'available') &&
  manifest.eventCapabilities.some((entry: any) => entry.id === 'artifact.completed' && entry.state === 'available') &&
  manifest.eventCapabilities.some((entry: any) => entry.id === 'kernel.completed' && entry.state === 'available'));
const transformCommand = manifest.commands.find((entry: any) => entry.id === 'assembly.component-transform');
check('I3 advertises advanced modeling, assembly, and saved-inspection families inside the fully typed command denominator',
  transformCommand?.state === 'available' &&
  transformCommand.operationKinds.join(',') === 'component.update' &&
  transformCommand.fields.map((entry: any) => `${entry.id}:${entry.kind}`).join(',') === 'occurrence:selection,gizmoMode:enum,gizmoSnap:number-or-expression,transform:matrix4' &&
  CAD_UI_COMMAND_CAPABILITIES.length === 48 &&
  CAD_UI_COMMAND_CAPABILITIES.filter((entry: any) => entry.id.startsWith('model.')).length === 23 &&
  CAD_UI_COMMAND_CAPABILITIES.filter((entry: any) => entry.id.startsWith('assembly.mate.')).length === 10 &&
  CAD_UI_COMMAND_CAPABILITIES.filter((entry: any) =>
    ['inspection.section', 'inspection.explode', 'inspection.stage', 'inspection.material', 'inspection.measure'].includes(entry.id)).length === 5 &&
  manifest.commands.length === 48 &&
  manifest.fullUiParity.commandFieldCovered === manifest.fullUiParity.commandDenominator &&
  manifest.actions.find((entry: any) => entry.id === 'command.bindSelection')?.inputSchema?.properties?.fieldId?.maxLength === 200 &&
  Array.isArray(manifest.actions.find((entry: any) => entry.id === 'command.setInput')?.inputSchema?.properties?.value?.oneOf));
const commandBuild = buildCadUiCommandTransaction({
  draft: {
    commandId: 'assembly.component-transform',
    draftId: 'draft-runtime-check',
    baseRevision: 7,
    boundSelections: { occurrence: [{ kind: 'occurrence', id: 'occurrence-shaft' }] },
    inputValues: { transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1] },
  },
  expectedRevision: 7,
  transactionId: 'transaction-visible-transform',
});
let nonRigidCode = '';
try {
  buildCadUiCommandTransaction({
    draft: {
      commandId: 'assembly.component-transform',
      draftId: 'draft-invalid-transform',
      baseRevision: 7,
      boundSelections: { occurrence: [{ kind: 'occurrence', id: 'occurrence-shaft' }] },
      inputValues: { transform: [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1] },
    },
    expectedRevision: 7,
    transactionId: 'transaction-invalid-transform',
  });
} catch (error: any) {
  nonRigidCode = error.code;
}
check('I3 visible command builder produces one normal revision-bound transaction and rejects non-rigid matrices',
  commandBuild.transaction.expectedRevision === 7 &&
  commandBuild.transaction.atomic === true &&
  commandBuild.transaction.operations.length === 1 &&
  commandBuild.transaction.operations[0].kind === 'component.update' &&
  commandBuild.transaction.operations[0].input.occurrenceId === 'occurrence-shaft' &&
  commandBuild.transactionHash.startsWith('fnv1a32:') &&
  nonRigidCode === 'COMMAND_FIELD_INVALID');
check('initial snapshot exposes the complete bounded I0 state shape and independent revisions',
  runtime.snapshot().activeDocument.id === 'part-v6-i0' &&
  runtime.snapshot().workspaceId === 'solid' &&
  Array.isArray(runtime.snapshot().selection) &&
  Array.isArray(runtime.snapshot().tree.expanded) &&
  runtime.snapshot().tree.sections.some((entry: any) => entry.sectionId === 'datums' && entry.expanded === true) &&
  Array.isArray(runtime.snapshot().panels) &&
  runtime.snapshot().viewport.renderedDocumentRevision === 7 &&
  runtime.snapshot().connection.paused === false &&
  runtime.snapshot().documentRevision === 7 &&
  runtime.snapshot().uiRevision === 0 &&
  runtime.snapshot().presentation.state === 'idle');

let transitionCode = '';
try {
  await runtime.apply({
    expectedUiRevision: 0,
    presentation: { transition: 'teleport' },
    actions: [{ kind: 'workspace.activate', workspaceId: 'view' }],
  }, { permissions });
} catch (error: any) {
  transitionCode = error.code;
}
check('manifest releases animation while unknown transitions still fail closed',
  manifest.transitionCapabilities.find((entry: any) => entry.id === 'animate')?.state === 'available' &&
  transitionCode === 'UI_CAPABILITY_DISABLED' &&
  runtime.snapshot().uiRevision === 0);

let unknownCommandCode = '';
try {
  await runtime.apply({
    expectedUiRevision: 0,
    actions: [{ kind: 'command.open', commandId: 'not-released-yet' }],
  }, { permissions });
} catch (error: any) {
  unknownCommandCode = error.code;
}
check('released command actions reject unadvertised command IDs before UI control',
  manifest.actions.find((entry: any) => entry.id === 'command.open')?.state === 'available' &&
  unknownCommandCode === 'COMMAND_NOT_AVAILABLE' &&
  runtime.snapshot().uiRevision === 0);

let coordinateCode = '';
try {
  await runtime.apply({
    expectedUiRevision: 0,
    actions: [{ kind: 'selection.clear', clientX: 240, clientY: 180 }],
  }, { permissions });
} catch (error: any) {
  coordinateCode = error.code;
}
check('semantic action schemas reject pointer-coordinate payloads before UI control',
  coordinateCode === 'UI_CAPABILITY_DISABLED' && runtime.snapshot().uiRevision === 0);

let sketchShapeCode = '';
try {
  await runtime.apply({
    expectedUiRevision: 0,
    actions: [{ kind: 'sketch.shape.update', shapeIndex: -1, property: 'd', value: 8 }],
  }, { permissions });
} catch (error: any) {
  sketchShapeCode = error.code;
}
check('selected-sketch shape actions publish closed bounded schemas before UI control',
  manifest.actions.some((entry: any) => entry.id === 'sketch.shape.select' && entry.state === 'available') &&
  manifest.actions.some((entry: any) => entry.id === 'sketch.shape.update' && entry.state === 'available') &&
  manifest.actions.some((entry: any) => entry.id === 'sketch.shape.delete' && entry.state === 'available') &&
  sketchShapeCode === 'COMMAND_FIELD_INVALID' &&
  runtime.snapshot().uiRevision === 0);

let topologyCode = '';
try {
  await runtime.apply({
    expectedUiRevision: 0,
    actions: [{
      kind: 'selection.set',
      entity: {
        ...faceRef,
        topologySignature: { ...faceRef.topologySignature, selector: '#viewport canvas' },
      },
    }],
  }, { permissions });
} catch (error: any) {
  topologyCode = error.code;
}
check('closed topology signatures reject selector leakage before UI control',
  topologyCode === 'SELECTION_KIND_UNSUPPORTED' && runtime.snapshot().uiRevision === 0);

const first = await runtime.apply({
  expectedUiRevision: 0,
  correlationId: 'corr-v6-visible',
  actions: [
    { kind: 'workspace.activate', workspaceId: 'view' },
    { kind: 'selection.set', entity: { kind: 'body', id: 'body-shaft' } },
    { kind: 'tree.reveal', entity: { kind: 'body', id: 'body-shaft' } },
    { kind: 'inspector.showEntity', entity: { kind: 'body', id: 'body-shaft' } },
    { kind: 'viewport.fitAll' },
  ],
}, { permissions });
check('one semantic batch coordinates workspace, selection, tree, inspector, and viewport',
  first.uiRevision === 1 &&
  first.snapshot.workspaceId === 'view' &&
  first.snapshot.selection[0].id === 'body-shaft' &&
  first.snapshot.tree.revealed.id === 'body-shaft' &&
  first.snapshot.panels.find((panel: any) => panel.panelId === 'inspector')?.open === true &&
  first.snapshot.viewport.viewId === 'fit');
check('every semantic action settles against renderer evidence before its settled event',
  settlements.length === 5 &&
  settlements.every((entry, index) => entry.renderSerial === index + 1 && entry.renderedUiRevision === 1) &&
  first.snapshot.viewport.renderedUiRevision === 1);
check('ephemeral UI actions never advance the document revision',
  first.snapshot.documentRevision === 7 && documentRevision === 7);
check('runtime narration is generated from capability templates and correlated with the action trace',
  narration.length === 10 &&
  narration.every((entry) => entry.cue.correlationId === 'corr-v6-visible') &&
  narration.every((entry) => !/prompt|reasoning|secret/i.test(entry.cue.text)));

const eventPage = await runtime.events({ afterCursor: 0, limit: 100 });
check('runtime emits ordered renderer, action, narration, UI, and selection events',
  eventPage.events.length > 15 &&
  eventPage.events.every((entry: any, index: number, all: any[]) => index === 0 || entry.cursor > all[index - 1].cursor) &&
  ['render.completed', 'presentation.stepStarted', 'presentation.stepSettled', 'narration.cueStarted', 'narration.cueCompleted', 'ui.changed', 'selection.changed']
    .every((kind) => eventPage.events.some((entry: any) => entry.kind === kind)));

let staleCode = '';
try {
  await runtime.apply({ expectedUiRevision: 0, actions: [{ kind: 'selection.clear' }] }, { permissions });
} catch (error: any) {
  staleCode = error.code;
}
check('stale UI revision fails closed without changing visible state',
  staleCode === 'UI_REVISION_CONFLICT' && runtime.snapshot().selection[0].id === 'body-shaft' && runtime.snapshot().uiRevision === 1);

let invalidCode = '';
try {
  await runtime.apply({
    expectedUiRevision: 1,
    actions: [
      { kind: 'selection.clear' },
      { kind: 'selection.set', entity: { kind: 'body', id: 'body-missing' } },
    ],
  }, { permissions });
} catch (error: any) {
  invalidCode = error.code;
}
check('batch validation is atomic before any UI adapter action runs',
  invalidCode === 'SELECTION_AMBIGUOUS' && runtime.snapshot().selection[0].id === 'body-shaft' && runtime.snapshot().uiRevision === 1);

let mixedTransitionCode = '';
try {
  await runtime.apply({
    expectedUiRevision: 1,
    actions: [
      { kind: 'template.use', templateId: 'starter-plate' },
      { kind: 'workspace.activate', workspaceId: 'solid' },
    ],
  }, { permissions: [...permissions, 'project.edit'] });
} catch (error: any) {
  mixedTransitionCode = error.code;
}
check('project transitions must be isolated in one semantic batch before any adapter action runs',
  mixedTransitionCode === 'UI_CAPABILITY_DISABLED' &&
  runtime.snapshot().selection[0].id === 'body-shaft' &&
  runtime.snapshot().uiRevision === 1);

let permissionCode = '';
try {
  await runtime.apply({ expectedUiRevision: 1, actions: [{ kind: 'selection.clear' }] }, { permissions: ['ui.read'] });
} catch (error: any) {
  permissionCode = error.code;
}
check('UI control requires an explicit session grant', permissionCode === 'PERMISSION_DENIED');

const i2StartSettlement = settlements.length;
const i2 = await runtime.apply({
  expectedUiRevision: 1,
  correlationId: 'corr-v6-i2-control',
  presentation: { mode: 'normal', transition: 'animate' },
  actions: [
    { kind: 'document.activate', documentId: 'part-v6-i0' },
    { kind: 'selection.set', entity: { kind: 'body', id: 'body-shaft' } },
    { kind: 'selection.add', entity: { kind: 'feature', id: 'feature-shaft' } },
    { kind: 'selection.add', entity: faceRef },
    { kind: 'selection.remove', entity: { kind: 'feature', id: 'feature-shaft' } },
    { kind: 'tree.expand', entity: { kind: 'occurrence', id: 'occurrence-shaft' } },
    { kind: 'tree.collapse', entity: { kind: 'occurrence', id: 'occurrence-shaft' } },
    { kind: 'tree.setSectionExpanded', sectionId: 'datums', expanded: false },
    { kind: 'panel.open', panelId: 'project' },
    { kind: 'panel.close', panelId: 'project' },
    { kind: 'viewport.setDisplayMode', displayModeId: 'ghost' },
    { kind: 'viewport.activateSection', sectionId: 'section-shaft' },
    { kind: 'viewport.activateExplodedView', explodedViewId: 'explode-shaft' },
    { kind: 'viewport.clearInspectionView' },
    {
      kind: 'viewport.setCamera',
      camera: { position: [44, 28, 31], target: [0, 0, 8], up: [0, 1, 0], projection: 'perspective' },
    },
    { kind: 'viewport.fitSelection' },
    { kind: 'history.showRevision', revision: 7 },
    { kind: 'diagnostics.show' },
    { kind: 'presentation.focusAction', actionId: 'viewport' },
    { kind: 'presentation.waitForSettled', correlationId: 'corr-v6-i2-control' },
  ],
}, { permissions });
const i2Settlements = settlements.slice(i2StartSettlement);
check('I2 controls multi-selection and exact subshape refs without pointer data',
  i2.uiRevision === 2 &&
  i2.snapshot.selection.length === 2 &&
  i2.snapshot.selection.some((entry: any) => entry.stableId === faceRef.stableId) &&
  !JSON.stringify(i2.snapshot.selection).includes('clientX'));
check('I2 controls panels, camera fit, display, inspection, history, and focus as ephemeral UI state',
  i2.snapshot.documentRevision === 7 &&
  i2.snapshot.viewport.viewId === 'fit-selection' &&
  i2.snapshot.viewport.displayMode === 'ghost' &&
  !i2.snapshot.viewport.activeSectionId &&
  !i2.snapshot.viewport.activeExplodedViewId &&
  i2.snapshot.viewport.framedEntities.some((entry: any) => entry.id === 'body-shaft') &&
  i2.snapshot.tree.sections.some((entry: any) => entry.sectionId === 'datums' && entry.expanded === false) &&
  i2.snapshot.panels.find((panel: any) => panel.panelId === 'diagnostics')?.open === true &&
  i2.snapshot.history.visibleRevision === 7 &&
  i2.snapshot.focusedActionId === 'viewport');
check('I2 animated choreography passes transition intent to every adapter action and settles each renderer state in order',
  i2Settlements.length === 20 &&
  i2Settlements.every((entry) => entry.renderedUiRevision === 2) &&
  actionContexts.slice(-20).every((entry) => entry.transition === 'animate') &&
  (await runtime.events({ afterCursor: eventPage.latestCursor, limit: 200 })).events
    .filter((entry: any) => entry.correlationId === 'corr-v6-i2-control' && entry.kind === 'presentation.stepSettled').length === 20);

const concurrentState: any = structuredClone(visibleState);
const concurrentAdapter = {
  snapshot: () => structuredClone(concurrentState),
  applyAction(action: any) {
    if (action.kind === 'workspace.activate') concurrentState.workspaceId = action.workspaceId;
    return { applied: action.kind };
  },
  restoreSnapshot(snapshot: any, { scopes = [] }: any) {
    for (const scope of scopes) restoreScope(concurrentState, snapshot, scope);
  },
  waitForSettled(_action: any, { targetUiRevision }: any) {
    return { renderSerial: ++renderSerial, renderedUiRevision: targetUiRevision, renderState: 'idle' };
  },
};
const concurrentRuntime = new CadStudioInteractionRuntime({
  projectId: () => 'project-v6-concurrent',
  adapter: concurrentAdapter,
});
const firstConcurrent = concurrentRuntime.apply({
  expectedUiRevision: 0,
  actions: [{ kind: 'workspace.activate', workspaceId: 'view' }],
}, { permissions });
let concurrentCode = '';
try {
  await concurrentRuntime.apply({
    expectedUiRevision: 0,
    actions: [{ kind: 'workspace.activate', workspaceId: 'solid' }],
  }, { permissions });
} catch (error: any) {
  concurrentCode = error.code;
}
const firstConcurrentResult = await firstConcurrent;
check('a second agent batch cannot enter while the first batch owns the semantic UI transaction',
  concurrentCode === 'UI_REVISION_CONFLICT' &&
  firstConcurrentResult.uiRevision === 1 &&
  concurrentState.workspaceId === 'view');

const validationRaceState: any = structuredClone(visibleState);
let validationRaceRuntime: any;
let validationRaceApplied = false;
const validationRaceAdapter = {
  snapshot: () => structuredClone(validationRaceState),
  async validateAction() {
    validationRaceState.selection = [{ kind: 'feature', id: 'feature-shaft' }];
    validationRaceRuntime.hostChanged('selection.changed', {
      selection: structuredClone(validationRaceState.selection),
      scopes: ['selection'],
    }, { actor: 'human' });
  },
  applyAction() {
    validationRaceApplied = true;
  },
  restoreSnapshot() {},
  waitForSettled() {},
};
validationRaceRuntime = new CadStudioInteractionRuntime({
  projectId: () => 'project-v6-validation-race',
  adapter: validationRaceAdapter,
});
let validationRaceCode = '';
try {
  await validationRaceRuntime.apply({
    expectedUiRevision: 0,
    actions: [{ kind: 'workspace.activate', workspaceId: 'view' }],
  }, { permissions });
} catch (error: any) {
  validationRaceCode = error.code;
}
check('a human change during asynchronous validation invalidates the batch before any action applies',
  validationRaceCode === 'UI_REVISION_CONFLICT' &&
  validationRaceApplied === false &&
  validationRaceState.selection[0].id === 'feature-shaft');

const recording = await runtime.apply({
  expectedUiRevision: 2,
  presentation: { mode: 'recording', minimumVisibleMs: 1200 },
  actions: [
    { kind: 'presentation.setMode', mode: 'recording' },
    { kind: 'narration.setMode', mode: 'recording' },
    { kind: 'viewport.standardView', viewId: 'front' },
  ],
}, { permissions });
check('recording pacing is bounded and owned by Studio after renderer settlement',
  recording.snapshot.presentation.mode === 'recording' &&
  recording.snapshot.narration.mode === 'recording' &&
  delays.join(',') === '1200,1200,1200' &&
  settlements.slice(-3).every((entry) => entry.renderedUiRevision === 3));

const pauseState: any = structuredClone(visibleState);
pauseState.workspaceId = 'solid';
let releasePauseHold: (() => void) | undefined;
const pauseHoldStarted = new Promise<void>((resolve) => { releasePauseHold = resolve; });
const pauseRuntime = new CadStudioInteractionRuntime({
  projectId: () => 'project-v6-pause',
  adapter: {
    snapshot: () => structuredClone(pauseState),
    applyAction(action: any) {
      if (action.kind === 'workspace.activate') pauseState.workspaceId = action.workspaceId;
      return { applied: action.kind };
    },
    restoreSnapshot(snapshot: any, { scopes = [] }: any) {
      for (const scope of scopes) restoreScope(pauseState, snapshot, scope);
    },
    waitForSettled(_action: any, { targetUiRevision }: any) {
      return { renderSerial: ++renderSerial, renderedUiRevision: targetUiRevision, renderState: 'idle' };
    },
  },
  delay: () => {
    releasePauseHold?.();
    return new Promise(() => {});
  },
});
let pauseCode = '';
const pausingBatch = pauseRuntime.apply({
  expectedUiRevision: 0,
  presentation: { mode: 'recording', minimumVisibleMs: 1000 },
  actions: [{ kind: 'workspace.activate', workspaceId: 'view' }],
}, { permissions }).catch((error: any) => {
  pauseCode = error.code;
});
await pauseHoldStarted;
pauseRuntime.interrupt('SESSION_PAUSED', 'The user paused this session.');
await pausingBatch;
check('session pause interrupts a visible hold and transactionally restores the agent-owned UI scope',
  pauseCode === 'SESSION_PAUSED' &&
  pauseState.workspaceId === 'solid' &&
  pauseRuntime.snapshot().uiRevision === 0 &&
  pauseRuntime.snapshot().presentation.state === 'idle');

const cursorBeforeWait = (await runtime.events({ afterCursor: 0, limit: 500 })).latestCursor;
const waiting = runtime.events({ afterCursor: cursorBeforeWait, kinds: ['ui.changed'], waitMs: 100 });
await runtime.apply({ expectedUiRevision: 3, actions: [{ kind: 'selection.clear' }] }, { permissions });
const awakened = await waiting;
check('event waits wake on structured settlement instead of elapsed-time guessing',
  awakened.events.length === 1 && awakened.events[0].kind === 'ui.changed' && awakened.events[0].uiRevision === 4);

visibleState.selection = [{ kind: 'feature', id: 'feature-shaft' }];
const humanSnapshot = runtime.hostChanged('selection.changed', {
  selection: [{ kind: 'feature', id: 'feature-shaft' }],
  scopes: ['selection'],
}, { actor: 'human' });
check('human interaction advances the same UI revision and emits human-authored state',
  humanSnapshot.uiRevision === 5 &&
  humanSnapshot.selection[0].id === 'feature-shaft' &&
  (await runtime.events({ afterCursor: awakened.latestCursor, limit: 20 })).events
    .some((entry: any) => entry.kind === 'selection.changed' && entry.actor === 'human' && entry.uiRevision === 5));

let humanConflictCode = '';
try {
  await runtime.apply({ expectedUiRevision: 4, actions: [{ kind: 'selection.clear' }] }, { permissions });
} catch (error: any) {
  humanConflictCode = error.code;
}
check('agent cannot overwrite a human UI change with a stale interaction batch',
  humanConflictCode === 'UI_REVISION_CONFLICT' && runtime.snapshot().selection[0].id === 'feature-shaft');

const interruptedState: any = structuredClone(visibleState);
interruptedState.workspaceId = 'solid';
interruptedState.selection = [{ kind: 'body', id: 'body-shaft' }];
const rollbackCalls: any[] = [];
let interruptedRuntime: any;
const interruptedAdapter = {
  ...adapter,
  snapshot: () => structuredClone(interruptedState),
  applyAction(action: any) {
    if (action.kind === 'workspace.activate') interruptedState.workspaceId = action.workspaceId;
    return { applied: action.kind };
  },
  restoreSnapshot(snapshot: any, options: any) {
    rollbackCalls.push(structuredClone(options));
    for (const scope of options.scopes) restoreScope(interruptedState, snapshot, scope);
  },
  waitForSettled(action: any, { targetUiRevision }: any) {
    return { actionKind: action.kind, renderSerial: ++renderSerial, renderedUiRevision: targetUiRevision, renderState: 'idle' };
  },
};
interruptedRuntime = new CadStudioInteractionRuntime({
  projectId: () => 'project-v6-interrupted',
  documentRevision: () => 11,
  adapter: interruptedAdapter,
  delay: async () => {
    interruptedState.selection = [{ kind: 'feature', id: 'feature-shaft' }];
    interruptedRuntime.hostChanged('selection.changed', {
      selection: structuredClone(interruptedState.selection),
      scopes: ['selection'],
    }, { actor: 'human' });
  },
});
let interruption: any = null;
try {
  await interruptedRuntime.apply({
    expectedUiRevision: 0,
    presentation: { mode: 'recording', minimumVisibleMs: 200 },
    actions: [{ kind: 'workspace.activate', workspaceId: 'view' }],
  }, { permissions });
} catch (error: any) {
  interruption = error;
}
const interruptionEvents = await interruptedRuntime.events({ afterCursor: 0, limit: 100 });
check('mid-batch human intervention rolls back only agent-owned scopes and preserves the human state',
  interruption?.code === 'UI_REVISION_CONFLICT' &&
  interruptedState.workspaceId === 'solid' &&
  interruptedState.selection[0].id === 'feature-shaft' &&
  rollbackCalls[0]?.scopes?.includes('workspace') &&
  !rollbackCalls[0]?.scopes?.includes('selection') &&
  interruption.details?.rollback?.preservedHumanScopes?.includes('selection') &&
  interruptionEvents.events.some((event: any) => event.kind === 'human.attentionRequired' && event.actor === 'human'));

const beforeTrustedNarration = runtime.snapshot();
await runtime.apply({
  expectedUiRevision: beforeTrustedNarration.uiRevision,
  actions: [{ kind: 'presentation.setMode', mode: 'recording' }],
}, { permissions });
const trustedNarrationBase = runtime.snapshot();
const trustedNarration = await runtime.presentTrustedNarration({
  templateId: 'exact-geometry-confirmed',
  correlationId: 'trusted-evidence-check',
});
const scriptedNarration = await runtime.presentTrustedNarration({
  templateId: 'demo.turbofan.fan-pattern',
  values: { bladeCount: 12 },
  correlationId: 'trusted-presentation-check',
});
const trustedNarrationEvents = await runtime.events({ afterCursor: 0, limit: 500 });
let arbitraryNarrationCode = '';
let invalidTemplateValueCode = '';
try {
  await runtime.presentTrustedNarration({
    templateId: 'agent-supplied',
  });
} catch (error: any) {
  arbitraryNarrationCode = error.code;
}
try {
  await runtime.presentTrustedNarration({
    templateId: 'demo.turbofan.fan-pattern',
    values: { bladeCount: 0 },
  });
} catch (error: any) {
  invalidTemplateValueCode = error.code;
}
check('recording mode presents only Studio-owned evidence narration with an owned bounded hold',
  trustedNarration.presented === true &&
  trustedNarration.cue.source === 'evidence-template' &&
  scriptedNarration.presented === true &&
  scriptedNarration.cue.source === 'presentation-template' &&
  scriptedNarration.cue.text === 'Patterning the blade into a reusable 12-blade fan row.' &&
  manifest.trustedNarrationTemplates.some((entry: any) =>
    entry.id === 'demo.turbofan.fan-pattern' &&
    entry.valueSchema?.properties?.bladeCount?.maximum === 1_000) &&
  delays.at(-1) === 800 &&
  runtime.snapshot().uiRevision === trustedNarrationBase.uiRevision &&
  runtime.snapshot().documentRevision === trustedNarrationBase.documentRevision &&
  trustedNarrationEvents.events.some((entry: any) =>
    entry.kind === 'narration.cueStarted' && entry.correlationId === 'trusted-evidence-check') &&
  trustedNarrationEvents.events.some((entry: any) =>
    entry.kind === 'narration.cueCompleted' && entry.payload.cue.state === 'completed') &&
  arbitraryNarrationCode === 'UI_CAPABILITY_DISABLED' &&
  invalidTemplateValueCode === 'UI_CAPABILITY_DISABLED');

let trustedHoldStarted!: () => void;
const trustedHold = new Promise<void>((resolve) => { trustedHoldStarted = resolve; });
let cancelledTrustedCue = false;
const serializedNarrationRuntime = new CadStudioInteractionRuntime({
  projectId: () => 'project-v6-trusted-narration-serialization',
  adapter: {
    ...adapter,
    snapshot: () => structuredClone(visibleState),
    showNarration: () => trustedHoldStarted(),
    completeNarration: (cue: any) => { cancelledTrustedCue = cue.state === 'cancelled'; },
  },
  delay: () => new Promise(() => {}),
});
serializedNarrationRuntime.presentationMode = 'recording';
serializedNarrationRuntime.narrationMode = 'detailed';
let interruptedNarrationCode = '';
const pendingTrustedNarration = serializedNarrationRuntime.presentTrustedNarration({
  templateId: 'exact-geometry-confirmed',
}).catch((error: any) => { interruptedNarrationCode = error.code; });
await trustedHold;
let overlappingBatchCode = '';
let overlappingNarrationCode = '';
try {
  await serializedNarrationRuntime.apply({
    expectedUiRevision: 0,
    actions: [{ kind: 'selection.clear' }],
  }, { permissions });
} catch (error: any) {
  overlappingBatchCode = error.code;
}
try {
  await serializedNarrationRuntime.presentTrustedNarration({
    templateId: 'assembly-clearance',
    values: { minimumClearanceMm: 12 },
  });
} catch (error: any) {
  overlappingNarrationCode = error.code;
}
serializedNarrationRuntime.interrupt('SESSION_PAUSED', 'The user paused trusted narration.');
await pendingTrustedNarration;
check('trusted narration serializes against UI batches and other cues, then cancels cleanly on pause',
  overlappingBatchCode === 'UI_REVISION_CONFLICT' &&
  overlappingNarrationCode === 'UI_REVISION_CONFLICT' &&
  interruptedNarrationCode === 'SESSION_PAUSED' &&
  cancelledTrustedCue &&
  serializedNarrationRuntime.snapshot().presentation.state === 'idle');

const oversizedRuntime = new CadStudioInteractionRuntime({
  projectId: () => 'project-v6-oversized',
  adapter: {
    snapshot: () => ({ payload: 'x'.repeat(513 * 1024) }),
    applyAction() {},
    restoreSnapshot() {},
    waitForSettled() {},
  },
});
let sizeCode = '';
try {
  oversizedRuntime.snapshot();
} catch (error: any) {
  sizeCode = error.code;
}
check('semantic snapshots enforce the advertised 512 KiB serialized limit',
  manifest.limits.maxSnapshotBytes === 512 * 1024 && sizeCode === 'UI_SNAPSHOT_TOO_LARGE');

let eventSizeCode = '';
try {
  runtime.emit('ui.changed', { payload: 'x'.repeat(513 * 1024) });
} catch (error: any) {
  eventSizeCode = error.code;
}
check('semantic event payloads enforce their advertised serialized limit',
  manifest.limits.maxEventPayloadBytes === 512 * 1024 && eventSizeCode === 'EVENT_PAYLOAD_TOO_LARGE');

const capabilityTimes: number[] = [];
const snapshotTimes: number[] = [];
for (let index = 0; index < 250; index++) {
  let started = performance.now();
  runtime.capabilities();
  capabilityTimes.push(performance.now() - started);
  started = performance.now();
  runtime.snapshot();
  snapshotTimes.push(performance.now() - started);
}
const performanceEvidence = {
  capabilityP95Ms: Math.round(percentile(capabilityTimes, 0.95) * 1000) / 1000,
  snapshotP95Ms: Math.round(percentile(snapshotTimes, 0.95) * 1000) / 1000,
};
console.log('  EVIDENCE runtime-performance', JSON.stringify(performanceEvidence));
check('in-process capability and snapshot p95 meet the I0 100 ms budgets',
  performanceEvidence.capabilityP95Ms < 100 && performanceEvidence.snapshotP95Ms < 100, performanceEvidence);

console.log(`\n${passed}/${passed + failed} V6 interaction checks passed`);
if (failed) process.exitCode = 1;
