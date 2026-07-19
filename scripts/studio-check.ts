// Browser-level checks for the CAD Studio (Slice A contract): transactional
// drafts, undo/redo, document restoration, keyboard focus rules. Runs the
// REAL page markup (rendered through cadStudioPage) and the real static JS
// against headless Chrome — no database needed, so CI can run it.
//
//   npm run studio:check
//
// Exits non-zero on any failure. Requires the puppeteer devDependency.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// Serve the rendered studio page plus /static — nothing else.
const html = cadStudioPage();
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path.startsWith('/api/')) {
    // The page chrome probes /api/session for signed-in state; answer with
    // an empty JSON object like the real engine does for anonymous users.
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
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;
const URL_ = `http://127.0.0.1:${port}/cad/studio`;

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page: Page = await browser.newPage();
page.on('pageerror', (e) => check('no page errors', false, String(e)));

const S = async <T>(fn: string): Promise<T> =>
  page.evaluate(`(() => { const s = window.__bwStudio; return (${fn})(s); })()`) as Promise<T>;
const waitReady = async () => {
  await page.waitForFunction(
    `window.__bwStudio && document.querySelectorAll('.hist-item').length >= 0 && window.__bwStudio.triCount() > 0`,
    { timeout: 60_000 },
  );
};

// --- boot: starter part seeds and builds ----------------------------------
await page.goto(URL_, { waitUntil: 'domcontentloaded' });
await waitReady();
check('starter part seeds two features', (await page.$$('.hist-item')).length === 2);
check('starter part builds without errors', ((await S<string[]>('(s) => s.errors()')) as string[]).length === 0);
check('boot leaves undo empty', (await S<number>('(s) => s.undoDepth()')) === 0);

// --- transactional drafts: edit + cancel is byte-identical ---------------
const docBefore = await S<string>('(s) => s.docJson()');
const trisBefore = await S<number>('(s) => s.triCount()');
await page.click('.hist-item [data-edit]'); // edit feature 1 (extrude)
await page.waitForSelector('#bw-sketch:not([hidden])');
// mutate several fields in the open editor
await page.evaluate(() => {
  const h = document.getElementById('bw-sk-op-h') as HTMLInputElement;
  h.value = '99';
  const canvas = document.getElementById('bw-sketch-canvas')!;
  const r = canvas.getBoundingClientRect();
  const ev = (t: string, x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, bubbles: true }));
  ev('pointerup', r.left + 50, r.top + 50);
  ev('pointermove', r.left + 90, r.top + 90);
  ev('pointerup', r.left + 90, r.top + 90); // adds a rect to the DRAFT
});
await page.click('#bw-sk-cancel');
check('cancel: document byte-identical', (await S<string>('(s) => s.docJson()')) === docBefore);
check('cancel: solid unchanged', (await S<number>('(s) => s.triCount()')) === trisBefore);
check('cancel: no undo entry', (await S<number>('(s) => s.undoDepth()')) === 0);

// --- one commit per apply -------------------------------------------------
await page.click('.hist-item [data-edit]');
await page.waitForSelector('#bw-sketch:not([hidden])');
await page.evaluate(() => {
  (document.getElementById('bw-sk-op-h') as HTMLInputElement).value = '9';
});
await page.click('#bw-sk-apply');
await page.waitForFunction(`document.getElementById('bw-sketch').hidden`);
await new Promise((r) => setTimeout(r, 1500)); // rebuild
check('apply: exactly one undo entry', (await S<number>('(s) => s.undoDepth()')) === 1);
check('apply: height changed in doc', (await S<string>('(s) => s.docJson()')).includes('"h":9'));

// --- undo / redo ----------------------------------------------------------
await page.keyboard.down('Control');
await page.keyboard.press('z');
await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 1200));
check('undo restores the document', (await S<string>('(s) => s.docJson()')) === docBefore);
check('undo moves entry to redo', (await S<number>('(s) => s.redoDepth()')) === 1);
await page.keyboard.down('Control');
await page.keyboard.press('y');
await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 1200));
check('redo re-applies', (await S<string>('(s) => s.docJson()')).includes('"h":9'));

// --- new commit clears redo ----------------------------------------------
await page.keyboard.down('Control');
await page.keyboard.press('z');
await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 1200));
await page.click('#bw-param-add');
await new Promise((r) => setTimeout(r, 800));
check('new commit clears redo', (await S<number>('(s) => s.redoDepth()')) === 0);

// --- shortcuts suppressed while a field is focused ------------------------
const depth = await S<number>('(s) => s.undoDepth()');
await page.focus('[data-pval="0"]');
await page.keyboard.down('Control');
await page.keyboard.press('z');
await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 300));
check('ctrl+z ignored in input field', (await S<number>('(s) => s.undoDepth()')) === depth);

// --- param change commits + undoes ---------------------------------------
await page.evaluate(() => {
  const inp = document.querySelector('[data-pval="0"]') as HTMLInputElement;
  inp.value = '55';
  inp.dispatchEvent(new Event('change'));
});
await new Promise((r) => setTimeout(r, 1500));
check('param change commits', ((await S<string[]>('(s) => s.undoLabels()')) as string[]).some((l) => /Set /.test(l)));

// --- invalid project open leaves doc unchanged ----------------------------
const beforeBad = await S<string>('(s) => s.docJson()');
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(['{"nope": true}'], 'bad.json', { type: 'application/json' }));
  const inp = document.getElementById('bw-open-file') as HTMLInputElement;
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 800));
check('invalid project rejected, doc unchanged', (await S<string>('(s) => s.docJson()')) === beforeBad);

// --- clear -> reload stays empty ------------------------------------------
page.on('dialog', (d) => d.accept());
await page.click('#bw-clear');
await new Promise((r) => setTimeout(r, 1200));
check('clear empties the document', (await S<string>('(s) => s.docJson()')).includes('"features":[]'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(`window.__bwStudio`, { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2500));
check('reload after clear stays empty (no starter resurrection)', (await S<string>('(s) => s.docJson()')).includes('"features":[]'));

await browser.close();
server.close();
console.log(failures === 0 ? '\nall studio checks passed' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
