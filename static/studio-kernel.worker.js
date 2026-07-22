// OpenCascade worker for BOMwiki CAD Studio.
//
// The UI owns documents, commands, selection and rendering. This worker owns
// the WASM kernel, B-rep shapes, exact rebuilds, topology extraction and
// exports. Every reply carries the caller's request id and document revision;
// the UI is responsible for discarding stale visual results.

let rc = null;
let kernelReady = null;
let currentShape = null;
let currentBodyCache = new Map();
let currentAssemblySolutions = new Map();
let currentRevision = -1;

import { resolveStudioV5Datums, resolveStudioV5Transform, studioV5VectorMath } from '/static/studio-v5-modeling.js';
import {
  solveStudioV5Assembly,
  studioV5IdentityMatrix as assemblyIdentityMatrix,
  studioV5MultiplyMatrices,
  studioV5RigidInverse,
  studioV5TransformBounds,
  studioV5TransformPoint,
} from '/static/studio-v5-assembly.js';
import { prepareStudioV5Project, STUDIO_V5_PROJECT_LIMITS } from '/static/studio-project-v5.js';

function loadKernel() {
  if (kernelReady) return kernelReady;
  self.postMessage({ kind: 'kernel-status', status: 'loading' });
  kernelReady = (async () => {
    const [replicad, ocFactory] = await Promise.all([
      import('/static/vendor/replicad.module.js'),
      import('/static/vendor/replicad-oc.module.js'),
    ]);
    const OC = await ocFactory.default({
      locateFile: () => '/static/vendor/replicad_single.wasm',
    });
    replicad.setOC(OC);
    rc = replicad;
    self.postMessage({ kind: 'kernel-status', status: 'ready' });
    return replicad;
  })();
  kernelReady.catch((error) => {
    self.postMessage({
      kind: 'kernel-status',
      status: 'failed',
      message: String(error?.message || error),
    });
  });
  return kernelReady;
}

function evalExpr(input, params) {
  if (typeof input === 'number') return input;
  const s = String(input);
  let i = 0;
  const skip = () => {
    while (s[i] === ' ') i++;
  };
  function factor() {
    skip();
    if (s[i] === '(') {
      i++;
      const value = expr();
      skip();
      if (s[i] !== ')') throw new Error('missing )');
      i++;
      return value;
    }
    if (s[i] === '-') {
      i++;
      return -factor();
    }
    let match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (match) {
      i += match[0].length;
      if (!(match[0] in params)) throw new Error('unknown parameter "' + match[0] + '"');
      return params[match[0]];
    }
    match = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (match) {
      i += match[0].length;
      return Number(match[0]);
    }
    throw new Error('bad expression');
  }
  function term() {
    let value = factor();
    for (;;) {
      skip();
      if (s[i] === '*') {
        i++;
        value *= factor();
      } else if (s[i] === '/') {
        i++;
        value /= factor();
      } else return value;
    }
  }
  function expr() {
    let value = term();
    for (;;) {
      skip();
      if (s[i] === '+') {
        i++;
        value += term();
      } else if (s[i] === '-') {
        i++;
        value -= term();
      } else return value;
    }
  }
  const value = expr();
  skip();
  if (i < s.length) throw new Error('bad expression');
  if (!Number.isFinite(value)) throw new Error('expression is not a number');
  return value;
}

function evaluator(document, activeDefinition = null) {
  const entries = document.schemaVersion === 5
    ? [
        ...(document.parameters || []),
        ...(activeDefinition?.parameters || (document.partDefinitions || []).find((part) => part.id === document.rootDocument?.partId)?.parameters || []),
      ]
    : document.params || [];
  const rawParams = Object.fromEntries(entries.map((param) => [param.name, param.value]));
  const resolvedParams = {};
  const resolving = new Set();
  const params = new Proxy(resolvedParams, {
    has: (_target, name) => typeof name === 'string' && name in rawParams,
    get: (_target, name) => {
      if (typeof name !== 'string') return undefined;
      if (name in resolvedParams) return resolvedParams[name];
      if (!(name in rawParams)) return undefined;
      if (resolving.has(name)) throw new Error('cyclic parameter "' + name + '"');
      resolving.add(name);
      const value = evalExpr(rawParams[name], params);
      resolving.delete(name);
      resolvedParams[name] = value;
      return value;
    },
  });
  const strict = (value) => evalExpr(value, params);
  const safe = (value, fallback) => {
    try {
      return strict(value);
    } catch {
      return fallback ?? 0;
    }
  };
  return { strict, safe };
}

function patternedDrawing(drawing, pattern, N, NS) {
  if (!pattern) return drawing;
  const count = Math.min(100, Math.max(1, Math.round(NS(pattern.n, 1))));
  if (count <= 1) return drawing;
  let result = drawing;
  for (let i = 1; i < count; i++) {
    result = result.fuse(
      pattern.kind === 'circular'
        ? drawing.rotate((360 / count) * i, [N(pattern.cx ?? 0), N(pattern.cy ?? 0)])
        : drawing.translate(N(pattern.dx ?? 0) * i, N(pattern.dy ?? 0) * i),
    );
  }
  return result;
}

function shapeToDrawing(shape, N) {
  if (shape.kind === 'rect') {
    return rc.drawRectangle(Math.max(0.1, N(shape.w)), Math.max(0.1, N(shape.h))).translate(N(shape.x), N(shape.y));
  }
  if (shape.kind === 'circle') {
    return rc.drawCircle(Math.max(0.05, N(shape.r))).translate(N(shape.x), N(shape.y));
  }
  if (shape.kind === 'poly') {
    let pen = rc.draw([shape.pts[0][0], shape.pts[0][1]]);
    for (let i = 1; i < shape.pts.length; i++) pen = pen.lineTo([shape.pts[i][0], shape.pts[i][1]]);
    return pen.close();
  }
  throw new Error('unknown shape');
}

function topOf(shape) {
  try {
    const bounds = shape.boundingBox?.bounds;
    if (Array.isArray(bounds) && bounds.length === 2) return bounds[1][2];
    if (Array.isArray(bounds) && bounds.length === 6) return bounds[5];
  } catch {}
  return 1000;
}

const quantize = (value) => Math.round(value * 100) / 100;

function edgeSignature(edge) {
  const point = edge.pointAt(0.5);
  return {
    p: [point.x ?? point[0], point.y ?? point[1], point.z ?? point[2]].map(quantize),
    l: quantize(edge.length),
  };
}

function edgeMatches(signature, edge) {
  const point = edge.pointAt(0.5);
  const candidate = [point.x ?? point[0], point.y ?? point[1], point.z ?? point[2]];
  return (
    Math.abs(edge.length - signature.l) < 0.05 &&
    Math.hypot(candidate[0] - signature.p[0], candidate[1] - signature.p[1], candidate[2] - signature.p[2]) < 0.05
  );
}

function faceSignature(face) {
  const center = face.center;
  const normal = face.normalAt();
  return {
    p: [quantize(center.x), quantize(center.y), quantize(center.z)],
    n: [quantize(normal.x), quantize(normal.y), quantize(normal.z)],
  };
}

function faceMatches(signature, face) {
  if (face.geomType !== 'PLANE') return false;
  const center = face.center;
  const normal = face.normalAt();
  return (
    Math.hypot(center.x - signature.p[0], center.y - signature.p[1], center.z - signature.p[2]) < 0.05 &&
    normal.x * signature.n[0] + normal.y * signature.n[1] + normal.z * signature.n[2] > 0.999
  );
}

function faceOutline(face) {
  const polygons = [];
  const plane = rc.makePlaneFromFace(face);
  try {
    for (const edge of face.edges) {
      const points = [];
      for (let i = 0; i <= 8; i++) {
        const point = edge.pointAt(i / 8);
        const local = plane.toLocalCoords(point);
        points.push([local.x ?? local[0], local.y ?? local[1]]);
      }
      polygons.push(points);
    }
  } catch {}
  return polygons;
}

function featureSolid(feature, zTop, accumulated, N, NS) {
  let facePlane = null;
  if (feature.onFace) {
    const face = accumulated ? accumulated.faces.find((candidate) => faceMatches(feature.onFace, candidate)) : null;
    if (!face) throw new Error('the picked face no longer exists — edit or delete this feature');
    facePlane = rc.makePlaneFromFace(face);
  }
  const solids = [];
  for (const shape of feature.sketch.shapes) {
    const drawing = patternedDrawing(shapeToDrawing(shape, N), feature.pattern, N, NS);
    if (feature.type === 'revolve') {
      solids.push(drawing.sketchOnPlane('XZ').revolve());
    } else if (feature.type === 'cut') {
      const depth = feature.through ? 0 : Math.max(0.1, N(feature.h));
      if (facePlane) {
        solids.push(drawing.sketchOnPlane(facePlane).extrude(-(feature.through ? 10000 : depth)));
      } else {
        const sketch = feature.through
          ? drawing.sketchOnPlane('XY', -5000)
          : drawing.sketchOnPlane('XY', (zTop ?? 0) - depth);
        solids.push(sketch.extrude(feature.through ? 10000 : depth + 1000));
      }
    } else {
      const sketch = facePlane
        ? drawing.sketchOnPlane(facePlane)
        : drawing.sketchOnPlane('XY', feature.sketch.z || 0);
      solids.push(sketch.extrude(Math.max(0.1, N(feature.h))));
    }
  }
  let result = solids[0];
  for (let i = 1; i < solids.length; i++) result = result.fuse(solids[i]);
  return result;
}

function friendlyError(feature, error) {
  let message = String(error?.message || error);
  if (/^\d+$/.test(message) || /^Error$/i.test(message)) {
    message =
      feature.type === 'shell'
        ? 'the kernel could not hollow this shape — try different walls, another opening face, or shell earlier in the history'
        : feature.type === 'fillet' || feature.type === 'chamfer'
          ? 'the kernel refused — try a smaller radius or fewer edges'
          : 'the kernel rejected this sketch — check for overlapping or self-crossing shapes';
  } else if ((feature.type === 'fillet' || feature.type === 'chamfer') && !/no longer exist/.test(message)) {
    message += ' — try a smaller radius';
  }
  return message;
}

async function buildLegacyDocument(document) {
  await loadKernel();
  const { strict: N, safe: NS } = evaluator(document);
  const errors = [];
  let accumulated = null;
  for (const feature of document.features || []) {
    try {
      if (feature.type === 'fillet' || feature.type === 'chamfer') {
        if (!accumulated) throw new Error('nothing to round yet');
        let hits = 0;
        const radius = Math.max(0.1, N(feature.r));
        const next = accumulated[feature.type]((edge) => {
          const selected = feature.edges.some((signature) => edgeMatches(signature, edge));
          if (selected) hits++;
          return selected ? radius : 0;
        });
        if (!hits) throw new Error('the picked edges no longer exist — edit or delete this feature');
        accumulated = next;
      } else if (feature.type === 'shell') {
        if (!accumulated) throw new Error('nothing to hollow yet');
        let hits = 0;
        const next = accumulated.shell(-Math.max(0.2, Math.abs(N(feature.t))), (finder) =>
          finder.when(({ element }) => {
            const selected = feature.faces.some((signature) => faceMatches(signature, element));
            if (selected) hits++;
            return selected;
          }),
        );
        if (!hits) throw new Error('the picked faces no longer exist — edit or delete this feature');
        accumulated = next;
      } else if (feature.type === 'cut') {
        if (!accumulated) throw new Error('nothing to cut yet — add a solid feature first');
        const solid = featureSolid(feature, accumulated ? topOf(accumulated) : 0, accumulated, N, NS);
        accumulated = accumulated.cut(solid);
      } else {
        const solid = featureSolid(feature, 0, accumulated, N, NS);
        accumulated = accumulated ? accumulated.fuse(solid) : solid;
      }
    } catch (error) {
      errors.push({ featureId: feature.id, featureType: feature.type, message: friendlyError(feature, error) });
    }
  }
  return { shape: accumulated, errors };
}

function v5RootPart(document) {
  if (document.rootDocument?.kind !== 'part') throw new Error('This worker request requires a schema-5 part document.');
  const part = (document.partDefinitions || []).find((entry) => entry.id === document.rootDocument.partId);
  if (!part) throw new Error('The schema-5 root part is missing.');
  return part;
}

function stableSource(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableSource).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableSource(value[key])).join(',') + '}';
}

