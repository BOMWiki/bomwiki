// Constraint-based sketch solver for BOMwiki CAD Studio.
//
// This module is deliberately free of DOM, three.js, and OpenCascade
// dependencies so the sketch editor, the kernel worker, the agent service,
// and headless CI checks all solve through exactly the same code.
//
// Model
//   entities: [
//     { id, kind: 'point',  at: [x, y], fixed?: true }
//     { id, kind: 'line',   a: pointId, b: pointId, construction?: true }
//     { id, kind: 'circle', center: pointId, r: number|string, construction?: true }
//     { id, kind: 'arc',    center: pointId, a: pointId, b: pointId, ccw?: boolean }
//   ]
//   constraints: [
//     { id?, kind: 'coincident',    a: pointId, b: pointId }
//     { id?, kind: 'horizontal',    line: lineId }            (or { a, b } point pair)
//     { id?, kind: 'vertical',      line: lineId }            (or { a, b } point pair)
//     { id?, kind: 'parallel',      a: lineId, b: lineId }
//     { id?, kind: 'perpendicular', a: lineId, b: lineId }
//     { id?, kind: 'tangent',       a: lineId|circleId|arcId, b: circleId|arcId }
//     { id?, kind: 'equal',         a: lineId|circleId|arcId, b: lineId|circleId|arcId }
//     { id?, kind: 'concentric',    a: circleId|arcId, b: circleId|arcId }
//     { id?, kind: 'midpoint',      point: pointId, line: lineId }
//     { id?, kind: 'pointOnLine',   point: pointId, line: lineId }
//     { id?, kind: 'pointOnCircle', point: pointId, circle: circleId|arcId }
//     { id?, kind: 'symmetric',     a: pointId, b: pointId, axis: lineId }
//     { id?, kind: 'distance',           a: pointId, b: pointId, value: dim }
//     { id?, kind: 'horizontalDistance', a: pointId, b: pointId, value: dim }   (signed b-a)
//     { id?, kind: 'verticalDistance',   a: pointId, b: pointId, value: dim }   (signed b-a)
//     { id?, kind: 'length',        line: lineId, value: dim }
//     { id?, kind: 'radius',        circle: circleId|arcId, value: dim }
//     { id?, kind: 'angle',         a: lineId, b: lineId, value: dim }  (degrees, a->b ccw)
//   ]
//   A dim is a finite number or an expression string; expression strings are
//   resolved through options.resolveDimension so the caller supplies the same
//   parameter evaluator the rest of the document uses.
//
// Solving is damped least squares (Levenberg-Marquardt) over the free point
// coordinates and circle radii. Under-constrained sketches stay near their
// current positions via a weak prior; they do not jump. Degrees of freedom
// are reported from the rank of the hard-constraint Jacobian.

const SOLVER_DEFAULTS = Object.freeze({
  tolerance: 1e-9,
  maxIterations: 150,
  rankTolerance: 1e-7,
});

const POINT_KINDS = new Set(['point']);
const CURVE_KINDS = new Set(['line', 'circle', 'arc']);
const ENTITY_KINDS = new Set(['point', 'line', 'circle', 'arc']);

const CONSTRAINT_ARITY = Object.freeze({
  coincident: ['a', 'b'],
  horizontal: [],
  vertical: [],
  parallel: ['a', 'b'],
  perpendicular: ['a', 'b'],
  tangent: ['a', 'b'],
  equal: ['a', 'b'],
  concentric: ['a', 'b'],
  midpoint: ['point', 'line'],
  pointOnLine: ['point', 'line'],
  pointOnCircle: ['point', 'circle'],
  symmetric: ['a', 'b', 'axis'],
  distance: ['a', 'b'],
  horizontalDistance: ['a', 'b'],
  verticalDistance: ['a', 'b'],
  length: ['line'],
  radius: ['circle'],
  angle: ['a', 'b'],
});

const DIMENSIONAL_KINDS = new Set([
  'distance', 'horizontalDistance', 'verticalDistance', 'length', 'radius', 'angle',
]);

export const SKETCH_CONSTRAINT_KINDS = Object.freeze(Object.keys(CONSTRAINT_ARITY));
export const SKETCH_ENTITY_KINDS = Object.freeze([...ENTITY_KINDS]);

class SketchSolveError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.code = code;
    this.meta = meta;
  }
}

