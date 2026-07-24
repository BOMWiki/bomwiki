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
  studioV5TransformVector,
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

const sameV4Point = (left, right) => Math.abs(left[0] - right[0]) <= 1e-9 && Math.abs(left[1] - right[1]) <= 1e-9;

function v4EntityEnds(entity) {
  if (entity.kind === 'line') return [entity.a, entity.b];
  if (entity.kind === 'arc') return [entity.start, entity.end];
  return null;
}

function traceV4EntityLoop(entities) {
  if (!entities.length) throw new Error('schema-4 profile loop is empty');
  const remaining = [...entities];
  const first = remaining.shift();
  const firstEnds = v4EntityEnds(first);
  if (!firstEnds) throw new Error('schema-4 profile contains a non-chain entity');
  const traced = [{ entity: first, reversed: false }];
  let current = firstEnds[1];
  while (remaining.length) {
    const index = remaining.findIndex((entity) => {
      const ends = v4EntityEnds(entity);
      return ends && (sameV4Point(ends[0], current) || sameV4Point(ends[1], current));
    });
    if (index < 0) throw new Error('schema-4 profile does not form one connected loop');
    const entity = remaining.splice(index, 1)[0];
    const ends = v4EntityEnds(entity);
    const reversed = sameV4Point(ends[1], current);
    traced.push({ entity, reversed });
    current = reversed ? ends[0] : ends[1];
  }
  if (!sameV4Point(current, firstEnds[0])) throw new Error('schema-4 profile loop is open');
  return traced;
}

function v4ArcPoints(entity, reversed, N, count = 48) {
  const start = reversed ? entity.end : entity.start;
  const end = reversed ? entity.start : entity.end;
  const clockwise = reversed ? entity.clockwise !== true : entity.clockwise === true;
  const center = entity.center.map(N);
  const evaluatedStart = start.map(N);
  const evaluatedEnd = end.map(N);
  const startAngle = Math.atan2(evaluatedStart[1] - center[1], evaluatedStart[0] - center[0]);
  const endAngle = Math.atan2(evaluatedEnd[1] - center[1], evaluatedEnd[0] - center[0]);
  let delta = endAngle - startAngle;
  if (clockwise) while (delta >= 0) delta -= Math.PI * 2;
  else while (delta <= 0) delta += Math.PI * 2;
  const radius = Math.hypot(evaluatedStart[0] - center[0], evaluatedStart[1] - center[1]);
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = startAngle + delta * index / count;
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
  });
}

function v4TracePolygon(traced, N) {
  const points = [];
  for (const { entity, reversed } of traced) {
    if (entity.kind === 'line') {
      const ends = v4EntityEnds(entity);
      const start = (reversed ? ends[1] : ends[0]).map(N);
      const end = (reversed ? ends[0] : ends[1]).map(N);
      if (!points.length) points.push(start);
      points.push(end);
    } else {
      const arc = v4ArcPoints(entity, reversed, N);
      if (!points.length) points.push(arc[0]);
      points.push(...arc.slice(1));
    }
  }
  if (points.length > 1 && sameV4Point(points[0], points.at(-1))) points.pop();
  return points;
}

function v4TraceDrawing(traced, N) {
  const first = traced[0];
  const firstEnds = v4EntityEnds(first.entity);
  const start = (first.reversed ? firstEnds[1] : firstEnds[0]).map(N);
  let pen = rc.draw(start);
  for (const { entity, reversed } of traced) {
    const ends = v4EntityEnds(entity);
    const end = (reversed ? ends[0] : ends[1]).map(N);
    if (entity.kind === 'line') pen = pen.lineTo(end);
    else pen = pen.threePointsArcTo(end, v4ArcPoints(entity, reversed, N, 2)[1]);
  }
  return pen.close();
}

function polygonCentroid(points) {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross;
    x += (current[0] + next[0]) * cross;
    y += (current[1] + next[1]) * cross;
  }
  if (Math.abs(twiceArea) <= 1e-12) {
    return points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
  }
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    if (((a[1] > point[1]) !== (b[1] > point[1])) &&
      point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function polygonInteriorProbe(polygon) {
  let signedArea = 0;
  let scale = 0;
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    signedArea += current[0] * next[1] - next[0] * current[1];
    scale = Math.max(scale, Math.abs(current[0]), Math.abs(current[1]));
  }
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const dx = next[0] - current[0];
    const dy = next[1] - current[1];
    const length = Math.hypot(dx, dy);
    if (length <= 1e-12) continue;
    const direction = signedArea >= 0 ? 1 : -1;
    const offset = Math.max(1, scale) * 1e-7;
    return [
      (current[0] + next[0]) / 2 - direction * dy / length * offset,
      (current[1] + next[1]) / 2 + direction * dx / length * offset,
    ];
  }
  return polygonCentroid(polygon);
}

function exactV4SketchDrawings(sketch, N) {
  const entities = sketch.entities.filter((entity) => entity.construction !== true);
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const used = new Set();
  const loops = [];
  for (const entity of entities) {
    if (entity.kind !== 'circle') continue;
    const center = entity.center.map(N);
    const radius = N(entity.radius);
    const polygon = Array.from({ length: 64 }, (_, index) => {
      const angle = Math.PI * 2 * index / 64;
      return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
    });
    loops.push({ drawing: rc.drawCircle(radius).translate(center), polygon });
    used.add(entity.id);
  }
  for (const group of sketch.groups || []) {
    const grouped = group.entityIds.map((id) => byId.get(id)).filter(Boolean);
    if (!grouped.length || grouped.some((entity) => entity.kind === 'circle')) continue;
    const traced = traceV4EntityLoop(grouped);
    loops.push({ drawing: v4TraceDrawing(traced, N), polygon: v4TracePolygon(traced, N) });
    grouped.forEach((entity) => used.add(entity.id));
  }
  const remaining = entities.filter((entity) => !used.has(entity.id));
  while (remaining.length) {
    const chain = [remaining.shift()];
    const firstEnds = v4EntityEnds(chain[0]);
    let current = firstEnds[1];
    while (!sameV4Point(current, firstEnds[0])) {
      const index = remaining.findIndex((entity) => {
        const ends = v4EntityEnds(entity);
        return ends && (sameV4Point(ends[0], current) || sameV4Point(ends[1], current));
      });
      if (index < 0) throw new Error('schema-4 profile contains an open loop');
      const entity = remaining.splice(index, 1)[0];
      const ends = v4EntityEnds(entity);
      current = sameV4Point(ends[0], current) ? ends[1] : ends[0];
      chain.push(entity);
    }
    const traced = traceV4EntityLoop(chain);
    loops.push({ drawing: v4TraceDrawing(traced, N), polygon: v4TracePolygon(traced, N) });
  }
  if (!loops.length) throw new Error('schema-4 sketch contains no closed non-construction profile');
  loops.forEach((loop) => {
    const point = polygonInteriorProbe(loop.polygon);
    loop.depth = loops.filter((candidate) => candidate !== loop && pointInPolygon(point, candidate.polygon)).length;
  });
  return loops.filter((loop) => loop.depth % 2 === 0).map((outer) => {
    let drawing = outer.drawing;
    for (const hole of loops.filter((loop) => loop.depth === outer.depth + 1 && pointInPolygon(polygonInteriorProbe(loop.polygon), outer.polygon))) {
      drawing = drawing.cut(hole.drawing);
    }
    return drawing;
  });
}

function featureProfileDrawings(feature, N, NS) {
  if (feature.extensions?.exactSketchEntities && Array.isArray(feature.sketch?.entities)) {
    return exactV4SketchDrawings(feature.sketch, N).map((drawing) => patternedDrawing(drawing, feature.pattern, N, NS));
  }
  return feature.sketch.shapes.map((shape) => patternedDrawing(shapeToDrawing(shape, N), feature.pattern, N, NS));
}

