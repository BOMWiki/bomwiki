// Shared schema-5 datum and transform math. This module is deliberately free
// of DOM and OpenCascade dependencies so document commands, the kernel worker,
// headless checks, and the visible Studio use exactly the same resolved frames.

const EPSILON = 1e-9;

const add = (a, b) => a.map((value, index) => value + b[index]);
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const multiply = (vector, scale) => vector.map((value) => value * scale);
const dot = (a, b) => a.reduce((total, value, index) => total + value * b[index], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (vector) => Math.hypot(...vector);

function finiteVector(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    throw new Error(name + ' must contain three finite numbers.');
  }
  return [...value];
}

function normalize(vector, name = 'Direction') {
  const magnitude = length(vector);
  if (magnitude <= EPSILON) throw new Error(name + ' cannot be zero length.');
  return multiply(vector, 1 / magnitude);
}

function orthogonalX(normal, preferred = [1, 0, 0]) {
  const projected = subtract(preferred, multiply(normal, dot(preferred, normal)));
  if (length(projected) > EPSILON) return normalize(projected);
  const fallback = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  return normalize(subtract(fallback, multiply(normal, dot(fallback, normal))));
}

function planeFrame(origin, normal, xDirection) {
  const z = normalize(finiteVector(normal, 'Plane normal'), 'Plane normal');
  const x = orthogonalX(z, finiteVector(xDirection || [1, 0, 0], 'Plane X direction'));
  return { kind: 'plane', origin: finiteVector(origin, 'Plane origin'), normal: z, xDirection: x, yDirection: normalize(cross(z, x)) };
}

function axisFrame(origin, direction) {
  return { kind: 'axis', origin: finiteVector(origin, 'Axis origin'), direction: normalize(finiteVector(direction, 'Axis direction'), 'Axis direction') };
}

function pointFrame(point) {
  return { kind: 'point', point: finiteVector(point, 'Point') };
}

function coordinateFrame(origin, xDirection, zDirection) {
  const plane = planeFrame(origin, zDirection, xDirection);
  return { kind: 'coordinate-system', origin: plane.origin, xDirection: plane.xDirection, yDirection: plane.yDirection, zDirection: plane.normal };
}

function rotateVector(vector, axis, angleDegrees) {
  const direction = normalize(axis, 'Rotation axis');
  const angle = angleDegrees * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return add(add(multiply(vector, cosine), multiply(cross(direction, vector), sine)), multiply(direction, dot(direction, vector) * (1 - cosine)));
}

export function evaluateStudioV5Expression(value, parameters = new Map()) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Expression must be finite.');
    return value;
  }
  const source = String(value || '');
  let index = 0;
  const skip = () => { while (/\s/.test(source[index] || '')) index++; };
  function factor() {
    skip();
    if (source[index] === '(') {
      index++;
      const result = expression();
      skip();
      if (source[index++] !== ')') throw new Error('Expression has an unmatched parenthesis.');
      return result;
    }
    if (source[index] === '+' || source[index] === '-') {
      const sign = source[index++] === '-' ? -1 : 1;
      return sign * factor();
    }
    let match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
    if (match) {
      index += match[0].length;
      if (!parameters.has(match[0])) throw new Error('Unknown parameter "' + match[0] + '".');
      return parameters.get(match[0]);
    }
    match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(index));
    if (!match) throw new Error('Expression contains unsupported syntax.');
    index += match[0].length;
    return Number(match[0]);
  }
  function term() {
    let result = factor();
    for (;;) {
      skip();
      if (source[index] === '*') { index++; result *= factor(); }
      else if (source[index] === '/') { index++; result /= factor(); }
      else return result;
    }
  }
  function expression() {
    let result = term();
    for (;;) {
      skip();
      if (source[index] === '+') { index++; result += term(); }
      else if (source[index] === '-') { index++; result -= term(); }
      else return result;
    }
  }
  const result = expression();
  skip();
  if (index !== source.length || !Number.isFinite(result)) throw new Error('Expression must evaluate to a finite number.');
  return result;
}

export function studioV5ParameterValues(project, part) {
  const unresolved = new Map([...(project.parameters || []), ...(part.parameters || [])].map((entry) => [entry.name, entry.value]));
  const resolved = new Map();
  const active = new Set();
  function resolve(name) {
    if (resolved.has(name)) return resolved.get(name);
    if (!unresolved.has(name)) throw new Error('Unknown parameter "' + name + '".');
    if (active.has(name)) throw new Error('Cyclic parameter "' + name + '".');
    active.add(name);
    const proxy = {
      has: (key) => unresolved.has(key),
      get: (key) => resolve(key),
    };
    const value = evaluateStudioV5Expression(unresolved.get(name), proxy);
    active.delete(name);
    resolved.set(name, value);
    return value;
  }
  for (const name of unresolved.keys()) resolve(name);
  return resolved;
}

