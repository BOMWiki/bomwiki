// Slice 5F interchange gate: genuine STEP product/component export, bounded
// exact-solid import, BOMwiki hierarchy round-trip, honest external fallback,
// browser transactions, persistence, and re-export.

import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
import { prepareStudioV5Project } from '../static/studio-project-v5.js';
// @ts-ignore Browser-native modules intentionally have no TypeScript declarations.
import { canonicalStudioV5Project, parseOrMigrateStudioV5RuntimeProject, studioV5CanonicalHash } from '../static/studio-v5-runtime-document.js';
import { createSolvedAssemblyProject } from './studio-v5-assemblies-fixture.ts';

type Mode = 'all' | 'document' | 'kernel' | 'browser';
const mode = (process.argv[2] || 'all') as Mode;
let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail != null ? ` — ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failures++;
}

function importedDocumentFixture(): any {
  const data = Buffer.from('DBRep_DrawableShape\nCASCADE Topology V3, (c) Open Cascade\n').toString('base64');
  return prepareStudioV5Project({
    schemaVersion: 5, projectId: 'project-import-contract', name: 'Imported contract', units: 'mm',
    parameters: [], materials: [],
    partDefinitions: [{
      id: 'part-imported', name: 'Imported part', parameters: [], referenceGeometry: [], sketches: [],
      bodies: [{ id: 'body-imported', name: 'Imported body', kind: 'solid', createdByFeatureId: 'feature-imported', featureIds: ['feature-imported'], visible: true, suppressed: false }],
      bodyPatterns: [],
      features: [{
        id: 'feature-imported', name: 'Imported exact body', type: 'imported-step', suppressed: false, inputRefs: [],
        resultPolicy: { kind: 'new-body', bodyName: 'Imported body' },
        extensions: { studioImportedStep: { resourceId: 'resource-imported', exactBrep: true, parametricHistory: false } },
      }],
      featureOrder: ['feature-imported'], metadata: { activeBodyId: 'body-imported', importedFromStep: true },
      extensions: { studioImportedStep: { parametricHistory: false } },
    }],
    assemblyDefinitions: [], rootDocument: { kind: 'part', partId: 'part-imported' },
    resources: [{ id: 'resource-imported', name: 'Imported exact B-rep', mimeType: 'text/plain', byteLength: Buffer.from(data, 'base64').byteLength, encoding: 'base64', data }],
    metadata: { importedFromStep: true, importLimitations: ['no-parametric-feature-history'] },
  });
}

async function documentChecks(): Promise<void> {
  console.log('\nSlice 5F interchange document contract');
  const project = importedDocumentFixture();
  check('schema-5 stores imported exact B-rep as a bounded resource referenced by one new-body feature',
    project.resources.length === 1 && project.partDefinitions[0].features[0].type === 'imported-step' &&
    project.partDefinitions[0].features[0].extensions.studioImportedStep.resourceId === project.resources[0].id);
  const serialized = JSON.stringify(canonicalStudioV5Project(project));
  check('imported resources and explicit no-history limitation survive canonical save/open byte-identically',
    JSON.stringify(parseOrMigrateStudioV5RuntimeProject(serialized)) === serialized &&
    JSON.parse(serialized).metadata.importLimitations.includes('no-parametric-feature-history'));
  const changed = canonicalStudioV5Project(project);
  changed.resources[0].data = Buffer.from('different').toString('base64');
  changed.resources[0].byteLength = Buffer.from('different').byteLength;
  check('embedded exact geometry participates in canonical document identity', studioV5CanonicalHash(project) !== studioV5CanonicalHash(prepareStudioV5Project(changed)));
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
    state.__interchangeWorker ||= new Worker('/static/studio-kernel.worker.js', { type: 'module' });
    state.__interchangeSequence = (state.__interchangeSequence || 0) + 1;
    const requestId = `interchange-${state.__interchangeSequence}`;
    if (request.stepText != null) {
      request.blob = new Blob([request.stepText], { type: 'application/STEP' });
      delete request.stepText;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Slice 5F interchange worker timeout')), 60_000);
      const listener = async (event: MessageEvent) => {
        if (event.data?.requestId !== requestId) return;
        clearTimeout(timer); state.__interchangeWorker.removeEventListener('message', listener);
        if (event.data.kind === 'kernel-error') reject(new Error(event.data.message));
        else resolve({
          ...event.data,
          blobSize: event.data.blob?.size || 0,
          blobType: event.data.blob?.type || '',
          stepText: event.data.blob ? await event.data.blob.text() : '',
          blob: undefined,
        });
      };
      state.__interchangeWorker.addEventListener('message', listener);
      state.__interchangeWorker.postMessage({ ...request, requestId, projectId: 'project-slice-5f-interchange' });
    });
  }, payload);
}

async function restartInterchangeWorker(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as any;
    state.__interchangeWorker?.terminate();
    state.__interchangeWorker = null;
  });
}

function withoutBomwikiManifest(text: string): string {
  return text.replace(/\/\*BOMWIKI_V5_MANIFEST:[A-Za-z0-9+/=]+\*\/\n?/, '');
}

function replaceBomwikiManifest(text: string, manifest: unknown): string {
  const encoded = Buffer.from(JSON.stringify(manifest)).toString('base64');
  return text.replace(/\/\*BOMWIKI_V5_MANIFEST:[A-Za-z0-9+/=]+\*\//, `/*BOMWIKI_V5_MANIFEST:${encoded}*/`);
}

let exportedStepText = '';
async function kernelChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5F exact STEP interchange worker');
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const sourceDraft: any = canonicalStudioV5Project(createSolvedAssemblyProject());
  sourceDraft.materials.push({
    id: 'material-step-proof', name: 'STEP proof alloy', densityKgM3: 2810, appearanceId: 'appearance-step-proof', source: 'interchange regression',
    extensions: { studioAppearance: { baseColor: '#3f81b5', metallic: 0.55, roughness: 0.32, opacity: 1, edgeColor: '#1d3447' } },
  });
  sourceDraft.partDefinitions.find((part: any) => part.name === 'Nacelle').bodies[0].materialId = 'material-step-proof';
  sourceDraft.partDefinitions.find((part: any) => part.name === 'Nacelle').bodies[0].appearanceId = 'appearance-step-proof';
  const source = prepareStudioV5Project(sourceDraft);
  const exported = await workerRequest(page, { kind: 'export-step', revision: 1, document: source });
  exportedStepText = exported.stepText;
  const products = (exported.stepText.match(/PRODUCT\('/g) || []).length;
  const usages = (exported.stepText.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) || []).length;
  check('complete assembly export is a genuine named XCAF product/component hierarchy with an embedded bounded manifest',
    exported.errors.length === 0 && exported.manifest.structuredHierarchy === true && products >= 12 && usages >= 13 &&
    exported.stepText.includes('BOMWIKI_V5_MANIFEST:') && exported.stepText.includes('COLOUR_RGB') && exported.manifest.interchange.materials[0].id === 'material-step-proof', { products, usages, manifest: exported.manifest });

  const imported = await workerRequest(page, { kind: 'import-step-v5', revision: 2, filename: 'engine.step', stepText: exported.stepText });
  check('BOMwiki STEP import restores reusable part/subassembly definitions and five shared exact body resources',
    imported.manifest.importMode === 'bomwiki-solved-hierarchy' && imported.project.partDefinitions.length === 5 &&
    imported.project.assemblyDefinitions.length === 2 && imported.manifest.bodyCount === 5 && imported.project.resources.length === 5 &&
    imported.project.materials[0].id === 'material-step-proof' && imported.project.partDefinitions.some((part: any) => part.bodies.some((body: any) => body.materialId === 'material-step-proof')),
    imported.manifest);
  check('round-trip document explicitly retains solved placements but no recovered mates or parametric feature history',
    imported.project.assemblyDefinitions.every((assembly: any) => assembly.mates.length === 0 && assembly.occurrencePatterns.length === 0) &&
    imported.project.partDefinitions.every((part: any) => part.features.every((feature: any) => feature.type === 'imported-step')) &&
    imported.manifest.limitations.includes('no-mate-recovery') && imported.manifest.limitations.includes('no-parametric-feature-history'));

  const preparedImported = prepareStudioV5Project(imported.project);
  const rebuilt = await workerRequest(page, { kind: 'rebuild', revision: 3, document: preparedImported });
  check('restored imported project evaluates all seven exact solids with stable nested occurrence paths',
    rebuilt.errors.length === 0 && rebuilt.bodies.length === 7 && rebuilt.bodies.every((body: any) => body.geometry?.valid && body.geometry.solidCount === 1) &&
    rebuilt.bodies.some((body: any) => body.occurrenceInstance.occurrencePath.length === 2), rebuilt.errors);

  const reexported = await workerRequest(page, { kind: 'export-step', revision: 4, document: preparedImported });
  await restartInterchangeWorker(page);
  const reimported = await workerRequest(page, { kind: 'import-step-v5', revision: 5, filename: 'engine-roundtrip.step', stepText: reexported.stepText });
  check('re-export and second import preserve definition, occurrence, and exact-body counts',
    reexported.manifest.structuredHierarchy === true && reimported.project.partDefinitions.length === 5 &&
    reimported.project.assemblyDefinitions.length === 2 && reimported.manifest.bodyCount === 5);

  const external = await workerRequest(page, { kind: 'import-step-v5', revision: 6, filename: 'external.step', stepText: withoutBomwikiManifest(exported.stepText) });
  const externalRebuild = await workerRequest(page, { kind: 'rebuild', revision: 7, document: external.project });
  check('third-party STEP without the sidecar recovers AP242 products, nesting, names, palette, units, and every exact solid',
    external.manifest.importMode === 'external-product-hierarchy' && external.project.partDefinitions.length === 7 &&
    external.project.assemblyDefinitions.length === 2 && externalRebuild.bodies.length === 7 && externalRebuild.errors.length === 0 &&
    external.project.metadata.sourceUnits === 'mm' && external.project.materials.length > 0 &&
    external.project.assemblyDefinitions.some((assembly: any) => assembly.name === 'Fan rotor') &&
    !external.manifest.limitations.includes('external-product-hierarchy-unavailable'), external.manifest);

  const metreText = withoutBomwikiManifest(exported.stepText).replace(/SI_UNIT\(\.MILLI\.,\s*\.METRE\.\)/g, 'SI_UNIT($,.METRE.)');
  const metreExternal = await workerRequest(page, { kind: 'import-step-v5', revision: 71, filename: 'external-metres.step', stepText: metreText });
  const metreRebuild = await workerRequest(page, { kind: 'rebuild', revision: 72, document: metreExternal.project });
  const mmSpan = externalRebuild.bodies[0].geometry.bounds[1][0] - externalRebuild.bodies[0].geometry.bounds[0][0];
  const metreSpan = metreRebuild.bodies[0].geometry.bounds[1][0] - metreRebuild.bodies[0].geometry.bounds[0][0];
  check('third-party metre STEP is normalized to internal millimetres while retaining source-unit metadata',
    metreExternal.project.metadata.sourceUnits === 'm' && metreExternal.project.metadata.sourceUnitScaleToMm === 1000 && Math.abs(metreSpan - mmSpan * 1000) <= Math.max(1, Math.abs(mmSpan * 1000)) * 1e-6,
    { mmSpan, metreSpan, metadata: metreExternal.project.metadata });

  const selectedBodyId = rebuilt.bodies.find((body: any) => body.bodyName.startsWith('Turbine'))?.bodyId;
  const selected = await workerRequest(page, { kind: 'export-step', revision: 8, document: preparedImported, bodyIds: [selectedBodyId] });
  check('selected-body STEP remains one placed exact solid without falsely advertising complete hierarchy',
    selected.errors.length === 0 && selected.manifest.bodyCount === 1 && selected.manifest.structuredHierarchy === false &&
    !selected.stepText.includes('BOMWIKI_V5_MANIFEST:'), selected.manifest);

  const hidden: any = canonicalStudioV5Project(source);
  hidden.assemblyDefinitions.find((assembly: any) => assembly.id === hidden.rootDocument.assemblyId)
    .occurrences.find((occurrence: any) => occurrence.name.startsWith('Turbine')).visible = false;
  const hiddenExport = await workerRequest(page, { kind: 'export-step', revision: 9, document: prepareStudioV5Project(hidden) });
  check('structured export prunes hidden component products and solids while retaining the visible hierarchy',
    hiddenExport.manifest.structuredHierarchy === true && hiddenExport.manifest.bodyCount === 6 &&
    hiddenExport.manifest.interchange.bodyInstances.every((instance: any) => !instance.name.startsWith('Turbine')) &&
    !hiddenExport.stepText.includes("PRODUCT('Turbine drum'"), hiddenExport.manifest);

  let refused = 0;
  try { await workerRequest(page, { kind: 'import-step-v5', revision: 10, filename: 'wrong.json', stepText: exported.stepText }); } catch { refused++; }
  try { await workerRequest(page, { kind: 'import-step-v5', revision: 11, filename: 'broken.step', stepText: 'not a step file' }); } catch { refused++; }
  const oversizedManifest = structuredClone(exported.manifest.interchange);
  oversizedManifest.bodyInstances = Array.from({ length: 5001 }, (_, index) => ({ ...oversizedManifest.bodyInstances[0], bodyId: 'oversized-' + index }));
  try {
    await workerRequest(page, {
      kind: 'import-step-v5', revision: 12, filename: 'oversized.step',
      stepText: replaceBomwikiManifest(exported.stepText, oversizedManifest),
    });
  } catch { refused++; }
  check('worker refuses wrong extensions, malformed STEP, and over-budget hierarchy before returning a partial project', refused === 3, refused);
  await page.close();
}

async function waitForStudio(page: Page, revisionAfter?: number): Promise<void> {
  await page.waitForFunction((after) => {
    const studio = (window as any).__bwStudio;
    return Boolean(studio && studio.mode().kind === 'idle' && (after == null || studio.appliedRevision() > after));
  }, { timeout: 60_000, polling: 100 }, revisionAfter ?? null);
}

async function browserChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5F visible STEP interchange gate');
  if (!exportedStepText) {
    const helper = await browser.newPage(); await helper.goto(url, { waitUntil: 'domcontentloaded' });
    exportedStepText = (await workerRequest(helper, { kind: 'export-step', revision: 1, document: createSolvedAssemblyProject() })).stepText;
    await helper.close();
  }
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const pageErrors: string[] = []; const dialogs: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('dialog', async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('bw-studio-welcome-v1', '1'); localStorage.setItem('bw-studio-v2-seeded', '1'); localStorage.setItem('bw-studio-tour-v1', '1');
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try { await waitForStudio(page); }
  catch (error) {
    console.error('Initial studio state', await page.evaluate(() => ({
      hasStudio: Boolean((window as any).__bwStudio),
      mode: (window as any).__bwStudio?.mode?.(),
      applied: (window as any).__bwStudio?.appliedRevision?.(),
      message: document.getElementById('bw-studio-msg')?.textContent || '',
    })), pageErrors);
    throw error;
  }
  check('visible Open control accepts native projects plus .step and .stp files',
    await page.$eval('#bw-open-file', (input) => (input as HTMLInputElement).accept) === '.json,.step,.stp');

  const directory = mkdtempSync(join(tmpdir(), 'bomwiki-slice5f-step-'));
  const filename = join(directory, 'engine.step');
  writeFileSync(filename, exportedStepText);
  const before = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  const input = await page.$('#bw-open-file');
  await (input as any).uploadFile(filename);
  await waitForStudio(page, before);
  const visible = await page.evaluate(() => {
    const studio = (window as any).__bwStudio;
    const project = JSON.parse(studio.docJson());
    return {
      rootKind: studio.rootKind(), bodies: studio.bodyResults(), project,
      message: document.getElementById('bw-studio-msg')?.textContent || '', hash: studio.canonicalHash(),
    };
  });
  check('browser imports STEP transactionally into the real assembly tree and renders all seven exact bodies',
    visible.rootKind === 'assembly' && visible.bodies.length === 7 && visible.bodies.every((body: any) => body.geometry?.valid) &&
    visible.project.partDefinitions.length === 5 && /solved assembly hierarchy/.test(visible.message),
    { bodies: visible.bodies.length, message: visible.message });
  check('browser-imported definitions use exact imported-step resources and expose the no-history boundary in the saved document',
    visible.project.partDefinitions.every((part: any) => part.features.every((feature: any) => feature.type === 'imported-step')) &&
    visible.project.resources.length === 5 && visible.project.metadata.importLimitations.includes('no-parametric-feature-history'));

  const persisted = await page.evaluate(async () => {
    const studio = (window as any).__bwStudio; await studio.flushStorage();
    return { hash: studio.canonicalHash(), bodies: studio.bodyResults().length, mode: JSON.parse(studio.docJson()).metadata.importMode };
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__bwStudio?.mode().kind === 'idle' && (window as any).__bwStudio.bodyResults().length === 7, { timeout: 60_000, polling: 100 });
  const recovered = await page.evaluate(() => ({
    hash: (window as any).__bwStudio.canonicalHash(), bodies: (window as any).__bwStudio.bodyResults().length,
    mode: JSON.parse((window as any).__bwStudio.docJson()).metadata.importMode,
  }));
  check('local recovery preserves imported exact resources, hierarchy, body count, and canonical identity', JSON.stringify(recovered) === JSON.stringify(persisted), { persisted, recovered });

  const reexport = await page.evaluate(async () => (window as any).__bwStudio.exportForTest('step'));
  check('browser can re-export the recovered complete assembly as structured STEP',
    reexport.errors.length === 0 && reexport.size > 500 && reexport.manifest.structuredHierarchy === true &&
    reexport.text.includes('NEXT_ASSEMBLY_USAGE_OCCURRENCE') && reexport.text.includes('BOMWIKI_V5_MANIFEST:'), reexport.manifest);
  const browserRoundTrip = await page.evaluate(async (stepText) => {
    const studio = (window as any).__bwStudio;
    const restartsBefore = studio.kernelRestartCount();
    const result = await studio.importStepForTest(new Blob([stepText], { type: 'application/STEP' }), 'browser-roundtrip.step');
    return {
      restartsBefore, restartsAfter: studio.kernelRestartCount(),
      parts: result.project.partDefinitions.length, assemblies: result.project.assemblyDefinitions.length,
      bodies: result.manifest.bodyCount,
    };
  }, reexport.text);
  check('browser re-imports its own recovered XCAF export, resetting and retrying once if the long-lived STEP reader faults',
    browserRoundTrip.parts === 5 && browserRoundTrip.assemblies === 2 && browserRoundTrip.bodies === 5 &&
    browserRoundTrip.restartsAfter - browserRoundTrip.restartsBefore <= 1, browserRoundTrip);

  const beforeStale = await page.evaluate(() => ({
    projectId: (window as any).__bwStudio.projectId(), revision: (window as any).__bwStudio.documentRevision(),
  }));
  await page.evaluate(() => (window as any).__bwStudio.delayNextKernelReply(750));
  const staleInput = await page.$('#bw-open-file');
  await (staleInput as any).uploadFile(filename);
  await page.$eval('[data-occurrence-action="visibility"]', (button) => (button as HTMLElement).click());
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 2500)));
  const afterStale = await page.evaluate(() => ({
    projectId: (window as any).__bwStudio.projectId(), revision: (window as any).__bwStudio.documentRevision(),
  }));
  check('a STEP result that returns after a document edit is discarded instead of replacing newer work',
    afterStale.projectId === beforeStale.projectId && afterStale.revision > beforeStale.revision, { beforeStale, afterStale });

  const badFile = join(directory, 'broken.step'); writeFileSync(badFile, 'not a STEP file');
  const beforeBad = await page.evaluate(() => ({ hash: (window as any).__bwStudio.canonicalHash(), undo: (window as any).__bwStudio.undoDepth(), redo: (window as any).__bwStudio.redoDepth() }));
  const recoveredInput = await page.$('#bw-open-file');
  await (recoveredInput as any).uploadFile(badFile);
  await page.waitForFunction(() => /Could not import STEP/.test(document.getElementById('bw-studio-msg')?.textContent || ''), { timeout: 60_000, polling: 100 });
  const afterBad = await page.evaluate(() => ({ hash: (window as any).__bwStudio.canonicalHash(), undo: (window as any).__bwStudio.undoDepth(), redo: (window as any).__bwStudio.redoDepth() }));
  check('failed browser import leaves document and undo/redo state byte-identical', JSON.stringify(afterBad) === JSON.stringify(beforeBad), { beforeBad, afterBad });
  check('browser interchange gate has no page errors or native dialogs', pageErrors.length === 0 && dialogs.length === 0, { pageErrors, dialogs });
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
if (failures) { console.error(`\n${failures}/${checks} Slice 5F interchange checks failed`); process.exit(1); }
console.log(`\n${checks}/${checks} Slice 5F interchange checks passed`);
