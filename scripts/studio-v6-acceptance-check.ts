import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer, { type Browser, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
import { buildRobotJointFixture } from './studio-v5-release-fixtures.ts';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { createStudioV5ExplodedView } from '../static/studio-v5-inspection.js';

type PresentationMode = 'normal' | 'recording';
const require = createRequire(import.meta.url);
const FFMPEG_PATH = (require('@ffmpeg-installer/ffmpeg') as { path: string }).path;
const RECORDING_CAPTURE_BACKEND = process.platform === 'darwin'
  ? 'chromium-print-compositor'
  : 'chromium-screenshot';
type TranscriptEntry = {
  tool: string;
  arguments: Record<string, unknown>;
  status: 'ok' | 'error';
  code?: string;
};

function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref();
  });
}

export class ViewportRecorder {
  page: Page;
  path: string;
  fps: number;
  process: ChildProcessWithoutNullStreams;
  closed: Promise<number | null>;
  running = true;
  stderr = '';
  frames: Array<{ receivedAt: number; bytes: Buffer }> = [];
  startedAt = Date.now();
  captureBackend = RECORDING_CAPTURE_BACKEND;

  private constructor(page: Page, path: string, fps = 4) {
    this.page = page;
    this.path = path;
    this.fps = fps;
    this.process = spawn(FFMPEG_PATH, [
      '-loglevel', 'error',
      '-f', 'image2pipe',
      '-framerate', String(fps),
      '-vcodec', 'mjpeg',
      '-i', 'pipe:0',
      '-an',
      '-threads', '4',
      '-b:v', '0',
      '-vcodec', 'libvpx-vp9',
      '-crf', '34',
      '-deadline', 'realtime',
      '-cpu-used', '8',
      '-row-mt', '1',
      '-pix_fmt', 'yuv420p',
      '-y',
      path,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.closed = new Promise((resolve, reject) => {
      this.process.once('close', resolve);
      this.process.once('error', reject);
    });
    this.process.stderr.setEncoding('utf8');
    this.process.stderr.on('data', (chunk) => { this.stderr += chunk; });
  }

  static async start(page: Page, path: string, fps = 4) {
    const recorder = new ViewportRecorder(page, path, fps);
    try {
      await page.emulateMediaType('screen');
      await recorder.captureCheckpoint('initial');
      return recorder;
    } catch (error) {
      await recorder.abort();
      throw error;
    }
  }

  async captureCheckpoint(label: string) {
    if (!this.running) return;
    console.log(`  INFO capturing recording checkpoint: ${label}`);
    let bytes: Buffer;
    if (this.captureBackend === 'chromium-print-compositor') {
      const pdf = await Promise.race([
        this.page.pdf({
          printBackground: true,
          width: '1280px',
          height: '800px',
          pageRanges: '1',
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        }),
        rejectAfter(10_000, `Timed out capturing recording checkpoint: ${label}`),
      ]);
      const converted = spawnSync('pdftoppm', [
        '-f', '1',
        '-singlefile',
        '-jpeg',
        '-scale-to-x', '1280',
        '-scale-to-y', '800',
        '-',
      ], {
        input: pdf,
        maxBuffer: 20_000_000,
      });
      if (converted.status !== 0 || !converted.stdout.length) {
        throw new Error(`Could not rasterize recording checkpoint ${label}: ${String(converted.stderr)}`);
      }
      bytes = converted.stdout;
    } else {
      bytes = Buffer.from(await Promise.race([
        this.page.screenshot({
          type: 'jpeg',
          quality: 76,
          captureBeyondViewport: false,
        }),
        rejectAfter(10_000, `Timed out capturing recording checkpoint: ${label}`),
      ]));
    }
    this.frames.push({
      receivedAt: Date.now(),
      bytes,
    });
  }

  async writeFrame(frame: Buffer) {
    if (this.process.stdin.write(frame)) return;
    await Promise.race([
      once(this.process.stdin, 'drain'),
      this.closed.then((code) => {
        throw new Error(`ffmpeg closed while encoding with ${code}: ${this.stderr}`);
      }),
    ]);
  }

  async stop() {
    if (!this.running) return;
    try {
      await this.captureCheckpoint('final');
      this.running = false;
      const stoppedAt = Date.now();
      if (!this.frames.length) throw new Error('The recording observer received no viewport frames.');
      const intervalMs = 1000 / this.fps;
      let frameIndex = 0;
      for (let at = this.startedAt; at <= stoppedAt; at += intervalMs) {
        while (
          frameIndex + 1 < this.frames.length &&
          this.frames[frameIndex + 1].receivedAt <= at
        ) {
          frameIndex++;
        }
        await this.writeFrame(this.frames[frameIndex].bytes);
      }
      this.process.stdin.end();
      const code = await Promise.race([
        this.closed,
        rejectAfter(20_000, 'Timed out waiting for ffmpeg to finalize the recording.'),
      ]);
      if (code !== 0) throw new Error(`ffmpeg exited with ${code}: ${this.stderr}`);
    } catch (error) {
      await this.abort();
      throw error;
    }
  }

  async abort() {
    this.running = false;
    this.process.stdin.destroy();
    if (this.process.exitCode == null && this.process.signalCode == null) this.process.kill('SIGTERM');
    await Promise.race([
      this.closed.catch(() => null),
      rejectAfter(5_000, 'Timed out terminating the recording encoder.'),
    ]).catch(() => {});
  }
}

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

export function sha256(value: Uint8Array | string) {
  return createHash('sha256').update(value).digest('hex');
}

export function presentation(mode: PresentationMode, transition: 'cut' | 'animate' = 'animate') {
  return {
    mode,
    transition,
    ...(mode === 'recording' ? { minimumVisibleMs: 800 } : {}),
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, '..');
const repoRoot = join(engineRoot, '..');
const staticDir = join(engineRoot, 'static');
const evidenceRoot = join(engineRoot, 'var', 'studio-v6-evidence');
const manifestPath = join(engineRoot, 'var', 'studio-v6-acceptance-manifest.json');
const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export async function startStudioServer(): Promise<{ server: Server; url: string }> {
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
  return {
    server,
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}/cad/studio`,
  };
}

function robotFixture() {
  const fixture = createStudioV5ExplodedView(buildRobotJointFixture().project, {
    id: 'explode-robot-joint',
    name: 'Robot joint service view',
    steps: [
      { occurrenceIds: ['occurrence-robot-motor'], translation: [0, 0, -28] },
      { occurrenceIds: ['occurrence-robot-cover'], translation: [0, 0, 22] },
    ],
  });
  const assembly = fixture.assemblyDefinitions
    .find((entry: any) => entry.id === fixture.rootDocument.assemblyId);
  const cover = assembly?.occurrences
    .find((entry: any) => entry.id === 'occurrence-robot-cover');
  if (cover) cover.fixed = false;
  return fixture;
}

export async function createStudioPage(browser: Browser, url: string, fixture = robotFixture()) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('requestfailed', (request) => requestFailures.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.evaluateOnNewDocument((fixture) => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify(fixture));
  }, fixture);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  return { context, page, pageErrors, requestFailures };
}

export class McpClient {
  child: ChildProcessWithoutNullStreams;
  transcript: TranscriptEntry[] = [];
  stderr = '';
  buffer = '';
  pending: Array<(value: any) => void> = [];
  rpcId = 0;

  constructor(origin: string, studioUrl: string, outputRoot: string) {
    this.child = spawn(process.execPath, [
      '--experimental-strip-types',
      'scripts/studio-agent-mcp.ts',
      '--bridge-port', '49784',
      '--studio-origin', origin,
      '--studio-url', studioUrl,
      '--allow-write', outputRoot,
      '--permissions', [
        'project.read',
        'project.edit',
        'project.save-new',
        'artifact.render',
        'artifact.export-project',
        'artifact.export-step',
        'artifact.export-stl',
        'artifact.export-narration',
        'ui.read',
        'ui.select',
        'ui.navigate',
        'ui.command-draft',
        'ui.present-preview',
        'ui.present-demo',
        'ui.present-narration',
        'ui.wait-events',
        'session.launch-visible',
      ].join(','),
    ], { cwd: engineRoot, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      for (;;) {
        const newline = this.buffer.indexOf('\n');
        if (newline < 0) break;
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        this.pending.shift()?.(JSON.parse(line));
      }
    });
  }

  rpc(method: string, params?: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}. stderr=${this.stderr}`)), 60_000);
      this.pending.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.child.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.rpcId,
        method,
        ...(params ? { params } : {}),
      }) + '\n');
    });
  }

  async tool(name: string, args: Record<string, unknown>) {
    const entry: TranscriptEntry = {
      tool: name,
      arguments: structuredClone(args),
      status: 'ok',
    };
    this.transcript.push(entry);
    const response = await this.rpc('tools/call', { name, arguments: args });
    if (response.result?.isError) {
      entry.status = 'error';
      entry.code = response.result.structuredContent?.code;
      throw Object.assign(new Error(response.result.structuredContent?.message), response.result.structuredContent);
    }
    return response.result?.structuredContent;
  }

  async close() {
    this.child.stdin.end();
    const exited = new Promise<void>((resolve) => {
      if (this.child.exitCode != null) resolve();
      else this.child.once('exit', () => resolve());
    });
    try {
      await Promise.race([
        exited,
        rejectAfter(5_000, 'Timed out waiting for the MCP acceptance host to exit.'),
      ]);
    } catch (error) {
      this.child.kill('SIGTERM');
      await Promise.race([
        exited,
        rejectAfter(5_000, 'Timed out terminating the MCP acceptance host.'),
      ]).catch(() => {});
      throw error;
    }
  }
}