function expressionVector(values, parameters, name) {
  if (!Array.isArray(values) || values.length !== 3) throw new Error(name + ' must contain three values.');
  return values.map((value) => evaluateStudioV5Expression(value, parameters));
}

function sameKind(frame, kind, name) {
  if (!frame || frame.kind !== kind) throw new Error(name + ' must reference a ' + kind + '.');
  return frame;
}

export function resolveStudioV5Datums(project, partId = project.rootDocument?.partId) {
  const part = (project.partDefinitions || []).find((entry) => entry.id === partId);
  if (!part) throw new Error('The requested part definition is missing.');
  const parameters = studioV5ParameterValues(project, part);
  const definitions = new Map((part.referenceGeometry || []).map((datum) => [datum.id, datum]));
  const resolved = new Map();
  const errors = new Map();
  const active = new Set();

  function pointFrom(value, name) {
    if (typeof value === 'string') return sameKind(resolve(value), 'point', name).point;
    return expressionVector(value, parameters, name);
  }

  function resolve(id) {
    if (resolved.has(id)) return resolved.get(id);
    if (errors.has(id)) throw errors.get(id);
    const datum = definitions.get(id);
    if (!datum) throw new Error('Missing datum "' + id + '".');
    if (datum.suppressed) throw new Error('Datum "' + datum.name + '" is suppressed.');
    if (active.has(id)) throw new Error('Cyclic datum dependency at "' + datum.name + '".');
    active.add(id);
    try {
      const definition = datum.definition || {};
      let frame;
      if (datum.kind === 'point') {
        if (definition.mode === 'midpoint') {
          frame = pointFrame(multiply(add(pointFrom(definition.pointA, 'First midpoint reference'), pointFrom(definition.pointB, 'Second midpoint reference')), 0.5));
        } else frame = pointFrame(expressionVector(definition.coordinates || definition.point || [0, 0, 0], parameters, 'Point coordinates'));
      } else if (datum.kind === 'axis') {
        if (definition.mode === 'through-points') {
          const first = pointFrom(definition.pointA, 'Axis start point');
          const second = pointFrom(definition.pointB, 'Axis end point');
          frame = axisFrame(first, subtract(second, first));
        } else if (definition.mode === 'plane-normal') {
          const plane = sameKind(resolve(definition.planeDatumId), 'plane', 'Axis plane');
          frame = axisFrame(definition.pointDatumId ? pointFrom(definition.pointDatumId, 'Axis point') : plane.origin, plane.normal);
        } else frame = axisFrame(expressionVector(definition.origin || [0, 0, 0], parameters, 'Axis origin'), expressionVector(definition.direction || [1, 0, 0], parameters, 'Axis direction'));
      } else if (datum.kind === 'coordinate-system') {
        frame = coordinateFrame(
          expressionVector(definition.origin || [0, 0, 0], parameters, 'Coordinate-system origin'),
          expressionVector(definition.xDirection || [1, 0, 0], parameters, 'Coordinate-system X direction'),
          expressionVector(definition.zDirection || [0, 0, 1], parameters, 'Coordinate-system Z direction'),
        );
      } else if (definition.mode === 'offset') {
        const base = sameKind(resolve(definition.referenceDatumId), 'plane', 'Offset reference');
        const signed = evaluateStudioV5Expression(definition.offset || 0, parameters) * (definition.flipNormal ? -1 : 1);
        frame = planeFrame(add(base.origin, multiply(base.normal, signed)), definition.flipNormal ? multiply(base.normal, -1) : base.normal, base.xDirection);
      } else if (definition.mode === 'angle') {
        const base = sameKind(resolve(definition.referenceDatumId), 'plane', 'Angle reference');
        const axis = sameKind(resolve(definition.axisDatumId), 'axis', 'Angle axis');
        const angle = evaluateStudioV5Expression(definition.angle || 0, parameters);
        const rotatedOrigin = add(axis.origin, rotateVector(subtract(base.origin, axis.origin), axis.direction, angle));
        frame = planeFrame(rotatedOrigin, rotateVector(base.normal, axis.direction, angle), rotateVector(base.xDirection, axis.direction, angle));
      } else if (definition.mode === 'three-point') {
        const first = pointFrom(definition.points?.[0] ?? definition.pointA, 'First plane point');
        const second = pointFrom(definition.points?.[1] ?? definition.pointB, 'Second plane point');
        const third = pointFrom(definition.points?.[2] ?? definition.pointC, 'Third plane point');
        frame = planeFrame(first, cross(subtract(second, first), subtract(third, first)), subtract(second, first));
      } else if (definition.mode === 'point-normal' || definition.mode === 'curve-normal') {
        const origin = pointFrom(definition.pointDatumId || definition.point || [0, 0, 0], 'Plane point');
        const direction = definition.axisDatumId
          ? sameKind(resolve(definition.axisDatumId), 'axis', 'Plane normal axis').direction
          : expressionVector(definition.normal || definition.tangent || [0, 0, 1], parameters, 'Plane normal');
        frame = planeFrame(origin, direction, definition.xDirection || [1, 0, 0]);
      } else if (definition.mode === 'midplane') {
        const first = sameKind(resolve(definition.firstDatumId), 'plane', 'First midplane reference');
        const second = sameKind(resolve(definition.secondDatumId), 'plane', 'Second midplane reference');
        if (Math.abs(Math.abs(dot(first.normal, second.normal)) - 1) > 1e-6) throw new Error('Midplane references must be parallel.');
        frame = planeFrame(multiply(add(first.origin, second.origin), 0.5), first.normal, first.xDirection);
      } else {
        frame = planeFrame(
          expressionVector(definition.origin || [0, 0, 0], parameters, 'Plane origin'),
          expressionVector(definition.normal || [0, 0, 1], parameters, 'Plane normal'),
          expressionVector(definition.xDirection || [1, 0, 0], parameters, 'Plane X direction'),
        );
      }
      active.delete(id);
      resolved.set(id, frame);
      return frame;
    } catch (error) {
      active.delete(id);
      const failure = error instanceof Error ? error : new Error(String(error));
      errors.set(id, failure);
      throw failure;
    }
  }

  for (const datum of definitions.values()) {
    try { resolve(datum.id); } catch {}
  }
  return { part, parameters, frames: resolved, errors, resolve };
}

