// The BOMwiki engine server: plain node:http, no framework. Read path from
// the in-memory graph; write path (propose -> review -> apply) from
// milestone 2. Auth is a single admin session until milestone 3.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getSession,
  login,
  logout,
  requestMagicLink,
  verifyMagicLink,
  type Session,
} from './auth.ts';
import {
  decideChangeset,
  isAutoconfirmed,
  listPending,
  massRevert,
  proposeChangeset,
  revertNode,
  type ProposedEdit,
} from './changesets.ts';
import {
  addComment,
  contributionsOf,
  contributionStats,
  getUserByHandle,
  recentChanges,
  setBlocked,
  setRole,
  setTopicResolved,
  toggleWatch,
  topicsFor,
  updateProfile,
  watchlistFeed,
} from './community.ts';
import {
  changesPage,
  profilePage,
  settingsPage,
  signinPage,
  talkPage,
  watchlistPage,
} from './render/community.ts';
import { pool } from './db.ts';
import { esc } from './html.ts';
import {
  getNode,
  loadGraph,
  nodeCount,
  searchNodes,
  setVerificationInMemory,
  totalCatalogParts,
  type Verification,
} from './nodes.ts';
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

// Read pages carry no per-session HTML (session-aware chrome is filled in by a
// client fetch), so they are identical for every visitor and safe to cache at
// the edge. Short TTL + stale-while-revalidate keeps edits appearing quickly
// while letting a CDN absorb read traffic instead of the single Node process.
function sendCacheableHtml(res: http.ServerResponse, body: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=60, stale-while-revalidate=86400',
  });
  res.end(body);
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

