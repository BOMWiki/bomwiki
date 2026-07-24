import { createServer, type Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
import { startStudioLoopbackBridge } from './studio-agent-loopback.ts';
import { buildRobotJointFixture } from './studio-v5-release-fixtures.ts';
import { addOriginDatums, DATUM_IDS } from './studio-v5-datums-fixture.ts';
import { createThreeBodyRuntimeProject, RUNTIME_BODY_IDS, RUNTIME_FEATURE_IDS } from './studio-v5-runtime-fixture.ts';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { createStudioV5AxialStageGroup, createStudioV5ExplodedView, createStudioV5Measurement } from '../static/studio-v5-inspection.js';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { configureStudioV5Feature, createStudioV5AssemblyMate, createStudioV5BodyPattern, createStudioV5Datum, createStudioV5PathSketch, createStudioV5ProfileSketch, enterStudioV5AssemblyContext, migrateStudioDocumentToV5 } from '../static/studio-v5-runtime-document.js';
import { createEmptyStudioV5PartProject } from '../static/studio-project-v5.js';

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

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

async function renderedCanvasDigest(page: Page): Promise<{ hash: string; nonzero: number }> {
  return page.evaluate(() =>
    (window as any).__bwStudio?.frameDigestForTest?.() || { hash: '', nonzero: 0 });
}

async function sketchCanvasDigest(page: Page): Promise<{ hash: string; nonzero: number }> {
  return page.evaluate(() => {
    const canvas = document.getElementById('bw-sketch-canvas') as HTMLCanvasElement | null;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context || !canvas.width || !canvas.height) return { hash: '', nonzero: 0 };
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    let nonzero = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const sample = pixels[index] ^ pixels[index + 1] ^ pixels[index + 2] ^ pixels[index + 3];
      if (sample) nonzero++;
      hash ^= sample;
      hash = Math.imul(hash, 16777619);
    }
    return { hash: (hash >>> 0).toString(16).padStart(8, '0'), nonzero };
  });
}

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');
const MIME: Record<string, string> = {
  '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
};

async function startServer(): Promise<{ server: Server; url: string }> {
  const html = cadStudioPage();
  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    if (path.startsWith('/static/')) {
      const file = join(staticDir, path.slice('/static/'.length));
      if (existsSync(file)) {
        response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        response.end(readFileSync(file));
        return;
      }
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/cad/studio` };
}

async function approveVisibleConnectionAsHuman(page: Page, clientLabel = 'V6 observer agent') {
  await page.waitForFunction((label) => [...document.querySelectorAll('.ws-agent-pair[open] h2')]
    .some((heading) => (heading.textContent || '').includes(label)), { polling: 50, timeout: 10_000 }, clientLabel);
  return page.evaluate((label) => {
    const dialog = [...document.querySelectorAll<HTMLDialogElement>('.ws-agent-pair[open]')]
      .find((candidate) => (candidate.querySelector('h2')?.textContent || '').includes(label));
    const button = dialog?.querySelector<HTMLButtonElement>('button[value="approve"]');
    if (!dialog || !button) throw new Error('Visible agent approval is missing.');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    const describedBy = dialog.getAttribute('aria-describedby');
    const accessibility = {
      labelled: Boolean(labelledBy && dialog.querySelector(`#${CSS.escape(labelledBy)}`)),
      described: Boolean(describedBy && dialog.querySelector(`#${CSS.escape(describedBy)}`)),
      focusInside: dialog.contains(document.activeElement),
      controls: [...dialog.querySelectorAll<HTMLElement>('[data-v6-control-id]')]
        .map((control) => control.dataset.v6ControlId)
        .sort(),
    };
    dialog.close(button.value);
    dialog.dispatchEvent(new Event('close'));
    return accessibility;
  }, clientLabel);
}

async function approveConnectionAsHuman(page: Page, clientLabel = 'V6 observer agent') {
  await page.evaluate(() => {
    (document.getElementById('bw-help-open') as HTMLButtonElement | null)?.click();
    (document.getElementById('bw-help-agent') as HTMLButtonElement | null)?.click();
  });
  return approveVisibleConnectionAsHuman(page, clientLabel);
}

async function approveAgentPreviewAsHuman(page: Page, expectedLabel: string) {
  await page.waitForFunction(() => [...document.querySelectorAll('.ws-agent-pair[open]')]
    .some((dialog) => /AGENT PREVIEW/.test(dialog.textContent || '')), { polling: 50, timeout: 10_000 });
  return page.evaluate((label) => {
    const dialog = [...document.querySelectorAll<HTMLDialogElement>('.ws-agent-pair[open]')]
      .find((candidate) => /AGENT PREVIEW/.test(candidate.textContent || ''));
    if (!dialog) throw new Error('Visible agent preview approval is missing.');
    const visible = /Apply this CAD change/.test(dialog.textContent || '') &&
      (dialog.textContent || '').includes(label) &&
      Boolean(dialog.getAttribute('aria-labelledby')) &&
      Boolean(dialog.getAttribute('aria-describedby')) &&
      dialog.contains(document.activeElement) &&
      dialog.querySelector('[data-v6-control-id="app.agent.preview-reject"]') instanceof HTMLButtonElement &&
      dialog.querySelector('[data-v6-control-id="app.agent.preview-approve"]') instanceof HTMLButtonElement;
    dialog.close('approve');
    dialog.dispatchEvent(new Event('close'));
    return visible;
  }, expectedLabel);
}

async function toggleAgentPauseAsHuman(page: Page): Promise<void> {
  await page.evaluate(() => (document.getElementById('bw-agent-activity') as HTMLButtonElement | null)?.click());
  await page.waitForSelector('.ws-agent-pair[open] button[value="pause"]');
  await page.evaluate(() => {
    const dialog = [...document.querySelectorAll<HTMLDialogElement>('.ws-agent-pair[open]')]
      .find((candidate) => candidate.querySelector('button[value="pause"]'));
    if (!dialog) throw new Error('Agent activity dialog is missing.');
    dialog.close('pause');
    dialog.dispatchEvent(new Event('close'));
  });
}

async function changeDisplayModeAsHuman(page: Page, mode: 'shaded' | 'shaded-edges' | 'wireframe'): Promise<void> {
  await page.evaluate((displayMode) => {
    const control = document.querySelector<HTMLButtonElement>(`[data-display-mode="${displayMode}"]`);
    if (!control) throw new Error(`The normal ${displayMode} display control is missing.`);
    control.click();
  }, mode);
}

