import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import puppeteer, { type Browser, type Page } from 'puppeteer';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { CadCommandService } from '../static/studio-agent-service.js';
import { buildCanonicalTurbofan, TURBOFAN_IDS } from './studio-v5-release-fixtures.ts';
import {
  closeBrowser, closeStudioServer, ensureEvidenceDirectory, openProjectThroughPublicControl,
  percentile, prepareStudioPage, sha256Json, startStudioServer,
} from './studio-v5-evidence-support.ts';

type Result = { name: string; pass: boolean; detail: unknown };
const checks: Result[] = [];
function check(name: string, pass: boolean, detail: unknown): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name} — ${JSON.stringify(detail)}`);
}
const round = (value: number) => Math.round(value * 10) / 10;

async function workerRequest(page: Page, payload: any): Promise<any> {
  return page.evaluate(async (request) => {
    const state = window as any;
    state.__performanceWorker ||= new Worker('/static/studio-kernel.worker.js', { type: 'module' });
    state.__performanceSequence = (state.__performanceSequence || 0) + 1;
    const requestId = `performance-${state.__performanceSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Performance worker timeout')), 180_000);
      const listener = async (event: MessageEvent) => {
        if (event.data?.requestId !== requestId) return;
        clearTimeout(timer); state.__performanceWorker.removeEventListener('message', listener);
        if (event.data.kind === 'kernel-error') reject(new Error(event.data.message));
        else resolve({
          ...event.data, blobSize: event.data.blob?.size || 0,
          triangleCount: (event.data.bodies || []).reduce((sum: number, body: any) => sum + (body.mesh?.triangles?.length || 0) / 3, 0),
          blob: undefined,
        });
      };
      state.__performanceWorker.addEventListener('message', listener);
      state.__performanceWorker.postMessage({ ...request, requestId, projectId: 'project-v5-performance' });
    });
  }, payload);
}

let requestSequence = 0;
async function agentRequest(page: Page, token: string, payload: any, expectedRevision?: number): Promise<any> {
  return page.evaluate(async ({ connectionToken, requestPayload, revision, requestId }) => (window as any).__bwStudio.agentRequestForTest(connectionToken, {
    protocol: 'bomwiki.cad.agent/v1', requestId, sessionId: 'v5-performance',
    ...(Number.isInteger(revision) ? { expectedRevision: revision } : {}), permissionContext: { granted: [] }, payload: requestPayload,
  }), { connectionToken: token, requestPayload: payload, revision: expectedRevision, requestId: `performance-agent-${++requestSequence}` });
}

async function agentEdit(page: Page, token: string, revision: number, operation: any | any[], label: string): Promise<{ previewMs: number; rebuildMs: number; revision: number }> {
  const transaction = { transactionId: `performance-edit-${revision}`, label, expectedRevision: revision, atomic: true, operations: Array.isArray(operation) ? operation : [operation], metadata: { actor: 'agent', clientLabel: 'V5 performance gate' } };
  const previewStart = performance.now();
  const preview = await agentRequest(page, token, { kind: 'preview', transaction });
  const previewMs = performance.now() - previewStart;
  if (preview.status !== 'ok') throw new Error(`Performance preview failed: ${JSON.stringify(preview.diagnostics)}`);
  // Measure visible rebuild time inside the browser. CDP request/response and
  // Node-side waitForFunction polling are automation transport overhead, not
  // user-visible Studio work, and were large enough to make a tight p50 gate
  // depend on the host running Puppeteer.
  const commitRequestId = `performance-agent-${++requestSequence}`;
  const committedResult = await page.evaluate(async ({ connectionToken, previewId, expectedRevision, requestId }) => {
    const studio = (window as any).__bwStudio;
    const appliedBefore = studio.appliedRevision();
    const started = performance.now();
    const committed = await studio.agentRequestForTest(connectionToken, {
      protocol: 'bomwiki.cad.agent/v1', requestId, sessionId: 'v5-performance', expectedRevision,
      permissionContext: { granted: [] }, payload: { kind: 'commit', previewId },
    });
    if (committed.status === 'ok') await new Promise<void>((resolve, reject) => {
      const deadline = performance.now() + 120_000;
      const poll = () => {
        if (studio.mode().kind === 'idle' && studio.appliedRevision() > appliedBefore && studio.commandRevision() === expectedRevision + 1) return resolve();
        if (performance.now() >= deadline) return reject(new Error('Performance rebuild timeout'));
        setTimeout(poll, 4);
      };
      poll();
    });
    return { committed, rebuildMs: performance.now() - started };
  }, { connectionToken: token, previewId: preview.result.previewId, expectedRevision: revision, requestId: commitRequestId });
  const committed = committedResult.committed;
  if (committed.status !== 'ok') throw new Error(`Performance commit failed: ${JSON.stringify(committed.diagnostics)}`);
  return { previewMs, rebuildMs: committedResult.rebuildMs, revision: revision + 1 };
}

