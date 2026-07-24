// Deterministic checks for the constraint-based sketch solver. Pure math —
// no LLM, DOM, kernel, or pointer input; safe to run anywhere node runs.

// @ts-expect-error Browser-native module intentionally has no declarations.
import { SKETCH_CONSTRAINT_KINDS, constraintSketchToLoops, sketchDof, solveSketch, validateConstraintSketch } from '../static/studio-sketch-solver.js';

let passed = 0;
let failed = 0;

function check(name: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log('  PASS', name);
  } else {
    failed++;
    console.error('  FAIL', name, detail ?? '');
  }
}

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

function point(id: string, x: number, y: number, fixed = false) {
  return { id, kind: 'point', at: [x, y], ...(fixed ? { fixed: true } : {}) };
}
function line(id: string, a: string, b: string) {
  return { id, kind: 'line', a, b };
}

const pt = (solved: any, id: string) => solved.entities.find((e: any) => e.id === id).at;

// --- 1. Fully constrained rectangle ---------------------------------------

{
  // Four lines sharing corner points, drawn sloppily; constraints demand an
  // axis-aligned 40x25 rectangle anchored at the origin.
  const sketch = {
    entities: [
      point('p0', 1, 2, true),
      point('p1', 43, -1),
      point('p2', 39, 26),
      point('p3', -2, 24),
      line('l0', 'p0', 'p1'),
      line('l1', 'p1', 'p2'),
      line('l2', 'p2', 'p3'),
      line('l3', 'p3', 'p0'),
    ],
    constraints: [
      { kind: 'horizontal', line: 'l0' },
      { kind: 'vertical', line: 'l1' },
      { kind: 'horizontal', line: 'l2' },
      { kind: 'vertical', line: 'l3' },
      { kind: 'length', line: 'l0', value: 40 },
      { kind: 'length', line: 'l1', value: 25 },
    ],
    };
  const solved = solveSketch(sketch);
  check('rect: solves', solved.status === 'ok', solved);
  check('rect: fully defined (dof 0)', solved.dof === 0, solved.dof);
  check('rect: p1 lands at (41, 2)', near(pt(solved, 'p1')[0], 41) && near(pt(solved, 'p1')[1], 2), pt(solved, 'p1'));
  check('rect: p2 lands at (41, 27)', near(pt(solved, 'p2')[0], 41) && near(pt(solved, 'p2')[1], 27), pt(solved, 'p2'));
  check('rect: fixed corner stays put', near(pt(solved, 'p0')[0], 1) && near(pt(solved, 'p0')[1], 2), pt(solved, 'p0'));

  const loops = constraintSketchToLoops(sketch);
  check('rect: one closed loop', loops.status === 'ok' && loops.loops.length === 1, loops.diagnostics);
  check('rect: loop has 4 line segments', loops.loops[0].segments.length === 4, loops.loops[0]);
}

// --- 2. Under-constrained sketch stays near its input ----------------------

{
  const sketch = {
    entities: [point('a', 10, 10), point('b', 30, 12), line('l', 'a', 'b')],
    constraints: [{ kind: 'horizontal', line: 'l' }],
  };
  const solved = solveSketch(sketch);
  check('under: solves', solved.status === 'ok', solved);
  check('under: reports remaining dof', solved.dof === 3, solved.dof);
  const a = pt(solved, 'a');
  const b = pt(solved, 'b');
  check('under: line became horizontal', near(a[1], b[1], 1e-6), [a, b]);
  check('under: points stayed near input', Math.abs(a[0] - 10) < 2 && Math.abs(b[0] - 30) < 2, [a, b]);
  const dof = sketchDof(sketch);
  check('under: sketchDof agrees', dof.status === 'ok' && dof.dof === 3 && dof.fullyDefined === false, dof);
}

// --- 3. Conflicting constraints are named ----------------------------------

{
  const sketch = {
    entities: [point('a', 0, 0, true), point('b', 30, 0), line('l', 'a', 'b')],
    constraints: [
      { id: 'len30', kind: 'length', line: 'l', value: 30 },
      { id: 'len40', kind: 'length', line: 'l', value: 40 },
    ],
  };
  const solved = solveSketch(sketch);
  check('conflict: reported inconsistent', solved.status === 'inconsistent', solved.status);
  check('conflict: diagnostics name a length constraint',
    solved.diagnostics.some((d: any) => d.code === 'CONSTRAINT_UNSATISFIED' && /len(30|40)/.test(String(d.constraintId))),
    solved.diagnostics);
}

// --- 4. Tangency: line tangent to a dimensioned circle ---------------------

