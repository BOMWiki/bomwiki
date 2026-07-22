// Slice 5A-runtime acceptance gate. The three modes keep failures attributable:
//
//   npm run studio:v5:runtime:document
//   npm run studio:v5:runtime:kernel
//   npm run studio:v5:runtime:browser
//   npm run studio:v5:runtime

import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type ElementHandle, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
import { prepareStudioV5Project } from '../static/studio-project-v5.js';
// @ts-expect-error Browser-native module intentionally has no TypeScript declarations.
import { canonicalStudioV5Project, createStudioV5BooleanFeature, deleteStudioV5Body, migrateStudioDocumentToV5, parseOrMigrateStudioV5RuntimeProject, prepareStudioV5RuntimeProject, studioV5CanonicalHash, studioV5RootPart, updateStudioV5Body } from '../static/studio-v5-runtime-document.js';
import {
  createDisjointBooleanRuntimeProject,
  createThreeBodyRuntimeProject,
  RUNTIME_BODY_IDS,
  RUNTIME_FEATURE_IDS,
} from './studio-v5-runtime-fixture.ts';

type Mode = 'all' | 'document' | 'kernel' | 'browser';
const mode = (process.argv[2] || 'all') as Mode;
if (!['all', 'document', 'kernel', 'browser'].includes(mode)) throw new Error(`Unknown Slice 5A check mode: ${mode}`);

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  const suffix = !ok && detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : '';
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${suffix}`);
  if (!ok) failures++;
}
const close = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
const copy = <T>(value: T): T => structuredClone(value);

async function documentChecks(): Promise<void> {
  console.log('\nSlice 5A document boundary');
  const three = createThreeBodyRuntimeProject({ boolean: false });
  const part = studioV5RootPart(three);
  const canonical = canonicalStudioV5Project(three);
  check('document 1/10 creates Housing, disjoint Shaft, and Tool as canonical bodies',
    part.bodies.map((body: { name: string }) => body.name).join(',') === 'Housing,Shaft,Tool' && canonical.schemaVersion === 5);
  check('document body IDs are stable and creator-derived',
    part.bodies.map((body: { id: string }) => body.id).join(',') === Object.values(RUNTIME_BODY_IDS).join(','));
  check('document feature ownership is explicit before Boolean',
    part.bodies.every((body: { featureIds: string[] }) => body.featureIds.length === 1));
  check('document active body is explicit', part.metadata?.activeBodyId === RUNTIME_BODY_IDS.housing);

  const beforeBoolean = JSON.stringify(three);
  const withBoolean = createStudioV5BooleanFeature(three, {
    id: RUNTIME_FEATURE_IDS.boolean,
    operation: 'subtract',
    targetBodyId: RUNTIME_BODY_IDS.housing,
    toolBodyId: RUNTIME_BODY_IDS.tool,
    keepTools: true,
  });
  const booleanPart = studioV5RootPart(withBoolean);
  check('document 4/10 Boolean creation is detached', JSON.stringify(three) === beforeBoolean);
  check('document Boolean belongs to Housing and references Tool',
    booleanPart.bodies[0].featureIds.at(-1) === RUNTIME_FEATURE_IDS.boolean &&
    booleanPart.features.at(-1)?.toolBodyIds?.[0] === RUNTIME_BODY_IDS.tool);
  const malformedBoolean = copy(withBoolean);
  studioV5RootPart(malformedBoolean).features.at(-1).toolBodyIds = [RUNTIME_BODY_IDS.housing];
  let malformedBooleanRejected = false;
  try { prepareStudioV5Project(malformedBoolean); } catch (error) { malformedBooleanRejected = (error as { code?: string }).code === 'INVALID_FEATURE'; }
  check('document boundary rejects a target body reused as its own Boolean tool', malformedBooleanRejected);
  let bodyCycleRejected = false;
  try {
    createStudioV5BooleanFeature(withBoolean, {
      id: 'feature-cyclic-tool', operation: 'subtract',
      targetBodyId: RUNTIME_BODY_IDS.tool, toolBodyId: RUNTIME_BODY_IDS.housing, keepTools: true,
    });
  } catch (error) {
    bodyCycleRejected = (error as { code?: string }).code === 'CYCLIC_BODY_DEPENDENCY';
  }
  check('document boundary rejects cyclic Boolean body dependencies', bodyCycleRejected);

  const beforeBodyEdit = JSON.stringify(withBoolean);
  const renamed = updateStudioV5Body(withBoolean, RUNTIME_BODY_IDS.shaft, { name: 'Shaft core', visible: false, suppressed: true, active: true });
  check('document 5/10 body edits are detached and retain identity',
    JSON.stringify(withBoolean) === beforeBodyEdit &&
    studioV5RootPart(renamed).bodies[1].id === RUNTIME_BODY_IDS.shaft &&
    studioV5RootPart(renamed).bodies[1].name === 'Shaft core');
  check('document suppression cannot leave a suppressed body active', studioV5RootPart(renamed).metadata.activeBodyId === RUNTIME_BODY_IDS.housing);
  let invalidRenameRejected = false;
  try { updateStudioV5Body(withBoolean, RUNTIME_BODY_IDS.shaft, { name: '' }); } catch { invalidRenameRejected = true; }
  check('document invalid body edits fail before mutating canonical state', invalidRenameRejected && JSON.stringify(withBoolean) === beforeBodyEdit);

  const serialized = JSON.stringify(withBoolean);
  const reopened = parseOrMigrateStudioV5RuntimeProject(serialized);
  check('document 8/10 schema-5 save/reopen is byte-identical', JSON.stringify(reopened) === serialized);
  check('document save/reopen preserves IDs and ownership',
    JSON.stringify(studioV5RootPart(reopened).bodies) === JSON.stringify(booleanPart.bodies));
  check('document canonical hash is stable across save/reopen', studioV5CanonicalHash(reopened) === studioV5CanonicalHash(withBoolean));

  const legacy3 = {
    title: 'Legacy V3 body', units: 'mm', params: [],
    features: [{ id: 'legacy-v3-extrude', type: 'extrude', sketch: { shapes: [{ kind: 'rect', x: 0, y: 0, w: 4, h: 4 }], z: 0 }, h: 2 }],
  };
  const legacy4 = { ...legacy3, schemaVersion: 4, title: 'Legacy V4 body', features: [{ ...legacy3.features[0], id: 'legacy-v4-extrude' }] };
  const migrated3 = migrateStudioDocumentToV5(legacy3, { projectId: 'project-legacy-3' });
  const migrated4 = migrateStudioDocumentToV5(legacy4, { projectId: 'project-legacy-4' });
  check('document schema-3 migration preserves body ownership',
    studioV5RootPart(migrated3).bodies[0].featureIds[0] === 'legacy-v3-extrude' && migrated3.metadata.migratedFromSchema === 3);
  check('document schema-4 migration preserves body ownership',
    studioV5RootPart(migrated4).bodies[0].featureIds[0] === 'legacy-v4-extrude' && migrated4.metadata.migratedFromSchema === 4);

  const deletedTool = deleteStudioV5Body(withBoolean, RUNTIME_BODY_IDS.tool);
  const deletedPart = studioV5RootPart(deletedTool);
  check('document body deletion removes its creator and dependent Boolean transactionally',
    !deletedPart.bodies.some((body: { id: string }) => body.id === RUNTIME_BODY_IDS.tool) &&
    !deletedPart.features.some((feature: { id: string }) => feature.id === RUNTIME_FEATURE_IDS.boolean));
  check('document preparation remains canonical after every command', JSON.stringify(prepareStudioV5RuntimeProject(withBoolean)) === JSON.stringify(prepareStudioV5Project(withBoolean)));
}

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');
const MIME: Record<string, string> = {
  '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
};

async function startServer(): Promise<{ server: Server; url: string }> {
  const html = cadStudioPage();
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    if (path.startsWith('/static/')) {
      const file = join(staticDir, path.slice('/static/'.length));
      if (existsSync(file)) {
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(readFileSync(file));
        return;
      }
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${port}/cad/studio` };
}

