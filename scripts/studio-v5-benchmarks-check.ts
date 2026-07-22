// Slice 5G structural, exact-kernel, and visible-browser benchmark coverage for
// the canonical turbofan plus gearbox and robot-joint generality fixtures.

import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
// @ts-expect-error Browser-native modules intentionally have no declarations.
import { CadCommandService, cadCapabilityManifest } from '../static/studio-agent-service.js';
// @ts-expect-error Browser-native modules intentionally have no declarations.
import { canonicalStudioV5Project, parseOrMigrateStudioV5RuntimeProject, studioV5CanonicalHash } from '../static/studio-v5-runtime-document.js';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { solveStudioV5Assembly } from '../static/studio-v5-assembly.js';
import { buildCanonicalTurbofan, buildGearboxFixture, buildRobotJointFixture, TURBOFAN_IDS } from './studio-v5-release-fixtures.ts';

type Mode = 'all' | 'document' | 'kernel' | 'browser';
const mode = (process.argv[2] || 'all') as Mode;
let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail != null ? ` — ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failures++;
}

const editScope = (projectId: string) => ({ granted: ['project.read', 'project.edit'], projectIds: [projectId] });
const transaction = (id: string, revision: number, operations: any[]) => ({ transactionId: id, label: id, expectedRevision: revision, atomic: true, operations });

async function edit(service: any, id: string, operations: any[]) {
  const tx = transaction(id, service.revision, operations);
  const preview = await service.preview(tx, editScope(service.snapshot().projectId));
  return service.commit(preview.previewId, service.revision, editScope(service.snapshot().projectId));
}

async function documentChecks(): Promise<void> {
  console.log('\nSlice 5G canonical benchmark documents');
  const built = buildCanonicalTurbofan();
  const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'cad-v5');
  const canonicalFixtures = [
    ['turbofan-v5', built],
    ['gearbox-v5', buildGearboxFixture()],
    ['robot-joint-v5', buildRobotJointFixture()],
  ] as const;
  check('checked-in native projects and public construction logs are byte-identical to their canonical builders',
    canonicalFixtures.every(([slug, construction]) =>
      readFileSync(join(fixtureDirectory, `${slug}.bomcad.json`), 'utf8') === `${JSON.stringify(construction.project, null, 2)}\n` &&
      readFileSync(join(fixtureDirectory, `${slug}.construction-log.json`), 'utf8') === `${JSON.stringify(construction.log, null, 2)}\n`));
  const project = built.project;
  const solution = solveStudioV5Assembly(project, TURBOFAN_IDS.rootAssembly);
  const parts = project.partDefinitions;
  const bodies = parts.flatMap((part: any) => part.bodies);
  const assemblies = project.assemblyDefinitions;
  const patterns = assemblies.flatMap((assembly: any) => assembly.occurrencePatterns);
  const mates = assemblies.flatMap((assembly: any) => assembly.mates);
  check('canonical turbofan is an ordinary schema-5 project built only through advertised public typed operations',
    project.schemaVersion === 5 && built.log.length >= 20 && built.log.flatMap((entry: any) => entry.operations)
      .every((operation: any) => cadCapabilityManifest().operations.some((entry: any) => entry.kind === operation.kind && entry.state === 'available')) &&
    !parts.flatMap((part: any) => part.features).some((feature: any) => feature.type === 'imported-step') && project.resources.length === 0,
    { commands: built.log.length });
  check('canonical structure exceeds the required part, body, occurrence, pattern, and mate floors',
    parts.length >= 15 && bodies.length >= 24 && solution.leafOccurrences.length >= 100 && patterns.length >= 8 &&
    mates.filter((mate: any) => mate.kind === 'concentric').length >= 8 && mates.filter((mate: any) => mate.kind === 'distance').length >= 8,
    { parts: parts.length, bodies: bodies.length, occurrences: solution.leafOccurrences.length, patterns: patterns.length, mates: mates.length });
  const master = parts.find((part: any) => part.name === 'Master layout');
  const engineAxis = master?.referenceGeometry.find((datum: any) => datum.name === 'Engine axis');
  const rootAssembly = assemblies.find((assembly: any) => assembly.id === TURBOFAN_IDS.rootAssembly);
  const requiredStations: Record<string, number | string> = {
    'occurrence-fan-rotor': 55, 'occurrence-egv': 82, 'occurrence-lpc-rotor': 120,
    'occurrence-lpc-stator': 137, 'occurrence-hpc-rotor': 'hpcStation', 'occurrence-hpc-stator': 181,
    'occurrence-combustor-outer': 240, 'occurrence-hpt-rotor': 300,
    'occurrence-hpt-stator': 316, 'occurrence-lpt-rotor': 342, 'occurrence-nozzle': 375,
  };
  check('coordinate convention, named axial stations, row axes, section plane, and exploded motion all use inlet-to-exhaust +X',
    JSON.stringify(engineAxis?.definition?.direction) === '[1,0,0]' &&
    Object.entries(requiredStations).every(([occurrenceId, value]) => rootAssembly.mates.some((mate: any) =>
      mate.id === `mate-${occurrenceId}-distance` && mate.value === value)) &&
    patterns.every((pattern: any) => pattern.kind !== 'circular' || JSON.stringify(pattern.definition.axis) === '[1,0,0]') &&
    rootAssembly.sectionViews.some((section: any) => section.id === TURBOFAN_IDS.halfSection && JSON.stringify(section.definition.planes[0].normal) === '[0,1,0]') &&
    rootAssembly.explodedViews.flatMap((view: any) => view.steps).every((step: any) => step.deltaTransform[13] === 0 && step.deltaTransform[14] === 0 && step.deltaTransform[12] !== 0),
    { axis: engineAxis?.definition?.direction, stations: Object.fromEntries(Object.keys(requiredStations).map((id) => [id, rootAssembly.mates.find((mate: any) => mate.id === `mate-${id}-distance`)?.value])) });
  const fanPart = parts.find((part: any) => part.id === 'part-fan-blade');
  const fanFeature = fanPart.features.find((feature: any) => feature.id === 'feature-fan-blade-blade');
  const rootPoints = fanPart.sketches.find((sketch: any) => sketch.id === 'sketch-fan-blade-root').entities[0].points;
  const tipPoints = fanPart.sketches.find((sketch: any) => sketch.id === 'sketch-fan-blade-tip').entities[0].points;
  const chord = (points: number[][]) => Math.max(...points.map((point) => point[0])) - Math.min(...points.map((point) => point[0]));
  check('fan spline blade and compressor/hot-section blades are editable three-section tapered/twisted Lofts',
    fanFeature.sections.length === 3 && fanPart.sketches.filter((sketch: any) => sketch.extensions.studioRole === 'profile').every((sketch: any) => sketch.entities[0].kind === 'spline') &&
    chord(tipPoints) <= chord(rootPoints) * 0.8 && project.parameters.find((entry: any) => entry.name === 'fanTipTwist').value >= 15 &&
    ['part-lpc-rotor', 'part-hpc-rotor', 'part-hpt-rotor'].every((id) => parts.find((part: any) => part.id === id).features.some((feature: any) => feature.type === 'loft' && feature.sections.length === 3)));
  check('all nine required rows retain one linked source and the exact required occurrence counts',
    patterns.length === 9 && patterns.map((pattern: any) => pattern.generatedCount + 1).sort((a: number, b: number) => a - b).join(',') === [12, 14, 14, 16, 16, 18, 18, 18, 20].sort((a, b) => a - b).join(','));
  check('assembly solves fully with named half-section, exploded view, measurements, and four material groups',
    solution.state === 'fully-constrained' && solution.errors.length === 0 &&
    assemblies.some((assembly: any) => assembly.sectionViews.some((entry: any) => entry.id === TURBOFAN_IDS.halfSection)) &&
    assemblies.some((assembly: any) => assembly.explodedViews.length > 0) && project.materials.length >= 4 &&
    assemblies.some((assembly: any) => assembly.metadata.measurements?.length > 0));
  const serialized = JSON.stringify(canonicalStudioV5Project(project));
  check('native save/reopen is canonical and byte-identical before any B-rep cache exists',
    JSON.stringify(parseOrMigrateStudioV5RuntimeProject(serialized)) === serialized);

  const service = new CadCommandService({ project });
  const identityBefore = new Map(solution.leafOccurrences.map((leaf: any) => [leaf.id, leaf.definition.partId]));
  await edit(service, 'edit-fan-diameter', [{ kind: 'parameter.update', input: { parameterId: 'parameter-fan-tip-diameter', value: 176 } }]);
  await edit(service, 'edit-fan-count', [
    { kind: 'parameter.update', input: { parameterId: 'parameter-fan-blade-count', value: 14 } },
    { kind: 'document.activate', input: { definition: { kind: 'assembly', assemblyId: TURBOFAN_IDS.fanAssembly } } },
    { kind: 'component.pattern.update', input: { patternId: TURBOFAN_IDS.fanPattern, patch: { generatedCount: 13 } } },
    { kind: 'document.activate', input: { definition: { kind: 'assembly', assemblyId: TURBOFAN_IDS.rootAssembly } } },
  ]);
  await edit(service, 'edit-fan-twist', [{ kind: 'parameter.update', input: { parameterId: 'parameter-fan-tip-twist', value: 25 } }]);
  await edit(service, 'edit-nacelle-wall', [{ kind: 'parameter.update', input: { parameterId: 'parameter-nacelle-wall', value: 4 } }]);
  await edit(service, 'edit-hpc-station', [{ kind: 'parameter.update', input: { parameterId: 'parameter-hpc-station', value: 173 } }]);
  await edit(service, 'suppress-stator-row', [{ kind: 'component.update', input: { occurrenceId: TURBOFAN_IDS.lpcStatorOccurrence, patch: { suppressed: true } } }]);
  await edit(service, 'restore-stator-row', [{ kind: 'component.update', input: { occurrenceId: TURBOFAN_IDS.lpcStatorOccurrence, patch: { suppressed: false } } }]);
  await edit(service, 'replace-bearing', [{ kind: 'component.replace', input: { occurrenceId: 'occurrence-bearing-front', definition: { kind: 'part', partId: 'part-bearing-rear' } } }]);
  const editedSolution = solveStudioV5Assembly(service.snapshot(), TURBOFAN_IDS.rootAssembly);
  const changedFanPattern = service.snapshot().assemblyDefinitions.find((entry: any) => entry.id === TURBOFAN_IDS.fanAssembly).occurrencePatterns.find((entry: any) => entry.id === TURBOFAN_IDS.fanPattern);
  check('required diameter, count, twist, wall, stage, suppression/restore, and replacement edits remain normal undoable transactions',
    service.revision === 8 && changedFanPattern.generatedCount === 13 && editedSolution.state === 'fully-constrained' && editedSolution.leafOccurrences.length === solution.leafOccurrences.length + 2 &&
    service.snapshot().parameters.find((entry: any) => entry.name === 'hpcStation').value === 173 &&
    service.snapshot().assemblyDefinitions.find((entry: any) => entry.id === TURBOFAN_IDS.rootAssembly).occurrences.find((entry: any) => entry.id === 'occurrence-bearing-front').definition.partId === 'part-bearing-rear',
    { revision: service.revision, generatedCount: changedFanPattern.generatedCount, solver: editedSolution.state, beforeLeaves: solution.leafOccurrences.length, afterLeaves: editedSolution.leafOccurrences.length, errors: editedSolution.errors });
  const unaffected = editedSolution.leafOccurrences.filter((leaf: any) => identityBefore.has(leaf.id) && leaf.id !== 'occurrence-bearing-front');
  check('parametric edits preserve every unaffected occurrence identity and definition owner',
    unaffected.every((leaf: any) => identityBefore.get(leaf.id) === leaf.definition.partId),
    { unaffected: unaffected.length, changed: unaffected.filter((leaf: any) => identityBefore.get(leaf.id) !== leaf.definition.partId).map((leaf: any) => leaf.id) });
  const editedHash = studioV5CanonicalHash(service.snapshot());
  await service.historyAction({ action: 'undo', expectedRevision: service.revision }, editScope(project.projectId));
  await service.historyAction({ action: 'redo', expectedRevision: service.revision }, editScope(project.projectId));
  check('advanced assembly undo/redo reproduces the exact canonical edit hash', studioV5CanonicalHash(service.snapshot()) === editedHash);

  for (const [name, fixture] of [['gearbox', buildGearboxFixture()], ['robot joint', buildRobotJointFixture()]] as const) {
    const general = fixture.project;
    const solved = solveStudioV5Assembly(general, general.rootDocument.assemblyId);
    check(`${name} generality fixture is built from the same public operations and retains editable multi-body/component/inspection structure`,
      fixture.log.flatMap((entry: any) => entry.operations).every((operation: any) => cadCapabilityManifest().operations.some((entry: any) => entry.kind === operation.kind && entry.state === 'available')) &&
      solved.errors.length === 0 && general.partDefinitions.flatMap((part: any) => part.bodies).length >= 5 &&
      general.assemblyDefinitions.some((assembly: any) => assembly.sectionViews.length > 0));
  }
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
    const documentProjectId = request.document?.projectId || 'project-v5-benchmark';
    if (state.__benchmarkWorker && state.__benchmarkProjectId && state.__benchmarkProjectId !== documentProjectId) {
      state.__benchmarkWorker.terminate();
      state.__benchmarkWorker = null;
    }
    state.__benchmarkWorker ||= new Worker('/static/studio-kernel.worker.js', { type: 'module' });
    state.__benchmarkProjectId = documentProjectId;
    state.__benchmarkSequence = (state.__benchmarkSequence || 0) + 1;
    const requestId = `benchmark-${state.__benchmarkSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Benchmark worker timeout')), 120_000);
      const listener = async (event: MessageEvent) => {
        if (event.data?.requestId !== requestId) return;
        clearTimeout(timer); state.__benchmarkWorker.removeEventListener('message', listener);
        if (event.data.kind === 'kernel-error') reject(new Error(event.data.message));
        else resolve({
          ...event.data,
          triangleCount: (event.data.bodies || []).reduce((total: number, body: any) => total + (body.mesh?.triangles?.length || 0) / 3, 0),
          blobSize: event.data.blob?.size || 0,
          stepText: event.data.blob ? await event.data.blob.text() : '',
          blob: undefined,
        });
      };
      state.__benchmarkWorker.addEventListener('message', listener);
      state.__benchmarkWorker.postMessage({
        ...request,
        requestId,
        projectId: documentProjectId,
      });
    });
  }, payload);
}

