import {
  STUDIO_V5_PROJECT_LIMITS,
  STUDIO_V5_SCHEMA_VERSION,
  createEmptyStudioV5PartProject,
} from './studio-project-v5.js';
import {
  canonicalStudioV5Project,
  configureStudioV5Feature,
  createStudioV5BooleanFeature,
  createStudioV5BooleanSplit,
  createStudioV5Datum,
  updateStudioV5Datum,
  deleteStudioV5Datum,
  createStudioV5ProfileSketch,
  createStudioV5PathSketch,
  updateStudioV5AdvancedSketch,
  deleteStudioV5AdvancedSketch,
  createStudioV5LoftFeature,
  createStudioV5SweepFeature,
  createStudioV5RevolveFeature,
  createStudioV5DraftFeature,
  createStudioV5ThickenFeature,
  createStudioV5VariableFilletFeature,
  updateStudioV5AdvancedFeature,
  createStudioV5BodyPattern,
  updateStudioV5BodyPattern,
  deleteStudioV5BodyPattern,
  materializeStudioV5PatternOccurrences,
  createStudioV5AssemblyFromPart,
  createStudioV5ComponentOccurrence,
  updateStudioV5ComponentOccurrence,
  duplicateStudioV5LinkedOccurrence,
  makeStudioV5OccurrenceIndependent,
  replaceStudioV5ComponentOccurrence,
  deleteStudioV5ComponentOccurrence,
  createStudioV5AssemblyMate,
  updateStudioV5AssemblyMate,
  deleteStudioV5AssemblyMate,
  createStudioV5OccurrencePattern,
  updateStudioV5OccurrencePattern,
  deleteStudioV5OccurrencePattern,
  enterStudioV5AssemblyContext,
  exitStudioV5AssemblyContext,
  createStudioV5TransformFeature,
  updateStudioV5TransformFeature,
  reorderStudioV5Feature,
  setStudioV5RollbackMarker,
  deleteStudioV5Body,
  isStudioV5Project,
  prepareStudioV5RuntimeProject,
  studioV5CanonicalHash,
  studioV5ActiveBody,
  studioV5RootAssembly,
  studioV5RootPart,
  updateStudioV5Body,
} from './studio-v5-runtime-document.js';
import {
  assignStudioV5BodyMaterial,
  assignStudioV5OccurrenceAppearance,
  ensureStudioV5GenericMaterials,
  createStudioV5SectionView,
  updateStudioV5SectionView,
  activateStudioV5SectionView,
  deleteStudioV5SectionView,
  createStudioV5ExplodedView,
  activateStudioV5ExplodedView,
  deleteStudioV5ExplodedView,
  createStudioV5Measurement,
  updateStudioV5Measurement,
  deleteStudioV5Measurement,
  setStudioV5DisplayMode,
  createStudioV5AxialStageGroup,
  updateStudioV5AxialStageGroup,
  deleteStudioV5AxialStageGroup,
} from './studio-v5-inspection.js';

export const CAD_AGENT_PROTOCOL = 'bomwiki.cad.agent/v1';
export const CAD_AGENT_STUDIO_VERSION = '6.0.0-i4';
export const CAD_AGENT_KERNEL_VERSION = 'replicad-open-cascade/runtime-5A';

const MAX_TRANSACTION_OPERATIONS = 250;
const MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_PREVIEW_TTL_MS = 5 * 60 * 1000;
const MAX_REQUEST_CACHE_ENTRIES = 1000;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const ALL_PERMISSIONS = Object.freeze([
  'project.read',
  'project.create',
  'project.edit',
  'project.replace',
  'project.save-new',
  'project.save-in-place',
  'project.recover',
  'artifact.render',
  'artifact.export-project',
  'artifact.export-step',
  'artifact.export-stl',
  'artifact.export-narration',
  'ui.read',
  'ui.select',
  'ui.navigate',
  'ui.command-draft',
  'ui.present-preview',
  'ui.present-demo',
  'ui.present-narration',
  'ui.wait-events',
  'session.launch-visible',
]);

const READ_PERMISSIONS = new Set(['project.read']);
const EDIT_PERMISSIONS = new Set(['project.edit']);
const clone = (value) => structuredClone(value);

const JSON_SCHEMAS = Object.freeze({
  transaction: {
    type: 'object',
    required: ['transactionId', 'label', 'expectedRevision', 'operations', 'atomic'],
    properties: {
      transactionId: { type: 'string', minLength: 1, maxLength: 200 },
      label: { type: 'string', minLength: 1, maxLength: 200 },
      expectedRevision: { type: 'integer', minimum: 0 },
      operations: { type: 'array', minItems: 1, maxItems: MAX_TRANSACTION_OPERATIONS },
      atomic: { const: true },
    },
  },
  result: {
    type: 'object',
    required: ['changeSet'],
    properties: { changeSet: { type: 'object' } },
  },
});