async function checks(browser: Browser, url: string) {
  console.log('\nCAD Studio V6 semantic UI with explicit human interventions');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('requestfailed', (request) => requestFailures.push(request.url() + ': ' + request.failure()?.errorText));
  let robotFixture = createStudioV5Measurement(buildRobotJointFixture().project, {
    id: 'measurement-robot-shaft-envelope',
    name: 'Robot shaft envelope',
    kind: 'bounding-box',
    definition: { bodyIds: ['occurrence-robot-shaft:body-feature-robot-shaft-body'] },
  });
  robotFixture = createStudioV5ExplodedView(robotFixture, {
    id: 'explode-robot-joint',
    name: 'Robot joint service view',
    steps: [
      { occurrenceIds: ['occurrence-robot-motor'], translation: [0, 0, -28] },
      { occurrenceIds: ['occurrence-robot-cover'], translation: [0, 0, 22] },
    ],
  });
  for (const [occurrenceId, prefix, station] of [
    ['occurrence-robot-bearing', 'robot-bearing', 18],
    ['occurrence-robot-motor', 'robot-motor', -32],
  ] as const) {
    robotFixture = createStudioV5AssemblyMate(robotFixture, {
      id: `mate-${occurrenceId}-distance`,
      name: `${occurrenceId} axial station`,
      kind: 'distance',
      value: station,
      occurrenceIds: ['occurrence-robot-shaft', occurrenceId],
      references: [
        {
          ownerKind: 'datum',
          ownerId: 'datum-robot-shaft-station',
          occurrencePath: ['occurrence-robot-shaft'],
          semanticPath: { role: 'anchor' },
          signature: { role: 'anchor' },
        },
        {
          ownerKind: 'datum',
          ownerId: `datum-${prefix}-station`,
          occurrencePath: [occurrenceId],
          semanticPath: { role: 'moving' },
          signature: { role: 'moving' },
        },
      ],
    });
  }
  const robotAssembly = robotFixture.assemblyDefinitions
    .find((entry: any) => entry.id === robotFixture.rootDocument.assemblyId);
  const movableCover = robotAssembly?.occurrences
    .find((entry: any) => entry.id === 'occurrence-robot-cover');
  for (const occurrence of robotAssembly?.occurrences || []) occurrence.fixed = false;
  const coverPart = robotFixture.partDefinitions.find((entry: any) => entry.id === movableCover?.definition?.partId);
  if (coverPart) coverPart.parameters = [{
    id: 'parameter-robot-cover-clearance',
    name: 'clearance',
    value: 0.2,
    description: 'Visible-command variant regression parameter',
  }];
  await page.evaluateOnNewDocument((fixture) => {
    (window as any).__studioBootErrors = [];
    window.addEventListener('error', (event) => (window as any).__studioBootErrors.push(String(event.error || event.message)));
    window.addEventListener('unhandledrejection', (event) =>
      (window as any).__studioBootErrors.push(String(event.reason?.stack || event.reason)));
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(fixture));
  }, robotFixture);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await page.evaluate(() => document.getElementById('bw-studio')?.scrollIntoView({ block: 'center' }));
  try {
    await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  } catch (error) {
    const boot = await page.evaluate(() => ({
      readyState: document.readyState,
      title: document.title,
      agentType: typeof (window as any).bomwikiCadAgent,
      agentDescriptor: Object.getOwnPropertyDescriptor(window, 'bomwikiCadAgent'),
      scripts: [...document.scripts].map((entry) => entry.src || 'inline'),
      resources: performance.getEntriesByType('resource').map((entry) => ({
        name: entry.name,
        duration: Math.round(entry.duration),
      })),
      bootErrors: (window as any).__studioBootErrors,
    }));
    throw new Error('Studio agent boot failed: ' + JSON.stringify({ pageErrors, requestFailures, boot, cause: String(error) }));
  }
  const bridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 observer agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: [
        'project.read', 'project.edit', 'project.recover',
        'artifact.render', 'artifact.export-project', 'artifact.export-step', 'artifact.export-stl', 'artifact.export-narration',
        'ui.read', 'ui.select', 'ui.navigate',
        'ui.command-draft', 'ui.present-preview', 'ui.present-demo', 'ui.present-narration', 'ui.wait-events',
      ],
    },
  });
  const approvalAccessibility = await approveConnectionAsHuman(page);
  for (let attempt = 0; attempt < 600 && bridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await page.bringToFront();
  const connectedStatus: any = bridge.status();
  check('one visible human approval grants the bounded V6 UI scopes',
    connectedStatus.state === 'connected' &&
    connectedStatus.permissionContext?.granted?.includes('project.recover') &&
    connectedStatus.permissionContext?.granted?.includes('ui.select') &&
    connectedStatus.permissionContext?.granted?.includes('ui.navigate') &&
    connectedStatus.permissionContext?.granted?.includes('ui.command-draft') &&
    connectedStatus.permissionContext?.granted?.includes('ui.present-preview') &&
    connectedStatus.permissionContext?.granted?.includes('ui.present-demo') &&
    connectedStatus.permissionContext?.granted?.includes('ui.present-narration') &&
    connectedStatus.permissionContext?.granted?.includes('ui.wait-events') &&
    connectedStatus.skillVersion === '0.4.0' &&
    connectedStatus.capabilities?.studioVersion === '6.0.0-i4' &&
    connectedStatus.capabilities?.exports?.some((entry: any) => entry.format === 'png' && entry.state === 'available'),
    connectedStatus);
  check('visible connection approval is named, described, and keyboard-focused',
    approvalAccessibility.labelled &&
    approvalAccessibility.described &&
    approvalAccessibility.focusInside &&
    approvalAccessibility.controls?.join(',') === 'app.agent.connection-approve,app.agent.connection-deny',
    approvalAccessibility);

  // Agent boundary: after approval, every agent-authored Studio action below
  // goes through a loopback CAD tool. Puppeteer reads visible state except for
  // the explicitly labelled human conflict, approval, pause, and control steps.
  const uiManifest: any = await bridge.request('cad_ui', { action: 'capabilities', detail: 'full' });
  check('live Studio publishes the versioned semantic UI manifest',
    uiManifest.profile === 'bomwiki.cad.agentic-ui/v1' &&
    uiManifest.studioVersion === '6.0.0-i4' &&
    uiManifest.actions.some((entry: any) => entry.id === 'tree.reveal') &&
    uiManifest.actions.some((entry: any) => entry.id === 'panel.open' && entry.state === 'available') &&
    uiManifest.actions.some((entry: any) => entry.id === 'viewport.fitSelection' && entry.state === 'available') &&
    uiManifest.actions.some((entry: any) => entry.id === 'command.open' && entry.state === 'available') &&
    uiManifest.actions.some((entry: any) => entry.id === 'control.invoke' && entry.state === 'available') &&
    uiManifest.actions.some((entry: any) => entry.id === 'template.select' && entry.state === 'available') &&
    uiManifest.actions.some((entry: any) => entry.id === 'recovery.open' && entry.state === 'available') &&
    uiManifest.actions.some((entry: any) => entry.id === 'tree.invoke' && entry.state === 'available') &&
    uiManifest.actions.some((entry: any) => entry.id === 'inspector.invoke' && entry.state === 'available') &&
    uiManifest.controls.some((entry: any) => entry.id === 'tree.assembly.occurrence.select' && entry.state === 'available' && entry.operation === 'occurrence.select') &&
    uiManifest.controls.some((entry: any) => entry.id === 'inspector.context.occurrence.isolate' && entry.state === 'available' && entry.operation === 'occurrence.isolate') &&
    uiManifest.commands.some((entry: any) => entry.id === 'assembly.component-transform' && entry.state === 'available') &&
    uiManifest.subshapeSelection.join(',') === 'face,edge,vertex' &&
    uiManifest.transitionCapabilities.some((entry: any) => entry.id === 'animate' && entry.state === 'available') &&
    uiManifest.events.includes('render.completed') &&
    /^fnv1a32:/.test(uiManifest.manifestHash));
  let initial: any = await bridge.request('cad_ui', { action: 'snapshot' });
  if (initial.viewport.renderState !== 'idle') {
    const readiness: any = await bridge.request('cad_ui', {
      action: 'apply',
      expectedUiRevision: initial.uiRevision,
      correlationId: 'observer-render-readiness',
      actions: [{ kind: 'presentation.waitForSettled', correlationId: 'observer-render-readiness' }],
      presentation: { mode: 'instant', transition: 'cut' },
    });
    initial = readiness.snapshot;
  }
  const tree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', pageSize: 100 } });
  const shaftOccurrence = tree.result.items.find((entry: any) => entry.kind === 'occurrence' && entry.id === 'occurrence-robot-shaft');
  check('agent discovers a stable assembly occurrence without reading the DOM',
    Number.isInteger(initial.uiRevision) &&
    initial.documentRevision === tree.revision &&
    initial.workspaceId === 'assembly' &&
    initial.activeDocument.kind === 'assembly' &&
    Array.isArray(initial.selection) &&
    Array.isArray(initial.panels) &&
    initial.viewport.renderState === 'idle' &&
    shaftOccurrence?.id === 'occurrence-robot-shaft', { initial, shaftOccurrence });

  const capabilityTimes: number[] = [];
  const snapshotTimes: number[] = [];
  for (let index = 0; index < 20; index++) {
    let started = performance.now();
    await bridge.request('cad_ui', { action: 'capabilities', detail: 'summary' });
    capabilityTimes.push(performance.now() - started);
    started = performance.now();
    await bridge.request('cad_ui', { action: 'snapshot' });
    snapshotTimes.push(performance.now() - started);
  }
  const livePerformance = {
    capabilityP95Ms: Math.round(percentile(capabilityTimes, 0.95) * 100) / 100,
    snapshotP95Ms: Math.round(percentile(snapshotTimes, 0.95) * 100) / 100,
  };
  console.log('  EVIDENCE live-loopback-performance', JSON.stringify(livePerformance));
  check('live loopback capability and snapshot p95 meet the 100 ms I0 budgets',
    livePerformance.capabilityP95Ms < 100 && livePerformance.snapshotP95Ms < 100, livePerformance);

  console.log('\nCAD Studio V6 normal application surfaces');
  const helpOpened: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: initial.uiRevision,
    correlationId: 'observer-open-help',
    actions: [{ kind: 'control.invoke', controlId: 'app.help' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const templatesOperated: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: helpOpened.uiRevision,
    correlationId: 'observer-template-library',
    actions: [
      { kind: 'control.invoke', controlId: 'help.templates' },
      { kind: 'template.filter', category: 'Basics' },
      { kind: 'control.setValue', controlId: 'template.search', value: 'Starter' },
      { kind: 'template.select', templateId: 'starter-plate' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const visibleTemplateSurface = await page.evaluate(() => {
    const help = document.getElementById('bw-help') as HTMLDialogElement | null;
    const templates = document.getElementById('bw-templates') as HTMLDialogElement | null;
    const selected = document.querySelector<HTMLElement>('.ws-template-card[aria-selected="true"]');
    const search = document.getElementById('bw-template-search') as HTMLInputElement | null;
    return {
      helpOpen: Boolean(help?.open),
      templatesOpen: Boolean(templates?.open),
      selectedTemplateId: selected?.dataset.templateId,
      search: search?.value,
    };
  });
  check('direct semantic surface calls visibly open Help and operate the normal template library',
    helpOpened.snapshot.surfaces.help.open === true &&
    templatesOperated.snapshot.surfaces.help.open === false &&
    templatesOperated.snapshot.surfaces.templates.open === true &&
    templatesOperated.snapshot.surfaces.templates.category === 'Basics' &&
    templatesOperated.snapshot.surfaces.templates.search === 'Starter' &&
    templatesOperated.snapshot.surfaces.templates.selectedTemplateId === 'starter-plate' &&
    visibleTemplateSurface.helpOpen === false &&
    visibleTemplateSurface.templatesOpen === true &&
    visibleTemplateSurface.selectedTemplateId === 'starter-plate' &&
    visibleTemplateSurface.search === 'Starter',
    { helpOpened: helpOpened.snapshot.surfaces, templatesOperated: templatesOperated.snapshot.surfaces, visibleTemplateSurface });

  const recoveryOpened: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: templatesOperated.uiRevision,
    correlationId: 'observer-recovery-surface',
    actions: [
      { kind: 'control.invoke', controlId: 'dialog.template.close' },
      { kind: 'recovery.open' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const recoveryClosed: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: recoveryOpened.uiRevision,
    correlationId: 'observer-recovery-close',
    actions: [{ kind: 'control.invoke', controlId: 'dialog.recovery.close' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  check('local recovery opens and closes through the normal visible recovery controller',
    recoveryOpened.snapshot.surfaces.templates.open === false &&
    recoveryOpened.snapshot.surfaces.recovery.open === true &&
    Array.isArray(recoveryOpened.snapshot.surfaces.recovery.entryIds) &&
    recoveryClosed.snapshot.surfaces.recovery.open === false,
    { opened: recoveryOpened.snapshot.surfaces, closed: recoveryClosed.snapshot.surfaces });

  const tourOperated: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: recoveryClosed.uiRevision,
    correlationId: 'observer-tour-surface',
    actions: [
      { kind: 'control.invoke', controlId: 'app.help' },
      { kind: 'control.invoke', controlId: 'help.tour' },
      { kind: 'control.invoke', controlId: 'dialog.tour.next' },
      { kind: 'control.invoke', controlId: 'dialog.tour.back' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const tourClosed: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: tourOperated.uiRevision,
    correlationId: 'observer-tour-close',
    actions: [{ kind: 'control.invoke', controlId: 'dialog.tour.skip' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  check('guided-tour controls use the real visible tour state machine',
    tourOperated.snapshot.surfaces.help.open === false &&
    tourOperated.snapshot.surfaces.tour.open === true &&
    tourOperated.snapshot.surfaces.tour.index === 0 &&
    tourOperated.snapshot.surfaces.tour.count > 1 &&
    tourClosed.snapshot.surfaces.tour.open === false,
    { operated: tourOperated.snapshot.surfaces, closed: tourClosed.snapshot.surfaces });
  const clearOpened: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: tourClosed.uiRevision,
    correlationId: 'observer-clear-surface',
    actions: [{ kind: 'control.invoke', controlId: 'project.clear' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const clearClosed: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: clearOpened.uiRevision,
    correlationId: 'observer-clear-cancel',
    actions: [{ kind: 'control.invoke', controlId: 'dialog.clear.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const visibleClearSurface = await page.evaluate(() => ({
    open: Boolean((document.getElementById('bw-clear-decision') as HTMLDialogElement | null)?.open),
    text: document.getElementById('bw-clear-decision')?.textContent,
  }));
  check('direct semantic control opens and cancels the normal destructive Clear decision without editing',
    clearOpened.snapshot.surfaces.clear.open === true &&
    clearOpened.snapshot.documentRevision === tourClosed.snapshot.documentRevision &&
    clearClosed.snapshot.surfaces.clear.open === false &&
    clearClosed.snapshot.documentRevision === tourClosed.snapshot.documentRevision &&
    visibleClearSurface.open === false &&
    /clear this part/i.test(visibleClearSurface.text || ''),
    { opened: clearOpened.snapshot.surfaces, closed: clearClosed.snapshot.surfaces, visibleClearSurface });
  const dynamicAssemblyActions: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: clearClosed.uiRevision,
    correlationId: 'observer-dynamic-assembly-actions',
    actions: [
      { kind: 'tree.invoke', entity: { kind: 'occurrence', id: 'occurrence-robot-shaft' }, operation: 'occurrence.expand' },
      { kind: 'tree.invoke', entity: { kind: 'occurrence', id: 'occurrence-robot-shaft' }, operation: 'occurrence.select' },
      { kind: 'tree.invoke', entity: { kind: 'occurrence', id: 'occurrence-robot-shaft' }, operation: 'occurrence.export' },
      { kind: 'tree.invoke', entity: { kind: 'mate', id: 'mate-occurrence-robot-bearing-distance' }, operation: 'mate.select' },
      { kind: 'tree.invoke', entity: { kind: 'occurrence', id: 'occurrence-robot-shaft' }, operation: 'occurrence.select' },
      { kind: 'inspector.invoke', operation: 'occurrence.isolate' },
      { kind: 'inspector.invoke', operation: 'occurrence.export' },
      { kind: 'inspector.invoke', operation: 'occurrence.isolate' },
      { kind: 'tree.invoke', entity: { kind: 'measurement', id: 'measurement-robot-shaft-envelope' }, operation: 'measurement.evaluate' },
      { kind: 'inspector.invoke', operation: 'inspection.clear' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const visibleDynamicAssembly = await page.evaluate(() => ({
    occurrenceExpanded: document.querySelector('[data-occurrence-id="occurrence-robot-shaft"]')?.getAttribute('aria-expanded'),
    occurrenceSelected: document.querySelector('[data-occurrence-id="occurrence-robot-shaft"]')?.getAttribute('aria-selected'),
    occurrenceExport: (document.querySelector('[data-occurrence-export="occurrence-robot-shaft"]') as HTMLInputElement | null)?.checked,
    inspectionKind: document.getElementById('bw-inspector-kind')?.textContent,
  }));
  const dynamicResult = (kind: string, operation: string) => dynamicAssemblyActions.results
    .find((entry: any) => entry.kind === kind && entry.result?.operation === operation)?.result;
  check('dynamic assembly tree and inspector actions visibly select, collapse, isolate, export, evaluate, and clear without a document edit',
    dynamicAssemblyActions.snapshot.documentRevision === clearClosed.snapshot.documentRevision &&
    dynamicAssemblyActions.snapshot.selection.some((entry: any) => entry.kind === 'occurrence' && entry.id === 'occurrence-robot-shaft') &&
    dynamicAssemblyActions.snapshot.tree.expanded.every((entry: any) => entry.id !== 'occurrence-robot-shaft') &&
    dynamicAssemblyActions.snapshot.tree.exportBodyIds.some((bodyId: string) => bodyId.startsWith('occurrence-robot-shaft:')) &&
    !dynamicAssemblyActions.snapshot.viewport.isolatedOccurrenceId &&
    dynamicAssemblyActions.snapshot.inspection === null &&
    dynamicResult('tree.invoke', 'occurrence.expand')?.expanded === false &&
    dynamicResult('tree.invoke', 'mate.select')?.selection?.[0]?.kind === 'mate' &&
    dynamicResult('tree.invoke', 'measurement.evaluate')?.exactGeometry === true &&
    dynamicResult('inspector.invoke', 'inspection.clear')?.inspection === null &&
    visibleDynamicAssembly.occurrenceExpanded === 'false' &&
    visibleDynamicAssembly.occurrenceSelected === 'true' &&
    visibleDynamicAssembly.occurrenceExport === true &&
    !/results/i.test(visibleDynamicAssembly.inspectionKind || ''),
    { snapshot: dynamicAssemblyActions.snapshot, results: dynamicAssemblyActions.results, visibleDynamicAssembly });
  const dynamicAssemblyCleaned: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: dynamicAssemblyActions.uiRevision,
    correlationId: 'observer-dynamic-assembly-cleanup',
    actions: [
      { kind: 'tree.invoke', entity: { kind: 'occurrence', id: 'occurrence-robot-shaft' }, operation: 'occurrence.export' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  initial = dynamicAssemblyCleaned.snapshot;

  const applied: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: initial.uiRevision,
    correlationId: 'observer-semantic-sequence',
    actions: [
      { kind: 'narration.setMode', mode: 'detailed' },
      { kind: 'document.activate', documentId: initial.activeDocument.id },
      { kind: 'workspace.activate', workspaceId: 'assembly' },
      { kind: 'tree.reveal', entity: { kind: 'occurrence', id: shaftOccurrence.id } },
      { kind: 'selection.set', entity: { kind: 'occurrence', id: shaftOccurrence.id } },
      { kind: 'inspector.showEntity', entity: { kind: 'occurrence', id: shaftOccurrence.id } },
      { kind: 'viewport.fitSelection' },
    ],
    presentation: { mode: 'normal', transition: 'animate' },
  });
  check('direct semantic actions settle as one revisioned UI batch without a document edit',
    applied.uiRevision === initial.uiRevision + 1 &&
    applied.snapshot.documentRevision === initial.documentRevision &&
    applied.snapshot.workspaceId === 'assembly' &&
    applied.snapshot.selection[0].id === shaftOccurrence.id &&
    applied.snapshot.viewport.viewId === 'fit-selection' &&
    applied.snapshot.viewport.framedEntities.some((entry: any) => entry.id === shaftOccurrence.id) &&
    applied.snapshot.viewport.framedBounds?.size?.every((entry: number) => entry >= 0) &&
    applied.snapshot.viewport.renderedUiRevision === applied.uiRevision &&
    applied.snapshot.presentation.state === 'idle');

  const visible = await page.evaluate((occurrenceId) => {
    const workspace = document.querySelector('[data-workspace="assembly"]');
    const occurrenceRow = [...document.querySelectorAll<HTMLElement>('[data-occurrence-id], [data-runtime-occurrence-id]')]
      .find((row) => (row.dataset.occurrenceId || row.dataset.runtimeOccurrenceId) === occurrenceId);
    const app = document.querySelector<HTMLElement>('.cadstudio-app');
    const inspector = document.getElementById('bw-context-wrap') as HTMLElement | null;
    const narration = document.getElementById('bw-agent-narration') as HTMLElement | null;
    return {
      workspaceSelected: workspace?.getAttribute('aria-selected'),
      occurrenceSelected: occurrenceRow?.classList.contains('is-selected'),
      occurrenceRevealed: occurrenceRow?.classList.contains('is-agent-revealed'),
      revealedEntity: app?.dataset.agentRevealedEntity,
      inspectorVisible: inspector ? !inspector.hidden : false,
      inspectorText: inspector?.textContent,
      narrationVisible: narration ? !narration.hidden : false,
      narrationText: narration?.textContent,
      narrationCorrelation: narration?.dataset.correlationId,
    };
  }, shaftOccurrence.id);
  check('observer sees the requested workspace, selection, tree reveal, inspector, and narration',
    visible.workspaceSelected === 'true' &&
    visible.occurrenceSelected === true &&
    visible.occurrenceRevealed === true &&
    visible.revealedEntity === shaftOccurrence.id &&
    visible.inspectorVisible === true &&
    (visible.inspectorText || '').includes(shaftOccurrence.id) &&
    visible.narrationVisible === true &&
    /selection/.test(visible.narrationText || '') &&
    visible.narrationCorrelation === 'observer-semantic-sequence',
    visible);

  const events: any = await bridge.request('cad_events', { afterCursor: 0, limit: 1000 });
  check('agent receives correlated structured action and subtitle settlement events',
    events.events.some((entry: any) => entry.kind === 'ui.changed' && entry.uiRevision === applied.uiRevision) &&
    events.events.some((entry: any) => entry.kind === 'render.completed' && entry.payload.settlement?.renderedUiRevision === applied.uiRevision) &&
    events.events.some((entry: any) => entry.kind === 'narration.cueStarted' && entry.correlationId === 'observer-semantic-sequence') &&
    events.events.some((entry: any) => entry.kind === 'presentation.stepSettled' && entry.payload.settlement?.renderState === 'idle'));

  console.log('\nCAD Studio V6 full I2 visible control');
  const topologyFaces: any = await bridge.request('cad_query', {
    query: { kind: 'geometry.topology', topologyKind: 'face', limit: 1000 },
  });
  const faceRef = topologyFaces.result.items.find((entry: any) => entry.owner?.kind === 'body');
  const topologyEdges: any = await bridge.request('cad_query', {
    query: { kind: 'geometry.topology', topologyKind: 'edge', bodyId: faceRef?.owner?.id, limit: 1000 },
  });
  const topologyVertices: any = await bridge.request('cad_query', {
    query: { kind: 'geometry.topology', topologyKind: 'vertex', bodyId: faceRef?.owner?.id, limit: 1000 },
  });
  const edgeRef = topologyEdges.result.items[0];
  const vertexRef = topologyVertices.result.items[0];
  check('agent discovers exact face, edge, and vertex refs through CAD query only',
    topologyFaces.result.exactGeometry === true &&
    faceRef?.topologySignature?.kind === 'face' &&
    edgeRef?.topologySignature?.kind === 'edge' &&
    vertexRef?.topologySignature?.kind === 'vertex' &&
    [faceRef, edgeRef, vertexRef].every((entry: any) => entry.owner.id === faceRef.owner.id),
    { faceRef, edgeRef, vertexRef });

  const beforeI2Image = await renderedCanvasDigest(page);
  const i2Applied: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: applied.uiRevision,
    correlationId: 'observer-full-i2',
    actions: [
      { kind: 'selection.set', entity: faceRef },
      { kind: 'selection.add', entity: edgeRef },
      { kind: 'selection.add', entity: vertexRef },
      { kind: 'tree.collapse', entity: { kind: 'occurrence', id: shaftOccurrence.id } },
      { kind: 'tree.expand', entity: { kind: 'occurrence', id: shaftOccurrence.id } },
      { kind: 'panel.close', panelId: 'model-tree' },
      { kind: 'panel.open', panelId: 'model-tree' },
      { kind: 'panel.close', panelId: 'inspector' },
      { kind: 'panel.open', panelId: 'inspector' },
      { kind: 'viewport.setDisplayMode', displayModeId: 'ghost' },
      { kind: 'viewport.setNavigationMode', navigationMode: 'pan' },
      { kind: 'viewport.setNavigationMode', navigationMode: 'orbit' },
      { kind: 'viewport.clearInspectionView' },
      { kind: 'viewport.activateSection', sectionId: 'section-robot-joint' },
      { kind: 'viewport.activateExplodedView', explodedViewId: 'explode-robot-joint' },
      {
        kind: 'viewport.setCamera',
        camera: { position: [128, 92, 118], target: [8, 0, 12], up: [0, 1, 0], projection: 'perspective' },
      },
      { kind: 'viewport.fitSelection' },
      { kind: 'history.showRevision', revision: initial.documentRevision },
      { kind: 'diagnostics.show' },
      { kind: 'presentation.focusAction', actionId: 'viewport.fitSelection' },
      { kind: 'presentation.waitForSettled', correlationId: 'observer-full-i2' },
    ],
    presentation: { mode: 'normal', transition: 'animate' },
  });
  const afterI2Image = await renderedCanvasDigest(page);
  check('full I2 batch controls multi-subshape selection, fit bounds, display, section, and explode without a document edit',
    i2Applied.uiRevision === applied.uiRevision + 1 &&
    i2Applied.snapshot.documentRevision === applied.snapshot.documentRevision &&
    i2Applied.snapshot.selection.length === 3 &&
    i2Applied.snapshot.selection.every((entry: any) => entry.owner.id === faceRef.owner.id) &&
    i2Applied.snapshot.viewport.displayMode === 'ghost' &&
    i2Applied.snapshot.viewport.navigationMode === 'orbit' &&
    i2Applied.snapshot.viewport.activeSectionId === 'section-robot-joint' &&
    i2Applied.snapshot.viewport.activeExplodedViewId === 'explode-robot-joint' &&
    i2Applied.snapshot.viewport.viewId === 'fit-selection' &&
    i2Applied.snapshot.viewport.framedBounds?.size?.length === 3 &&
    i2Applied.snapshot.viewport.framedBounds.size.some((entry: number) => entry > 0));
  check('observer canvas changes after real rendered subshape, camera, display, section, and explode control',
    beforeI2Image.nonzero > 0 &&
    afterI2Image.nonzero > 0 &&
    beforeI2Image.hash !== afterI2Image.hash,
    { before: beforeI2Image, after: afterI2Image });

  const visibleI2 = await page.evaluate((occurrenceId) => {
    const occurrence = [...document.querySelectorAll<HTMLElement>('[data-occurrence-id]')]
      .find((row) => row.dataset.occurrenceId === occurrenceId);
    const childKey = occurrence ? JSON.stringify({ id: occurrenceId, kind: 'occurrence' }) : '';
    const children = [...document.querySelectorAll<HTMLElement>('[data-v6-tree-parent]')]
      .filter((row) => row.dataset.v6TreeParent === childKey);
    const ghost = document.querySelector<HTMLElement>('[data-display-mode="ghost"]');
    const orbitMode = document.querySelector<HTMLElement>('[data-nav-mode="orbit"]');
    const section = document.querySelector<HTMLElement>('[data-inspection-kind="section"][data-inspection-id="section-robot-joint"]');
    const exploded = document.querySelector<HTMLElement>('[data-inspection-kind="explode"][data-inspection-id="explode-robot-joint"]');
    const diagnostics = document.getElementById('bw-v6-diagnostics') as HTMLElement | null;
    const app = document.querySelector<HTMLElement>('.cadstudio-app');
    const viewport = document.getElementById('bw-studio') as HTMLElement | null;
    const visibleRevision = document.querySelector<HTMLElement>('[data-v6-revision].is-agent-revealed');
    return {
      occurrenceExpanded: occurrence?.getAttribute('aria-expanded'),
      visibleChildren: children.filter((row) => !row.hidden).length,
      ghostPressed: ghost?.getAttribute('aria-pressed'),
      orbitPressed: orbitMode?.getAttribute('aria-pressed'),
      sectionActive: section?.classList.contains('is-active'),
      explodedActive: exploded?.classList.contains('is-active'),
      diagnosticsVisible: diagnostics ? !diagnostics.hidden : false,
      diagnosticsText: diagnostics?.textContent,
      modelTreeVisible: !app?.classList.contains('v6-model-tree-closed'),
      inspectorVisible: !app?.classList.contains('v6-inspector-closed'),
      viewportFocused: viewport?.dataset.v6FocusedAction,
      visibleRevision: visibleRevision?.dataset.v6Revision,
    };
  }, shaftOccurrence.id);
  check('observer sees expanded tree, open panels, diagnostics, display mode, saved views, and focused viewport',
    visibleI2.occurrenceExpanded === 'true' &&
    visibleI2.visibleChildren > 0 &&
    visibleI2.ghostPressed === 'true' &&
    visibleI2.orbitPressed === 'true' &&
    visibleI2.sectionActive === true &&
    visibleI2.explodedActive === true &&
    visibleI2.diagnosticsVisible === true &&
    /No current kernel or document diagnostics/.test(visibleI2.diagnosticsText || '') &&
    visibleI2.modelTreeVisible === true &&
    visibleI2.inspectorVisible === true &&
    visibleI2.viewportFocused === 'true' &&
    visibleI2.visibleRevision === String(initial.documentRevision),
    visibleI2);
  const i2Events: any = await bridge.request('cad_events', { afterCursor: events.latestCursor, limit: 500 });
  const i2Trace = i2Events.events.filter((entry: any) => entry.correlationId === 'observer-full-i2');
  const startedCursors = i2Trace.filter((entry: any) => entry.kind === 'presentation.stepStarted').map((entry: any) => entry.cursor);
  const renderCursors = i2Trace.filter((entry: any) => entry.kind === 'render.completed').map((entry: any) => entry.cursor);
  const settledCursors = i2Trace.filter((entry: any) => entry.kind === 'presentation.stepSettled').map((entry: any) => entry.cursor);
  check('recordable I2 choreography emits one ordered renderer-settled trace per visible action',
    startedCursors.length === 21 &&
    renderCursors.length === 21 &&
    settledCursors.length === 21 &&
    startedCursors.every((cursor: number, index: number) => cursor < renderCursors[index] && renderCursors[index] < settledCursors[index]) &&
    i2Trace.every((entry: any) => !/prompt|reasoning|secret|clientX|selector/i.test(JSON.stringify(entry))));

  console.log('\nCAD Studio V6 visible command draft and exact preview');
  const coverRef = { kind: 'occurrence', id: 'occurrence-robot-cover' };
  const selectCover: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: i2Applied.uiRevision,
    correlationId: 'observer-i3-select',
    actions: [
      { kind: 'selection.set', entity: coverRef },
      { kind: 'tree.reveal', entity: coverRef },
    ],
    presentation: { mode: 'normal', transition: 'cut' },
  });
  const previewTransform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 44, 1];
  const beforePreviewImage = await renderedCanvasDigest(page);
  const commandApplied: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: selectCover.uiRevision,
    correlationId: 'observer-i3-command-preview',
    actions: [
      { kind: 'command.open', commandId: 'assembly.component-transform' },
      { kind: 'command.bindSelection', fieldId: 'occurrence', entities: [coverRef] },
      { kind: 'command.setInput', fieldId: 'transform', value: previewTransform },
      { kind: 'command.preview' },
      { kind: 'presentation.focusAction', actionId: 'viewport' },
      { kind: 'presentation.waitForSettled', correlationId: 'observer-i3-command-preview' },
    ],
    presentation: { mode: 'recording', transition: 'cut', minimumVisibleMs: 50 },
  });
  let activeCommandApplied = commandApplied;
  let previewResult = commandApplied.results
    .find((entry: any) => entry.kind === 'command.preview')?.result;
  const afterPreviewImage = await renderedCanvasDigest(page);
  const visibleCommand = await page.evaluate(() => {
    const dialog = document.getElementById('bw-v5-command') as HTMLDialogElement | null;
    const matrix = dialog?.querySelector<HTMLTextAreaElement>('[name="matrix"]');
    const preview = document.getElementById('bw-v6-command-preview') as HTMLElement | null;
    const apply = document.getElementById('bw-v5-command-apply') as HTMLButtonElement | null;
    return {
      dialogOpen: Boolean(dialog?.open),
      command: dialog?.dataset.command,
      matrix: matrix?.value,
      previewVisible: preview ? !preview.hidden : false,
      previewText: preview?.textContent,
      applyText: apply?.textContent,
      applyDisabled: apply?.disabled,
      narrationLiveText: document.getElementById('bw-agent-narration-live')?.textContent,
      narrationLiveRole: document.getElementById('bw-agent-narration-live')?.getAttribute('role'),
      narrationLiveMode: document.getElementById('bw-agent-narration-live')?.getAttribute('aria-live'),
    };
  });
  check('direct UI calls open the normal command panel, bind the occurrence, populate the typed field, and visibly present exact preview',
    commandApplied.snapshot.documentRevision === selectCover.snapshot.documentRevision &&
    commandApplied.snapshot.activeCommand?.commandId === 'assembly.component-transform' &&
    commandApplied.snapshot.activeCommand?.state === 'preview' &&
    commandApplied.snapshot.activeCommand?.boundSelections?.occurrence?.[0]?.id === coverRef.id &&
    JSON.stringify(commandApplied.snapshot.activeCommand?.inputValues?.transform) === JSON.stringify(previewTransform) &&
    commandApplied.snapshot.preview?.previewId === previewResult?.previewId &&
    commandApplied.snapshot.preview?.visible === true &&
    previewResult?.validation?.valid === true &&
    previewResult?.validation?.exactGeometry === true &&
    previewResult?.directVisibleHashParity === true &&
    visibleCommand.dialogOpen === true &&
    visibleCommand.command === 'assembly-transform' &&
    visibleCommand.matrix === previewTransform.join(', ') &&
    visibleCommand.previewVisible === true &&
    /Exact validation passed/.test(visibleCommand.previewText || '') &&
    visibleCommand.applyText === 'Apply exact preview' &&
    visibleCommand.applyDisabled === false &&
    visibleCommand.narrationLiveRole === 'status' &&
    visibleCommand.narrationLiveMode === 'polite' &&
    Boolean(visibleCommand.narrationLiveText),
    { commandApplied, visibleCommand });
  check('detached transform preview changes the rendered assembly while preserving the document revision',
    beforePreviewImage.nonzero > 0 &&
    afterPreviewImage.nonzero > 0 &&
    beforePreviewImage.hash !== afterPreviewImage.hash &&
    commandApplied.snapshot.documentRevision === initial.documentRevision,
    { beforePreviewImage, afterPreviewImage });

  let rollbackCode = '';
  try {
    await bridge.request('cad_ui', {
      action: 'apply',
      expectedUiRevision: commandApplied.uiRevision,
      correlationId: 'observer-i3-command-rollback',
      actions: [
        { kind: 'command.setInput', fieldId: 'transform', value: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 48, 1] },
        { kind: 'command.open', commandId: 'assembly.component-transform' },
      ],
      presentation: { mode: 'normal', transition: 'cut' },
    });
  } catch (error: any) {
    rollbackCode = error.code;
  }
  const afterCommandRollback: any = await bridge.request('cad_ui', { action: 'snapshot' });
  check('failed semantic command batch restores the prior visible draft and its still-committable exact preview',
    rollbackCode === 'COMMAND_ALREADY_OPEN' &&
    afterCommandRollback.uiRevision === commandApplied.uiRevision &&
    afterCommandRollback.activeCommand?.draftId === commandApplied.snapshot.activeCommand.draftId &&
    JSON.stringify(afterCommandRollback.activeCommand?.inputValues?.transform) === JSON.stringify(previewTransform) &&
    afterCommandRollback.preview?.previewId === previewResult.previewId &&
    afterCommandRollback.preview?.visible === true &&
    afterCommandRollback.preview?.validation?.exactGeometry === true,
    { rollbackCode, afterCommandRollback });

  const directParity: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-i3-direct-parity',
      label: 'Transform component occurrence-robot-cover',
      expectedRevision: commandApplied.snapshot.documentRevision,
      operations: [{
        kind: 'component.update',
        input: {
          occurrenceId: coverRef.id,
          patch: { baseTransform: previewTransform },
        },
      }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  check('visible-command preview and direct cad_preview produce the same canonical result and exact evidence',
    directParity.changeSet.documentHashAfter === previewResult.changeSet.documentHashAfter &&
    directParity.validation.exactGeometry === true &&
    JSON.stringify(directParity.evidence) === JSON.stringify(previewResult.evidence));

  const commandEventCursor = i2Events.latestCursor;
  const stalePreviewId = previewResult.previewId;
  const stalePreviewRevision = previewResult.baseRevision;
  await changeDisplayModeAsHuman(page, 'wireframe');
  await page.waitForFunction((revision) => (window as any).__bwStudio.commandRevision() === revision + 1, { polling: 50 }, stalePreviewRevision);
  const afterHumanDocumentChange: any = await bridge.request('cad_ui', { action: 'snapshot' });
  let staleDocumentCode = '';
  try {
    await bridge.request('cad_commit', {
      previewId: stalePreviewId,
      expectedRevision: stalePreviewRevision,
    });
  } catch (error: any) {
    staleDocumentCode = error.code;
  }
  const changesAfterHuman: any = await bridge.request('cad_history', {
    action: 'changesSince',
    revision: stalePreviewRevision,
  });
  check('simulated human assembly edit invalidates the visible preview, refuses stale commit, and appears in structured history',
    afterHumanDocumentChange.documentRevision === stalePreviewRevision + 1 &&
    afterHumanDocumentChange.activeCommand?.state === 'blocked' &&
    afterHumanDocumentChange.preview === undefined &&
    staleDocumentCode === 'REVISION_CONFLICT' &&
    changesAfterHuman.items.some((entry: any) => entry.actor === 'human' && /wireframe display/i.test(entry.label)),
    { afterHumanDocumentChange, staleDocumentCode, changesAfterHuman });

  const closedStaleDraft: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: afterHumanDocumentChange.uiRevision,
    correlationId: 'observer-i3-refresh-cancel',
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'normal', transition: 'cut' },
  });
  activeCommandApplied = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: closedStaleDraft.uiRevision,
    correlationId: 'observer-i3-refreshed-command-preview',
    actions: [
      { kind: 'command.open', commandId: 'assembly.component-transform' },
      { kind: 'command.bindSelection', fieldId: 'occurrence', entities: [coverRef] },
      { kind: 'command.setInput', fieldId: 'transform', value: previewTransform },
      { kind: 'command.preview' },
    ],
    presentation: { mode: 'normal', transition: 'cut' },
  });
  previewResult = activeCommandApplied.results
    .find((entry: any) => entry.kind === 'command.preview')?.result;
  const refreshedDirectParity: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-i3-refreshed-direct-parity',
      label: 'Transform component occurrence-robot-cover after human edit',
      expectedRevision: previewResult.baseRevision,
      operations: [{
        kind: 'component.update',
        input: {
          occurrenceId: coverRef.id,
          patch: { baseTransform: previewTransform },
        },
      }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  check('agent refreshes the visible command on the human revision and restores exact direct/visible parity',
    previewResult.baseRevision === stalePreviewRevision + 1 &&
    previewResult.validation.exactGeometry === true &&
    previewResult.changeSet.documentHashAfter === refreshedDirectParity.changeSet.documentHashAfter &&
    JSON.stringify(previewResult.evidence) === JSON.stringify(refreshedDirectParity.evidence));

  const registeredPreviewIds = await page.evaluate(() => (window as any).__bwStudio.agentPreviewIds());
  check('visible exact preview is registered with the preview-required connection before commit',
    registeredPreviewIds.includes(previewResult.previewId),
    registeredPreviewIds);
  const commitPromise = bridge.request('cad_commit', {
    previewId: previewResult.previewId,
    expectedRevision: previewResult.baseRevision,
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.ws-agent-pair[open]')]
    .some((dialog) => /AGENT PREVIEW/.test(dialog.textContent || '')), { polling: 50, timeout: 10_000 });
  const commitApprovalVisible = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll<HTMLDialogElement>('.ws-agent-pair[open]')]
      .find((candidate) => /AGENT PREVIEW/.test(candidate.textContent || ''));
    if (!dialog) return false;
    const visible = /Apply this CAD change/.test(dialog.textContent || '') &&
      /Transform component occurrence-robot-cover/.test(dialog.textContent || '') &&
      Boolean(dialog.getAttribute('aria-labelledby')) &&
      Boolean(dialog.getAttribute('aria-describedby')) &&
      dialog.contains(document.activeElement);
    dialog.close('approve');
    dialog.dispatchEvent(new Event('close'));
    return visible;
  });
  const committed: any = await commitPromise;
  let afterCommit: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const commitSettled: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: afterCommit.uiRevision,
    correlationId: 'observer-i3-commit-settled',
    actions: [{ kind: 'presentation.waitForSettled', correlationId: 'observer-i3-commit-settled' }],
    presentation: { mode: 'normal', transition: 'cut' },
  });
  afterCommit = commitSettled.snapshot;
  const committedCover: any = await bridge.request('cad_inspect', {
    query: { kind: 'entity.detail', entity: coverRef },
  });
  const visibleCommit = await page.evaluate(() => ({
    dialogOpen: Boolean((document.getElementById('bw-v5-command') as HTMLDialogElement | null)?.open),
    currentRevision: document.querySelector<HTMLElement>('[data-v6-revision][aria-current="true"]')?.dataset.v6Revision,
    previewVisible: !(document.getElementById('bw-v6-command-preview') as HTMLElement | null)?.hidden,
  }));
  check('cad_commit applies the exact visible preview as one normal editable command and closes the draft',
    commitApprovalVisible === true &&
    committed.revision === initial.documentRevision + 2 &&
    committed.historyEntry?.transactionId === activeCommandApplied.snapshot.activeCommand.transactionId &&
    afterCommit.documentRevision === committed.revision &&
    afterCommit.activeCommand === undefined &&
    afterCommit.preview === undefined &&
    afterCommit.viewport.renderedDocumentRevision === committed.revision &&
    JSON.stringify(committedCover.result.value.baseTransform) === JSON.stringify(previewTransform) &&
    visibleCommit.dialogOpen === false &&
    visibleCommit.currentRevision === String(committed.revision) &&
    visibleCommit.previewVisible === false,
    { committed, afterCommit, committedCover, visibleCommit });
  const commandEvents: any = await bridge.request('cad_events', { afterCursor: commandEventCursor, limit: 500 });
  check('visible command lifecycle emits structured draft, exact preview, commit, history, render, and settled events',
    commandEvents.events.some((entry: any) => entry.kind === 'command.draftChanged' && entry.payload.reason === 'opened') &&
    commandEvents.events.some((entry: any) => entry.kind === 'preview.started') &&
    commandEvents.events.some((entry: any) => entry.kind === 'preview.ready' && entry.payload.previewId === previewResult.previewId) &&
    commandEvents.events.some((entry: any) => entry.kind === 'commit.applied' && entry.payload.revision === committed.revision) &&
    commandEvents.events.some((entry: any) => entry.kind === 'history.changed' && entry.payload.revision === committed.revision) &&
    commandEvents.events.some((entry: any) => entry.kind === 'render.completed' && entry.correlationId === 'observer-i3-commit-settled') &&
    commandEvents.events.every((entry: any) => !/clientX|clientY|selector|xpath|reasoning|prompt/i.test(JSON.stringify(entry))));

  const cancelDraft: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: afterCommit.uiRevision,
    correlationId: 'observer-i3-cancel-draft',
    actions: [
      { kind: 'command.open', commandId: 'assembly.component-transform' },
      { kind: 'command.setInput', fieldId: 'transform', value: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 52, 1] },
      { kind: 'command.preview' },
    ],
    presentation: { mode: 'normal', transition: 'cut' },
  });
  const cancelled: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: cancelDraft.uiRevision,
    correlationId: 'observer-i3-cancel',
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'normal', transition: 'cut' },
  });
  check('command cancellation removes the detached preview and leaves the committed document unchanged',
    cancelled.snapshot.documentRevision === committed.revision &&
    cancelled.snapshot.activeCommand === undefined &&
    cancelled.snapshot.preview === undefined &&
    !(await page.evaluate(() => Boolean((document.getElementById('bw-v5-command') as HTMLDialogElement | null)?.open))));

  console.log('\nCAD Studio V6 full assembly command family');
  const definitionRef = { kind: 'part', id: coverPart.id };
  const anchorRef = { kind: 'occurrence', id: 'occurrence-robot-shaft' };
  const assemblyCommandCases = [
    {
      commandId: 'assembly.insert',
      actions: [
        { kind: 'command.bindSelection', fieldId: 'definition', entities: [definitionRef] },
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent inserted cover' },
        { kind: 'command.setInput', fieldId: 'translation', value: [0, 0, 60] },
        { kind: 'command.setInput', fieldId: 'fixed', value: false },
      ],
    },
    {
      commandId: 'assembly.linked',
      actions: [
        { kind: 'command.bindSelection', fieldId: 'occurrence', entities: [coverRef] },
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent linked cover' },
        { kind: 'command.setInput', fieldId: 'translation', value: [0, 0, 70] },
      ],
    },
    {
      commandId: 'assembly.independent',
      actions: [
        { kind: 'command.bindSelection', fieldId: 'occurrence', entities: [coverRef] },
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent independent cover' },
      ],
    },
    {
      commandId: 'assembly.replace',
      actions: [
        { kind: 'command.bindSelection', fieldId: 'occurrence', entities: [coverRef] },
        { kind: 'command.bindSelection', fieldId: 'definition', entities: [definitionRef] },
      ],
    },
    {
      commandId: 'assembly.variant',
      actions: [
        { kind: 'command.bindSelection', fieldId: 'occurrence', entities: [coverRef] },
        { kind: 'command.setInput', fieldId: 'parameterOverrides', value: ['clearance = 0.35'] },
      ],
    },
    {
      commandId: 'assembly.edit-context',
      actions: [
        { kind: 'command.bindSelection', fieldId: 'occurrence', entities: [coverRef] },
      ],
    },
    {
      commandId: 'assembly.pattern',
      actions: [
        { kind: 'command.bindSelection', fieldId: 'occurrence', entities: [coverRef] },
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent cover pattern' },
        { kind: 'command.setInput', fieldId: 'patternKind', value: 'circular' },
        { kind: 'command.setInput', fieldId: 'generatedCount', value: 3 },
        { kind: 'command.setInput', fieldId: 'totalAngle', value: 90 },
      ],
    },
    ...['fixed', 'coincident', 'concentric', 'distance', 'angle', 'parallel', 'perpendicular', 'tangent', 'revolute', 'slider']
      .map((mateKind) => ({
        commandId: `assembly.mate.${mateKind}`,
        actions: [
          { kind: 'command.bindSelection', fieldId: 'movingOccurrence', entities: [coverRef] },
          ...(mateKind === 'fixed' ? [] : [
            { kind: 'command.bindSelection', fieldId: 'anchorOccurrence', entities: [anchorRef] },
            { kind: 'command.bindSelection', fieldId: 'anchorReference', entities: [anchorRef] },
            { kind: 'command.bindSelection', fieldId: 'movingReference', entities: [coverRef] },
          ]),
          { kind: 'command.setInput', fieldId: 'name', value: `Agent ${mateKind} mate` },
          { kind: 'command.setInput', fieldId: 'value', value: mateKind === 'angle' ? 15 : 0 },
          { kind: 'command.setInput', fieldId: 'flip', value: false },
        ],
      })),
  ];
  const assemblyCommandResults: any[] = [];
  let assemblyUiRevision = cancelled.uiRevision;
  for (const [index, commandCase] of assemblyCommandCases.entries()) {
    try {
      const appliedCase: any = await bridge.request('cad_ui', {
        action: 'apply',
        expectedUiRevision: assemblyUiRevision,
        correlationId: `observer-assembly-command-${index}`,
        actions: [
          { kind: 'selection.set', entity: coverRef },
          { kind: 'command.open', commandId: commandCase.commandId },
          ...commandCase.actions,
          { kind: 'command.preview' },
        ],
        presentation: { mode: 'instant', transition: 'cut' },
      });
      const visible = await page.evaluate(() => {
        const dialog = document.getElementById('bw-v5-command') as HTMLDialogElement | null;
        const previewSurface = document.getElementById('bw-v6-command-preview') as HTMLElement | null;
        return {
          open: Boolean(dialog?.open),
          command: dialog?.dataset.command,
          mateKind: dialog?.dataset.mateKind,
          previewVisible: previewSurface ? !previewSurface.hidden : false,
        };
      });
      const previewEntry = appliedCase.results.find((entry: any) => entry.kind === 'command.preview')?.result;
      const result = {
        commandId: commandCase.commandId,
        valid:
          appliedCase.snapshot.activeCommand?.commandId === commandCase.commandId &&
          appliedCase.snapshot.activeCommand?.state === 'preview' &&
          appliedCase.snapshot.preview?.visible === true &&
          previewEntry?.validation?.valid === true &&
          previewEntry?.validation?.exactGeometry === true &&
          previewEntry?.directVisibleHashParity === true &&
          visible.open &&
          visible.previewVisible,
        visible,
      };
      assemblyCommandResults.push(result);
      const closed: any = await bridge.request('cad_ui', {
        action: 'apply',
        expectedUiRevision: appliedCase.uiRevision,
        correlationId: `observer-assembly-command-cancel-${index}`,
        actions: [{ kind: 'command.cancel' }],
        presentation: { mode: 'instant', transition: 'cut' },
      });
      assemblyUiRevision = closed.uiRevision;
    } catch (error: any) {
      assemblyCommandResults.push({
        commandId: commandCase.commandId,
        valid: false,
        code: error.code,
        message: error.message,
      });
      const state: any = await bridge.request('cad_ui', { action: 'snapshot' });
      assemblyUiRevision = state.uiRevision;
      if (state.activeCommand) {
        const closed: any = await bridge.request('cad_ui', {
          action: 'apply',
          expectedUiRevision: assemblyUiRevision,
          actions: [{ kind: 'command.cancel' }],
          presentation: { mode: 'instant', transition: 'cut' },
        });
        assemblyUiRevision = closed.uiRevision;
      }
    }
  }
  check('every assembly structure adapter and all ten mate adapters use the normal visible panel with exact preview and cancel',
    assemblyCommandResults.length === 17 &&
    assemblyCommandResults.every((entry) => entry.valid),
    assemblyCommandResults);

  const bodyRef = { kind: 'body', id: faceRef.owner.id };
  const inspectionCommandCases = [
    {
      commandId: 'inspection.section',
      selection: coverRef,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'scopeOccurrence', entities: [] },
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent quarter section' },
        { kind: 'command.setInput', fieldId: 'sectionKind', value: 'quarter' },
        { kind: 'command.setInput', fieldId: 'offset', value: 2 },
        { kind: 'command.setInput', fieldId: 'cap', value: true },
        { kind: 'command.setInput', fieldId: 'reverse', value: true },
        { kind: 'command.setInput', fieldId: 'hatchSpacing', value: 6 },
        { kind: 'command.setInput', fieldId: 'hatchAngle', value: 30 },
      ],
    },
    {
      commandId: 'inspection.explode',
      selection: coverRef,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'occurrence', entities: [coverRef] },
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent exploded view' },
        { kind: 'command.setInput', fieldId: 'translation', value: [0, 0, 44] },
      ],
    },
    {
      commandId: 'inspection.stage',
      selection: coverRef,
      actions: [
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent axial stages' },
        { kind: 'command.setInput', fieldId: 'start', value: 18 },
        { kind: 'command.setInput', fieldId: 'spacing', value: 14 },
        { kind: 'command.setInput', fieldId: 'visible', value: true },
      ],
    },
    {
      commandId: 'inspection.measure',
      selection: bodyRef,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'bodies', entities: [bodyRef] },
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent body envelope' },
        { kind: 'command.setInput', fieldId: 'measurementKind', value: 'bounding-box' },
      ],
    },
    {
      commandId: 'inspection.material',
      selection: bodyRef,
      actions: [
        {
          kind: 'command.bindSelection',
          fieldId: 'material',
          entities: [{ kind: 'material', id: 'material-generic-aluminum' }],
        },
      ],
    },
  ];
  const inspectionCommandResults: any[] = [];
  for (const [index, commandCase] of inspectionCommandCases.entries()) {
    try {
      const appliedCase: any = await bridge.request('cad_ui', {
        action: 'apply',
        expectedUiRevision: assemblyUiRevision,
        correlationId: `observer-inspection-command-${index}`,
        actions: [
          { kind: 'selection.set', entity: commandCase.selection },
          { kind: 'command.open', commandId: commandCase.commandId },
          ...commandCase.actions,
          { kind: 'command.preview' },
        ],
        presentation: { mode: 'instant', transition: 'cut' },
      });
      const visible = await page.evaluate(() => {
        const dialog = document.getElementById('bw-v5-command') as HTMLDialogElement | null;
        const previewSurface = document.getElementById('bw-v6-command-preview') as HTMLElement | null;
        return {
          open: Boolean(dialog?.open),
          command: dialog?.dataset.command,
          previewVisible: previewSurface ? !previewSurface.hidden : false,
        };
      });
      const previewEntry = appliedCase.results.find((entry: any) => entry.kind === 'command.preview')?.result;
      inspectionCommandResults.push({
        commandId: commandCase.commandId,
        valid:
          appliedCase.snapshot.activeCommand?.commandId === commandCase.commandId &&
          appliedCase.snapshot.activeCommand?.state === 'preview' &&
          appliedCase.snapshot.preview?.visible === true &&
          previewEntry?.validation?.valid === true &&
          previewEntry?.validation?.exactGeometry === true &&
          previewEntry?.directVisibleHashParity === true &&
          visible.open &&
          visible.command === commandCase.commandId.replace('.', '-') &&
          visible.previewVisible,
        visible,
      });
      const closed: any = await bridge.request('cad_ui', {
        action: 'apply',
        expectedUiRevision: appliedCase.uiRevision,
        correlationId: `observer-inspection-command-cancel-${index}`,
        actions: [{ kind: 'command.cancel' }],
        presentation: { mode: 'instant', transition: 'cut' },
      });
      assemblyUiRevision = closed.uiRevision;
    } catch (error: any) {
      inspectionCommandResults.push({
        commandId: commandCase.commandId,
        valid: false,
        code: error.code,
        message: error.message,
      });
      const state: any = await bridge.request('cad_ui', { action: 'snapshot' });
      assemblyUiRevision = state.uiRevision;
      if (state.activeCommand) {
        const closed: any = await bridge.request('cad_ui', {
          action: 'apply',
          expectedUiRevision: assemblyUiRevision,
          actions: [{ kind: 'command.cancel' }],
          presentation: { mode: 'instant', transition: 'cut' },
        });
        assemblyUiRevision = closed.uiRevision;
      }
    }
  }
  check('saved section, explode, axial-stage, measurement, and material adapters use their normal visible panels with exact preview and cancel',
    inspectionCommandResults.length === 5 &&
    inspectionCommandResults.every((entry) => entry.valid),
    inspectionCommandResults);

  let staleCode = '';
  try {
    await bridge.request('cad_ui', {
      action: 'apply',
      expectedUiRevision: initial.uiRevision,
      actions: [{ kind: 'selection.clear' }],
    });
  } catch (error: any) {
    staleCode = error.code;
  }
  const afterConflict: any = await bridge.request('cad_ui', { action: 'snapshot' });
  check('stale semantic UI action fails closed and preserves the visible selection',
    staleCode === 'UI_REVISION_CONFLICT' &&
    afterConflict.uiRevision === assemblyUiRevision &&
    afterConflict.selection.some((entry: any) => entry.id === bodyRef.id),
    { staleCode, assemblyUiRevision, bodyRef, afterConflict });

  console.log('\nCAD Studio V6 exact inspection and artifact transfer');
  // Cursor zero is the specified resynchronization path after a bounded event
  // buffer rolls over. Capture only the current high-water mark so this phase
  // proves its own kernel/artifact events without depending on older phases.
  const artifactEventCursor = (await bridge.request('cad_events', {
    afterCursor: 0,
    limit: 500,
  }) as any).latestCursor;
  const shaftRef = { kind: 'occurrence', id: 'occurrence-robot-shaft' };
  const visibleInspections: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: afterConflict.uiRevision,
    correlationId: 'observer-visible-inspections',
    actions: [
      { kind: 'selection.set', entity: shaftRef },
      { kind: 'selection.add', entity: coverRef },
      { kind: 'inspection.run', inspectionId: 'properties' },
      { kind: 'inspection.run', inspectionId: 'clearance' },
      { kind: 'inspection.run', inspectionId: 'interference' },
      { kind: 'inspection.run', inspectionId: 'measurements' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const visibleInspectionPanel = await page.evaluate(() => ({
    visible: !(document.getElementById('bw-context-wrap') as HTMLElement | null)?.hidden,
    text: document.getElementById('bw-context-wrap')?.textContent,
  }));
  check('all four immediate inspection controls return exact evidence and visibly use the normal inspector',
    visibleInspections.results.filter((entry: any) => entry.kind === 'inspection.run').length === 4 &&
    visibleInspections.results.filter((entry: any) => entry.kind === 'inspection.run').every((entry: any) => entry.result.exactGeometry === true) &&
    Array.isArray(visibleInspections.snapshot.inspection?.measurementResults) &&
    visibleInspectionPanel.visible === true &&
    /measurement/i.test(visibleInspectionPanel.text || ''),
    { results: visibleInspections.results, inspection: visibleInspections.snapshot.inspection, visibleInspectionPanel });
  const exactClearance: any = await bridge.request('cad_query', {
    query: { kind: 'assembly.clearance', entities: [shaftRef, coverRef] },
  });
  const exactInterference: any = await bridge.request('cad_query', {
    query: { kind: 'assembly.interference', scope: 'visible-model' },
  });
  const exactHealth: any = await bridge.request('cad_query', {
    query: { kind: 'geometry.health', scope: 'visible-model' },
  });
  check('direct CAD queries return exact clearance, interference, and health evidence at the committed revision',
    exactClearance.revision === committed.revision &&
    exactClearance.result.exactGeometry === true &&
    exactClearance.result.scope.bodyIds.length === 2 &&
    exactClearance.result.pairs.length === 1 &&
    Number.isFinite(exactClearance.result.pairs[0].minimumClearanceMm) &&
    exactInterference.result.exactGeometry === true &&
    exactInterference.result.bodyCount >= 3 &&
    Array.isArray(exactInterference.result.pairs) &&
    exactHealth.result.exactGeometry === true &&
    exactHealth.result.aggregate?.valid === true,
    { exactClearance, exactInterference, exactHealth });

  let ambiguousArtifactCode = '';
  let unknownArtifactCode = '';
  try {
    await bridge.request('cad_artifact', { format: 'png', scope: 'selection', entities: [coverRef] });
  } catch (error: any) {
    ambiguousArtifactCode = error.code;
  }
  try {
    await bridge.request('cad_artifact', { format: 'png', entities: [coverRef], selector: '#forbidden' });
  } catch (error: any) {
    unknownArtifactCode = error.code;
  }
  check('artifact transfer rejects ambiguous scope and every unadvertised control field',
    ambiguousArtifactCode === 'INVALID_ARTIFACT_SCOPE' &&
    unknownArtifactCode === 'INVALID_ARTIFACT_REQUEST',
    { ambiguousArtifactCode, unknownArtifactCode });

  const selectedStep: any = await bridge.request('cad_artifact', {
    format: 'step',
    entities: [coverRef],
  });
  const selectedRender: any = await bridge.request('cad_artifact', {
    format: 'png',
    entities: [coverRef],
    width: 640,
    height: 360,
  });
  const projectArtifact: any = await bridge.request('cad_artifact', { format: 'project' });
  const webvtt: any = await bridge.request('cad_artifact', { format: 'webvtt' });
  const srt: any = await bridge.request('cad_artifact', { format: 'srt' });
  const stepBytes = Buffer.from(selectedStep.dataBase64, 'base64');
  const renderBytes = Buffer.from(selectedRender.dataBase64, 'base64');
  const projectBytes = Buffer.from(projectArtifact.dataBase64, 'base64');
  const webvttText = Buffer.from(webvtt.dataBase64, 'base64').toString('utf8');
  const srtText = Buffer.from(srt.dataBase64, 'base64').toString('utf8');
  check('selected occurrence STEP export transfers exact bytes with a stable one-component manifest',
    /^(model\/step|application\/step)$/i.test(selectedStep.mediaType) &&
    selectedStep.bytes === stepBytes.byteLength &&
    stepBytes.subarray(0, 14).toString('utf8').includes('ISO-10303-21') &&
    selectedStep.manifest.kind === 'selected-entity-cad' &&
    selectedStep.manifest.scope.requestedEntities[0].id === coverRef.id &&
    selectedStep.manifest.scope.bodyIds.length === 1 &&
    selectedStep.documentHash === exactHealth.result.documentHash,
    { mediaType: selectedStep.mediaType, header: stepBytes.subarray(0, 24).toString('utf8'), manifest: selectedStep.manifest });
  check('model-only PNG transfer contains no browser chrome and binds the render to camera, scope, and revisions',
    selectedRender.mediaType === 'image/png' &&
    renderBytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' &&
    selectedRender.manifest.kind === 'model-only-render' &&
    selectedRender.manifest.browserChromeIncluded === false &&
    selectedRender.manifest.width === 640 &&
    selectedRender.manifest.height === 360 &&
    selectedRender.manifest.scope.bodyIds.length === 1 &&
    selectedRender.manifest.renderedDocumentRevision === committed.revision &&
    selectedRender.manifest.camera.position.length === 3);
  check('canonical project and visible-only subtitle artifacts transfer with hashes and no private reasoning',
    JSON.parse(projectBytes.toString('utf8')).projectId === initial.projectId &&
    webvttText.startsWith('WEBVTT\n') &&
    webvtt.manifest.cueCount > 0 &&
    /^\d+\n\d{2}:\d{2}:\d{2},\d{3} --> /m.test(srtText) &&
    srt.manifest.cueCount === webvtt.manifest.cueCount &&
    !/chain.of.thought|private reasoning|raw prompt|credential|secret/i.test(webvttText + srtText));
  const artifactEvents: any = await bridge.request('cad_events', { afterCursor: artifactEventCursor, limit: 500 });
  check('inspection and every artifact complete through structured kernel/artifact events',
    artifactEvents.events.filter((entry: any) => entry.kind === 'kernel.completed').length >= 3 &&
    artifactEvents.events.filter((entry: any) => entry.kind === 'artifact.completed').length === 5 &&
    artifactEvents.events.every((entry: any) => !/dataBase64|selector|clientX|clientY|prompt|reasoning/i.test(JSON.stringify(entry))));

  const historyBefore: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const historyUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: historyBefore.revision,
  });
  const historyAfterUndo: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const historyRedo: any = await bridge.request('cad_history', {
    action: 'redo',
    expectedRevision: historyAfterUndo.revision,
  });
  const historyAfterRedo: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const historyUi: any = await bridge.request('cad_ui', { action: 'snapshot' });
  check('Undo and Redo use the normal visible history controller and restore the exact document hash',
    historyUndo.revision === historyBefore.revision + 1 &&
    historyRedo.revision === historyAfterUndo.revision + 1 &&
    historyAfterUndo.result.documentHash !== historyBefore.result.documentHash &&
    historyAfterRedo.result.documentHash === historyBefore.result.documentHash &&
    historyUi.documentRevision === historyAfterRedo.revision &&
    historyUi.viewport.renderedDocumentRevision === historyAfterRedo.revision,
    { historyBefore, historyUndo, historyAfterUndo, historyRedo, historyAfterRedo, historyUi });

  const narrationOff: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: historyUi.uiRevision,
    actions: [{ kind: 'narration.setMode', mode: 'off' }],
  });
  const hiddenNarration = await page.evaluate(() => ({
    hidden: (document.getElementById('bw-agent-narration') as HTMLElement | null)?.hidden,
    liveText: document.getElementById('bw-agent-narration-live')?.textContent,
  }));
  check('semantic narration control hides both visual and accessible subtitle surfaces',
    narrationOff.uiRevision === historyUi.uiRevision + 1 && hiddenNarration.hidden === true && hiddenNarration.liveText === '');
  check('agent path plus explicitly labelled human interventions produce no page errors', pageErrors.length === 0, pageErrors);

  console.log('\nCAD Studio V6 simulated-human state capture');
  let interruptionCode = '';
  const pauseCameraDirection = await page.evaluate(() => (window as any).__bwStudio.cameraDir());
  const interrupted = bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: narrationOff.uiRevision,
    correlationId: 'pause-cancellation-check',
    actions: [{ kind: 'viewport.standardView', viewId: 'front' }],
    presentation: { mode: 'recording', transition: 'animate', minimumVisibleMs: 3000 },
  }).then(() => {
    interruptionCode = 'NOT_INTERRUPTED';
  }, (error: any) => {
    interruptionCode = error.code;
  });
  await page.waitForFunction((before) => {
    const current = (window as any).__bwStudio.cameraDir();
    return current.some((entry: number, index: number) => Math.abs(entry - before[index]) > 1e-4);
  }, { polling: 10 }, pauseCameraDirection);
  await toggleAgentPauseAsHuman(page);
  await interrupted;
  check('human pause cancels an in-flight animated camera transition and marks the bridge paused',
    interruptionCode === 'SESSION_PAUSED' && bridge.status().state === 'paused',
    { interruptionCode, status: bridge.status() });
  await toggleAgentPauseAsHuman(page);
  for (let attempt = 0; attempt < 100 && bridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const afterResume: any = await bridge.request('cad_ui', { action: 'snapshot' });
  check('resume restores the exact pre-animation camera before accepting new work',
    bridge.status().state === 'connected' &&
    JSON.stringify(afterResume.viewport.camera) === JSON.stringify(narrationOff.snapshot.viewport.camera) &&
    afterResume.viewport.viewId === narrationOff.snapshot.viewport.viewId &&
    afterResume.documentRevision === narrationOff.snapshot.documentRevision &&
    afterResume.uiRevision >= narrationOff.uiRevision,
    { status: bridge.status(), afterResume });

  const humanInitial: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const humanCursor = (await bridge.request('cad_events', { afterCursor: 0, limit: 500 }) as any).latestCursor;
  // The observer-only phase is complete. These three normal-control actions
  // intentionally represent the human collaborator, never the CAD agent.
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => (document.querySelector('[data-workspace="solid"]') as HTMLButtonElement | null)?.click());
  await page.evaluate(() => (document.querySelector('[data-cube-view="top"]') as HTMLButtonElement | null)?.click());
  await page.evaluate(() => (document.getElementById('bw-mtab-project') as HTMLButtonElement | null)?.click());
  await page.waitForFunction(() => document.querySelector('.cadstudio-app')?.classList.contains('m-open-project'), { polling: 50 });
  await page.evaluate(() => (document.getElementById('bw-mtab-project') as HTMLButtonElement | null)?.click());
  await page.waitForFunction(() => !document.querySelector('.cadstudio-app')?.classList.contains('m-open-project'), { polling: 50 });
  const humanChanged: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const humanEvents: any = await bridge.request('cad_events', { afterCursor: humanCursor, limit: 100 });
  check('normal human workspace, camera, and panel controls advance the shared UI revision',
    humanChanged.uiRevision >= humanInitial.uiRevision + 3 &&
    humanChanged.workspaceId === 'solid' &&
    humanChanged.viewport.viewId === 'top' &&
    humanChanged.panels.find((panel: any) => panel.panelId === 'project')?.open === false,
    { initialRevision: humanInitial.uiRevision, humanChanged });
  check('broad human-state capture reports semantic scopes without pointer or selector data',
    humanEvents.events.some((entry: any) =>
      entry.kind === 'ui.changed' &&
      entry.actor === 'human' &&
      entry.payload.scopes?.includes('panels')) &&
    !JSON.stringify(humanEvents.events).includes('clientX') &&
    !JSON.stringify(humanEvents.events).includes('selector'));

  console.log('\nCAD Studio V6 recovery and expiry');
  const beforeReload: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const beforeReloadSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const staleAcrossReload: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-i4-stale-across-reload',
      label: 'Preview that must not survive reload',
      expectedRevision: beforeReload.documentRevision,
      operations: [{ kind: 'project.rename', input: { name: 'Stale preview must not commit' } }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  for (let attempt = 0; attempt < 100 && bridge.status().state !== 'recovering'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const recovery = bridge.reconnect();
  check('Studio reload enters a bounded recovery state with an agent-first launch',
    bridge.status().state === 'recovering' &&
    /^http:\/\/127\.0\.0\.1:49784\/launch\//.test(recovery.launchUrl) &&
    Date.parse(recovery.recoveryExpiresAt) > Date.now(),
    { status: bridge.status(), recovery });
  await page.goto(recovery.launchUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  await approveVisibleConnectionAsHuman(page);
  for (let attempt = 0; attempt < 600 && bridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const recovered: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const recoveredCapabilities: any = await bridge.request('cad_ui', { action: 'capabilities' });
  const recoveredSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const recoveredExact: any = await bridge.request('cad_query', { query: { kind: 'geometry.validity', exact: true } });
  const recoveredEvents: any = await bridge.request('cad_events', { afterCursor: 0, limit: 100 });
  let staleAcrossReloadCode = '';
  try {
    await bridge.request('cad_commit', {
      previewId: staleAcrossReload.previewId,
      expectedRevision: staleAcrossReload.baseRevision,
    });
  } catch (error: any) {
    staleAcrossReloadCode = error.code;
  }
  check('approved recovery resumes the same project and canonical document revision',
    bridge.status().state === 'connected' &&
    recovered.projectId === beforeReload.projectId &&
    recovered.documentRevision === beforeReload.documentRevision &&
    recoveredCapabilities.studioVersion === '6.0.0-i4' &&
    recoveredSummary.result.documentHash === beforeReloadSummary.result.documentHash,
    { beforeReload, recovered, recoveredSummary, recoveredExact, status: bridge.status() });
  check('recovery refreshes structured state and refuses every pre-reload preview as non-committable',
    recoveredSummary.revision === recovered.documentRevision &&
    recoveredExact.result.exactGeometry === true &&
    recoveredEvents.events.some((entry: any) => entry.kind === 'session.connected' && entry.payload.recovered === true) &&
    recoveredEvents.events.some((entry: any) => entry.kind === 'document.recovered' && entry.payload.documentHash === recoveredSummary.result.documentHash) &&
    staleAcrossReloadCode === 'PREVIEW_EXPIRED',
    { recoveredEvents, staleAcrossReloadCode });

  await bridge.close('V6 observer check complete');
  await page.waitForFunction(() => !(window as any).bomwikiCadAgent.status().connected, { polling: 50, timeout: 10_000 });
  const readOnlyBridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 read-only confirmation',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    mode: 'read-only',
    permissionContext: { granted: ['project.read', 'project.edit', 'project.replace', 'project.recover', 'ui.read', 'ui.select', 'ui.navigate', 'ui.wait-events'] },
  });
  await approveConnectionAsHuman(page, 'V6 read-only confirmation');
  for (let attempt = 0; attempt < 600 && readOnlyBridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const readOnlySummary: any = await readOnlyBridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const readOnlyUi: any = await readOnlyBridge.request('cad_ui', { action: 'snapshot' });
  let readOnlyEditCode = '';
  try {
    await readOnlyBridge.request('cad_preview', {
      transaction: {
        transactionId: 'observer-i4-read-only-refusal',
        label: 'Must not edit in read-only session',
        expectedRevision: readOnlyUi.documentRevision,
        operations: [{ kind: 'project.rename', input: { name: 'Forbidden read-only edit' } }],
        atomic: true,
      },
    });
  } catch (error: any) {
    readOnlyEditCode = error.code;
  }
  const readOnlyStatus: any = readOnlyBridge.status();
  check('disconnect and read-only reconnect confirm the final recovered state without edit authority',
    readOnlyStatus.mode === 'read-only' &&
    readOnlySummary.revision === recovered.documentRevision &&
    readOnlySummary.result.documentHash === recoveredSummary.result.documentHash &&
    readOnlyUi.projectId === recovered.projectId &&
    !readOnlyStatus.permissionContext?.granted?.includes('project.edit') &&
    !readOnlyStatus.permissionContext?.granted?.includes('project.replace') &&
    !readOnlyStatus.permissionContext?.granted?.includes('project.recover') &&
    readOnlyEditCode === 'PERMISSION_DENIED',
    { status: readOnlyStatus, readOnlySummary, readOnlyUi, readOnlyEditCode });
  await readOnlyBridge.close('Read-only confirmation complete');
  await page.waitForFunction(() => !(window as any).bomwikiCadAgent.status().connected, { polling: 50, timeout: 10_000 });
  const expiringBridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 expiry agent',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    sessionTtlMs: 800,
    permissionContext: { granted: ['project.read', 'ui.read'] },
  });
  await approveConnectionAsHuman(page, 'V6 expiry agent');
  for (let attempt = 0; attempt < 600 && expiringBridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  for (let attempt = 0; attempt < 120 && expiringBridge.status().state !== 'closed'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  check('session expiry revokes the fixed bridge with a typed terminal state',
    expiringBridge.status().state === 'closed' &&
    expiringBridge.status().closeCode === 'PERMISSION_EXPIRED',
    expiringBridge.status());
  await context.close();
}

async function projectBoundaryControlChecks(browser: Browser, url: string) {
  console.log('\nCAD Studio V6 project-boundary template, recovery, and blank-project controls');

  const templateContext = await browser.createBrowserContext();
  const templatePage = await templateContext.newPage();
  await templatePage.setViewport({ width: 1440, height: 900 });
  const templateErrors: string[] = [];
  templatePage.on('pageerror', (error) => templateErrors.push(String(error)));
  await templatePage.evaluateOnNewDocument(() => {
    localStorage.setItem('bw-studio-tour-v1', '1');
  });
  await templatePage.goto(url, { waitUntil: 'domcontentloaded' });
  await templatePage.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const templateBridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 project transition agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: [
        'project.read', 'project.edit', 'project.recover',
        'ui.read', 'ui.select', 'ui.navigate', 'ui.command-draft', 'ui.present-preview', 'ui.wait-events',
      ],
    },
  });
  await approveConnectionAsHuman(templatePage, 'V6 project transition agent');
  for (let attempt = 0; attempt < 600 && templateBridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const templateBase: any = await templateBridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  let templateUi: any = await templateBridge.request('cad_ui', { action: 'snapshot' });
  const welcomeTemplateUsed: any = await templateBridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: templateUi.uiRevision,
    actions: [{ kind: 'template.use', templateId: 'starter-plate' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const starterSummary: any = await templateBridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const starterVisible = await templatePage.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    return {
      title: document.querySelector('.ws-document .ws-project-name')?.textContent,
      welcomeOpen: !(document.getElementById('bw-welcome') as HTMLElement | null)?.hidden,
      transitionOpen: !(document.getElementById('bw-transition-toast') as HTMLElement | null)?.hidden,
      undoVisible: !(document.getElementById('bw-transition-undo') as HTMLElement | null)?.hidden,
      localTitle: local?.name || local?.title,
    };
  });
  check('a welcome template control replaces the project visibly while preserving the approved agent session',
    templateUi.surfaces.welcome.open === true &&
    welcomeTemplateUsed.snapshot.projectId !== templateBase.result.projectId &&
    welcomeTemplateUsed.snapshot.documentRevision === 0 &&
    welcomeTemplateUsed.snapshot.surfaces.welcome.open === false &&
    welcomeTemplateUsed.snapshot.surfaces.transition.open === true &&
    welcomeTemplateUsed.snapshot.surfaces.transition.undoAvailable === false &&
    starterSummary.result.name === 'Starter plate' &&
    starterSummary.result.counts.features === 2 &&
    starterVisible.title === 'Starter plate' &&
    starterVisible.welcomeOpen === false &&
    starterVisible.transitionOpen === true &&
    starterVisible.undoVisible === false &&
    starterVisible.localTitle === 'Starter plate' &&
    templateBridge.status().state === 'connected',
    { welcomeTemplateUsed, starterSummary, starterVisible, status: templateBridge.status() });

  const templateLibraryOpened: any = await templateBridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: welcomeTemplateUsed.uiRevision,
    actions: [
      { kind: 'transition.dismiss' },
      { kind: 'control.invoke', controlId: 'project.templates' },
      { kind: 'template.select', templateId: 'electronics-tray' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const dialogTemplateUsed: any = await templateBridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: templateLibraryOpened.uiRevision,
    actions: [{ kind: 'template.use', templateId: 'electronics-tray' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const traySummary: any = await templateBridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const transitionUndone: any = await templateBridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: dialogTemplateUsed.uiRevision,
    actions: [{ kind: 'transition.undo' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const restoredStarter: any = await templateBridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('the normal Use-template path is exact and transition Undo restores the prior template project',
    templateLibraryOpened.snapshot.surfaces.templates.open === true &&
    templateLibraryOpened.snapshot.surfaces.templates.selectedTemplateId === 'electronics-tray' &&
    dialogTemplateUsed.snapshot.surfaces.templates.open === false &&
    dialogTemplateUsed.snapshot.surfaces.transition.open === true &&
    dialogTemplateUsed.snapshot.surfaces.transition.undoAvailable === true &&
    traySummary.result.name === 'Electronics tray' &&
    traySummary.result.counts.features === 2 &&
    transitionUndone.snapshot.projectId === starterSummary.result.projectId &&
    restoredStarter.result.documentHash === starterSummary.result.documentHash &&
    restoredStarter.result.name === starterSummary.result.name &&
    transitionUndone.snapshot.surfaces.transition.open === true &&
    transitionUndone.snapshot.surfaces.transition.undoAvailable === false &&
    templateBridge.status().state === 'connected' &&
    templateErrors.length === 0,
    { templateLibraryOpened, dialogTemplateUsed, traySummary, transitionUndone, restoredStarter, templateErrors });
  const transitionDismissed: any = await templateBridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: transitionUndone.uiRevision,
    actions: [{ kind: 'transition.dismiss' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  check('transition dismiss closes the visible project notification and leaves the restored project operable',
    transitionDismissed.snapshot.surfaces.transition.open === false &&
    templateBridge.status().state === 'connected' &&
    templateErrors.length === 0,
    { transitionDismissed, status: templateBridge.status(), templateErrors });
  await templateBridge.close('Template transition checks complete');
  await templateContext.close();

  const blankContext = await browser.createBrowserContext();
  const blankPage = await blankContext.newPage();
  await blankPage.setViewport({ width: 1440, height: 900 });
  const blankErrors: string[] = [];
  blankPage.on('pageerror', (error) => blankErrors.push(String(error)));
  await blankPage.evaluateOnNewDocument(() => {
    localStorage.setItem('bw-studio-tour-v1', '1');
  });
  await blankPage.goto(url, { waitUntil: 'domcontentloaded' });
  await blankPage.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const blankBridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 blank project agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: ['project.read', 'project.edit', 'ui.read', 'ui.navigate', 'ui.command-draft', 'ui.present-preview'],
    },
  });
  await approveConnectionAsHuman(blankPage, 'V6 blank project agent');
  for (let attempt = 0; attempt < 600 && blankBridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const blankBefore: any = await blankBridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const blankUi: any = await blankBridge.request('cad_ui', { action: 'snapshot' });
  const blankStarted: any = await blankBridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: blankUi.uiRevision,
    actions: [{ kind: 'project.newBlank' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const blankSummary: any = await blankBridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const blankVisible = await blankPage.evaluate(() => ({
    sketchVisible: !(document.getElementById('bw-sketch') as HTMLElement | null)?.hidden,
    title: document.getElementById('bw-sk-title')?.textContent,
    resultPolicy: (document.getElementById('bw-sk-result') as HTMLSelectElement | null)?.value,
    welcomeOpen: !(document.getElementById('bw-welcome') as HTMLElement | null)?.hidden,
  }));
  check('Start blank sketch creates a canonical empty project and opens the normal first-body editor without disconnecting',
    blankUi.surfaces.welcome.open === true &&
    blankStarted.snapshot.projectId !== blankBefore.result.projectId &&
    blankStarted.snapshot.documentRevision === 0 &&
    blankStarted.snapshot.activeCommand?.commandId === 'model.extrude' &&
    blankStarted.snapshot.activeCommand?.state === 'draft' &&
    blankSummary.result.schemaVersion === 5 &&
    blankSummary.result.counts.features === 0 &&
    blankSummary.result.counts.bodies === 0 &&
    blankVisible.sketchVisible === true &&
    blankVisible.title === 'New extrude' &&
    blankVisible.resultPolicy === 'new-body' &&
    blankVisible.welcomeOpen === false &&
    blankBridge.status().state === 'connected' &&
    blankErrors.length === 0,
    { blankStarted, blankSummary, blankVisible, status: blankBridge.status(), blankErrors });
  await blankBridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: blankStarted.uiRevision,
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  await blankBridge.close('Blank project check complete');
  await blankContext.close();

  const recoveryContext = await browser.createBrowserContext();
  const recoveryPage = await recoveryContext.newPage();
  await recoveryPage.setViewport({ width: 1440, height: 900 });
  const recoveryErrors: string[] = [];
  recoveryPage.on('pageerror', (error) => recoveryErrors.push(String(error)));
  await recoveryPage.evaluateOnNewDocument((fixture) => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(fixture));
  }, buildVisibleModelCommandFixture());
  await recoveryPage.goto(url, { waitUntil: 'domcontentloaded' });
  await recoveryPage.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const recoveryBridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 recovery restore agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: ['project.read', 'project.edit', 'project.recover', 'ui.read', 'ui.navigate'],
    },
  });
  await approveConnectionAsHuman(recoveryPage, 'V6 recovery restore agent');
  for (let attempt = 0; attempt < 600 && recoveryBridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const recoveryBase: any = await recoveryBridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const firstPreview: any = await recoveryBridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-recovery-first',
      label: 'Recovery checkpoint one',
      expectedRevision: recoveryBase.revision,
      operations: [{ kind: 'body.rename', input: { bodyId: RUNTIME_BODY_IDS.housing, name: 'Recovery housing one' } }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const firstCommitPromise = recoveryBridge.request('cad_commit', {
    previewId: firstPreview.previewId,
    expectedRevision: firstPreview.baseRevision,
  });
  await approveAgentPreviewAsHuman(recoveryPage, 'Recovery checkpoint one');
  const firstCommitted: any = await firstCommitPromise;
  const firstSummary: any = await recoveryBridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const secondPreview: any = await recoveryBridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-recovery-second',
      label: 'Recovery checkpoint two',
      expectedRevision: firstCommitted.revision,
      operations: [{ kind: 'body.rename', input: { bodyId: RUNTIME_BODY_IDS.housing, name: 'Recovery housing two' } }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const secondCommitPromise = recoveryBridge.request('cad_commit', {
    previewId: secondPreview.previewId,
    expectedRevision: secondPreview.baseRevision,
  });
  await approveAgentPreviewAsHuman(recoveryPage, 'Recovery checkpoint two');
  const secondCommitted: any = await secondCommitPromise;
  const secondSummary: any = await recoveryBridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  await recoveryPage.evaluate(async () => (window as any).__bwStudio.flushStorage());
  const recoveryUi: any = await recoveryBridge.request('cad_ui', { action: 'snapshot' });
  const recoveryOpened: any = await recoveryBridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: recoveryUi.uiRevision,
    actions: [{ kind: 'recovery.open' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const firstEntry = recoveryOpened.snapshot.surfaces.recovery.entries
    .find((entry: any) => entry.label === 'Recovery checkpoint one');
  const restored: any = await recoveryBridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: recoveryOpened.uiRevision,
    actions: [{ kind: 'recovery.restore', snapshotId: firstEntry.snapshotId }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const restoredSummary: any = await recoveryBridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const restoredPersistence = await recoveryPage.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const name = (project: any) =>
      project?.partDefinitions?.[0]?.bodies?.find((entry: any) => entry.id === 'body-feature-housing')?.name;
    return {
      localName: name(local),
      journalName: name(journal?.document),
      dialogOpen: Boolean((document.getElementById('bw-recover') as HTMLDialogElement | null)?.open),
    };
  });
  const recoveryUndo: any = await recoveryBridge.request('cad_history', {
    action: 'undo',
    expectedRevision: restored.snapshot.documentRevision,
  });
  const recoveryUndoSummary: any = await recoveryBridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('a semantic recovery entry restore is visible, persistent, session-safe, and normally undoable',
    firstEntry?.snapshotId &&
    recoveryOpened.snapshot.surfaces.recovery.open === true &&
    recoveryOpened.snapshot.surfaces.recovery.entries.length >= 2 &&
    restored.snapshot.surfaces.recovery.open === false &&
    restoredSummary.result.documentHash === firstSummary.result.documentHash &&
    restoredPersistence.localName === 'Recovery housing one' &&
    restoredPersistence.journalName === 'Recovery housing one' &&
    restoredPersistence.dialogOpen === false &&
    recoveryUndo.revision === restored.snapshot.documentRevision + 1 &&
    recoveryUndoSummary.result.documentHash === secondSummary.result.documentHash &&
    secondCommitted.revision + 1 === restored.snapshot.documentRevision &&
    recoveryBridge.status().state === 'connected' &&
    recoveryErrors.length === 0,
    {
      firstEntry,
      recoveryOpened: recoveryOpened.snapshot.surfaces.recovery,
      restored,
      restoredSummary,
      restoredPersistence,
      recoveryUndo,
      recoveryUndoSummary,
      status: recoveryBridge.status(),
      recoveryErrors,
    });
  await recoveryBridge.close('Recovery restore check complete');
  await recoveryContext.close();

  const importContext = await browser.createBrowserContext();
  const importPage = await importContext.newPage();
  await importPage.setViewport({ width: 1440, height: 900 });
  const importErrors: string[] = [];
  importPage.on('pageerror', (error) => importErrors.push(String(error)));
  await importPage.evaluateOnNewDocument(() => {
    localStorage.setItem('bw-studio-tour-v1', '1');
  });
  await importPage.goto(url, { waitUntil: 'domcontentloaded' });
  await importPage.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const importBridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 visible import agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: ['project.read', 'project.replace', 'artifact.export-step', 'ui.read', 'ui.wait-events'],
    },
  });
  await approveConnectionAsHuman(importPage, 'V6 visible import agent');
  for (let attempt = 0; attempt < 600 && importBridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const importUi: any = await importBridge.request('cad_ui', { action: 'snapshot' });
  const importCursor = (await importBridge.request('cad_events', { afterCursor: 0, limit: 500 }) as any).nextCursor;
  const importSource = Buffer.from(JSON.stringify({
    title: 'Agent imported project',
    units: 'mm',
    params: [],
    features: [{
      id: 'feature-agent-import',
      name: 'Imported mounting plate',
      type: 'extrude',
      sketch: { shapes: [{ kind: 'rect', x: 0, y: 0, w: 48, h: 32 }], z: 0 },
      h: 6,
      through: false,
    }],
  }, null, 2) + '\n');
  const transferId = 'import-' + randomUUID();
  const importSha256 = createHash('sha256').update(importSource).digest('hex');
  let invalidChunkCountCode = '';
  try {
    await importBridge.request('cad_artifact', {
      action: 'import.begin',
      transferId: 'import-' + randomUUID(),
      format: 'project',
      filename: 'invalid-chunk-count.bomcad.json',
      bytes: importSource.byteLength,
      sha256: importSha256,
      totalChunks: 2,
    });
  } catch (error: any) {
    invalidChunkCountCode = String(error?.code || '');
  }
  const invalidChunkTransferId = 'import-' + randomUUID();
  await importBridge.request('cad_artifact', {
    action: 'import.begin',
    transferId: invalidChunkTransferId,
    format: 'project',
    filename: 'invalid-chunk-size.bomcad.json',
    bytes: importSource.byteLength,
    sha256: importSha256,
    totalChunks: 1,
  });
  let invalidChunkSizeCode = '';
  try {
    await importBridge.request('cad_artifact', {
      action: 'import.chunk',
      transferId: invalidChunkTransferId,
      index: 0,
      dataBase64: Buffer.from('short').toString('base64'),
    });
  } catch (error: any) {
    invalidChunkSizeCode = String(error?.code || '');
  }
  await importBridge.request('cad_artifact', {
    action: 'import.abort',
    transferId: invalidChunkTransferId,
  });
  check('bounded import rejects inconsistent transfer metadata and chunk bytes before parsing or replacement',
    invalidChunkCountCode === 'INVALID_ARTIFACT_REQUEST' &&
    invalidChunkSizeCode === 'ARTIFACT_IMPORT_SIZE' &&
    importBridge.status().projectId === importUi.projectId &&
    importErrors.length === 0,
    { invalidChunkCountCode, invalidChunkSizeCode, status: importBridge.status(), importErrors });
  await importBridge.request('cad_artifact', {
    action: 'import.begin',
    transferId,
    format: 'project',
    filename: 'agent-import.bomcad.json',
    bytes: importSource.byteLength,
    sha256: importSha256,
    totalChunks: 1,
  });
  await importBridge.request('cad_artifact', {
    action: 'import.chunk',
    transferId,
    index: 0,
    dataBase64: importSource.toString('base64'),
  });
  const imported: any = await importBridge.request('cad_artifact', {
    action: 'import.commit',
    transferId,
  });
  const importedSummary: any = await importBridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const importEvents: any = await importBridge.request('cad_events', { afterCursor: importCursor, limit: 500 });
  const importVisible = await importPage.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    return {
      title: document.querySelector('.ws-document .ws-project-name')?.textContent,
      message: document.getElementById('bw-studio-msg')?.textContent,
      welcomeOpen: !(document.getElementById('bw-welcome') as HTMLElement | null)?.hidden,
      localTitle: local?.name || local?.title,
    };
  });
  check('welcome and Project Open share one integrity-checked import path that persists and preserves the approved session',
    importUi.surfaces.welcome.open === true &&
    imported.direction === 'import' &&
    imported.format === 'project' &&
    imported.bytes === importSource.byteLength &&
    imported.sha256 === importSha256 &&
    imported.projectId === importedSummary.result.projectId &&
    imported.documentHash === importedSummary.result.documentHash &&
    importedSummary.result.name === 'Agent imported project' &&
    importedSummary.result.counts.features === 1 &&
    importVisible.title === 'Agent imported project' &&
    importVisible.message === 'Project opened.' &&
    importVisible.welcomeOpen === false &&
    importVisible.localTitle === 'Agent imported project' &&
    importBridge.status().state === 'connected' &&
    importBridge.status().projectId === imported.projectId &&
    importBridge.status().uiRevision === imported.uiRevision &&
    importEvents.events.some((entry: any) =>
      entry.kind === 'artifact.completed' &&
      entry.payload?.direction === 'import' &&
      entry.payload?.sha256 === importSha256) &&
    importErrors.length === 0,
    { imported, importedSummary, importVisible, status: importBridge.status(), importEvents, importErrors });

  const exportedForStepImport: any = await importBridge.request('cad_artifact', {
    format: 'step',
    scope: 'visible-model',
  });
  const stepSource = Buffer.from(exportedForStepImport.dataBase64, 'base64');
  const stepTransferId = 'import-' + randomUUID();
  const stepChunkBytes = 192 * 1024;
  const stepTotalChunks = Math.ceil(stepSource.byteLength / stepChunkBytes);
  await importBridge.request('cad_artifact', {
    action: 'import.begin',
    transferId: stepTransferId,
    format: 'step',
    filename: 'agent-roundtrip.step',
    bytes: stepSource.byteLength,
    sha256: exportedForStepImport.sha256,
    totalChunks: stepTotalChunks,
  });
  for (let index = 0; index < stepTotalChunks; index++) {
    await importBridge.request('cad_artifact', {
      action: 'import.chunk',
      transferId: stepTransferId,
      index,
      dataBase64: stepSource
        .subarray(index * stepChunkBytes, Math.min(stepSource.byteLength, (index + 1) * stepChunkBytes))
        .toString('base64'),
    });
  }
  const stepImported: any = await importBridge.request('cad_artifact', {
    action: 'import.commit',
    transferId: stepTransferId,
  });
  const stepImportedSummary: any = await importBridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('the same bounded Open adapter round-trips exact STEP and exposes its kernel import manifest',
    stepSource.byteLength === exportedForStepImport.bytes &&
    createHash('sha256').update(stepSource).digest('hex') === exportedForStepImport.sha256 &&
    stepImported.direction === 'import' &&
    stepImported.format === 'step' &&
    stepImported.bytes === stepSource.byteLength &&
    stepImported.sha256 === exportedForStepImport.sha256 &&
    stepImported.projectId !== imported.projectId &&
    stepImported.projectId === stepImportedSummary.result.projectId &&
    stepImported.documentHash === stepImportedSummary.result.documentHash &&
    stepImported.importManifest?.bodyCount === 1 &&
    ['bomwiki-solved-hierarchy', 'external-product-hierarchy', 'flat-solid-fallback'].includes(stepImported.importManifest?.importMode) &&
    importBridge.status().state === 'connected' &&
    importBridge.status().projectId === stepImported.projectId &&
    importErrors.length === 0,
    { exportedForStepImport: { ...exportedForStepImport, dataBase64: undefined }, stepImported, stepImportedSummary, status: importBridge.status(), importErrors });
  await importBridge.close('Visible import check complete');
  await importContext.close();

  const legacyContext = await browser.createBrowserContext();
  const legacyPage = await legacyContext.newPage();
  await legacyPage.setViewport({ width: 1280, height: 800 });
  const legacyErrors: string[] = [];
  legacyPage.on('pageerror', (error) => legacyErrors.push(String(error)));
  await legacyPage.evaluateOnNewDocument((fixture) => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(fixture));
    localStorage.setItem('bw-studio-scene-v1', '{"legacy":true}');
    localStorage.removeItem('bw-studio-v1-notice');
  }, buildVisibleModelCommandFixture());
  await legacyPage.goto(url, { waitUntil: 'domcontentloaded' });
  await legacyPage.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  await legacyPage.waitForSelector('#bw-v1-notice-dismiss');
  const legacyBridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 legacy notice agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: { granted: ['project.read', 'ui.read', 'ui.navigate'] },
  });
  await approveConnectionAsHuman(legacyPage, 'V6 legacy notice agent');
  for (let attempt = 0; attempt < 600 && legacyBridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const legacyBefore: any = await legacyBridge.request('cad_ui', { action: 'snapshot' });
  const legacyDismissed: any = await legacyBridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: legacyBefore.uiRevision,
    actions: [{ kind: 'control.invoke', controlId: 'notice.legacy-dismiss' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const legacyVisible = await legacyPage.evaluate(() => ({
    noticePresent: Boolean(document.getElementById('bw-v1-notice')),
    dismissed: localStorage.getItem('bw-studio-v1-notice'),
    legacyPreserved: localStorage.getItem('bw-studio-scene-v1'),
  }));
  check('the conditional legacy-project notice is directly dismissible without deleting legacy data or editing the CAD document',
    legacyDismissed.snapshot.documentRevision === legacyBefore.documentRevision &&
    legacyVisible.noticePresent === false &&
    legacyVisible.dismissed === '1' &&
    legacyVisible.legacyPreserved === '{"legacy":true}' &&
    legacyErrors.length === 0,
    { legacyDismissed, legacyVisible, legacyErrors });
  await legacyBridge.close('Legacy notice check complete');
  await legacyContext.close();

  const exitContext = await browser.createBrowserContext();
  const exitPage = await exitContext.newPage();
  await exitPage.setViewport({ width: 1280, height: 800 });
  const exitErrors: string[] = [];
  exitPage.on('pageerror', (error) => exitErrors.push(String(error)));
  await exitPage.evaluateOnNewDocument((fixture) => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(fixture));
  }, buildVisibleModelCommandFixture());
  await exitPage.goto(url, { waitUntil: 'domcontentloaded' });
  await exitPage.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const exitBridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 exit navigation agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: { granted: ['project.read', 'ui.read', 'ui.navigate'] },
  });
  await approveConnectionAsHuman(exitPage, 'V6 exit navigation agent');
  for (let attempt = 0; attempt < 600 && exitBridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const exitUi: any = await exitBridge.request('cad_ui', { action: 'snapshot' });
  const exited: any = await exitBridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: exitUi.uiRevision,
    actions: [{ kind: 'application.navigate', target: 'cad-home' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  await exitPage.waitForFunction(() => location.pathname === '/cad', { polling: 25, timeout: 10_000 });
  for (let attempt = 0; attempt < 200 && exitBridge.status().state === 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  check('Exit Studio settles its structured response before following the normal visible CAD-start navigation',
    exited.results?.[0]?.result?.target === 'cad-home' &&
    exited.results?.[0]?.result?.navigationPending === true &&
    new URL(exitPage.url()).pathname === '/cad' &&
    ['recovering', 'closed'].includes(String(exitBridge.status().state)) &&
    exitErrors.length === 0,
    { exited, url: exitPage.url(), status: exitBridge.status(), exitErrors });
  await exitBridge.close('Exit navigation check complete');
  await exitContext.close();
}

async function persistentAssemblyControlChecks(browser: Browser, url: string) {
  console.log('\nCAD Studio V6 persistent assembly controls and inspector command redirects');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  let fixture = buildRobotJointFixture().project;
  const assembly = fixture.assemblyDefinitions.find((entry: any) => entry.id === fixture.rootDocument.assemblyId);
  for (const occurrence of assembly?.occurrences || []) occurrence.fixed = false;
  const coverPart = fixture.partDefinitions.find((entry: any) => entry.id === 'part-robot-cover');
  if (coverPart) coverPart.parameters = [{
    id: 'parameter-assembly-control-cover',
    name: 'clearance',
    value: 0.25,
    description: 'Inspector variant command redirect regression',
  }];
  fixture = createStudioV5AssemblyMate(fixture, {
    id: 'mate-assembly-control-bearing-distance',
    name: 'Robot bearing axial station',
    kind: 'distance',
    value: 18,
    occurrenceIds: ['occurrence-robot-shaft', 'occurrence-robot-bearing'],
    references: [
      {
        ownerKind: 'datum',
        ownerId: 'datum-robot-shaft-station',
        occurrencePath: ['occurrence-robot-shaft'],
        semanticPath: { role: 'anchor' },
        signature: { role: 'anchor' },
      },
      {
        ownerKind: 'datum',
        ownerId: 'datum-robot-bearing-station',
        occurrencePath: ['occurrence-robot-bearing'],
        semanticPath: { role: 'moving' },
        signature: { role: 'moving' },
      },
    ],
  });
  await page.evaluateOnNewDocument((documentFixture) => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(documentFixture));
  }, fixture);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const bridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 assembly control agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: [
        'project.read', 'project.edit',
        'ui.read', 'ui.select', 'ui.navigate',
        'ui.command-draft', 'ui.present-preview', 'ui.wait-events',
      ],
    },
  });
  await approveConnectionAsHuman(page, 'V6 assembly control agent');
  for (let attempt = 0; attempt < 600 && bridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const base: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const editPreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-persistent-assembly-edit',
      label: 'Edit assembly presentation and solve participation',
      expectedRevision: base.revision,
      operations: [
        { kind: 'component.update', input: { occurrenceId: 'occurrence-robot-cover', patch: { visible: false } } },
        { kind: 'component.update', input: { occurrenceId: 'occurrence-robot-motor', patch: { suppressed: true } } },
        { kind: 'mate.update', input: { mateId: 'mate-assembly-control-bearing-distance', patch: { suppressed: true } } },
      ],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const editPreviewSnapshot: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const editPreviewSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const visibleEditPreview = await page.evaluate(() => ({
    dialogOpen: Boolean((document.getElementById('bw-v5-command') as HTMLDialogElement | null)?.open),
    operationKinds: [...(document.getElementById('bw-v5-command-fields')?.querySelectorAll('li') || [])]
      .map((entry) => (entry as HTMLElement).dataset.operationKind),
    operationText: [...(document.getElementById('bw-v5-command-fields')?.querySelectorAll('li') || [])]
      .map((entry) => entry.textContent),
    previewText: document.getElementById('bw-v6-command-preview')?.textContent,
  }));
  check('assembly visibility, suppression, and mate suppression use one visible exact preview without mutation',
    editPreview.visible === true &&
    editPreview.validation?.valid === true &&
    editPreview.validation?.exactGeometry === true &&
    editPreviewSnapshot.documentRevision === base.revision &&
    editPreviewSnapshot.activeCommand?.commandId === 'document.transaction' &&
    editPreviewSnapshot.preview?.previewId === editPreview.previewId &&
    editPreviewSummary.result.documentHash === base.result.documentHash &&
    visibleEditPreview.dialogOpen === true &&
    visibleEditPreview.operationKinds.join(',') === 'component.update,component.update,mate.update' &&
    visibleEditPreview.operationText.join('|') ===
      'Hide Robot joint cover:1|Suppress Robot joint motor:1|Suppress Robot bearing axial station' &&
    /Exact validation passed/.test(visibleEditPreview.previewText || ''),
    { editPreview, editPreviewSnapshot, visibleEditPreview });

  const editCommitPromise = bridge.request('cad_commit', {
    previewId: editPreview.previewId,
    expectedRevision: editPreview.baseRevision,
  });
  const editApprovalVisible = await approveAgentPreviewAsHuman(page, 'Edit assembly presentation and solve participation');
  const editCommitted: any = await editCommitPromise;
  const [editedCover, editedMotor, editedMate] = await Promise.all([
    bridge.request('cad_inspect', { query: { kind: 'entity.detail', entity: { kind: 'occurrence', id: 'occurrence-robot-cover' } } }),
    bridge.request('cad_inspect', { query: { kind: 'entity.detail', entity: { kind: 'occurrence', id: 'occurrence-robot-motor' } } }),
    bridge.request('cad_inspect', { query: { kind: 'entity.detail', entity: { kind: 'mate', id: 'mate-assembly-control-bearing-distance' } } }),
  ]) as any[];
  const editPersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const state = (project: any) => {
      const assembly = project?.assemblyDefinitions?.find((entry: any) => entry.id === project.rootDocument?.assemblyId);
      return {
        coverVisible: assembly?.occurrences?.find((entry: any) => entry.id === 'occurrence-robot-cover')?.visible,
        motorSuppressed: assembly?.occurrences?.find((entry: any) => entry.id === 'occurrence-robot-motor')?.suppressed,
        mateSuppressed: assembly?.mates?.find((entry: any) => entry.id === 'mate-assembly-control-bearing-distance')?.suppressed,
      };
    };
    return { local: state(local), journal: state(journal?.document), journalRevision: journal?.commandRevision };
  });
  const visibleEditCommit = await page.evaluate(() => ({
    coverAria: document.querySelector('[data-occurrence-id="occurrence-robot-cover"]')?.getAttribute('aria-label'),
    motorClass: document.querySelector('[data-occurrence-id="occurrence-robot-motor"]')?.className,
    mateClass: document.querySelector('[data-mate-id="mate-assembly-control-bearing-distance"]')?.className,
  }));
  check('approved assembly state edit commits atomically, renders in the normal tree, and persists',
    editApprovalVisible === true &&
    editCommitted.revision === base.revision + 1 &&
    editedCover.result.value.visible === false &&
    editedMotor.result.value.suppressed === true &&
    editedMate.result.value.suppressed === true &&
    editPersistence.local.coverVisible === false &&
    editPersistence.local.motorSuppressed === true &&
    editPersistence.local.mateSuppressed === true &&
    editPersistence.journal.coverVisible === false &&
    editPersistence.journal.motorSuppressed === true &&
    editPersistence.journal.mateSuppressed === true &&
    editPersistence.journalRevision === editCommitted.revision &&
    /hidden/.test(visibleEditCommit.coverAria || '') &&
    /is-suppressed/.test(visibleEditCommit.motorClass || '') &&
    /is-suppressed/.test(visibleEditCommit.mateClass || ''),
    { editCommitted, editedCover, editedMotor, editedMate, editPersistence, visibleEditCommit });
  const editUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: editCommitted.revision,
  });
  const editUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('normal Undo restores the exact assembly presentation and solver document',
    editUndo.revision === editCommitted.revision + 1 &&
    editUndoSummary.result.documentHash === base.result.documentHash,
    { editUndo, editUndoSummary });

  const deletePreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-persistent-assembly-delete',
      label: 'Delete a mate and component occurrence',
      expectedRevision: editUndo.revision,
      operations: [
        { kind: 'mate.delete', input: { mateId: 'mate-assembly-control-bearing-distance' } },
        { kind: 'component.delete', input: { occurrenceId: 'occurrence-robot-cover' } },
      ],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const deletePreviewTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const visibleDeletePreview = await page.evaluate(() =>
    document.getElementById('bw-v6-command-preview')?.textContent || '');
  check('assembly deletion remains visibly exact-previewed and confirmation-gated before mutation',
    deletePreview.visible === true &&
    deletePreview.validation?.valid === true &&
    deletePreview.confirmation?.required === true &&
    deletePreview.changeSet.deleted.some((entry: any) => entry.kind === 'mate' && entry.id === 'mate-assembly-control-bearing-distance') &&
    deletePreview.changeSet.deleted.some((entry: any) => entry.kind === 'occurrence' && entry.id === 'occurrence-robot-cover') &&
    deletePreviewTree.result.items.some((entry: any) => entry.id === 'mate-assembly-control-bearing-distance') &&
    deletePreviewTree.result.items.some((entry: any) => entry.id === 'occurrence-robot-cover') &&
    /Confirmation is required for this destructive change/.test(visibleDeletePreview),
    { deletePreview, deletePreviewTree, visibleDeletePreview });
  const deleteCommitPromise = bridge.request('cad_commit', {
    previewId: deletePreview.previewId,
    expectedRevision: deletePreview.baseRevision,
  });
  const deleteApprovalVisible = await approveAgentPreviewAsHuman(page, 'Delete a mate and component occurrence');
  const deleteCommitted: any = await deleteCommitPromise;
  const deletedTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const deletePersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const assembly = local?.assemblyDefinitions?.find((entry: any) => entry.id === local.rootDocument?.assemblyId);
    return {
      hasCover: assembly?.occurrences?.some((entry: any) => entry.id === 'occurrence-robot-cover'),
      hasMate: assembly?.mates?.some((entry: any) => entry.id === 'mate-assembly-control-bearing-distance'),
    };
  });
  check('approved assembly deletion removes normal editable structure, persists, and stays undoable',
    deleteApprovalVisible === true &&
    deleteCommitted.revision === editUndo.revision + 1 &&
    !deletedTree.result.items.some((entry: any) => entry.id === 'mate-assembly-control-bearing-distance') &&
    !deletedTree.result.items.some((entry: any) => entry.id === 'occurrence-robot-cover') &&
    deletePersistence.hasCover === false &&
    deletePersistence.hasMate === false,
    { deleteCommitted, deletedTree, deletePersistence });
  const deleteUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: deleteCommitted.revision,
  });
  const restoredTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  check('Undo restores the deleted assembly occurrence and mate with stable IDs',
    deleteUndo.revision === deleteCommitted.revision + 1 &&
    restoredTree.result.items.some((entry: any) => entry.id === 'mate-assembly-control-bearing-distance') &&
    restoredTree.result.items.some((entry: any) => entry.id === 'occurrence-robot-cover'),
    { deleteUndo, restoredTree });

  let uiState: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const mateEditOpen: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: uiState.uiRevision,
    actions: [
      { kind: 'tree.invoke', entity: { kind: 'mate', id: 'mate-assembly-control-bearing-distance' }, operation: 'mate.select' },
      { kind: 'command.open', commandId: 'assembly.mate.distance' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const mateEditVisible = await page.evaluate(() => ({
    command: (document.getElementById('bw-v5-command') as HTMLDialogElement | null)?.dataset.command,
    mateId: (document.getElementById('bw-v5-command') as HTMLDialogElement | null)?.dataset.mateId,
  }));
  uiState = (await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: mateEditOpen.uiRevision,
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  }) as any).snapshot;
  const redirectResults = [{
    operation: 'mate.edit',
    commandId: mateEditOpen.snapshot.activeCommand?.commandId,
    visible: mateEditVisible.command === 'assembly-mate' && mateEditVisible.mateId === 'mate-assembly-control-bearing-distance',
  }];
  for (const [operation, commandId] of [
    ['occurrence.edit-context', 'assembly.edit-context'],
    ['occurrence.variant', 'assembly.variant'],
    ['occurrence.independent', 'assembly.independent'],
    ['occurrence.transform', 'assembly.component-transform'],
    ['occurrence.linked', 'assembly.linked'],
  ] as const) {
    const opened: any = await bridge.request('cad_ui', {
      action: 'apply',
      expectedUiRevision: uiState.uiRevision,
      actions: [
        { kind: 'tree.invoke', entity: { kind: 'occurrence', id: 'occurrence-robot-cover' }, operation: 'occurrence.select' },
        { kind: 'command.open', commandId },
      ],
      presentation: { mode: 'instant', transition: 'cut' },
    });
    const visible = await page.evaluate(() =>
      Boolean((document.getElementById('bw-v5-command') as HTMLDialogElement | null)?.open));
    redirectResults.push({
      operation,
      commandId: opened.snapshot.activeCommand?.commandId,
      visible,
    });
    uiState = (await bridge.request('cad_ui', {
      action: 'apply',
      expectedUiRevision: opened.uiRevision,
      actions: [{ kind: 'command.cancel' }],
      presentation: { mode: 'instant', transition: 'cut' },
    }) as any).snapshot;
  }
  check('inspector edit controls resolve selected mate and occurrence state into all six normal command panels',
    redirectResults.length === 6 &&
    redirectResults.every((entry) => entry.visible) &&
    redirectResults.map((entry) => entry.commandId).join(',') ===
      'assembly.mate.distance,assembly.edit-context,assembly.variant,assembly.independent,assembly.component-transform,assembly.linked' &&
    pageErrors.length === 0,
    { redirectResults, pageErrors });

  await bridge.close('Persistent assembly control checks complete');
  await context.close();
}

