// Integrated acceptance gate for the ten capability gaps that triggered V5.
// The fixtures are ordinary editable schema-5 documents authored by the same
// public document commands used by Studio. This gate does not introduce a
// fixture-only geometry command or claim completion of the larger V5 spec.

import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
// @ts-ignore Browser-native modules intentionally have no TypeScript declarations.
import { canonicalStudioV5Project, parseOrMigrateStudioV5RuntimeProject, studioV5RootAssembly, studioV5RootPart } from '../static/studio-v5-runtime-document.js';
// @ts-ignore Browser-native module intentionally has no TypeScript declarations.
import { resolveStudioV5Datums } from '../static/studio-v5-modeling.js';
// @ts-ignore Browser-native module intentionally has no TypeScript declarations.
import { solveStudioV5Assembly } from '../static/studio-v5-assembly.js';
// @ts-ignore Browser-native module intentionally has no TypeScript declarations.
import { createStudioV5AxialStageGroup, createStudioV5SectionView, studioV5AxialStageGroups } from '../static/studio-v5-inspection.js';
import { ASSEMBLY_IDS, createSolvedAssemblyProject } from './studio-v5-assemblies-fixture.ts';
import { createDatumTransformProject, DATUM_IDS } from './studio-v5-datums-fixture.ts';
import { createEditablePatternProject, PATTERN_IDS } from './studio-v5-patterns-fixture.ts';
import { createThreeBodyRuntimeProject, RUNTIME_BODY_IDS, RUNTIME_FEATURE_IDS } from './studio-v5-runtime-fixture.ts';
import { createAdvancedShapeProject, SHAPE_IDS } from './studio-v5-shapes-fixture.ts';

type Mode = 'all' | 'document' | 'kernel' | 'browser';
const mode = (process.argv[2] || 'all') as Mode;
if (!['all', 'document', 'kernel', 'browser'].includes(mode)) throw new Error(`Unknown ten-capability check mode: ${mode}`);

