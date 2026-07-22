import { prepareStudioDocument } from './studio-document.js';

// Canonical schema-5 project boundary. Slice 5A-runtime now uses this boundary
// for production multi-body part documents; later slices will consume the same
// envelope for assembly and advanced-modeling behavior.

export const STUDIO_V5_SCHEMA_VERSION = 5;

export const STUDIO_V5_PROJECT_LIMITS = Object.freeze({
  bytes: 20 * 1024 * 1024,
  // 20 MiB document + up to 100 MiB decoded resources at base64 expansion,
  // rounded up so parsing is bounded before JSON is allocated.
  fileBytes: 160 * 1024 * 1024,
  resourcesBytes: 100 * 1024 * 1024,
  partDefinitions: 250,
  assemblyDefinitions: 250,
  occurrences: 2000,
  generatedOccurrences: 5000,
  featuresPerPart: 2000,
  sketchEntities: 25000,
  parameters: 5000,
  materials: 1000,
  resources: 1000,
  treeDepth: 100,
});

export const STUDIO_V5_IDENTITY_MATRIX = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DOCUMENT_KINDS = new Set(['part', 'assembly']);
const BODY_KINDS = new Set(['solid', 'surface']);
const OWNER_KINDS = new Set(['part', 'body', 'feature', 'datum', 'sketch', 'occurrence']);
const RESULT_KINDS = new Set(['new-body', 'add', 'subtract', 'intersect', 'surface']);
const REFERENCE_KINDS = new Set(['plane', 'axis', 'point', 'coordinate-system']);
const MATE_KINDS = new Set(['fixed', 'coincident', 'concentric', 'distance', 'angle', 'parallel', 'perpendicular', 'tangent', 'revolute', 'slider']);
const PATTERN_KINDS = new Set(['linear', 'circular', 'curve']);
const BODY_PATTERN_KINDS = new Set(['linear', 'circular', 'curve', 'mirror']);
const SECTION_KINDS = new Set(['plane', 'quarter', 'box']);
const RESOURCE_MIME_TYPES = new Set(['text/plain', 'text/csv', 'application/dxf', 'application/step', 'model/step', 'image/svg+xml']);

export class StudioV5ProjectError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StudioV5ProjectError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new StudioV5ProjectError(code, message);
};

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateJsonTree(value, path = 'project', stack = new Set(), depth = 0) {
  if (depth > STUDIO_V5_PROJECT_LIMITS.treeDepth) fail('LIMIT_DEPTH', path + ' exceeds the maximum nesting depth.');
  if (value == null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_NUMBER', path + ' must contain only finite numbers.');
    return;
  }
  if (typeof value !== 'object') fail('INVALID_VALUE', path + ' contains a non-JSON value.');
  if (stack.has(value)) fail('CYCLIC_OBJECT', path + ' contains a cyclic object reference.');
  if (!Array.isArray(value) && !isRecord(value)) fail('INVALID_VALUE', path + ' must contain only JSON objects and arrays.');
  stack.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonTree(item, path + '[' + index + ']', stack, depth + 1));
  } else {
    for (const [key, item] of Object.entries(value)) validateJsonTree(item, path + '.' + key, stack, depth + 1);
  }
  stack.delete(value);
}

function utf8Bytes(text, stopAfter = Number.POSITIVE_INFINITY) {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const trail = text.charCodeAt(index + 1);
      if (trail >= 0xdc00 && trail <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > stopAfter) return bytes;
  }
  return bytes;
}

function jsonBytes(value) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    fail('CYCLIC_OBJECT', 'Project contains a cyclic object reference.');
  }
  return utf8Bytes(text);
}

function documentBytesWithoutEmbeddedResources(value) {
  if (!isRecord(value) || !Array.isArray(value.resources)) return jsonBytes(value);
  const resources = value.resources.map((resource) => {
    if (!isRecord(resource) || resource.data == null) return resource;
    const { data: _data, ...metadata } = resource;
    return metadata;
  });
  return jsonBytes({ ...value, resources });
}

function clone(value) {
  return structuredClone(value);
}

function requireRecord(value, path) {
  if (!isRecord(value)) fail('INVALID_RECORD', path + ' must be an object.');
  return value;
}

function requireArray(value, path, limit, code = 'LIMIT_ITEMS') {
  if (!Array.isArray(value)) fail('INVALID_ARRAY', path + ' must be an array.');
  if (value.length > limit) fail(code, path + ' exceeds its ' + limit.toLocaleString('en-US') + '-item limit.');
  return value;
}

function requireId(value, path) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    fail('INVALID_ID', path + ' must be a non-empty stable ID using letters, numbers, dot, underscore, colon, or hyphen.');
  }
  return value;
}

function requireName(value, path) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail('INVALID_NAME', path + ' must be a non-empty name of at most 200 characters.');
  return value.trim();
}

function requireBoolean(value, path) {
  if (typeof value !== 'boolean') fail('INVALID_BOOLEAN', path + ' must be true or false.');
  return value;
}

function validateOptionalRecord(value, path) {
  if (value != null) requireRecord(value, path);
}

function validateOptionalText(value, path, maximum = 2000) {
  if (value != null && (typeof value !== 'string' || value.length > maximum)) {
    fail('INVALID_TEXT', path + ' must be text of at most ' + maximum.toLocaleString('en-US') + ' characters.');
  }
}

function requireInteger(value, path, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail('INVALID_INTEGER', path + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  }
  return value;
}

function expressionLike(value) {
  return (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.trim().length > 0 && value.length <= 500);
}

function parseSafeExpression(value, path, allowedNames) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_EXPRESSION', path + ' must be finite.');
    return { dependencies: new Set(), evaluate: () => value };
  }
  if (!expressionLike(value)) fail('INVALID_EXPRESSION', path + ' must be a finite number or supported expression.');
  const source = value;
  const dependencies = new Set();
  let index = 0;
  const skip = () => {
    while (/\s/.test(source[index] || '')) index++;
  };
  function factor() {
    skip();
    if (source[index] === '(') {
      index++;
      const inner = expression();
      skip();
      if (source[index] !== ')') fail('INVALID_EXPRESSION', path + ' has an unmatched parenthesis.');
      index++;
      return inner;
    }
    if (source[index] === '-' || source[index] === '+') {
      const sign = source[index++] === '-' ? -1 : 1;
      const operand = factor();
      return (resolve) => sign * operand(resolve);
    }
    let match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
    if (match) {
      const name = match[0];
      if (!allowedNames.has(name)) fail('UNKNOWN_PARAMETER', path + ' references unknown parameter "' + name + '".');
      dependencies.add(name);
      index += name.length;
      return (resolve) => resolve(name);
    }
    match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(index));
    if (!match) fail('INVALID_EXPRESSION', path + ' contains unsupported expression syntax.');
    index += match[0].length;
    const number = Number(match[0]);
    return () => number;
  }
  function term() {
    let evaluate = factor();
    for (;;) {
      skip();
      const operator = source[index];
      if (operator !== '*' && operator !== '/') return evaluate;
      index++;
      const left = evaluate;
      const right = factor();
      evaluate = operator === '*'
        ? (resolve) => left(resolve) * right(resolve)
        : (resolve) => left(resolve) / right(resolve);
    }
  }
  function expression() {
    let evaluate = term();
    for (;;) {
      skip();
      const operator = source[index];
      if (operator !== '+' && operator !== '-') return evaluate;
      index++;
      const left = evaluate;
      const right = term();
      evaluate = operator === '+'
        ? (resolve) => left(resolve) + right(resolve)
        : (resolve) => left(resolve) - right(resolve);
    }
  }
  const evaluateNode = expression();
  skip();
  if (index !== source.length) fail('INVALID_EXPRESSION', path + ' contains unsupported expression syntax.');
  return {
    dependencies,
    evaluate(resolve) {
      const result = evaluateNode(resolve);
      if (!Number.isFinite(result)) fail('INVALID_EXPRESSION', path + ' must evaluate to a finite number.');
      return result;
    },
  };
}

function addUnique(seen, id, path, scope = 'project') {
  if (seen.has(id)) fail('DUPLICATE_ID', 'Duplicate ' + scope + ' ID "' + id + '" at ' + path + '.');
  seen.add(id);
}

function validateDocumentRef(ref, path) {
  requireRecord(ref, path);
  if (!DOCUMENT_KINDS.has(ref.kind)) fail('INVALID_DOCUMENT_REF', path + '.kind must be part or assembly.');
  if (ref.kind === 'part') requireId(ref.partId, path + '.partId');
  else requireId(ref.assemblyId, path + '.assemblyId');
}

function validateGeometryReference(reference, path) {
  requireRecord(reference, path);
  if (!OWNER_KINDS.has(reference.ownerKind)) fail('INVALID_REFERENCE', path + '.ownerKind is unsupported.');
  requireId(reference.ownerId, path + '.ownerId');
  requireRecord(reference.signature, path + '.signature');
  if (reference.semanticPath != null) requireRecord(reference.semanticPath, path + '.semanticPath');
  if (reference.occurrencePath != null) {
    const occurrencePath = requireArray(reference.occurrencePath, path + '.occurrencePath', STUDIO_V5_PROJECT_LIMITS.occurrences);
    if (occurrencePath.length === 0) fail('INVALID_REFERENCE', path + '.occurrencePath must not be empty when present.');
    const seenOccurrences = new Set();
    occurrencePath.forEach((id, index) => {
      const occurrenceId = requireId(id, path + '.occurrencePath[' + index + ']');
      if (seenOccurrences.has(occurrenceId)) fail('CYCLIC_OCCURRENCE_PATH', path + '.occurrencePath repeats occurrence "' + occurrenceId + '".');
      seenOccurrences.add(occurrenceId);
    });
  }
}