export async function approveConnectionAsHuman(page: Page, clientLabel: string, studioFirst = true) {
  if (studioFirst) {
    await page.evaluate(() => {
      (document.getElementById('bw-help-open') as HTMLButtonElement | null)?.click();
      (document.getElementById('bw-help-agent') as HTMLButtonElement | null)?.click();
    });
  }
  await page.waitForFunction((label) => [...document.querySelectorAll('.ws-agent-pair[open] h2')]
    .some((heading) => (heading.textContent || '').includes(label)), { polling: 50, timeout: 10_000 }, clientLabel);
  return page.evaluate((label) => {
    const dialog = [...document.querySelectorAll<HTMLDialogElement>('.ws-agent-pair[open]')]
      .find((candidate) => (candidate.querySelector('h2')?.textContent || '').includes(label));
    const approve = dialog?.querySelector<HTMLButtonElement>('button[value="approve"]');
    if (!dialog || !approve) throw new Error('The visible connection approval is missing.');
    const result = {
      labelled: Boolean(dialog.getAttribute('aria-labelledby')),
      described: Boolean(dialog.getAttribute('aria-describedby')),
      focusInside: dialog.contains(document.activeElement),
    };
    dialog.close(approve.value);
    dialog.dispatchEvent(new Event('close'));
    return result;
  }, clientLabel);
}

async function approveCommitAsHuman(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll('.ws-agent-pair[open]')]
    .some((dialog) => /AGENT PREVIEW/.test(dialog.textContent || '')), { polling: 50, timeout: 10_000 });
  return page.evaluate(() => {
    const dialog = [...document.querySelectorAll<HTMLDialogElement>('.ws-agent-pair[open]')]
      .find((candidate) => /AGENT PREVIEW/.test(candidate.textContent || ''));
    if (!dialog) throw new Error('The visible preview approval is missing.');
    const result = {
      normalPreview: /Apply this CAD change/.test(dialog.textContent || ''),
      labelled: Boolean(dialog.getAttribute('aria-labelledby')),
      described: Boolean(dialog.getAttribute('aria-describedby')),
      focusInside: dialog.contains(document.activeElement),
    };
    dialog.close('approve');
    dialog.dispatchEvent(new Event('close'));
    return result;
  });
}

async function changeDisplayModeAsHuman(page: Page, mode: 'wireframe') {
  await page.evaluate((displayMode) => {
    const control = document.querySelector<HTMLButtonElement>(`[data-display-mode="${displayMode}"]`);
    if (!control) throw new Error(`The normal ${displayMode} control is missing.`);
    control.click();
  }, mode);
}

