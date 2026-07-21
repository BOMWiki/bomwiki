import {
  STUDIO_V5_PROJECT_LIMITS,
  STUDIO_V5_SCHEMA_VERSION,
  createEmptyStudioV5PartProject,
} from './studio-project-v5.js';
import {
  canonicalStudioV5Project,
  configureStudioV5Feature,
  createStudioV5BooleanFeature,
  deleteStudioV5Body,
  isStudioV5Project,
  prepareStudioV5RuntimeProject,
  studioV5CanonicalHash,
  studioV5ActiveBody,
  studioV5RootPart,
  updateStudioV5Body,
} from './studio-v5-runtime-document.js';

export const CAD_AGENT_PROTOCOL = 'bomwiki.cad.agent/v1';
export const CAD_AGENT_STUDIO_VERSION = '5A-agent-1';
export const CAD_AGENT_KERNEL_VERSION = 'replicad-open-cascade/runtime-5A';

const MAX_TRANSACTION_OPERATIONS = 250;
const MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_PREVIEW_TTL_MS = 5 * 60 * 1000;
const MAX_REQUEST_CACHE_ENTRIES = 1000;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const ALL_PERMISSIONS = Object.freeze([
  'project.read',
  'project.create',
  'project.edit',
  'project.replace',
  'project.save-new',
  'project.save-in-place',
  'project.recover',
  'artifact.render',
  'artifact.export-project',
  'artifact.export-step',
  'artifact.export-stl',
]);

const READ_PERMISSIONS = new Set(['project.read']);
const EDIT_PERMISSIONS = new Set(['project.edit']);
const clone = (value) => structuredClone(value);

const JSON_SCHEMAS = Object.freeze({
  transaction: {
    type: 'object',
    required: ['transactionId', 'label', 'expectedRevision', 'operations', 'atomic'],
    properties: {
      transactionId: { type: 'string', minLength: 1, maxLength: 200 },
      label: { type: 'string', minLength: 1, maxLength: 200 },
      expectedRevision: { type: 'integer', minimum: 0 },
      operations: { type: 'array', minItems: 1, maxItems: MAX_TRANSACTION_OPERATIONS },
      atomic: { const: true },
    },
  },
  result: {
    type: 'object',
    required: ['changeSet'],
    properties: { changeSet: { type: 'object' } },
  },
});