{
  const sketch = {
    entities: [
      point('c', 0, 0, true),
      { id: 'circ', kind: 'circle', center: 'c', r: 8 },
      point('a', -20, 11),
      point('b', 20, 9),
      line('l', 'a', 'b'),
    ],
    constraints: [
      { kind: 'horizontal', line: 'l' },
      { kind: 'radius', circle: 'circ', value: 10 },
      { id: 'tan', kind: 'tangent', a: 'l', b: 'circ' },
    ],
  };
  const solved = solveSketch(sketch);
  check('tangent: solves', solved.status === 'ok', solved);
  const circle = solved.entities.find((e: any) => e.id === 'circ');
  check('tangent: radius driven to 10', near(circle.solvedR, 10), circle.solvedR);
  check('tangent: line sits at y=10', near(pt(solved, 'a')[1], 10, 1e-5) && near(pt(solved, 'b')[1], 10, 1e-5),
    [pt(solved, 'a'), pt(solved, 'b')]);
}

// --- 5. Expressions resolve through the caller's evaluator -----------------

{
  const params: Record<string, number> = { wall: 6, size: 48 };
  const resolveDimension = (value: number | string) => {
    if (typeof value === 'number') return value;
    if (String(value) === 'wall*2') return params.wall * 2;
    if (String(value) === 'size') return params.size;
    throw new Error('unknown expression ' + value);
  };
  const sketch = {
    entities: [point('a', 0, 0, true), point('b', 40, 3), line('l', 'a', 'b')],
    constraints: [
      { kind: 'horizontal', line: 'l' },
      { kind: 'length', line: 'l', value: 'size' },
    ],
  };
  const solved = solveSketch(sketch, { resolveDimension });
  check('expr: solves with resolver', solved.status === 'ok', solved);
  check('expr: length follows parameter', near(Math.abs(pt(solved, 'b')[0]), 48, 1e-6), pt(solved, 'b'));
  const noResolver = solveSketch(sketch);
  check('expr: without resolver reports invalid', noResolver.status === 'invalid', noResolver.status);
  check('expr: resolver failure is diagnosed not thrown',
    noResolver.diagnostics.every((d: any) => typeof d.message === 'string'), noResolver.diagnostics);
}

// --- 6. Angle constraint ----------------------------------------------------

{
  const sketch = {
    entities: [
      point('o', 0, 0, true),
      point('x', 30, 0),
      point('d', 20, 4),
      line('base', 'o', 'x'),
      line('ray', 'o', 'd'),
    ],
    constraints: [
      { kind: 'horizontal', line: 'base' },
      { kind: 'length', line: 'base', value: 30 },
      { kind: 'length', line: 'ray', value: 20 },
      { kind: 'angle', a: 'base', b: 'ray', value: 45 },
    ],
  };
  const solved = solveSketch(sketch);
  check('angle: solves', solved.status === 'ok', solved);
  const d = pt(solved, 'd');
  check('angle: ray endpoint at 45 degrees', near(d[0], 20 * Math.SQRT1_2, 1e-5) && near(d[1], 20 * Math.SQRT1_2, 1e-5), d);
}

// --- 7. Symmetric + midpoint ------------------------------------------------

{
  const sketch = {
    entities: [
      point('a0', 0, -20, true),
      point('a1', 0, 20, true),
      line('axis', 'a0', 'a1'),
      point('l', -14, 3),
      point('r', 15, 5),
      point('m', 2, 2),
      line('span', 'l', 'r'),
    ],
    constraints: [
      { kind: 'symmetric', a: 'l', b: 'r', axis: 'axis' },
      { kind: 'midpoint', point: 'm', line: 'span' },
      { kind: 'horizontalDistance', a: 'l', b: 'r', value: 30 },
      { kind: 'verticalDistance', a: 'a0', b: 'l', value: 24 },
    ],
  };
  const solved = solveSketch(sketch);
  check('symmetric: solves', solved.status === 'ok', solved);
  const l = pt(solved, 'l'); const r = pt(solved, 'r'); const m = pt(solved, 'm');
  check('symmetric: mirrored about x=0', near(l[0], -15, 1e-5) && near(r[0], 15, 1e-5), [l, r]);
  check('symmetric: same height', near(l[1], r[1], 1e-6) && near(l[1], 4, 1e-5), [l, r]);
  check('symmetric: midpoint centered on axis', near(m[0], 0, 1e-5) && near(m[1], 4, 1e-5), m);
}

// --- 8. Rounded-slot profile: lines + arcs chain into one closed loop -------