export function resolveStudioV5Transform(project, part, feature) {
  const datums = resolveStudioV5Datums(project, part.id);
  const parameters = datums.parameters;
  const vector = (value, name) => expressionVector(value, parameters, name);
  const scalar = (value, fallback = 0) => evaluateStudioV5Expression(value ?? fallback, parameters);
  const transform = feature.transform || {};
  const mode = transform.mode || feature.operation;
  if (mode === 'translate' || mode === 'move' || mode === 'copy') {
    return { mode, translation: vector(transform.translation || [0, 0, 0], 'Translation') };
  }
  if (mode === 'rotate') {
    const axis = transform.axisDatumId
      ? sameKind(datums.resolve(transform.axisDatumId), 'axis', 'Rotation axis')
      : axisFrame(vector(transform.origin || [0, 0, 0], 'Rotation origin'), vector(transform.direction || [1, 0, 0], 'Rotation direction'));
    return { mode, origin: axis.origin, direction: axis.direction, angle: scalar(transform.angle) };
  }
  if (mode === 'scale') {
    const factor = scalar(transform.factor, 1);
    if (!(factor > 0)) throw new Error('Scale factor must be greater than zero.');
    return { mode, center: vector(transform.center || [0, 0, 0], 'Scale center'), factor };
  }
  if (mode === 'mirror') {
    const plane = transform.planeDatumId
      ? sameKind(datums.resolve(transform.planeDatumId), 'plane', 'Mirror plane')
      : planeFrame(vector(transform.origin || [0, 0, 0], 'Mirror origin'), vector(transform.normal || [1, 0, 0], 'Mirror normal'));
    return { mode, origin: plane.origin, normal: plane.normal };
  }
  if (mode === 'align') {
    const from = datums.resolve(transform.fromDatumId);
    const to = datums.resolve(transform.toDatumId);
    if (from.kind !== to.kind || (from.kind !== 'plane' && from.kind !== 'axis' && from.kind !== 'coordinate-system')) {
      throw new Error('Align requires compatible plane, axis, or coordinate-system datums.');
    }
    return { mode, from, to, offset: scalar(transform.offset), flip: transform.flip === true };
  }
  throw new Error('Unsupported transform mode "' + mode + '".');
}

export const studioV5VectorMath = Object.freeze({ add, subtract, multiply, dot, cross, length, normalize, rotateVector, planeFrame, axisFrame });
