// Schema-5 project-boundary checks. This suite is intentionally independent of
// the production Studio UI while V4 still owns the live schema-3 boundary.
//
//   npm run studio:v5:migration

import {
  STUDIO_V5_IDENTITY_MATRIX,
  STUDIO_V5_PROJECT_LIMITS,
  STUDIO_V5_SCHEMA_VERSION,
  StudioV5ProjectError,
  createEmptyStudioV5PartProject,
  migrateStudioPartToV5,
  parseOrMigrateStudioV5Project,
  parseStudioV5Project,
  prepareStudioV5Project,
  studioV5DocumentRefKey,
} from '../static/studio-project-v5.js';
import {
  STUDIO_V5_SCHEMA_VERSION as TYPED_SCHEMA_VERSION,
  STUDIO_V5_IDENTITY_MATRIX as TYPED_IDENTITY_MATRIX,
  type StudioV5Project,
} from '../src/studio-v5-types.ts';

let checks = 0;
let failures = 0;

function check(name: string, ok: boolean, detail?: string): void {
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function errorCode(work: () => unknown): string | undefined {
  try {
    work();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

function deepCopy<T>(value: T): T {
  return structuredClone(value);
}

function partRef(partId = 'part-main') {
  return { kind: 'part' as const, partId };
}

function assemblyRef(assemblyId: string) {
  return { kind: 'assembly' as const, assemblyId };
}

function emptyPart(id = 'part-main') {
  return {
    id,
    name: 'Main part',
    parameters: [],
    referenceGeometry: [],
    sketches: [],
    bodies: [],
    features: [],
    featureOrder: [],
  };
}

function emptyAssembly(id = 'assembly-main') {
  return {
    id,
    name: 'Main assembly',
    parameters: [],
    occurrences: [],
    mates: [],
    occurrencePatterns: [],
    explodedViews: [],
    sectionViews: [],
  };
}

function baseProject(): StudioV5Project {
  return {
    schemaVersion: TYPED_SCHEMA_VERSION,
    projectId: 'project-fixture',
    name: 'V5 fixture',
    units: 'mm',
    parameters: [],
    materials: [],
    partDefinitions: [emptyPart()],
    assemblyDefinitions: [],
    rootDocument: partRef(),
    resources: [],
    metadata: {},
  };
}

function assemblyProject(): StudioV5Project {
  const project = baseProject();
  project.assemblyDefinitions = [{
    ...emptyAssembly(),
    occurrences: [{
      id: 'occurrence-part-1',
      name: 'Main part:1',
      definition: partRef(),
      baseTransform: [...TYPED_IDENTITY_MATRIX],
      fixed: true,
      suppressed: false,
      visible: true,
    }],
  }];
  project.rootDocument = assemblyRef('assembly-main');
  return project;
}

check('runtime and TypeScript schema constants agree', STUDIO_V5_SCHEMA_VERSION === TYPED_SCHEMA_VERSION && STUDIO_V5_SCHEMA_VERSION === 5);
check('runtime and TypeScript identity matrices agree', JSON.stringify(STUDIO_V5_IDENTITY_MATRIX) === JSON.stringify(TYPED_IDENTITY_MATRIX));
check('V5 project errors carry a stable class', new StudioV5ProjectError('TEST', 'test') instanceof Error);
check(
  'encoded file budget can contain the document and maximum base64 resources',
  STUDIO_V5_PROJECT_LIMITS.fileBytes >= STUDIO_V5_PROJECT_LIMITS.bytes + Math.ceil(STUDIO_V5_PROJECT_LIMITS.resourcesBytes * 4 / 3),
);

const empty = createEmptyStudioV5PartProject({ projectId: 'project-empty', name: 'Empty rotor', units: 'in' });
check('empty project factory creates schema 5', empty.schemaVersion === 5);
check('empty project factory creates one root part', empty.partDefinitions.length === 1 && empty.rootDocument.kind === 'part');
check('empty project factory preserves requested units', empty.units === 'in');
check('document reference keys remain kind-qualified', studioV5DocumentRefKey(empty.rootDocument).startsWith('part:'));

const legacy = {
  title: 'Migrated rotor',
  units: 'mm',
  features: [
    {
      id: 'legacy-extrude',
      type: 'extrude',
      sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 'fan_radius' }] },
      h: 20,
      vendorExtension: { retained: true },
      error: 'derived failure must not migrate',
    },
    {
      id: 'legacy-cut',
      type: 'cut',
      sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 4 }] },
      h: 20,
      through: true,
    },
  ],
  params: [{ name: 'fan_radius', value: 60, description: 'Preserved parameter metadata' }],
  extension: { retained: true },
};
const legacyBefore = JSON.stringify(legacy);
const migrated = migrateStudioPartToV5(legacy, { projectId: 'project-migrated-fixture' });
const migratedAgain = migrateStudioPartToV5(deepCopy(legacy), { projectId: 'project-migrated-fixture' });
const migratedPart = migrated.partDefinitions[0];
const migratedLegacyFeature = migratedPart.features[0] as Record<string, any>;
const migratedRoot = migrated as StudioV5Project & { extension?: { retained?: boolean } };