export async function waitForSessionState(client: McpClient, sessionId: string, expected: string) {
  let status: any;
  for (let attempt = 0; attempt < 600; attempt++) {
    status = await client.tool('cad_session', { action: 'status', sessionId });
    if (status.status?.state === expected) return status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Session ${sessionId} did not reach ${expected}: ${JSON.stringify(status)}`);
}

async function expectedToolError<T>(operation: Promise<T>) {
  try {
    await operation;
    return 'NO_ERROR';
  } catch (error: any) {
    return String(error?.code || 'UNKNOWN_ERROR');
  }
}

async function runWorkflow(browser: Browser, url: string, mode: PresentationMode) {
  const runRoot = join(evidenceRoot, mode);
  await mkdir(runRoot, { recursive: true });
  const client = new McpClient(new URL(url).origin, url, runRoot);
  const { context, page, pageErrors, requestFailures } = await createStudioPage(browser, url);
  const clientLabel = mode === 'recording'
    ? 'V6 recording replay agent'
    : 'V6 normal acceptance agent';
  const humanActions: string[] = [];
  let recorder: ViewportRecorder | null = null;
  const videoPath = join(runRoot, 'studio-v6-recording.webm');
  let activeSessionId: string | null = null;
  try {
    const initialized = await client.rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: `studio-v6-${mode}-acceptance`, version: '1.0.0' },
    });
    const tools = await client.rpc('tools/list');
    const coreSkill = await client.rpc('resources/read', { uri: 'bomwiki-cad://skills/core' });
    const protocolCapabilities = await client.tool('cad_capabilities', {});
    const requiredTools = [
      'cad_capabilities',
      'cad_session',
      'cad_inspect',
      'cad_query',
      'cad_preview',
      'cad_commit',
      'cad_history',
      'cad_artifact',
      'cad_ui',
      'cad_events',
    ];
    const toolNames = tools.result?.tools?.map((entry: any) => entry.name) || [];
    const step1 = {
      initialized: initialized.result?.serverInfo?.name === 'bomwiki-cad',
      skillVersion: protocolCapabilities.skillCompatibility?.skillVersion,
      skillPackageSha256: protocolCapabilities.skillCompatibility?.packageSha256,
      protocolManifestSha256: sha256(JSON.stringify(protocolCapabilities)),
      requiredToolsAvailable: requiredTools.every((name) => toolNames.includes(name)),
      coreSkillLoaded: /Never use Computer Use/.test(coreSkill.result?.contents?.[0]?.text || ''),
    };

    const connected = await client.tool('cad_session', {
      action: 'connect',
      clientLabel,
      mode: 'preview-required',
      permissions: {
        granted: [
          'project.read',
          'project.edit',
          'project.save-new',
          'artifact.render',
          'artifact.export-project',
          'artifact.export-step',
          'artifact.export-stl',
          'artifact.export-narration',
          'ui.read',
          'ui.select',
          'ui.navigate',
          'ui.command-draft',
          'ui.present-preview',
          'ui.present-demo',
          'ui.present-narration',
          'ui.wait-events',
          'session.launch-visible',
        ],
      },
    });
    activeSessionId = connected.sessionId;
    const connectionApproval = await approveConnectionAsHuman(page, clientLabel);
    humanActions.push('approve permission-scoped connection');
    const connectedStatus = await waitForSessionState(client, connected.sessionId, 'connected');
    const uiManifest = await client.tool('cad_ui', { sessionId: connected.sessionId, action: 'capabilities' });
    let initial = await client.tool('cad_ui', { sessionId: connected.sessionId, action: 'snapshot' });
    if (initial.viewport.renderState !== 'idle') {
      const readiness = await client.tool('cad_ui', {
        sessionId: connected.sessionId,
        action: 'apply',
        expectedUiRevision: initial.uiRevision,
        correlationId: `${mode}-initial-settlement`,
        actions: [{ kind: 'presentation.waitForSettled', correlationId: `${mode}-initial-settlement` }],
        presentation: { mode: 'instant', transition: 'cut' },
      });
      initial = readiness.snapshot;
    }
    const tree = await client.tool('cad_inspect', {
      sessionId: connected.sessionId,
      query: { kind: 'project.tree', pageSize: 500 },
    });
    const shaftRef = { kind: 'occurrence', id: 'occurrence-robot-shaft' };
    const coverRef = { kind: 'occurrence', id: 'occurrence-robot-cover' };
    const shaft = tree.result.items.find((entry: any) => entry.kind === shaftRef.kind && entry.id === shaftRef.id);
    const cover = tree.result.items.find((entry: any) => entry.kind === coverRef.kind && entry.id === coverRef.id);
    const step2 = {
      oneApproval: connectedStatus.status?.state === 'connected',
      noCopyPaste: typeof connected.discoveryUrl === 'string' && !('pairingUrl' in connected),
      accessibleApproval: Object.values(connectionApproval).every(Boolean),
      liveCapabilities: connectedStatus.status?.capabilities?.studioVersion === '6.0.0-i4',
    };
    const step3 = {
      projectId: initial.projectId,
      documentRevision: initial.documentRevision,
      uiRevision: initial.uiRevision,
      workspaceId: initial.workspaceId,
      camera: initial.viewport.camera,
      assemblyFound: Boolean(shaft && cover && initial.activeDocument.kind === 'assembly'),
    };

    if (mode === 'recording') {
      recorder = await ViewportRecorder.start(page, videoPath);
    }
    const captureCheckpoint = (label: string) =>
      recorder?.captureCheckpoint(label) || Promise.resolve();

    const navigated = await client.tool('cad_ui', {
      sessionId: connected.sessionId,
      action: 'apply',
      expectedUiRevision: initial.uiRevision,
      correlationId: `${mode}-step-4-navigate`,
      actions: [
        { kind: 'presentation.setMode', mode },
        { kind: 'narration.setMode', mode: 'detailed' },
        { kind: 'workspace.activate', workspaceId: 'assembly' },
        { kind: 'tree.expand', entity: shaftRef },
        { kind: 'tree.reveal', entity: shaftRef },
        { kind: 'selection.set', entity: shaftRef },
        { kind: 'inspector.showEntity', entity: shaftRef },
        { kind: 'viewport.fitSelection' },
        { kind: 'presentation.waitForSettled', correlationId: `${mode}-step-4-navigate` },
      ],
      presentation: presentation(mode),
    });
    const visibleNavigation = await page.evaluate((occurrenceId) => {
      const row = [...document.querySelectorAll<HTMLElement>('[data-occurrence-id], [data-runtime-occurrence-id]')]
        .find((candidate) => (candidate.dataset.occurrenceId || candidate.dataset.runtimeOccurrenceId) === occurrenceId);
      return {
        workspace: document.querySelector('[data-workspace="assembly"]')?.getAttribute('aria-selected'),
        selected: row?.classList.contains('is-selected'),
        revealed: row?.classList.contains('is-agent-revealed'),
        inspectorVisible: !(document.getElementById('bw-context-wrap') as HTMLElement | null)?.hidden,
      };
    }, shaftRef.id);
    const step4 = {
      uiRevision: navigated.uiRevision,
      documentUnchanged: navigated.snapshot.documentRevision === initial.documentRevision,
      visible: visibleNavigation.workspace === 'true' &&
        visibleNavigation.selected === true &&
        visibleNavigation.revealed === true &&
        visibleNavigation.inspectorVisible === true,
      rendererSettled: navigated.snapshot.viewport.renderedUiRevision === navigated.uiRevision,
    };
    await captureCheckpoint('workspace and selection');

    const previewTransform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 44, 1];
    const coverSelected = await client.tool('cad_ui', {
      sessionId: connected.sessionId,
      action: 'apply',
      expectedUiRevision: navigated.uiRevision,
      correlationId: `${mode}-step-5-select-command-target`,
      actions: [
        { kind: 'selection.set', entity: coverRef },
        { kind: 'tree.reveal', entity: coverRef },
      ],
      presentation: presentation(mode, 'cut'),
    });
    const drafted = await client.tool('cad_ui', {
      sessionId: connected.sessionId,
      action: 'apply',
      expectedUiRevision: coverSelected.uiRevision,
      correlationId: `${mode}-steps-5-6-preview`,
      actions: [
        { kind: 'command.open', commandId: 'assembly.component-transform' },
        { kind: 'command.bindSelection', fieldId: 'occurrence', entities: [coverRef] },
        { kind: 'command.setInput', fieldId: 'transform', value: previewTransform },
        { kind: 'command.preview' },
        { kind: 'presentation.focusAction', actionId: 'viewport' },
        { kind: 'presentation.waitForSettled', correlationId: `${mode}-steps-5-6-preview` },
      ],
      presentation: presentation(mode, 'cut'),
    });
    let visiblePreview = drafted.results.find((entry: any) => entry.kind === 'command.preview')?.result;
    const visibleDraft = await page.evaluate(() => {
      const dialog = document.getElementById('bw-v5-command') as HTMLDialogElement | null;
      const matrix = dialog?.querySelector<HTMLTextAreaElement>('[name="matrix"]') || null;
      const preview = document.getElementById('bw-v6-command-preview') as HTMLElement | null;
      return {
        dialogOpen: Boolean(dialog?.open),
        matrix: matrix?.value,
        previewVisible: preview ? !preview.hidden : false,
        previewText: preview?.textContent,
      };
    });
    const step5 = {
      commandId: drafted.snapshot.activeCommand?.commandId,
      boundOccurrence: drafted.snapshot.activeCommand?.boundSelections?.occurrence?.[0]?.id,
      typedTransformVisible: visibleDraft.matrix
        ?.split(',')
        .map((value: string) => Number(value.trim()))
        .every((value: number, index: number) =>
          Number.isFinite(value) && Math.abs(value - previewTransform[index]) < 1e-9) === true &&
        visibleDraft.matrix.split(',').length === previewTransform.length,
      matrix: visibleDraft.matrix,
      normalPanelVisible: visibleDraft.dialogOpen,
    };
    const directParity = await client.tool('cad_preview', {
      sessionId: connected.sessionId,
      transaction: {
        transactionId: `${mode}-direct-preview-parity`,
        label: 'Transform robot cover',
        expectedRevision: visiblePreview.baseRevision,
        operations: [{
          kind: 'component.update',
          input: { occurrenceId: coverRef.id, patch: { baseTransform: previewTransform } },
        }],
        atomic: true,
        metadata: { actor: 'agent' },
      },
    });
    const step6 = {
      previewId: visiblePreview.previewId,
      exactGeometry: visiblePreview.validation?.exactGeometry === true,
      detached: drafted.snapshot.documentRevision === initial.documentRevision,
      visible: visibleDraft.previewVisible && /Exact validation passed/.test(visibleDraft.previewText || ''),
      directVisibleHashParity: directParity.changeSet.documentHashAfter === visiblePreview.changeSet.documentHashAfter,
      exactEvidenceParity: JSON.stringify(directParity.evidence) === JSON.stringify(visiblePreview.evidence),
    };
    await captureCheckpoint('visible exact preview');

    const stalePreviewId = visiblePreview.previewId;
    const staleRevision = visiblePreview.baseRevision;
    await changeDisplayModeAsHuman(page, 'wireframe');
    humanActions.push('change normal display mode to wireframe');
    await page.waitForFunction((revision) =>
      (window as any).__bwStudio.commandRevision() === revision + 1, { polling: 50, timeout: 10_000 }, staleRevision);
    const afterHuman = await client.tool('cad_ui', { sessionId: connected.sessionId, action: 'snapshot' });
    const staleCommitCode = await expectedToolError(client.tool('cad_commit', {
      sessionId: connected.sessionId,
      previewId: stalePreviewId,
      expectedRevision: staleRevision,
    }));
    await captureCheckpoint('stale preview attention');
    const changes = await client.tool('cad_history', {
      sessionId: connected.sessionId,
      action: 'changesSince',
      revision: staleRevision,
    });
    const step7 = {
      humanRevision: afterHuman.documentRevision,
      previewInvalidated: !afterHuman.preview && afterHuman.activeCommand?.state === 'blocked',
      staleCommitCode,
      historyContainsHumanEdit: changes.items.some((entry: any) =>
        entry.actor === 'human' && /wireframe display/i.test(entry.label)),
    };

    const cancelled = await client.tool('cad_ui', {
      sessionId: connected.sessionId,
      action: 'apply',
      expectedUiRevision: afterHuman.uiRevision,
      correlationId: `${mode}-step-8-cancel-stale`,
      actions: [{ kind: 'command.cancel' }],
      presentation: presentation(mode, 'cut'),
    });
    const refreshed = await client.tool('cad_ui', {
      sessionId: connected.sessionId,
      action: 'apply',
      expectedUiRevision: cancelled.uiRevision,
      correlationId: `${mode}-step-8-refresh-preview`,
      actions: [
        { kind: 'command.open', commandId: 'assembly.component-transform' },
        { kind: 'command.bindSelection', fieldId: 'occurrence', entities: [coverRef] },
        { kind: 'command.setInput', fieldId: 'transform', value: previewTransform },
        { kind: 'command.preview' },
        { kind: 'presentation.waitForSettled', correlationId: `${mode}-step-8-refresh-preview` },
      ],
      presentation: presentation(mode, 'cut'),
    });
    visiblePreview = refreshed.results.find((entry: any) => entry.kind === 'command.preview')?.result;
    const refreshedParity = await client.tool('cad_preview', {
      sessionId: connected.sessionId,
      transaction: {
        transactionId: `${mode}-refreshed-direct-parity`,
        label: 'Transform robot cover after human edit',
        expectedRevision: visiblePreview.baseRevision,
        operations: [{
          kind: 'component.update',
          input: { occurrenceId: coverRef.id, patch: { baseTransform: previewTransform } },
        }],
        atomic: true,
        metadata: { actor: 'agent' },
      },
    });
    await captureCheckpoint('refreshed preview');
    const commitPromise = client.tool('cad_commit', {
      sessionId: connected.sessionId,
      previewId: visiblePreview.previewId,
      expectedRevision: visiblePreview.baseRevision,
    });
    const commitApproval = await approveCommitAsHuman(page);
    humanActions.push('approve exact preview commit');
    const committed = await commitPromise;
    let afterCommit = await client.tool('cad_ui', { sessionId: connected.sessionId, action: 'snapshot' });
    const commitSettlement = await client.tool('cad_ui', {
      sessionId: connected.sessionId,
      action: 'apply',
      expectedUiRevision: afterCommit.uiRevision,
      correlationId: `${mode}-step-8-commit-settled`,
      actions: [{ kind: 'presentation.waitForSettled', correlationId: `${mode}-step-8-commit-settled` }],
      presentation: presentation(mode, 'cut'),
    });
    afterCommit = commitSettlement.snapshot;
    const step8 = {
      refreshedRevision: visiblePreview.baseRevision,
      directVisibleHashParity: refreshedParity.changeSet.documentHashAfter === visiblePreview.changeSet.documentHashAfter,
      approvalVisible: Object.values(commitApproval).every(Boolean),
      committedRevision: committed.revision,
      oneNormalRevision: committed.revision === staleRevision + 2,
      commandClosed: !afterCommit.activeCommand && !afterCommit.preview,
      rendererRevision: afterCommit.viewport.renderedDocumentRevision,
      historyTransactionId: committed.historyEntry?.transactionId,
    };
    await captureCheckpoint('approved commit');

    const inspectedView = await client.tool('cad_ui', {
      sessionId: connected.sessionId,
      action: 'apply',
      expectedUiRevision: afterCommit.uiRevision,
      correlationId: `${mode}-step-9-inspect`,
      actions: [
        { kind: 'selection.set', entity: shaftRef },
        { kind: 'viewport.activateSection', sectionId: 'section-robot-joint' },
        { kind: 'viewport.activateExplodedView', explodedViewId: 'explode-robot-joint' },
        { kind: 'viewport.fitSelection' },
        { kind: 'diagnostics.show' },
        { kind: 'presentation.waitForSettled', correlationId: `${mode}-step-9-inspect` },
      ],
      presentation: presentation(mode),
    });
    await captureCheckpoint('section and exploded inspection');
    const visibleInspection = await page.evaluate(() => {
      const section = document.querySelector<HTMLElement>(
        '[data-inspection-kind="section"][data-inspection-id="section-robot-joint"]',
      );
      const exploded = document.querySelector<HTMLElement>(
        '[data-inspection-kind="explode"][data-inspection-id="explode-robot-joint"]',
      );
      const diagnostics = document.getElementById('bw-v6-diagnostics') as HTMLElement | null;
      return {
        sectionActive: section?.classList.contains('is-active') === true,
        explodedActive: exploded?.classList.contains('is-active') === true,
        diagnosticsVisible: diagnostics ? !diagnostics.hidden : false,
      };
    });
    const clearance = await client.tool('cad_query', {
      sessionId: connected.sessionId,
      query: { kind: 'assembly.clearance', entities: [shaftRef, coverRef] },
    });
    await captureCheckpoint('clearance evidence');
    const interference = await client.tool('cad_query', {
      sessionId: connected.sessionId,
      query: { kind: 'assembly.interference', scope: 'visible-model' },
    });
    await captureCheckpoint('interference evidence');
    const health = await client.tool('cad_query', {
      sessionId: connected.sessionId,
      query: { kind: 'geometry.health', scope: 'visible-model' },
    });
    await captureCheckpoint('geometry health evidence');
    const renderPath = join(runRoot, 'model-only-review.png');
    const renderArtifact = await client.tool('cad_artifact', {
      sessionId: connected.sessionId,
      format: 'png',
      path: renderPath,
      entities: [coverRef],
      width: 960,
      height: 540,
    });
    await captureCheckpoint('model-only artifact evidence');
    const renderBytes = await readFile(renderPath);
    const webvttPath = join(runRoot, 'visible-narration.vtt');
    const srtPath = join(runRoot, 'visible-narration.srt');
    const webvttArtifact = await client.tool('cad_artifact', {
      sessionId: connected.sessionId,
      format: 'webvtt',
      path: webvttPath,
    });
    const srtArtifact = await client.tool('cad_artifact', {
      sessionId: connected.sessionId,
      format: 'srt',
      path: srtPath,
    });
    const webvtt = await readFile(webvttPath, 'utf8');
    const srt = await readFile(srtPath, 'utf8');
    const step9 = {
      sectionId: inspectedView.snapshot.viewport.activeSectionId,
      explodedViewId: inspectedView.snapshot.viewport.activeExplodedViewId,
      visibleInspection: Object.values(visibleInspection).every(Boolean),
      clearanceExact: clearance.result.exactGeometry === true && clearance.result.pairs.length === 1,
      interferenceExact: interference.result.exactGeometry === true && Array.isArray(interference.result.pairs),
      healthExact: health.result.exactGeometry === true && health.result.aggregate?.valid === true,
      renderSha256: renderArtifact.sha256,
      renderIntegrity: renderArtifact.sha256 === sha256(renderBytes) &&
        renderBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      modelOnly: renderArtifact.manifest?.browserChromeIncluded === false,
      narrationCueCount: webvttArtifact.manifest?.cueCount,
      narrationParity: webvttArtifact.manifest?.cueCount === srtArtifact.manifest?.cueCount,
      trustedNarration: /project changed/i.test(webvtt) &&
        /Applied the exact preview/i.test(webvtt) &&
        /clearance measured/i.test(webvtt) &&
        /Interference inspection completed/i.test(webvtt) &&
        /Geometry health confirmed/i.test(webvtt) &&
        /Rendered the model-only review image/i.test(webvtt) &&
        !/chain.of.thought|private reasoning|raw prompt|credential|secret/i.test(webvtt + srt),
    };

    if (recorder) {
      console.log('  INFO finalizing recording observer');
      await recorder.stop();
      recorder = null;
      console.log('  INFO recording observer finalized');
    }

    let step10: any = null;
    let finalSummary = await client.tool('cad_inspect', {
      sessionId: connected.sessionId,
      query: { kind: 'project.summary' },
    });
    if (mode === 'normal') {
      const projectPath = join(runRoot, 'final-project.json');
      const stepPath = join(runRoot, 'selected-cover.step');
      const projectArtifact = await client.tool('cad_artifact', {
        sessionId: connected.sessionId,
        format: 'project',
        path: projectPath,
      });
      const selectedStep = await client.tool('cad_artifact', {
        sessionId: connected.sessionId,
        format: 'step',
        path: stepPath,
        entities: [coverRef],
      });
      const projectBytes = await readFile(projectPath);
      const selectedStepBytes = await readFile(stepPath);
      const selectedStepText = selectedStepBytes.toString('utf8');
      const exactBeforeReload = await client.tool('cad_query', {
        sessionId: connected.sessionId,
        query: { kind: 'geometry.validity', exact: true },
      });
      const staleAcrossReload = await client.tool('cad_preview', {
        sessionId: connected.sessionId,
        transaction: {
          transactionId: 'normal-stale-across-reload',
          label: 'Preview that must expire across recovery',
          expectedRevision: finalSummary.revision,
          operations: [{ kind: 'project.rename', input: { name: 'Must not commit' } }],
          atomic: true,
        },
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
      await waitForSessionState(client, connected.sessionId, 'recovering');
      const recovery = await client.tool('cad_session', { action: 'reconnect', sessionId: connected.sessionId });
      await page.goto(recovery.launchUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
      const recoveryApproval = await approveConnectionAsHuman(page, clientLabel, false);
      humanActions.push('approve bounded reload recovery');
      await waitForSessionState(client, connected.sessionId, 'connected');
      const recoveredSummary = await client.tool('cad_inspect', {
        sessionId: connected.sessionId,
        query: { kind: 'project.summary' },
      });
      const recoveredUi = await client.tool('cad_ui', { sessionId: connected.sessionId, action: 'snapshot' });
      const recoveredExact = await client.tool('cad_query', {
        sessionId: connected.sessionId,
        query: { kind: 'geometry.validity', exact: true },
      });
      const staleRecoveryCode = await expectedToolError(client.tool('cad_commit', {
        sessionId: connected.sessionId,
        previewId: staleAcrossReload.previewId,
        expectedRevision: staleAcrossReload.baseRevision,
      }));
      await client.tool('cad_session', { action: 'close', sessionId: connected.sessionId });
      activeSessionId = null;
      await page.waitForFunction(() => !(window as any).bomwikiCadAgent.status().connected, { polling: 50, timeout: 10_000 });
      const readOnly = await client.tool('cad_session', {
        action: 'connect',
        clientLabel: 'V6 final read-only confirmation',
        mode: 'read-only',
        permissions: { granted: ['project.read', 'ui.read', 'ui.wait-events'] },
      });
      activeSessionId = readOnly.sessionId;
      const readOnlyApproval = await approveConnectionAsHuman(page, 'V6 final read-only confirmation');
      humanActions.push('approve final read-only confirmation');
      const readOnlyStatus = await waitForSessionState(client, readOnly.sessionId, 'connected');
      const readOnlySummary = await client.tool('cad_inspect', {
        sessionId: readOnly.sessionId,
        query: { kind: 'project.summary' },
      });
      const readOnlyUi = await client.tool('cad_ui', { sessionId: readOnly.sessionId, action: 'snapshot' });
      const readOnlyEditCode = await expectedToolError(client.tool('cad_preview', {
        sessionId: readOnly.sessionId,
        transaction: {
          transactionId: 'normal-read-only-refusal',
          label: 'Must not edit',
          expectedRevision: readOnlyUi.documentRevision,
          operations: [{ kind: 'project.rename', input: { name: 'Forbidden' } }],
          atomic: true,
        },
      }));
      step10 = {
        projectArtifactSha256: projectArtifact.sha256,
        projectArtifactIntegrity: projectArtifact.sha256 === sha256(projectBytes) &&
          JSON.parse(projectBytes.toString('utf8')).schemaVersion === 5,
        selectedStepSha256: selectedStep.sha256,
        selectedStepBodyCount: selectedStep.manifest?.scope?.bodyIds?.length,
        selectedStepIntegrity: selectedStep.sha256 === sha256(selectedStepBytes) &&
          selectedStepText.startsWith('ISO-10303-21;') &&
          selectedStepText.trimEnd().endsWith('END-ISO-10303-21;'),
        recoveryApproval: Object.values(recoveryApproval).every(Boolean),
        canonicalHashPreserved: recoveredSummary.result.documentHash === finalSummary.result.documentHash,
        exactEvidencePreserved: JSON.stringify(recoveredExact.result) === JSON.stringify(exactBeforeReload.result),
        staleRecoveryCode,
        readOnlyApproval: Object.values(readOnlyApproval).every(Boolean),
        readOnlyMode: readOnlyStatus.status?.mode === 'read-only',
        readOnlyHash: readOnlySummary.result.documentHash,
        readOnlyEditCode,
      };
      finalSummary = readOnlySummary;
      await client.tool('cad_session', { action: 'close', sessionId: readOnly.sessionId });
      activeSessionId = null;
    } else {
      await client.tool('cad_session', { action: 'close', sessionId: connected.sessionId });
      activeSessionId = null;
    }

    const forbiddenTranscript = client.transcript.filter((entry) =>
      /selector|clientX|clientY|pointer|keyboard|computer.use|screenshot/i.test(JSON.stringify(entry)));
    const video = mode === 'recording' ? await readFile(videoPath) : null;
    const videoProbe = mode === 'recording'
      ? spawnSync(FFMPEG_PATH, [
          '-hide_banner',
          '-i', videoPath,
        ], { encoding: 'utf8' })
      : null;
    const durationMatch = videoProbe?.stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
    const videoDurationSeconds = durationMatch
      ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
      : null;
    const videoLine = videoProbe?.stderr.split('\n').find((line) => /Video:\s*vp9\b/.test(line)) || '';
    const dimensions = videoLine.match(/\b(\d{2,5})x(\d{2,5})\b/);
    return {
      mode,
      step1,
      step2,
      step3,
      step4,
      step5,
      step6,
      step7,
      step8,
      step9,
      step10,
      finalDocumentHash: finalSummary.result.documentHash,
      exactHealthSha256: sha256(JSON.stringify(health.result)),
      finalRevision: finalSummary.revision,
      uiManifestHash: uiManifest.manifestHash,
      protocolCapabilities: connectedStatus.status?.capabilities,
      transcript: client.transcript,
      transcriptSha256: sha256(JSON.stringify(client.transcript)),
      forbiddenTranscript,
      humanActions,
      pageErrors,
      requestFailures,
      artifacts: {
        renderPath,
        renderSha256: renderArtifact.sha256,
        webvttPath,
        webvttSha256: webvttArtifact.sha256,
        srtPath,
        srtSha256: srtArtifact.sha256,
        ...(video ? {
          videoPath,
          videoBytes: video.byteLength,
          videoSha256: sha256(video),
          videoDurationSeconds,
          videoCodec: videoLine ? 'vp9' : null,
          videoWidth: dimensions ? Number(dimensions[1]) : null,
          videoHeight: dimensions ? Number(dimensions[2]) : null,
          videoSegments: 1,
          captureBackend: RECORDING_CAPTURE_BACKEND,
        } : {}),
      },
    };
  } finally {
    if (recorder) await recorder.stop().catch(() => {});
    if (activeSessionId) {
      await client.tool('cad_session', { action: 'close', sessionId: activeSessionId }).catch(() => {});
    }
    await context.close();
    await client.close();
  }
}

export async function runStudioV6Acceptance() {
console.log('\nCAD Studio V6 ten-step normal-operation acceptance');
await rm(evidenceRoot, { recursive: true, force: true });
await rm(manifestPath, { force: true });
await mkdir(evidenceRoot, { recursive: true });
const { server, url } = await startStudioServer();
let browser: Browser | null = null;
let normal: any;
let recording: any;
let normalGate: 'pass' | 'fail' | 'not-run' = 'not-run';
let recordingGate: 'pass' | 'fail' | 'not-run' = 'not-run';
const fatalErrors: string[] = [];
try {
  const requiredPrograms = [
    [FFMPEG_PATH, ['-version']],
    ...(RECORDING_CAPTURE_BACKEND === 'chromium-print-compositor'
      ? [['pdftoppm', ['-v']] as [string, string[]]]
      : []),
  ] as Array<[string, string[]]>;
  for (const [program, args] of requiredPrograms) {
    const probe = spawnSync(program, args, { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) {
      throw new Error(`Required recording program "${program}" is unavailable: ${probe.error?.message || probe.stderr}`);
    }
  }
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
  normal = await runWorkflow(browser, url, 'normal');
  check('step 1/10 loads the canonical skill and discovers the complete V6 tool/profile contract',
    normal.step1.initialized &&
    normal.step1.skillVersion === '0.6.0' &&
    /^[a-f0-9]{64}$/.test(normal.step1.skillPackageSha256 || '') &&
    normal.step1.requiredToolsAvailable &&
    normal.step1.coreSkillLoaded &&
    /^fnv1a32:/.test(normal.uiManifestHash));
  check('step 2/10 connects through one accessible approval without copy/paste',
    normal.step2.oneApproval &&
    normal.step2.noCopyPaste &&
    normal.step2.accessibleApproval &&
    normal.step2.liveCapabilities);
  check('step 3/10 inspects the active assembly, UI state, camera, and independent revisions',
    normal.step3.assemblyFound &&
    typeof normal.step3.projectId === 'string' &&
    Number.isInteger(normal.step3.documentRevision) &&
    Number.isInteger(normal.step3.uiRevision) &&
    normal.step3.camera?.position?.length === 3);
  check('step 4/10 visibly navigates workspace, tree, selection, inspector, and fitted camera',
    normal.step4.visible &&
    normal.step4.documentUnchanged &&
    normal.step4.rendererSettled);
  check('step 5/10 opens and fills the normal component-transform command',
    normal.step5.commandId === 'assembly.component-transform' &&
    normal.step5.boundOccurrence === 'occurrence-robot-cover' &&
    normal.step5.typedTransformVisible &&
    normal.step5.normalPanelVisible,
    normal.step5);
  check('step 6/10 produces a detached visible exact preview with direct-path parity',
    normal.step6.exactGeometry &&
    normal.step6.detached &&
    normal.step6.visible &&
    normal.step6.directVisibleHashParity &&
    normal.step6.exactEvidenceParity);
  check('step 7/10 observes the human edit, refuses stale commit, and reports structured history',
    normal.step7.previewInvalidated &&
    normal.step7.staleCommitCode === 'REVISION_CONFLICT' &&
    normal.step7.historyContainsHumanEdit);
  check('step 8/10 refreshes and commits one approved normal undoable command',
    normal.step8.directVisibleHashParity &&
    normal.step8.approvalVisible &&
    normal.step8.oneNormalRevision &&
    normal.step8.commandClosed &&
    normal.step8.rendererRevision === normal.step8.committedRevision &&
    typeof normal.step8.historyTransactionId === 'string');
  check('step 9/10 activates saved inspection views, runs exact assembly queries, and renders a model-only artifact',
    normal.step9.sectionId === 'section-robot-joint' &&
    normal.step9.explodedViewId === 'explode-robot-joint' &&
    normal.step9.visibleInspection &&
    normal.step9.clearanceExact &&
    normal.step9.interferenceExact &&
    normal.step9.healthExact &&
    normal.step9.renderIntegrity &&
    normal.step9.modelOnly &&
    normal.step9.narrationParity &&
    normal.step9.trustedNarration);
  check('step 10/10 persists, recovers, exports selected CAD, and confirms final state read-only',
    normal.step10.canonicalHashPreserved &&
    normal.step10.exactEvidencePreserved &&
    normal.step10.projectArtifactIntegrity &&
    normal.step10.selectedStepBodyCount === 1 &&
    normal.step10.selectedStepIntegrity &&
    normal.step10.staleRecoveryCode === 'PREVIEW_EXPIRED' &&
    normal.step10.readOnlyMode &&
    normal.step10.readOnlyHash === normal.finalDocumentHash &&
    normal.step10.readOnlyEditCode === 'PERMISSION_DENIED');
  check('normal-operation transcript contains only BOMwiki CAD tools and no screen-control data',
    normal.transcript.length >= 30 &&
    normal.transcript.every((entry: TranscriptEntry) => entry.tool.startsWith('cad_')) &&
    normal.forbiddenTranscript.length === 0 &&
    normal.pageErrors.length === 0 &&
    normal.requestFailures.length === 0,
    {
      forbiddenTranscript: normal.forbiddenTranscript,
      pageErrors: normal.pageErrors,
      requestFailures: normal.requestFailures,
    });
  normalGate = failed === 0 ? 'pass' : 'fail';

  console.log('\nCAD Studio V6 recording-presentation replay');
  const recordingFailuresAtStart = failed;
  recording = await runWorkflow(browser, url, 'recording');
  check('recording replay uses the same semantic workflow and reaches exact normal-run parity',
    recording.finalDocumentHash === normal.finalDocumentHash &&
    recording.exactHealthSha256 === normal.exactHealthSha256 &&
    recording.finalRevision === normal.finalRevision &&
    recording.step6.directVisibleHashParity &&
    recording.step8.directVisibleHashParity &&
    recording.step9.healthExact);
  check('recording replay produces one uncut reviewable WebM over the real Studio UI',
    recording.artifacts.videoSegments === 1 &&
    recording.artifacts.videoBytes > 50_000 &&
    /^[a-f0-9]{64}$/.test(recording.artifacts.videoSha256) &&
    Number.isFinite(recording.artifacts.videoDurationSeconds) &&
    recording.artifacts.videoDurationSeconds > 10 &&
    recording.artifacts.videoCodec === 'vp9' &&
    recording.artifacts.videoWidth === 1280 &&
    recording.artifacts.videoHeight === 800 &&
    ['chromium-print-compositor', 'chromium-screenshot'].includes(recording.artifacts.captureBackend));
  check('recording replay exports matching trusted visible WebVTT/SRT cues',
    recording.step9.narrationCueCount > 10 &&
    recording.step9.narrationParity &&
    recording.step9.trustedNarration &&
    /^[a-f0-9]{64}$/.test(recording.artifacts.webvttSha256) &&
    /^[a-f0-9]{64}$/.test(recording.artifacts.srtSha256));
  check('recording observer performs no agent CAD/UI operation outside the MCP transcript',
    recording.transcript.every((entry: TranscriptEntry) => entry.tool.startsWith('cad_')) &&
    recording.forbiddenTranscript.length === 0 &&
    recording.pageErrors.length === 0 &&
    recording.requestFailures.length === 0 &&
    recording.humanActions.join(',') === [
      'approve permission-scoped connection',
      'change normal display mode to wireframe',
      'approve exact preview commit',
    ].join(','),
    {
      forbiddenTranscript: recording.forbiddenTranscript,
      pageErrors: recording.pageErrors,
      requestFailures: recording.requestFailures,
      humanActions: recording.humanActions,
    });
  recordingGate = failed === recordingFailuresAtStart ? 'pass' : 'fail';
} catch (error) {
  failed++;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  fatalErrors.push(message);
  if (normalGate === 'not-run') normalGate = 'fail';
  if (recordingGate === 'not-run') recordingGate = 'fail';
  console.error('  FAIL fatal acceptance runtime error', message);
} finally {
  await browser?.close().catch((error) => {
    failed++;
    fatalErrors.push(`Browser cleanup: ${String(error)}`);
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim() || null;
const dirtyWorkingTree = Boolean(spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim());
const manifest = {
  generatedAt: new Date().toISOString(),
  sourceCommit,
  dirtyWorkingTree,
  profile: 'bomwiki.cad.agentic-ui/v1',
  skillVersion: '0.6.0',
  normal: normal || null,
  recording: recording || null,
  fatalErrors,
  gates: {
    tenStepNormalOperation: normalGate,
    recordingPresentationReplay: recordingGate,
    protectedCi: 'not-run-by-local-acceptance',
    productionCodexHost: 'not-run-by-local-acceptance',
    productionHostNeutral: 'not-run-by-local-acceptance',
    humanVisualSignoff: 'required-before-v6-release-signoff',
  },
  status: failed === 0 ? 'automated-pass-awaiting-protected-production-evidence' : 'fail',
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
console.log(`\n${passed}/${passed + failed} V6 acceptance checks passed`);
console.log(JSON.stringify({ status: manifest.status, manifestPath }, null, 2));
if (failed) process.exitCode = 1;
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  await runStudioV6Acceptance();
}