function stableHash(value) {
  const source = stableSource(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function solidCount(shape) {
  let count = 0;
  for (const solid of rc.iterTopo(shape.wrapped, 'solid')) {
    count++;
    try { solid.delete?.(); } catch {}
  }
  return count;
}

function shapeVolume(shape) {
  const properties = rc.measureShapeVolumeProperties(shape);
  try {
    return properties.volume;
  } finally {
    try { properties.delete(); } catch {}
  }
}

function topologyCount(shape, kind) {
  let count = 0;
  for (const element of rc.iterTopo(shape.wrapped, kind)) {
    count++;
    try { element.delete?.(); } catch {}
  }
  return count;
}

function shapePhysicalProperties(shape) {
  const volumeProperties = rc.measureShapeVolumeProperties(shape);
  const surfaceProperties = rc.measureShapeSurfaceProperties(shape);
  try {
    return {
      volume: volumeProperties.volume,
      surfaceArea: surfaceProperties.area,
      centerOfMass: volumeProperties.centerOfMass,
    };
  } finally {
    try { volumeProperties.delete(); } catch {}
    try { surfaceProperties.delete(); } catch {}
  }
}

function bodyGeometry(shape) {
  const solids = solidCount(shape);
  const physical = shapePhysicalProperties(shape);
  const volume = physical.volume;
  const bounds = shape.boundingBox?.bounds ?? null;
  let brepValid = false;
  let brepError = null;
  try {
    const analyzer = new (rc.getOC().BRepCheck_Analyzer)(shape.wrapped, true, false);
    try { brepValid = analyzer.IsValid_2(); } finally { analyzer.delete(); }
  } catch (error) { brepError = String(error?.message || error); }
  return {
    solidCount: solids,
    volume,
    surfaceArea: physical.surfaceArea,
    centerOfMass: physical.centerOfMass,
    shellCount: topologyCount(shape, 'shell'),
    faceCount: topologyCount(shape, 'face'),
    edgeCount: topologyCount(shape, 'edge'),
    vertexCount: topologyCount(shape, 'vertex'),
    bounds,
    brepValid,
    ...(brepError ? { brepError } : {}),
    valid: solids === 1 && brepValid && Number.isFinite(volume) && volume > 1e-8,
  };
}

function boundsOverlap(left, right, tolerance = 1e-7) {
  const a = left?.boundingBox?.bounds;
  const b = right?.boundingBox?.bounds;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 2 || b.length !== 2) return true;
  return [0, 1, 2].every((axis) => a[0][axis] <= b[1][axis] + tolerance && b[0][axis] <= a[1][axis] + tolerance);
}

function safeDelete(shape) {
  try { shape?.delete(); } catch {}
}

function applyBodyModifier(feature, shape, N) {
  if (feature.type === 'fillet' || feature.type === 'chamfer') {
    let hits = 0;
    const radius = Math.max(0.1, N(feature.r));
    const next = shape[feature.type]((edge) => {
      const selected = feature.edges.some((signature) => edgeMatches(signature, edge));
      if (selected) hits++;
      return selected ? radius : 0;
    });
    if (!hits) {
      safeDelete(next);
      throw new Error('the picked edges no longer exist — edit or delete this feature');
    }
    return next;
  }
  if (feature.type === 'shell') {
    let hits = 0;
    const next = shape.shell(-Math.max(0.2, Math.abs(N(feature.t))), (finder) =>
      finder.when(({ element }) => {
        const selected = feature.faces.some((signature) => faceMatches(signature, element));
        if (selected) hits++;
        return selected;
      }),
    );
    if (!hits) {
      safeDelete(next);
      throw new Error('the picked faces no longer exist — edit or delete this feature');
    }
    return next;
  }
  return null;
}

function transformDirection(frame) {
  if (frame.kind === 'plane') return frame.normal;
  if (frame.kind === 'axis') return frame.direction;
  return frame.zDirection;
}

function transformOrigin(frame) {
  return frame.origin;
}

function rotationBetween(from, to) {
  const { cross, dot, length, normalize } = studioV5VectorMath;
  const source = normalize(from);
  const target = normalize(to);
  const product = Math.max(-1, Math.min(1, dot(source, target)));
  let axis = cross(source, target);
  if (length(axis) < 1e-8) {
    if (product > 0) return { axis: [1, 0, 0], angle: 0 };
    axis = cross(source, Math.abs(source[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]);
  }
  return { axis: normalize(axis), angle: Math.acos(product) * 180 / Math.PI };
}

function applyStudioV5Transform(document, part, feature, sourceShape) {
  const resolved = resolveStudioV5Transform(document, part, feature);
  const { add, subtract, multiply, dot, cross, length, normalize, rotateVector } = studioV5VectorMath;
  let next = sourceShape.clone();
  if (resolved.mode === 'translate' || resolved.mode === 'move' || resolved.mode === 'copy') {
    return next.translate(resolved.translation);
  }
  if (resolved.mode === 'rotate') return next.rotate(resolved.angle, resolved.origin, resolved.direction);
  if (resolved.mode === 'scale') {
    if (!(resolved.factor > 0)) {
      safeDelete(next);
      throw new Error('Scale factor must be greater than zero.');
    }
    return next.scale(resolved.factor, resolved.center);
  }
  if (resolved.mode === 'mirror') return next.mirror(resolved.normal, resolved.origin);
  if (resolved.mode === 'align') {
    const fromDirection = transformDirection(resolved.from);
    const toDirection = resolved.flip ? multiply(transformDirection(resolved.to), -1) : transformDirection(resolved.to);
    const rotation = rotationBetween(fromDirection, toDirection);
    if (Math.abs(rotation.angle) > 1e-8) next = next.rotate(rotation.angle, transformOrigin(resolved.from), rotation.axis);
    if (resolved.from.xDirection && resolved.to.xDirection) {
      const rotatedFromX = Math.abs(rotation.angle) > 1e-8
        ? rotateVector(resolved.from.xDirection, rotation.axis, rotation.angle)
        : resolved.from.xDirection;
      const projectToAlignmentPlane = (direction) => subtract(direction, multiply(toDirection, dot(direction, toDirection)));
      const sourceX = projectToAlignmentPlane(rotatedFromX);
      const targetX = projectToAlignmentPlane(resolved.to.xDirection);
      if (length(sourceX) > 1e-8 && length(targetX) > 1e-8) {
        const fromX = normalize(sourceX);
        const toX = normalize(targetX);
        const twist = Math.atan2(dot(toDirection, cross(fromX, toX)), Math.max(-1, Math.min(1, dot(fromX, toX)))) * 180 / Math.PI;
        if (Math.abs(twist) > 1e-8) next = next.rotate(twist, transformOrigin(resolved.from), toDirection);
      }
    }
    const destination = add(transformOrigin(resolved.to), multiply(toDirection, resolved.offset));
    next = next.translate(subtract(destination, transformOrigin(resolved.from)));
    return next;
  }
  safeDelete(next);
  throw new Error('Unsupported transform operation.');
}

function evaluatedSketchPoints(sketch, N) {
  const entity = sketch?.entities?.[0];
  if (!entity || !Array.isArray(entity.points)) throw new Error('sketch has no editable point geometry');
  return entity.points.map((point) => point.map((value) => N(value)));
}

function mappedSectionPoints(points, section) {
  const start = section.startIndex || 0;
  const ordered = [...points.slice(start), ...points.slice(0, start)];
  return section.reversed ? [ordered[0], ...ordered.slice(1).reverse()] : ordered;
}

function profileSketch3d(document, part, sketch, section, N) {
  if (sketch.extensions?.studioRole !== 'profile' || sketch.support?.ownerKind !== 'datum') throw new Error('Loft and Sweep profiles must be plane-supported profile sketches');
  const frame = resolveStudioV5Datums(document, part.id).resolve(sketch.support.ownerId);
  if (frame.kind !== 'plane') throw new Error('profile support is not a plane');
  const points = mappedSectionPoints(evaluatedSketchPoints(sketch, N), section || {});
  if (sketch.entities[0].kind === 'spline') {
    const { add, subtract, multiply } = studioV5VectorMath;
    const worldPoints = points.map(([x, y]) => add(frame.origin, add(multiply(frame.xDirection, x), multiply(frame.yDirection, y))));
    const edges = worldPoints.map((point, index) => {
      const previous = worldPoints[(index - 1 + worldPoints.length) % worldPoints.length];
      const next = worldPoints[(index + 1) % worldPoints.length];
      const after = worldPoints[(index + 2) % worldPoints.length];
      const control1 = add(point, multiply(subtract(next, previous), 1 / 6));
      const control2 = subtract(next, multiply(subtract(after, point), 1 / 6));
      return rc.makeBezierCurve([point, control1, control2, next]);
    });
    return new rc.Sketch(rc.assembleWire(edges), { defaultOrigin: frame.origin, defaultDirection: frame.normal });
  }
  const drawing = points.slice(1).reduce((pen, point) => pen.lineTo(point), rc.draw(points[0])).close();
  const plane = new rc.Plane(frame.origin, frame.xDirection, frame.normal);
  try {
    return drawing.sketchOnPlane(plane);
  } finally {
    plane.delete();
  }
}

function pathWire3d(sketch, N) {
  if (sketch?.extensions?.studioRole !== 'path') throw new Error('feature path reference is not a path sketch');
  const points = evaluatedSketchPoints(sketch, N);
  let edges;
  if (sketch.entities[0].kind === 'spline') edges = [rc.makeBSplineApproximation(points, { tolerance: 1e-4, degMax: 5 })];
  else edges = points.slice(1).map((point, index) => rc.makeLine(points[index], point));
  return rc.assembleWire(edges);
}

function sectionFrames(document, part, sectionSketches) {
  const datums = resolveStudioV5Datums(document, part.id);
  return sectionSketches.map((sketch) => datums.resolve(sketch.support.ownerId));
}

function requireGuideIntersections(document, part, guideSketch, frames, N) {
  const points = evaluatedSketchPoints(guideSketch, N);
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    const intersects = points.some((point) => Math.abs(studioV5VectorMath.dot(studioV5VectorMath.subtract(point, frame.origin), frame.normal)) <= 1e-5);
    if (!intersects) throw new Error('guide curve misses Loft section ' + (index + 1));
  }
}

function loftContinuity(oc, feature) {
  const values = [feature.continuity?.start, feature.continuity?.end];
  if (values.includes('curvature')) return oc.GeomAbs_Shape.GeomAbs_C2;
  if (values.includes('tangent')) return oc.GeomAbs_Shape.GeomAbs_C1;
  return oc.GeomAbs_Shape.GeomAbs_C0;
}

function pipeShellFromProfiles(profileWires, spine, options = {}) {
  const oc = rc.getOC();
  const builder = new oc.BRepOffsetAPI_MakePipeShell(spine.wrapped);
  const progress = new oc.Message_ProgressRange_1();
  let law = null;
  let trimmedLaw = null;
  let step = 'initialization';
  try {
    const transition = {
      transformed: oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_Transformed,
      round: oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RoundCorner,
      right: oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner,
    }[options.transition || 'right'];
    step = 'transition setup';
    builder.SetTransitionMode(transition);
    if (options.auxiliarySpine) {
      step = 'guide setup';
      builder.SetMode_5(options.auxiliarySpine.wrapped, false, oc.BRepFill_TypeOfContact.BRepFill_NoContact);
    } else if (options.fixedDirection) {
      step = 'fixed-direction setup';
      const direction = rc.makeDirection(options.fixedDirection);
      try { builder.SetMode_3(direction); } finally { direction.delete(); }
    } else {
      step = 'orientation setup';
      builder.SetMode_1(options.frenet === true);
    }
    if (profileWires.length === 1 && options.scaleEnd != null && Math.abs(options.scaleEnd - 1) > 1e-9) {
      law = new oc.Law_Linear();
      law.Set(0, 1, spine.length, options.scaleEnd);
      trimmedLaw = law.Trim(0, spine.length, 1e-6);
      step = 'scale-law profile setup';
      builder.SetLaw_1(profileWires[0].wrapped, trimmedLaw, false, true);
    } else {
      step = 'profile setup';
      profileWires.forEach((wire) => builder.Add_1(wire.wrapped, false, true));
    }
    step = 'build';
    builder.Build(progress);
    if (options.solid !== false) { step = 'solid closure'; builder.MakeSolid(); }
    step = 'shape extraction';
    let shape;
    try { shape = rc.cast(builder.Shape()); }
    catch (error) { throw new Error('pipe-shell result unavailable: ' + String(error?.message || error)); }
    if (!shape || shape.isNull) throw new Error('OpenCascade could not build the requested guided shape');
    if (options.withBounds) {
      const firstWire = rc.cast(builder.FirstShape());
      const lastWire = rc.cast(builder.LastShape());
      if (!rc.isWire(firstWire) || !rc.isWire(lastWire)) throw new Error('guided Loft did not retain usable end profiles');
      return [shape, firstWire, lastWire];
    }
    return shape;
  } catch (error) {
    throw new Error('guided shape failed during ' + step + ': ' + String(error?.message || error));
  } finally {
    try { trimmedLaw?.delete(); } catch {}
    try { law?.delete(); } catch {}
    progress.delete();
    builder.delete();
  }
}

function generatedTwistGuide(path, twistAngle) {
  const { cross, dot, length, multiply, add, normalize, rotateVector } = studioV5VectorMath;
  const samples = 32;
  const points = [];
  let previousTangent = null;
  let transported = null;
  for (let index = 0; index <= samples; index++) {
    const t = index / samples;
    const pointVector = path.pointAt(t);
    const tangentVector = path.tangentAt(Math.min(1 - 1e-7, Math.max(1e-7, t)));
    const point = [pointVector.x, pointVector.y, pointVector.z];
    const tangent = normalize([tangentVector.x, tangentVector.y, tangentVector.z]);
    pointVector.delete(); tangentVector.delete();
    if (!transported) {
      const preferred = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
      transported = normalize(cross(tangent, preferred));
    } else {
      const axis = cross(previousTangent, tangent);
      if (length(axis) > 1e-8) {
        const angle = Math.atan2(length(axis), Math.max(-1, Math.min(1, dot(previousTangent, tangent)))) * 180 / Math.PI;
        transported = rotateVector(transported, normalize(axis), angle);
      }
    }
    previousTangent = tangent;
    const twisted = rotateVector(transported, tangent, twistAngle * t);
    points.push(add(point, multiply(twisted, 1)));
  }
  const edge = rc.makeBSplineApproximation(points, { tolerance: 1e-4, degMax: 6 });
  return rc.assembleWire([edge]);
}

function buildStudioV5Loft(document, part, feature, N) {
  const sketchById = new Map(part.sketches.map((sketch) => [sketch.id, sketch]));
  const sectionSketches = feature.sections.map((section) => {
    const sketch = sketchById.get(section.sketchId);
    if (!sketch) throw new Error('missing Loft section sketch "' + section.sketchId + '"');
    return sketch;
  });
  const sections = sectionSketches.map((sketch, index) => profileSketch3d(document, part, sketch, feature.sections[index], N));
  const frames = sectionFrames(document, part, sectionSketches);
  let guide = null;
  let spine = null;
  try {
    if (feature.guideSketchIds?.length) {
      const guideSketch = sketchById.get(feature.guideSketchIds[0]);
      if (!guideSketch) throw new Error('missing Loft guide sketch');
      requireGuideIntersections(document, part, guideSketch, frames, N);
      guide = pathWire3d(guideSketch, N);
    }
    if (feature.centerlineSketchId) {
      const centerline = sketchById.get(feature.centerlineSketchId);
      if (!centerline) throw new Error('missing Loft centerline sketch');
      spine = pathWire3d(centerline, N);
    } else if (guide) {
      const edge = rc.makeBSplineApproximation(frames.map((frame) => frame.origin), { tolerance: 1e-4, degMax: 5 });
      spine = rc.assembleWire([edge]);
    }
    let shape;
    if (spine) {
      const [shell, startWire, endWire] = pipeShellFromProfiles(sections.map((section) => section.wire), spine, { solid: false, transition: 'round', withBounds: true });
      const startFace = rc.makeFace(startWire);
      const endFace = rc.makeFace(endWire);
      let sewn = null;
      try {
        sewn = rc.weldShellsAndFaces([startFace, shell, endFace]);
        const oc = rc.getOC();
        const maker = new oc.BRepBuilderAPI_MakeSolid_1();
        try { maker.Add(sewn.wrapped); shape = rc.cast(maker.Solid()); } finally { maker.delete(); }
        if (shapeVolume(shape) < 0) {
          const oriented = rc.cast(shape.wrapped.Reversed());
          safeDelete(shape);
          shape = oriented;
        }
      } finally {
        safeDelete(sewn); safeDelete(startFace); safeDelete(endFace); safeDelete(startWire); safeDelete(endWire); safeDelete(shell);
      }
    } else {
      const oc = rc.getOC();
      const builder = new oc.BRepOffsetAPI_ThruSections(true, feature.ruled === true, 1e-6);
      const progress = new oc.Message_ProgressRange_1();
      try {
        builder.CheckCompatibility(false);
        builder.SetSmoothing(feature.ruled !== true);
        builder.SetMaxDegree(8);
        builder.SetContinuity(loftContinuity(oc, feature));
        sections.forEach((section) => builder.AddWire(section.wire.wrapped));
        builder.Build(progress);
        shape = rc.cast(builder.Shape());
      } finally {
        progress.delete(); builder.delete();
      }
    }
    return shape;
  } finally {
    sections.forEach((section) => section.delete());
    safeDelete(guide); safeDelete(spine);
  }
}

function buildStudioV5Sweep(document, part, feature, N) {
  const sketchById = new Map(part.sketches.map((sketch) => [sketch.id, sketch]));
  const profileDefinition = sketchById.get(feature.profileSketchId);
  const pathDefinition = sketchById.get(feature.pathSketchId);
  if (!profileDefinition || !pathDefinition) throw new Error('Sweep profile or path sketch is missing');
  const profile = profileSketch3d(document, part, profileDefinition, {}, N);
  const path = pathWire3d(pathDefinition, N);
  let auxiliary = null;
  try {
    if (feature.orientation === 'guide') {
      auxiliary = pathWire3d(sketchById.get(feature.guideSketchId), N);
    } else if (feature.orientation === 'controlled-twist') {
      auxiliary = generatedTwistGuide(path, N(feature.twistAngle || 0));
    }
    return pipeShellFromProfiles([profile.wire], path, {
      auxiliarySpine: auxiliary,
      fixedDirection: feature.orientation === 'fixed' || feature.orientation === 'reference' ? feature.referenceDirection.map(N) : null,
      frenet: feature.orientation === 'path-normal',
      scaleEnd: N(feature.scaleEnd ?? 1),
      transition: feature.transition,
      solid: true,
    });
  } finally {
    profile.delete(); path.delete(); safeDelete(auxiliary);
  }
}

function studioV5FeatureSolid(document, part, feature, zTop, accumulated, N, NS) {
  if (feature.type === 'imported-step') {
    const resourceId = feature.extensions?.studioImportedStep?.resourceId;
    const resource = document.resources?.find((entry) => entry.id === resourceId);
    if (!resource?.data || resource.encoding !== 'base64') throw new Error('Imported STEP body resource is missing');
    const binary = atob(resource.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return rc.deserializeShape(new TextDecoder().decode(bytes));
  }
  if (feature.type === 'loft') return buildStudioV5Loft(document, part, feature, N);
  if (feature.type === 'sweep') return buildStudioV5Sweep(document, part, feature, N);
  return featureSolid(feature, zTop, accumulated, N, NS);
}

const patternInstanceId = (patternId, index) => patternId + '-instance-' + index;

function patternReference(pattern, role) {
  return (pattern.references || []).find((reference) => reference.semanticPath?.role === role);
}

function patternCount(pattern, N) {
  const count = N(pattern.definition?.count);
  if (!Number.isInteger(count) || count < 2 || count > 5000) throw new Error('pattern count must evaluate to an integer from 2 to 5,000');
  return count;
}

function patternOccurrenceCount(pattern, N) {
  const count = patternCount(pattern, N);
  if (pattern.kind !== 'linear' || !patternReference(pattern, 'direction-2')) return count;
  const count2 = N(pattern.definition?.count2);
  if (!Number.isInteger(count2) || count2 < 2 || count * count2 > 5000) throw new Error('two-direction pattern counts must produce from 4 to 5,000 total occurrences');
  return count * count2;
}

function patternStep(index, symmetric) {
  if (!symmetric) return index;
  return Math.ceil(index / 2) * (index % 2 ? 1 : -1);
}

function shapeCenter(shape) {
  const bounds = shape.boundingBox?.bounds;
  if (!bounds) return [0, 0, 0];
  return bounds[0].map((value, axis) => (value + bounds[1][axis]) / 2);
}

const identityMatrix = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiplyMatrix(left, right) {
  const out = Array(16).fill(0);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let inner = 0; inner < 4; inner++) out[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner];
  }
  return out;
}
const translationMatrix = ([x, y, z]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
function rotationMatrix(degrees, point, axis) {
  const [x, y, z] = studioV5VectorMath.normalize(axis);
  const angle = degrees * Math.PI / 180;
  const c = Math.cos(angle); const s = Math.sin(angle); const t = 1 - c;
  const rotation = [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
  return multiplyMatrix(translationMatrix(point), multiplyMatrix(rotation, translationMatrix(point.map((value) => -value))));
}
function mirrorMatrix(normal, point) {
  const [x, y, z] = studioV5VectorMath.normalize(normal);
  const offset = 2 * (x * point[0] + y * point[1] + z * point[2]);
  return [
    1 - 2 * x * x, -2 * x * y, -2 * x * z, 0,
    -2 * x * y, 1 - 2 * y * y, -2 * y * z, 0,
    -2 * x * z, -2 * y * z, 1 - 2 * z * z, 0,
    offset * x, offset * y, offset * z, 1,
  ];
}
function sceneRenderMatrix(cadMatrix) {
  const cadToScene = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
  const sceneToCad = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
  return multiplyMatrix(cadToScene, multiplyMatrix(cadMatrix, sceneToCad));
}
function applyLocatedTransform(shape, configure) {
  const transformation = new rc.Transformation();
  let transformer = null;
  try {
    configure(transformation);
    const OC = rc.getOC();
    transformer = new OC.BRepBuilderAPI_Transform_2(shape.wrapped, transformation.wrapped, false);
    return rc.cast(transformer.ModifiedShape(shape.wrapped));
  } finally {
    transformer?.delete();
    transformation.delete();
    shape.delete();
  }
}
function pathFrameAtArcFraction(path, fraction) {
  const adaptor = new path.oc.BRepAdaptor_CompCurve_2(path.wrapped, true);
  const point = new path.oc.gp_Pnt_1();
  const tangent = new path.oc.gp_Vec_1();
  try {
    const parameter = adaptor.FirstParameter() + (adaptor.LastParameter() - adaptor.FirstParameter()) * fraction;
    adaptor.D1(parameter, point, tangent);
    return {
      point: [point.X(), point.Y(), point.Z()],
      tangent: [tangent.X(), tangent.Y(), tangent.Z()],
    };
  } finally {
    point.delete(); tangent.delete(); adaptor.delete();
  }
}

function patternTransform(document, part, pattern, sourceShape, index, N, sketchById) {
  const definition = pattern.definition || {};
  const { add, subtract, multiply, dot, length, normalize, rotateVector } = studioV5VectorMath;
  const datums = resolveStudioV5Datums(document, part.id);
  let next = sourceShape.clone();
  let placement = identityMatrix();
  const translate = (vector) => {
    next = applyLocatedTransform(next, (transformation) => transformation.translate(vector));
    placement = multiplyMatrix(translationMatrix(vector), placement);
  };
  const rotate = (degrees, point, axis) => {
    next = applyLocatedTransform(next, (transformation) => transformation.rotate(degrees, point, axis));
    placement = multiplyMatrix(rotationMatrix(degrees, point, axis), placement);
  };
  try {
  if (pattern.kind === 'mirror') {
    const reference = patternReference(pattern, 'plane');
    const frame = datums.resolve(reference.ownerId);
    next = applyLocatedTransform(next, (transformation) => transformation.mirror(frame.normal, frame.origin));
    placement = multiplyMatrix(mirrorMatrix(frame.normal, frame.origin), placement);
    return { shape: next, placement };
  }
  if (pattern.kind === 'linear') {
    const count = patternCount(pattern, N);
    const secondReference = patternReference(pattern, 'direction-2');
    const firstIndex = secondReference ? index % count : index;
    const secondIndex = secondReference ? Math.floor(index / count) : 0;
    const transformDirection = (reference, ordinal, distribution, spacing, extent, positions, symmetric, alternating) => {
      if (!reference || ordinal === 0) return;
      const frame = datums.resolve(reference.ownerId);
      const direction = frame.kind === 'axis' ? frame.direction : frame.xDirection;
      const dimensionCount = reference === secondReference ? N(definition.count2) : count;
      let distance;
      if (distribution === 'table') distance = N(positions[ordinal - 1]);
      else if (distribution === 'extent') distance = N(extent) / (dimensionCount - 1) * patternStep(ordinal, symmetric);
      else distance = N(spacing) * patternStep(ordinal, symmetric);
      translate(multiply(direction, distance));
      if (alternating === true && ordinal % 2 === 1) rotate(180, shapeCenter(next), direction);
    };
    transformDirection(patternReference(pattern, 'direction'), firstIndex, definition.distribution, definition.spacing, definition.extent, definition.positions, definition.symmetric, definition.alternating);
    transformDirection(secondReference, secondIndex, definition.distribution2, definition.spacing2, definition.extent2, definition.positions2, definition.symmetric2, definition.alternating2);
    return { shape: next, placement };
  }
  if (pattern.kind === 'circular') {
    const reference = patternReference(pattern, 'axis');
    const frame = datums.resolve(reference.ownerId);
    const direction = frame.kind === 'axis' ? frame.direction : frame.zDirection;
    const count = patternCount(pattern, N);
    let angle;
    if (definition.distribution === 'table') angle = N(definition.angles[index - 1]);
    else if (definition.distribution === 'spacing') angle = N(definition.spacingAngle) * patternStep(index, definition.symmetric);
    else if (definition.distribution === 'extent') angle = N(definition.totalAngle) / (count - 1) * patternStep(index, definition.symmetric);
    else angle = 360 / count * index;
    const center = shapeCenter(sourceShape);
    const centerOffset = subtract(center, frame.origin);
    const axialComponent = multiply(direction, dot(centerOffset, direction));
    const radial = subtract(centerOffset, axialComponent);
    const radialDirection = length(radial) > 1e-8 ? normalize(rotateVector(radial, direction, angle)) : [1, 0, 0];
    if (definition.orientation === 'preserve') {
      const rotatedCenter = add(frame.origin, add(axialComponent, rotateVector(radial, direction, angle)));
      translate(subtract(rotatedCenter, center));
    } else {
      rotate(angle, frame.origin, direction);
      if (definition.orientation === 'alternating' && index % 2 === 1) rotate(180, shapeCenter(next), direction);
    }
    const radialOffset = N(definition.radialOffset ?? 0) * index;
    const axialOffset = N(definition.axialOffset ?? 0) * index;
    if (Math.abs(radialOffset) > 1e-9 || Math.abs(axialOffset) > 1e-9) {
      translate(add(multiply(radialDirection, radialOffset), multiply(direction, axialOffset)));
    }
    return { shape: next, placement };
  }
  const reference = patternReference(pattern, 'path');
  const pathSketch = sketchById.get(reference.ownerId);
  const path = pathWire3d(pathSketch, N);
  try {
    const count = patternCount(pattern, N);
    let parameter;
    if (definition.distribution === 'table') parameter = N(definition.parameters[index - 1]);
    else if (definition.distribution === 'spacing') parameter = index * N(definition.spacing) / path.length;
    else if (definition.distribution === 'extent') parameter = index * N(definition.extent) / (count - 1) / path.length;
    else parameter = index / (count - 1);
    if (!(parameter >= 0 && parameter <= 1)) throw new Error('curve pattern parameter must stay between 0 and 1');
    const startFrame = pathFrameAtArcFraction(path, 0);
    const currentFrame = pathFrameAtArcFraction(path, parameter);
    const startPoint = startFrame.point;
    const point = currentFrame.point;
    if (definition.orientation === 'tangent') {
      const rotation = rotationBetween(startFrame.tangent, currentFrame.tangent);
      if (Math.abs(rotation.angle) > 1e-8) rotate(rotation.angle, startPoint, rotation.axis);
    }
    translate(subtract(point, startPoint));
    return { shape: next, placement };
  } finally {
    path.delete();
  }
  } catch (error) {
    safeDelete(next);
    throw error;
  }
}

async function buildV5Document(document, options = {}) {
  await loadKernel();
  const part = options.partId
    ? (document.partDefinitions || []).find((entry) => entry.id === options.partId)
    : v5RootPart(document);
  if (!part) throw new Error('The requested schema-5 part definition is missing.');
  const { strict: N, safe: NS } = evaluator(document, part);
  const featureById = new Map(part.features.map((feature) => [feature.id, feature]));
  const bodyById = new Map(part.bodies.map((body) => [body.id, body]));
  const cache = options.cache || new Map();
  const previousCache = options.previousCache || new Map();
  const evaluating = new Set();
  const signatures = new Map();
  const signing = new Set();
  const results = new Map();
  const errors = [];
  const evaluatedBodyIds = [];
  const reusedBodyIds = [];
  const evaluatedFeatureIds = [];
  const reusedFeatureIds = [];
  const evaluatedPatternInstanceIds = [];
  const reusedPatternInstanceIds = [];
  const parameterState = [document.parameters || [], part.parameters || []];
  const datumById = new Map((part.referenceGeometry || []).map((datum) => [datum.id, datum]));
  const sketchById = new Map((part.sketches || []).map((sketch) => [sketch.id, sketch]));
  const datumSignatures = new Map();
  const signingDatums = new Set();
  function datumSignature(datumId) {
    if (datumSignatures.has(datumId)) return datumSignatures.get(datumId);
    if (signingDatums.has(datumId)) return 'cyclic:' + datumId;
    signingDatums.add(datumId);
    const datum = datumById.get(datumId);
    const dependencyIds = Object.entries(datum?.definition || {})
      .filter(([key, value]) => (key.endsWith('DatumId') || key.endsWith('DatumIds')) && (typeof value === 'string' || Array.isArray(value)))
      .flatMap(([, value]) => Array.isArray(value) ? value : [value]);
    const signature = stableHash({ datum, dependencies: dependencyIds.map((id) => [id, datumSignature(id)]) });
    signingDatums.delete(datumId);
    datumSignatures.set(datumId, signature);
    return signature;
  }
  const requestedRollbackIndex = part.metadata?.rollbackFeatureId
    ? part.featureOrder.indexOf(part.metadata.rollbackFeatureId)
    : -1;
  const rollbackIndex = requestedRollbackIndex >= 0 ? requestedRollbackIndex : part.featureOrder.length - 1;
  const enabledFeatureIds = new Set(part.featureOrder.slice(0, rollbackIndex + 1));

  function signatureFor(bodyId) {
    if (signatures.has(bodyId)) return signatures.get(bodyId);
    if (signing.has(bodyId)) throw new Error('cyclic body dependency at "' + bodyId + '"');
    signing.add(bodyId);
    const body = bodyById.get(bodyId);
    if (!body) throw new Error('missing body "' + bodyId + '"');
    const features = body.featureIds.map((featureId) => featureById.get(featureId)).filter((feature) => feature && enabledFeatureIds.has(feature.id));
    const toolSignatures = [];
    const referencedDatumSignatures = [];
    const referencedSketchSignatures = [];
    for (const feature of features) {
      if (feature.suppressed) continue;
      if (feature.type === 'imported-step') {
        const resourceId = feature.extensions?.studioImportedStep?.resourceId;
        const resource = document.resources?.find((entry) => entry.id === resourceId);
        toolSignatures.push(['resource:' + String(resourceId || ''), stableHash(resource || null)]);
      }
      for (const toolBodyId of feature.toolBodyIds || []) toolSignatures.push([toolBodyId, signatureFor(toolBodyId)]);
      for (const reference of feature.inputRefs || []) {
        if (reference.ownerKind === 'datum') referencedDatumSignatures.push([reference.ownerId, datumSignature(reference.ownerId)]);
        if (reference.ownerKind === 'sketch') {
          const sketch = sketchById.get(reference.ownerId);
          const supportSignature = sketch?.support?.ownerKind === 'datum' ? datumSignature(sketch.support.ownerId) : null;
          referencedSketchSignatures.push([reference.ownerId, stableHash({ sketch, supportSignature })]);
        }
      }
    }
    const signature = stableHash({ parameterState, kind: body.kind, features, toolSignatures, referencedDatumSignatures, referencedSketchSignatures });
    signatures.set(bodyId, signature);
    signing.delete(bodyId);
    return signature;
  }

  function evaluateBody(bodyId) {
    if (results.has(bodyId)) return results.get(bodyId);
    if (evaluating.has(bodyId)) throw new Error('cyclic body dependency at "' + bodyId + '"');
    evaluating.add(bodyId);
    const body = bodyById.get(bodyId);
    if (!body) throw new Error('missing body "' + bodyId + '"');
    const signature = signatureFor(bodyId);
    const cached = cache.get(bodyId);
    if (cached?.signature === signature && cached.shape) {
      const result = { ...cached, body, reused: true, lastValid: false };
      results.set(bodyId, result);
      reusedBodyIds.push(bodyId);
      reusedFeatureIds.push(...body.featureIds);
      evaluating.delete(bodyId);
      return result;
    }

    let shape = null;
    let failure = null;
    let currentFeature = null;
    try {
      for (const featureId of body.featureIds) {
        const feature = featureById.get(featureId);
        if (!feature || feature.suppressed || !enabledFeatureIds.has(feature.id)) continue;
        currentFeature = feature;
        evaluatedFeatureIds.push(feature.id);
        const policy = feature.resultPolicy;
        if (policy.kind === 'surface') throw new Error('surface results are not supported by this solid feature yet');
        if (policy.kind === 'new-body') {
          if (feature.type === 'boolean') throw new Error('a Boolean cannot create a new body');
          const next = feature.type === 'transform'
            ? (() => {
                const source = evaluateBody(feature.sourceBodyId);
                if (!source.shape || source.error) throw new Error('source body "' + feature.sourceBodyId + '" has no valid solid');
                return applyStudioV5Transform(document, part, feature, source.shape);
              })()
            : studioV5FeatureSolid(document, part, feature, 0, null, N, NS);
          if (!next) throw new Error('the feature produced no solid');
          safeDelete(shape);
          shape = next;
        } else if (feature.type === 'boolean') {
          if (!shape) throw new Error('the Boolean target has no valid solid');
          let next = shape;
          const before = bodyGeometry(shape);
          for (const toolBodyId of feature.toolBodyIds || []) {
            const tool = evaluateBody(toolBodyId);
            if (!tool.shape || tool.error) throw new Error('tool body "' + toolBodyId + '" has no valid solid');
            const operation = feature.operation || policy.kind;
            if ((operation === 'subtract' || operation === 'intersect') && !boundsOverlap(next, tool.shape)) {
              throw new Error('the selected tool does not intersect the target body');
            }
            const operated = operation === 'add'
              ? next.fuse(tool.shape)
              : operation === 'intersect'
                ? next.intersect(tool.shape)
                : next.cut(tool.shape);
            if (next !== shape) safeDelete(next);
            next = operated;
          }
          const after = bodyGeometry(next);
          if (!after.valid) {
            if (next !== shape) safeDelete(next);
            throw new Error('the Boolean did not produce exactly one valid solid');
          }
          if (policy.kind === 'subtract' && before.volume - after.volume <= Math.max(1e-7, before.volume * 1e-9)) {
            if (next !== shape) safeDelete(next);
            throw new Error('the selected tool does not intersect the target body');
          }
          if (policy.kind === 'intersect' && after.volume >= before.volume - Math.max(1e-7, before.volume * 1e-9)) {
            if (next !== shape) safeDelete(next);
            throw new Error('the intersection did not isolate shared material');
          }
          if (next !== shape) safeDelete(shape);
          shape = next;
        } else {
          if (!shape) throw new Error('target body has no solid before ' + feature.name);
          if (feature.type === 'transform') {
            const transformed = applyStudioV5Transform(document, part, feature, shape);
            const geometry = bodyGeometry(transformed);
            if (!geometry.valid) {
              safeDelete(transformed);
              throw new Error('the transform result is not exactly one valid solid');
            }
            safeDelete(shape);
            shape = transformed;
            continue;
          }
          const modified = applyBodyModifier(feature, shape, N);
          if (modified) {
            safeDelete(shape);
            shape = modified;
            continue;
          }
          const tool = studioV5FeatureSolid(document, part, feature, topOf(shape), shape, N, NS);
          let next;
          if (policy.kind === 'add') next = shape.fuse(tool);
          else if (policy.kind === 'intersect') next = shape.intersect(tool);
          else next = shape.cut(tool);
          safeDelete(tool);
          const before = bodyGeometry(shape);
          const after = bodyGeometry(next);
          if (!after.valid) {
            safeDelete(next);
            throw new Error('the ' + policy.kind + ' result is not exactly one valid solid');
          }
          if (policy.kind === 'add' && after.solidCount !== 1) {
            safeDelete(next);
            throw new Error('disconnected additive geometry must use New body');
          }
          if (policy.kind === 'subtract' && before.volume - after.volume <= Math.max(1e-7, before.volume * 1e-9)) {
            safeDelete(next);
            throw new Error('the subtract feature does not intersect its target body');
          }
          safeDelete(shape);
          shape = next;
        }
        const geometry = bodyGeometry(shape);
        if (!geometry.valid) throw new Error('feature result is not exactly one valid solid (solids ' + geometry.solidCount + ', volume ' + geometry.volume + (geometry.brepError ? ', check ' + geometry.brepError : '') + ')');
      }
      if (!shape) throw new Error('body history produced no solid');
    } catch (error) {
      failure = {
        bodyId,
        featureId: currentFeature?.id || body.createdByFeatureId,
        featureType: currentFeature?.type || 'body',
        message: String(error?.message || error),
      };
      errors.push(failure);
    }

    if (failure) {
      safeDelete(shape);
      const previous = previousCache.get(bodyId);
      const result = previous?.shape
        ? { ...previous, body, error: failure, reused: false, lastValid: true }
        : { signature, shape: null, geometry: null, body, error: failure, reused: false, lastValid: false };
      results.set(bodyId, result);
      evaluating.delete(bodyId);
      return result;
    }

    const entry = { signature, shape, geometry: bodyGeometry(shape), body, error: null, reused: false, lastValid: false };
    results.set(bodyId, entry);
    evaluatedBodyIds.push(bodyId);
    evaluating.delete(bodyId);
    return entry;
  }

  for (const body of part.bodies) evaluateBody(body.id);
  const patternResults = new Map();
  for (const pattern of part.bodyPatterns || []) {
    if (pattern.suppressed) continue;
    let count;
    let source;
    try {
      count = patternOccurrenceCount(pattern, N);
      source = evaluateBody(pattern.sourceBodyId);
      if (!source?.shape || source.error) throw new Error('source body has no valid exact solid');
    } catch (error) {
      const failure = { bodyId: pattern.sourceBodyId, featureId: pattern.id, featureType: 'pattern', message: String(error?.message || error) };
      errors.push(failure);
      for (const previous of previousCache.values()) {
        if (previous?.body?.patternInstance?.patternId !== pattern.id || !previous.shape) continue;
        const index = previous.body.patternInstance.index;
        if ((pattern.skippedIndices || []).includes(index) || (count && index >= count)) continue;
        const body = {
          ...previous.body,
          name: pattern.name + ' ' + (index + 1),
          visible: pattern.visible !== false && (source?.body?.visible ?? bodyById.get(pattern.sourceBodyId)?.visible) !== false,
        };
        patternResults.set(body.id, { ...previous, body, error: { ...failure, bodyId: body.id }, reused: false, lastValid: true });
      }
      continue;
    }
    const skipped = new Set(pattern.skippedIndices || []);
    const referenceState = (pattern.references || []).map((reference) => {
      if (reference.ownerKind === 'datum') {
        try { return [reference.ownerId, resolveStudioV5Datums(document, part.id).resolve(reference.ownerId)]; }
        catch (error) { return [reference.ownerId, { error: String(error?.message || error) }]; }
      }
      const sketch = sketchById.get(reference.ownerId);
      return [reference.ownerId, sketch];
    });
    for (let index = 1; index < count; index++) {
      if (skipped.has(index)) continue;
      const bodyId = patternInstanceId(pattern.id, index);
      const body = {
        id: bodyId,
        name: pattern.name + ' ' + (index + 1),
        kind: source.body.kind,
        visible: pattern.visible !== false && source.body.visible !== false,
        suppressed: false,
        patternInstance: { patternId: pattern.id, index, sourceBodyId: pattern.sourceBodyId },
      };
      const signature = stableHash({
        pattern: { id: pattern.id, kind: pattern.kind, sourceBodyId: pattern.sourceBodyId, references: pattern.references, definition: pattern.definition },
        index,
        source: source.signature,
        referenceState,
      });
      const cached = cache.get(bodyId);
      if (cached?.signature === signature && cached.shape) {
        patternResults.set(bodyId, { ...cached, body, reused: true, lastValid: false });
        reusedPatternInstanceIds.push(bodyId);
        continue;
      }
      try {
        const transformed = patternTransform(document, part, pattern, source.shape, index, N, sketchById);
        const shape = transformed.shape;
        const geometry = bodyGeometry(shape);
        if (!geometry.valid) {
          safeDelete(shape);
          throw new Error('generated occurrence is not exactly one valid solid');
        }
        patternResults.set(bodyId, {
          signature, shape, geometry, body, renderTransform: transformed.placement,
          sharesSourceGeometry: shape.wrapped.IsPartner(source.shape.wrapped),
          error: null, reused: false, lastValid: false,
        });
        evaluatedPatternInstanceIds.push(bodyId);
      } catch (error) {
        const failure = { bodyId, featureId: pattern.id, featureType: 'pattern', message: 'occurrence ' + index + ': ' + String(error?.message || error) };
        errors.push(failure);
        const previous = previousCache.get(bodyId);
        patternResults.set(bodyId, previous?.shape
          ? { ...previous, body, error: failure, reused: false, lastValid: true }
          : { signature, shape: null, geometry: null, body, error: failure, reused: false, lastValid: false });
      }
    }
  }
  return {
    part,
    results,
    patternResults,
    errors,
    trace: { evaluatedBodyIds, reusedBodyIds, evaluatedFeatureIds, reusedFeatureIds, evaluatedPatternInstanceIds, reusedPatternInstanceIds },
  };
}

function rigidMatrixAxisAngle(matrix) {
  const m00 = matrix[0]; const m01 = matrix[4]; const m02 = matrix[8];
  const m10 = matrix[1]; const m11 = matrix[5]; const m12 = matrix[9];
  const m20 = matrix[2]; const m21 = matrix[6]; const m22 = matrix[10];
  const trace = m00 + m11 + m22;
  let x; let y; let z; let w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const magnitude = Math.hypot(x, y, z);
  if (magnitude < 1e-12) return { angle: 0, axis: [0, 0, 1] };
  return { angle: 2 * Math.atan2(magnitude, w) * 180 / Math.PI, axis: [x / magnitude, y / magnitude, z / magnitude] };
}

function applyRigidMatrix(shape, matrix) {
  let next = shape.clone();
  const rotation = rigidMatrixAxisAngle(matrix);
  if (Math.abs(rotation.angle) > 1e-10) next = applyLocatedTransform(next, (transformation) => transformation.rotate(rotation.angle, [0, 0, 0], rotation.axis));
  const translation = [matrix[12], matrix[13], matrix[14]];
  if (Math.hypot(...translation) > 1e-10) next = applyLocatedTransform(next, (transformation) => transformation.translate(translation));
  return next;
}

const STUDIO_V5_STEP_BYTES = 50 * 1024 * 1024;
const STUDIO_V5_STEP_MANIFEST_PREFIX = '/*BOMWIKI_V5_MANIFEST:';
const STUDIO_V5_STEP_MANIFEST_SUFFIX = '*/';

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToUtf8(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function stepManifestFromText(text) {
  const start = text.indexOf(STUDIO_V5_STEP_MANIFEST_PREFIX);
  if (start < 0) return null;
  const encodedStart = start + STUDIO_V5_STEP_MANIFEST_PREFIX.length;
  const end = text.indexOf(STUDIO_V5_STEP_MANIFEST_SUFFIX, encodedStart);
  if (end < 0 || end - encodedStart > 8 * 1024 * 1024) throw new Error('BOMwiki STEP hierarchy manifest is invalid or too large');
  const manifest = JSON.parse(base64ToUtf8(text.slice(encodedStart, end)));
  if (manifest?.format !== 'bomwiki-v5-step-assembly-1' || manifest.units !== 'mm') throw new Error('BOMwiki STEP hierarchy manifest is unsupported');
  return manifest;
}

async function withStepManifest(blob, manifest) {
  const text = await blob.text();
  const marker = STUDIO_V5_STEP_MANIFEST_PREFIX + utf8ToBase64(JSON.stringify(manifest)) + STUDIO_V5_STEP_MANIFEST_SUFFIX;
  const insertion = text.indexOf('\n');
  const next = insertion < 0 ? text + '\n' + marker : text.slice(0, insertion + 1) + marker + '\n' + text.slice(insertion + 1);
  return new Blob([next], { type: 'application/STEP' });
}

function ocExtendedString(oc, value) {
  return new oc.TCollection_ExtendedString_2(String(value || 'Unnamed'), true);
}

function ocLocationFromMatrix(oc, matrix) {
  const transform = new oc.gp_Trsf_1();
  transform.SetValues(
    matrix[0], matrix[4], matrix[8], matrix[12],
    matrix[1], matrix[5], matrix[9], matrix[13],
    matrix[2], matrix[6], matrix[10], matrix[14],
  );
  const location = new oc.TopLoc_Location_2(transform);
  transform.delete();
  return location;
}

function setOcLabelName(oc, label, name) {
  const wrapped = ocExtendedString(oc, name);
  oc.TDataStd_Name.Set_1(label, wrapped);
  wrapped.delete();
}

function writeXcafStep(oc, document) {
  // The default writer owns its work session. Keeping that lifetime inside a
  // single wrapper avoids dangling Handle_XSControl_WorkSession instances in
  // the long-lived WASM worker after repeated export/import cycles.
  const writer = new oc.STEPCAFControl_Writer_1();
  oc.Interface_Static.SetCVal('xstep.cascade.unit', 'MM');
  oc.Interface_Static.SetCVal('write.step.unit', 'MM');
  writer.SetColorMode(true);
  writer.SetLayerMode(true);
  writer.SetNameMode(true);
  oc.Interface_Static.SetIVal('write.surfacecurve.mode', true);
  oc.Interface_Static.SetIVal('write.precision.mode', 0);
  oc.Interface_Static.SetIVal('write.step.assembly', 2);
  oc.Interface_Static.SetIVal('write.step.schema', 5);
  const progress = new oc.Message_ProgressRange_1();
  const documentHandle = new oc.Handle_TDocStd_Document_2(document);
  writer.Transfer_1(documentHandle, oc.STEPControl_StepModelType.STEPControl_AsIs, null, progress);
  documentHandle.delete(); progress.delete();
  const filename = 'bomwiki-assembly-export.step';
  const status = writer.Write(filename);
  writer.delete();
  if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('Structured STEP export failed');
  const file = oc.FS.readFile('/' + filename);
  oc.FS.unlink('/' + filename);
  return new Blob([file], { type: 'application/STEP' });
}

function sourcePatternOccurrenceTransform(solution, leaf) {
  if (leaf.definition.kind === 'part') return leaf.transform;
  const sourceId = leaf.sourceOccurrenceId;
  const child = solution.subassemblies.get(sourceId);
  const childLeaf = child?.leafOccurrences.find((entry) => !entry.patternInstance && entry.occurrencePath.join('/') === leaf.occurrencePath.slice(1).join('/'))
    || child?.leafOccurrences.find((entry) => !entry.patternInstance);
  if (!childLeaf) throw new Error('Cannot resolve patterned subassembly placement');
  return studioV5MultiplyMatrices(leaf.transform, studioV5RigidInverse(childLeaf.transform));
}

function createStructuredAssemblyStep(document, built, selected) {
  const oc = rc.getOC();
  const documentType = ocExtendedString(oc, 'XmlOcaf');
  const xcafDocument = new oc.TDocStd_Document(documentType);
  documentType.delete();
  oc.XCAFDoc_ShapeTool.SetAutoNaming(false);
  const mainLabel = xcafDocument.Main();
  const shapeToolHandle = oc.XCAFDoc_DocumentTool.ShapeTool(mainLabel);
  const shapeTool = shapeToolHandle.get();
  const selectedKeys = new Set(selected.map((runtime) => runtime.occurrenceInstance.definition.partId + ':' + runtime.localBodyId));
  const bodyLabels = new Map();
  const partLabels = new Map();
  const assemblyLabels = new Map();
  const manifestParts = [];
  const manifestAssemblies = [];
  const selectedPaths = selected.map((runtime) => runtime.occurrenceInstance.occurrencePath);
  const pathStartsWith = (path, prefix) => prefix.every((id, index) => path[index] === id);
  const contextsByAssembly = new Map([[built.solution.assembly.id, [[]]]]);
  const contextQueue = [built.solution.assembly.id];
  while (contextQueue.length) {
    const assemblyId = contextQueue.shift();
    const assembly = (document.assemblyDefinitions || []).find((entry) => entry.id === assemblyId);
    const contexts = contextsByAssembly.get(assemblyId) || [];
    for (const occurrence of assembly?.occurrences || []) {
      if (occurrence.suppressed || occurrence.definition.kind !== 'assembly') continue;
      const childContexts = contexts
        .map((prefix) => [...prefix, occurrence.id])
        .filter((prefix) => selectedPaths.some((path) => pathStartsWith(path, prefix)));
      if (!childContexts.length) continue;
      const childId = occurrence.definition.assemblyId;
      const existing = contextsByAssembly.get(childId) || [];
      const additions = childContexts.filter((prefix) => !existing.some((entry) => entry.join('/') === prefix.join('/')));
      if (additions.length) {
        contextsByAssembly.set(childId, [...existing, ...additions]);
        contextQueue.push(childId);
      }
    }
  }

  try {
    for (const [partId, partBuild] of built.partBuilds) {
      const part = partBuild.part;
      const localResults = [
        ...part.bodies.map((body) => ({ body, result: partBuild.results.get(body.id) })),
        ...[...partBuild.patternResults.values()].map((result) => ({ body: result.body, result })),
      ].filter(({ body, result }) => selectedKeys.has(partId + ':' + body.id) && result?.shape && result.geometry?.valid);
      if (!localResults.length) continue;
      const partLabel = shapeTool.NewShape();
      setOcLabelName(oc, partLabel, part.name);
      partLabels.set(partId, partLabel);
      const manifestBodies = [];
      for (const { body, result } of localResults) {
        const definitionLabel = shapeTool.AddShape(result.shape.wrapped, false, false);
        setOcLabelName(oc, definitionLabel, body.name);
        bodyLabels.set(partId + ':' + body.id, definitionLabel);
        const location = ocLocationFromMatrix(oc, assemblyIdentityMatrix());
        const componentLabel = shapeTool.AddComponent_1(partLabel, definitionLabel, location);
        setOcLabelName(oc, componentLabel, body.name);
        location.delete();
        manifestBodies.push({ id: body.id, name: body.name, kind: body.kind, visible: body.visible !== false, appearanceId: body.appearanceId || null });
      }
      if (manifestBodies.length) manifestParts.push({ id: partId, name: part.name, bodies: manifestBodies });
    }

    for (const assembly of document.assemblyDefinitions || []) {
      if (!contextsByAssembly.has(assembly.id)) continue;
      const label = shapeTool.NewShape();
      setOcLabelName(oc, label, assembly.name);
      assemblyLabels.set(assembly.id, label);
    }
    const solutions = collectAssemblySolutions(built.solution);
    for (const assembly of document.assemblyDefinitions || []) {
      const solution = solutions.get(assembly.id);
      if (!solution) continue;
      const parentLabel = assemblyLabels.get(assembly.id);
      const contexts = contextsByAssembly.get(assembly.id) || [];
      const occurrences = [];
      for (const occurrence of assembly.occurrences) {
        if (occurrence.suppressed) continue;
        if (!contexts.some((prefix) => selectedPaths.some((path) => pathStartsWith(path, [...prefix, occurrence.id])))) continue;
        const definitionLabel = occurrence.definition.kind === 'part'
          ? partLabels.get(occurrence.definition.partId)
          : assemblyLabels.get(occurrence.definition.assemblyId);
        if (!definitionLabel) continue;
        const transform = solution.transforms.get(occurrence.id);
        const location = ocLocationFromMatrix(oc, transform);
        const componentLabel = shapeTool.AddComponent_1(parentLabel, definitionLabel, location);
        setOcLabelName(oc, componentLabel, occurrence.name);
        location.delete();
        occurrences.push({
          id: occurrence.id, name: occurrence.name, definition: occurrence.definition,
          transform, visible: occurrence.visible !== false, extensions: { importedFromStep: true },
        });
      }
      const generatedTopIds = new Set();
      for (const leaf of solution.leafOccurrences.filter((entry) => entry.patternInstance)) {
        const topId = leaf.occurrencePath[0];
        if (generatedTopIds.has(topId)) continue;
        if (!contexts.some((prefix) => selectedPaths.some((path) => pathStartsWith(path, [...prefix, topId])))) continue;
        generatedTopIds.add(topId);
        const source = assembly.occurrences.find((entry) => entry.id === leaf.sourceOccurrenceId);
        const definitionLabel = source?.definition.kind === 'part'
          ? partLabels.get(source.definition.partId)
          : assemblyLabels.get(source?.definition.assemblyId);
        if (!source || !definitionLabel) continue;
        const transform = source.definition.kind === 'part' ? leaf.transform : sourcePatternOccurrenceTransform(solution, leaf);
        const name = leaf.name.split(' / ')[0];
        const location = ocLocationFromMatrix(oc, transform);
        const componentLabel = shapeTool.AddComponent_1(parentLabel, definitionLabel, location);
        setOcLabelName(oc, componentLabel, name);
        location.delete();
        occurrences.push({
          id: topId, name, definition: source.definition, transform,
          visible: source.visible !== false, extensions: { importedFromStep: true, sourcePatternId: leaf.patternInstance.patternId },
        });
      }
      manifestAssemblies.push({ id: assembly.id, name: assembly.name, occurrences });
    }
    shapeTool.UpdateAssemblies();
    const blob = writeXcafStep(oc, xcafDocument);
    const bodyInstances = selected.map((runtime) => ({
      bodyId: runtime.bodyId,
      partId: runtime.occurrenceInstance.definition.partId,
      localBodyId: runtime.localBodyId,
      name: runtime.bodyName,
      occurrencePath: runtime.occurrenceInstance.occurrencePath,
      transform: runtime.exactPlacement,
      bounds: runtime.geometry?.bounds || null,
      volume: runtime.geometry?.volume ?? null,
    }));
    return {
      blob,
      manifest: {
        format: 'bomwiki-v5-step-assembly-1', schemaVersion: 5, units: 'mm',
        projectName: document.name, rootAssemblyId: built.solution.assembly.id,
        parts: manifestParts, assemblies: manifestAssemblies, bodyInstances,
        limitations: ['exact-brep-and-solved-hierarchy-only', 'no-parametric-feature-history', 'no-mate-recovery'],
      },
    };
  } finally {
    safeDelete(shapeToolHandle);
    safeDelete(xcafDocument);
  }
}

function collectAssemblySolutions(solution, target = new Map()) {
  target.set(solution.assembly.id, solution);
  for (const child of solution.subassemblies.values()) collectAssemblySolutions(child, target);
  return target;
}

async function buildV5Assembly(document, options = {}) {
  await loadKernel();
  if (document.rootDocument?.kind !== 'assembly') throw new Error('This worker request requires a schema-5 assembly document.');
  const solution = solveStudioV5Assembly(document, document.rootDocument.assemblyId, { previousByAssembly: options.previousSolutions || new Map() });
  const partBuilds = new Map();
  for (const occurrence of solution.leafOccurrences) {
    const partId = occurrence.definition.partId;
    if (!partBuilds.has(partId)) partBuilds.set(partId, await buildV5Document(document, { ...options, partId }));
  }
  const runtimeBodies = [];
  const errors = solution.errors.map((error) => ({ ...error, featureType: 'mate' }));
  for (const occurrence of solution.leafOccurrences) {
    const built = partBuilds.get(occurrence.definition.partId);
    for (const body of built.part.bodies) {
      const result = built.results.get(body.id);
      const bodyId = occurrence.id + ':' + body.id;
      const geometry = result?.geometry ? {
        ...result.geometry,
        bounds: studioV5TransformBounds(result.geometry.bounds, occurrence.transform),
        centerOfMass: result.geometry.centerOfMass ? studioV5TransformPoint(occurrence.transform, result.geometry.centerOfMass) : null,
      } : null;
      const error = result?.error ? { ...result.error, bodyId, occurrencePath: occurrence.occurrencePath } : null;
      if (error) errors.push(error);
      runtimeBodies.push({
        bodyId,
        localBodyId: body.id,
        bodyName: occurrence.name + ' / ' + body.name,
        kind: body.kind,
        visible: occurrence.visible && body.visible,
        suppressed: occurrence.suppressed || body.suppressed,
        occurrenceInstance: {
          occurrenceId: occurrence.id,
          occurrencePath: occurrence.occurrencePath,
          definition: occurrence.definition,
          sourceOccurrenceId: occurrence.sourceOccurrenceId,
          patternInstance: occurrence.patternInstance || null,
        },
        sourceBodyId: body.id,
        sourceKey: occurrence.definition.partId + ':' + body.id,
        exactShape: result?.shape || null,
        renderShape: result?.shape || null,
        exactPlacement: occurrence.transform,
        renderTransform: occurrence.transform,
        geometry,
        error,
        lastValid: Boolean(result?.lastValid || solution.usedLastValid),
      });
    }
    for (const result of built.patternResults.values()) {
      const source = built.results.get(result.body.patternInstance.sourceBodyId);
      const bodyId = occurrence.id + ':' + result.body.id;
      const placement = studioV5MultiplyMatrices(occurrence.transform, result.renderTransform || assemblyIdentityMatrix());
      const geometry = result.geometry ? {
        ...result.geometry,
        bounds: studioV5TransformBounds(result.geometry.bounds, occurrence.transform),
        centerOfMass: result.geometry.centerOfMass ? studioV5TransformPoint(occurrence.transform, result.geometry.centerOfMass) : null,
      } : null;
      const error = result.error ? { ...result.error, bodyId, occurrencePath: occurrence.occurrencePath } : null;
      if (error) errors.push(error);
      runtimeBodies.push({
        bodyId,
        localBodyId: result.body.id,
        bodyName: occurrence.name + ' / ' + result.body.name,
        kind: result.body.kind,
        visible: occurrence.visible && result.body.visible,
        suppressed: occurrence.suppressed || result.body.suppressed,
        occurrenceInstance: {
          occurrenceId: occurrence.id,
          occurrencePath: occurrence.occurrencePath,
          definition: occurrence.definition,
          sourceOccurrenceId: occurrence.sourceOccurrenceId,
          patternInstance: occurrence.patternInstance || null,
        },
        patternInstance: result.body.patternInstance,
        sourceBodyId: result.body.patternInstance.sourceBodyId,
        sourceKey: occurrence.definition.partId + ':' + result.body.patternInstance.sourceBodyId,
        exactShape: result.shape,
        renderShape: source?.shape || null,
        exactPlacement: occurrence.transform,
        renderTransform: placement,
        geometry,
        error,
        lastValid: Boolean(result.lastValid || solution.usedLastValid),
      });
    }
  }
  return {
    solution,
    partBuilds,
    runtimeBodies,
    errors,
    trace: {
      assemblyId: solution.assembly.id,
      solverState: solution.state,
      degreesOfFreedom: Object.fromEntries(solution.degreesOfFreedom),
      conflicts: solution.conflicts,
      redundantMateIds: solution.redundantMateIds,
      usedLastValid: solution.usedLastValid,
      evaluatedPartIds: [...partBuilds.keys()],
      reusedBodyIds: [...partBuilds.values()].flatMap((built) => built.trace.reusedBodyIds),
      evaluatedBodyIds: [...partBuilds.values()].flatMap((built) => built.trace.evaluatedBodyIds),
    },
  };
}

function serializeShape(shape) {
  if (!shape) return { mesh: null, transfer: [] };
  const mesh = shape.mesh({ tolerance: 0.05, angularTolerance: 0.3 });
  const vertices = Float32Array.from(mesh.vertices);
  const normals = mesh.normals ? Float32Array.from(mesh.normals) : null;
  const triangles = Uint32Array.from(mesh.triangles);
  const faceGroups = (mesh.faceGroups || []).map((group) => ({
    start: group.start,
    count: group.count,
    faceId: group.faceId,
  }));
  const planarFaces = [];
  for (const face of shape.faces) {
    try {
      if (face.geomType === 'PLANE') {
        planarFaces.push({ faceId: face.hashCode, sig: faceSignature(face), outline: faceOutline(face) });
      }
    } catch {}
  }
  const edges = [];
  try {
    const edgeMesh = shape.meshEdges();
    const byHash = new Map(shape.edges.map((edge) => [edge.hashCode, edge]));
    for (const group of edgeMesh.edgeGroups || []) {
      const edge = byHash.get(group.edgeId);
      if (!edge) continue;
      edges.push({
        points: Float32Array.from(edgeMesh.lines.slice(group.start * 3, (group.start + group.count) * 3)),
        sig: edgeSignature(edge),
      });
    }
  } catch {}
  const bounds = shape.boundingBox?.bounds ?? null;
  const transfer = [vertices.buffer, triangles.buffer, ...edges.map((edge) => edge.points.buffer)];
  if (normals) transfer.push(normals.buffer);
  return {
    mesh: { vertices, normals, triangles, faceGroups, planarFaces, edges, bounds },
    transfer,
  };
}

async function rebuild(request) {
  if (request.document?.schemaVersion === 5) return rebuildV5(request);
  const { shape, errors } = await buildLegacyDocument(request.document);
  const previous = currentShape;
  currentShape = shape;
  for (const entry of currentBodyCache.values()) safeDelete(entry.shape);
  currentBodyCache = new Map();
  currentRevision = request.revision;
  const { mesh, transfer } = serializeShape(shape);
  if (previous && previous !== shape) safeDelete(previous);
  if (request.delayMs) await new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(0, request.delayMs))));
  self.postMessage(
    {
      kind: 'rebuild-result',
      requestId: request.requestId,
      projectId: request.projectId,
      revision: request.revision,
      mesh,
      errors,
    },
    transfer,
  );
}