check('legacy migration never mutates its input', JSON.stringify(legacy) === legacyBefore);
check('legacy migration is deterministic', JSON.stringify(migrated) === JSON.stringify(migratedAgain));
check('legacy migration records schema 3 provenance', migrated.metadata.migratedFromSchema === 3 && migratedPart.metadata?.migratedFromSchema === 3);
check('legacy migration creates one part and one body', migrated.partDefinitions.length === 1 && migratedPart.bodies.length === 1);
check('legacy migration preserves feature order', migratedPart.featureOrder.join(',') === 'legacy-extrude,legacy-cut');
check('legacy migration preserves feature-specific extensions', migratedLegacyFeature.vendorExtension?.retained === true);
check('legacy migration strips derived feature errors', !('error' in migratedPart.features[0]));
check('first migrated feature creates the initial body', migratedPart.features[0].resultPolicy.kind === 'new-body');
check('migrated cut targets the initial body', migratedPart.features[1].resultPolicy.kind === 'subtract' && migratedPart.features[1].resultPolicy.targetBodyIds[0] === migratedPart.bodies[0].id);
check('migrated body owns the complete legacy history', migratedPart.bodies[0].featureIds.join(',') === migratedPart.featureOrder.join(','));
check('legacy parameters receive deterministic stable IDs', typeof migrated.parameters[0].id === 'string' && migrated.parameters[0].id.includes('fan_radius'));
check('unknown legacy top-level fields survive at the schema-5 root', migratedRoot.extension?.retained === true);
check('explicit project ID crosses the migration boundary', migrated.projectId === 'project-migrated-fixture');

const schema4Fixture = {
  schemaVersion: 4,
  title: 'Synthetic V4 constrained part',
  units: 'mm',
  params: [{ id: 'parameter-width', name: 'width', expression: '80', vendorUnit: 'nominal' }],
  features: [{
    id: 'feature-schema-4',
    type: 'extrude',
    name: 'Constrained base',
    suppressed: false,
    plane: { kind: 'base', plane: 'XY' },
    sketch: {
      id: 'sketch-schema-4',
      entities: [
        { id: 'entity-1', kind: 'line', a: [-40, -20], b: [40, -20], vendorEntity: { retained: true } },
        { id: 'entity-2', kind: 'line', a: [40, -20], b: [40, 20] },
        { id: 'entity-3', kind: 'line', a: [40, 20], b: [-40, 20] },
        { id: 'entity-4', kind: 'line', a: [-40, 20], b: [-40, -20] },
      ],
      groups: [{ id: 'group-1', kind: 'rectangle', entityIds: ['entity-1', 'entity-2', 'entity-3', 'entity-4'], creationMode: 'center' }],
      constraints: [
        { id: 'constraint-1', kind: 'horizontal', refs: [{ entityId: 'entity-1' }], driving: true },
        { id: 'constraint-2', kind: 'horizontal-distance', refs: [{ entityId: 'entity-1' }], expression: 'width', driving: true },
      ],
      extensions: { sketchUnknown: { retained: true } },
    },
    extent: { kind: 'distance', expression: 'width / 16', reversed: false, symmetric: false },
    extensions: { featureUnknown: { retained: true } },
  }],
  extensions: { schema4Unknown: { retained: true } },
};
const schema4Before = JSON.stringify(schema4Fixture);
const migrated4 = migrateStudioPartToV5(schema4Fixture);
const migrated4Again = migrateStudioPartToV5(deepCopy(schema4Fixture));
const migrated4Feature = migrated4.partDefinitions[0].features[0] as Record<string, any>;
const migrated4Sketch = migrated4.partDefinitions[0].sketches[0] as Record<string, any>;
const migrated4Extensions = migrated4.extensions as Record<string, any>;
check('schema-4 migration never mutates its input', JSON.stringify(schema4Fixture) === schema4Before);
check('schema-4 migration is byte-deterministic', JSON.stringify(migrated4) === JSON.stringify(migrated4Again));
check('schema-4 migration is idempotent at the schema-5 boundary', JSON.stringify(migrateStudioPartToV5(deepCopy(migrated4))) === JSON.stringify(migrated4));
check('schema-4 migration records schema 4 provenance', migrated4.metadata.migratedFromSchema === 4);
check('schema-4 migration promotes the constrained sketch into the part', migrated4Sketch.id === 'sketch-schema-4' && migrated4.partDefinitions[0].sketches.length === 1);
check('schema-4 migration preserves entity and constraint identity', migrated4Sketch.entities.map((entity: any) => entity.id).join(',') === 'entity-1,entity-2,entity-3,entity-4' && migrated4Sketch.constraints[1].id === 'constraint-2');
check('schema-4 migration gives the feature an explicit sketch reference', migrated4Feature.inputRefs.some((reference: any) => reference.ownerKind === 'sketch' && reference.ownerId === 'sketch-schema-4'));
check('schema-4 migration converts the constrained loop for exact legacy evaluation', migrated4Feature.sketch.shapes[0].kind === 'poly' && migrated4Feature.sketch.shapes[0].pts.length === 4);
check('schema-4 migration preserves expressions verbatim', migrated4.parameters[0].value === '80' && migrated4Feature.h === 'width / 16');
check('schema-4 migration preserves safe extensions at their migrated object paths',
  migrated4Extensions.schema4Unknown?.retained === true &&
  migrated4Sketch.extensions?.sketchUnknown?.retained === true &&
  migrated4Feature.extensions?.featureUnknown?.retained === true &&
  migrated4Sketch.entities[0].vendorEntity?.retained === true);