const ID_SCHEMA = Object.freeze({ type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' });
const DIMENSION_SCHEMA = Object.freeze({ oneOf: [{ type: 'number' }, { type: 'string', minLength: 1, maxLength: 500 }] });
const ENTITY_OR_ALIAS_SCHEMA = Object.freeze({ oneOf: [ID_SCHEMA, { type: 'object', required: ['alias'], properties: { alias: { type: 'string', minLength: 1, maxLength: 200 } }, additionalProperties: false }] });
const RESULT_POLICY_SCHEMA = Object.freeze({
  oneOf: [
    { type: 'object', required: ['kind'], properties: { kind: { const: 'new-body' }, bodyName: { type: 'string', minLength: 1, maxLength: 200 } }, additionalProperties: false },
    ...['add', 'subtract', 'intersect'].map((kind) => ({
      type: 'object', required: ['kind', 'targetBodyIds'],
      properties: { kind: { const: kind }, targetBodyIds: { type: 'array', minItems: 1, items: ENTITY_OR_ALIAS_SCHEMA }, keepTools: { type: 'boolean' } },
      additionalProperties: false,
    })),
  ],
});
const SHAPE_SCHEMA = Object.freeze({
  oneOf: [
    { type: 'object', required: ['kind', 'x', 'y', 'w', 'h'], properties: { kind: { const: 'rect' }, x: DIMENSION_SCHEMA, y: DIMENSION_SCHEMA, w: DIMENSION_SCHEMA, h: DIMENSION_SCHEMA }, additionalProperties: false },
    { type: 'object', required: ['kind', 'x', 'y', 'r'], properties: { kind: { const: 'circle' }, x: DIMENSION_SCHEMA, y: DIMENSION_SCHEMA, r: DIMENSION_SCHEMA }, additionalProperties: false },
    { type: 'object', required: ['kind', 'pts'], properties: { kind: { const: 'poly' }, pts: { type: 'array', minItems: 3, items: { type: 'array', minItems: 2, maxItems: 2, items: DIMENSION_SCHEMA } } }, additionalProperties: false },
  ],
});
const SKETCH_SCHEMA = Object.freeze({
  type: 'object', required: ['shapes'],
  properties: { shapes: { type: 'array', minItems: 1, items: SHAPE_SCHEMA }, z: DIMENSION_SCHEMA },
  additionalProperties: true,
});
const FEATURE_PATTERN_SCHEMA = Object.freeze({
  oneOf: [
    {
      type: 'object',
      required: ['kind', 'n', 'dx', 'dy'],
      properties: {
        kind: { const: 'linear' },
        n: { type: 'integer', minimum: 2, maximum: 100 },
        dx: DIMENSION_SCHEMA,
        dy: DIMENSION_SCHEMA,
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['kind', 'n', 'cx', 'cy'],
      properties: {
        kind: { const: 'circular' },
        n: { type: 'integer', minimum: 2, maximum: 100 },
        cx: DIMENSION_SCHEMA,
        cy: DIMENSION_SCHEMA,
      },
      additionalProperties: false,
    },
  ],
});
const FEATURE_COMMON_PROPERTIES = Object.freeze({
  id: ID_SCHEMA,
  name: { type: 'string', minLength: 1, maxLength: 200 },
  resultPolicy: RESULT_POLICY_SCHEMA,
  inputRefs: { type: 'array', items: { type: 'object' } },
  onFace: { type: 'object' },
  bodyName: { type: 'string', minLength: 1, maxLength: 200 },
  pattern: FEATURE_PATTERN_SCHEMA,
});
const objectSchema = (required, properties) => ({ type: 'object', required, properties, additionalProperties: false });
const OPERATION_INPUT_SCHEMAS = Object.freeze({
  'project.rename': objectSchema(['name'], { name: { type: 'string', minLength: 1, maxLength: 200 } }),
  'project.setUnits': objectSchema(['units'], { units: { enum: ['mm', 'in'] } }),
  'project.clear': objectSchema([], {}),
  'parameter.create': objectSchema(['name', 'value'], { id: ID_SCHEMA, name: { type: 'string', minLength: 1, maxLength: 200 }, value: DIMENSION_SCHEMA, description: { type: 'string', maxLength: 2000 } }),
  'parameter.update': objectSchema([], { parameterId: ENTITY_OR_ALIAS_SCHEMA, parameterName: { type: 'string' }, name: { type: 'string', minLength: 1, maxLength: 200 }, value: DIMENSION_SCHEMA, description: { type: 'string', maxLength: 2000 } }),
  'parameter.delete': objectSchema([], { parameterId: ENTITY_OR_ALIAS_SCHEMA, parameterName: { type: 'string' } }),
  'feature.extrude': objectSchema(['sketch'], { ...FEATURE_COMMON_PROPERTIES, sketch: SKETCH_SCHEMA, height: DIMENSION_SCHEMA, h: DIMENSION_SCHEMA }),
  'feature.cut': objectSchema(['sketch'], { ...FEATURE_COMMON_PROPERTIES, sketch: SKETCH_SCHEMA, height: DIMENSION_SCHEMA, h: DIMENSION_SCHEMA, through: { type: 'boolean' } }),
  'feature.revolve': objectSchema(['sketch'], { ...FEATURE_COMMON_PROPERTIES, sketch: SKETCH_SCHEMA }),
  'feature.fillet': objectSchema(['radius'], { ...FEATURE_COMMON_PROPERTIES, radius: DIMENSION_SCHEMA, r: DIMENSION_SCHEMA, edges: { type: 'array', items: { type: 'object' } } }),
  'feature.chamfer': objectSchema(['radius'], { ...FEATURE_COMMON_PROPERTIES, radius: DIMENSION_SCHEMA, r: DIMENSION_SCHEMA, edges: { type: 'array', items: { type: 'object' } } }),
  'feature.shell': objectSchema(['thickness'], { ...FEATURE_COMMON_PROPERTIES, thickness: DIMENSION_SCHEMA, t: DIMENSION_SCHEMA, faces: { type: 'array', items: { type: 'object' } } }),
  'feature.update': objectSchema(['featureId', 'patch'], { featureId: ENTITY_OR_ALIAS_SCHEMA, patch: { type: 'object' } }),
  'feature.suppress': objectSchema(['featureId', 'suppressed'], { featureId: ENTITY_OR_ALIAS_SCHEMA, suppressed: { type: 'boolean' } }),
  'feature.delete': objectSchema(['featureId'], { featureId: ENTITY_OR_ALIAS_SCHEMA }),
  'body.activate': objectSchema(['bodyId'], { bodyId: ENTITY_OR_ALIAS_SCHEMA }),
  'body.rename': objectSchema(['bodyId', 'name'], { bodyId: ENTITY_OR_ALIAS_SCHEMA, name: { type: 'string', minLength: 1, maxLength: 200 } }),
  'body.setVisibility': objectSchema(['bodyId', 'visible'], { bodyId: ENTITY_OR_ALIAS_SCHEMA, visible: { type: 'boolean' } }),
  'body.suppress': objectSchema(['bodyId', 'suppressed'], { bodyId: ENTITY_OR_ALIAS_SCHEMA, suppressed: { type: 'boolean' } }),
  'body.delete': objectSchema(['bodyId'], { bodyId: ENTITY_OR_ALIAS_SCHEMA }),
  'boolean.union': objectSchema(['targetBodyId', 'toolBodyId'], { id: ID_SCHEMA, name: { type: 'string' }, targetBodyId: ENTITY_OR_ALIAS_SCHEMA, toolBodyId: ENTITY_OR_ALIAS_SCHEMA, keepTools: { type: 'boolean' } }),
  'boolean.subtract': objectSchema(['targetBodyId', 'toolBodyId'], { id: ID_SCHEMA, name: { type: 'string' }, targetBodyId: ENTITY_OR_ALIAS_SCHEMA, toolBodyId: ENTITY_OR_ALIAS_SCHEMA, keepTools: { type: 'boolean' } }),
  'boolean.intersect': objectSchema(['targetBodyId', 'toolBodyId'], { id: ID_SCHEMA, name: { type: 'string' }, targetBodyId: ENTITY_OR_ALIAS_SCHEMA, toolBodyId: ENTITY_OR_ALIAS_SCHEMA, keepTools: { type: 'boolean' } }),
  'boolean.split': objectSchema(['targetBodyId', 'toolBodyIds'], { id: ID_SCHEMA, name: { type: 'string' }, targetBodyId: ENTITY_OR_ALIAS_SCHEMA, toolBodyIds: { type: 'array', minItems: 1, items: ENTITY_OR_ALIAS_SCHEMA }, keepOriginal: { type: 'boolean' }, keepTools: { type: 'boolean' }, bodyNames: { type: 'array', items: { type: 'string' } } }),
  'datum.create': objectSchema(['id', 'name', 'datumKind', 'definition'], { id: ID_SCHEMA, name: { type: 'string' }, datumKind: { enum: ['plane', 'axis', 'point', 'coordinate-system'] }, definition: { type: 'object' } }),
  'datum.update': objectSchema(['datumId', 'patch'], { datumId: ENTITY_OR_ALIAS_SCHEMA, patch: { type: 'object' } }),
  'datum.delete': objectSchema(['datumId'], { datumId: ENTITY_OR_ALIAS_SCHEMA }),
  'sketch.profile.create': objectSchema(['id', 'name', 'planeDatumId', 'points'], { id: ID_SCHEMA, name: { type: 'string' }, planeDatumId: ENTITY_OR_ALIAS_SCHEMA, points: { type: 'array' }, curveKind: { enum: ['spline', 'polyline'] } }),
  'sketch.path.create': objectSchema(['id', 'name', 'points'], { id: ID_SCHEMA, name: { type: 'string' }, points: { type: 'array' }, curveKind: { enum: ['spline', 'polyline'] } }),
  'sketch.advanced.update': objectSchema(['sketchId', 'patch'], { sketchId: ENTITY_OR_ALIAS_SCHEMA, patch: { type: 'object' } }),
  'sketch.advanced.delete': objectSchema(['sketchId'], { sketchId: ENTITY_OR_ALIAS_SCHEMA }),
  'body.transform': objectSchema(['id', 'bodyId', 'transform'], { id: ID_SCHEMA, name: { type: 'string' }, bodyId: ENTITY_OR_ALIAS_SCHEMA, transform: { type: 'object' }, copy: { type: 'boolean' }, moveOriginal: { type: 'boolean' }, bodyName: { type: 'string' }, createdBodyId: ID_SCHEMA }),
  'transform.update': objectSchema(['featureId', 'patch'], { featureId: ENTITY_OR_ALIAS_SCHEMA, patch: { type: 'object' } }),
  'feature.reorder': objectSchema(['featureId'], { featureId: ENTITY_OR_ALIAS_SCHEMA, beforeFeatureId: ENTITY_OR_ALIAS_SCHEMA }),
  'feature.rollback': objectSchema([], { featureId: ENTITY_OR_ALIAS_SCHEMA }),
  'feature.loft': objectSchema(['id', 'sections'], { id: ID_SCHEMA, name: { type: 'string' }, sections: { type: 'array', minItems: 2 }, guideSketchIds: { type: 'array', items: ENTITY_OR_ALIAS_SCHEMA }, centerlineSketchId: ENTITY_OR_ALIAS_SCHEMA, continuity: { type: 'object' }, ruled: { type: 'boolean' }, targetBodyId: ENTITY_OR_ALIAS_SCHEMA, operation: { enum: ['add', 'subtract', 'intersect'] }, bodyName: { type: 'string' } }),
  'feature.sweep': objectSchema(['id', 'profileSketchId', 'pathSketchId'], { id: ID_SCHEMA, name: { type: 'string' }, profileSketchId: ENTITY_OR_ALIAS_SCHEMA, pathSketchId: ENTITY_OR_ALIAS_SCHEMA, guideSketchId: ENTITY_OR_ALIAS_SCHEMA, orientation: { type: 'string' }, referenceDirection: { type: 'array' }, twistAngle: DIMENSION_SCHEMA, scaleEnd: DIMENSION_SCHEMA, transition: { type: 'string' }, targetBodyId: ENTITY_OR_ALIAS_SCHEMA, operation: { enum: ['add', 'subtract', 'intersect'] }, bodyName: { type: 'string' } }),
  'feature.revolveProfile': objectSchema(['id', 'profileSketchId', 'axisDatumId', 'angle'], { id: ID_SCHEMA, name: { type: 'string' }, profileSketchId: ENTITY_OR_ALIAS_SCHEMA, axisDatumId: ENTITY_OR_ALIAS_SCHEMA, angle: DIMENSION_SCHEMA, startAngle: DIMENSION_SCHEMA, symmetric: { type: 'boolean' }, targetBodyId: ENTITY_OR_ALIAS_SCHEMA, operation: { enum: ['add', 'subtract', 'intersect'] }, bodyName: { type: 'string' } }),
  'feature.draft': objectSchema(['id', 'bodyId', 'neutralPlaneDatumId', 'angle'], { id: ID_SCHEMA, name: { type: 'string' }, bodyId: ENTITY_OR_ALIAS_SCHEMA, neutralPlaneDatumId: ENTITY_OR_ALIAS_SCHEMA, angle: DIMENSION_SCHEMA, faceRefs: { type: 'array' }, pullDirectionDatumId: ENTITY_OR_ALIAS_SCHEMA, flip: { type: 'boolean' }, tangentPropagation: { type: 'boolean' } }),
  'feature.thicken': objectSchema(['id', 'bodyId', 'faceRefs', 'thickness'], { id: ID_SCHEMA, name: { type: 'string' }, bodyId: ENTITY_OR_ALIAS_SCHEMA, faceRefs: { type: 'array', minItems: 1 }, thickness: DIMENSION_SCHEMA, direction: { enum: ['inside', 'outside', 'symmetric'] }, bodyName: { type: 'string' } }),
  'feature.variableFillet': objectSchema(['id', 'bodyId', 'edgeRefs', 'variableRadii'], { id: ID_SCHEMA, name: { type: 'string' }, bodyId: ENTITY_OR_ALIAS_SCHEMA, edgeRefs: { type: 'array', minItems: 1 }, variableRadii: { type: 'array', minItems: 1 }, tangentPropagation: { type: 'boolean' } }),
  'feature.advanced.update': objectSchema(['featureId', 'patch'], { featureId: ENTITY_OR_ALIAS_SCHEMA, patch: { type: 'object' } }),
  'pattern.create': objectSchema(['id', 'kind', 'sourceBodyId'], { id: ID_SCHEMA, name: { type: 'string' }, kind: { enum: ['linear', 'circular', 'curve', 'mirror'] }, sourceBodyId: ENTITY_OR_ALIAS_SCHEMA, count: DIMENSION_SCHEMA, directionDatumId: ENTITY_OR_ALIAS_SCHEMA, directionDatumIds: { type: 'array', items: ENTITY_OR_ALIAS_SCHEMA }, axisDatumId: ENTITY_OR_ALIAS_SCHEMA, pathSketchId: ENTITY_OR_ALIAS_SCHEMA, planeDatumId: ENTITY_OR_ALIAS_SCHEMA, definition: { type: 'object' } }),
  'pattern.update': objectSchema(['patternId', 'patch'], { patternId: ENTITY_OR_ALIAS_SCHEMA, patch: { type: 'object' } }),
  'pattern.delete': objectSchema(['patternId'], { patternId: ENTITY_OR_ALIAS_SCHEMA }),
  'pattern.materialize': objectSchema(['patternId', 'records'], { patternId: ENTITY_OR_ALIAS_SCHEMA, records: { type: 'array', minItems: 1 }, dissolve: { type: 'boolean' } }),
  'assembly.create': objectSchema(['id', 'occurrenceId'], { id: ID_SCHEMA, name: { type: 'string' }, occurrenceId: ID_SCHEMA, occurrenceName: { type: 'string' }, fixed: { type: 'boolean' } }),
  'document.activate': objectSchema(['definition'], { definition: { type: 'object' } }),
  'assembly.context.enter': objectSchema(['occurrenceId'], { occurrenceId: ENTITY_OR_ALIAS_SCHEMA }),
  'assembly.context.exit': objectSchema([], {}),
  'component.createPart': objectSchema(['partId', 'name', 'occurrenceId'], { partId: ID_SCHEMA, name: { type: 'string' }, occurrenceId: ID_SCHEMA, occurrenceName: { type: 'string' }, baseTransform: { type: 'array', minItems: 16, maxItems: 16 }, fixed: { type: 'boolean' }, enterContext: { type: 'boolean' } }),
  'component.insert': objectSchema(['id', 'definition'], { id: ID_SCHEMA, name: { type: 'string' }, definition: { type: 'object' }, baseTransform: { type: 'array', minItems: 16, maxItems: 16 }, fixed: { type: 'boolean' }, visible: { type: 'boolean' }, parameterOverrides: { type: 'object' } }),
  'component.update': objectSchema(['occurrenceId', 'patch'], { occurrenceId: ENTITY_OR_ALIAS_SCHEMA, patch: { type: 'object' } }),
  'component.duplicate': objectSchema(['occurrenceId', 'id'], { occurrenceId: ENTITY_OR_ALIAS_SCHEMA, id: ID_SCHEMA, name: { type: 'string' }, baseTransform: { type: 'array', minItems: 16, maxItems: 16 } }),
  'component.makeIndependent': objectSchema(['occurrenceId', 'partId'], { occurrenceId: ENTITY_OR_ALIAS_SCHEMA, partId: ID_SCHEMA, name: { type: 'string' }, occurrenceName: { type: 'string' } }),
  'component.replace': objectSchema(['occurrenceId', 'definition'], { occurrenceId: ENTITY_OR_ALIAS_SCHEMA, definition: { type: 'object' } }),
  'component.delete': objectSchema(['occurrenceId'], { occurrenceId: ENTITY_OR_ALIAS_SCHEMA }),
  'component.pattern': objectSchema(['id', 'sourceOccurrenceIds', 'generatedCount'], { id: ID_SCHEMA, name: { type: 'string' }, kind: { type: 'string' }, sourceOccurrenceIds: { type: 'array', minItems: 1, items: ENTITY_OR_ALIAS_SCHEMA }, generatedCount: { type: 'integer' }, definition: { type: 'object' } }),
  'component.pattern.update': objectSchema(['patternId', 'patch'], { patternId: ENTITY_OR_ALIAS_SCHEMA, patch: { type: 'object' } }),
  'component.pattern.delete': objectSchema(['patternId'], { patternId: ENTITY_OR_ALIAS_SCHEMA }),
  'mate.create': objectSchema(['id', 'mateKind', 'occurrenceIds'], {
    id: ID_SCHEMA,
    name: { type: 'string' },
    mateKind: { enum: ['fixed', 'coincident', 'concentric', 'distance', 'angle', 'parallel', 'perpendicular', 'tangent', 'revolute', 'slider'] },
    occurrenceIds: { type: 'array', minItems: 1, items: ENTITY_OR_ALIAS_SCHEMA },
    references: { type: 'array' },
    value: DIMENSION_SCHEMA,
    extensions: { type: 'object' },
  }),
  'mate.update': objectSchema(['mateId', 'patch'], { mateId: ENTITY_OR_ALIAS_SCHEMA, patch: { type: 'object' } }),
  'mate.delete': objectSchema(['mateId'], { mateId: ENTITY_OR_ALIAS_SCHEMA }),
  'section.create': objectSchema(['id', 'name', 'kind', 'planes'], { id: ID_SCHEMA, name: { type: 'string' }, kind: { enum: ['plane', 'quarter', 'box'] }, planes: { type: 'array', minItems: 1 }, scopeOccurrenceIds: { type: 'array', items: ENTITY_OR_ALIAS_SCHEMA }, cap: { type: 'boolean' }, reverse: { type: 'boolean' }, hatch: { type: 'object' } }),
  'section.update': objectSchema(['sectionId', 'patch'], { sectionId: ENTITY_OR_ALIAS_SCHEMA, patch: { type: 'object' } }),
  'section.activate': objectSchema([], { sectionId: ENTITY_OR_ALIAS_SCHEMA }),
  'section.delete': objectSchema(['sectionId'], { sectionId: ENTITY_OR_ALIAS_SCHEMA }),
  'exploded.create': objectSchema(['id', 'name', 'steps'], { id: ID_SCHEMA, name: { type: 'string' }, steps: { type: 'array', minItems: 1 } }),
  'exploded.activate': objectSchema([], { explodedViewId: ENTITY_OR_ALIAS_SCHEMA }),
  'exploded.delete': objectSchema(['explodedViewId'], { explodedViewId: ENTITY_OR_ALIAS_SCHEMA }),
  'measurement.create': objectSchema(['id', 'name', 'measurementKind', 'definition'], { id: ID_SCHEMA, name: { type: 'string' }, measurementKind: { type: 'string' }, definition: { type: 'object' } }),
  'measurement.update': objectSchema(['measurementId', 'patch'], { measurementId: ENTITY_OR_ALIAS_SCHEMA, patch: { type: 'object' } }),
  'measurement.delete': objectSchema(['measurementId'], { measurementId: ENTITY_OR_ALIAS_SCHEMA }),
  'display.setMode': objectSchema(['mode'], { mode: { enum: ['shaded', 'shaded-edges', 'wireframe', 'hidden-line', 'ghost'] } }),
  'material.ensureGeneric': objectSchema([], {}),
  'material.assignBody': objectSchema(['partId', 'bodyId', 'materialId'], { partId: ENTITY_OR_ALIAS_SCHEMA, bodyId: ENTITY_OR_ALIAS_SCHEMA, materialId: ENTITY_OR_ALIAS_SCHEMA }),
  'appearance.assignOccurrence': objectSchema(['occurrenceId', 'appearanceId'], { occurrenceId: ENTITY_OR_ALIAS_SCHEMA, appearanceId: ID_SCHEMA }),
  'stage.create': objectSchema(['id', 'name', 'occurrenceIds', 'distanceMateIds'], { id: ID_SCHEMA, name: { type: 'string' }, occurrenceIds: { type: 'array', minItems: 1, items: ENTITY_OR_ALIAS_SCHEMA }, distanceMateIds: { type: 'array', minItems: 1, items: ENTITY_OR_ALIAS_SCHEMA }, axis: { type: 'array' }, start: { type: 'number' }, spacing: { type: 'number' }, visible: { type: 'boolean' } }),
  'stage.update': objectSchema(['groupId', 'patch'], { groupId: ENTITY_OR_ALIAS_SCHEMA, patch: { type: 'object' } }),
  'stage.delete': objectSchema(['groupId'], { groupId: ENTITY_OR_ALIAS_SCHEMA }),
});

const AVAILABLE_OPERATION_KINDS = Object.freeze([
  'project.rename',
  'project.setUnits',
  'project.clear',
  'parameter.create',
  'parameter.update',
  'parameter.delete',
  'feature.extrude',
  'feature.cut',
  'feature.revolve',
  'feature.fillet',
  'feature.chamfer',
  'feature.shell',
  'feature.update',
  'feature.suppress',
  'feature.delete',
  'body.activate',
  'body.rename',
  'body.setVisibility',
  'body.suppress',
  'body.delete',
  'boolean.union',
  'boolean.subtract',
  'boolean.intersect',
  'boolean.split',
  'datum.create', 'datum.update', 'datum.delete',
  'sketch.profile.create', 'sketch.path.create', 'sketch.advanced.update', 'sketch.advanced.delete',
  'body.transform', 'transform.update', 'feature.reorder', 'feature.rollback',
  'feature.loft', 'feature.sweep', 'feature.revolveProfile', 'feature.draft', 'feature.thicken', 'feature.variableFillet', 'feature.advanced.update',
  'pattern.create', 'pattern.update', 'pattern.delete', 'pattern.materialize',
  'assembly.create', 'document.activate', 'assembly.context.enter', 'assembly.context.exit',
  'component.createPart', 'component.insert', 'component.update', 'component.duplicate', 'component.makeIndependent', 'component.replace', 'component.delete', 'component.pattern', 'component.pattern.update', 'component.pattern.delete',
  'mate.create', 'mate.update', 'mate.delete',
  'section.create', 'section.update', 'section.activate', 'section.delete',
  'exploded.create', 'exploded.activate', 'exploded.delete',
  'measurement.create', 'measurement.update', 'measurement.delete',
  'display.setMode', 'material.ensureGeneric', 'material.assignBody', 'appearance.assignOccurrence',
  'stage.create', 'stage.update', 'stage.delete',
]);

const DISABLED_OPERATION_REASONS = Object.freeze({});

const QUERY_CAPABILITIES = Object.freeze([
  'project.summary',
  'project.tree',
  'entity.detail',
  'entity.dependencies',
  'entity.search',
  'geometry.validity',
  'geometry.bodies',
  'geometry.topology',
  'geometry.health',
  'assembly.clearance',
  'assembly.interference',
  'history.list',
  'history.changesSince',
]);

function operationCapability(kind, state = 'available', disabledReasonCode) {
  return {
    kind,
    version: 1,
    state,
    ...(disabledReasonCode ? { disabledReasonCode } : {}),
    inputSchema: state === 'available'
      ? { type: 'object', required: ['kind', 'input'], properties: { kind: { const: kind }, alias: { type: 'string' }, input: clone(OPERATION_INPUT_SCHEMAS[kind] || { type: 'object' }) }, additionalProperties: false }
      : { type: 'object' },
    resultSchema: JSON_SCHEMAS.result,
    supportsPreview: state === 'available',
    supportsAtomicBatch: state === 'available',
  };
}

export function cadCapabilityManifest(options = {}) {
  const available = AVAILABLE_OPERATION_KINDS.map((kind) => operationCapability(kind));
  const disabled = Object.entries(DISABLED_OPERATION_REASONS).map(([kind, reason]) => operationCapability(kind, 'disabled', reason));
  return {
    protocolVersion: CAD_AGENT_PROTOCOL,
    studioVersion: CAD_AGENT_STUDIO_VERSION,
    schemaVersions: [STUDIO_V5_SCHEMA_VERSION],
    kernelVersion: CAD_AGENT_KERNEL_VERSION,
    documentKinds: ['part', 'assembly'],
    operations: [...available, ...disabled],
    queries: QUERY_CAPABILITIES.map((kind) => ({
      kind,
      version: 1,
      state: ['geometry.topology', 'geometry.health', 'assembly.clearance', 'assembly.interference'].includes(kind) && options.exactKernel === false
        ? 'disabled'
        : 'available',
      ...(['geometry.topology', 'geometry.health', 'assembly.clearance', 'assembly.interference'].includes(kind) && options.exactKernel === false
        ? { disabledReasonCode: 'EXACT_KERNEL_ADAPTER_REQUIRED' }
        : {}),
      supportsPreviewScope: ['geometry.health', 'assembly.clearance', 'assembly.interference'].includes(kind),
      inputSchema: { type: 'object' },
      resultSchema: { type: 'object' },
    })),
    exports: [
      { format: 'project', state: 'available', permission: 'artifact.export-project' },
      { format: 'step', state: options.exactKernel === false ? 'disabled' : 'available', permission: 'artifact.export-step', disabledReasonCode: options.exactKernel === false ? 'EXACT_KERNEL_ADAPTER_REQUIRED' : undefined },
      { format: 'stl', state: options.exactKernel === false ? 'disabled' : 'available', permission: 'artifact.export-stl', disabledReasonCode: options.exactKernel === false ? 'EXACT_KERNEL_ADAPTER_REQUIRED' : undefined },
      { format: 'png', state: options.visibleStudio === true ? 'available' : 'disabled', permission: 'artifact.render', disabledReasonCode: options.visibleStudio === true ? undefined : 'VISIBLE_STUDIO_REQUIRED' },
      { format: 'webvtt', state: options.visibleStudio === true ? 'available' : 'disabled', permission: 'artifact.export-narration', disabledReasonCode: options.visibleStudio === true ? undefined : 'VISIBLE_STUDIO_REQUIRED' },
      { format: 'srt', state: options.visibleStudio === true ? 'available' : 'disabled', permission: 'artifact.export-narration', disabledReasonCode: options.visibleStudio === true ? undefined : 'VISIBLE_STUDIO_REQUIRED' },
    ],
    imports: [
      { format: 'project', state: options.visibleStudio === true ? 'available' : 'disabled', permission: 'project.replace', disabledReasonCode: options.visibleStudio === true ? undefined : 'VISIBLE_STUDIO_REQUIRED' },
      { format: 'step', state: options.visibleStudio === true && options.exactKernel !== false ? 'available' : 'disabled', permission: 'project.replace', disabledReasonCode: options.visibleStudio !== true ? 'VISIBLE_STUDIO_REQUIRED' : options.exactKernel === false ? 'EXACT_KERNEL_ADAPTER_REQUIRED' : undefined },
    ],
    limits: {
      ...STUDIO_V5_PROJECT_LIMITS,
      transactionOperations: MAX_TRANSACTION_OPERATIONS,
      requestBytes: MAX_REQUEST_BYTES,
      queryPageSize: MAX_PAGE_SIZE,
    },
    permissions: ALL_PERMISSIONS.map((permission) => ({ permission, default: 'denied' })),
    transports: ['headless', 'mcp-stdio', 'studio-loopback'],
  };
}

function invalidCapabilityQuery(message) {
  const error = new Error(message);
  error.code = 'INVALID_CAPABILITY_QUERY';
  throw error;
}

function boundedCapabilityIds(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some((entry) => typeof entry !== 'string' || !entry || entry.length > 200)) {
    invalidCapabilityQuery(`${name} must be a bounded list of at most 20 stable capability IDs.`);
  }
  return [...new Set(value)];
}

function compactCapability(entry) {
  const { inputSchema: _inputSchema, resultSchema: _resultSchema, ...summary } = entry;
  return summary;
}

export function selectCadCapabilities(manifest, query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    invalidCapabilityQuery('Capability discovery requires an object.');
  }
  const allowed = new Set(['detail', 'operationKinds', 'queryKinds']);
  const unknown = Object.keys(query).filter((key) => !allowed.has(key));
  if (unknown.length) invalidCapabilityQuery(`Unknown capability discovery fields: ${unknown.join(', ')}.`);
  const detail = query.detail || 'summary';
  if (!['summary', 'schemas', 'full'].includes(detail)) {
    invalidCapabilityQuery('Capability detail must be summary, schemas, or full.');
  }
  const operationKinds = boundedCapabilityIds(query.operationKinds, 'operationKinds');
  const queryKinds = boundedCapabilityIds(query.queryKinds, 'queryKinds');
  const operationByKind = new Map(manifest.operations.map((entry) => [entry.kind, entry]));
  const queryByKind = new Map(manifest.queries.map((entry) => [entry.kind, entry]));
  const missingOperationKinds = operationKinds.filter((kind) => !operationByKind.has(kind));
  const missingQueryKinds = queryKinds.filter((kind) => !queryByKind.has(kind));
  if (missingOperationKinds.length || missingQueryKinds.length) {
    invalidCapabilityQuery(`Unknown capability IDs: ${[...missingOperationKinds, ...missingQueryKinds].join(', ')}.`);
  }
  if (detail === 'schemas' && !operationKinds.length && !queryKinds.length) {
    invalidCapabilityQuery('Schema discovery requires at least one operationKinds or queryKinds entry.');
  }
  const operations = detail === 'full'
    ? manifest.operations
    : detail === 'schemas'
      ? operationKinds.map((kind) => operationByKind.get(kind))
      : manifest.operations.map(compactCapability);
  const queries = detail === 'full'
    ? manifest.queries
    : detail === 'schemas'
      ? queryKinds.map((kind) => queryByKind.get(kind))
      : manifest.queries.map(compactCapability);
  return clone({
    ...manifest,
    operations,
    queries,
    capabilityDiscovery: {
      detail,
      operationCount: manifest.operations.length,
      queryCount: manifest.queries.length,
      schemaBatchLimit: 20,
      supportedDetails: ['summary', 'schemas', 'full'],
      instructions: detail === 'summary'
        ? 'Request detail "schemas" with only the operationKinds or queryKinds needed for the current task. Full discovery is available for audits.'
        : 'The manifest identity and capability states are unchanged across discovery detail levels.',
    },
  });
}

export class CadAgentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CadAgentError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CadAgentError(code, message, details);
}

