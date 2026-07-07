// Optional graph sidecar: an FFS daemon (ffsd) holding the catalog as a
// property graph (Item nodes, HAS_PART edges), refreshed nightly from
// Postgres by scripts/export-ffs.ts. It serves traversals that need the
// whole graph at once, currently transitive where-used. Same contract as
// the analyzer sidecar: unreachable or slow means the feature is absent,
// never an error. Protocol: one "QUERY <cypher>" line over TCP, response
// framed as "OK query ..." / COLUMNS / ROW / END (see ffsd docs).
import net from 'node:net';
import { pool } from './db.ts';

const FFS_HOST = process.env.FFS_HOST ?? '127.0.0.1';
const FFS_PORT = Number(process.env.FFS_PORT ?? 8464);
const TIMEOUT_MS = Number(process.env.FFS_TIMEOUT_MS ?? 2500);
const MAX_DEPTH = 30;
// The graph refreshes nightly, so answers are stable for hours. A traversal
// over the whole catalog costs around a second on the production box; the
// cache means each part pays that once per engine restart, not per view.
const CACHE_TTL_MS = 6 * 3600_000;
const FAIL_TTL_MS = 60_000;
const CACHE_MAX = 20_000;

export type Row = Record<string, string | number | boolean | null>;

function parseWireValue(raw: string): string | number | boolean | null {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return raw;
    }
  }
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}

/** Run one Cypher query against ffsd. Resolves to rows, or null on any
 *  failure (down, timeout, parse error) — callers treat null as "no data". */
export function ffsQuery(cypher: string): Promise<Row[] | null> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: FFS_HOST, port: FFS_PORT });
    let buf = '';
    let done = false;
    const finish = (rows: Row[] | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(rows);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    sock.on('error', () => finish(null));
    sock.on('connect', () => sock.write(`QUERY ${cypher}\n`));
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (!buf.includes('\nEND\n') && !buf.includes('ERR ')) return;
      const rows: Row[] = [];
      for (const line of buf.split('\n')) {
        if (line.startsWith('ERR ')) return finish(null);
        if (!line.startsWith('ROW\t')) continue;
        const row: Row = {};
        for (const cell of line.slice(4).split('\t')) {
          const eq = cell.indexOf('=');
          if (eq > 0) row[cell.slice(0, eq)] = parseWireValue(cell.slice(eq + 1));
        }
        rows.push(row);
      }
      finish(rows);
    });
  });
}

export interface UsedInProducts {
  count: number;
  top: { id: string; name: string }[];
}

const cache = new Map<string, { at: number; ttl: number; v: UsedInProducts | null }>();

/** All products whose build tree transitively contains `id`. Ids are safe to
 *  interpolate: routes only match [A-Za-z0-9._-], enforced again here. */
export async function productsUsing(id: string): Promise<UsedInProducts | null> {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.v;

  // Fast path: read the materialized index built at export time
  // (scripts/export-ffs.ts -> where_used table). A single indexed lookup,
  // versus the full-catalog ffsd traversal below. If the row is absent
  // because the export hasn't run yet, fall through to the live traversal so
  // the feature still works on a fresh database.
  const wu = await whereUsedFromTable(id);
  if (wu !== undefined) {
    cache.set(id, { at: Date.now(), ttl: CACHE_TTL_MS, v: wu });
    return wu;
  }

  // Fallback traversal: fetch every distinct containing product and count here.
  // Even the most shared part in the catalog is in ~3,500 products, a
  // few hundred kilobytes on a loopback socket.
  const rows = await ffsQuery(
    `MATCH (a:Item)-[:HAS_PART*1..${MAX_DEPTH}]->(b:Item) WHERE b.id = '${id}' AND a.kind = 'product' RETURN DISTINCT a.id, a.name ORDER BY a.name`,
  );
  const v: UsedInProducts | null =
    rows && rows.length
      ? {
          count: rows.length,
          top: rows.slice(0, 8).map((r) => ({ id: String(r['a.id']), name: String(r['a.name']) })),
        }
      : null;
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(id, { at: Date.now(), ttl: rows === null ? FAIL_TTL_MS : CACHE_TTL_MS, v });
  return v;
}

// Whether the materialized index has been populated at least once. Cached for
// the process lifetime after the first successful read of a present table, so
// the common (post-export) case is a single-row lookup with no extra probe.
let whereUsedReady = false;

/** Read one item's where-used from the materialized table.
 *  Returns the value (possibly `null` for "in zero products") when the index
 *  is available, or `undefined` when it is not — table missing, empty, or the
 *  query failed — signalling the caller to fall back to the live traversal. */
async function whereUsedFromTable(id: string): Promise<UsedInProducts | null | undefined> {
  try {
    const res = await pool.query<{ count: number; top: { id: string; name: string }[] }>(
      'select count, top from where_used where item_id = $1',
      [id],
    );
    if (res.rows.length) {
      whereUsedReady = true;
      const r = res.rows[0];
      return { count: Number(r.count), top: r.top ?? [] };
    }
    // No row for this id. Only trust that as "zero products" once we know the
    // table has been populated; otherwise treat it as not-yet-available.
    if (whereUsedReady) return null;
    const any = await pool.query('select 1 from where_used limit 1');
    if (any.rows.length) {
      whereUsedReady = true;
      return null;
    }
    return undefined;
  } catch {
    // Table absent (pre-migration) or transient DB error — fall back to ffsd.
    return undefined;
  }
}
