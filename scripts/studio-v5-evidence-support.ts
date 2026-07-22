import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, '..');
const staticDir = join(engineRoot, 'static');
const MIME: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };

export const evidenceRoot = process.env.STUDIO_V5_EVIDENCE_DIR || join(engineRoot, 'var', 'studio-v5-evidence');

export async function startStudioServer(): Promise<{ server: Server; url: string }> {
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
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/cad/studio` };
}

export async function closeStudioServer(server: Server | null): Promise<void> {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
}

export async function prepareStudioPage(page: Page, url: string, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForStudio(page, 0);
}

export async function waitForStudio(page: Page, minimumBodies = 0): Promise<void> {
  await page.waitForFunction((count) => {
    const studio = (window as any).__bwStudio;
    return Boolean(studio && studio.mode().kind === 'idle' && studio.bodyResults().length >= count);
  }, { timeout: 120_000, polling: 50 }, minimumBodies);
}

export async function openProjectThroughPublicControl(page: Page, project: unknown, minimumBodies: number, slug = 'fixture'): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), `bomwiki-${slug}-`));
  const filename = join(directory, `${slug}.bomcad.json`);
  writeFileSync(filename, JSON.stringify(project));
  const input = await page.$('#bw-open-file');
  if (!input) throw new Error('Public Open file control is missing.');
  await (input as any).uploadFile(filename);
  const expectedProjectId = (project as { projectId?: string })?.projectId;
  await page.waitForFunction((count, projectId) => {
    const studio = (window as any).__bwStudio;
    if (!studio || studio.mode().kind !== 'idle' || studio.bodyResults().length < count) return false;
    if (!projectId) return true;
    try { return JSON.parse(studio.docJson()).projectId === projectId; } catch { return false; }
  }, { timeout: 120_000, polling: 50 }, minimumBodies, expectedProjectId);
}

export function ensureEvidenceDirectory(name: string): string {
  const directory = join(evidenceRoot, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function percentile(values: number[], percentage: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * percentage) - 1))];
}

export async function closeBrowser(browser: Browser | null): Promise<void> {
  await browser?.close();
}
