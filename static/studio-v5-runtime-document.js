import {
  migrateStudioPartToV5,
  parseOrMigrateStudioV5Project,
  prepareStudioV5Project,
} from './studio-project-v5.js';
import { evaluateStudioV5Expression, resolveStudioV5Datums, resolveStudioV5Transform, studioV5ParameterValues } from './studio-v5-modeling.js';
import { studioV5IdentityMatrix } from './studio-v5-assembly.js';

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
    throw new Error('This operation requires a schema-5 part document.');
  }
  const part = project.partDefinitions.find((entry) => entry.id === project.rootDocument.partId);
  if (!part) throw new Error('The active schema-5 part definition is missing.');
  return part;
}

export function studioV5RootAssembly(project) {
  if (!isStudioV5Project(project) || project.rootDocument?.kind !== 'assembly') {
    throw new Error('This operation requires a schema-5 assembly document.');
  }
  const assembly = project.assemblyDefinitions.find((entry) => entry.id === project.rootDocument.assemblyId);
  if (!assembly) throw new Error('The active schema-5 assembly definition is missing.');
  return assembly;
}

function defineAlias(project, name, descriptor) {
  Object.defineProperty(project, name, {
    configurable: true,
    enumerable: false,
    ...descriptor,
  });
}

export function decorateStudioV5Project(project) {
  const part = project.rootDocument?.kind === 'part'
    ? project.partDefinitions.find((entry) => entry.id === project.rootDocument.partId)
    : null;
  const assembly = project.rootDocument?.kind === 'assembly'
    ? project.assemblyDefinitions.find((entry) => entry.id === project.rootDocument.assemblyId)
    : null;
  if (!part && !assembly) throw new Error('The active schema-5 document definition is missing.');
  defineAlias(project, 'features', {
    get: () => part?.features || [],
    set: (features) => {
      if (!part) throw new Error('Assembly documents do not have a part feature history.');
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
      (part || assembly).name = title;
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
  if (part.metadata.rollbackFeatureId && !features.some((feature) => feature.id === part.metadata.rollbackFeatureId)) {
    part.metadata.rollbackFeatureId = null;
  }
  const activeBody = bodies.find((body) => body.id === part.metadata.activeBodyId);
  if (!activeBody || activeBody.suppressed) {
    part.metadata.activeBodyId = bodies.find((body) => !body.suppressed)?.id || null;
  }
  return part;
}

export function prepareStudioV5RuntimeProject(candidate) {
  const detached = clone(candidate);
  for (const part of detached.partDefinitions || []) reconcileStudioV5Bodies(part);
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

export function createStudioV5BooleanSplit(project, options) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const source = part.bodies.find((body) => body.id === options.targetBodyId);
  const tool = part.bodies.find((body) => body.id === options.toolBodyId);
  if (!source || !tool || source.id === tool.id) throw new Error('Choose different existing target and splitting-tool bodies.');
  const operationId = options.id;
  const sides = [
    { side: 'outside', suffix: 'outside', name: options.outsideName || source.name + ' outside split' },
    { side: 'inside', suffix: 'inside', name: options.insideName || source.name + ' inside split' },
  ];
  for (const entry of sides) requireUniquePartId(part, operationId + '-' + entry.suffix, 'Boolean Split feature');
  for (const entry of sides) {
    part.features.push({
      id: operationId + '-' + entry.suffix,
      name: String((options.name || 'Split ' + source.name) + ' · ' + entry.suffix).trim(),
      type: 'boolean-split-side', operationId, side: entry.side,
      sourceBodyId: source.id, toolBodyIds: [source.id, tool.id], keepTools: options.keepTools !== false,
      suppressed: false,
      inputRefs: [bodyInputReference(source.id, 'target'), bodyInputReference(tool.id, 'tool')],
      resultPolicy: { kind: 'new-body', bodyName: entry.name },
    });
  }
  source.visible = options.keepOriginal === true;
  if (options.keepTools === false) tool.visible = false;
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

function requireUniquePartId(part, id, label) {
  const used = new Set([
    ...part.referenceGeometry.map((entry) => entry.id),
    ...part.sketches.map((entry) => entry.id),
    ...part.features.map((entry) => entry.id),
    ...part.bodies.map((entry) => entry.id),
    ...(part.bodyPatterns || []).map((entry) => entry.id),
  ]);
  if (used.has(id)) throw new Error(label + ' ID "' + id + '" is already in use.');
}

export function createStudioV5Datum(project, input) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  requireUniquePartId(part, input.id, 'Datum');
  const datum = {
    id: input.id,
    name: String(input.name || '').trim(),
    kind: input.kind,
    suppressed: false,
    definition: clone(input.definition || {}),
    ...(input.extensions ? { extensions: clone(input.extensions) } : {}),
  };
  if (!datum.name) throw new Error('Datum name is required.');
  part.referenceGeometry.push(datum);
  const prepared = prepareStudioV5Project(candidate);
  const resolution = resolveStudioV5Datums(prepared, part.id);
  if (resolution.errors.has(datum.id)) throw resolution.errors.get(datum.id);
  return decorateStudioV5Project(prepared);
}

export function updateStudioV5Datum(project, datumId, patch, options = {}) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const datum = part.referenceGeometry.find((entry) => entry.id === datumId);
  if (!datum) throw new Error('That datum no longer exists.');
  if (patch.name != null) {
    const name = String(patch.name).trim();
    if (!name || name.length > 200) throw new Error('Datum names must contain 1 to 200 characters.');
    datum.name = name;
  }
  if (patch.definition != null) datum.definition = clone(patch.definition);
  if (patch.suppressed != null) datum.suppressed = Boolean(patch.suppressed);
  const prepared = prepareStudioV5Project(candidate);
  if (options.allowBroken !== true && !datum.suppressed) {
    const resolution = resolveStudioV5Datums(prepared, part.id);
    if (resolution.errors.size) throw resolution.errors.get(datum.id) || resolution.errors.values().next().value;
  }
  return decorateStudioV5Project(prepared);
}

export function deleteStudioV5Datum(project, datumId) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  if (!part.referenceGeometry.some((entry) => entry.id === datumId)) throw new Error('That datum no longer exists.');
  const usedBy = part.features.filter((feature) =>
    feature.inputRefs.some((reference) => reference.ownerKind === 'datum' && reference.ownerId === datumId) ||
    Object.values(feature.transform || {}).includes(datumId),
  );
  const sketchUsers = part.sketches.filter((sketch) => sketch.support?.ownerKind === 'datum' && sketch.support.ownerId === datumId);
  const datumUsers = part.referenceGeometry.filter((datum) => datum.id !== datumId && Object.values(datum.definition || {}).some((value) => value === datumId || (Array.isArray(value) && value.includes(datumId))));
  const patternUsers = (part.bodyPatterns || []).filter((pattern) => pattern.references?.some((reference) => reference.ownerKind === 'datum' && reference.ownerId === datumId));
  if (usedBy.length || sketchUsers.length || datumUsers.length || patternUsers.length) {
    throw new Error('Datum is used by ' + [...usedBy.map((entry) => entry.name), ...sketchUsers.map((entry) => entry.name), ...datumUsers.map((entry) => entry.name), ...patternUsers.map((entry) => entry.name)].join(', ') + '. Repair or delete those dependents first.');
  }
  part.referenceGeometry = part.referenceGeometry.filter((entry) => entry.id !== datumId);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

function advancedSketchEntity(input, role) {
  const dimensions = role === 'profile' ? 2 : 3;
  const minimum = role === 'profile' ? 3 : 2;
  const points = clone(input.points || []);
  if (!Array.isArray(points) || points.length < minimum) throw new Error((role === 'profile' ? 'Profiles' : 'Paths') + ' require at least ' + minimum + ' points.');
  if (points.some((point) => !Array.isArray(point) || point.length !== dimensions)) {
    throw new Error((role === 'profile' ? 'Profile' : 'Path') + ' points must contain ' + dimensions + ' coordinates.');
  }
  const kind = input.kind || 'spline';
  if (kind !== 'spline' && kind !== 'polyline') throw new Error('Sketch curve kind must be spline or polyline.');
  return { id: input.entityId || 'entity-' + input.id, kind, points, closed: role === 'profile' };
}

function validateAdvancedSketch(project, part, sketch) {
  const role = sketch.extensions?.studioRole;
  if (role !== 'profile' && role !== 'path') throw new Error('Advanced sketches must declare a profile or path role.');
  const entity = sketch.entities[0];
  const parameters = studioV5ParameterValues(project, part);
  const points = entity.points.map((point) => point.map((value) => evaluateStudioV5Expression(value, parameters)));
  for (let index = 1; index < points.length; index++) {
    if (Math.hypot(...points[index].map((value, axis) => value - points[index - 1][axis])) <= 1e-8) throw new Error('Sketch contains consecutive duplicate points.');
  }
  if (role === 'profile') {
    if (sketch.support?.ownerKind !== 'datum') throw new Error('A profile must be supported by a datum plane.');
    const frame = resolveStudioV5Datums(project, part.id).resolve(sketch.support.ownerId);
    if (frame.kind !== 'plane') throw new Error('A profile support must resolve to a datum plane.');
    const area = Math.abs(points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2);
    if (area <= 1e-8) throw new Error('Profile has zero enclosed area.');
  }
  return points;
}

function createStudioV5AdvancedSketch(project, input, role) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  requireUniquePartId(part, input.id, role === 'profile' ? 'Profile sketch' : 'Path sketch');
  const entity = advancedSketchEntity(input, role);
  const sketch = {
    id: input.id,
    name: String(input.name || '').trim(),
    ...(role === 'profile' ? { support: { ownerKind: 'datum', ownerId: input.planeDatumId, semanticPath: { role: 'support' }, signature: { kind: 'plane' } } } : {}),
    entities: [entity],
    groups: [],
    constraints: [],
    extensions: { ...(input.extensions || {}), studioRole: role },
  };
  if (!sketch.name) throw new Error('Sketch name is required.');
  part.sketches.push(sketch);
  const prepared = prepareStudioV5Project(candidate);
  validateAdvancedSketch(prepared, studioV5RootPart(prepared), sketch);
  return decorateStudioV5Project(prepared);
}

export function createStudioV5ProfileSketch(project, input) {
  return createStudioV5AdvancedSketch(project, input, 'profile');
}

export function createStudioV5PathSketch(project, input) {
  return createStudioV5AdvancedSketch(project, input, 'path');
}

export function updateStudioV5AdvancedSketch(project, sketchId, patch) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const sketch = part.sketches.find((entry) => entry.id === sketchId);
  const role = sketch?.extensions?.studioRole;
  if (!sketch || (role !== 'profile' && role !== 'path')) throw new Error('That profile or path sketch no longer exists.');
  if (patch.name != null) sketch.name = String(patch.name).trim();
  if (!sketch.name) throw new Error('Sketch name is required.');
  if (patch.points != null || patch.kind != null) {
    sketch.entities = [advancedSketchEntity({ id: sketch.id, entityId: sketch.entities[0]?.id, points: patch.points ?? sketch.entities[0].points, kind: patch.kind ?? sketch.entities[0].kind }, role)];
  }
  if (role === 'profile' && patch.planeDatumId != null) sketch.support.ownerId = patch.planeDatumId;
  const prepared = prepareStudioV5Project(candidate);
  validateAdvancedSketch(prepared, studioV5RootPart(prepared), sketch);
  return decorateStudioV5Project(prepared);
}

