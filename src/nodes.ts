// The in-memory graph the server renders from: every node at its current
// revision, loaded once at boot. 192k nodes is ~100MB, which is fine; when
// edits land (milestone 2) the store updates in place from the accepted
// changeset instead of reloading.
import pg from 'pg';

export interface BomLine {
  id: string;
  qty: number;
  note?: string;
}

export interface NodeData {
  id: string;
  name: string;
  kind: 'product' | 'assembly' | 'part';
  domain?: string;
  summary?: string;
  standard?: string;
  material?: string;
  bom?: BomLine[];
}

export interface Child {
  node: NodeData;
  qty: number;
  note?: string;
}

export interface BomRow {
  num: string;
  level: number;
  node: NodeData;
  qty: number;
  ext: number;
  childLines: number;
  subtreeParts: number;
  hasMore: boolean;
}

const byId = new Map<string, NodeData>();
const parentsOf = new Map<string, NodeData[]>();
const partsMemo = new Map<string, number>();
const revOf = new Map<string, number>();
// Precomputed lowercased names so the per-keystroke search scan doesn't
// allocate 192k fresh strings every call.
const lowerName = new Map<string, string>();
let databaseUrlInUse = '';
export let totalCatalogParts = 0;

export function loadedDatabaseUrl(): string {
  return databaseUrlInUse;
}

/** Current revision number of a node (what an edit must be based on). */
export function currentRev(id: string): number | undefined {
  return revOf.get(id);
}

// All reloads run strictly one-at-a-time. Without this, two accepts could each
// fire a reload and the one whose query ran earlier could finish later,
// clobbering the newer snapshot with stale data. Serializing guarantees the
// last reload to start is the last to finish, so the in-memory graph always
// ends on the most recent committed state.
let graphLock: Promise<void> = Promise.resolve();

export function loadGraph(databaseUrl: string): Promise<void> {
  const run = graphLock.then(
    () => doLoadGraph(databaseUrl),
    () => doLoadGraph(databaseUrl),
  );
  graphLock = run.catch(() => {});
  return run;
}

async function doLoadGraph(databaseUrl: string): Promise<void> {
  databaseUrlInUse = databaseUrl;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const res = await client.query(
    'select n.id, n.current_rev, r.data from nodes n join revisions r on r.rev = n.current_rev where not n.deleted order by n.pos',
  );
  await client.end();

  byId.clear();
  parentsOf.clear();
  partsMemo.clear();
  revOf.clear();
  lowerName.clear();
  for (const row of res.rows) {
    byId.set(row.id, { id: row.id, ...row.data });
    revOf.set(row.id, Number(row.current_rev));
    lowerName.set(row.id, (row.data.name ?? '').toLowerCase());
  }
  for (const node of byId.values()) {
    for (const line of node.bom ?? []) {
      const list = parentsOf.get(line.id);
      if (list) list.push(node);
      else parentsOf.set(line.id, [node]);
    }
  }
  totalCatalogParts = 0;
  for (const node of byId.values()) {
    if (node.kind === 'product') totalCatalogParts += totalParts(node.id);
  }
}

export interface AppliedEdit {
  nodeId: string;
  op: 'edit' | 'create';
  rev: number;
  data: Omit<NodeData, 'id'>;
}

/** Apply accepted edits to the in-memory graph in place — no full reload.
 *  Synchronous, so requests never observe a half-applied state. Node objects
 *  are mutated (not replaced) to keep every reference in parentsOf valid.
 *  Part-count memos are invalidated up the ancestor chain only, and the
 *  headline total is re-summed from memos (cheap: untouched products hit
 *  their memo). */
export function applyAcceptedEdits(edits: AppliedEdit[]): void {
  for (const e of edits) {
    const oldBom = byId.get(e.nodeId)?.bom ?? [];
    let node = byId.get(e.nodeId);
    if (!node) {
      node = { id: e.nodeId, ...e.data };
      byId.set(e.nodeId, node);
    } else {
      const mutable = node as unknown as Record<string, unknown>;
      for (const key of Object.keys(node)) {
        if (key !== 'id' && !(key in e.data)) delete mutable[key];
      }
      Object.assign(node, e.data);
    }
    revOf.set(e.nodeId, e.rev);
    lowerName.set(e.nodeId, (e.data.name ?? '').toLowerCase());

    // Reconcile the reverse index for edges this edit added or removed.
    const newIds = new Set((e.data.bom ?? []).map((l) => l.id));
    const oldIds = new Set(oldBom.map((l) => l.id));
    for (const childId of oldIds) {
      if (newIds.has(childId)) continue;
      const list = parentsOf.get(childId);
      if (list) {
        const i = list.findIndex((p) => p.id === e.nodeId);
        if (i >= 0) list.splice(i, 1);
      }
    }
    for (const childId of newIds) {
      if (oldIds.has(childId)) continue;
      const list = parentsOf.get(childId);
      if (list) {
        if (!list.some((p) => p.id === e.nodeId)) list.push(node);
      } else {
        parentsOf.set(childId, [node]);
      }
    }

    // Part counts change for this node and everything above it.
    const invalid = [e.nodeId];
    const seen = new Set<string>();
    while (invalid.length) {
      const id = invalid.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      partsMemo.delete(id);
      for (const parent of parentsOf.get(id) ?? []) invalid.push(parent.id);
    }
  }

  totalCatalogParts = 0;
  for (const node of byId.values()) {
    if (node.kind === 'product') totalCatalogParts += totalParts(node.id);
  }
}