async function rebuildV5(request) {
  if (request.document.rootDocument?.kind === 'assembly') return rebuildV5Assembly(request);
  const previousCache = currentBodyCache;
  const built = await buildV5Document(request.document, { cache: previousCache, previousCache });
  const nextCache = new Map();
  const bodies = [];
  const transfer = [];
  for (const body of built.part.bodies) {
    const result = built.results.get(body.id);
    if (result?.shape && !result.error) nextCache.set(body.id, result);
    else if (result?.shape && result.lastValid) nextCache.set(body.id, previousCache.get(body.id));
    const serialized = !body.suppressed && result?.shape ? serializeShape(result.shape) : { mesh: null, transfer: [] };
    transfer.push(...serialized.transfer);
    bodies.push({
      bodyId: body.id,
      bodyName: body.name,
      sourceBodyId: body.id,
      kind: body.kind,
      visible: body.visible,
      suppressed: body.suppressed,
      mesh: serialized.mesh,
      geometry: result?.geometry || null,
      error: result?.error || null,
      lastValid: Boolean(result?.lastValid),
    });
  }
  for (const result of built.patternResults.values()) {
    const body = result.body;
    if (result?.shape && !result.error) nextCache.set(body.id, result);
    else if (result?.shape && result.lastValid) nextCache.set(body.id, previousCache.get(body.id));
    bodies.push({
      bodyId: body.id,
      bodyName: body.name,
      sourceBodyId: body.patternInstance.sourceBodyId,
      kind: body.kind,
      visible: body.visible,
      suppressed: body.suppressed,
      patternInstance: body.patternInstance,
      mesh: null,
      renderSourceBodyId: body.patternInstance.sourceBodyId,
      renderTransform: sceneRenderMatrix(result.renderTransform || identityMatrix()),
      sharesSourceGeometry: result.sharesSourceGeometry === true,
      geometry: result?.geometry || null,
      error: result?.error || null,
      lastValid: Boolean(result?.lastValid),
    });
  }
  for (const [bodyId, entry] of previousCache) {
    if (nextCache.get(bodyId)?.shape !== entry.shape) safeDelete(entry.shape);
  }
  safeDelete(currentShape);
  currentShape = null;
  currentBodyCache = nextCache;
  currentRevision = request.revision;
  if (request.delayMs) await new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(0, request.delayMs))));
  self.postMessage({
    kind: 'rebuild-result',
    requestId: request.requestId,
    projectId: request.projectId,
    revision: request.revision,
    bodies,
    errors: built.errors,
    evaluation: built.trace,
  }, transfer);
}