function defaultResolveDimension(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new SketchSolveError('DIMENSION_UNRESOLVED', 'Dimension "' + value + '" is not a number and no expression resolver was provided.');
}

// --- structural validation -------------------------------------------------

export function validateConstraintSketch(sketch) {
  const diagnostics = [];
  const fail = (code, message, meta) => diagnostics.push({ code, severity: 'error', message, ...(meta || {}) });
  if (!sketch || typeof sketch !== 'object') {
    fail('SKETCH_INVALID', 'Sketch must be an object.');
    return diagnostics;
  }
  const entities = Array.isArray(sketch.entities) ? sketch.entities : [];
  const constraints = Array.isArray(sketch.constraints) ? sketch.constraints : [];
  const byId = new Map();
  for (const entity of entities) {
    if (!entity || typeof entity !== 'object') { fail('ENTITY_INVALID', 'Entity must be an object.'); continue; }
    if (typeof entity.id !== 'string' || !entity.id) { fail('ENTITY_ID_INVALID', 'Entity id must be a non-empty string.'); continue; }
    if (byId.has(entity.id)) { fail('ENTITY_ID_DUPLICATE', 'Duplicate entity id "' + entity.id + '".', { entityId: entity.id }); continue; }
    if (!ENTITY_KINDS.has(entity.kind)) { fail('ENTITY_KIND_UNKNOWN', 'Unknown entity kind "' + entity.kind + '".', { entityId: entity.id }); continue; }
    byId.set(entity.id, entity);
  }
  const requireRef = (constraintOrEntity, field, kinds, label) => {
    const ref = constraintOrEntity[field];
    const target = byId.get(ref);
    if (typeof ref !== 'string' || !target) {
      fail('REF_MISSING', label + '.' + field + ' must reference an existing entity.', { ref });
      return null;
    }
    if (kinds && !kinds.has(target.kind)) {
      fail('REF_KIND', label + '.' + field + ' references a ' + target.kind + '; expected ' + [...kinds].join('|') + '.', { ref });
      return null;
    }
    return target;
  };
  for (const entity of entities) {
    if (!byId.has(entity.id) || byId.get(entity.id) !== entity) continue;
    const label = 'entity "' + entity.id + '"';
    if (entity.kind === 'point') {
      const at = entity.at;
      if (!Array.isArray(at) || at.length !== 2 || !at.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        fail('POINT_AT_INVALID', label + ' needs at: [x, y] with finite numbers.', { entityId: entity.id });
      }
    } else if (entity.kind === 'line') {
      requireRef(entity, 'a', POINT_KINDS, label);
      requireRef(entity, 'b', POINT_KINDS, label);
      if (entity.a === entity.b) fail('LINE_DEGENERATE', label + ' endpoints must be distinct points.', { entityId: entity.id });
    } else if (entity.kind === 'circle') {
      requireRef(entity, 'center', POINT_KINDS, label);
      if (!(typeof entity.r === 'number' && Number.isFinite(entity.r) && entity.r > 0) && typeof entity.r !== 'string') {
        fail('CIRCLE_RADIUS_INVALID', label + ' needs r as a positive number or expression string.', { entityId: entity.id });
      }
    } else if (entity.kind === 'arc') {
      requireRef(entity, 'center', POINT_KINDS, label);
      requireRef(entity, 'a', POINT_KINDS, label);
      requireRef(entity, 'b', POINT_KINDS, label);
      if (entity.a === entity.b) fail('ARC_DEGENERATE', label + ' endpoints must be distinct points.', { entityId: entity.id });
    }
  }
  const LINE_ONLY = new Set(['line']);
  const ROUND_KINDS = new Set(['circle', 'arc']);
  const TANGENT_A = new Set(['line', 'circle', 'arc']);
  const EQUAL_KINDS = new Set(['line', 'circle', 'arc']);
  constraints.forEach((constraint, index) => {
    if (!constraint || typeof constraint !== 'object') { fail('CONSTRAINT_INVALID', 'Constraint #' + index + ' must be an object.'); return; }
    const kind = constraint.kind;
    if (!CONSTRAINT_ARITY[kind]) { fail('CONSTRAINT_KIND_UNKNOWN', 'Unknown constraint kind "' + kind + '".', { constraintIndex: index }); return; }
    const label = 'constraint "' + (constraint.id || kind + '#' + index) + '"';
    const need = (field, kinds) => requireRef(constraint, field, kinds, label);
    if (kind === 'coincident' || kind === 'distance' || kind === 'horizontalDistance' || kind === 'verticalDistance') {
      need('a', POINT_KINDS); need('b', POINT_KINDS);
    } else if (kind === 'horizontal' || kind === 'vertical') {
      if (typeof constraint.line === 'string') need('line', LINE_ONLY);
      else { need('a', POINT_KINDS); need('b', POINT_KINDS); }
    } else if (kind === 'parallel' || kind === 'perpendicular' || kind === 'angle') {
      need('a', LINE_ONLY); need('b', LINE_ONLY);
    } else if (kind === 'tangent') {
      need('a', TANGENT_A); need('b', ROUND_KINDS);
    } else if (kind === 'equal') {
      const a = need('a', EQUAL_KINDS); const b = need('b', EQUAL_KINDS);
      if (a && b) {
        const aRound = ROUND_KINDS.has(a.kind); const bRound = ROUND_KINDS.has(b.kind);
        if (aRound !== bRound) fail('EQUAL_MIXED', label + ' cannot equate a length with a radius.', { constraintIndex: index });
      }
    } else if (kind === 'concentric') {
      need('a', ROUND_KINDS); need('b', ROUND_KINDS);
    } else if (kind === 'midpoint' || kind === 'pointOnLine') {
      need('point', POINT_KINDS); need('line', LINE_ONLY);
    } else if (kind === 'pointOnCircle') {
      need('point', POINT_KINDS); need('circle', ROUND_KINDS);
    } else if (kind === 'symmetric') {
      need('a', POINT_KINDS); need('b', POINT_KINDS); need('axis', LINE_ONLY);
    } else if (kind === 'length') {
      need('line', LINE_ONLY);
    } else if (kind === 'radius') {
      need('circle', ROUND_KINDS);
    }
    if (DIMENSIONAL_KINDS.has(kind)) {
      const value = constraint.value;
      const numeric = typeof value === 'number' && Number.isFinite(value);
      const expression = typeof value === 'string' && value.length > 0;
      if (!numeric && !expression) fail('DIMENSION_INVALID', label + ' needs value as a finite number or expression string.', { constraintIndex: index });
    }
  });
  return diagnostics;
}