const schema4Rejections: Array<[string, Record<string, any>, string]> = [];
const duplicateV4Entity = deepCopy(schema4Fixture);
duplicateV4Entity.features[0].sketch.entities[1].id = 'entity-1';
schema4Rejections.push(['schema-4 migration rejects duplicate entity identity', duplicateV4Entity, 'DUPLICATE_ID']);
const danglingV4Group = deepCopy(schema4Fixture);
danglingV4Group.features[0].sketch.groups[0].entityIds[3] = 'entity-missing';
schema4Rejections.push(['schema-4 migration rejects dangling group membership', danglingV4Group, 'MISSING_REFERENCE']);
const danglingV4Constraint = deepCopy(schema4Fixture);
danglingV4Constraint.features[0].sketch.constraints[0].refs[0].entityId = 'entity-missing';
schema4Rejections.push(['schema-4 migration rejects dangling constraint references', danglingV4Constraint, 'MISSING_REFERENCE']);
const invalidV4Extent = deepCopy(schema4Fixture);
invalidV4Extent.features[0].extent.expression = 'width ** 2';
schema4Rejections.push(['schema-4 migration rejects unsafe extent expressions', invalidV4Extent, 'INVALID_EXPRESSION']);
const openV4Profile = deepCopy(schema4Fixture);
openV4Profile.features[0].sketch.entities.pop();
openV4Profile.features[0].sketch.groups[0].entityIds.pop();
schema4Rejections.push(['schema-4 migration rejects an open solid profile', openV4Profile, 'INVALID_SKETCH']);
const cyclicV4Parameters = deepCopy(schema4Fixture);
cyclicV4Parameters.params = [
  { id: 'parameter-a', name: 'a', expression: 'b + 1', vendorUnit: 'nominal' },
  { id: 'parameter-b', name: 'b', expression: 'a + 1', vendorUnit: 'nominal' },
];
cyclicV4Parameters.features[0].extent.expression = 'a';
schema4Rejections.push(['schema-4 migration rejects cyclic parameter expressions', cyclicV4Parameters, 'CYCLIC_PARAMETER']);
const excessiveV4Features = deepCopy(schema4Fixture);
excessiveV4Features.features = Array.from({ length: 501 }, () => deepCopy(schema4Fixture.features[0]));
schema4Rejections.push(['schema-4 migration enforces the 500-feature budget', excessiveV4Features, 'LIMIT_FEATURES']);
const excessiveV4Entities = deepCopy(schema4Fixture);
excessiveV4Entities.features[0].sketch.entities = Array.from({ length: 5001 }, (_, index) => ({
  id: `entity-budget-${index}`, kind: 'line', a: [index, 0], b: [index, 1],
}));
schema4Rejections.push(['schema-4 migration enforces the 5,000-entity budget', excessiveV4Entities, 'LIMIT_SKETCH_ENTITIES']);
const excessiveV4Constraints = deepCopy(schema4Fixture);
excessiveV4Constraints.features[0].sketch.constraints = Array.from({ length: 10001 }, (_, index) => ({
  id: `constraint-budget-${index}`, kind: 'fixed', refs: [{ entityId: 'entity-1' }], driving: true,
}));
schema4Rejections.push(['schema-4 migration enforces the 10,000-constraint budget', excessiveV4Constraints, 'LIMIT_CONSTRAINTS']);
const excessiveV4Bytes = deepCopy(schema4Fixture);
(excessiveV4Bytes.extensions as Record<string, unknown>).padding = 'x'.repeat(10 * 1024 * 1024);
schema4Rejections.push(['schema-4 migration enforces the 10 MB document budget', excessiveV4Bytes, 'LIMIT_BYTES']);
for (const [name, fixture, expected] of schema4Rejections) {
  const before = JSON.stringify(fixture);
  const actual = errorCode(() => migrateStudioPartToV5(fixture));
  check(name, actual === expected, `expected ${expected}, got ${actual ?? 'no error'}`);
  check(name + ' without mutating input', JSON.stringify(fixture) === before);
}

const parsedMigrated = parseOrMigrateStudioV5Project(JSON.stringify(legacy), { projectId: 'project-from-text' });
check('text migration produces a detached schema-5 project', parsedMigrated.schemaVersion === 5 && parsedMigrated.projectId === 'project-from-text');
const parsedExact = parseStudioV5Project(JSON.stringify(migrated));
check('schema-5 JSON round-trips through the exact boundary', JSON.stringify(parsedExact) === JSON.stringify(migrated));

const candidate = baseProject();
const candidateBefore = JSON.stringify(candidate);
const prepared = prepareStudioV5Project(candidate);
prepared.name = 'Detached result';
prepared.partDefinitions[0].name = 'Detached part';
check('schema-5 preparation never mutates its input', JSON.stringify(candidate) === candidateBefore);
check('schema-5 preparation returns a deeply detached result', candidate.name === 'V5 fixture' && candidate.partDefinitions[0].name === 'Main part');