async function persistentParameterControlChecks(browser: Browser, url: string) {
  console.log('\nCAD Studio V6 persistent parameter controls');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const fixture = createThreeBodyRuntimeProject({
    boolean: false,
    projectId: 'project-v6-parameter-controls',
  });
  fixture.parameters = [{
    id: 'parameter-span',
    name: 'span',
    value: 42,
    description: 'Stable parameter control regression',
  }];
  await page.evaluateOnNewDocument((documentFixture) => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(documentFixture));
  }, fixture);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const bridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 parameter control agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: [
        'project.read', 'project.edit',
        'ui.read', 'ui.select', 'ui.navigate',
        'ui.command-draft', 'ui.present-preview', 'ui.wait-events',
      ],
    },
  });
  await approveConnectionAsHuman(page, 'V6 parameter control agent');
  for (let attempt = 0; attempt < 600 && bridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const base: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const createPreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-parameter-create',
      label: 'Create editable clearance parameter',
      expectedRevision: base.revision,
      operations: [{
        kind: 'parameter.create',
        input: { id: 'parameter-agent-clearance', name: 'clearance', value: 0.5 },
      }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const createPreviewSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const createPreviewUi: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const visibleCreatePreview = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-parameter-id="parameter-agent-clearance"]');
    return {
      dialogOpen: Boolean((document.getElementById('bw-v5-command') as HTMLDialogElement | null)?.open),
      operationText: document.getElementById('bw-v5-command-fields')?.querySelector('li')?.textContent,
      rowDraft: row?.dataset.agentDraft,
      name: (row?.querySelector('[data-preview-parameter-name]') as HTMLInputElement | null)?.value,
      value: (row?.querySelector('[data-preview-parameter-value]') as HTMLInputElement | null)?.value,
      previewText: document.getElementById('bw-v6-command-preview')?.textContent,
    };
  });
  check('parameter creation uses the normal visible exact-preview surface without mutating the document',
    createPreview.visible === true &&
    createPreview.validation?.valid === true &&
    createPreview.validation?.exactGeometry === true &&
    createPreviewSummary.result.documentHash === base.result.documentHash &&
    createPreviewUi.documentRevision === base.revision &&
    createPreviewUi.activeCommand?.commandId === 'document.transaction' &&
    visibleCreatePreview.dialogOpen === true &&
    visibleCreatePreview.operationText === 'Create parameter clearance = 0.5' &&
    visibleCreatePreview.rowDraft === 'create' &&
    visibleCreatePreview.name === 'clearance' &&
    visibleCreatePreview.value === '0.5' &&
    /Exact validation passed/.test(visibleCreatePreview.previewText || ''),
    { createPreview, createPreviewUi, visibleCreatePreview });

  const createCommitPromise = bridge.request('cad_commit', {
    previewId: createPreview.previewId,
    expectedRevision: createPreview.baseRevision,
  });
  const createApprovalVisible = await approveAgentPreviewAsHuman(page, 'Create editable clearance parameter');
  const createCommitted: any = await createCommitPromise;
  const createdParameter: any = await bridge.request('cad_inspect', {
    query: { kind: 'entity.detail', entity: { kind: 'parameter', id: 'parameter-agent-clearance' } },
  });
  const createPersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const find = (project: any) => project?.parameters?.find((entry: any) => entry.id === 'parameter-agent-clearance');
    return {
      local: find(local),
      journal: find(journal?.document),
      journalRevision: journal?.commandRevision,
      visible: Boolean(document.querySelector('[data-parameter-id="parameter-agent-clearance"]')),
    };
  });
  check('approved parameter creation commits, renders, and persists to local and recovery storage',
    createApprovalVisible === true &&
    createCommitted.revision === base.revision + 1 &&
    createdParameter.result.value.name === 'clearance' &&
    createdParameter.result.value.value === 0.5 &&
    createPersistence.local?.value === 0.5 &&
    createPersistence.journal?.value === 0.5 &&
    createPersistence.journalRevision === createCommitted.revision &&
    createPersistence.visible === true,
    { createCommitted, createdParameter, createPersistence });

  const postCreate: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const updatePreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-parameter-update-cancel',
      label: 'Preview parameter rename and value',
      expectedRevision: postCreate.revision,
      operations: [{
        kind: 'parameter.update',
        input: { parameterId: 'parameter-agent-clearance', name: 'running_clearance', value: 0.75 },
      }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const visibleUpdatePreview = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-parameter-id="parameter-agent-clearance"]');
    return {
      rowDraft: row?.dataset.agentDraft,
      name: (row?.querySelector('[data-pname]') as HTMLInputElement | null)?.value,
      value: (row?.querySelector('[data-pval]') as HTMLInputElement | null)?.value,
      aria: row?.getAttribute('aria-label'),
    };
  });
  const updatePreviewUi: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const cancelledUpdate: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: updatePreviewUi.uiRevision,
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const afterCancelSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const visibleAfterCancel = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-parameter-id="parameter-agent-clearance"]');
    return {
      rowDraft: row?.dataset.agentDraft,
      name: (row?.querySelector('[data-pname]') as HTMLInputElement | null)?.value,
      value: (row?.querySelector('[data-pval]') as HTMLInputElement | null)?.value,
      dialogOpen: Boolean((document.getElementById('bw-v5-command') as HTMLDialogElement | null)?.open),
    };
  });
  check('parameter rename and value preview populate the real row and Cancel restores it exactly',
    updatePreview.visible === true &&
    visibleUpdatePreview.rowDraft === 'update' &&
    visibleUpdatePreview.name === 'running_clearance' &&
    visibleUpdatePreview.value === '0.75' &&
    /running_clearance = 0.75/.test(visibleUpdatePreview.aria || '') &&
    cancelledUpdate.snapshot.documentRevision === postCreate.revision &&
    afterCancelSummary.result.documentHash === postCreate.result.documentHash &&
    visibleAfterCancel.rowDraft === undefined &&
    visibleAfterCancel.name === 'clearance' &&
    visibleAfterCancel.value === '0.5' &&
    visibleAfterCancel.dialogOpen === false,
    { updatePreview, visibleUpdatePreview, cancelledUpdate, visibleAfterCancel });

  const committedUpdatePreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-parameter-update',
      label: 'Update editable clearance parameter',
      expectedRevision: postCreate.revision,
      operations: [{
        kind: 'parameter.update',
        input: { parameterId: 'parameter-agent-clearance', name: 'running_clearance', value: 0.75 },
      }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const updateCommitPromise = bridge.request('cad_commit', {
    previewId: committedUpdatePreview.previewId,
    expectedRevision: committedUpdatePreview.baseRevision,
  });
  const updateApprovalVisible = await approveAgentPreviewAsHuman(page, 'Update editable clearance parameter');
  const updateCommitted: any = await updateCommitPromise;
  const updatePersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const find = (project: any) => project?.parameters?.find((entry: any) => entry.id === 'parameter-agent-clearance');
    const row = document.querySelector<HTMLElement>('[data-parameter-id="parameter-agent-clearance"]');
    return {
      local: find(local),
      journal: find(journal?.document),
      name: (row?.querySelector('[data-pname]') as HTMLInputElement | null)?.value,
      value: (row?.querySelector('[data-pval]') as HTMLInputElement | null)?.value,
    };
  });
  const updateUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: updateCommitted.revision,
  });
  const updateUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('approved parameter rename and value commit atomically, persist, and Undo to the exact prior hash',
    updateApprovalVisible === true &&
    updateCommitted.revision === postCreate.revision + 1 &&
    updatePersistence.local?.name === 'running_clearance' &&
    updatePersistence.local?.value === 0.75 &&
    updatePersistence.journal?.name === 'running_clearance' &&
    updatePersistence.journal?.value === 0.75 &&
    updatePersistence.name === 'running_clearance' &&
    updatePersistence.value === '0.75' &&
    updateUndo.revision === updateCommitted.revision + 1 &&
    updateUndoSummary.result.documentHash === postCreate.result.documentHash,
    { updateCommitted, updatePersistence, updateUndo, updateUndoSummary });

  const deletePreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-parameter-delete',
      label: 'Delete obsolete span parameter',
      expectedRevision: updateUndo.revision,
      operations: [{ kind: 'parameter.delete', input: { parameterId: 'parameter-span' } }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const deletePreviewSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const visibleDeletePreview = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-parameter-id="parameter-span"]');
    return {
      rowDraft: row?.dataset.agentDraft,
      aria: row?.getAttribute('aria-label'),
      deleteMarker: row?.querySelector('[data-agent-delete-preview]')?.getAttribute('data-agent-delete-preview'),
      previewText: document.getElementById('bw-v6-command-preview')?.textContent,
    };
  });
  check('parameter deletion remains visibly marked, confirmation-gated, and non-mutating before approval',
    deletePreview.visible === true &&
    deletePreview.confirmation?.required === true &&
    deletePreview.changeSet.deleted.some((entry: any) => entry.kind === 'parameter' && entry.id === 'parameter-span') &&
    deletePreviewSummary.result.documentHash === postCreate.result.documentHash &&
    visibleDeletePreview.rowDraft === 'delete' &&
    visibleDeletePreview.aria === 'Preview deletion of parameter span' &&
    visibleDeletePreview.deleteMarker === 'true' &&
    /Confirmation is required for this destructive change/.test(visibleDeletePreview.previewText || ''),
    { deletePreview, visibleDeletePreview });
  const deleteCommitPromise = bridge.request('cad_commit', {
    previewId: deletePreview.previewId,
    expectedRevision: deletePreview.baseRevision,
  });
  const deleteApprovalVisible = await approveAgentPreviewAsHuman(page, 'Delete obsolete span parameter');
  const deleteCommitted: any = await deleteCommitPromise;
  const deletedTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const deletePersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const has = (project: any) => project?.parameters?.some((entry: any) => entry.id === 'parameter-span');
    return {
      localHas: has(local),
      journalHas: has(journal?.document),
      visible: Boolean(document.querySelector('[data-parameter-id="parameter-span"]')),
    };
  });
  const deleteUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: deleteCommitted.revision,
  });
  const restoredTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  check('approved parameter deletion persists and normal Undo restores its stable identity',
    deleteApprovalVisible === true &&
    !deletedTree.result.items.some((entry: any) => entry.kind === 'parameter' && entry.id === 'parameter-span') &&
    deletePersistence.localHas === false &&
    deletePersistence.journalHas === false &&
    deletePersistence.visible === false &&
    deleteUndo.revision === deleteCommitted.revision + 1 &&
    restoredTree.result.items.some((entry: any) => entry.kind === 'parameter' && entry.id === 'parameter-span') &&
    pageErrors.length === 0,
    { deleteCommitted, deletedTree, deletePersistence, deleteUndo, restoredTree, pageErrors });

  await bridge.close('Persistent parameter control checks complete');
  await context.close();
}