// --- solve state -----------------------------------------------------------

function buildSystem(sketch, options) {
  const resolve = options.resolveDimension || defaultResolveDimension;
  const entities = sketch.entities || [];
  const constraints = sketch.constraints || [];
  const byId = new Map(entities.map((entity) => [entity.id, entity]));

  // Union coincident points so shared corners solve as one node. This keeps
  // the system small and makes loop extraction exact instead of tolerance-based.
  const parent = new Map();
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root);
    let cursor = id;
    while (cursor !== root) { const next = parent.get(cursor); parent.set(cursor, root); cursor = next; }
    return root;
  };
  for (const entity of entities) if (entity.kind === 'point') parent.set(entity.id, entity.id);
  const mergedConstraints = [];
  for (const constraint of constraints) {
    if (constraint.kind === 'coincident') {
      const ra = find(constraint.a); const rb = find(constraint.b);
      if (ra !== rb) parent.set(ra, rb);
      continue; // handled structurally, not as a residual
    }
    mergedConstraints.push(constraint);
  }

  // Free parameters: one (x, y) pair per point cluster root (unless a fixed
  // point is in the cluster), plus one radius per circle.
  const clusterOf = (pointId) => find(pointId);
  const clusters = new Map(); // root -> {x, y, fixed, index|-1}
  for (const entity of entities) {
    if (entity.kind !== 'point') continue;
    const root = clusterOf(entity.id);
    let cluster = clusters.get(root);
    if (!cluster) { cluster = { x: entity.at[0], y: entity.at[1], fixed: false, index: -1 }; clusters.set(root, cluster); }
    if (entity.fixed) { cluster.fixed = true; cluster.x = entity.at[0]; cluster.y = entity.at[1]; }
  }
  const params = [];
  for (const cluster of clusters.values()) {
    if (cluster.fixed) continue;
    cluster.index = params.length;
    params.push(cluster.x, cluster.y);
  }
  const radii = new Map(); // circleId -> {index, value}
  for (const entity of entities) {
    if (entity.kind !== 'circle') continue;
    const value = resolve(entity.r);
    if (!(value > 0)) throw new SketchSolveError('CIRCLE_RADIUS_INVALID', 'Circle "' + entity.id + '" radius must resolve positive.', { entityId: entity.id });
    radii.set(entity.id, { index: params.length, value });
    params.push(value);
  }

  const px = (x, pointId) => { const c = clusters.get(clusterOf(pointId)); return c.fixed ? c.x : x[c.index]; };
  const py = (x, pointId) => { const c = clusters.get(clusterOf(pointId)); return c.fixed ? c.y : x[c.index + 1]; };
  const rOf = (x, circleId) => x[radii.get(circleId).index];

  // Radius accessor that works for circles (parameter) and arcs (derived).
  const roundRadius = (x, entity) => entity.kind === 'circle'
    ? rOf(x, entity.id)
    : Math.hypot(px(x, entity.a) - px(x, entity.center), py(x, entity.a) - py(x, entity.center));

  const residuals = []; // {constraint, eval(x, out)} pushing 1..2 values
  const pushResidual = (constraint, count, evaluate) => residuals.push({ constraint, count, evaluate });

  // Arcs stay circular: |center-a| === |center-b|.
  for (const entity of entities) {
    if (entity.kind !== 'arc') continue;
    pushResidual({ kind: 'arc-internal', id: entity.id }, 1, (x, out) => {
      const cx = px(x, entity.center), cy = py(x, entity.center);
      out.push(Math.hypot(px(x, entity.a) - cx, py(x, entity.a) - cy)
             - Math.hypot(px(x, entity.b) - cx, py(x, entity.b) - cy));
    });
  }

  const lineOf = (id) => byId.get(id);
  const dir = (x, line) => [px(x, line.b) - px(x, line.a), py(x, line.b) - py(x, line.a)];
  const norm = (v) => Math.hypot(v[0], v[1]) || 1e-12;

  for (const constraint of mergedConstraints) {
    const kind = constraint.kind;
    if (kind === 'horizontal' || kind === 'vertical') {
      const pair = typeof constraint.line === 'string'
        ? { a: lineOf(constraint.line).a, b: lineOf(constraint.line).b }
        : { a: constraint.a, b: constraint.b };
      pushResidual(constraint, 1, (x, out) => {
        out.push(kind === 'horizontal' ? py(x, pair.b) - py(x, pair.a) : px(x, pair.b) - px(x, pair.a));
      });
    } else if (kind === 'parallel' || kind === 'perpendicular') {
      const la = lineOf(constraint.a), lb = lineOf(constraint.b);
      pushResidual(constraint, 1, (x, out) => {
        const d1 = dir(x, la), d2 = dir(x, lb);
        const scale = norm(d1) * norm(d2);
        out.push(kind === 'parallel'
          ? (d1[0] * d2[1] - d1[1] * d2[0]) / scale
          : (d1[0] * d2[0] + d1[1] * d2[1]) / scale);
      });
    } else if (kind === 'tangent') {
      const a = byId.get(constraint.a), b = byId.get(constraint.b);
      const x0 = Float64Array.from(params);
      if (a.kind === 'line') {
        // Which side the circle sits on is decided by the input configuration,
        // so solving is deterministic and the circle never flips across.
        const d0 = dir(x0, a);
        const signed0 = (d0[0] * (py(x0, b.center) - py(x0, a.a)) - d0[1] * (px(x0, b.center) - px(x0, a.a))) / norm(d0);
        const sign = signed0 >= 0 ? 1 : -1;
        pushResidual(constraint, 1, (x, out) => {
          const d = dir(x, a);
          const cxv = px(x, b.center) - px(x, a.a);
          const cyv = py(x, b.center) - py(x, a.a);
          out.push((d[0] * cyv - d[1] * cxv) / norm(d) - sign * roundRadius(x, b));
        });
      } else {
        const gap0 = Math.hypot(px(x0, b.center) - px(x0, a.center), py(x0, b.center) - py(x0, a.center));
        const ra0 = roundRadius(x0, a), rb0 = roundRadius(x0, b);
        const mode = Math.abs(gap0 - (ra0 + rb0)) <= Math.abs(gap0 - Math.abs(ra0 - rb0)) ? 'external' : 'internal';
        pushResidual(constraint, 1, (x, out) => {
          const gap = Math.hypot(px(x, b.center) - px(x, a.center), py(x, b.center) - py(x, a.center));
          const ra = roundRadius(x, a), rb = roundRadius(x, b);
          out.push(gap - (mode === 'external' ? ra + rb : Math.abs(ra - rb)));
        });
      }
    } else if (kind === 'equal') {
      const a = byId.get(constraint.a), b = byId.get(constraint.b);
      if (a.kind === 'line') {
        pushResidual(constraint, 1, (x, out) => {
          const d1 = dir(x, a), d2 = dir(x, b);
          out.push((d1[0] * d1[0] + d1[1] * d1[1]) - (d2[0] * d2[0] + d2[1] * d2[1]));
        });
      } else {
        pushResidual(constraint, 1, (x, out) => out.push(roundRadius(x, a) - roundRadius(x, b)));
      }
    } else if (kind === 'concentric') {
      const a = byId.get(constraint.a), b = byId.get(constraint.b);
      pushResidual(constraint, 2, (x, out) => {
        out.push(px(x, a.center) - px(x, b.center), py(x, a.center) - py(x, b.center));
      });
    } else if (kind === 'midpoint') {
      const line = lineOf(constraint.line);
      pushResidual(constraint, 2, (x, out) => {
        out.push(px(x, constraint.point) - (px(x, line.a) + px(x, line.b)) / 2,
                 py(x, constraint.point) - (py(x, line.a) + py(x, line.b)) / 2);
      });
    } else if (kind === 'pointOnLine') {
      const line = lineOf(constraint.line);
      pushResidual(constraint, 1, (x, out) => {
        const d = dir(x, line);
        out.push((d[0] * (py(x, constraint.point) - py(x, line.a))
                - d[1] * (px(x, constraint.point) - px(x, line.a))) / norm(d));
      });
    } else if (kind === 'pointOnCircle') {
      const circle = byId.get(constraint.circle);
      pushResidual(constraint, 1, (x, out) => {
        out.push(Math.hypot(px(x, constraint.point) - px(x, circle.center),
                            py(x, constraint.point) - py(x, circle.center)) - roundRadius(x, circle));
      });
    } else if (kind === 'symmetric') {
      const axis = lineOf(constraint.axis);
      pushResidual(constraint, 2, (x, out) => {
        const ax = px(x, axis.a), ay = py(x, axis.a);
        const d = dir(x, axis); const len = norm(d);
        const ux = d[0] / len, uy = d[1] / len;
        const rel = [px(x, constraint.a) - ax, py(x, constraint.a) - ay];
        const along = rel[0] * ux + rel[1] * uy;
        const across = rel[0] * -uy + rel[1] * ux;
        const mx = ax + along * ux - across * -uy;
        const my = ay + along * uy - across * ux;
        out.push(mx - px(x, constraint.b), my - py(x, constraint.b));
      });
    } else if (kind === 'distance') {
      const value = resolve(constraint.value);
      pushResidual(constraint, 1, (x, out) => {
        out.push(Math.hypot(px(x, constraint.b) - px(x, constraint.a), py(x, constraint.b) - py(x, constraint.a)) - value);
      });
    } else if (kind === 'horizontalDistance') {
      const value = resolve(constraint.value);
      pushResidual(constraint, 1, (x, out) => out.push(px(x, constraint.b) - px(x, constraint.a) - value));
    } else if (kind === 'verticalDistance') {
      const value = resolve(constraint.value);
      pushResidual(constraint, 1, (x, out) => out.push(py(x, constraint.b) - py(x, constraint.a) - value));
    } else if (kind === 'length') {
      const line = lineOf(constraint.line);
      const value = resolve(constraint.value);
      pushResidual(constraint, 1, (x, out) => {
        const d = dir(x, line);
        out.push(Math.hypot(d[0], d[1]) - value);
      });
    } else if (kind === 'radius') {
      const circle = byId.get(constraint.circle);
      const value = resolve(constraint.value);
      pushResidual(constraint, 1, (x, out) => out.push(roundRadius(x, circle) - value));
    } else if (kind === 'angle') {
      const la = lineOf(constraint.a), lb = lineOf(constraint.b);
      const target = (resolve(constraint.value) * Math.PI) / 180;
      pushResidual(constraint, 1, (x, out) => {
        const d1 = dir(x, la), d2 = dir(x, lb);
        let delta = Math.atan2(d2[1], d2[0]) - Math.atan2(d1[1], d1[0]) - target;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta <= -Math.PI) delta += 2 * Math.PI;
        out.push(delta);
      });
    }
  }

  return { params, residuals, clusters, clusterOf, radii, px, py, byId, entities };
}

