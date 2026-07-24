import { buildRobotJointFixture } from './studio-v5-release-fixtures.ts';
import { addOriginDatums, createDatumTransformProject, DATUM_IDS } from './studio-v5-datums-fixture.ts';
import { createPatternSourceProject, PATTERN_IDS } from './studio-v5-patterns-fixture.ts';
import { createThreeBodyRuntimeProject, RUNTIME_BODY_IDS } from './studio-v5-runtime-fixture.ts';
import { createAdvancedModifierBaseProject, createAdvancedShapeProject, SHAPE_IDS } from './studio-v5-shapes-fixture.ts';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { CadCommandService, applyCadTransaction } from '../static/studio-agent-service.js';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { studioV5CanonicalHash, studioV5RootPart } from '../static/studio-v5-runtime-document.js';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { CAD_UI_COMMAND_CAPABILITIES, buildCadUiCommandTransaction, cadUiCapabilityManifest } from '../static/studio-v6-interaction.js';

let passed = 0;
let failed = 0;
function check(name: string, condition: unknown, detail?: unknown) {
  if (condition) {
    passed++;
    console.log('  PASS', name);
  } else {
    failed++;
    console.error('  FAIL', name, detail ?? '');
  }
}

console.log('\nCAD Studio V6 I3 visible-command document parity');

const project = structuredClone(buildRobotJointFixture().project);
const assembly = project.assemblyDefinitions
  .find((entry: any) => entry.id === project.rootDocument.assemblyId);
const cover = assembly?.occurrences
  .find((entry: any) => entry.id === 'occurrence-robot-cover');
if (!cover) throw new Error('Robot-joint cover occurrence is missing.');
cover.fixed = false;

const revision = 12;
const transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 44, 1];
const built = buildCadUiCommandTransaction({
  draft: {
    commandId: 'assembly.component-transform',
    draftId: 'draft-i3-document',
    baseRevision: revision,
    inputValues: { transform },
    boundSelections: {
      occurrence: [{ kind: 'occurrence', id: cover.id }],
    },
  },
  expectedRevision: revision,
  transactionId: 'transaction-i3-visible',
});
const direct = applyCadTransaction(project, built.transaction);
const beforeHash = studioV5CanonicalHash(project);
const manifest = cadUiCapabilityManifest();
const transformCapability = manifest.commands.find((entry: any) => entry.id === 'assembly.component-transform');

check('I3 manifest publishes the assembly adapter family inside the literal full-UI command denominator',
  manifest.studioVersion === '6.0.0-i4' &&
  CAD_UI_COMMAND_CAPABILITIES.length === 48 &&
  manifest.commands.length === CAD_UI_COMMAND_CAPABILITIES.length &&
  transformCapability?.state === 'available' &&
  transformCapability.operationKinds.join(',') === 'component.update' &&
  transformCapability.fields.map((entry: any) => entry.id).join(',') === 'occurrence,gizmoMode,gizmoSnap,transform' &&
  manifest.fullUiParity.complete === true &&
  manifest.fullUiParity.missingAdapterIds.length === 0);
check('visible command builder produces a closed revision-bound component.update transaction',
  built.transaction.expectedRevision === revision &&
  built.transaction.atomic === true &&
  built.transaction.operations.length === 1 &&
  built.transaction.operations[0].kind === 'component.update' &&
  built.transaction.operations[0].input.occurrenceId === cover.id &&
  JSON.stringify(built.transaction.operations[0].input.patch.baseTransform) === JSON.stringify(transform) &&
  built.transactionHash.startsWith('fnv1a32:'));