export function nodeCount(): number {
  return byId.size;
}

export function getNode(id: string): NodeData | undefined {
  return byId.get(id);
}

export interface SearchHit {
  id: string;
  name: string;
  kind: string;
  usedIn: number;
}

/** Substring search over names and ids for the part picker. Prefix matches
 *  rank first, then more-used parts. Linear scan of the in-memory graph —
 *  a few milliseconds at 192k nodes, fine until it isn't. */
export function searchNodes(q: string, limit = 8): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const hits: (SearchHit & { rank: number })[] = [];
  for (const node of byId.values()) {
    const name = lowerName.get(node.id) ?? node.name.toLowerCase();
    let rank = -1;
    if (name.startsWith(needle)) rank = 0;
    else if (name.includes(needle)) rank = 1;
    else if (node.id.includes(needle)) rank = 2;
    if (rank < 0) continue;
    hits.push({ id: node.id, name: node.name, kind: node.kind, usedIn: parents(node.id).length, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || b.usedIn - a.usedIn || a.name.localeCompare(b.name));
  return hits.slice(0, limit).map(({ rank, ...h }) => h);
}

/** Products in a domain, alphabetical by name (matches the site's rail). */
export function productsByDomain(slug: string): NodeData[] {
  const out: NodeData[] = [];
  for (const node of byId.values()) {
    if (node.kind === 'product' && node.domain === slug) out.push(node);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function children(id: string): Child[] {
  const node = byId.get(id);
  if (!node?.bom) return [];
  return node.bom
    .filter((line) => byId.has(line.id))
    .map((line) => ({ node: byId.get(line.id)!, qty: line.qty, note: line.note }));
}

export function lineCount(id: string): number {
  return byId.get(id)?.bom?.length ?? 0;
}

/** Total atomic parts under a node, multiplied through quantities. Memoized.
 *  The write path guarantees a DAG (validateEdits rejects cycles at accept),
 *  so the stack guard is a last-resort against corruption. A total computed
 *  while the guard truncated a descendant is NOT memoized, so a stray cycle
 *  can never poison the cache with an order-dependent wrong count. */
export function totalParts(id: string, stack = new Set<string>()): number {
  const memo = partsMemo.get(id);
  if (memo !== undefined) return memo;
  const node = byId.get(id);
  if (!node) return 0;
  if (!node.bom || node.bom.length === 0) return 1;
  if (stack.has(id)) {
    truncatedByCycle = true;
    return 0;
  }
  stack.add(id);
  const outerTruncated = truncatedByCycle;
  truncatedByCycle = false;
  let total = 0;
  for (const line of node.bom) total += line.qty * totalParts(line.id, stack);
  stack.delete(id);
  if (!truncatedByCycle) partsMemo.set(id, total);
  truncatedByCycle = truncatedByCycle || outerTruncated;
  return total;
}
let truncatedByCycle = false;

export function parents(id: string): NodeData[] {
  return parentsOf.get(id) ?? [];
}

/** Breadcrumb chain from a product down to this node (product first). */
export function primaryPath(id: string): NodeData[] {
  const path: NodeData[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    if (cur.kind === 'product') break;
    const ps = parentsOf.get(cur.id);
    cur = ps?.find((p) => p.kind === 'product') ?? ps?.[0];
  }
  return path;
}

/** Flatten the BOM into an indented, find-numbered table to a fixed depth. */
export function flattenBom(id: string, maxDepth = 3): BomRow[] {
  const rows: BomRow[] = [];
  const walk = (pid: string, level: number, prefix: string, parentExt: number) => {
    const lines = byId.get(pid)?.bom ?? [];
    lines.forEach((line, i) => {
      const node = byId.get(line.id);
      if (!node) return;
      const num = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      const ext = parentExt * line.qty;
      const childLines = lineCount(line.id);
      const deeper = childLines > 0;
      rows.push({
        num,
        level,
        node,
        qty: line.qty,
        ext,
        childLines,
        subtreeParts: totalParts(line.id),
        hasMore: deeper && level >= maxDepth,
      });
      if (deeper && level < maxDepth) walk(line.id, level + 1, num, ext);
    });
  };
  walk(id, 1, '', 1);
  return rows;
}
