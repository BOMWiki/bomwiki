// End-to-end smoke test of the 3D model layer against a running engine:
// upload validation, the two-step contribute flow, quarantine of pending
// files, the review queue, and serving headers. Needs DATABASE_URL for
// cleanup (like email-smoke); leaves the database and MODELS_DIR as found.
import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { pool } from '../src/db.ts';
import { modelFilePath } from '../src/models.ts';

const BASE = process.env.ENGINE_URL ?? 'http://localhost:4400';
const TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin';
const NODE = process.env.SMOKE_NODE ?? 'hv-battery-pack';

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function client(cookie = '') {
  const jar = { cookie };
  return {
    jar,
    async req(path: string, init: RequestInit = {}): Promise<Response> {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        redirect: 'manual',
        headers: { ...(init.headers ?? {}), cookie: jar.cookie },
      });
      const set = res.headers.get('set-cookie');
      if (set?.startsWith('bw_sess=') && !set.includes('Max-Age=0')) jar.cookie = set.split(';')[0];
      return res;
    },
  };
}
type Client = ReturnType<typeof client>;

async function signup(email: string, handle: string): Promise<Client> {
  const anon = client();
  const res = await anon.req('/auth/request', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(email)}&handle=${encodeURIComponent(handle)}`,
  });
  const html = await res.text();
  const link = html.match(/href="(\/auth\/[a-f0-9]{48})"/)?.[1];
  check(`magic link issued for ${handle}`, Boolean(link));
  const authRes = await anon.req(link!);
  check(`magic link signs ${handle} in`, authRes.status === 303);
  return anon;
}

/** A minimal valid binary STL: 80-byte header, uint32 triangle count = 1,
 *  one 50-byte facet record. 134 bytes total. `seed` varies the vertex data
 *  so each run uploads content the engine has never hashed. */
function binaryStl(seed: number): Buffer {
  const buf = Buffer.alloc(134);
  buf.write('bomwiki models-smoke', 0, 'latin1');
  buf.writeUInt32LE(1, 80);
  // normal + 3 vertices, 12 floats. The seed vertex makes the content unique
  // per run (float32 is exact for integers up to 2^24), so a rerun can never
  // dedupe onto a leftover file owned by another user.
  const floats = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, seed % 16_000_000, 0];
  floats.forEach((f, i) => buf.writeFloatLE(f, 84 + i * 4));
  return buf;
}

const STEP_TEXT = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('smoke.step','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
ENDSEC;
END-ISO-10303-21;
`;

async function upload(
  c: Client,
  ext: string,
  body: Buffer | string,
): Promise<{ status: number; body: any }> {
  const bytes = typeof body === 'string' ? Buffer.from(body) : body;
  const res = await c.req(`/api/models/upload?ext=${ext}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Uint8Array(bytes),
  });
  return { status: res.status, body: await res.json() };
}

async function submit(c: Client, payload: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const res = await c.req('/api/models/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: NODE,
      license: 'CC-BY',
      attribution: 'Models Smoke',
      attest: true,
      ...payload,
    }),
  });
  return { status: res.status, body: await res.json() };
}

const createdShas: string[] = [];
const stamp = Date.now() % 1000000;

// --- admin login ---
const admin = client();
const loginRes = await admin.req('/login', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `token=${encodeURIComponent(TOKEN)}`,
});
check('admin login', loginRes.status === 303 && admin.jar.cookie.startsWith('bw_sess='));

// --- upload validation ---
const anon = client();
check('signed-out upload is 401', (await upload(anon, 'stl', binaryStl(stamp))).status === 401);

const stl = binaryStl(stamp);
const localSha = createHash('sha256').update(stl).digest('hex');
const up1 = await upload(admin, 'stl', stl);
check('stl upload ok', up1.status === 200, JSON.stringify(up1.body));
check('sha matches local hash', up1.body.sha256 === localSha);
check('format sniffed as binary stl', up1.body.format === 'stl-binary' && up1.body.triangles === 1);
if (up1.status === 200) createdShas.push(up1.body.sha256);

const up2 = await upload(admin, 'stl', stl);
check('re-upload dedupes to same sha', up2.status === 200 && up2.body.sha256 === localSha);

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400)]);
check('jpeg-as-.stl rejected 422', (await upload(admin, 'stl', jpeg)).status === 422);
check('bad extension rejected 422', (await upload(admin, 'exe', stl)).status === 422);
check('oversize .scad rejected 413', (await upload(admin, 'scad', Buffer.alloc(1_100_000, 32))).status === 413);

const ascii = `solid smoke\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 ${stamp} 0\n  endloop\n endfacet\nendsolid smoke\n`;
const upA = await upload(admin, 'stl', ascii);
check('ascii stl sniffed', upA.status === 200 && upA.body.format === 'stl-ascii' && upA.body.triangles === 1);
if (upA.status === 200) createdShas.push(upA.body.sha256);

// --- submit validation ---
check('bad license rejected', 'errors' in (await submit(admin, { sha256: localSha, license: 'GPL' })).body);
check('missing attestation rejected', 'errors' in (await submit(admin, { sha256: localSha, attest: false })).body);
check('unknown node rejected', 'errors' in (await submit(admin, { sha256: localSha, nodeId: 'no-such-node-xyz' })).body);

// --- admin submit goes live, file becomes public, page shows it ---
const sub1 = await submit(admin, { sha256: localSha });
check('admin submit is live', sub1.status === 201 && sub1.body.live === true, JSON.stringify(sub1.body));

const pub = await fetch(`${BASE}/models/${localSha}.stl`);
check('accepted file is public', pub.status === 200);
check('served as model/stl', pub.headers.get('content-type') === 'model/stl');
check('served immutable', (pub.headers.get('cache-control') ?? '').includes('immutable'));

const pageHtml = await (await admin.req(`/item/${NODE}/`)).text();
check('item page has model data block', pageHtml.includes('id="bw-model-data"'));
check('item page has credit line', pageHtml.includes('3D model: Models Smoke'));
check('item page loads viewer script', pageHtml.includes('/static/model-viewer.js'));

// --- STEP source file: download disposition ---
const upS = await upload(admin, 'stp', STEP_TEXT.replace('smoke.step', `smoke-${stamp}.step`));
check('step upload ok (stp normalized)', upS.status === 200 && upS.body.format === 'step');
if (upS.status === 200) createdShas.push(upS.body.sha256);
const subS = await submit(admin, { sha256: upS.body.sha256 });
check('step submit live as source', subS.status === 201 && subS.body.live === true);
const stepRes = await fetch(`${BASE}/models/${upS.body.sha256}.step`);
check('step served as attachment', (stepRes.headers.get('content-disposition') ?? '').startsWith('attachment'));
const pageHtml2 = await (await admin.req(`/item/${NODE}/`)).text();
check('item page lists CAD source files', pageHtml2.includes('CAD source files'));

// --- fresh contributor: pending path + quarantine ---
const fresh = await signup(`models-smoke-${stamp}@example.com`, `msmoke${stamp}`);
const freshStl = binaryStl(stamp + 1);
const upF = await upload(fresh, 'stl', freshStl);
check('fresh user upload ok', upF.status === 200);
if (upF.status === 200) createdShas.push(upF.body.sha256);
const subF = await submit(fresh, { sha256: upF.body.sha256 });
check('fresh user submit is queued', subF.status === 201 && subF.body.live === false, JSON.stringify(subF.body));

const anonGet = await fetch(`${BASE}/models/${upF.body.sha256}.stl`);
check('pending file hidden from public', anonGet.status === 404);
const ownGet = await fresh.req(`/models/${upF.body.sha256}.stl`);
check('pending file visible to uploader', ownGet.status === 200);
check('pending file uncached', ownGet.headers.get('cache-control') === 'no-store');

const reviewHtml = await (await admin.req('/review')).text();
check('pending model on review queue', reviewHtml.includes(`Model #${subF.body.id}`));

const acceptRes = await admin.req(`/review/model/${subF.body.id}/accept`, { method: 'POST' });
check('reviewer accept redirects', acceptRes.status === 303);
check('accepted file now public', (await fetch(`${BASE}/models/${upF.body.sha256}.stl`)).status === 200);
const pageHtml3 = await (await admin.req(`/item/${NODE}/`)).text();
check('display pointer flipped to newest accept', pageHtml3.includes(upF.body.sha256));

// --- withdraw ---
const wStl = binaryStl(stamp + 2);
const upW = await upload(fresh, 'stl', wStl);
check('withdraw-test upload ok', upW.status === 200, JSON.stringify(upW.body));
if (upW.status === 200) createdShas.push(upW.body.sha256);
const subW = await submit(fresh, { sha256: upW.body.sha256 });
check(
  'second queued submit',
  subW.status === 201 && subW.body.live === false,
  `${subW.status} ${JSON.stringify(subW.body)}`,
);
const withdrawRes = await fresh.req(`/model/${subW.body.id}/withdraw`, { method: 'POST' });
check('uploader can withdraw', withdrawRes.status === 303, String(withdrawRes.status));
const reviewHtml2 = await (await admin.req('/review')).text();
check('withdrawn model gone from queue', !reviewHtml2.includes(`Model #${subW.body.id}`));

// --- cleanup: remove everything this run created ---
await pool.query('delete from node_models where node_id = $1', [NODE]);
await pool.query('delete from model_submissions where sha256 = any($1)', [createdShas]);
const files = await pool.query('delete from model_files where sha256 = any($1) returning sha256, ext', [createdShas]);
for (const f of files.rows) await unlink(modelFilePath(f.sha256, f.ext)).catch(() => {});
// The throwaway user stays, same as community-smoke — sessions/magic-link/
// email-log rows reference it and content cleanup is what matters.
const after = await (await admin.req(`/item/${NODE}/`)).text();
check('cleanup: page back to no-model state', after.includes('No 3D model yet'));
await pool.end();

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
