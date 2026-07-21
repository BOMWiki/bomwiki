// Deterministic agent-operability checks. No LLM, DOM, pointer, keyboard, or
// direct geometry constructor is used by the client scenarios in this file.

// @ts-expect-error Browser-native module intentionally has no declarations.
import { CAD_AGENT_PROTOCOL, CadCommandService, applyCadTransaction, cadCapabilityManifest, createCadAgentRequest } from '../static/studio-agent-service.js';
import { createEmptyStudioV5PartProject } from '../static/studio-project-v5.js';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { studioV5CanonicalHash, studioV5RootPart } from '../static/studio-v5-runtime-document.js';

type Mode = 'protocol' | 'queries' | 'transactions' | 'security' | 'handoff' | 'multibody' | 'all';

const mode = (process.argv[2] || 'all') as Mode;
let passed = 0;
let failed = 0;

function check(name: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log('  PASS', name);
  } else {
    failed++;
    console.error('  FAIL', name, detail ?? '');
  }
}

const editScope = (projectId?: string) => ({
  granted: ['project.read', 'project.edit', 'artifact.export-project'],
  ...(projectId ? { projectIds: [projectId] } : {}),
});

const readScope = (projectId?: string) => ({
  granted: ['project.read'],
  ...(projectId ? { projectIds: [projectId] } : {}),
});

let requestSequence = 0;
function envelope(service: any, payload: Record<string, unknown>, options: Record<string, any> = {}) {
  return createCadAgentRequest({
    requestId: options.requestId || `request-${++requestSequence}`,
    sessionId: options.sessionId || 'session-check',
    projectId: service.snapshot().projectId,
    expectedRevision: options.expectedRevision,
    permissionContext: options.permissionContext || editScope(service.snapshot().projectId),
    payload,
  });
}

function emptyProject(projectId: string) {
  return createEmptyStudioV5PartProject({ projectId, name: 'Agent check', units: 'mm' });
}

function boxFeature(id: string, bodyName: string, x: number, y: number, w: number, h: number, depth: number) {
  return {
    kind: 'feature.extrude',
    input: {
      id,
      name: `${bodyName} extrude`,
      bodyName,
      sketch: { shapes: [{ kind: 'rect', x, y, w, h }], z: 0 },
      height: depth,
      resultPolicy: { kind: 'new-body', bodyName },
    },
  };
}

function circleFeature(id: string, bodyName: string, x: number, y: number, radius: number, depth: number) {
  return {
    kind: 'feature.extrude',
    input: {
      id,
      name: `${bodyName} extrude`,
      bodyName,
      sketch: { shapes: [{ kind: 'circle', x, y, r: radius }], z: 0 },
      height: depth,
      resultPolicy: { kind: 'new-body', bodyName },
    },
  };
}

function transaction(id: string, revision: number, operations: any[], label = id) {
  return {
    transactionId: id,
    label,
    expectedRevision: revision,
    atomic: true,
    operations,
    metadata: { actor: 'agent', clientLabel: 'deterministic-check' },
  };
}

async function previewAndCommit(service: any, tx: any, scope = editScope(service.snapshot().projectId)) {
  const preview = await service.preview(tx, scope);
  const committed = await service.commit(preview.previewId, tx.expectedRevision, scope);
  return { preview, committed };
}