const validAssembly = prepareStudioV5Project(assemblyProject());
check('root assembly resolves through a reusable part occurrence', validAssembly.rootDocument.kind === 'assembly' && validAssembly.assemblyDefinitions[0].occurrences[0].definition.kind === 'part');

const bodyProject = baseProject();
bodyProject.materials.push({ id: 'material-aluminum', name: 'Aluminum', densityKgM3: 2700 });
bodyProject.partDefinitions[0] = {
  ...emptyPart(),
  bodies: [{
    id: 'body-main',
    name: 'Rotor',
    kind: 'solid',
    createdByFeatureId: 'feature-extrude',
    featureIds: ['feature-extrude', 'feature-cut'],
    visible: true,
    suppressed: false,
    materialId: 'material-aluminum',
  }],
  features: [
    {
      id: 'feature-extrude',
      name: 'Rotor blank',
      type: 'extrude',
      suppressed: false,
      inputRefs: [],
      resultPolicy: { kind: 'new-body', bodyName: 'Rotor' },
    },
    {
      id: 'feature-cut',
      name: 'Bore',
      type: 'cut',
      suppressed: false,
      inputRefs: [],
      resultPolicy: { kind: 'subtract', targetBodyIds: ['body-main'], keepTools: false },
    },
  ],
  featureOrder: ['feature-extrude', 'feature-cut'],
};
const validBodyProject = prepareStudioV5Project(bodyProject);
check('body ownership and result-policy references validate', validBodyProject.partDefinitions[0].bodies[0].featureIds.length === 2);

const validBodyPatternProject = deepCopy(bodyProject);
validBodyPatternProject.partDefinitions[0].referenceGeometry.push({
  id: 'datum-rotor-axis', name: 'Rotor axis', kind: 'axis', suppressed: false,
  definition: { mode: 'principal', origin: [0, 0, 0], direction: [1, 0, 0] },
});
validBodyPatternProject.partDefinitions[0].bodyPatterns = [{
  id: 'pattern-rotor-blades', name: 'Rotor blades', kind: 'circular', sourceBodyId: 'body-main',
  references: [{ ownerKind: 'datum', ownerId: 'datum-rotor-axis', semanticPath: { role: 'axis' }, signature: { role: 'axis' } }],
  definition: { count: 12, distribution: 'full', symmetric: false, orientation: 'rotate', totalAngle: 360, spacingAngle: 30, angles: [], radialOffset: 0, axialOffset: 0 },
  skippedIndices: [], suppressed: false, visible: true,
}];
check('linked body-pattern source, role, policy, and occurrence budget validate', prepareStudioV5Project(validBodyPatternProject).partDefinitions[0].bodyPatterns?.length === 1);

const validAssemblyGeometryReference = deepCopy(bodyProject);
validAssemblyGeometryReference.assemblyDefinitions = [{
  ...emptyAssembly(),
  occurrences: [{
    id: 'occurrence-rotor-1',
    name: 'Rotor:1',
    definition: partRef(),
    baseTransform: [...TYPED_IDENTITY_MATRIX],
    fixed: true,
    suppressed: false,
    visible: true,
  }],
  mates: [{
    id: 'mate-rotor-fixed',
    name: 'Fix rotor',
    kind: 'fixed',
    occurrenceIds: ['occurrence-rotor-1'],
    references: [{ ownerKind: 'body', ownerId: 'body-main', signature: {}, occurrencePath: ['occurrence-rotor-1'] }],
    suppressed: false,
  }],
}];
validAssemblyGeometryReference.rootDocument = assemblyRef('assembly-main');
check(
  'assembly geometry references resolve through explicit occurrence paths',
  prepareStudioV5Project(validAssemblyGeometryReference).assemblyDefinitions[0].mates.length === 1,
);

const scopedExpressions = baseProject();
scopedExpressions.parameters = [{ id: 'parameter-project-pitch', name: 'pitch', value: 4 }];
scopedExpressions.partDefinitions[0].parameters = [{ id: 'parameter-part-spacing', name: 'spacing', value: 'pitch * 2 + 1' }];
check(
  'project parameters safely feed part parameter expressions',
  prepareStudioV5Project(scopedExpressions).partDefinitions[0].parameters[0].value === 'pitch * 2 + 1',
);

const validParameterOverride = assemblyProject();
validParameterOverride.partDefinitions[0].parameters = [{ id: 'parameter-part-width', name: 'width', value: 10 }];
validParameterOverride.assemblyDefinitions[0].parameters = [{ id: 'parameter-assembly-scale', name: 'scale', value: 2 }];
validParameterOverride.assemblyDefinitions[0].occurrences[0].parameterOverrides = { width: 'scale * 5' };
check(
  'occurrence overrides target real component parameters and use assembly expressions',
  prepareStudioV5Project(validParameterOverride).assemblyDefinitions[0].occurrences[0].parameterOverrides?.width === 'scale * 5',
);

const resourceBeyondDocumentBudget = baseProject();
const base64BeyondDocumentBudget = 'AAAA'.repeat(Math.floor(STUDIO_V5_PROJECT_LIMITS.bytes / 4) + 1);
resourceBeyondDocumentBudget.resources.push({
  id: 'resource-large-profile',
  name: 'Large profile resource',
  mimeType: 'text/csv',
  byteLength: base64BeyondDocumentBudget.length / 4 * 3,
  encoding: 'base64',
  data: base64BeyondDocumentBudget,
});
check(
  'embedded resources use their separate decoded budget instead of the document budget',
  prepareStudioV5Project(resourceBeyondDocumentBudget).resources[0].byteLength > STUDIO_V5_PROJECT_LIMITS.bytes / 2,
);

