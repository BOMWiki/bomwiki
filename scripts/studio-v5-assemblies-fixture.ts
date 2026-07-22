import { createEmptyStudioV5PartProject, prepareStudioV5Project } from '../static/studio-project-v5.js';
// @ts-expect-error Browser-native modules intentionally have no TypeScript declarations.
import { configureStudioV5Feature, createStudioV5Datum } from '../static/studio-v5-runtime-document.js';
// @ts-expect-error Browser-native module intentionally has no TypeScript declarations.
import { studioV5IdentityMatrix, studioV5TranslationMatrix } from '../static/studio-v5-assembly.js';

export const ASSEMBLY_IDS = Object.freeze({
  root: 'assembly-engine-modules',
  fanSubassembly: 'assembly-fan-rotor',
  fan: 'occurrence-fan-disk',
  shaft: 'occurrence-fan-shaft',
  fanModule: 'occurrence-fan-module',
  nacelle: 'occurrence-nacelle',
  compressor: 'occurrence-compressor',
  turbine: 'occurrence-turbine',
  compressorPattern: 'occurrence-pattern-compressor-stages',
});

function createModulePart(prefix: string, name: string, radius: number, length: number) {
  let project: any = createEmptyStudioV5PartProject({ projectId: `project-module-${prefix}`, name, units: 'mm' });
  const partId = project.rootDocument.partId;
  project = configureStudioV5Feature(project, {
    id: `feature-${prefix}-solid`,
    name: `${name} solid`,
    type: 'extrude',
    sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: radius }], z: -length / 2 },
    h: length,
    through: false,
    resultPolicy: { kind: 'new-body', bodyName: name },
    createdBodyId: `body-${prefix}`,
  }, { resultPolicy: { kind: 'new-body', bodyName: name }, bodyName: name });
  project.partDefinitions[0].parameters.push({
    id: `parameter-${prefix}-length`, name: 'moduleLength', value: length, unit: 'length',
  });
  project.partDefinitions[0].features.find((feature: any) => feature.id === `feature-${prefix}-solid`).h = 'moduleLength';
  project = createStudioV5Datum(project, {
    id: `datum-${prefix}-axis`, name: `${name} axis`, kind: 'axis',
    definition: { mode: 'principal', origin: [0, 0, 0], direction: [0, 0, 1] },
  });
  project = createStudioV5Datum(project, {
    id: `datum-${prefix}-station`, name: `${name} station`, kind: 'plane',
    definition: { mode: 'principal', origin: [0, 0, 0], normal: [0, 0, 1], xDirection: [1, 0, 0] },
  });
  return { partId, part: project.partDefinitions[0], featureId: `feature-${prefix}-solid`, bodyId: `body-${prefix}` };
}

function datumReference(ownerId: string, occurrencePath: string[], role: string) {
  return { ownerKind: 'datum', ownerId, occurrencePath, semanticPath: { role }, signature: { role } };
}

function fixedMate(id: string, occurrenceId: string) {
  return { id, name: `Fix ${occurrenceId}`, kind: 'fixed', occurrenceIds: [occurrenceId], references: [], suppressed: false };
}

function axisMate(id: string, kind: string, anchorOccurrenceId: string, movingOccurrenceId: string, anchorDatumId: string, movingDatumId: string, anchorPath: string[], movingPath: string[], value?: number | string) {
  return {
    id, name: `${kind} ${movingOccurrenceId}`, kind,
    occurrenceIds: [anchorOccurrenceId, movingOccurrenceId],
    references: [datumReference(anchorDatumId, anchorPath, 'anchor'), datumReference(movingDatumId, movingPath, 'moving')],
    ...(value == null ? {} : { value }),
    suppressed: false,
  };
}