const anchor = assembly.occurrences.find((entry: any) => entry.id !== cover.id);
const partDefinition = project.partDefinitions[0];
if (!anchor || !partDefinition) throw new Error('Robot-joint assembly adapter fixtures are incomplete.');
const assemblyDrafts: any[] = [
  {
    commandId: 'assembly.create',
    inputValues: { name: 'Fixture assembly', occurrenceName: 'Fixture:1', fixed: true },
    generatedIds: { assemblyId: 'assembly-visible-created', occurrenceId: 'occurrence-visible-root' },
  },
  {
    commandId: 'assembly.insert',
    inputValues: { name: 'Inserted component', translation: [10, 20, 30], fixed: false },
    boundSelections: { definition: [{ kind: 'part', id: partDefinition.id }] },
    generatedIds: { occurrenceId: 'occurrence-visible-inserted' },
  },
  {
    commandId: 'assembly.linked',
    inputValues: { name: 'Linked component', translation: [5, 0, 0] },
    boundSelections: { occurrence: [{ kind: 'occurrence', id: cover.id }] },
    generatedIds: { occurrenceId: 'occurrence-visible-linked' },
  },
  {
    commandId: 'assembly.independent',
    inputValues: { name: 'Independent component' },
    boundSelections: { occurrence: [{ kind: 'occurrence', id: cover.id }] },
    generatedIds: { partId: 'part-visible-independent' },
  },
  {
    commandId: 'assembly.replace',
    boundSelections: {
      occurrence: [{ kind: 'occurrence', id: cover.id }],
      definition: [{ kind: 'part', id: partDefinition.id }],
    },
  },
  {
    commandId: 'assembly.variant',
    inputValues: { parameterOverrides: ['clearance = 0.25', 'teeth = 24'] },
    boundSelections: { occurrence: [{ kind: 'occurrence', id: cover.id }] },
  },
  {
    commandId: 'assembly.component-transform',
    inputValues: { transform },
    boundSelections: { occurrence: [{ kind: 'occurrence', id: cover.id }] },
  },
  {
    commandId: 'assembly.edit-context',
    boundSelections: { occurrence: [{ kind: 'occurrence', id: cover.id }] },
  },
  { commandId: 'assembly.exit-context' },
  {
    commandId: 'assembly.pattern',
    inputValues: { name: 'Visible pattern', patternKind: 'circular', generatedCount: 6, spacing: 20, totalAngle: 360 },
    boundSelections: { occurrence: [{ kind: 'occurrence', id: cover.id }] },
    generatedIds: { patternId: 'occurrence-pattern-visible' },
  },
  ...['fixed', 'coincident', 'concentric', 'distance', 'angle', 'parallel', 'perpendicular', 'tangent', 'revolute', 'slider'].map((mateKind) => ({
    commandId: `assembly.mate.${mateKind}`,
    inputValues: { name: `Visible ${mateKind} mate`, value: 0, flip: false },
    boundSelections: {
      movingOccurrence: [{ kind: 'occurrence', id: cover.id }],
      ...(mateKind === 'fixed' ? {} : {
        anchorOccurrence: [{ kind: 'occurrence', id: anchor.id }],
        anchorReference: [{ kind: 'occurrence', id: anchor.id }],
        movingReference: [{ kind: 'occurrence', id: cover.id }],
      }),
    },
    generatedIds: { mateId: `mate-visible-${mateKind}` },
  })),
].map((draft, index) => buildCadUiCommandTransaction({
  draft: {
    draftId: `draft-assembly-contract-${index}`,
    baseRevision: revision,
    inputValues: {},
    boundSelections: {},
    generatedIds: {},
    ...draft,
  },
  expectedRevision: revision,
  transactionId: `transaction-assembly-contract-${index}`,
}));
const assemblyOperationKinds = assemblyDrafts.map((entry) => entry.transaction.operations[0].kind);
check('shared visible-command builder covers every assembly structure and mate command with ordinary document operations',
  assemblyDrafts.length === 20 &&
  assemblyOperationKinds.join(',') === [
    'assembly.create',
    'component.insert',
    'component.duplicate',
    'component.makeIndependent',
    'component.replace',
    'component.update',
    'component.update',
    'assembly.context.enter',
    'assembly.context.exit',
    'component.pattern',
    ...Array(10).fill('mate.create'),
  ].join(',') &&
  assemblyDrafts.every((entry) =>
    entry.transaction.atomic === true &&
    entry.transaction.expectedRevision === revision &&
    entry.transaction.metadata.visibleCommandId.startsWith('assembly.') &&
    entry.transactionHash.startsWith('fnv1a32:')));
check('all ten visible mate commands retain their exact mate kind and closed semantic references',
  assemblyDrafts.slice(-10).every((entry, index) => {
    const input = entry.transaction.operations[0].input;
    const expectedKind = ['fixed', 'coincident', 'concentric', 'distance', 'angle', 'parallel', 'perpendicular', 'tangent', 'revolute', 'slider'][index];
    return input.mateKind === expectedKind &&
      input.occurrenceIds.length === (expectedKind === 'fixed' ? 1 : 2) &&
      input.references.length === (expectedKind === 'fixed' ? 0 : 2);
  }));
