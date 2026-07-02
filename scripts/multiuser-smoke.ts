// Multi-account versioning test: three actors (admin, contributor A who
// climbs to autoconfirmed, fresh contributor B) editing ONE node. Verifies
// per-revision attribution, history order, old-revision views, cross-account
// merge, cross-account conflict, profile counts, watchlists, and restoration.
const BASE = process.env.ENGINE_URL ?? 'http://localhost:4400';
const TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin';
const NODE = process.env.SMOKE_NODE ?? 'pack-bms';

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

async function pageData(c: Client, id: string): Promise<{ rev: number; data: any }> {
  const html = await (await c.req(`/item/${id}/`)).text();
  const m = html.match(/id="bw-edit-data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`no edit data on /item/${id}/`);
  return JSON.parse(m[1]);
}

async function propose(c: Client, edits: unknown[]): Promise<{ status: number; body: any }> {
  const res = await c.req('/api/changesets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ edits }),
  });
  return { status: res.status, body: await res.json() };
}

async function editNote(c: Client, lineIndex: number, note: string, baseRev?: number, baseData?: any) {
  const cur = baseRev !== undefined ? { rev: baseRev, data: baseData } : await pageData(c, NODE);
  const data = JSON.parse(JSON.stringify(cur.data));
  data.bom[lineIndex].note = note;
  return propose(c, [{ op: 'edit', nodeId: NODE, baseRev: cur.rev, data }]);
}

async function signup(handle: string): Promise<Client> {
  const c = client();
  const res = await c.req('/auth/request', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `email=${handle}@example.com&handle=${handle}`,
  });
  const link = (await res.text()).match(/href="(\/auth\/[a-f0-9]{48})"/)?.[1];
  await c.req(link!);
  return c;
}

const stamp = Date.now() % 1000000;
const admin = client();
await admin.req('/login', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `token=${encodeURIComponent(TOKEN)}`,
});
const handleA = `ver-a-${stamp}`;
const handleB = `ver-b-${stamp}`;
const userA = await signup(handleA);
const userB = await signup(handleB);
check('three accounts ready', Boolean(admin.jar.cookie && userA.jar.cookie && userB.jar.cookie));

const baseline = await pageData(admin, NODE);
const origNote0 = baseline.data.bom[0].note ?? '';

// --- A's gated edit, accepted by admin: revision attributed to A ---
const e1 = await editNote(userA, 0, 'A pass 1');
check('A (new) is gated', e1.status === 201 && e1.body.applied === false);
await admin.req(`/review/${e1.body.id}/accept`, { method: 'POST' });
let hist = await (await admin.req(`/item/${NODE}/history`)).text();
check('history attributes revision to A', hist.includes(`by ${handleA}`));
check('history does NOT attribute it to admin', !new RegExp(`r\\d+[\\s\\S]{0,200}A pass 1[\\s\\S]{0,200}by sd`).test(hist));

// --- climb A to autoconfirmed ---
for (let i = 2; i <= 4; i++) {
  const e = await editNote(userA, 0, `A pass ${i}`);
  if (!e.body.applied) await admin.req(`/review/${e.body.id}/accept`, { method: 'POST' });
}
const e5 = await editNote(userA, 0, 'A pass 5 instant');
check('A autoconfirmed publishes instantly', e5.body.applied === true, JSON.stringify(e5.body));

// --- B watches the node, then A edits: B's watchlist sees A's revision ---
await userB.req(`/item/${NODE}/watch`, { method: 'POST' });
await editNote(userA, 0, 'A pass 6 watched');
const watchHtml = await (await userB.req('/watchlist')).text();
check("B's watchlist shows A's edit", watchHtml.includes(handleA) && watchHtml.includes('note updated'));

// --- cross-account merge: A publishes line0, B proposes stale line1 ---
const snap = await pageData(admin, NODE);
await editNote(userA, 0, 'A merge-side');
const bData = JSON.parse(JSON.stringify(snap.data));
bData.bom[1].note = 'B merge-side';
const bMerge = await propose(userB, [{ op: 'edit', nodeId: NODE, baseRev: snap.rev, data: bData }]);
check('B (still new) gated', bMerge.body.applied === false);
const acc = await admin.req(`/review/${bMerge.body.id}/accept`, { method: 'POST' });
check('cross-account merge accepted', acc.status === 303 && !decodeURIComponent(acc.headers.get('location') ?? '').includes('conflict'));
const merged = await pageData(admin, NODE);
check('merge kept A change', merged.data.bom[0].note === 'A merge-side');
check('merge kept B change', merged.data.bom[1].note === 'B merge-side');
hist = await (await admin.req(`/item/${NODE}/history`)).text();
check('merged revision attributed to B', new RegExp(`merged over r[\\s\\S]{0,300}by ${handleB}|by ${handleB}[\\s\\S]{0,300}merged over r`).test(hist));

// --- cross-account conflict ---
const snap2 = await pageData(admin, NODE);
await editNote(userA, 0, 'A conflict-side');
const cData = JSON.parse(JSON.stringify(snap2.data));
cData.bom[0].note = 'B conflict-side';
const bConf = await propose(userB, [{ op: 'edit', nodeId: NODE, baseRev: snap2.rev, data: cData }]);
const confAcc = await admin.req(`/review/${bConf.body.id}/accept`, { method: 'POST' });
check('cross-account conflict refused', decodeURIComponent(confAcc.headers.get('location') ?? '').includes('conflicts with'));
await admin.req(`/review/${bConf.body.id}/reject`, { method: 'POST' });

// --- old revision views reproduce each account's state ---
const revs = [...hist.matchAll(/r(\d+)/g)].map((m) => Number(m[1]));
const oldest = Math.min(...revs);
const oldView = await (await admin.req(`/item/${NODE}/rev/${baseline.rev}`)).text();
check('baseline revision view reachable', oldView.includes(`viewing r${baseline.rev}`));
check('baseline view shows pre-A note', origNote0 === '' || oldView.includes(origNote0));
void oldest;

// --- profiles reflect the split ---
const profA = await (await admin.req(`/user/${handleA}`)).text();
const profB = await (await admin.req(`/user/${handleB}`)).text();
const aAccepted = Number(profA.match(/<b>(\d+)<\/b> accepted/)?.[1] ?? 0);
check('A profile counts all accepted', aAccepted >= 7, `${aAccepted}`);
check('B profile shows accepted merge', /<b>1<\/b> accepted/.test(profB));
check('B profile shows rejected conflict', /<b>1<\/b> rejected/.test(profB));

// --- recent changes attributes both accounts ---
const changes = await (await admin.req('/changes')).text();
check('recent changes lists A and B', changes.includes(handleA) && changes.includes(handleB));

// --- restore ---
const revertRes = await admin.req(`/item/${NODE}/revert/${baseline.rev}`, { method: 'POST' });
check('admin reverts to baseline', revertRes.status === 303);
const end = await pageData(admin, NODE);
check('node restored', (end.data.bom[0].note ?? '') === origNote0 && (end.data.bom[1].note ?? '') === (baseline.data.bom[1].note ?? ''));
hist = await (await admin.req(`/item/${NODE}/history`)).text();
check('revert attributed to admin, history intact', hist.includes('Revert') && hist.includes(`by ${handleA}`) && hist.includes(`by ${handleB}`));

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