export function createSolvedAssemblyProject(): any {
  const fan = createModulePart('fan', 'Fan disk', 42, 8);
  const shaft = createModulePart('shaft', 'Main shaft', 6, 180);
  const nacelle = createModulePart('nacelle', 'Nacelle', 55, 24);
  const compressor = createModulePart('compressor', 'Compressor drum', 28, 18);
  const turbine = createModulePart('turbine', 'Turbine drum', 24, 20);
  const fanSubassembly = {
    id: ASSEMBLY_IDS.fanSubassembly,
    name: 'Fan rotor',
    parameters: [],
    occurrences: [
      { id: ASSEMBLY_IDS.fan, name: 'Fan disk:1', definition: { kind: 'part', partId: fan.partId }, baseTransform: studioV5IdentityMatrix(), fixed: true, suppressed: false, visible: true },
      { id: ASSEMBLY_IDS.shaft, name: 'Main shaft:1', definition: { kind: 'part', partId: shaft.partId }, baseTransform: studioV5TranslationMatrix([12, 8, 4]), fixed: false, suppressed: false, visible: true },
    ],
    mates: [
      fixedMate('mate-fan-fixed', ASSEMBLY_IDS.fan),
      axisMate('mate-shaft-concentric', 'concentric', ASSEMBLY_IDS.fan, ASSEMBLY_IDS.shaft, 'datum-fan-axis', 'datum-shaft-axis', [ASSEMBLY_IDS.fan], [ASSEMBLY_IDS.shaft]),
      axisMate('mate-shaft-distance', 'distance', ASSEMBLY_IDS.fan, ASSEMBLY_IDS.shaft, 'datum-fan-station', 'datum-shaft-station', [ASSEMBLY_IDS.fan], [ASSEMBLY_IDS.shaft], 0),
      axisMate('mate-shaft-angle', 'angle', ASSEMBLY_IDS.fan, ASSEMBLY_IDS.shaft, 'datum-fan-axis', 'datum-shaft-axis', [ASSEMBLY_IDS.fan], [ASSEMBLY_IDS.shaft], 0),
    ],
    occurrencePatterns: [], explodedViews: [], sectionViews: [],
  };
  const root = {
    id: ASSEMBLY_IDS.root,
    name: 'Engine module assembly',
    parameters: [{ id: 'parameter-fan-station', name: 'fanStation', value: -60, unit: 'length' }],
    occurrences: [
      { id: ASSEMBLY_IDS.nacelle, name: 'Nacelle:1', definition: { kind: 'part', partId: nacelle.partId }, baseTransform: studioV5IdentityMatrix(), fixed: true, suppressed: false, visible: true },
      { id: ASSEMBLY_IDS.fanModule, name: 'Fan rotor:1', definition: { kind: 'assembly', assemblyId: ASSEMBLY_IDS.fanSubassembly }, baseTransform: studioV5TranslationMatrix([17, -9, 5]), fixed: false, suppressed: false, visible: true },
      { id: ASSEMBLY_IDS.compressor, name: 'Compressor:1', definition: { kind: 'part', partId: compressor.partId }, baseTransform: studioV5TranslationMatrix([-14, 5, 7]), fixed: false, suppressed: false, visible: true },
      { id: ASSEMBLY_IDS.turbine, name: 'Turbine:1', definition: { kind: 'part', partId: turbine.partId }, baseTransform: studioV5TranslationMatrix([9, 11, 3]), fixed: false, suppressed: false, visible: true },
    ],
    mates: [
      fixedMate('mate-nacelle-fixed', ASSEMBLY_IDS.nacelle),
      axisMate('mate-fan-concentric', 'concentric', ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.fanModule, 'datum-nacelle-axis', 'datum-fan-axis', [ASSEMBLY_IDS.nacelle], [ASSEMBLY_IDS.fanModule, ASSEMBLY_IDS.fan]),
      axisMate('mate-fan-distance', 'distance', ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.fanModule, 'datum-nacelle-station', 'datum-fan-station', [ASSEMBLY_IDS.nacelle], [ASSEMBLY_IDS.fanModule, ASSEMBLY_IDS.fan], 'fanStation'),
      axisMate('mate-fan-angle', 'angle', ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.fanModule, 'datum-nacelle-axis', 'datum-fan-axis', [ASSEMBLY_IDS.nacelle], [ASSEMBLY_IDS.fanModule, ASSEMBLY_IDS.fan], 0),
      axisMate('mate-compressor-concentric', 'concentric', ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.compressor, 'datum-nacelle-axis', 'datum-compressor-axis', [ASSEMBLY_IDS.nacelle], [ASSEMBLY_IDS.compressor]),
      axisMate('mate-compressor-distance', 'distance', ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.compressor, 'datum-nacelle-station', 'datum-compressor-station', [ASSEMBLY_IDS.nacelle], [ASSEMBLY_IDS.compressor], 35),
      axisMate('mate-compressor-angle', 'angle', ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.compressor, 'datum-nacelle-axis', 'datum-compressor-axis', [ASSEMBLY_IDS.nacelle], [ASSEMBLY_IDS.compressor], 0),
      axisMate('mate-turbine-concentric', 'concentric', ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.turbine, 'datum-nacelle-axis', 'datum-turbine-axis', [ASSEMBLY_IDS.nacelle], [ASSEMBLY_IDS.turbine]),
      axisMate('mate-turbine-distance', 'distance', ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.turbine, 'datum-nacelle-station', 'datum-turbine-station', [ASSEMBLY_IDS.nacelle], [ASSEMBLY_IDS.turbine], 105),
      axisMate('mate-turbine-angle', 'angle', ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.turbine, 'datum-nacelle-axis', 'datum-turbine-axis', [ASSEMBLY_IDS.nacelle], [ASSEMBLY_IDS.turbine], 0),
    ],
    occurrencePatterns: [{
      id: ASSEMBLY_IDS.compressorPattern,
      name: 'Compressor axial stages',
      kind: 'linear',
      sourceOccurrenceIds: [ASSEMBLY_IDS.compressor],
      generatedCount: 2,
      definition: { direction: [0, 0, 1], spacing: 24 },
      suppressed: false,
    }],
    explodedViews: [], sectionViews: [],
  };
  return prepareStudioV5Project({
    schemaVersion: 5,
    projectId: 'project-slice-5e-assemblies',
    name: root.name,
    units: 'mm',
    parameters: [],
    materials: [],
    partDefinitions: [fan.part, shaft.part, nacelle.part, compressor.part, turbine.part],
    assemblyDefinitions: [fanSubassembly, root],
    rootDocument: { kind: 'assembly', assemblyId: root.id },
    resources: [], metadata: {},
  });
}

export function sourceIds() {
  const project = createSolvedAssemblyProject();
  return Object.fromEntries(project.partDefinitions.map((part: any) => [part.name, part.id]));
}
