// Generic Slice 5C fixture. Every result is authored through ordinary datum,
// profile/path sketch, Loft, and Sweep document commands.

// @ts-expect-error Browser-native modules intentionally have no TypeScript declarations.
import { configureStudioV5Feature, createStudioV5Datum, createStudioV5LoftFeature, createStudioV5PathSketch, createStudioV5ProfileSketch, createStudioV5RevolveFeature, createStudioV5SweepFeature } from '../static/studio-v5-runtime-document.js';
import { createEmptyStudioV5PartProject } from '../static/studio-project-v5.js';

export const SHAPE_IDS = Object.freeze({
  rootPlane: 'datum-blade-root', midPlane: 'datum-blade-mid', tipPlane: 'datum-blade-tip',
  rootProfile: 'sketch-blade-root', midProfile: 'sketch-blade-mid', tipProfile: 'sketch-blade-tip',
  bladeLoft: 'feature-blade-loft', bladeBody: 'body-feature-blade-loft',
  inlet0: 'datum-inlet-0', inlet1: 'datum-inlet-1', inlet2: 'datum-inlet-2',
  inletProfile0: 'sketch-inlet-0', inletProfile1: 'sketch-inlet-1', inletProfile2: 'sketch-inlet-2',
  inletGuide: 'sketch-inlet-guide', inletCenterline: 'sketch-inlet-centerline',
  inletLoft: 'feature-inlet-loft', inletBody: 'body-feature-inlet-loft',
  sweepPlane: 'datum-sweep-profile', sweepProfile: 'sketch-sweep-profile', sweepPath: 'sketch-sweep-path',
  sweepFeature: 'feature-controlled-sweep', sweepBody: 'body-feature-controlled-sweep',
  modifierBoxFeature: 'feature-modifier-box', modifierBoxBody: 'body-feature-modifier-box',
  neutralPlane: 'datum-modifier-neutral-plane', revolvePlane: 'datum-revolve-profile-plane', revolveAxis: 'datum-revolve-axis',
  revolveProfile: 'sketch-revolve-profile', revolveFeature: 'feature-partial-revolve', revolveBody: 'body-feature-partial-revolve',
  draftFeature: 'feature-exact-draft', thickenFeature: 'feature-planar-thicken', thickenBody: 'body-feature-planar-thicken',
  variableFilletFeature: 'feature-variable-fillet',
});

const rotate = (points: number[][], degrees: number) => {
  const a = degrees * Math.PI / 180;
  return points.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
};

const airfoil = (chord: number, thickness: number) => [
  [0.50 * chord, 0], [0.30 * chord, 0.35 * thickness], [0, 0.50 * thickness], [-0.40 * chord, 0.22 * thickness],
  [-0.50 * chord, 0], [-0.40 * chord, -0.22 * thickness], [0, -0.50 * thickness], [0.30 * chord, -0.35 * thickness],
];

const circlePoints = (radius: number, offsetY = 0) => Array.from({ length: 12 }, (_, index) => {
  const angle = index * Math.PI * 2 / 12;
  return [offsetY + Math.cos(angle) * radius, Math.sin(angle) * radius];
});