const rejectionFixtures: Array<[string, StudioV5Project | Record<string, unknown>, string]> = [];

const missingBodyPatternSource = deepCopy(validBodyPatternProject);
missingBodyPatternSource.partDefinitions[0].bodyPatterns![0].sourceBodyId = 'body-missing';
rejectionFixtures.push(['body patterns require a canonical source body', missingBodyPatternSource, 'MISSING_REFERENCE']);

const wrongBodyPatternRole = deepCopy(validBodyPatternProject);
wrongBodyPatternRole.partDefinitions[0].bodyPatterns![0].references[0].semanticPath = { role: 'direction' };
wrongBodyPatternRole.partDefinitions[0].bodyPatterns![0].references[0].signature = { role: 'direction' };
rejectionFixtures.push(['body pattern references must match their kind-specific role', wrongBodyPatternRole, 'INVALID_PATTERN']);

const wrongBodyPatternDatumKind = deepCopy(validBodyPatternProject);
wrongBodyPatternDatumKind.partDefinitions[0].referenceGeometry[0].kind = 'plane';
rejectionFixtures.push(['body pattern references must resolve to kind-compatible geometry', wrongBodyPatternDatumKind, 'INVALID_PATTERN']);

const shortBodyPatternTable = deepCopy(validBodyPatternProject);
shortBodyPatternTable.partDefinitions[0].bodyPatterns![0].definition = {
  ...shortBodyPatternTable.partDefinitions[0].bodyPatterns![0].definition,
  distribution: 'table', angles: [30],
};
rejectionFixtures.push(['body pattern tables require one value per generated occurrence', shortBodyPatternTable, 'INVALID_PATTERN']);

const excessiveBodyPattern = deepCopy(validBodyPatternProject);
excessiveBodyPattern.partDefinitions[0].bodyPatterns![0].definition.count = 5001;
rejectionFixtures.push(['body pattern count is bounded before generation', excessiveBodyPattern, 'INVALID_PATTERN']);

const older = deepCopy(baseProject()) as unknown as Record<string, unknown>;
older.schemaVersion = 4;
rejectionFixtures.push(['exact V5 boundary refuses older schemas', older, 'UNSUPPORTED_SCHEMA']);

const newer = deepCopy(baseProject()) as unknown as Record<string, unknown>;
newer.schemaVersion = 6;
rejectionFixtures.push(['newer schemas are refused explicitly', newer, 'NEWER_SCHEMA']);

const missingRoot = baseProject();
missingRoot.rootDocument = partRef('missing-part');
rejectionFixtures.push(['missing root document is refused', missingRoot, 'MISSING_REFERENCE']);

const duplicatePart = baseProject();
duplicatePart.partDefinitions.push(emptyPart());
rejectionFixtures.push(['duplicate part IDs are refused', duplicatePart, 'DUPLICATE_ID']);

const duplicateFeature = deepCopy(bodyProject);
duplicateFeature.partDefinitions[0].features[1].id = 'feature-extrude';
duplicateFeature.partDefinitions[0].featureOrder = ['feature-extrude', 'feature-extrude'];
rejectionFixtures.push(['duplicate feature IDs are refused', duplicateFeature, 'DUPLICATE_ID']);

const incompleteOrder = deepCopy(bodyProject);
incompleteOrder.partDefinitions[0].featureOrder = ['feature-extrude'];
rejectionFixtures.push(['incomplete feature order is refused', incompleteOrder, 'INVALID_FEATURE_ORDER']);

const badBodyFeature = deepCopy(bodyProject);
badBodyFeature.partDefinitions[0].bodies[0].featureIds.push('missing-feature');
rejectionFixtures.push(['missing body feature reference is refused', badBodyFeature, 'MISSING_REFERENCE']);

const badMaterial = deepCopy(bodyProject);
badMaterial.partDefinitions[0].bodies[0].materialId = 'material-missing';
rejectionFixtures.push(['missing material reference is refused', badMaterial, 'MISSING_REFERENCE']);

const badTarget = deepCopy(bodyProject);
badTarget.partDefinitions[0].features[1].resultPolicy = { kind: 'subtract', targetBodyIds: ['body-missing'] };
rejectionFixtures.push(['missing result target body is refused', badTarget, 'MISSING_REFERENCE']);

const parameterCycle = baseProject();
parameterCycle.parameters = [
  { id: 'parameter-a', name: 'a', value: 'b+1' },
  { id: 'parameter-b', name: 'b', value: 'a+1' },
];
rejectionFixtures.push(['parameter dependency cycles are refused', parameterCycle, 'CYCLIC_PARAMETER']);

const unknownParameter = baseProject();
unknownParameter.parameters = [{ id: 'parameter-unknown', name: 'width', value: 'missing + 1' }];
rejectionFixtures.push(['unknown parameter references are refused', unknownParameter, 'UNKNOWN_PARAMETER']);