const ID_SCHEMA = Object.freeze({ type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' });
const DIMENSION_SCHEMA = Object.freeze({ oneOf: [{ type: 'number' }, { type: 'string', minLength: 1, maxLength: 500 }] });
const ENTITY_OR_ALIAS_SCHEMA = Object.freeze({ oneOf: [ID_SCHEMA, { type: 'object', required: ['alias'], properties: { alias: { type: 'string', minLength: 1, maxLength: 200 } }, additionalProperties: false }] });
const RESULT_POLICY_SCHEMA = Object.freeze({
  oneOf: [
    { type: 'object', required: ['kind'], properties: { kind: { const: 'new-body' }, bodyName: { type: 'string', minLength: 1, maxLength: 200 } }, additionalProperties: false },
    ...['add', 'subtract', 'intersect'].map((kind) => ({
      type: 'object', required: ['kind', 'targetBodyIds'],
      properties: { kind: { const: kind }, targetBodyIds: { type: 'array', minItems: 1, items: ENTITY_OR_ALIAS_SCHEMA }, keepTools: { type: 'boolean' } },
      additionalProperties: false,
    })),
  ],
});
const SHAPE_SCHEMA = Object.freeze({
  oneOf: [
    { type: 'object', required: ['kind', 'x', 'y', 'w', 'h'], properties: { kind: { const: 'rect' }, x: DIMENSION_SCHEMA, y: DIMENSION_SCHEMA, w: DIMENSION_SCHEMA, h: DIMENSION_SCHEMA }, additionalProperties: false },
    { type: 'object', required: ['kind', 'x', 'y', 'r'], properties: { kind: { const: 'circle' }, x: DIMENSION_SCHEMA, y: DIMENSION_SCHEMA, r: DIMENSION_SCHEMA }, additionalProperties: false },
    { type: 'object', required: ['kind', 'pts'], properties: { kind: { const: 'poly' }, pts: { type: 'array', minItems: 3, items: { type: 'array', minItems: 2, maxItems: 2, items: DIMENSION_SCHEMA } } }, additionalProperties: false },
  ],
});
const SKETCH_SCHEMA = Object.freeze({
  type: 'object', required: ['shapes'],
  properties: { shapes: { type: 'array', minItems: 1, items: SHAPE_SCHEMA }, z: DIMENSION_SCHEMA },
  additionalProperties: true,
});
const FEATURE_COMMON_PROPERTIES = Object.freeze({
  id: ID_SCHEMA,
  name: { type: 'string', minLength: 1, maxLength: 200 },
  resultPolicy: RESULT_POLICY_SCHEMA,
  inputRefs: { type: 'array', items: { type: 'object' } },
  bodyName: { type: 'string', minLength: 1, maxLength: 200 },
});
const objectSchema = (required, properties) => ({ type: 'object', required, properties, additionalProperties: false });
const OPERATION_INPUT_SCHEMAS = Object.freeze({
  'project.rename': objectSchema(['name'], { name: { type: 'string', minLength: 1, maxLength: 200 } }),
  'project.setUnits': objectSchema(['units'], { units: { enum: ['mm', 'in'] } }),
  'parameter.create': objectSchema(['name', 'value'], { id: ID_SCHEMA, name: { type: 'string', minLength: 1, maxLength: 200 }, value: DIMENSION_SCHEMA, description: { type: 'string', maxLength: 2000 } }),
  'parameter.update': objectSchema([], { parameterId: ENTITY_OR_ALIAS_SCHEMA, parameterName: { type: 'string' }, name: { type: 'string', minLength: 1, maxLength: 200 }, value: DIMENSION_SCHEMA, description: { type: 'string', maxLength: 2000 } }),
  'parameter.delete': objectSchema([], { parameterId: ENTITY_OR_ALIAS_SCHEMA, parameterName: { type: 'string' } }),
  'feature.extrude': objectSchema(['sketch'], { ...FEATURE_COMMON_PROPERTIES, sketch: SKETCH_SCHEMA, height: DIMENSION_SCHEMA, h: DIMENSION_SCHEMA }),
  'feature.cut': objectSchema(['sketch'], { ...FEATURE_COMMON_PROPERTIES, sketch: SKETCH_SCHEMA, height: DIMENSION_SCHEMA, h: DIMENSION_SCHEMA, through: { type: 'boolean' } }),
  'feature.revolve': objectSchema(['sketch'], { ...FEATURE_COMMON_PROPERTIES, sketch: SKETCH_SCHEMA }),
  'feature.fillet': objectSchema(['radius'], { ...FEATURE_COMMON_PROPERTIES, radius: DIMENSION_SCHEMA, r: DIMENSION_SCHEMA, edges: { type: 'array', items: { type: 'object' } } }),
  'feature.chamfer': objectSchema(['radius'], { ...FEATURE_COMMON_PROPERTIES, radius: DIMENSION_SCHEMA, r: DIMENSION_SCHEMA, edges: { type: 'array', items: { type: 'object' } } }),
  'feature.shell': objectSchema(['thickness'], { ...FEATURE_COMMON_PROPERTIES, thickness: DIMENSION_SCHEMA, t: DIMENSION_SCHEMA, faces: { type: 'array', items: { type: 'object' } } }),
  'feature.update': objectSchema(['featureId', 'patch'], { featureId: ENTITY_OR_ALIAS_SCHEMA, patch: { type: 'object' } }),
  'feature.suppress': objectSchema(['featureId', 'suppressed'], { featureId: ENTITY_OR_ALIAS_SCHEMA, suppressed: { type: 'boolean' } }),
  'feature.delete': objectSchema(['featureId'], { featureId: ENTITY_OR_ALIAS_SCHEMA }),
  'body.activate': objectSchema(['bodyId'], { bodyId: ENTITY_OR_ALIAS_SCHEMA }),
  'body.rename': objectSchema(['bodyId', 'name'], { bodyId: ENTITY_OR_ALIAS_SCHEMA, name: { type: 'string', minLength: 1, maxLength: 200 } }),
  'body.setVisibility': objectSchema(['bodyId', 'visible'], { bodyId: ENTITY_OR_ALIAS_SCHEMA, visible: { type: 'boolean' } }),
  'body.suppress': objectSchema(['bodyId', 'suppressed'], { bodyId: ENTITY_OR_ALIAS_SCHEMA, suppressed: { type: 'boolean' } }),
  'body.delete': objectSchema(['bodyId'], { bodyId: ENTITY_OR_ALIAS_SCHEMA }),
  'boolean.union': objectSchema(['targetBodyId', 'toolBodyId'], { id: ID_SCHEMA, name: { type: 'string' }, targetBodyId: ENTITY_OR_ALIAS_SCHEMA, toolBodyId: ENTITY_OR_ALIAS_SCHEMA, keepTools: { type: 'boolean' } }),
  'boolean.subtract': objectSchema(['targetBodyId', 'toolBodyId'], { id: ID_SCHEMA, name: { type: 'string' }, targetBodyId: ENTITY_OR_ALIAS_SCHEMA, toolBodyId: ENTITY_OR_ALIAS_SCHEMA, keepTools: { type: 'boolean' } }),
  'boolean.intersect': objectSchema(['targetBodyId', 'toolBodyId'], { id: ID_SCHEMA, name: { type: 'string' }, targetBodyId: ENTITY_OR_ALIAS_SCHEMA, toolBodyId: ENTITY_OR_ALIAS_SCHEMA, keepTools: { type: 'boolean' } }),
});

const AVAILABLE_OPERATION_KINDS = Object.freeze([
  'project.rename',
  'project.setUnits',
  'parameter.create',
  'parameter.update',
  'parameter.delete',
  'feature.extrude',
  'feature.cut',
  'feature.revolve',
  'feature.fillet',
  'feature.chamfer',
  'feature.shell',
  'feature.update',
  'feature.suppress',
  'feature.delete',
  'body.activate',
  'body.rename',
  'body.setVisibility',
  'body.suppress',
  'body.delete',
  'boolean.union',
  'boolean.subtract',
  'boolean.intersect',
]);

const DISABLED_OPERATION_REASONS = Object.freeze({
  'datum.createPlane': 'V5_DATUM_RUNTIME_NOT_AVAILABLE',
  'datum.createAxis': 'V5_DATUM_RUNTIME_NOT_AVAILABLE',
  'body.transform': 'V5_TRANSFORM_RUNTIME_NOT_AVAILABLE',
  'feature.loft': 'V5_LOFT_RUNTIME_NOT_AVAILABLE',
  'feature.sweep': 'V5_SWEEP_RUNTIME_NOT_AVAILABLE',
  'pattern.linear': 'V5_LINKED_PATTERN_RUNTIME_NOT_AVAILABLE',
  'pattern.circular': 'V5_LINKED_PATTERN_RUNTIME_NOT_AVAILABLE',
  'pattern.dissolve': 'V5_LINKED_PATTERN_RUNTIME_NOT_AVAILABLE',
  'pattern.curve': 'V5_LINKED_PATTERN_RUNTIME_NOT_AVAILABLE',
  'pattern.mirror': 'V5_LINKED_PATTERN_RUNTIME_NOT_AVAILABLE',
  'boolean.split': 'V5_BOOLEAN_SPLIT_RUNTIME_NOT_AVAILABLE',
  'component.createPart': 'V5_ASSEMBLY_RUNTIME_NOT_AVAILABLE',
  'component.insert': 'V5_ASSEMBLY_RUNTIME_NOT_AVAILABLE',
  'component.transform': 'V5_ASSEMBLY_RUNTIME_NOT_AVAILABLE',
  'mate.create': 'V5_ASSEMBLY_SOLVER_NOT_AVAILABLE',
  'section.create': 'V5_SECTION_RUNTIME_NOT_AVAILABLE',
});

const QUERY_CAPABILITIES = Object.freeze([
  'project.summary',
  'project.tree',
  'entity.detail',
  'entity.dependencies',
  'entity.search',
  'geometry.validity',
  'geometry.bodies',
  'history.list',
  'history.changesSince',
]);

function operationCapability(kind, state = 'available', disabledReasonCode) {
  return {
    kind,
    version: 1,
    state,
    ...(disabledReasonCode ? { disabledReasonCode } : {}),
    inputSchema: state === 'available'
      ? { type: 'object', required: ['kind', 'input'], properties: { kind: { const: kind }, alias: { type: 'string' }, input: clone(OPERATION_INPUT_SCHEMAS[kind] || { type: 'object' }) }, additionalProperties: false }
      : { type: 'object' },
    resultSchema: JSON_SCHEMAS.result,
    supportsPreview: state === 'available',
    supportsAtomicBatch: state === 'available',
  };
}

export function cadCapabilityManifest(options = {}) {
  const available = AVAILABLE_OPERATION_KINDS.map((kind) => operationCapability(kind));
  const disabled = Object.entries(DISABLED_OPERATION_REASONS).map(([kind, reason]) => operationCapability(kind, 'disabled', reason));
  return {
    protocolVersion: CAD_AGENT_PROTOCOL,
    studioVersion: CAD_AGENT_STUDIO_VERSION,
    schemaVersions: [STUDIO_V5_SCHEMA_VERSION],
    kernelVersion: CAD_AGENT_KERNEL_VERSION,
    documentKinds: ['part'],
    operations: [...available, ...disabled],
    queries: QUERY_CAPABILITIES.map((kind) => ({
      kind,
      version: 1,
      state: 'available',
      inputSchema: { type: 'object' },
      resultSchema: { type: 'object' },
    })),
    exports: [
      { format: 'project', state: 'available', permission: 'artifact.export-project' },
      { format: 'step', state: options.exactKernel === false ? 'disabled' : 'available', permission: 'artifact.export-step', disabledReasonCode: options.exactKernel === false ? 'EXACT_KERNEL_ADAPTER_REQUIRED' : undefined },
      { format: 'stl', state: options.exactKernel === false ? 'disabled' : 'available', permission: 'artifact.export-stl', disabledReasonCode: options.exactKernel === false ? 'EXACT_KERNEL_ADAPTER_REQUIRED' : undefined },
    ],
    limits: {
      ...STUDIO_V5_PROJECT_LIMITS,
      transactionOperations: MAX_TRANSACTION_OPERATIONS,
      requestBytes: MAX_REQUEST_BYTES,
      queryPageSize: MAX_PAGE_SIZE,
    },
    permissions: ALL_PERMISSIONS.map((permission) => ({ permission, default: 'denied' })),
    transports: ['headless', 'mcp-stdio', 'studio-loopback'],
  };
}

export class CadAgentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CadAgentError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CadAgentError(code, message, details);
}

function diagnostic(error, operationIndex) {
  const code = error?.code || 'CAD_OPERATION_FAILED';
  return {
    code,
    severity: 'error',
    message: String(error?.message || error),
    ...(Number.isInteger(operationIndex) ? { operationIndex } : {}),
    ...(error?.details?.entity ? { entity: error.details.entity } : {}),
    ...(error?.details?.repairOptions ? { repairOptions: clone(error.details.repairOptions) } : {}),
  };
}

function assertRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_REQUEST', path + ' must be an object.');
  return value;
}

