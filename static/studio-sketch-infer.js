// Constraint inference for interactive sketching. Pure math, no DOM: the
// pointer tools feed placements through here and get back snapped positions
// plus the constraints a competent CAD sketcher would add automatically.
//
// Inference kinds:
//   - coincident: a placement within snapRadius of an existing point snaps
//     onto that point (returns its id instead of creating a duplicate).
//   - horizontal / vertical: a segment within snapAngleDeg of an axis snaps
//     onto it, and the matching constraint is recorded.
//
// The caller owns id allocation and entity insertion; this module only
// decides positions and constraint records so it stays trivially testable.

const DEFAULTS = Object.freeze({
  snapRadiusMm: 2.5,
  snapAngleDeg: 7,
});

export function nearestPoint(at, entities, snapRadiusMm = DEFAULTS.snapRadiusMm) {
  let best = null;
  for (const entity of entities || []) {
    if (entity.kind !== 'point') continue;
    const distance = Math.hypot(entity.at[0] - at[0], entity.at[1] - at[1]);
    if (distance <= snapRadiusMm && (!best || distance < best.distance)) {
      best = { pointId: entity.id, at: [entity.at[0], entity.at[1]], distance };
    }
  }
  return best;
}

export function axisSnap(from, to, snapAngleDeg = DEFAULTS.snapAngleDeg) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.hypot(dx, dy) < 1e-9) return { at: [to[0], to[1]], axis: null };
  const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
  const offHorizontal = Math.min(angle, 180 - angle);
  const offVertical = Math.abs(90 - angle);
  if (offHorizontal <= snapAngleDeg && offHorizontal <= offVertical) {
    return { at: [to[0], from[1]], axis: 'horizontal' };
  }
  if (offVertical <= snapAngleDeg) {
    return { at: [from[0], to[1]], axis: 'vertical' };
  }
  return { at: [to[0], to[1]], axis: null };
}

// One line-tool placement: given the chain's previous point (id or null for
// the first click) and the raw click position, produce the snapped position,
// whether it lands on an existing point, and the constraints to record.
export function inferLinePlacement(options) {
  const { sketch, fromPointId, at, snapRadiusMm = DEFAULTS.snapRadiusMm, snapAngleDeg = DEFAULTS.snapAngleDeg } = options;
  const entities = sketch?.entities || [];
  const from = fromPointId ? entities.find((entity) => entity.id === fromPointId) : null;
  let target = [at[0], at[1]];
  let axis = null;
  if (from) {
    const snapped = axisSnap(from.at, target, snapAngleDeg);
    target = snapped.at;
    axis = snapped.axis;
  }
  // Coincidence wins over axis snap: landing on an existing point reuses it
  // exactly (id-based connectivity, no tolerance welding later).
  const hit = nearestPoint(target, entities, snapRadiusMm);
  if (hit) {
    const constraints = [];
    if (from && axis) {
      // Keep the axis constraint only if the existing point actually lies on
      // the snapped axis; otherwise the coincidence decides the direction.
      const stillAxis = axis === 'horizontal'
        ? Math.abs(hit.at[1] - from.at[1]) <= 1e-9
        : Math.abs(hit.at[0] - from.at[0]) <= 1e-9;
      if (stillAxis) constraints.push({ kind: axis });
    }
    return { at: hit.at, coincidentWith: hit.pointId, axis: constraints.length ? axis : null, constraints };
  }
  return {
    at: target,
    coincidentWith: null,
    axis,
    constraints: axis ? [{ kind: axis }] : [],
  };
}

// Build a fully-defined axis-aligned rectangle from two corner picks. The
// first corner is fixed (anchoring the sketch), sides carry H/V constraints,
// and the two driving dimensions come from the actual drag, rounded to the
// grid so hand-drawn rectangles come out with round numbers.
export function constrainedRectangle(options) {
  const { corner, opposite, idPrefix = 'sk', gridMm = 1 } = options;
  const round = (value) => {
    const rounded = Math.round(value / gridMm) * gridMm;
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  const x0 = round(corner[0]), y0 = round(corner[1]);
  const x1 = round(opposite[0]), y1 = round(opposite[1]);
  const width = Math.abs(x1 - x0), height = Math.abs(y1 - y0);
  if (width < gridMm || height < gridMm) return null;
  const id = (suffix) => idPrefix + '-' + suffix;
  return {
    entities: [
      { id: id('p0'), kind: 'point', at: [x0, y0], fixed: true },
      { id: id('p1'), kind: 'point', at: [x1, y0] },
      { id: id('p2'), kind: 'point', at: [x1, y1] },
      { id: id('p3'), kind: 'point', at: [x0, y1] },
      { id: id('l0'), kind: 'line', a: id('p0'), b: id('p1') },
      { id: id('l1'), kind: 'line', a: id('p1'), b: id('p2') },
      { id: id('l2'), kind: 'line', a: id('p2'), b: id('p3') },
      { id: id('l3'), kind: 'line', a: id('p3'), b: id('p0') },
    ],
    constraints: [
      { kind: 'horizontal', line: id('l0') },
      { kind: 'vertical', line: id('l1') },
      { kind: 'horizontal', line: id('l2') },
      { kind: 'vertical', line: id('l3') },
      { id: id('width'), kind: 'length', line: id('l0'), value: width },
      { id: id('height'), kind: 'length', line: id('l1'), value: height },
    ],
  };
}

// A dimensioned circle from a centre pick and a radius pick.
export function constrainedCircle(options) {
  const { center, radiusPoint, idPrefix = 'sk', gridMm = 1 } = options;
  const round = (value) => {
    const rounded = Math.round(value / gridMm) * gridMm;
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  const radius = Math.max(gridMm, round(Math.hypot(radiusPoint[0] - center[0], radiusPoint[1] - center[1])));
  const id = (suffix) => idPrefix + '-' + suffix;
  return {
    entities: [
      { id: id('c'), kind: 'point', at: [round(center[0]), round(center[1])], fixed: true },
      { id: id('circle'), kind: 'circle', center: id('c'), r: radius },
    ],
    constraints: [
      { id: id('r'), kind: 'radius', circle: id('circle'), value: radius },
    ],
  };
}

export { DEFAULTS as SKETCH_INFER_DEFAULTS };