async function rebuildV5Assembly(request) {
  const previousCache = currentBodyCache;
  const built = await buildV5Assembly(request.document, { cache: previousCache, previousCache, previousSolutions: currentAssemblySolutions });
  const nextCache = new Map();
  for (const partBuild of built.partBuilds.values()) {
    for (const body of partBuild.part.bodies) {
      const result = partBuild.results.get(body.id);
      if (result?.shape && !result.error) nextCache.set(body.id, result);
      else if (result?.shape && result.lastValid) nextCache.set(body.id, previousCache.get(body.id));
    }
    for (const result of partBuild.patternResults.values()) {
      if (result?.shape && !result.error) nextCache.set(result.body.id, result);
      else if (result?.shape && result.lastValid) nextCache.set(result.body.id, previousCache.get(result.body.id));
    }
  }
  const templateBodyIds = new Map();
  const bodies = [];
  const transfer = [];
  for (const runtime of built.runtimeBodies) {
    const templateBodyId = templateBodyIds.get(runtime.sourceKey);
    let serialized = { mesh: null, transfer: [] };
    if (!templateBodyId && runtime.renderShape) {
      serialized = serializeShape(runtime.renderShape);
      templateBodyIds.set(runtime.sourceKey, runtime.bodyId);
      transfer.push(...serialized.transfer);
    }
    bodies.push({
      bodyId: runtime.bodyId,
      bodyName: runtime.bodyName,
      kind: runtime.kind,
      visible: runtime.visible,
      suppressed: runtime.suppressed,
      occurrenceInstance: runtime.occurrenceInstance,
      patternInstance: runtime.patternInstance || null,
      sourceBodyId: runtime.sourceBodyId,
      sourceKey: runtime.sourceKey,
      mesh: serialized.mesh,
      ...(templateBodyId ? { renderSourceBodyId: templateBodyId, sharesSourceGeometry: true } : {}),
      renderTransform: sceneRenderMatrix(runtime.renderTransform || identityMatrix()),
      geometry: runtime.geometry,
      error: runtime.error,
      lastValid: runtime.lastValid,
    });
  }
  for (const [bodyId, entry] of previousCache) if (nextCache.get(bodyId)?.shape !== entry.shape) safeDelete(entry.shape);
  safeDelete(currentShape);
  currentShape = null;
  currentBodyCache = nextCache;
  if (!built.solution.errors.length) currentAssemblySolutions = collectAssemblySolutions(built.solution);
  currentRevision = request.revision;
  if (request.delayMs) await new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(0, request.delayMs))));
  self.postMessage({
    kind: 'rebuild-result',
    requestId: request.requestId,
    projectId: request.projectId,
    revision: request.revision,
    bodies,
    errors: built.errors,
    evaluation: built.trace,
  }, transfer);
}