export function deleteStudioV5AdvancedSketch(project, sketchId) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const sketch = part.sketches.find((entry) => entry.id === sketchId);
  if (!sketch) throw new Error('That sketch no longer exists.');
  const users = part.features.filter((feature) => feature.inputRefs.some((reference) => reference.ownerKind === 'sketch' && reference.ownerId === sketchId));
  const patternUsers = (part.bodyPatterns || []).filter((pattern) => pattern.references?.some((reference) => reference.ownerKind === 'sketch' && reference.ownerId === sketchId));
  if (users.length || patternUsers.length) throw new Error('Sketch is used by ' + [...users, ...patternUsers].map((entry) => entry.name).join(', ') + '. Repair or delete those dependents first.');
  part.sketches = part.sketches.filter((entry) => entry.id !== sketchId);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

function advancedFeaturePolicy(part, options) {
  if (!options.targetBodyId) return { kind: 'new-body', bodyName: options.bodyName || options.name || 'Advanced body' };
  if (!part.bodies.some((body) => body.id === options.targetBodyId)) throw new Error('Choose an existing target body.');
  const kind = options.operation || 'add';
  if (!['add', 'subtract', 'intersect'].includes(kind)) throw new Error('Advanced feature result policy is unsupported.');
  return { kind, targetBodyIds: [options.targetBodyId] };
}

function sketchReference(sketchId, role, index) {
  return { ownerKind: 'sketch', ownerId: sketchId, semanticPath: { role, ...(index == null ? {} : { index }) }, signature: { role } };
}

function requireAdvancedSketch(part, sketchId, role) {
  const sketch = part.sketches.find((entry) => entry.id === sketchId);
  if (!sketch || sketch.extensions?.studioRole !== role) throw new Error('Choose an existing ' + role + ' sketch.');
  return sketch;
}

function buildStudioV5LoftFeature(project, part, options, updatingId = null) {
  if (options.id !== updatingId) requireUniquePartId(part, options.id, 'Loft feature');
  if (options.closed === true) throw new Error('Closed periodic Loft is not available in this kernel increment.');
  if (options.mapping != null && options.mapping !== 'explicit') throw new Error('This kernel increment requires explicit Loft section mapping.');
  const sections = (options.sections || []).map((section, index) => {
    const sketchId = typeof section === 'string' ? section : section.sketchId;
    const sketch = requireAdvancedSketch(part, sketchId, 'profile');
    const pointCount = sketch.entities[0].points.length;
    const startIndex = Number(typeof section === 'string' ? 0 : section.startIndex || 0);
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= pointCount) throw new Error('Loft section start index is out of range.');
    return { sketchId, startIndex, reversed: typeof section === 'string' ? false : section.reversed === true, index };
  });
  if (sections.length < 2 || new Set(sections.map((entry) => entry.sketchId)).size !== sections.length) throw new Error('Loft requires two or more distinct ordered profiles.');
  const guideSketchIds = [...new Set(options.guideSketchIds || [])];
  guideSketchIds.forEach((id) => requireAdvancedSketch(part, id, 'path'));
  if (guideSketchIds.length > 1) throw new Error('This kernel increment supports one explicit Loft guide curve.');
  if (options.centerlineSketchId) requireAdvancedSketch(part, options.centerlineSketchId, 'path');
  const continuity = { start: options.continuity?.start || 'free', end: options.continuity?.end || 'free' };
  if (![continuity.start, continuity.end].every((value) => ['free', 'tangent', 'curvature'].includes(value))) throw new Error('Loft continuity must be free, tangent, or curvature.');
  const feature = {
    id: options.id,
    name: String(options.name || 'Loft').trim(),
    type: 'loft',
    suppressed: false,
    sections: sections.map(({ index: _index, ...entry }) => entry),
    guideSketchIds,
    ...(options.centerlineSketchId ? { centerlineSketchId: options.centerlineSketchId } : {}),
    mapping: options.mapping || 'explicit',
    continuity,
    ruled: options.ruled === true,
    closed: options.closed === true,
    inputRefs: [
      ...sections.map((section) => sketchReference(section.sketchId, 'section', section.index)),
      ...guideSketchIds.map((id, index) => sketchReference(id, 'guide', index)),
      ...(options.centerlineSketchId ? [sketchReference(options.centerlineSketchId, 'centerline')] : []),
    ],
    resultPolicy: advancedFeaturePolicy(part, options),
  };
  if (!feature.name) throw new Error('Loft name is required.');
  return feature;
}