function validatePartReferenceContext(reference, path, partId, bodyIds, featureIds, datumIds, sketchIds) {
  if (reference.occurrencePath?.length) return;
  if (reference.ownerKind === 'part' && reference.ownerId !== partId) {
    fail('MISSING_REFERENCE', path + ' references another part without an occurrence path.');
  }
  if (reference.ownerKind === 'body' && !bodyIds.has(reference.ownerId)) {
    fail('MISSING_REFERENCE', path + ' references a body outside this part without an occurrence path.');
  }
  if (reference.ownerKind === 'feature' && !featureIds.has(reference.ownerId)) {
    fail('MISSING_REFERENCE', path + ' references a feature outside this part without an occurrence path.');
  }
  if (reference.ownerKind === 'datum' && !datumIds.has(reference.ownerId)) {
    fail('MISSING_REFERENCE', path + ' references a datum outside this part without an occurrence path.');
  }
  if (reference.ownerKind === 'sketch' && !sketchIds.has(reference.ownerId)) {
    fail('MISSING_REFERENCE', path + ' references a sketch outside this part without an occurrence path.');
  }
  if (reference.ownerKind === 'occurrence') {
    fail('INVALID_REFERENCE', path + ' must include an occurrence path in a part definition.');
  }
}

function validateParameter(parameter, path, seenIds, seenNames) {
  requireRecord(parameter, path);
  const id = requireId(parameter.id, path + '.id');
  addUnique(seenIds, id, path, 'parameter');
  if (typeof parameter.name !== 'string' || !PARAMETER_NAME_PATTERN.test(parameter.name)) {
    fail('INVALID_PARAMETER', path + '.name must be a valid parameter identifier.');
  }
  if (seenNames.has(parameter.name)) fail('DUPLICATE_PARAMETER', 'Duplicate parameter name "' + parameter.name + '" in one scope.');
  seenNames.add(parameter.name);
  if (!expressionLike(parameter.value)) fail('INVALID_PARAMETER', path + '.value must be a finite number or non-empty expression.');
  validateOptionalText(parameter.description, path + '.description');
  validateOptionalRecord(parameter.extensions, path + '.extensions');
}

function validateParameterArray(parameters, path, counter, globalIds, inheritedValues = new Map()) {
  const entries = requireArray(parameters, path, STUDIO_V5_PROJECT_LIMITS.parameters, 'LIMIT_PARAMETERS');
  counter.count += entries.length;
  if (counter.count > STUDIO_V5_PROJECT_LIMITS.parameters) fail('LIMIT_PARAMETERS', 'Project exceeds the 5,000-parameter limit.');
  const seenNames = new Set();
  entries.forEach((parameter, index) => validateParameter(parameter, path + '[' + index + ']', globalIds, seenNames));
  const allowedNames = new Set([...inheritedValues.keys(), ...seenNames]);
  const parsed = new Map(entries.map((parameter, index) => [
    parameter.name,
    parseSafeExpression(parameter.value, path + '[' + index + '].value', allowedNames),
  ]));
  const dependencies = new Map([...parsed].map(([name, expression]) => [
    name,
    [...expression.dependencies].filter((dependency) => seenNames.has(dependency)),
  ]));
  const visiting = new Set();
  const visited = new Set();
  function visit(name, chain) {
    if (visiting.has(name)) fail('CYCLIC_PARAMETER', path + ' contains a parameter cycle: ' + [...chain, name].join(' -> ') + '.');
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of dependencies.get(name) || []) visit(dependency, [...chain, name]);
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of dependencies.keys()) visit(name, []);
  const values = new Map(inheritedValues);
  const evaluating = new Set();
  const resolved = new Set();
  function resolve(name) {
    if (!parsed.has(name)) return inheritedValues.get(name);
    if (resolved.has(name)) return values.get(name);
    if (evaluating.has(name)) fail('CYCLIC_PARAMETER', path + ' contains a parameter cycle while evaluating "' + name + '".');
    evaluating.add(name);
    const value = parsed.get(name).evaluate(resolve);
    evaluating.delete(name);
    values.set(name, value);
    resolved.add(name);
    return value;
  }
  for (const name of parsed.keys()) resolve(name);
  return values;
}

function validateMaterial(material, path, seenIds) {
  requireRecord(material, path);
  const id = requireId(material.id, path + '.id');
  addUnique(seenIds, id, path, 'material');
  requireName(material.name, path + '.name');
  if (material.densityKgM3 != null && (typeof material.densityKgM3 !== 'number' || !Number.isFinite(material.densityKgM3) || material.densityKgM3 <= 0)) {
    fail('INVALID_MATERIAL', path + '.densityKgM3 must be a positive finite number.');
  }
  if (material.appearanceId != null) requireId(material.appearanceId, path + '.appearanceId');
  validateOptionalText(material.description, path + '.description');
  validateOptionalText(material.source, path + '.source');
  validateOptionalRecord(material.extensions, path + '.extensions');
}

function validateFeatureResultPolicy(policy, path) {
  requireRecord(policy, path);
  if (!RESULT_KINDS.has(policy.kind)) fail('INVALID_RESULT_POLICY', path + '.kind is unsupported.');
  if (policy.kind === 'new-body' || policy.kind === 'surface') {
    if (policy.bodyName != null) requireName(policy.bodyName, path + '.bodyName');
    return;
  }
  const targets = requireArray(policy.targetBodyIds, path + '.targetBodyIds', STUDIO_V5_PROJECT_LIMITS.featuresPerPart);
  if (targets.length === 0) fail('INVALID_RESULT_POLICY', path + '.targetBodyIds must contain at least one body.');
  const seen = new Set();
  targets.forEach((id, index) => {
    const bodyId = requireId(id, path + '.targetBodyIds[' + index + ']');
    if (seen.has(bodyId)) fail('DUPLICATE_REFERENCE', path + ' repeats target body "' + bodyId + '".');
    seen.add(bodyId);
  });
  if ((policy.kind === 'subtract' || policy.kind === 'intersect') && policy.keepTools != null) requireBoolean(policy.keepTools, path + '.keepTools');
}

function validateFeature(feature, path, seenIds, globalIds) {
  requireRecord(feature, path);
  const id = requireId(feature.id, path + '.id');
  addUnique(seenIds, id, path, 'feature');
  addUnique(globalIds, id, path, 'project feature');
  requireName(feature.name, path + '.name');
  if (typeof feature.type !== 'string' || !feature.type.trim() || feature.type.length > 100) fail('INVALID_FEATURE', path + '.type is required.');
  requireBoolean(feature.suppressed, path + '.suppressed');
  requireArray(feature.inputRefs, path + '.inputRefs', STUDIO_V5_PROJECT_LIMITS.featuresPerPart)
    .forEach((reference, index) => validateGeometryReference(reference, path + '.inputRefs[' + index + ']'));
  validateFeatureResultPolicy(feature.resultPolicy, path + '.resultPolicy');
  validateOptionalRecord(feature.extensions, path + '.extensions');
}

function validateBody(body, path, seenIds, globalIds, featureIds, materialIds) {
  requireRecord(body, path);
  const id = requireId(body.id, path + '.id');
  addUnique(seenIds, id, path, 'body');
  addUnique(globalIds, id, path, 'project body');
  requireName(body.name, path + '.name');
  if (!BODY_KINDS.has(body.kind)) fail('INVALID_BODY', path + '.kind must be solid or surface.');
  const createdBy = requireId(body.createdByFeatureId, path + '.createdByFeatureId');
  if (!featureIds.has(createdBy)) fail('MISSING_REFERENCE', path + '.createdByFeatureId does not resolve in this part.');
  const ordered = requireArray(body.featureIds, path + '.featureIds', STUDIO_V5_PROJECT_LIMITS.featuresPerPart);
  if (ordered.length === 0 || !ordered.includes(createdBy)) fail('INVALID_BODY', path + '.featureIds must include its creating feature.');
  if (ordered[0] !== createdBy) fail('INVALID_BODY', path + '.featureIds must begin with its creating feature.');
  const seenFeatureIds = new Set();
  ordered.forEach((featureId, index) => {
    const idValue = requireId(featureId, path + '.featureIds[' + index + ']');
    if (!featureIds.has(idValue)) fail('MISSING_REFERENCE', path + '.featureIds[' + index + '] does not resolve in this part.');
    if (seenFeatureIds.has(idValue)) fail('DUPLICATE_REFERENCE', path + ' repeats feature "' + idValue + '".');
    seenFeatureIds.add(idValue);
  });
  requireBoolean(body.visible, path + '.visible');
  requireBoolean(body.suppressed, path + '.suppressed');
  if (body.materialId != null) {
    const materialId = requireId(body.materialId, path + '.materialId');
    if (!materialIds.has(materialId)) fail('MISSING_REFERENCE', path + '.materialId does not resolve in project materials.');
  }
  if (body.appearanceId != null) requireId(body.appearanceId, path + '.appearanceId');
  validateOptionalRecord(body.extensions, path + '.extensions');
}