async function validateV5(request) {
  if (request.document.rootDocument?.kind === 'assembly') return validateV5Assembly(request);
  const built = await buildV5Document(request.document, { cache: new Map(), previousCache: new Map() });
  const bodies = built.part.bodies.map((body) => {
    const result = built.results.get(body.id);
    return {
      bodyId: body.id,
      bodyName: body.name,
      suppressed: body.suppressed,
      geometry: result?.geometry || null,
      error: result?.error || null,
    };
  });
  for (const result of built.patternResults.values()) {
    bodies.push({
      bodyId: result.body.id,
      bodyName: result.body.name,
      patternInstance: result.body.patternInstance,
      suppressed: result.body.suppressed,
      geometry: result.geometry || null,
      error: result.error || null,
    });
  }
  const disposed = new Set();
  for (const result of [...built.results.values(), ...built.patternResults.values()]) {
    if (result.shape && !disposed.has(result.shape)) {
      disposed.add(result.shape);
      safeDelete(result.shape);
    }
  }
  if (request.delayMs) await new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(0, request.delayMs))));
  self.postMessage({
    kind: 'validation-result',
    requestId: request.requestId,
    projectId: request.projectId,
    revision: request.revision,
    bodies,
    errors: built.errors,
    evaluation: built.trace,
  });
}

