// Canonical V5 release fixtures constructed only through the public typed CAD
// transaction service. There are no fixture-only geometry constructors, opaque
// imports, direct project mutations, or turbofan-specific runtime operations.

import { createEmptyStudioV5PartProject } from '../static/studio-project-v5.js';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { applyCadTransaction } from '../static/studio-agent-service.js';

type Operation = { kind: string; input: Record<string, any>; alias?: string };
type Construction = { project: any; log: any[] };

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function command(construction: Construction, label: string, operations: Operation[]): Construction {
  const transaction = {
    transactionId: `tx-release-${String(construction.log.length + 1).padStart(3, '0')}`,
    label,
    expectedRevision: construction.log.length,
    atomic: true,
    operations,
    metadata: { actor: 'agent', clientLabel: 'Canonical generic V5 construction replay' },
  };
  const applied = applyCadTransaction(construction.project, transaction);
  return { project: applied.project, log: [...construction.log, transaction] };
}

const circlePoints = (radius: number | string, count = 20) => Array.from({ length: count }, (_, index) => {
  const angle = index * Math.PI * 2 / count;
  const coordinate = (factor: number) => typeof radius === 'number'
    ? radius * factor
    : `(${radius})*${factor.toFixed(9)}`;
  return [coordinate(Math.cos(angle)), coordinate(Math.sin(angle))];
});

function standardDatums(prefix: string): Operation[] {
  return [
    { kind: 'datum.create', input: { id: `datum-${prefix}-axis`, name: `${prefix} axis`, datumKind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [1, 0, 0] } } },
    { kind: 'datum.create', input: { id: `datum-${prefix}-station`, name: `${prefix} station`, datumKind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [1, 0, 0], xDirection: [0, 1, 0] } } },
    { kind: 'datum.create', input: { id: `datum-${prefix}-xz`, name: `${prefix} longitudinal plane`, datumKind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [0, 1, 0], xDirection: [1, 0, 0] } } },
  ];
}

function revolvedBody(prefix: string, slug: string, name: string, points: any[]): Operation[] {
  const sketchId = `sketch-${prefix}-${slug}`;
  return [
    { kind: 'sketch.profile.create', input: { id: sketchId, name: `${name} profile`, planeDatumId: `datum-${prefix}-xz`, curveKind: 'polyline', points: points.map(([radius, axial]) => [axial, radius]) } },
    { kind: 'feature.revolveProfile', input: { id: `feature-${prefix}-${slug}`, name, bodyName: name, profileSketchId: sketchId, axisDatumId: `datum-${prefix}-axis`, angle: 360 } },
  ];
}

function createPart(construction: Construction, options: {
  partId: string; name: string; occurrenceId: string; operations: Operation[]; fixed?: boolean;
}): Construction {
  return command(construction, `Build ${options.name}`, [
    { kind: 'component.createPart', input: {
      partId: options.partId, name: options.name, occurrenceId: options.occurrenceId,
      occurrenceName: `${options.name}:1`, fixed: options.fixed === true, enterContext: true,
    } },
    ...options.operations,
    { kind: 'assembly.context.exit', input: {} },
  ]);
}