function diagnostic(error, operationIndex) {
  const code = error?.code || 'CAD_OPERATION_FAILED';
  return {
    code,
    severity: 'error',
    message: String(error?.message || error),
    ...(Number.isInteger(operationIndex) ? { operationIndex } : {}),
    ...(error?.details?.entity ? { entity: error.details.entity } : {}),
    ...(error?.details?.repairOptions ? { repairOptions: clone(error.details.repairOptions) } : {}),
  };
}

function assertRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_REQUEST', path + ' must be an object.');
  return value;
}

function assertText(value, path, maximum = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail('INVALID_REQUEST', path + ' must contain 1 to ' + maximum + ' characters.');
  return value.trim();
}

function assertId(value, path) {
  const id = assertText(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) fail('INVALID_REQUEST', path + ' is not a valid stable ID.');
  return id;
}

function assertInteger(value, path, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail('INVALID_REQUEST', path + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  return value;
}

function assertFiniteOrExpression(value, path) {
  if ((typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.trim() && value.length <= 500)) return value;
  fail('INVALID_EXPRESSION', path + ' must be a finite number or bounded parameter expression.');
}

function assertPermission(context, required, projectId, operationKinds = []) {
  const permission = assertRecord(context, 'permissionContext');
  const granted = new Set(Array.isArray(permission.granted) ? permission.granted : []);
  for (const item of required) if (!granted.has(item)) fail('PERMISSION_DENIED', 'Permission "' + item + '" is required.');
  if (permission.expiresAt != null) {
    const expiresAt = typeof permission.expiresAt === 'string' ? Date.parse(permission.expiresAt) : Number.NaN;
    if (!Number.isFinite(expiresAt)) fail('INVALID_PERMISSION_SCOPE', 'permissionContext.expiresAt must be a valid timestamp.');
    if (expiresAt <= Date.now()) fail('PERMISSION_EXPIRED', 'The CAD permission scope has expired.');
  }
  if (permission.maxCommits != null && (!Number.isInteger(permission.maxCommits) || permission.maxCommits < 0)) {
    fail('INVALID_PERMISSION_SCOPE', 'permissionContext.maxCommits must be a non-negative integer.');
  }
  if (Array.isArray(permission.projectIds) && projectId && !permission.projectIds.includes(projectId)) fail('PERMISSION_DENIED', 'The session is not allowed to access this project.');
  if (Array.isArray(permission.operationKinds)) {
    for (const kind of operationKinds) if (!permission.operationKinds.includes(kind)) fail('PERMISSION_DENIED', 'Operation "' + kind + '" is outside the session scope.');
  }
  return permission;
}

function canonicalEntityMap(project) {
  const entries = [];
  entries.push(['project', project.projectId, project]);
  for (const parameter of project.parameters || []) entries.push(['parameter', parameter.id, parameter]);
  for (const material of project.materials || []) entries.push(['material', material.id, material]);
  for (const part of project.partDefinitions || []) {
    entries.push(['part', part.id, part]);
    for (const parameter of part.parameters || []) entries.push(['parameter', parameter.id, parameter]);
    for (const datum of part.referenceGeometry || []) entries.push(['datum', datum.id, datum]);
    for (const sketch of part.sketches || []) entries.push(['sketch', sketch.id, sketch]);
    for (const feature of part.features || []) entries.push(['feature', feature.id, feature]);
    for (const body of part.bodies || []) entries.push(['body', body.id, body]);
    for (const pattern of part.bodyPatterns || []) entries.push(['body-pattern', pattern.id, pattern]);
  }
  for (const assembly of project.assemblyDefinitions || []) {
    entries.push(['assembly', assembly.id, assembly]);
    for (const parameter of assembly.parameters || []) entries.push(['parameter', parameter.id, parameter]);
    for (const occurrence of assembly.occurrences || []) entries.push(['occurrence', occurrence.id, occurrence]);
    for (const mate of assembly.mates || []) entries.push(['mate', mate.id, mate]);
    for (const pattern of assembly.occurrencePatterns || []) entries.push(['occurrence-pattern', pattern.id, pattern]);
    for (const section of assembly.sectionViews || []) entries.push(['section', section.id, section]);
    for (const exploded of assembly.explodedViews || []) entries.push(['exploded-view', exploded.id, exploded]);
    for (const measurement of assembly.metadata?.measurements || []) entries.push(['measurement', measurement.id, measurement]);
    for (const stage of assembly.metadata?.axialStageGroups || []) entries.push(['stage-group', stage.id, stage]);
  }
  return new Map(entries.map(([kind, id, value]) => [kind + ':' + id, { kind, id, value }]));
}

function changedEntity(entry) {
  return { kind: entry.kind, id: entry.id, name: entry.value?.name || entry.value?.title || entry.id };
}

function semanticChangeSet(before, after, aliases = {}) {
  const previous = canonicalEntityMap(before);
  const next = canonicalEntityMap(after);
  const created = [];
  const updated = [];
  const deleted = [];
  for (const [key, entry] of next) {
    if (!previous.has(key)) created.push(changedEntity(entry));
    else if (JSON.stringify(previous.get(key).value) !== JSON.stringify(entry.value)) updated.push(changedEntity(entry));
  }
  for (const [key, entry] of previous) if (!next.has(key)) deleted.push(changedEntity(entry));
  const previousParameters = new Map((before.parameters || []).map((entry) => [entry.id, entry]));
  const parameterDiffs = (after.parameters || []).flatMap((entry) => {
    const old = previousParameters.get(entry.id);
    return !old || old.name !== entry.name || old.value !== entry.value
      ? [{ parameter: { kind: 'parameter', id: entry.id }, before: old?.value, after: entry.value, nameBefore: old?.name, nameAfter: entry.name }]
      : [];
  });
  const beforeBodies = (before.partDefinitions || []).flatMap((part) => part.bodies || []);
  const afterBodies = (after.partDefinitions || []).flatMap((part) => part.bodies || []);
  const previousBodies = new Map(beforeBodies.map((body) => [body.id, body]));
  const visibilityDiffs = afterBodies.flatMap((body) => {
    const old = previousBodies.get(body.id);
    return old && (old.visible !== body.visible || old.suppressed !== body.suppressed)
      ? [{ body: { kind: 'body', id: body.id }, visibleBefore: old.visible, visibleAfter: body.visible, suppressedBefore: old.suppressed, suppressedAfter: body.suppressed }]
      : [];
  });
  const previousOccurrences = new Map((before.assemblyDefinitions || []).flatMap((assembly) => assembly.occurrences || []).map((entry) => [entry.id, entry]));
  const transformDiffs = (after.assemblyDefinitions || []).flatMap((assembly) => assembly.occurrences || []).flatMap((entry) => {
    const old = previousOccurrences.get(entry.id);
    return old && JSON.stringify(old.baseTransform) !== JSON.stringify(entry.baseTransform)
      ? [{ occurrence: { kind: 'occurrence', id: entry.id }, before: clone(old.baseTransform), after: clone(entry.baseTransform) }]
      : [];
  });
  return {
    created,
    updated,
    deleted,
    remapped: [],
    invalidated: updated.filter((entry) => entry.kind === 'feature' || entry.kind === 'body'),
    rebuilt: updated.filter((entry) => entry.kind === 'feature' || entry.kind === 'body').map((entry) => ({ entity: entry })),
    unchangedAssertions: [],
    parameterDiffs,
    transformDiffs,
    visibilityDiffs,
    aliases: clone(aliases),
    documentHashBefore: studioV5CanonicalHash(before),
    documentHashAfter: studioV5CanonicalHash(after),
  };
}

function boundedHash(value) {
  const source = JSON.stringify(value ?? null);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return 'fnv1a32:' + (hash >>> 0).toString(16).padStart(8, '0');
}

function evidenceFromKernel(response, exactGeometry) {
  return {
    exactGeometry: Boolean(exactGeometry),
    bodyResults: (response?.bodies || []).map((body) => ({
      body: { kind: 'body', id: body.bodyId, name: body.bodyName },
      sourceBodyId: body.sourceBodyId || body.bodyId,
      occurrenceInstance: clone(body.occurrenceInstance || null),
      visible: body.visible !== false,
      suppressed: body.suppressed === true,
      valid: body.geometry?.valid === true && !body.error,
      solids: body.geometry?.solidCount || 0,
      shells: body.geometry?.shellCount || 0,
      faces: body.geometry?.faceCount || 0,
      edges: body.geometry?.edgeCount || 0,
      ...(Number.isFinite(body.geometry?.volume) ? { volume: body.geometry.volume } : {}),
      ...(body.geometry?.bounds ? { boundingBox: body.geometry.bounds } : {}),
      geometryHash: body.geometry?.hash || body.geometry?.geometryHash || boundedHash({
        valid: body.geometry?.valid,
        solidCount: body.geometry?.solidCount,
        shellCount: body.geometry?.shellCount,
        faceCount: body.geometry?.faceCount,
        edgeCount: body.geometry?.edgeCount,
        volume: body.geometry?.volume,
        bounds: body.geometry?.bounds,
      }),
    })),
    warnings: (response?.errors || []).filter((entry) => entry.severity === 'warning').map((entry) => entry.message),
  };
}

function findFeature(project, featureId) {
  const feature = studioV5RootPart(project).features.find((entry) => entry.id === featureId);
  if (!feature) fail('MISSING_REFERENCE', 'Feature "' + featureId + '" does not exist.', { entity: { kind: 'feature', id: featureId } });
  return feature;
}

function findBody(project, bodyId) {
  const body = studioV5RootPart(project).bodies.find((entry) => entry.id === bodyId);
  if (!body) fail('MISSING_REFERENCE', 'Body "' + bodyId + '" does not exist.', { entity: { kind: 'body', id: bodyId } });
  return body;
}

function findParameter(project, parameterId) {
  const parameter = project.parameters.find((entry) => entry.id === parameterId);
  if (!parameter) fail('MISSING_REFERENCE', 'Parameter "' + parameterId + '" does not exist.', { entity: { kind: 'parameter', id: parameterId } });
  return parameter;
}

function replaceFeature(project, nextFeature) {
  return configureStudioV5Feature(project, nextFeature, {
    resultPolicy: nextFeature.resultPolicy,
    bodyName: nextFeature.resultPolicy?.bodyName,
  });
}

function deleteFeature(project, featureId) {
  const candidate = canonicalStudioV5Project(project);
  const part = studioV5RootPart(candidate);
  const createdBody = part.bodies.find((body) => body.createdByFeatureId === featureId);
  if (createdBody) return deleteStudioV5Body(candidate, createdBody.id);
  if (!part.features.some((feature) => feature.id === featureId)) fail('MISSING_REFERENCE', 'Feature "' + featureId + '" does not exist.');
  part.features = part.features.filter((feature) => feature.id !== featureId);
  return prepareStudioV5RuntimeProject(candidate);
}

function resolveReference(value, aliases, path) {
  if (value && typeof value === 'object' && typeof value.alias === 'string') {
    const resolved = aliases[value.alias];
    if (!resolved) fail('MISSING_ALIAS', path + ' references unknown transaction alias "' + value.alias + '".');
    return resolved.id;
  }
  return assertId(value, path);
}

function resolveOptionalReference(value, aliases, path) {
  return value == null ? value : resolveReference(value, aliases, path);
}

function resolveReferenceArray(values, aliases, path) {
  if (!Array.isArray(values)) fail('INVALID_REQUEST', path + ' must be an array.');
  return values.map((value, index) => resolveReference(value, aliases, path + '[' + index + ']'));
}

function resolveDefinition(definition, aliases, path) {
  const value = assertRecord(definition, path);
  if (value.kind === 'part') return { kind: 'part', partId: resolveReference(value.partId, aliases, path + '.partId') };
  if (value.kind === 'assembly') return { kind: 'assembly', assemblyId: resolveReference(value.assemblyId, aliases, path + '.assemblyId') };
  fail('INVALID_REQUEST', path + '.kind must be "part" or "assembly".');
}

function nextStableId(project, prefix) {
  const used = new Set(canonicalEntityMap(project).values());
  const usedIds = new Set([...used].map((entry) => entry.id));
  let index = 1;
  while (usedIds.has(prefix + '-' + index)) index++;
  return prefix + '-' + index;
}

function featureFromOperation(project, kind, input, aliases) {
  const type = kind.slice('feature.'.length);
  const id = input.id ? assertId(input.id, 'operation.input.id') : nextStableId(project, 'feature-' + type);
  const activeBody = studioV5ActiveBody(project);
  const defaultPolicy = activeBody
    ? type === 'cut'
      ? { kind: 'subtract', targetBodyIds: [activeBody.id], keepTools: false }
      : { kind: 'add', targetBodyIds: [activeBody.id] }
    : { kind: 'new-body', bodyName: input.bodyName || 'Body ' + (studioV5RootPart(project).bodies.length + 1) };
  const resultPolicy = clone(input.resultPolicy || defaultPolicy);
  if (Array.isArray(resultPolicy.targetBodyIds)) {
    resultPolicy.targetBodyIds = resultPolicy.targetBodyIds.map((bodyId, index) => resolveReference(bodyId, aliases, 'operation.input.resultPolicy.targetBodyIds[' + index + ']'));
  }
  const inputRefs = clone(input.inputRefs || []).map((reference, index) => {
    if (reference?.ownerId && typeof reference.ownerId === 'object') {
      return { ...reference, ownerId: resolveReference(reference.ownerId, aliases, 'operation.input.inputRefs[' + index + '].ownerId') };
    }
    return reference;
  });
  const base = {
    id,
    name: input.name || type[0].toUpperCase() + type.slice(1),
    type,
    suppressed: false,
    inputRefs,
    resultPolicy,
    ...(input.onFace ? { onFace: clone(input.onFace) } : {}),
    ...(input.pattern ? { pattern: clone(input.pattern) } : {}),
  };
  if (type === 'extrude' || type === 'cut' || type === 'revolve') {
    assertRecord(input.sketch, 'operation.input.sketch');
    base.sketch = clone(input.sketch);
  }
  if (type === 'extrude' || type === 'cut') {
    base.h = assertFiniteOrExpression(input.height ?? input.h ?? 20, 'operation.input.height');
    base.through = type === 'cut' ? input.through === true : false;
  } else if (type === 'fillet' || type === 'chamfer') {
    base.r = assertFiniteOrExpression(input.radius ?? input.r, 'operation.input.radius');
    base.edges = clone(Array.isArray(input.edges) ? input.edges : []);
  } else if (type === 'shell') {
    base.t = assertFiniteOrExpression(input.thickness ?? input.t, 'operation.input.thickness');
    base.faces = clone(Array.isArray(input.faces) ? input.faces : []);
  }
  return base;
}

function applyOperation(project, operation, aliases) {
  const op = assertRecord(operation, 'operation');
  const kind = assertText(op.kind, 'operation.kind');
  if (!AVAILABLE_OPERATION_KINDS.includes(kind)) {
    const reason = DISABLED_OPERATION_REASONS[kind];
    if (reason) fail('CAPABILITY_DISABLED', 'Operation "' + kind + '" is not available in this runtime.', { repairOptions: [{ kind: 'inspect-capabilities', capability: kind, reasonCode: reason }] });
    fail('UNKNOWN_OPERATION', 'Unknown CAD operation "' + kind + '".');
  }
  const input = assertRecord(op.input || {}, 'operation.input');
  let candidate = canonicalStudioV5Project(project);
  let resultRef = null;

  if (kind === 'project.rename') {
    const name = assertText(input.name, 'operation.input.name');
    candidate.name = name;
    if (candidate.rootDocument.kind === 'part') studioV5RootPart(candidate).name = name;
    else studioV5RootAssembly(candidate).name = name;
  } else if (kind === 'project.setUnits') {
    if (input.units !== 'mm' && input.units !== 'in') fail('INVALID_UNITS', 'Project units must be "mm" or "in".');
    candidate.units = input.units;
  } else if (kind === 'project.clear') {
    const cleared = createEmptyStudioV5PartProject({
      projectId: candidate.projectId,
      name: candidate.name,
      units: candidate.units,
    });
    cleared.materials = clone(candidate.materials || []);
    cleared.resources = clone(candidate.resources || []);
    candidate = cleared;
  } else if (kind === 'parameter.create') {
    const parameter = {
      id: input.id ? assertId(input.id, 'operation.input.id') : nextStableId(candidate, 'parameter'),
      name: assertText(input.name, 'operation.input.name'),
      value: assertFiniteOrExpression(input.value, 'operation.input.value'),
      ...(input.description ? { description: String(input.description).slice(0, 2000) } : {}),
    };
    candidate.parameters.push(parameter);
    resultRef = { kind: 'parameter', id: parameter.id, name: parameter.name };
  } else if (kind === 'parameter.update') {
    const parameterId = input.parameterId
      ? resolveReference(input.parameterId, aliases, 'operation.input.parameterId')
      : candidate.parameters.find((entry) => entry.name === input.parameterName)?.id;
    if (!parameterId) fail('MISSING_REFERENCE', 'The requested parameter does not exist.');
    const parameter = findParameter(candidate, parameterId);
    if (input.name != null) parameter.name = assertText(input.name, 'operation.input.name');
    if (input.value != null) parameter.value = assertFiniteOrExpression(input.value, 'operation.input.value');
    if (input.description != null) parameter.description = String(input.description).slice(0, 2000);
    resultRef = { kind: 'parameter', id: parameter.id, name: parameter.name };
  } else if (kind === 'parameter.delete') {
    const parameterId = input.parameterId
      ? resolveReference(input.parameterId, aliases, 'operation.input.parameterId')
      : candidate.parameters.find((entry) => entry.name === input.parameterName)?.id;
    if (!parameterId) fail('MISSING_REFERENCE', 'The requested parameter does not exist.');
    findParameter(candidate, parameterId);
    candidate.parameters = candidate.parameters.filter((entry) => entry.id !== parameterId);
  } else if (kind === 'datum.create') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5Datum(candidate, { id, name: input.name, kind: input.datumKind, definition: clone(input.definition) });
    resultRef = { kind: 'datum', id, name: input.name };
  } else if (kind === 'datum.update') {
    const datumId = resolveReference(input.datumId, aliases, 'operation.input.datumId');
    candidate = updateStudioV5Datum(candidate, datumId, clone(input.patch));
    resultRef = { kind: 'datum', id: datumId };
  } else if (kind === 'datum.delete') {
    candidate = deleteStudioV5Datum(candidate, resolveReference(input.datumId, aliases, 'operation.input.datumId'));
  } else if (kind === 'sketch.profile.create') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5ProfileSketch(candidate, {
      id, name: input.name, planeDatumId: resolveReference(input.planeDatumId, aliases, 'operation.input.planeDatumId'),
      points: clone(input.points), kind: input.curveKind,
    });
    resultRef = { kind: 'sketch', id, name: input.name };
  } else if (kind === 'sketch.path.create') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5PathSketch(candidate, { id, name: input.name, points: clone(input.points), kind: input.curveKind });
    resultRef = { kind: 'sketch', id, name: input.name };
  } else if (kind === 'sketch.advanced.update') {
    const sketchId = resolveReference(input.sketchId, aliases, 'operation.input.sketchId');
    candidate = updateStudioV5AdvancedSketch(candidate, sketchId, clone(input.patch));
    resultRef = { kind: 'sketch', id: sketchId };
  } else if (kind === 'sketch.advanced.delete') {
    candidate = deleteStudioV5AdvancedSketch(candidate, resolveReference(input.sketchId, aliases, 'operation.input.sketchId'));
  } else if (kind === 'body.transform') {
    const id = assertId(input.id, 'operation.input.id');
    const transform = clone(input.transform);
    for (const key of ['axisDatumId', 'planeDatumId', 'fromDatumId', 'toDatumId']) {
      if (transform[key] != null) transform[key] = resolveReference(transform[key], aliases, 'operation.input.transform.' + key);
    }
    candidate = createStudioV5TransformFeature(candidate, {
      ...clone(input), id, bodyId: resolveReference(input.bodyId, aliases, 'operation.input.bodyId'), transform,
    });
    resultRef = { kind: 'feature', id, name: input.name || 'Transform' };
  } else if (kind === 'transform.update') {
    const featureId = resolveReference(input.featureId, aliases, 'operation.input.featureId');
    candidate = updateStudioV5TransformFeature(candidate, featureId, clone(input.patch));
    resultRef = { kind: 'feature', id: featureId };
  } else if (kind === 'feature.reorder') {
    const featureId = resolveReference(input.featureId, aliases, 'operation.input.featureId');
    candidate = reorderStudioV5Feature(candidate, featureId, resolveOptionalReference(input.beforeFeatureId, aliases, 'operation.input.beforeFeatureId'));
    resultRef = { kind: 'feature', id: featureId };
  } else if (kind === 'feature.rollback') {
    candidate = setStudioV5RollbackMarker(candidate, resolveOptionalReference(input.featureId, aliases, 'operation.input.featureId'));
  } else if (kind === 'feature.loft') {
    const id = assertId(input.id, 'operation.input.id');
    const sections = input.sections.map((section, index) => typeof section === 'string' || section?.alias
      ? resolveReference(section, aliases, 'operation.input.sections[' + index + ']')
      : { ...clone(section), sketchId: resolveReference(section.sketchId, aliases, 'operation.input.sections[' + index + '].sketchId') });
    candidate = createStudioV5LoftFeature(candidate, {
      ...clone(input), id, sections,
      guideSketchIds: input.guideSketchIds ? resolveReferenceArray(input.guideSketchIds, aliases, 'operation.input.guideSketchIds') : [],
      centerlineSketchId: resolveOptionalReference(input.centerlineSketchId, aliases, 'operation.input.centerlineSketchId'),
      targetBodyId: resolveOptionalReference(input.targetBodyId, aliases, 'operation.input.targetBodyId'),
    });
    resultRef = { kind: 'feature', id, name: input.name || 'Loft' };
  } else if (kind === 'feature.sweep') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5SweepFeature(candidate, {
      ...clone(input), id,
      profileSketchId: resolveReference(input.profileSketchId, aliases, 'operation.input.profileSketchId'),
      pathSketchId: resolveReference(input.pathSketchId, aliases, 'operation.input.pathSketchId'),
      guideSketchId: resolveOptionalReference(input.guideSketchId, aliases, 'operation.input.guideSketchId'),
      targetBodyId: resolveOptionalReference(input.targetBodyId, aliases, 'operation.input.targetBodyId'),
    });
    resultRef = { kind: 'feature', id, name: input.name || 'Sweep' };
  } else if (kind === 'feature.revolveProfile') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5RevolveFeature(candidate, {
      ...clone(input), id,
      profileSketchId: resolveReference(input.profileSketchId, aliases, 'operation.input.profileSketchId'),
      axisDatumId: resolveReference(input.axisDatumId, aliases, 'operation.input.axisDatumId'),
      targetBodyId: resolveOptionalReference(input.targetBodyId, aliases, 'operation.input.targetBodyId'),
    });
    resultRef = { kind: 'feature', id, name: input.name || 'Revolve' };
  } else if (kind === 'feature.draft') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5DraftFeature(candidate, {
      ...clone(input), id, bodyId: resolveReference(input.bodyId, aliases, 'operation.input.bodyId'),
      neutralPlaneDatumId: resolveReference(input.neutralPlaneDatumId, aliases, 'operation.input.neutralPlaneDatumId'),
      faces: clone(input.faceRefs || input.faces || []),
    });
    resultRef = { kind: 'feature', id, name: input.name || 'Draft' };
  } else if (kind === 'feature.thicken') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5ThickenFeature(candidate, {
      ...clone(input), id, bodyId: resolveReference(input.bodyId, aliases, 'operation.input.bodyId'),
      faces: clone(input.faceRefs || input.faces || []), symmetric: input.direction === 'symmetric', flip: input.direction === 'inside',
    });
    resultRef = { kind: 'feature', id, name: input.name || 'Thicken' };
  } else if (kind === 'feature.variableFillet') {
    const id = assertId(input.id, 'operation.input.id');
    const radii = clone(input.variableRadii || input.radii || []);
    candidate = createStudioV5VariableFilletFeature(candidate, {
      ...clone(input), id, bodyId: resolveReference(input.bodyId, aliases, 'operation.input.bodyId'),
      edges: clone(input.edgeRefs || input.edges || []), radii,
      startRadius: radii[0]?.startRadius, endRadius: radii[0]?.endRadius,
    });
    resultRef = { kind: 'feature', id, name: input.name || 'Variable Fillet' };
  } else if (kind === 'feature.advanced.update') {
    const featureId = resolveReference(input.featureId, aliases, 'operation.input.featureId');
    candidate = updateStudioV5AdvancedFeature(candidate, featureId, clone(input.patch));
    resultRef = { kind: 'feature', id: featureId };
  } else if (kind.startsWith('feature.') && ['feature.extrude', 'feature.cut', 'feature.revolve', 'feature.fillet', 'feature.chamfer', 'feature.shell'].includes(kind)) {
    const feature = featureFromOperation(candidate, kind, input, aliases);
    candidate = configureStudioV5Feature(candidate, feature, { resultPolicy: feature.resultPolicy, bodyName: feature.resultPolicy?.bodyName || input.bodyName });
    resultRef = { kind: 'feature', id: feature.id, name: feature.name };
  } else if (kind === 'feature.update') {
    const featureId = resolveReference(input.featureId, aliases, 'operation.input.featureId');
    const feature = clone(findFeature(candidate, featureId));
    const patch = assertRecord(input.patch, 'operation.input.patch');
    const allowed = new Set(['name', 'h', 'through', 'r', 't', 'edges', 'faces', 'sketch', 'pattern', 'resultPolicy', 'inputRefs', 'onFace']);
    for (const key of Object.keys(patch)) if (!allowed.has(key)) fail('INVALID_PATCH', 'Feature field "' + key + '" is not editable through protocol v1.');
    Object.assign(feature, clone(patch));
    if (patch.pattern === null) delete feature.pattern;
    if (patch.onFace === null) delete feature.onFace;
    candidate = replaceFeature(candidate, feature);
    resultRef = { kind: 'feature', id: feature.id, name: feature.name };
  } else if (kind === 'feature.suppress') {
    const featureId = resolveReference(input.featureId, aliases, 'operation.input.featureId');
    const feature = clone(findFeature(candidate, featureId));
    if (typeof input.suppressed !== 'boolean') fail('INVALID_REQUEST', 'operation.input.suppressed must be a boolean.');
    feature.suppressed = input.suppressed;
    candidate = replaceFeature(candidate, feature);
    resultRef = { kind: 'feature', id: feature.id, name: feature.name };
  } else if (kind === 'feature.delete') {
    candidate = deleteFeature(candidate, resolveReference(input.featureId, aliases, 'operation.input.featureId'));
  } else if (kind === 'body.activate') {
    const bodyId = resolveReference(input.bodyId, aliases, 'operation.input.bodyId');
    findBody(candidate, bodyId);
    candidate = updateStudioV5Body(candidate, bodyId, { active: true });
    resultRef = { kind: 'body', id: bodyId };
  } else if (kind === 'body.rename') {
    const bodyId = resolveReference(input.bodyId, aliases, 'operation.input.bodyId');
    findBody(candidate, bodyId);
    const name = assertText(input.name, 'operation.input.name');
    candidate = updateStudioV5Body(candidate, bodyId, { name });
    resultRef = { kind: 'body', id: bodyId, name };
  } else if (kind === 'body.setVisibility') {
    const bodyId = resolveReference(input.bodyId, aliases, 'operation.input.bodyId');
    findBody(candidate, bodyId);
    if (typeof input.visible !== 'boolean') fail('INVALID_REQUEST', 'operation.input.visible must be a boolean.');
    candidate = updateStudioV5Body(candidate, bodyId, { visible: input.visible });
    resultRef = { kind: 'body', id: bodyId };
  } else if (kind === 'body.suppress') {
    const bodyId = resolveReference(input.bodyId, aliases, 'operation.input.bodyId');
    findBody(candidate, bodyId);
    if (typeof input.suppressed !== 'boolean') fail('INVALID_REQUEST', 'operation.input.suppressed must be a boolean.');
    candidate = updateStudioV5Body(candidate, bodyId, { suppressed: input.suppressed });
    resultRef = { kind: 'body', id: bodyId };
  } else if (kind === 'body.delete') {
    const bodyId = resolveReference(input.bodyId, aliases, 'operation.input.bodyId');
    findBody(candidate, bodyId);
    candidate = deleteStudioV5Body(candidate, bodyId);
  } else if (kind === 'pattern.create') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5BodyPattern(candidate, {
      ...clone(input), ...clone(input.definition || {}), id,
      sourceBodyId: resolveReference(input.sourceBodyId, aliases, 'operation.input.sourceBodyId'),
      directionDatumId: resolveOptionalReference(input.directionDatumId, aliases, 'operation.input.directionDatumId'),
      directionDatumIds: input.directionDatumIds ? resolveReferenceArray(input.directionDatumIds, aliases, 'operation.input.directionDatumIds') : undefined,
      axisDatumId: resolveOptionalReference(input.axisDatumId, aliases, 'operation.input.axisDatumId'),
      pathSketchId: resolveOptionalReference(input.pathSketchId, aliases, 'operation.input.pathSketchId'),
      planeDatumId: resolveOptionalReference(input.planeDatumId, aliases, 'operation.input.planeDatumId'),
    });
    resultRef = { kind: 'body-pattern', id, name: input.name || input.kind + ' pattern' };
  } else if (kind === 'pattern.update') {
    const patternId = resolveReference(input.patternId, aliases, 'operation.input.patternId');
    candidate = updateStudioV5BodyPattern(candidate, patternId, clone(input.patch));
    resultRef = { kind: 'body-pattern', id: patternId };
  } else if (kind === 'pattern.delete') {
    candidate = deleteStudioV5BodyPattern(candidate, resolveReference(input.patternId, aliases, 'operation.input.patternId'));
  } else if (kind === 'pattern.materialize') {
    const patternId = resolveReference(input.patternId, aliases, 'operation.input.patternId');
    candidate = materializeStudioV5PatternOccurrences(candidate, patternId, clone(input.records), { dissolve: input.dissolve === true });
  } else if (kind === 'assembly.create') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5AssemblyFromPart(candidate, { ...clone(input), id, occurrenceId: assertId(input.occurrenceId, 'operation.input.occurrenceId') });
    resultRef = { kind: 'assembly', id, name: input.name || 'Assembly' };
  } else if (kind === 'document.activate') {
    const definition = resolveDefinition(input.definition, aliases, 'operation.input.definition');
    const exists = definition.kind === 'part'
      ? candidate.partDefinitions.some((entry) => entry.id === definition.partId)
      : candidate.assemblyDefinitions.some((entry) => entry.id === definition.assemblyId);
    if (!exists) fail('MISSING_REFERENCE', 'The requested active document definition does not exist.');
    candidate.rootDocument = definition;
    delete candidate.metadata.editContext;
  } else if (kind === 'assembly.context.enter') {
    candidate = enterStudioV5AssemblyContext(candidate, resolveReference(input.occurrenceId, aliases, 'operation.input.occurrenceId'));
  } else if (kind === 'assembly.context.exit') {
    candidate = exitStudioV5AssemblyContext(candidate);
  } else if (kind === 'component.createPart') {
    const partId = assertId(input.partId, 'operation.input.partId');
    const occurrenceId = assertId(input.occurrenceId, 'operation.input.occurrenceId');
    if (candidate.partDefinitions.some((entry) => entry.id === partId)) fail('DUPLICATE_ID', 'Part ID "' + partId + '" is already in use.');
    candidate.partDefinitions.push({
      id: partId, name: assertText(input.name, 'operation.input.name'), parameters: [], referenceGeometry: [], sketches: [],
      bodies: [], bodyPatterns: [], features: [], featureOrder: [], metadata: {},
    });
    candidate = createStudioV5ComponentOccurrence(candidate, {
      id: occurrenceId, name: input.occurrenceName || input.name, definition: { kind: 'part', partId },
      baseTransform: input.baseTransform, fixed: input.fixed === true, visible: true,
    });
    if (input.enterContext === true) candidate = enterStudioV5AssemblyContext(candidate, occurrenceId);
    resultRef = { kind: 'part', id: partId, name: input.name };
  } else if (kind === 'component.insert') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5ComponentOccurrence(candidate, { ...clone(input), id, definition: resolveDefinition(input.definition, aliases, 'operation.input.definition') });
    resultRef = { kind: 'occurrence', id, name: input.name || 'Component' };
  } else if (kind === 'component.update') {
    const occurrenceId = resolveReference(input.occurrenceId, aliases, 'operation.input.occurrenceId');
    candidate = updateStudioV5ComponentOccurrence(candidate, occurrenceId, clone(input.patch));
    resultRef = { kind: 'occurrence', id: occurrenceId };
  } else if (kind === 'component.duplicate') {
    const occurrenceId = resolveReference(input.occurrenceId, aliases, 'operation.input.occurrenceId');
    const id = assertId(input.id, 'operation.input.id');
    candidate = duplicateStudioV5LinkedOccurrence(candidate, occurrenceId, { ...clone(input), id });
    resultRef = { kind: 'occurrence', id, name: input.name || 'Linked component' };
  } else if (kind === 'component.makeIndependent') {
    const occurrenceId = resolveReference(input.occurrenceId, aliases, 'operation.input.occurrenceId');
    candidate = makeStudioV5OccurrenceIndependent(candidate, occurrenceId, { ...clone(input), partId: assertId(input.partId, 'operation.input.partId') });
    resultRef = { kind: 'part', id: input.partId, name: input.name || 'Independent part' };
  } else if (kind === 'component.replace') {
    const occurrenceId = resolveReference(input.occurrenceId, aliases, 'operation.input.occurrenceId');
    candidate = replaceStudioV5ComponentOccurrence(candidate, occurrenceId, resolveDefinition(input.definition, aliases, 'operation.input.definition'));
    resultRef = { kind: 'occurrence', id: occurrenceId };
  } else if (kind === 'component.delete') {
    candidate = deleteStudioV5ComponentOccurrence(candidate, resolveReference(input.occurrenceId, aliases, 'operation.input.occurrenceId'));
  } else if (kind === 'component.pattern') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5OccurrencePattern(candidate, {
      ...clone(input), id, sourceOccurrenceIds: resolveReferenceArray(input.sourceOccurrenceIds, aliases, 'operation.input.sourceOccurrenceIds'),
    });
    resultRef = { kind: 'occurrence-pattern', id, name: input.name || 'Component pattern' };
  } else if (kind === 'component.pattern.update') {
    const patternId = resolveReference(input.patternId, aliases, 'operation.input.patternId');
    const patch = clone(input.patch);
    if (patch.sourceOccurrenceIds) patch.sourceOccurrenceIds = resolveReferenceArray(patch.sourceOccurrenceIds, aliases, 'operation.input.patch.sourceOccurrenceIds');
    candidate = updateStudioV5OccurrencePattern(candidate, patternId, patch);
    resultRef = { kind: 'occurrence-pattern', id: patternId };
  } else if (kind === 'component.pattern.delete') {
    candidate = deleteStudioV5OccurrencePattern(candidate, resolveReference(input.patternId, aliases, 'operation.input.patternId'));
  } else if (kind === 'mate.create') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5AssemblyMate(candidate, {
      ...clone(input), id, kind: input.mateKind,
      occurrenceIds: resolveReferenceArray(input.occurrenceIds, aliases, 'operation.input.occurrenceIds'),
    });
    resultRef = { kind: 'mate', id, name: input.name || input.mateKind + ' mate' };
  } else if (kind === 'mate.update') {
    const mateId = resolveReference(input.mateId, aliases, 'operation.input.mateId');
    candidate = updateStudioV5AssemblyMate(candidate, mateId, clone(input.patch));
    resultRef = { kind: 'mate', id: mateId };
  } else if (kind === 'mate.delete') {
    candidate = deleteStudioV5AssemblyMate(candidate, resolveReference(input.mateId, aliases, 'operation.input.mateId'));
  } else if (kind === 'section.create') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5SectionView(candidate, {
      ...clone(input), id,
      scopeOccurrenceIds: input.scopeOccurrenceIds ? resolveReferenceArray(input.scopeOccurrenceIds, aliases, 'operation.input.scopeOccurrenceIds') : [],
    });
    resultRef = { kind: 'section', id, name: input.name };
  } else if (kind === 'section.update') {
    const sectionId = resolveReference(input.sectionId, aliases, 'operation.input.sectionId');
    candidate = updateStudioV5SectionView(candidate, sectionId, clone(input.patch));
    resultRef = { kind: 'section', id: sectionId };
  } else if (kind === 'section.activate') {
    candidate = activateStudioV5SectionView(candidate, resolveOptionalReference(input.sectionId, aliases, 'operation.input.sectionId'));
  } else if (kind === 'section.delete') {
    candidate = deleteStudioV5SectionView(candidate, resolveReference(input.sectionId, aliases, 'operation.input.sectionId'));
  } else if (kind === 'exploded.create') {
    const id = assertId(input.id, 'operation.input.id');
    const steps = clone(input.steps).map((step, index) => ({
      ...step, occurrenceIds: resolveReferenceArray(step.occurrenceIds, aliases, 'operation.input.steps[' + index + '].occurrenceIds'),
    }));
    candidate = createStudioV5ExplodedView(candidate, { ...clone(input), id, steps });
    resultRef = { kind: 'exploded-view', id, name: input.name };
  } else if (kind === 'exploded.activate') {
    candidate = activateStudioV5ExplodedView(candidate, resolveOptionalReference(input.explodedViewId, aliases, 'operation.input.explodedViewId'));
  } else if (kind === 'exploded.delete') {
    candidate = deleteStudioV5ExplodedView(candidate, resolveReference(input.explodedViewId, aliases, 'operation.input.explodedViewId'));
  } else if (kind === 'measurement.create') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5Measurement(candidate, { ...clone(input), id, kind: input.measurementKind });
    resultRef = { kind: 'measurement', id, name: input.name };
  } else if (kind === 'measurement.update') {
    const measurementId = resolveReference(input.measurementId, aliases, 'operation.input.measurementId');
    candidate = updateStudioV5Measurement(candidate, measurementId, clone(input.patch));
    resultRef = { kind: 'measurement', id: measurementId };
  } else if (kind === 'measurement.delete') {
    candidate = deleteStudioV5Measurement(candidate, resolveReference(input.measurementId, aliases, 'operation.input.measurementId'));
  } else if (kind === 'display.setMode') {
    candidate = setStudioV5DisplayMode(candidate, input.mode);
  } else if (kind === 'material.ensureGeneric') {
    candidate = ensureStudioV5GenericMaterials(candidate);
  } else if (kind === 'material.assignBody') {
    candidate = assignStudioV5BodyMaterial(candidate,
      resolveReference(input.partId, aliases, 'operation.input.partId'),
      resolveReference(input.bodyId, aliases, 'operation.input.bodyId'),
      resolveReference(input.materialId, aliases, 'operation.input.materialId'));
  } else if (kind === 'appearance.assignOccurrence') {
    candidate = assignStudioV5OccurrenceAppearance(candidate,
      resolveReference(input.occurrenceId, aliases, 'operation.input.occurrenceId'),
      assertId(input.appearanceId, 'operation.input.appearanceId'));
  } else if (kind === 'stage.create') {
    const id = assertId(input.id, 'operation.input.id');
    candidate = createStudioV5AxialStageGroup(candidate, {
      ...clone(input), id,
      occurrenceIds: resolveReferenceArray(input.occurrenceIds, aliases, 'operation.input.occurrenceIds'),
      distanceMateIds: resolveReferenceArray(input.distanceMateIds, aliases, 'operation.input.distanceMateIds'),
    });
    resultRef = { kind: 'stage-group', id, name: input.name };
  } else if (kind === 'stage.update') {
    const groupId = resolveReference(input.groupId, aliases, 'operation.input.groupId');
    candidate = updateStudioV5AxialStageGroup(candidate, groupId, clone(input.patch));
    resultRef = { kind: 'stage-group', id: groupId };
  } else if (kind === 'stage.delete') {
    candidate = deleteStudioV5AxialStageGroup(candidate, resolveReference(input.groupId, aliases, 'operation.input.groupId'));
  } else if (kind === 'pattern.linear' || kind === 'pattern.circular' || kind === 'pattern.dissolve') {
    const featureId = resolveReference(input.featureId, aliases, 'operation.input.featureId');
    const feature = clone(findFeature(candidate, featureId));
    if (kind === 'pattern.dissolve') delete feature.pattern;
    else if (kind === 'pattern.linear') {
      feature.pattern = {
        kind: 'linear',
        n: assertInteger(input.count, 'operation.input.count', 1, 100),
        dx: assertFiniteOrExpression(input.dx ?? 0, 'operation.input.dx'),
        dy: assertFiniteOrExpression(input.dy ?? 0, 'operation.input.dy'),
      };
    } else {
      feature.pattern = {
        kind: 'circular',
        n: assertInteger(input.count, 'operation.input.count', 1, 100),
        cx: assertFiniteOrExpression(input.cx ?? 0, 'operation.input.cx'),
        cy: assertFiniteOrExpression(input.cy ?? 0, 'operation.input.cy'),
      };
    }
    candidate = replaceFeature(candidate, feature);
    resultRef = { kind: 'feature', id: feature.id, name: feature.name };
  } else if (kind === 'boolean.split') {
    const targetBodyId = resolveReference(input.targetBodyId, aliases, 'operation.input.targetBodyId');
    const toolSource = input.toolBodyId ?? input.toolBodyIds?.[0];
    const toolBodyId = resolveReference(toolSource, aliases, 'operation.input.toolBodyId');
    const id = input.id ? assertId(input.id, 'operation.input.id') : nextStableId(candidate, 'feature-boolean-split');
    candidate = createStudioV5BooleanSplit(candidate, {
      id, name: input.name, targetBodyId, toolBodyId, keepTools: input.keepTools !== false,
      keepOriginal: input.keepOriginal === true,
      outsideName: input.bodyNames?.[0], insideName: input.bodyNames?.[1],
    });
    resultRef = { kind: 'feature', id: id + '-outside', name: input.name || 'Boolean Split' };
  } else if (kind.startsWith('boolean.')) {
    const operationName = kind.slice('boolean.'.length);
    const targetBodyId = resolveReference(input.targetBodyId, aliases, 'operation.input.targetBodyId');
    const toolBodyId = resolveReference(input.toolBodyId, aliases, 'operation.input.toolBodyId');
    findBody(candidate, targetBodyId);
    findBody(candidate, toolBodyId);
    const id = input.id ? assertId(input.id, 'operation.input.id') : nextStableId(candidate, 'feature-boolean-' + operationName);
    if (input.keepTools != null && typeof input.keepTools !== 'boolean') fail('INVALID_REQUEST', 'operation.input.keepTools must be a boolean.');
    candidate = createStudioV5BooleanFeature(candidate, {
      id,
      name: input.name,
      operation: operationName === 'union' ? 'add' : operationName,
      targetBodyId,
      toolBodyId,
      keepTools: input.keepTools !== false,
    });
    resultRef = { kind: 'feature', id, name: input.name || operationName };
  }

  candidate = prepareStudioV5RuntimeProject(candidate);
  if (op.alias) {
    const alias = assertText(op.alias, 'operation.alias');
    if (aliases[alias]) fail('DUPLICATE_ALIAS', 'Transaction alias "' + alias + '" is already defined.');
    if (!resultRef) fail('INVALID_ALIAS', 'Operation "' + kind + '" does not create or select an addressable result.');
    aliases[alias] = resultRef;
  }
  return candidate;
}