export function createAdvancedShapeProject(): any {
  let project = createEmptyStudioV5PartProject({ projectId: 'project-slice-5c-shapes', name: 'Slice 5C generic advanced shapes', units: 'mm' });
  const planes = [
    { id: SHAPE_IDS.rootPlane, name: 'Blade root plane', origin: [0, 0, 0], xDirection: [0, 1, 0] },
    { id: SHAPE_IDS.midPlane, name: 'Blade mid plane', origin: [30, 0, 0], xDirection: [0, Math.cos(10 * Math.PI / 180), Math.sin(10 * Math.PI / 180)] },
    { id: SHAPE_IDS.tipPlane, name: 'Blade tip plane', origin: [60, 0, 0], xDirection: [0, Math.cos(20 * Math.PI / 180), Math.sin(20 * Math.PI / 180)] },
    { id: SHAPE_IDS.inlet0, name: 'Inlet section 0', origin: [0, 100, 0], xDirection: [0, 1, 0] },
    { id: SHAPE_IDS.inlet1, name: 'Inlet section 1', origin: [45, 100, 0], xDirection: [0, 1, 0] },
    { id: SHAPE_IDS.inlet2, name: 'Inlet section 2', origin: [90, 100, 0], xDirection: [0, 1, 0] },
    { id: SHAPE_IDS.sweepPlane, name: 'Sweep profile plane', origin: [0, -100, 0], xDirection: [0, 1, 0] },
  ];
  for (const plane of planes) {
    project = createStudioV5Datum(project, { id: plane.id, name: plane.name, kind: 'plane', definition: { mode: 'principal', origin: plane.origin, normal: [1, 0, 0], xDirection: plane.xDirection } });
  }
  project = createStudioV5ProfileSketch(project, { id: SHAPE_IDS.rootProfile, name: 'Blade root airfoil', planeDatumId: SHAPE_IDS.rootPlane, kind: 'spline', points: airfoil(50, 6) });
  project = createStudioV5ProfileSketch(project, { id: SHAPE_IDS.midProfile, name: 'Blade mid airfoil', planeDatumId: SHAPE_IDS.midPlane, kind: 'spline', points: airfoil(42, 5) });
  project = createStudioV5ProfileSketch(project, { id: SHAPE_IDS.tipProfile, name: 'Blade tip airfoil', planeDatumId: SHAPE_IDS.tipPlane, kind: 'spline', points: airfoil(35, 4) });
  project = createStudioV5LoftFeature(project, {
    id: SHAPE_IDS.bladeLoft, name: 'Three-section twisted blade',
    sections: [SHAPE_IDS.rootProfile, SHAPE_IDS.midProfile, SHAPE_IDS.tipProfile],
    continuity: { start: 'free', end: 'free' }, ruled: false, bodyName: 'Twisted blade',
  });

  project = createStudioV5ProfileSketch(project, { id: SHAPE_IDS.inletProfile0, name: 'Inlet root', planeDatumId: SHAPE_IDS.inlet0, kind: 'spline', points: circlePoints(18) });
  project = createStudioV5ProfileSketch(project, { id: SHAPE_IDS.inletProfile1, name: 'Inlet middle', planeDatumId: SHAPE_IDS.inlet1, kind: 'spline', points: circlePoints(24, 5) });
  project = createStudioV5ProfileSketch(project, { id: SHAPE_IDS.inletProfile2, name: 'Inlet exit', planeDatumId: SHAPE_IDS.inlet2, kind: 'spline', points: circlePoints(14, 10) });
  project = createStudioV5PathSketch(project, { id: SHAPE_IDS.inletGuide, name: 'Inlet guide rail', kind: 'spline', points: [[0, 118, 0], [45, 129, 0], [90, 124, 0]] });
  project = createStudioV5PathSketch(project, { id: SHAPE_IDS.inletCenterline, name: 'Inlet centreline', kind: 'spline', points: [[0, 100, 0], [45, 105, 0], [90, 110, 0]] });
  project = createStudioV5LoftFeature(project, {
    id: SHAPE_IDS.inletLoft, name: 'Guided inlet loft',
    sections: [SHAPE_IDS.inletProfile0, SHAPE_IDS.inletProfile1, SHAPE_IDS.inletProfile2],
    guideSketchIds: [SHAPE_IDS.inletGuide], centerlineSketchId: SHAPE_IDS.inletCenterline,
    bodyName: 'Guided inlet',
  });

  project = createStudioV5ProfileSketch(project, { id: SHAPE_IDS.sweepProfile, name: 'Sweep circular profile', planeDatumId: SHAPE_IDS.sweepPlane, kind: 'spline', points: circlePoints(7) });
  project = createStudioV5PathSketch(project, { id: SHAPE_IDS.sweepPath, name: 'Curved duct path', kind: 'spline', points: [[0, -100, 0], [35, -100, 0], [65, -82, 8], [95, -70, 20]] });
  project = createStudioV5SweepFeature(project, {
    id: SHAPE_IDS.sweepFeature, name: 'Controlled-twist tapered sweep',
    profileSketchId: SHAPE_IDS.sweepProfile, pathSketchId: SHAPE_IDS.sweepPath,
    orientation: 'controlled-twist', twistAngle: 35, scaleEnd: 0.65, transition: 'round', bodyName: 'Swept duct',
  });
  return project;
}

export function createAdvancedModifierBaseProject(): any {
  let project = createEmptyStudioV5PartProject({ projectId: 'project-slice-5c-modifiers', name: 'Slice 5C generic advanced modifiers', units: 'mm' });
  project = configureStudioV5Feature(project, {
    id: SHAPE_IDS.modifierBoxFeature, name: 'Modifier source box', type: 'extrude',
    sketch: { shapes: [{ kind: 'rect', x: 80, y: 0, w: 40, h: 30 }], z: 0 }, h: 20, through: false,
    resultPolicy: { kind: 'new-body', bodyName: 'Modifier source box' }, createdBodyId: SHAPE_IDS.modifierBoxBody,
  }, { resultPolicy: { kind: 'new-body', bodyName: 'Modifier source box' }, bodyName: 'Modifier source box' });
  project = createStudioV5Datum(project, {
    id: SHAPE_IDS.neutralPlane, name: 'Modifier neutral plane', kind: 'plane',
    definition: { mode: 'principal', origin: [0, 0, 0], normal: [0, 0, 1], xDirection: [1, 0, 0] },
  });
  project = createStudioV5Datum(project, {
    id: SHAPE_IDS.revolvePlane, name: 'Revolve profile plane', kind: 'plane',
    definition: { mode: 'principal', origin: [0, 0, 0], normal: [0, 1, 0], xDirection: [1, 0, 0] },
  });
  project = createStudioV5Datum(project, {
    id: SHAPE_IDS.revolveAxis, name: 'Revolve X axis', kind: 'axis',
    definition: { mode: 'principal', origin: [0, 0, 0], direction: [1, 0, 0] },
  });
  project = createStudioV5ProfileSketch(project, {
    id: SHAPE_IDS.revolveProfile, name: 'Partial revolve annulus profile', planeDatumId: SHAPE_IDS.revolvePlane, kind: 'polyline',
    points: [[0, -12], [20, -12], [20, -18], [0, -18]],
  });
  return createStudioV5RevolveFeature(project, {
    id: SHAPE_IDS.revolveFeature, name: 'Editable 180 degree revolve', profileSketchId: SHAPE_IDS.revolveProfile,
    axisDatumId: SHAPE_IDS.revolveAxis, angle: 180, startAngle: 15, bodyName: 'Partial revolve',
  });
}

export const ADVANCED_SHAPE_EDIT = Object.freeze({
  tipPoints: rotate(airfoil(32, 3.8), 0),
});