const malformedExpression = baseProject();
malformedExpression.parameters = [{ id: 'parameter-malformed', name: 'width', value: '2 ** 3' }];
rejectionFixtures.push(['unsupported expression syntax is refused', malformedExpression, 'INVALID_EXPRESSION']);

const nonFiniteExpression = baseProject();
nonFiniteExpression.parameters = [{ id: 'parameter-infinite', name: 'width', value: '1 / 0' }];
rejectionFixtures.push(['non-finite expression results are refused', nonFiniteExpression, 'INVALID_EXPRESSION']);

const duplicateScopedParameterId = baseProject();
duplicateScopedParameterId.parameters = [{ id: 'parameter-shared', name: 'globalWidth', value: 10 }];
duplicateScopedParameterId.partDefinitions[0].parameters = [{ id: 'parameter-shared', name: 'localWidth', value: 12 }];
rejectionFixtures.push(['parameter IDs are unique across project scopes', duplicateScopedParameterId, 'DUPLICATE_ID']);

const featureCycle = deepCopy(bodyProject);
featureCycle.partDefinitions[0].features[0].inputRefs = [{ ownerKind: 'feature', ownerId: 'feature-cut', signature: {} }];
featureCycle.partDefinitions[0].features[1].inputRefs = [{ ownerKind: 'feature', ownerId: 'feature-extrude', signature: {} }];
rejectionFixtures.push(['feature dependency cycles are refused', featureCycle, 'CYCLIC_FEATURE_DEPENDENCY']);

const missingCreatedBody = deepCopy(bodyProject);
missingCreatedBody.partDefinitions[0].bodies = [];
rejectionFixtures.push(['new-body features must create exactly one body', missingCreatedBody, 'INVALID_BODY_OWNERSHIP']);

const inconsistentBodyHistory = deepCopy(bodyProject);
inconsistentBodyHistory.partDefinitions[0].bodies[0].featureIds = ['feature-extrude'];
rejectionFixtures.push(['targeted features must appear in the target body history', inconsistentBodyHistory, 'INVALID_BODY_OWNERSHIP']);

const bodyCreatedByAdd = deepCopy(bodyProject);
bodyCreatedByAdd.partDefinitions[0].bodies[0].createdByFeatureId = 'feature-cut';
bodyCreatedByAdd.partDefinitions[0].bodies[0].featureIds = ['feature-cut'];
rejectionFixtures.push(['additive and subtractive policies cannot create bodies', bodyCreatedByAdd, 'INVALID_BODY_OWNERSHIP']);

const missingSketchSupport = baseProject();
missingSketchSupport.partDefinitions[0].sketches.push({
  id: 'sketch-missing-support',
  name: 'Missing support',
  support: { ownerKind: 'body', ownerId: 'body-missing', signature: {} },
  entities: [],
  groups: [],
  constraints: [],
});
rejectionFixtures.push(['sketch support owners must resolve', missingSketchSupport, 'MISSING_REFERENCE']);

const malformedSketchEntity = baseProject();
malformedSketchEntity.partDefinitions[0].sketches.push({
  id: 'sketch-malformed-entity',
  name: 'Malformed entity',
  entities: [42 as unknown as Record<string, unknown>],
  groups: [],
  constraints: [],
});
rejectionFixtures.push(['sketch entities must remain object records', malformedSketchEntity, 'INVALID_RECORD']);

const malformedExtensions = baseProject();
malformedExtensions.extensions = [] as unknown as Record<string, unknown>;
rejectionFixtures.push(['declared extension containers must be object records', malformedExtensions, 'INVALID_RECORD']);

const missingOccurrenceDefinition = assemblyProject();
missingOccurrenceDefinition.assemblyDefinitions[0].occurrences[0].definition = partRef('part-missing');
rejectionFixtures.push(['missing occurrence definition is refused', missingOccurrenceDefinition, 'MISSING_REFERENCE']);

const parentCycle = assemblyProject();
parentCycle.assemblyDefinitions[0].occurrences.push({
  id: 'occurrence-part-2',
  name: 'Main part:2',
  definition: partRef(),
  parentOccurrenceId: 'occurrence-part-1',
  baseTransform: [...TYPED_IDENTITY_MATRIX],
  fixed: false,
  suppressed: false,
  visible: true,
});
parentCycle.assemblyDefinitions[0].occurrences[0].parentOccurrenceId = 'occurrence-part-2';
rejectionFixtures.push(['parent-occurrence cycles are refused', parentCycle, 'CYCLIC_OCCURRENCE_PARENT']);

const assemblyCycle = baseProject();
assemblyCycle.assemblyDefinitions = [
  {
    ...emptyAssembly('assembly-a'),
    occurrences: [{
      id: 'occurrence-b',
      name: 'Assembly B:1',
      definition: assemblyRef('assembly-b'),
      baseTransform: [...TYPED_IDENTITY_MATRIX],
      fixed: true,
      suppressed: false,
      visible: true,
    }],
  },
  {
    ...emptyAssembly('assembly-b'),
    occurrences: [{
      id: 'occurrence-a',
      name: 'Assembly A:1',
      definition: assemblyRef('assembly-a'),
      baseTransform: [...TYPED_IDENTITY_MATRIX],
      fixed: true,
      suppressed: false,
      visible: true,
    }],
  },
];
assemblyCycle.rootDocument = assemblyRef('assembly-a');
rejectionFixtures.push(['recursive assembly containment is refused', assemblyCycle, 'CYCLIC_ASSEMBLY']);