{
  const sketch = {
    entities: [
      point('cl', -15, 0, true),
      point('cr', 15, 0, true),
      point('tl', -15, 6), point('tr', 15, 6),
      point('bl', -15, -6), point('br', 15, -6),
      line('top', 'tl', 'tr'),
      { id: 'capR', kind: 'arc', center: 'cr', a: 'tr', b: 'br', ccw: false },
      line('bottom', 'br', 'bl'),
      { id: 'capL', kind: 'arc', center: 'cl', a: 'bl', b: 'tl', ccw: false },
    ],
    constraints: [
      { kind: 'horizontal', line: 'top' },
      { kind: 'horizontal', line: 'bottom' },
      { id: 'slotR', kind: 'radius', circle: 'capR', value: 6 },
      { kind: 'equal', a: 'capL', b: 'capR' },
      { kind: 'verticalDistance', a: 'cr', b: 'tr', value: 6 },
      { kind: 'verticalDistance', a: 'br', b: 'cr', value: 6 },
      { kind: 'verticalDistance', a: 'cl', b: 'tl', value: 6 },
      { kind: 'verticalDistance', a: 'bl', b: 'cl', value: 6 },
      { kind: 'vertical', a: 'cr', b: 'tr' },
      { kind: 'vertical', a: 'cr', b: 'br' },
      { kind: 'vertical', a: 'cl', b: 'tl' },
      { kind: 'vertical', a: 'cl', b: 'bl' },
    ],
  };
  const solved = solveSketch(sketch);
  check('slot: solves', solved.status === 'ok', solved);
  check('slot: arc endpoints on radius', near(pt(solved, 'tr')[1], 6, 1e-5), pt(solved, 'tr'));
  const loops = constraintSketchToLoops(sketch);
  check('slot: closes into one loop', loops.status === 'ok' && loops.loops.length === 1, loops.diagnostics);
  const kinds = loops.status === 'ok' ? loops.loops[0].segments.map((s: any) => s.kind).sort().join(',') : '';
  check('slot: loop is 2 lines + 2 arcs', kinds === 'arc,arc,line,line', kinds);
}

// --- 9. Open profile is diagnosed, circles are standalone loops -------------

{
  const sketch = {
    entities: [
      point('a', 0, 0), point('b', 10, 0), point('c', 10, 10),
      line('l0', 'a', 'b'), line('l1', 'b', 'c'),
      point('cc', 40, 40),
      { id: 'hole', kind: 'circle', center: 'cc', r: 3 },
    ],
    constraints: [],
  };
  const loops = constraintSketchToLoops(sketch);
  check('open: reported invalid', loops.status === 'invalid', loops.status);
  check('open: diagnostic names the chain', loops.diagnostics.some((d: any) => d.code === 'PROFILE_OPEN'), loops.diagnostics);
  check('open: circle still extracted as loop', loops.loops.some((l: any) => l.kind === 'circle'), loops.loops);
}

// --- 10. Coincident merging + concentric + equal radii ----------------------

{
  const sketch = {
    entities: [
      point('c1', 0, 0, true),
      point('c2', 0.5, -0.5),
      { id: 'inner', kind: 'circle', center: 'c1', r: 5 },
      { id: 'outer', kind: 'circle', center: 'c2', r: 9 },
    ],
    constraints: [
      { kind: 'concentric', a: 'inner', b: 'outer' },
      { kind: 'radius', circle: 'inner', value: 5 },
      { kind: 'distance', a: 'c1', b: 'c2', value: 0 },
    ],
  };
  const solved = solveSketch(sketch);
  check('concentric: solves', solved.status === 'ok', solved);
  check('concentric: centers merged', near(pt(solved, 'c2')[0], 0, 1e-6) && near(pt(solved, 'c2')[1], 0, 1e-6), pt(solved, 'c2'));
}

// --- 11. Validation catches structural problems -----------------------------

{
  const diagnostics = validateConstraintSketch({
    entities: [
      point('p', 0, 0),
      point('p', 1, 1),
      { id: 'l', kind: 'line', a: 'p', b: 'missing' },
      { id: 'weird', kind: 'blob' },
    ],
    constraints: [
      { kind: 'nonsense', a: 'p', b: 'p' },
      { kind: 'radius', circle: 'l', value: 5 },
      { kind: 'length', line: 'l' },
    ],
  });
  const codes = new Set(diagnostics.map((d: any) => d.code));
  check('validate: duplicate id', codes.has('ENTITY_ID_DUPLICATE'), [...codes]);
  check('validate: missing ref', codes.has('REF_MISSING'), [...codes]);
  check('validate: unknown entity kind', codes.has('ENTITY_KIND_UNKNOWN'), [...codes]);
  check('validate: unknown constraint kind', codes.has('CONSTRAINT_KIND_UNKNOWN'), [...codes]);
  check('validate: wrong ref kind', codes.has('REF_KIND'), [...codes]);
  check('validate: missing dimension value', codes.has('DIMENSION_INVALID'), [...codes]);
}

