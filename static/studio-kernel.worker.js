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
let currentRevision = -1;

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

function evaluator(document) {
  const entries = document.schemaVersion === 5
    ? [
        ...(document.parameters || []),
        ...((document.partDefinitions || []).find((part) => part.id === document.rootDocument?.partId)?.parameters || []),
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
  if (document.rootDocument?.kind !== 'part') throw new Error('Slice 5A can evaluate schema-5 part documents only.');
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

function bodyGeometry(shape) {
  const solids = solidCount(shape);
  const volume = shapeVolume(shape);
  const bounds = shape.boundingBox?.bounds ?? null;
  return {
    solidCount: solids,
    volume,
    bounds,
    valid: solids === 1 && Number.isFinite(volume) && volume > 1e-8,
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

async function buildV5Document(document, options = {}) {
  await loadKernel();
  const part = v5RootPart(document);
  const { strict: N, safe: NS } = evaluator(document);
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
  const parameterState = [document.parameters || [], part.parameters || []];

  function signatureFor(bodyId) {
    if (signatures.has(bodyId)) return signatures.get(bodyId);
    if (signing.has(bodyId)) throw new Error('cyclic body dependency at "' + bodyId + '"');
    signing.add(bodyId);
    const body = bodyById.get(bodyId);
    if (!body) throw new Error('missing body "' + bodyId + '"');
    const features = body.featureIds.map((featureId) => featureById.get(featureId)).filter(Boolean);
    const toolSignatures = [];
    for (const feature of features) {
      if (feature.suppressed) continue;
      for (const toolBodyId of feature.toolBodyIds || []) toolSignatures.push([toolBodyId, signatureFor(toolBodyId)]);
    }
    const signature = stableHash({ parameterState, kind: body.kind, features, toolSignatures });
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
        if (!feature || feature.suppressed) continue;
        currentFeature = feature;
        evaluatedFeatureIds.push(feature.id);
        const policy = feature.resultPolicy;
        if (policy.kind === 'surface') throw new Error('surface results are not supported by this solid feature yet');
        if (policy.kind === 'new-body') {
          if (feature.type === 'boolean') throw new Error('a Boolean cannot create a body in Slice 5A');
          const next = featureSolid(feature, 0, null, N, NS);
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
          const modified = applyBodyModifier(feature, shape, N);
          if (modified) {
            safeDelete(shape);
            shape = modified;
            continue;
          }
          const tool = featureSolid(feature, topOf(shape), shape, N, NS);
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
        if (!geometry.valid) throw new Error('feature result is not exactly one valid solid');
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
  return {
    part,
    results,
    errors,
    trace: { evaluatedBodyIds, reusedBodyIds, evaluatedFeatureIds, reusedFeatureIds },
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
      kind: body.kind,
      visible: body.visible,
      suppressed: body.suppressed,
      mesh: serialized.mesh,
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

async function validateV5(request) {
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
  const disposed = new Set();
  for (const result of built.results.values()) {
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
  const built = await buildV5Document(request.document, { cache: new Map(), previousCache: new Map() });
  const requestedIds = Array.isArray(request.bodyIds) && request.bodyIds.length
    ? new Set(request.bodyIds)
    : new Set(built.part.bodies.filter((body) => body.visible && !body.suppressed).map((body) => body.id));
  const selected = built.part.bodies
    .filter((body) => requestedIds.has(body.id) && !body.suppressed)
    .map((body) => ({ body, result: built.results.get(body.id) }));
  const errors = [
    ...built.errors.filter((error) => requestedIds.has(error.bodyId)),
    ...[...requestedIds]
      .filter((bodyId) => !built.part.bodies.some((body) => body.id === bodyId))
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
  for (const result of built.results.values()) {
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

function releaseShape(request) {
  safeDelete(currentShape);
  currentShape = null;
  for (const entry of currentBodyCache.values()) safeDelete(entry.shape);
  currentBodyCache = new Map();
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