const createdDistanceMate = applyCadTransaction(project, assemblyDrafts[13].transaction).project;
const editedDistanceMate = buildCadUiCommandTransaction({
  draft: {
    commandId: 'assembly.mate.distance',
    draftId: 'draft-edit-distance-mate',
    baseRevision: revision,
    editEntity: { kind: 'mate', id: 'mate-visible-distance' },
    inputValues: { name: 'Visible distance mate', value: 12, flip: false },
    boundSelections: {
      movingOccurrence: [{ kind: 'occurrence', id: cover.id }],
      anchorOccurrence: [{ kind: 'occurrence', id: anchor.id }],
      anchorReference: [{ kind: 'occurrence', id: anchor.id }],
      movingReference: [{ kind: 'occurrence', id: cover.id }],
    },
    generatedIds: { mateId: 'mate-visible-distance' },
  },
  expectedRevision: revision,
  transactionId: 'transaction-edit-distance-mate',
});
const editedDistanceProject = applyCadTransaction(createdDistanceMate, editedDistanceMate.transaction).project;
const editedDistanceAssembly = editedDistanceProject.assemblyDefinitions
  .find((entry: any) => entry.id === editedDistanceProject.rootDocument.assemblyId);
check('selected normal mate editing updates the existing constraint instead of creating a conflicting duplicate',
  editedDistanceMate.transaction.operations[0].kind === 'mate.update' &&
  editedDistanceMate.transaction.operations[0].input.mateId === 'mate-visible-distance' &&
  editedDistanceMate.transaction.operations[0].input.patch.value === 12 &&
  editedDistanceAssembly?.mates.filter((entry: any) => entry.id === 'mate-visible-distance').length === 1 &&
  editedDistanceAssembly?.mates.find((entry: any) => entry.id === 'mate-visible-distance')?.value === 12);

const topologyRef = (bodyId: string, kind: 'face' | 'edge', signature: Record<string, unknown>) => ({
  owner: { kind: 'body', id: bodyId },
  stableId: `visible-${kind}-${bodyId}`,
  topologySignature: { kind, ...signature },
});
const placeholderFace = topologyRef(SHAPE_IDS.modifierBoxBody, 'face', { p: [80, 0, 20], n: [0, 0, 1] });
const placeholderEdge = topologyRef(SHAPE_IDS.modifierBoxBody, 'edge', { p: [80, 0, 0], l: 40, curveType: 'line' });
const datumProject = createDatumTransformProject({ transforms: false });
const shapeProject = createAdvancedShapeProject();
const modifierProject = createAdvancedModifierBaseProject();
const runtimeProject = createThreeBodyRuntimeProject({ boolean: false });
const patternProject = createPatternSourceProject();
const basicFace = topologyRef(RUNTIME_BODY_IDS.housing, 'face', { p: [0, 0, 20], n: [0, 0, 1] });
const basicEdge = topologyRef(SHAPE_IDS.modifierBoxBody, 'edge', { p: [80, 0, 0], l: 40, curveType: 'line' });
const basicModelCases = [
  {
    project: runtimeProject,
    operationKind: 'feature.extrude',
    draft: {
      commandId: 'model.extrude',
      inputValues: {
        sketch: [{ kind: 'circle', x: 0, y: 0, r: 4 }],
        height: 12,
        resultPolicy: 'add',
        bodyName: 'Visible boss',
      },
      boundSelections: {
        targetBody: [{ kind: 'body', id: RUNTIME_BODY_IDS.housing }],
        supportFace: [basicFace],
      },
      generatedIds: { featureId: 'feature-visible-extrude' },
    },
  },
  {
    project: runtimeProject,
    operationKind: 'feature.cut',
    draft: {
      commandId: 'model.cut',
      inputValues: {
        sketch: [{ kind: 'circle', x: 0, y: 0, r: 2 }],
        height: 30,
        through: true,
        resultPolicy: 'subtract',
        bodyName: 'Unused cut body',
      },
      boundSelections: { targetBody: [{ kind: 'body', id: RUNTIME_BODY_IDS.housing }] },
      generatedIds: { featureId: 'feature-visible-cut' },
    },
  },
  {
    project: runtimeProject,
    operationKind: 'feature.revolve',
    draft: {
      commandId: 'model.revolve',
      inputValues: {
        sketch: [{ kind: 'rect', x: 8, y: 0, w: 3, h: 12 }],
        resultPolicy: 'new-body',
        bodyName: 'Visible revolved body',
      },
      generatedIds: { featureId: 'feature-visible-revolve-basic' },
    },
  },
  ...['fillet', 'chamfer'].map((kind) => ({
    project: modifierProject,
    operationKind: `feature.${kind}`,
    draft: {
      commandId: `model.${kind}`,
      inputValues: { radius: kind === 'fillet' ? 2 : 1.5 },
      boundSelections: { edges: [basicEdge] },
      generatedIds: { featureId: `feature-visible-${kind}` },
    },
  })),
  {
    project: modifierProject,
    operationKind: 'feature.shell',
    draft: {
      commandId: 'model.shell',
      inputValues: { thickness: 2 },
      boundSelections: {
        body: [{ kind: 'body', id: SHAPE_IDS.modifierBoxBody }],
        faces: [placeholderFace],
      },
      generatedIds: { featureId: 'feature-visible-shell' },
    },
  },
];
const builtBasicModelCases = basicModelCases.map((entry, index) => {
  const draft = entry.draft as any;
  const builtBasic = buildCadUiCommandTransaction({
    draft: {
      draftId: `draft-basic-model-contract-${index}`,
      baseRevision: revision,
      ...draft,
      inputValues: draft.inputValues || {},
      boundSelections: draft.boundSelections || {},
      generatedIds: draft.generatedIds || {},
    },
    expectedRevision: revision,
    transactionId: `transaction-basic-model-contract-${index}`,
  });
  return {
    ...entry,
    built: builtBasic,
    applied: applyCadTransaction(entry.project, builtBasic.transaction),
  };
});
check('shared visible-command builder covers all six production sketch and topology editors',
  builtBasicModelCases.length === 6 &&
  builtBasicModelCases.every((entry) =>
    entry.built.transaction.operations[0].kind === entry.operationKind &&
    entry.built.transaction.atomic === true &&
    entry.built.transaction.metadata.visibleCommandId.startsWith('model.') &&
    entry.built.transactionHash.startsWith('fnv1a32:') &&
    entry.applied.changeSet.documentHashAfter !== studioV5CanonicalHash(entry.project)));