export function createStudioV5LoftFeature(project, options) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const feature = buildStudioV5LoftFeature(candidate, part, options);
  part.features.push(feature);
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

function buildStudioV5SweepFeature(project, part, options, updatingId = null) {
  if (options.id !== updatingId) requireUniquePartId(part, options.id, 'Sweep feature');
  requireAdvancedSketch(part, options.profileSketchId, 'profile');
  requireAdvancedSketch(part, options.pathSketchId, 'path');
  if (options.guideSketchId) requireAdvancedSketch(part, options.guideSketchId, 'path');
  const orientation = options.orientation || 'minimum-twist';
  if (!['path-normal', 'minimum-twist', 'fixed', 'reference', 'guide', 'controlled-twist'].includes(orientation)) throw new Error('Sweep orientation mode is unsupported.');
  if (orientation === 'guide' && !options.guideSketchId) throw new Error('Guide orientation requires a guide path.');
  const parameters = studioV5ParameterValues(project, part);
  const twistAngle = evaluateStudioV5Expression(options.twistAngle ?? 0, parameters);
  const scaleEnd = evaluateStudioV5Expression(options.scaleEnd ?? 1, parameters);
  const referenceDirection = clone(options.referenceDirection || [0, 0, 1]);
  if (!Array.isArray(referenceDirection) || referenceDirection.length !== 3) throw new Error('Sweep reference direction requires three coordinates.');
  const evaluatedDirection = referenceDirection.map((value) => evaluateStudioV5Expression(value, parameters));
  if ((orientation === 'fixed' || orientation === 'reference') && Math.hypot(...evaluatedDirection) <= 1e-8) throw new Error('Sweep reference direction must be nonzero.');
  if (!(scaleEnd > 0)) throw new Error('Sweep end scale must be greater than zero.');
  const transition = options.transition || 'right';
  if (!['transformed', 'round', 'right'].includes(transition)) throw new Error('Sweep transition mode is unsupported.');
  const feature = {
    id: options.id,
    name: String(options.name || 'Sweep').trim(),
    type: 'sweep',
    suppressed: false,
    profileSketchId: options.profileSketchId,
    pathSketchId: options.pathSketchId,
    ...(options.guideSketchId ? { guideSketchId: options.guideSketchId } : {}),
    orientation,
    referenceDirection,
    twistAngle: options.twistAngle ?? twistAngle,
    scaleEnd: options.scaleEnd ?? scaleEnd,
    transition,
    inputRefs: [
      sketchReference(options.profileSketchId, 'profile'),
      sketchReference(options.pathSketchId, 'path'),
      ...(options.guideSketchId ? [sketchReference(options.guideSketchId, 'guide')] : []),
    ],
    resultPolicy: advancedFeaturePolicy(part, options),
  };
  if (!feature.name) throw new Error('Sweep name is required.');
  return feature;
}

export function createStudioV5SweepFeature(project, options) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const feature = buildStudioV5SweepFeature(candidate, part, options);
  part.features.push(feature);
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function updateStudioV5AdvancedFeature(project, featureId, patch) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const feature = part.features.find((entry) => entry.id === featureId && (
    entry.type === 'loft' || entry.type === 'sweep' || entry.type === 'revolve' || entry.type === 'draft' ||
    entry.type === 'thicken' || (entry.type === 'fillet' && Array.isArray(entry.variableRadii))
  ));
  if (!feature) throw new Error('That advanced shape feature no longer exists.');
  const body = part.bodies.find((entry) => entry.createdByFeatureId === feature.id);
  const featureIndex = part.features.indexOf(feature);
  const targetBodyId = feature.resultPolicy.kind === 'new-body' ? null : feature.resultPolicy.targetBodyIds[0];
  const shared = {
    id: feature.id,
    name: patch.name ?? feature.name,
    bodyName: body?.name || feature.resultPolicy.bodyName,
    ...(targetBodyId ? { targetBodyId, operation: feature.resultPolicy.kind } : {}),
  };
  if (feature.type === 'loft') {
    part.features[featureIndex] = buildStudioV5LoftFeature(candidate, part, {
      ...shared,
      sections: patch.sections ?? feature.sections,
      guideSketchIds: patch.guideSketchIds ?? feature.guideSketchIds,
      centerlineSketchId: patch.centerlineSketchId !== undefined ? patch.centerlineSketchId : feature.centerlineSketchId,
      continuity: patch.continuity ?? feature.continuity,
      ruled: patch.ruled ?? feature.ruled,
      closed: patch.closed ?? feature.closed,
      mapping: patch.mapping ?? feature.mapping,
    }, feature.id);
  } else if (feature.type === 'sweep') {
    part.features[featureIndex] = buildStudioV5SweepFeature(candidate, part, {
      ...shared,
      profileSketchId: patch.profileSketchId ?? feature.profileSketchId,
      pathSketchId: patch.pathSketchId ?? feature.pathSketchId,
      guideSketchId: patch.guideSketchId !== undefined ? patch.guideSketchId : feature.guideSketchId,
      orientation: patch.orientation ?? feature.orientation,
      referenceDirection: patch.referenceDirection ?? feature.referenceDirection,
      twistAngle: patch.twistAngle ?? feature.twistAngle,
      scaleEnd: patch.scaleEnd ?? feature.scaleEnd,
      transition: patch.transition ?? feature.transition,
    }, feature.id);
  } else if (feature.type === 'revolve') {
    part.features[featureIndex] = buildStudioV5RevolveFeature(candidate, part, {
      ...shared,
      profileSketchId: patch.profileSketchId ?? feature.profileSketchId,
      axisDatumId: patch.axisDatumId ?? feature.axisDatumId,
      angle: patch.angle ?? feature.angle,
      startAngle: patch.startAngle ?? feature.startAngle,
      symmetric: patch.symmetric ?? feature.symmetric,
    }, feature.id);
  } else if (feature.type === 'draft') {
    part.features[featureIndex] = buildStudioV5DraftFeature(candidate, part, {
      id: feature.id,
      name: patch.name ?? feature.name,
      bodyId: patch.bodyId ?? targetBodyId,
      faces: patch.faces ?? feature.faces,
      neutralPlaneDatumId: patch.neutralPlaneDatumId ?? feature.neutralPlaneDatumId,
      angle: patch.angle ?? feature.angle,
      flip: patch.flip ?? feature.flip,
      tangentPropagation: patch.tangentPropagation ?? feature.tangentPropagation,
    }, feature.id);
  } else if (feature.type === 'thicken') {
    part.features[featureIndex] = buildStudioV5ThickenFeature(candidate, part, {
      id: feature.id,
      name: patch.name ?? feature.name,
      bodyId: patch.bodyId ?? feature.sourceBodyId,
      bodyName: body?.name || feature.resultPolicy.bodyName,
      faces: patch.faces ?? feature.faces,
      thickness: patch.thickness ?? feature.thickness,
      symmetric: patch.symmetric ?? feature.symmetric,
      flip: patch.flip ?? feature.flip,
    }, feature.id);
  } else {
    part.features[featureIndex] = buildStudioV5VariableFilletFeature(candidate, part, {
      id: feature.id,
      name: patch.name ?? feature.name,
      bodyId: patch.bodyId ?? targetBodyId,
      edges: patch.edges ?? feature.edges,
      radii: patch.radii,
      startRadius: patch.startRadius ?? feature.variableRadii[0]?.startRadius,
      endRadius: patch.endRadius ?? feature.variableRadii[0]?.endRadius,
      tangentPropagation: patch.tangentPropagation ?? feature.tangentPropagation,
    }, feature.id);
  }
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

const bodyInputReference = (bodyId, role = 'source') => ({
  ownerKind: 'body', ownerId: bodyId, semanticPath: { role }, signature: { role },
});
const datumInputReference = (datumId, role) => ({
  ownerKind: 'datum', ownerId: datumId, semanticPath: { role }, signature: { role },
});