function assertText(value, path, maximum = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail('INVALID_REQUEST', path + ' must contain 1 to ' + maximum + ' characters.');
  return value.trim();
}

function assertId(value, path) {
  const id = assertText(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) fail('INVALID_REQUEST', path + ' is not a valid stable ID.');
  return id;
}

function assertInteger(value, path, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail('INVALID_REQUEST', path + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  return value;
}

function assertFiniteOrExpression(value, path) {
  if ((typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.trim() && value.length <= 500)) return value;
  fail('INVALID_EXPRESSION', path + ' must be a finite number or bounded parameter expression.');
}

function assertPermission(context, required, projectId, operationKinds = []) {
  const permission = assertRecord(context, 'permissionContext');
  const granted = new Set(Array.isArray(permission.granted) ? permission.granted : []);
  for (const item of required) if (!granted.has(item)) fail('PERMISSION_DENIED', 'Permission "' + item + '" is required.');
  if (permission.expiresAt != null) {
    const expiresAt = typeof permission.expiresAt === 'string' ? Date.parse(permission.expiresAt) : Number.NaN;
    if (!Number.isFinite(expiresAt)) fail('INVALID_PERMISSION_SCOPE', 'permissionContext.expiresAt must be a valid timestamp.');
    if (expiresAt <= Date.now()) fail('PERMISSION_EXPIRED', 'The CAD permission scope has expired.');
  }
  if (permission.maxCommits != null && (!Number.isInteger(permission.maxCommits) || permission.maxCommits < 0)) {
    fail('INVALID_PERMISSION_SCOPE', 'permissionContext.maxCommits must be a non-negative integer.');
  }
  if (Array.isArray(permission.projectIds) && projectId && !permission.projectIds.includes(projectId)) fail('PERMISSION_DENIED', 'The session is not allowed to access this project.');
  if (Array.isArray(permission.operationKinds)) {
    for (const kind of operationKinds) if (!permission.operationKinds.includes(kind)) fail('PERMISSION_DENIED', 'Operation "' + kind + '" is outside the session scope.');
  }
  return permission;
}

function canonicalEntityMap(project) {
  const part = studioV5RootPart(project);
  const entries = [];
  entries.push(['project', project.projectId, project]);
  entries.push(['part', part.id, part]);
  for (const parameter of project.parameters || []) entries.push(['parameter', parameter.id, parameter]);
  for (const parameter of part.parameters || []) entries.push(['parameter', parameter.id, parameter]);
  for (const datum of part.referenceGeometry || []) entries.push(['datum', datum.id, datum]);
  for (const sketch of part.sketches || []) entries.push(['sketch', sketch.id, sketch]);
  for (const feature of part.features || []) entries.push(['feature', feature.id, feature]);
  for (const body of part.bodies || []) entries.push(['body', body.id, body]);
  return new Map(entries.map(([kind, id, value]) => [kind + ':' + id, { kind, id, value }]));
}

function changedEntity(entry) {
  return { kind: entry.kind, id: entry.id, name: entry.value?.name || entry.value?.title || entry.id };
}

function semanticChangeSet(before, after, aliases = {}) {
  const previous = canonicalEntityMap(before);
  const next = canonicalEntityMap(after);
  const created = [];
  const updated = [];
  const deleted = [];
  for (const [key, entry] of next) {
    if (!previous.has(key)) created.push(changedEntity(entry));
    else if (JSON.stringify(previous.get(key).value) !== JSON.stringify(entry.value)) updated.push(changedEntity(entry));
  }
  for (const [key, entry] of previous) if (!next.has(key)) deleted.push(changedEntity(entry));
  const previousParameters = new Map((before.parameters || []).map((entry) => [entry.id, entry]));
  const parameterDiffs = (after.parameters || []).flatMap((entry) => {
    const old = previousParameters.get(entry.id);
    return !old || old.name !== entry.name || old.value !== entry.value
      ? [{ parameter: { kind: 'parameter', id: entry.id }, before: old?.value, after: entry.value, nameBefore: old?.name, nameAfter: entry.name }]
      : [];
  });
  const previousBodies = new Map(studioV5RootPart(before).bodies.map((body) => [body.id, body]));
  const visibilityDiffs = studioV5RootPart(after).bodies.flatMap((body) => {
    const old = previousBodies.get(body.id);
    return old && (old.visible !== body.visible || old.suppressed !== body.suppressed)
      ? [{ body: { kind: 'body', id: body.id }, visibleBefore: old.visible, visibleAfter: body.visible, suppressedBefore: old.suppressed, suppressedAfter: body.suppressed }]
      : [];
  });
  return {
    created,
    updated,
    deleted,
    remapped: [],
    invalidated: updated.filter((entry) => entry.kind === 'feature' || entry.kind === 'body'),
    rebuilt: updated.filter((entry) => entry.kind === 'feature' || entry.kind === 'body').map((entry) => ({ entity: entry })),
    unchangedAssertions: [],
    parameterDiffs,
    transformDiffs: [],
    visibilityDiffs,
    aliases: clone(aliases),
    documentHashBefore: studioV5CanonicalHash(before),
    documentHashAfter: studioV5CanonicalHash(after),
  };
}

function boundedHash(value) {
  const source = JSON.stringify(value ?? null);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return 'fnv1a32:' + (hash >>> 0).toString(16).padStart(8, '0');
}

function evidenceFromKernel(response, exactGeometry) {
  return {
    exactGeometry: Boolean(exactGeometry),
    bodyResults: (response?.bodies || []).map((body) => ({
      body: { kind: 'body', id: body.bodyId, name: body.bodyName },
      valid: body.geometry?.valid === true && !body.error,
      solids: body.geometry?.solidCount || 0,
      shells: body.geometry?.shellCount || 0,
      faces: body.geometry?.faceCount || 0,
      edges: body.geometry?.edgeCount || 0,
      ...(Number.isFinite(body.geometry?.volume) ? { volume: body.geometry.volume } : {}),
      ...(body.geometry?.bounds ? { boundingBox: body.geometry.bounds } : {}),
      geometryHash: body.geometry?.hash || body.geometry?.geometryHash || boundedHash({
        valid: body.geometry?.valid,
        solidCount: body.geometry?.solidCount,
        shellCount: body.geometry?.shellCount,
        faceCount: body.geometry?.faceCount,
        edgeCount: body.geometry?.edgeCount,
        volume: body.geometry?.volume,
        bounds: body.geometry?.bounds,
      }),
    })),
    warnings: (response?.errors || []).filter((entry) => entry.severity === 'warning').map((entry) => entry.message),
  };
}

function findFeature(project, featureId) {
  const feature = studioV5RootPart(project).features.find((entry) => entry.id === featureId);
  if (!feature) fail('MISSING_REFERENCE', 'Feature "' + featureId + '" does not exist.', { entity: { kind: 'feature', id: featureId } });
  return feature;
}

function findBody(project, bodyId) {
  const body = studioV5RootPart(project).bodies.find((entry) => entry.id === bodyId);
  if (!body) fail('MISSING_REFERENCE', 'Body "' + bodyId + '" does not exist.', { entity: { kind: 'body', id: bodyId } });
  return body;
}

function findParameter(project, parameterId) {
  const parameter = project.parameters.find((entry) => entry.id === parameterId);
  if (!parameter) fail('MISSING_REFERENCE', 'Parameter "' + parameterId + '" does not exist.', { entity: { kind: 'parameter', id: parameterId } });
  return parameter;
}

function replaceFeature(project, nextFeature) {
  return configureStudioV5Feature(project, nextFeature, {
    resultPolicy: nextFeature.resultPolicy,
    bodyName: nextFeature.resultPolicy?.bodyName,
  });
}

function deleteFeature(project, featureId) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const createdBody = part.bodies.find((body) => body.createdByFeatureId === featureId);
  if (createdBody) return deleteStudioV5Body(candidate, createdBody.id);
  if (!part.features.some((feature) => feature.id === featureId)) fail('MISSING_REFERENCE', 'Feature "' + featureId + '" does not exist.');
  part.features = part.features.filter((feature) => feature.id !== featureId);
  return prepareStudioV5RuntimeProject(candidate);
}