async function persistentFeatureControlChecks(browser: Browser, url: string) {
  console.log('\nCAD Studio V6 persistent feature controls and feature editor redirects');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  let fixture = createThreeBodyRuntimeProject({
    boolean: false,
    projectId: 'project-v6-feature-controls',
  });
  fixture = configureStudioV5Feature(fixture, {
    id: 'feature-control-cut',
    name: 'Vent cut',
    type: 'cut',
    sketch: { shapes: [{ kind: 'circle', x: 10, y: 10, r: 2 }], z: 20 },
    h: 20,
    through: true,
    resultPolicy: { kind: 'subtract', targetBodyIds: [RUNTIME_BODY_IDS.housing], keepTools: false },
  }, {
    resultPolicy: { kind: 'subtract', targetBodyIds: [RUNTIME_BODY_IDS.housing], keepTools: false },
  });
  await page.evaluateOnNewDocument((documentFixture) => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(documentFixture));
  }, fixture);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const bridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 feature control agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: [
        'project.read', 'project.edit',
        'ui.read', 'ui.select', 'ui.navigate',
        'ui.command-draft', 'ui.present-preview', 'ui.wait-events',
      ],
    },
  });
  await approveConnectionAsHuman(page, 'V6 feature control agent');
  for (let attempt = 0; attempt < 600 && bridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  let uiState: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const createBodyOpen: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: uiState.uiRevision,
    actions: [{ kind: 'control.invoke', controlId: 'body.create' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const visibleCreateBody = await page.evaluate(() => ({
    sketchVisible: !(document.getElementById('bw-sketch') as HTMLElement | null)?.hidden,
    title: document.getElementById('bw-sk-title')?.textContent,
    result: (document.getElementById('bw-sk-result') as HTMLSelectElement | null)?.value,
    bodyName: (document.getElementById('bw-sk-body-name') as HTMLInputElement | null)?.value,
  }));
  check('Create body opens the real extrude editor in explicit new-body mode with the normal next body name',
    createBodyOpen.snapshot.activeCommand?.commandId === 'model.extrude' &&
    createBodyOpen.snapshot.activeCommand?.state === 'draft' &&
    visibleCreateBody.sketchVisible === true &&
    visibleCreateBody.title === 'New extrude' &&
    visibleCreateBody.result === 'new-body' &&
    visibleCreateBody.bodyName === 'Body 4',
    { createBodyOpen, visibleCreateBody });
  uiState = (await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: createBodyOpen.uiRevision,
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  }) as any).snapshot;

  const dimensionEditOpen: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: uiState.uiRevision,
    actions: [
      { kind: 'selection.set', entity: { kind: 'feature', id: RUNTIME_FEATURE_IDS.shaft } },
      { kind: 'command.open', commandId: 'model.extrude' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const visibleDimensionEdit = await page.evaluate(() => ({
    title: document.getElementById('bw-sk-title')?.textContent,
    height: (document.getElementById('bw-sk-op-h') as HTMLInputElement | null)?.value,
  }));
  uiState = (await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: dimensionEditOpen.uiRevision,
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  }) as any).snapshot;
  const cutEditOpen: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: uiState.uiRevision,
    actions: [
      { kind: 'selection.set', entity: { kind: 'feature', id: 'feature-control-cut' } },
      { kind: 'command.open', commandId: 'model.cut' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const visibleCutEdit = await page.evaluate(() => ({
    title: document.getElementById('bw-sk-title')?.textContent,
    through: (document.getElementById('bw-sk-through') as HTMLInputElement | null)?.checked,
  }));
  uiState = (await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: cutEditOpen.uiRevision,
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  }) as any).snapshot;
  check('selected-feature redirects open the existing normal editor with dimension and through fields populated',
    dimensionEditOpen.snapshot.activeCommand?.commandId === 'model.extrude' &&
    visibleDimensionEdit.title === 'Edit extrude' &&
    visibleDimensionEdit.height === '20' &&
    cutEditOpen.snapshot.activeCommand?.commandId === 'model.cut' &&
    visibleCutEdit.title === 'Edit cut' &&
    visibleCutEdit.through === true,
    { dimensionEditOpen, visibleDimensionEdit, cutEditOpen, visibleCutEdit });

  const base: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const reorderPreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-feature-reorder',
      label: 'Move shaft feature before housing',
      expectedRevision: base.revision,
      operations: [{
        kind: 'feature.reorder',
        input: { featureId: RUNTIME_FEATURE_IDS.shaft, beforeFeatureId: RUNTIME_FEATURE_IDS.housing },
      }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const reorderPreviewSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const reorderVisiblePreview = await page.evaluate(() => ({
    operationText: document.getElementById('bw-v5-command-fields')?.querySelector('li')?.textContent,
    firstFeatureId: document.querySelector('#bw-history .hist-item')?.getAttribute('data-sel'),
  }));
  const reorderCommitPromise = bridge.request('cad_commit', {
    previewId: reorderPreview.previewId,
    expectedRevision: reorderPreview.baseRevision,
  });
  const reorderApprovalVisible = await approveAgentPreviewAsHuman(page, 'Move shaft feature before housing');
  const reorderCommitted: any = await reorderCommitPromise;
  const reorderPersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    return {
      localOrder: local?.partDefinitions?.[0]?.featureOrder,
      journalOrder: journal?.document?.partDefinitions?.[0]?.featureOrder,
      firstFeatureId: document.querySelector('#bw-history .hist-item')?.getAttribute('data-sel'),
    };
  });
  const reorderUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: reorderCommitted.revision,
  });
  const reorderUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('feature reorder previews without mutation, commits through approval, persists, renders, and undoes exactly',
    reorderPreview.visible === true &&
    reorderPreviewSummary.result.documentHash === base.result.documentHash &&
    reorderVisiblePreview.operationText === 'Move Shaft extrude before Housing extrude' &&
    reorderVisiblePreview.firstFeatureId === RUNTIME_FEATURE_IDS.housing &&
    reorderApprovalVisible === true &&
    reorderPersistence.localOrder?.[0] === RUNTIME_FEATURE_IDS.shaft &&
    reorderPersistence.journalOrder?.[0] === RUNTIME_FEATURE_IDS.shaft &&
    reorderPersistence.firstFeatureId === RUNTIME_FEATURE_IDS.shaft &&
    reorderUndo.revision === reorderCommitted.revision + 1 &&
    reorderUndoSummary.result.documentHash === base.result.documentHash,
    { reorderPreview, reorderVisiblePreview, reorderCommitted, reorderPersistence, reorderUndo });

  const rollbackPreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-feature-rollback',
      label: 'Set feature rollback marker',
      expectedRevision: reorderUndo.revision,
      operations: [{ kind: 'feature.rollback', input: { featureId: 'feature-control-cut' } }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const rollbackPreviewSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const rollbackCommitPromise = bridge.request('cad_commit', {
    previewId: rollbackPreview.previewId,
    expectedRevision: rollbackPreview.baseRevision,
  });
  const rollbackApprovalVisible = await approveAgentPreviewAsHuman(page, 'Set feature rollback marker');
  const rollbackCommitted: any = await rollbackCommitPromise;
  const rollbackPersistence = await page.evaluate(async (rollbackFeatureId) => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    return {
      local: local?.partDefinitions?.[0]?.metadata?.rollbackFeatureId,
      journal: journal?.document?.partDefinitions?.[0]?.metadata?.rollbackFeatureId,
      pressed: document.querySelector(`[data-rollback-feature="${rollbackFeatureId}"]`)?.getAttribute('aria-pressed'),
    };
  }, 'feature-control-cut');
  const rollbackUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: rollbackCommitted.revision,
  });
  const rollbackUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('feature rollback marker previews without mutation, persists visibly, and Undo restores the exact project',
    rollbackPreview.visible === true &&
    rollbackPreviewSummary.result.documentHash === base.result.documentHash &&
    rollbackApprovalVisible === true &&
    rollbackPersistence.local === 'feature-control-cut' &&
    rollbackPersistence.journal === 'feature-control-cut' &&
    rollbackPersistence.pressed === 'true' &&
    rollbackUndo.revision === rollbackCommitted.revision + 1 &&
    rollbackUndoSummary.result.documentHash === base.result.documentHash,
    { rollbackPreview, rollbackCommitted, rollbackPersistence, rollbackUndo });

  const deletePreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-feature-delete',
      label: 'Delete obsolete tool feature',
      expectedRevision: rollbackUndo.revision,
      operations: [{ kind: 'feature.delete', input: { featureId: RUNTIME_FEATURE_IDS.tool } }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const deletePreviewTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const deleteVisiblePreview = await page.evaluate(() => ({
    operationText: document.getElementById('bw-v5-command-fields')?.querySelector('li')?.textContent,
    previewText: document.getElementById('bw-v6-command-preview')?.textContent,
  }));
  const deleteCommitPromise = bridge.request('cad_commit', {
    previewId: deletePreview.previewId,
    expectedRevision: deletePreview.baseRevision,
  });
  const deleteApprovalVisible = await approveAgentPreviewAsHuman(page, 'Delete obsolete tool feature');
  const deleteCommitted: any = await deleteCommitPromise;
  const deletedTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const deletePersistence = await page.evaluate(async (toolFeatureId) => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const hasFeature = (project: any) =>
      project?.partDefinitions?.some((part: any) =>
        (part.features || []).some((entry: any) => entry.id === toolFeatureId));
    return {
      localHas: hasFeature(local),
      journalHas: hasFeature(journal?.document),
      visible: Boolean(document.querySelector(`[data-sel="${toolFeatureId}"]`)),
    };
  }, RUNTIME_FEATURE_IDS.tool);
  const deleteUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: deleteCommitted.revision,
  });
  const restoredTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  check('feature deletion is visibly confirmation-gated, persists dependent removal, and Undo restores stable IDs',
    deletePreview.visible === true &&
    deletePreview.confirmation?.required === true &&
    deletePreviewTree.result.items.some((entry: any) => entry.kind === 'feature' && entry.id === RUNTIME_FEATURE_IDS.tool) &&
    deleteVisiblePreview.operationText === 'Delete Tool extrude and dependent structure' &&
    /Confirmation is required for this destructive change/.test(deleteVisiblePreview.previewText || '') &&
    deleteApprovalVisible === true &&
    !deletedTree.result.items.some((entry: any) => entry.kind === 'feature' && entry.id === RUNTIME_FEATURE_IDS.tool) &&
    deletePersistence.localHas === false &&
    deletePersistence.journalHas === false &&
    deletePersistence.visible === false &&
    deleteUndo.revision === deleteCommitted.revision + 1 &&
    restoredTree.result.items.some((entry: any) => entry.kind === 'feature' && entry.id === RUNTIME_FEATURE_IDS.tool) &&
    pageErrors.length === 0,
    { deletePreview, deleteVisiblePreview, deleteCommitted, deletedTree, deletePersistence, deleteUndo, pageErrors });

  await bridge.close('Persistent feature control checks complete');
  await context.close();
}