function basePlaneNormal(plane) {
  if (plane === 'YZ') return [1, 0, 0];
  if (plane === 'ZX') return [0, 1, 0];
  return [0, 0, 1];
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
  const signature = {
    p: [point.x ?? point[0], point.y ?? point[1], point.z ?? point[2]].map(quantize),
    l: quantize(edge.length),
    curveType: edge.geomType,
  };
  if (edge.geomType === 'CIRCLE') {
    let adaptor = null; let circle = null; let location = null;
    try {
      adaptor = edge._geomAdaptor();
      circle = adaptor.Circle();
      location = circle.Location();
      signature.r = quantize(circle.Radius());
      signature.c = [location.X(), location.Y(), location.Z()].map(quantize);
    } catch {}
    finally { safeDelete(location); safeDelete(circle); safeDelete(adaptor); }
  }
  return signature;
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
  for (const drawing of featureProfileDrawings(feature, N, NS)) {
    if (feature.type === 'revolve') {
      const plane = feature.plane?.kind === 'base' ? feature.plane.plane : 'XZ';
      const angle = Math.max(0.01, Math.min(360, Math.abs(N(feature.angle ?? feature.h ?? 360))));
      solids.push(drawing.sketchOnPlane(plane).revolve(undefined, { angle: feature.reversed ? -angle : angle }));
    } else if (feature.type === 'cut') {
      const depth = feature.through ? 0 : Math.max(0.1, N(feature.h));
      if (facePlane) {
        const distance = feature.through ? 10000 : depth;
        solids.push(drawing.sketchOnPlane(facePlane).extrude(feature.reversed ? distance : -distance));
      } else {
        const plane = feature.plane?.kind === 'base' ? feature.plane.plane : 'XY';
        if (feature.extensions?.exactSketchEntities) {
          const signedDepth = feature.reversed ? -depth : depth;
          const normal = basePlaneNormal(plane);
          const originDistance = feature.through ? -5000 : feature.symmetric ? -depth / 2 : 0;
          const origin = normal.map((value) => value * originDistance);
          solids.push(drawing.sketchOnPlane(plane, origin).extrude(feature.through ? 10000 : feature.symmetric ? depth : signedDepth));
        } else {
          const sketch = feature.through
            ? drawing.sketchOnPlane('XY', -5000)
            : drawing.sketchOnPlane('XY', (zTop ?? 0) - depth);
          solids.push(sketch.extrude(feature.through ? 10000 : depth + 1000));
        }
      }
    } else {
      const depth = Math.max(0.1, N(feature.h));
      if (facePlane) {
        solids.push(drawing.sketchOnPlane(facePlane).extrude(feature.reversed ? -depth : depth));
      } else if (feature.extensions?.exactSketchEntities) {
        const plane = feature.plane?.kind === 'base' ? feature.plane.plane : 'XY';
        const normal = basePlaneNormal(plane);
        const originDistance = feature.symmetric ? -depth / 2 : 0;
        const origin = normal.map((value) => value * originDistance);
        solids.push(drawing.sketchOnPlane(plane, origin).extrude(feature.symmetric ? depth : feature.reversed ? -depth : depth));
      } else {
        solids.push(drawing.sketchOnPlane('XY', feature.sketch.z || 0).extrude(depth));
      }
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

function orientedBounds(shape, matrix, tolerance = 1e-7) {
  const bounds = shape?.boundingBox?.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 2) return null;
  const center = [0, 1, 2].map((axis) => (bounds[0][axis] + bounds[1][axis]) / 2);
  const localExtents = [0, 1, 2].map((axis) => Math.max(0, (bounds[1][axis] - bounds[0][axis]) / 2));
  const columns = [[matrix[0], matrix[1], matrix[2]], [matrix[4], matrix[5], matrix[6]], [matrix[8], matrix[9], matrix[10]]];
  const axes = [];
  const extents = [];
  for (let index = 0; index < 3; index++) {
    const length = Math.hypot(...columns[index]);
    if (!(length > 1e-12)) return null;
    axes.push(columns[index].map((value) => value / length));
    extents.push(localExtents[index] * length + tolerance);
  }
  return { center: studioV5TransformPoint(matrix, center), axes, extents };
}

// Full 15-axis separating-axis test for two rigidly transformed local AABBs.
// These OBBs conservatively contain the exact B-reps, so a separating axis is
// a safe proof of non-interference before any expensive OCC extrema/Boolean.
function orientedBoundsOverlap(left, right) {
  if (!left || !right) return true;
  const R = Array.from({ length: 3 }, () => [0, 0, 0]);
  const absR = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    R[i][j] = left.axes[i][0] * right.axes[j][0] + left.axes[i][1] * right.axes[j][1] + left.axes[i][2] * right.axes[j][2];
    absR[i][j] = Math.abs(R[i][j]) + 1e-10;
  }
  const delta = right.center.map((value, axis) => value - left.center[axis]);
  const t = left.axes.map((axis) => delta[0] * axis[0] + delta[1] * axis[1] + delta[2] * axis[2]);
  for (let i = 0; i < 3; i++) {
    const rb = right.extents[0] * absR[i][0] + right.extents[1] * absR[i][1] + right.extents[2] * absR[i][2];
    if (Math.abs(t[i]) > left.extents[i] + rb) return false;
  }
  for (let j = 0; j < 3; j++) {
    const projected = Math.abs(t[0] * R[0][j] + t[1] * R[1][j] + t[2] * R[2][j]);
    const ra = left.extents[0] * absR[0][j] + left.extents[1] * absR[1][j] + left.extents[2] * absR[2][j];
    if (projected > ra + right.extents[j]) return false;
  }
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const i1 = (i + 1) % 3; const i2 = (i + 2) % 3;
    const j1 = (j + 1) % 3; const j2 = (j + 2) % 3;
    const projected = Math.abs(t[i2] * R[i1][j] - t[i1] * R[i2][j]);
    const ra = left.extents[i1] * absR[i2][j] + left.extents[i2] * absR[i1][j];
    const rb = right.extents[j1] * absR[i][j2] + right.extents[j2] * absR[i][j1];
    if (projected > ra + rb) return false;
  }
  return true;
}

const INTERFERENCE_MESH_TOLERANCE_MM = 0.5;
const INTERFERENCE_CELL_MM = 2;

function collisionMesh(shape) {
  return shape.mesh({ tolerance: INTERFERENCE_MESH_TOLERANCE_MM, angularTolerance: 0.3 });
}

function collisionEnvelope(mesh, transform = assemblyIdentityMatrix()) {
  const cells = new Set();
  const padding = INTERFERENCE_MESH_TOLERANCE_MM * 2;
  const vertices = [];
  const lower = [Infinity, Infinity, Infinity];
  const upper = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < mesh.vertices.length; index += 3) {
    const point = studioV5TransformPoint(transform, [mesh.vertices[index], mesh.vertices[index + 1], mesh.vertices[index + 2]]);
    vertices.push(...point);
    for (let axis = 0; axis < 3; axis++) {
      lower[axis] = Math.min(lower[axis], point[axis]);
      upper[axis] = Math.max(upper[axis], point[axis]);
    }
  }
  const triangles = mesh.triangles;
  const triangleBounds = [];
  for (let index = 0; index < triangles.length; index += 3) {
    const points = [triangles[index], triangles[index + 1], triangles[index + 2]].map((vertexIndex) => [
      vertices[vertexIndex * 3], vertices[vertexIndex * 3 + 1], vertices[vertexIndex * 3 + 2],
    ]);
    const triangleLow = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])));
    const triangleHigh = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])));
    triangleBounds.push([triangleLow, triangleHigh]);
    const low = triangleLow.map((value) => Math.floor((value - padding) / INTERFERENCE_CELL_MM));
    const high = triangleHigh.map((value) => Math.floor((value + padding) / INTERFERENCE_CELL_MM));
    for (let x = low[0]; x <= high[0]; x++) for (let y = low[1]; y <= high[1]; y++) for (let z = low[2]; z <= high[2]; z++) {
      cells.add(x + ',' + y + ',' + z);
    }
  }
  const bounds = [
    lower.map((value) => value - padding),
    upper.map((value) => value + padding),
  ];
  return { cells, vertices, triangles, triangleBounds, triangleCells: null, point: vertices.slice(0, 3), bounds };
}

function boundsContain(outer, inner, tolerance = 1e-7) {
  if (!Array.isArray(outer) || !Array.isArray(inner)) return false;
  return [0, 1, 2].every((axis) => outer[0][axis] <= inner[0][axis] + tolerance && outer[1][axis] >= inner[1][axis] - tolerance);
}

function rayTriangleHit(origin, direction, a, b, c) {
  const edge1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const edge2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = [
    direction[1] * edge2[2] - direction[2] * edge2[1],
    direction[2] * edge2[0] - direction[0] * edge2[2],
    direction[0] * edge2[1] - direction[1] * edge2[0],
  ];
  const determinant = edge1[0] * p[0] + edge1[1] * p[1] + edge1[2] * p[2];
  if (Math.abs(determinant) < 1e-10) return false;
  const inverse = 1 / determinant;
  const t = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) * inverse;
  if (!(u > 1e-8 && u < 1 - 1e-8)) return false;
  const q = [
    t[1] * edge1[2] - t[2] * edge1[1],
    t[2] * edge1[0] - t[0] * edge1[2],
    t[0] * edge1[1] - t[1] * edge1[0],
  ];
  const v = (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]) * inverse;
  if (!(v > 1e-8 && u + v < 1 - 1e-8)) return false;
  const distance = (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]) * inverse;
  return distance > 1e-7;
}

function meshContainsPoint(envelope, point) {
  if (!point?.length) return true;
  const directions = [[1, 0.371, 0.127], [0.217, 1, 0.433], [0.319, 0.173, 1]];
  let insideVotes = 0;
  for (const direction of directions) {
    let hits = 0;
    for (let index = 0; index < envelope.triangles.length; index += 3) {
      const points = [envelope.triangles[index], envelope.triangles[index + 1], envelope.triangles[index + 2]].map((vertexIndex) => [
        envelope.vertices[vertexIndex * 3], envelope.vertices[vertexIndex * 3 + 1], envelope.vertices[vertexIndex * 3 + 2],
      ]);
      if (rayTriangleHit(point, direction, points[0], points[1], points[2])) hits++;
    }
    if (hits % 2 === 1) insideVotes++;
  }
  return insideVotes >= 2;
}

// Tessellation deflection bounds the exact surface to 0.5 mm on each body.
// If no transformed triangle AABBs approach within the combined 1 mm
// envelope, the exact B-rep surfaces cannot cross and no OCC distance query
// or Boolean is needed. Containment remains a separate check below.
function ensureTriangleCells(envelope) {
  if (envelope.triangleCells) return envelope.triangleCells;
  const cells = new Map();
  for (let triangleIndex = 0; triangleIndex < envelope.triangleBounds.length; triangleIndex++) {
    const bounds = envelope.triangleBounds[triangleIndex];
    const low = bounds[0].map((value) => Math.floor(value / INTERFERENCE_CELL_MM));
    const high = bounds[1].map((value) => Math.floor(value / INTERFERENCE_CELL_MM));
    for (let x = low[0]; x <= high[0]; x++) for (let y = low[1]; y <= high[1]; y++) for (let z = low[2]; z <= high[2]; z++) {
      const key = x + ',' + y + ',' + z;
      const entries = cells.get(key) || [];
      entries.push(triangleIndex); cells.set(key, entries);
    }
  }
  envelope.triangleCells = cells;
  return cells;
}

function vectorSubtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vectorDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vectorCross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function pointTriangleDistanceSquared(point, a, b, c) {
  const ab = vectorSubtract(b, a); const ac = vectorSubtract(c, a); const ap = vectorSubtract(point, a);
  const d1 = vectorDot(ab, ap); const d2 = vectorDot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return vectorDot(ap, ap);
  const bp = vectorSubtract(point, b); const d3 = vectorDot(ab, bp); const d4 = vectorDot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return vectorDot(bp, bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3); const projected = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]];
    const delta = vectorSubtract(point, projected); return vectorDot(delta, delta);
  }
  const cp = vectorSubtract(point, c); const d5 = vectorDot(ab, cp); const d6 = vectorDot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return vectorDot(cp, cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6); const projected = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]];
    const delta = vectorSubtract(point, projected); return vectorDot(delta, delta);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const edge = vectorSubtract(c, b); const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const projected = [b[0] + w * edge[0], b[1] + w * edge[1], b[2] + w * edge[2]];
    const delta = vectorSubtract(point, projected); return vectorDot(delta, delta);
  }
  const denominator = 1 / (va + vb + vc); const v = vb * denominator; const w = vc * denominator;
  const projected = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
  const delta = vectorSubtract(point, projected); return vectorDot(delta, delta);
}