function evaluateResiduals(system, x) {
  const values = [];
  const spans = [];
  for (const residual of system.residuals) {
    const start = values.length;
    residual.evaluate(x, values);
    spans.push({ residual, start, end: values.length });
  }
  return { values, spans };
}

function numericJacobian(system, x, baseValues) {
  const n = x.length;
  const m = baseValues.length;
  const jacobian = new Array(m);
  for (let row = 0; row < m; row++) jacobian[row] = new Float64Array(n);
  const probe = x.slice();
  for (let col = 0; col < n; col++) {
    const h = 1e-7 * Math.max(1, Math.abs(x[col]));
    probe[col] = x[col] + h;
    const shifted = evaluateResiduals(system, probe).values;
    probe[col] = x[col];
    for (let row = 0; row < m; row++) jacobian[row][col] = (shifted[row] - baseValues[row]) / h;
  }
  return jacobian;
}

function solveNormalEquations(jtj, rhs) {
  // Cholesky with diagonal jitter fallback; deterministic.
  const n = rhs.length;
  const a = jtj.map((row) => row.slice());
  const b = rhs.slice();
  for (let attempt = 0; attempt < 4; attempt++) {
    const chol = a.map((row) => row.slice());
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = chol[i][j];
        for (let k = 0; k < j; k++) sum -= chol[i][k] * chol[j][k];
        if (i === j) {
          if (sum <= 0) { ok = false; break; }
          chol[i][i] = Math.sqrt(sum);
        } else {
          chol[i][j] = sum / chol[j][j];
        }
      }
    }
    if (ok) {
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let sum = b[i];
        for (let k = 0; k < i; k++) sum -= chol[i][k] * y[k];
        y[i] = sum / chol[i][i];
      }
      const out = new Float64Array(n);
      for (let i = n - 1; i >= 0; i--) {
        let sum = y[i];
        for (let k = i + 1; k < n; k++) sum -= chol[k][i] * out[k];
        out[i] = sum / chol[i][i];
      }
      return out;
    }
    for (let i = 0; i < n; i++) a[i][i] += 1e-10 * Math.pow(10, attempt);
  }
  return null;
}