const appliedFaceExtrude = studioV5RootPart(builtBasicModelCases[0].applied.project).features
  .find((entry: any) => entry.id === 'feature-visible-extrude');
check('basic feature transactions preserve face support, result policy, topology, and editable sketch structure',
  appliedFaceExtrude?.onFace?.n?.[2] === 1 &&
  appliedFaceExtrude?.inputRefs?.[0]?.ownerId === RUNTIME_BODY_IDS.housing &&
  appliedFaceExtrude?.resultPolicy?.targetBodyIds?.[0] === RUNTIME_BODY_IDS.housing &&
  appliedFaceExtrude?.sketch?.shapes?.[0]?.kind === 'circle' &&
  studioV5RootPart(builtBasicModelCases[5].applied.project).features
    .some((entry: any) => entry.id === 'feature-visible-shell' && entry.faces.length === 1));
const modelCases: Array<{ project: any; draft: any; operationKind: string }> = [
  {
    project: runtimeProject,
    operationKind: 'boolean.split',
    draft: {
      commandId: 'model.split',
      inputValues: { name: 'Visible split', keepOriginal: true, keepTools: true },
      boundSelections: {
        targetBody: [{ kind: 'body', id: RUNTIME_BODY_IDS.housing }],
        toolBody: [{ kind: 'body', id: RUNTIME_BODY_IDS.tool }],
      },
      generatedIds: { splitId: 'split-visible' },
    },
  },
  {
    project: datumProject,
    operationKind: 'datum.create',
    draft: {
      commandId: 'model.plane',
      inputValues: { name: 'Visible station', mode: 'offset', offset: 210 },
      boundSelections: { referenceDatum: [{ kind: 'datum', id: DATUM_IDS.yz }] },
      generatedIds: { datumId: 'datum-visible-station' },
    },
  },
  {
    project: datumProject,
    operationKind: 'body.transform',
    draft: {
      commandId: 'model.align',
      inputValues: { offset: 8, flip: false },
      boundSelections: {
        body: [{ kind: 'body', id: RUNTIME_BODY_IDS.shaft }],
        fromDatum: [{ kind: 'datum', id: DATUM_IDS.yz }],
        toDatum: [{ kind: 'datum', id: DATUM_IDS.station165 }],
      },
      generatedIds: { featureId: 'transform-visible-align' },
    },
  },
  {
    project: datumProject,
    operationKind: 'sketch.profile.create',
    draft: {
      commandId: 'model.profile',
      inputValues: { name: 'Visible profile', curveKind: 'polyline', points: [[0, 0], [12, 0], [12, 8], [0, 8]] },
      boundSelections: { planeDatum: [{ kind: 'datum', id: DATUM_IDS.yz }] },
      generatedIds: { sketchId: 'sketch-visible-profile' },
    },
  },
  {
    project: datumProject,
    operationKind: 'sketch.path.create',
    draft: {
      commandId: 'model.path',
      inputValues: { name: 'Visible path', curveKind: 'spline', points: [[0, 0, 0], [20, 5, 0], [40, 10, 5]] },
      generatedIds: { sketchId: 'sketch-visible-path' },
    },
  },
  {
    project: shapeProject,
    operationKind: 'feature.loft',
    draft: {
      commandId: 'model.loft',
      inputValues: { name: 'Visible loft', startContinuity: 'free', endContinuity: 'free', ruled: false },
      boundSelections: {
        sections: [SHAPE_IDS.rootProfile, SHAPE_IDS.midProfile, SHAPE_IDS.tipProfile].map((id) => ({ kind: 'sketch', id })),
      },
      generatedIds: { featureId: 'feature-visible-loft' },
    },
  },
  {
    project: shapeProject,
    operationKind: 'feature.sweep',
    draft: {
      commandId: 'model.sweep',
      inputValues: {
        name: 'Visible sweep',
        orientation: 'controlled-twist',
        twistAngle: 22,
        scaleEnd: 0.8,
        referenceDirection: [0, 0, 1],
      },
      boundSelections: {
        profileSketch: [{ kind: 'sketch', id: SHAPE_IDS.sweepProfile }],
        pathSketch: [{ kind: 'sketch', id: SHAPE_IDS.sweepPath }],
      },
      generatedIds: { featureId: 'feature-visible-sweep' },
    },
  },
  {
    project: modifierProject,
    operationKind: 'feature.revolveProfile',
    draft: {
      commandId: 'model.revolve-advanced',
      inputValues: { name: 'Visible partial revolve', angle: 240, startAngle: -30, symmetric: false },
      boundSelections: {
        profileSketch: [{ kind: 'sketch', id: SHAPE_IDS.revolveProfile }],
        axisDatum: [{ kind: 'datum', id: SHAPE_IDS.revolveAxis }],
      },
      generatedIds: { featureId: 'feature-visible-revolve' },
    },
  },
  {
    project: modifierProject,
    operationKind: 'feature.draft',
    draft: {
      commandId: 'model.draft',
      inputValues: { name: 'Visible draft', angle: 5, flip: false, tangentPropagation: true },
      boundSelections: {
        body: [{ kind: 'body', id: SHAPE_IDS.modifierBoxBody }],
        neutralPlane: [{ kind: 'datum', id: SHAPE_IDS.neutralPlane }],
        faces: [placeholderFace],
      },
      generatedIds: { featureId: 'feature-visible-draft' },
    },
  },
  {
    project: modifierProject,
    operationKind: 'feature.thicken',
    draft: {
      commandId: 'model.thicken',
      inputValues: { name: 'Visible thicken', bodyName: 'Visible thickened face', thickness: 3, symmetric: false, flip: true },
      boundSelections: {
        body: [{ kind: 'body', id: SHAPE_IDS.modifierBoxBody }],
        faces: [placeholderFace],
      },
      generatedIds: { featureId: 'feature-visible-thicken' },
    },
  },
  {
    project: modifierProject,
    operationKind: 'feature.variableFillet',
    draft: {
      commandId: 'model.variable-fillet',
      inputValues: { name: 'Visible variable fillet', startRadius: 1, endRadius: 2.5, tangentPropagation: true },
      boundSelections: {
        body: [{ kind: 'body', id: SHAPE_IDS.modifierBoxBody }],
        edges: [placeholderEdge],
      },
      generatedIds: { featureId: 'feature-visible-variable-fillet' },
    },
  },
  {
    project: patternProject,
    operationKind: 'pattern.create',
    draft: {
      commandId: 'model.pattern',
      inputValues: {
        name: 'Visible body pattern',
        patternKind: 'circular',
        outputMode: 'linked',
        count: 8,
        distribution: 'full',
        symmetric: false,
        orientation: 'rotate',
        count2: 2,
        symmetric2: false,
        spacing2: 10,
        extent2: 100,
        tableValues2: [],
        spacing: 10,
        extent: 100,
        totalAngle: 360,
        spacingAngle: 45,
        radialOffset: 0,
        axialOffset: 0,
        tableValues: [],
        skippedIndices: [],
      },
      boundSelections: {
        sourceBody: [{ kind: 'body', id: SHAPE_IDS.bladeBody }],
        axisDatum: [{ kind: 'datum', id: PATTERN_IDS.axis }],
      },
      generatedIds: { patternId: 'pattern-visible' },
    },
  },
  ...[
    {
      commandId: 'model.move',
      inputValues: { translation: [12, 3, 0], gizmoSnap: 1 },
      boundSelections: { body: [{ kind: 'body', id: RUNTIME_BODY_IDS.housing }] },
    },
    {
      commandId: 'model.copy',
      inputValues: { translation: [25, 0, 0], gizmoSnap: 1 },
      boundSelections: { body: [{ kind: 'body', id: RUNTIME_BODY_IDS.housing }] },
    },
    {
      commandId: 'model.rotate',
      inputValues: { angle: 30, gizmoSnap: 15 },
      boundSelections: {
        body: [{ kind: 'body', id: RUNTIME_BODY_IDS.housing }],
        axisDatum: [{ kind: 'datum', id: DATUM_IDS.zAxis }],
      },
    },
    {
      commandId: 'model.mirror',
      inputValues: { moveOriginal: false },
      boundSelections: {
        body: [{ kind: 'body', id: RUNTIME_BODY_IDS.housing }],
        planeDatum: [{ kind: 'datum', id: DATUM_IDS.station165 }],
      },
    },
    {
      commandId: 'model.scale',
      inputValues: { factor: 1.1, center: [0, 0, 0] },
      boundSelections: { body: [{ kind: 'body', id: RUNTIME_BODY_IDS.housing }] },
    },
  ].map((draft, index) => ({
    project: datumProject,
    operationKind: 'body.transform',
    draft: { ...draft, generatedIds: { featureId: `transform-visible-${index}` } },
  })),
];
const builtModelCases = modelCases.map((entry, index) => {
  const builtModel = buildCadUiCommandTransaction({
    draft: {
      draftId: `draft-model-contract-${index}`,
      baseRevision: revision,
      inputValues: {},
      boundSelections: {},
      generatedIds: {},
      ...entry.draft,
    },
    expectedRevision: revision,
    transactionId: `transaction-model-contract-${index}`,
  });
  const applied = applyCadTransaction(entry.project, builtModel.transaction);
  return { ...entry, built: builtModel, applied };
});
check('shared visible-command builder covers all 17 advanced modeling dialogs with ordinary document operations',
  builtModelCases.length === 17 &&
  builtModelCases.every((entry) =>
    entry.built.transaction.operations[0].kind === entry.operationKind &&
    entry.built.transaction.metadata.visibleCommandId.startsWith('model.') &&
    entry.built.transaction.atomic === true &&
    entry.built.transactionHash.startsWith('fnv1a32:') &&
    entry.applied.changeSet.documentHashAfter !== studioV5CanonicalHash(entry.project)));