function validateBodyPattern(pattern, path, partId, bodyIds, featureIds, datumIds, sketchIds, datumKinds, sketchRoles, parameterValues, seenIds, globalIds, counters) {
  requireRecord(pattern, path);
  const id = requireId(pattern.id, path + '.id');
  addUnique(seenIds, id, path, 'body pattern');
  addUnique(globalIds, id, path, 'project pattern');
  requireName(pattern.name, path + '.name');
  if (!BODY_PATTERN_KINDS.has(pattern.kind)) fail('INVALID_PATTERN', path + '.kind is unsupported.');
  const sourceBodyId = requireId(pattern.sourceBodyId, path + '.sourceBodyId');
  if (!bodyIds.has(sourceBodyId)) fail('MISSING_REFERENCE', path + '.sourceBodyId does not resolve in this part.');
  const references = requireArray(pattern.references, path + '.references', 4);
  references.forEach((reference, index) => validatePartReferenceContext(
    reference,
    path + '.references[' + index + ']',
    partId,
    bodyIds,
    featureIds,
    datumIds,
    sketchIds,
  ));
  requireRecord(pattern.definition, path + '.definition');
  const expressionValue = (value, suffix) => parseSafeExpression(value, path + '.definition.' + suffix, new Set(parameterValues.keys()))
    .evaluate((parameterName) => parameterValues.get(parameterName));
  const count = expressionValue(pattern.definition.count, 'count');
  if (!Number.isInteger(count) || count < 2 || count > STUDIO_V5_PROJECT_LIMITS.generatedOccurrences) {
    fail('INVALID_PATTERN', path + '.definition.count must evaluate to an integer from 2 to 5,000.');
  }
  let occurrenceCount = count;
  const roles = references.map((reference, index) => {
    if (reference.occurrencePath?.length) fail('INVALID_PATTERN', path + '.references[' + index + '] cannot cross an assembly occurrence.');
    const role = reference.semanticPath?.role;
    if (typeof role !== 'string' || reference.signature?.role !== role) fail('INVALID_PATTERN', path + '.references[' + index + '] must carry one matching semantic role.');
    return role;
  });
  const expectRoles = (expected) => {
    if (roles.length !== expected.length || expected.some((role) => !roles.includes(role)) || new Set(roles).size !== roles.length) {
      fail('INVALID_PATTERN', path + '.references must contain exactly ' + expected.join(' and ') + '.');
    }
  };
  const expectReferenceKinds = (ownerKind, expectedRoles) => {
    expectRoles(expectedRoles);
    references.forEach((reference, index) => {
      if (reference.ownerKind !== ownerKind) fail('INVALID_PATTERN', path + '.references[' + index + '] must reference a ' + ownerKind + '.');
    });
  };
  const referenceForRole = (role) => references.find((reference) => reference.semanticPath?.role === role);
  const validateTable = (values, suffix, tableCount = count) => {
    const entries = requireArray(values, path + '.definition.' + suffix, tableCount - 1);
    if (entries.length !== tableCount - 1) fail('INVALID_PATTERN', path + '.definition.' + suffix + ' must contain one value per generated occurrence in that direction.');
    entries.forEach((value, index) => expressionValue(value, suffix + '[' + index + ']'));
  };
  if (pattern.kind === 'linear') {
    const linearRoles = roles.includes('direction-2') ? ['direction', 'direction-2'] : ['direction'];
    expectReferenceKinds('datum', linearRoles);
    linearRoles.forEach((role) => {
      if (!['axis', 'coordinate-system'].includes(datumKinds.get(referenceForRole(role).ownerId))) fail('INVALID_PATTERN', path + '.references role ' + role + ' must resolve to an axis or coordinate system.');
    });
    if (!['spacing', 'extent', 'table'].includes(pattern.definition.distribution)) fail('INVALID_PATTERN', path + '.definition.distribution is unsupported for a linear pattern.');
    if (!['preserve', 'alternating'].includes(pattern.definition.orientation)) fail('INVALID_PATTERN', path + '.definition.orientation is unsupported for a linear pattern.');
    if (pattern.definition.distribution === 'spacing' && Math.abs(expressionValue(pattern.definition.spacing, 'spacing')) <= 1e-9) fail('INVALID_PATTERN', path + '.definition.spacing must be nonzero.');
    if (pattern.definition.distribution === 'extent' && Math.abs(expressionValue(pattern.definition.extent, 'extent')) <= 1e-9) fail('INVALID_PATTERN', path + '.definition.extent must be nonzero.');
    if (pattern.definition.distribution === 'table') validateTable(pattern.definition.positions, 'positions');
    if (linearRoles.length === 2) {
      const count2 = expressionValue(pattern.definition.count2, 'count2');
      if (!Number.isInteger(count2) || count2 < 2 || count * count2 > STUDIO_V5_PROJECT_LIMITS.generatedOccurrences) {
        fail('INVALID_PATTERN', path + '.definition.count2 must produce from 4 to 5,000 total occurrences.');
      }
      occurrenceCount = count * count2;
      if (!['spacing', 'extent', 'table'].includes(pattern.definition.distribution2)) fail('INVALID_PATTERN', path + '.definition.distribution2 is unsupported for a linear pattern.');
      if (pattern.definition.distribution2 === 'spacing' && Math.abs(expressionValue(pattern.definition.spacing2, 'spacing2')) <= 1e-9) fail('INVALID_PATTERN', path + '.definition.spacing2 must be nonzero.');
      if (pattern.definition.distribution2 === 'extent' && Math.abs(expressionValue(pattern.definition.extent2, 'extent2')) <= 1e-9) fail('INVALID_PATTERN', path + '.definition.extent2 must be nonzero.');
      if (pattern.definition.distribution2 === 'table') validateTable(pattern.definition.positions2, 'positions2', count2);
    }
  } else if (pattern.kind === 'circular') {
    expectReferenceKinds('datum', ['axis']);
    if (!['axis', 'coordinate-system'].includes(datumKinds.get(referenceForRole('axis').ownerId))) fail('INVALID_PATTERN', path + '.references role axis must resolve to an axis or coordinate system.');
    if (!['full', 'spacing', 'extent', 'table'].includes(pattern.definition.distribution)) fail('INVALID_PATTERN', path + '.definition.distribution is unsupported for a circular pattern.');
    if (!['rotate', 'preserve', 'alternating'].includes(pattern.definition.orientation)) fail('INVALID_PATTERN', path + '.definition.orientation is unsupported for a circular pattern.');
    expressionValue(pattern.definition.radialOffset ?? 0, 'radialOffset');
    expressionValue(pattern.definition.axialOffset ?? 0, 'axialOffset');
    if (pattern.definition.distribution === 'spacing' && Math.abs(expressionValue(pattern.definition.spacingAngle, 'spacingAngle')) <= 1e-9) fail('INVALID_PATTERN', path + '.definition.spacingAngle must be nonzero.');
    if (pattern.definition.distribution === 'extent' && Math.abs(expressionValue(pattern.definition.totalAngle, 'totalAngle')) <= 1e-9) fail('INVALID_PATTERN', path + '.definition.totalAngle must be nonzero.');
    if (pattern.definition.distribution === 'table') validateTable(pattern.definition.angles, 'angles');
  } else if (pattern.kind === 'curve') {
    expectReferenceKinds('sketch', ['path']);
    if (sketchRoles.get(referenceForRole('path').ownerId) !== 'path') fail('INVALID_PATTERN', path + '.references role path must resolve to an editable path sketch.');
    if (!['equal', 'spacing', 'extent', 'table'].includes(pattern.definition.distribution)) fail('INVALID_PATTERN', path + '.definition.distribution is unsupported for a curve pattern.');
    if (!['tangent', 'fixed'].includes(pattern.definition.orientation)) fail('INVALID_PATTERN', path + '.definition.orientation is unsupported for a curve pattern.');
    if (pattern.definition.distribution === 'spacing' && expressionValue(pattern.definition.spacing, 'spacing') <= 0) fail('INVALID_PATTERN', path + '.definition.spacing must be positive.');
    if (pattern.definition.distribution === 'extent' && expressionValue(pattern.definition.extent, 'extent') <= 0) fail('INVALID_PATTERN', path + '.definition.extent must be positive.');
    if (pattern.definition.distribution === 'table') {
      validateTable(pattern.definition.parameters, 'parameters');
      pattern.definition.parameters.forEach((value, index) => {
        const parameter = expressionValue(value, 'parameters[' + index + ']');
        if (!(parameter >= 0 && parameter <= 1)) fail('INVALID_PATTERN', path + '.definition.parameters[' + index + '] must evaluate from 0 to 1.');
      });
    }
  } else {
    expectReferenceKinds('datum', ['plane']);
    if (datumKinds.get(referenceForRole('plane').ownerId) !== 'plane') fail('INVALID_PATTERN', path + '.references role plane must resolve to a plane datum.');
    if (count !== 2 || pattern.definition.distribution !== 'mirror' || pattern.definition.orientation !== 'mirror') {
      fail('INVALID_PATTERN', path + '.definition must describe one mirror occurrence.');
    }
  }
  counters.generatedOccurrences += occurrenceCount - 1;
  if (counters.generatedOccurrences > STUDIO_V5_PROJECT_LIMITS.generatedOccurrences) {
    fail('LIMIT_GENERATED_OCCURRENCES', 'Project exceeds the 5,000-generated-occurrence limit.');
  }
  const skipped = requireArray(pattern.skippedIndices, path + '.skippedIndices', occurrenceCount - 1);
  const seenSkipped = new Set();
  skipped.forEach((value, index) => {
    if (!Number.isInteger(value) || value < 1 || value >= occurrenceCount) fail('INVALID_PATTERN', path + '.skippedIndices[' + index + '] is outside the generated occurrence range.');
    if (seenSkipped.has(value)) fail('DUPLICATE_REFERENCE', path + '.skippedIndices repeats occurrence ' + value + '.');
    seenSkipped.add(value);
  });
  requireBoolean(pattern.suppressed, path + '.suppressed');
  requireBoolean(pattern.visible, path + '.visible');
  validateOptionalRecord(pattern.extensions, path + '.extensions');
}

function validateSketch(sketch, path, counters, seenIds, globalIds) {
  requireRecord(sketch, path);
  const id = requireId(sketch.id, path + '.id');
  addUnique(seenIds, id, path, 'sketch');
  addUnique(globalIds, id, path, 'project sketch');
  requireName(sketch.name, path + '.name');
  if (sketch.support != null) validateGeometryReference(sketch.support, path + '.support');
  const entities = requireArray(sketch.entities, path + '.entities', STUDIO_V5_PROJECT_LIMITS.sketchEntities, 'LIMIT_SKETCH_ENTITIES');
  counters.sketchEntities += entities.length;
  if (counters.sketchEntities > STUDIO_V5_PROJECT_LIMITS.sketchEntities) {
    fail('LIMIT_SKETCH_ENTITIES', 'Project exceeds the 25,000-sketch-entity limit.');
  }
  entities.forEach((entity, index) => requireRecord(entity, path + '.entities[' + index + ']'));
  requireArray(sketch.groups, path + '.groups', STUDIO_V5_PROJECT_LIMITS.sketchEntities, 'LIMIT_SKETCH_ENTITIES')
    .forEach((group, index) => requireRecord(group, path + '.groups[' + index + ']'));
  requireArray(sketch.constraints, path + '.constraints', STUDIO_V5_PROJECT_LIMITS.sketchEntities, 'LIMIT_SKETCH_ENTITIES')
    .forEach((constraint, index) => requireRecord(constraint, path + '.constraints[' + index + ']'));
  validateOptionalRecord(sketch.extensions, path + '.extensions');
}

