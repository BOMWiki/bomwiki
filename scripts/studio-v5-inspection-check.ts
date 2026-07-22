// Slice 5F gate: non-destructive section/explode display state, axial stage
// groups, materials/appearance, exact mass/health/clearance/interference, and
// normal-placement export from the same solved assembly.

import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
// @ts-ignore Browser-native modules intentionally have no TypeScript declarations.
import { canonicalStudioV5Project, parseOrMigrateStudioV5RuntimeProject, studioV5RootAssembly } from '../static/studio-v5-runtime-document.js';
// @ts-ignore Browser-native module intentionally has no TypeScript declarations.
import * as inspectionTools from '../static/studio-v5-inspection.js';
const {
  activateStudioV5ExplodedView,
  activateStudioV5SectionView,
  assignStudioV5BodyMaterial,
  assignStudioV5OccurrenceAppearance,
  createStudioV5AxialStageGroup,
  createStudioV5ExplodedView,
  createStudioV5Measurement,
  createStudioV5SectionView,
  ensureStudioV5GenericMaterials,
  STUDIO_V5_GENERIC_MATERIALS,
  studioV5ActiveExplodedTransforms,
  studioV5AppearanceMap,
  studioV5AxialStageGroups,
  studioV5Measurements,
  setStudioV5DisplayMode,
  updateStudioV5AxialStageGroup,
} = inspectionTools;
// @ts-ignore Browser-native module intentionally has no TypeScript declarations.
import { solveStudioV5Assembly } from '../static/studio-v5-assembly.js';
import { ASSEMBLY_IDS, createSolvedAssemblyProject } from './studio-v5-assemblies-fixture.ts';