function bladeOperations(prefix: string, name: string, dimensions: {
  root: number | string; tip: number | string; chord: number; thickness: number; twist: number | string;
}): Operation[] {
  const root = dimensions.root;
  const tip = dimensions.tip;
  const mid = typeof root === 'number' && typeof tip === 'number' ? (root + tip) / 2 : `((${root})+(${tip}))/2`;
  // The canonical fan uses the specification's spline-section requirement.
  // Compressor and turbine rows deliberately use the permitted simplified
  // coordinate-loop sections while retaining independent root/mid/tip taper
  // and twist; this keeps the 12-blade source-edit gate below two seconds.
  const profileKind = prefix === 'fan-blade' ? 'spline' : 'polyline';
  const section = (chord: number, thickness: number) => prefix === 'fan-blade'
    ? [
        [-chord / 2, 0],
        [-chord * 0.12, -thickness],
        [chord / 2, 0],
        [-chord * 0.12, thickness],
      ]
    : [
        [-chord / 2, -thickness * 0.25],
        [-chord * 0.2, -thickness],
        [chord * 0.38, -thickness * 0.45],
        [chord / 2, 0],
        [chord * 0.38, thickness * 0.45],
        [-chord * 0.2, thickness],
        [-chord / 2, thickness * 0.25],
      ];
  return [
    ...standardDatums(prefix),
    { kind: 'datum.create', input: { id: `datum-${prefix}-radial-axis`, name: `${name} radial axis`, datumKind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [0, 1, 0] } } },
    { kind: 'datum.create', input: { id: `datum-${prefix}-span-base`, name: `${name} span base`, datumKind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [0, 1, 0], xDirection: [1, 0, 0] } } },
    { kind: 'datum.create', input: { id: `datum-${prefix}-root`, name: `${name} root plane`, datumKind: 'plane', definition: { mode: 'offset', referenceDatumId: `datum-${prefix}-span-base`, offset: root } } },
    { kind: 'datum.create', input: { id: `datum-${prefix}-mid-offset`, name: `${name} mid offset`, datumKind: 'plane', definition: { mode: 'offset', referenceDatumId: `datum-${prefix}-span-base`, offset: mid } } },
    { kind: 'datum.create', input: { id: `datum-${prefix}-mid`, name: `${name} mid twist`, datumKind: 'plane', definition: { mode: 'angle', referenceDatumId: `datum-${prefix}-mid-offset`, axisDatumId: `datum-${prefix}-radial-axis`, angle: typeof dimensions.twist === 'number' ? dimensions.twist / 2 : `(${dimensions.twist})/2` } } },
    { kind: 'datum.create', input: { id: `datum-${prefix}-tip-offset`, name: `${name} tip offset`, datumKind: 'plane', definition: { mode: 'offset', referenceDatumId: `datum-${prefix}-span-base`, offset: tip } } },
    { kind: 'datum.create', input: { id: `datum-${prefix}-tip`, name: `${name} tip twist`, datumKind: 'plane', definition: { mode: 'angle', referenceDatumId: `datum-${prefix}-tip-offset`, axisDatumId: `datum-${prefix}-radial-axis`, angle: dimensions.twist } } },
    { kind: 'sketch.profile.create', input: { id: `sketch-${prefix}-root`, name: `${name} root airfoil`, planeDatumId: `datum-${prefix}-root`, curveKind: profileKind, points: section(dimensions.chord, dimensions.thickness) } },
    { kind: 'sketch.profile.create', input: { id: `sketch-${prefix}-mid`, name: `${name} mid airfoil`, planeDatumId: `datum-${prefix}-mid`, curveKind: profileKind, points: section(dimensions.chord * 0.84, dimensions.thickness * 0.78) } },
    { kind: 'sketch.profile.create', input: { id: `sketch-${prefix}-tip`, name: `${name} tip airfoil`, planeDatumId: `datum-${prefix}-tip`, curveKind: profileKind, points: section(dimensions.chord * 0.68, dimensions.thickness * 0.58) } },
    { kind: 'feature.loft', input: {
      id: `feature-${prefix}-blade`, name: `${name} three-section Loft`, bodyName: name,
      sections: [`sketch-${prefix}-root`, `sketch-${prefix}-mid`, `sketch-${prefix}-tip`],
      mapping: 'explicit', continuity: { start: 'free', end: 'free' },
    } },
  ];
}

function mateReference(ownerId: string, occurrencePath: string[], role: string) {
  return { ownerKind: 'datum', ownerId, occurrencePath, semanticPath: { role }, signature: { role } };
}

function mateSet(anchor: { occurrenceId: string; prefix: string; path?: string[] }, moving: { occurrenceId: string; prefix: string; path?: string[] }, station: number | string): Operation[] {
  const anchorPath = anchor.path || [anchor.occurrenceId];
  const movingPath = moving.path || [moving.occurrenceId];
  return [
    { kind: 'mate.create', input: {
      id: `mate-${moving.occurrenceId}-concentric`, name: `${moving.occurrenceId} concentric`, mateKind: 'concentric',
      occurrenceIds: [anchor.occurrenceId, moving.occurrenceId],
      references: [mateReference(`datum-${anchor.prefix}-axis`, anchorPath, 'anchor'), mateReference(`datum-${moving.prefix}-axis`, movingPath, 'moving')],
    } },
    { kind: 'mate.create', input: {
      id: `mate-${moving.occurrenceId}-distance`, name: `${moving.occurrenceId} axial station`, mateKind: 'distance', value: station,
      occurrenceIds: [anchor.occurrenceId, moving.occurrenceId],
      references: [mateReference(`datum-${anchor.prefix}-station`, anchorPath, 'anchor'), mateReference(`datum-${moving.prefix}-station`, movingPath, 'moving')],
    } },
    { kind: 'mate.create', input: {
      id: `mate-${moving.occurrenceId}-angle`, name: `${moving.occurrenceId} clocking`, mateKind: 'angle', value: 0,
      occurrenceIds: [anchor.occurrenceId, moving.occurrenceId],
      references: [mateReference(`datum-${anchor.prefix}-axis`, anchorPath, 'anchor'), mateReference(`datum-${moving.prefix}-axis`, movingPath, 'moving')],
    } },
  ];
}