function validateReferenceGeometry(datum, path, seenIds, globalIds) {
  requireRecord(datum, path);
  const id = requireId(datum.id, path + '.id');
  addUnique(seenIds, id, path, 'datum');
  addUnique(globalIds, id, path, 'project datum');
  requireName(datum.name, path + '.name');
  if (!REFERENCE_KINDS.has(datum.kind)) fail('INVALID_DATUM', path + '.kind is unsupported.');
  requireBoolean(datum.suppressed, path + '.suppressed');
  requireRecord(datum.definition, path + '.definition');
  validateOptionalRecord(datum.extensions, path + '.extensions');
}

function validatePart(part, path, counters, projectIds, materialIds, projectParameterValues) {
  requireRecord(part, path);
  const partId = requireId(part.id, path + '.id');
  addUnique(projectIds.partIds, partId, path, 'part');
  requireName(part.name, path + '.name');
  const partParameterValues = validateParameterArray(part.parameters, path + '.parameters', counters.parameters, projectIds.parameterIds, projectParameterValues);

  const datumIds = new Set();
  requireArray(part.referenceGeometry, path + '.referenceGeometry', STUDIO_V5_PROJECT_LIMITS.featuresPerPart)
    .forEach((datum, index) => validateReferenceGeometry(datum, path + '.referenceGeometry[' + index + ']', datumIds, projectIds.datumIds));

  const sketchIds = new Set();
  requireArray(part.sketches, path + '.sketches', STUDIO_V5_PROJECT_LIMITS.featuresPerPart)
    .forEach((sketch, index) => validateSketch(sketch, path + '.sketches[' + index + ']', counters, sketchIds, projectIds.sketchIds));

  const featureEntries = requireArray(part.features, path + '.features', STUDIO_V5_PROJECT_LIMITS.featuresPerPart, 'LIMIT_FEATURES');
  const featureIds = new Set();
  featureEntries.forEach((feature, index) => validateFeature(feature, path + '.features[' + index + ']', featureIds, projectIds.featureIds));

  const featureOrder = requireArray(part.featureOrder, path + '.featureOrder', STUDIO_V5_PROJECT_LIMITS.featuresPerPart, 'LIMIT_FEATURES');
  if (featureOrder.length !== featureEntries.length) fail('INVALID_FEATURE_ORDER', path + '.featureOrder must contain every feature exactly once.');
  const orderedIds = new Set();
  const orderIndex = new Map();
  featureOrder.forEach((featureId, index) => {
    const id = requireId(featureId, path + '.featureOrder[' + index + ']');
    if (!featureIds.has(id)) fail('MISSING_REFERENCE', path + '.featureOrder[' + index + '] does not resolve in this part.');
    if (orderedIds.has(id)) fail('DUPLICATE_REFERENCE', path + '.featureOrder repeats feature "' + id + '".');
    orderedIds.add(id);
    orderIndex.set(id, index);
  });

  const featureDependencies = new Map(featureEntries.map((feature) => [
    feature.id,
    feature.inputRefs
      .filter((reference) => reference.ownerKind === 'feature' && !reference.occurrencePath?.length)
      .map((reference) => reference.ownerId),
  ]));
  const visitingFeatures = new Set();
  const visitedFeatures = new Set();
  function visitFeature(featureId, chain) {
    if (visitingFeatures.has(featureId)) fail('CYCLIC_FEATURE_DEPENDENCY', path + ' contains a feature dependency cycle: ' + [...chain, featureId].join(' -> ') + '.');
    if (visitedFeatures.has(featureId)) return;
    visitingFeatures.add(featureId);
    for (const dependencyId of featureDependencies.get(featureId) || []) {
      if (!featureIds.has(dependencyId)) fail('MISSING_REFERENCE', path + ' feature "' + featureId + '" references missing feature "' + dependencyId + '".');
      visitFeature(dependencyId, [...chain, featureId]);
    }
    visitingFeatures.delete(featureId);
    visitedFeatures.add(featureId);
  }
  for (const featureId of featureIds) visitFeature(featureId, []);
  for (const [featureId, dependencyIds] of featureDependencies) {
    for (const dependencyId of dependencyIds) {
      if (orderIndex.get(dependencyId) >= orderIndex.get(featureId)) {
        fail('INVALID_FEATURE_ORDER', path + ' feature "' + featureId + '" must come after dependency "' + dependencyId + '".');
      }
    }
  }

  const bodyIds = new Set();
  requireArray(part.bodies, path + '.bodies', STUDIO_V5_PROJECT_LIMITS.featuresPerPart)
    .forEach((body, index) => validateBody(body, path + '.bodies[' + index + ']', bodyIds, projectIds.bodyIds, featureIds, materialIds));

  const bodyPatternIds = new Set();
  const datumKinds = new Map(part.referenceGeometry.map((datum) => [datum.id, datum.kind]));
  const sketchRoles = new Map(part.sketches.map((sketch) => [sketch.id, sketch.extensions?.studioRole]));
  requireArray(part.bodyPatterns === undefined ? [] : part.bodyPatterns, path + '.bodyPatterns', STUDIO_V5_PROJECT_LIMITS.featuresPerPart)
    .forEach((pattern, index) => validateBodyPattern(
      pattern,
      path + '.bodyPatterns[' + index + ']',
      partId,
      bodyIds,
      featureIds,
      datumIds,
      sketchIds,
      datumKinds,
      sketchRoles,
      partParameterValues,
      bodyPatternIds,
      projectIds.patternIds,
      counters,
    ));

  for (const [index, body] of part.bodies.entries()) {
    let previousOrder = -1;
    for (const featureId of body.featureIds) {
      const nextOrder = orderIndex.get(featureId);
      if (nextOrder < previousOrder) fail('INVALID_BODY', path + '.bodies[' + index + '].featureIds must follow part feature order.');
      previousOrder = nextOrder;
    }
  }

  const bodyById = new Map(part.bodies.map((body) => [body.id, body]));
  const bodyDependencies = new Map(part.bodies.map((body) => [body.id, new Set()]));
  for (const [index, feature] of featureEntries.entries()) {
    const policy = feature.resultPolicy;
    let affectedBodyIds;
    if (policy.kind === 'new-body' || policy.kind === 'surface') {
      affectedBodyIds = part.bodies.filter((body) => body.createdByFeatureId === feature.id).map((body) => body.id);
      if (affectedBodyIds.length !== 1) {
        fail('INVALID_BODY_OWNERSHIP', path + '.features[' + index + '] must create exactly one body for result policy "' + policy.kind + '".');
      }
      const createdBody = bodyById.get(affectedBodyIds[0]);
      const expectedKind = policy.kind === 'surface' ? 'surface' : 'solid';
      if (createdBody.kind !== expectedKind) {
        fail('INVALID_BODY_OWNERSHIP', path + '.features[' + index + '] creates a ' + createdBody.kind + ' body under a ' + policy.kind + ' result policy.');
      }
    } else {
      affectedBodyIds = policy.targetBodyIds;
      if (part.bodies.some((body) => body.createdByFeatureId === feature.id)) {
        fail('INVALID_BODY_OWNERSHIP', path + '.features[' + index + '] cannot create a body under a ' + policy.kind + ' result policy.');
      }
    }
    const expected = new Set(affectedBodyIds);
    for (const bodyId of expected) {
      const affectedBody = bodyById.get(bodyId);
      if (!affectedBody) {
        fail('MISSING_REFERENCE', path + '.features[' + index + '].resultPolicy references missing body "' + bodyId + '".');
      }
      if (!affectedBody.featureIds.includes(feature.id)) {
        fail('INVALID_BODY_OWNERSHIP', path + ' body "' + bodyId + '" is missing affected feature "' + feature.id + '" from its history.');
      }
    }
    for (const body of part.bodies) {
      if (body.featureIds.includes(feature.id) && !expected.has(body.id)) {
        fail('INVALID_BODY_OWNERSHIP', path + ' body "' + body.id + '" contains feature "' + feature.id + '" that does not target it.');
      }
    }
    if (feature.type === 'boolean') {
      if (policy.kind !== 'add' && policy.kind !== 'subtract' && policy.kind !== 'intersect') {
        fail('INVALID_FEATURE', path + '.features[' + index + '] Boolean result policy must be add, subtract, or intersect.');
      }
      if (feature.operation !== policy.kind) {
        fail('INVALID_FEATURE', path + '.features[' + index + '].operation must match its Boolean result policy.');
      }
      const toolBodyIds = requireArray(feature.toolBodyIds, path + '.features[' + index + '].toolBodyIds', STUDIO_V5_PROJECT_LIMITS.featuresPerPart);
      if (!toolBodyIds.length) fail('INVALID_FEATURE', path + '.features[' + index + '] Boolean must reference at least one tool body.');
      const seenTools = new Set();
      toolBodyIds.forEach((toolBodyId, toolIndex) => {
        const id = requireId(toolBodyId, path + '.features[' + index + '].toolBodyIds[' + toolIndex + ']');
        if (!bodyIds.has(id)) fail('MISSING_REFERENCE', path + '.features[' + index + '].toolBodyIds[' + toolIndex + '] does not resolve in this part.');
        if (seenTools.has(id)) fail('DUPLICATE_REFERENCE', path + '.features[' + index + '] repeats tool body "' + id + '".');
        if (policy.targetBodyIds.includes(id)) fail('INVALID_FEATURE', path + '.features[' + index + '] cannot use a target body as its own Boolean tool.');
        seenTools.add(id);
        for (const targetBodyId of policy.targetBodyIds) bodyDependencies.get(targetBodyId).add(id);
      });
    } else if (feature.type === 'transform') {
      const sourceBodyId = requireId(feature.sourceBodyId, path + '.features[' + index + '].sourceBodyId');
      const sourceBody = bodyById.get(sourceBodyId);
      if (!sourceBody) fail('MISSING_REFERENCE', path + '.features[' + index + '].sourceBodyId does not resolve in this part.');
      const sourceCreationOrder = orderIndex.get(sourceBody.createdByFeatureId);
      if (sourceCreationOrder >= orderIndex.get(feature.id)) {
        fail('INVALID_FEATURE_ORDER', path + '.features[' + index + '] must come after its source body creation feature.');
      }
      const mode = feature.transform?.mode || feature.operation;
      if (!['move', 'translate', 'copy', 'rotate', 'align', 'mirror', 'scale'].includes(mode)) {
        fail('INVALID_FEATURE', path + '.features[' + index + '] has an unsupported transform mode.');
      }
      if (policy.kind === 'new-body') {
        const createdBody = part.bodies.find((body) => body.createdByFeatureId === feature.id);
        if (!createdBody || createdBody.id === sourceBodyId) fail('INVALID_FEATURE', path + '.features[' + index + '] must create a distinct linked body.');
        bodyDependencies.get(createdBody.id).add(sourceBodyId);
      } else if (!policy.targetBodyIds.includes(sourceBodyId)) {
        fail('INVALID_FEATURE', path + '.features[' + index + '] must target its source body unless it creates a copy.');
      }
    }
  }

  const visitingBodies = new Set();
  const visitedBodies = new Set();
  function visitBody(bodyId, chain) {
    if (visitingBodies.has(bodyId)) fail('CYCLIC_BODY_DEPENDENCY', path + ' contains a body dependency cycle: ' + [...chain, bodyId].join(' -> ') + '.');
    if (visitedBodies.has(bodyId)) return;
    visitingBodies.add(bodyId);
    for (const dependencyId of bodyDependencies.get(bodyId) || []) visitBody(dependencyId, [...chain, bodyId]);
    visitingBodies.delete(bodyId);
    visitedBodies.add(bodyId);
  }
  for (const bodyId of bodyIds) visitBody(bodyId, []);

  for (const [index, feature] of featureEntries.entries()) {
    const policy = feature.resultPolicy;
    if (policy.kind === 'add' || policy.kind === 'subtract' || policy.kind === 'intersect') {
      policy.targetBodyIds.forEach((targetId, targetIndex) => {
        if (!bodyIds.has(targetId)) fail('MISSING_REFERENCE', path + '.features[' + index + '].resultPolicy.targetBodyIds[' + targetIndex + '] does not resolve in this part.');
      });
    }
    for (const [referenceIndex, reference] of feature.inputRefs.entries()) {
      validatePartReferenceContext(
        reference,
        path + '.features[' + index + '].inputRefs[' + referenceIndex + ']',
        partId,
        bodyIds,
        featureIds,
        datumIds,
        sketchIds,
      );
    }
  }

  for (const [index, sketch] of part.sketches.entries()) {
    if (sketch.support != null) {
      validatePartReferenceContext(sketch.support, path + '.sketches[' + index + '].support', partId, bodyIds, featureIds, datumIds, sketchIds);
    }
  }

  if (part.defaultAppearanceId != null) requireId(part.defaultAppearanceId, path + '.defaultAppearanceId');
  validateOptionalRecord(part.metadata, path + '.metadata');
  validateOptionalRecord(part.extensions, path + '.extensions');
}