async function kernelChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5G exact OpenCascade and performance benchmark');
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const project = buildCanonicalTurbofan().project;
  const coldStart = performance.now();
  const cold = await workerRequest(page, { kind: 'rebuild', revision: 1, document: project });
  const coldMs = performance.now() - coldStart;
  const warmStart = performance.now();
  const warm = await workerRequest(page, { kind: 'rebuild', revision: 2, document: project });
  const warmMs = performance.now() - warmStart;
  check('canonical turbofan exact rebuild returns every occurrence body as a valid solid with no kernel errors',
    cold.errors.length === 0 && cold.bodies.length >= 159 && cold.bodies.every((body: any) => body.geometry?.valid && body.geometry.solidCount === 1),
    { errors: cold.errors, bodies: cold.bodies.length });
  const aggregateBounds = cold.bodies.reduce((bounds: number[][], body: any) => [
    bounds[0].map((value, axis) => Math.min(value, body.geometry.bounds[0][axis])),
    bounds[1].map((value, axis) => Math.max(value, body.geometry.bounds[1][axis])),
  ], [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]]);
  const spans = aggregateBounds[1].map((value: number, axis: number) => value - aggregateBounds[0][axis]);
  check('exact solved envelope is axial along +X from the inlet datum through the X=430 nozzle station',
    aggregateBounds[0][0] >= -0.5 && aggregateBounds[0][0] <= 1 &&
    aggregateBounds[1][0] >= 429 && aggregateBounds[1][0] <= 431 &&
    spans[0] > spans[1] * 2 && spans[0] > spans[2] * 2 && Math.max(spans[1], spans[2]) >= 190,
    { bounds: aggregateBounds, spans });
  check('canonical turbofan meets cold/warm rebuild and displayed-triangle budgets',
    coldMs < 20_000 && warmMs < 2_000 && cold.triangleCount >= 100_000,
    { coldMs: Math.round(coldMs), warmMs: Math.round(warmMs), triangles: cold.triangleCount });
  check('warm rebuild preserves exact body IDs, bounds, volumes, and shared-instance geometry contract',
    JSON.stringify(warm.bodies.map((body: any) => [body.bodyId, body.geometry.bounds, body.geometry.volume])) ===
      JSON.stringify(cold.bodies.map((body: any) => [body.bodyId, body.geometry.bounds, body.geometry.volume])) &&
    warm.bodies.filter((body: any) => body.patternInstance).every((body: any) => body.sharesSourceGeometry));

  const sourceEditedProject = structuredClone(project);
  sourceEditedProject.parameters.find((entry: any) => entry.id === 'parameter-fan-tip-twist').value = 21;
  const sourceEdited = await workerRequest(page, { kind: 'rebuild', revision: 3, document: sourceEditedProject });
  check('project-scoped fan source edit invalidates only its referencing part while unrelated exact bodies stay cached',
    sourceEdited.errors.length === 0 && sourceEdited.evaluation.evaluatedVariantBodyIds.length === 1 &&
    sourceEdited.evaluation.evaluatedVariantBodyIds[0].endsWith(':body-feature-fan-blade-blade') &&
    sourceEdited.evaluation.reusedVariantBodyIds.length >= 20,
    sourceEdited.evaluation);

  const healthStart = performance.now();
  const health = await workerRequest(page, { kind: 'inspect-v5', mode: 'health', revision: 4, document: project });
  const healthMs = performance.now() - healthStart;
  const massStart = performance.now();
  const mass = await workerRequest(page, { kind: 'inspect-v5', mode: 'mass', revision: 5, document: project });
  const massMs = performance.now() - massStart;
  check('exact geometry-health and mass inspection cover the complete assembly within budget',
    health.errors.length === 0 && health.inspection.properties.every((body: any) => body.health.valid) &&
    mass.errors.length === 0 && mass.inspection.aggregate.massKg > 0 && healthMs < 5_000 && massMs < 5_000,
    { healthMs: Math.round(healthMs), massMs: Math.round(massMs), massKg: mass.inspection.aggregate.massKg });

  const exportStart = performance.now();
  const exported = await workerRequest(page, { kind: 'export-step', revision: 6, document: project });
  const exportMs = performance.now() - exportStart;
  check('canonical turbofan structured STEP export preserves the solved hierarchy and exact body inventory within budget',
    exported.errors.length === 0 && exported.manifest.structuredHierarchy === true && exported.manifest.bodyCount >= 159 &&
    exported.stepText.includes('NEXT_ASSEMBLY_USAGE_OCCURRENCE') && exported.stepText.includes('BOMWIKI_V5_MANIFEST:') && exportMs < 30_000,
    { exportMs: Math.round(exportMs), bytes: exported.blobSize, bodyCount: exported.manifest.bodyCount });

  for (const [name, fixture, revision] of [
    ['gearbox', buildGearboxFixture().project, 7], ['robot joint', buildRobotJointFixture().project, 8],
  ] as const) {
    const rebuilt = await workerRequest(page, { kind: 'rebuild', revision, document: fixture });
    const step = await workerRequest(page, { kind: 'export-step', revision: revision + 10, document: fixture });
    check(`${name} exact generality fixture has only valid solids and structured STEP output`,
      rebuilt.errors.length === 0 && rebuilt.bodies.length >= 5 && rebuilt.bodies.every((body: any) => body.geometry?.valid) &&
      step.errors.length === 0 && step.manifest.structuredHierarchy === true && step.manifest.bodyCount >= 5,
      { rebuildErrors: rebuilt.errors, exportErrors: step.errors });
  }
  await page.close();
}

