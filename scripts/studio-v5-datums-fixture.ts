// Generic Slice 5B fixture: the names describe stations and bodies, but every
// result is authored through ordinary datum and transform document commands.

// @ts-expect-error Browser-native module intentionally has no TypeScript declarations.
import { createStudioV5Datum, createStudioV5TransformFeature } from '../static/studio-v5-runtime-document.js';
import { createThreeBodyRuntimeProject, RUNTIME_BODY_IDS } from './studio-v5-runtime-fixture.ts';

export const DATUM_IDS = Object.freeze({
  origin: 'datum-origin-point',
  xy: 'datum-origin-xy',
  yz: 'datum-origin-yz',
  zx: 'datum-origin-zx',
  xAxis: 'datum-origin-x',
  yAxis: 'datum-origin-y',
  zAxis: 'datum-origin-z',
  offsetAxis: 'datum-offset-z',
  coordinates: 'datum-origin-cs',
  rotatedCoordinates: 'datum-rotated-cs',
  station165: 'datum-station-165',
  station173: 'datum-station-173',
  angled: 'datum-angled-20',
  angledAboutOffsetAxis: 'datum-angled-offset-axis',
  mid: 'datum-mid-station',
  threePoint: 'datum-three-point',
  curveNormal: 'datum-curve-normal',
});

export const TRANSFORM_IDS = Object.freeze({
  moveHousing: 'transform-move-housing',
  rotateHousing: 'transform-rotate-housing',
  alignShaft: 'transform-align-shaft',
  mirrorTool: 'transform-mirror-tool',
  scaleMirror: 'transform-scale-tool-mirror',
});

export function addOriginDatums(input: any): any {
  let project = input;
  const datums = [
    { id: DATUM_IDS.origin, name: 'Origin', kind: 'point', definition: { mode: 'coordinates', coordinates: [0, 0, 0] } },
    { id: DATUM_IDS.xy, name: 'XY plane', kind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [0, 0, 1], xDirection: [1, 0, 0] } },
    { id: DATUM_IDS.yz, name: 'YZ plane', kind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [1, 0, 0], xDirection: [0, 1, 0] } },
    { id: DATUM_IDS.zx, name: 'ZX plane', kind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [0, 1, 0], xDirection: [0, 0, 1] } },
    { id: DATUM_IDS.xAxis, name: 'X axis', kind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [1, 0, 0] } },
    { id: DATUM_IDS.yAxis, name: 'Y axis', kind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [0, 1, 0] } },
    { id: DATUM_IDS.zAxis, name: 'Z axis', kind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [0, 0, 1] } },
    { id: DATUM_IDS.offsetAxis, name: 'Offset Z axis', kind: 'axis', definition: { mode: 'principal', origin: [0, 10, 0], direction: [0, 0, 1] } },
    { id: DATUM_IDS.coordinates, name: 'World coordinates', kind: 'coordinate-system', definition: { mode: 'principal', origin: [0, 0, 0], xDirection: [1, 0, 0], zDirection: [0, 0, 1] } },
    { id: DATUM_IDS.rotatedCoordinates, name: 'Rotated coordinates', kind: 'coordinate-system', definition: { mode: 'principal', origin: [100, 0, 0], xDirection: [0, 1, 0], zDirection: [1, 0, 0] } },
  ];
  for (const datum of datums) project = createStudioV5Datum(project, datum);
  return project;
}

export function createDatumTransformProject(options: { transforms?: boolean } = {}): any {
  let project = addOriginDatums(createThreeBodyRuntimeProject({ boolean: false, projectId: 'project-slice-5b-datums' }));
  project = createStudioV5Datum(project, {
    id: DATUM_IDS.station165, name: 'S40 HPC-1', kind: 'plane',
    definition: { mode: 'offset', referenceDatumId: DATUM_IDS.yz, offset: 165 },
  });
  project = createStudioV5Datum(project, {
    id: DATUM_IDS.station173, name: 'S40 HPC-1 shifted', kind: 'plane',
    definition: { mode: 'offset', referenceDatumId: DATUM_IDS.yz, offset: 173 },
  });
  project = createStudioV5Datum(project, {
    id: DATUM_IDS.angled, name: 'Blade tip twist', kind: 'plane',
    definition: { mode: 'angle', referenceDatumId: DATUM_IDS.yz, axisDatumId: DATUM_IDS.zAxis, angle: 20 },
  });
  project = createStudioV5Datum(project, {
    id: DATUM_IDS.angledAboutOffsetAxis, name: 'Angled about offset axis', kind: 'plane',
    definition: { mode: 'angle', referenceDatumId: DATUM_IDS.yz, axisDatumId: DATUM_IDS.offsetAxis, angle: 90 },
  });
  project = createStudioV5Datum(project, {
    id: DATUM_IDS.mid, name: 'HPC mid-plane', kind: 'plane',
    definition: { mode: 'midplane', firstDatumId: DATUM_IDS.station165, secondDatumId: DATUM_IDS.station173 },
  });
  project = createStudioV5Datum(project, {
    id: DATUM_IDS.threePoint, name: 'Three-point plane', kind: 'plane',
    definition: { mode: 'three-point', points: [[0, 0, 0], [0, 10, 0], [0, 0, 10]] },
  });
  project = createStudioV5Datum(project, {
    id: DATUM_IDS.curveNormal, name: 'Curve-normal plane', kind: 'plane',
    definition: { mode: 'curve-normal', pointDatumId: DATUM_IDS.origin, tangent: [1, 1, 0] },
  });
  if (options.transforms === false) return project;
  project = createStudioV5TransformFeature(project, {
    id: TRANSFORM_IDS.moveHousing, name: 'Move Housing', bodyId: RUNTIME_BODY_IDS.housing,
    mode: 'move', transform: { mode: 'move', translation: [25, 5, 0] }, moveOriginal: true,
  });
  project = createStudioV5TransformFeature(project, {
    id: TRANSFORM_IDS.rotateHousing, name: 'Rotate Housing', bodyId: RUNTIME_BODY_IDS.housing,
    mode: 'rotate', transform: { mode: 'rotate', axisDatumId: DATUM_IDS.zAxis, angle: 15 }, moveOriginal: true,
  });
  project = createStudioV5TransformFeature(project, {
    id: TRANSFORM_IDS.alignShaft, name: 'Align Shaft to S40', bodyId: RUNTIME_BODY_IDS.shaft,
    mode: 'align', transform: { mode: 'align', fromDatumId: DATUM_IDS.yz, toDatumId: DATUM_IDS.station165, offset: 0 }, moveOriginal: true,
  });
  project = createStudioV5TransformFeature(project, {
    id: TRANSFORM_IDS.mirrorTool, name: 'Mirror Tool', bodyId: RUNTIME_BODY_IDS.tool,
    mode: 'mirror', transform: { mode: 'mirror', planeDatumId: DATUM_IDS.station165 }, copy: true, linked: true,
    bodyName: 'Tool mirror', createdBodyId: 'body-tool-mirror',
  });
  project = createStudioV5TransformFeature(project, {
    id: TRANSFORM_IDS.scaleMirror, name: 'Scale Tool mirror', bodyId: 'body-tool-mirror',
    mode: 'scale', transform: { mode: 'scale', factor: 1.2, center: [0, 0, 0] }, moveOriginal: true,
  });
  return project;
}