function validateOccurrence(occurrence, path, seenIds, globalIds, parameterValues) {
  requireRecord(occurrence, path);
  const id = requireId(occurrence.id, path + '.id');
  addUnique(seenIds, id, path, 'occurrence');
  addUnique(globalIds, id, path, 'project occurrence');
  requireName(occurrence.name, path + '.name');
  validateDocumentRef(occurrence.definition, path + '.definition');
  if (occurrence.parentOccurrenceId != null) requireId(occurrence.parentOccurrenceId, path + '.parentOccurrenceId');
  const matrix = requireArray(occurrence.baseTransform, path + '.baseTransform', 16);
  if (matrix.length !== 16 || !matrix.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    fail('INVALID_TRANSFORM', path + '.baseTransform must contain 16 finite numbers.');
  }
  if (matrix.length === 16) {
    const columns = [[matrix[0], matrix[1], matrix[2]], [matrix[4], matrix[5], matrix[6]], [matrix[8], matrix[9], matrix[10]]];
    const dot3 = (left, right) => left.reduce((total, value, index) => total + value * right[index], 0);
    const determinant =
      columns[0][0] * (columns[1][1] * columns[2][2] - columns[1][2] * columns[2][1]) -
      columns[1][0] * (columns[0][1] * columns[2][2] - columns[0][2] * columns[2][1]) +
      columns[2][0] * (columns[0][1] * columns[1][2] - columns[0][2] * columns[1][1]);
    const rigid = columns.every((column) => Math.abs(dot3(column, column) - 1) <= 1e-8) &&
      Math.abs(dot3(columns[0], columns[1])) <= 1e-8 && Math.abs(dot3(columns[0], columns[2])) <= 1e-8 && Math.abs(dot3(columns[1], columns[2])) <= 1e-8 &&
      Math.abs(determinant - 1) <= 1e-8 && Math.abs(matrix[3]) <= 1e-10 && Math.abs(matrix[7]) <= 1e-10 && Math.abs(matrix[11]) <= 1e-10 && Math.abs(matrix[15] - 1) <= 1e-10;
    if (!rigid) fail('INVALID_TRANSFORM', path + '.baseTransform must be a rigid right-handed transform without scale, shear, reflection, or perspective.');
  }
  requireBoolean(occurrence.fixed, path + '.fixed');
  requireBoolean(occurrence.suppressed, path + '.suppressed');
  requireBoolean(occurrence.visible, path + '.visible');
  if (occurrence.appearanceOverrideId != null) requireId(occurrence.appearanceOverrideId, path + '.appearanceOverrideId');
  if (occurrence.parameterOverrides != null) {
    requireRecord(occurrence.parameterOverrides, path + '.parameterOverrides');
    for (const [name, value] of Object.entries(occurrence.parameterOverrides)) {
      if (!PARAMETER_NAME_PATTERN.test(name) || !expressionLike(value)) fail('INVALID_PARAMETER_OVERRIDE', path + '.parameterOverrides.' + name + ' is invalid.');
      parseSafeExpression(value, path + '.parameterOverrides.' + name, new Set(parameterValues.keys())).evaluate((parameterName) => parameterValues.get(parameterName));
    }
  }
  validateOptionalRecord(occurrence.extensions, path + '.extensions');
}

function validateMate(mate, path, occurrenceIds, seenIds, globalIds, parameterValues) {
  requireRecord(mate, path);
  const id = requireId(mate.id, path + '.id');
  addUnique(seenIds, id, path, 'mate');
  addUnique(globalIds, id, path, 'project mate');
  requireName(mate.name, path + '.name');
  if (!MATE_KINDS.has(mate.kind)) fail('INVALID_MATE', path + '.kind is unsupported.');
  const selectedOccurrences = requireArray(mate.occurrenceIds, path + '.occurrenceIds', STUDIO_V5_PROJECT_LIMITS.occurrences);
  const expectedOccurrences = mate.kind === 'fixed' ? 1 : 2;
  const selectedOccurrenceIds = new Set();
  selectedOccurrences.forEach((occurrenceId, index) => {
    const idValue = requireId(occurrenceId, path + '.occurrenceIds[' + index + ']');
    if (!occurrenceIds.has(idValue)) fail('MISSING_REFERENCE', path + '.occurrenceIds[' + index + '] does not resolve in this assembly.');
    if (selectedOccurrenceIds.has(idValue)) fail('DUPLICATE_REFERENCE', path + '.occurrenceIds repeats occurrence "' + idValue + '".');
    selectedOccurrenceIds.add(idValue);
  });
  if (selectedOccurrences.length !== expectedOccurrences) fail('INVALID_MATE', path + '.occurrenceIds must contain exactly ' + expectedOccurrences + ' occurrence' + (expectedOccurrences === 1 ? '' : 's') + ' for a ' + mate.kind + ' mate.');
  const references = requireArray(mate.references, path + '.references', 10);
  const expectedReferences = mate.kind === 'fixed' ? [0, 1] : [2];
  if (!expectedReferences.includes(references.length)) fail('INVALID_MATE', path + '.references has the wrong number of explicit references for a ' + mate.kind + ' mate.');
  references.forEach((reference, index) => validateGeometryReference(reference, path + '.references[' + index + ']'));
  if (mate.value != null) {
    parseSafeExpression(mate.value, path + '.value', new Set(parameterValues.keys())).evaluate((parameterName) => parameterValues.get(parameterName));
  }
  requireBoolean(mate.suppressed, path + '.suppressed');
  validateOptionalRecord(mate.extensions, path + '.extensions');
}