function buildStudioV5RevolveFeature(candidate, part, options, updatingId = null) {
  if (options.id !== updatingId) requireUniquePartId(part, options.id, 'Revolve feature');
  requireAdvancedSketch(part, options.profileSketchId, 'profile');
  const axis = resolveStudioV5Datums(candidate, part.id).resolve(options.axisDatumId);
  if (axis.kind !== 'axis') throw new Error('Revolve requires an axis datum.');
  const parameters = studioV5ParameterValues(candidate, part);
  const angle = evaluateStudioV5Expression(options.angle ?? 360, parameters);
  const startAngle = evaluateStudioV5Expression(options.startAngle ?? (options.symmetric ? -angle / 2 : 0), parameters);
  if (!(angle > 0 && angle <= 360) || !Number.isFinite(startAngle)) throw new Error('Revolve angle must evaluate above zero and at most 360 degrees.');
  const feature = {
    id: options.id,
    name: String(options.name || 'Revolve').trim(),
    type: 'revolve',
    profileSketchId: options.profileSketchId,
    axisDatumId: options.axisDatumId,
    angle: options.angle ?? angle,
    startAngle: options.startAngle ?? (options.symmetric ? -angle / 2 : 0),
    symmetric: options.symmetric === true,
    suppressed: false,
    inputRefs: [sketchReference(options.profileSketchId, 'profile'), datumInputReference(options.axisDatumId, 'axis')],
    resultPolicy: advancedFeaturePolicy(part, options),
  };
  if (!feature.name) throw new Error('Revolve name is required.');
  return feature;
}

export function createStudioV5RevolveFeature(project, options) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const feature = buildStudioV5RevolveFeature(candidate, part, options);
  part.features.push(feature);
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

function buildStudioV5DraftFeature(candidate, part, options, updatingId = null) {
  if (options.id !== updatingId) requireUniquePartId(part, options.id, 'Draft feature');
  const target = part.bodies.find((body) => body.id === options.bodyId);
  if (!target) throw new Error('Choose a body to draft.');
  const plane = resolveStudioV5Datums(candidate, part.id).resolve(options.neutralPlaneDatumId);
  if (plane.kind !== 'plane') throw new Error('Draft requires a neutral plane datum.');
  const parameters = studioV5ParameterValues(candidate, part);
  const angle = evaluateStudioV5Expression(options.angle, parameters);
  if (!(Math.abs(angle) > 1e-6 && Math.abs(angle) < 89)) throw new Error('Draft angle must be non-zero and below 89 degrees.');
  if (!Array.isArray(options.faces) || !options.faces.length) throw new Error('Draft requires at least one selected face.');
  const feature = {
    id: options.id,
    name: String(options.name || 'Draft ' + target.name).trim(),
    type: 'draft',
    faces: clone(options.faces),
    neutralPlaneDatumId: options.neutralPlaneDatumId,
    angle: options.angle,
    flip: options.flip === true,
    tangentPropagation: options.tangentPropagation !== false,
    suppressed: false,
    inputRefs: [bodyInputReference(target.id, 'target'), datumInputReference(options.neutralPlaneDatumId, 'neutral-plane')],
    resultPolicy: { kind: 'add', targetBodyIds: [target.id] },
  };
  if (!feature.name) throw new Error('Draft name is required.');
  return feature;
}

export function createStudioV5DraftFeature(project, options) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  part.features.push(buildStudioV5DraftFeature(candidate, part, options));
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

function buildStudioV5ThickenFeature(candidate, part, options, updatingId = null) {
  if (options.id !== updatingId) requireUniquePartId(part, options.id, 'Thicken feature');
  const source = part.bodies.find((body) => body.id === options.bodyId);
  if (!source) throw new Error('Choose a body face to thicken.');
  const parameters = studioV5ParameterValues(candidate, part);
  if (!(evaluateStudioV5Expression(options.thickness, parameters) > 0)) throw new Error('Thicken distance must evaluate above zero.');
  if (!Array.isArray(options.faces) || options.faces.length !== 1) throw new Error('This Thicken increment requires exactly one selected planar face.');
  const feature = {
    id: options.id,
    name: String(options.name || 'Thicken ' + source.name).trim(),
    type: 'thicken',
    sourceBodyId: source.id,
    toolBodyIds: [source.id],
    linked: true,
    faces: clone(options.faces),
    thickness: options.thickness,
    symmetric: options.symmetric === true,
    flip: options.flip === true,
    suppressed: false,
    inputRefs: [bodyInputReference(source.id)],
    resultPolicy: { kind: 'new-body', bodyName: options.bodyName || source.name + ' thickened face' },
  };
  if (!feature.name) throw new Error('Thicken name is required.');
  return feature;
}

export function createStudioV5ThickenFeature(project, options) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  part.features.push(buildStudioV5ThickenFeature(candidate, part, options));
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

function buildStudioV5VariableFilletFeature(candidate, part, options, updatingId = null) {
  if (options.id !== updatingId) requireUniquePartId(part, options.id, 'Variable Fillet feature');
  const target = part.bodies.find((body) => body.id === options.bodyId);
  if (!target) throw new Error('Choose a body to fillet.');
  const parameters = studioV5ParameterValues(candidate, part);
  if (!Array.isArray(options.edges) || !options.edges.length) throw new Error('Variable Fillet requires one or more selected edges.');
  const variableRadii = options.edges.map((edge, index) => {
    const startRadius = options.radii?.[index]?.startRadius ?? options.startRadius;
    const endRadius = options.radii?.[index]?.endRadius ?? options.endRadius;
    if (!(evaluateStudioV5Expression(startRadius, parameters) > 0) || !(evaluateStudioV5Expression(endRadius, parameters) > 0)) {
      throw new Error('Variable Fillet radii must evaluate above zero.');
    }
    return { edge: clone(edge), startRadius, endRadius };
  });
  const feature = {
    id: options.id,
    name: String(options.name || 'Variable Fillet ' + target.name).trim(),
    type: 'fillet',
    r: variableRadii[0].startRadius,
    edges: options.edges.map(clone),
    variableRadii,
    tangentPropagation: options.tangentPropagation === true,
    suppressed: false,
    inputRefs: [bodyInputReference(target.id, 'target')],
    resultPolicy: { kind: 'add', targetBodyIds: [target.id] },
  };
  if (!feature.name) throw new Error('Variable Fillet name is required.');
  return feature;
}

export function createStudioV5VariableFilletFeature(project, options) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  part.features.push(buildStudioV5VariableFilletFeature(candidate, part, options));
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export const studioV5PatternInstanceId = (patternId, index) => patternId + '-instance-' + index;

function patternReference(ownerKind, ownerId, role) {
  return { ownerKind, ownerId, semanticPath: { role }, signature: { role } };
}

function expressionNumber(value, parameters, label) {
  const evaluated = evaluateStudioV5Expression(value, parameters);
  if (!Number.isFinite(evaluated)) throw new Error(label + ' must evaluate to a finite number.');
  return evaluated;
}