function resolveReference(value, aliases, path) {
  if (value && typeof value === 'object' && typeof value.alias === 'string') {
    const resolved = aliases[value.alias];
    if (!resolved) fail('MISSING_ALIAS', path + ' references unknown transaction alias "' + value.alias + '".');
    return resolved.id;
  }
  return assertId(value, path);
}

function nextStableId(project, prefix) {
  const used = new Set(canonicalEntityMap(project).values());
  const usedIds = new Set([...used].map((entry) => entry.id));
  let index = 1;
  while (usedIds.has(prefix + '-' + index)) index++;
  return prefix + '-' + index;
}

function featureFromOperation(project, kind, input, aliases) {
  const type = kind.slice('feature.'.length);
  const id = input.id ? assertId(input.id, 'operation.input.id') : nextStableId(project, 'feature-' + type);
  const activeBody = studioV5ActiveBody(project);
  const defaultPolicy = activeBody
    ? type === 'cut'
      ? { kind: 'subtract', targetBodyIds: [activeBody.id], keepTools: false }
      : { kind: 'add', targetBodyIds: [activeBody.id] }
    : { kind: 'new-body', bodyName: input.bodyName || 'Body ' + (studioV5RootPart(project).bodies.length + 1) };
  const resultPolicy = clone(input.resultPolicy || defaultPolicy);
  if (Array.isArray(resultPolicy.targetBodyIds)) {
    resultPolicy.targetBodyIds = resultPolicy.targetBodyIds.map((bodyId, index) => resolveReference(bodyId, aliases, 'operation.input.resultPolicy.targetBodyIds[' + index + ']'));
  }
  const inputRefs = clone(input.inputRefs || []).map((reference, index) => {
    if (reference?.ownerId && typeof reference.ownerId === 'object') {
      return { ...reference, ownerId: resolveReference(reference.ownerId, aliases, 'operation.input.inputRefs[' + index + '].ownerId') };
    }
    return reference;
  });
  const base = {
    id,
    name: input.name || type[0].toUpperCase() + type.slice(1),
    type,
    suppressed: false,
    inputRefs,
    resultPolicy,
  };
  if (type === 'extrude' || type === 'cut' || type === 'revolve') {
    assertRecord(input.sketch, 'operation.input.sketch');
    base.sketch = clone(input.sketch);
  }
  if (type === 'extrude' || type === 'cut') {
    base.h = assertFiniteOrExpression(input.height ?? input.h ?? 20, 'operation.input.height');
    base.through = type === 'cut' ? input.through === true : false;
  } else if (type === 'fillet' || type === 'chamfer') {
    base.r = assertFiniteOrExpression(input.radius ?? input.r, 'operation.input.radius');
    base.edges = clone(Array.isArray(input.edges) ? input.edges : []);
  } else if (type === 'shell') {
    base.t = assertFiniteOrExpression(input.thickness ?? input.t, 'operation.input.thickness');
    base.faces = clone(Array.isArray(input.faces) ? input.faces : []);
  }
  return base;
}

