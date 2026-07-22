// Slice 5D fixture: one ordinary editable Loft body drives linked exact
// occurrences. The generated blades are runtime results, never copied feature
// histories or serialized body definitions.

// @ts-expect-error Browser-native modules intentionally have no TypeScript declarations.
import { createStudioV5BodyPattern, createStudioV5Datum, createStudioV5TransformFeature } from '../static/studio-v5-runtime-document.js';
import { createAdvancedShapeProject, SHAPE_IDS } from './studio-v5-shapes-fixture.ts';

export const PATTERN_IDS = Object.freeze({
  axis: 'datum-fan-axis',
  direction2: 'datum-pattern-direction-y',
  radialMove: 'feature-blade-radial-position',
  pattern: 'pattern-fan-blades',
});

export function createPatternSourceProject(): any {
  let project = createAdvancedShapeProject();
  project.projectId = 'project-slice-5d-patterns';
  project.name = 'Slice 5D linked exact patterns';
  project = createStudioV5Datum(project, {
    id: PATTERN_IDS.axis,
    name: 'Fan axis',
    kind: 'axis',
    definition: { mode: 'principal', origin: [0, 0, 0], direction: [1, 0, 0] },
  });
  project = createStudioV5Datum(project, {
    id: PATTERN_IDS.direction2,
    name: 'Pattern Y direction',
    kind: 'axis',
    definition: { mode: 'principal', origin: [0, 0, 0], direction: [0, 1, 0] },
  });
  project = createStudioV5TransformFeature(project, {
    id: PATTERN_IDS.radialMove,
    name: 'Position source blade radially',
    bodyId: SHAPE_IDS.bladeBody,
    mode: 'move',
    transform: { mode: 'translate', translation: [0, 55, 0] },
    moveOriginal: true,
  });
  return project;
}

export function createEditablePatternProject(): any {
  return createStudioV5BodyPattern(createPatternSourceProject(), {
    id: PATTERN_IDS.pattern,
    name: 'Editable fan blade pattern',
    kind: 'circular',
    sourceBodyId: SHAPE_IDS.bladeBody,
    axisDatumId: PATTERN_IDS.axis,
    count: 12,
    distribution: 'full',
    orientation: 'rotate',
  });
}

export const patternInstanceId = (index: number) => `${PATTERN_IDS.pattern}-instance-${index}`;