function validateOccurrencePattern(pattern, path, occurrenceIds, seenIds, globalIds, counters) {
  requireRecord(pattern, path);
  const id = requireId(pattern.id, path + '.id');
  addUnique(seenIds, id, path, 'occurrence pattern');
  addUnique(globalIds, id, path, 'project occurrence pattern');
  requireName(pattern.name, path + '.name');
  if (!PATTERN_KINDS.has(pattern.kind)) fail('INVALID_PATTERN', path + '.kind is unsupported.');
  const sourceIds = requireArray(pattern.sourceOccurrenceIds, path + '.sourceOccurrenceIds', STUDIO_V5_PROJECT_LIMITS.occurrences);
  if (sourceIds.length === 0) fail('INVALID_PATTERN', path + '.sourceOccurrenceIds must not be empty.');
  const sourceOccurrenceIds = new Set();
  sourceIds.forEach((occurrenceId, index) => {
    const idValue = requireId(occurrenceId, path + '.sourceOccurrenceIds[' + index + ']');
    if (!occurrenceIds.has(idValue)) fail('MISSING_REFERENCE', path + '.sourceOccurrenceIds[' + index + '] does not resolve in this assembly.');
    if (sourceOccurrenceIds.has(idValue)) fail('DUPLICATE_REFERENCE', path + '.sourceOccurrenceIds repeats occurrence "' + idValue + '".');
    sourceOccurrenceIds.add(idValue);
  });
  const generatedCount = requireInteger(pattern.generatedCount, path + '.generatedCount', 1, STUDIO_V5_PROJECT_LIMITS.generatedOccurrences);
  counters.generatedOccurrences += generatedCount;
  if (counters.generatedOccurrences > STUDIO_V5_PROJECT_LIMITS.generatedOccurrences) {
    fail('LIMIT_GENERATED_OCCURRENCES', 'Project exceeds the 5,000-generated-occurrence limit.');
  }
  requireRecord(pattern.definition, path + '.definition');
  requireBoolean(pattern.suppressed, path + '.suppressed');
  validateOptionalRecord(pattern.extensions, path + '.extensions');
}

function detectParentOccurrenceCycles(occurrences, path) {
  const byId = new Map(occurrences.map((occurrence) => [occurrence.id, occurrence]));
  for (const occurrence of occurrences) {
    if (occurrence.parentOccurrenceId != null && !byId.has(occurrence.parentOccurrenceId)) {
      fail('MISSING_REFERENCE', path + ' occurrence "' + occurrence.id + '" has a missing parentOccurrenceId.');
    }
    const active = new Set();
    let current = occurrence;
    while (current?.parentOccurrenceId != null) {
      if (active.has(current.id)) fail('CYCLIC_OCCURRENCE_PARENT', path + ' contains a parent-occurrence cycle at "' + current.id + '".');
      active.add(current.id);
      current = byId.get(current.parentOccurrenceId);
    }
  }
}

function validateAssembly(assembly, path, counters, projectIds, projectParameterValues) {
  requireRecord(assembly, path);
  const assemblyId = requireId(assembly.id, path + '.id');
  addUnique(projectIds.assemblyIds, assemblyId, path, 'assembly');
  requireName(assembly.name, path + '.name');
  const parameterValues = validateParameterArray(
    assembly.parameters,
    path + '.parameters',
    counters.parameters,
    projectIds.parameterIds,
    projectParameterValues,
  );

  const occurrences = requireArray(assembly.occurrences, path + '.occurrences', STUDIO_V5_PROJECT_LIMITS.occurrences, 'LIMIT_OCCURRENCES');
  counters.occurrences += occurrences.length;
  if (counters.occurrences > STUDIO_V5_PROJECT_LIMITS.occurrences) fail('LIMIT_OCCURRENCES', 'Project exceeds the 2,000-explicit-occurrence limit.');
  const occurrenceIds = new Set();
  occurrences.forEach((occurrence, index) => validateOccurrence(
    occurrence,
    path + '.occurrences[' + index + ']',
    occurrenceIds,
    projectIds.occurrenceIds,
    parameterValues,
  ));
  detectParentOccurrenceCycles(occurrences, path + '.occurrences');

  const mateIds = new Set();
  requireArray(assembly.mates, path + '.mates', STUDIO_V5_PROJECT_LIMITS.occurrences)
    .forEach((mate, index) => validateMate(
      mate,
      path + '.mates[' + index + ']',
      occurrenceIds,
      mateIds,
      projectIds.mateIds,
      parameterValues,
    ));

  const patternIds = new Set();
  requireArray(assembly.occurrencePatterns, path + '.occurrencePatterns', STUDIO_V5_PROJECT_LIMITS.occurrences)
    .forEach((pattern, index) => validateOccurrencePattern(
      pattern,
      path + '.occurrencePatterns[' + index + ']',
      occurrenceIds,
      patternIds,
      projectIds.patternIds,
      counters,
    ));

  const explodedIds = new Set();
  requireArray(assembly.explodedViews, path + '.explodedViews', 1000).forEach((view, index) => {
    const viewPath = path + '.explodedViews[' + index + ']';
    requireRecord(view, viewPath);
    const id = requireId(view.id, viewPath + '.id');
    addUnique(explodedIds, id, viewPath, 'exploded view');
    addUnique(projectIds.explodedViewIds, id, viewPath, 'project exploded view');
    requireName(view.name, viewPath + '.name');
    requireArray(view.steps, viewPath + '.steps', STUDIO_V5_PROJECT_LIMITS.occurrences)
      .forEach((step, stepIndex) => requireRecord(step, viewPath + '.steps[' + stepIndex + ']'));
    validateOptionalRecord(view.extensions, viewPath + '.extensions');
  });

  const sectionIds = new Set();
  requireArray(assembly.sectionViews, path + '.sectionViews', 1000).forEach((view, index) => {
    const viewPath = path + '.sectionViews[' + index + ']';
    requireRecord(view, viewPath);
    const id = requireId(view.id, viewPath + '.id');
    addUnique(sectionIds, id, viewPath, 'section view');
    addUnique(projectIds.sectionViewIds, id, viewPath, 'project section view');
    requireName(view.name, viewPath + '.name');
    if (!SECTION_KINDS.has(view.kind)) fail('INVALID_SECTION', viewPath + '.kind is unsupported.');
    requireRecord(view.definition, viewPath + '.definition');
    validateOptionalRecord(view.extensions, viewPath + '.extensions');
  });
  validateOptionalRecord(assembly.metadata, path + '.metadata');
  validateOptionalRecord(assembly.extensions, path + '.extensions');
}

function documentRefKey(ref) {
  return ref.kind === 'part' ? 'part:' + ref.partId : 'assembly:' + ref.assemblyId;
}

function validateResolvedDocumentRef(ref, path, projectIds) {
  if (ref.kind === 'part' && !projectIds.partIds.has(ref.partId)) fail('MISSING_REFERENCE', path + ' does not resolve to a part definition.');
  if (ref.kind === 'assembly' && !projectIds.assemblyIds.has(ref.assemblyId)) fail('MISSING_REFERENCE', path + ' does not resolve to an assembly definition.');
}

