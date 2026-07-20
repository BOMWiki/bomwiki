// Safe document boundary for the V4 implementation branch.
//
// Shipped V3 documents were unversioned. This module formalizes that exact
// shape as schema 3 so Slice 4B can deterministically migrate it to the final
// entity/constraint schema 4. It never mutates the caller's candidate.

export const STUDIO_SCHEMA_VERSION = 3;
export const PROJECT_LIMITS = Object.freeze({
  bytes: 10 * 1024 * 1024,
  features: 500,
  sketchShapes: 5000,
  params: 1000,
});

const FEATURE_TYPES = new Set(['extrude', 'cut', 'revolve', 'fillet', 'chamfer', 'shell']);
const SHAPE_TYPES = new Set(['rect', 'circle', 'poly']);

export class StudioDocumentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StudioDocumentError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new StudioDocumentError(code, message);
};

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function expressionLike(value) {
  return (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.trim().length > 0 && value.length <= 500);
}

function validatePoint(point, path) {
  if (!Array.isArray(point) || point.length !== 2 || !point.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    fail('INVALID_POINT', path + ' must be a finite [x, y] point.');
  }
}

function evaluateExpression(input, params) {
  if (typeof input === 'number') return input;
  const source = String(input);
  let index = 0;
  const skip = () => {
    while (source[index] === ' ') index++;
  };
  function factor() {
    skip();
    if (source[index] === '(') {
      index++;
      const value = expression();
      skip();
      if (source[index] !== ')') throw new Error('missing )');
      index++;
      return value;
    }
    if (source[index] === '-') {
      index++;
      return -factor();
    }
    let match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
    if (match) {
      index += match[0].length;
      if (!(match[0] in params)) throw new Error('unknown parameter');
      return params[match[0]];
    }
    match = /^\d+(\.\d+)?/.exec(source.slice(index));
    if (!match) throw new Error('bad expression');
    index += match[0].length;
    return Number(match[0]);
  }
  function term() {
    let value = factor();
    for (;;) {
      skip();
      if (source[index] === '*') {
        index++;
        value *= factor();
      } else if (source[index] === '/') {
        index++;
        value /= factor();
      } else return value;
    }
  }
  function expression() {
    let value = term();
    for (;;) {
      skip();
      if (source[index] === '+') {
        index++;
        value += term();
      } else if (source[index] === '-') {
        index++;
        value -= term();
      } else return value;
    }
  }
  const value = expression();
  skip();
  if (index !== source.length || !Number.isFinite(value)) throw new Error('expression is not finite');
  return value;
}

function validateExpression(value, path, params) {
  if (!expressionLike(value)) fail('INVALID_EXPRESSION', path + ' must be a number or supported expression.');
  try {
    return evaluateExpression(value, params);
  } catch {
    fail('INVALID_EXPRESSION', path + ' is not a supported finite expression.');
  }
}

function validateShape(shape, path, params) {
  if (!isRecord(shape) || !SHAPE_TYPES.has(shape.kind)) fail('INVALID_SHAPE', path + ' has an unsupported sketch shape.');
  if (shape.kind === 'rect') {
    for (const field of ['x', 'y', 'w', 'h']) {
      const evaluated = validateExpression(shape[field], path + '.' + field, params);
      if ((field === 'w' || field === 'h') && evaluated <= 0) fail('INVALID_SHAPE', path + '.' + field + ' must be positive.');
    }
  } else if (shape.kind === 'circle') {
    for (const field of ['x', 'y', 'r']) {
      const evaluated = validateExpression(shape[field], path + '.' + field, params);
      if (field === 'r' && evaluated <= 0) fail('INVALID_SHAPE', path + '.r must be positive.');
    }
  } else {
    if (!Array.isArray(shape.pts) || shape.pts.length < 3 || shape.pts.length > 5000) {
      fail('INVALID_SHAPE', path + '.pts must contain between 3 and 5,000 points.');
    }
    shape.pts.forEach((point, index) => validatePoint(point, path + '.pts[' + index + ']'));
  }
}