export function applyCadTransaction(project, transaction) {
  if (!isStudioV5Project(project)) fail('UNSUPPORTED_DOCUMENT', 'Agent protocol v1 requires a schema-5 CAD project.');
  const tx = assertRecord(transaction, 'transaction');
  assertText(tx.transactionId, 'transaction.transactionId');
  assertText(tx.label, 'transaction.label');
  if (tx.atomic !== true) fail('ATOMIC_REQUIRED', 'Protocol v1 transactions must set atomic to true.');
  if (!Array.isArray(tx.operations) || tx.operations.length < 1 || tx.operations.length > MAX_TRANSACTION_OPERATIONS) {
    fail('LIMIT_OPERATIONS', 'A transaction must contain 1 to ' + MAX_TRANSACTION_OPERATIONS + ' operations.');
  }
  const aliases = {};
  let candidate = canonicalStudioV5Project(project);
  for (let index = 0; index < tx.operations.length; index++) {
    try {
      candidate = applyOperation(candidate, tx.operations[index], aliases);
    } catch (error) {
      if (error instanceof CadAgentError) {
        error.details = { ...(error.details || {}), operationIndex: index };
        throw error;
      }
      throw new CadAgentError(error?.code || 'DOCUMENT_VALIDATION_FAILED', String(error?.message || error), { operationIndex: index });
    }
  }
  candidate = prepareStudioV5RuntimeProject(candidate);
  return { project: candidate, aliases, changeSet: semanticChangeSet(project, candidate, aliases) };
}