function validateAssemblyContainment(parts, assemblies, projectIds) {
  const byId = new Map(assemblies.map((assembly) => [assembly.id, assembly]));
  const partsById = new Map(parts.map((part) => [part.id, part]));
  for (const assembly of assemblies) {
    for (const [index, occurrence] of assembly.occurrences.entries()) {
      validateResolvedDocumentRef(occurrence.definition, 'assemblyDefinitions[' + assembly.id + '].occurrences[' + index + '].definition', projectIds);
      if (occurrence.parameterOverrides != null) {
        const definition = occurrence.definition.kind === 'part'
          ? partsById.get(occurrence.definition.partId)
          : byId.get(occurrence.definition.assemblyId);
        const parameterNames = new Set(definition.parameters.map((parameter) => parameter.name));
        for (const name of Object.keys(occurrence.parameterOverrides)) {
          if (!parameterNames.has(name)) {
            fail('MISSING_REFERENCE', 'assemblyDefinitions[' + assembly.id + '].occurrences[' + index + '].parameterOverrides.' + name + ' does not resolve in the component definition.');
          }
        }
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(assemblyId, chain) {
    if (visiting.has(assemblyId)) fail('CYCLIC_ASSEMBLY', 'Assembly containment cycle: ' + [...chain, assemblyId].join(' -> ') + '.');
    if (visited.has(assemblyId)) return;
    visiting.add(assemblyId);
    const assembly = byId.get(assemblyId);
    for (const occurrence of assembly.occurrences) {
      if (occurrence.definition.kind === 'assembly') visit(occurrence.definition.assemblyId, [...chain, assemblyId]);
    }
    visiting.delete(assemblyId);
    visited.add(assemblyId);
  }
  for (const assembly of assemblies) visit(assembly.id, []);
}

function base64Value(characterCode) {
  if (characterCode >= 65 && characterCode <= 90) return characterCode - 65;
  if (characterCode >= 97 && characterCode <= 122) return characterCode - 71;
  if (characterCode >= 48 && characterCode <= 57) return characterCode + 4;
  if (characterCode === 43) return 62;
  if (characterCode === 47) return 63;
  return -1;
}

function canonicalBase64DecodedBytes(data, path) {
  const maximumEncodedBytes = Math.ceil(STUDIO_V5_PROJECT_LIMITS.resourcesBytes * 4 / 3) + 4;
  if (data.length > maximumEncodedBytes || data.length % 4 !== 0) {
    fail('INVALID_RESOURCE', path + ' must be bounded canonical base64.');
  }
  if (data.length === 0) return 0;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const contentLength = data.length - padding;
  for (let index = 0; index < contentLength; index++) {
    if (base64Value(data.charCodeAt(index)) < 0) fail('INVALID_RESOURCE', path + ' contains a non-base64 character.');
  }
  for (let index = contentLength; index < data.length; index++) {
    if (data.charCodeAt(index) !== 61) fail('INVALID_RESOURCE', path + ' has invalid base64 padding.');
  }
  if (padding === 2 && (base64Value(data.charCodeAt(data.length - 3)) & 15) !== 0) {
    fail('INVALID_RESOURCE', path + ' has non-canonical base64 padding bits.');
  }
  if (padding === 1 && (base64Value(data.charCodeAt(data.length - 2)) & 3) !== 0) {
    fail('INVALID_RESOURCE', path + ' has non-canonical base64 padding bits.');
  }
  return data.length / 4 * 3 - padding;
}

function validateGeometryReferenceResolution(parts, assemblies, projectIds) {
  const featurePartId = new Map();
  const bodyPartId = new Map();
  const datumPartId = new Map();
  const sketchPartId = new Map();
  for (const part of parts) {
    part.features.forEach((feature) => featurePartId.set(feature.id, part.id));
    part.bodies.forEach((body) => bodyPartId.set(body.id, part.id));
    part.referenceGeometry.forEach((datum) => datumPartId.set(datum.id, part.id));
    part.sketches.forEach((sketch) => sketchPartId.set(sketch.id, part.id));
  }
  const occurrenceById = new Map();
  const occurrenceAssemblyId = new Map();
  for (const assembly of assemblies) {
    for (const occurrence of assembly.occurrences) {
      occurrenceById.set(occurrence.id, occurrence);
      occurrenceAssemblyId.set(occurrence.id, assembly.id);
    }
  }

  function ownerPart(reference) {
    if (reference.ownerKind === 'part') return reference.ownerId;
    if (reference.ownerKind === 'body') return bodyPartId.get(reference.ownerId);
    if (reference.ownerKind === 'feature') return featurePartId.get(reference.ownerId);
    if (reference.ownerKind === 'datum') return datumPartId.get(reference.ownerId);
    if (reference.ownerKind === 'sketch') return sketchPartId.get(reference.ownerId);
    return undefined;
  }

  function validateReference(reference, path, selectedOccurrenceIds) {
    const ownerSet = reference.ownerKind === 'part'
      ? projectIds.partIds
      : reference.ownerKind === 'body'
        ? projectIds.bodyIds
        : reference.ownerKind === 'feature'
          ? projectIds.featureIds
          : reference.ownerKind === 'datum'
            ? projectIds.datumIds
            : reference.ownerKind === 'sketch'
              ? projectIds.sketchIds
          : projectIds.occurrenceIds;
    if (!ownerSet.has(reference.ownerId)) fail('MISSING_REFERENCE', path + ' does not resolve to an existing ' + reference.ownerKind + ' owner.');

    const occurrencePath = reference.occurrencePath;
    if (!occurrencePath?.length) {
      if (selectedOccurrenceIds) {
        if (reference.ownerKind !== 'occurrence' || !selectedOccurrenceIds.has(reference.ownerId)) {
          fail('INVALID_REFERENCE', path + ' must resolve through one of the mate occurrence paths.');
        }
      }
      return;
    }
    if (selectedOccurrenceIds && !selectedOccurrenceIds.has(occurrencePath[0])) {
      fail('INVALID_REFERENCE', path + '.occurrencePath must begin with one of the mate occurrences.');
    }
    for (let index = 0; index < occurrencePath.length; index++) {
      const occurrenceId = occurrencePath[index];
      const occurrence = occurrenceById.get(occurrenceId);
      if (!occurrence) fail('MISSING_REFERENCE', path + '.occurrencePath[' + index + '] does not resolve to an occurrence.');
      if (index > 0) {
        const parent = occurrenceById.get(occurrencePath[index - 1]);
        if (parent.definition.kind !== 'assembly' || parent.definition.assemblyId !== occurrenceAssemblyId.get(occurrenceId)) {
          fail('INVALID_REFERENCE', path + '.occurrencePath is not a valid nested component chain.');
        }
      }
    }
    const terminalId = occurrencePath[occurrencePath.length - 1];
    const terminal = occurrenceById.get(terminalId);
    if (reference.ownerKind === 'occurrence') {
      if (terminalId !== reference.ownerId) fail('INVALID_REFERENCE', path + '.occurrencePath does not terminate at its occurrence owner.');
      return;
    }
    const partId = ownerPart(reference);
    if (terminal.definition.kind !== 'part' || terminal.definition.partId !== partId) {
      fail('INVALID_REFERENCE', path + '.occurrencePath does not terminate at the owner part.');
    }
  }

  for (const [partIndex, part] of parts.entries()) {
    for (const [sketchIndex, sketch] of part.sketches.entries()) {
      if (sketch.support != null) validateReference(sketch.support, 'partDefinitions[' + partIndex + '].sketches[' + sketchIndex + '].support');
    }
    for (const [featureIndex, feature] of part.features.entries()) {
      feature.inputRefs.forEach((reference, referenceIndex) => validateReference(
        reference,
        'partDefinitions[' + partIndex + '].features[' + featureIndex + '].inputRefs[' + referenceIndex + ']',
      ));
    }
  }
  for (const [assemblyIndex, assembly] of assemblies.entries()) {
    for (const [mateIndex, mate] of assembly.mates.entries()) {
      const selectedOccurrenceIds = new Set(mate.occurrenceIds);
      mate.references.forEach((reference, referenceIndex) => validateReference(
        reference,
        'assemblyDefinitions[' + assemblyIndex + '].mates[' + mateIndex + '].references[' + referenceIndex + ']',
        selectedOccurrenceIds,
      ));
    }
  }
}

function validateResource(resource, path, seenIds, counters) {
  requireRecord(resource, path);
  const id = requireId(resource.id, path + '.id');
  addUnique(seenIds, id, path, 'resource');
  requireName(resource.name, path + '.name');
  if (typeof resource.mimeType !== 'string' || !RESOURCE_MIME_TYPES.has(resource.mimeType)) fail('INVALID_RESOURCE', path + '.mimeType is not allowed.');
  const byteLength = requireInteger(resource.byteLength, path + '.byteLength', 0, STUDIO_V5_PROJECT_LIMITS.resourcesBytes);
  counters.resourceBytes += byteLength;
  if (counters.resourceBytes > STUDIO_V5_PROJECT_LIMITS.resourcesBytes) fail('LIMIT_RESOURCE_BYTES', 'Project resources exceed the 100 MB decoded limit.');
  if (resource.data != null) {
    if (resource.encoding !== 'base64' || typeof resource.data !== 'string') {
      fail('INVALID_RESOURCE', path + '.data must be canonical base64 with encoding "base64".');
    }
    const decodedBytes = canonicalBase64DecodedBytes(resource.data, path + '.data');
    if (decodedBytes !== byteLength) fail('INVALID_RESOURCE', path + '.byteLength does not match embedded base64 data.');
  } else if (resource.encoding != null) fail('INVALID_RESOURCE', path + '.encoding requires embedded data.');
  validateOptionalRecord(resource.extensions, path + '.extensions');
}

export function prepareStudioV5Project(candidate) {
  if (!isRecord(candidate)) fail('INVALID_PROJECT', 'Project root must be an object.');
  validateJsonTree(candidate);
  if (documentBytesWithoutEmbeddedResources(candidate) > STUDIO_V5_PROJECT_LIMITS.bytes) {
    fail('LIMIT_BYTES', 'Project exceeds the 20 MB canonical JSON limit before embedded resources.');
  }
  if (!Number.isInteger(candidate.schemaVersion) || candidate.schemaVersion < 1) fail('INVALID_SCHEMA', 'Project schemaVersion must be a positive integer.');
  if (candidate.schemaVersion > STUDIO_V5_SCHEMA_VERSION) {
    fail('NEWER_SCHEMA', 'This project uses schema ' + candidate.schemaVersion + '; this build supports schema ' + STUDIO_V5_SCHEMA_VERSION + '.');
  }
  if (candidate.schemaVersion !== STUDIO_V5_SCHEMA_VERSION) fail('UNSUPPORTED_SCHEMA', 'The V5 boundary accepts schema 5 projects only; migrate older part documents explicitly.');
  requireId(candidate.projectId, 'project.projectId');
  requireName(candidate.name, 'project.name');
  if (candidate.units !== 'mm' && candidate.units !== 'in') fail('INVALID_UNITS', 'project.units must be mm or in.');

  const counters = {
    sketchEntities: 0,
    occurrences: 0,
    generatedOccurrences: 0,
    resourceBytes: 0,
    parameters: { count: 0 },
  };
  const projectIds = {
    partIds: new Set(),
    assemblyIds: new Set(),
    parameterIds: new Set(),
    datumIds: new Set(),
    sketchIds: new Set(),
    featureIds: new Set(),
    bodyIds: new Set(),
    occurrenceIds: new Set(),
    mateIds: new Set(),
    patternIds: new Set(),
    explodedViewIds: new Set(),
    sectionViewIds: new Set(),
  };
  const projectParameterValues = validateParameterArray(
    candidate.parameters,
    'project.parameters',
    counters.parameters,
    projectIds.parameterIds,
  );

  const materialEntries = requireArray(candidate.materials, 'project.materials', STUDIO_V5_PROJECT_LIMITS.materials, 'LIMIT_MATERIALS');
  const materialIds = new Set();
  materialEntries.forEach((material, index) => validateMaterial(material, 'project.materials[' + index + ']', materialIds));

  const parts = requireArray(candidate.partDefinitions, 'project.partDefinitions', STUDIO_V5_PROJECT_LIMITS.partDefinitions, 'LIMIT_PARTS');
  parts.forEach((part, index) => validatePart(
    part,
    'project.partDefinitions[' + index + ']',
    counters,
    projectIds,
    materialIds,
    projectParameterValues,
  ));

  const assemblies = requireArray(candidate.assemblyDefinitions, 'project.assemblyDefinitions', STUDIO_V5_PROJECT_LIMITS.assemblyDefinitions, 'LIMIT_ASSEMBLIES');
  assemblies.forEach((assembly, index) => validateAssembly(
    assembly,
    'project.assemblyDefinitions[' + index + ']',
    counters,
    projectIds,
    projectParameterValues,
  ));

  if (parts.length + assemblies.length === 0) fail('INVALID_PROJECT', 'Project must contain at least one part or assembly definition.');
  validateDocumentRef(candidate.rootDocument, 'project.rootDocument');
  validateResolvedDocumentRef(candidate.rootDocument, 'project.rootDocument', projectIds);
  validateAssemblyContainment(parts, assemblies, projectIds);
  validateGeometryReferenceResolution(parts, assemblies, projectIds);

  const resourceEntries = requireArray(candidate.resources, 'project.resources', STUDIO_V5_PROJECT_LIMITS.resources, 'LIMIT_RESOURCES');
  const resourceIds = new Set();
  resourceEntries.forEach((resource, index) => validateResource(resource, 'project.resources[' + index + ']', resourceIds, counters));
  requireRecord(candidate.metadata, 'project.metadata');
  validateOptionalRecord(candidate.extensions, 'project.extensions');

  return clone(candidate);
}

export function parseStudioV5Project(text) {
  if (typeof text !== 'string') fail('INVALID_FILE', 'Project file must be text.');
  if (utf8Bytes(text, STUDIO_V5_PROJECT_LIMITS.fileBytes) > STUDIO_V5_PROJECT_LIMITS.fileBytes) fail('LIMIT_FILE_BYTES', 'Project file exceeds the 160 MB encoded limit.');
  let candidate;
  try {
    candidate = JSON.parse(text);
  } catch {
    fail('INVALID_JSON', 'Project file is not valid JSON.');
  }
  return prepareStudioV5Project(candidate);
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
}

function stableHash(value) {
  const source = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function cleanIdFragment(value, fallback) {
  const cleaned = String(value || '').trim().replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return cleaned && ID_PATTERN.test(cleaned) ? cleaned : fallback;
}

function legacyV4Boundary(candidate) {
  validateJsonTree(candidate);
  if (jsonBytes(candidate) > STUDIO_V5_PROJECT_LIMITS.bytes) fail('LIMIT_BYTES', 'Legacy project exceeds the 20 MB migration limit.');
  if (!Array.isArray(candidate.features) || !Array.isArray(candidate.params)) {
    fail('INVALID_LEGACY_DOCUMENT', 'Schema-4 migration input must expose features and params arrays until the final V4 adapter replaces this boundary.');
  }
  if (candidate.features.length > STUDIO_V5_PROJECT_LIMITS.featuresPerPart) fail('LIMIT_FEATURES', 'Legacy part exceeds the 2,000-feature V5 migration limit.');
  if (candidate.params.length > STUDIO_V5_PROJECT_LIMITS.parameters) fail('LIMIT_PARAMETERS', 'Legacy part exceeds the 5,000-parameter V5 migration limit.');
  const ids = new Set();
  candidate.features.forEach((feature, index) => {
    requireRecord(feature, 'legacy.features[' + index + ']');
    const id = requireId(feature.id, 'legacy.features[' + index + '].id');
    addUnique(ids, id, 'legacy.features[' + index + ']', 'legacy feature');
  });
  return clone(candidate);
}

function migrateLegacyParameter(parameter, index, prefix) {
  requireRecord(parameter, 'legacy.params[' + index + ']');
  if (typeof parameter.name !== 'string' || !PARAMETER_NAME_PATTERN.test(parameter.name)) {
    fail('INVALID_PARAMETER', 'legacy.params[' + index + '].name is invalid.');
  }
  if (!expressionLike(parameter.value)) fail('INVALID_PARAMETER', 'legacy.params[' + index + '].value is invalid.');
  const migrated = clone(parameter);
  migrated.id = ID_PATTERN.test(parameter.id || '') ? parameter.id : prefix + '-param-' + cleanIdFragment(parameter.name, String(index + 1));
  return migrated;
}

function inferredResultPolicy(feature, index, bodyId) {
  if (isRecord(feature.resultPolicy) && RESULT_KINDS.has(feature.resultPolicy.kind)) return clone(feature.resultPolicy);
  if (index === 0) return { kind: 'new-body', bodyName: 'Body 1' };
  if (feature.type === 'cut') return { kind: 'subtract', targetBodyIds: [bodyId], keepTools: false };
  return { kind: 'add', targetBodyIds: [bodyId] };
}

function migrateLegacyFeature(feature, index, bodyId) {
  const migrated = clone(feature);
  migrated.name = typeof feature.name === 'string' && feature.name.trim() ? feature.name.trim().slice(0, 200) : String(feature.type || 'Feature') + ' ' + (index + 1);
  migrated.suppressed = feature.suppressed === true;
  migrated.inputRefs = Array.isArray(feature.inputRefs) ? clone(feature.inputRefs) : [];
  migrated.resultPolicy = inferredResultPolicy(feature, index, bodyId);
  delete migrated.error;
  return migrated;
}

function legacyTopLevelExtensions(document) {
  const known = new Set(['schemaVersion', 'projectId', 'title', 'name', 'units', 'features', 'params', 'metadata', 'extensions']);
  const preserved = {};
  for (const [key, value] of Object.entries(document)) {
    if (!known.has(key)) preserved[key] = clone(value);
  }
  return preserved;
}

export function migrateStudioPartToV5(candidate, options = {}) {
  if (!isRecord(candidate)) fail('INVALID_LEGACY_DOCUMENT', 'Legacy part root must be an object.');
  let legacy;
  const sourceSchema = candidate.schemaVersion == null ? 3 : candidate.schemaVersion;
  if (sourceSchema === 3) legacy = prepareStudioDocument(candidate);
  else if (sourceSchema === 4) legacy = legacyV4Boundary(candidate);
  else if (sourceSchema === STUDIO_V5_SCHEMA_VERSION) return prepareStudioV5Project(candidate);
  else if (Number.isInteger(sourceSchema) && sourceSchema > STUDIO_V5_SCHEMA_VERSION) {
    fail('NEWER_SCHEMA', 'This project uses schema ' + sourceSchema + '; this build supports schema ' + STUDIO_V5_SCHEMA_VERSION + '.');
  } else fail('UNSUPPORTED_SCHEMA', 'Only unversioned/schema-3 parts, schema-4 parts, or schema-5 projects can enter the V5 migration boundary.');

  const fingerprint = stableHash(legacy);
  const requestedProjectId = options.projectId ?? legacy.projectId;
  if (requestedProjectId != null) requireId(requestedProjectId, 'migration.projectId');
  const projectId = requestedProjectId || 'project-migrated-' + fingerprint;
  const partId = 'part-migrated-' + fingerprint;
  const bodyId = 'body-migrated-' + fingerprint;
  const projectName = typeof legacy.title === 'string' && legacy.title.trim()
    ? legacy.title.trim().slice(0, 200)
    : typeof legacy.name === 'string' && legacy.name.trim()
      ? legacy.name.trim().slice(0, 200)
      : 'Untitled part';

  const parameters = legacy.params.map((parameter, index) => migrateLegacyParameter(parameter, index, projectId));
  const features = legacy.features.map((feature, index) => migrateLegacyFeature(feature, index, bodyId));
  const featureOrder = features.map((feature) => feature.id);
  const bodies = features.length
    ? [{
        id: bodyId,
        name: 'Body 1',
        kind: 'solid',
        createdByFeatureId: features[0].id,
        featureIds: [...featureOrder],
        visible: true,
        suppressed: false,
      }]
    : [];

  const project = {
    ...legacyTopLevelExtensions(legacy),
    schemaVersion: STUDIO_V5_SCHEMA_VERSION,
    projectId,
    name: projectName,
    units: legacy.units === 'in' ? 'in' : 'mm',
    parameters,
    materials: [],
    partDefinitions: [{
      id: partId,
      name: projectName,
      parameters: [],
      referenceGeometry: [],
      sketches: [],
      bodies,
      bodyPatterns: [],
      features,
      featureOrder,
      metadata: { migratedFromSchema: sourceSchema },
      extensions: {
        legacyPartDocument: true,
        sourceSchemaVersion: sourceSchema,
      },
    }],
    assemblyDefinitions: [],
    rootDocument: { kind: 'part', partId },
    resources: [],
    metadata: {
      ...(isRecord(legacy.metadata) ? clone(legacy.metadata) : {}),
      migratedFromSchema: sourceSchema,
    },
    extensions: {
      ...(isRecord(legacy.extensions) ? clone(legacy.extensions) : {}),
    },
  };
  return prepareStudioV5Project(project);
}

export function parseOrMigrateStudioV5Project(text, options = {}) {
  if (typeof text !== 'string') fail('INVALID_FILE', 'Project file must be text.');
  if (utf8Bytes(text, STUDIO_V5_PROJECT_LIMITS.fileBytes) > STUDIO_V5_PROJECT_LIMITS.fileBytes) fail('LIMIT_FILE_BYTES', 'Project file exceeds the 160 MB encoded migration limit.');
  let candidate;
  try {
    candidate = JSON.parse(text);
  } catch {
    fail('INVALID_JSON', 'Project file is not valid JSON.');
  }
  return migrateStudioPartToV5(candidate, options);
}

export function createEmptyStudioV5PartProject(options = {}) {
  const seed = {
    projectId: options.projectId || 'project-new',
    name: options.name || 'Untitled part',
    units: options.units || 'mm',
  };
  const fingerprint = stableHash(seed);
  if (options.projectId != null) requireId(options.projectId, 'options.projectId');
  const projectId = options.projectId || 'project-new-' + fingerprint;
  const partId = 'part-new-' + fingerprint;
  return prepareStudioV5Project({
    schemaVersion: STUDIO_V5_SCHEMA_VERSION,
    projectId,
    name: seed.name,
    units: seed.units,
    parameters: [],
    materials: [],
    partDefinitions: [{
      id: partId,
      name: seed.name,
      parameters: [],
      referenceGeometry: [],
      sketches: [],
      bodies: [],
      bodyPatterns: [],
      features: [],
      featureOrder: [],
    }],
    assemblyDefinitions: [],
    rootDocument: { kind: 'part', partId },
    resources: [],
    metadata: {},
  });
}

export function studioV5DocumentRefKey(ref) {
  validateDocumentRef(ref, 'documentRef');
  return documentRefKey(ref);
}