let browser: Browser | null = null;
let server: Awaited<ReturnType<typeof startStudioServer>>['server'] | null = null;
const pageErrors: string[] = [];
try {
  const started = await startStudioServer(); server = started.server;
  const browserArgs = [
    '--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  ];
  if (process.env.STUDIO_PERF_FORCE_SOFTWARE_WEBGL === '1') browserArgs.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  browser = await puppeteer.launch({ headless: true, args: browserArgs });
  const context = await browser.createBrowserContext();
  let page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await prepareStudioPage(page, started.url, { width: 1600, height: 1000 });
  const construction = buildCanonicalTurbofan();
  const project = construction.project;

  const coldStart = performance.now();
  const cold = await workerRequest(page, { kind: 'rebuild', revision: 1, document: project });
  const coldMs = performance.now() - coldStart;
  const warmStart = performance.now();
  const warm = await workerRequest(page, { kind: 'rebuild', revision: 2, document: project });
  const warmMs = performance.now() - warmStart;
  check('cold and warm exact turbofan rebuild budgets', coldMs < 20_000 && warmMs < 2_000 && cold.errors.length === 0 && warm.errors.length === 0,
    { coldMs: round(coldMs), warmMs: round(warmMs), bodies: cold.bodies.length, triangles: cold.triangleCount });
  const massStart = performance.now(); const mass = await workerRequest(page, { kind: 'inspect-v5', mode: 'mass', revision: 3, document: project }); const massMs = performance.now() - massStart;
  const interferenceStart = performance.now(); const interference = await workerRequest(page, { kind: 'inspect-v5', mode: 'interference', revision: 4, document: project }); const interferenceMs = performance.now() - interferenceStart;
  const positiveInterferencePairs = (interference.inspection?.pairs || []).filter((pair: any) => pair.interferenceVolumeMm3 > 1e-8);
  check('full mass and interference inspection budgets', massMs < 5_000 && interferenceMs < 10_000 && mass.errors.length === 0 && interference.errors.length === 0
    && positiveInterferencePairs.length === 0,
    { massMs: round(massMs), interferenceMs: round(interferenceMs), pairs: interference.inspection?.pairs?.length || 0,
      positivePairs: positiveInterferencePairs.length,
      candidatePairDetails: (interference.inspection?.pairs || []).map((pair: any) => ({ leftBodyId: pair.leftBodyId, rightBodyId: pair.rightBodyId })),
      positivePairDetails: positiveInterferencePairs.map((pair: any) => ({
        leftBodyId: pair.leftBodyId, rightBodyId: pair.rightBodyId, volumeMm3: round(pair.interferenceVolumeMm3),
      })),
      broadPhasePairs: interference.inspection?.broadPhasePairs, exactPairClasses: interference.inspection?.exactPairClassCount });

  await page.evaluate(() => {
    const state = window as any; state.__countExportFrames = true; state.__exportFrames = 0; state.__exportHeartbeats = 0;
    state.__exportHeartbeatTimer = setInterval(() => { state.__exportHeartbeats++; }, 16);
    const tick = () => { if (!state.__countExportFrames) return; state.__exportFrames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const exportStart = performance.now(); const step = await workerRequest(page, { kind: 'export-step', revision: 5, document: project }); const exportMs = performance.now() - exportStart;
  const exportActivity = await page.evaluate(() => {
    const state = window as any; state.__countExportFrames = false; clearInterval(state.__exportHeartbeatTimer);
    return { frames: state.__exportFrames, heartbeats: state.__exportHeartbeats };
  });
  check('structured STEP export stays inside budget without freezing the UI thread', exportMs < 30_000 && step.errors.length === 0 && step.blobSize > 0
    && Math.max(exportActivity.frames, exportActivity.heartbeats) >= Math.max(2, Math.floor(exportMs / 100)),
    { exportMs: round(exportMs), bytes: step.blobSize, concurrentFramesObserved: exportActivity.frames, concurrentHeartbeatsObserved: exportActivity.heartbeats });
  // The raw-worker phase and visible-Studio phase intentionally use separate
  // workers. Release the first OCC/WASM instance before opening the canonical
  // project in Studio so the browser does not retain two full kernel heaps.
  await page.evaluate(() => {
    const state = window as any;
    state.__performanceWorker?.terminate();
    state.__performanceWorker = null;
  });
  await page.close();
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await prepareStudioPage(page, started.url, { width: 1600, height: 1000 });

  await openProjectThroughPublicControl(page, project, 159, 'turbofan-performance');
  const renderObjectStats = await page.evaluate(() => ({
    exactEdgeSignatures: (window as any).__bwStudio.edges(),
    edgeDrawObjects: (window as any).__bwStudio.edgeDrawObjects(),
    sceneBatchDrawObjects: (window as any).__bwStudio.sceneBatchDrawObjects(),
    sceneBatchBodyCount: (window as any).__bwStudio.sceneBatchBodyCount(),
    sceneInteractiveBatchDrawObjects: (window as any).__bwStudio.sceneInteractiveBatchDrawObjects(),
    sceneInteractiveBodyCount: (window as any).__bwStudio.sceneInteractiveBodyCount(),
    sceneInteractiveTriangleCount: (window as any).__bwStudio.sceneInteractiveTriangleCount(),
    extensionIndependentBatches: (window as any).__bwStudio.sceneBatchesExtensionIndependent(),
  }));
  await page.evaluate(() => (window as any).__bwStudio.beginInteractiveResolutionForTest());
  const orbit = await page.evaluate(async () => {
    const samples: number[] = []; const intervals: number[] = []; let prior = 0;
    const canvas = document.querySelector('#bw-studio canvas') as HTMLCanvasElement;
    if (!canvas) return { response: samples, frames: intervals };
    const sample = () => {
      const moved = performance.now(); (window as any).__bwStudio.frame(); samples.push(performance.now() - moved);
    };
    document.addEventListener('mousemove', sample, { capture: true });
    document.addEventListener('pointermove', sample, { capture: true });
    const frameTimer = setInterval(() => { const now = performance.now(); if (prior) intervals.push(now - prior); prior = now; }, 16);
    const event = (type: string, index: number, buttons: number) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 1, pointerType: 'mouse', buttons,
      clientX: canvas.getBoundingClientRect().left + canvas.clientWidth * (0.55 + index * 0.002),
      clientY: canvas.getBoundingClientRect().top + canvas.clientHeight * (0.52 + Math.sin(index / 5) * 0.035),
    }));
    event('pointerdown', 0, 1);
    for (let index = 0; index < 48; index++) { event('pointermove', index, 1); await new Promise((resolve) => setTimeout(resolve, 5)); }
    event('pointerup', 48, 0); await new Promise((resolve) => setTimeout(resolve, 100)); clearInterval(frameTimer);
    return { response: samples, frames: intervals, resolution: (window as any).__bwStudio.renderResolutionState() };
  });
  check('pointer-to-orbit response and frame budgets with the full fixture visible',
    percentile(orbit.response, 0.95) < 50 && orbit.frames.filter((value: number) => value < 32).length / Math.max(1, orbit.frames.length) >= 0.95
      && renderObjectStats.edgeDrawObjects <= cold.bodies.length && renderObjectStats.exactEdgeSignatures > renderObjectStats.edgeDrawObjects
      && renderObjectStats.sceneBatchDrawObjects <= 12 && renderObjectStats.extensionIndependentBatches
      && renderObjectStats.sceneInteractiveBatchDrawObjects <= 8
      && renderObjectStats.sceneInteractiveBodyCount === renderObjectStats.sceneBatchBodyCount
      && renderObjectStats.sceneInteractiveTriangleCount < cold.triangleCount / 10
      && (!orbit.resolution.softwareWebgl || (orbit.resolution.currentPixelRatio === orbit.resolution.interactivePixelRatio && orbit.resolution.interactionLodActive)),
    { responseP95Ms: round(percentile(orbit.response, 0.95)), frameP95Ms: round(percentile(orbit.frames, 0.95)), samples: orbit.response.length,
      ...renderObjectStats, resolution: orbit.resolution });

  const occurrenceIds = await page.evaluate(() => {
    (window as any).__bwStudio.beginInteractiveResolutionForTest();
    return (window as any).__bwStudio.occurrenceIds().slice(0, 18);
  });
  const treeSamples = await page.evaluate(async (ids) => {
    const samples: number[] = [];
    for (const id of ids) {
      const start = performance.now();
      (document.querySelector(`[data-occurrence-id="${CSS.escape(id)}"] [data-occurrence-action="select"]`) as HTMLElement)?.click();
      await new Promise((resolve) => setTimeout(resolve, 0)); samples.push(performance.now() - start);
    }
    return samples;
  }, occurrenceIds);
  check('tree selection-to-highlight p95 budget', percentile(treeSamples, 0.95) < 100, { p95Ms: round(percentile(treeSamples, 0.95)), samples: treeSamples.length });

  const acknowledgement = await page.evaluate(() => {
    const input = document.querySelector('[data-pval="0"]') as HTMLInputElement;
    const start = performance.now(); input.value = '161'; input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ms: performance.now() - start, mode: (window as any).__bwStudio.mode().kind };
  });
  await page.waitForFunction(() => (window as any).__bwStudio.mode().kind === 'idle', { timeout: 120_000, polling: 25 });
  await page.evaluate(() => { const input = document.querySelector('[data-pval="0"]') as HTMLInputElement; input.value = '160'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => (window as any).__bwStudio.mode().kind === 'idle', { timeout: 120_000, polling: 25 });
  check('numeric field edit acknowledgement budget', acknowledgement.ms < 100 && acknowledgement.mode === 'rebuilding', { acknowledgementMs: round(acknowledgement.ms), mode: acknowledgement.mode });

  await page.evaluate(() => (window as any).__bwStudio.beginInteractiveResolutionForTest());
  const sectionFrames = await page.evaluate(async () => {
    const samples: number[] = []; let prior = performance.now();
    for (let index = 0; index < 72; index++) {
      await new Promise((resolve) => setTimeout(resolve, 16)); const now = performance.now(); samples.push(now - prior); prior = now;
      (window as any).__bwStudio.sectionPlaneOffsetForTest(Math.sin(index / 8) * 8);
      (window as any).__bwStudio.frame();
    }
    (window as any).__bwStudio.sectionPlaneOffsetForTest(0);
    return samples;
  });
  check('GPU section-plane drag frame budget', sectionFrames.filter((value) => value < 32).length / sectionFrames.length >= 0.95,
    { p95Ms: round(percentile(sectionFrames, 0.95)), under32Percent: round(sectionFrames.filter((value) => value < 32).length / sectionFrames.length * 100) });
  await page.evaluate(() => (window as any).__bwStudio.endInteractiveResolutionForTest());

  const direct = new CadCommandService({ project });
  const scope = { granted: ['project.read', 'project.edit'], projectIds: [project.projectId] };
  const matePreviewSamples: number[] = [];
  for (let index = 0; index < 20; index++) {
    const start = performance.now();
    await direct.preview({ transactionId: `mate-preview-${index}`, label: 'Mate preview sample', expectedRevision: 0, atomic: true,
      operations: [{ kind: 'mate.update', input: { mateId: TURBOFAN_IDS.hpcDistanceMate, patch: { value: index % 2 ? 165 : 166 } } }] }, scope);
    matePreviewSamples.push(performance.now() - start);
  }
  check('mate preview median and p95 budgets', percentile(matePreviewSamples, 0.5) < 100 && percentile(matePreviewSamples, 0.95) < 300,
    { medianMs: round(percentile(matePreviewSamples, 0.5)), p95Ms: round(percentile(matePreviewSamples, 0.95)) });

  const connection = await page.evaluate(() => (window as any).__bwStudio.connectAgentForTest({ clientLabel: 'V5 performance gate', permissionContext: { granted: ['project.read', 'project.edit'] } }));
  const token = connection.connectionToken;
  let revision = connection.revision;
  const sourceRebuildSamples: number[] = [];
  const exactPreviewSamples: number[] = [];
  const memorySamples: any[] = [];
  const client = await page.createCDPSession();
  await client.send('Performance.enable');
  for (let index = 0; index < 50; index++) {
    const parameterEdit = index % 2 === 0;
    const sample = await agentEdit(page, token, revision, parameterEdit
      ? { kind: 'parameter.update', input: { parameterId: 'parameter-fan-tip-twist', value: (Math.floor(index / 2) % 2) ? 20 : 21 } }
      : { kind: 'mate.update', input: { mateId: TURBOFAN_IDS.hpcDistanceMate, patch: { value: (Math.floor(index / 2) % 2) ? 165 : 166 } } },
      parameterEdit ? 'Fan source edit sample' : 'Mate edit sample');
    revision = sample.revision; exactPreviewSamples.push(sample.previewMs); if (parameterEdit) sourceRebuildSamples.push(sample.rebuildMs);
    await client.send('HeapProfiler.collectGarbage').catch(() => {});
    const metrics = await client.send('Performance.getMetrics');
    const jsHeapBytes = Number(metrics.metrics.find((entry: any) => entry.name === 'JSHeapUsedSize')?.value || 0);
    const runtimeMemory = await page.evaluate(async () => ({
      kernel: await (window as any).__bwStudio.kernelMemoryForTest(), renderBufferBytes: (window as any).__bwStudio.renderBufferBytes(),
    }));
    memorySamples.push({ iteration: index + 1, jsHeapBytes, ...runtimeMemory, retainedBytes: jsHeapBytes + runtimeMemory.renderBufferBytes + runtimeMemory.kernel.wasmHeapBytes });
  }
  const preRenderedTreeReuses = await page.evaluate(() => (window as any).__bwStudio.preRenderedAssemblyTreeReuseCount());
  check('12-blade source edit visible rebuild median and p95 budgets', percentile(sourceRebuildSamples, 0.5) < 2_000 && percentile(sourceRebuildSamples, 0.95) < 5_000,
    { medianMs: round(percentile(sourceRebuildSamples, 0.5)), p95Ms: round(percentile(sourceRebuildSamples, 0.95)), samples: sourceRebuildSamples.length, preRenderedTreeReuses });
  check('exact feature preview visual-response median and p95 budgets', percentile(exactPreviewSamples, 0.5) < 500 && percentile(exactPreviewSamples, 0.95) < 2_000,
    { medianMs: round(percentile(exactPreviewSamples, 0.5)), p95Ms: round(percentile(exactPreviewSamples, 0.95)), samples: exactPreviewSamples.length });
  const preceding = memorySamples.slice(30, 40); const final = memorySamples.slice(40, 50);
  const mean = (values: any[]) => values.reduce((sum, entry) => sum + entry.retainedBytes, 0) / values.length;
  check('50-edit retained worker heap plus live mesh window remains within ten percent after warm-up', mean(final) <= mean(preceding) * 1.1,
    { precedingMeanBytes: Math.round(mean(preceding)), finalMeanBytes: Math.round(mean(final)), ratio: round(mean(final) / mean(preceding)), final: final.map((entry) => ({ iteration: entry.iteration, retainedBytes: entry.retainedBytes, wasmHeapBytes: entry.kernel.wasmHeapBytes, shapes: entry.kernel.retainedShapeEntries, renderBufferBytes: entry.renderBufferBytes })) });

  const nacelle = await agentEdit(page, token, revision, { kind: 'parameter.update', input: { parameterId: 'parameter-nacelle-wall', value: 4 } }, 'Early nacelle dependent edit');
  revision = nacelle.revision;
  check('early nacelle dependent edit p95 ceiling', nacelle.rebuildMs < 10_000, { rebuildMs: round(nacelle.rebuildMs), previewMs: round(nacelle.previewMs) });

  // Direct manipulation is intentionally unavailable while a component is
  // driven by active mates. Release the HPC row through the same public,
  // atomic agent transaction a user-facing command uses, then measure the
  // actual 3D manipulator preview without weakening the constraint policy.
  const releasedHpc = await agentEdit(page, token, revision, ['concentric', 'distance', 'angle'].map((kind) => ({
    kind: 'mate.update', input: { mateId: `mate-${TURBOFAN_IDS.hpcOccurrence}-${kind}`, patch: { suppressed: true } },
  })), 'Release HPC row for direct manipulation');
  revision = releasedHpc.revision;
  await page.evaluate((connectionToken) => (window as any).__bwStudio.disconnectAgentForTest(connectionToken), token);

  const transformOccurrenceId = TURBOFAN_IDS.hpcOccurrence;
  const transformOpened = await page.evaluate((id) => (window as any).__bwStudio.openAssemblyTransformForTest(id), transformOccurrenceId);
  if (!transformOpened) throw new Error('Assembly transform manipulator did not open for the canonical HPC occurrence.');
  const transformSamples = await page.evaluate(() => {
    const samples: number[] = [];
    for (let index = 0; index < 30; index++) { const start = performance.now(); (window as any).__bwStudio.gizmoTranslateForTest([index % 2, 0, 0]); (window as any).__bwStudio.frame(); samples.push(performance.now() - start); }
    return samples;
  });
  check('transform manipulator coarse-preview budget', percentile(transformSamples, 0.95) < 100, { p95Ms: round(percentile(transformSamples, 0.95)), samples: transformSamples.length });
  await page.evaluate(() => (document.querySelector('#bw-v5-command-cancel') as HTMLButtonElement)?.click());

  const finalResolution = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return (window as any).__bwStudio.renderResolutionState();
  });
  check('performance scenario restores idle-quality resolution and produced no page errors',
    pageErrors.length === 0 && finalResolution.currentPixelRatio === finalResolution.fullPixelRatio,
    { pageErrors, resolution: finalResolution });
  const failures = checks.filter((entry) => !entry.pass);
  const output = ensureEvidenceDirectory('performance');
  const manifest = {
    gate: 'v5-performance', status: failures.length ? 'failed' : 'pass', projectId: project.projectId,
    projectHash: sha256Json(project), browser: await browser.version(), checks, memorySamples, pageErrors,
  };
  const path = join(output, 'performance-manifest.json');
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n${checks.length - failures.length}/${checks.length} performance checks passed`);
  console.log(path);
  if (failures.length) process.exitCode = 1;
  await context.close();
} finally {
  await closeBrowser(browser);
  await closeStudioServer(server);
}