function buildStudioV5BodyPattern(project, part, input, updatingId = null) {
  if (input.id !== updatingId) requireUniquePartId(part, input.id, 'Pattern');
  const source = part.bodies.find((body) => body.id === input.sourceBodyId);
  if (!source) throw new Error('Choose an existing source body.');
  const parameters = studioV5ParameterValues(project, part);
  const kind = input.kind;
  if (!['linear', 'circular', 'curve', 'mirror'].includes(kind)) throw new Error('Pattern type is unsupported.');
  const countExpression = kind === 'mirror' ? 2 : (input.count ?? 2);
  const count = expressionNumber(countExpression, parameters, 'Pattern count');
  if (!Number.isInteger(count) || count < 2 || count > 5000) throw new Error('Pattern count must evaluate to an integer from 2 to 5,000.');
  const skippedIndices = [...new Set((input.skippedIndices || []).map(Number))].sort((a, b) => a - b);
  let occurrenceCount = count;
  const references = [];
  const definition = {
    count: countExpression,
    distribution: input.distribution || (kind === 'circular' ? 'full' : 'spacing'),
    symmetric: input.symmetric === true,
    orientation: input.orientation || (kind === 'circular' ? 'rotate' : kind === 'curve' ? 'tangent' : 'preserve'),
  };
  if (kind === 'linear') {
    const directionDatumIds = [...new Set(input.directionDatumIds || (input.directionDatumId ? [input.directionDatumId] : []))];
    if (directionDatumIds.length < 1 || directionDatumIds.length > 2) throw new Error('Linear pattern requires one or two direction datums.');
    for (const [index, datumId] of directionDatumIds.entries()) {
      const frame = resolveStudioV5Datums(project, part.id).resolve(datumId);
      if (frame.kind !== 'axis' && frame.kind !== 'coordinate-system') throw new Error('Linear pattern directions must resolve to axes or coordinate systems.');
      references.push(patternReference('datum', datumId, index === 0 ? 'direction' : 'direction-2'));
    }
    definition.spacing = input.spacing ?? 10;
    definition.extent = input.extent ?? expressionNumber(definition.spacing, parameters, 'Pattern spacing') * (count - 1);
    definition.positions = clone(input.positions || []);
    definition.alternating = input.alternating === true || definition.orientation === 'alternating';
    if (definition.distribution === 'spacing' && Math.abs(expressionNumber(definition.spacing, parameters, 'Pattern spacing')) <= 1e-9) throw new Error('Linear pattern spacing must be nonzero.');
    if (definition.distribution === 'extent' && Math.abs(expressionNumber(definition.extent, parameters, 'Pattern extent')) <= 1e-9) throw new Error('Linear pattern extent must be nonzero.');
    if (definition.distribution === 'table' && definition.positions.length !== count - 1) throw new Error('Linear table spacing requires one generated position per occurrence.');
    if (directionDatumIds.length === 2) {
      definition.count2 = input.count2 ?? 2;
      const count2 = expressionNumber(definition.count2, parameters, 'Second-direction pattern count');
      if (!Number.isInteger(count2) || count2 < 2 || count * count2 > 5000) throw new Error('Two-direction pattern counts must produce from 4 to 5,000 total occurrences.');
      occurrenceCount = count * count2;
      definition.distribution2 = input.distribution2 || 'spacing';
      definition.symmetric2 = input.symmetric2 === true;
      definition.spacing2 = input.spacing2 ?? 10;
      definition.extent2 = input.extent2 ?? expressionNumber(definition.spacing2, parameters, 'Second-direction pattern spacing') * (count2 - 1);
      definition.positions2 = clone(input.positions2 || []);
      definition.alternating2 = input.alternating2 === true;
      if (!['spacing', 'extent', 'table'].includes(definition.distribution2)) throw new Error('Second-direction linear pattern distribution is unsupported.');
      if (definition.distribution2 === 'spacing' && Math.abs(expressionNumber(definition.spacing2, parameters, 'Second-direction pattern spacing')) <= 1e-9) throw new Error('Second-direction pattern spacing must be nonzero.');
      if (definition.distribution2 === 'extent' && Math.abs(expressionNumber(definition.extent2, parameters, 'Second-direction pattern extent')) <= 1e-9) throw new Error('Second-direction pattern extent must be nonzero.');
      if (definition.distribution2 === 'table' && definition.positions2.length !== count2 - 1) throw new Error('Second-direction table spacing requires one generated position per occurrence.');
    }
  } else if (kind === 'circular') {
    const frame = resolveStudioV5Datums(project, part.id).resolve(input.axisDatumId);
    if (frame.kind !== 'axis' && frame.kind !== 'coordinate-system') throw new Error('Circular pattern axis must resolve to an axis or coordinate system.');
    references.push(patternReference('datum', input.axisDatumId, 'axis'));
    definition.totalAngle = input.totalAngle ?? 360;
    definition.spacingAngle = input.spacingAngle ?? expressionNumber(definition.totalAngle, parameters, 'Pattern angle') / count;
    definition.angles = clone(input.angles || []);
    definition.radialOffset = input.radialOffset ?? 0;
    definition.axialOffset = input.axialOffset ?? 0;
    if (!['full', 'extent', 'spacing', 'table'].includes(definition.distribution)) throw new Error('Circular pattern distribution is unsupported.');
    if (definition.distribution === 'spacing' && Math.abs(expressionNumber(definition.spacingAngle, parameters, 'Pattern spacing angle')) <= 1e-9) throw new Error('Circular pattern spacing angle must be nonzero.');
    if (definition.distribution === 'extent' && Math.abs(expressionNumber(definition.totalAngle, parameters, 'Pattern total angle')) <= 1e-9) throw new Error('Circular pattern total angle must be nonzero.');
    if (definition.distribution === 'table' && definition.angles.length !== count - 1) throw new Error('Circular table spacing requires one generated angle per occurrence.');
    if (!['rotate', 'preserve', 'alternating'].includes(definition.orientation)) throw new Error('Circular pattern orientation is unsupported.');
  } else if (kind === 'curve') {
    const sketch = part.sketches.find((entry) => entry.id === input.pathSketchId && entry.extensions?.studioRole === 'path');
    if (!sketch) throw new Error('Curve pattern requires an editable path sketch.');
    references.push(patternReference('sketch', input.pathSketchId, 'path'));
    definition.spacing = input.spacing ?? 10;
    definition.extent = input.extent ?? 1;
    definition.parameters = clone(input.parameters || []);
    if (!['equal', 'spacing', 'extent', 'table'].includes(definition.distribution)) definition.distribution = 'equal';
    if (definition.distribution === 'spacing' && expressionNumber(definition.spacing, parameters, 'Curve pattern spacing') <= 0) throw new Error('Curve pattern spacing must be positive.');
    if (definition.distribution === 'extent' && expressionNumber(definition.extent, parameters, 'Curve pattern extent') <= 0) throw new Error('Curve pattern extent must be positive.');
    if (definition.distribution === 'table' && definition.parameters.length !== count - 1) throw new Error('Curve table spacing requires one parameter per generated occurrence.');
    if (!['tangent', 'fixed'].includes(definition.orientation)) throw new Error('Curve pattern orientation is unsupported.');
  } else {
    const frame = resolveStudioV5Datums(project, part.id).resolve(input.planeDatumId);
    if (frame.kind !== 'plane') throw new Error('Mirror pattern requires a plane datum.');
    references.push(patternReference('datum', input.planeDatumId, 'plane'));
    definition.distribution = 'mirror';
    definition.orientation = 'mirror';
  }
  if (skippedIndices.some((index) => !Number.isInteger(index) || index < 1 || index >= occurrenceCount)) throw new Error('Skipped pattern indices must refer to generated occurrences 1 through ' + (occurrenceCount - 1) + '.');
  return {
    id: input.id,
    name: String(input.name || (kind[0].toUpperCase() + kind.slice(1) + ' pattern')).trim(),
    kind,
    sourceBodyId: source.id,
    references,
    definition,
    outputMode: input.outputMode === 'union' ? 'union' : 'linked',
    skippedIndices,
    suppressed: input.suppressed === true,
    visible: input.visible !== false,
  };
}