function segmentSegmentDistanceSquared(p1, q1, p2, q2) {
  const d1 = vectorSubtract(q1, p1); const d2 = vectorSubtract(q2, p2); const r = vectorSubtract(p1, p2);
  const a = vectorDot(d1, d1); const e = vectorDot(d2, d2); const f = vectorDot(d2, r);
  let s = 0; let t = 0;
  if (a <= 1e-18 && e <= 1e-18) return vectorDot(r, r);
  if (a <= 1e-18) t = Math.max(0, Math.min(1, f / e));
  else {
    const c = vectorDot(d1, r);
    if (e <= 1e-18) s = Math.max(0, Math.min(1, -c / a));
    else {
      const b = vectorDot(d1, d2); const denominator = a * e - b * b;
      if (denominator !== 0) s = Math.max(0, Math.min(1, (b * f - c * e) / denominator));
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  const closest1 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const closest2 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  const delta = vectorSubtract(closest1, closest2); return vectorDot(delta, delta);
}

function segmentIntersectsTriangle(start, end, a, b, c) {
  const direction = vectorSubtract(end, start); const edge1 = vectorSubtract(b, a); const edge2 = vectorSubtract(c, a);
  const h = vectorCross(direction, edge2); const determinant = vectorDot(edge1, h);
  if (Math.abs(determinant) < 1e-12) return false;
  const inverse = 1 / determinant; const s = vectorSubtract(start, a); const u = inverse * vectorDot(s, h);
  if (u < 0 || u > 1) return false;
  const q = vectorCross(s, edge1); const v = inverse * vectorDot(direction, q);
  if (v < 0 || u + v > 1) return false;
  const along = inverse * vectorDot(edge2, q);
  return along >= 0 && along <= 1;
}

function triangleDistanceSquared(left, right) {
  const leftEdges = [[left[0], left[1]], [left[1], left[2]], [left[2], left[0]]];
  const rightEdges = [[right[0], right[1]], [right[1], right[2]], [right[2], right[0]]];
  let minimum = Infinity;
  for (const [start, end] of leftEdges) {
    if (segmentIntersectsTriangle(start, end, right[0], right[1], right[2])) return 0;
    minimum = Math.min(minimum, pointTriangleDistanceSquared(start, right[0], right[1], right[2]));
  }
  for (const [start, end] of rightEdges) {
    if (segmentIntersectsTriangle(start, end, left[0], left[1], left[2])) return 0;
    minimum = Math.min(minimum, pointTriangleDistanceSquared(start, left[0], left[1], left[2]));
  }
  for (const leftEdge of leftEdges) for (const rightEdge of rightEdges) {
    minimum = Math.min(minimum, segmentSegmentDistanceSquared(leftEdge[0], leftEdge[1], rightEdge[0], rightEdge[1]));
  }
  return minimum;
}

function envelopeTriangle(envelope, triangleIndex) {
  return [0, 1, 2].map((offset) => {
    const vertexIndex = envelope.triangles[triangleIndex * 3 + offset] * 3;
    return envelope.vertices.slice(vertexIndex, vertexIndex + 3);
  });
}

function meshSurfacesMayMeet(left, right) {
  if (!left?.triangleBounds || !right?.triangleBounds) return true;
  const tolerance = INTERFERENCE_MESH_TOLERANCE_MM * 2;
  const toleranceSquared = tolerance * tolerance;
  const [probe, indexed] = left.triangleBounds.length <= right.triangleBounds.length ? [left, right] : [right, left];
  const indexedCells = ensureTriangleCells(indexed);
  for (let probeIndex = 0; probeIndex < probe.triangleBounds.length; probeIndex++) {
    const bounds = probe.triangleBounds[probeIndex];
    const low = bounds[0].map((value) => Math.floor((value - tolerance) / INTERFERENCE_CELL_MM));
    const high = bounds[1].map((value) => Math.floor((value + tolerance) / INTERFERENCE_CELL_MM));
    const tested = new Set();
    for (let x = low[0]; x <= high[0]; x++) for (let y = low[1]; y <= high[1]; y++) for (let z = low[2]; z <= high[2]; z++) {
      for (const triangleIndex of indexedCells.get(x + ',' + y + ',' + z) || []) {
        if (tested.has(triangleIndex)) continue;
        tested.add(triangleIndex);
        const candidate = indexed.triangleBounds[triangleIndex];
        if ([0, 1, 2].every((axis) => bounds[0][axis] <= candidate[1][axis] + tolerance && candidate[0][axis] <= bounds[1][axis] + tolerance)
          && triangleDistanceSquared(envelopeTriangle(probe, probeIndex), envelopeTriangle(indexed, triangleIndex)) <= toleranceSquared) return true;
      }
    }
  }
  return false;
}

// Conservative surface-cell broad phase. Exact B-rep Booleans still produce
// every reported volume; tessellation only proves obviously separated
// surfaces. The expanded cells cover mesh deflection, while a containment
// vote retains swallowed-solid cases whose boundaries do not cross.
function collisionEnvelopesOverlap(left, right) {
  if (!left || !right) return true;
  const smaller = left.cells.size <= right.cells.size ? left.cells : right.cells;
  const larger = smaller === left.cells ? right.cells : left.cells;
  let sharedSurfaceCell = false;
  for (const key of smaller) if (larger.has(key)) { sharedSurfaceCell = true; break; }
  if (sharedSurfaceCell && meshSurfacesMayMeet(left, right)) return true;
  if (boundsContain(left.bounds, right.bounds) && meshContainsPoint(left, right.point)) return true;
  if (boundsContain(right.bounds, left.bounds) && meshContainsPoint(right, left.point)) return true;
  return false;
}

function roundedRigidMatrix(matrix) {
  return matrix.map((value) => Math.abs(value) < 1e-10 ? 0 : Math.round(value * 1e8) / 1e8);
}

function interferenceEquivalenceKey(left, right) {
  const leftKey = left.runtime.sourceKey;
  const rightKey = right.runtime.sourceKey;
  const leftMatrix = left.runtime.renderTransform || left.runtime.exactPlacement;
  const rightMatrix = right.runtime.renderTransform || right.runtime.exactPlacement;
  if (!leftKey || !rightKey || !leftMatrix || !rightMatrix) return null;
  if (leftKey < rightKey) {
    return leftKey + '|' + rightKey + '|' + stableHash(roundedRigidMatrix(studioV5MultiplyMatrices(studioV5RigidInverse(leftMatrix), rightMatrix)));
  }
  if (rightKey < leftKey) {
    return rightKey + '|' + leftKey + '|' + stableHash(roundedRigidMatrix(studioV5MultiplyMatrices(studioV5RigidInverse(rightMatrix), leftMatrix)));
  }
  const relative = roundedRigidMatrix(studioV5MultiplyMatrices(studioV5RigidInverse(leftMatrix), rightMatrix));
  const inverse = roundedRigidMatrix(studioV5RigidInverse(relative));
  const forwardHash = stableHash(relative); const inverseHash = stableHash(inverse);
  return leftKey + '|' + rightKey + '|' + (forwardHash < inverseHash ? forwardHash : inverseHash);
}

// Inspection only needs the exact common volume, not a simplified result B-rep.
// Running OCC's common builder directly avoids the expensive post-Boolean
// topology simplification performed by Shape.intersect on complex lofts.
function exactIntersectionVolume(left, right) {
  let intersection = null;
  let intersector = null;
  let progress = null;
  try {
    const oc = rc.getOC();
    progress = new oc.Message_ProgressRange_1();
    intersector = new oc.BRepAlgoAPI_Common_3(left.shape.wrapped, right.shape.wrapped, progress);
    intersector.SetUseOBB?.(true);
    intersector.SetFuzzyValue?.(1e-4);
    intersector.Build(progress);
    intersection = rc.cast(intersector.Shape());
    return shapeVolume(intersection);
  } catch {
    return 0;
  } finally {
    safeDelete(intersection);
    try { intersector?.delete(); } catch {}
    try { progress?.delete(); } catch {}
  }
}

function batchInterferenceVolumes(left, candidates, tolerance = 0) {
  const volumes = new Map(candidates.map((entry) => [entry.index, 0]));
  if (!candidates.length) return volumes;
  // A positive exact shape distance proves that two solids cannot have a
  // volumetric intersection. Use that exact predicate after the conservative
  // mesh/cell broad phase so nearby surfaces do not force a Boolean Common.
  let exactCandidates = candidates;
  let distanceQuery = null;
  try {
    distanceQuery = new rc.DistanceQuery(left.shape);
    const contactTolerance = Math.max(1e-7, Number(tolerance) || 0);
    exactCandidates = candidates.filter(({ entry }) => {
      const leftEnvelope = left.collisionEnvelope;
      const rightEnvelope = entry.collisionEnvelope;
      const containmentPossible = leftEnvelope && rightEnvelope && (
        (boundsContain(leftEnvelope.bounds, rightEnvelope.bounds) && meshContainsPoint(leftEnvelope, rightEnvelope.point))
        || (boundsContain(rightEnvelope.bounds, leftEnvelope.bounds) && meshContainsPoint(rightEnvelope, leftEnvelope.point))
      );
      // Boundary distance remains positive when one solid is wholly inside
      // another, so contained candidates must still reach Boolean Common.
      if (containmentPossible) return true;
      try { return distanceQuery.distanceTo(entry.shape) <= contactTolerance; }
      catch { return true; }
    });
  } catch {
    exactCandidates = candidates;
  } finally {
    distanceQuery?.delete();
  }
  if (!exactCandidates.length) return volumes;
  for (const candidate of exactCandidates) {
    // Keep attribution exact per pair. A compound common is slower for complex
    // lofts and can assign a valid solid to the wrong overlapping bounds.
    volumes.set(candidate.index, exactIntersectionVolume(left, candidate.entry));
  }
  return volumes;
}

function safeDelete(shape) {
  try { shape?.delete(); } catch {}
}

function datumPlaneForFeature(document, part, datumId) {
  const frame = resolveStudioV5Datums(document, part.id).resolve(datumId);
  if (frame.kind !== 'plane') throw new Error('the selected neutral reference is not a plane');
  return new rc.Plane(frame.origin, frame.xDirection, frame.normal);
}

function applyBodyModifier(document, part, feature, shape, N) {
  if (feature.type === 'fillet' || feature.type === 'chamfer') {
    let hits = 0;
    const radius = Math.max(0.1, N(feature.r));
    const next = shape[feature.type]((edge) => {
      const selected = feature.edges.find((signature) => edgeMatches(signature, edge));
      if (!selected) return 0;
      hits++;
      if (feature.type === 'fillet') {
        const variable = feature.variableRadii?.find((entry) => edgeMatches(entry.edge, edge));
        if (variable) {
          const start = N(variable.startRadius);
          const end = N(variable.endRadius);
          if (!(start > 0 && end > 0)) throw new Error('variable fillet radii must stay above zero');
          return [start, end];
        }
      }
      return radius;
    });
    if (!hits) {
      safeDelete(next);
      throw new Error('the picked edges no longer exist — edit or delete this feature');
    }
    return next;
  }
  if (feature.type === 'draft') {
    const matchingFaces = shape.faces.filter((face) => feature.faces.some((signature) => faceMatches(signature, face)));
    if (!matchingFaces.length) throw new Error('the picked draft faces no longer exist — repair this feature');
    const angle = N(feature.angle) * (feature.flip ? -1 : 1);
    if (!(Math.abs(angle) > 1e-6 && Math.abs(angle) < 89)) throw new Error('draft angle must stay between -89 and 89 degrees and not be zero');
    const neutralPlane = datumPlaneForFeature(document, part, feature.neutralPlaneDatumId);
    try {
      return shape.draft(angle, (finder) => finder.when(({ element }) => feature.faces.some((signature) => faceMatches(signature, element))), neutralPlane);
    } finally {
      neutralPlane.delete();
    }
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

function thickenStudioV5Face(feature, sourceShape, N) {
  const face = sourceShape.faces.find((candidate) => feature.faces.some((signature) => faceMatches(signature, candidate)));
  if (!face) throw new Error('the selected Thicken face no longer exists — repair this feature');
  if (face.geomType !== 'PLANE') throw new Error('this Thicken increment requires a planar source face');
  const thickness = N(feature.thickness);
  if (!(thickness > 0)) throw new Error('Thicken distance must stay above zero');
  const normalValue = face.normalAt();
  const direction = [normalValue.x, normalValue.y, normalValue.z].map((value) => value * (feature.flip ? -1 : 1));
  normalValue.delete?.();
  const startFace = feature.symmetric
    ? face.translate(direction.map((value) => -value * thickness / 2))
    : face.clone();
  const vector = new rc.Vector(direction.map((value) => value * thickness));
  try {
    return rc.basicFaceExtrusion(startFace, vector);
  } finally {
    startFace.delete();
    vector.delete();
  }
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
      // Schema-5 dimensions are stored in millimetres; a 1e-4 mm Loft
      // approximation is already well below display, export, and inspection
      // tolerances. The previous 1e-6 mm solver target made every ordinary
      // three-section blade rebuild pay for nanometre-scale fitting.
      const builder = new oc.BRepOffsetAPI_ThruSections(true, feature.ruled === true, 1e-4);
      const progress = new oc.Message_ProgressRange_1();
      try {
        const continuity = loftContinuity(oc, feature);
        builder.CheckCompatibility(false);
        // C0 multi-section geometry does not request tangent/curvature
        // smoothing. Asking OCC to run its smoothing optimizer anyway added
        // substantial rebuild time to ordinary editable blade Lofts without
        // strengthening the feature's declared continuity contract.
        builder.SetSmoothing(feature.ruled !== true && continuity !== oc.GeomAbs_Shape.GeomAbs_C0);
        builder.SetMaxDegree(4);
        builder.SetContinuity(continuity);
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

function buildStudioV5Revolve(document, part, feature, N) {
  const sketch = part.sketches.find((entry) => entry.id === feature.profileSketchId);
  if (!sketch) throw new Error('Revolve profile sketch is missing');
  const frame = resolveStudioV5Datums(document, part.id).resolve(feature.axisDatumId);
  if (frame.kind !== 'axis') throw new Error('Revolve requires an axis datum');
  const angle = N(feature.angle);
  const startAngle = N(feature.startAngle ?? (feature.symmetric ? -angle / 2 : 0));
  if (!(angle > 0 && angle <= 360)) throw new Error('Revolve angle must stay above zero and at most 360 degrees');
  const profile = profileSketch3d(document, part, sketch, {}, N);
  let shape = profile.revolve(frame.direction, { origin: frame.origin, angle });
  if (Math.abs(startAngle) > 1e-9) {
    const rotated = shape.rotate(startAngle, frame.origin, frame.direction);
    safeDelete(shape);
    shape = rotated;
  }
  return shape;
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
  if (feature.type === 'revolve' && feature.profileSketchId) return buildStudioV5Revolve(document, part, feature, N);
  if (feature.extensions?.exactSketchEntities && feature.sketchId) {
    const sketch = part.sketches.find((entry) => entry.id === feature.sketchId);
    if (!sketch) throw new Error('migrated schema-4 feature sketch is missing');
    return featureSolid({ ...feature, sketch: { ...feature.sketch, ...sketch } }, zTop, accumulated, N, NS);
  }
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
  // A project-scoped parameter invalidates only parts whose editable records
  // actually reference it. Hashing the complete project parameter table into
  // every body made one fan-blade twist rebuild all unrelated engine parts.
  const referencedParameterNames = new Set();
  const collectIdentifiers = (value) => {
    if (typeof value === 'string') for (const match of value.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) referencedParameterNames.add(match[0]);
    else if (Array.isArray(value)) for (const entry of value) collectIdentifiers(entry);
    else if (value && typeof value === 'object') for (const entry of Object.values(value)) collectIdentifiers(entry);
  };
  collectIdentifiers(part);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const parameter of document.parameters || []) if (referencedParameterNames.has(parameter.name)) {
      const before = referencedParameterNames.size;
      collectIdentifiers(parameter.value);
      if (referencedParameterNames.size !== before) expanded = true;
    }
  }
  const parameterState = [
    (document.parameters || []).filter((parameter) => referencedParameterNames.has(parameter.name)),
    part.parameters || [],
  ];
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
            : feature.type === 'thicken'
              ? (() => {
                  const source = evaluateBody(feature.sourceBodyId);
                  if (!source.shape || source.error) throw new Error('source body "' + feature.sourceBodyId + '" has no valid face to thicken');
                  return thickenStudioV5Face(feature, source.shape, N);
                })()
            : feature.type === 'boolean-split-side'
              ? (() => {
                  const source = evaluateBody(feature.sourceBodyId);
                  const toolBodyId = (feature.toolBodyIds || []).find((bodyId) => bodyId !== feature.sourceBodyId);
                  const tool = evaluateBody(toolBodyId);
                  if (!source.shape || source.error || !tool?.shape || tool.error) throw new Error('Boolean Split source or tool has no valid exact solid');
                  if (!boundsOverlap(source.shape, tool.shape)) throw new Error('the splitting tool does not intersect the target body');
                  // A split evaluates two sibling results from the same source
                  // and tool. Cached Replicad wrappers must stay immutable:
                  // OCC Boolean builders may attach mutable operation state to
                  // their operands even though they return a new shape. Give
                  // each side private inputs so evaluating Outside can never
                  // poison the subsequent Inside result or the body cache.
                  // Shape.clone() is a TopoDS partner, not a deep B-rep copy.
                  // Round-trip the bounded exact operands so OCC cannot share
                  // mutable topology between the two sibling Boolean builders.
                  const sourceInput = rc.deserializeShape(source.shape.serialize());
                  const toolInput = rc.deserializeShape(tool.shape.serialize());
                  try { return feature.side === 'inside' ? sourceInput.intersect(toolInput) : sourceInput.cut(toolInput); }
                  finally { safeDelete(sourceInput); safeDelete(toolInput); }
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
          const modified = applyBodyModifier(document, part, feature, shape, N);
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
  // Boolean tool bodies remain addressable dependencies so suppression,
  // repair, and undo can recover them, but `keepTools: false` must not leave
  // the consumed solid rendered or exported as an independent body.
  const consumedBodyIds = new Map();
  for (const feature of part.features || []) {
    if (feature.suppressed || !enabledFeatureIds.has(feature.id) || feature.type !== 'boolean' || feature.resultPolicy?.keepTools !== false) continue;
    for (const toolBodyId of feature.toolBodyIds || []) consumedBodyIds.set(toolBodyId, feature.id);
  }
  for (const [bodyId, featureId] of consumedBodyIds) {
    const result = results.get(bodyId);
    if (result) result.body = { ...result.body, visible: false, extensions: { ...(result.body.extensions || {}), consumedByFeatureId: featureId } };
  }
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
    if (pattern.outputMode === 'union') {
      const generated = [...patternResults.values()].filter((entry) => entry.body.patternInstance?.patternId === pattern.id && !entry.error && entry.shape);
      // Keep the retained source/occurrence cache immutable. A TopoDS clone
      // is only a shared partner, so Boolean builders can otherwise leak
      // operation state into the linked bodies that must remain editable.
      let fused = rc.deserializeShape(source.shape.serialize());
      try {
        for (const entry of generated) {
          const operand = rc.deserializeShape(entry.shape.serialize());
          try {
            const next = fused.fuse(operand);
            safeDelete(fused);
            fused = next;
          } finally {
            safeDelete(operand);
          }
        }
        const geometry = bodyGeometry(fused);
        if (!geometry.valid || geometry.solidCount !== 1) throw new Error('pattern fusion must produce exactly one connected valid solid');
        for (const entry of generated) entry.body.visible = false;
        const bodyId = pattern.id + '-fused';
        const body = {
          id: bodyId, name: pattern.name + ' fused result', kind: source.body.kind,
          visible: pattern.visible !== false && source.body.visible !== false, suppressed: false,
          patternInstance: { patternId: pattern.id, index: 0, sourceBodyId: pattern.sourceBodyId, fused: true },
        };
        patternResults.set(bodyId, {
          signature: stableHash({ pattern, source: source.signature, fused: true }), shape: fused, geometry, body,
          renderTransform: identityMatrix(), sharesSourceGeometry: false, error: null, reused: false, lastValid: false,
        });
        fused = null;
        evaluatedPatternInstanceIds.push(bodyId);
      } catch (error) {
        const failure = { bodyId: pattern.id + '-fused', featureId: pattern.id, featureType: 'pattern', message: String(error?.message || error) };
        errors.push(failure);
      } finally {
        safeDelete(fused);
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

function setOcLabelColor(oc, colorTool, label, color) {
  const source = String(color || '#a7b8c9').replace(/^#/, '');
  const hex = source.length === 3 ? source.replace(/(.)/g, '$1$1') : source.padEnd(6, '0').slice(0, 6);
  const rgba = new oc.Quantity_ColorRGBA_5(
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
    1,
  );
  colorTool.SetColor_3(label, rgba, oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf);
  rgba.delete();
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
  // AP214 preserves names, colors, and hierarchy while remaining stable in
  // the browser STEPControl reader across repeated import/re-export cycles.
  oc.Interface_Static.SetIVal('write.step.schema', 4);
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
  const colorToolHandle = oc.XCAFDoc_DocumentTool.ColorTool(mainLabel);
  const colorTool = colorToolHandle.get();
  const selectedKeys = new Set(selected.map((runtime) => runtime.sourceKey));
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
    for (const [variantKey, partBuild] of built.partBuilds) {
      const part = partBuild.part;
      const localResults = [
        ...part.bodies.map((body) => ({ body, result: partBuild.results.get(body.id) })),
        ...[...partBuild.patternResults.values()].map((result) => ({ body: result.body, result })),
      ].filter(({ body, result }) => selectedKeys.has(variantKey + ':' + body.id) && result?.shape && result.geometry?.valid);
      if (!localResults.length) continue;
      const partLabel = shapeTool.NewShape();
      setOcLabelName(oc, partLabel, part.name);
      partLabels.set(variantKey, partLabel);
      const manifestBodies = [];
      for (const { body, result } of localResults) {
        const definitionLabel = shapeTool.AddShape(result.shape.wrapped, false, false);
        setOcLabelName(oc, definitionLabel, body.name);
        const material = body.materialId ? document.materials?.find((entry) => entry.id === body.materialId) : null;
        const appearance = document.materials?.find((entry) => entry.appearanceId === (body.appearanceId || material?.appearanceId))?.extensions?.studioAppearance;
        setOcLabelColor(oc, colorTool, definitionLabel, appearance?.baseColor || '#a7b8c9');
        bodyLabels.set(variantKey + ':' + body.id, definitionLabel);
        const location = ocLocationFromMatrix(oc, assemblyIdentityMatrix());
        const componentLabel = shapeTool.AddComponent_1(partLabel, definitionLabel, location);
        setOcLabelName(oc, componentLabel, body.name);
        location.delete();
        manifestBodies.push({ id: body.id, name: body.name, kind: body.kind, visible: body.visible !== false, materialId: body.materialId || null, appearanceId: body.appearanceId || null });
      }
      if (manifestBodies.length) manifestParts.push({
        id: variantKey,
        definitionPartId: partBuild.sourcePartId,
        name: part.name,
        parameterOverrides: partBuild.parameterOverrides,
        bodies: manifestBodies,
      });
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
          ? partLabels.get(occurrence.definition.partId + ':variant:' + stableHash(occurrence.parameterOverrides || {}))
          : assemblyLabels.get(occurrence.definition.assemblyId);
        if (!definitionLabel) continue;
        const transform = solution.transforms.get(occurrence.id);
        const location = ocLocationFromMatrix(oc, transform);
        const componentLabel = shapeTool.AddComponent_1(parentLabel, definitionLabel, location);
        setOcLabelName(oc, componentLabel, occurrence.name);
        location.delete();
        occurrences.push({
          id: occurrence.id, name: occurrence.name,
          definition: occurrence.definition.kind === 'part'
            ? { kind: 'part', partId: occurrence.definition.partId + ':variant:' + stableHash(occurrence.parameterOverrides || {}) }
            : occurrence.definition,
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
          ? partLabels.get(source.definition.partId + ':variant:' + stableHash(source.parameterOverrides || {}))
          : assemblyLabels.get(source?.definition.assemblyId);
        if (!source || !definitionLabel) continue;
        const transform = source.definition.kind === 'part' ? leaf.transform : sourcePatternOccurrenceTransform(solution, leaf);
        const name = leaf.name.split(' / ')[0];
        const location = ocLocationFromMatrix(oc, transform);
        const componentLabel = shapeTool.AddComponent_1(parentLabel, definitionLabel, location);
        setOcLabelName(oc, componentLabel, name);
        location.delete();
        occurrences.push({
          id: topId, name,
          definition: source.definition.kind === 'part'
            ? { kind: 'part', partId: source.definition.partId + ':variant:' + stableHash(source.parameterOverrides || {}) }
            : source.definition,
          transform,
          visible: source.visible !== false, extensions: { importedFromStep: true, sourcePatternId: leaf.patternInstance.patternId },
        });
      }
      manifestAssemblies.push({ id: assembly.id, name: assembly.name, occurrences });
    }
    shapeTool.UpdateAssemblies();
    const blob = writeXcafStep(oc, xcafDocument);
    const bodyInstances = selected.map((runtime) => ({
      bodyId: runtime.bodyId,
      partId: runtime.occurrenceInstance.variantKey,
      definitionPartId: runtime.occurrenceInstance.definition.partId,
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
        format: 'bomwiki-v5-step-assembly-1', schemaVersion: 5, units: 'mm', sourceUnits: document.units,
        projectName: document.name, rootAssemblyId: built.solution.assembly.id,
        parts: manifestParts, assemblies: manifestAssemblies, bodyInstances, materials: structuredClone(document.materials || []),
        limitations: ['exact-brep-and-solved-hierarchy-only', 'no-parametric-feature-history', 'no-mate-recovery'],
      },
    };
  } finally {
    safeDelete(colorToolHandle);
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
  const variantKeyFor = (occurrence) => occurrence.definition.partId + ':variant:' + stableHash(occurrence.parameterOverrides || {});
  const cacheView = (cache, variantKey) => {
    const view = new Map();
    const prefix = variantKey + ':';
    for (const [key, value] of cache || []) if (String(key).startsWith(prefix)) view.set(String(key).slice(prefix.length), value);
    return view;
  };
  for (const occurrence of solution.leafOccurrences) {
    const partId = occurrence.definition.partId;
    const variantKey = variantKeyFor(occurrence);
    occurrence.variantKey = variantKey;
    if (partBuilds.has(variantKey)) continue;
    const parameterOverrides = occurrence.parameterOverrides || {};
    // The canonical assembly has many reusable definitions but only a small
    // number of actual parameter variants. Cloning the complete project once
    // per ordinary (non-overridden) definition added avoidable latency to
    // every edit. Exact document evaluation is read-only, so share the
    // canonical document unless this variant genuinely needs an isolated
    // parameter patch.
    const variantDocument = Object.keys(parameterOverrides).length ? structuredClone(document) : document;
    if (variantDocument !== document) {
      const variantPart = variantDocument.partDefinitions.find((entry) => entry.id === partId);
      for (const [name, value] of Object.entries(parameterOverrides)) {
        const parameter = variantPart?.parameters?.find((entry) => entry.name === name);
        if (!parameter) throw new Error('Component variant parameter "' + name + '" no longer exists in part "' + partId + '".');
        parameter.value = value;
      }
    }
    const built = await buildV5Document(variantDocument, {
      ...options,
      partId,
      cache: cacheView(options.cache, variantKey),
      previousCache: cacheView(options.previousCache, variantKey),
    });
    built.variantKey = variantKey;
    built.sourcePartId = partId;
    built.parameterOverrides = structuredClone(parameterOverrides);
    partBuilds.set(variantKey, built);
  }
  const runtimeBodies = [];
  const errors = solution.errors.map((error) => ({ ...error, featureType: 'mate' }));
  for (const occurrence of solution.leafOccurrences) {
    const built = partBuilds.get(occurrence.variantKey);
    for (const body of built.part.bodies) {
      const result = built.results.get(body.id);
      const runtimeBody = result?.body || body;
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
        bodyName: occurrence.name + ' / ' + runtimeBody.name,
        kind: runtimeBody.kind,
        visible: occurrence.visible && runtimeBody.visible,
        suppressed: occurrence.suppressed || runtimeBody.suppressed,
        consumed: Boolean(runtimeBody.extensions?.consumedByFeatureId),
        occurrenceInstance: {
          occurrenceId: occurrence.id,
          occurrencePath: occurrence.occurrencePath,
          definition: occurrence.definition,
          parameterOverrides: occurrence.parameterOverrides || {},
          variantKey: occurrence.variantKey,
          sourceOccurrenceId: occurrence.sourceOccurrenceId,
          patternInstance: occurrence.patternInstance || null,
        },
        sourceBodyId: body.id,
        sourceKey: occurrence.variantKey + ':' + body.id,
        exactShape: result?.shape || null,
        renderShape: result?.shape || null,
        exactPlacement: occurrence.transform,
        renderTransform: occurrence.transform,
        geometry,
        error,
        reused: result?.reused === true,
        lastValid: Boolean(result?.lastValid || solution.usedLastValid),
      });
    }
    for (const result of built.patternResults.values()) {
      const source = built.results.get(result.body.patternInstance.sourceBodyId);
      const bodyId = occurrence.id + ':' + result.body.id;
      const fused = result.body.patternInstance?.fused === true;
      const placement = fused
        ? occurrence.transform
        : studioV5MultiplyMatrices(occurrence.transform, result.renderTransform || assemblyIdentityMatrix());
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
          parameterOverrides: occurrence.parameterOverrides || {},
          variantKey: occurrence.variantKey,
          sourceOccurrenceId: occurrence.sourceOccurrenceId,
          patternInstance: occurrence.patternInstance || null,
        },
        patternInstance: result.body.patternInstance,
        sourceBodyId: result.body.patternInstance.sourceBodyId,
        sourceKey: occurrence.variantKey + ':' + (fused ? result.body.id : result.body.patternInstance.sourceBodyId),
        exactShape: result.shape,
        renderShape: fused ? result.shape : source?.shape || null,
        exactPlacement: occurrence.transform,
        renderTransform: placement,
        geometry,
        error,
        reused: result.reused === true,
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
      mateResiduals: solution.residuals,
      usedLastValid: solution.usedLastValid,
      evaluatedPartIds: [...new Set([...partBuilds.values()].map((built) => built.sourcePartId))],
      evaluatedVariantKeys: [...partBuilds.keys()],
      reusedBodyIds: [...partBuilds.values()].flatMap((built) => built.trace.reusedBodyIds),
      evaluatedBodyIds: [...partBuilds.values()].flatMap((built) => built.trace.evaluatedBodyIds),
      reusedVariantBodyIds: [...partBuilds.values()].flatMap((built) => built.trace.reusedBodyIds.map((bodyId) => built.variantKey + ':' + bodyId)),
      evaluatedVariantBodyIds: [...partBuilds.values()].flatMap((built) => built.trace.evaluatedBodyIds.map((bodyId) => built.variantKey + ':' + bodyId)),
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
  const topologyFaces = [];
  for (const face of shape.faces) {
    try {
      topologyFaces.push({ faceId: face.hashCode, sig: faceSignature(face), geomType: face.geomType || 'OTHER' });
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
  const topologyVertices = [];
  const vertexKeys = new Set();
  for (const edge of shape.edges) {
    for (const parameter of [0, 1]) {
      let exactPoint = null;
      try {
        exactPoint = edge.pointAt(parameter);
        const point = [
          exactPoint.x ?? exactPoint[0],
          exactPoint.y ?? exactPoint[1],
          exactPoint.z ?? exactPoint[2],
        ].map(quantize);
        const key = point.join(',');
        if (vertexKeys.has(key)) continue;
        vertexKeys.add(key);
        topologyVertices.push({ sig: { p: point } });
      } catch {}
      finally { safeDelete(exactPoint); }
    }
  }
  const bounds = shape.boundingBox?.bounds ?? null;
  const transfer = [vertices.buffer, triangles.buffer, ...edges.map((edge) => edge.points.buffer)];
  if (normals) transfer.push(normals.buffer);
  return {
    mesh: { vertices, normals, triangles, faceGroups, planarFaces, topologyFaces, edges, topologyVertices, bounds },
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
      sourceKey: built.part.id + ':' + body.id,
      renderSourceKey: built.part.id + ':' + body.id,
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
    const fused = body.patternInstance?.fused === true;
    const shared = result.sharesSourceGeometry === true;
    const serialized = fused && !body.suppressed && result?.shape ? serializeShape(result.shape) : { mesh: null, transfer: [] };
    transfer.push(...serialized.transfer);
    bodies.push({
      bodyId: body.id,
      bodyName: body.name,
      sourceBodyId: body.patternInstance.sourceBodyId,
      sourceKey: built.part.id + ':' + (fused ? body.id : body.patternInstance.sourceBodyId),
      renderSourceKey: built.part.id + ':' + (fused ? body.id : body.patternInstance.sourceBodyId),
      kind: body.kind,
      visible: body.visible,
      suppressed: body.suppressed,
      patternInstance: body.patternInstance,
      mesh: serialized.mesh,
      ...(!fused ? { renderSourceBodyId: body.patternInstance.sourceBodyId, renderTransform: sceneRenderMatrix(result.renderTransform || identityMatrix()) } : {}),
      sharesSourceGeometry: shared,
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
      const cacheKey = partBuild.variantKey + ':' + body.id;
      if (result?.shape && !result.error) nextCache.set(cacheKey, result);
      else if (result?.shape && result.lastValid) nextCache.set(cacheKey, previousCache.get(cacheKey));
    }
    for (const result of partBuild.patternResults.values()) {
      const cacheKey = partBuild.variantKey + ':' + result.body.id;
      if (result?.shape && !result.error) nextCache.set(cacheKey, result);
      else if (result?.shape && result.lastValid) nextCache.set(cacheKey, previousCache.get(cacheKey));
    }
  }
  const templateBodyIds = new Map();
  const bodies = [];
  const transfer = [];
  for (const runtime of built.runtimeBodies) {
    const templateBodyId = templateBodyIds.get(runtime.sourceKey);
    let serialized = { mesh: null, transfer: [] };
    if (!templateBodyId && runtime.renderShape && (currentRevision < 0 || !runtime.reused)) {
      serialized = serializeShape(runtime.renderShape);
      transfer.push(...serialized.transfer);
    }
    if (!templateBodyId) templateBodyIds.set(runtime.sourceKey, runtime.bodyId);
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
      renderSourceKey: runtime.sourceKey,
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
  const built = await buildV5Document(request.document, { cache: currentBodyCache, previousCache: currentBodyCache });
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
  disposeV5Build(built);
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
  const built = await buildV5Assembly(request.document, {
    cache: currentBodyCache,
    previousCache: currentBodyCache,
    previousSolutions: currentAssemblySolutions,
  });
  const bodies = built.runtimeBodies.map((runtime) => ({
    bodyId: runtime.bodyId,
    bodyName: runtime.bodyName,
    sourceBodyId: runtime.sourceBodyId,
    visible: runtime.visible,
    occurrenceInstance: runtime.occurrenceInstance,
    patternInstance: runtime.patternInstance || null,
    suppressed: runtime.suppressed,
    geometry: runtime.geometry,
    error: runtime.error,
  }));
  disposeV5Build(built);
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

function evaluateSavedMeasurement(measurement, placedByBodyId) {
  const definition = measurement.definition || {};
  const body = (bodyId) => {
    const entry = placedByBodyId.get(bodyId);
    if (!entry) throw new Error('Referenced measurement body "' + bodyId + '" no longer exists.');
    return entry;
  };
  const referencePoint = (reference) => {
    const local = reference?.signature?.p;
    if (!Array.isArray(local) || local.length !== 3 || local.some((value) => !Number.isFinite(Number(value)))) throw new Error('Measurement point signature is invalid.');
    return reference.bodyId ? studioV5TransformPoint(body(reference.bodyId).runtime.exactPlacement || assemblyIdentityMatrix(), local.map(Number)) : local.map(Number);
  };
  const referenceNormal = (reference) => {
    const local = reference?.signature?.n;
    if (!Array.isArray(local) || local.length !== 3) throw new Error('Measurement face normal is invalid.');
    const transformed = reference.bodyId ? studioV5TransformVector(body(reference.bodyId).runtime.exactPlacement || assemblyIdentityMatrix(), local.map(Number)) : local.map(Number);
    const magnitude = Math.hypot(...transformed);
    if (!(magnitude > 1e-12)) throw new Error('Measurement direction is zero length.');
    return transformed.map((value) => value / magnitude);
  };
  const result = { id: measurement.id, name: measurement.name, kind: measurement.kind, valid: true };
  const references = definition.references || [];
  if (measurement.kind === 'coordinate') return { ...result, value: referencePoint(references[0]), unit: 'mm' };
  if (measurement.kind === 'point-distance') {
    const left = referencePoint(references[0]); const right = referencePoint(references[1]);
    return { ...result, value: Math.hypot(...left.map((value, index) => value - right[index])), unit: 'mm' };
  }
  if (measurement.kind === 'edge-length') return { ...result, value: Number(references[0]?.signature?.l), unit: 'mm' };
  if (measurement.kind === 'radius' || measurement.kind === 'diameter') {
    const radius = Number(references[0]?.signature?.r);
    if (!(radius > 0)) throw new Error('Referenced circular edge no longer has a valid radius.');
    return { ...result, value: measurement.kind === 'diameter' ? radius * 2 : radius, unit: 'mm' };
  }
  if (measurement.kind === 'face-angle') {
    const left = referenceNormal(references[0]); const right = referenceNormal(references[1]);
    const cosine = Math.max(-1, Math.min(1, left.reduce((total, value, index) => total + value * right[index], 0)));
    return { ...result, value: Math.acos(cosine) * 180 / Math.PI, unit: 'deg' };
  }
  if (measurement.kind === 'wall-thickness') {
    const left = referencePoint(references[0]); const right = referencePoint(references[1]); const normal = referenceNormal(references[0]);
    const delta = right.map((value, index) => value - left[index]);
    return { ...result, value: Math.abs(delta.reduce((total, value, index) => total + value * normal[index], 0)), unit: 'mm' };
  }
  if (measurement.kind === 'bounding-box') {
    const bounds = body(definition.bodyIds[0]).properties.bounds;
    return { ...result, value: bounds[0].map((value, axis) => bounds[1][axis] - value), coordinates: bounds, unit: 'mm' };
  }
  if (measurement.kind === 'minimum-clearance') {
    const left = body(definition.bodyIds[0]); const right = body(definition.bodyIds[1]);
    const distanceTool = new rc.DistanceTool();
    try { return { ...result, value: distanceTool.distanceBetween(left.shape, right.shape), unit: 'mm' }; }
    finally { distanceTool.delete(); }
  }
  throw new Error('Measurement kind is unsupported.');
}

function disposeV5Build(built) {
  const disposed = new Set();
  const builds = built.partBuilds ? [...built.partBuilds.values()] : [built];
  for (const partBuild of builds) for (const result of [...partBuild.results.values(), ...partBuild.patternResults.values()]) {
    if (result.shape && !result.reused && !result.lastValid && !disposed.has(result.shape)) { disposed.add(result.shape); safeDelete(result.shape); }
  }
}

async function inspectV5(request) {
  await loadKernel();
  if (request.document?.schemaVersion !== 5) throw new Error('Engineering inspection requires a schema-5 project.');
  let built;
  let runtimes;
  if (request.document.rootDocument?.kind === 'assembly') {
    built = await buildV5Assembly(request.document, {
      cache: currentBodyCache,
      previousCache: currentBodyCache,
      previousSolutions: currentAssemblySolutions,
    });
    runtimes = built.runtimeBodies;
  } else {
    built = await buildV5Document(request.document, { cache: currentBodyCache, previousCache: currentBodyCache });
    runtimes = [
      ...built.part.bodies.map((body) => {
        const result = built.results.get(body.id);
        return { bodyId: body.id, bodyName: body.name, sourceBodyId: body.id, sourceKey: built.part.id + ':' + body.id, visible: result?.body?.visible ?? body.visible, suppressed: body.suppressed, consumed: Boolean(result?.body?.extensions?.consumedByFeatureId), exactShape: result?.shape, exactPlacement: assemblyIdentityMatrix(), renderShape: result?.shape, renderTransform: assemblyIdentityMatrix(), geometry: result?.geometry, error: result?.error };
      }),
      ...[...built.patternResults.values()].map((result) => ({
        bodyId: result.body.id, bodyName: result.body.name, sourceBodyId: result.body.patternInstance.sourceBodyId,
        sourceKey: built.part.id + ':' + (result.body.patternInstance?.fused ? result.body.id : result.body.patternInstance.sourceBodyId),
        visible: result.body.visible, suppressed: result.body.suppressed, exactShape: result.shape, exactPlacement: assemblyIdentityMatrix(),
        renderShape: result.body.patternInstance?.fused ? result.shape : built.results.get(result.body.patternInstance.sourceBodyId)?.shape,
        renderTransform: result.body.patternInstance?.fused ? assemblyIdentityMatrix() : result.renderTransform || assemblyIdentityMatrix(),
        geometry: result.geometry, error: result.error,
      })),
    ];
  }
  const requested = Array.isArray(request.bodyIds) && request.bodyIds.length ? new Set(request.bodyIds) : null;
  const candidates = runtimes.filter((runtime) => (!requested || requested.has(runtime.bodyId)) && !runtime.suppressed && !runtime.consumed);
  const selected = candidates.filter((runtime) => runtime.exactShape);
  const errors = [...(built.errors || [])]
    .filter((error) => !requested || !error.bodyId || requested.has(error.bodyId));
  if (!selected.length) errors.push({ featureType: 'inspection', message: 'Select at least one valid unsuppressed body or component.' });
  if (requested) for (const bodyId of requested) if (!runtimes.some((runtime) => runtime.bodyId === bodyId)) errors.push({ bodyId, featureType: 'inspection', message: 'Selected inspection body no longer exists.' });
  for (const runtime of candidates) if (!runtime.exactShape && !errors.some((error) => error.bodyId === runtime.bodyId)) {
    errors.push({ bodyId: runtime.bodyId, featureType: 'inspection', message: 'Selected body has no exact geometry to inspect.' });
  }
  const placed = [];
  const collisionMeshes = new Map();
  try {
    for (const runtime of selected) {
      const shape = applyRigidMatrix(runtime.exactShape, runtime.exactPlacement || assemblyIdentityMatrix());
      const physical = shapePhysicalProperties(shape);
      const { part, body, material } = inspectionMaterial(request.document, runtime);
      const densityKgM3 = material?.densityKgM3 ?? null;
      let envelope = null;
      if (request.mode === 'interference') {
        const collisionKey = runtime.sourceKey || runtime.sourceBodyId || runtime.bodyId;
        let mesh = collisionMeshes.get(collisionKey);
        if (!mesh) {
          mesh = collisionMesh(runtime.renderShape || runtime.exactShape);
          collisionMeshes.set(collisionKey, mesh);
        }
        envelope = collisionEnvelope(mesh, runtime.renderTransform || runtime.exactPlacement || assemblyIdentityMatrix());
      }
      placed.push({
        runtime, shape,
        orientedBounds: orientedBounds(
          runtime.renderShape || runtime.exactShape,
          runtime.renderTransform || runtime.exactPlacement || assemblyIdentityMatrix(),
          Number(request.tolerance) || 1e-7,
        ),
        collisionEnvelope: envelope,
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
    const exactPairCache = new Map();
    const broadPhaseClassKeys = new Set();
    if (request.mode === 'interference' || request.mode === 'clearance') {
      const pairFilter = Array.isArray(request.pairBodyIds) && request.pairBodyIds.length === 2 ? new Set(request.pairBodyIds) : null;
      for (let leftIndex = 0; leftIndex < placed.length; leftIndex++) {
        const left = placed[leftIndex];
        const candidates = [];
        for (let rightIndex = leftIndex + 1; rightIndex < placed.length; rightIndex++) {
          const right = placed[rightIndex];
          if (pairFilter && (!pairFilter.has(left.runtime.bodyId) || !pairFilter.has(right.runtime.bodyId))) continue;
          const overlaps = boundsOverlap(left.shape, right.shape, Number(request.tolerance) || 0)
            && orientedBoundsOverlap(left.orientedBounds, right.orientedBounds)
            && collisionEnvelopesOverlap(left.collisionEnvelope, right.collisionEnvelope);
          const equivalenceKey = overlaps ? interferenceEquivalenceKey(left, right) : null;
          if (overlaps) {
            broadPhasePairs++;
            if (equivalenceKey) broadPhaseClassKeys.add(equivalenceKey);
            candidates.push({ index: rightIndex, entry: right, equivalenceKey });
          }
          if (request.mode === 'clearance' && !overlaps) candidates.push({ index: rightIndex, entry: right, equivalenceKey: null });
        }
        if (request.mode === 'interference') {
          const uncached = candidates.filter((candidate) => !candidate.equivalenceKey || !exactPairCache.has(candidate.equivalenceKey));
          const batchVolumes = batchInterferenceVolumes(left, uncached, Number(request.tolerance) || 0);
          for (const candidate of uncached) if (candidate.equivalenceKey) {
            exactPairCache.set(candidate.equivalenceKey, { interferenceVolumeMm3: batchVolumes.get(candidate.index) || 0 });
          }
          for (const candidate of candidates) {
            const interferenceVolumeMm3 = candidate.equivalenceKey && exactPairCache.has(candidate.equivalenceKey)
              ? exactPairCache.get(candidate.equivalenceKey).interferenceVolumeMm3
              : batchVolumes.get(candidate.index) || 0;
            pairs.push({
              leftBodyId: left.runtime.bodyId, rightBodyId: candidate.entry.runtime.bodyId,
              leftOccurrencePath: left.runtime.occurrenceInstance?.occurrencePath || [], rightOccurrencePath: candidate.entry.runtime.occurrenceInstance?.occurrencePath || [],
              interferenceVolumeMm3, minimumClearanceMm: 0,
            });
          }
          continue;
        }
        const distanceQuery = new rc.DistanceQuery(left.shape);
        try {
          for (const candidate of candidates) {
            let minimumClearanceMm = null;
            try { minimumClearanceMm = distanceQuery.distanceTo(candidate.entry.shape); } catch {}
            let interferenceVolumeMm3 = 0;
            if (candidate.equivalenceKey && minimumClearanceMm != null && minimumClearanceMm <= Math.max(1e-7, Number(request.tolerance) || 0)) {
              interferenceVolumeMm3 = exactIntersectionVolume(left, candidate.entry);
            }
            pairs.push({
              leftBodyId: left.runtime.bodyId, rightBodyId: candidate.entry.runtime.bodyId,
              leftOccurrencePath: left.runtime.occurrenceInstance?.occurrencePath || [], rightOccurrencePath: candidate.entry.runtime.occurrenceInstance?.occurrencePath || [],
              interferenceVolumeMm3, minimumClearanceMm,
            });
          }
        } finally {
          distanceQuery.delete();
        }
      }
    }
    const measurementResults = [];
    if (request.mode === 'measurements') {
      const saved = request.document.rootDocument?.kind === 'assembly'
        ? request.document.assemblyDefinitions.find((entry) => entry.id === request.document.rootDocument.assemblyId)?.metadata?.measurements || []
        : [];
      const placedByBodyId = new Map(placed.map((entry) => [entry.runtime.bodyId, entry]));
      for (const measurement of saved.filter((entry) => entry.visible !== false)) {
        try { measurementResults.push(evaluateSavedMeasurement(measurement, placedByBodyId)); }
        catch (error) { measurementResults.push({ id: measurement.id, name: measurement.name, kind: measurement.kind, valid: false, error: String(error?.message || error) }); }
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
        broadPhaseClassCount: broadPhaseClassKeys.size,
        exactPairClassCount: exactPairCache.size,
        pairs,
        measurementResults,
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

async function freezePatternOccurrences(request) {
  if (request.document?.rootDocument?.kind !== 'part') throw new Error('Pattern materialization requires a part document');
  const built = await buildV5Document(request.document, { cache: new Map(), previousCache: new Map() });
  const requestedIds = new Set(request.bodyIds || []);
  const selected = [...built.patternResults.values()].filter((result) => requestedIds.has(result.body.id));
  const errors = [
    ...built.errors.filter((error) => requestedIds.has(error.bodyId)),
    ...[...requestedIds].filter((bodyId) => !selected.some((result) => result.body.id === bodyId))
      .map((bodyId) => ({ bodyId, featureType: 'pattern', message: 'selected pattern occurrence does not exist' })),
  ];
  if (!selected.length) errors.push({ featureType: 'pattern', message: 'select at least one generated pattern occurrence' });
  if (selected.some((result) => !result.shape || !result.geometry?.valid)) errors.push({ featureType: 'pattern', message: 'one or more selected occurrences have no valid exact solid' });
  const prefix = String(request.freezePrefix || 'materialized-pattern').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 120);
  const records = errors.length ? [] : selected.map((result, index) => {
    const ids = {
      resourceId: prefix + '-resource-' + (index + 1),
      featureId: prefix + '-feature-' + (index + 1),
      bodyId: prefix + '-body-' + (index + 1),
    };
    const record = importedBodyRecord(ids, 'Independent ' + result.body.name, result.shape.serialize(), result.body);
    return {
      ...record,
      patternId: result.body.patternInstance.patternId,
      patternIndex: result.body.patternInstance.index,
      sourceBodyId: result.body.patternInstance.sourceBodyId,
      geometry: result.geometry,
    };
  });
  const disposed = new Set();
  for (const result of [...built.results.values(), ...built.patternResults.values()]) {
    if (result.shape && !disposed.has(result.shape)) { disposed.add(result.shape); safeDelete(result.shape); }
  }
  self.postMessage({
    kind: 'freeze-pattern-result', requestId: request.requestId, projectId: request.projectId,
    revision: request.revision, errors, records,
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
      ...(originalBody?.materialId ? { materialId: originalBody.materialId } : {}),
    },
  };
}

function externalStepMetadata(text) {
  const unit = /SI_UNIT\(\.MILLI\.,\s*\.METRE\.\)/i.test(text) ? { sourceUnits: 'mm', scaleToMm: 1 }
    : /SI_UNIT\(\.CENTI\.,\s*\.METRE\.\)/i.test(text) ? { sourceUnits: 'cm', scaleToMm: 10 }
      : /SI_UNIT\(\$,\s*\.METRE\.\)/i.test(text) ? { sourceUnits: 'm', scaleToMm: 1000 }
        : /CONVERSION_BASED_UNIT\(\s*'INCH'/i.test(text) ? { sourceUnits: 'in', scaleToMm: 25.4 }
          : { sourceUnits: 'unknown', scaleToMm: null };
  const colors = [];
  for (const match of text.matchAll(/COLOUR_RGB\(\s*'([^']*)'\s*,\s*([\d.+-Ee]+)\s*,\s*([\d.+-Ee]+)\s*,\s*([\d.+-Ee]+)\s*\)/gi)) {
    const rgb = match.slice(2, 5).map(Number);
    if (rgb.every(Number.isFinite)) colors.push({ name: match[1] || 'STEP color', rgb });
  }
  return { ...unit, colors };
}

function externalStepProductGraph(text) {
  const entities = new Map();
  for (const match of text.matchAll(/#(\d+)\s*=\s*([\s\S]*?);/g)) entities.set(Number(match[1]), match[2].trim());
  const refs = (source) => [...String(source || '').matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
  const strings = (source) => [...String(source || '').matchAll(/'((?:''|[^'])*)'/g)].map((match) => match[1].replaceAll("''", "'"));
  const products = new Map();
  const formations = new Map();
  const definitions = new Map();
  const relations = [];
  for (const [id, source] of entities) {
    if (/^PRODUCT\(/i.test(source)) products.set(id, strings(source)[0] || 'Imported product');
    else if (/^PRODUCT_DEFINITION_FORMATION(?:_WITH_SPECIFIED_SOURCE)?\(/i.test(source)) formations.set(id, refs(source).at(-1));
    else if (/^PRODUCT_DEFINITION\(/i.test(source)) definitions.set(id, refs(source)[0]);
    else if (/^NEXT_ASSEMBLY_USAGE_OCCURRENCE\(/i.test(source)) {
      const relationRefs = refs(source); const values = strings(source);
      if (relationRefs.length >= 2) relations.push({ id, name: values[1] || values[0] || 'Imported occurrence', parent: relationRefs.at(-2), child: relationRefs.at(-1) });
    }
  }
  const nameForDefinition = (definitionId) => products.get(formations.get(definitions.get(definitionId))) || 'Imported product';
  const children = new Map();
  for (const relation of relations) {
    if (!children.has(relation.parent)) children.set(relation.parent, []);
    children.get(relation.parent).push(relation);
  }
  const childIds = new Set(relations.map((relation) => relation.child));
  const roots = [...children.keys()].filter((id) => !childIds.has(id));
  return { relations, children, roots, nameForDefinition };
}

function createExternalStructuredProject(filename, text, solids) {
  const graph = externalStepProductGraph(text);
  if (graph.roots.length !== 1 || !graph.relations.length) throw new Error('external STEP has no unambiguous product root');
  const metadata = externalStepMetadata(text);
  const resources = []; const parts = []; const assemblies = []; let solidIndex = 0; let sequence = 0;
  const safeId = (prefix, value) => prefix + '-' + String(value || '').replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) + '-' + (++sequence).toString(36);
  const materials = metadata.colors.map((color, index) => {
    const hex = '#' + color.rgb.map((value) => Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, '0')).join('');
    return {
      id: 'material-step-color-' + (index + 1), name: color.name || 'STEP color ' + (index + 1),
      appearanceId: 'appearance-step-color-' + (index + 1), source: 'Imported STEP presentation style',
      extensions: { studioAppearance: { baseColor: hex, metallic: 0.1, roughness: 0.55, opacity: 1, edgeColor: '#263746' }, sourceRgb: color.rgb },
    };
  });
  const isPartWrapper = (definitionId) => {
    const childRelations = graph.children.get(definitionId) || [];
    return childRelations.length > 0 && childRelations.every((relation) => !(graph.children.get(relation.child)?.length));
  };
  const buildPart = (definitionId, occurrenceName) => {
    const bodyRelations = graph.children.get(definitionId) || [];
    const bodyRecords = [];
    for (const relation of bodyRelations) {
      const solid = solids[solidIndex++];
      if (!solid) throw new Error('external STEP product hierarchy has more leaf bodies than exact solids');
      const suffix = solidIndex.toString(36); const bodyName = graph.nameForDefinition(relation.child) || relation.name || 'Imported body ' + solidIndex;
      const material = materials[(solidIndex - 1) % Math.max(1, materials.length)];
      const record = importedBodyRecord({ bodyId: 'body-step-' + suffix, featureId: 'feature-step-' + suffix, resourceId: 'resource-step-' + suffix }, bodyName, solid.serialize(), {
        kind: 'solid', visible: true, ...(material ? { materialId: material.id, appearanceId: material.appearanceId } : {}),
      });
      resources.push(record.resource); bodyRecords.push(record);
    }
    const partId = safeId('part-step', occurrenceName || graph.nameForDefinition(definitionId));
    const part = importedPartRecord(partId, graph.nameForDefinition(definitionId) || occurrenceName, bodyRecords);
    part.metadata.sourceProductDefinitionId = definitionId;
    parts.push(part);
    return partId;
  };
  const buildAssembly = (definitionId, occurrenceName) => {
    const assemblyId = safeId('assembly-step', occurrenceName || graph.nameForDefinition(definitionId));
    const occurrences = [];
    for (const relation of graph.children.get(definitionId) || []) {
      if (!(graph.children.get(relation.child)?.length)) continue;
      const definition = isPartWrapper(relation.child)
        ? { kind: 'part', partId: buildPart(relation.child, relation.name) }
        : { kind: 'assembly', assemblyId: buildAssembly(relation.child, relation.name) };
      occurrences.push({
        id: safeId('occurrence-step', relation.name), name: relation.name || graph.nameForDefinition(relation.child), definition,
        baseTransform: assemblyIdentityMatrix(), fixed: true, suppressed: false, visible: true,
        extensions: { studioImportedStep: { sourceUsageId: relation.id, worldPlacedGeometry: true } },
      });
    }
    assemblies.push({
      id: assemblyId, name: graph.nameForDefinition(definitionId) || occurrenceName, parameters: [], occurrences,
      mates: [], occurrencePatterns: [], explodedViews: [], sectionViews: [],
      metadata: { importedFromStep: true, sourceProductDefinitionId: definitionId },
      extensions: { studioImportedStep: { externalProductHierarchy: true, worldPlacedGeometry: true } },
    });
    return assemblyId;
  };
  const rootAssemblyId = buildAssembly(graph.roots[0], filename.replace(/\.(step|stp)$/i, ''));
  if (solidIndex !== solids.length || !parts.length || !assemblies.length) throw new Error('external STEP product hierarchy does not cover every exact solid');
  assertImportedResourceBudget(resources);
  return {
    schemaVersion: 5, projectId: 'project-step-' + crypto.randomUUID(), name: graph.nameForDefinition(graph.roots[0]) || filename.replace(/\.(step|stp)$/i, ''), units: 'mm',
    parameters: [], materials, partDefinitions: parts, assemblyDefinitions: assemblies,
    rootDocument: { kind: 'assembly', assemblyId: rootAssemblyId }, resources,
    metadata: {
      importedFromStep: true, importMode: 'external-product-hierarchy', sourceUnits: metadata.sourceUnits, sourceUnitScaleToMm: metadata.scaleToMm,
      importLimitations: ['world-placed-imported-geometry', 'no-parametric-feature-history', 'no-mate-recovery', ...(materials.length ? ['external-material-density-unavailable'] : ['external-material-assignment-unavailable'])],
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
    units: 'mm', parameters: [], materials: structuredClone(manifest.materials || []), partDefinitions: parts, assemblyDefinitions: assemblies,
    rootDocument: { kind: 'assembly', assemblyId: manifest.rootAssemblyId }, resources,
    metadata: {
      importedFromStep: true, importMode: 'bomwiki-solved-hierarchy', sourceUnits: manifest.sourceUnits || manifest.units,
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
  const oc = rc.getOC();
  oc.Interface_Static.SetCVal('xstep.cascade.unit', 'MM');
  oc.Interface_Static.SetCVal('read.step.unit', 'MM');
  let stage = 'reading STEP geometry';
  let imported;
  let readError = null;
  for (let attempt = 0; attempt < 2 && !imported; attempt++) {
    try { imported = await rc.importSTEP(request.blob); }
    catch (error) { readError = error; }
  }
  if (!imported) throw new Error(stage + ': ' + String(readError?.message || readError));
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
    let importedProject;
    if (manifest) importedProject = createStructuredImportedProject(filename, manifest, solids, solidGeometry);
    else {
      try { importedProject = createExternalStructuredProject(filename, text, solids); }
      catch { importedProject = createFlatImportedProject(filename, solids); }
    }
    const project = prepareStudioV5Project(importedProject);
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

async function reportMemoryStats(request) {
  await loadKernel();
  const oc = rc?.getOC?.();
  const heapBuffer = oc?.HEAP8?.buffer || oc?.wasmMemory?.buffer || oc?.asm?.memory?.buffer || null;
  self.postMessage({
    kind: 'memory-stats-result', requestId: request.requestId, projectId: request.projectId, revision: request.revision,
    memory: {
      wasmHeapBytes: heapBuffer?.byteLength || 0,
      retainedShapeEntries: currentBodyCache.size,
      retainedAssemblySolutions: currentAssemblySolutions.size,
      hasLegacyShape: Boolean(currentShape),
    },
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
      : request.kind === 'freeze-pattern-v5'
        ? freezePatternOccurrences(request)
      : request.kind === 'import-step-v5'
        ? importV5Step(request)
      : request.kind === 'inspect-v5'
        ? inspectV5(request)
      : request.kind === 'release'
        ? Promise.resolve(releaseShape(request))
      : request.kind === 'memory-stats'
        ? reportMemoryStats(request)
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
