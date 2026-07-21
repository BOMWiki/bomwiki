import {
  migrateStudioPartToV5,
  parseOrMigrateStudioV5Project,
  prepareStudioV5Project,
} from './studio-project-v5.js';

// Canonical schema-5 document helpers used by the production Studio runtime.
// The non-enumerable legacy aliases let the existing V4 editors keep using
// doc.features/doc.params/doc.title while save, recovery and undo snapshots
// contain only the canonical schema-5 project.

const clone = (value) => structuredClone(value);

export function isStudioV5Project(value) {
  return Boolean(value && typeof value === 'object' && value.schemaVersion === 5 && Array.isArray(value.partDefinitions));
}

export function studioV5RootPart(project) {
  if (!isStudioV5Project(project) || project.rootDocument?.kind !== 'part') {
    throw new Error('Slice 5A supports schema-5 part documents only.');
  }
  const part = project.partDefinitions.find((entry) => entry.id === project.rootDocument.partId);
  if (!part) throw new Error('The active schema-5 part definition is missing.');
  return part;
}

function defineAlias(project, name, descriptor) {
  Object.defineProperty(project, name, {
    configurable: true,
    enumerable: false,
    ...descriptor,
  });
}

export function decorateStudioV5Project(project) {
  const part = studioV5RootPart(project);
  defineAlias(project, 'features', {
    get: () => part.features,
    set: (features) => {
      part.features = features;
      part.featureOrder = features.map((feature) => feature.id);
    },
  });
  defineAlias(project, 'params', {
    get: () => project.parameters,
    set: (parameters) => {
      project.parameters = parameters;
    },
  });
  defineAlias(project, 'title', {
    get: () => project.name,
    set: (title) => {
      project.name = title;
      part.name = title;
    },
  });
  return project;
}

function featureName(feature, index) {
  const fallback = String(feature.type || 'Feature').replace(/(^|-)([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase());
  return typeof feature.name === 'string' && feature.name.trim()
    ? feature.name.trim().slice(0, 200)
    : fallback + ' ' + (index + 1);
}

function bodyIdFor(feature) {
  return feature.createdBodyId || 'body-' + feature.id;
}

export function reconcileStudioV5Bodies(part) {
  part.metadata ||= {};
  const existingByCreator = new Map((part.bodies || []).map((body) => [body.createdByFeatureId, body]));
  const features = Array.isArray(part.features) ? part.features : [];
  const byId = new Map();
  const bodies = [];

  features.forEach((feature, index) => {
    feature.name = featureName(feature, index);
    feature.suppressed = feature.suppressed === true;
    feature.inputRefs = Array.isArray(feature.inputRefs) ? feature.inputRefs : [];
    if (!feature.resultPolicy) {
      const firstBody = bodies[0];
      feature.resultPolicy = firstBody
        ? feature.type === 'cut'
          ? { kind: 'subtract', targetBodyIds: [firstBody.id], keepTools: false }
          : { kind: 'add', targetBodyIds: [firstBody.id] }
        : { kind: 'new-body', bodyName: 'Body 1' };
    }
    if (feature.resultPolicy.kind !== 'new-body' && feature.resultPolicy.kind !== 'surface') return;
    const previous = existingByCreator.get(feature.id);
    const id = previous?.id || bodyIdFor(feature);
    feature.createdBodyId = id;
    const body = {
      id,
      name: previous?.name || feature.resultPolicy.bodyName || (feature.resultPolicy.kind === 'surface' ? 'Surface ' : 'Body ') + (bodies.length + 1),
      kind: feature.resultPolicy.kind === 'surface' ? 'surface' : 'solid',
      createdByFeatureId: feature.id,
      featureIds: [],
      visible: previous?.visible !== false,
      suppressed: previous?.suppressed === true,
      ...(previous?.appearanceId ? { appearanceId: previous.appearanceId } : {}),
      ...(previous?.materialId ? { materialId: previous.materialId } : {}),
      ...(previous?.extensions ? { extensions: clone(previous.extensions) } : {}),
    };
    bodies.push(body);
    byId.set(body.id, body);
  });

  for (const feature of features) {
    const policy = feature.resultPolicy;
    const targets = policy.kind === 'new-body' || policy.kind === 'surface'
      ? [feature.createdBodyId]
      : policy.targetBodyIds;
    for (const bodyId of targets || []) {
      const body = byId.get(bodyId);
      if (body && !body.featureIds.includes(feature.id)) body.featureIds.push(feature.id);
    }
  }

  part.bodies = bodies;
  part.featureOrder = features.map((feature) => feature.id);
  const activeBody = bodies.find((body) => body.id === part.metadata.activeBodyId);
  if (!activeBody || activeBody.suppressed) {
    part.metadata.activeBodyId = bodies.find((body) => !body.suppressed)?.id || null;
  }
  return part;
}

export function prepareStudioV5RuntimeProject(candidate) {
  const detached = clone(candidate);
  const part = studioV5RootPart(detached);
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(detached));
}

export function migrateStudioDocumentToV5(candidate, options = {}) {
  const migrated = migrateStudioPartToV5(candidate, options);
  const part = studioV5RootPart(migrated);
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(migrated));
}