// --- 12. Determinism --------------------------------------------------------

{
  const sketch = {
    entities: [
      point('p0', 0.3, 1.7, true), point('p1', 41, 0.2), point('p2', 40, 24), point('p3', 0.5, 25),
      line('l0', 'p0', 'p1'), line('l1', 'p1', 'p2'), line('l2', 'p2', 'p3'), line('l3', 'p3', 'p0'),
    ],
    constraints: [
      { kind: 'horizontal', line: 'l0' }, { kind: 'vertical', line: 'l1' },
      { kind: 'parallel', a: 'l2', b: 'l0' }, { kind: 'parallel', a: 'l3', b: 'l1' },
      { kind: 'length', line: 'l0', value: 40 }, { kind: 'length', line: 'l1', value: 25 },
    ],
  };
  const one = JSON.stringify(solveSketch(sketch));
  const two = JSON.stringify(solveSketch(sketch));
  check('determinism: identical output', one === two);
}

// --- 13. Performance guard --------------------------------------------------

{
  // A 60-segment closed polyline chain with parallel/length constraints:
  // representative of a busy production sketch.
  const entities: any[] = [];
  const constraints: any[] = [];
  const n = 60;
  for (let i = 0; i < n; i++) {
    // Deterministically perturbed ring so the solver has real work to do.
    const angle = (i / n) * 2 * Math.PI;
    const wobble = 1 + 0.08 * Math.sin(i * 7);
    entities.push(point('p' + i, 30 * wobble * Math.cos(angle), 30 * wobble * Math.sin(angle), i === 0));
  }
  for (let i = 0; i < n; i++) {
    entities.push(line('s' + i, 'p' + i, 'p' + ((i + 1) % n)));
    if (i % 3 === 0) constraints.push({ kind: 'length', line: 's' + i, value: 30 * 2 * Math.sin(Math.PI / n) });
  }
  const startedAt = process.hrtime.bigint();
  const solved = solveSketch({ entities, constraints });
  const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
  check('perf: 60-segment sketch solves', solved.status === 'ok', solved.status);
  check('perf: under 1500ms', ms < 1500, ms.toFixed(1) + 'ms');
  console.log('  info: 60-segment solve took ' + ms.toFixed(1) + 'ms, ' + solved.iterations + ' iterations');
}

// --- 14. Constraint vocabulary is stable ------------------------------------

{
  const expected = [
    'coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'tangent',
    'equal', 'concentric', 'midpoint', 'pointOnLine', 'pointOnCircle', 'symmetric',
    'distance', 'horizontalDistance', 'verticalDistance', 'length', 'radius', 'angle',
  ];
  check('vocabulary: all expected kinds present',
    expected.every((kind) => SKETCH_CONSTRAINT_KINDS.includes(kind)),
    SKETCH_CONSTRAINT_KINDS);
}

// --- 15. End to end: constrained sketches through the agent service ---------

// @ts-expect-error Browser-native module intentionally has no declarations.
const { CadCommandService } = await import('../static/studio-agent-service.js');
const { createEmptyStudioV5PartProject } = await import('../static/studio-project-v5.js');

const editScope = (projectId: string) => ({ granted: ['project.read', 'project.edit'], projectIds: [projectId] });

function constrainedRect(widthValue: number | string, heightValue: number | string) {
  return {
    entities: [
      point('p0', 0, 0, true), point('p1', 30, 2), point('p2', 31, 20), point('p3', -1, 21),
      line('l0', 'p0', 'p1'), line('l1', 'p1', 'p2'), line('l2', 'p2', 'p3'), line('l3', 'p3', 'p0'),
    ],
    constraints: [
      { kind: 'horizontal', line: 'l0' }, { kind: 'vertical', line: 'l1' },
      { kind: 'horizontal', line: 'l2' }, { kind: 'vertical', line: 'l3' },
      { id: 'dim-w', kind: 'length', line: 'l0', value: widthValue },
      { id: 'dim-h', kind: 'length', line: 'l1', value: heightValue },
    ],
  };
}