export function createStudioV5BodyPattern(project, input) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const pattern = buildStudioV5BodyPattern(candidate, part, input);
  if (!pattern.name) throw new Error('Pattern name is required.');
  part.bodyPatterns ||= [];
  part.bodyPatterns.push(pattern);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function updateStudioV5BodyPattern(project, patternId, patch) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const index = (part.bodyPatterns || []).findIndex((entry) => entry.id === patternId);
  if (index < 0) throw new Error('That body pattern no longer exists.');
  const previous = part.bodyPatterns[index];
  const byRole = Object.fromEntries((previous.references || []).map((reference) => [reference.semanticPath?.role, reference.ownerId]));
  const input = {
    id: previous.id,
    name: patch.name ?? previous.name,
    kind: patch.kind ?? previous.kind,
    sourceBodyId: patch.sourceBodyId ?? previous.sourceBodyId,
    count: patch.count ?? previous.definition.count,
    distribution: patch.distribution ?? previous.definition.distribution,
    symmetric: patch.symmetric ?? previous.definition.symmetric,
    orientation: patch.orientation ?? previous.definition.orientation,
    skippedIndices: patch.skippedIndices ?? previous.skippedIndices,
    suppressed: patch.suppressed ?? previous.suppressed,
    visible: patch.visible ?? previous.visible,
    directionDatumIds: patch.directionDatumIds ?? [byRole.direction, byRole['direction-2']].filter(Boolean),
    axisDatumId: patch.axisDatumId ?? byRole.axis,
    pathSketchId: patch.pathSketchId ?? byRole.path,
    planeDatumId: patch.planeDatumId ?? byRole.plane,
    spacing: patch.spacing ?? previous.definition.spacing,
    extent: patch.extent ?? previous.definition.extent,
    positions: patch.positions ?? previous.definition.positions,
    alternating: patch.alternating ?? previous.definition.alternating,
    count2: patch.count2 ?? previous.definition.count2,
    distribution2: patch.distribution2 ?? previous.definition.distribution2,
    symmetric2: patch.symmetric2 ?? previous.definition.symmetric2,
    spacing2: patch.spacing2 ?? previous.definition.spacing2,
    extent2: patch.extent2 ?? previous.definition.extent2,
    positions2: patch.positions2 ?? previous.definition.positions2,
    alternating2: patch.alternating2 ?? previous.definition.alternating2,
    totalAngle: patch.totalAngle ?? previous.definition.totalAngle,
    spacingAngle: patch.spacingAngle ?? previous.definition.spacingAngle,
    angles: patch.angles ?? previous.definition.angles,
    radialOffset: patch.radialOffset ?? previous.definition.radialOffset,
    axialOffset: patch.axialOffset ?? previous.definition.axialOffset,
    parameters: patch.parameters ?? previous.definition.parameters,
    outputMode: patch.outputMode ?? previous.outputMode,
  };
  part.bodyPatterns[index] = buildStudioV5BodyPattern(candidate, part, input, patternId);
  if (!part.bodyPatterns[index].name) throw new Error('Pattern name is required.');
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function deleteStudioV5BodyPattern(project, patternId) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  if (!(part.bodyPatterns || []).some((entry) => entry.id === patternId)) throw new Error('That body pattern no longer exists.');
  part.bodyPatterns = part.bodyPatterns.filter((entry) => entry.id !== patternId);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function materializeStudioV5PatternOccurrences(project, patternId, records, options = {}) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const pattern = (part.bodyPatterns || []).find((entry) => entry.id === patternId);
  if (!pattern) throw new Error('That body pattern no longer exists.');
  if (!Array.isArray(records) || !records.length) throw new Error('Pattern materialization requires at least one exact occurrence record.');
  const indices = new Set();
  for (const [index, record] of records.entries()) {
    if (record?.patternId !== pattern.id || record.sourceBodyId !== pattern.sourceBodyId) throw new Error('Materialized occurrence ' + (index + 1) + ' does not belong to this pattern.');
    if (!Number.isInteger(record.patternIndex) || record.patternIndex < 1) throw new Error('Materialized occurrence has an invalid stable index.');
    if (indices.has(record.patternIndex)) throw new Error('Materialized occurrence index ' + record.patternIndex + ' is duplicated.');
    indices.add(record.patternIndex);
    const resource = clone(record.resource);
    const feature = clone(record.feature);
    const body = clone(record.body);
    requireUniquePartId(part, feature.id, 'Materialized feature');
    requireUniquePartId(part, body.id, 'Materialized body');
    if (candidate.resources.some((entry) => entry.id === resource.id)) throw new Error('Materialized resource ID "' + resource.id + '" is already in use.');
    feature.createdBodyId = body.id;
    feature.resultPolicy = { kind: 'new-body', bodyName: body.name };
    feature.extensions = {
      ...(feature.extensions || {}),
      studioPatternMaterialization: { patternId: pattern.id, patternIndex: record.patternIndex, sourceBodyId: pattern.sourceBodyId, independent: true },
    };
    body.createdByFeatureId = feature.id;
    body.featureIds = [feature.id];
    body.extensions = {
      ...(body.extensions || {}),
      studioPatternMaterialization: { patternId: pattern.id, patternIndex: record.patternIndex, sourceBodyId: pattern.sourceBodyId, independent: true },
    };
    candidate.resources.push(resource);
    part.features.push(feature);
    part.bodies.push(body);
  }
  if (options.dissolve === true) part.bodyPatterns = part.bodyPatterns.filter((entry) => entry.id !== pattern.id);
  else pattern.skippedIndices = [...new Set([...(pattern.skippedIndices || []), ...indices])].sort((left, right) => left - right);
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

function studioV5ProjectIds(project) {
  const ids = new Set([project.projectId]);
  const visit = (value, key = '') => {
    if (key === 'id' && typeof value === 'string') ids.add(value);
    else if (Array.isArray(value)) value.forEach((entry) => visit(entry));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(project);
  return ids;
}

function requireUniqueProjectId(project, id, label) {
  if (studioV5ProjectIds(project).has(id)) throw new Error(label + ' ID "' + id + '" is already in use.');
}

export function createStudioV5AssemblyFromPart(project, input) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  requireUniqueProjectId(candidate, input.id, 'Assembly');
  requireUniqueProjectId(candidate, input.occurrenceId, 'Occurrence');
  const assembly = {
    id: input.id,
    name: String(input.name || part.name + ' assembly').trim(),
    parameters: [],
    occurrences: [{
      id: input.occurrenceId,
      name: String(input.occurrenceName || part.name).trim(),
      definition: { kind: 'part', partId: part.id },
      baseTransform: studioV5IdentityMatrix(),
      fixed: input.fixed !== false,
      suppressed: false,
      visible: true,
    }],
    mates: [],
    occurrencePatterns: [],
    explodedViews: [],
    sectionViews: [],
  };
  if (!assembly.name || !assembly.occurrences[0].name) throw new Error('Assembly and first occurrence names are required.');
  candidate.assemblyDefinitions.push(assembly);
  candidate.rootDocument = { kind: 'assembly', assemblyId: assembly.id };
  candidate.name = assembly.name;
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function createStudioV5ComponentOccurrence(project, input) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  requireUniqueProjectId(candidate, input.id, 'Occurrence');
  const definition = clone(input.definition);
  const source = definition?.kind === 'part'
    ? candidate.partDefinitions.find((entry) => entry.id === definition.partId)
    : candidate.assemblyDefinitions.find((entry) => entry.id === definition?.assemblyId);
  if (!source) throw new Error('Choose an existing part or subassembly definition.');
  if (definition.kind === 'assembly' && definition.assemblyId === assembly.id) throw new Error('An assembly cannot contain itself.');
  const matrix = input.baseTransform == null ? studioV5IdentityMatrix() : [...input.baseTransform];
  if (matrix.length !== 16 || !matrix.every(Number.isFinite)) throw new Error('Component transform must contain 16 finite numbers.');
  const occurrence = {
    id: input.id,
    name: String(input.name || source.name).trim(),
    definition,
    ...(input.parentOccurrenceId ? { parentOccurrenceId: input.parentOccurrenceId } : {}),
    baseTransform: matrix,
    fixed: input.fixed === true,
    suppressed: input.suppressed === true,
    visible: input.visible !== false,
    ...(input.parameterOverrides ? { parameterOverrides: clone(input.parameterOverrides) } : {}),
  };
  if (!occurrence.name) throw new Error('Component occurrence name is required.');
  assembly.occurrences.push(occurrence);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function updateStudioV5ComponentOccurrence(project, occurrenceId, patch) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  const occurrence = assembly.occurrences.find((entry) => entry.id === occurrenceId);
  if (!occurrence) throw new Error('That component occurrence no longer exists.');
  if (patch.name != null) {
    const name = String(patch.name).trim();
    if (!name) throw new Error('Component occurrence name is required.');
    occurrence.name = name;
  }
  for (const property of ['fixed', 'suppressed', 'visible']) if (patch[property] != null) occurrence[property] = patch[property] === true;
  if (patch.baseTransform != null) occurrence.baseTransform = [...patch.baseTransform];
  if (patch.parameterOverrides !== undefined) {
    if (patch.parameterOverrides == null) delete occurrence.parameterOverrides;
    else occurrence.parameterOverrides = clone(patch.parameterOverrides);
  }
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function duplicateStudioV5LinkedOccurrence(project, occurrenceId, input) {
  const assembly = studioV5RootAssembly(project);
  const source = assembly.occurrences.find((entry) => entry.id === occurrenceId);
  if (!source) throw new Error('That component occurrence no longer exists.');
  return createStudioV5ComponentOccurrence(project, {
    ...source,
    id: input.id,
    name: input.name || source.name + ' linked',
    baseTransform: input.baseTransform || source.baseTransform,
    fixed: input.fixed === true,
  });
}

function remapDefinitionIds(value, replacements, key = '') {
  if (typeof value === 'string') return replacements.get(value) || value;
  if (Array.isArray(value)) return value.map((entry) => remapDefinitionIds(entry, replacements, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, remapDefinitionIds(child, replacements, childKey)]));
}