async function persistentInspectionTreeControlChecks(browser: Browser, url: string) {
  console.log('\nCAD Studio V6 persistent saved-inspection tree controls');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  let fixture = buildRobotJointFixture().project;
  let assembly = fixture.assemblyDefinitions.find((entry: any) => entry.id === fixture.rootDocument.assemblyId);
  const bearing = assembly?.occurrences.find((entry: any) => entry.id === 'occurrence-robot-bearing');
  if (bearing) bearing.fixed = false;
  fixture = createStudioV5AssemblyMate(fixture, {
    id: 'mate-inspection-stage-bearing',
    name: 'Inspection bearing station',
    kind: 'distance',
    value: 18,
    occurrenceIds: ['occurrence-robot-shaft', 'occurrence-robot-bearing'],
    references: [
      {
        ownerKind: 'datum',
        ownerId: 'datum-robot-shaft-station',
        occurrencePath: ['occurrence-robot-shaft'],
        semanticPath: { role: 'anchor' },
        signature: { role: 'anchor' },
      },
      {
        ownerKind: 'datum',
        ownerId: 'datum-robot-bearing-station',
        occurrencePath: ['occurrence-robot-bearing'],
        semanticPath: { role: 'moving' },
        signature: { role: 'moving' },
      },
    ],
  });
  fixture = createStudioV5ExplodedView(fixture, {
    id: 'explode-inspection-cover',
    name: 'Inspection cover exploded',
    steps: [{
      occurrenceIds: ['occurrence-robot-cover'],
      translation: [0, 0, 24],
    }],
  });
  assembly = fixture.assemblyDefinitions.find((entry: any) => entry.id === fixture.rootDocument.assemblyId);
  if (assembly) {
    assembly.explodedViews = assembly.explodedViews.filter((entry: any, index: number, values: any[]) =>
      values.findIndex((candidate) => candidate.id === entry.id) === index);
  }
  fixture = createStudioV5AxialStageGroup(fixture, {
    id: 'stage-inspection-bearing',
    name: 'Inspection bearing stage',
    occurrenceIds: ['occurrence-robot-bearing'],
    distanceMateIds: ['mate-inspection-stage-bearing'],
    axis: [0, 0, 1],
    start: 18,
    spacing: 12,
    visible: true,
  });
  fixture = createStudioV5Measurement(fixture, {
    id: 'measurement-inspection-arm',
    name: 'Inspection arm envelope',
    kind: 'bounding-box',
    definition: { bodyIds: ['body-feature-robot-arm'] },
  });
  await page.evaluateOnNewDocument((documentFixture) => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(documentFixture));
  }, fixture);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const bridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 inspection tree control agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: [
        'project.read', 'project.edit',
        'ui.read', 'ui.select', 'ui.navigate',
        'ui.command-draft', 'ui.present-preview', 'ui.wait-events',
      ],
    },
  });
  await approveConnectionAsHuman(page, 'V6 inspection tree control agent');
  for (let attempt = 0; attempt < 600 && bridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const base: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const editPreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-inspection-tree-edit',
      label: 'Edit saved inspection presentation',
      expectedRevision: base.revision,
      operations: [
        { kind: 'section.activate', input: {} },
        { kind: 'exploded.activate', input: {} },
        { kind: 'stage.update', input: { groupId: 'stage-inspection-bearing', patch: { visible: false, spacing: 17 } } },
      ],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const editPreviewSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const visibleEditPreview = await page.evaluate(() => ({
    operationText: [...(document.getElementById('bw-v5-command-fields')?.querySelectorAll('li') || [])]
      .map((entry) => entry.textContent),
    sectionActive: document.querySelector('[data-inspection-id="section-robot-joint"]')?.classList.contains('is-active'),
    explodeActive: document.querySelector('[data-inspection-id="explode-inspection-cover"]')?.classList.contains('is-active'),
    stageText: document.querySelector('[data-inspection-id="stage-inspection-bearing"]')?.textContent,
  }));
  check('saved section, exploded view, stage visibility, and spacing use one exact visible preview without mutation',
    editPreview.visible === true &&
    editPreview.validation?.valid === true &&
    editPreview.validation?.exactGeometry === true &&
    editPreviewSummary.result.documentHash === base.result.documentHash &&
    visibleEditPreview.operationText.join('|') ===
      'Turn off the active section view|Turn off the active exploded view|Hide Inspection bearing stage' &&
    visibleEditPreview.sectionActive === true &&
    visibleEditPreview.explodeActive === true &&
    /12 mm · shown/.test(visibleEditPreview.stageText || ''),
    { editPreview, visibleEditPreview });
  const editCommitPromise = bridge.request('cad_commit', {
    previewId: editPreview.previewId,
    expectedRevision: editPreview.baseRevision,
  });
  const editApprovalVisible = await approveAgentPreviewAsHuman(page, 'Edit saved inspection presentation');
  const editCommitted: any = await editCommitPromise;
  const [editedStage, editedAssembly] = await Promise.all([
    bridge.request('cad_inspect', {
      query: { kind: 'entity.detail', entity: { kind: 'stage-group', id: 'stage-inspection-bearing' } },
    }),
    bridge.request('cad_inspect', {
      query: { kind: 'entity.detail', entity: { kind: 'assembly', id: 'assembly-robot-joint' } },
    }),
  ]) as any[];
  const editPersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const state = (project: any) => {
      const assembly = project?.assemblyDefinitions?.find((entry: any) => entry.id === project.rootDocument?.assemblyId);
      const stage = assembly?.metadata?.axialStageGroups?.find((entry: any) => entry.id === 'stage-inspection-bearing');
      return {
        activeSection: assembly?.metadata?.activeSectionViewId,
        activeExplode: assembly?.metadata?.activeExplodedViewId,
        stageVisible: stage?.visible,
        stageSpacing: stage?.spacing,
      };
    };
    return {
      local: state(local),
      journal: state(journal?.document),
      sectionActive: document.querySelector('[data-inspection-id="section-robot-joint"]')?.classList.contains('is-active'),
      explodeActive: document.querySelector('[data-inspection-id="explode-inspection-cover"]')?.classList.contains('is-active'),
      stageText: document.querySelector('[data-inspection-id="stage-inspection-bearing"]')?.textContent,
    };
  });
  const editUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: editCommitted.revision,
  });
  const editUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('approved inspection-tree state edit renders, persists atomically, and Undo restores the exact prior hash',
    editApprovalVisible === true &&
    editedStage.result.value.visible === false &&
    editedStage.result.value.spacing === 17 &&
    !editedAssembly.result.value.metadata.activeSectionViewId &&
    !editedAssembly.result.value.metadata.activeExplodedViewId &&
    editPersistence.local.activeSection === undefined &&
    editPersistence.local.activeExplode === undefined &&
    editPersistence.local.stageVisible === false &&
    editPersistence.local.stageSpacing === 17 &&
    editPersistence.journal.stageVisible === false &&
    editPersistence.journal.stageSpacing === 17 &&
    editPersistence.sectionActive === false &&
    editPersistence.explodeActive === false &&
    /17 mm · hidden/.test(editPersistence.stageText || '') &&
    editUndo.revision === editCommitted.revision + 1 &&
    editUndoSummary.result.documentHash === base.result.documentHash,
    { editCommitted, editedStage, editedAssembly, editPersistence, editUndo });

  const deletePreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-inspection-tree-delete',
      label: 'Delete saved inspection records',
      expectedRevision: editUndo.revision,
      operations: [
        { kind: 'section.delete', input: { sectionId: 'section-robot-joint' } },
        { kind: 'exploded.delete', input: { explodedViewId: 'explode-inspection-cover' } },
        { kind: 'measurement.delete', input: { measurementId: 'measurement-inspection-arm' } },
      ],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const deletePreviewTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const visibleDeletePreview = await page.evaluate(() => ({
    operationText: [...(document.getElementById('bw-v5-command-fields')?.querySelectorAll('li') || [])]
      .map((entry) => entry.textContent),
    previewText: document.getElementById('bw-v6-command-preview')?.textContent,
  }));
  check('saved inspection deletion remains confirmation-gated and recoverable before commit',
    deletePreview.visible === true &&
    deletePreview.confirmation?.required === true &&
    deletePreviewTree.result.items.some((entry: any) => entry.id === 'section-robot-joint') &&
    deletePreviewTree.result.items.some((entry: any) => entry.id === 'explode-inspection-cover') &&
    deletePreviewTree.result.items.some((entry: any) => entry.id === 'measurement-inspection-arm') &&
    visibleDeletePreview.operationText.join('|') ===
      'Delete Robot joint section|Delete Inspection cover exploded|Delete Inspection arm envelope' &&
    /Confirmation is required for this destructive change/.test(visibleDeletePreview.previewText || ''),
    { deletePreview, visibleDeletePreview });
  const deleteCommitPromise = bridge.request('cad_commit', {
    previewId: deletePreview.previewId,
    expectedRevision: deletePreview.baseRevision,
  });
  const deleteApprovalVisible = await approveAgentPreviewAsHuman(page, 'Delete saved inspection records');
  const deleteCommitted: any = await deleteCommitPromise;
  const deletedTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const deletePersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const state = (project: any) => {
      const assembly = project?.assemblyDefinitions?.find((entry: any) => entry.id === project.rootDocument?.assemblyId);
      return {
        section: assembly?.sectionViews?.some((entry: any) => entry.id === 'section-robot-joint'),
        explode: assembly?.explodedViews?.some((entry: any) => entry.id === 'explode-inspection-cover'),
        measurement: assembly?.metadata?.measurements?.some((entry: any) => entry.id === 'measurement-inspection-arm'),
      };
    };
    return {
      local: state(local),
      journal: state(journal?.document),
      sectionVisible: Boolean(document.querySelector('[data-inspection-id="section-robot-joint"]')),
      explodeVisible: Boolean(document.querySelector('[data-inspection-id="explode-inspection-cover"]')),
      measurementVisible: Boolean(document.querySelector('[data-inspection-id="measurement-inspection-arm"]')),
    };
  });
  const deleteUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: deleteCommitted.revision,
  });
  const restoredTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  check('approved saved-inspection deletion persists and normal Undo restores every stable record',
    deleteApprovalVisible === true &&
    !deletedTree.result.items.some((entry: any) =>
      ['section-robot-joint', 'explode-inspection-cover', 'measurement-inspection-arm'].includes(entry.id)) &&
    Object.values(deletePersistence.local).every((value) => value === false) &&
    Object.values(deletePersistence.journal).every((value) => value === false) &&
    deletePersistence.sectionVisible === false &&
    deletePersistence.explodeVisible === false &&
    deletePersistence.measurementVisible === false &&
    deleteUndo.revision === deleteCommitted.revision + 1 &&
    restoredTree.result.items.some((entry: any) => entry.id === 'section-robot-joint') &&
    restoredTree.result.items.some((entry: any) => entry.id === 'explode-inspection-cover') &&
    restoredTree.result.items.some((entry: any) => entry.id === 'measurement-inspection-arm') &&
    pageErrors.length === 0,
    { deleteCommitted, deletedTree, deletePersistence, deleteUndo, restoredTree, pageErrors });

  await bridge.close('Persistent inspection tree control checks complete');
  await context.close();
}

function buildVisibleModelCommandFixture() {
  let project = addOriginDatums(createThreeBodyRuntimeProject({
    boolean: false,
    projectId: 'project-v6-visible-model-commands',
  }));
  project = createStudioV5BodyPattern(project, {
    id: 'pattern-visible-housing',
    name: 'Visible housing pattern',
    kind: 'linear',
    sourceBodyId: RUNTIME_BODY_IDS.housing,
    directionDatumIds: [DATUM_IDS.xAxis],
    count: 3,
    spacing: 60,
    outputMode: 'linked',
  });
  for (const [id, name, offset] of [
    ['datum-visible-profile-0', 'Visible profile station 0', 0],
    ['datum-visible-profile-1', 'Visible profile station 1', 30],
    ['datum-visible-profile-2', 'Visible profile station 2', 60],
  ] as const) {
    project = createStudioV5Datum(project, {
      id,
      name,
      kind: 'plane',
      definition: { mode: 'offset', referenceDatumId: DATUM_IDS.yz, offset },
    });
  }
  const circle = (radius: number) => Array.from({ length: 12 }, (_, index) => {
    const angle = index * Math.PI * 2 / 12;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
  for (const [id, name, planeDatumId, radius] of [
    ['sketch-visible-profile-0', 'Visible section 0', 'datum-visible-profile-0', 8],
    ['sketch-visible-profile-1', 'Visible section 1', 'datum-visible-profile-1', 10],
    ['sketch-visible-profile-2', 'Visible section 2', 'datum-visible-profile-2', 6],
  ] as const) {
    project = createStudioV5ProfileSketch(project, {
      id,
      name,
      planeDatumId,
      kind: 'spline',
      points: circle(radius),
    });
  }
  project = createStudioV5ProfileSketch(project, {
    id: 'sketch-visible-revolve',
    name: 'Visible revolve profile',
    planeDatumId: DATUM_IDS.zx,
    kind: 'polyline',
    points: [[0, -12], [20, -12], [20, -18], [0, -18]],
  });
  project = createStudioV5PathSketch(project, {
    id: 'sketch-visible-path',
    name: 'Visible sweep path',
    kind: 'spline',
    points: [[0, 0, 0], [30, 0, 0], [60, 10, 5]],
  });
  return project;
}

async function persistentDatumSketchPatternControlChecks(browser: Browser, url: string) {
  console.log('\nCAD Studio V6 persistent datum, sketch, and body-pattern controls');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const fixture = buildVisibleModelCommandFixture();
  await page.evaluateOnNewDocument((documentFixture) => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(documentFixture));
  }, fixture);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const bridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 datum sketch pattern control agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: [
        'project.read', 'project.edit',
        'ui.read', 'ui.select', 'ui.navigate',
        'ui.command-draft', 'ui.present-preview', 'ui.wait-events',
      ],
    },
  });
  await approveConnectionAsHuman(page, 'V6 datum sketch pattern control agent');
  for (let attempt = 0; attempt < 600 && bridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const base: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  let uiState: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const semanticTreeControls: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: uiState.uiRevision,
    correlationId: 'observer-datum-sketch-tree-controls',
    actions: [
      { kind: 'tree.invoke', entity: { kind: 'datum', id: 'datum-visible-profile-1' }, operation: 'datum.select' },
      { kind: 'tree.invoke', entity: { kind: 'sketch', id: 'sketch-visible-profile-1' }, operation: 'sketch.select' },
      { kind: 'tree.setSectionExpanded', sectionId: 'datums', expanded: false },
      { kind: 'tree.setSectionExpanded', sectionId: 'sketches', expanded: false },
      { kind: 'tree.setSectionExpanded', sectionId: 'datums', expanded: true },
      { kind: 'tree.setSectionExpanded', sectionId: 'sketches', expanded: true },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const visibleSemanticTreeControls = await page.evaluate(() => ({
    datumSelected: document.querySelector('[data-datum-id="datum-visible-profile-1"]')?.getAttribute('aria-selected'),
    sketchSelected: document.querySelector('[data-sketch-id="sketch-visible-profile-1"]')?.getAttribute('aria-selected'),
    datumsOpen: (document.querySelector('[data-tree-section="datums"]') as HTMLDetailsElement | null)?.open,
    sketchesOpen: (document.querySelector('[data-tree-section="sketches"]') as HTMLDetailsElement | null)?.open,
    controlIds: [...document.querySelectorAll<HTMLElement>(
      '[data-v6-control-id="tree.entity.datum.select"],' +
      '[data-v6-control-id="tree.entity.sketch.select"],' +
      '[data-v6-control-id^="tree.section."]',
    )].map((entry) => entry.dataset.v6ControlId).sort(),
  }));
  check('datum/sketch selection and every concrete model-tree section use visible coordinate-free controls without editing the document',
    semanticTreeControls.snapshot.documentRevision === uiState.documentRevision &&
    semanticTreeControls.snapshot.selection.length === 1 &&
    semanticTreeControls.snapshot.selection[0].kind === 'sketch' &&
    semanticTreeControls.snapshot.selection[0].id === 'sketch-visible-profile-1' &&
    semanticTreeControls.snapshot.tree.sections.length === 7 &&
    semanticTreeControls.snapshot.tree.sections.find((entry: any) => entry.sectionId === 'datums')?.expanded === true &&
    semanticTreeControls.snapshot.tree.sections.find((entry: any) => entry.sectionId === 'sketches')?.expanded === true &&
    visibleSemanticTreeControls.datumSelected === 'false' &&
    visibleSemanticTreeControls.sketchSelected === 'true' &&
    visibleSemanticTreeControls.datumsOpen === true &&
    visibleSemanticTreeControls.sketchesOpen === true &&
    visibleSemanticTreeControls.controlIds.includes('tree.entity.datum.select') &&
    visibleSemanticTreeControls.controlIds.includes('tree.entity.sketch.select') &&
    visibleSemanticTreeControls.controlIds.filter((id) => id?.startsWith('tree.section.')).length === 7,
    { snapshot: semanticTreeControls.snapshot, visibleSemanticTreeControls });

  await page.evaluate(() => {
    (document.querySelector('[data-v6-control-id="tree.section.datums"]') as HTMLElement | null)?.click();
  });
  await page.waitForFunction(() =>
    (document.querySelector('[data-tree-section="datums"]') as HTMLDetailsElement | null)?.open === false);
  const humanCollapsed: any = await bridge.request('cad_ui', { action: 'snapshot' });
  check('a human model-tree disclosure advances the shared UI revision and reports the same section state',
    humanCollapsed.uiRevision === semanticTreeControls.uiRevision + 1 &&
    humanCollapsed.documentRevision === semanticTreeControls.snapshot.documentRevision &&
    humanCollapsed.tree.sections.find((entry: any) => entry.sectionId === 'datums')?.expanded === false,
    humanCollapsed);

  await page.evaluate(() => {
    (document.querySelector('[data-v6-control-id="tree.section.datums"]') as HTMLElement | null)?.click();
  });
  await page.waitForFunction(() =>
    (document.querySelector('[data-tree-section="datums"]') as HTMLDetailsElement | null)?.open === true);
  const humanExpanded: any = await bridge.request('cad_ui', { action: 'snapshot' });
  let sectionRollbackCode = '';
  try {
    await bridge.request('cad_ui', {
      action: 'apply',
      expectedUiRevision: humanExpanded.uiRevision,
      correlationId: 'observer-tree-section-rollback',
      actions: [
        { kind: 'tree.setSectionExpanded', sectionId: 'datums', expanded: false },
        { kind: 'inspector.invoke', operation: 'inspection.clear' },
      ],
      presentation: { mode: 'instant', transition: 'cut' },
    });
  } catch (error: any) {
    sectionRollbackCode = error.code;
  }
  const sectionRolledBack: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const sectionVisibleAfterRollback = await page.evaluate(() =>
    (document.querySelector('[data-tree-section="datums"]') as HTMLDetailsElement | null)?.open);
  check('a failed semantic batch transactionally restores the visible model-tree disclosure state',
    sectionRollbackCode === 'COMMAND_BLOCKED' &&
    sectionRolledBack.uiRevision === humanExpanded.uiRevision &&
    sectionRolledBack.documentRevision === humanExpanded.documentRevision &&
    sectionRolledBack.tree.sections.find((entry: any) => entry.sectionId === 'datums')?.expanded === true &&
    sectionVisibleAfterRollback === true,
    { sectionRollbackCode, sectionRolledBack, sectionVisibleAfterRollback });
  uiState = sectionRolledBack;

  const datumPreviewApplied: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: uiState.uiRevision,
    actions: [
      { kind: 'selection.set', entity: { kind: 'datum', id: 'datum-visible-profile-1' } },
      { kind: 'command.open', commandId: 'model.plane' },
      { kind: 'command.setInput', fieldId: 'offset', value: 35 },
      { kind: 'command.preview' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const datumPreview = datumPreviewApplied.results.find((entry: any) => entry.kind === 'command.preview')?.result;
  const visibleDatumEdit = await page.evaluate(() => ({
    title: document.getElementById('bw-v5-command-title')?.textContent,
    offset: (document.querySelector('#bw-v5-command-form [name="offset"]') as HTMLInputElement | null)?.value,
  }));
  const datumBeforeCommit: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const datumCommitPromise = bridge.request('cad_commit', {
    previewId: datumPreview.previewId,
    expectedRevision: datumPreview.baseRevision,
  });
  const datumApprovalVisible = await approveAgentPreviewAsHuman(page, 'Edit construction plane');
  const datumCommitted: any = await datumCommitPromise;
  const datumDetail: any = await bridge.request('cad_inspect', {
    query: { kind: 'entity.detail', entity: { kind: 'datum', id: 'datum-visible-profile-1' } },
  });
  const datumPersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const offset = (project: any) =>
      project?.partDefinitions?.[0]?.referenceGeometry?.find((entry: any) => entry.id === 'datum-visible-profile-1')?.definition?.offset;
    return { local: offset(local), journal: offset(journal?.document) };
  });
  const datumUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: datumCommitted.revision,
  });
  const datumUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('datum edit opens the existing normal plane panel, exact-previews an update, persists, and undoes',
    datumPreviewApplied.snapshot.activeCommand?.editEntity?.kind === 'datum' &&
    datumPreviewApplied.snapshot.activeCommand?.editEntity?.id === 'datum-visible-profile-1' &&
    datumPreview?.visible === true &&
    datumPreview?.validation?.valid === true &&
    datumPreview?.validation?.exactGeometry === true &&
    datumBeforeCommit.result.documentHash === base.result.documentHash &&
    visibleDatumEdit.title === 'Edit Visible profile station 1' &&
    visibleDatumEdit.offset === '35' &&
    datumApprovalVisible === true &&
    datumDetail.result.value.definition.offset === 35 &&
    datumPersistence.local === 35 &&
    datumPersistence.journal === 35 &&
    datumUndoSummary.result.documentHash === base.result.documentHash,
    { datumPreviewApplied, datumPreview, visibleDatumEdit, datumCommitted, datumDetail, datumPersistence, datumUndo });

  uiState = await bridge.request('cad_ui', { action: 'snapshot' });
  const editedSketchPoints = [[-10, 0], [0, 12], [10, 0], [0, -12]];
  const sketchPreviewApplied: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: uiState.uiRevision,
    actions: [
      { kind: 'selection.set', entity: { kind: 'sketch', id: 'sketch-visible-profile-1' } },
      { kind: 'command.open', commandId: 'model.profile' },
      { kind: 'command.setInput', fieldId: 'name', value: 'Edited visible section 1' },
      { kind: 'command.setInput', fieldId: 'points', value: editedSketchPoints },
      { kind: 'command.preview' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const sketchPreview = sketchPreviewApplied.results.find((entry: any) => entry.kind === 'command.preview')?.result;
  const visibleSketchEdit = await page.evaluate(() => ({
    title: document.getElementById('bw-v5-command-title')?.textContent,
    name: (document.querySelector('#bw-v5-command-form [name="name"]') as HTMLInputElement | null)?.value,
  }));
  const sketchBeforeCommit: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const sketchCommitPromise = bridge.request('cad_commit', {
    previewId: sketchPreview.previewId,
    expectedRevision: sketchPreview.baseRevision,
  });
  const sketchApprovalVisible = await approveAgentPreviewAsHuman(page, 'Edit profile sketch');
  const sketchCommitted: any = await sketchCommitPromise;
  const sketchDetail: any = await bridge.request('cad_inspect', {
    query: { kind: 'entity.detail', entity: { kind: 'sketch', id: 'sketch-visible-profile-1' } },
  });
  const sketchPersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const sketch = (project: any) =>
      project?.partDefinitions?.[0]?.sketches?.find((entry: any) => entry.id === 'sketch-visible-profile-1');
    return { local: sketch(local), journal: sketch(journal?.document) };
  });
  const sketchUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: sketchCommitted.revision,
  });
  const sketchUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('sketch edit opens the existing normal profile panel, exact-previews an update, persists, and undoes',
    sketchPreviewApplied.snapshot.activeCommand?.editEntity?.kind === 'sketch' &&
    sketchPreviewApplied.snapshot.activeCommand?.editEntity?.id === 'sketch-visible-profile-1' &&
    sketchPreview?.visible === true &&
    sketchPreview?.validation?.valid === true &&
    sketchPreview?.validation?.exactGeometry === true &&
    sketchBeforeCommit.result.documentHash === base.result.documentHash &&
    visibleSketchEdit.title === 'Edit Visible section 1' &&
    visibleSketchEdit.name === 'Edited visible section 1' &&
    sketchApprovalVisible === true &&
    sketchDetail.result.value.name === 'Edited visible section 1' &&
    JSON.stringify(sketchDetail.result.value.entities?.[0]?.points) === JSON.stringify(editedSketchPoints) &&
    sketchPersistence.local?.name === 'Edited visible section 1' &&
    sketchPersistence.journal?.name === 'Edited visible section 1' &&
    sketchUndoSummary.result.documentHash === base.result.documentHash,
    { sketchPreviewApplied, sketchPreview, visibleSketchEdit, sketchCommitted, sketchDetail, sketchPersistence, sketchUndo });

  uiState = await bridge.request('cad_ui', { action: 'snapshot' });
  const patternPreviewApplied: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: uiState.uiRevision,
    actions: [
      { kind: 'selection.set', entity: { kind: 'body-pattern', id: 'pattern-visible-housing' } },
      { kind: 'command.open', commandId: 'model.pattern' },
      { kind: 'command.setInput', fieldId: 'count', value: 4 },
      { kind: 'command.preview' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const patternPreview = patternPreviewApplied.results.find((entry: any) => entry.kind === 'command.preview')?.result;
  const visiblePatternEdit = await page.evaluate(() => ({
    title: document.getElementById('bw-v5-command-title')?.textContent,
    count: (document.querySelector('#bw-v5-command-form [name="count"]') as HTMLInputElement | null)?.value,
  }));
  const patternBeforeCommit: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const patternCommitPromise = bridge.request('cad_commit', {
    previewId: patternPreview.previewId,
    expectedRevision: patternPreview.baseRevision,
  });
  const patternApprovalVisible = await approveAgentPreviewAsHuman(page, 'Edit linear body pattern');
  const patternCommitted: any = await patternCommitPromise;
  await page.waitForFunction(() =>
    document.querySelectorAll('[data-pattern-instance-id^="pattern-visible-housing-instance-"]').length === 3,
    { polling: 50, timeout: 30_000 });
  const patternDetail: any = await bridge.request('cad_inspect', {
    query: { kind: 'entity.detail', entity: { kind: 'body-pattern', id: 'pattern-visible-housing' } },
  });
  const patternPersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const pattern = (project: any) =>
      project?.partDefinitions?.[0]?.bodyPatterns?.find((entry: any) => entry.id === 'pattern-visible-housing');
    return {
      local: pattern(local),
      journal: pattern(journal?.document),
      renderedInstances: document.querySelectorAll('[data-pattern-instance-id^="pattern-visible-housing-instance-"]').length,
    };
  });
  const patternUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: patternCommitted.revision,
  });
  const patternUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('body-pattern edit opens the existing normal panel, exact-previews an update, persists, renders, and undoes',
    patternPreviewApplied.snapshot.activeCommand?.editEntity?.kind === 'body-pattern' &&
    patternPreviewApplied.snapshot.activeCommand?.editEntity?.id === 'pattern-visible-housing' &&
    patternPreview?.visible === true &&
    patternPreview?.validation?.valid === true &&
    patternPreview?.validation?.exactGeometry === true &&
    patternBeforeCommit.result.documentHash === base.result.documentHash &&
    visiblePatternEdit.title === 'Edit Visible housing pattern' &&
    visiblePatternEdit.count === '4' &&
    patternApprovalVisible === true &&
    patternDetail.result.value.definition.count === 4 &&
    patternPersistence.local?.definition?.count === 4 &&
    patternPersistence.journal?.definition?.count === 4 &&
    patternPersistence.renderedInstances === 3 &&
    patternUndoSummary.result.documentHash === base.result.documentHash,
    { patternPreviewApplied, patternPreview, visiblePatternEdit, patternCommitted, patternDetail, patternPersistence, patternUndo });

  const statePreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-pattern-state-edit',
      label: 'Skip and hide body-pattern occurrences',
      expectedRevision: patternUndo.revision,
      operations: [{
        kind: 'pattern.update',
        input: {
          patternId: 'pattern-visible-housing',
          patch: { skippedIndices: [1], visible: false },
        },
      }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const statePreviewSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const visibleStatePreview = await page.evaluate(() => ({
    operationText: document.getElementById('bw-v5-command-fields')?.querySelector('li')?.textContent,
    visibleRows: document.querySelectorAll('[data-pattern-instance-id^="pattern-visible-housing-instance-"]').length,
  }));
  const stateCommitPromise = bridge.request('cad_commit', {
    previewId: statePreview.previewId,
    expectedRevision: statePreview.baseRevision,
  });
  const stateApprovalVisible = await approveAgentPreviewAsHuman(page, 'Skip and hide body-pattern occurrences');
  const stateCommitted: any = await stateCommitPromise;
  await page.waitForFunction(() => {
    const row = document.querySelector('[data-pattern-id="pattern-visible-housing"]');
    return /hidden/.test(row?.getAttribute('aria-label') || '') &&
      document.querySelectorAll('[data-pattern-instance-id^="pattern-visible-housing-instance-"]').length === 0;
  }, { polling: 50, timeout: 30_000 });
  const stateDetail: any = await bridge.request('cad_inspect', {
    query: { kind: 'entity.detail', entity: { kind: 'body-pattern', id: 'pattern-visible-housing' } },
  });
  const statePersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const pattern = (project: any) =>
      project?.partDefinitions?.[0]?.bodyPatterns?.find((entry: any) => entry.id === 'pattern-visible-housing');
    return {
      local: pattern(local),
      journal: pattern(journal?.document),
      visibleRows: document.querySelectorAll('[data-pattern-instance-id^="pattern-visible-housing-instance-"]').length,
    };
  });
  const stateUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: stateCommitted.revision,
  });
  const stateUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('pattern-instance skip and pattern visibility use exact preview, persist normal tree state, and undo',
    statePreview.visible === true &&
    statePreview.validation?.valid === true &&
    statePreview.validation?.exactGeometry === true &&
    statePreviewSummary.result.documentHash === base.result.documentHash &&
    visibleStatePreview.operationText === 'Hide Visible housing pattern and set skipped occurrences to 1' &&
    visibleStatePreview.visibleRows === 2 &&
    stateApprovalVisible === true &&
    JSON.stringify(stateDetail.result.value.skippedIndices) === JSON.stringify([1]) &&
    stateDetail.result.value.visible === false &&
    JSON.stringify(statePersistence.local?.skippedIndices) === JSON.stringify([1]) &&
    statePersistence.local?.visible === false &&
    JSON.stringify(statePersistence.journal?.skippedIndices) === JSON.stringify([1]) &&
    statePersistence.journal?.visible === false &&
    statePersistence.visibleRows === 0 &&
    stateUndoSummary.result.documentHash === base.result.documentHash,
    { statePreview, visibleStatePreview, stateCommitted, stateDetail, statePersistence, stateUndo });

  const deletePreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-pattern-delete',
      label: 'Delete editable body pattern',
      expectedRevision: stateUndo.revision,
      operations: [{ kind: 'pattern.delete', input: { patternId: 'pattern-visible-housing' } }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const deleteTreeBefore: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const visibleDeletePreview = await page.evaluate(() => ({
    operationText: document.getElementById('bw-v5-command-fields')?.querySelector('li')?.textContent,
    previewText: document.getElementById('bw-v6-command-preview')?.textContent,
  }));
  const deleteCommitPromise = bridge.request('cad_commit', {
    previewId: deletePreview.previewId,
    expectedRevision: deletePreview.baseRevision,
  });
  const deleteApprovalVisible = await approveAgentPreviewAsHuman(page, 'Delete editable body pattern');
  const deleteCommitted: any = await deleteCommitPromise;
  const deleteTreeAfter: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const deletePersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const exists = (project: any) =>
      project?.partDefinitions?.[0]?.bodyPatterns?.some((entry: any) => entry.id === 'pattern-visible-housing');
    return {
      local: exists(local),
      journal: exists(journal?.document),
      visible: Boolean(document.querySelector('[data-pattern-id="pattern-visible-housing"]')),
    };
  });
  const deleteUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: deleteCommitted.revision,
  });
  const deleteTreeRestored: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  check('body-pattern deletion is confirmation-gated, persists, and Undo restores the stable editable pattern',
    deletePreview.visible === true &&
    deletePreview.confirmation?.required === true &&
    deleteTreeBefore.result.items.some((entry: any) => entry.id === 'pattern-visible-housing') &&
    visibleDeletePreview.operationText === 'Delete Visible housing pattern' &&
    /Confirmation is required for this destructive change/.test(visibleDeletePreview.previewText || '') &&
    deleteApprovalVisible === true &&
    !deleteTreeAfter.result.items.some((entry: any) => entry.id === 'pattern-visible-housing') &&
    deletePersistence.local === false &&
    deletePersistence.journal === false &&
    deletePersistence.visible === false &&
    deleteUndo.revision === deleteCommitted.revision + 1 &&
    deleteTreeRestored.result.items.some((entry: any) => entry.id === 'pattern-visible-housing') &&
    pageErrors.length === 0,
    { deletePreview, visibleDeletePreview, deleteCommitted, deleteTreeAfter, deletePersistence, deleteUndo, pageErrors });

  uiState = await bridge.request('cad_ui', { action: 'snapshot' });
  const independentApplied: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: uiState.uiRevision,
    actions: [{
      kind: 'tree.invoke',
      entity: { kind: 'body', id: 'pattern-visible-housing-instance-1' },
      operation: 'pattern-instance.independent',
    }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const independentResult = independentApplied.results
    .find((entry: any) => entry.kind === 'tree.invoke')?.result;
  const independentPreviewSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const independentVisiblePreview = await page.evaluate(() => ({
    visible: !(document.getElementById('bw-v6-command-preview') as HTMLElement | null)?.hidden,
    operationText: document.getElementById('bw-v5-command-fields')?.querySelector('li')?.textContent,
    instanceVisible: Boolean(document.querySelector('[data-pattern-instance-id="pattern-visible-housing-instance-1"]')),
  }));
  check('Make independent uses the exact kernel-backed tree action and presents a non-mutating normal preview',
    independentResult?.preview?.visible === true &&
    independentResult?.preview?.validation?.valid === true &&
    independentResult?.preview?.validation?.exactGeometry === true &&
    independentResult?.preview?.transactionHash &&
    independentResult?.materializedBodyIds?.length === 1 &&
    independentPreviewSummary.result.documentHash === base.result.documentHash &&
    independentVisiblePreview.visible === true &&
    independentVisiblePreview.operationText === 'Make Visible housing pattern occurrence 1 independent' &&
    independentVisiblePreview.instanceVisible === true,
    { independentResult, independentPreviewSummary, independentVisiblePreview });
  const independentCommitPromise = bridge.request('cad_commit', {
    previewId: independentResult.preview.previewId,
    expectedRevision: independentResult.preview.baseRevision,
  });
  const independentApprovalVisible = await approveAgentPreviewAsHuman(
    page,
    'Make Visible housing pattern occurrence 1 independent',
  );
  const independentCommitted: any = await independentCommitPromise;
  const independentBodyId = independentResult.materializedBodyIds[0];
  await page.waitForFunction((bodyId) =>
    Boolean(document.querySelector(`[data-body-id="${bodyId}"]`)) &&
    !document.querySelector('[data-pattern-instance-id="pattern-visible-housing-instance-1"]'),
  { polling: 50, timeout: 30_000 }, independentBodyId);
  const independentTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const independentPersistence = await page.evaluate(async ({ bodyId }) => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const state = (project: any) => {
      const part = project?.partDefinitions?.[0];
      return {
        body: part?.bodies?.find((entry: any) => entry.id === bodyId),
        pattern: part?.bodyPatterns?.find((entry: any) => entry.id === 'pattern-visible-housing'),
      };
    };
    return {
      local: state(local),
      journal: state(journal?.document),
      bodyVisible: Boolean(document.querySelector(`[data-body-id="${bodyId}"]`)),
      linkedInstanceVisible: Boolean(document.querySelector('[data-pattern-instance-id="pattern-visible-housing-instance-1"]')),
    };
  }, { bodyId: independentBodyId });
  const independentUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: independentCommitted.revision,
  });
  const independentUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('approved Make independent persists one exact body, updates the linked pattern, renders, and undoes exactly',
    independentApprovalVisible === true &&
    independentTree.result.items.some((entry: any) => entry.kind === 'body' && entry.id === independentBodyId) &&
    independentTree.result.items.some((entry: any) => entry.kind === 'body-pattern' && entry.id === 'pattern-visible-housing') &&
    independentPersistence.local.body?.id === independentBodyId &&
    independentPersistence.journal.body?.id === independentBodyId &&
    JSON.stringify(independentPersistence.local.pattern?.skippedIndices) === JSON.stringify([1]) &&
    JSON.stringify(independentPersistence.journal.pattern?.skippedIndices) === JSON.stringify([1]) &&
    independentPersistence.bodyVisible === true &&
    independentPersistence.linkedInstanceVisible === false &&
    independentUndo.revision === independentCommitted.revision + 1 &&
    independentUndoSummary.result.documentHash === base.result.documentHash,
    {
      independentCommitted,
      independentTree,
      independentPersistence,
      independentUndo,
      independentUndoSummary,
    });

  uiState = await bridge.request('cad_ui', { action: 'snapshot' });
  const dissolveApplied: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: uiState.uiRevision,
    actions: [{
      kind: 'tree.invoke',
      entity: { kind: 'body-pattern', id: 'pattern-visible-housing' },
      operation: 'pattern.dissolve',
    }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const dissolveResult = dissolveApplied.results.find((entry: any) => entry.kind === 'tree.invoke')?.result;
  const dissolvePreviewSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const dissolveVisiblePreview = await page.evaluate(() => ({
    visible: !(document.getElementById('bw-v6-command-preview') as HTMLElement | null)?.hidden,
    operationText: document.getElementById('bw-v5-command-fields')?.querySelector('li')?.textContent,
    previewText: document.getElementById('bw-v6-command-preview')?.textContent,
    patternVisible: Boolean(document.querySelector('[data-pattern-id="pattern-visible-housing"]')),
  }));
  check('Dissolve uses exact kernel records, requires destructive approval, and preserves the document during preview',
    dissolveResult?.preview?.visible === true &&
    dissolveResult?.preview?.validation?.valid === true &&
    dissolveResult?.preview?.validation?.exactGeometry === true &&
    dissolveResult?.preview?.confirmation?.required === true &&
    dissolveResult?.materializedBodyIds?.length === 2 &&
    dissolvePreviewSummary.result.documentHash === base.result.documentHash &&
    dissolveVisiblePreview.visible === true &&
    dissolveVisiblePreview.operationText === 'Dissolve Visible housing pattern into 2 independent exact bodies' &&
    /Confirmation is required for this destructive change/.test(dissolveVisiblePreview.previewText || '') &&
    dissolveVisiblePreview.patternVisible === true,
    { dissolveResult, dissolvePreviewSummary, dissolveVisiblePreview });
  const dissolveCommitPromise = bridge.request('cad_commit', {
    previewId: dissolveResult.preview.previewId,
    expectedRevision: dissolveResult.preview.baseRevision,
  });
  const dissolveApprovalVisible = await approveAgentPreviewAsHuman(page, 'Dissolve Visible housing pattern');
  const dissolveCommitted: any = await dissolveCommitPromise;
  const dissolvedTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const dissolvePersistence = await page.evaluate(async ({ bodyIds }) => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const state = (project: any) => {
      const part = project?.partDefinitions?.[0];
      return {
        bodies: bodyIds.filter((bodyId: string) => part?.bodies?.some((entry: any) => entry.id === bodyId)),
        pattern: part?.bodyPatterns?.some((entry: any) => entry.id === 'pattern-visible-housing'),
      };
    };
    return {
      local: state(local),
      journal: state(journal?.document),
      bodyRows: bodyIds.filter((bodyId: string) => document.querySelector(`[data-body-id="${bodyId}"]`)),
      patternVisible: Boolean(document.querySelector('[data-pattern-id="pattern-visible-housing"]')),
    };
  }, { bodyIds: dissolveResult.materializedBodyIds });
  const dissolveUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: dissolveCommitted.revision,
  });
  const dissolveUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const dissolveRestoredTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  check('approved Dissolve persists and renders every exact body while normal Undo restores the editable pattern',
    dissolveApprovalVisible === true &&
    !dissolvedTree.result.items.some((entry: any) => entry.kind === 'body-pattern' && entry.id === 'pattern-visible-housing') &&
    dissolveResult.materializedBodyIds.every((bodyId: string) =>
      dissolvedTree.result.items.some((entry: any) => entry.kind === 'body' && entry.id === bodyId)) &&
    dissolvePersistence.local.pattern === false &&
    dissolvePersistence.journal.pattern === false &&
    dissolvePersistence.local.bodies.length === dissolveResult.materializedBodyIds.length &&
    dissolvePersistence.journal.bodies.length === dissolveResult.materializedBodyIds.length &&
    dissolvePersistence.bodyRows.length === dissolveResult.materializedBodyIds.length &&
    dissolvePersistence.patternVisible === false &&
    dissolveUndo.revision === dissolveCommitted.revision + 1 &&
    dissolveUndoSummary.result.documentHash === base.result.documentHash &&
    dissolveRestoredTree.result.items.some((entry: any) => entry.kind === 'body-pattern' && entry.id === 'pattern-visible-housing') &&
    pageErrors.length === 0,
    {
      dissolveCommitted,
      dissolvedTree,
      dissolvePersistence,
      dissolveUndo,
      dissolveUndoSummary,
      dissolveRestoredTree,
      pageErrors,
    });

  await bridge.close('Persistent datum sketch pattern control checks complete');
  await context.close();
}