function jacobianRank(jacobian, tolerance) {
  if (!jacobian.length) return 0;
  const rows = jacobian.map((row) => Array.from(row));
  const cols = rows[0].length;
  let rank = 0;
  let pivotRow = 0;
  for (let col = 0; col < cols && pivotRow < rows.length; col++) {
    let best = pivotRow;
    for (let row = pivotRow + 1; row < rows.length; row++) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[best][col])) best = row;
    }
    if (Math.abs(rows[best][col]) <= tolerance) continue;
    [rows[pivotRow], rows[best]] = [rows[best], rows[pivotRow]];
    const pivot = rows[pivotRow][col];
    for (let row = pivotRow + 1; row < rows.length; row++) {
      const factor = rows[row][col] / pivot;
      if (factor === 0) continue;
      for (let k = col; k < cols; k++) rows[row][k] -= factor * rows[pivotRow][k];
    }
    pivotRow++;
    rank++;
  }
  return rank;
}

export function solveSketch(sketch, options = {}) {
  const settings = { ...SOLVER_DEFAULTS, ...options };
  const structural = validateConstraintSketch(sketch);
  if (structural.length) return { status: 'invalid', diagnostics: structural };

  let system;
  try {
    system = buildSystem(sketch, settings);
  } catch (error) {
    if (error instanceof SketchSolveError) {
      return { status: 'invalid', diagnostics: [{ code: error.code, severity: 'error', message: error.message, ...error.meta }] };
    }
    throw error;
  }

  const x = Float64Array.from(system.params);
  const n = x.length;

  // Damped least squares. The damping term keeps every step minimal-norm,
  // which is what makes under-constrained sketches settle near their input
  // instead of drifting; no explicit prior is needed (a prior would bias the
  // converged solution away from exactly satisfying the constraints).
  let lambda = 1e-4;
  let iterations = 0;
  let evaluation = evaluateResiduals(system, x);
  const costOf = (values) => values.reduce((sum, v) => sum + v * v, 0);
  let cost = costOf(evaluation.values);

  while (iterations < settings.maxIterations) {
    const maxResidual = evaluation.values.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
    if (maxResidual < settings.tolerance) break;
    const jacobian = numericJacobian(system, x, evaluation.values);
    const m = evaluation.values.length;
    const jtj = [];
    const rhs = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      jtj.push(new Float64Array(n));
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let row = 0; row < m; row++) sum += jacobian[row][i] * jacobian[row][j];
        jtj[i][j] = sum;
      }
      let g = 0;
      for (let row = 0; row < m; row++) g += jacobian[row][i] * evaluation.values[row];
      rhs[i] = -g;
    }
    let accepted = false;
    for (let inner = 0; inner < 8 && !accepted; inner++) {
      // Marquardt scaling plus an absolute floor: parameters no constraint
      // touches get a well-conditioned identity block (and a zero gradient,
      // so they simply do not move).
      const damped = jtj.map((row, i) => {
        const copy = row.slice();
        copy[i] += lambda * copy[i] + lambda;
        return copy;
      });
      const step = solveNormalEquations(damped, rhs);
      if (!step) { lambda *= 4; continue; }
      const trial = x.slice();
      for (let i = 0; i < n; i++) trial[i] += step[i];
      const trialEval = evaluateResiduals(system, trial);
      const trialCost = costOf(trialEval.values);
      if (trialCost <= cost || trialCost < settings.tolerance * settings.tolerance) {
        x.set(trial);
        evaluation = trialEval;
        cost = trialCost;
        lambda = Math.max(lambda / 3, 1e-12);
        accepted = true;
      } else {
        lambda *= 4;
      }
    }
    iterations++;
    if (!accepted) break;
  }

  const maxResidual = evaluation.values.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
  const converged = maxResidual < Math.max(settings.tolerance, 1e-7);

  // DOF from the hard-constraint Jacobian at the solution.
  const jacobian = numericJacobian(system, x, evaluation.values);
  const rank = jacobianRank(jacobian, settings.rankTolerance);
  const dof = Math.max(0, n - rank);
  const redundant = evaluation.values.length > rank;

  const diagnostics = [];
  if (!converged) {
    const offenders = evaluation.spans
      .map(({ residual, start, end }) => ({
        constraint: residual.constraint,
        worst: evaluation.values.slice(start, end).reduce((max, v) => Math.max(max, Math.abs(v)), 0),
      }))
      .filter((entry) => entry.worst > Math.max(settings.tolerance, 1e-7))
      .sort((a, b) => b.worst - a.worst)
      .slice(0, 5);
    for (const offender of offenders) {
      diagnostics.push({
        code: 'CONSTRAINT_UNSATISFIED',
        severity: 'error',
        message: 'Constraint ' + (offender.constraint.id || offender.constraint.kind) + ' is off by ' + offender.worst.toPrecision(3) + ' — the sketch is over-constrained or conflicting.',
        constraintId: offender.constraint.id,
        constraintKind: offender.constraint.kind,
        residual: offender.worst,
      });
    }
  } else if (redundant) {
    diagnostics.push({
      code: 'CONSTRAINTS_REDUNDANT',
      severity: 'warning',
      message: 'The sketch solves, but ' + (evaluation.values.length - rank) + ' constraint equation(s) are redundant.',
    });
  }

  // Write solved coordinates back into entity copies.
  const solvedEntities = (sketch.entities || []).map((entity) => {
    if (entity.kind === 'point') {
      const cluster = system.clusters.get(system.clusterOf(entity.id));
      const sx = cluster.fixed ? cluster.x : x[cluster.index];
      const sy = cluster.fixed ? cluster.y : x[cluster.index + 1];
      return { ...entity, at: [roundTiny(sx), roundTiny(sy)] };
    }
    if (entity.kind === 'circle') {
      const slot = system.radii.get(entity.id);
      return { ...entity, solvedR: roundTiny(x[slot.index]) };
    }
    return { ...entity };
  });

  return {
    status: converged ? 'ok' : 'inconsistent',
    entities: solvedEntities,
    dof,
    rank,
    equations: evaluation.values.length,
    iterations,
    residual: maxResidual,
    diagnostics,
  };
}