async function protocolChecks(): Promise<void> {
  console.log('\nAgent protocol');
  const service = new CadCommandService({ project: emptyProject('project-agent-protocol') });
  const manifest = cadCapabilityManifest({ exactKernel: false });
  const available = new Set(manifest.operations.filter((entry: any) => entry.state === 'available').map((entry: any) => entry.kind));
  const disabled = new Map(manifest.operations.filter((entry: any) => entry.state === 'disabled').map((entry: any) => [entry.kind, entry.disabledReasonCode]));
  check('protocol manifest is schema-versioned and transport-complete',
    manifest.protocolVersion === CAD_AGENT_PROTOCOL && manifest.schemaVersions.join(',') === '5' && manifest.transports.join(',') === 'headless,mcp-stdio,studio-loopback');
  check('protocol reports implemented multi-body operations available',
    ['feature.extrude', 'body.rename', 'body.setVisibility', 'boolean.subtract'].every((kind) => available.has(kind)));
  const extrudeSchema = manifest.operations.find((entry: any) => entry.kind === 'feature.extrude')?.inputSchema;
  check('protocol capability discovery includes usable per-operation input schemas',
    extrudeSchema?.properties?.input?.required?.includes('sketch') && extrudeSchema.properties.input.properties.resultPolicy.oneOf.length === 4);
  check('protocol truthfully disables advanced capabilities',
    disabled.get('feature.loft') === 'V5_LOFT_RUNTIME_NOT_AVAILABLE' && disabled.get('mate.create') === 'V5_ASSEMBLY_SOLVER_NOT_AVAILABLE');
  check('protocol does not advertise exact STEP without a kernel adapter',
    manifest.exports.find((entry: any) => entry.format === 'step')?.state === 'disabled');

  const unsupported = await service.request({ ...envelope(service, { kind: 'capabilities' }), protocol: 'bomwiki.cad.agent/v2' });
  check('protocol rejects unknown major versions with a stable diagnostic', unsupported.status === 'error' && unsupported.diagnostics[0].code === 'UNSUPPORTED_PROTOCOL');

  const request = envelope(service, { kind: 'inspect', query: { kind: 'project.summary' } }, {
    requestId: 'idempotent-read',
    permissionContext: readScope(service.snapshot().projectId),
  });
  const first = await service.request(request);
  const second = await service.request({ ...request, payload: { kind: 'inspect', query: { kind: 'project.tree' } } });
  check('protocol duplicate request retry returns the original completed response', JSON.stringify(first) === JSON.stringify(second));

  const otherSession = await service.request({ ...request, sessionId: 'another-session', payload: { kind: 'inspect', query: { kind: 'project.tree' } } });
  check('protocol idempotency key is scoped to one session', Boolean(otherSession.result?.items));

  const before = studioV5CanonicalHash(service.snapshot());
  const unknownTx = transaction('tx-unknown', 0, [{ kind: 'kernel.eval', input: { source: 'arbitrary code' } }]);
  const unknown = await service.request(envelope(service, { kind: 'preview', transaction: unknownTx }));
  check('protocol rejects unknown code-like operations atomically', unknown.status === 'error' && unknown.diagnostics[0].code === 'UNKNOWN_OPERATION');
  check('protocol unknown operation cannot mutate the project', studioV5CanonicalHash(service.snapshot()) === before && service.revision === 0);
}

async function queryChecks(): Promise<void> {
  console.log('\nAgent queries');
  const service = new CadCommandService({ project: emptyProject('project-agent-queries') });
  await previewAndCommit(service, transaction('tx-query-seed', 0, [
    boxFeature('feature-query-housing', 'Housing', 0, 0, 40, 40, 20),
    circleFeature('feature-query-tool', 'Tool', 0, 0, 5, 20),
    { kind: 'boolean.subtract', input: { id: 'feature-query-boolean', targetBodyId: 'body-feature-query-housing', toolBodyId: 'body-feature-query-tool', keepTools: true } },
  ]));
  const before = JSON.stringify(service.snapshot());
  const summary = service.inspect({ kind: 'project.summary' });
  const tree = service.inspect({ kind: 'project.tree', pageSize: 2 });
  const housing = service.inspect({ kind: 'entity.detail', entity: { kind: 'body', id: 'body-feature-query-housing' } });
  const deps = service.inspect({ kind: 'entity.dependencies', entity: { kind: 'body', id: 'body-feature-query-tool' } });
  const search = service.inspect({ kind: 'entity.search', query: 'housing' });
  check('queries return project summary and stable revision', summary.counts.bodies === 2 && summary.revision === 1);
  check('queries paginate the semantic tree', tree.items.length === 2 && tree.nextCursor === '2' && tree.total >= 6);
  check('queries return stable entity detail', housing.entity.name === 'Housing' && housing.value.id === 'body-feature-query-housing');
  check('queries expose body-to-Boolean dependency edges', deps.items.some((entry: any) => entry.relation === 'tool' && entry.to.id === 'feature-query-boolean'));
  check('queries search names and IDs without display scraping', search.items.some((entry: any) => entry.id === 'body-feature-query-housing'));
  check('queries cannot mutate canonical project state', JSON.stringify(service.snapshot()) === before);
  const noKernel = await service.request(envelope(service, { kind: 'query', query: { kind: 'geometry.validity', exact: true } }, { permissionContext: readScope(service.snapshot().projectId) }));
  check('exact query refuses to fake evidence without a kernel adapter', noKernel.status === 'error' && noKernel.diagnostics[0].code === 'EXACT_KERNEL_REQUIRED');
}