async function validateV5Assembly(request) {
  const built = await buildV5Assembly(request.document, { cache: new Map(), previousCache: new Map(), previousSolutions: new Map() });
  const bodies = built.runtimeBodies.map((runtime) => ({
    bodyId: runtime.bodyId,
    bodyName: runtime.bodyName,
    occurrenceInstance: runtime.occurrenceInstance,
    patternInstance: runtime.patternInstance || null,
    suppressed: runtime.suppressed,
    geometry: runtime.geometry,
    error: runtime.error,
  }));
  const disposed = new Set();
  for (const partBuild of built.partBuilds.values()) for (const result of [...partBuild.results.values(), ...partBuild.patternResults.values()]) {
    if (result.shape && !disposed.has(result.shape)) { disposed.add(result.shape); safeDelete(result.shape); }
  }
  if (request.delayMs) await new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(0, request.delayMs))));
  self.postMessage({
    kind: 'validation-result', requestId: request.requestId, projectId: request.projectId, revision: request.revision,
    bodies, errors: built.errors, evaluation: built.trace,
  });
}

function inspectionMaterial(document, runtime) {
  const partId = runtime.occurrenceInstance?.definition?.partId || document.rootDocument?.partId;
  const part = document.partDefinitions.find((entry) => entry.id === partId);
  const body = part?.bodies.find((entry) => entry.id === runtime.sourceBodyId || entry.id === runtime.bodyId);
  const material = body?.materialId ? document.materials.find((entry) => entry.id === body.materialId) : null;
  return { part, body, material };
}

function disposeV5Build(built) {
  const disposed = new Set();
  const builds = built.partBuilds ? [...built.partBuilds.values()] : [built];
  for (const partBuild of builds) for (const result of [...partBuild.results.values(), ...partBuild.patternResults.values()]) {
    if (result.shape && !disposed.has(result.shape)) { disposed.add(result.shape); safeDelete(result.shape); }
  }
}