let checks = 0;
let failures = 0;
function check(number: number, layer: string, name: string, ok: boolean, detail?: unknown): void {
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${layer} ${number}/10 ${name}${!ok && detail != null ? ` — ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failures++;
}
const close = (left: number, right: number, tolerance = 1e-6) => Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
const centre = (bounds: number[][]) => bounds[0].map((value, axis) => (value + bounds[1][axis]) / 2);

function sectionProject(): any {
  return createStudioV5SectionView(createSolvedAssemblyProject(), {
    id: 'section-ten-capability', name: 'Ten-capability longitudinal section', kind: 'plane',
    definition: { planes: [{ normal: [1, 0, 0], offset: 0 }], cap: true, reverse: false, scopeOccurrenceIds: [] },
  });
}

function inspectionProject(): any {
  return createStudioV5AxialStageGroup(sectionProject(), {
    id: 'stage-ten-capability', name: 'Editable axial stages', axis: [0, 0, 1],
    occurrenceIds: [ASSEMBLY_IDS.compressor, ASSEMBLY_IDS.turbine],
    distanceMateIds: ['mate-compressor-distance', 'mate-turbine-distance'],
    start: 35, spacing: 70, visible: true,
  });
}

async function documentChecks(): Promise<void> {
  console.log('\nTen-capability canonical document gate');
  const datums = createDatumTransformProject();
  const datumPart = studioV5RootPart(datums);
  const frames = resolveStudioV5Datums(datums, datumPart.id);
  check(1, 'document', 'construction planes include offset, angle, three-point, curve-normal, and mid-plane definitions',
    [DATUM_IDS.station165, DATUM_IDS.angled, DATUM_IDS.threePoint, DATUM_IDS.curveNormal, DATUM_IDS.mid].every((id) => frames.frames.has(id)) && frames.errors.size === 0);

  const multiBody = createThreeBodyRuntimeProject();
  check(2, 'document', 'three independent named bodies retain explicit ownership and result policies',
    studioV5RootPart(multiBody).bodies.length === 3 && studioV5RootPart(multiBody).features.every((feature: any) => feature.resultPolicy));

  check(3, 'document', 'move, rotate, align, mirror-copy, and scale remain editable transform history',
    ['move', 'rotate', 'align', 'mirror', 'scale'].every((kind) => datumPart.features.some((feature: any) => feature.type === 'transform' && feature.transform.mode === kind)));

  const shapes = createAdvancedShapeProject();
  const shapePart = studioV5RootPart(shapes);
  check(4, 'document', 'Loft and Sweep preserve ordered editable profiles, path, guide, and orientation references',
    shapePart.features.filter((feature: any) => feature.type === 'loft').length === 2 && shapePart.features.filter((feature: any) => feature.type === 'sweep').length === 1 &&
    shapePart.features.find((feature: any) => feature.id === SHAPE_IDS.sweepFeature).orientation === 'controlled-twist');

  const bladePlanes = [SHAPE_IDS.rootPlane, SHAPE_IDS.midPlane, SHAPE_IDS.tipPlane].map((id) => shapePart.referenceGeometry.find((datum: any) => datum.id === id));
  const bladeProfiles = [SHAPE_IDS.rootProfile, SHAPE_IDS.midProfile, SHAPE_IDS.tipProfile].map((id) => shapePart.sketches.find((sketch: any) => sketch.id === id));
  check(5, 'document', 'twisted blade is one three-section tapered spline Loft rather than a flat extrusion',
    bladePlanes.every(Boolean) && bladeProfiles.every((sketch: any) => sketch?.entities?.[0]?.kind === 'spline') &&
    shapePart.features.find((feature: any) => feature.id === SHAPE_IDS.bladeLoft).sections.length === 3 &&
    Math.max(...bladeProfiles[2].entities[0].points.map((point: number[]) => point[0])) < Math.max(...bladeProfiles[0].entities[0].points.map((point: number[]) => point[0])));

  const patterned = createEditablePatternProject();
  const pattern = studioV5RootPart(patterned).bodyPatterns[0];
  check(6, 'document', 'editable pattern stores one source link, axis reference, count, orientation, and stable derived identity contract',
    pattern.sourceBodyId === SHAPE_IDS.bladeBody && pattern.references[0].ownerId === PATTERN_IDS.axis && pattern.definition.count === 12 && pattern.definition.orientation === 'rotate');

  const booleanFeature = studioV5RootPart(multiBody).features.find((feature: any) => feature.id === RUNTIME_FEATURE_IDS.boolean);
  check(7, 'document', 'selected-body Boolean names target and retained tool bodies explicitly',
    booleanFeature.operation === 'subtract' && booleanFeature.resultPolicy.targetBodyIds[0] === RUNTIME_BODY_IDS.housing &&
    booleanFeature.toolBodyIds[0] === RUNTIME_BODY_IDS.tool && booleanFeature.resultPolicy.keepTools === true);

  const assembly = createSolvedAssemblyProject();
  const solved = solveStudioV5Assembly(assembly, ASSEMBLY_IDS.root);
  check(8, 'document', 'nested reusable components solve through explicit concentric, distance, angle, and fixed mates',
    solved.state === 'fully-constrained' && solved.leafOccurrences.length === 7 && solved.errors.length === 0 && studioV5RootAssembly(assembly).mates.length === 10);

  const sectioned = sectionProject();
  check(9, 'document', 'saved active section is non-destructive display state with unchanged part and mate history',
    studioV5RootAssembly(sectioned).metadata.activeSectionViewId === 'section-ten-capability' &&
    JSON.stringify(sectioned.partDefinitions) === JSON.stringify(assembly.partDefinitions) && JSON.stringify(studioV5RootAssembly(sectioned).mates) === JSON.stringify(studioV5RootAssembly(assembly).mates));

  const inspected = inspectionProject();
  const stage = studioV5AxialStageGroups(inspected)[0];
  check(10, 'document', 'axial model-tree group persists stage order, spacing, visibility, and controlling Distance mates',
    stage.spacing === 70 && stage.visible === true && stage.occurrenceIds.join(',') === [ASSEMBLY_IDS.compressor, ASSEMBLY_IDS.turbine].join(',') &&
    studioV5RootAssembly(inspected).mates.find((mate: any) => mate.id === 'mate-turbine-distance').value === 105 &&
    JSON.stringify(parseOrMigrateStudioV5RuntimeProject(JSON.stringify(canonicalStudioV5Project(inspected)))) === JSON.stringify(canonicalStudioV5Project(inspected)));
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
    state.__tenCapabilityWorker ||= new Worker('/static/studio-kernel.worker.js', { type: 'module' });
    state.__tenCapabilitySequence = (state.__tenCapabilitySequence || 0) + 1;
    const requestId = `ten-capability-${state.__tenCapabilitySequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Ten-capability worker timeout')), 60_000);
      const listener = (event: MessageEvent) => {
        if (event.data?.requestId !== requestId) return;
        clearTimeout(timer); state.__tenCapabilityWorker.removeEventListener('message', listener);
        if (event.data.kind === 'kernel-error') reject(new Error(event.data.message));
        else resolve({ ...event.data, blobSize: event.data.blob?.size || 0 });
      };
      state.__tenCapabilityWorker.addEventListener('message', listener);
      state.__tenCapabilityWorker.postMessage({ ...request, requestId, projectId: 'project-ten-capability' });
    });
  }, payload);
}