async function transactionChecks(): Promise<void> {
  console.log('\nAgent transactions');
  const service = new CadCommandService({ project: emptyProject('project-agent-transactions') });
  const tx = transaction('tx-atomic-create', 0, [
    { kind: 'parameter.create', alias: 'width', input: { id: 'parameter-width', name: 'width', value: 40 } },
    boxFeature('feature-housing', 'Housing', 0, 0, 40, 40, 20),
    { kind: 'body.rename', input: { bodyId: 'body-feature-housing', name: 'Main housing' } },
  ], 'Create parametric housing');
  const before = JSON.stringify(service.snapshot());
  const preview = await service.preview(tx, editScope(service.snapshot().projectId));
  check('transaction preview is detached from canonical state', JSON.stringify(service.snapshot()) === before && service.revision === 0);
  check('transaction preview returns semantic identities and aliases',
    preview.changeSet.created.some((entry: any) => entry.id === 'body-feature-housing') && preview.changeSet.aliases.width.id === 'parameter-width');

  const aliasService = new CadCommandService({ project: emptyProject('project-agent-alias-target') });
  const aliasPreview = await aliasService.preview(transaction('tx-body-alias-target', 0, [
    boxFeature('feature-alias-housing', 'Alias housing', 0, 0, 30, 30, 10),
    { kind: 'body.activate', alias: 'target-body', input: { bodyId: 'body-feature-alias-housing' } },
    {
      kind: 'feature.cut',
      input: {
        id: 'feature-alias-hole', name: 'Alias-targeted hole', through: true,
        sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 4 }], z: 10 },
        resultPolicy: { kind: 'subtract', targetBodyIds: [{ alias: 'target-body' }], keepTools: false },
      },
    },
  ]), editScope('project-agent-alias-target'));
  check('transaction-local body aliases resolve inside later result policies',
    aliasPreview.changeSet.created.some((entry: any) => entry.id === 'feature-alias-hole'));
  const committed = await service.commit(preview.previewId, 0, editScope(service.snapshot().projectId));
  check('transaction commit advances exactly one revision and one history command', committed.revision === 1 && service.inspect({ kind: 'history.list' }).total === 1);
  check('transaction commit preserves the exact previewed canonical hash', studioV5CanonicalHash(service.snapshot()) === preview.changeSet.documentHashAfter);

  const beforeFailure = JSON.stringify(service.snapshot());
  let middleFailed = false;
  try {
    await service.preview(transaction('tx-middle-failure', 1, [
      { kind: 'project.rename', input: { name: 'Must roll back' } },
      { kind: 'body.rename', input: { bodyId: 'missing-body', name: 'Nope' } },
      { kind: 'project.setUnits', input: { units: 'in' } },
    ]), editScope(service.snapshot().projectId));
  } catch (error: any) {
    middleFailed = error.code === 'MISSING_REFERENCE' && error.details.operationIndex === 1;
  }
  check('transaction invalid middle operation reports its stable index', middleFailed);
  check('transaction invalid middle operation rolls back the entire batch', JSON.stringify(service.snapshot()) === beforeFailure && service.revision === 1);

  let stale = false;
  try {
    await service.preview(transaction('tx-stale', 0, [{ kind: 'project.rename', input: { name: 'Stale' } }]), editScope(service.snapshot().projectId));
  } catch (error: any) { stale = error.code === 'REVISION_CONFLICT'; }
  check('transaction stale preview is rejected before draft work', stale && service.revision === 1);

  let clock = 1000;
  const expiring = new CadCommandService({ project: service.snapshot(), revision: service.revision, previewTtlMs: 10, now: () => clock });
  const shortPreview = await expiring.preview(transaction('tx-expire', 1, [{ kind: 'project.rename', input: { name: 'Expiry' } }]), editScope(expiring.snapshot().projectId));
  clock += 11;
  let expired = false;
  try { await expiring.commit(shortPreview.previewId, 1, editScope(expiring.snapshot().projectId)); } catch (error: any) { expired = error.code === 'PREVIEW_EXPIRED'; }
  check('transaction expired preview cannot commit', expired && expiring.revision === 1);

  const hashAtOne = studioV5CanonicalHash(service.snapshot());
  const second = await previewAndCommit(service, transaction('tx-second', 1, [{ kind: 'body.setVisibility', input: { bodyId: 'body-feature-housing', visible: false } }]));
  check('transaction visibility edit returns semantic visibility diff', second.committed.changeSet.visibilityDiffs.length === 1 && service.revision === 2);
  await service.historyAction({ action: 'undo', expectedRevision: 2 }, editScope(service.snapshot().projectId));
  check('transaction undo restores exact prior document under a new revision', studioV5CanonicalHash(service.snapshot()) === hashAtOne && service.revision === 3);
  await service.historyAction({ action: 'redo', expectedRevision: 3 }, editScope(service.snapshot().projectId));
  check('transaction redo restores exact committed document under a new revision', studioV5CanonicalHash(service.snapshot()) === second.preview.changeSet.documentHashAfter && service.revision === 4);
}