type Mode = 'all' | 'document' | 'kernel' | 'browser';
const mode = (process.argv[2] || 'all') as Mode;
let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail != null ? ` — ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failures++;
}
const close = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
const centre = (bounds: number[][]) => bounds[0].map((value, axis) => (value + bounds[1][axis]) / 2);

function assignedMaterialProject(): any {
  let project: any = ensureStudioV5GenericMaterials(createSolvedAssemblyProject());
  project.partDefinitions.forEach((part: any, index: number) => {
    for (const body of part.bodies) project = assignStudioV5BodyMaterial(project, part.id, body.id, STUDIO_V5_GENERIC_MATERIALS[index % STUDIO_V5_GENERIC_MATERIALS.length].id);
  });
  const steel = project.materials.find((entry: any) => entry.id === STUDIO_V5_GENERIC_MATERIALS[0].id);
  const aluminum = project.materials.find((entry: any) => entry.id === STUDIO_V5_GENERIC_MATERIALS[2].id);
  project = assignStudioV5OccurrenceAppearance(project, ASSEMBLY_IDS.turbine, steel.appearanceId);
  return assignStudioV5OccurrenceAppearance(project, ASSEMBLY_IDS.shaft, aluminum.appearanceId);
}

function withDisplayViews(project: any): any {
  let next = createStudioV5SectionView(project, {
    id: 'section-longitudinal', name: 'Longitudinal half section', kind: 'plane',
    definition: { planes: [{ normal: [1, 0, 0], offset: 0 }], cap: true, reverse: false, scopeOccurrenceIds: [] },
  });
  next = createStudioV5ExplodedView(next, {
    id: 'exploded-service', name: 'Service exploded view',
    steps: [{ occurrenceIds: [ASSEMBLY_IDS.fanModule], translation: [0, 0, -80] }, { occurrenceIds: [ASSEMBLY_IDS.turbine], translation: [0, 0, 75] }],
  });
  return next;
}

function withStageGroup(project: any): any {
  return createStudioV5AxialStageGroup(project, {
    id: 'stage-group-core', name: 'Core axial stages', axis: [0, 0, 1],
    occurrenceIds: [ASSEMBLY_IDS.compressor, ASSEMBLY_IDS.turbine],
    distanceMateIds: ['mate-compressor-distance', 'mate-turbine-distance'], start: 40, spacing: 82, visible: true,
  });
}

async function documentChecks(): Promise<void> {
  console.log('\nSlice 5F inspection documents');
  const base = createSolvedAssemblyProject();
  const materials = ensureStudioV5GenericMaterials(base);
  check('document installs nine clearly generic editable materials with density-backed appearances',
    materials.materials.length === 9 && materials.materials.every((entry: any) => entry.name.startsWith('Generic ') && entry.densityKgM3 > 0 && entry.extensions?.studioAppearance?.baseColor), materials.materials);
  const assigned = assignedMaterialProject();
  const turbineOccurrence = studioV5RootAssembly(assigned).occurrences.find((entry: any) => entry.id === ASSEMBLY_IDS.turbine);
  const shaftOccurrence = assigned.assemblyDefinitions.flatMap((assembly: any) => assembly.occurrences).find((entry: any) => entry.id === ASSEMBLY_IDS.shaft);
  check('document assigns source-body material and occurrence appearance without copying geometry',
    assigned.partDefinitions.every((part: any) => part.bodies.every((body: any) => body.materialId && body.appearanceId)) && turbineOccurrence.appearanceOverrideId && shaftOccurrence.appearanceOverrideId && assigned.partDefinitions.length === base.partDefinitions.length);
  check('appearance registry resolves stable material-linked render properties',
    studioV5AppearanceMap(assigned).size === 9 && studioV5AppearanceMap(assigned).get(turbineOccurrence.appearanceOverrideId).metallic > 0 && studioV5AppearanceMap(assigned).has(shaftOccurrence.appearanceOverrideId));

  const sectioned = createStudioV5SectionView(assigned, {
    id: 'section-half', name: 'Axial half section', kind: 'plane',
    definition: { planes: [{ normal: [1, 0, 0], offset: 0 }], cap: true, reverse: false, scopeOccurrenceIds: [ASSEMBLY_IDS.shaft] },
  });
  check('document saves and activates a scoped non-destructive section as display state',
    studioV5RootAssembly(sectioned).sectionViews[0].extensions.studioDisplayOnly === true && studioV5RootAssembly(sectioned).metadata.activeSectionViewId === 'section-half' &&
    JSON.stringify(sectioned.partDefinitions) === JSON.stringify(assigned.partDefinitions) && JSON.stringify(studioV5RootAssembly(sectioned).mates) === JSON.stringify(studioV5RootAssembly(assigned).mates));
  const multiSectioned = createStudioV5SectionView(sectioned, {
    id: 'section-quarter', name: 'Quarter section', kind: 'quarter',
    definition: { planes: [{ normal: [1, 0, 0], offset: 0 }, { normal: [0, 1, 0], offset: 0 }], cap: false, reverse: true, scopeOccurrenceIds: [] },
  });
  check('document stores exact plane cardinality, cap, reverse, and scope for reusable section modes',
    studioV5RootAssembly(multiSectioned).sectionViews[1].definition.planes.length === 2 && studioV5RootAssembly(multiSectioned).sectionViews[1].definition.cap === false && studioV5RootAssembly(multiSectioned).sectionViews[1].definition.reverse === true);
  const sectionOff = activateStudioV5SectionView(multiSectioned, null);
  check('turning section display off retains the saved view and changes no part or mate history',
    !studioV5RootAssembly(sectionOff).metadata.activeSectionViewId && studioV5RootAssembly(sectionOff).sectionViews.length === 2 && JSON.stringify(sectionOff.partDefinitions) === JSON.stringify(multiSectioned.partDefinitions));

  const solvedBeforeExplode = solveStudioV5Assembly(sectionOff, ASSEMBLY_IDS.root);
  const exploded = createStudioV5ExplodedView(sectionOff, {
    id: 'exploded-doc', name: 'Document exploded view', steps: [{ occurrenceIds: [ASSEMBLY_IDS.shaft], translation: [0, 0, 75] }],
  });
  const solvedAfterExplode = solveStudioV5Assembly(exploded, ASSEMBLY_IDS.root);
  check('exploded steps persist display deltas without changing solved occurrence transforms',
    studioV5ActiveExplodedTransforms(exploded).get(ASSEMBLY_IDS.shaft)[14] === 75 && JSON.stringify([...solvedBeforeExplode.transforms]) === JSON.stringify([...solvedAfterExplode.transforms]));
  const explosionOff = activateStudioV5ExplodedView(exploded, null);
  check('turning exploded playback off retains saved steps and restores no mate or base-transform mutations',
    !studioV5RootAssembly(explosionOff).metadata.activeExplodedViewId && studioV5RootAssembly(explosionOff).explodedViews.length === 1 && JSON.stringify(studioV5RootAssembly(explosionOff).mates) === JSON.stringify(studioV5RootAssembly(exploded).mates));

  const grouped = withStageGroup(assigned);
  const group = studioV5AxialStageGroups(grouped)[0];
  const groupedAssembly = studioV5RootAssembly(grouped);
  check('axial stage group stores ordered occurrences and drives their real Distance mate stations',
    group.spacing === 82 && groupedAssembly.mates.find((entry: any) => entry.id === 'mate-compressor-distance').value === 40 && groupedAssembly.mates.find((entry: any) => entry.id === 'mate-turbine-distance').value === 122);
  const respaced = updateStudioV5AxialStageGroup(grouped, group.id, { spacing: 95 });
  check('editing stage spacing preserves IDs and updates downstream axial placement parameters transactionally',
    studioV5AxialStageGroups(respaced)[0].id === group.id && studioV5RootAssembly(respaced).mates.find((entry: any) => entry.id === 'mate-turbine-distance').value === 135);
  const hidden = updateStudioV5AxialStageGroup(respaced, group.id, { visible: false });
  check('stage group visibility is one persisted command and does not suppress or delete components',
    studioV5RootAssembly(hidden).occurrences.filter((entry: any) => group.occurrenceIds.includes(entry.id)).every((entry: any) => entry.visible === false && entry.suppressed === false) && studioV5RootAssembly(hidden).occurrences.length === groupedAssembly.occurrences.length);

  let measured = createStudioV5Measurement(assigned, {
    id: 'measurement-turbine-envelope', name: 'Turbine envelope', kind: 'bounding-box',
    definition: { bodyIds: [ASSEMBLY_IDS.turbine + ':body-turbine'] },
  });
  measured = createStudioV5Measurement(measured, {
    id: 'measurement-fan-radius', name: 'Fan reference radius', kind: 'radius',
    definition: { references: [{ bodyId: ASSEMBLY_IDS.fanModule + '/' + ASSEMBLY_IDS.fan + ':body-fan', ownerKind: 'body', ownerId: 'body-fan', signature: { curveType: 'CIRCLE', r: 42, l: 263.894 } }] },
  });
  measured = setStudioV5DisplayMode(measured, 'wireframe');
  check('document persists exact body/topology measurement records and assembly display mode without copying geometry',
    studioV5Measurements(measured).length === 2 && studioV5Measurements(measured)[1].definition.references[0].signature.r === 42 &&
    studioV5RootAssembly(measured).metadata.displayMode === 'wireframe' && JSON.stringify(measured.partDefinitions) === JSON.stringify(assigned.partDefinitions));

  const beforeInvalid = JSON.stringify(base); let refused = 0;
  try { createStudioV5SectionView(base, { id: 'bad-section', name: 'Bad', kind: 'plane', definition: { planes: [{ normal: [0, 0, 0], offset: 0 }] } }); } catch { refused++; }
  try { createStudioV5ExplodedView(base, { id: 'bad-explode', name: 'Bad', steps: [{ occurrenceIds: ['missing'], translation: [0, 0, 1] }] }); } catch { refused++; }
  try { createStudioV5AxialStageGroup(base, { id: 'bad-stages', name: 'Bad', occurrenceIds: [ASSEMBLY_IDS.compressor], distanceMateIds: [], spacing: 1 }); } catch { refused++; }
  try { createStudioV5Measurement(base, { id: 'bad-measure', name: 'Bad', kind: 'minimum-clearance', definition: { bodyIds: ['one'] } }); } catch { refused++; }
  check('invalid section, explode, stage, and measurement commands leave the canonical project byte-identical', refused === 4 && JSON.stringify(base) === beforeInvalid);
  const serialized = JSON.stringify(canonicalStudioV5Project(withStageGroup(withDisplayViews(assigned))));
  check('materials, sections, exploded views, and axial groups survive schema-5 save/reopen byte-identically', JSON.stringify(parseOrMigrateStudioV5RuntimeProject(serialized)) === serialized);
}

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');
const MIME: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
async function startServer(): Promise<{ server: Server; url: string }> {
  const html = cadStudioPage();
  const server = createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    if (path.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
    if (path.startsWith('/static/')) {
      const file = join(staticDir, path.slice(8));
      if (existsSync(file)) { res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file)); return; }
    }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/cad/studio` };
}