async function requireUser(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<Session | null> {
  const session = await getSession(req);
  if (!session) {
    redirect(res, '/login');
    return null;
  }
  return session;
}

async function requireReviewer(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<Session | null> {
  const session = await getSession(req);
  if (!session || (session.role !== 'admin' && session.role !== 'reviewer')) {
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
  const setSessionAndGo = (token: string, to: string) => {
    res.writeHead(303, {
      'set-cookie': `bw_sess=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`,
      location: to,
    });
    res.end();
  };
  if ((path === '/login' || path === '/signup') && method === 'GET') {
    return sendHtml(res, signinPage());
  }
  if (path === '/login' && method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    const token = await login(body.get('token') ?? '');
    if (!token) return sendHtml(res, signinPage({ error: 'Wrong token.' }), 403);
    return setSessionAndGo(token, '/review');
  }
  if (path === '/auth/request' && method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    const result = await requestMagicLink(body.get('email') ?? '', body.get('handle') ?? undefined);
    if (result.error) return sendHtml(res, signinPage({ error: result.error }), 422);
    return sendHtml(res, signinPage({ sent: true, devLink: result.devLink }));
  }
  const magic = path.match(/^\/auth\/([a-f0-9]{48})$/);
  if (magic && method === 'GET') {
    const token = await verifyMagicLink(magic[1]);
    if (!token) return sendHtml(res, signinPage({ error: 'That link is expired or already used.' }), 403);
    return setSessionAndGo(token, '/');
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
    const raw = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(raw) ? Math.min(50, Math.max(1, raw)) : 8;
    return sendJson(res, 200, searchNodes(q, limit));
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
    const result = await proposeChangeset(
      { userId: session.userId, role: session.role },
      parsed.edits ?? [],
      parsed.summary,
    );
    if (result.errors) return sendJson(res, 422, { errors: result.errors });
    return sendJson(res, 201, {
      id: result.id,
      applied: result.applied,
      ...(result.applyError ? { applyError: result.applyError } : {}),
    });
  }

  // --- review ---
  if (path === '/review' && method === 'GET') {
    const session = await requireReviewer(req, res);
    if (!session) return;
    return sendHtml(res, reviewPage(await listPending(), url.searchParams.get('m') ?? undefined));
  }
  const decide = path.match(/^\/review\/(\d+)\/(accept|reject)$/);
  if (decide && method === 'POST') {
    const session = await requireReviewer(req, res);
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
  const history = path.match(/^\/item\/([A-Za-z0-9._-]+)\/history$/);
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

  const oldRev = path.match(/^\/item\/([A-Za-z0-9._-]+)\/rev\/(\d+)$/);
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

  const revert = path.match(/^\/item\/([A-Za-z0-9._-]+)\/revert\/(\d+)$/);
  if (revert && method === 'POST') {
    const session = await requireReviewer(req, res);
    if (!session) return;
    const result = await revertNode(revert[1], Number(revert[2]), session.userId);
    if (!result.ok) return sendJson(res, 409, { error: result.error });
    return redirect(res, `/item/${revert[1]}/history`);
  }

  // --- community ---
  if (path === '/changes') return sendHtml(res, changesPage(await recentChanges()));

  const profile = path.match(/^\/user\/([a-z0-9_-]+)$/);
  if (profile && method === 'GET') {
    const user = await getUserByHandle(profile[1]);
    if (!user) return notFound(res, profile[1]);
    const session = await getSession(req);
    return sendHtml(
      res,
      profilePage(user, await contributionStats(user.id), await contributionsOf(user.id), {
        adminView: session?.role === 'admin',
        notice: url.searchParams.get('m') ?? undefined,
      }),
    );
  }

  // --- admin moderation actions ---
  const modAction = path.match(/^\/admin\/user\/([a-z0-9_-]+)\/(block|unblock|make-reviewer|make-contributor|mass-revert)$/);
  if (modAction && method === 'POST') {
    const session = await getSession(req);
    if (!session || session.role !== 'admin') return redirect(res, '/login');
    const target = await getUserByHandle(modAction[1]);
    if (!target) return notFound(res, modAction[1]);
    if (target.role === 'admin' || target.role === 'system') {
      return redirect(res, `/user/${target.handle}?m=${encodeURIComponent('Admins cannot be moderated from here.')}`);
    }
    let message = '';
    switch (modAction[2]) {
      case 'block':
        await setBlocked(target.id, true);
        message = 'Account blocked; sessions ended, pending changes rejected.';
        break;
      case 'unblock':
        await setBlocked(target.id, false);
        message = 'Account unblocked.';
        break;
      case 'make-reviewer':
        await setRole(target.id, 'reviewer');
        message = 'Promoted to reviewer.';
        break;
      case 'make-contributor':
        await setRole(target.id, 'contributor');
        message = 'Set to contributor.';
        break;
      case 'mass-revert': {
        const result = await massRevert(target.id, session.userId);
        message = `Mass revert: ${result.reverted.length} page(s) restored${result.skipped.length ? `, ${result.skipped.length} skipped (no earlier revision by someone else)` : ''}.`;
        break;
      }
    }
    return redirect(res, `/user/${target.handle}?m=${encodeURIComponent(message)}`);
  }

  if (path === '/settings') {
    const session = await requireUser(req, res);
    if (!session) return;
    if (method === 'POST') {
      const body = new URLSearchParams(await readBody(req));
      await updateProfile(session.userId, {
        displayName: body.get('displayName')?.trim().slice(0, 60) || undefined,
        affiliation: body.get('affiliation')?.trim().slice(0, 120) || undefined,
        bio: body.get('bio')?.trim().slice(0, 1000) || undefined,
      });
      return redirect(res, '/settings?saved=1');
    }
    const user = await getUserByHandle(session.handle);
    return sendHtml(res, settingsPage(user!, url.searchParams.has('saved')));
  }

  const talk = path.match(/^\/item\/([A-Za-z0-9._-]+)\/talk$/);
  if (talk) {
    const node = getNode(talk[1]);
    if (!node) return notFound(res, talk[1]);
    const session = await getSession(req);
    if (method === 'POST') {
      if (!session) return redirect(res, '/login');
      const body = new URLSearchParams(await readBody(req));
      const parentRaw = body.get('parent_id');
      let parentId: number | undefined;
      if (parentRaw) {
        parentId = Number.parseInt(parentRaw, 10);
        if (!Number.isInteger(parentId)) return sendJson(res, 422, { error: 'invalid parent_id' });
      }
      const trusted = await isAutoconfirmed(session.userId, session.role);
      const result = await addComment(
        node.id,
        session.userId,
        body.get('body') ?? '',
        parentId,
        trusted,
      );
      if (result.error) return sendJson(res, 422, result);
      return redirect(res, `/item/${node.id}/talk`);
    }
    const canModerate = session?.role === 'admin' || session?.role === 'reviewer';
    return sendHtml(res, talkPage(node, await topicsFor(node.id), Boolean(session), canModerate));
  }

  const resolve = path.match(/^\/talk\/(\d+)\/resolve$/);
  if (resolve && method === 'POST') {
    const session = await requireReviewer(req, res);
    if (!session) return;
    const nodeId = await setTopicResolved(Number(resolve[1]), true);
    if (!nodeId) return notFound(res);
    return redirect(res, `/item/${nodeId}/talk`);
  }

  const verify = path.match(/^\/item\/([A-Za-z0-9._-]+)\/verify$/);
  if (verify && method === 'POST') {
    const session = await requireReviewer(req, res);
    if (!session) return;
    const node = getNode(verify[1]);
    if (!node) return notFound(res, verify[1]);
    const body = new URLSearchParams(await readBody(req));
    const status = body.get('status') ?? '';
    if (!['unverified', 'machine-checked', 'human-verified'].includes(status)) {
      return sendJson(res, 422, { error: 'invalid status' });
    }
    await pool.query('update nodes set verification = $2 where id = $1', [node.id, status]);
    await pool.query(
      'insert into verification_events (node_id, status, user_id, note) values ($1, $2, $3, $4)',
      [node.id, status, session.userId, body.get('note')?.trim().slice(0, 500) || null],
    );
    setVerificationInMemory(node.id, status as Verification);
    return redirect(res, `/item/${node.id}/`);
  }

  const watch = path.match(/^\/item\/([A-Za-z0-9._-]+)\/watch$/);
  if (watch && method === 'POST') {
    const session = await requireUser(req, res);
    if (!session) return;
    if (!getNode(watch[1])) return notFound(res, watch[1]);
    await toggleWatch(session.userId, watch[1]);
    return redirect(res, `/item/${watch[1]}/`);
  }

  if (path === '/watchlist') {
    const session = await requireUser(req, res);
    if (!session) return;
    return sendHtml(res, watchlistPage(await watchlistFeed(session.userId)));
  }

  // --- read path ---
  const item = path.match(/^\/item\/([A-Za-z0-9._-]+)(\/?)$/);
  if (item) {
    const [, id, slash] = item;
    const node = getNode(id);
    if (!node) return notFound(res, id);
    if (!slash) return redirect(res, `/item/${id}/`);
    return sendCacheableHtml(res, itemPage(node));
  }

  if (path === '/') {
    return sendHtml(
      res,
      page({
        title: 'BOMwiki: the bill-of-materials encyclopedia',
        description: 'A public catalog of parts and the assemblies they roll up into.',
        path: '/',
        indexable: false,
        body: `<p>BOMwiki engine. ${nodeCount().toLocaleString()} items served from the database, ${totalCatalogParts.toLocaleString()} parts mapped. Try <a href="/item/ev-car/">the electric car</a>, the <a href="/changes">recent changes</a>, or the <a href="/review">review queue</a>.</p>`,
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