const duplicateOccurrenceAcrossAssemblies = assemblyProject();
duplicateOccurrenceAcrossAssemblies.assemblyDefinitions.push({
  ...emptyAssembly('assembly-second'),
  occurrences: [{
    id: 'occurrence-part-1',
    name: 'Duplicate occurrence ID',
    definition: partRef(),
    baseTransform: [...TYPED_IDENTITY_MATRIX],
    fixed: false,
    suppressed: false,
    visible: true,
  }],
});
rejectionFixtures.push(['occurrence IDs are unique across assemblies', duplicateOccurrenceAcrossAssemblies, 'DUPLICATE_ID']);

const badMate = assemblyProject();
badMate.assemblyDefinitions[0].mates.push({
  id: 'mate-missing',
  name: 'Missing component mate',
  kind: 'fixed',
  occurrenceIds: ['occurrence-missing'],
  references: [],
  suppressed: false,
});
rejectionFixtures.push(['mates cannot reference missing occurrences', badMate, 'MISSING_REFERENCE']);

const nonRigidOccurrence = assemblyProject();
nonRigidOccurrence.assemblyDefinitions[0].occurrences[0].baseTransform[0] = 2;
rejectionFixtures.push(['component transforms reject hidden scale and shear', nonRigidOccurrence, 'INVALID_TRANSFORM']);

const reflectedOccurrence = assemblyProject();
reflectedOccurrence.assemblyDefinitions[0].occurrences[0].baseTransform[0] = -1;
rejectionFixtures.push(['component transforms reject left-handed reflections', reflectedOccurrence, 'INVALID_TRANSFORM']);

const incompleteBinaryMate = assemblyProject();
incompleteBinaryMate.assemblyDefinitions[0].mates.push({
  id: 'mate-incomplete-binary',
  name: 'Incomplete distance mate',
  kind: 'distance',
  occurrenceIds: ['occurrence-part-1'],
  references: [],
  value: 10,
  suppressed: false,
});
rejectionFixtures.push(['binary mates require exactly two component occurrences and references', incompleteBinaryMate, 'INVALID_MATE']);

const duplicateMateOccurrence = assemblyProject();
duplicateMateOccurrence.assemblyDefinitions[0].mates.push({
  id: 'mate-duplicate-occurrence',
  name: 'Duplicate occurrence',
  kind: 'fixed',
  occurrenceIds: ['occurrence-part-1', 'occurrence-part-1'],
  references: [],
  suppressed: false,
});
rejectionFixtures.push(['mates reject duplicate occurrence references', duplicateMateOccurrence, 'DUPLICATE_REFERENCE']);

const badMateOwner = assemblyProject();
badMateOwner.assemblyDefinitions[0].mates.push({
  id: 'mate-bad-owner',
  name: 'Bad owner',
  kind: 'fixed',
  occurrenceIds: ['occurrence-part-1'],
  references: [{ ownerKind: 'body', ownerId: 'body-missing', signature: {}, occurrencePath: ['occurrence-part-1'] }],
  suppressed: false,
});
rejectionFixtures.push(['mate geometry owners must resolve', badMateOwner, 'MISSING_REFERENCE']);

const unrelatedMateOccurrence = assemblyProject();
unrelatedMateOccurrence.assemblyDefinitions[0].occurrences.push({
  id: 'occurrence-part-2',
  name: 'Other part:1',
  definition: partRef(),
  baseTransform: [...TYPED_IDENTITY_MATRIX],
  fixed: false,
  suppressed: false,
  visible: true,
});
unrelatedMateOccurrence.assemblyDefinitions[0].mates.push({
  id: 'mate-unrelated-owner',
  name: 'Unrelated owner',
  kind: 'fixed',
  occurrenceIds: ['occurrence-part-1'],
  references: [{ ownerKind: 'occurrence', ownerId: 'occurrence-part-2', signature: {} }],
  suppressed: false,
});
rejectionFixtures.push(['mate references stay inside selected occurrences', unrelatedMateOccurrence, 'INVALID_REFERENCE']);

const badPattern = assemblyProject();
badPattern.assemblyDefinitions[0].occurrencePatterns.push({
  id: 'pattern-blades',
  name: 'Fan blades',
  kind: 'circular',
  sourceOccurrenceIds: ['occurrence-missing'],
  generatedCount: 12,
  definition: {},
  suppressed: false,
});
rejectionFixtures.push(['patterns cannot reference missing source occurrences', badPattern, 'MISSING_REFERENCE']);

const duplicatePatternSource = assemblyProject();
duplicatePatternSource.assemblyDefinitions[0].occurrencePatterns.push({
  id: 'pattern-duplicate-source',
  name: 'Duplicate source',
  kind: 'circular',
  sourceOccurrenceIds: ['occurrence-part-1', 'occurrence-part-1'],
  generatedCount: 12,
  definition: {},
  suppressed: false,
});
rejectionFixtures.push(['patterns reject duplicate source occurrences', duplicatePatternSource, 'DUPLICATE_REFERENCE']);