async function inspectV5(request) {
  await loadKernel();
  if (request.document?.schemaVersion !== 5) throw new Error('Engineering inspection requires a schema-5 project.');
  let built;
  let runtimes;
  if (request.document.rootDocument?.kind === 'assembly') {
    built = await buildV5Assembly(request.document, { cache: new Map(), previousCache: new Map(), previousSolutions: new Map() });
    runtimes = built.runtimeBodies;
  } else {
    built = await buildV5Document(request.document, { cache: new Map(), previousCache: new Map() });
    runtimes = [
      ...built.part.bodies.map((body) => {
        const result = built.results.get(body.id);
        return { bodyId: body.id, bodyName: body.name, sourceBodyId: body.id, visible: body.visible, suppressed: body.suppressed, exactShape: result?.shape, exactPlacement: assemblyIdentityMatrix(), geometry: result?.geometry, error: result?.error };
      }),
      ...[...built.patternResults.values()].map((result) => ({
        bodyId: result.body.id, bodyName: result.body.name, sourceBodyId: result.body.patternInstance.sourceBodyId,
        visible: result.body.visible, suppressed: result.body.suppressed, exactShape: result.shape, exactPlacement: assemblyIdentityMatrix(), geometry: result.geometry, error: result.error,
      })),
    ];
  }
  const requested = Array.isArray(request.bodyIds) && request.bodyIds.length ? new Set(request.bodyIds) : null;
  const candidates = runtimes.filter((runtime) => (!requested || requested.has(runtime.bodyId)) && !runtime.suppressed);
  const selected = candidates.filter((runtime) => runtime.exactShape);
  const errors = [...(built.errors || [])]
    .filter((error) => !requested || !error.bodyId || requested.has(error.bodyId));
  if (!selected.length) errors.push({ featureType: 'inspection', message: 'Select at least one valid unsuppressed body or component.' });
  if (requested) for (const bodyId of requested) if (!runtimes.some((runtime) => runtime.bodyId === bodyId)) errors.push({ bodyId, featureType: 'inspection', message: 'Selected inspection body no longer exists.' });
  for (const runtime of candidates) if (!runtime.exactShape && !errors.some((error) => error.bodyId === runtime.bodyId)) {
    errors.push({ bodyId: runtime.bodyId, featureType: 'inspection', message: 'Selected body has no exact geometry to inspect.' });
  }
  const placed = [];
  try {
    for (const runtime of selected) {
      const shape = applyRigidMatrix(runtime.exactShape, runtime.exactPlacement || assemblyIdentityMatrix());
      const physical = shapePhysicalProperties(shape);
      const { part, body, material } = inspectionMaterial(request.document, runtime);
      const densityKgM3 = material?.densityKgM3 ?? null;
      placed.push({
        runtime, shape,
        properties: {
          bodyId: runtime.bodyId,
          bodyName: runtime.bodyName,
          occurrencePath: runtime.occurrenceInstance?.occurrencePath || [],
          partId: part?.id || null,
          sourceBodyId: body?.id || runtime.sourceBodyId || runtime.bodyId,
          volumeMm3: physical.volume,
          surfaceAreaMm2: physical.surfaceArea,
          centerOfMassMm: physical.centerOfMass,
          massKg: densityKgM3 == null ? null : physical.volume * 1e-9 * densityKgM3,
          materialId: material?.id || null,
          materialName: material?.name || null,
          health: {
            valid: runtime.geometry?.valid === true && !runtime.error,
            brepValid: runtime.geometry?.brepValid === true,
            solidCount: runtime.geometry?.solidCount ?? solidCount(shape),
            shellCount: runtime.geometry?.shellCount ?? topologyCount(shape, 'shell'),
            faceCount: runtime.geometry?.faceCount ?? topologyCount(shape, 'face'),
            edgeCount: runtime.geometry?.edgeCount ?? topologyCount(shape, 'edge'),
            vertexCount: runtime.geometry?.vertexCount ?? topologyCount(shape, 'vertex'),
            freeEdgeCount: runtime.geometry?.valid ? 0 : null,
            nonManifold: runtime.geometry?.brepValid === false,
            recoveredLastValid: Boolean(runtime.lastValid || runtime.error),
          },
          bounds: shape.boundingBox?.bounds || null,
        },
      });
    }
    const properties = placed.map((entry) => entry.properties);
    const totalVolumeMm3 = properties.reduce((total, entry) => total + entry.volumeMm3, 0);
    const knownMass = properties.filter((entry) => entry.massKg != null);
    const knownMassKg = knownMass.reduce((total, entry) => total + entry.massKg, 0);
    const missingMaterialBodyIds = properties.filter((entry) => entry.massKg == null).map((entry) => entry.bodyId);
    const centerOfVolumeMm = [0, 1, 2].map((axis) => totalVolumeMm3 > 0
      ? properties.reduce((total, entry) => total + entry.centerOfMassMm[axis] * entry.volumeMm3, 0) / totalVolumeMm3
      : 0);
    const centerOfKnownMassMm = [0, 1, 2].map((axis) => knownMassKg > 0
      ? knownMass.reduce((total, entry) => total + entry.centerOfMassMm[axis] * entry.massKg, 0) / knownMassKg
      : null);
    const centerOfMassMm = missingMaterialBodyIds.length ? [null, null, null] : centerOfKnownMassMm;
    const pairs = [];
    let broadPhasePairs = 0;
    if (request.mode === 'interference' || request.mode === 'clearance') {
      const pairFilter = Array.isArray(request.pairBodyIds) && request.pairBodyIds.length === 2 ? new Set(request.pairBodyIds) : null;
      for (let leftIndex = 0; leftIndex < placed.length; leftIndex++) for (let rightIndex = leftIndex + 1; rightIndex < placed.length; rightIndex++) {
        const left = placed[leftIndex]; const right = placed[rightIndex];
        if (pairFilter && (!pairFilter.has(left.runtime.bodyId) || !pairFilter.has(right.runtime.bodyId))) continue;
        const overlaps = boundsOverlap(left.shape, right.shape, Number(request.tolerance) || 0);
        if (overlaps) broadPhasePairs++;
        let interferenceVolumeMm3 = 0;
        if (overlaps) {
          let intersection = null;
          try {
            intersection = left.shape.intersect(right.shape);
            interferenceVolumeMm3 = shapeVolume(intersection);
          } catch {}
          finally { safeDelete(intersection); }
        }
        let minimumClearanceMm = 0;
        if (!(interferenceVolumeMm3 > 1e-8)) {
          const distanceTool = new rc.DistanceTool();
          try { minimumClearanceMm = distanceTool.distanceBetween(left.shape, right.shape); }
          catch { minimumClearanceMm = null; }
          finally { distanceTool.delete(); }
        }
        pairs.push({
          leftBodyId: left.runtime.bodyId, rightBodyId: right.runtime.bodyId,
          leftOccurrencePath: left.runtime.occurrenceInstance?.occurrencePath || [], rightOccurrencePath: right.runtime.occurrenceInstance?.occurrencePath || [],
          interferenceVolumeMm3, minimumClearanceMm,
        });
      }
    }
    self.postMessage({
      kind: 'inspection-result', requestId: request.requestId, projectId: request.projectId, revision: request.revision,
      errors,
      inspection: {
        mode: request.mode || 'properties',
        revisionKey: stableHash(request.document),
        bodyCount: properties.length,
        properties,
        aggregate: {
          volumeMm3: totalVolumeMm3,
          surfaceAreaMm2: properties.reduce((total, entry) => total + entry.surfaceAreaMm2, 0),
          massKg: missingMaterialBodyIds.length ? null : knownMassKg,
          knownMassKg,
          centerOfVolumeMm,
          centerOfMassMm,
          centerOfKnownMassMm,
          missingMaterialBodyIds,
          valid: errors.length === 0 && properties.every((entry) => entry.health.valid),
        },
        broadPhasePairs,
        pairs,
      },
    });
  } finally {
    for (const entry of placed) safeDelete(entry.shape);
    disposeV5Build(built);
  }
}

async function exportDocument(request) {
  if (request.document?.schemaVersion === 5) return exportV5Document(request);
  const { shape, errors } = await buildLegacyDocument(request.document);
  if (!shape || errors.length) {
    try {
      shape?.delete();
    } catch {}
    self.postMessage({
      kind: 'export-result',
      requestId: request.requestId,
      projectId: request.projectId,
      revision: request.revision,
      errors,
      blob: null,
    });
    return;
  }
  const blob = request.kind === 'export-step'
    ? shape.blobSTEP()
    : shape.blobSTL({ tolerance: 0.03, angularTolerance: 0.3 });
  try {
    shape.delete();
  } catch {}
  self.postMessage({
    kind: 'export-result',
    requestId: request.requestId,
    projectId: request.projectId,
    revision: request.revision,
    errors: [],
    blob,
  });
}

async function exportV5Document(request) {
  if (request.document.rootDocument?.kind === 'assembly') return exportV5AssemblyDocument(request);
  const built = await buildV5Document(request.document, { cache: new Map(), previousCache: new Map() });
  const runtimeBodies = [
    ...built.part.bodies.map((body) => ({ body, result: built.results.get(body.id) })),
    ...[...built.patternResults.values()].map((result) => ({ body: result.body, result })),
  ];
  const requestedIds = Array.isArray(request.bodyIds) && request.bodyIds.length
    ? new Set(request.bodyIds)
    : new Set(runtimeBodies.filter(({ body }) => body.visible && !body.suppressed).map(({ body }) => body.id));
  const selected = runtimeBodies.filter(({ body }) => requestedIds.has(body.id) && !body.suppressed);
  const errors = [
    ...built.errors.filter((error) => requestedIds.has(error.bodyId)),
    ...[...requestedIds]
      .filter((bodyId) => !runtimeBodies.some(({ body }) => body.id === bodyId))
      .map((bodyId) => ({ bodyId, featureType: 'export', message: 'selected body does not exist' })),
  ];
  if (!selected.length) errors.push({ featureType: 'export', message: 'select at least one unsuppressed body' });
  if (selected.some(({ result }) => !result?.shape || !result.geometry?.valid)) {
    errors.push({ featureType: 'export', message: 'one or more selected bodies have no valid exact solid' });
  }
  let blob = null;
  if (!errors.length) {
    if (request.kind === 'export-step') {
      blob = rc.exportSTEP(
        selected.map(({ body, result }) => ({ shape: result.shape, name: body.name, color: '#a7b8c9' })),
        { unit: 'MM', modelUnit: 'MM' },
      );
    } else {
      const compound = rc.compoundShapes(selected.map(({ result }) => result.shape.clone()));
      try {
        blob = compound.blobSTL({ tolerance: 0.03, angularTolerance: 0.3, binary: true });
      } finally {
        safeDelete(compound);
      }
    }
  }
  const manifest = {
    schemaVersion: 5,
    units: 'mm',
    bodyCount: selected.length,
    solidCount: selected.reduce((total, entry) => total + (entry.result?.geometry?.solidCount || 0), 0),
    names: selected.map(({ body }) => body.name),
    placements: selected.map(({ body, result }) => ({ bodyId: body.id, bounds: result?.geometry?.bounds || null })),
  };
  const disposed = new Set();
  for (const result of [...built.results.values(), ...built.patternResults.values()]) {
    if (result.shape && !disposed.has(result.shape)) {
      disposed.add(result.shape);
      safeDelete(result.shape);
    }
  }
  self.postMessage({
    kind: 'export-result',
    requestId: request.requestId,
    projectId: request.projectId,
    revision: request.revision,
    errors,
    blob,
    manifest,
  });
}

async function exportV5AssemblyDocument(request) {
  const built = await buildV5Assembly(request.document, { cache: new Map(), previousCache: new Map(), previousSolutions: new Map() });
  const available = built.runtimeBodies.filter((runtime) => runtime.visible && !runtime.suppressed);
  const requestedIds = Array.isArray(request.bodyIds) && request.bodyIds.length
    ? new Set(request.bodyIds)
    : new Set(available.map((runtime) => runtime.bodyId));
  const selected = built.runtimeBodies.filter((runtime) => requestedIds.has(runtime.bodyId) && !runtime.suppressed);
  const completeAssembly = request.kind === 'export-step' &&
    selected.length === available.length && available.every((runtime) => requestedIds.has(runtime.bodyId));
  const errors = [
    ...built.errors.filter((error) => !error.bodyId || requestedIds.has(error.bodyId)),
    ...[...requestedIds]
      .filter((bodyId) => !built.runtimeBodies.some((runtime) => runtime.bodyId === bodyId))
      .map((bodyId) => ({ bodyId, featureType: 'export', message: 'selected assembly body does not exist' })),
  ];
  if (!selected.length) errors.push({ featureType: 'export', message: 'select at least one visible assembly body' });
  if (selected.some((runtime) => !runtime.exactShape || !runtime.geometry?.valid)) errors.push({ featureType: 'export', message: 'one or more selected component bodies have no valid exact solid' });
  const placed = [];
  let blob = null;
  let interchangeManifest = null;
  try {
    if (!errors.length) {
      if (completeAssembly) {
        const structured = createStructuredAssemblyStep(request.document, built, selected);
        interchangeManifest = structured.manifest;
        blob = await withStepManifest(structured.blob, structured.manifest);
      } else {
        for (const runtime of selected) placed.push({ runtime, shape: applyRigidMatrix(runtime.exactShape, runtime.exactPlacement) });
      }
      if (request.kind === 'export-step' && !completeAssembly) {
        blob = rc.exportSTEP(
          placed.map(({ runtime, shape }) => ({ shape, name: runtime.bodyName, color: '#a7b8c9' })),
          { unit: 'MM', modelUnit: 'MM' },
        );
      } else if (request.kind !== 'export-step') {
        const compound = rc.compoundShapes(placed.map(({ shape }) => shape.clone()));
        try { blob = compound.blobSTL({ tolerance: 0.03, angularTolerance: 0.3, binary: true }); }
        finally { safeDelete(compound); }
      }
    }
  } finally {
    for (const entry of placed) safeDelete(entry.shape);
  }
  const manifest = {
    schemaVersion: 5,
    units: 'mm',
    documentKind: 'assembly',
    assemblyId: built.solution.assembly.id,
    bodyCount: selected.length,
    componentCount: new Set(selected.map((runtime) => runtime.occurrenceInstance.occurrenceId)).size,
    solidCount: selected.reduce((total, runtime) => total + (runtime.geometry?.solidCount || 0), 0),
    names: selected.map((runtime) => runtime.bodyName),
    placements: selected.map((runtime) => ({
      bodyId: runtime.bodyId,
      occurrencePath: runtime.occurrenceInstance.occurrencePath,
      transform: runtime.exactPlacement,
      bounds: runtime.geometry?.bounds || null,
    })),
    interchange: interchangeManifest,
    structuredHierarchy: Boolean(interchangeManifest),
  };
  const disposed = new Set();
  for (const partBuild of built.partBuilds.values()) for (const result of [...partBuild.results.values(), ...partBuild.patternResults.values()]) {
    if (result.shape && !disposed.has(result.shape)) { disposed.add(result.shape); safeDelete(result.shape); }
  }
  self.postMessage({
    kind: 'export-result', requestId: request.requestId, projectId: request.projectId, revision: request.revision,
    errors, blob, manifest,
  });
}