function paginate(items, request = {}) {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(request.pageSize) || DEFAULT_PAGE_SIZE));
  const offset = request.cursor == null ? 0 : assertInteger(Number(request.cursor), 'cursor', 0);
  return {
    items: items.slice(offset, offset + pageSize),
    total: items.length,
    nextCursor: offset + pageSize < items.length ? String(offset + pageSize) : null,
  };
}

function dependencyGraph(project) {
  const edges = [];
  for (const part of project.partDefinitions || []) {
    for (const feature of part.features) {
      for (const ref of feature.inputRefs || []) edges.push({ from: { kind: ref.ownerKind, id: ref.ownerId }, to: { kind: 'feature', id: feature.id }, relation: 'input' });
      for (const bodyId of feature.resultPolicy?.targetBodyIds || []) edges.push({ from: { kind: 'feature', id: feature.id }, to: { kind: 'body', id: bodyId }, relation: 'modifies' });
      if (feature.createdBodyId) edges.push({ from: { kind: 'feature', id: feature.id }, to: { kind: 'body', id: feature.createdBodyId }, relation: 'creates' });
      for (const bodyId of feature.toolBodyIds || []) edges.push({ from: { kind: 'body', id: bodyId }, to: { kind: 'feature', id: feature.id }, relation: 'tool' });
    }
    for (const pattern of part.bodyPatterns || []) edges.push({ from: { kind: 'body', id: pattern.sourceBodyId }, to: { kind: 'body-pattern', id: pattern.id }, relation: 'patterns' });
  }
  for (const assembly of project.assemblyDefinitions || []) {
    for (const occurrence of assembly.occurrences || []) edges.push({
      from: occurrence.definition.kind === 'part'
        ? { kind: 'part', id: occurrence.definition.partId }
        : { kind: 'assembly', id: occurrence.definition.assemblyId },
      to: { kind: 'occurrence', id: occurrence.id }, relation: 'instantiates',
    });
    for (const mate of assembly.mates || []) for (const occurrenceId of mate.occurrenceIds || []) {
      edges.push({ from: { kind: 'occurrence', id: occurrenceId }, to: { kind: 'mate', id: mate.id }, relation: 'constrains' });
    }
  }
  return edges;
}

