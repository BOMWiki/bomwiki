// Builds the transitive "where-used" index for the whole catalog in one pass
// over the in-memory graph, then persists it to the `where_used` table. Called
// from scripts/export-ffs.ts, which already loads the full graph via
// loadGraph()/allNodes(). This replaces the per-request ffsd traversal in
// graphdb.ts that re-scanned the catalog for every /item/ view.
//
// Correctness: "products whose build tree transitively contains X" is exactly
// the set of product ancestors of X in the HAS_PART DAG. We compute every
// node's product-ancestor set by memoized DFS up the reverse edges. The
// catalog is a DAG (self-loops are stripped upstream in buildgraph); a `seen`
// guard also makes any stray cycle safe.
import { allNodes, getNode, type NodeData } from './nodes.ts';
import { pool } from './db.ts';

export interface UsedInProducts {
  count: number;
  top: { id: string; name: string }[];
}

const TOP_N = 8;

/** Compute where-used for every non-product item. Returns a map keyed by item
 *  id. Products are omitted (they are never contained by anything). */
export function computeWhereUsed(): Map<string, UsedInProducts> {
  // Reverse adjacency: child id -> set of direct parent ids.
  const parents = new Map<string, Set<string>>();
  const nodes: NodeData[] = [];
  for (const node of allNodes()) {
    nodes.push(node);
    for (const line of node.bom ?? []) {
      let set = parents.get(line.id);
      if (!set) parents.set(line.id, (set = new Set()));
      set.add(node.id);
    }
  }

  // Memoized product-ancestor set for each node, built by DFS up the parents.
  const memo = new Map<string, Set<string>>();
  function productAncestors(id: string, stack: Set<string>): Set<string> {
    const cached = memo.get(id);
    if (cached) return cached;
    if (stack.has(id)) return new Set(); // cycle guard — should not happen
    stack.add(id);
    const acc = new Set<string>();
    for (const parentId of parents.get(id) ?? []) {
      if (getNode(parentId)?.kind === 'product') acc.add(parentId);
      for (const p of productAncestors(parentId, stack)) acc.add(p);
    }
    stack.delete(id);
    memo.set(id, acc);
    return acc;
  }

  const out = new Map<string, UsedInProducts>();
  for (const node of nodes) {
    if (node.kind === 'product') continue;
    const products = productAncestors(node.id, new Set());
    if (!products.size) continue;
    const top = [...products]
      .map((pid) => ({ id: pid, name: getNode(pid)?.name ?? pid }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, TOP_N);
    out.set(node.id, { count: products.size, top });
  }
  return out;
}

/** Recompute and replace the persisted where_used index. Idempotent: truncates
 *  and re-inserts inside one transaction, so readers see a consistent set. */
export async function persistWhereUsed(): Promise<number> {
  const index = computeWhereUsed();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('truncate where_used');
    // Batched multi-row inserts keep this to a handful of round-trips.
    const rows = [...index.entries()];
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const values: unknown[] = [];
      const tuples = slice.map(([id, v], j) => {
        const b = j * 3;
        values.push(id, v.count, JSON.stringify(v.top));
        return `($${b + 1}, $${b + 2}, $${b + 3}::jsonb)`;
      });
      await client.query(
        `insert into where_used (item_id, count, top) values ${tuples.join(', ')}`,
        values,
      );
    }
    await client.query('commit');
    return rows.length;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