function shapeMatchScore(geometry, instance) {
  if (!instance?.bounds || !Number.isFinite(instance.volume)) return Number.POSITIVE_INFINITY;
  if (!geometry.bounds || !Number.isFinite(geometry.volume)) return Number.POSITIVE_INFINITY;
  const boundDelta = Math.max(...geometry.bounds.flatMap((corner, side) => corner.map((value, axis) => Math.abs(value - instance.bounds[side][axis]))));
  const size = Math.max(1, ...instance.bounds.flat().map(Math.abs));
  const volumeDelta = Math.abs(geometry.volume - instance.volume) / Math.max(1, Math.abs(instance.volume));
  if (boundDelta > Math.max(0.02, size * 1e-6) || volumeDelta > 1e-5) return Number.POSITIVE_INFINITY;
  return boundDelta / size + volumeDelta;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function importedBodyRecord(ids, name, serialized, originalBody) {
  const bytes = new TextEncoder().encode(serialized);
  return {
    resource: {
      id: ids.resourceId, name: name + ' exact STEP B-rep', mimeType: 'text/plain',
      byteLength: bytes.byteLength, encoding: 'base64', data: bytesToBase64(bytes),
      extensions: { studioImportedStep: { source: 'step' } },
    },
    feature: {
      id: ids.featureId, name: 'Imported ' + name, type: 'imported-step', suppressed: false, inputRefs: [],
      resultPolicy: { kind: 'new-body', bodyName: name },
      extensions: { studioImportedStep: { resourceId: ids.resourceId, exactBrep: true, parametricHistory: false } },
    },
    body: {
      id: ids.bodyId, name, kind: originalBody?.kind || 'solid', createdByFeatureId: ids.featureId,
      featureIds: [ids.featureId], visible: originalBody?.visible !== false, suppressed: false,
      ...(originalBody?.appearanceId ? { appearanceId: originalBody.appearanceId } : {}),
    },
  };
}

function importedPartRecord(id, name, bodyRecords) {
  return {
    id, name, parameters: [], referenceGeometry: [], sketches: [],
    bodies: bodyRecords.map((entry) => entry.body), bodyPatterns: [],
    features: bodyRecords.map((entry) => entry.feature), featureOrder: bodyRecords.map((entry) => entry.feature.id),
    metadata: { activeBodyId: bodyRecords[0]?.body.id || null, importedFromStep: true },
    extensions: { studioImportedStep: { exactBrep: true, parametricHistory: false } },
  };
}

function assertImportedResourceBudget(resources) {
  if (resources.length > 1000) throw new Error('STEP import exceeds the 1,000 exact-body resource limit');
  const bytes = resources.reduce((total, resource) => total + resource.byteLength, 0);
  if (bytes > 100 * 1024 * 1024) throw new Error('STEP import exceeds the 100 MB exact-body resource limit');
}

function assertImportedManifestBudget(manifest, solidCount) {
  const parts = Array.isArray(manifest.parts) ? manifest.parts : [];
  const assemblies = Array.isArray(manifest.assemblies) ? manifest.assemblies : [];
  const instances = Array.isArray(manifest.bodyInstances) ? manifest.bodyInstances : [];
  const occurrenceCount = assemblies.reduce((total, assembly) => total + (Array.isArray(assembly?.occurrences) ? assembly.occurrences.length : 0), 0);
  if (parts.length > STUDIO_V5_PROJECT_LIMITS.partDefinitions) throw new Error('BOMwiki STEP hierarchy exceeds the part-definition limit');
  if (assemblies.length > STUDIO_V5_PROJECT_LIMITS.assemblyDefinitions) throw new Error('BOMwiki STEP hierarchy exceeds the assembly-definition limit');
  if (occurrenceCount > STUDIO_V5_PROJECT_LIMITS.occurrences) throw new Error('BOMwiki STEP hierarchy exceeds the occurrence limit');
  if (instances.length > STUDIO_V5_PROJECT_LIMITS.generatedOccurrences) throw new Error('BOMwiki STEP hierarchy exceeds the 5,000 body-instance import limit');
  if (solidCount > STUDIO_V5_PROJECT_LIMITS.generatedOccurrences) throw new Error('STEP import exceeds the 5,000 exact-solid separation limit');
}

function createStructuredImportedProject(filename, manifest, solids, solidGeometry) {
  if (!Array.isArray(manifest.parts) || !Array.isArray(manifest.assemblies) || !Array.isArray(manifest.bodyInstances)) {
    throw new Error('BOMwiki STEP hierarchy manifest is incomplete');
  }
  assertImportedManifestBudget(manifest, solids.length);
  const unused = new Set(solids.map((_, index) => index));
  const matched = new Map();
  for (const instance of manifest.bodyInstances) {
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const index of unused) {
      const score = shapeMatchScore(solidGeometry[index], instance);
      if (score < bestScore) { bestIndex = index; bestScore = score; }
    }
    if (bestIndex < 0) throw new Error('STEP geometry does not match its BOMwiki hierarchy manifest');
    unused.delete(bestIndex);
    const key = instance.partId + ':' + instance.localBodyId;
    if (!matched.has(key)) matched.set(key, { solid: solids[bestIndex], instance });
  }
  if (unused.size || matched.size === 0) throw new Error('STEP solid count does not match its BOMwiki hierarchy manifest');

  const resources = [];
  const parts = [];
  let sequence = 0;
  for (const part of manifest.parts) {
    const bodyRecords = [];
    for (const originalBody of part.bodies || []) {
      const found = matched.get(part.id + ':' + originalBody.id);
      if (!found) continue;
      const localShape = applyRigidMatrix(found.solid, studioV5RigidInverse(found.instance.transform));
      try {
        const suffix = (++sequence).toString(36);
        const record = importedBodyRecord({
          bodyId: originalBody.id,
          featureId: 'feature-step-' + suffix,
          resourceId: 'resource-step-' + suffix,
        }, originalBody.name, localShape.serialize(), originalBody);
        resources.push(record.resource); bodyRecords.push(record);
      } finally { safeDelete(localShape); }
    }
    if (bodyRecords.length) parts.push(importedPartRecord(part.id, part.name, bodyRecords));
  }
  assertImportedResourceBudget(resources);
  const partIds = new Set(parts.map((part) => part.id));
  const assemblyIds = new Set((manifest.assemblies || []).map((assembly) => assembly.id));
  const assemblies = (manifest.assemblies || []).map((assembly) => ({
    id: assembly.id, name: assembly.name, parameters: [],
    occurrences: (assembly.occurrences || []).filter((occurrence) =>
      occurrence.definition?.kind === 'part' ? partIds.has(occurrence.definition.partId) : assemblyIds.has(occurrence.definition?.assemblyId),
    ).map((occurrence) => ({
      id: occurrence.id, name: occurrence.name, definition: occurrence.definition,
      baseTransform: occurrence.transform, fixed: true, suppressed: false, visible: occurrence.visible !== false,
      extensions: { studioImportedStep: { solvedPlacement: true, sourcePatternId: occurrence.extensions?.sourcePatternId || null } },
    })),
    mates: [], occurrencePatterns: [], explodedViews: [], sectionViews: [],
    metadata: { importedFromStep: true },
    extensions: { studioImportedStep: { solvedHierarchy: true, mateRecovery: false } },
  }));
  if (!parts.length || !assemblies.some((assembly) => assembly.id === manifest.rootAssemblyId)) throw new Error('BOMwiki STEP hierarchy has no reusable geometry or root assembly');
  return {
    schemaVersion: 5,
    projectId: 'project-step-' + crypto.randomUUID(),
    name: manifest.projectName || filename.replace(/\.(step|stp)$/i, '') || 'Imported STEP assembly',
    units: 'mm', parameters: [], materials: [], partDefinitions: parts, assemblyDefinitions: assemblies,
    rootDocument: { kind: 'assembly', assemblyId: manifest.rootAssemblyId }, resources,
    metadata: {
      importedFromStep: true, importMode: 'bomwiki-solved-hierarchy',
      importLimitations: ['no-parametric-feature-history', 'no-mate-recovery'],
    },
  };
}

function createFlatImportedProject(filename, solids) {
  const resources = [];
  const bodyRecords = [];
  solids.forEach((solid, index) => {
    const suffix = (index + 1).toString(36);
    const bodyName = 'Imported solid ' + (index + 1);
    const record = importedBodyRecord({
      bodyId: 'body-step-' + suffix, featureId: 'feature-step-' + suffix, resourceId: 'resource-step-' + suffix,
    }, bodyName, solid.serialize());
    resources.push(record.resource);
    bodyRecords.push(record);
  });
  assertImportedResourceBudget(resources);
  const partId = 'part-step-flat';
  const parts = [importedPartRecord(partId, 'Imported STEP solids', bodyRecords)];
  const occurrences = [{
    id: 'occurrence-step-flat', name: 'Imported STEP solids:1', definition: { kind: 'part', partId },
    baseTransform: assemblyIdentityMatrix(), fixed: true, suppressed: false, visible: true,
    extensions: { studioImportedStep: { flatFallback: true } },
  }];
  const assemblyId = 'assembly-step-root';
  return {
    schemaVersion: 5, projectId: 'project-step-' + crypto.randomUUID(),
    name: filename.replace(/\.(step|stp)$/i, '') || 'Imported STEP', units: 'mm',
    parameters: [], materials: [], partDefinitions: parts,
    assemblyDefinitions: [{
      id: assemblyId, name: 'Imported STEP solids', parameters: [], occurrences,
      mates: [], occurrencePatterns: [], explodedViews: [], sectionViews: [],
      metadata: { importedFromStep: true }, extensions: { studioImportedStep: { flatFallback: true } },
    }],
    rootDocument: { kind: 'assembly', assemblyId }, resources,
    metadata: {
      importedFromStep: true, importMode: 'flat-solid-fallback',
      importLimitations: ['external-product-hierarchy-unavailable', 'no-parametric-feature-history', 'no-mate-recovery'],
    },
  };
}

async function importV5Step(request) {
  await loadKernel();
  if (!(request.blob instanceof Blob)) throw new Error('STEP import requires a file');
  if (request.blob.size <= 0 || request.blob.size > STUDIO_V5_STEP_BYTES) throw new Error('STEP files must be between 1 byte and 50 MB');
  const filename = String(request.filename || 'import.step').slice(0, 200);
  if (!/\.(step|stp)$/i.test(filename)) throw new Error('Only .step and .stp files can be imported');
  const text = await request.blob.text();
  const manifest = stepManifestFromText(text);
  let stage = 'reading STEP geometry';
  let imported;
  try { imported = await rc.importSTEP(request.blob); }
  catch (error) { throw new Error(stage + ': ' + String(error?.message || error)); }
  const solids = [];
  try {
    stage = 'separating exact solids';
    for (const rawSolid of rc.iterTopo(imported.wrapped, 'solid')) {
      const solid = rc.cast(rawSolid);
      try { rawSolid.delete(); } catch {}
      solids.push(solid);
      if (solids.length > STUDIO_V5_PROJECT_LIMITS.generatedOccurrences) throw new Error('STEP import exceeds the 5,000 exact-solid separation limit');
    }
    if (!solids.length) throw new Error('STEP file contains no exact solid bodies');
    const solidGeometry = solids.map((solid) => ({ bounds: solid.boundingBox?.bounds ?? null, volume: shapeVolume(solid) }));
    stage = 'reconstructing the imported document';
    const project = prepareStudioV5Project(manifest
      ? createStructuredImportedProject(filename, manifest, solids, solidGeometry)
      : createFlatImportedProject(filename, solids));
    if (request.delayMs) await new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(0, request.delayMs))));
    self.postMessage({
      kind: 'import-result', requestId: request.requestId, projectId: request.projectId, revision: request.revision,
      project, manifest: {
        importMode: project.metadata.importMode,
        bodyCount: project.partDefinitions.reduce((total, part) => total + part.bodies.length, 0),
        partCount: project.partDefinitions.length,
        assemblyCount: project.assemblyDefinitions.length,
        exactGeometry: true,
        limitations: project.metadata.importLimitations,
      },
    });
  } catch (error) {
    throw new Error(stage + ': ' + String(error?.message || error));
  } finally {
    for (const solid of solids) safeDelete(solid);
    safeDelete(imported);
  }
}

function releaseShape(request) {
  safeDelete(currentShape);
  currentShape = null;
  for (const entry of currentBodyCache.values()) safeDelete(entry.shape);
  currentBodyCache = new Map();
  currentAssemblySolutions = new Map();
  currentRevision = request.revision;
  self.postMessage({
    kind: 'release-result',
    requestId: request.requestId,
    projectId: request.projectId,
    revision: request.revision,
  });
}

self.addEventListener('message', (event) => {
  const request = event.data;
  if (!request || typeof request !== 'object') return;
  const run = request.kind === 'rebuild'
    ? rebuild(request)
    : request.kind === 'validate-v5'
      ? validateV5(request)
    : request.kind === 'export-step' || request.kind === 'export-stl'
      ? exportDocument(request)
      : request.kind === 'import-step-v5'
        ? importV5Step(request)
      : request.kind === 'inspect-v5'
        ? inspectV5(request)
      : request.kind === 'release'
        ? Promise.resolve(releaseShape(request))
        : Promise.resolve();
  run.catch((error) => {
    self.postMessage({
      kind: 'kernel-error',
      requestId: request.requestId,
      projectId: request.projectId,
      revision: request.revision,
      message: String(error?.message || error),
    });
  });
});

// Start initialization as soon as the module worker is alive. Requests that
// arrive during the WASM load await the same promise.
loadKernel().catch(() => {});
