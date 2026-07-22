import { evaluateStudioV5Expression, resolveStudioV5Datums } from './studio-v5-modeling.js';

export const studioV5IdentityMatrix = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function studioV5MultiplyMatrices(left, right) {
  const out = Array(16).fill(0);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let inner = 0; inner < 4; inner++) out[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner];
  }
  return out;
}

export const studioV5TranslationMatrix = ([x, y, z]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const add = (a, b) => a.map((value, index) => value + b[index]);
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const multiply = (vector, scalar) => vector.map((value) => value * scalar);
const dot = (a, b) => a.reduce((total, value, index) => total + value * b[index], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (vector) => Math.hypot(...vector);
const normalize = (vector) => {
  const magnitude = length(vector);
  if (!(magnitude > 1e-12)) throw new Error('assembly reference direction has zero length');
  return multiply(vector, 1 / magnitude);
};

export function studioV5TransformPoint(matrix, [x, y, z]) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

export function studioV5TransformVector(matrix, [x, y, z]) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z,
  ];
}

export function studioV5RigidInverse(matrix) {
  const out = studioV5IdentityMatrix();
  out[0] = matrix[0]; out[1] = matrix[4]; out[2] = matrix[8];
  out[4] = matrix[1]; out[5] = matrix[5]; out[6] = matrix[9];
  out[8] = matrix[2]; out[9] = matrix[6]; out[10] = matrix[10];
  const translation = [-matrix[12], -matrix[13], -matrix[14]];
  const moved = studioV5TransformVector(out, translation);
  out[12] = moved[0]; out[13] = moved[1]; out[14] = moved[2];
  return out;
}