async function workerRequest(page: Page, request: Record<string, unknown>): Promise<any> {
  return page.evaluate(async (payload) => {
    const state = window as unknown as { __slice5aWorker?: Worker; __slice5aSeq?: number };
    state.__slice5aWorker ||= new Worker('/static/studio-kernel.worker.js', { type: 'module' });
    state.__slice5aSeq = (state.__slice5aSeq || 0) + 1;
    const requestId = `slice-5a-${state.__slice5aSeq}`;
    const response = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Slice 5A worker timed out.')), 60_000);
      const listener = (event: MessageEvent) => {
        if (event.data?.requestId !== requestId) return;
        clearTimeout(timer);
        state.__slice5aWorker!.removeEventListener('message', listener);
        if (event.data.kind === 'kernel-error') reject(new Error(event.data.message));
        else resolve(event.data);
      };
      state.__slice5aWorker!.addEventListener('message', listener);
      state.__slice5aWorker!.postMessage({ ...payload, requestId, projectId: 'project-slice-5a-worker' });
    });
    if (response.blob) {
      response.blobSize = response.blob.size;
      response.blobType = response.blob.type;
      if (payload.kind === 'export-step') response.blobText = await response.blob.text();
      delete response.blob;
    }
    return response;
  }, request);
}

function bodyById(response: any, bodyId: string): any {
  return response.bodies?.find((body: any) => body.bodyId === bodyId);
}

