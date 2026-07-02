// The BOMwiki engine server: plain node:http, no framework. Milestone 1
// serves the read path from Postgres; the write path (editing, review)
// arrives in milestone 2.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './html.ts';
import { getNode, loadGraph, nodeCount, totalCatalogParts } from './nodes.ts';
import { itemPage } from './render/item.ts';
import { page } from './render/base.ts';

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres:///bomwiki_dev';
const PORT = Number(process.env.PORT ?? 4400);

const STATIC_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function notFound(res: http.ServerResponse, id?: string): void {
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(
    page({
      title: 'Not found | BOMwiki',
      description: 'This page does not exist.',
      path: '/404',
      indexable: false,
      body: `<p>Nothing here${id ? ` for <code>${esc(id)}</code>` : ''}. <a href="/">Back to the catalog</a>.</p>`,
    }),
  );
}

const t0 = performance.now();
await loadGraph(DATABASE_URL);
console.log(
  `graph loaded: ${nodeCount().toLocaleString()} nodes, ${totalCatalogParts.toLocaleString()} catalog parts in ${Math.round(performance.now() - t0)}ms`,
);

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, nodes: nodeCount() }));
    return;
  }

  if (path.startsWith('/static/')) {
    const name = path.slice('/static/'.length);
    if (name.includes('..') || name.includes('/')) return notFound(res);
    const ext = name.slice(name.lastIndexOf('.'));
    const type = STATIC_TYPES[ext];
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

  const item = path.match(/^\/item\/([a-z0-9-]+)(\/?)$/);
  if (item) {
    const [, id, slash] = item;
    const node = getNode(id);
    if (!node) return notFound(res, id);
    if (!slash) {
      res.writeHead(301, { location: `/item/${id}/` });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(itemPage(node));
    return;
  }

  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      page({
        title: 'BOMwiki: the bill-of-materials encyclopedia',
        description: 'A public catalog of parts and the assemblies they roll up into.',
        path: '/',
        indexable: false,
        body: `<p>BOMwiki engine, milestone 1. ${nodeCount().toLocaleString()} items served from the database. Try <a href="/item/coffee-table/">the coffee table</a> or <a href="/item/ev-car/">the electric car</a>.</p>`,
      }),
    );
    return;
  }

  notFound(res);
});

server.listen(PORT, () => {
  console.log(`bomwiki engine listening on http://localhost:${PORT}`);
});