async function persistentInspectorBooleanShortcutChecks(browser: Browser, url: string) {
  console.log('\nCAD Studio V6 persistent inspector Boolean shortcuts');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const fixture = createThreeBodyRuntimeProject({
    boolean: false,
    projectId: 'project-v6-inspector-boolean-controls',
  });
  await page.evaluateOnNewDocument((documentFixture) => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(documentFixture));
  }, fixture);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const bridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 inspector Boolean shortcut agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: [
        'project.read', 'project.edit',
        'ui.read', 'ui.select', 'ui.navigate',
        'ui.command-draft', 'ui.present-preview', 'ui.wait-events',
      ],
    },
  });
  await approveConnectionAsHuman(page, 'V6 inspector Boolean shortcut agent');
  for (let attempt = 0; attempt < 600 && bridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const base: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const cases = [
    { operation: 'subtract', label: 'Subtract Tool from Housing' },
    { operation: 'intersect', label: 'Intersect Tool with Housing' },
    { operation: 'union', label: 'Union Tool with Housing' },
  ];
  const results: any[] = [];
  let unionPreview: any = null;
  for (const entry of cases) {
    const preview: any = await bridge.request('cad_preview', {
      transaction: {
        transactionId: `observer-inspector-boolean-${entry.operation}`,
        label: entry.label,
        expectedRevision: base.revision,
        operations: [{
          kind: `boolean.${entry.operation}`,
          input: {
            id: `feature-observer-${entry.operation}`,
            targetBodyId: RUNTIME_BODY_IDS.housing,
            toolBodyId: RUNTIME_BODY_IDS.tool,
            keepTools: true,
          },
        }],
        atomic: true,
        metadata: { actor: 'agent' },
      },
    });
    const visible = await page.evaluate(() => ({
      title: document.getElementById('bw-v5-command-title')?.textContent,
      operationText: document.getElementById('bw-v5-command-fields')?.querySelector('li')?.textContent,
      selectedIds: [...document.querySelectorAll('.is-agent-selected, [aria-selected="true"]')]
        .map((element) => element.getAttribute('data-body-id'))
        .filter(Boolean),
    }));
    const summary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
    results.push({ entry, preview, visible, summary });
    if (entry.operation === 'union') {
      unionPreview = preview;
    } else {
      const uiState: any = await bridge.request('cad_ui', { action: 'snapshot' });
      await bridge.request('cad_ui', {
        action: 'apply',
        expectedUiRevision: uiState.uiRevision,
        actions: [{ kind: 'command.cancel' }],
        presentation: { mode: 'instant', transition: 'cut' },
      });
    }
  }
  check('Subtract, Intersect, and Union inspector shortcuts each use a named exact non-mutating preview',
    results.length === 3 &&
    results.every(({ entry, preview, visible, summary }) =>
      preview.visible === true &&
      preview.validation?.valid === true &&
      preview.validation?.exactGeometry === true &&
      preview.changeSet.documentHashBefore === base.result.documentHash &&
      summary.result.documentHash === base.result.documentHash &&
      visible.title === entry.label &&
      visible.operationText === entry.label) &&
    pageErrors.length === 0,
    { results, pageErrors });

  const unionCommitPromise = bridge.request('cad_commit', {
    previewId: unionPreview.previewId,
    expectedRevision: unionPreview.baseRevision,
  });
  const unionApprovalVisible = await approveAgentPreviewAsHuman(page, 'Union Tool with Housing');
  const unionCommitted: any = await unionCommitPromise;
  const unionTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const unionPersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const hasUnion = (project: any) =>
      project?.partDefinitions?.[0]?.features?.some((entry: any) => entry.id === 'feature-observer-union');
    return { local: hasUnion(local), journal: hasUnion(journal?.document) };
  });
  const unionUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: unionCommitted.revision,
  });
  const unionUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('approved inspector Union commits as normal editable Boolean structure, persists, and undoes exactly',
    unionApprovalVisible === true &&
    unionTree.result.items.some((entry: any) => entry.kind === 'feature' && entry.id === 'feature-observer-union') &&
    unionPersistence.local === true &&
    unionPersistence.journal === true &&
    unionUndo.revision === unionCommitted.revision + 1 &&
    unionUndoSummary.result.documentHash === base.result.documentHash &&
    pageErrors.length === 0,
    { unionCommitted, unionTree, unionPersistence, unionUndo, pageErrors });

  await bridge.close('Persistent inspector Boolean shortcut checks complete');
  await context.close();
}

async function persistentFeaturePatternFieldChecks(browser: Browser, url: string) {
  console.log('\nCAD Studio V6 persistent feature-pattern inspector fields');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const fixture = migrateStudioDocumentToV5({
    title: 'Feature pattern control fixture',
    units: 'mm',
    params: [],
    features: [{
      id: 'feature-pattern-controls',
      name: 'Patterned mounting boss',
      type: 'extrude',
      sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 4 }], z: 0 },
      h: 6,
      through: false,
      pattern: { kind: 'linear', n: 3, dx: 6, dy: 0 },
    }],
  }, { projectId: 'project-v6-feature-pattern-controls' });
  await page.evaluateOnNewDocument((documentFixture) => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(documentFixture));
  }, fixture);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const bridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 feature pattern field agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: [
        'project.read', 'project.edit',
        'ui.read', 'ui.select', 'ui.navigate',
        'ui.command-draft', 'ui.present-preview', 'ui.wait-events',
      ],
    },
  });
  await approveConnectionAsHuman(page, 'V6 feature pattern field agent');
  for (let attempt = 0; attempt < 600 && bridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const base: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const preview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-feature-pattern-fields',
      label: 'Edit patterned mounting boss spacing',
      expectedRevision: base.revision,
      operations: [{
        kind: 'feature.update',
        input: {
          featureId: 'feature-pattern-controls',
          patch: { pattern: { kind: 'linear', n: 4, dx: 5, dy: 1 } },
        },
      }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const previewSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const visiblePreview = await page.evaluate(() => ({
    title: document.getElementById('bw-v5-command-title')?.textContent,
    operationText: document.getElementById('bw-v5-command-fields')?.querySelector('li')?.textContent,
    previewText: document.getElementById('bw-v6-command-preview')?.textContent,
  }));
  check('feature pattern count and both spacing fields use one exact visible preview without mutation',
    preview.visible === true &&
    preview.validation?.valid === true &&
    preview.validation?.exactGeometry === true &&
    previewSummary.result.documentHash === base.result.documentHash &&
    visiblePreview.title === 'Edit patterned mounting boss spacing' &&
    visiblePreview.operationText === 'Set Patterned mounting boss pattern to 4 occurrences · spacing 5, 1' &&
    /Exact validation passed/.test(visiblePreview.previewText || ''),
    { preview, visiblePreview });

  const commitPromise = bridge.request('cad_commit', {
    previewId: preview.previewId,
    expectedRevision: preview.baseRevision,
  });
  const approvalVisible = await approveAgentPreviewAsHuman(page, 'Edit patterned mounting boss spacing');
  const committed: any = await commitPromise;
  await page.waitForFunction(() => {
    const count = document.querySelector('#bw-context [data-cxpat="n"]') as HTMLInputElement | null;
    const first = document.querySelector('#bw-context [data-cxpat="a"]') as HTMLInputElement | null;
    const second = document.querySelector('#bw-context [data-cxpat="b"]') as HTMLInputElement | null;
    return count?.value === '4' && first?.value === '5' && second?.value === '1';
  }, { polling: 50, timeout: 30_000 });
  const detail: any = await bridge.request('cad_inspect', {
    query: { kind: 'entity.detail', entity: { kind: 'feature', id: 'feature-pattern-controls' } },
  });
  const persistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const pattern = (project: any) =>
      project?.partDefinitions?.[0]?.features?.find((entry: any) => entry.id === 'feature-pattern-controls')?.pattern;
    return {
      local: pattern(local),
      journal: pattern(journal?.document),
      visible: {
        count: (document.querySelector('#bw-context [data-cxpat="n"]') as HTMLInputElement | null)?.value,
        first: (document.querySelector('#bw-context [data-cxpat="a"]') as HTMLInputElement | null)?.value,
        second: (document.querySelector('#bw-context [data-cxpat="b"]') as HTMLInputElement | null)?.value,
      },
    };
  });
  const undo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: committed.revision,
  });
  const undoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('approved feature-pattern field edit persists the normal editable feature and Undo restores the exact project',
    approvalVisible === true &&
    JSON.stringify(detail.result.value.pattern) === JSON.stringify({ kind: 'linear', n: 4, dx: 5, dy: 1 }) &&
    JSON.stringify(persistence.local) === JSON.stringify({ kind: 'linear', n: 4, dx: 5, dy: 1 }) &&
    JSON.stringify(persistence.journal) === JSON.stringify({ kind: 'linear', n: 4, dx: 5, dy: 1 }) &&
    persistence.visible.count === '4' &&
    persistence.visible.first === '5' &&
    persistence.visible.second === '1' &&
    undo.revision === committed.revision + 1 &&
    undoSummary.result.documentHash === base.result.documentHash &&
    pageErrors.length === 0,
    { committed, detail, persistence, undo, pageErrors });

  const normalUiState: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const normalPatternPreview: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: normalUiState.uiRevision,
    correlationId: 'observer-normal-feature-pattern-fields',
    actions: [
      { kind: 'selection.set', entity: { kind: 'feature', id: 'feature-pattern-controls' } },
      { kind: 'command.open', commandId: 'model.extrude' },
      { kind: 'command.setInput', fieldId: 'patternKind', value: 'linear' },
      { kind: 'command.setInput', fieldId: 'patternCount', value: 4 },
      { kind: 'command.setInput', fieldId: 'patternA', value: 5 },
      { kind: 'command.setInput', fieldId: 'patternB', value: 1 },
      { kind: 'command.preview' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const normalPatternSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const normalPatternVisible = await page.evaluate(() => ({
    title: document.getElementById('bw-sk-title')?.textContent,
    kind: (document.getElementById('bw-sk-pat') as HTMLSelectElement | null)?.value,
    count: (document.getElementById('bw-sk-pat-n') as HTMLInputElement | null)?.value,
    first: (document.getElementById('bw-sk-pat-a') as HTMLInputElement | null)?.value,
    second: (document.getElementById('bw-sk-pat-b') as HTMLInputElement | null)?.value,
    previewText: document.getElementById('bw-v6-command-preview')?.textContent,
  }));
  check('the four normal sketch-operation pattern controls drive an exact visible edit preview without mutating the document',
    normalPatternPreview.snapshot.activeCommand?.commandId === 'model.extrude' &&
    normalPatternPreview.snapshot.activeCommand?.editEntity?.id === 'feature-pattern-controls' &&
    normalPatternPreview.snapshot.activeCommand?.inputValues?.patternKind === 'linear' &&
    normalPatternPreview.snapshot.activeCommand?.inputValues?.patternCount === 4 &&
    normalPatternPreview.snapshot.activeCommand?.inputValues?.patternA === 5 &&
    normalPatternPreview.snapshot.activeCommand?.inputValues?.patternB === 1 &&
    normalPatternPreview.snapshot.preview?.validation?.valid === true &&
    normalPatternPreview.snapshot.preview?.validation?.exactGeometry === true &&
    normalPatternSummary.result.documentHash === base.result.documentHash &&
    normalPatternVisible.title === 'Edit extrude' &&
    normalPatternVisible.kind === 'linear' &&
    normalPatternVisible.count === '4' &&
    normalPatternVisible.first === '5' &&
    normalPatternVisible.second === '1' &&
    /Exact validation passed/.test(normalPatternVisible.previewText || ''),
    { normalPatternPreview, normalPatternSummary, normalPatternVisible });

  const normalPatternCommitPromise = bridge.request('cad_commit', {
    previewId: normalPatternPreview.snapshot.preview.previewId,
    expectedRevision: normalPatternPreview.snapshot.preview.baseRevision,
  });
  const normalPatternApprovalVisible = await approveAgentPreviewAsHuman(page, 'Edit extrude');
  const normalPatternCommitted: any = await normalPatternCommitPromise;
  const normalPatternDetail: any = await bridge.request('cad_inspect', {
    query: { kind: 'entity.detail', entity: { kind: 'feature', id: 'feature-pattern-controls' } },
  });
  const normalPatternPersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const pattern = (project: any) =>
      project?.partDefinitions?.[0]?.features?.find((entry: any) => entry.id === 'feature-pattern-controls')?.pattern;
    return { local: pattern(local), journal: pattern(journal?.document) };
  });
  const normalPatternUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: normalPatternCommitted.revision,
  });
  const normalPatternUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('approved normal sketch-operation pattern edit persists the same editable feature and Undo restores the exact project',
    normalPatternApprovalVisible === true &&
    JSON.stringify(normalPatternDetail.result.value.pattern) === JSON.stringify({ kind: 'linear', n: 4, dx: 5, dy: 1 }) &&
    JSON.stringify(normalPatternPersistence.local) === JSON.stringify({ kind: 'linear', n: 4, dx: 5, dy: 1 }) &&
    JSON.stringify(normalPatternPersistence.journal) === JSON.stringify({ kind: 'linear', n: 4, dx: 5, dy: 1 }) &&
    normalPatternUndo.revision === normalPatternCommitted.revision + 1 &&
    normalPatternUndoSummary.result.documentHash === base.result.documentHash &&
    pageErrors.length === 0,
    {
      normalPatternCommitted,
      normalPatternDetail,
      normalPatternPersistence,
      normalPatternUndo,
      pageErrors,
    });

  await bridge.close('Persistent feature pattern field checks complete');
  await context.close();
}