check('advanced modeling transactions preserve visible form-only policies and editable feature structure',
  builtModelCases[0].built.transaction.operations[0].input.keepOriginal === true &&
  builtModelCases[8].built.transaction.operations[0].input.tangentPropagation === true &&
  builtModelCases[9].built.transaction.operations[0].input.bodyName === 'Visible thickened face' &&
  builtModelCases[10].built.transaction.operations[0].input.tangentPropagation === true &&
  studioV5RootPart(builtModelCases[11].applied.project).bodyPatterns.some((entry: any) => entry.id === 'pattern-visible') &&
  studioV5RootPart(builtModelCases[13].applied.project).bodies.some((entry: any) => entry.createdByFeatureId === 'transform-visible-1'));

const freshRuntimeProject = createThreeBodyRuntimeProject({ boolean: false, projectId: 'project-v6-origin-bootstrap' });
const freshRuntimePart = studioV5RootPart(freshRuntimeProject);
const originCandidatePart = studioV5RootPart(addOriginDatums(freshRuntimeProject));
const originBootstrapOperations = originCandidatePart.referenceGeometry
  .filter((entry: any) => entry.id.startsWith('datum-origin-'))
  .map((entry: any) => ({
    kind: 'datum.create',
    input: {
      id: entry.id,
      name: entry.name,
      datumKind: entry.kind,
      definition: structuredClone(entry.definition),
    },
  }));