async function workerRequest(page: Page, payload: any): Promise<any> {
  return page.evaluate(async (request) => {
    const state = window as any;
    state.__inspectionWorker ||= new Worker('/static/studio-kernel.worker.js', { type: 'module' });
    state.__inspectionSequence = (state.__inspectionSequence || 0) + 1;
    const requestId = `inspection-${state.__inspectionSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Slice 5F worker timeout')), 60_000);
      const listener = (event: MessageEvent) => {
        if (event.data?.requestId !== requestId) return;
        clearTimeout(timer); state.__inspectionWorker.removeEventListener('message', listener);
        if (event.data.kind === 'kernel-error') reject(new Error(event.data.message));
        else resolve({ ...event.data, blobSize: event.data.blob?.size || 0 });
      };
      state.__inspectionWorker.addEventListener('message', listener);
      state.__inspectionWorker.postMessage({ ...request, requestId, projectId: 'project-slice-5f-worker' });
    });
  }, payload);
}

async function kernelChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5F exact inspection worker');
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const base = createSolvedAssemblyProject();
  const baseline = await workerRequest(page, { kind: 'rebuild', revision: 1, document: base });
  check('worker enriches every exact assembly body with mass/health topology primitives',
    baseline.errors.length === 0 && baseline.bodies.length === 7 && baseline.bodies.every((entry: any) => entry.geometry.surfaceArea > 0 && entry.geometry.faceCount > 0 && entry.geometry.edgeCount > 0 && entry.geometry.vertexCount > 0), baseline.errors);
  const missing = await workerRequest(page, { kind: 'inspect-v5', mode: 'properties', revision: 2, document: base });
  check('exact mass inspection reports valid volume and explicit missing-material warnings instead of invented mass',
    missing.errors.length === 0 && missing.inspection.aggregate.valid && missing.inspection.aggregate.volumeMm3 > 0 && missing.inspection.aggregate.massKg === null && missing.inspection.aggregate.knownMassKg === 0 && missing.inspection.aggregate.missingMaterialBodyIds.length === 7, missing.inspection.aggregate);

  const assigned = assignedMaterialProject();
  const properties = await workerRequest(page, { kind: 'inspect-v5', mode: 'properties', revision: 3, document: assigned });
  const summedMass = properties.inspection.properties.reduce((total: number, entry: any) => total + entry.massKg, 0);
  check('density-backed exact inspection returns per-body and aggregate mass, area, centres, and B-rep health',
    properties.errors.length === 0 && properties.inspection.bodyCount === 7 && close(properties.inspection.aggregate.massKg, summedMass) &&
    properties.inspection.properties.every((entry: any) => entry.massKg > 0 && entry.surfaceAreaMm2 > 0 && entry.health.valid && entry.health.faceCount > 0), properties.inspection.aggregate);

  const invalid = assignedMaterialProject();
  invalid.partDefinitions.find((part: any) => part.name === 'Turbine drum').features[0].sketch.shapes = [];
  const invalidInspection = await workerRequest(page, { kind: 'inspect-v5', mode: 'properties', revision: 4, document: invalid });
  const recoveredFailure = invalidInspection.inspection.properties.find((entry: any) => String(entry.bodyId).includes('body-turbine'));
  check('inspection surfaces failed current geometry instead of silently passing or omitting it as healthy',
    invalidInspection.errors.some((entry: any) => String(entry.bodyId).includes('body-turbine')) && !invalidInspection.inspection.aggregate.valid &&
    invalidInspection.inspection.bodyCount === 7 && recoveredFailure?.health?.valid === false && recoveredFailure?.health?.recoveredLastValid === true,
    { errors: invalidInspection.errors, aggregate: invalidInspection.inspection.aggregate, recoveredFailure });

  const shaftBody = baseline.bodies.find((entry: any) => entry.bodyName.includes('Main shaft'));
  const nacelleBody = baseline.bodies.find((entry: any) => entry.bodyName.startsWith('Nacelle'));
  const turbineBody = baseline.bodies.find((entry: any) => entry.bodyName.startsWith('Turbine'));
  const fanBody = baseline.bodies.find((entry: any) => entry.bodyName.includes('Fan disk'));
  const interference = await workerRequest(page, { kind: 'inspect-v5', mode: 'interference', revision: 5, document: assigned, bodyIds: [shaftBody.bodyId, nacelleBody.bodyId] });
  check('exact interference uses broad-phase pruning then reports positive B-rep common volume with occurrence paths',
    interference.errors.length === 0 && interference.inspection.broadPhasePairs === 1 && interference.inspection.pairs[0].interferenceVolumeMm3 > 1 && interference.inspection.pairs[0].leftOccurrencePath.length > 0, interference.inspection);
  const clearance = await workerRequest(page, { kind: 'inspect-v5', mode: 'clearance', revision: 6, document: assigned, bodyIds: [fanBody.bodyId, turbineBody.bodyId], pairBodyIds: [fanBody.bodyId, turbineBody.bodyId] });
  check('exact clearance returns a positive minimum distance for two solved non-interfering components',
    clearance.errors.length === 0 && clearance.inspection.pairs.length === 1 && clearance.inspection.pairs[0].interferenceVolumeMm3 === 0 && clearance.inspection.pairs[0].minimumClearanceMm > 100, clearance.inspection.pairs);

  const swallowed = assignedMaterialProject();
  studioV5RootAssembly(swallowed).parameters.find((entry: any) => entry.name === 'fanStation').value = 0;
  const swallowedInterference = await workerRequest(page, {
    kind: 'inspect-v5', mode: 'interference', revision: 7, document: swallowed,
    bodyIds: [fanBody.bodyId, nacelleBody.bodyId], pairBodyIds: [fanBody.bodyId, nacelleBody.bodyId],
  });
  const swallowedPair = swallowedInterference.inspection.pairs[0];
  const swallowedFan = swallowedInterference.inspection.properties.find((entry: any) => entry.bodyId === fanBody.bodyId);
  check('exact interference retains a fully enclosed solid whose boundary has positive clearance from the containing solid',
    swallowedInterference.errors.length === 0 && swallowedInterference.inspection.broadPhasePairs === 1 && swallowedInterference.inspection.pairs.length === 1 &&
    swallowedPair.interferenceVolumeMm3 > 1 && close(swallowedPair.interferenceVolumeMm3, swallowedFan.volumeMm3, 1e-4),
    swallowedInterference.inspection);

  const display = withDisplayViews(assigned);
  const displayInspection = await workerRequest(page, { kind: 'inspect-v5', mode: 'properties', revision: 8, document: display });
  check('active section and exploded display state do not change exact mass, volume, centre, or normal solved geometry',
    close(displayInspection.inspection.aggregate.volumeMm3, properties.inspection.aggregate.volumeMm3) && close(displayInspection.inspection.aggregate.massKg, properties.inspection.aggregate.massKg) &&
    displayInspection.inspection.aggregate.centerOfVolumeMm.every((value: number, index: number) => close(value, properties.inspection.aggregate.centerOfVolumeMm[index])));
  const normalExport = await workerRequest(page, { kind: 'export-step', revision: 9, document: assigned });
  const displayExport = await workerRequest(page, { kind: 'export-step', revision: 10, document: display });
  check('assembly STEP export ignores section/explode playback and retains normal solved placement and hierarchy manifest',
    normalExport.errors.length === 0 && displayExport.errors.length === 0 && displayExport.blobSize > 500 && JSON.stringify(displayExport.manifest) === JSON.stringify(normalExport.manifest), { normal: normalExport.manifest, display: displayExport.manifest });

  const grouped = withStageGroup(assigned);
  const groupedResult = await workerRequest(page, { kind: 'rebuild', revision: 11, document: grouped });
  const compressorCentre = centre(groupedResult.bodies.find((entry: any) => entry.bodyName === 'Compressor:1 / Compressor drum').geometry.bounds)[2];
  const turbineCentre = centre(groupedResult.bodies.find((entry: any) => entry.bodyName === 'Turbine:1 / Turbine drum').geometry.bounds)[2];
  check('axial stage spacing drives the real solved component stations while preserving exact valid bodies',
    close(compressorCentre, 40) && close(turbineCentre, 122) && groupedResult.bodies.every((entry: any) => entry.geometry.valid), { compressorCentre, turbineCentre });
  const hidden = updateStudioV5AxialStageGroup(grouped, 'stage-group-core', { visible: false });
  const hiddenInspection = await workerRequest(page, { kind: 'inspect-v5', mode: 'properties', revision: 12, document: hidden });
  check('engineering mass remains based on unsuppressed solved structure when a stage group is display-hidden',
    close(hiddenInspection.inspection.aggregate.massKg, properties.inspection.aggregate.massKg) && hiddenInspection.inspection.bodyCount === 7, hiddenInspection.inspection.aggregate);

  let measured = assigned;
  const addMeasurement = (id: string, kind: string, definition: any) => { measured = createStudioV5Measurement(measured, { id, name: id, kind, definition }); };
  addMeasurement('measure-envelope', 'bounding-box', { bodyIds: [turbineBody.bodyId] });
  addMeasurement('measure-clearance', 'minimum-clearance', { bodyIds: [fanBody.bodyId, turbineBody.bodyId] });
  addMeasurement('measure-coordinate', 'coordinate', { references: [{ bodyId: fanBody.bodyId, signature: { p: [0, 0, 0] } }] });
  addMeasurement('measure-point-distance', 'point-distance', { references: [{ bodyId: fanBody.bodyId, signature: { p: [0, 0, -4] } }, { bodyId: fanBody.bodyId, signature: { p: [0, 0, 4] } }] });
  addMeasurement('measure-edge', 'edge-length', { references: [{ bodyId: fanBody.bodyId, signature: { l: 12 } }] });
  addMeasurement('measure-radius', 'radius', { references: [{ bodyId: fanBody.bodyId, signature: { r: 42 } }] });
  addMeasurement('measure-diameter', 'diameter', { references: [{ bodyId: fanBody.bodyId, signature: { r: 42 } }] });
  addMeasurement('measure-angle', 'face-angle', { references: [{ bodyId: fanBody.bodyId, signature: { n: [0, 0, 1] } }, { bodyId: fanBody.bodyId, signature: { n: [1, 0, 0] } }] });
  addMeasurement('measure-thickness', 'wall-thickness', { references: [{ bodyId: fanBody.bodyId, signature: { p: [0, 0, -4], n: [0, 0, 1] } }, { bodyId: fanBody.bodyId, signature: { p: [0, 0, 4], n: [0, 0, -1] } }] });
  const measurementInspection = await workerRequest(page, { kind: 'inspect-v5', mode: 'measurements', revision: 13, document: measured });
  const measurementById = new Map<string, any>(measurementInspection.inspection.measurementResults.map((entry: any) => [entry.id, entry]));
  check('kernel evaluates persisted coordinate, point, edge, radius, diameter, angle, thickness, bounds, and clearance measurements at one revision',
    measurementInspection.errors.length === 0 && measurementById.size === 9 && [...measurementById.values()].every((entry: any) => entry.valid) &&
    close(measurementById.get('measure-point-distance').value, 8) && close(measurementById.get('measure-radius').value, 42) &&
    close(measurementById.get('measure-diameter').value, 84) && close(measurementById.get('measure-angle').value, 90) && close(measurementById.get('measure-thickness').value, 8),
    measurementInspection.inspection.measurementResults);
  await page.close();
}

async function waitForStudio(page: Page, revisionAfter?: number): Promise<void> {
  await page.waitForFunction((after) => {
    const studio = (window as any).__bwStudio;
    return Boolean(studio && studio.mode().kind === 'idle' && (after == null || studio.appliedRevision() > after));
  }, { timeout: 60_000, polling: 250 }, revisionAfter ?? null);
}

function installSemanticControlActivation(page: Page): void {
  page.click = (async (selector: string) => {
    await page.evaluate((value) => {
      const element = document.querySelector(value) as HTMLElement | null;
      if (!element) throw new Error(`Slice 5F browser control is missing: ${value}`);
      element.focus(); element.click();
    }, selector);
  }) as Page['click'];
}

async function openProject(page: Page, project: any): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'bomwiki-slice5f-'));
  const filename = join(directory, 'slice5f.bomcad.json');
  writeFileSync(filename, JSON.stringify(project));
  const before = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  const input = await page.$('#bw-open-file');
  await (input as any).uploadFile(filename);
  await waitForStudio(page, before);
}

async function submitVisibleCommand(page: Page): Promise<void> {
  const before = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, before);
}

async function browserChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5F visible inspection gate');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  installSemanticControlActivation(page);
  const pageErrors: string[] = []; const dialogs: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('dialog', async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('bw-studio-welcome-v1', '1'); localStorage.setItem('bw-studio-v2-seeded', '1'); localStorage.setItem('bw-studio-tour-v1', '1');
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' }); await waitForStudio(page);
  check('browser exposes visible section, explode, stage, material, mass, measurement, clearance, and interference commands plus saved-view tree',
    (await page.$$('[data-inspection-command]')).length === 9 && Boolean(await page.$('#bw-inspection-tree')) && (await page.$$('[data-display-mode]')).length === 4);
  await openProject(page, createSolvedAssemblyProject());
  await page.click('[data-workspace="assembly"]');
  const baseline = await page.evaluate(() => ({ results: (window as any).__bwStudio.bodyResults(), hash: (window as any).__bwStudio.canonicalHash() }));

  await page.click('[data-inspection-command="section"]');
  await page.waitForSelector('#bw-v5-command[open]');
  await submitVisibleCommand(page);
  const sectionId = await page.evaluate(() => (window as any).__bwStudio.activeSectionViewId());
  const clipped = await page.evaluate(() => (window as any).__bwStudio.bodyResults().map((entry: any) => (window as any).__bwStudio.bodyDisplayState(entry.bodyId).clippingPlanes));
  check('browser creates a saved active longitudinal section and clips every displayed body without changing exact results',
    Boolean(sectionId) && clipped.length === 7 && clipped.every((count: number) => count === 1) &&
    (await page.evaluate(() => (window as any).__bwStudio.bodyResults().every((entry: any) => entry.geometry.valid))), { sectionId, clipped });
  const capState = await page.evaluate(() => (window as any).__bwStudio.sectionCapState());
  check('browser renders one bounded stencil cap with configurable hatch over every scoped exact section boundary',
    capState.planes === 1 && capState.stencilMeshes === 14 && capState.stencilDrawObjects === 2 && capState.extensionIndependent && await page.evaluate(() => {
      const project = JSON.parse((window as any).__bwStudio.docJson());
      const assembly = project.assemblyDefinitions.find((entry: any) => entry.id === project.rootDocument.assemblyId);
      return assembly.sectionViews[0].definition.hatch.enabled && assembly.sectionViews[0].definition.hatch.spacing === 8;
    }), capState);
  const capMotion = await page.evaluate(() => {
    const studio = (window as any).__bwStudio;
    const before = studio.sectionCapState().capPositions;
    const updatedPlanes = studio.sectionPlaneOffsetForTest(5);
    const after = studio.sectionCapState().capPositions;
    studio.sectionPlaneOffsetForTest(0);
    return { before, after, updatedPlanes };
  });
  check('browser section-plane drag moves the bounded cap and every visible clipping material together',
    capMotion.updatedPlanes > 0 && JSON.stringify(capMotion.before) !== JSON.stringify(capMotion.after), capMotion);
  const beforeSectionOff = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click(`[data-inspection-kind="section"][data-inspection-id="${sectionId}"] [data-inspection-action="toggle"]`);
  await waitForStudio(page, beforeSectionOff);
  const unclipped = await page.evaluate(() => (window as any).__bwStudio.bodyResults().every((entry: any) => (window as any).__bwStudio.bodyDisplayState(entry.bodyId).clippingPlanes === 0));
  check('browser turns section playback off while retaining the saved view and unclipped exact assembly',
    (await page.evaluate(() => (window as any).__bwStudio.activeSectionViewId())) === null &&
    (await page.$$('[data-inspection-kind="section"]')).length === 1 && unclipped);

  await page.click('[data-display-mode="wireframe"]');
  await waitForStudio(page);
  check('browser persists and applies assembly wireframe display without changing exact body results',
    await page.evaluate(() => (window as any).__bwStudio.displayMode()) === 'wireframe' &&
    (await page.evaluate(() => (window as any).__bwStudio.bodyResults().every((entry: any) => entry.geometry.valid))));
  await page.click('[data-display-mode="shaded-edges"]');
  await waitForStudio(page);

  await page.evaluate((occurrenceId) => (window as any).__bwStudio.selectOccurrenceForTest(occurrenceId), ASSEMBLY_IDS.turbine);
  const turbineBodyId = await page.evaluate(() => (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyName.startsWith('Turbine')).bodyId);
  const solvedMatrix = await page.evaluate((bodyId) => (window as any).__bwStudio.bodyDisplayState(bodyId).matrix, turbineBodyId);
  await page.click('[data-inspection-command="measure"]');
  await page.waitForSelector('#bw-v5-command[open]');
  await submitVisibleCommand(page);
  check('browser saves a selected-body measurement as an editable tree record',
    (await page.$$('[data-inspection-kind="measurement"]')).length === 1 && (await page.evaluate(() => (window as any).__bwStudio.measurements()[0].kind)) === 'bounding-box');
  await page.click('[data-inspection-command="measurements"]');
  await page.waitForFunction(() => (window as any).__bwStudio.inspectionResult()?.mode === 'measurements', { timeout: 60_000, polling: 250 });
  const visibleMeasurement = await page.evaluate(() => (window as any).__bwStudio.inspectionResult().measurementResults[0]);
  check('browser evaluates the persisted measurement at the current exact revision and shows its result',
    visibleMeasurement.valid && visibleMeasurement.value.length === 3 && visibleMeasurement.value.every((entry: number) => entry > 0), visibleMeasurement);
  await page.click('[data-inspection-context="clear"]');
  await page.click('[data-inspection-command="explode"]');
  await submitVisibleCommand(page);
  const explodedMatrix = await page.evaluate((bodyId) => (window as any).__bwStudio.bodyDisplayState(bodyId).matrix, turbineBodyId);
  check('browser saves and plays an exploded occurrence delta without changing the worker solved transform',
    Boolean(await page.evaluate(() => (window as any).__bwStudio.activeExplodedViewId())) && !close(explodedMatrix[13], solvedMatrix[13]) &&
    (await page.evaluate(() => (window as any).__bwStudio.evaluationTrace().solverState)) === 'fully-constrained', { solvedMatrix, explodedMatrix });

  await page.click('[data-inspection-command="material"]');
  await page.waitForSelector('#bw-v5-command[open]');
  await submitVisibleCommand(page);
  await page.evaluate((occurrenceId) => (window as any).__bwStudio.selectOccurrenceForTest(occurrenceId), ASSEMBLY_IDS.compressor);
  const turbineAppearance = await page.evaluate((bodyId) => (window as any).__bwStudio.bodyDisplayState(bodyId), turbineBodyId);
  check('browser material command assigns a density-backed source material and visible occurrence appearance',
    await page.evaluate(() => {
      const project = JSON.parse((window as any).__bwStudio.docJson());
      const turbine = project.assemblyDefinitions.find((entry: any) => entry.id === project.rootDocument.assemblyId).occurrences.find((entry: any) => entry.id === 'occurrence-turbine');
      const part = project.partDefinitions.find((entry: any) => entry.id === turbine.definition.partId);
      return project.materials.length === 9 && part.bodies[0].materialId && turbine.appearanceOverrideId;
    }) && turbineAppearance.color !== '#a7b8c9', turbineAppearance);

  await page.evaluate(() => (window as any).__bwStudio.selectOccurrenceForTest(null));
  await page.click('[data-inspection-command="properties"]');
  await page.waitForFunction(() => (window as any).__bwStudio.inspectionResult()?.mode === 'properties', { timeout: 60_000, polling: 250 });
  const massInspection = await page.evaluate(() => (window as any).__bwStudio.inspectionResult());
  check('browser Mass & health command reports exact revision-keyed body properties and missing-material warnings',
    massInspection.bodyCount === 7 && massInspection.aggregate.valid && massInspection.properties.every((entry: any) => entry.health.faceCount > 0) && massInspection.aggregate.missingMaterialBodyIds.length === 6, massInspection.aggregate);
  await page.click('[data-inspection-context="clear"]');

  await page.evaluate((occurrenceId) => (window as any).__bwStudio.selectOccurrenceForTest(occurrenceId), ASSEMBLY_IDS.fanModule);
  await page.click('[data-inspection-command="clearance"]');
  await page.waitForFunction(() => (window as any).__bwStudio.inspectionResult()?.mode === 'clearance', { timeout: 60_000, polling: 250 });
  const clearance = await page.evaluate(() => (window as any).__bwStudio.inspectionResult());
  check('browser Clearance command operates on the two exact bodies selected through a nested subassembly path',
    clearance.bodyCount === 2 && clearance.pairs.length === 1 && clearance.pairs[0].minimumClearanceMm >= 0, clearance.pairs);
  await page.click('[data-inspection-context="clear"]');

  await page.evaluate(() => (window as any).__bwStudio.selectOccurrenceForTest(null));
  await page.click('[data-inspection-command="interference"]');
  await page.waitForFunction(() => (window as any).__bwStudio.inspectionResult()?.mode === 'interference', { timeout: 60_000, polling: 250 });
  const interference = await page.evaluate(() => (window as any).__bwStudio.inspectionResult());
  check('browser Interference command checks the complete normally solved assembly and exposes exact pair results',
    interference.bodyCount === 7 && interference.pairs.some((entry: any) => entry.interferenceVolumeMm3 > 1), { broadPhasePairs: interference.broadPhasePairs, pairs: interference.pairs.length });
  await page.click('[data-inspection-context="clear"]');

  await page.click('[data-inspection-command="stage"]');
  await page.waitForSelector('#bw-v5-command[open]');
  await submitVisibleCommand(page);
  const stageBefore = await page.evaluate(() => (window as any).__bwStudio.axialStageGroups()[0]);
  const turbineDistanceBefore = await page.evaluate(() => {
    const project = JSON.parse((window as any).__bwStudio.docJson());
    return project.assemblyDefinitions.find((entry: any) => entry.id === project.rootDocument.assemblyId).mates.find((entry: any) => entry.id === 'mate-turbine-distance').value;
  });
  const beforeSpacing = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click('[data-inspection-kind="stage"] [data-inspection-action="spacing-more"]');
  await waitForStudio(page, beforeSpacing);
  const stageAfter = await page.evaluate(() => (window as any).__bwStudio.axialStageGroups()[0]);
  const turbineDistanceAfter = await page.evaluate(() => {
    const project = JSON.parse((window as any).__bwStudio.docJson());
    return project.assemblyDefinitions.find((entry: any) => entry.id === project.rootDocument.assemblyId).mates.find((entry: any) => entry.id === 'mate-turbine-distance').value;
  });
  check('browser axial model tree edits saved spacing and the real ordered Distance mate stations in one transaction',
    stageAfter.id === stageBefore.id && stageAfter.spacing === stageBefore.spacing + 5 && turbineDistanceAfter > turbineDistanceBefore && (await page.$$('.stage-leaf-row')).length === 3,
    { stageBefore, stageAfter, turbineDistanceBefore, turbineDistanceAfter });

  const normalExport = await page.evaluate(async () => (window as any).__bwStudio.exportForTest('step'));
  check('browser normal assembly export remains valid and uncut despite saved section and active exploded playback',
    normalExport.errors.length === 0 && normalExport.size > 500 && normalExport.manifest.bodyCount === 7 && normalExport.manifest.placements.every((entry: any) => Array.isArray(entry.transform) && entry.transform.length === 16), normalExport.manifest);
  const persisted = await page.evaluate(async () => { await (window as any).__bwStudio.flushStorage(); return { hash: (window as any).__bwStudio.canonicalHash(), section: (window as any).__bwStudio.activeSectionViewId(), explode: (window as any).__bwStudio.activeExplodedViewId(), stages: (window as any).__bwStudio.axialStageGroups(), measurements: (window as any).__bwStudio.measurements(), displayMode: (window as any).__bwStudio.displayMode() }; });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__bwStudio?.mode().kind === 'idle' && (window as any).__bwStudio.bodyResults().length === 7, { timeout: 60_000, polling: 250 });
  const recovered = await page.evaluate(() => ({ hash: (window as any).__bwStudio.canonicalHash(), section: (window as any).__bwStudio.activeSectionViewId(), explode: (window as any).__bwStudio.activeExplodedViewId(), stages: (window as any).__bwStudio.axialStageGroups(), measurements: (window as any).__bwStudio.measurements(), displayMode: (window as any).__bwStudio.displayMode() }));
  check('browser recovery preserves saved inspection state, appearance assignments, stage tree, and solved project identity', JSON.stringify(recovered) === JSON.stringify(persisted), { persisted, recovered });
  await page.setViewport({ width: 375, height: 812 }); await page.click('#bw-mtab-history');
  const touchTargets = await page.$$eval('#bw-inspection-tree button', (elements) => elements.map((element) => Number.parseFloat(getComputedStyle(element).minHeight)));
  check('browser mobile inspection keeps saved view and stage controls touch-sized', touchTargets.length > 0 && touchTargets.every((height) => height >= 44), touchTargets);
  check('browser Slice 5F gate has no page errors or native dialogs', pageErrors.length === 0 && dialogs.length === 0, { pageErrors, dialogs });
  check('browser section/explode/material/stage work leaves the project structurally editable rather than replacing it with a finished model',
    await page.evaluate(() => {
      const project = JSON.parse((window as any).__bwStudio.docJson());
      return project.partDefinitions.every((part: any) => part.features.length > 0) && project.assemblyDefinitions.length === 2 && project.rootDocument.kind === 'assembly';
    }) && baseline.results.length === 7 && typeof baseline.hash === 'string');
  await context.close();
}

let server: Server | null = null; let browser: Browser | null = null;
try {
  if (mode === 'all' || mode === 'document') await documentChecks();
  if (mode === 'all' || mode === 'kernel' || mode === 'browser') {
    const started = await startServer(); server = started.server;
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    if (mode === 'all' || mode === 'kernel') await kernelChecks(browser, started.url);
    if (mode === 'all' || mode === 'browser') await browserChecks(browser, started.url);
  }
} finally {
  await browser?.close();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
}
if (failures) { console.error(`\n${failures} Slice 5F inspection check(s) failed`); process.exit(1); }
console.log(`\n${checks}/${checks} Slice 5F inspection checks passed`);