async function waitForStudio(page: Page, minimumBodies = 0): Promise<void> {
  await page.waitForFunction((count) => {
    const studio = (window as any).__bwStudio;
    return Boolean(studio && studio.mode().kind === 'idle' && studio.bodyResults().length >= count);
  }, { timeout: 120_000, polling: 100 }, minimumBodies);
}

function installSemanticControlActivation(page: Page): void {
  page.click = (async (selector: string) => {
    await page.evaluate((value) => {
      const element = document.querySelector(value) as HTMLElement | null;
      if (!element) throw new Error(`Benchmark browser control is missing: ${value}`);
      element.focus(); element.click();
    }, selector);
  }) as Page['click'];
}

async function browserChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5G visible public-browser benchmark');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  installSemanticControlActivation(page);
  const pageErrors: string[] = []; const dialogs: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('dialog', async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('bw-studio-welcome-v1', '1'); localStorage.setItem('bw-studio-v2-seeded', '1'); localStorage.setItem('bw-studio-tour-v1', '1');
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForStudio(page, 0);
  const project = buildCanonicalTurbofan().project;
  const directory = mkdtempSync(join(tmpdir(), 'bomwiki-v5-turbofan-'));
  const filename = join(directory, 'turbofan-v5.bomcad.json');
  writeFileSync(filename, JSON.stringify(project));
  const input = await page.$('#bw-open-file');
  await (input as any).uploadFile(filename);
  await waitForStudio(page, 159);
  const visible = await page.evaluate(() => ({
    bodies: (window as any).__bwStudio.bodyResults(), solver: (window as any).__bwStudio.evaluationTrace().solverState,
    hash: (window as any).__bwStudio.canonicalHash(),
    occurrences: document.querySelectorAll('#bw-assembly-tree [data-occurrence-id]').length,
    leaves: document.querySelectorAll('#bw-assembly-tree .assembly-leaf-row').length,
    mates: document.querySelectorAll('#bw-mate-tree [data-mate-id]').length,
    patterns: document.querySelectorAll('#bw-assembly-tree .assembly-pattern-row').length,
  }));
  check('public Open renders the canonical solved assembly with its real body, component, mate, and pattern trees',
    visible.solver === 'fully-constrained' && visible.bodies.length >= 159 && visible.bodies.every((body: any) => body.geometry?.valid) &&
    visible.occurrences >= 20 && visible.leaves >= 150 && visible.mates >= 20 && visible.patterns >= 8,
    { bodies: visible.bodies.length, occurrences: visible.occurrences, leaves: visible.leaves, mates: visible.mates, patterns: visible.patterns });
  const sectionBodyId = visible.bodies.find((body: any) => body.bodyName.includes('Nacelle shell'))?.bodyId;
  const clipped = await page.evaluate((bodyId) => (window as any).__bwStudio.bodyDisplayState(bodyId).clippingPlanes, sectionBodyId);
  await page.click(`[data-inspection-kind="section"] [data-inspection-action="toggle"]`);
  await waitForStudio(page, 159);
  const unclipped = await page.evaluate((bodyId) => (window as any).__bwStudio.bodyDisplayState(bodyId).clippingPlanes, sectionBodyId);
  check('saved longitudinal section toggles non-destructively while preserving exact assembly identity',
    clipped === 1 && unclipped === 0 && await page.evaluate((hash) => (window as any).__bwStudio.canonicalHash() !== hash, visible.hash));

  const persisted = await page.evaluate(async () => { await (window as any).__bwStudio.flushStorage(); return (window as any).__bwStudio.canonicalHash(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForStudio(page, 159);
  check('browser recovery reopens the same canonical turbofan with no lost exact occurrence bodies',
    await page.evaluate((hash) => (window as any).__bwStudio.canonicalHash() === hash && (window as any).__bwStudio.bodyResults().length >= 159, persisted));
  check('visible benchmark produced no native dialogs or page errors', dialogs.length === 0 && pageErrors.length === 0, { dialogs, pageErrors });
  await context.close();
}

let server: Server | null = null;
let browser: Browser | null = null;
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
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
}
if (failures) { console.error(`\n${failures}/${checks} Slice 5G benchmark checks failed`); process.exit(1); }
console.log(`\n${checks}/${checks} Slice 5G benchmark checks passed`);