async function securityChecks(): Promise<void> {
  console.log('\nAgent permissions and safety');
  const service = new CadCommandService({ project: emptyProject('project-agent-security') });
  const tx = transaction('tx-secure', 0, [boxFeature('feature-secure', 'Secure body', 0, 0, 10, 10, 10)]);
  let readOnlyDenied = false;
  try { await service.preview(tx, readScope(service.snapshot().projectId)); } catch (error: any) { readOnlyDenied = error.code === 'PERMISSION_DENIED'; }
  check('security read permission cannot edit', readOnlyDenied && service.revision === 0);

  let crossProjectDenied = false;
  try { await service.preview(tx, editScope('another-project')); } catch (error: any) { crossProjectDenied = error.code === 'PERMISSION_DENIED'; }
  check('security cross-project edit is denied', crossProjectDenied && service.revision === 0);

  let operationDenied = false;
  try {
    await service.preview(tx, { ...editScope(service.snapshot().projectId), operationKinds: ['project.rename'] });
  } catch (error: any) { operationDenied = error.code === 'PERMISSION_DENIED'; }
  check('security operation-scope escalation is denied', operationDenied && service.revision === 0);

  let expiredDenied = false;
  try {
    await service.preview(tx, { ...editScope(service.snapshot().projectId), expiresAt: '2000-01-01T00:00:00.000Z' });
  } catch (error: any) { expiredDenied = error.code === 'PERMISSION_EXPIRED'; }
  check('security expired scope is denied', expiredDenied && service.revision === 0);

  let malformedScopeDenied = false;
  try {
    await service.preview(tx, { ...editScope(service.snapshot().projectId), expiresAt: 'not-a-timestamp' });
  } catch (error: any) { malformedScopeDenied = error.code === 'INVALID_PERMISSION_SCOPE'; }
  check('security malformed expiry cannot become a non-expiring scope', malformedScopeDenied && service.revision === 0);

  const injection = transaction('tx-injection', 0, [{
    kind: 'parameter.create',
    input: { id: 'parameter-injection', name: 'danger', value: 'globalThis.process.exit()' },
  }]);
  let injectionDenied = false;
  try { applyCadTransaction(service.snapshot(), injection); } catch (error: any) { injectionDenied = ['UNKNOWN_PARAMETER', 'INVALID_EXPRESSION'].includes(error.code); }
  check('security parameter expressions cannot execute code', injectionDenied && service.revision === 0);
}

async function handoffChecks(): Promise<void> {
  console.log('\nHuman-agent handoff');
  const service = new CadCommandService({ project: emptyProject('project-agent-handoff') });
  await previewAndCommit(service, transaction('tx-handoff-seed', 0, [boxFeature('feature-handoff', 'Housing', 0, 0, 20, 20, 10)]));
  const agentPreview = await service.preview(transaction('tx-agent-pending', 1, [{ kind: 'body.rename', input: { bodyId: 'body-feature-handoff', name: 'Agent housing' } }]), editScope(service.snapshot().projectId));

  const human = applyCadTransaction(service.snapshot(), transaction('tx-human', 1, [{ kind: 'feature.update', input: { featureId: 'feature-handoff', patch: { h: 12 } } }]));
  service.synchronize(human.project, 2, { label: 'Human changed housing height', actor: 'human', transactionId: 'tx-human', changeSet: human.changeSet });
  let conflict = false;
  try { await service.commit(agentPreview.previewId, 1, editScope(service.snapshot().projectId)); } catch (error: any) { conflict = ['PREVIEW_EXPIRED', 'REVISION_CONFLICT'].includes(error.code); }
  check('handoff human edit invalidates the agent preview without overwrite', conflict && service.revision === 2 && findHeight(service.snapshot(), 'feature-handoff') === 12);

  const changes = service.inspect({ kind: 'history.changesSince', revision: 1 });
  check('handoff agent can inspect the intervening human command', changes.items.some((entry: any) => entry.actor === 'human' && entry.transactionId === 'tx-human'));

  const refreshed = await previewAndCommit(service, transaction('tx-agent-refreshed', 2, [{ kind: 'body.rename', input: { bodyId: 'body-feature-handoff', name: 'Agent housing' } }]));
  check('handoff refreshed agent transaction commits after inspection', refreshed.committed.revision === 3 && studioV5RootPart(service.snapshot()).bodies[0].name === 'Agent housing');
  check('handoff preserves the human geometry edit', findHeight(service.snapshot(), 'feature-handoff') === 12);
}