function finiteVector(value, length) {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function validateEdgeSignature(signature, path) {
  if (!isRecord(signature) || !finiteVector(signature.p, 3) || typeof signature.l !== 'number' || !Number.isFinite(signature.l) || signature.l < 0) {
    fail('INVALID_REFERENCE', path + ' must contain a finite point p and non-negative length l.');
  }
}

function validateFaceSignature(signature, path) {
  if (!isRecord(signature) || !finiteVector(signature.p, 3) || !finiteVector(signature.n, 3)) {
    fail('INVALID_REFERENCE', path + ' must contain finite point p and normal n vectors.');
  }
}

function validatePattern(pattern, path, params) {
  if (!isRecord(pattern) || (pattern.kind !== 'linear' && pattern.kind !== 'circular')) {
    fail('INVALID_PATTERN', path + '.kind must be linear or circular.');
  }
  const count = validateExpression(pattern.n, path + '.n', params);
  if (!Number.isInteger(count) || count < 2 || count > 100) fail('INVALID_PATTERN', path + '.n must evaluate to an integer from 2 to 100.');
  if (pattern.kind === 'linear') {
    const dx = validateExpression(pattern.dx, path + '.dx', params);
    const dy = validateExpression(pattern.dy, path + '.dy', params);
    if (dx === 0 && dy === 0) fail('INVALID_PATTERN', path + ' must have non-zero linear spacing.');
  } else {
    validateExpression(pattern.cx, path + '.cx', params);
    validateExpression(pattern.cy, path + '.cy', params);
  }
}

function validateFeature(feature, index, seenIds, shapeCounter, params) {
  const path = 'features[' + index + ']';
  if (!isRecord(feature)) fail('INVALID_FEATURE', path + ' must be an object.');
  if (typeof feature.id !== 'string' || !feature.id || feature.id.length > 200) fail('INVALID_FEATURE', path + '.id is required.');
  if (seenIds.has(feature.id)) fail('DUPLICATE_ID', 'Duplicate feature id "' + feature.id + '".');
  seenIds.add(feature.id);
  if (!FEATURE_TYPES.has(feature.type)) fail('INVALID_FEATURE', path + '.type is unsupported.');
  if (feature.type === 'fillet' || feature.type === 'chamfer') {
    if (!Array.isArray(feature.edges) || feature.edges.length === 0) fail('INVALID_REFERENCE', path + '.edges must contain at least one edge.');
    feature.edges.forEach((signature, signatureIndex) => validateEdgeSignature(signature, path + '.edges[' + signatureIndex + ']'));
    if (validateExpression(feature.r, path + '.r', params) <= 0) fail('INVALID_FEATURE', path + '.r must be positive.');
    return;
  }
  if (feature.type === 'shell') {
    if (!Array.isArray(feature.faces) || feature.faces.length === 0) fail('INVALID_REFERENCE', path + '.faces must contain at least one face.');
    feature.faces.forEach((signature, signatureIndex) => validateFaceSignature(signature, path + '.faces[' + signatureIndex + ']'));
    if (validateExpression(feature.t, path + '.t', params) <= 0) fail('INVALID_FEATURE', path + '.t must be positive.');
    return;
  }
  if (!isRecord(feature.sketch) || !Array.isArray(feature.sketch.shapes) || feature.sketch.shapes.length === 0) {
    fail('INVALID_SKETCH', path + '.sketch.shapes must contain at least one shape.');
  }
  shapeCounter.count += feature.sketch.shapes.length;
  if (shapeCounter.count > PROJECT_LIMITS.sketchShapes) {
    fail('LIMIT_SHAPES', 'Project exceeds the 5,000 sketch-shape limit.');
  }
  feature.sketch.shapes.forEach((shape, shapeIndex) => validateShape(shape, path + '.sketch.shapes[' + shapeIndex + ']', params));
  if (feature.sketch.z != null && (typeof feature.sketch.z !== 'number' || !Number.isFinite(feature.sketch.z))) {
    fail('INVALID_SKETCH', path + '.sketch.z must be a finite number.');
  }
  if (feature.onFace != null) validateFaceSignature(feature.onFace, path + '.onFace');
  if (feature.pattern != null) validatePattern(feature.pattern, path + '.pattern', params);
  if (feature.type === 'cut' && typeof feature.through !== 'boolean') fail('INVALID_FEATURE', path + '.through must be true or false.');
  if (feature.type !== 'revolve' && !feature.through && validateExpression(feature.h, path + '.h', params) <= 0) {
    fail('INVALID_FEATURE', path + '.h must be positive.');
  }
}

export function prepareStudioDocument(candidate) {
  if (!isRecord(candidate)) fail('INVALID_DOCUMENT', 'Project root must be an object.');
  if (candidate.schemaVersion != null) {
    if (!Number.isInteger(candidate.schemaVersion) || candidate.schemaVersion < 1) {
      fail('INVALID_SCHEMA', 'Project schemaVersion must be a positive integer.');
    }
    if (candidate.schemaVersion > STUDIO_SCHEMA_VERSION) {
      fail(
        'NEWER_SCHEMA',
        'This project uses schema ' + candidate.schemaVersion + '; this build supports up to schema ' + STUDIO_SCHEMA_VERSION + '.',
      );
    }
    if (candidate.schemaVersion !== STUDIO_SCHEMA_VERSION) {
      fail('UNSUPPORTED_SCHEMA', 'This build only accepts unversioned legacy projects or schema ' + STUDIO_SCHEMA_VERSION + '.');
    }
  }
  if (candidate.units != null && candidate.units !== 'mm' && candidate.units !== 'in') fail('INVALID_UNITS', 'Project units must be mm or in.');
  if (!Array.isArray(candidate.features)) fail('INVALID_DOCUMENT', 'Project features must be an array.');
  if (!Array.isArray(candidate.params)) fail('INVALID_DOCUMENT', 'Project params must be an array.');
  if (candidate.features.length > PROJECT_LIMITS.features) fail('LIMIT_FEATURES', 'Project exceeds the 500-feature limit.');
  if (candidate.params.length > PROJECT_LIMITS.params) fail('LIMIT_PARAMS', 'Project exceeds the 1,000-parameter limit.');

  const paramNames = new Set();
  candidate.params.forEach((param, index) => {
    if (!isRecord(param) || typeof param.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(param.name)) {
      fail('INVALID_PARAMETER', 'params[' + index + '] has an invalid name.');
    }
    if (paramNames.has(param.name)) fail('DUPLICATE_PARAMETER', 'Duplicate parameter name "' + param.name + '".');
    paramNames.add(param.name);
    if (typeof param.value !== 'number' || !Number.isFinite(param.value)) {
      fail('INVALID_PARAMETER', 'params[' + index + '].value must be a finite number.');
    }
  });

  const parameterValues = Object.fromEntries(candidate.params.map((param) => [param.name, param.value]));

  const seenIds = new Set();
  const shapeCounter = { count: 0 };
  candidate.features.forEach((feature, index) => validateFeature(feature, index, seenIds, shapeCounter, parameterValues));

  const document = structuredClone(candidate);
  document.schemaVersion = STUDIO_SCHEMA_VERSION;
  document.title = typeof document.title === 'string' && document.title.trim() ? document.title.trim().slice(0, 200) : 'Untitled part';
  document.units = document.units === 'in' ? 'in' : 'mm';
  for (const feature of document.features) delete feature.error;
  return document;
}

export function parseStudioProject(text) {
  if (typeof text !== 'string') fail('INVALID_FILE', 'Project file must be text.');
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > PROJECT_LIMITS.bytes) fail('LIMIT_BYTES', 'Project exceeds the 10 MB file limit.');
  let candidate;
  try {
    candidate = JSON.parse(text);
  } catch {
    fail('INVALID_JSON', 'Project file is not valid JSON.');
  }
  return prepareStudioDocument(candidate);
}