function perpendicular(vector) {
  const candidate = Math.abs(vector[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  return normalize(cross(vector, candidate));
}

export function studioV5RotationMatrix(axisInput, degrees) {
  const [x, y, z] = normalize(axisInput);
  const angle = degrees * Math.PI / 180;
  const c = Math.cos(angle); const s = Math.sin(angle); const t = 1 - c;
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
}

function rotationFromTo(fromInput, toInput) {
  const from = normalize(fromInput);
  const to = normalize(toInput);
  const cosine = Math.max(-1, Math.min(1, dot(from, to)));
  if (cosine > 1 - 1e-10) return studioV5IdentityMatrix();
  if (cosine < -1 + 1e-10) return studioV5RotationMatrix(perpendicular(from), 180);
  return studioV5RotationMatrix(cross(from, to), Math.acos(cosine) * 180 / Math.PI);
}

function rotateAround(matrix, pivot) {
  return studioV5MultiplyMatrices(
    studioV5TranslationMatrix(pivot),
    studioV5MultiplyMatrices(matrix, studioV5TranslationMatrix(multiply(pivot, -1))),
  );
}

function alignedTransform(current, movingFrame, targetOrigin, targetDirection, moveOrigin = true) {
  const rotation = rotationFromTo(movingFrame.direction, targetDirection);
  let delta = rotateAround(rotation, movingFrame.origin);
  if (moveOrigin) {
    const rotatedOrigin = studioV5TransformPoint(delta, movingFrame.origin);
    delta = studioV5MultiplyMatrices(studioV5TranslationMatrix(subtract(targetOrigin, rotatedOrigin)), delta);
  }
  return studioV5MultiplyMatrices(delta, current);
}

function frameDirection(frame) {
  return frame.direction || frame.normal || frame.zDirection || [0, 0, 1];
}

function transformedFrame(frame, matrix) {
  return {
    origin: studioV5TransformPoint(matrix, frame.origin || [0, 0, 0]),
    direction: normalize(studioV5TransformVector(matrix, frameDirection(frame))),
    xDirection: normalize(studioV5TransformVector(matrix, frame.xDirection || [1, 0, 0])),
  };
}

function parametersFor(project, assembly) {
  const definitions = [...(project.parameters || []), ...(assembly.parameters || [])];
  const resolved = new Map();
  const resolving = new Set();
  const byName = new Map(definitions.map((parameter) => [parameter.name, parameter.value]));
  const resolve = (name) => {
    if (resolved.has(name)) return resolved.get(name);
    if (!byName.has(name)) throw new Error('unknown assembly parameter "' + name + '"');
    if (resolving.has(name)) throw new Error('cyclic assembly parameter "' + name + '"');
    resolving.add(name);
    const value = evaluateStudioV5Expression(byName.get(name), { has: (key) => byName.has(key), get: (key) => resolve(key) });
    resolving.delete(name);
    resolved.set(name, value);
    return value;
  };
  for (const name of byName.keys()) resolve(name);
  return resolved;
}

function mateValue(mate, parameters) {
  return mate.value == null ? 0 : evaluateStudioV5Expression(mate.value, parameters);
}

function semanticMateKey(mate) {
  const family = mate.kind === 'revolute' ? 'concentric' : mate.kind === 'slider' ? 'parallel' : mate.kind;
  return [family, ...mate.occurrenceIds, ...(mate.references || []).map((reference) => reference.ownerKind + ':' + reference.ownerId)].join('|');
}

function occurrencePatternTransforms(pattern, sourceTransform, parameters) {
  const count = pattern.generatedCount;
  const definition = pattern.definition || {};
  const transforms = [];
  if (pattern.kind === 'circular') {
    const axis = definition.axis || [0, 0, 1];
    const center = definition.center || [0, 0, 0];
    const totalAngle = Number(evaluateStudioV5Expression(definition.totalAngle ?? 360, parameters));
    for (let index = 1; index <= count; index++) {
      const rotation = rotateAround(studioV5RotationMatrix(axis, totalAngle / (count + 1) * index), center);
      transforms.push(studioV5MultiplyMatrices(rotation, sourceTransform));
    }
  } else {
    const direction = normalize(definition.direction || [1, 0, 0]);
    const spacing = Number(evaluateStudioV5Expression(definition.spacing ?? 10, parameters));
    for (let index = 1; index <= count; index++) transforms.push(studioV5MultiplyMatrices(studioV5TranslationMatrix(multiply(direction, spacing * index)), sourceTransform));
  }
  return transforms;
}

const DOF_REMOVAL = { coincident: 3, concentric: 4, distance: 1, angle: 1, parallel: 2, perpendicular: 1, tangent: 1, revolute: 5, slider: 5 };

export function solveStudioV5Assembly(project, assemblyId, options = {}) {
  const assemblies = new Map((project.assemblyDefinitions || []).map((assembly) => [assembly.id, assembly]));
  const parts = new Map((project.partDefinitions || []).map((part) => [part.id, part]));
  const solving = new Set();
  const previousByAssembly = options.previousByAssembly || new Map();

  function solve(owningAssemblyId) {
    if (solving.has(owningAssemblyId)) throw new Error('cyclic subassembly containment at "' + owningAssemblyId + '"');
    const assembly = assemblies.get(owningAssemblyId);
    if (!assembly) throw new Error('missing assembly "' + owningAssemblyId + '"');
    solving.add(owningAssemblyId);
    const parameters = parametersFor(project, assembly);
    const directById = new Map(assembly.occurrences.map((occurrence) => [occurrence.id, occurrence]));
    const transforms = new Map(assembly.occurrences.map((occurrence) => [occurrence.id, [...occurrence.baseTransform]]));
    const degreesOfFreedom = new Map(assembly.occurrences.map((occurrence) => [occurrence.id, occurrence.fixed ? 0 : 6]));
    const subassemblies = new Map();
    for (const occurrence of assembly.occurrences) {
      if (occurrence.definition.kind === 'assembly') subassemblies.set(occurrence.id, solve(occurrence.definition.assemblyId));
    }
    const errors = [];
    const conflicts = [];
    const redundantMateIds = [];
    const residuals = [];
    const driverByKey = new Map();

    function nestedTransform(path) {
      if (!path?.length) throw new Error('assembly reference has no occurrence path');
      const first = transforms.get(path[0]);
      if (!first) throw new Error('assembly reference path begins with a missing occurrence');
      let composed = first;
      let sub = subassemblies.get(path[0]);
      for (let index = 1; index < path.length; index++) {
        const next = sub?.transforms.get(path[index]);
        if (!next) throw new Error('assembly reference path does not resolve through the subassembly');
        composed = studioV5MultiplyMatrices(composed, next);
        sub = sub.subassemblies.get(path[index]);
      }
      return composed;
    }

    function referenceFrame(reference) {
      const path = reference.occurrencePath?.length ? reference.occurrencePath : [reference.ownerId];
      const transform = nestedTransform(path);
      if (reference.ownerKind === 'occurrence') return transformedFrame({ origin: [0, 0, 0], direction: [0, 0, 1], xDirection: [1, 0, 0] }, transform);
      const terminal = directById.get(path[0]);
      let definition = terminal?.definition;
      let sub = subassemblies.get(path[0]);
      for (let index = 1; index < path.length; index++) {
        definition = sub?.directById.get(path[index])?.definition;
        sub = sub?.subassemblies.get(path[index]);
      }
      if (reference.ownerKind === 'body' && definition?.kind === 'part') {
        const part = parts.get(definition.partId);
        if (!part?.bodies.some((body) => body.id === reference.ownerId)) throw new Error('mate topology owner body is missing');
        const signature = reference.signature || {};
        if (signature.topologyKind !== 'planar-face' || !Array.isArray(signature.p) || !Array.isArray(signature.n)) {
          throw new Error('mate body reference must contain a planar-face topology signature');
        }
        const origin = signature.p.map(Number);
        const direction = normalize(signature.n.map(Number));
        if (origin.length !== 3 || origin.some((value) => !Number.isFinite(value))) throw new Error('mate planar-face origin is invalid');
        return transformedFrame({ origin, direction, xDirection: perpendicular(direction) }, transform);
      }
      if (reference.ownerKind !== 'datum' || definition?.kind !== 'part') throw new Error('mate reference must resolve to an occurrence, part datum, or planar body face');
      const part = parts.get(definition.partId);
      if (!part) throw new Error('mate datum owner part is missing');
      const frame = resolveStudioV5Datums(project, part.id).resolve(reference.ownerId);
      return transformedFrame(frame, transform);
    }

    for (const mate of assembly.mates) {
      if (mate.suppressed) continue;
      try {
        const movingId = mate.kind === 'fixed' ? mate.occurrenceIds[0] : mate.occurrenceIds[1];
        const moving = directById.get(movingId);
        if (!moving) throw new Error('mate moving occurrence is missing');
        if (mate.kind === 'fixed') {
          degreesOfFreedom.set(movingId, 0);
          continue;
        }
        if (mate.occurrenceIds.length !== 2 || mate.references.length !== 2) throw new Error(mate.kind + ' mate requires two occurrences and two references');
        const key = semanticMateKey(mate);
        const value = mateValue(mate, parameters);
        const previousDriver = driverByKey.get(key);
        if (previousDriver) {
          if (Math.abs(previousDriver.value - value) <= 1e-8) redundantMateIds.push(mate.id);
          else {
            const conflict = [previousDriver.id, mate.id];
            conflicts.push(conflict);
            throw Object.assign(new Error('conflicting mate value'), { conflict });
          }
          continue;
        }
        driverByKey.set(key, { id: mate.id, value });
        const anchorFrame = referenceFrame(mate.references[0]);
        const movingFrame = referenceFrame(mate.references[1]);
        const current = transforms.get(movingId);
        let next = current;
        if (mate.kind === 'coincident' || mate.kind === 'tangent') {
          const direction = mate.extensions?.flip ? multiply(anchorFrame.direction, -1) : anchorFrame.direction;
          next = alignedTransform(current, movingFrame, add(anchorFrame.origin, multiply(direction, value)), direction);
        } else if (mate.kind === 'concentric' || mate.kind === 'revolute') {
          const direction = mate.extensions?.flip ? multiply(anchorFrame.direction, -1) : anchorFrame.direction;
          next = alignedTransform(current, movingFrame, add(anchorFrame.origin, multiply(direction, value)), direction);
        } else if (mate.kind === 'distance') {
          next = studioV5MultiplyMatrices(studioV5TranslationMatrix(subtract(add(anchorFrame.origin, multiply(anchorFrame.direction, value)), movingFrame.origin)), current);
        } else if (mate.kind === 'parallel' || mate.kind === 'slider') {
          next = alignedTransform(current, movingFrame, movingFrame.origin, anchorFrame.direction, false);
          if (mate.kind === 'slider') {
            const moved = transformedFrame({ origin: movingFrame.origin, direction: movingFrame.direction }, studioV5MultiplyMatrices(next, studioV5RigidInverse(current)));
            const offset = subtract(anchorFrame.origin, moved.origin);
            const transverse = subtract(offset, multiply(anchorFrame.direction, dot(offset, anchorFrame.direction)));
            next = studioV5MultiplyMatrices(studioV5TranslationMatrix(transverse), next);
          }
        } else if (mate.kind === 'perpendicular') {
          let target = cross(anchorFrame.direction, movingFrame.direction);
          if (length(target) < 1e-8) target = perpendicular(anchorFrame.direction);
          next = alignedTransform(current, movingFrame, movingFrame.origin, target, false);
        } else if (mate.kind === 'angle') {
          const radians = value * Math.PI / 180;
          let side = subtract(movingFrame.direction, multiply(anchorFrame.direction, dot(movingFrame.direction, anchorFrame.direction)));
          if (length(side) < 1e-8) side = perpendicular(anchorFrame.direction);
          side = normalize(side);
          const target = add(multiply(anchorFrame.direction, Math.cos(radians)), multiply(side, Math.sin(radians)));
          next = alignedTransform(current, movingFrame, movingFrame.origin, target, false);
        }
        transforms.set(movingId, next);
        degreesOfFreedom.set(movingId, Math.max(0, degreesOfFreedom.get(movingId) - (DOF_REMOVAL[mate.kind] || 0)));
      } catch (error) {
        errors.push({ mateId: mate.id, kind: 'mate', message: String(error?.message || error), conflictSet: error.conflict || [] });
      }
    }

    const activeMates = assembly.mates.filter((mate) => !mate.suppressed && mate.kind !== 'fixed' && !redundantMateIds.includes(mate.id));
    const erroredMateIds = new Set(errors.map((error) => error.mateId));
    for (const mate of activeMates) {
      if (erroredMateIds.has(mate.id)) continue;
      try {
        const anchorFrame = referenceFrame(mate.references[0]);
        const movingFrame = referenceFrame(mate.references[1]);
        const value = mateValue(mate, parameters);
        const targetDirection = mate.extensions?.flip ? multiply(anchorFrame.direction, -1) : anchorFrame.direction;
        const axisDot = Math.max(-1, Math.min(1, dot(targetDirection, movingFrame.direction)));
        const offset = subtract(movingFrame.origin, anchorFrame.origin);
        const transverse = subtract(offset, multiply(targetDirection, dot(offset, targetDirection)));
        let residual = 0;
        if (mate.kind === 'coincident' || mate.kind === 'tangent') {
          residual = Math.max(length(subtract(movingFrame.origin, add(anchorFrame.origin, multiply(targetDirection, value)))), 1 - axisDot);
        } else if (mate.kind === 'concentric' || mate.kind === 'revolute') {
          residual = Math.max(length(transverse), 1 - axisDot);
        } else if (mate.kind === 'distance') {
          residual = length(subtract(movingFrame.origin, add(anchorFrame.origin, multiply(anchorFrame.direction, value))));
        } else if (mate.kind === 'parallel') {
          residual = 1 - Math.abs(axisDot);
        } else if (mate.kind === 'slider') {
          residual = Math.max(length(transverse), 1 - Math.abs(axisDot));
        } else if (mate.kind === 'perpendicular') {
          residual = Math.abs(dot(anchorFrame.direction, movingFrame.direction));
        } else if (mate.kind === 'angle') {
          residual = Math.abs(Math.acos(Math.max(-1, Math.min(1, dot(anchorFrame.direction, movingFrame.direction)))) * 180 / Math.PI - Math.abs(value));
        }
        residuals.push({ mateId: mate.id, residual });
        if (residual <= 1e-6) continue;
        const occurrenceIds = new Set(mate.occurrenceIds);
        const conflict = activeMates
          .filter((candidate) => candidate.occurrenceIds.some((id) => occurrenceIds.has(id)))
          .map((candidate) => candidate.id);
        if (!conflict.includes(mate.id)) conflict.push(mate.id);
        conflicts.push(conflict);
        errors.push({ mateId: mate.id, kind: 'mate', message: 'mate closed-graph residual is ' + residual.toPrecision(6), conflictSet: conflict, residual });
      } catch (error) {
        errors.push({ mateId: mate.id, kind: 'mate', message: String(error?.message || error), conflictSet: [] });
      }
    }

    let usedLastValid = false;
    if (errors.length && previousByAssembly.get(owningAssemblyId)) {
      const previous = previousByAssembly.get(owningAssemblyId);
      for (const [occurrenceId, matrix] of previous.transforms) if (transforms.has(occurrenceId)) transforms.set(occurrenceId, [...matrix]);
      usedLastValid = true;
    }

    const leafOccurrences = [];
    for (const occurrence of assembly.occurrences) {
      if (occurrence.suppressed) continue;
      const localTransform = transforms.get(occurrence.id);
      if (occurrence.definition.kind === 'part') {
        leafOccurrences.push({
          id: occurrence.id, name: occurrence.name, occurrencePath: [occurrence.id], definition: occurrence.definition,
          transform: localTransform, visible: occurrence.visible, suppressed: occurrence.suppressed, sourceOccurrenceId: occurrence.id,
          parameterOverrides: occurrence.parameterOverrides || {},
        });
      } else {
        const child = subassemblies.get(occurrence.id);
        for (const leaf of child.leafOccurrences) leafOccurrences.push({
          ...leaf,
          id: occurrence.id + '/' + leaf.id,
          name: occurrence.name + ' / ' + leaf.name,
          occurrencePath: [occurrence.id, ...leaf.occurrencePath],
          transform: studioV5MultiplyMatrices(localTransform, leaf.transform),
          visible: occurrence.visible && leaf.visible,
          suppressed: occurrence.suppressed || leaf.suppressed,
        });
      }
    }
    const unpatternedLeaves = [...leafOccurrences];
    for (const pattern of assembly.occurrencePatterns) {
      if (pattern.suppressed) continue;
      for (const sourceId of pattern.sourceOccurrenceIds) {
        const sources = unpatternedLeaves.filter((leaf) => leaf.occurrencePath[0] === sourceId);
        for (const source of sources) {
          const generated = occurrencePatternTransforms(pattern, source.transform, parameters);
          generated.forEach((transform, index) => {
            const generatedOccurrenceId = pattern.id + '-instance-' + (index + 1) + '-' + sourceId;
            const nestedPath = source.occurrencePath.slice(1);
            leafOccurrences.push({
              ...source,
              id: [generatedOccurrenceId, ...nestedPath].join('/'),
              name: pattern.name + ' ' + (index + 2) + ' / ' + source.name,
              occurrencePath: [generatedOccurrenceId, ...nestedPath],
              transform,
              sourceOccurrenceId: sourceId,
              patternInstance: { patternId: pattern.id, index: index + 1, sourceOccurrenceId: sourceId },
            });
          });
        }
      }
    }

    const nestedSolutions = [...subassemblies.values()];
    const aggregateErrors = [...errors, ...nestedSolutions.flatMap((child) => child.errors)];
    const aggregateConflicts = [...conflicts, ...nestedSolutions.flatMap((child) => child.conflicts)];
    const aggregateRedundantMateIds = [...redundantMateIds, ...nestedSolutions.flatMap((child) => child.redundantMateIds)];
    const aggregateResiduals = [...residuals, ...nestedSolutions.flatMap((child) => child.residuals)];
    const aggregateDegreesOfFreedom = new Map(degreesOfFreedom);
    for (const child of nestedSolutions) for (const [occurrenceId, value] of child.degreesOfFreedom) aggregateDegreesOfFreedom.set(occurrenceId, value);
    const aggregateUsedLastValid = usedLastValid || nestedSolutions.some((child) => child.usedLastValid);
    solving.delete(owningAssemblyId);
    return {
      assembly, directById, transforms, degreesOfFreedom: aggregateDegreesOfFreedom, errors: aggregateErrors,
      conflicts: aggregateConflicts, redundantMateIds: aggregateRedundantMateIds,
      residuals: aggregateResiduals,
      subassemblies, leafOccurrences, usedLastValid: aggregateUsedLastValid,
      state: aggregateErrors.length ? 'conflicting' : [...aggregateDegreesOfFreedom.values()].every((value) => value === 0) ? 'fully-constrained' : 'under-constrained',
    };
  }

  return solve(assemblyId);
}

export function studioV5TransformBounds(bounds, matrix) {
  if (!bounds) return null;
  const points = [];
  for (const x of [bounds[0][0], bounds[1][0]]) for (const y of [bounds[0][1], bounds[1][1]]) for (const z of [bounds[0][2], bounds[1][2]]) {
    points.push(studioV5TransformPoint(matrix, [x, y, z]));
  }
  return [
    [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]))),
    [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]))),
  ];
}