export const TURBOFAN_IDS = Object.freeze({
  rootAssembly: 'assembly-turbofan-v5', fanAssembly: 'assembly-fan-rotor-v5',
  nacelleOccurrence: 'occurrence-nacelle', fanRotorOccurrence: 'occurrence-fan-rotor',
  fanBladeOccurrence: 'occurrence-fan-blade-sub', fanPattern: 'pattern-fan-blades',
  hpcOccurrence: 'occurrence-hpc-rotor', hpcDistanceMate: 'mate-occurrence-hpc-rotor-distance',
  lpcStatorOccurrence: 'occurrence-lpc-stator', halfSection: 'section-turbofan-half',
});

export function buildCanonicalTurbofan(): Construction {
  let result: Construction = {
    project: createEmptyStudioV5PartProject({ projectId: 'project-canonical-turbofan-v5', name: 'Master layout', units: 'mm' }),
    log: [],
  };
  const masterPartId = result.project.rootDocument.partId;
  result = command(result, 'Create editable engine layout and root assembly', [
    { kind: 'parameter.create', input: { id: 'parameter-fan-tip-diameter', name: 'fanTipDiameter', value: 160 } },
    { kind: 'parameter.create', input: { id: 'parameter-fan-blade-count', name: 'fanBladeCount', value: 12 } },
    { kind: 'parameter.create', input: { id: 'parameter-fan-tip-twist', name: 'fanTipTwist', value: 20 } },
    { kind: 'parameter.create', input: { id: 'parameter-nacelle-wall', name: 'nacelleWall', value: 3 } },
    { kind: 'parameter.create', input: { id: 'parameter-hpc-station', name: 'hpcStation', value: 165 } },
    { kind: 'datum.create', input: { id: 'datum-master-axis', name: 'Engine axis', datumKind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [1, 0, 0] } } },
    { kind: 'datum.create', input: { id: 'datum-master-station', name: 'S00 datum', datumKind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [1, 0, 0], xDirection: [0, 1, 0] } } },
    { kind: 'assembly.create', input: { id: TURBOFAN_IDS.rootAssembly, name: 'Canonical editable turbofan', occurrenceId: 'occurrence-master-layout', occurrenceName: 'Master layout:1', fixed: true } },
  ]);

  const nacelleProfiles = [
    ['front', 37, 95], ['mid', 220, 92], ['rear', 430, 70],
  ] as const;
  const nacelleOps: Operation[] = [...standardDatums('nacelle')];
  for (const [slug, offset, radius] of nacelleProfiles) {
    nacelleOps.push(
      { kind: 'datum.create', input: { id: `datum-nacelle-${slug}`, name: `Nacelle ${slug} station`, datumKind: 'plane', definition: { mode: 'offset', referenceDatumId: 'datum-nacelle-station', offset } } },
      { kind: 'sketch.profile.create', input: { id: `sketch-nacelle-${slug}-outer`, name: `Nacelle ${slug} outer`, planeDatumId: `datum-nacelle-${slug}`, curveKind: 'spline', points: circlePoints(radius) } },
      { kind: 'sketch.profile.create', input: { id: `sketch-nacelle-${slug}-inner`, name: `Nacelle ${slug} inner`, planeDatumId: `datum-nacelle-${slug}`, curveKind: 'spline', points: circlePoints(`${radius}-nacelleWall`) } },
    );
  }
  nacelleOps.push(
    { kind: 'feature.loft', input: { id: 'feature-nacelle-outer', name: 'Three-section nacelle outer Loft', bodyName: 'Nacelle shell', sections: nacelleProfiles.map(([slug]) => `sketch-nacelle-${slug}-outer`), mapping: 'explicit', continuity: { start: 'tangent', end: 'tangent' } } },
    { kind: 'feature.loft', input: { id: 'feature-nacelle-inner-tool', name: 'Three-section nacelle passage Loft', bodyName: 'Nacelle passage tool', sections: nacelleProfiles.map(([slug]) => `sketch-nacelle-${slug}-inner`), mapping: 'explicit', continuity: { start: 'tangent', end: 'tangent' } } },
    { kind: 'boolean.subtract', input: { id: 'feature-nacelle-hollow', name: 'Hollow nacelle passage', targetBodyId: 'body-feature-nacelle-outer', toolBodyId: 'body-feature-nacelle-inner-tool', keepTools: false } },
    ...revolvedBody('nacelle', 'inlet-lip', 'Inlet lip', [[82, 0], [95, 0], [96, 18], [88, 35], [82, 25]]),
    // Keep the inner rear cowl mechanically separate from the hollow nacelle
    // shell instead of carrying a hidden overlapping annulus into inspection.
    ...revolvedBody('nacelle', 'rear-cowl', 'Rear bypass cowl', [[60, 360], [68, 360], [65, 430], [58, 430]]),
  );
  result = createPart(result, { partId: 'part-nacelle', name: 'Nacelle', occurrenceId: TURBOFAN_IDS.nacelleOccurrence, operations: nacelleOps });

  result = createPart(result, {
    partId: 'part-core-casing', name: 'Bypass splitter and core casing', occurrenceId: 'occurrence-core-casing',
    operations: [
      ...standardDatums('core-casing'),
      ...revolvedBody('core-casing', 'splitter', 'Bypass splitter', [[44, 76], [48, 76], [56, 98], [52, 98]]),
      ...revolvedBody('core-casing', 'core-shell', 'Core casing', [[52, 100], [56, 100], [53, 330], [49, 330]]),
    ],
  });

  const bladeParts = [
    ['fan-blade', 'Fan blade', 'occurrence-fan-blade-source-root', 22, 'fanTipDiameter/2', 32, 4.8, 'fanTipTwist'],
    ['egv', 'Fan exit guide vane', 'occurrence-egv', 65, 76, 18, 2.8, -16],
    ['lpc-rotor', 'LPC rotor blade', 'occurrence-lpc-rotor', 19, 42, 16, 3.0, 17],
    ['lpc-stator', 'LPC stator vane', TURBOFAN_IDS.lpcStatorOccurrence, 20, 43, 15, 2.8, -14],
    ['hpc-rotor', 'HPC rotor blade', TURBOFAN_IDS.hpcOccurrence, 22, 36, 13, 2.6, 19],
    ['hpc-stator', 'HPC stator vane', 'occurrence-hpc-stator', 18, 37, 12, 2.4, -16],
    ['hpt-rotor', 'HPT rotor blade', 'occurrence-hpt-rotor', 15, 32, 12, 3.1, 22],
    ['hpt-stator', 'HPT stator vane', 'occurrence-hpt-stator', 16, 33, 11, 2.8, -18],
    ['lpt-rotor', 'LPT rotor blade', 'occurrence-lpt-rotor', 23, 38, 12, 2.4, 18],
  ] as const;
  for (const [prefix, name, occurrenceId, root, tip, chord, thickness, twist] of bladeParts) {
    result = createPart(result, {
      partId: `part-${prefix}`, name, occurrenceId,
      operations: bladeOperations(prefix, name, { root, tip, chord, thickness, twist }),
    });
  }

  const revolvedParts = [
    // The fan disk is an annulus around the front bearing and shaft rather
    // than a visually hidden solid plug through both components.
    ['fan-disk', 'Fan disk', 'occurrence-fan-disk-source', [[15.5, -4], [21, -4], [21, 4], [15.5, 4]]],
    // Close the spinner on the disk's forward face with a real shaft/bearing
    // clearance instead of overlapping half of the disk volume.
    ['spinner', 'Spinner', 'occurrence-spinner-source', [[0, -34], [3, -32], [21, -5.5], [14, -5.5]]],
    ['lp-shaft', 'Low-pressure shaft', 'occurrence-lp-shaft', [[0, 55], [6, 55], [6, 305], [0, 305]]],
    ['hp-shaft', 'High-pressure shaft', 'occurrence-hp-shaft', [[10, 70], [13, 70], [13, 250], [10, 250]]],
    ['combustor-outer', 'Annular combustor casing', 'occurrence-combustor-outer', [[26, -28], [34, -28], [34, 28], [26, 28]]],
    ['combustor-liner', 'Inner combustor liner', 'occurrence-combustor-liner', [[17, -25], [20, -25], [20, 25], [17, 25]]],
    ['nozzle', 'Tapered exhaust nozzle', 'occurrence-nozzle', [[18, -25], [31, -25], [24, 55], [13, 55]]],
    ['rear-support', 'Rear support stator', 'occurrence-rear-support', [[39, -4], [43, -4], [43, 4], [39, 4]]],
    ['bearing-front', 'Front bearing placeholder', 'occurrence-bearing-front', [[7.5, -6], [14, -6], [14, 6], [7.5, 6]]],
    ['bearing-rear', 'Rear bearing placeholder', 'occurrence-bearing-rear', [[7.5, -7], [14, -7], [14, 7], [7.5, 7]]],
  ] as const;
  for (const [prefix, name, occurrenceId, points] of revolvedParts) {
    result = createPart(result, {
      partId: `part-${prefix}`, name, occurrenceId,
      operations: [...standardDatums(prefix), ...revolvedBody(prefix, 'body', name, points.map((point) => [...point]))],
    });
  }

  // Build the nested fan-rotor assembly from ordinary component operations.
  result = command(result, 'Create reusable Fan rotor subassembly', [
    { kind: 'document.activate', input: { definition: { kind: 'part', partId: 'part-fan-disk' } } },
    { kind: 'assembly.create', input: { id: TURBOFAN_IDS.fanAssembly, name: 'Fan rotor', occurrenceId: 'occurrence-fan-disk-sub', occurrenceName: 'Fan disk:1', fixed: false } },
    { kind: 'component.insert', input: { id: 'occurrence-spinner-sub', name: 'Spinner:1', definition: { kind: 'part', partId: 'part-spinner' }, baseTransform: identity } },
    { kind: 'component.insert', input: { id: TURBOFAN_IDS.fanBladeOccurrence, name: 'Fan blade source:1', definition: { kind: 'part', partId: 'part-fan-blade' }, baseTransform: identity } },
    { kind: 'mate.create', input: { id: 'mate-fan-disk-fixed', name: 'Fix fan disk', mateKind: 'fixed', occurrenceIds: ['occurrence-fan-disk-sub'], references: [] } },
    ...mateSet({ occurrenceId: 'occurrence-fan-disk-sub', prefix: 'fan-disk' }, { occurrenceId: 'occurrence-spinner-sub', prefix: 'spinner' }, 0),
    ...mateSet({ occurrenceId: 'occurrence-fan-disk-sub', prefix: 'fan-disk' }, { occurrenceId: TURBOFAN_IDS.fanBladeOccurrence, prefix: 'fan-blade' }, 0),
    { kind: 'component.pattern', input: { id: TURBOFAN_IDS.fanPattern, name: 'Fan blade row', kind: 'circular', sourceOccurrenceIds: [TURBOFAN_IDS.fanBladeOccurrence], generatedCount: 11, definition: { axis: [1, 0, 0], center: [0, 0, 0], totalAngle: 360 } } },
    { kind: 'document.activate', input: { definition: { kind: 'assembly', assemblyId: TURBOFAN_IDS.rootAssembly } } },
    { kind: 'component.delete', input: { occurrenceId: 'occurrence-fan-disk-source' } },
    { kind: 'component.delete', input: { occurrenceId: 'occurrence-spinner-source' } },
    { kind: 'component.delete', input: { occurrenceId: 'occurrence-fan-blade-source-root' } },
    { kind: 'component.insert', input: { id: TURBOFAN_IDS.fanRotorOccurrence, name: 'Fan rotor:1', definition: { kind: 'assembly', assemblyId: TURBOFAN_IDS.fanAssembly }, baseTransform: identity } },
  ]);

  const rowPatterns = [
    ['egv', 'occurrence-egv', 13, 'Fan exit guide vane row'],
    ['lpc-rotor', 'occurrence-lpc-rotor', 15, 'LPC rotor row'],
    ['lpc-stator', TURBOFAN_IDS.lpcStatorOccurrence, 17, 'LPC stator row'],
    ['hpc-rotor', TURBOFAN_IDS.hpcOccurrence, 17, 'HPC rotor row'],
    ['hpc-stator', 'occurrence-hpc-stator', 19, 'HPC stator row'],
    ['hpt-rotor', 'occurrence-hpt-rotor', 13, 'HPT rotor row'],
    ['hpt-stator', 'occurrence-hpt-stator', 15, 'HPT stator row'],
    ['lpt-rotor', 'occurrence-lpt-rotor', 17, 'LPT rotor row'],
  ] as const;
  result = command(result, 'Create eight editable axial blade-row patterns', rowPatterns.map(([prefix, occurrenceId, generatedCount, name]) => ({
    kind: 'component.pattern', input: {
      id: `pattern-${prefix}-row`, name, kind: 'circular', sourceOccurrenceIds: [occurrenceId], generatedCount,
      definition: { axis: [1, 0, 0], center: [0, 0, 0], totalAngle: 360 },
    },
  })));

  const anchor = { occurrenceId: TURBOFAN_IDS.nacelleOccurrence, prefix: 'nacelle' };
  const stations: Array<[string, string, number | string]> = [
    ['occurrence-core-casing', 'core-casing', 0],
    [TURBOFAN_IDS.fanRotorOccurrence, 'fan-disk', 55],
    ['occurrence-egv', 'egv', 82],
    ['occurrence-lpc-rotor', 'lpc-rotor', 120],
    [TURBOFAN_IDS.lpcStatorOccurrence, 'lpc-stator', 137],
    [TURBOFAN_IDS.hpcOccurrence, 'hpc-rotor', 'hpcStation'],
    ['occurrence-hpc-stator', 'hpc-stator', 181],
    ['occurrence-combustor-outer', 'combustor-outer', 240],
    ['occurrence-combustor-liner', 'combustor-liner', 240],
    ['occurrence-hpt-rotor', 'hpt-rotor', 300],
    ['occurrence-hpt-stator', 'hpt-stator', 316],
    ['occurrence-lpt-rotor', 'lpt-rotor', 342],
    ['occurrence-lp-shaft', 'lp-shaft', 0],
    ['occurrence-hp-shaft', 'hp-shaft', 0],
    ['occurrence-nozzle', 'nozzle', 375],
    ['occurrence-rear-support', 'rear-support', 365],
    ['occurrence-bearing-front', 'bearing-front', 60],
    ['occurrence-bearing-rear', 'bearing-rear', 280],
  ];
  const mateOperations: Operation[] = [
    { kind: 'mate.create', input: { id: 'mate-nacelle-fixed', name: 'Fix nacelle', mateKind: 'fixed', occurrenceIds: [TURBOFAN_IDS.nacelleOccurrence], references: [] } },
  ];
  for (const [occurrenceId, prefix, station] of stations) {
    const moving = occurrenceId === TURBOFAN_IDS.fanRotorOccurrence
      ? { occurrenceId, prefix, path: [occurrenceId, 'occurrence-fan-disk-sub'] }
      : { occurrenceId, prefix };
    mateOperations.push(...mateSet(anchor, moving, station));
  }
  result = command(result, 'Solve all engine modules with datum mates', mateOperations);

  result = command(result, 'Install the editable engineering material library', [
    { kind: 'material.ensureGeneric', input: {} },
  ]);
  const materialIds = ['material-generic-aluminum', 'material-generic-titanium', 'material-generic-stainless', 'material-generic-steel'];
  const materialAssignments = result.project.partDefinitions.flatMap((part: any, partIndex: number) =>
    part.bodies.map((body: any) => ({
      kind: 'material.assignBody',
      input: { partId: part.id, bodyId: body.id, materialId: materialIds[partIndex % materialIds.length] },
    })),
  );
  result = command(result, 'Assign materials and saved inspection state', [
    ...materialAssignments,
    { kind: 'appearance.assignOccurrence', input: { occurrenceId: 'occurrence-hpt-rotor', appearanceId: 'appearance-generic-titanium' } },
    { kind: 'section.create', input: { id: TURBOFAN_IDS.halfSection, name: 'Longitudinal half-section', kind: 'plane', planes: [{ normal: [0, 1, 0], offset: 0 }], cap: true, hatch: { enabled: true, spacing: 7, angle: 45, color: '#263746', fillColor: '#d8e0e4' } } },
    { kind: 'exploded.create', input: { id: 'exploded-turbofan-axial', name: 'Axial module exploded view', steps: [
      { occurrenceIds: [TURBOFAN_IDS.fanRotorOccurrence, 'occurrence-egv'], translation: [-45, 0, 0] },
      { occurrenceIds: ['occurrence-combustor-outer', 'occurrence-combustor-liner'], translation: [30, 0, 0] },
      { occurrenceIds: ['occurrence-nozzle', 'occurrence-rear-support'], translation: [65, 0, 0] },
    ] } },
    { kind: 'measurement.create', input: { id: 'measurement-turbofan-envelope', name: 'Nacelle envelope', measurementKind: 'bounding-box', definition: { bodyIds: [`${TURBOFAN_IDS.nacelleOccurrence}:body-feature-nacelle-outer`] } } },
    { kind: 'display.setMode', input: { mode: 'shaded-edges' } },
  ]);

  // The master layout remains a normal reusable part definition and the final
  // active document is the root assembly.
  if (!result.project.partDefinitions.some((part: any) => part.id === masterPartId)) throw new Error('Master layout part was lost.');
  return result;
}

