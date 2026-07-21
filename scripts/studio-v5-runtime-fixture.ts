import { createEmptyStudioV5PartProject } from '../static/studio-project-v5.js';
// @ts-expect-error Browser-native module intentionally has no TypeScript declarations.
import { configureStudioV5Feature, createStudioV5BooleanFeature } from '../static/studio-v5-runtime-document.js';

export const RUNTIME_BODY_IDS = Object.freeze({
  housing: 'body-feature-housing',
  shaft: 'body-feature-shaft',
  tool: 'body-feature-tool',
});

export const RUNTIME_FEATURE_IDS = Object.freeze({
  housing: 'feature-housing',
  shaft: 'feature-shaft',
  tool: 'feature-tool',
  boolean: 'feature-housing-tool-subtract',
});

function bodyFeature(id: string, name: string, shape: Record<string, unknown>, height: number) {
  return {
    id,
    name: `${name} extrude`,
    type: 'extrude',
    sketch: { shapes: [shape], z: 0 },
    h: height,
    through: false,
    resultPolicy: { kind: 'new-body', bodyName: name },
    createdBodyId: `body-${id}`,
  };
}

export function createThreeBodyRuntimeProject(options: { boolean?: boolean; projectId?: string } = {}) {
  let project = createEmptyStudioV5PartProject({
    projectId: options.projectId || 'project-slice-5a-runtime',
    name: 'Slice 5A runtime fixture',
    units: 'mm',
  });
  project = configureStudioV5Feature(
    project,
    bodyFeature(RUNTIME_FEATURE_IDS.housing, 'Housing', { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }, 20),
    { resultPolicy: { kind: 'new-body', bodyName: 'Housing' }, bodyName: 'Housing' },
  );
  project = configureStudioV5Feature(
    project,
    bodyFeature(RUNTIME_FEATURE_IDS.shaft, 'Shaft', { kind: 'rect', x: 60, y: 0, w: 10, h: 10 }, 20),
    { resultPolicy: { kind: 'new-body', bodyName: 'Shaft' }, bodyName: 'Shaft' },
  );
  project = configureStudioV5Feature(
    project,
    bodyFeature(RUNTIME_FEATURE_IDS.tool, 'Tool', { kind: 'circle', x: 0, y: 0, r: 5 }, 20),
    { resultPolicy: { kind: 'new-body', bodyName: 'Tool' }, bodyName: 'Tool' },
  );
  if (options.boolean !== false) {
    project = createStudioV5BooleanFeature(project, {
      id: RUNTIME_FEATURE_IDS.boolean,
      name: 'Subtract Tool from Housing',
      operation: 'subtract',
      targetBodyId: RUNTIME_BODY_IDS.housing,
      toolBodyId: RUNTIME_BODY_IDS.tool,
      keepTools: true,
    });
  }
  return project;
}

export function createDisjointBooleanRuntimeProject() {
  return createStudioV5BooleanFeature(createThreeBodyRuntimeProject(), {
    id: 'feature-invalid-disjoint-subtract',
    name: 'Invalid subtract Shaft from Housing',
    operation: 'subtract',
    targetBodyId: RUNTIME_BODY_IDS.housing,
    toolBodyId: RUNTIME_BODY_IDS.shaft,
    keepTools: true,
  });
}