function roundTiny(value) {
  const rounded = Math.round(value * 1e9) / 1e9;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function sketchDof(sketch, options = {}) {
  const solved = solveSketch(sketch, options);
  if (solved.status === 'invalid') return solved;
  return {
    status: solved.status,
    dof: solved.dof,
    rank: solved.rank,
    equations: solved.equations,
    fullyDefined: solved.status === 'ok' && solved.dof === 0,
    diagnostics: solved.diagnostics,
  };
}

// --- profile extraction ----------------------------------------------------

// Turns solved entities into closed loops the kernel can sweep: circles become
// standalone round loops; lines and arcs chain end-to-end (coincidence is by
// shared or coincident-merged point ids, never by distance tolerance).
export function constraintSketchToLoops(sketch, options = {}) {
  const solved = options.presolved || solveSketch(sketch, options);
  if (solved.status === 'invalid') return { status: 'invalid', loops: [], diagnostics: solved.diagnostics };
  const entities = solved.entities || [];
  const byId = new Map(entities.map((entity) => [entity.id, entity]));

  const parent = new Map();
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root);
    let cursor = id;
    while (cursor !== root) { const next = parent.get(cursor); parent.set(cursor, root); cursor = next; }
    return root;
  };
  for (const entity of entities) if (entity.kind === 'point') parent.set(entity.id, entity.id);
  for (const constraint of sketch.constraints || []) {
    if (constraint.kind !== 'coincident') continue;
    const ra = find(constraint.a); const rb = find(constraint.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const at = (pointId) => byId.get(pointId).at;

  const loops = [];
  const diagnostics = [];
  for (const entity of entities) {
    if (entity.kind === 'circle' && !entity.construction) {
      loops.push({ kind: 'circle', center: at(entity.center), r: entity.solvedR !== undefined ? entity.solvedR : entity.r });
    }
  }

  const segments = entities.filter((entity) => (entity.kind === 'line' || entity.kind === 'arc') && !entity.construction);
  const bySocket = new Map(); // cluster root -> [{segment, end: 'a'|'b'}]
  for (const segment of segments) {
    for (const end of ['a', 'b']) {
      const root = find(segment[end]);
      if (!bySocket.has(root)) bySocket.set(root, []);
      bySocket.get(root).push({ segment, end });
    }
  }
  const used = new Set();
  for (const segment of segments) {
    if (used.has(segment.id)) continue;
    const chain = [];
    let current = segment;
    let entrySocket = find(current.a);
    let guard = segments.length + 1;
    let closed = false;
    while (guard-- > 0) {
      used.add(current.id);
      const exitEnd = find(current.a) === entrySocket ? 'b' : 'a';
      chain.push({ segment: current, reversed: exitEnd === 'a' });
      const exitSocket = find(current[exitEnd]);
      if (chain.length > 1 || segments.length === 1) {
        if (exitSocket === find(chain[0].segment[chain[0].reversed ? 'b' : 'a'])) { closed = true; break; }
      }
      const next = (bySocket.get(exitSocket) || []).find((slot) => !used.has(slot.segment.id));
      if (!next) break;
      current = next.segment;
      entrySocket = exitSocket;
    }
    if (!closed) {
      diagnostics.push({
        code: 'PROFILE_OPEN',
        severity: 'error',
        message: 'Profile chain starting at "' + segment.id + '" does not close (' + chain.length + ' segment(s)).',
        entityId: segment.id,
      });
      continue;
    }
    const loopSegments = chain.map(({ segment: seg, reversed }) => {
      const a = at(reversed ? seg.b : seg.a);
      const b = at(reversed ? seg.a : seg.b);
      if (seg.kind === 'line') return { kind: 'line', a, b };
      const ccw = seg.ccw !== false;
      return {
        kind: 'arc', a, b,
        center: at(seg.center),
        ccw: reversed ? !ccw : ccw,
      };
    });
    loops.push({ kind: 'loop', segments: loopSegments });
  }

  return { status: diagnostics.length ? 'invalid' : 'ok', loops, diagnostics, solved };
}

export { SketchSolveError };