async function persistentDraftDecisionChecks(browser: Browser, url: string) {
  console.log('\nCAD Studio V6 unfinished-draft decision controls');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const fixture = createThreeBodyRuntimeProject({
    boolean: false,
    projectId: 'project-v6-draft-decision-controls',
  });
  await page.evaluateOnNewDocument((documentFixture) => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(documentFixture));
  }, fixture);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const bridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 draft decision agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: [
        'project.read', 'project.edit',
        'ui.read', 'ui.select', 'ui.navigate',
        'ui.command-draft', 'ui.present-preview', 'ui.wait-events',
      ],
    },
  });
  await approveConnectionAsHuman(page, 'V6 draft decision agent');
  for (let attempt = 0; attempt < 600 && bridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const base: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  let state: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const dirtyDraft: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: state.uiRevision,
    correlationId: 'observer-dirty-draft-open',
    actions: [
      { kind: 'control.invoke', controlId: 'body.create' },
      { kind: 'command.setInput', fieldId: 'sketch', value: [{ kind: 'circle', x: 2, y: 3, r: 4 }] },
      { kind: 'command.setInput', fieldId: 'height', value: 11 },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const decisionOpened: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: dirtyDraft.uiRevision,
    correlationId: 'observer-draft-decision-open',
    actions: [{ kind: 'control.invoke', controlId: 'project.clear' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const visibleDecision = await page.evaluate(() => ({
    open: Boolean((document.getElementById('bw-draft-decision') as HTMLDialogElement | null)?.open),
    text: document.getElementById('bw-draft-decision-copy')?.textContent,
    height: (document.getElementById('bw-sk-op-h') as HTMLInputElement | null)?.value,
  }));
  check('a dirty normal feature command exposes the real unfinished-edit decision with the draft intact',
    decisionOpened.snapshot.activeCommand?.commandId === 'model.extrude' &&
    decisionOpened.snapshot.activeCommand?.inputValues?.height === 11 &&
    decisionOpened.snapshot.surfaces.draftDecision.open === true &&
    decisionOpened.snapshot.surfaces.draftDecision.controlId === 'project.clear' &&
    decisionOpened.snapshot.documentRevision === base.revision &&
    visibleDecision.open === true &&
    /clear the project/i.test(visibleDecision.text || '') &&
    visibleDecision.height === '11',
    { decisionOpened, visibleDecision });

  const kept: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: decisionOpened.uiRevision,
    correlationId: 'observer-draft-keep',
    actions: [{ kind: 'control.invoke', controlId: 'dialog.draft.keep' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  check('Keep editing closes only the decision and preserves the exact normal command draft',
    kept.snapshot.surfaces.draftDecision.open === false &&
    kept.snapshot.activeCommand?.commandId === 'model.extrude' &&
    kept.snapshot.activeCommand?.inputValues?.height === 11 &&
    kept.snapshot.documentRevision === base.revision,
    kept.snapshot);

  const reopened: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: kept.uiRevision,
    correlationId: 'observer-draft-decision-reopen',
    actions: [{ kind: 'control.invoke', controlId: 'project.clear' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  let rollbackCode = '';
  try {
    await bridge.request('cad_ui', {
      action: 'apply',
      expectedUiRevision: reopened.uiRevision,
      correlationId: 'observer-draft-discard-rollback',
      actions: [
        { kind: 'control.invoke', controlId: 'dialog.draft.discard' },
        { kind: 'control.invoke', controlId: 'dialog.draft.keep' },
      ],
      presentation: { mode: 'instant', transition: 'cut' },
    });
  } catch (error: any) {
    rollbackCode = error.code;
  }
  state = await bridge.request('cad_ui', { action: 'snapshot' });
  const rollbackVisible = await page.evaluate(() => ({
    decisionOpen: Boolean((document.getElementById('bw-draft-decision') as HTMLDialogElement | null)?.open),
    clearOpen: Boolean((document.getElementById('bw-clear-decision') as HTMLDialogElement | null)?.open),
    sketchOpen: !(document.getElementById('bw-sketch') as HTMLElement | null)?.hidden,
    height: (document.getElementById('bw-sk-op-h') as HTMLInputElement | null)?.value,
  }));
  check('a failed multi-control batch restores the discarded normal draft and queued decision transactionally',
    rollbackCode === 'COMMAND_BLOCKED' &&
    state.activeCommand?.commandId === 'model.extrude' &&
    state.activeCommand?.inputValues?.height === 11 &&
    state.surfaces.draftDecision.open === true &&
    state.surfaces.clear.open === false &&
    state.documentRevision === base.revision &&
    rollbackVisible.decisionOpen === true &&
    rollbackVisible.clearOpen === false &&
    rollbackVisible.sketchOpen === true &&
    rollbackVisible.height === '11',
    { rollbackCode, state, rollbackVisible });

  const discarded: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: state.uiRevision,
    correlationId: 'observer-draft-discard',
    actions: [{ kind: 'control.invoke', controlId: 'dialog.draft.discard' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const discardedSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const discardedVisible = await page.evaluate(() => ({
    decisionOpen: Boolean((document.getElementById('bw-draft-decision') as HTMLDialogElement | null)?.open),
    clearOpen: Boolean((document.getElementById('bw-clear-decision') as HTMLDialogElement | null)?.open),
    sketchOpen: !(document.getElementById('bw-sketch') as HTMLElement | null)?.hidden,
  }));
  check('Discard removes only the unfinished draft, continues to the queued Clear decision, and leaves the document exact',
    discarded.snapshot.activeCommand === undefined &&
    discarded.snapshot.surfaces.draftDecision.open === false &&
    discarded.snapshot.surfaces.clear.open === true &&
    discarded.snapshot.documentRevision === base.revision &&
    discardedSummary.result.documentHash === base.result.documentHash &&
    discardedVisible.decisionOpen === false &&
    discardedVisible.clearOpen === true &&
    discardedVisible.sketchOpen === false &&
    pageErrors.length === 0,
    { discarded, discardedSummary, discardedVisible, pageErrors });
  const clearCancelled: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: discarded.uiRevision,
    actions: [{ kind: 'control.invoke', controlId: 'dialog.clear.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });

  const clearDecisionOpened: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: clearCancelled.uiRevision,
    correlationId: 'observer-clear-exact-decision',
    actions: [{ kind: 'control.invoke', controlId: 'project.clear' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const clearPreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-clear-exact-preview',
      label: 'Clear project',
      expectedRevision: base.revision,
      operations: [{ kind: 'project.clear', input: {} }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const clearPreviewSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const clearPreviewVisible = await page.evaluate(() => ({
    clearOpen: Boolean((document.getElementById('bw-clear-decision') as HTMLDialogElement | null)?.open),
    commandOpen: Boolean((document.getElementById('bw-v5-command') as HTMLDialogElement | null)?.open),
    title: document.getElementById('bw-v5-command-title')?.textContent,
    operationText: document.getElementById('bw-v5-command-fields')?.querySelector('li')?.textContent,
    previewText: document.getElementById('bw-v6-command-preview')?.textContent,
  }));
  check('Confirm Clear becomes an exact destructive preview and keeps the project byte-identical before approval',
    clearDecisionOpened.snapshot.surfaces.clear.open === true &&
    clearPreview.visible === true &&
    clearPreview.validation?.valid === true &&
    clearPreview.validation?.exactGeometry === true &&
    clearPreview.confirmation?.required === true &&
    clearPreview.confirmation?.reasons?.includes('DESTRUCTIVE_DELETE') &&
    clearPreviewSummary.result.documentHash === base.result.documentHash &&
    clearPreviewVisible.clearOpen === false &&
    clearPreviewVisible.commandOpen === true &&
    clearPreviewVisible.title === 'Clear project' &&
    clearPreviewVisible.operationText === 'Clear all editable project structure' &&
    /Exact validation passed/.test(clearPreviewVisible.previewText || ''),
    { clearPreview, clearPreviewSummary, clearPreviewVisible });

  const clearCommitPromise = bridge.request('cad_commit', {
    previewId: clearPreview.previewId,
    expectedRevision: clearPreview.baseRevision,
  });
  const clearApprovalVisible = await approveAgentPreviewAsHuman(page, 'Clear project');
  const clearCommitted: any = await clearCommitPromise;
  const clearedTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const clearPersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const counts = (project: any) => ({
      parameters: project?.parameters?.length,
      features: project?.partDefinitions?.[0]?.features?.length,
      bodies: project?.partDefinitions?.[0]?.bodies?.length,
    });
    return { local: counts(local), journal: counts(journal?.document) };
  });
  const clearUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: clearCommitted.revision,
  });
  const clearUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('approved Clear persists an empty editable project and normal Undo restores the exact prior project',
    clearApprovalVisible === true &&
    !clearedTree.result.items.some((entry: any) => ['parameter', 'feature', 'body'].includes(entry.kind)) &&
    JSON.stringify(clearPersistence.local) === JSON.stringify({ parameters: 0, features: 0, bodies: 0 }) &&
    JSON.stringify(clearPersistence.journal) === JSON.stringify({ parameters: 0, features: 0, bodies: 0 }) &&
    clearUndo.revision === clearCommitted.revision + 1 &&
    clearUndoSummary.result.documentHash === base.result.documentHash &&
    pageErrors.length === 0,
    {
      clearCommitted,
      clearedTree,
      clearPersistence,
      clearUndo,
      clearUndoSummary,
      pageErrors,
    });

  state = await bridge.request('cad_ui', { action: 'snapshot' });
  const applyDraftOpened: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: state.uiRevision,
    correlationId: 'observer-apply-draft-open',
    actions: [
      { kind: 'control.invoke', controlId: 'body.create' },
      { kind: 'command.setInput', fieldId: 'sketch', value: [{ kind: 'rect', x: 0, y: 0, w: 8, h: 6 }] },
      { kind: 'command.setInput', fieldId: 'height', value: 7 },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const applyDraftDecision: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: applyDraftOpened.uiRevision,
    correlationId: 'observer-apply-draft-decision',
    actions: [{ kind: 'control.invoke', controlId: 'project.clear' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const applyDraftPreview: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: applyDraftDecision.uiRevision,
    correlationId: 'observer-apply-draft-preview',
    actions: [{ kind: 'command.preview' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const applyDraftPreviewSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('Apply draft first exposes the unfinished normal command as an exact non-mutating preview',
    applyDraftPreview.snapshot.activeCommand?.commandId === 'model.extrude' &&
    applyDraftPreview.snapshot.activeCommand?.state === 'preview' &&
    applyDraftPreview.snapshot.preview?.validation?.valid === true &&
    applyDraftPreview.snapshot.preview?.validation?.exactGeometry === true &&
    applyDraftPreview.snapshot.surfaces.draftDecision.open === true &&
    applyDraftPreviewSummary.result.documentHash === base.result.documentHash,
    { applyDraftPreview, applyDraftPreviewSummary });

  const applyDraftCommitPromise = bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: applyDraftPreview.uiRevision,
    correlationId: 'observer-apply-draft-commit',
    actions: [{ kind: 'command.commit' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const applyDraftApprovalVisible = await approveAgentPreviewAsHuman(page, 'Create extrude');
  const applyDraftCommitted: any = await applyDraftCommitPromise;
  const applyDraftTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const applyDraftPersistence = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const count = (project: any) => project?.partDefinitions?.[0]?.features?.length;
    return { local: count(local), journal: count(journal?.document) };
  });
  check('approved Apply draft commits once, persists, closes the draft decision, and continues to the queued Clear decision',
    applyDraftApprovalVisible === true &&
    applyDraftCommitted.snapshot.activeCommand === undefined &&
    applyDraftCommitted.snapshot.preview === undefined &&
    applyDraftCommitted.snapshot.surfaces.draftDecision.open === false &&
    applyDraftCommitted.snapshot.surfaces.clear.open === true &&
    applyDraftCommitted.snapshot.documentRevision === clearUndo.revision + 1 &&
    applyDraftTree.result.items.some((entry: any) =>
      entry.kind === 'feature' && entry.id === applyDraftPreview.snapshot.activeCommand.generatedIds.featureId) &&
    applyDraftPersistence.local === fixture.partDefinitions[0].features.length + 1 &&
    applyDraftPersistence.journal === fixture.partDefinitions[0].features.length + 1 &&
    pageErrors.length === 0,
    { applyDraftCommitted, applyDraftTree, applyDraftPersistence, pageErrors });
  const applyDraftClearCancelled: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: applyDraftCommitted.uiRevision,
    actions: [{ kind: 'control.invoke', controlId: 'dialog.clear.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const applyDraftUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: applyDraftCommitted.snapshot.documentRevision,
  });
  const applyDraftUndoSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('normal Undo after Apply draft restores the exact pre-draft project',
    applyDraftClearCancelled.snapshot.surfaces.clear.open === false &&
    applyDraftUndo.revision === applyDraftCommitted.snapshot.documentRevision + 1 &&
    applyDraftUndoSummary.result.documentHash === base.result.documentHash,
    { applyDraftClearCancelled, applyDraftUndo, applyDraftUndoSummary });

  await bridge.close('Persistent unfinished-draft decision checks complete');
  await context.close();
}

async function visibleModelCommandChecks(browser: Browser, url: string) {
  console.log('\nCAD Studio V6 full advanced modeling command family');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const fixture = buildVisibleModelCommandFixture();
  await page.evaluateOnNewDocument((documentFixture) => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(documentFixture));
  }, fixture);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const bridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 modeling agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: [
        'project.read', 'project.edit',
        'ui.read', 'ui.select', 'ui.navigate', 'ui.command-draft', 'ui.present-preview', 'ui.present-demo', 'ui.wait-events',
      ],
    },
  });
  await approveConnectionAsHuman(page, 'V6 modeling agent');
  for (let attempt = 0; attempt < 600 && bridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  let state: any = await bridge.request('cad_ui', { action: 'snapshot' });
  if (state.viewport.renderState !== 'idle') {
    const settled: any = await bridge.request('cad_ui', {
      action: 'apply',
      expectedUiRevision: state.uiRevision,
      actions: [{ kind: 'presentation.waitForSettled', correlationId: 'observer-model-ready' }],
      presentation: { mode: 'instant', transition: 'cut' },
    });
    state = settled.snapshot;
  }
  const dynamicPartActions: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: state.uiRevision,
    correlationId: 'observer-dynamic-part-actions',
    actions: [
      { kind: 'tree.invoke', entity: { kind: 'body', id: RUNTIME_BODY_IDS.housing }, operation: 'select' },
      { kind: 'tree.invoke', entity: { kind: 'body', id: RUNTIME_BODY_IDS.housing }, operation: 'export' },
      { kind: 'tree.invoke', entity: { kind: 'body', id: RUNTIME_BODY_IDS.housing }, operation: 'isolate' },
      { kind: 'inspector.invoke', operation: 'body.isolate' },
      { kind: 'tree.invoke', entity: { kind: 'feature', id: RUNTIME_FEATURE_IDS.housing }, operation: 'select' },
      { kind: 'tree.invoke', entity: { kind: 'body', id: 'pattern-visible-housing-instance-1' }, operation: 'pattern-instance.select' },
      { kind: 'tree.invoke', entity: { kind: 'body', id: 'pattern-visible-housing-instance-1' }, operation: 'pattern-instance.export' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const visibleDynamicPart = await page.evaluate(() => ({
    selectedPattern: document.querySelector('[data-pattern-instance-id="pattern-visible-housing-instance-1"]')?.getAttribute('aria-selected'),
    housingExport: (document.querySelector('[data-body-export="body-feature-housing"]') as HTMLInputElement | null)?.checked,
    patternExport: (document.querySelector('[data-body-export="pattern-visible-housing-instance-1"]') as HTMLInputElement | null)?.checked,
  }));
  check('dynamic part tree and inspector actions visibly select bodies, features, and pattern occurrences while preserving document state',
    dynamicPartActions.snapshot.documentRevision === state.documentRevision &&
    dynamicPartActions.snapshot.selection.some((entry: any) => entry.kind === 'body' && entry.id === 'pattern-visible-housing-instance-1') &&
    dynamicPartActions.snapshot.tree.exportBodyIds.includes(RUNTIME_BODY_IDS.housing) &&
    dynamicPartActions.snapshot.tree.exportBodyIds.includes('pattern-visible-housing-instance-1') &&
    !dynamicPartActions.snapshot.viewport.isolatedBodyId &&
    dynamicPartActions.results.some((entry: any) => entry.kind === 'tree.invoke' && entry.result?.operation === 'select' && entry.result.selection?.[0]?.id === RUNTIME_BODY_IDS.housing) &&
    dynamicPartActions.results.some((entry: any) => entry.kind === 'tree.invoke' && entry.result?.operation === 'select' && entry.result.selection?.[0]?.id === RUNTIME_FEATURE_IDS.housing) &&
    dynamicPartActions.results.some((entry: any) => entry.kind === 'inspector.invoke' && entry.result?.operation === 'body.isolate' && entry.result.isolatedBodyId === null) &&
    visibleDynamicPart.selectedPattern === 'true' &&
    visibleDynamicPart.housingExport === true &&
    visibleDynamicPart.patternExport === true,
    { snapshot: dynamicPartActions.snapshot, results: dynamicPartActions.results, visibleDynamicPart });
  const dynamicPartCleaned: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: dynamicPartActions.uiRevision,
    correlationId: 'observer-dynamic-part-cleanup',
    actions: [
      { kind: 'tree.invoke', entity: { kind: 'body', id: RUNTIME_BODY_IDS.housing }, operation: 'export' },
      { kind: 'tree.invoke', entity: { kind: 'body', id: 'pattern-visible-housing-instance-1' }, operation: 'pattern-instance.export' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  let dynamicRollbackCode = '';
  try {
    await bridge.request('cad_ui', {
      action: 'apply',
      expectedUiRevision: dynamicPartCleaned.uiRevision,
      correlationId: 'observer-dynamic-part-rollback',
      actions: [
        { kind: 'tree.invoke', entity: { kind: 'body', id: RUNTIME_BODY_IDS.housing }, operation: 'export' },
        { kind: 'tree.invoke', entity: { kind: 'body', id: RUNTIME_BODY_IDS.housing }, operation: 'isolate' },
        { kind: 'inspector.invoke', operation: 'inspection.clear' },
      ],
      presentation: { mode: 'instant', transition: 'cut' },
    });
  } catch (error: any) {
    dynamicRollbackCode = error.code;
  }
  const dynamicPartRolledBack: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const visibleDynamicRollback = await page.evaluate(() => ({
    housingExport: (document.querySelector('[data-body-export="body-feature-housing"]') as HTMLInputElement | null)?.checked,
    visibleBodies: [...document.querySelectorAll<HTMLElement>('[data-body-id]')]
      .filter((entry) => !/,\s*hidden(?:,|$)/.test(entry.getAttribute('aria-label') || '')).length,
  }));
  check('failed dynamic action batch transactionally restores export and isolation state',
    dynamicRollbackCode === 'COMMAND_BLOCKED' &&
    dynamicPartRolledBack.documentRevision === dynamicPartCleaned.snapshot.documentRevision &&
    !dynamicPartRolledBack.tree.exportBodyIds.includes(RUNTIME_BODY_IDS.housing) &&
    !dynamicPartRolledBack.viewport.isolatedBodyId &&
    visibleDynamicRollback.housingExport === false &&
    visibleDynamicRollback.visibleBodies >= 3,
    { dynamicRollbackCode, snapshot: dynamicPartRolledBack, visibleDynamicRollback });

  const bodyEditBase: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const bodyEditPreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-persistent-body-edit',
      label: 'Edit body presentation and ownership',
      expectedRevision: bodyEditBase.revision,
      operations: [
        { kind: 'body.rename', input: { bodyId: RUNTIME_BODY_IDS.housing, name: 'Agent housing' } },
        { kind: 'body.setVisibility', input: { bodyId: RUNTIME_BODY_IDS.housing, visible: false } },
        { kind: 'body.suppress', input: { bodyId: RUNTIME_BODY_IDS.tool, suppressed: true } },
        { kind: 'body.activate', input: { bodyId: RUNTIME_BODY_IDS.shaft } },
      ],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const bodyEditPreviewSnapshot: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const bodyEditPreviewSummary: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const visibleBodyEditPreview = await page.evaluate(() => {
    const dialog = document.getElementById('bw-v5-command') as HTMLDialogElement | null;
    const preview = document.getElementById('bw-v6-command-preview');
    return {
      dialogOpen: Boolean(dialog?.open),
      command: dialog?.dataset.command,
      kind: document.getElementById('bw-v5-command-kind')?.textContent,
      title: document.getElementById('bw-v5-command-title')?.textContent,
      operationKinds: [...(document.getElementById('bw-v5-command-fields')?.querySelectorAll('li') || [])]
        .map((entry) => (entry as HTMLElement).dataset.operationKind),
      operationText: [...(document.getElementById('bw-v5-command-fields')?.querySelectorAll('li') || [])]
        .map((entry) => entry.textContent),
      bodyNameDraft: (document.querySelector('[data-body-name]') as HTMLInputElement | null)?.value,
      bodyNameDraftVisible: document.querySelector('[data-body-name]')?.getAttribute('data-agent-draft'),
      previewText: preview?.textContent,
      previewVisible: preview ? !preview.hidden : false,
      applyText: document.getElementById('bw-v5-command-apply')?.textContent,
    };
  });
  check('direct persistent body transaction uses the normal visible exact-preview surface without mutating the project',
    bodyEditPreview.visible === true &&
    bodyEditPreview.validation?.valid === true &&
    bodyEditPreview.validation?.exactGeometry === true &&
    bodyEditPreviewSnapshot.documentRevision === bodyEditBase.revision &&
    bodyEditPreviewSnapshot.activeCommand?.commandId === 'document.transaction' &&
    bodyEditPreviewSnapshot.activeCommand?.state === 'preview' &&
    bodyEditPreviewSnapshot.preview?.visible === true &&
    bodyEditPreviewSnapshot.preview?.previewId === bodyEditPreview.previewId &&
    bodyEditPreviewSummary.result.documentHash === bodyEditBase.result.documentHash &&
    visibleBodyEditPreview.dialogOpen === true &&
    visibleBodyEditPreview.command === 'document-transaction' &&
    visibleBodyEditPreview.kind === 'Agent transaction' &&
    visibleBodyEditPreview.title === 'Edit body presentation and ownership' &&
    visibleBodyEditPreview.operationKinds?.join(',') === 'body.rename,body.setVisibility,body.suppress,body.activate' &&
    visibleBodyEditPreview.operationText?.join('|') ===
      'Rename Housing to Agent housing|Hide Housing|Suppress Tool|Make Shaft the active body' &&
    visibleBodyEditPreview.bodyNameDraft === 'Agent housing' &&
    visibleBodyEditPreview.bodyNameDraftVisible === 'true' &&
    visibleBodyEditPreview.previewVisible === true &&
    /Exact validation passed/.test(visibleBodyEditPreview.previewText || '') &&
    visibleBodyEditPreview.applyText === 'Apply exact preview',
    { bodyEditPreview, bodyEditPreviewSnapshot, visibleBodyEditPreview });

  const bodyEditCommitPromise = bridge.request('cad_commit', {
    previewId: bodyEditPreview.previewId,
    expectedRevision: bodyEditPreview.baseRevision,
  });
  const bodyEditApprovalVisible = await approveAgentPreviewAsHuman(page, 'Edit body presentation and ownership');
  const bodyEditCommitted: any = await bodyEditCommitPromise;
  let bodyEditCommittedSnapshot: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const bodyEditSettled: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: bodyEditCommittedSnapshot.uiRevision,
    correlationId: 'observer-persistent-body-edit-settled',
    actions: [{ kind: 'presentation.waitForSettled', correlationId: 'observer-persistent-body-edit-settled' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  bodyEditCommittedSnapshot = bodyEditSettled.snapshot;
  const [editedHousing, editedTool, editedShaft] = await Promise.all([
    bridge.request('cad_inspect', { query: { kind: 'entity.detail', entity: { kind: 'body', id: RUNTIME_BODY_IDS.housing } } }),
    bridge.request('cad_inspect', { query: { kind: 'entity.detail', entity: { kind: 'body', id: RUNTIME_BODY_IDS.tool } } }),
    bridge.request('cad_inspect', { query: { kind: 'entity.detail', entity: { kind: 'body', id: RUNTIME_BODY_IDS.shaft } } }),
  ]) as any[];
  const bodyEditPersistence = await page.evaluate(async (ids) => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const findBody = (project: any, id: string) =>
      project?.partDefinitions?.flatMap((part: any) => part.bodies || []).find((body: any) => body.id === id);
    return {
      localHousing: findBody(local, ids.housing),
      localTool: findBody(local, ids.tool),
      localActiveBodyId: local?.partDefinitions?.[0]?.metadata?.activeBodyId,
      journalHousing: findBody(journal?.document, ids.housing),
      journalTool: findBody(journal?.document, ids.tool),
      journalActiveBodyId: journal?.document?.partDefinitions?.[0]?.metadata?.activeBodyId,
      journalRevision: journal?.commandRevision,
    };
  }, RUNTIME_BODY_IDS);
  const visibleBodyEditCommit = await page.evaluate((ids) => ({
    dialogOpen: Boolean((document.getElementById('bw-v5-command') as HTMLDialogElement | null)?.open),
    housingName: document.querySelector(`[data-body-id="${ids.housing}"] .body-select`)?.childNodes[0]?.textContent,
    housingAria: document.querySelector(`[data-body-id="${ids.housing}"]`)?.getAttribute('aria-label'),
    toolClass: document.querySelector(`[data-body-id="${ids.tool}"]`)?.className,
    activeLabel: document.getElementById('bw-active-body-label')?.textContent,
  }), RUNTIME_BODY_IDS);
  check('approved persistent body edit commits atomically, renders visibly, and persists to local and recovery storage',
    bodyEditApprovalVisible === true &&
    bodyEditCommitted.revision === bodyEditBase.revision + 1 &&
    bodyEditCommitted.historyEntry?.transactionId === 'observer-persistent-body-edit' &&
    bodyEditCommittedSnapshot.documentRevision === bodyEditCommitted.revision &&
    bodyEditCommittedSnapshot.activeCommand === undefined &&
    bodyEditCommittedSnapshot.preview === undefined &&
    editedHousing.result.value.name === 'Agent housing' &&
    editedHousing.result.value.visible === false &&
    editedTool.result.value.suppressed === true &&
    editedShaft.result.value.id === RUNTIME_BODY_IDS.shaft &&
    bodyEditPersistence.localHousing?.name === 'Agent housing' &&
    bodyEditPersistence.localHousing?.visible === false &&
    bodyEditPersistence.localTool?.suppressed === true &&
    bodyEditPersistence.localActiveBodyId === RUNTIME_BODY_IDS.shaft &&
    bodyEditPersistence.journalHousing?.name === 'Agent housing' &&
    bodyEditPersistence.journalTool?.suppressed === true &&
    bodyEditPersistence.journalActiveBodyId === RUNTIME_BODY_IDS.shaft &&
    bodyEditPersistence.journalRevision === bodyEditCommitted.revision &&
    visibleBodyEditCommit.dialogOpen === false &&
    visibleBodyEditCommit.housingName === 'Agent housing' &&
    /hidden/.test(visibleBodyEditCommit.housingAria || '') &&
    /is-suppressed/.test(visibleBodyEditCommit.toolClass || '') &&
    visibleBodyEditCommit.activeLabel === 'Active: Shaft',
    { bodyEditCommitted, bodyEditCommittedSnapshot, editedHousing, editedTool, editedShaft, bodyEditPersistence, visibleBodyEditCommit });

  const bodyEditUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: bodyEditCommitted.revision,
  });
  const [restoredHousing, restoredTool, restoredBodySummary] = await Promise.all([
    bridge.request('cad_inspect', { query: { kind: 'entity.detail', entity: { kind: 'body', id: RUNTIME_BODY_IDS.housing } } }),
    bridge.request('cad_inspect', { query: { kind: 'entity.detail', entity: { kind: 'body', id: RUNTIME_BODY_IDS.tool } } }),
    bridge.request('cad_inspect', { query: { kind: 'project.summary' } }),
  ]) as any[];
  check('normal Undo restores every body edit and its exact prior document hash',
    bodyEditUndo.revision === bodyEditCommitted.revision + 1 &&
    restoredHousing.result.value.name === 'Housing' &&
    restoredHousing.result.value.visible === true &&
    restoredTool.result.value.suppressed === false &&
    restoredBodySummary.result.documentHash === bodyEditBase.result.documentHash,
    { bodyEditUndo, restoredHousing, restoredTool, restoredBodySummary });

  const bodyDeletePreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-persistent-body-delete',
      label: 'Delete obsolete Tool body',
      expectedRevision: bodyEditUndo.revision,
      operations: [{ kind: 'body.delete', input: { bodyId: RUNTIME_BODY_IDS.tool } }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const bodyDeletePreviewTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const visibleBodyDeletePreview = await page.evaluate(() => ({
    dialogOpen: Boolean((document.getElementById('bw-v5-command') as HTMLDialogElement | null)?.open),
    title: document.getElementById('bw-v5-command-title')?.textContent,
    operationKind: (document.getElementById('bw-v5-command-fields')?.querySelector('li') as HTMLElement | null)?.dataset.operationKind,
    operationText: document.getElementById('bw-v5-command-fields')?.querySelector('li')?.textContent,
    previewText: document.getElementById('bw-v6-command-preview')?.textContent,
  }));
  check('body deletion remains visibly previewed and recoverable before commit',
    bodyDeletePreview.visible === true &&
    bodyDeletePreview.validation?.valid === true &&
    bodyDeletePreview.confirmation?.required === true &&
    bodyDeletePreview.confirmation?.reasons?.length > 0 &&
    bodyDeletePreview.changeSet.deleted.some((entry: any) => entry.kind === 'body' && entry.id === RUNTIME_BODY_IDS.tool) &&
    bodyDeletePreviewTree.result.items.some((entry: any) => entry.kind === 'body' && entry.id === RUNTIME_BODY_IDS.tool) &&
    visibleBodyDeletePreview.dialogOpen === true &&
    visibleBodyDeletePreview.title === 'Delete obsolete Tool body' &&
    visibleBodyDeletePreview.operationKind === 'body.delete' &&
    visibleBodyDeletePreview.operationText === 'Delete Tool and dependent structure' &&
    /Exact validation passed/.test(visibleBodyDeletePreview.previewText || '') &&
    /Confirmation is required for this destructive change/.test(visibleBodyDeletePreview.previewText || ''),
    { bodyDeletePreview, visibleBodyDeletePreview });
  const bodyDeleteCommitPromise = bridge.request('cad_commit', {
    previewId: bodyDeletePreview.previewId,
    expectedRevision: bodyDeletePreview.baseRevision,
  });
  const bodyDeleteApprovalVisible = await approveAgentPreviewAsHuman(page, 'Delete obsolete Tool body');
  const bodyDeleteCommitted: any = await bodyDeleteCommitPromise;
  const bodyDeleteTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  const bodyDeletePersistence = await page.evaluate(async (bodyId) => {
    await (window as any).__bwStudio.flushStorage();
    const local = JSON.parse(localStorage.getItem('bw-studio-doc-v2') || 'null');
    const journal = await (window as any).__bwStudio.journalState();
    const hasBody = (project: any) =>
      project?.partDefinitions?.some((part: any) => (part.bodies || []).some((body: any) => body.id === bodyId));
    return {
      localHasBody: hasBody(local),
      journalHasBody: hasBody(journal?.document),
      journalRevision: journal?.commandRevision,
      visibleRow: Boolean(document.querySelector(`[data-body-id="${bodyId}"]`)),
    };
  }, RUNTIME_BODY_IDS.tool);
  check('approved body deletion removes dependent structure transactionally and persists the exact revision',
    bodyDeleteApprovalVisible === true &&
    bodyDeleteCommitted.revision === bodyEditUndo.revision + 1 &&
    bodyDeleteCommitted.historyEntry?.transactionId === 'observer-persistent-body-delete' &&
    !bodyDeleteTree.result.items.some((entry: any) => entry.kind === 'body' && entry.id === RUNTIME_BODY_IDS.tool) &&
    bodyDeletePersistence.localHasBody === false &&
    bodyDeletePersistence.journalHasBody === false &&
    bodyDeletePersistence.journalRevision === bodyDeleteCommitted.revision &&
    bodyDeletePersistence.visibleRow === false,
    { bodyDeleteCommitted, bodyDeleteTree, bodyDeletePersistence });
  const bodyDeleteUndo: any = await bridge.request('cad_history', {
    action: 'undo',
    expectedRevision: bodyDeleteCommitted.revision,
  });
  const restoredDeleteTree: any = await bridge.request('cad_inspect', { query: { kind: 'project.tree', limit: 1000 } });
  check('normal Undo recovers the deleted body and exact pre-delete model',
    bodyDeleteUndo.revision === bodyDeleteCommitted.revision + 1 &&
    restoredDeleteTree.result.items.some((entry: any) => entry.kind === 'body' && entry.id === RUNTIME_BODY_IDS.tool),
    { bodyDeleteUndo, restoredDeleteTree });

  const bodyCancelBase: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const bodyCancelPreview: any = await bridge.request('cad_preview', {
    transaction: {
      transactionId: 'observer-persistent-body-cancel',
      label: 'Preview a temporary body name',
      expectedRevision: bodyCancelBase.revision,
      operations: [{ kind: 'body.rename', input: { bodyId: RUNTIME_BODY_IDS.housing, name: 'Temporary housing' } }],
      atomic: true,
      metadata: { actor: 'agent' },
    },
  });
  const bodyCancelSnapshot: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const bodyCancelDraftValue = await page.evaluate(() =>
    (document.querySelector('[data-body-name]') as HTMLInputElement | null)?.value);
  const bodyCancelled: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: bodyCancelSnapshot.uiRevision,
    correlationId: 'observer-persistent-body-cancel',
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const bodyCancelAfter: any = await bridge.request('cad_inspect', { query: { kind: 'project.summary' } });
  const visibleBodyCancel = await page.evaluate((previewId) => ({
    dialogOpen: Boolean((document.getElementById('bw-v5-command') as HTMLDialogElement | null)?.open),
    bodyName: (document.querySelector('[data-body-name]') as HTMLInputElement | null)?.value,
    previewRegistered: (window as any).__bwStudio.agentPreviewIds().includes(previewId),
  }), bodyCancelPreview.previewId);
  check('cancelling a direct persistent preview restores the normal inspector field and discards the preview without editing',
    bodyCancelDraftValue === 'Temporary housing' &&
    bodyCancelled.snapshot.documentRevision === bodyCancelBase.revision &&
    bodyCancelled.snapshot.activeCommand === undefined &&
    bodyCancelled.snapshot.preview === undefined &&
    bodyCancelAfter.result.documentHash === bodyCancelBase.result.documentHash &&
    visibleBodyCancel.dialogOpen === false &&
    visibleBodyCancel.bodyName === 'Housing' &&
    visibleBodyCancel.previewRegistered === false,
    { bodyCancelPreview, bodyCancelled, bodyCancelAfter, visibleBodyCancel });
  state = await bridge.request('cad_ui', { action: 'snapshot' });
  const faces: any = await bridge.request('cad_query', {
    query: { kind: 'geometry.topology', topologyKind: 'face', bodyId: RUNTIME_BODY_IDS.housing, limit: 1000 },
  });
  const edges: any = await bridge.request('cad_query', {
    query: { kind: 'geometry.topology', topologyKind: 'edge', bodyId: RUNTIME_BODY_IDS.housing, limit: 1000 },
  });
  const sideFace = faces.result.items.find((entry: any) => Math.abs(entry.topologySignature?.n?.[2] || 0) < 0.5) || faces.result.items[0];
  const planarFace = faces.result.items.find((entry: any) => Math.abs(entry.topologySignature?.n?.[2] || 0) > 0.9) || faces.result.items[0];
  const edge = edges.result.items[0];
  const body = (id: string) => ({ kind: 'body', id });
  const datum = (id: string) => ({ kind: 'datum', id });
  const sketch = (id: string) => ({ kind: 'sketch', id });
  const housing = body(RUNTIME_BODY_IDS.housing);
  const sketchToolIds = ['line', 'rect', 'circle', 'poly', 'select', 'pan'];
  const sketchToolsOperated: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: state.uiRevision,
    correlationId: 'observer-sketch-tools',
    actions: [
      { kind: 'selection.set', entity: planarFace },
      { kind: 'command.open', commandId: 'model.extrude' },
      ...sketchToolIds.map((toolId) => ({ kind: 'sketch.setTool', toolId })),
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const visibleSketchTool = await page.evaluate(() => ({
    workspace: document.querySelector('[data-workspace="sketch"]')?.getAttribute('aria-selected'),
    pressed: [...document.querySelectorAll<HTMLElement>('[data-sktool][aria-pressed="true"]')].map((entry) => entry.dataset.sktool),
    sketchVisible: !(document.getElementById('bw-sketch') as HTMLElement | null)?.hidden,
  }));
  check('all six sketch-tool controls drive the real visible sketch state machine by stable ID',
    sketchToolsOperated.results.filter((entry: any) => entry.kind === 'sketch.setTool').map((entry: any) => entry.result.toolId).join(',') === sketchToolIds.join(',') &&
    sketchToolsOperated.snapshot.activeCommand?.toolId === 'pan' &&
    visibleSketchTool.workspace === 'true' &&
    visibleSketchTool.sketchVisible === true &&
    visibleSketchTool.pressed.join(',') === 'pan',
    { results: sketchToolsOperated.results, snapshot: sketchToolsOperated.snapshot.activeCommand, visibleSketchTool });
  const sketchToolsClosed: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: sketchToolsOperated.uiRevision,
    correlationId: 'observer-sketch-tools-cancel',
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  state = sketchToolsClosed.snapshot;

  const faceLifecycle: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: state.uiRevision,
    correlationId: 'observer-face-lifecycle',
    actions: [
      { kind: 'selection.clear' },
      { kind: 'command.open', commandId: 'model.extrude' },
      { kind: 'command.advance', controlId: 'model.face.next' },
      { kind: 'command.advance', controlId: 'model.face.use' },
      { kind: 'command.setInput', fieldId: 'sketch', value: [{ kind: 'circle', x: 0, y: 0, r: 2 }] },
      { kind: 'command.setInput', fieldId: 'height', value: 6 },
      { kind: 'command.preview' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  check('face lifecycle controls visibly advance the normal picker into an exact face-supported sketch preview',
    faceLifecycle.results.filter((entry: any) => entry.kind === 'command.advance').length === 2 &&
    faceLifecycle.snapshot.activeCommand?.stage === 'sketching' &&
    faceLifecycle.snapshot.activeCommand?.boundSelections?.supportFace?.length === 1 &&
    faceLifecycle.snapshot.preview?.validation?.exactGeometry === true,
    { results: faceLifecycle.results, activeCommand: faceLifecycle.snapshot.activeCommand, preview: faceLifecycle.snapshot.preview });
  const faceLifecycleClosed: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: faceLifecycle.uiRevision,
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });

  const pressPullLifecycle: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: faceLifecycleClosed.uiRevision,
    correlationId: 'observer-presspull-lifecycle',
    actions: [
      { kind: 'selection.clear' },
      { kind: 'command.open', commandId: 'model.extrude' },
      { kind: 'command.advance', controlId: 'model.face.base' },
      { kind: 'command.setInput', fieldId: 'sketch', value: [{ kind: 'rect', x: 0, y: 0, w: 12, h: 8 }] },
      { kind: 'command.advance', controlId: 'sketch.presspull.start' },
      { kind: 'command.setInput', fieldId: 'height', value: 9 },
      { kind: 'command.advance', controlId: 'sketch.presspull.back' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const visiblePressPull = await page.evaluate(() => ({
    sketchVisible: !(document.getElementById('bw-sketch') as HTMLElement | null)?.hidden,
    pressPullHidden: (document.getElementById('bw-presspull') as HTMLElement | null)?.hidden,
    height: (document.getElementById('bw-sk-op-h') as HTMLInputElement | null)?.value,
  }));
  check('base-plane and press-pull lifecycle controls use the normal preview controller and preserve typed distance on Back',
    pressPullLifecycle.snapshot.activeCommand?.stage === 'sketching' &&
    pressPullLifecycle.snapshot.activeCommand?.inputValues?.height === 9 &&
    visiblePressPull.sketchVisible === true &&
    visiblePressPull.pressPullHidden === true &&
    visiblePressPull.height === '9',
    { activeCommand: pressPullLifecycle.snapshot.activeCommand, visiblePressPull });
  const pressPullClosed: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: pressPullLifecycle.uiRevision,
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });

  const shellLifecycle: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: pressPullClosed.uiRevision,
    correlationId: 'observer-shell-lifecycle',
    actions: [
      { kind: 'selection.set', entity: housing },
      { kind: 'command.open', commandId: 'model.shell' },
      { kind: 'command.advance', controlId: 'model.shell.next' },
      { kind: 'command.advance', controlId: 'model.shell.toggle' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  check('shell Next and Toggle controls use the real multi-body face picker',
    shellLifecycle.snapshot.activeCommand?.stage === 'picking-faces' &&
    shellLifecycle.snapshot.activeCommand?.boundSelections?.faces?.length === 1 &&
    shellLifecycle.snapshot.activeCommand?.boundSelections?.body?.[0]?.id === RUNTIME_BODY_IDS.housing,
    shellLifecycle.snapshot.activeCommand);
  const shellLifecycleClosed: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: shellLifecycle.uiRevision,
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  state = shellLifecycleClosed.snapshot;
  const modelCases: Array<{ commandId: string; selection?: any; actions: any[] }> = [
    {
      commandId: 'model.extrude',
      selection: planarFace,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'supportFace', entities: [planarFace] },
        { kind: 'command.setInput', fieldId: 'sketch', value: [{ kind: 'circle', x: 0, y: 0, r: 3 }] },
        { kind: 'command.setInput', fieldId: 'height', value: 8 },
        { kind: 'command.setInput', fieldId: 'resultPolicy', value: 'add' },
        { kind: 'command.bindSelection', fieldId: 'targetBody', entities: [housing] },
      ],
    },
    {
      commandId: 'model.cut',
      selection: planarFace,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'supportFace', entities: [planarFace] },
        { kind: 'command.setInput', fieldId: 'sketch', value: [{ kind: 'circle', x: 0, y: 0, r: 2 }] },
        { kind: 'command.setInput', fieldId: 'height', value: 30 },
        { kind: 'command.setInput', fieldId: 'through', value: true },
        { kind: 'command.setInput', fieldId: 'resultPolicy', value: 'subtract' },
        { kind: 'command.bindSelection', fieldId: 'targetBody', entities: [housing] },
      ],
    },
    {
      commandId: 'model.revolve',
      selection: housing,
      actions: [
        { kind: 'command.setInput', fieldId: 'sketch', value: [{ kind: 'rect', x: 8, y: 0, w: 3, h: 12 }] },
        { kind: 'command.setInput', fieldId: 'resultPolicy', value: 'new-body' },
        { kind: 'command.setInput', fieldId: 'bodyName', value: 'Agent revolved body' },
      ],
    },
    {
      commandId: 'model.fillet',
      selection: edge,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'edges', entities: [edge] },
        { kind: 'command.setInput', fieldId: 'radius', value: 1 },
      ],
    },
    {
      commandId: 'model.chamfer',
      selection: edge,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'edges', entities: [edge] },
        { kind: 'command.setInput', fieldId: 'radius', value: 1 },
      ],
    },
    {
      commandId: 'model.shell',
      selection: planarFace,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'body', entities: [housing] },
        { kind: 'command.bindSelection', fieldId: 'faces', entities: [planarFace] },
        { kind: 'command.setInput', fieldId: 'thickness', value: 1 },
      ],
    },
    {
      commandId: 'model.split',
      selection: housing,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'targetBody', entities: [housing] },
        { kind: 'command.bindSelection', fieldId: 'toolBody', entities: [body(RUNTIME_BODY_IDS.tool)] },
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent visible split' },
        { kind: 'command.setInput', fieldId: 'keepOriginal', value: true },
        { kind: 'command.setInput', fieldId: 'keepTools', value: true },
      ],
    },
    {
      commandId: 'model.plane',
      actions: [
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent visible station' },
        { kind: 'command.setInput', fieldId: 'mode', value: 'offset' },
        { kind: 'command.bindSelection', fieldId: 'referenceDatum', entities: [datum(DATUM_IDS.yz)] },
        { kind: 'command.setInput', fieldId: 'offset', value: 95 },
      ],
    },
    {
      commandId: 'model.align',
      selection: body(RUNTIME_BODY_IDS.shaft),
      actions: [
        { kind: 'command.bindSelection', fieldId: 'body', entities: [body(RUNTIME_BODY_IDS.shaft)] },
        { kind: 'command.bindSelection', fieldId: 'fromDatum', entities: [datum(DATUM_IDS.yz)] },
        { kind: 'command.bindSelection', fieldId: 'toDatum', entities: [datum('datum-visible-profile-2')] },
        { kind: 'command.setInput', fieldId: 'offset', value: 4 },
        { kind: 'command.setInput', fieldId: 'flip', value: false },
      ],
    },
    {
      commandId: 'model.profile',
      actions: [
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent visible profile' },
        { kind: 'command.setInput', fieldId: 'curveKind', value: 'polyline' },
        { kind: 'command.bindSelection', fieldId: 'planeDatum', entities: [datum('datum-visible-profile-0')] },
        { kind: 'command.setInput', fieldId: 'points', value: [[-5, -5], [5, -5], [5, 5], [-5, 5]] },
      ],
    },
    {
      commandId: 'model.path',
      actions: [
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent visible path' },
        { kind: 'command.setInput', fieldId: 'curveKind', value: 'spline' },
        { kind: 'command.setInput', fieldId: 'points', value: [[0, 0, 0], [20, 5, 0], [40, 10, 4]] },
      ],
    },
    {
      commandId: 'model.loft',
      actions: [
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent visible loft' },
        {
          kind: 'command.bindSelection',
          fieldId: 'sections',
          entities: ['sketch-visible-profile-0', 'sketch-visible-profile-1', 'sketch-visible-profile-2'].map(sketch),
        },
        { kind: 'command.setInput', fieldId: 'startContinuity', value: 'free' },
        { kind: 'command.setInput', fieldId: 'endContinuity', value: 'free' },
        { kind: 'command.setInput', fieldId: 'ruled', value: false },
      ],
    },
    {
      commandId: 'model.sweep',
      actions: [
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent visible sweep' },
        { kind: 'command.bindSelection', fieldId: 'profileSketch', entities: [sketch('sketch-visible-profile-0')] },
        { kind: 'command.bindSelection', fieldId: 'pathSketch', entities: [sketch('sketch-visible-path')] },
        { kind: 'command.setInput', fieldId: 'orientation', value: 'minimum-twist' },
        { kind: 'command.setInput', fieldId: 'twistAngle', value: 15 },
        { kind: 'command.setInput', fieldId: 'scaleEnd', value: 0.8 },
        { kind: 'command.setInput', fieldId: 'referenceDirection', value: [0, 0, 1] },
      ],
    },
    {
      commandId: 'model.revolve-advanced',
      actions: [
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent visible revolve' },
        { kind: 'command.bindSelection', fieldId: 'profileSketch', entities: [sketch('sketch-visible-revolve')] },
        { kind: 'command.bindSelection', fieldId: 'axisDatum', entities: [datum(DATUM_IDS.xAxis)] },
        { kind: 'command.setInput', fieldId: 'angle', value: 210 },
        { kind: 'command.setInput', fieldId: 'startAngle', value: -15 },
        { kind: 'command.setInput', fieldId: 'symmetric', value: false },
      ],
    },
    {
      commandId: 'model.draft',
      selection: housing,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'body', entities: [housing] },
        { kind: 'command.bindSelection', fieldId: 'neutralPlane', entities: [datum(DATUM_IDS.xy)] },
        { kind: 'command.bindSelection', fieldId: 'faces', entities: [sideFace] },
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent visible draft' },
        { kind: 'command.setInput', fieldId: 'angle', value: 4 },
        { kind: 'command.setInput', fieldId: 'flip', value: false },
        { kind: 'command.setInput', fieldId: 'tangentPropagation', value: true },
      ],
    },
    {
      commandId: 'model.thicken',
      selection: housing,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'body', entities: [housing] },
        { kind: 'command.bindSelection', fieldId: 'faces', entities: [planarFace] },
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent visible thicken' },
        { kind: 'command.setInput', fieldId: 'bodyName', value: 'Agent thickened face' },
        { kind: 'command.setInput', fieldId: 'thickness', value: 2 },
        { kind: 'command.setInput', fieldId: 'symmetric', value: false },
        { kind: 'command.setInput', fieldId: 'flip', value: false },
      ],
    },
    {
      commandId: 'model.variable-fillet',
      selection: housing,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'body', entities: [housing] },
        { kind: 'command.bindSelection', fieldId: 'edges', entities: [edge] },
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent visible variable fillet' },
        { kind: 'command.setInput', fieldId: 'startRadius', value: 1 },
        { kind: 'command.setInput', fieldId: 'endRadius', value: 2 },
        { kind: 'command.setInput', fieldId: 'tangentPropagation', value: false },
      ],
    },
    {
      commandId: 'model.pattern',
      selection: housing,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'sourceBody', entities: [housing] },
        { kind: 'command.bindSelection', fieldId: 'axisDatum', entities: [datum(DATUM_IDS.xAxis)] },
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent visible body pattern' },
        { kind: 'command.setInput', fieldId: 'patternKind', value: 'circular' },
        { kind: 'command.setInput', fieldId: 'outputMode', value: 'linked' },
        { kind: 'command.setInput', fieldId: 'count', value: 6 },
        { kind: 'command.setInput', fieldId: 'distribution', value: 'full' },
        { kind: 'command.setInput', fieldId: 'orientation', value: 'rotate' },
      ],
    },
    {
      commandId: 'model.move',
      selection: housing,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'body', entities: [housing] },
        { kind: 'command.setInput', fieldId: 'translation', value: [8, 0, 0] },
        { kind: 'command.setInput', fieldId: 'gizmoSnap', value: 1 },
      ],
    },
    {
      commandId: 'model.copy',
      selection: housing,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'body', entities: [housing] },
        { kind: 'command.setInput', fieldId: 'translation', value: [55, 0, 0] },
        { kind: 'command.setInput', fieldId: 'gizmoSnap', value: 1 },
      ],
    },
    {
      commandId: 'model.rotate',
      selection: housing,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'body', entities: [housing] },
        { kind: 'command.bindSelection', fieldId: 'axisDatum', entities: [datum(DATUM_IDS.zAxis)] },
        { kind: 'command.setInput', fieldId: 'angle', value: 15 },
        { kind: 'command.setInput', fieldId: 'gizmoSnap', value: 15 },
      ],
    },
    {
      commandId: 'model.mirror',
      selection: housing,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'body', entities: [housing] },
        { kind: 'command.bindSelection', fieldId: 'planeDatum', entities: [datum('datum-visible-profile-2')] },
        { kind: 'command.setInput', fieldId: 'moveOriginal', value: false },
      ],
    },
    {
      commandId: 'model.scale',
      selection: housing,
      actions: [
        { kind: 'command.bindSelection', fieldId: 'body', entities: [housing] },
        { kind: 'command.setInput', fieldId: 'factor', value: 1.1 },
        { kind: 'command.setInput', fieldId: 'center', value: [0, 0, 0] },
      ],
    },
  ];
  const results: any[] = [];
  let uiRevision = state.uiRevision;
  for (const [index, commandCase] of modelCases.entries()) {
    try {
      const applied: any = await bridge.request('cad_ui', {
        action: 'apply',
        expectedUiRevision: uiRevision,
        correlationId: `observer-model-command-${index}`,
        actions: [
          ...(commandCase.selection ? [{ kind: 'selection.set', entity: commandCase.selection }] : []),
          { kind: 'command.open', commandId: commandCase.commandId },
          ...commandCase.actions,
          { kind: 'command.preview' },
        ],
        presentation: { mode: 'instant', transition: 'cut' },
      });
      const visible = await page.evaluate(() => {
        const dialog = document.getElementById('bw-v5-command') as HTMLDialogElement | null;
        const preview = document.getElementById('bw-v6-command-preview') as HTMLElement | null;
        const sketchSurface = document.getElementById('bw-sketch') as HTMLElement | null;
        const edgeSurface = document.getElementById('bw-pick') as HTMLElement | null;
        const shellSurface = document.getElementById('bw-shell') as HTMLElement | null;
        return {
          open: Boolean(dialog?.open),
          command: dialog?.dataset.command,
          sketchOpen: Boolean(sketchSurface && !sketchSurface.hidden),
          edgeOpen: Boolean(edgeSurface && !edgeSurface.hidden),
          shellOpen: Boolean(shellSurface && !shellSurface.hidden),
          previewVisible: preview ? !preview.hidden : false,
          previewText: preview?.textContent || '',
        };
      });
      const preview = applied.results.find((entry: any) => entry.kind === 'command.preview')?.result;
      const basic = ['model.extrude', 'model.cut', 'model.revolve', 'model.fillet', 'model.chamfer', 'model.shell']
        .includes(commandCase.commandId);
      const expectedSurface = ['model.extrude', 'model.cut', 'model.revolve'].includes(commandCase.commandId)
        ? visible.sketchOpen
        : ['model.fillet', 'model.chamfer'].includes(commandCase.commandId)
          ? visible.edgeOpen
          : commandCase.commandId === 'model.shell'
            ? visible.shellOpen
            : visible.open && visible.command === commandCase.commandId.slice('model.'.length);
      results.push({
        commandId: commandCase.commandId,
        valid:
          applied.snapshot.activeCommand?.commandId === commandCase.commandId &&
          applied.snapshot.activeCommand?.state === 'preview' &&
          applied.snapshot.preview?.visible === true &&
          preview?.validation?.valid === true &&
          preview?.validation?.exactGeometry === true &&
          preview?.directVisibleHashParity === true &&
          expectedSurface &&
          (basic ? !visible.open : true) &&
          visible.previewVisible &&
          /Exact validation passed/.test(visible.previewText) &&
          pageErrors.length === 0,
        visible,
      });
      const cancelled: any = await bridge.request('cad_ui', {
        action: 'apply',
        expectedUiRevision: applied.uiRevision,
        correlationId: `observer-model-command-cancel-${index}`,
        actions: [{ kind: 'command.cancel' }],
        presentation: { mode: 'instant', transition: 'cut' },
      });
      uiRevision = cancelled.uiRevision;
    } catch (error: any) {
      results.push({
        commandId: commandCase.commandId,
        valid: false,
        code: error.code,
        message: error.message,
        details: error.details,
      });
      const current: any = await bridge.request('cad_ui', { action: 'snapshot' });
      uiRevision = current.uiRevision;
      if (current.activeCommand) {
        const cancelled: any = await bridge.request('cad_ui', {
          action: 'apply',
          expectedUiRevision: uiRevision,
          actions: [{ kind: 'command.cancel' }],
          presentation: { mode: 'instant', transition: 'cut' },
        });
        uiRevision = cancelled.uiRevision;
      }
    }
  }
  check('all 23 basic and advanced modeling adapters use their normal visible editors with exact preview, parity, and cancel',
    results.length === 23 && results.every((entry) => entry.valid),
    results);
  check('advanced modeling preview/cancel leaves the part document and renderer revision unchanged',
    (await bridge.request('cad_ui', { action: 'snapshot' }) as any).documentRevision === state.documentRevision &&
    pageErrors.length === 0,
    pageErrors);

  const sketchCanvasOpened: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: uiRevision,
    correlationId: 'observer-semantic-sketch-canvas-open',
    actions: [
      { kind: 'selection.set', entity: planarFace },
      { kind: 'command.open', commandId: 'model.extrude' },
      { kind: 'command.bindSelection', fieldId: 'supportFace', entities: [planarFace] },
      { kind: 'sketch.setTool', toolId: 'circle' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const beforeSketchCanvas = await sketchCanvasDigest(page);
  const sketchCanvasEdited: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: sketchCanvasOpened.uiRevision,
    correlationId: 'observer-semantic-sketch-canvas-edit',
    actions: [
      {
        kind: 'command.setInput',
        fieldId: 'sketch',
        value: [
          { kind: 'circle', x: 4, y: -3, r: 3.5 },
          { kind: 'rect', x: -12, y: 2, w: 5, h: 6 },
        ],
      },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const sketchShapeEdited: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: sketchCanvasEdited.uiRevision,
    correlationId: 'observer-semantic-sketch-shape-edit',
    actions: [
      { kind: 'sketch.shape.select', shapeIndex: 0 },
      { kind: 'sketch.shape.update', shapeIndex: 0, property: 'd', value: 9 },
      { kind: 'sketch.shape.update', shapeIndex: 0, property: 'x', value: 6 },
      { kind: 'sketch.shape.delete', shapeIndex: 1 },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const afterSketchCanvas = await sketchCanvasDigest(page);
  const sketchCanvasVisible = await page.evaluate(() => ({
    open: !(document.getElementById('bw-sketch') as HTMLElement | null)?.hidden,
    activeTool: [...document.querySelectorAll<HTMLElement>('[data-sktool][aria-pressed="true"]')]
      .map((entry) => entry.dataset.sktool),
    dimensionFields: document.querySelectorAll('#bw-sk-dims [data-dim]').length,
    diameter: (document.querySelector('[data-v6-control-id="sketch.shape.dimension.d"]') as HTMLInputElement | null)?.value,
    x: (document.querySelector('[data-v6-control-id="sketch.shape.dimension.x"]') as HTMLInputElement | null)?.value,
    deleteVisible: document.querySelector('[data-v6-control-id="sketch.shape.delete"]') instanceof HTMLButtonElement,
  }));
  check('the 2D canvas and selected-shape controls accept typed geometry, dimensions, selection, and deletion without pointer coordinates',
    sketchShapeEdited.snapshot.activeCommand?.inputValues?.sketch?.length === 1 &&
    sketchShapeEdited.snapshot.activeCommand?.inputValues?.sketch?.[0]?.kind === 'circle' &&
    sketchShapeEdited.snapshot.activeCommand?.inputValues?.sketch?.[0]?.r === 4.5 &&
    sketchShapeEdited.snapshot.activeCommand?.inputValues?.sketch?.[0]?.x === 6 &&
    sketchShapeEdited.snapshot.activeCommand?.selectedShapeIndex === 0 &&
    beforeSketchCanvas.nonzero > 0 &&
    afterSketchCanvas.nonzero > 0 &&
    beforeSketchCanvas.hash !== afterSketchCanvas.hash &&
    sketchCanvasVisible.open === true &&
    sketchCanvasVisible.activeTool.join(',') === 'circle' &&
    sketchCanvasVisible.dimensionFields === 3 &&
    sketchCanvasVisible.diameter === '9' &&
    sketchCanvasVisible.x === '6' &&
    sketchCanvasVisible.deleteVisible === true &&
    pageErrors.length === 0,
    { sketchShapeEdited, beforeSketchCanvas, afterSketchCanvas, sketchCanvasVisible, pageErrors });
  const sketchCanvasCancelled: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: sketchShapeEdited.uiRevision,
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  uiRevision = sketchCanvasCancelled.uiRevision;

  const transactionalDraft: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: uiRevision,
    correlationId: 'observer-basic-human-transaction',
    actions: [
      { kind: 'selection.set', entity: planarFace },
      { kind: 'command.open', commandId: 'model.extrude' },
      { kind: 'command.bindSelection', fieldId: 'supportFace', entities: [planarFace] },
      { kind: 'command.setInput', fieldId: 'sketch', value: [{ kind: 'circle', x: 0, y: 0, r: 2.5 }] },
      { kind: 'command.setInput', fieldId: 'height', value: 7 },
      { kind: 'command.setInput', fieldId: 'resultPolicy', value: 'add' },
      { kind: 'command.bindSelection', fieldId: 'targetBody', entities: [housing] },
      { kind: 'command.preview' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const featureId = transactionalDraft.snapshot.activeCommand?.generatedIds?.featureId;
  await page.evaluate(() => {
    const input = document.getElementById('bw-sk-op-h') as HTMLInputElement | null;
    if (!input) throw new Error('Normal sketch distance field is missing.');
    input.value = '9';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  let humanEdited: any = null;
  for (let attempt = 0; attempt < 200; attempt++) {
    humanEdited = await bridge.request('cad_ui', { action: 'snapshot' });
    if (
      humanEdited.activeCommand?.state === 'draft' &&
      humanEdited.activeCommand?.inputValues?.height === 9 &&
      !humanEdited.preview
    ) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const rePreviewed: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: humanEdited.uiRevision,
    correlationId: 'observer-basic-human-repreview',
    actions: [{ kind: 'command.preview' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const humanPreview = rePreviewed.results.find((entry: any) => entry.kind === 'command.preview')?.result;
  await page.evaluate(() => {
    const apply = document.getElementById('bw-sk-apply') as HTMLButtonElement | null;
    if (!apply || apply.hidden || apply.disabled) throw new Error('Normal sketch Apply control is unavailable.');
    apply.click();
  });
  await page.waitForFunction((expectedRevision) => {
    const studio = (window as any).__bwStudio;
    const sketchSurface = document.getElementById('bw-sketch') as HTMLElement | null;
    return studio?.commandRevision?.() === expectedRevision && sketchSurface?.hidden === true;
  }, { polling: 50, timeout: 30_000 }, state.documentRevision + 1);
  const humanCommitted: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const committedTree: any = await bridge.request('cad_query', {
    query: { kind: 'project.tree', limit: 1000 },
  });
  const committedSurface = await page.evaluate(() => ({
    sketchHidden: (document.getElementById('bw-sketch') as HTMLElement | null)?.hidden === true,
    previewHidden: (document.getElementById('bw-v6-command-preview') as HTMLElement | null)?.hidden === true,
  }));
  check('normal sketch input invalidates exact preview, re-previews, and human Apply commits one editable transaction',
    humanEdited.activeCommand?.inputValues?.height === 9 &&
    humanEdited.activeCommand?.state === 'draft' &&
    !humanEdited.preview &&
    humanPreview?.validation?.valid === true &&
    humanPreview?.directVisibleHashParity === true &&
    humanCommitted.documentRevision === state.documentRevision + 1 &&
    !humanCommitted.activeCommand &&
    JSON.stringify(committedTree.result).includes(featureId) &&
    committedSurface.sketchHidden &&
    committedSurface.previewHidden &&
    pageErrors.length === 0,
    { humanEdited, humanPreview, humanCommitted, committedSurface, featureId });
  await bridge.close('Advanced modeling command check complete');
  await context.close();
}

async function visibleFreshPartOriginBootstrapCheck(browser: Browser, url: string) {
  console.log('\nCAD Studio V6 fresh-part origin bootstrap');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const fixture = createThreeBodyRuntimeProject({
    boolean: false,
    projectId: 'project-v6-visible-origin-bootstrap',
  });
  await page.evaluateOnNewDocument((documentFixture) => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(documentFixture));
  }, fixture);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  const bridge = await startStudioLoopbackBridge({
    clientLabel: 'V6 fresh-part modeling agent',
    skillVersion: '0.4.0',
    studioOrigin: new URL(url).origin,
    studioUrl: url,
    permissionContext: {
      granted: [
        'project.read', 'project.edit',
        'ui.read', 'ui.select', 'ui.navigate',
        'ui.command-draft', 'ui.present-preview', 'ui.wait-events',
      ],
    },
  });
  await approveConnectionAsHuman(page, 'V6 fresh-part modeling agent');
  for (let attempt = 0; attempt < 600 && bridge.status().state !== 'connected'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const before: any = await bridge.request('cad_ui', { action: 'snapshot' });
  const beforeTree: any = await bridge.request('cad_query', {
    query: { kind: 'project.tree', limit: 1000 },
  });
  const housing = { kind: 'body', id: RUNTIME_BODY_IDS.housing };
  let invalidSelectionCode = '';
  try {
    await bridge.request('cad_ui', {
      action: 'apply',
      expectedUiRevision: before.uiRevision,
      correlationId: 'observer-invalid-model-selection',
      actions: [
        { kind: 'selection.set', entity: housing },
        { kind: 'command.open', commandId: 'model.rotate' },
        { kind: 'command.bindSelection', fieldId: 'axisDatum', entities: [{ kind: 'datum', id: 'datum-missing-axis' }] },
      ],
      presentation: { mode: 'instant', transition: 'cut' },
    });
  } catch (error: any) {
    invalidSelectionCode = error.code;
  }
  const afterInvalid: any = await bridge.request('cad_ui', { action: 'snapshot' });
  check('nonexistent modeling selections fail during visible binding and roll back the semantic UI batch',
    invalidSelectionCode === 'COMMAND_FIELD_INVALID' &&
    afterInvalid.uiRevision === before.uiRevision &&
    afterInvalid.documentRevision === before.documentRevision &&
    !afterInvalid.activeCommand &&
    afterInvalid.selection.length === 0,
    { invalidSelectionCode, before, afterInvalid });
  const applied: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: before.uiRevision,
    correlationId: 'observer-fresh-part-origin-bootstrap',
    actions: [
      { kind: 'selection.set', entity: housing },
      { kind: 'command.open', commandId: 'model.rotate' },
      { kind: 'command.bindSelection', fieldId: 'body', entities: [housing] },
      { kind: 'command.bindSelection', fieldId: 'axisDatum', entities: [{ kind: 'datum', id: DATUM_IDS.zAxis }] },
      { kind: 'command.setInput', fieldId: 'angle', value: 30 },
      { kind: 'command.setInput', fieldId: 'gizmoSnap', value: 15 },
      { kind: 'command.preview' },
    ],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const preview = applied.results.find((entry: any) => entry.kind === 'command.preview')?.result;
  const visible = await page.evaluate(() => {
    const dialog = document.getElementById('bw-v5-command') as HTMLDialogElement | null;
    const previewPanel = document.getElementById('bw-v6-command-preview') as HTMLElement | null;
    return {
      open: Boolean(dialog?.open),
      command: dialog?.dataset.command,
      previewVisible: previewPanel ? !previewPanel.hidden : false,
      previewText: previewPanel?.textContent || '',
    };
  });
  const cancelled: any = await bridge.request('cad_ui', {
    action: 'apply',
    expectedUiRevision: applied.uiRevision,
    actions: [{ kind: 'command.cancel' }],
    presentation: { mode: 'instant', transition: 'cut' },
  });
  const afterTree: any = await bridge.request('cad_query', {
    query: { kind: 'project.tree', limit: 1000 },
  });
  const beforeOriginCount = beforeTree.result.items.filter((entry: any) => entry.kind === 'datum' && entry.id.startsWith('datum-origin-')).length;
  const afterOriginCount = afterTree.result.items.filter((entry: any) => entry.kind === 'datum' && entry.id.startsWith('datum-origin-')).length;
  const previewCreatedIds = preview?.changeSet?.created?.map((entry: any) => entry.id) || [];
  check('a normal advanced-modeling dialog on a fresh part atomically previews its canonical origin datums',
    beforeOriginCount === 0 &&
    applied.snapshot.documentRevision === before.documentRevision &&
    applied.snapshot.activeCommand?.commandId === 'model.rotate' &&
    applied.snapshot.activeCommand?.state === 'preview' &&
    preview?.validation?.valid === true &&
    preview?.validation?.exactGeometry === true &&
    preview?.directVisibleHashParity === true &&
    previewCreatedIds.includes(DATUM_IDS.zAxis) &&
    visible.open &&
    visible.command === 'rotate' &&
    visible.previewVisible &&
    /Exact validation passed/.test(visible.previewText) &&
    pageErrors.length === 0,
    { preview, visible, pageErrors });
  check('cancelling the fresh-part preview leaves implicit origin datums and the document revision uncommitted',
    cancelled.snapshot.documentRevision === before.documentRevision &&
    !cancelled.snapshot.activeCommand &&
    afterOriginCount === 0 &&
    pageErrors.length === 0,
    { beforeOriginCount, afterOriginCount, before, cancelled: cancelled.snapshot, pageErrors });
  await bridge.close('Fresh-part origin bootstrap check complete');
  await context.close();
}

async function isolatedAssemblyBoundaryCommandChecks(browser: Browser, url: string) {
  console.log('\nCAD Studio V6 assembly document-boundary commands');
  const contextCases = [
    {
      clientLabel: 'V6 create assembly observer',
      fixture: createEmptyStudioV5PartProject({
        projectId: 'project-v6-visible-create-assembly',
        name: 'Visible assembly source part',
        units: 'mm',
      }),
      commandId: 'assembly.create',
      actions: [
        { kind: 'command.setInput', fieldId: 'name', value: 'Agent-created assembly' },
        { kind: 'command.setInput', fieldId: 'occurrenceName', value: 'Source part:1' },
        { kind: 'command.setInput', fieldId: 'fixed', value: true },
      ],
    },
    {
      clientLabel: 'V6 exit context observer',
      fixture: enterStudioV5AssemblyContext(
        buildRobotJointFixture().project,
        'occurrence-robot-cover',
      ),
      commandId: 'assembly.exit-context',
      actions: [],
    },
  ];
  const results: any[] = [];
  for (const commandCase of contextCases) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.evaluateOnNewDocument((fixture) => {
      localStorage.setItem('bw-studio-welcome-v1', '1');
      localStorage.setItem('bw-studio-v2-seeded', '1');
      localStorage.setItem('bw-studio-tour-v1', '1');
      localStorage.setItem('bw-studio-doc-v2', JSON.stringify(fixture));
    }, commandCase.fixture);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
    const bridge = await startStudioLoopbackBridge({
      clientLabel: commandCase.clientLabel,
      skillVersion: '0.4.0',
      studioOrigin: new URL(url).origin,
      studioUrl: url,
      permissionContext: {
        granted: [
          'project.read', 'project.edit',
          'ui.read', 'ui.select', 'ui.navigate',
          'ui.command-draft', 'ui.present-preview', 'ui.wait-events',
        ],
      },
    });
    await approveConnectionAsHuman(page, commandCase.clientLabel);
    for (let attempt = 0; attempt < 600 && bridge.status().state !== 'connected'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const before: any = await bridge.request('cad_ui', { action: 'snapshot' });
    try {
      const applied: any = await bridge.request('cad_ui', {
        action: 'apply',
        expectedUiRevision: before.uiRevision,
        correlationId: `observer-boundary-${commandCase.commandId}`,
        actions: [
          { kind: 'command.open', commandId: commandCase.commandId },
          ...commandCase.actions,
          { kind: 'command.preview' },
        ],
        presentation: { mode: 'instant', transition: 'cut' },
      });
      const visible = await page.evaluate(() => {
        const dialog = document.getElementById('bw-v5-command') as HTMLDialogElement | null;
        const preview = document.getElementById('bw-v6-command-preview') as HTMLElement | null;
        return {
          dialogOpen: Boolean(dialog?.open),
          command: dialog?.dataset.command,
          previewVisible: preview ? !preview.hidden : false,
        };
      });
      const previewEntry = applied.results.find((entry: any) => entry.kind === 'command.preview')?.result;
      results.push({
        commandId: commandCase.commandId,
        valid:
          applied.snapshot.activeCommand?.commandId === commandCase.commandId &&
          applied.snapshot.activeCommand?.state === 'preview' &&
          applied.snapshot.documentRevision === before.documentRevision &&
          previewEntry?.validation?.valid === true &&
          previewEntry?.validation?.exactGeometry === true &&
          previewEntry?.directVisibleHashParity === true &&
          visible.dialogOpen &&
          visible.command === commandCase.commandId.replace('.', '-') &&
          visible.previewVisible &&
          pageErrors.length === 0,
        visible,
        pageErrors,
      });
      await bridge.request('cad_ui', {
        action: 'apply',
        expectedUiRevision: applied.uiRevision,
        actions: [{ kind: 'command.cancel' }],
        presentation: { mode: 'instant', transition: 'cut' },
      });
    } catch (error: any) {
      results.push({
        commandId: commandCase.commandId,
        valid: false,
        code: error.code,
        message: error.message,
        pageErrors,
      });
    } finally {
      await bridge.close('Boundary command check complete');
      await context.close();
    }
  }
  check('create-assembly and return-to-assembly operate their real context-specific panels with exact preview and cancel',
    results.length === 2 && results.every((entry) => entry.valid),
    results);
}

const { server, url } = await startServer();
let browser: Browser | null = null;
try {
  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  await checks(browser, url);
  await projectBoundaryControlChecks(browser, url);
  await persistentAssemblyControlChecks(browser, url);
  await persistentParameterControlChecks(browser, url);
  await persistentFeatureControlChecks(browser, url);
  await persistentInspectionTreeControlChecks(browser, url);
  await persistentDatumSketchPatternControlChecks(browser, url);
  await persistentInspectorBooleanShortcutChecks(browser, url);
  await persistentFeaturePatternFieldChecks(browser, url);
  await persistentDraftDecisionChecks(browser, url);
  await visibleModelCommandChecks(browser, url);
  await visibleFreshPartOriginBootstrapCheck(browser, url);
  await isolatedAssemblyBoundaryCommandChecks(browser, url);
} finally {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

console.log(`\n${passed}/${passed + failed} V6 observer checks passed`);
if (failed) process.exitCode = 1;