export function parseOrMigrateStudioV5RuntimeProject(text, options = {}) {
  return decorateStudioV5Project(parseOrMigrateStudioV5Project(text, options));
}

export function canonicalStudioV5Project(project) {
  return prepareStudioV5Project(JSON.parse(JSON.stringify(project)));
}

export function studioV5ActiveBody(project) {
  const part = studioV5RootPart(project);
  return part.bodies.find((body) => body.id === part.metadata?.activeBodyId && !body.suppressed) || null;
}

export function configureStudioV5Feature(project, featureInput, options = {}) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const feature = clone(featureInput);
  const existingIndex = part.features.findIndex((entry) => entry.id === feature.id);
  const previous = existingIndex >= 0 ? part.features[existingIndex] : null;
  feature.name = featureName(feature, existingIndex >= 0 ? existingIndex : part.features.length);
  feature.suppressed = feature.suppressed === true;
  feature.inputRefs = Array.isArray(feature.inputRefs) ? feature.inputRefs : [];

  if (options.resultPolicy) feature.resultPolicy = clone(options.resultPolicy);
  else if (previous?.resultPolicy) feature.resultPolicy = clone(previous.resultPolicy);
  else {
    const active = studioV5ActiveBody(candidate);
    feature.resultPolicy = active
      ? feature.type === 'cut'
        ? { kind: 'subtract', targetBodyIds: [active.id], keepTools: false }
        : { kind: 'add', targetBodyIds: [active.id] }
      : { kind: 'new-body', bodyName: options.bodyName || 'Body 1' };
  }
  if (feature.resultPolicy.kind === 'new-body' || feature.resultPolicy.kind === 'surface') {
    feature.resultPolicy.bodyName = options.bodyName || feature.resultPolicy.bodyName || previous?.resultPolicy?.bodyName || 'Body ' + (part.bodies.length + 1);
    feature.createdBodyId = previous?.createdBodyId || feature.createdBodyId || 'body-' + feature.id;
  }

  if (existingIndex >= 0) part.features[existingIndex] = feature;
  else part.features.push(feature);
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function createStudioV5BooleanFeature(project, options) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const target = part.bodies.find((body) => body.id === options.targetBodyId);
  const tool = part.bodies.find((body) => body.id === options.toolBodyId);
  if (!target || !tool || target.id === tool.id) throw new Error('Choose two different existing bodies for the Boolean operation.');
  const feature = {
    id: options.id,
    name: options.name || 'Subtract ' + tool.name + ' from ' + target.name,
    type: 'boolean',
    operation: options.operation || 'subtract',
    suppressed: false,
    inputRefs: [
      { ownerKind: 'body', ownerId: target.id, signature: { role: 'target' } },
      { ownerKind: 'body', ownerId: tool.id, signature: { role: 'tool' } },
    ],
    toolBodyIds: [tool.id],
    resultPolicy: {
      kind: options.operation || 'subtract',
      targetBodyIds: [target.id],
      keepTools: options.keepTools !== false,
    },
  };
  part.features.push(feature);
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function updateStudioV5Body(project, bodyId, patch) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const body = part.bodies.find((entry) => entry.id === bodyId);
  if (!body) throw new Error('That body no longer exists.');
  if (patch.name != null) {
    const name = String(patch.name).trim();
    if (!name || name.length > 200) throw new Error('Body names must contain 1 to 200 characters.');
    body.name = name;
  }
  if (patch.visible != null) body.visible = Boolean(patch.visible);
  if (patch.suppressed != null) body.suppressed = Boolean(patch.suppressed);
  if (patch.active === true) part.metadata = { ...(part.metadata || {}), activeBodyId: body.id };
  return prepareStudioV5RuntimeProject(candidate);
}

export function deleteStudioV5Body(project, bodyId) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  if (!part.bodies.some((body) => body.id === bodyId)) throw new Error('That body no longer exists.');
  const removedFeatureIds = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const feature of part.features) {
      if (removedFeatureIds.has(feature.id)) continue;
      const createsBody = feature.createdBodyId === bodyId;
      const targetsBody = feature.resultPolicy?.targetBodyIds?.includes(bodyId);
      const usesBody = feature.toolBodyIds?.includes(bodyId) || feature.inputRefs?.some((ref) => ref.ownerKind === 'body' && ref.ownerId === bodyId);
      const usesRemovedFeature = feature.inputRefs?.some((ref) => ref.ownerKind === 'feature' && removedFeatureIds.has(ref.ownerId));
      if (createsBody || targetsBody || usesBody || usesRemovedFeature) {
        removedFeatureIds.add(feature.id);
        changed = true;
      }
    }
  }
  part.features = part.features.filter((feature) => !removedFeatureIds.has(feature.id));
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function studioV5CanonicalHash(project) {
  const source = JSON.stringify(canonicalStudioV5Project(project));
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}