function cacheResponse(cache, key, response) {
  if (!cache.has(key) && cache.size >= MAX_REQUEST_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, clone(response));
}

export class CadCommandService {
  constructor(options = {}) {
    const project = options.project || createEmptyStudioV5PartProject({ projectId: options.projectId || 'project-agent-1', name: options.name || 'Agent part', units: options.units || 'mm' });
    this.project = prepareStudioV5RuntimeProject(project);
    this.revision = Number.isInteger(options.revision) ? options.revision : 0;
    this.kernel = options.kernel || null;
    this.commitAdapter = options.commitAdapter || null;
    this.visibleStudio = options.visibleStudio === true;
    this.previewTtlMs = options.previewTtlMs || DEFAULT_PREVIEW_TTL_MS;
    this.now = options.now || (() => Date.now());
    this.previews = new Map();
    this.requestCache = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.journal = [];
    this.previewSequence = 0;
    this.commitCount = 0;
    this.lastEvidence = evidenceFromKernel(null, false);
  }

  snapshot() {
    return canonicalStudioV5Project(this.project);
  }

  previewSnapshot(previewId, expectedRevision) {
    this.prunePreviews();
    const requestedRevision = assertInteger(expectedRevision, 'expectedRevision', 0);
    if (requestedRevision !== this.revision) {
      fail('REVISION_CONFLICT', 'The requested preview targets an older project revision.', {
        expectedRevision: requestedRevision,
        actualRevision: this.revision,
      });
    }
    const preview = this.previews.get(assertText(previewId, 'previewId'));
    if (!preview) fail('PREVIEW_EXPIRED', 'The requested preview does not exist or has expired.');
    if (preview.baseRevision !== this.revision) {
      this.previews.delete(previewId);
      fail('REVISION_CONFLICT', 'The project changed after this preview was created.', {
        expectedRevision: preview.baseRevision,
        actualRevision: this.revision,
      });
    }
    return {
      previewId: preview.previewId,
      baseRevision: preview.baseRevision,
      project: canonicalStudioV5Project(preview.project),
      evidence: clone(preview.evidence),
      documentHash: preview.changeSet.documentHashAfter,
      expiresAt: new Date(preview.expiresAtMs).toISOString(),
    };
  }