const bootstrapBuilt = buildCadUiCommandTransaction({
  draft: {
    commandId: 'model.rotate',
    draftId: 'draft-model-origin-bootstrap',
    baseRevision: revision,
    inputValues: { angle: 30, gizmoSnap: 15 },
    boundSelections: {
      body: [{ kind: 'body', id: RUNTIME_BODY_IDS.housing }],
      axisDatum: [{ kind: 'datum', id: DATUM_IDS.zAxis }],
    },
    generatedIds: { featureId: 'transform-visible-origin-bootstrap' },
    bootstrapOperations: originBootstrapOperations,
  },
  expectedRevision: revision,
  transactionId: 'transaction-model-origin-bootstrap',
});
const bootstrapApplied = applyCadTransaction(freshRuntimeProject, bootstrapBuilt.transaction);
const bootstrapPart = studioV5RootPart(bootstrapApplied.project);
check('fresh-part model commands atomically bootstrap canonical origin datums before the visible operation',
  freshRuntimePart.referenceGeometry.length === 0 &&
  bootstrapBuilt.transaction.atomic === true &&
  bootstrapBuilt.transaction.operations.length === 9 &&
  bootstrapBuilt.transaction.operations.slice(0, 8).every((operation: any) => operation.kind === 'datum.create') &&
  bootstrapBuilt.transaction.operations[8].kind === 'body.transform' &&
  bootstrapPart.referenceGeometry.filter((entry: any) => entry.id.startsWith('datum-origin-')).length === 8 &&
  bootstrapPart.features.some((entry: any) => entry.id === 'transform-visible-origin-bootstrap'));