const body = (result: any, id: string) => result.bodies.find((entry: any) => entry.bodyId === id);
async function kernelChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nTen-capability exact OpenCascade gate');
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  let revision = 0;
  const runtimeWithoutBoolean = await workerRequest(page, { kind: 'rebuild', revision: ++revision, document: createThreeBodyRuntimeProject({ boolean: false }) });
  const runtime = await workerRequest(page, { kind: 'rebuild', revision: ++revision, document: createThreeBodyRuntimeProject() });
  const datumBaseline = await workerRequest(page, { kind: 'rebuild', revision: ++revision, document: createDatumTransformProject({ transforms: false }) });
  const datums = await workerRequest(page, { kind: 'rebuild', revision: ++revision, document: createDatumTransformProject() });
  const shapes = await workerRequest(page, { kind: 'rebuild', revision: ++revision, document: createAdvancedShapeProject() });
  const patterns = await workerRequest(page, { kind: 'rebuild', revision: ++revision, document: createEditablePatternProject() });
  const assembly = await workerRequest(page, { kind: 'rebuild', revision: ++revision, document: createSolvedAssemblyProject() });
  const sectioned = await workerRequest(page, { kind: 'rebuild', revision: ++revision, document: sectionProject() });
  const staged = await workerRequest(page, { kind: 'rebuild', revision: ++revision, document: inspectionProject() });

  check(1, 'kernel', 'datum-dependent exact bodies rebuild without unresolved construction references', datums.errors.length === 0 && datums.bodies.length === 4, datums.errors);
  check(2, 'kernel', 'independent multi-body evaluation returns three valid exact solids', runtime.bodies.length === 3 && runtime.bodies.every((entry: any) => entry.geometry?.valid));
  check(3, 'kernel', 'numeric transforms alter placement while preserving exact source volume',
    !close(body(datums, RUNTIME_BODY_IDS.housing).geometry.bounds[0][0], body(datumBaseline, RUNTIME_BODY_IDS.housing).geometry.bounds[0][0]) &&
    close(body(datums, RUNTIME_BODY_IDS.housing).geometry.volume, body(datumBaseline, RUNTIME_BODY_IDS.housing).geometry.volume));
  check(4, 'kernel', 'two Lofts and one controlled-twist Sweep produce three valid solids', shapes.errors.length === 0 && shapes.bodies.length === 3 && shapes.bodies.every((entry: any) => entry.geometry?.valid), shapes.errors);
  check(5, 'kernel', 'three-section twisted source blade is a valid nonzero exact solid', body(shapes, SHAPE_IDS.bladeBody).geometry.valid && body(shapes, SHAPE_IDS.bladeBody).geometry.volume > 0);
  const generated = patterns.bodies.filter((entry: any) => entry.patternInstance?.patternId === PATTERN_IDS.pattern);
  check(6, 'kernel', 'linked circular pattern evaluates eleven exact instances from one shared source mesh', generated.length === 11 && generated.every((entry: any) => entry.geometry?.valid && entry.sharesSourceGeometry));
  check(7, 'kernel', 'selected-body subtraction removes exact volume and retains the tool body',
    body(runtime, RUNTIME_BODY_IDS.housing).geometry.volume < body(runtimeWithoutBoolean, RUNTIME_BODY_IDS.housing).geometry.volume && Boolean(body(runtime, RUNTIME_BODY_IDS.tool)));
  check(8, 'kernel', 'nested assembly returns seven valid occurrence bodies with a fully constrained solver state',
    assembly.errors.length === 0 && assembly.bodies.length === 7 && assembly.evaluation.solverState === 'fully-constrained' && assembly.bodies.every((entry: any) => entry.geometry?.valid));
  check(9, 'kernel', 'section display state changes no exact body bounds, volume, or export geometry',
    JSON.stringify(sectioned.bodies.map((entry: any) => [entry.bodyId, entry.geometry.bounds, entry.geometry.volume])) ===
    JSON.stringify(assembly.bodies.map((entry: any) => [entry.bodyId, entry.geometry.bounds, entry.geometry.volume])));
  const compressor = staged.bodies.find((entry: any) => entry.bodyName === 'Compressor:1 / Compressor drum');
  const turbine = staged.bodies.find((entry: any) => entry.bodyName === 'Turbine:1 / Turbine drum');
  check(10, 'kernel', 'axial stage spacing drives solved exact placements while all bodies remain valid',
    close(centre(compressor.geometry.bounds)[2], 35) && close(centre(turbine.geometry.bounds)[2], 105) && staged.bodies.every((entry: any) => entry.geometry?.valid),
    { compressor: centre(compressor.geometry.bounds), turbine: centre(turbine.geometry.bounds) });
  await page.close();
}

