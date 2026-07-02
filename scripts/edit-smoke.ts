// End-to-end smoke test of the edit loop against a running engine:
// login -> propose (qty change + new part) -> pending in queue -> accept ->
// page updated -> history has the revision -> revert -> page restored.
// Uses a real node but leaves the database exactly as found.
const BASE = process.env.ENGINE_URL ?? 'http://localhost:4400';
const TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin';
const NODE = process.env.SMOKE_NODE ?? 'hv-battery-pack';

let cookie = '';
let failures = 0;

function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers ?? {}), cookie },
  });
}

async function pageData(id: string): Promise<{ rev: number; data: any; html: string }> {
  const html = await (await req(`/item/${id}/`)).text();
  const m = html.match(/<script type="application\/json" id="bw-edit-data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`no edit data on /item/${id}/`);
  const parsed = JSON.parse(m[1]);
  return { rev: parsed.rev, data: parsed.data, html };
}

// --- login ---
const loginRes = await fetch(`${BASE}/login`, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `token=${encodeURIComponent(TOKEN)}`,
});
cookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0];
check('login sets session', loginRes.status === 303 && cookie.startsWith('bw_sess='));

// --- snapshot the starting state ---
const before = await pageData(NODE);
const firstLine = before.data.bom[0];
const origQty = firstLine.qty;
const newQty = origQty + 3;
const newPartName = `Smoke Test Washer ${Date.now() % 100000}`;
const newPartId = newPartName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// --- propose: qty change + created part added to the BOM ---
const proposed = JSON.parse(JSON.stringify(before.data));
proposed.bom[0].qty = newQty;
proposed.bom.push({ id: newPartId, qty: 6, note: 'smoke test line' });
const proposeRes = await req('/api/changesets', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    edits: [
      { op: 'create', nodeId: newPartId, data: { name: newPartName, kind: 'part' } },
      { op: 'edit', nodeId: NODE, baseRev: before.rev, data: proposed },
    ],
  }),
});
const proposeBody = await proposeRes.json();
check('propose accepted (201)', proposeRes.status === 201, JSON.stringify(proposeBody));
const csId = proposeBody.id;

// --- rejected inputs are rejected ---
const badRes = await req('/api/changesets', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    edits: [{ op: 'edit', nodeId: NODE, baseRev: before.rev, data: { ...proposed, bom: [{ id: 'does-not-exist-xyz', qty: 0.5 }] } }],
  }),
});
check('invalid edit rejected (422)', badRes.status === 422);

// --- pending queue shows it, page is still unchanged ---
const queueHtml = await (await req('/review')).text();
check('queue lists the change', queueHtml.includes(`Change #${csId}`));
check('queue shows semantic line', queueHtml.includes(`quantity ${origQty} → ${newQty}`));
const stillBefore = await pageData(NODE);
check('page unchanged while pending', stillBefore.data.bom[0].qty === origQty);

// --- accept ---
const acceptRes = await req(`/review/${csId}/accept`, { method: 'POST' });
check('accept redirects', acceptRes.status === 303);
const after = await pageData(NODE);
check('page shows new qty', after.data.bom[0].qty === newQty);
check('page rev advanced', after.rev > before.rev);
check('new part page exists', (await req(`/item/${newPartId}/`)).status === 200);
check('new part in rendered BOM', after.html.includes(newPartId));

// --- history ---
const histHtml = await (await req(`/item/${NODE}/history`)).text();
check('history lists new revision', histHtml.includes(`r${after.rev}`));
check('history has semantic summary', histHtml.includes(`quantity ${origQty} → ${newQty}`));
const oldView = await (await req(`/item/${NODE}/rev/${before.rev}`)).text();
check('old revision view has banner', oldView.includes(`viewing r${before.rev}`));

// --- stale baseRev is refused on accept ---
const staleRes = await req('/api/changesets', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    edits: [{ op: 'edit', nodeId: NODE, baseRev: before.rev, data: proposed }],
  }),
});
const staleId = (await staleRes.json()).id;
const staleAccept = await req(`/review/${staleId}/accept`, { method: 'POST' });
const staleLoc = staleAccept.headers.get('location') ?? '';
check('stale accept refused', decodeURIComponent(staleLoc).includes('changed since'));
await req(`/review/${staleId}/reject`, { method: 'POST' });

// --- revert restores the original state ---
const revertRes = await req(`/item/${NODE}/revert/${before.rev}`, { method: 'POST' });
check('revert redirects', revertRes.status === 303);
const restored = await pageData(NODE);
check('qty restored', restored.data.bom[0].qty === origQty);
check('smoke line gone', !restored.data.bom.some((l: any) => l.id === newPartId));

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