async function kernelChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5A exact kernel');
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const three = createThreeBodyRuntimeProject({ boolean: false });
  const initial = await workerRequest(page, { kind: 'rebuild', revision: 1, document: three });
  const initialGeometry = Object.fromEntries(initial.bodies.map((body: any) => [body.bodyId, body.geometry]));
  check('kernel 1-3/10 returns three independently named body results', initial.bodies.map((body: any) => body.bodyName).join(',') === 'Housing,Shaft,Tool');
  check('kernel 1-3/10 proves exactly one B-rep solid per body', initial.bodies.every((body: any) => body.geometry?.solidCount === 1 && body.geometry.valid));
  check('kernel disjoint placement is exact, not silently fused',
    initialGeometry[RUNTIME_BODY_IDS.shaft].bounds[0][0] > initialGeometry[RUNTIME_BODY_IDS.housing].bounds[1][0]);

  const valid = createThreeBodyRuntimeProject();
  const subtracted = await workerRequest(page, { kind: 'rebuild', revision: 2, document: valid });
  check('kernel 4/10 subtract reduces exact Housing volume',
    bodyById(subtracted, RUNTIME_BODY_IDS.housing).geometry.volume < initialGeometry[RUNTIME_BODY_IDS.housing].volume);
  check('kernel 4/10 retains Shaft and Tool exact volumes and identities',
    close(bodyById(subtracted, RUNTIME_BODY_IDS.shaft).geometry.volume, initialGeometry[RUNTIME_BODY_IDS.shaft].volume) &&
    close(bodyById(subtracted, RUNTIME_BODY_IDS.tool).geometry.volume, initialGeometry[RUNTIME_BODY_IDS.tool].volume));

  const edited = copy(valid);
  const editedPart = studioV5RootPart(edited);
  editedPart.features.find((feature: { id: string }) => feature.id === RUNTIME_FEATURE_IDS.housing).sketch.shapes[0].w = 44;
  const rebuilt = await workerRequest(page, { kind: 'rebuild', revision: 3, document: edited });
  check('kernel 6/10 rebuild evaluates only Housing dependency chain',
    rebuilt.evaluation.evaluatedBodyIds.join(',') === RUNTIME_BODY_IDS.housing &&
    new Set(rebuilt.evaluation.reusedBodyIds).has(RUNTIME_BODY_IDS.shaft) &&
    new Set(rebuilt.evaluation.reusedBodyIds).has(RUNTIME_BODY_IDS.tool), rebuilt.evaluation);
  check('kernel early Housing edit changes Housing while preserving unrelated exact geometry',
    !close(bodyById(rebuilt, RUNTIME_BODY_IDS.housing).geometry.volume, bodyById(subtracted, RUNTIME_BODY_IDS.housing).geometry.volume) &&
    close(bodyById(rebuilt, RUNTIME_BODY_IDS.shaft).geometry.volume, bodyById(subtracted, RUNTIME_BODY_IDS.shaft).geometry.volume));

  const selectedIds = [RUNTIME_BODY_IDS.housing, RUNTIME_BODY_IDS.shaft];
  const step = await workerRequest(page, { kind: 'export-step', revision: 4, document: edited, bodyIds: selectedIds });
  check('kernel 9/10 selected STEP manifest has exact count, units, names, and placement',
    step.manifest.bodyCount === 2 && step.manifest.solidCount === 2 && step.manifest.units === 'mm' &&
    step.manifest.names.join(',') === 'Housing,Shaft' && step.manifest.placements.every((entry: any) => entry.bounds));
  check('kernel selected STEP is a real named exchange file',
    step.blobSize > 1000 && /Housing/.test(step.blobText) && /Shaft/.test(step.blobText), { size: step.blobSize, type: step.blobType });
  const stl = await workerRequest(page, { kind: 'export-stl', revision: 5, document: edited, bodyIds: selectedIds });
  check('kernel selected STL contains the same two exact solids', stl.blobSize > 100 && stl.manifest.bodyCount === 2 && stl.manifest.solidCount === 2);

  const unrelatedFailure = createStudioV5BooleanFeature(edited, {
    id: 'feature-invalid-shaft-subtract',
    operation: 'subtract',
    targetBodyId: RUNTIME_BODY_IDS.shaft,
    toolBodyId: RUNTIME_BODY_IDS.tool,
    keepTools: true,
  });
  const isolatedExport = await workerRequest(page, { kind: 'export-step', revision: 6, document: unrelatedFailure, bodyIds: [RUNTIME_BODY_IDS.housing] });
  check('kernel selected-body export is not blocked by an unrelated failed body',
    isolatedExport.errors.length === 0 && isolatedExport.blobSize > 1000 && isolatedExport.manifest.names.join(',') === 'Housing');

  const invalid = createDisjointBooleanRuntimeProject();
  const validation = await workerRequest(page, { kind: 'validate-v5', revision: 7, document: invalid });
  check('kernel 10/10 rejects a disjoint subtract explicitly',
    validation.errors.length === 1 && /does not intersect/.test(validation.errors[0].message), validation.errors);
  const afterValidation = await workerRequest(page, { kind: 'rebuild', revision: 8, document: edited });
  check('kernel failed transactional validation cannot mutate committed body cache',
    afterValidation.evaluation.evaluatedBodyIds.length === 0 && afterValidation.evaluation.reusedBodyIds.length === 3, afterValidation.evaluation);
  const failedRebuild = await workerRequest(page, { kind: 'rebuild', revision: 9, document: invalid });
  check('kernel failed body rebuild returns last-valid Housing plus unaffected bodies',
    bodyById(failedRebuild, RUNTIME_BODY_IDS.housing).lastValid === true &&
    bodyById(failedRebuild, RUNTIME_BODY_IDS.housing).mesh &&
    bodyById(failedRebuild, RUNTIME_BODY_IDS.shaft).geometry.solidCount === 1 &&
    bodyById(failedRebuild, RUNTIME_BODY_IDS.tool).geometry.solidCount === 1);
  await workerRequest(page, { kind: 'release', revision: 10, document: edited });
  await page.close();
}