const measurementBody = partDefinition.bodies[0];
if (!measurementBody) throw new Error('Robot-joint inspection adapter fixture has no body.');
const inspectionDrafts = [
  {
    commandId: 'inspection.section',
    inputValues: {
      name: 'Visible half section',
      sectionKind: 'quarter',
      offset: 12,
      cap: true,
      reverse: true,
      hatchSpacing: 6,
      hatchAngle: 30,
      capFillColor: '#d7e0e5',
      hatchColor: '#243746',
    },
    boundSelections: { scopeOccurrence: [{ kind: 'occurrence', id: cover.id }] },
    generatedIds: { sectionId: 'section-visible' },
  },
  {
    commandId: 'inspection.explode',
    inputValues: { name: 'Visible exploded view', translation: [0, 0, 40] },
    boundSelections: { occurrence: [{ kind: 'occurrence', id: cover.id }] },
    generatedIds: { explodedViewId: 'exploded-visible' },
  },
  {
    commandId: 'inspection.stage',
    inputValues: {
      name: 'Visible axial stages',
      occurrenceIds: [anchor.id, cover.id],
      distanceMateIds: ['mate-visible-stage-anchor', 'mate-visible-stage-cover'],
      start: 0,
      spacing: 25,
      visible: true,
    },
    generatedIds: { stageGroupId: 'stage-group-visible' },
  },
  {
    commandId: 'inspection.measure',
    inputValues: { name: 'Visible body envelope', measurementKind: 'bounding-box' },
    boundSelections: { bodies: [{ kind: 'body', id: measurementBody.id }] },
    generatedIds: { measurementId: 'measurement-visible' },
  },
].map((draft, index) => buildCadUiCommandTransaction({
  draft: {
    draftId: `draft-inspection-contract-${index}`,
    baseRevision: revision,
    boundSelections: {},
    ...draft,
  },
  expectedRevision: revision,
  transactionId: `transaction-inspection-contract-${index}`,
}));
check('shared visible-command builder covers saved section, explode, stage, and measurement panels',
  inspectionDrafts.map((entry) => entry.transaction.operations[0].kind).join(',') ===
    'section.create,exploded.create,stage.create,measurement.create' &&
  inspectionDrafts.every((entry) =>
    entry.transaction.atomic === true &&
    entry.transaction.expectedRevision === revision &&
    entry.transaction.metadata.visibleCommandId.startsWith('inspection.') &&
    entry.transactionHash.startsWith('fnv1a32:')) &&
  inspectionDrafts[0].transaction.operations[0].input.reverse === true &&
  inspectionDrafts[0].transaction.operations[0].input.planes.length === 2 &&
  inspectionDrafts[1].transaction.operations[0].input.steps[0].occurrenceIds[0] === cover.id &&
  inspectionDrafts[3].transaction.operations[0].input.definition.bodyIds[0] === measurementBody.id);