function applyOperation(project, operation, aliases) {
  const op = assertRecord(operation, 'operation');
  const kind = assertText(op.kind, 'operation.kind');
  if (!AVAILABLE_OPERATION_KINDS.includes(kind)) {
    const reason = DISABLED_OPERATION_REASONS[kind];
    if (reason) fail('CAPABILITY_DISABLED', 'Operation "' + kind + '" is not available in this runtime.', { repairOptions: [{ kind: 'inspect-capabilities', capability: kind, reasonCode: reason }] });
    fail('UNKNOWN_OPERATION', 'Unknown CAD operation "' + kind + '".');
  }
  const input = assertRecord(op.input || {}, 'operation.input');
  let candidate = canonicalStudioV5Project(project);
  let resultRef = null;

  if (kind === 'project.rename') {
    const name = assertText(input.name, 'operation.input.name');
    candidate.name = name;
    studioV5RootPart(candidate).name = name;
  } else if (kind === 'project.setUnits') {
    if (input.units !== 'mm' && input.units !== 'in') fail('INVALID_UNITS', 'Project units must be "mm" or "in".');
    candidate.units = input.units;
  } else if (kind === 'parameter.create') {
    const parameter = {
      id: input.id ? assertId(input.id, 'operation.input.id') : nextStableId(candidate, 'parameter'),
      name: assertText(input.name, 'operation.input.name'),
      value: assertFiniteOrExpression(input.value, 'operation.input.value'),
      ...(input.description ? { description: String(input.description).slice(0, 2000) } : {}),
    };
    candidate.parameters.push(parameter);
    resultRef = { kind: 'parameter', id: parameter.id, name: parameter.name };
  } else if (kind === 'parameter.update') {
    const parameterId = input.parameterId
      ? resolveReference(input.parameterId, aliases, 'operation.input.parameterId')
      : candidate.parameters.find((entry) => entry.name === input.parameterName)?.id;
    if (!parameterId) fail('MISSING_REFERENCE', 'The requested parameter does not exist.');
    const parameter = findParameter(candidate, parameterId);
    if (input.name != null) parameter.name = assertText(input.name, 'operation.input.name');
    if (input.value != null) parameter.value = assertFiniteOrExpression(input.value, 'operation.input.value');
    if (input.description != null) parameter.description = String(input.description).slice(0, 2000);
    resultRef = { kind: 'parameter', id: parameter.id, name: parameter.name };
  } else if (kind === 'parameter.delete') {
    const parameterId = input.parameterId
      ? resolveReference(input.parameterId, aliases, 'operation.input.parameterId')
      : candidate.parameters.find((entry) => entry.name === input.parameterName)?.id;
    if (!parameterId) fail('MISSING_REFERENCE', 'The requested parameter does not exist.');
    findParameter(candidate, parameterId);
    candidate.parameters = candidate.parameters.filter((entry) => entry.id !== parameterId);
  } else if (kind.startsWith('feature.') && ['feature.extrude', 'feature.cut', 'feature.revolve', 'feature.fillet', 'feature.chamfer', 'feature.shell'].includes(kind)) {
    const feature = featureFromOperation(candidate, kind, input, aliases);
    candidate = configureStudioV5Feature(candidate, feature, { resultPolicy: feature.resultPolicy, bodyName: feature.resultPolicy?.bodyName || input.bodyName });
    resultRef = { kind: 'feature', id: feature.id, name: feature.name };
  } else if (kind === 'feature.update') {
    const featureId = resolveReference(input.featureId, aliases, 'operation.input.featureId');
    const feature = clone(findFeature(candidate, featureId));
    const patch = assertRecord(input.patch, 'operation.input.patch');
    const allowed = new Set(['name', 'h', 'through', 'r', 't', 'edges', 'faces', 'sketch', 'pattern', 'resultPolicy', 'inputRefs']);
    for (const key of Object.keys(patch)) if (!allowed.has(key)) fail('INVALID_PATCH', 'Feature field "' + key + '" is not editable through protocol v1.');
    Object.assign(feature, clone(patch));
    if (patch.pattern === null) delete feature.pattern;
    candidate = replaceFeature(candidate, feature);
    resultRef = { kind: 'feature', id: feature.id, name: feature.name };
  } else if (kind === 'feature.suppress') {
    const featureId = resolveReference(input.featureId, aliases, 'operation.input.featureId');
    const feature = clone(findFeature(candidate, featureId));
    if (typeof input.suppressed !== 'boolean') fail('INVALID_REQUEST', 'operation.input.suppressed must be a boolean.');
    feature.suppressed = input.suppressed;
    candidate = replaceFeature(candidate, feature);
    resultRef = { kind: 'feature', id: feature.id, name: feature.name };
  } else if (kind === 'feature.delete') {
    candidate = deleteFeature(candidate, resolveReference(input.featureId, aliases, 'operation.input.featureId'));
  } else if (kind === 'body.activate') {
    const bodyId = resolveReference(input.bodyId, aliases, 'operation.input.bodyId');
    findBody(candidate, bodyId);
    candidate = updateStudioV5Body(candidate, bodyId, { active: true });
    resultRef = { kind: 'body', id: bodyId };
  } else if (kind === 'body.rename') {
    const bodyId = resolveReference(input.bodyId, aliases, 'operation.input.bodyId');
    findBody(candidate, bodyId);
    const name = assertText(input.name, 'operation.input.name');
    candidate = updateStudioV5Body(candidate, bodyId, { name });
    resultRef = { kind: 'body', id: bodyId, name };
  } else if (kind === 'body.setVisibility') {
    const bodyId = resolveReference(input.bodyId, aliases, 'operation.input.bodyId');
    findBody(candidate, bodyId);
    if (typeof input.visible !== 'boolean') fail('INVALID_REQUEST', 'operation.input.visible must be a boolean.');
    candidate = updateStudioV5Body(candidate, bodyId, { visible: input.visible });
    resultRef = { kind: 'body', id: bodyId };
  } else if (kind === 'body.suppress') {
    const bodyId = resolveReference(input.bodyId, aliases, 'operation.input.bodyId');
    findBody(candidate, bodyId);
    if (typeof input.suppressed !== 'boolean') fail('INVALID_REQUEST', 'operation.input.suppressed must be a boolean.');
    candidate = updateStudioV5Body(candidate, bodyId, { suppressed: input.suppressed });
    resultRef = { kind: 'body', id: bodyId };
  } else if (kind === 'body.delete') {
    const bodyId = resolveReference(input.bodyId, aliases, 'operation.input.bodyId');
    findBody(candidate, bodyId);
    candidate = deleteStudioV5Body(candidate, bodyId);
  } else if (kind === 'pattern.linear' || kind === 'pattern.circular' || kind === 'pattern.dissolve') {
    const featureId = resolveReference(input.featureId, aliases, 'operation.input.featureId');
    const feature = clone(findFeature(candidate, featureId));
    if (kind === 'pattern.dissolve') delete feature.pattern;
    else if (kind === 'pattern.linear') {
      feature.pattern = {
        kind: 'linear',
        n: assertInteger(input.count, 'operation.input.count', 1, 100),
        dx: assertFiniteOrExpression(input.dx ?? 0, 'operation.input.dx'),
        dy: assertFiniteOrExpression(input.dy ?? 0, 'operation.input.dy'),
      };
    } else {
      feature.pattern = {
        kind: 'circular',
        n: assertInteger(input.count, 'operation.input.count', 1, 100),
        cx: assertFiniteOrExpression(input.cx ?? 0, 'operation.input.cx'),
        cy: assertFiniteOrExpression(input.cy ?? 0, 'operation.input.cy'),
      };
    }
    candidate = replaceFeature(candidate, feature);
    resultRef = { kind: 'feature', id: feature.id, name: feature.name };
  } else if (kind.startsWith('boolean.')) {
    const operationName = kind.slice('boolean.'.length);
    const targetBodyId = resolveReference(input.targetBodyId, aliases, 'operation.input.targetBodyId');
    const toolBodyId = resolveReference(input.toolBodyId, aliases, 'operation.input.toolBodyId');
    findBody(candidate, targetBodyId);
    findBody(candidate, toolBodyId);
    const id = input.id ? assertId(input.id, 'operation.input.id') : nextStableId(candidate, 'feature-boolean-' + operationName);
    if (input.keepTools != null && typeof input.keepTools !== 'boolean') fail('INVALID_REQUEST', 'operation.input.keepTools must be a boolean.');
    candidate = createStudioV5BooleanFeature(candidate, {
      id,
      name: input.name,
      operation: operationName === 'union' ? 'add' : operationName,
      targetBodyId,
      toolBodyId,
      keepTools: input.keepTools !== false,
    });
    resultRef = { kind: 'feature', id, name: input.name || operationName };
  }

  candidate = prepareStudioV5RuntimeProject(candidate);
  if (op.alias) {
    const alias = assertText(op.alias, 'operation.alias');
    if (aliases[alias]) fail('DUPLICATE_ALIAS', 'Transaction alias "' + alias + '" is already defined.');
    if (!resultRef) fail('INVALID_ALIAS', 'Operation "' + kind + '" does not create or select an addressable result.');
    aliases[alias] = resultRef;
  }
  return candidate;
}

