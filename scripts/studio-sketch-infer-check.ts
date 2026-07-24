// Deterministic checks for sketch constraint inference. Pure math, no DOM.

// @ts-expect-error Browser-native module intentionally has no declarations.
import { axisSnap, constrainedCircle, constrainedRectangle, inferLinePlacement, nearestPoint } from '../static/studio-sketch-infer.js';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { solveSketch, constraintSketchToLoops } from '../static/studio-sketch-solver.js';

let passed = 0;
let failed = 0;
function check(name: string, condition: unknown, detail?: unknown): void {
  if (condition) { passed++; console.log('  PASS', name); }
  else { failed++; console.error('  FAIL', name, detail ?? ''); }
}
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

// --- axis snap --------------------------------------------------------------
{
  const flat = axisSnap([0, 0], [30, 2.1]);
  check('axis: near-horizontal snaps flat', flat.axis === 'horizontal' && near(flat.at[1], 0), flat);
  const upright = axisSnap([10, 10], [10.8, 34]);
  check('axis: near-vertical snaps upright', upright.axis === 'vertical' && near(upright.at[0], 10), upright);
  const diagonal = axisSnap([0, 0], [20, 15]);
  check('axis: a true diagonal is left alone', diagonal.axis === null && near(diagonal.at[0], 20) && near(diagonal.at[1], 15), diagonal);
}

// --- point snap -------------------------------------------------------------
{
  const entities = [
    { id: 'a', kind: 'point', at: [0, 0] },
    { id: 'b', kind: 'point', at: [40, 0] },
  ];
  const hit = nearestPoint([39.2, 0.9], entities);
  check('snap: lands on the nearest existing point', hit?.pointId === 'b', hit);
  check('snap: far placements create nothing', nearestPoint([20, 20], entities) === null);
}

// --- line placement inference ----------------------------------------------
{
  const sketch = {
    entities: [
      { id: 'p0', kind: 'point', at: [0, 0] },
      { id: 'p1', kind: 'point', at: [40, 0] },
      { id: 'l0', kind: 'line', a: 'p0', b: 'p1' },
    ],
    constraints: [],
  };
  const chained = inferLinePlacement({ sketch, fromPointId: 'p1', at: [40.6, 24] });
  check('line: vertical chain placement snaps and constrains',
    chained.axis === 'vertical' && near(chained.at[0], 40) && chained.constraints[0]?.kind === 'vertical', chained);
  const closing = inferLinePlacement({ sketch, fromPointId: 'p1', at: [0.8, 0.4] });
  check('line: closing click reuses the first point by id', closing.coincidentWith === 'p0' && near(closing.at[0], 0) && near(closing.at[1], 0), closing);
  check('line: coincidence keeps a still-valid axis constraint', closing.constraints.some((c: any) => c.kind === 'horizontal'), closing);
}

// --- rectangle recipe solves fully defined ---------------------------------
{
  const rect = constrainedRectangle({ corner: [1.2, 0.7], opposite: [41.4, 25.6], idPrefix: 'r' });
  check('rect: built from rounded picks', rect !== null, rect);
  const solved = solveSketch(rect);
  check('rect: solves fully defined immediately', solved.status === 'ok' && solved.dof === 0, { status: solved.status, dof: solved.dof });
  const loops = constraintSketchToLoops(rect, { presolved: solved });
  check('rect: forms one closed loop', loops.status === 'ok' && loops.loops.length === 1, loops.diagnostics);
  const width = rect.constraints.find((c: any) => c.id === 'r-width');
  check('rect: width dimension is the rounded drag distance', width?.value === 40, width);
  check('rect: degenerate drags are rejected', constrainedRectangle({ corner: [0, 0], opposite: [0.3, 8] }) === null);
}

// --- circle recipe ----------------------------------------------------------
{
  const circle = constrainedCircle({ center: [10.2, 9.8], radiusPoint: [16.1, 9.8], idPrefix: 'c' });
  const solved = solveSketch(circle);
  check('circle: solves fully defined', solved.status === 'ok' && solved.dof === 0, { status: solved.status, dof: solved.dof });
  const radius = circle.constraints.find((c: any) => c.id === 'c-r');
  check('circle: radius dimension is the rounded pick distance', radius?.value === 6, radius);
}

console.log('');
if (failed > 0) {
  console.error('studio-sketch-infer-check: ' + failed + ' of ' + (passed + failed) + ' checks FAILED');
  process.exit(1);
}
console.log('all ' + passed + ' sketch inference checks passed');