function findHeight(project: any, featureId: string): number {
  return studioV5RootPart(project).features.find((entry: any) => entry.id === featureId)?.h;
}

async function multibodyChecks(): Promise<void> {
  console.log('\nAgent multi-body foundation');
  const service = new CadCommandService({ project: emptyProject('project-agent-multibody') });
  const create = transaction('tx-agent-multibody-create', 0, [
    boxFeature('feature-housing', 'Housing', 0, 0, 40, 40, 20),
    boxFeature('feature-shaft', 'Shaft', 60, 0, 10, 10, 20),
    circleFeature('feature-tool', 'Tool', 0, 0, 5, 20),
    { kind: 'boolean.subtract', input: { id: 'feature-housing-tool-subtract', name: 'Subtract Tool from Housing', targetBodyId: 'body-feature-housing', toolBodyId: 'body-feature-tool', keepTools: true } },
  ], 'Build Housing, Shaft, Tool, and subtract');
  const createResult = await previewAndCommit(service, create);
  const part = studioV5RootPart(service.snapshot());
  check('multibody protocol creates three independently named bodies', part.bodies.map((entry: any) => entry.name).join(',') === 'Housing,Shaft,Tool');
  check('multibody protocol creates explicit Boolean ownership', part.bodies[0].featureIds.at(-1) === 'feature-housing-tool-subtract' && part.features.at(-1).toolBodyIds[0] === 'body-feature-tool');
  check('multibody change set reports bodies rather than raw JSON paths', createResult.committed.changeSet.created.filter((entry: any) => entry.kind === 'body').length === 3);

  await previewAndCommit(service, transaction('tx-agent-body-edits', 1, [
    { kind: 'body.rename', input: { bodyId: 'body-feature-shaft', name: 'Shaft core' } },
    { kind: 'body.setVisibility', input: { bodyId: 'body-feature-tool', visible: false } },
    { kind: 'body.suppress', input: { bodyId: 'body-feature-shaft', suppressed: true } },
  ], 'Organize bodies'));
  let editedPart = studioV5RootPart(service.snapshot());
  check('multibody protocol edits body name, visibility, and suppression atomically',
    editedPart.bodies.find((entry: any) => entry.id === 'body-feature-shaft').name === 'Shaft core' &&
    editedPart.bodies.find((entry: any) => entry.id === 'body-feature-tool').visible === false &&
    editedPart.bodies.find((entry: any) => entry.id === 'body-feature-shaft').suppressed === true);

  await previewAndCommit(service, transaction('tx-agent-restore-edit', 2, [
    { kind: 'body.suppress', input: { bodyId: 'body-feature-shaft', suppressed: false } },
    { kind: 'feature.update', input: { featureId: 'feature-housing', patch: { h: 24 } } },
  ], 'Restore shaft and edit early Housing feature'));
  editedPart = studioV5RootPart(service.snapshot());
  check('multibody protocol preserves unaffected stable body identities after an early edit',
    editedPart.bodies.map((entry: any) => entry.id).join(',') === 'body-feature-housing,body-feature-shaft,body-feature-tool' && findHeight(service.snapshot(), 'feature-housing') === 24);

  const saved = JSON.stringify(service.snapshot());
  const reopened = new CadCommandService({ project: JSON.parse(saved), revision: service.revision });
  check('multibody protocol project save/reopen is canonical and byte-identical', JSON.stringify(reopened.snapshot()) === saved);
  check('multibody client used only capability-discovered operation kinds', create.operations.every((entry: any) => cadCapabilityManifest().operations.some((capability: any) => capability.kind === entry.kind && capability.state === 'available')));
}

async function run(): Promise<void> {
  if (mode === 'protocol' || mode === 'all') await protocolChecks();
  if (mode === 'queries' || mode === 'all') await queryChecks();
  if (mode === 'transactions' || mode === 'all') await transactionChecks();
  if (mode === 'security' || mode === 'all') await securityChecks();
  if (mode === 'handoff' || mode === 'all') await handoffChecks();
  if (mode === 'multibody' || mode === 'all') await multibodyChecks();
  console.log(`\n${passed}/${passed + failed} agent checks passed`);
  if (failed) process.exitCode = 1;
}

await run();