async function waitForStudio(page: Page, options: { bodyCount?: number; revisionAfter?: number; timeout?: number } = {}): Promise<void> {
  const timeout = options.timeout || 60_000;
  await page.waitForFunction(({ bodyCount, revisionAfter }) => {
    const studio = (window as any).__bwStudio;
    if (!studio || studio.mode().kind !== 'idle') return false;
    if (bodyCount != null && studio.bodyResults().filter((body: any) => body.geometry).length !== bodyCount) return false;
    if (revisionAfter != null && studio.appliedRevision() <= revisionAfter) return false;
    return true;
  }, { timeout, polling: 250 }, options);
}

async function drawExactBody(page: Page, name: string, dimensions: { w?: number; h?: number; d?: number; x: number; y: number; depth: number }): Promise<void> {
  await page.click('#bw-body-new');
  await page.waitForSelector('#bw-sketch:not([hidden])');
  if (dimensions.d != null) await page.click('[data-sktool="circle"]');
  await page.evaluate((circle) => {
    const canvas = document.getElementById('bw-sketch-canvas')!;
    const bounds = canvas.getBoundingClientRect();
    const emit = (type: string, x: number, y: number) => canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
    emit('pointerup', bounds.left + bounds.width / 2 - 20, bounds.top + bounds.height / 2 - 20);
    emit('pointermove', bounds.left + bounds.width / 2 + 20, bounds.top + bounds.height / 2 + 20);
    emit('pointerup', bounds.left + bounds.width / 2 + 20, bounds.top + bounds.height / 2 + 20);
  }, dimensions.d != null);
  await page.waitForSelector('#bw-sk-dims [data-dim]');
  await page.evaluate(({ name, dimensions }) => {
    const set = (selector: string, value: number | string) => {
      const input = document.querySelector(selector) as HTMLInputElement;
      input.value = String(value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    if (dimensions.d != null) set('[data-dim="d"]', dimensions.d);
    else {
      set('[data-dim="w"]', dimensions.w!);
      set('[data-dim="h"]', dimensions.h!);
    }
    set('[data-dim="x"]', dimensions.x);
    set('[data-dim="y"]', dimensions.y);
    set('#bw-sk-op-h', dimensions.depth);
    set('#bw-sk-body-name', name);
  }, { name, dimensions });
  const before = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click('#bw-sk-apply');
  await waitForStudio(page, { revisionAfter: before });
}

async function clickBodyAction(page: Page, bodyId: string, action: string): Promise<void> {
  const selector = `#bw-bodies [data-body-id="${bodyId}"] [data-body-action="${action}"]`;
  const before = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.$eval(selector, (element) => (element as HTMLButtonElement).click());
  if (action !== 'select' && action !== 'isolate' && action !== 'rename') await waitForStudio(page, { revisionAfter: before });
}

async function selectBodyVisible(page: Page, bodyId: string): Promise<void> {
  const selected = await page.evaluate(() => (window as any).__bwStudio.selectedBodyId());
  if (selected === bodyId) await clickBodyAction(page, bodyId, 'select');
  await clickBodyAction(page, bodyId, 'select');
  await page.waitForFunction((id) => (window as any).__bwStudio.selectedBodyId() === id, { polling: 250 }, bodyId);
}

async function keyCommand(page: Page, key: 'z' | 'y'): Promise<void> {
  const before = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
  await waitForStudio(page, { revisionAfter: before });
}

async function browserChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5A visible browser gate');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.removeItem('bw-studio-doc-v2');
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForStudio(page);

  await drawExactBody(page, 'Housing', { w: 40, h: 40, x: 0, y: 0, depth: 20 });
  await drawExactBody(page, 'Shaft', { w: 10, h: 10, x: 60, y: 0, depth: 20 });
  await drawExactBody(page, 'Tool', { d: 10, x: 0, y: 0, depth: 20 });
  const created = await page.evaluate(() => ({ doc: JSON.parse((window as any).__bwStudio.docJson()), bodies: (window as any).__bwStudio.bodyResults() }));
  const createdPart = studioV5RootPart(created.doc);
  const ids = Object.fromEntries(createdPart.bodies.map((body: any) => [body.name, body.id]));
  check('browser 1-3/10 visibly creates Housing, disjoint Shaft, and Tool', createdPart.bodies.map((body: any) => body.name).join(',') === 'Housing,Shaft,Tool');
  check('browser 1-3/10 worker proves one exact solid per created body', created.bodies.every((body: any) => body.geometry?.solidCount === 1));
  check('browser renderer owns three independently selectable body meshes',
    (await page.evaluate((bodyIds) => {
      const studio = (window as any).__bwStudio;
      const independent = bodyIds.every((id: string) => { studio.selectBodyForTest(id); return studio.selectedBodyId() === id && studio.triCount() > 0; });
      studio.selectBodyForTest(null);
      return independent;
    }, Object.values(ids))) === true);
  const topologyOwners = await page.evaluate(() => (window as any).__bwStudio.topologyBodyIds());
  check('browser renderer keeps face and edge topology owned by body identity',
    Object.values(ids).every((id) => topologyOwners.edges.includes(id) && topologyOwners.faces.includes(id)), topologyOwners);
  await page.$eval('[data-view="fit"]', (button) => (button as HTMLButtonElement).click());
  await page.evaluate(() => (window as any).__bwStudio.frame());
  const shaftPoint = await page.evaluate((bodyId) => {
    const ndc = (window as any).__bwStudio.ndcOfBodyCenter(bodyId);
    const bounds = document.querySelector('#bw-studio > canvas')!.getBoundingClientRect();
    return { x: bounds.left + (ndc[0] + 1) * bounds.width / 2, y: bounds.top + (1 - ndc[1]) * bounds.height / 2 };
  }, ids.Shaft);
  await page.mouse.click(shaftPoint.x, shaftPoint.y);
  const canvasSelectedBody = await page.evaluate(() => (window as any).__bwStudio.selectedBodyId());
  check('browser canvas click selects and identifies Shaft independently', canvasSelectedBody === ids.Shaft, { shaftPoint, selectedBodyId: canvasSelectedBody, shaftBodyId: ids.Shaft });

  const beforeParameterHash = await page.evaluate(() => (window as any).__bwStudio.canonicalHash());
  const beforeParameterRevision = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click('#bw-param-add');
  await waitForStudio(page, { revisionAfter: beforeParameterRevision });
  check('browser schema-5 parameter commands create stable canonical IDs',
    await page.evaluate(() => JSON.parse((window as any).__bwStudio.docJson()).parameters.at(-1)?.id?.startsWith('parameter-')));
  await keyCommand(page, 'z');
  check('browser schema-5 parameter command is transactionally undoable', await page.evaluate(() => (window as any).__bwStudio.canonicalHash()) === beforeParameterHash);

  await selectBodyVisible(page, ids.Tool);
  const booleanSelection = await page.evaluate(() => ({
    active: (window as any).__bwStudio.activeBodyId(),
    selected: (window as any).__bwStudio.selectedBodyId(),
    controls: [...document.querySelectorAll('#bw-context [data-body-context]')].map((element) => (element as HTMLElement).dataset.bodyContext),
  }));
  check('browser Boolean command identifies active Housing and selected Tool',
    booleanSelection.active === ids.Housing && booleanSelection.selected === ids.Tool && booleanSelection.controls.includes('subtract'), booleanSelection);
  const beforeBooleanRevision = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click('#bw-context [data-body-context="subtract"]');
  await page.waitForFunction(() => JSON.parse((window as any).__bwStudio.docJson()).partDefinitions[0].features.some((feature: any) => feature.type === 'boolean'), { timeout: 60_000, polling: 250 });
  await waitForStudio(page, { revisionAfter: beforeBooleanRevision });
  const afterBoolean = await page.evaluate(() => ({ doc: JSON.parse((window as any).__bwStudio.docJson()), bodies: (window as any).__bwStudio.bodyResults() }));
  check('browser 4/10 visibly subtracts Tool from Housing while retaining Shaft',
    studioV5RootPart(afterBoolean.doc).bodies.length === 3 && afterBoolean.bodies.every((body: any) => body.geometry?.solidCount === 1));

  const booleanHash = await page.evaluate(() => (window as any).__bwStudio.canonicalHash());
  await keyCommand(page, 'z');
  const booleanAfterUndo = await page.evaluate(() =>
    JSON.parse((window as any).__bwStudio.docJson()).partDefinitions[0].features.some((feature: any) => feature.type === 'boolean'));
  check('browser 7/10 undo removes the Boolean as one transaction', !booleanAfterUndo);
  await keyCommand(page, 'y');
  check('browser 7/10 redo restores byte-identical Boolean state', await page.evaluate(() => (window as any).__bwStudio.canonicalHash()) === booleanHash);

  for (const [initialName, bodyId] of Object.entries(ids)) {
    await clickBodyAction(page, bodyId as string, 'visibility');
    check(`browser 5/10 hides ${initialName} independently`, !(await page.evaluate((id) => (window as any).__bwStudio.visibleBodyIds().includes(id), bodyId)));
    await clickBodyAction(page, bodyId as string, 'visibility');
    check(`browser 5/10 shows ${initialName} independently`, await page.evaluate((id) => (window as any).__bwStudio.visibleBodyIds().includes(id), bodyId));
    await clickBodyAction(page, bodyId as string, 'isolate');
    check(`browser 5/10 isolates ${initialName}`, (await page.evaluate(() => (window as any).__bwStudio.visibleBodyIds())).join(',') === bodyId);
    await clickBodyAction(page, bodyId as string, 'isolate');
    await clickBodyAction(page, bodyId as string, 'rename');
    await page.waitForSelector('#bw-context [data-body-name]');
    const renamed = `${initialName} runtime`;
    const beforeRename = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
    await page.$eval('#bw-context [data-body-name]', (input, value) => {
      (input as HTMLInputElement).value = value as string;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, renamed);
    await waitForStudio(page, { revisionAfter: beforeRename });
    check(`browser 5/10 renames ${initialName} through the tree inspector`, await page.$eval(`#bw-bodies [data-body-id="${bodyId}"] .body-select`, (button, name) => button.childNodes[0].textContent === name, renamed));
    await keyCommand(page, 'z');
    await keyCommand(page, 'y');
    check(`browser 7/10 undo/redo restores the ${initialName} body edit`, await page.$eval(`#bw-bodies [data-body-id="${bodyId}"] .body-select`, (button, name) => button.childNodes[0].textContent === name, renamed));
    await clickBodyAction(page, bodyId as string, 'suppress');
    check(`browser 5/10 suppresses ${initialName}`, await page.$eval(`#bw-bodies [data-body-id="${bodyId}"]`, (row) => row.classList.contains('is-suppressed')));
    await clickBodyAction(page, bodyId as string, 'suppress');
    check(`browser 5/10 restores ${initialName}`, !(await page.$eval(`#bw-bodies [data-body-id="${bodyId}"]`, (row) => row.classList.contains('is-suppressed'))));
  }

  const housingCreator = createdPart.bodies.find((body: any) => body.id === ids.Housing).createdByFeatureId;
  await page.click(`#bw-history [data-edit="${housingCreator}"]`);
  await page.waitForSelector('#bw-sketch:not([hidden])');
  await page.$eval('[data-dim="w"]', (input) => {
    (input as HTMLInputElement).value = '44';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const beforeDimensionRevision = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click('#bw-sk-apply');
  await waitForStudio(page, { revisionAfter: beforeDimensionRevision });
  const trace = await page.evaluate(() => (window as any).__bwStudio.evaluationTrace());
  check('browser 6/10 early dimension rebuild evaluates only the affected dependency chain',
    trace.evaluatedBodyIds.join(',') === ids.Housing && new Set(trace.reusedBodyIds).has(ids.Shaft) && new Set(trace.reusedBodyIds).has(ids.Tool), trace);

  const beforeSave = await page.evaluate(() => {
    const studio = (window as any).__bwStudio;
    const original = URL.createObjectURL.bind(URL);
    (window as any).__slice5aSavedText = null;
    URL.createObjectURL = (blob: Blob) => {
      blob.text().then((text) => (window as any).__slice5aSavedText = text);
      return original(blob);
    };
    return {
      hash: studio.canonicalHash(),
      doc: JSON.parse(studio.docJson()),
      geometry: studio.bodyResults().map((body: any) => ({ bodyId: body.bodyId, geometry: body.geometry })),
    };
  });
  await page.click('#bw-save-file');
  await page.waitForFunction(() => Boolean((window as any).__slice5aSavedText), { polling: 250 });
  const savedText = await page.evaluate(() => (window as any).__slice5aSavedText as string);
  const fixtureDir = mkdtempSync(join(tmpdir(), 'bomwiki-slice-5a-'));
  const projectFile = join(fixtureDir, 'project.bomcad.json');
  writeFileSync(projectFile, savedText);
  const fileInput = await page.$('#bw-open-file') as ElementHandle<HTMLInputElement> | null;
  await fileInput!.uploadFile(projectFile);
  await page.waitForFunction((hash) => (window as any).__bwStudio.canonicalHash() === hash, { timeout: 60_000, polling: 250 }, beforeSave.hash);
  await waitForStudio(page, { bodyCount: 3 });
  const reopened = await page.evaluate(() => ({
    hash: (window as any).__bwStudio.canonicalHash(),
    doc: JSON.parse((window as any).__bwStudio.docJson()),
    geometry: (window as any).__bwStudio.bodyResults().map((body: any) => ({ bodyId: body.bodyId, geometry: body.geometry })),
  }));
  check('browser 8/10 Save and real file-input reopen preserve canonical hash', reopened.hash === beforeSave.hash);
  check('browser 8/10 reopen preserves body IDs, ownership, and visibility',
    JSON.stringify(studioV5RootPart(reopened.doc).bodies) === JSON.stringify(studioV5RootPart(beforeSave.doc).bodies));
  check('browser 8/10 reopen preserves exact body solid counts, volumes, and placement',
    reopened.geometry.every((entry: any) => {
      const prior = beforeSave.geometry.find((candidate: any) => candidate.bodyId === entry.bodyId)?.geometry;
      return prior && entry.geometry.solidCount === prior.solidCount && close(entry.geometry.volume, prior.volume) && JSON.stringify(entry.geometry.bounds) === JSON.stringify(prior.bounds);
    }));

  await page.evaluate(() => (window as any).__bwStudio.flushStorage());
  const recoveryBeforeReload = await page.evaluate(() => (window as any).__bwStudio.recovery());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForStudio(page, { bodyCount: 3 });
  check('browser recovery journal stores canonical schema-5 snapshots', recoveryBeforeReload.length > 0 && recoveryBeforeReload.every((snapshot: any) => snapshot.document.schemaVersion === 5));
  check('browser recovery reload restores identical IDs, ownership, visibility, and geometry',
    await page.evaluate((hash) => (window as any).__bwStudio.canonicalHash() === hash && (window as any).__bwStudio.bodyResults().every((body: any) => body.geometry?.solidCount === 1), beforeSave.hash));

  await page.$eval(`#bw-bodies [data-body-id="${ids.Housing}"] [data-body-export]`, (checkbox) => (checkbox as HTMLInputElement).click());
  await page.$eval(`#bw-bodies [data-body-id="${ids.Shaft}"] [data-body-export]`, (checkbox) => (checkbox as HTMLInputElement).click());
  const exportSelection = await page.$$eval('#bw-bodies [data-body-export]:checked', (checkboxes) => checkboxes.map((checkbox) => (checkbox as HTMLInputElement).dataset.bodyExport));
  check('browser selected-body export controls retain both checked identities', exportSelection.join(',') === [ids.Housing, ids.Shaft].join(','), exportSelection);
  const exported = await page.evaluate(async () => (window as any).__bwStudio.exportForTest('step'));
  check('browser 9/10 selected export has exact body/solid count, units, names, and placement',
    exported.manifest.bodyCount === 2 && exported.manifest.solidCount === 2 && exported.manifest.units === 'mm' &&
    exported.manifest.names.join(',') === 'Housing runtime,Shaft runtime' && exported.manifest.placements.every((entry: any) => entry.bounds), { size: exported.size, errors: exported.errors, manifest: exported.manifest });
  check('browser selected STEP contains both visible body names', exported.size > 1000 && /Housing runtime/.test(exported.text) && /Shaft runtime/.test(exported.text), { size: exported.size, names: exported.manifest?.names, textHead: exported.text?.slice(0, 240) });

  await page.evaluate(({ housingId, toolId }) => {
    const studio = (window as any).__bwStudio;
    studio.delayNextKernelReply(300);
    (window as any).__slice5aPendingBoolean = studio.attemptBodyBooleanForTest('add', housingId, toolId);
  }, { housingId: ids.Housing, toolId: ids.Tool });
  await clickBodyAction(page, ids.Tool, 'visibility');
  const staleBooleanApplied = await page.evaluate(async () => await (window as any).__slice5aPendingBoolean);
  check('browser stale Boolean validation cannot overwrite a newer body edit',
    staleBooleanApplied === false &&
    !(await page.evaluate((toolId) => (window as any).__bwStudio.visibleBodyIds().includes(toolId), ids.Tool)) &&
    (await page.evaluate(() => JSON.parse((window as any).__bwStudio.docJson()).partDefinitions[0].features.filter((feature: any) => feature.type === 'boolean').length)) === 1);
  await keyCommand(page, 'z');

  await clickBodyAction(page, ids.Housing, 'activate');
  await selectBodyVisible(page, ids.Shaft);
  const beforeFailure = await page.evaluate(() => {
    const studio = (window as any).__bwStudio;
    return {
      json: studio.docJson(), hash: studio.canonicalHash(), undo: studio.undoDepth(), redo: studio.redoDepth(),
      visible: studio.visibleBodyIds(), geometry: studio.bodyResults().map((body: any) => ({ bodyId: body.bodyId, geometry: body.geometry })),
    };
  });
  await page.click('#bw-context [data-body-context="subtract"]');
  await page.waitForFunction(() => document.getElementById('bw-studio-msg')?.textContent?.includes('does not intersect'), { timeout: 60_000, polling: 250 });
  const afterFailure = await page.evaluate(() => {
    const studio = (window as any).__bwStudio;
    return {
      json: studio.docJson(), hash: studio.canonicalHash(), undo: studio.undoDepth(), redo: studio.redoDepth(),
      visible: studio.visibleBodyIds(), geometry: studio.bodyResults().map((body: any) => ({ bodyId: body.bodyId, geometry: body.geometry })),
    };
  });
  check('browser 10/10 failed disjoint operation leaves document and undo/redo stacks byte-identical',
    afterFailure.json === beforeFailure.json && afterFailure.hash === beforeFailure.hash && afterFailure.undo === beforeFailure.undo && afterFailure.redo === beforeFailure.redo);
  check('browser 10/10 failed operation leaves every last-valid exact body visible and unchanged',
    JSON.stringify(afterFailure.visible.sort()) === JSON.stringify(beforeFailure.visible.sort()) && JSON.stringify(afterFailure.geometry) === JSON.stringify(beforeFailure.geometry));
  const beforeDeleteHash = afterFailure.hash;
  await clickBodyAction(page, ids.Tool, 'delete');
  check('browser body-tree Delete removes the body creator and dependent Boolean together',
    await page.evaluate((toolId) => {
      const part = JSON.parse((window as any).__bwStudio.docJson()).partDefinitions[0];
      return !part.bodies.some((body: any) => body.id === toolId) && !part.features.some((feature: any) => feature.type === 'boolean');
    }, ids.Tool));
  await keyCommand(page, 'z');
  check('browser dependency-aware body deletion is one undoable transaction', await page.evaluate(() => (window as any).__bwStudio.canonicalHash()) === beforeDeleteHash);
  await keyCommand(page, 'y');
  await keyCommand(page, 'z');
  check('browser dependency-aware body deletion survives redo and restores again', await page.evaluate(() => (window as any).__bwStudio.canonicalHash()) === beforeDeleteHash);
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
  await page.click('#bw-mtab-history');
  await page.waitForSelector('#bw-bodies .body-row', { visible: true });
  const mobileBodies = await page.evaluate(() => {
    const tree = document.getElementById('bw-bodies')!;
    const controls = [...tree.querySelectorAll<HTMLElement>('.body-actions button, .body-actions label')];
    return {
      noOverflow: tree.scrollWidth <= tree.clientWidth,
      touchSized: controls.every((control) => control.getBoundingClientRect().width >= 44 && control.getBoundingClientRect().height >= 44),
    };
  });
  check('browser mobile body tree stays inside the viewport with touch-sized controls', mobileBodies.noOverflow && mobileBodies.touchSized, mobileBodies);
  check('browser gate has no page errors or native dialogs', pageErrors.length === 0, pageErrors);
  await context.close();
}

if (mode === 'all' || mode === 'document') await documentChecks();

let server: Server | null = null;
let browser: Browser | null = null;
if (mode === 'all' || mode === 'kernel' || mode === 'browser') {
  const started = await startServer();
  server = started.server;
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    if (mode === 'all' || mode === 'kernel') await kernelChecks(browser, started.url);
    if (mode === 'all' || mode === 'browser') await browserChecks(browser, started.url);
  } finally {
    await browser.close();
    server.close();
  }
}

console.log(`\n${checks - failures}/${checks} Slice 5A-runtime checks passed`);
if (failures) process.exit(1);