  synchronize(project, revision, entry = null) {
    this.project = prepareStudioV5RuntimeProject(project);
    this.revision = assertInteger(revision, 'revision', 0);
    this.previews.clear();
    if (entry) this.journal.push({ revision: this.revision, ...clone(entry), documentHash: studioV5CanonicalHash(this.project) });
    return this.snapshot();
  }

  capabilities(query = { detail: 'full' }) {
    return selectCadCapabilities(
      cadCapabilityManifest({ exactKernel: Boolean(this.kernel), visibleStudio: this.visibleStudio }),
      query,
    );
  }

  inspect(request = {}) {
    const kind = request.kind || 'project.summary';
    const project = this.project;
    const activePart = project.rootDocument.kind === 'part' ? studioV5RootPart(project) : null;
    const activeAssembly = project.rootDocument.kind === 'assembly' ? studioV5RootAssembly(project) : null;
    const allFeatures = project.partDefinitions.flatMap((part) => part.features || []);
    const allBodies = project.partDefinitions.flatMap((part) => part.bodies || []);
    const allOccurrences = project.assemblyDefinitions.flatMap((assembly) => assembly.occurrences || []);
    const allMates = project.assemblyDefinitions.flatMap((assembly) => assembly.mates || []);
    if (kind === 'project.summary') {
      return {
        projectId: project.projectId,
        revision: this.revision,
        name: project.name,
        units: project.units,
        schemaVersion: project.schemaVersion,
        documentKind: project.rootDocument.kind,
        counts: {
          parameters: project.parameters.length,
          parts: project.partDefinitions.length,
          assemblies: project.assemblyDefinitions.length,
          features: allFeatures.length,
          bodies: allBodies.length,
          occurrences: allOccurrences.length,
          mates: allMates.length,
        },
        activeBodyId: activePart?.metadata?.activeBodyId || null,
        activeAssemblyId: activeAssembly?.id || null,
        documentHash: studioV5CanonicalHash(project),
      };
    }
    if (kind === 'project.tree') {
      const nodes = [
        { kind: 'project', id: project.projectId, name: project.name, parent: null },
        ...project.parameters.map((entry) => ({ kind: 'parameter', id: entry.id, name: entry.name, parent: { kind: 'project', id: project.projectId } })),
        ...project.partDefinitions.flatMap((part) => [
          { kind: 'part', id: part.id, name: part.name, parent: { kind: 'project', id: project.projectId } },
          ...part.referenceGeometry.map((entry) => ({ kind: 'datum', id: entry.id, name: entry.name, datumKind: entry.kind, parent: { kind: 'part', id: part.id } })),
          ...part.sketches.map((entry) => ({ kind: 'sketch', id: entry.id, name: entry.name, role: entry.extensions?.studioRole, parent: { kind: 'part', id: part.id } })),
          ...part.bodies.map((entry) => ({ kind: 'body', id: entry.id, name: entry.name, visible: entry.visible, suppressed: entry.suppressed, parent: { kind: 'part', id: part.id } })),
          ...part.features.map((entry) => ({ kind: 'feature', id: entry.id, name: entry.name, featureType: entry.type, suppressed: entry.suppressed, parent: { kind: 'part', id: part.id } })),
          ...(part.bodyPatterns || []).map((entry) => ({ kind: 'body-pattern', id: entry.id, name: entry.name, patternKind: entry.kind, parent: { kind: 'part', id: part.id } })),
        ]),
        ...project.assemblyDefinitions.flatMap((assembly) => [
          { kind: 'assembly', id: assembly.id, name: assembly.name, parent: { kind: 'project', id: project.projectId } },
          ...assembly.occurrences.map((entry) => ({ kind: 'occurrence', id: entry.id, name: entry.name, definition: clone(entry.definition), visible: entry.visible, suppressed: entry.suppressed, parent: { kind: 'assembly', id: assembly.id } })),
          ...assembly.mates.map((entry) => ({ kind: 'mate', id: entry.id, name: entry.name, mateKind: entry.kind, suppressed: entry.suppressed, parent: { kind: 'assembly', id: assembly.id } })),
          ...(assembly.occurrencePatterns || []).map((entry) => ({ kind: 'occurrence-pattern', id: entry.id, name: entry.name, patternKind: entry.kind, parent: { kind: 'assembly', id: assembly.id } })),
          ...(assembly.sectionViews || []).map((entry) => ({ kind: 'section', id: entry.id, name: entry.name, sectionKind: entry.kind, parent: { kind: 'assembly', id: assembly.id } })),
          ...(assembly.explodedViews || []).map((entry) => ({ kind: 'exploded-view', id: entry.id, name: entry.name, parent: { kind: 'assembly', id: assembly.id } })),
          ...(assembly.metadata?.measurements || []).map((entry) => ({ kind: 'measurement', id: entry.id, name: entry.name, measurementKind: entry.kind, parent: { kind: 'assembly', id: assembly.id } })),
          ...(assembly.metadata?.axialStageGroups || []).map((entry) => ({ kind: 'stage-group', id: entry.id, name: entry.name, parent: { kind: 'assembly', id: assembly.id } })),
        ]),
      ];
      return paginate(nodes, request);
    }
    if (kind === 'entity.detail') {
      const entityKind = assertText(request.entity?.kind, 'entity.kind');
      const entityId = assertId(request.entity?.id, 'entity.id');
      const entry = canonicalEntityMap(project).get(entityKind + ':' + entityId);
      if (!entry) fail('MISSING_REFERENCE', entityKind + ' "' + entityId + '" does not exist.');
      return { entity: changedEntity(entry), value: clone(entry.value) };
    }
    if (kind === 'entity.dependencies') {
      const edges = dependencyGraph(project);
      if (!request.entity) return paginate(edges, request);
      const entityKind = assertText(request.entity.kind, 'entity.kind');
      const entityId = assertId(request.entity.id, 'entity.id');
      return paginate(edges.filter((edge) => (edge.from.kind === entityKind && edge.from.id === entityId) || (edge.to.kind === entityKind && edge.to.id === entityId)), request);
    }
    if (kind === 'entity.search') {
      const query = String(request.query || '').trim().toLowerCase();
      const matches = [...canonicalEntityMap(project).values()]
        .filter((entry) => !query || entry.id.toLowerCase().includes(query) || String(entry.value?.name || '').toLowerCase().includes(query))
        .map(changedEntity);
      return paginate(matches, request);
    }
    if (kind === 'history.list') return paginate(this.journal.slice().reverse(), request);
    if (kind === 'history.changesSince') {
      const revision = assertInteger(request.revision, 'revision', 0);
      return paginate(this.journal.filter((entry) => entry.revision > revision), request);
    }
    fail('UNKNOWN_QUERY', 'Unknown inspection query "' + kind + '".');
  }

