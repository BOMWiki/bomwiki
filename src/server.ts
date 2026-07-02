// The BOMwiki engine server: plain node:http, no framework. Read path from
// the in-memory graph; write path (propose -> review -> apply) from
// milestone 2. Auth is a single admin session until milestone 3.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSession, login, logout, type Session } from './auth.ts';
import {
  createChangeset,
  decideChangeset,
  listPending,
  revertNode,
  type ProposedEdit,
} from './changesets.ts';
import { pool } from './db.ts';
import { esc } from './html.ts';
import { getNode, loadGraph, nodeCount, searchNodes, totalCatalogParts } from './nodes.ts';
import { page } from './render/base.ts';
import { historyPage, type RevisionRow } from './render/history.ts';
import { itemPage } from './render/item.ts';
import { reviewPage } from './render/review.ts';

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres:///bomwiki_dev';
const PORT = Number(process.env.PORT ?? 4400);

const STATIC_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function send(res: http.ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

function sendHtml(res: http.ServerResponse, body: string, status = 200): void {
  send(res, status, 'text/html; charset=utf-8', body);
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  send(res, status, 'application/json', JSON.stringify(value));
}

function redirect(res: http.ServerResponse, to: string): void {
  res.writeHead(303, { location: to });
  res.end();
}

function notFound(res: http.ServerResponse, id?: string): void {
  sendHtml(
    res,
    page({
      title: 'Not found | BOMwiki',
      description: 'This page does not exist.',
      path: '/404',
      indexable: false,
      body: `<p>Nothing here${id ? ` for <code>${esc(id)}</code>` : ''}. <a href="/">Back to the catalog</a>.</p>`,
    }),
    404,
  );
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function loginPage(error?: string): string {
  return page({
    title: 'Sign in | BOMwiki',
    description: 'Sign in to edit.',
    path: '/login',
    indexable: false,
    body: `<div class="review"><h1>Sign in</h1>
      ${error ? `<p class="rv-notice">${esc(error)}</p>` : ''}
      <form method="post" action="/login" class="login-form">
        <input type="password" name="token" placeholder="Admin token" autofocus />
        <button>Sign in</button>
      </form>
      <p class="stub">Milestone 2: a single admin token. Accounts arrive in milestone 3.</p></div>`,
    extraCss: ['/static/edit.css'],
  });
}

async function requireAdmin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<Session | null> {
  const session = await getSession(req);
  if (!session || session.role !== 'admin') {
    redirect(res, '/login');
    return null;
  }
  return session;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/healthz') return sendJson(res, 200, { ok: true, nodes: nodeCount() });

  if (path.startsWith('/static/')) {
    const name = path.slice('/static/'.length);
    if (name.includes('..') || name.includes('/')) return notFound(res);
    const type = STATIC_TYPES[name.slice(name.lastIndexOf('.'))];
    if (!type) return notFound(res);
    try {
      const content = readFileSync(join(staticDir, name));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=300' });
      res.end(content);
    } catch {
      notFound(res);
    }
    return;
  }

  // --- auth ---
  if (path === '/login' && method === 'GET') return sendHtml(res, loginPage());
  if (path === '/login' && method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    const token = await login(body.get('token') ?? '');
    if (!token) return sendHtml(res, loginPage('Wrong token.'), 403);
    res.writeHead(303, {
      'set-cookie': `bw_sess=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`,
      location: '/review',
    });
    res.end();
    return;
  }
  if (path === '/logout' && method === 'POST') {
    await logout(req);
    res.writeHead(303, { 'set-cookie': 'bw_sess=; Path=/; Max-Age=0', location: '/' });
    res.end();
    return;
  }

  // --- api ---
  if (path === '/api/session') {
    const session = await getSession(req);
    return sendJson(res, 200, session ? { handle: session.handle, role: session.role } : {});
  }
  if (path === '/api/search') {
    const q = url.searchParams.get('q') ?? '';
    return sendJson(res, 200, searchNodes(q, Number(url.searchParams.get('limit') ?? 8)));
  }
  if (path === '/api/changesets' && method === 'POST') {
    const session = await getSession(req);
    if (!session) return sendJson(res, 401, { error: 'sign in to propose changes' });
    let parsed: { summary?: string; edits: ProposedEdit[] };
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON' });
    }
    const result = await createChangeset(session.userId, parsed.edits ?? [], parsed.summary);
    if (result.errors) return sendJson(res, 422, { errors: result.errors });
    return sendJson(res, 201, { id: result.id });
  }

  // --- review ---
  if (path === '/review' && method === 'GET') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    return sendHtml(res, reviewPage(await listPending(), url.searchParams.get('m') ?? undefined));
  }
  const decide = path.match(/^\/review\/(\d+)\/(accept|reject)$/);
  if (decide && method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    const result = await decideChangeset(
      Number(decide[1]),
      session.userId,
      decide[2] === 'accept' ? 'accepted' : 'rejected',
    );
    const m = result.ok
      ? `Change #${decide[1]} ${decide[2]}ed.`
      : `Change #${decide[1]}: ${result.error}`;
    return redirect(res, `/review?m=${encodeURIComponent(m)}`);
  }

  // --- history ---
  const history = path.match(/^\/item\/([a-z0-9-]+)\/history$/);
  if (history) {
    const node = getNode(history[1]);
    if (!node) return notFound(res, history[1]);
    const session = await getSession(req);
    const rows = await pool.query(
      `select r.rev, r.created_at, r.summary, r.changeset_id, u.handle as author
       from revisions r join changesets c on c.id = r.changeset_id join users u on u.id = c.author_id
       where r.node_id = $1 order by r.rev desc`,
      [node.id],
    );
    const revisions: RevisionRow[] = rows.rows.map((r) => ({
      rev: Number(r.rev),
      author: r.author,
      createdAt: r.created_at.toISOString(),
      summary: r.summary ?? '',
      changesetId: Number(r.changeset_id),
    }));
    return sendHtml(res, historyPage(node, revisions, session?.role === 'admin'));
  }

  const oldRev = path.match(/^\/item\/([a-z0-9-]+)\/rev\/(\d+)$/);
  if (oldRev) {
    const node = getNode(oldRev[1]);
    if (!node) return notFound(res, oldRev[1]);
    const row = await pool.query('select data from revisions where node_id = $1 and rev = $2', [
      oldRev[1],
      Number(oldRev[2]),
    ]);
    if (row.rows.length === 0) return notFound(res, `r${oldRev[2]}`);
    const historical = { id: node.id, ...row.rows[0].data };
    return sendHtml(res, itemPage(historical, { asOfRev: Number(oldRev[2]) }));
  }

  const revert = path.match(/^\/item\/([a-z0-9-]+)\/revert\/(\d+)$/);
  if (revert && method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    const result = await revertNode(revert[1], Number(revert[2]), session.userId);
    if (!result.ok) return sendJson(res, 409, { error: result.error });
    return redirect(res, `/item/${revert[1]}/history`);
  }

  // --- read path ---
  const item = path.match(/^\/item\/([a-z0-9-]+)(\/?)$/);
  if (item) {
    const [, id, slash] = item;
    const node = getNode(id);
    if (!node) return notFound(res, id);
    if (!slash) return redirect(res, `/item/${id}/`);
    return sendHtml(res, itemPage(node));
  }

  if (path === '/') {
    return sendHtml(
      res,
      page({
        title: 'BOMwiki: the bill-of-materials encyclopedia',
        description: 'A public catalog of parts and the assemblies they roll up into.',
        path: '/',
        indexable: false,
        body: `<p>BOMwiki engine, milestone 2. ${nodeCount().toLocaleString()} items served from the database, ${totalCatalogParts.toLocaleString()} parts mapped. Try <a href="/item/ev-car/">the electric car</a>, or the <a href="/review">review queue</a>.</p>`,
      }),
    );
  }

  notFound(res);
}

const t0 = performance.now();
await loadGraph(DATABASE_URL);
console.log(
  `graph loaded: ${nodeCount().toLocaleString()} nodes, ${totalCatalogParts.toLocaleString()} catalog parts in ${Math.round(performance.now() - t0)}ms`,
);

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(`${req.method} ${req.url} failed:`, err);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.end();
    });
  })
  .listen(PORT, () => {
    console.log(`bomwiki engine listening on http://localhost:${PORT}`);
  });