const missingOverrideTarget = assemblyProject();
missingOverrideTarget.assemblyDefinitions[0].occurrences[0].parameterOverrides = { missingWidth: 10 };
rejectionFixtures.push(['occurrence override names resolve in the component definition', missingOverrideTarget, 'MISSING_REFERENCE']);

const tooManyGenerated = assemblyProject();
tooManyGenerated.assemblyDefinitions[0].occurrencePatterns = [
  {
    id: 'pattern-a',
    name: 'Pattern A',
    kind: 'circular',
    sourceOccurrenceIds: ['occurrence-part-1'],
    generatedCount: 3000,
    definition: {},
    suppressed: false,
  },
  {
    id: 'pattern-b',
    name: 'Pattern B',
    kind: 'linear',
    sourceOccurrenceIds: ['occurrence-part-1'],
    generatedCount: 3000,
    definition: {},
    suppressed: false,
  },
];
rejectionFixtures.push(['generated occurrence budget is cumulative', tooManyGenerated, 'LIMIT_GENERATED_OCCURRENCES']);

const oversizedResource = baseProject();
oversizedResource.resources.push({
  id: 'resource-too-large',
  name: 'Too large',
  mimeType: 'text/plain',
  byteLength: STUDIO_V5_PROJECT_LIMITS.resourcesBytes + 1,
});
rejectionFixtures.push(['decoded resource byte limit is enforced', oversizedResource, 'INVALID_INTEGER']);

const disallowedResource = baseProject();
disallowedResource.resources.push({
  id: 'resource-html',
  name: 'Unsafe HTML',
  mimeType: 'text/html',
  byteLength: 0,
});
rejectionFixtures.push(['resource MIME types are allowlisted', disallowedResource, 'INVALID_RESOURCE']);

const mismatchedEmbeddedResource = baseProject();
mismatchedEmbeddedResource.resources.push({
  id: 'resource-profile',
  name: 'Profile',
  mimeType: 'text/csv',
  byteLength: 4,
  encoding: 'base64',
  data: 'YWJj',
});
rejectionFixtures.push(['embedded resource byte length must match base64 data', mismatchedEmbeddedResource, 'INVALID_RESOURCE']);

const nonCanonicalEmbeddedResource = baseProject();
nonCanonicalEmbeddedResource.resources.push({
  id: 'resource-noncanonical',
  name: 'Noncanonical profile',
  mimeType: 'text/csv',
  byteLength: 1,
  encoding: 'base64',
  data: 'AB==',
});
rejectionFixtures.push(['embedded resources require canonical base64 padding bits', nonCanonicalEmbeddedResource, 'INVALID_RESOURCE']);

const nonFinite = baseProject();
(nonFinite.metadata as Record<string, unknown>).bad = Number.POSITIVE_INFINITY;
rejectionFixtures.push(['non-finite extension values are refused', nonFinite, 'INVALID_NUMBER']);

for (const [name, fixture, code] of rejectionFixtures) {
  const before = (() => {
    try {
      return JSON.stringify(fixture);
    } catch {
      return undefined;
    }
  })();
  const actual = errorCode(() => prepareStudioV5Project(fixture));
  const after = (() => {
    try {
      return JSON.stringify(fixture);
    } catch {
      return undefined;
    }
  })();
  check(name, actual === code, `expected ${code}, got ${actual ?? 'no error'}`);
  check(name + ' without mutating input', before === after);
}

const cyclic = baseProject() as StudioV5Project & { loop?: unknown };
cyclic.loop = cyclic;
check('cyclic object graphs fail closed', errorCode(() => prepareStudioV5Project(cyclic)) === 'CYCLIC_OBJECT');
check('cyclic failure leaves the cycle intact', cyclic.loop === cyclic);

let nested: Record<string, unknown> = {};
const deepRoot = baseProject() as StudioV5Project & { extensions?: Record<string, unknown> };
deepRoot.extensions = nested;
for (let index = 0; index < STUDIO_V5_PROJECT_LIMITS.treeDepth + 2; index++) {
  nested.next = {};
  nested = nested.next as Record<string, unknown>;
}
check('excessive object depth fails before cloning', errorCode(() => prepareStudioV5Project(deepRoot)) === 'LIMIT_DEPTH');

const oversizedCanonicalProject = baseProject();
oversizedCanonicalProject.metadata = { padding: 'x'.repeat(STUDIO_V5_PROJECT_LIMITS.bytes) };
check('canonical document byte limit excludes only embedded resources', errorCode(() => prepareStudioV5Project(oversizedCanonicalProject)) === 'LIMIT_BYTES');
check('invalid JSON is refused explicitly', errorCode(() => parseStudioV5Project('{')) === 'INVALID_JSON');
check('legacy migration refuses unknown older schemas', errorCode(() => migrateStudioPartToV5({ schemaVersion: 2, features: [], params: [] })) === 'UNSUPPORTED_SCHEMA');
check('legacy migration refuses newer schemas', errorCode(() => migrateStudioPartToV5({ schemaVersion: 99, features: [], params: [] })) === 'NEWER_SCHEMA');
check('legacy migration refuses an invalid explicit project ID', errorCode(() => migrateStudioPartToV5(legacy, { projectId: 'not a valid id' })) === 'INVALID_ID');

console.log(`\n${checks - failures}/${checks} schema-5 checks passed`);
if (failures) process.exitCode = 1;
