// OpenCascade worker for BOMwiki CAD Studio.
//
// The UI owns documents, commands, selection and rendering. This worker owns
// the WASM kernel, B-rep shapes, exact rebuilds, topology extraction and
// exports. Every reply carries the caller's request id and document revision;
// the UI is responsible for discarding stale visual results.

let rc = null;
let kernelReady = null;
let currentShape = null;
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
  const params = Object.fromEntries((document.params || []).map((param) => [param.name, param.value]));
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

async function buildDocument(document) {
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
  const { shape, errors } = await buildDocument(request.document);
  const previous = currentShape;
  currentShape = shape;
  currentRevision = request.revision;
  const { mesh, transfer } = serializeShape(shape);
  try {
    if (previous && previous !== shape) previous.delete();
  } catch {}
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

async function exportDocument(request) {
  const { shape, errors } = await buildDocument(request.document);
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

function releaseShape(request) {
  try {
    currentShape?.delete();
  } catch {}
  currentShape = null;
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