{
  const service = new CadCommandService({ project: createEmptyStudioV5PartProject({ projectId: 'project-sketch-solver', name: 'Solver check', units: 'mm' }) });
  const scope = editScope('project-sketch-solver');
  const preview = await service.preview({
    transactionId: 'tx-constrained-extrude', label: 'Constrained base plate', atomic: true, expectedRevision: 0,
    operations: [
      { kind: 'parameter.create', input: { id: 'parameter-width', name: 'width', value: 40 } },
      {
        kind: 'feature.extrude',
        input: {
          id: 'feature-plate', name: 'Plate',
          sketch: { constrained: constrainedRect('width', 25), z: 0 },
          height: 10, bodyName: 'Plate',
        },
      },
    ],
  }, scope);
  await service.commit(preview.previewId, 0, scope);
  const snapshot = service.snapshot();
  const part = snapshot.partDefinitions[0];
  const feature = part.features.find((entry: any) => entry.id === 'feature-plate');
  check('e2e: committed feature keeps its constrained source', !!feature?.sketch?.constrained, feature?.sketch && Object.keys(feature.sketch));
  check('e2e: solver emitted exact kernel entities', feature.extensions?.exactSketchEntities === true
    && Array.isArray(feature.sketch.entities)
    && feature.sketch.entities.filter((entity: any) => entity.kind === 'line').length === 4,
    feature.sketch.entities);
  check('e2e: solver emitted legacy shapes for display', Array.isArray(feature.sketch.shapes) && feature.sketch.shapes[0]?.kind === 'poly', feature.sketch.shapes);
  check('e2e: sketch reports fully defined', feature.sketch.solver?.fullyDefined === true, feature.sketch.solver);
  const spanOf = (entities: any[]) => {
    const xs = entities.filter((entity: any) => entity.kind === 'line').flatMap((entity: any) => [entity.a[0], entity.b[0]]);
    return Math.max(...xs) - Math.min(...xs);
  };
  check('e2e: geometry follows the width parameter (40)', near(spanOf(feature.sketch.entities), 40, 1e-6), spanOf(feature.sketch.entities));

  const editPreview = await service.preview({
    transactionId: 'tx-widen', label: 'Widen plate', atomic: true, expectedRevision: 1,
    operations: [{ kind: 'parameter.update', input: { parameterId: 'parameter-width', value: 60 } }],
  }, scope);
  await service.commit(editPreview.previewId, 1, scope);
  const widened = service.snapshot().partDefinitions[0].features.find((entry: any) => entry.id === 'feature-plate');
  check('e2e: parameter edit re-solved the constrained sketch (60)', near(spanOf(widened.sketch.entities), 60, 1e-6), spanOf(widened.sketch.entities));

  let conflictCode = '';
  try {
    await service.preview({
      transactionId: 'tx-conflict', label: 'Conflicting sketch', atomic: true, expectedRevision: 2,
      operations: [{
        kind: 'feature.extrude',
        input: {
          id: 'feature-bad', name: 'Bad',
          sketch: {
            constrained: {
              entities: [point('a', 0, 0, true), point('b', 30, 0), line('l', 'a', 'b')],
              constraints: [
                { id: 'len30', kind: 'length', line: 'l', value: 30 },
                { id: 'len40', kind: 'length', line: 'l', value: 40 },
              ],
            },
            z: 0,
          },
          height: 5,
        },
      }],
    }, scope);
  } catch (error: any) {
    conflictCode = error?.code || '';
  }
  check('e2e: conflicting constraints reject the transaction', conflictCode === 'SKETCH_CONSTRAINTS_UNSOLVED', conflictCode);

  const solveQuery = await service.query({
    kind: 'sketch.solve',
    sketch: constrainedRect('width', 25),
  });
  check('e2e: sketch.solve query returns solved loops', solveQuery.status === 'ok' && solveQuery.fullyDefined === true
    && solveQuery.profilesClosed === true && solveQuery.loops.length === 1, solveQuery.status);
  check('e2e: sketch.solve resolves document parameters (width=60)',
    near(spanOf(solveQuery.loops[0].segments.map((segment: any, index: number) => ({ kind: 'line', a: segment.a, b: segment.b, id: 's' + index }))), 60, 1e-6),
    solveQuery.loops[0]);

  const openProfile = await service.query({
    kind: 'sketch.solve',
    sketch: { entities: [point('a', 0, 0), point('b', 10, 0), line('l', 'a', 'b')], constraints: [] },
  });
  check('e2e: sketch.solve flags open profiles', openProfile.profilesClosed === false
    && openProfile.diagnostics.some((d: any) => d.code === 'PROFILE_OPEN'), openProfile.diagnostics);
}

console.log('');
if (failed > 0) {
  console.error('studio-sketch-solver-check: ' + failed + ' of ' + (passed + failed) + ' checks FAILED');
  process.exit(1);
}
console.log('all ' + passed + ' sketch solver checks passed');