export function buildGearboxFixture(): Construction {
  let result: Construction = {
    project: createEmptyStudioV5PartProject({ projectId: 'project-generality-gearbox-v5', name: 'Gearbox enclosure', units: 'mm' }),
    log: [],
  };
  result = command(result, 'Build multi-body gearbox enclosure', [
    { kind: 'feature.extrude', input: { id: 'feature-gearbox-case', name: 'Gearbox case', bodyName: 'Gearbox case', height: 45, sketch: { shapes: [{ kind: 'rect', x: -70, y: -45, w: 140, h: 90 }], z: -22.5 }, resultPolicy: { kind: 'new-body', bodyName: 'Gearbox case' } } },
    { kind: 'feature.extrude', input: { id: 'feature-gearbox-cover', name: 'Gearbox cover', bodyName: 'Gearbox cover', height: 5, sketch: { shapes: [{ kind: 'rect', x: -72, y: -47, w: 144, h: 94 }], z: 25 }, resultPolicy: { kind: 'new-body', bodyName: 'Gearbox cover' } } },
    { kind: 'assembly.create', input: { id: 'assembly-gearbox', name: 'Three-shaft gearbox', occurrenceId: 'occurrence-gearbox-case', fixed: true } },
  ]);
  const shaftSpecs = [['input', -40], ['idler', 0], ['output', 40]] as const;
  for (const [prefix, x] of shaftSpecs) {
    result = createPart(result, {
      partId: `part-gear-${prefix}`, name: `${prefix} shaft and gear`, occurrenceId: `occurrence-gear-${prefix}`,
      operations: [
        ...standardDatums(`gear-${prefix}`),
        ...revolvedBody(`gear-${prefix}`, 'shaft', `${prefix} shaft`, [[0, -30], [7, -30], [7, 30], [0, 30]]),
        ...revolvedBody(`gear-${prefix}`, 'gear', `${prefix} gear`, [[7, -8], [22, -8], [22, 8], [7, 8]]),
      ],
    });
    result = command(result, `Position ${prefix} shaft`, [
      { kind: 'component.update', input: { occurrenceId: `occurrence-gear-${prefix}`, patch: { baseTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, x, 0, 1], fixed: true } } },
    ]);
  }
  result = createPart(result, {
    partId: 'part-gearbox-fastener', name: 'Gearbox cover fastener', occurrenceId: 'occurrence-fastener-source',
    operations: [
      ...standardDatums('gearbox-fastener'),
      ...revolvedBody('gearbox-fastener', 'body', 'Cover fastener', [[0, -3], [2.5, -3], [2.5, 3], [0, 3]]),
    ],
  });
  result = command(result, 'Pattern fasteners and save gearbox section', [
    { kind: 'component.update', input: { occurrenceId: 'occurrence-fastener-source', patch: { baseTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 64, 0, 28, 1], fixed: true } } },
    { kind: 'component.pattern', input: { id: 'pattern-gearbox-fasteners', name: 'Cover fasteners', kind: 'circular', sourceOccurrenceIds: ['occurrence-fastener-source'], generatedCount: 7, definition: { axis: [0, 0, 1], center: [0, 0, 0], totalAngle: 360 } } },
    { kind: 'section.create', input: { id: 'section-gearbox', name: 'Gear train section', kind: 'plane', planes: [{ normal: [0, 1, 0], offset: 0 }], cap: true } },
    { kind: 'material.ensureGeneric', input: {} },
    { kind: 'material.assignBody', input: { partId: result.project.partDefinitions[0].id, bodyId: 'body-feature-gearbox-case', materialId: 'material-generic-aluminum' } },
  ]);
  return result;
}