export function applyCadTransaction(project, transaction) {
  if (!isStudioV5Project(project)) fail('UNSUPPORTED_DOCUMENT', 'Agent protocol v1 currently accepts schema-5 part projects only.');
  const tx = assertRecord(transaction, 'transaction');
  assertText(tx.transactionId, 'transaction.transactionId');
  assertText(tx.label, 'transaction.label');
  if (tx.atomic !== true) fail('ATOMIC_REQUIRED', 'Protocol v1 transactions must set atomic to true.');
  if (!Array.isArray(tx.operations) || tx.operations.length < 1 || tx.operations.length > MAX_TRANSACTION_OPERATIONS) {
    fail('LIMIT_OPERATIONS', 'A transaction must contain 1 to ' + MAX_TRANSACTION_OPERATIONS + ' operations.');
  }
  const aliases = {};
  let candidate = canonicalStudioV5Project(project);
  for (let index = 0; index < tx.operations.length; index++) {
    try {
      candidate = applyOperation(candidate, tx.operations[index], aliases);
    } catch (error) {
      if (error instanceof CadAgentError) {
        error.details = { ...(error.details || {}), operationIndex: index };
        throw error;
      }
      throw new CadAgentError(error?.code || 'DOCUMENT_VALIDATION_FAILED', String(error?.message || error), { operationIndex: index });
    }
  }
  candidate = prepareStudioV5RuntimeProject(candidate);
  return { project: candidate, aliases, changeSet: semanticChangeSet(project, candidate, aliases) };
}

function paginate(items, request = {}) {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(request.pageSize) || DEFAULT_PAGE_SIZE));
  const offset = request.cursor == null ? 0 : assertInteger(Number(request.cursor), 'cursor', 0);
  return {
    items: items.slice(offset, offset + pageSize),
    total: items.length,
    nextCursor: offset + pageSize < items.length ? String(offset + pageSize) : null,
  };
}

function dependencyGraph(project) {
  const part = studioV5RootPart(project);
  const edges = [];
  for (const feature of part.features) {
    for (const ref of feature.inputRefs || []) edges.push({ from: { kind: ref.ownerKind, id: ref.ownerId }, to: { kind: 'feature', id: feature.id }, relation: 'input' });
    for (const bodyId of feature.resultPolicy?.targetBodyIds || []) edges.push({ from: { kind: 'feature', id: feature.id }, to: { kind: 'body', id: bodyId }, relation: 'modifies' });
    if (feature.createdBodyId) edges.push({ from: { kind: 'feature', id: feature.id }, to: { kind: 'body', id: feature.createdBodyId }, relation: 'creates' });
    for (const bodyId of feature.toolBodyIds || []) edges.push({ from: { kind: 'body', id: bodyId }, to: { kind: 'feature', id: feature.id }, relation: 'tool' });
  }
  return edges;
}

function cacheResponse(cache, key, response) {
  if (!cache.has(key) && cache.size >= MAX_REQUEST_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, clone(response));
}

export class CadCommandService {
  constructor(options = {}) {
    const project = options.project || createEmptyStudioV5PartProject({ projectId: options.projectId || 'project-agent-1', name: options.name || 'Agent part', units: options.units || 'mm' });
    this.project = prepareStudioV5RuntimeProject(project);
    this.revision = Number.isInteger(options.revision) ? options.revision : 0;
    this.kernel = options.kernel || null;
    this.commitAdapter = options.commitAdapter || null;
    this.previewTtlMs = options.previewTtlMs || DEFAULT_PREVIEW_TTL_MS;
    this.now = options.now || (() => Date.now());
    this.previews = new Map();
    this.requestCache = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.journal = [];
    this.previewSequence = 0;
    this.commitCount = 0;
    this.lastEvidence = evidenceFromKernel(null, false);
  }

  snapshot() {
    return canonicalStudioV5Project(this.project);
  }

  synchronize(project, revision, entry = null) {
    this.project = prepareStudioV5RuntimeProject(project);
    this.revision = assertInteger(revision, 'revision', 0);
    if (entry) this.journal.push({ revision: this.revision, ...clone(entry), documentHash: studioV5CanonicalHash(this.project) });
    return this.snapshot();
  }

  capabilities() {
    return cadCapabilityManifest({ exactKernel: Boolean(this.kernel) });
  }