const materialBuilt = buildCadUiCommandTransaction({
  draft: {
    commandId: 'inspection.material',
    draftId: 'draft-inspection-material',
    baseRevision: revision,
    inputValues: {},
    boundSelections: {
      body: [{ kind: 'body', id: measurementBody.id }],
      material: [{ kind: 'material', id: 'material-generic-aluminum' }],
    },
    materialContext: {
      partId: partDefinition.id,
      bodyId: measurementBody.id,
      occurrenceId: cover.id,
      appearanceId: 'appearance-generic-aluminum',
    },
    bootstrapOperations: [{ kind: 'material.ensureGeneric', input: {} }],
  },
  expectedRevision: revision,
  transactionId: 'transaction-inspection-material',
});
const materialApplied = applyCadTransaction(project, materialBuilt.transaction);
const materialBody = materialApplied.project.partDefinitions
  .find((entry: any) => entry.id === partDefinition.id)?.bodies
  .find((entry: any) => entry.id === measurementBody.id);
const materialOccurrence = materialApplied.project.assemblyDefinitions
  .flatMap((entry: any) => entry.occurrences)
  .find((entry: any) => entry.id === cover.id);
check('material dialog parity uses one atomic ensure, body assignment, and occurrence appearance transaction',
  materialBuilt.transaction.operations.map((entry: any) => entry.kind).join(',') ===
    'material.ensureGeneric,material.assignBody,appearance.assignOccurrence' &&
  materialBody?.materialId === 'material-generic-aluminum' &&
  materialOccurrence?.appearanceOverrideId === 'appearance-generic-aluminum' &&
  materialBuilt.transactionHash.startsWith('fnv1a32:'));

const service = new CadCommandService({
  project,
  revision,
  kernel: {
    validate: async (candidate: any) => ({
      errors: [],
      bodies: candidate.partDefinitions.flatMap((part: any) => part.bodies).map((body: any) => ({
        bodyId: body.id,
        bodyName: body.name,
        geometry: { valid: true, brepValid: true, solidCount: 1 },
      })),
      evaluation: { solverState: 'solved', conflicts: [], usedLastValid: false },
    }),
  },
});
const permissions = {
  granted: ['project.read', 'project.edit'],
  projectIds: [project.projectId],
  operationKinds: ['component.update'],
};
const preview = await service.preview(built.transaction, permissions);
check('visible and direct preview paths have the same canonical document hash and leave the base project unchanged',
  preview.changeSet.documentHashAfter === direct.changeSet.documentHashAfter &&
  preview.validation.valid === true &&
  preview.validation.exactGeometry === true &&
  service.revision === revision &&
  studioV5CanonicalHash(service.snapshot()) === beforeHash &&
  studioV5CanonicalHash(project) === beforeHash);
const exactPreviewSnapshot = service.previewSnapshot(preview.previewId, revision);
exactPreviewSnapshot.project.name = 'Mutated external clone';
check('revision-bound preview snapshots expose exact query input without leaking mutable service state',
  exactPreviewSnapshot.previewId === preview.previewId &&
  exactPreviewSnapshot.baseRevision === revision &&
  exactPreviewSnapshot.documentHash === preview.changeSet.documentHashAfter &&
  studioV5CanonicalHash(exactPreviewSnapshot.project) !== exactPreviewSnapshot.documentHash &&
  service.previewSnapshot(preview.previewId, revision).documentHash === preview.changeSet.documentHashAfter &&
  service.capabilities().queries
    .filter((entry: any) => ['geometry.health', 'assembly.clearance', 'assembly.interference'].includes(entry.kind))
    .every((entry: any) => entry.supportsPreviewScope === true));

const committed = await service.commit(preview.previewId, revision, permissions);
const committedCover = service.snapshot().assemblyDefinitions
  .flatMap((entry: any) => entry.occurrences)
  .find((entry: any) => entry.id === cover.id);
check('committing the exact preview advances one revision and preserves ordinary editable assembly structure',
  committed.revision === revision + 1 &&
  committed.historyEntry.transactionId === built.transaction.transactionId &&
  studioV5CanonicalHash(service.snapshot()) === direct.changeSet.documentHashAfter &&
  JSON.stringify(committedCover?.baseTransform) === JSON.stringify(transform));

let staleCode = '';
try {
  await service.preview({
    ...built.transaction,
    transactionId: 'transaction-i3-stale',
    expectedRevision: revision,
  }, permissions);
} catch (error: any) {
  staleCode = error.code;
}
check('a human or agent revision change invalidates the old visible draft before preview',
  staleCode === 'REVISION_CONFLICT' && service.revision === revision + 1);

console.log(`\n${passed}/${passed + failed} V6 I3 command checks passed`);
if (failed) process.exitCode = 1;