export function buildRobotJointFixture(): Construction {
  let result: Construction = {
    project: createEmptyStudioV5PartProject({ projectId: 'project-generality-robot-joint-v5', name: 'Robot joint bracket', units: 'mm' }),
    log: [],
  };
  result = command(result, 'Build swept robot-joint bracket', [
    { kind: 'datum.create', input: { id: 'datum-robot-xy', name: 'Robot XY', datumKind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [0, 0, 1], xDirection: [1, 0, 0] } } },
    { kind: 'sketch.profile.create', input: { id: 'sketch-robot-profile', name: 'Bracket profile', planeDatumId: 'datum-robot-xy', curveKind: 'polyline', points: [[-8, -5], [8, -5], [8, 5], [-8, 5]] } },
    { kind: 'sketch.path.create', input: { id: 'sketch-robot-path', name: 'Bracket sweep path', curveKind: 'spline', points: [[0, 0, 0], [0, 0, 45], [25, 0, 70], [45, 0, 70]] } },
    { kind: 'feature.sweep', input: { id: 'feature-robot-arm', name: 'Swept robot arm', bodyName: 'Robot arm', profileSketchId: 'sketch-robot-profile', pathSketchId: 'sketch-robot-path', orientation: 'minimum-twist', transition: 'round' } },
    { kind: 'datum.create', input: { id: 'datum-robot-mirror', name: 'Robot mirror plane', datumKind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [0, 1, 0], xDirection: [1, 0, 0] } } },
    { kind: 'body.transform', input: { id: 'feature-robot-mirror', name: 'Mirrored bracket arm', bodyId: 'body-feature-robot-arm', bodyName: 'Mirrored robot arm', copy: true, transform: { mode: 'mirror', planeDatumId: 'datum-robot-mirror' } } },
    { kind: 'assembly.create', input: { id: 'assembly-robot-joint', name: 'Robot joint', occurrenceId: 'occurrence-robot-bracket', fixed: true } },
  ]);
  const components = [
    ['robot-shaft', 'Robot joint shaft', 'occurrence-robot-shaft', [[0, -25], [8, -25], [8, 25], [0, 25]]],
    ['robot-bearing', 'Robot joint bearing', 'occurrence-robot-bearing', [[8.5, -8], [16, -8], [16, 8], [8.5, 8]]],
    ['robot-motor', 'Robot joint motor', 'occurrence-robot-motor', [[0, -22], [28, -22], [28, 22], [0, 22]]],
    ['robot-cover', 'Robot joint cover', 'occurrence-robot-cover', [[17, -10], [31, -10], [31, 10], [17, 10]]],
  ] as const;
  for (const [prefix, name, occurrenceId, points] of components) {
    result = createPart(result, { partId: `part-${prefix}`, name, occurrenceId, operations: [...standardDatums(prefix), ...revolvedBody(prefix, 'body', name, points.map((point) => [...point]))] });
  }
  result = command(result, 'Finish robot-joint inspection and materials', [
    { kind: 'component.update', input: { occurrenceId: 'occurrence-robot-shaft', patch: { fixed: true } } },
    { kind: 'component.update', input: { occurrenceId: 'occurrence-robot-bearing', patch: { baseTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 18, 1], fixed: true } } },
    { kind: 'component.update', input: { occurrenceId: 'occurrence-robot-motor', patch: { baseTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -32, 1], fixed: true } } },
    { kind: 'component.update', input: { occurrenceId: 'occurrence-robot-cover', patch: { baseTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 32, 1], fixed: true } } },
    { kind: 'material.ensureGeneric', input: {} },
    { kind: 'material.assignBody', input: { partId: result.project.partDefinitions[0].id, bodyId: 'body-feature-robot-arm', materialId: 'material-generic-aluminum' } },
    { kind: 'section.create', input: { id: 'section-robot-joint', name: 'Robot joint section', kind: 'plane', planes: [{ normal: [0, 1, 0], offset: 0 }], cap: true } },
  ]);
  return result;
}