  inspect(request = {}) {
    const kind = request.kind || 'project.summary';
    const project = this.project;
    const part = studioV5RootPart(project);
    if (kind === 'project.summary') {
      return {
        projectId: project.projectId,
        revision: this.revision,
        name: project.name,
        units: project.units,
        schemaVersion: project.schemaVersion,
        documentKind: project.rootDocument.kind,
        counts: {
          parameters: project.parameters.length,
          parts: project.partDefinitions.length,
          features: part.features.length,
          bodies: part.bodies.length,
        },
        activeBodyId: part.metadata?.activeBodyId || null,
        documentHash: studioV5CanonicalHash(project),
      };
    }
    if (kind === 'project.tree') {
      const nodes = [
        { kind: 'project', id: project.projectId, name: project.name, parent: null },
        { kind: 'part', id: part.id, name: part.name, parent: { kind: 'project', id: project.projectId } },
        ...project.parameters.map((entry) => ({ kind: 'parameter', id: entry.id, name: entry.name, parent: { kind: 'project', id: project.projectId } })),
        ...part.bodies.map((entry) => ({ kind: 'body', id: entry.id, name: entry.name, visible: entry.visible, suppressed: entry.suppressed, parent: { kind: 'part', id: part.id } })),
        ...part.features.map((entry) => ({ kind: 'feature', id: entry.id, name: entry.name, featureType: entry.type, suppressed: entry.suppressed, parent: { kind: 'part', id: part.id } })),
      ];
      return paginate(nodes, request);
    }
    if (kind === 'entity.detail') {
      const entityKind = assertText(request.entity?.kind, 'entity.kind');
      const entityId = assertId(request.entity?.id, 'entity.id');
      const entry = canonicalEntityMap(project).get(entityKind + ':' + entityId);
      if (!entry) fail('MISSING_REFERENCE', entityKind + ' "' + entityId + '" does not exist.');
      return { entity: changedEntity(entry), value: clone(entry.value) };
    }
    if (kind === 'entity.dependencies') {
      const edges = dependencyGraph(project);
      if (!request.entity) return paginate(edges, request);
      const entityKind = assertText(request.entity.kind, 'entity.kind');
      const entityId = assertId(request.entity.id, 'entity.id');
      return paginate(edges.filter((edge) => (edge.from.kind === entityKind && edge.from.id === entityId) || (edge.to.kind === entityKind && edge.to.id === entityId)), request);
    }
    if (kind === 'entity.search') {
      const query = String(request.query || '').trim().toLowerCase();
      const matches = [...canonicalEntityMap(project).values()]
        .filter((entry) => !query || entry.id.toLowerCase().includes(query) || String(entry.value?.name || '').toLowerCase().includes(query))
        .map(changedEntity);
      return paginate(matches, request);
    }
    if (kind === 'history.list') return paginate(this.journal.slice().reverse(), request);
    if (kind === 'history.changesSince') {
      const revision = assertInteger(request.revision, 'revision', 0);
      return paginate(this.journal.filter((entry) => entry.revision > revision), request);
    }
    fail('UNKNOWN_QUERY', 'Unknown inspection query "' + kind + '".');
  }

  async query(request = {}) {
    const kind = request.kind || 'geometry.validity';
    if (kind === 'geometry.bodies' || kind === 'geometry.validity') {
      let evidence = this.lastEvidence;
      if (request.exact === true) {
        if (!this.kernel) fail('EXACT_KERNEL_REQUIRED', 'This session has no exact-kernel adapter.');
        const response = await this.kernel.validate(this.snapshot(), this.revision);
        if (response?.errors?.length) fail('KERNEL_VALIDATION_FAILED', response.errors[0].message, { kernelErrors: response.errors });
        evidence = evidenceFromKernel(response, true);
        this.lastEvidence = evidence;
      }
      return kind === 'geometry.bodies'
        ? paginate(evidence.bodyResults, request)
        : { exactGeometry: evidence.exactGeometry, valid: evidence.bodyResults.every((entry) => entry.valid), bodies: evidence.bodyResults };
    }
    return this.inspect(request);
  }

  prunePreviews() {
    const now = this.now();
    for (const [id, preview] of this.previews) if (preview.expiresAtMs <= now) this.previews.delete(id);
  }

  async preview(transaction, permissionContext) {
    assertPermission(permissionContext, EDIT_PERMISSIONS, this.project.projectId, transaction?.operations?.map((entry) => entry.kind) || []);
    const expectedRevision = assertInteger(transaction?.expectedRevision, 'transaction.expectedRevision', 0);
    if (expectedRevision !== this.revision) fail('REVISION_CONFLICT', 'Expected project revision ' + expectedRevision + ' but current revision is ' + this.revision + '.', {
      expectedRevision,
      actualRevision: this.revision,
      changesSince: this.journal.filter((entry) => entry.revision > expectedRevision).slice(-20),
    });
    const bytes = new TextEncoder().encode(JSON.stringify(transaction)).byteLength;
    if (bytes > MAX_REQUEST_BYTES) fail('LIMIT_REQUEST_BYTES', 'Transaction exceeds the 1 MiB protocol request limit.');
    let applied;
    try {
      applied = applyCadTransaction(this.project, transaction);
    } catch (error) {
      if (error instanceof CadAgentError) throw error;
      throw new CadAgentError(error?.code || 'DOCUMENT_VALIDATION_FAILED', String(error?.message || error));
    }
    let kernelResponse = null;
    if (this.kernel) {
      kernelResponse = await this.kernel.validate(applied.project, this.revision);
      if (kernelResponse?.errors?.length) fail('KERNEL_VALIDATION_FAILED', kernelResponse.errors[0].message, { kernelErrors: kernelResponse.errors });
    }
    this.prunePreviews();
    const previewId = 'preview-' + (++this.previewSequence) + '-' + applied.changeSet.documentHashAfter;
    const expiresAtMs = this.now() + this.previewTtlMs;
    const preview = {
      previewId,
      transaction: clone(transaction),
      project: applied.project,
      aliases: applied.aliases,
      baseRevision: this.revision,
      expiresAtMs,
      changeSet: applied.changeSet,
      evidence: evidenceFromKernel(kernelResponse, Boolean(this.kernel)),
    };
    this.previews.set(previewId, preview);
    return {
      previewId,
      baseRevision: this.revision,
      expiresAt: new Date(expiresAtMs).toISOString(),
      changeSet: clone(preview.changeSet),
      validation: { valid: true, exactGeometry: Boolean(this.kernel), diagnostics: [] },
      evidence: clone(preview.evidence),
      confirmation: { required: preview.changeSet.deleted.length > 0, reasons: preview.changeSet.deleted.length ? ['DESTRUCTIVE_DELETE'] : [] },
    };
  }