  async query(request = {}) {
    const kind = request.kind || 'geometry.validity';
    if (kind === 'geometry.bodies' || kind === 'geometry.validity') {
      let evidence = this.lastEvidence;
      if (request.exact === true) {
        if (!this.kernel) fail('EXACT_KERNEL_REQUIRED', 'This session has no exact-kernel adapter.');
        const response = await this.kernel.validate(this.snapshot(), this.revision);
        if (response?.errors?.length) fail('KERNEL_VALIDATION_FAILED', response.errors[0].message, { kernelErrors: response.errors });
        evidence = evidenceFromKernel(response, true);
        this.lastEvidence = evidence;
      }
      return kind === 'geometry.bodies'
        ? paginate(evidence.bodyResults, request)
        : { exactGeometry: evidence.exactGeometry, valid: evidence.bodyResults.every((entry) => entry.valid), bodies: evidence.bodyResults };
    }
    return this.inspect(request);
  }

  prunePreviews() {
    const now = this.now();
    for (const [id, preview] of this.previews) if (preview.expiresAtMs <= now) this.previews.delete(id);
  }

  async preview(transaction, permissionContext, options = {}) {
    assertPermission(permissionContext, EDIT_PERMISSIONS, this.project.projectId, transaction?.operations?.map((entry) => entry.kind) || []);
    const expectedRevision = assertInteger(transaction?.expectedRevision, 'transaction.expectedRevision', 0);
    if (expectedRevision !== this.revision) fail('REVISION_CONFLICT', 'Expected project revision ' + expectedRevision + ' but current revision is ' + this.revision + '.', {
      expectedRevision,
      actualRevision: this.revision,
      changesSince: this.journal.filter((entry) => entry.revision > expectedRevision).slice(-20),
    });
    const bytes = new TextEncoder().encode(JSON.stringify(transaction)).byteLength;
    if (bytes > MAX_REQUEST_BYTES && options.trustedGenerated !== true) {
      fail('LIMIT_REQUEST_BYTES', 'Transaction exceeds the 1 MiB protocol request limit.');
    }
    let applied;
    try {
      applied = applyCadTransaction(this.project, transaction);
    } catch (error) {
      if (error instanceof CadAgentError) throw error;
      throw new CadAgentError(error?.code || 'DOCUMENT_VALIDATION_FAILED', String(error?.message || error));
    }
    let kernelResponse = null;
    if (this.kernel) {
      kernelResponse = await this.kernel.validate(applied.project, this.revision);
      if (kernelResponse?.errors?.length) fail('KERNEL_VALIDATION_FAILED', kernelResponse.errors[0].message, { kernelErrors: kernelResponse.errors });
    }
    this.prunePreviews();
    const previewId = 'preview-' + (++this.previewSequence) + '-' + applied.changeSet.documentHashAfter;
    const expiresAtMs = this.now() + this.previewTtlMs;
    const preview = {
      previewId,
      transaction: clone(transaction),
      project: applied.project,
      aliases: applied.aliases,
      baseRevision: this.revision,
      expiresAtMs,
      changeSet: applied.changeSet,
      evidence: evidenceFromKernel(kernelResponse, Boolean(this.kernel)),
    };
    this.previews.set(previewId, preview);
    return {
      previewId,
      baseRevision: this.revision,
      expiresAt: new Date(expiresAtMs).toISOString(),
      changeSet: clone(preview.changeSet),
      validation: { valid: true, exactGeometry: Boolean(this.kernel), diagnostics: [] },
      evidence: clone(preview.evidence),
      confirmation: { required: preview.changeSet.deleted.length > 0, reasons: preview.changeSet.deleted.length ? ['DESTRUCTIVE_DELETE'] : [] },
    };
  }

  async commit(previewId, expectedRevision, permissionContext, options = {}) {
    const permission = assertPermission(permissionContext, EDIT_PERMISSIONS, this.project.projectId);
    this.prunePreviews();
    const requestedRevision = assertInteger(expectedRevision, 'expectedRevision', 0);
    if (requestedRevision !== this.revision) {
      fail('REVISION_CONFLICT', 'The project changed after this preview was created.', { expectedRevision: requestedRevision, actualRevision: this.revision });
    }
    const preview = this.previews.get(assertText(previewId, 'previewId'));
    if (!preview) fail('PREVIEW_EXPIRED', 'The requested preview does not exist or has expired.');
    if (preview.baseRevision !== this.revision) {
      this.previews.delete(previewId);
      fail('REVISION_CONFLICT', 'The project changed after this preview was created.', { expectedRevision: preview.baseRevision, actualRevision: this.revision });
    }
    if (Number.isInteger(permission.maxCommits) && this.commitCount >= permission.maxCommits) fail('PERMISSION_BUDGET_EXCEEDED', 'The session commit budget has been exhausted.');
    const before = this.snapshot();
    const entry = {
      label: preview.transaction.label,
      actor: preview.transaction.metadata?.actor || options.actor || 'agent',
      transactionId: preview.transaction.transactionId,
      changeSet: clone(preview.changeSet),
    };
    let committedRevision = this.revision + 1;
    if (this.commitAdapter) {
      const result = await this.commitAdapter({ project: clone(preview.project), baseRevision: this.revision, ...entry });
      if (result?.project) this.project = prepareStudioV5RuntimeProject(result.project);
      else this.project = prepareStudioV5RuntimeProject(preview.project);
      if (Number.isInteger(result?.revision)) committedRevision = result.revision;
    } else {
      this.project = prepareStudioV5RuntimeProject(preview.project);
      this.undoStack.push({ project: before, entry });
      this.redoStack.length = 0;
    }
    this.revision = committedRevision;
    this.commitCount++;
    this.lastEvidence = clone(preview.evidence);
    this.journal.push({ revision: this.revision, ...entry, documentHash: studioV5CanonicalHash(this.project) });
    this.previews.clear();
    return {
      revision: this.revision,
      projectId: this.project.projectId,
      changeSet: clone(preview.changeSet),
      evidence: clone(preview.evidence),
      aliases: clone(preview.aliases),
      historyEntry: { revision: this.revision, label: entry.label, actor: entry.actor, transactionId: entry.transactionId },
    };
  }

  cancelPreview(previewId) {
    const existed = this.previews.delete(previewId);
    return { cancelled: existed };
  }

  async historyAction(request, permissionContext) {
    const action = request.action || 'list';
    if (action === 'list' || action === 'changesSince') {
      assertPermission(permissionContext, READ_PERMISSIONS, this.project.projectId);
      return this.inspect(action === 'list'
        ? { ...request, kind: 'history.list' }
        : { ...request, kind: 'history.changesSince', revision: request.revision });
    }
    assertPermission(permissionContext, EDIT_PERMISSIONS, this.project.projectId);
    if (this.commitAdapter) return this.commitAdapter({ historyAction: action, expectedRevision: request.expectedRevision });
    if (assertInteger(request.expectedRevision, 'expectedRevision', 0) !== this.revision) fail('REVISION_CONFLICT', 'History command targets a stale project revision.');
    if (action === 'undo') {
      const command = this.undoStack.pop();
      if (!command) fail('NOTHING_TO_UNDO', 'There is no command to undo.');
      this.redoStack.push({ project: this.snapshot(), entry: command.entry });
      this.project = prepareStudioV5RuntimeProject(command.project);
    } else if (action === 'redo') {
      const command = this.redoStack.pop();
      if (!command) fail('NOTHING_TO_REDO', 'There is no command to redo.');
      this.undoStack.push({ project: this.snapshot(), entry: command.entry });
      this.project = prepareStudioV5RuntimeProject(command.project);
    } else fail('UNKNOWN_HISTORY_ACTION', 'Unknown history action "' + action + '".');
    this.revision++;
    this.previews.clear();
    this.journal.push({ revision: this.revision, label: action === 'undo' ? 'Undo' : 'Redo', actor: 'agent', documentHash: studioV5CanonicalHash(this.project) });
    return { revision: this.revision, project: this.snapshot(), documentHash: studioV5CanonicalHash(this.project) };
  }

  async request(envelope) {
    const startedAt = this.now();
    let requestId = envelope?.requestId;
    let sessionId = envelope?.sessionId;
    try {
      assertRecord(envelope, 'request');
      if (envelope.protocol !== CAD_AGENT_PROTOCOL) fail('UNSUPPORTED_PROTOCOL', 'This build supports only ' + CAD_AGENT_PROTOCOL + '.');
      requestId = assertText(envelope.requestId, 'request.requestId');
      sessionId = assertText(envelope.sessionId, 'request.sessionId');
      const cacheKey = sessionId + ':' + requestId;
      if (this.requestCache.has(cacheKey)) return clone(this.requestCache.get(cacheKey));
      const payload = assertRecord(envelope.payload, 'request.payload');
      let result;
      if (payload.kind === 'capabilities') result = this.capabilities(payload.capabilityQuery || { detail: 'full' });
      else if (payload.kind === 'inspect') {
        assertPermission(envelope.permissionContext, READ_PERMISSIONS, this.project.projectId);
        result = this.inspect(payload.query || {});
      } else if (payload.kind === 'query') {
        assertPermission(envelope.permissionContext, READ_PERMISSIONS, this.project.projectId);
        result = await this.query(payload.query || {});
      } else if (payload.kind === 'preview') result = await this.preview(payload.transaction, envelope.permissionContext);
      else if (payload.kind === 'commit') result = await this.commit(payload.previewId, envelope.expectedRevision, envelope.permissionContext, payload);
      else if (payload.kind === 'cancelPreview') result = this.cancelPreview(payload.previewId);
      else if (payload.kind === 'history') result = await this.historyAction(payload, envelope.permissionContext);
      else fail('UNKNOWN_REQUEST_KIND', 'Unknown CAD request kind "' + payload.kind + '".');
      const response = {
        protocol: CAD_AGENT_PROTOCOL,
        requestId,
        sessionId,
        projectId: this.project.projectId,
        revision: this.revision,
        status: 'ok',
        result,
        diagnostics: [],
        timing: { totalMs: Math.max(0, this.now() - startedAt) },
      };
      cacheResponse(this.requestCache, cacheKey, response);
      return response;
    } catch (error) {
      const status = error?.code === 'REVISION_CONFLICT' ? 'conflict' : 'error';
      const response = {
        protocol: CAD_AGENT_PROTOCOL,
        requestId: requestId || 'invalid-request',
        sessionId: sessionId || 'invalid-session',
        projectId: this.project.projectId,
        revision: this.revision,
        status,
        diagnostics: [diagnostic(error, error?.details?.operationIndex)],
        timing: { totalMs: Math.max(0, this.now() - startedAt) },
      };
      if (requestId && sessionId) cacheResponse(this.requestCache, sessionId + ':' + requestId, response);
      return response;
    }
  }
}

export function createCadAgentRequest(options) {
  return {
    protocol: CAD_AGENT_PROTOCOL,
    requestId: options.requestId,
    sessionId: options.sessionId,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(Number.isInteger(options.expectedRevision) ? { expectedRevision: options.expectedRevision } : {}),
    permissionContext: clone(options.permissionContext || { granted: [] }),
    payload: clone(options.payload),
  };
}