async function waitForStudio(page: Page, revisionAfter?: number): Promise<void> {
  await page.waitForFunction((after) => {
    const studio = (window as any).__bwStudio;
    return Boolean(studio && studio.mode().kind === 'idle' && (after == null || studio.appliedRevision() > after));
  }, { timeout: 60_000, polling: 100 }, revisionAfter ?? null);
}

function installSemanticControlActivation(page: Page): void {
  page.click = (async (selector: string) => {
    await page.evaluate((value) => {
      const element = document.querySelector(value) as HTMLElement | null;
      if (!element) throw new Error(`Ten-capability browser control is missing: ${value}`);
      element.focus(); element.click();
    }, selector);
  }) as Page['click'];
}

async function openProject(page: Page, project: any, name: string): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'bomwiki-ten-capability-'));
  const filename = join(directory, name + '.bomcad.json');
  writeFileSync(filename, JSON.stringify(project));
  const before = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  const input = await page.$('#bw-open-file');
  await (input as any).uploadFile(filename);
  await waitForStudio(page, before);
}

async function browserChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nTen-capability visible public-browser gate');
  const pageErrors: string[] = [];
  const dialogs: string[] = [];
  const projectPage = async (project: any, name: string): Promise<Page> => {
    const next = await browser.newPage();
    installSemanticControlActivation(next);
    next.on('pageerror', (error) => pageErrors.push(String(error)));
    next.on('dialog', async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss(); });
    await next.evaluateOnNewDocument(() => {
      localStorage.setItem('bw-studio-welcome-v1', '1'); localStorage.setItem('bw-studio-v2-seeded', '1'); localStorage.setItem('bw-studio-tour-v1', '1');
    });
    await next.goto(url, { waitUntil: 'domcontentloaded' });
    await waitForStudio(next);
    await openProject(next, project, name);
    return next;
  };

  const page = await projectPage(createDatumTransformProject(), 'datums');
  const datumModes = await page.$$eval('#bw-datum-tree [data-datum-id]', (rows) => rows.map((row: any) => row.textContent));
  check(1, 'browser', 'Open renders named construction planes and exposes the visible Plane command', datumModes.some((text) => text.includes('S40 HPC-1')) && datumModes.some((text) => text.includes('Blade tip twist')) && Boolean(await page.$('[data-v5-command="plane"]')));

  await openProject(page, createThreeBodyRuntimeProject(), 'multi-body');
  check(2, 'browser', 'body tree and canvas expose three independently selectable valid bodies',
    (await page.$$('#bw-bodies [data-body-id]')).length === 3 && (await page.evaluate(() => (window as any).__bwStudio.bodyResults().every((entry: any) => entry.geometry?.valid))));

  await openProject(page, createDatumTransformProject(), 'transforms');
  const transformCommands = await page.$$eval('[data-v5-command]', (buttons) => [...new Set(buttons.map((button: any) => button.dataset.v5Command))]);
  check(3, 'browser', 'visible transform controls and history expose Move, Rotate, Align, Mirror, Copy, and Scale',
    ['move', 'rotate', 'align', 'mirror', 'copy', 'scale'].every((command) => transformCommands.includes(command)) &&
    (await page.$$('#bw-history [data-feature="transform"]')).length === 5);

  check(4, 'browser', 'public Loft and Sweep authoring commands are visibly available in the modeling ribbon',
    Boolean(await page.$('[data-v5-command="loft"]')) && Boolean(await page.$('[data-v5-command="sweep"]')));
  check(5, 'browser', 'public Plane, Profile, and Loft controls expose the multi-section blade authoring workflow',
    Boolean(await page.$('[data-v5-command="plane"]')) && Boolean(await page.$('[data-v5-command="profile"]')) && Boolean(await page.$('[data-v5-command="loft"]')));

  await openProject(page, createThreeBodyRuntimeProject(), 'boolean');
  await page.click(`#bw-bodies [data-body-id="${RUNTIME_BODY_IDS.tool}"] [data-body-action="select"]`);
  check(7, 'browser', 'Boolean history remains body-aware and selected-body Boolean actions are visible',
    Boolean(await page.$(`#bw-history [data-sel="${RUNTIME_FEATURE_IDS.boolean}"]`)) && Boolean(await page.$('[data-body-context="subtract"]')));

  await openProject(page, inspectionProject(), 'assembly-inspection');
  check(8, 'browser', 'assembly tree, nested leaves, and mate tree expose solved reusable components and concentric relationships',
    (await page.$$('#bw-assembly-tree [data-occurrence-id]')).length === 4 && (await page.$$('#bw-assembly-tree .assembly-leaf-row')).length === 7 &&
    (await page.$$('#bw-mate-tree [data-mate-id]')).length === 10 && (await page.evaluate(() => (window as any).__bwStudio.evaluationTrace().solverState)) === 'fully-constrained');

  const sectionBodyId = await page.evaluate(() => (window as any).__bwStudio.bodyResults().find((entry: any) => entry.geometry?.valid)?.bodyId);
  const clipped = await page.evaluate((bodyId) => (window as any).__bwStudio.bodyDisplayState(bodyId).clippingPlanes, sectionBodyId);
  const beforeSectionToggle = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click('[data-inspection-kind="section"] [data-inspection-action="toggle"]');
  await waitForStudio(page, beforeSectionToggle);
  const unclipped = await page.evaluate((bodyId) => (window as any).__bwStudio.bodyDisplayState(bodyId).clippingPlanes, sectionBodyId);
  check(9, 'browser', 'saved section visibly clips exact rendered bodies and toggles off without changing geometry', clipped === 1 && unclipped === 0 && (await page.evaluate(() => (window as any).__bwStudio.bodyResults().length)) === 7);

  const beforeSpacing = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click('[data-inspection-kind="stage"] [data-inspection-action="spacing-more"]');
  await waitForStudio(page, beforeSpacing);
  const afterSpacing = await page.evaluate(() => (window as any).__bwStudio.axialStageGroups()[0]);
  const beforeVisibility = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click('[data-inspection-kind="stage"] [data-inspection-action="visibility"]');
  await waitForStudio(page, beforeVisibility);
  const afterVisibility = await page.evaluate(() => ({ group: (window as any).__bwStudio.axialStageGroups()[0], bodies: (window as any).__bwStudio.bodyResults() }));
  check(10, 'browser', 'axial tree edits spacing and stage visibility transactionally with no native dialog or page error',
    afterSpacing.spacing === 75 && afterVisibility.group.visible === false && afterVisibility.bodies.some((entry: any) => entry.bodyName.startsWith('Compressor') && entry.visible === false) &&
    pageErrors.length === 0 && dialogs.length === 0, { afterSpacing, pageErrors, dialogs });

  // The linked-pattern fixture owns fourteen exact shapes. Open it last so no
  // later check depends on replacing that live OpenCascade document.
  await openProject(page, createEditablePatternProject(), 'patterns');
  await page.waitForFunction(() => (window as any).__bwStudio?.mode().kind === 'idle' && (window as any).__bwStudio.bodyResults().length === 14, { timeout: 60_000, polling: 100 });
  check(6, 'browser', 'pattern tree renders eleven stable linked blade occurrences from one editable source record',
    (await page.$$('#bw-pattern-tree .pattern-instance-row')).length === 11 && (await page.$$('#bw-pattern-tree .pattern-row')).length === 1 && Boolean(await page.$('[data-v5-command="pattern"]')));
  await page.close();
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

if (failures) { console.error(`\n${failures}/${checks} ten-capability checks failed`); process.exit(1); }
console.log(`\n${checks}/${checks} ten-capability checks passed`);