  async commit(previewId, expectedRevision, permissionContext, options = {}) {
    const permission = assertPermission(permissionContext, EDIT_PERMISSIONS, this.project.projectId);
    this.prunePreviews();
    const preview = this.previews.get(assertText(previewId, 'previewId'));
    if (!preview) fail('PREVIEW_EXPIRED', 'The requested preview does not exist or has expired.');
    if (assertInteger(expectedRevision, 'expectedRevision', 0) !== this.revision || preview.baseRevision !== this.revision) {
      this.previews.delete(previewId);
      fail('REVISION_CONFLICT', 'The project changed after this preview was created.', { expectedRevision: preview.baseRevision, actualRevision: this.revision });
    }
    if (Number.isInteger(permission.maxCommits) && this.commitCount >= permission.maxCommits) fail('PERMISSION_BUDGET_EXCEEDED', 'The session commit budget has been exhausted.');
    const before = this.snapshot();
    const entry = {
      label: preview.transaction.label,
      actor: preview.transaction.metadata?.actor || options.actor || 'agent',
      transactionId: preview.transaction.transactionId,
      changeSet: clone(preview.changeSet),
    };
    let committedRevision = this.revision + 1;
    if (this.commitAdapter) {
      const result = await this.commitAdapter({ project: clone(preview.project), baseRevision: this.revision, ...entry });
      if (result?.project) this.project = prepareStudioV5RuntimeProject(result.project);
      else this.project = prepareStudioV5RuntimeProject(preview.project);
      if (Number.isInteger(result?.revision)) committedRevision = result.revision;
    } else {
      this.project = prepareStudioV5RuntimeProject(preview.project);
      this.undoStack.push({ project: before, entry });
      this.redoStack.length = 0;
    }
    this.revision = committedRevision;
    this.commitCount++;
    this.lastEvidence = clone(preview.evidence);
    this.journal.push({ revision: this.revision, ...entry, documentHash: studioV5CanonicalHash(this.project) });
    this.previews.clear();
    return {
      revision: this.revision,
      projectId: this.project.projectId,
      changeSet: clone(preview.changeSet),
      evidence: clone(preview.evidence),
      aliases: clone(preview.aliases),
      historyEntry: { revision: this.revision, label: entry.label, actor: entry.actor, transactionId: entry.transactionId },
    };
  }

  cancelPreview(previewId) {
    const existed = this.previews.delete(previewId);
    return { cancelled: existed };
  }

  async historyAction(request, permissionContext) {
    const action = request.action || 'list';
    if (action === 'list' || action === 'changesSince') {
      assertPermission(permissionContext, READ_PERMISSIONS, this.project.projectId);
      return this.inspect(action === 'list' ? { kind: 'history.list', ...request } : { kind: 'history.changesSince', revision: request.revision, ...request });
    }
    assertPermission(permissionContext, EDIT_PERMISSIONS, this.project.projectId);
    if (this.commitAdapter) return this.commitAdapter({ historyAction: action, expectedRevision: request.expectedRevision });
    if (assertInteger(request.expectedRevision, 'expectedRevision', 0) !== this.revision) fail('REVISION_CONFLICT', 'History command targets a stale project revision.');
    if (action === 'undo') {
      const command = this.undoStack.pop();
      if (!command) fail('NOTHING_TO_UNDO', 'There is no command to undo.');
      this.redoStack.push({ project: this.snapshot(), entry: command.entry });
      this.project = prepareStudioV5RuntimeProject(command.project);
    } else if (action === 'redo') {
      const command = this.redoStack.pop();
      if (!command) fail('NOTHING_TO_REDO', 'There is no command to redo.');
      this.undoStack.push({ project: this.snapshot(), entry: command.entry });
      this.project = prepareStudioV5RuntimeProject(command.project);
    } else fail('UNKNOWN_HISTORY_ACTION', 'Unknown history action "' + action + '".');
    this.revision++;
    this.previews.clear();
    this.journal.push({ revision: this.revision, label: action === 'undo' ? 'Undo' : 'Redo', actor: 'agent', documentHash: studioV5CanonicalHash(this.project) });
    return { revision: this.revision, project: this.snapshot(), documentHash: studioV5CanonicalHash(this.project) };
  }

  async request(envelope) {
    const startedAt = this.now();
    let requestId = envelope?.requestId;
    let sessionId = envelope?.sessionId;
    try {
      assertRecord(envelope, 'request');
      if (envelope.protocol !== CAD_AGENT_PROTOCOL) fail('UNSUPPORTED_PROTOCOL', 'This build supports only ' + CAD_AGENT_PROTOCOL + '.');
      requestId = assertText(envelope.requestId, 'request.requestId');
      sessionId = assertText(envelope.sessionId, 'request.sessionId');
      const cacheKey = sessionId + ':' + requestId;
      if (this.requestCache.has(cacheKey)) return clone(this.requestCache.get(cacheKey));
      const payload = assertRecord(envelope.payload, 'request.payload');
      let result;
      if (payload.kind === 'capabilities') result = this.capabilities();
      else if (payload.kind === 'inspect') {
        assertPermission(envelope.permissionContext, READ_PERMISSIONS, this.project.projectId);
        result = this.inspect(payload.query || {});
      } else if (payload.kind === 'query') {
        assertPermission(envelope.permissionContext, READ_PERMISSIONS, this.project.projectId);
        result = await this.query(payload.query || {});
      } else if (payload.kind === 'preview') result = await this.preview(payload.transaction, envelope.permissionContext);
      else if (payload.kind === 'commit') result = await this.commit(payload.previewId, envelope.expectedRevision, envelope.permissionContext, payload);
      else if (payload.kind === 'cancelPreview') result = this.cancelPreview(payload.previewId);
      else if (payload.kind === 'history') result = await this.historyAction(payload, envelope.permissionContext);
      else fail('UNKNOWN_REQUEST_KIND', 'Unknown CAD request kind "' + payload.kind + '".');
      const response = {
        protocol: CAD_AGENT_PROTOCOL,
        requestId,
        sessionId,
        projectId: this.project.projectId,
        revision: this.revision,
        status: 'ok',
        result,
        diagnostics: [],
        timing: { totalMs: Math.max(0, this.now() - startedAt) },
      };
      cacheResponse(this.requestCache, cacheKey, response);
      return response;
    } catch (error) {
      const status = error?.code === 'REVISION_CONFLICT' ? 'conflict' : 'error';
      const response = {
        protocol: CAD_AGENT_PROTOCOL,
        requestId: requestId || 'invalid-request',
        sessionId: sessionId || 'invalid-session',
        projectId: this.project.projectId,
        revision: this.revision,
        status,
        diagnostics: [diagnostic(error, error?.details?.operationIndex)],
        timing: { totalMs: Math.max(0, this.now() - startedAt) },
      };
      if (requestId && sessionId) cacheResponse(this.requestCache, sessionId + ':' + requestId, response);
      return response;
    }
  }
}

export function createCadAgentRequest(options) {
  return {
    protocol: CAD_AGENT_PROTOCOL,
    requestId: options.requestId,
    sessionId: options.sessionId,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(Number.isInteger(options.expectedRevision) ? { expectedRevision: options.expectedRevision } : {}),
    permissionContext: clone(options.permissionContext || { granted: [] }),
    payload: clone(options.payload),
  };
}