export function makeStudioV5OccurrenceIndependent(project, occurrenceId, input) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  const occurrence = assembly.occurrences.find((entry) => entry.id === occurrenceId);
  if (!occurrence || occurrence.definition.kind !== 'part') throw new Error('Make independent currently requires a part occurrence.');
  const source = candidate.partDefinitions.find((entry) => entry.id === occurrence.definition.partId);
  if (!source) throw new Error('The source part definition is missing.');
  requireUniqueProjectId(candidate, input.partId, 'Independent part');
  const replacements = new Map();
  const collect = (value, key = '') => {
    if (key === 'id' && typeof value === 'string') replacements.set(value, input.partId + '-' + value);
    else if (Array.isArray(value)) value.forEach((entry) => collect(entry));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => collect(child, childKey));
  };
  collect(source);
  replacements.set(source.id, input.partId);
  const independent = remapDefinitionIds(source, replacements);
  independent.id = input.partId;
  independent.name = String(input.name || source.name + ' independent').trim();
  candidate.partDefinitions.push(independent);
  occurrence.definition = { kind: 'part', partId: independent.id };
  occurrence.name = input.occurrenceName || occurrence.name;
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function replaceStudioV5ComponentOccurrence(project, occurrenceId, definition) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  const occurrence = assembly.occurrences.find((entry) => entry.id === occurrenceId);
  if (!occurrence) throw new Error('That component occurrence no longer exists.');
  const previousDefinition = occurrence.definition.kind === 'part'
    ? candidate.partDefinitions.find((entry) => entry.id === occurrence.definition.partId)
    : candidate.assemblyDefinitions.find((entry) => entry.id === occurrence.definition.assemblyId);
  const replacement = definition?.kind === 'part'
    ? candidate.partDefinitions.find((entry) => entry.id === definition.partId)
    : candidate.assemblyDefinitions.find((entry) => entry.id === definition?.assemblyId);
  if (!replacement) throw new Error('Choose an existing replacement definition.');
  occurrence.definition = clone(definition);
  const replacementOwnerIds = new Set();
  const visit = (value, key = '') => {
    if (key === 'id' && typeof value === 'string') replacementOwnerIds.add(value);
    else if (Array.isArray(value)) value.forEach((entry) => visit(entry));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(replacement);
  const compatibleOwners = new Map();
  if (previousDefinition && occurrence.definition.kind === 'part') {
    const ownerCollections = [
      ['datum', previousDefinition.referenceGeometry || [], replacement.referenceGeometry || []],
      ['sketch', previousDefinition.sketches || [], replacement.sketches || []],
      ['body', previousDefinition.bodies || [], replacement.bodies || []],
    ];
    const semanticToken = (entry) => String(entry?.name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).at(-1) || '';
    for (const [ownerKind, previousOwners, nextOwners] of ownerCollections) for (const owner of previousOwners) {
      const matches = nextOwners.filter((entry) => ownerKind !== 'datum' || entry.kind === owner.kind);
      const semantic = matches.find((entry) => semanticToken(entry) === semanticToken(owner));
      const sameMode = matches.find((entry) => entry.definition?.mode === owner.definition?.mode);
      const resolved = semantic || sameMode || (matches.length === 1 ? matches[0] : null);
      if (resolved) compatibleOwners.set(ownerKind + ':' + owner.id, resolved.id);
    }
  }
  assembly.mates = assembly.mates.filter((mate) => {
    if (!mate.occurrenceIds.includes(occurrenceId)) return true;
    for (const reference of mate.references) {
      if (reference.ownerKind === 'occurrence' || !reference.occurrencePath?.includes(occurrenceId) || replacementOwnerIds.has(reference.ownerId)) continue;
      const repaired = compatibleOwners.get(reference.ownerKind + ':' + reference.ownerId);
      if (!repaired) return false;
      const previousOwnerId = reference.ownerId;
      reference.ownerId = repaired;
      reference.signature = { ...(reference.signature || {}), repairedFromOwnerId: previousOwnerId };
    }
    return true;
  });
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function deleteStudioV5ComponentOccurrence(project, occurrenceId) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  if (!assembly.occurrences.some((entry) => entry.id === occurrenceId)) throw new Error('That component occurrence no longer exists.');
  const removed = new Set([occurrenceId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const occurrence of assembly.occurrences) if (removed.has(occurrence.parentOccurrenceId) && !removed.has(occurrence.id)) {
      removed.add(occurrence.id); changed = true;
    }
  }
  assembly.occurrences = assembly.occurrences.filter((entry) => !removed.has(entry.id));
  assembly.mates = assembly.mates.filter((mate) => !mate.occurrenceIds.some((id) => removed.has(id)));
  assembly.occurrencePatterns = assembly.occurrencePatterns.filter((pattern) => !pattern.sourceOccurrenceIds.some((id) => removed.has(id)));
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

function buildStudioV5Mate(assembly, input) {
  const kind = input.kind;
  const occurrenceIds = [...new Set(input.occurrenceIds || [])];
  if (kind === 'fixed') {
    if (occurrenceIds.length !== 1) throw new Error('Fixed mate requires one occurrence.');
  } else if (occurrenceIds.length !== 2) throw new Error(kind + ' mate requires two different occurrences.');
  if (occurrenceIds.some((id) => !assembly.occurrences.some((entry) => entry.id === id))) throw new Error('Mate occurrence selection no longer resolves.');
  const references = clone(input.references || []);
  if (kind !== 'fixed' && references.length !== 2) throw new Error(kind + ' mate requires two explicit references.');
  return {
    id: input.id,
    name: String(input.name || kind[0].toUpperCase() + kind.slice(1) + ' mate').trim(),
    kind,
    occurrenceIds,
    references,
    ...(input.value != null ? { value: input.value } : {}),
    suppressed: input.suppressed === true,
    ...(input.extensions ? { extensions: clone(input.extensions) } : {}),
  };
}

export function createStudioV5AssemblyMate(project, input) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  requireUniqueProjectId(candidate, input.id, 'Mate');
  const mate = buildStudioV5Mate(assembly, input);
  if (!mate.name) throw new Error('Mate name is required.');
  assembly.mates.push(mate);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function updateStudioV5AssemblyMate(project, mateId, patch) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  const index = assembly.mates.findIndex((entry) => entry.id === mateId);
  if (index < 0) throw new Error('That mate no longer exists.');
  const previous = assembly.mates[index];
  assembly.mates[index] = buildStudioV5Mate(assembly, { ...previous, ...patch, id: previous.id });
  if (!assembly.mates[index].name) throw new Error('Mate name is required.');
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function deleteStudioV5AssemblyMate(project, mateId) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  if (!assembly.mates.some((entry) => entry.id === mateId)) throw new Error('That mate no longer exists.');
  assembly.mates = assembly.mates.filter((entry) => entry.id !== mateId);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function createStudioV5OccurrencePattern(project, input) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  requireUniqueProjectId(candidate, input.id, 'Occurrence pattern');
  const sources = [...new Set(input.sourceOccurrenceIds || [])];
  if (!sources.length || sources.some((id) => !assembly.occurrences.some((entry) => entry.id === id))) throw new Error('Choose existing source component occurrences.');
  const generatedCount = Number(input.generatedCount);
  if (!Number.isInteger(generatedCount) || generatedCount < 1 || generatedCount > 5000) throw new Error('Generated occurrence count must be an integer from 1 to 5,000.');
  assembly.occurrencePatterns.push({
    id: input.id,
    name: String(input.name || 'Component pattern').trim(),
    kind: input.kind || 'circular',
    sourceOccurrenceIds: sources,
    generatedCount,
    definition: clone(input.definition || {}),
    suppressed: input.suppressed === true,
  });
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function updateStudioV5OccurrencePattern(project, patternId, patch) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  const index = assembly.occurrencePatterns.findIndex((entry) => entry.id === patternId);
  if (index < 0) throw new Error('That component pattern no longer exists.');
  const previous = assembly.occurrencePatterns[index];
  const sources = [...new Set(patch.sourceOccurrenceIds || previous.sourceOccurrenceIds)];
  if (!sources.length || sources.some((id) => !assembly.occurrences.some((entry) => entry.id === id))) throw new Error('Choose existing source component occurrences.');
  const generatedCount = Number(patch.generatedCount ?? previous.generatedCount);
  if (!Number.isInteger(generatedCount) || generatedCount < 1 || generatedCount > 5000) throw new Error('Generated occurrence count must be an integer from 1 to 5,000.');
  const name = String(patch.name ?? previous.name).trim();
  if (!name) throw new Error('Component pattern name is required.');
  assembly.occurrencePatterns[index] = {
    ...previous,
    name,
    kind: patch.kind ?? previous.kind,
    sourceOccurrenceIds: sources,
    generatedCount,
    definition: clone(patch.definition ?? previous.definition),
    suppressed: patch.suppressed ?? previous.suppressed,
  };
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function deleteStudioV5OccurrencePattern(project, patternId) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  if (!assembly.occurrencePatterns.some((entry) => entry.id === patternId)) throw new Error('That component pattern no longer exists.');
  assembly.occurrencePatterns = assembly.occurrencePatterns.filter((entry) => entry.id !== patternId);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function enterStudioV5AssemblyContext(project, occurrenceId) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  const occurrence = assembly.occurrences.find((entry) => entry.id === occurrenceId && entry.definition.kind === 'part');
  if (!occurrence) throw new Error('Choose a direct part occurrence to edit in context.');
  candidate.metadata.editContext = { assemblyId: assembly.id, occurrencePath: [occurrence.id] };
  candidate.rootDocument = clone(occurrence.definition);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function exitStudioV5AssemblyContext(project) {
  const candidate = canonicalStudioV5Project(project);
  const assemblyId = candidate.metadata?.editContext?.assemblyId;
  if (!assemblyId || !candidate.assemblyDefinitions.some((entry) => entry.id === assemblyId)) throw new Error('There is no active assembly edit context.');
  candidate.rootDocument = { kind: 'assembly', assemblyId };
  delete candidate.metadata.editContext;
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

function datumRefsForTransform(transform) {
  return ['axisDatumId', 'planeDatumId', 'fromDatumId', 'toDatumId']
    .filter((key) => typeof transform?.[key] === 'string')
    .map((key) => ({ ownerKind: 'datum', ownerId: transform[key], semanticPath: { role: key }, signature: { kind: key.replace('DatumId', '') } }));
}

export function createStudioV5TransformFeature(project, options) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  requireUniquePartId(part, options.id, 'Transform feature');
  const source = part.bodies.find((body) => body.id === options.bodyId);
  if (!source) throw new Error('Choose an existing body to transform.');
  const mode = options.transform?.mode || options.mode;
  const createsCopy = options.copy === true || mode === 'copy' || (mode === 'mirror' && options.moveOriginal !== true);
  const feature = {
    id: options.id,
    name: String(options.name || (mode === 'mirror' ? 'Mirror ' : createsCopy ? 'Copy ' : 'Transform ') + source.name).trim(),
    type: 'transform',
    operation: mode,
    transform: clone({ ...(options.transform || {}), mode }),
    sourceBodyId: source.id,
    toolBodyIds: createsCopy ? [source.id] : [],
    linked: createsCopy,
    suppressed: false,
    inputRefs: [
      { ownerKind: 'body', ownerId: source.id, semanticPath: { role: 'source' }, signature: { role: 'source' } },
      ...datumRefsForTransform(options.transform || {}),
    ],
    resultPolicy: createsCopy
      ? { kind: 'new-body', bodyName: options.bodyName || (mode === 'mirror' ? source.name + ' mirror' : source.name + ' copy') }
      : { kind: 'add', targetBodyIds: [source.id] },
  };
  if (createsCopy) feature.createdBodyId = options.createdBodyId || 'body-' + feature.id;
  // Resolve before the feature enters history so invalid frames and cyclic
  // datums cannot create an undo entry or mutate the active document.
  resolveStudioV5Transform(candidate, part, feature);
  part.features.push(feature);
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function updateStudioV5TransformFeature(project, featureId, patch) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const feature = part.features.find((entry) => entry.id === featureId && entry.type === 'transform');
  if (!feature) throw new Error('That transform feature no longer exists.');
  if (patch.name != null) feature.name = String(patch.name).trim();
  if (patch.transform != null) {
    feature.transform = clone(patch.transform);
    feature.operation = feature.transform.mode;
    feature.inputRefs = feature.inputRefs.filter((reference) => reference.ownerKind !== 'datum').concat(datumRefsForTransform(feature.transform));
  }
  if (patch.suppressed != null) feature.suppressed = Boolean(patch.suppressed);
  resolveStudioV5Transform(candidate, part, feature);
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function reorderStudioV5Feature(project, featureId, beforeFeatureId = null) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const from = part.features.findIndex((feature) => feature.id === featureId);
  if (from < 0) throw new Error('That feature no longer exists.');
  const [feature] = part.features.splice(from, 1);
  const destination = beforeFeatureId == null ? part.features.length : part.features.findIndex((entry) => entry.id === beforeFeatureId);
  if (destination < 0) throw new Error('The target history position no longer exists.');
  part.features.splice(destination, 0, feature);
  reconcileStudioV5Bodies(part);
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function setStudioV5RollbackMarker(project, featureId = null) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  if (featureId != null && !part.features.some((feature) => feature.id === featureId)) throw new Error('That rollback feature no longer exists.');
  part.metadata = { ...(part.metadata || {}), rollbackFeatureId: featureId };
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
  const removedBodyIds = new Set([bodyId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const feature of part.features) {
      if (removedFeatureIds.has(feature.id)) continue;
      const createsBody = removedBodyIds.has(feature.createdBodyId);
      const targetsBody = feature.resultPolicy?.targetBodyIds?.some((id) => removedBodyIds.has(id));
      const usesBody = feature.toolBodyIds?.some((id) => removedBodyIds.has(id)) || feature.inputRefs?.some((ref) => ref.ownerKind === 'body' && removedBodyIds.has(ref.ownerId));
      const usesRemovedFeature = feature.inputRefs?.some((ref) => ref.ownerKind === 'feature' && removedFeatureIds.has(ref.ownerId));
      if (createsBody || targetsBody || usesBody || usesRemovedFeature) {
        removedFeatureIds.add(feature.id);
        if (feature.createdBodyId) removedBodyIds.add(feature.createdBodyId);
        changed = true;
      }
    }
  }
  part.features = part.features.filter((feature) => !removedFeatureIds.has(feature.id));
  part.bodyPatterns = (part.bodyPatterns || []).filter((pattern) => !removedBodyIds.has(pattern.sourceBodyId));
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
