// Build the data for the interactive Cytoscape build/assembly graph: the BOM as a
// node-link DAG (shared sub-assemblies are one node with converging edges), each
// node carrying its role, part count, labour estimate and a link to its page,
// plus dashed links to related products. The page renders/lays it out client-side
// with expand/collapse. Ported from the static site's src/lib/buildgraph.ts.
import { children, getNode, nodeCount, productList, totalParts, type NodeData } from './nodes.ts';

const MAX_NODES = 600;

// ---------------------------------------------------------------------------
// Product-containment index. The static site precomputed this at module load;
// here the graph is mutable (edits land in place), so the index is built
// lazily and rebuilt whenever the node count changes. That misses edits that
// only rewire BOM lines without adding/removing nodes, which is acceptable
// staleness for "shared across products" shading and related-product links.
// ---------------------------------------------------------------------------
let indexedAt = -1;
// product id -> set of node ids anywhere in its build subtree (excluding itself)
let productNodes = new Map<string, Set<string>>();
// node id -> product ids whose subtree contains it
let nodeProducts = new Map<string, string[]>();

function ensureIndex(): void {
  if (indexedAt === nodeCount()) return;
  productNodes = new Map();
  nodeProducts = new Map();
  for (const p of productList()) {
    const set = new Set<string>();
    const seen = new Set<string>();
    const stack = [p.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const line of getNode(id)?.bom ?? []) {
        set.add(line.id);
        stack.push(line.id);
      }
    }
    productNodes.set(p.id, set);
  }
  for (const [pid, set] of productNodes) {
    for (const nid of set) {
      const list = nodeProducts.get(nid);
      if (list) list.push(pid);
      else nodeProducts.set(nid, [pid]);
    }
  }
  indexedAt = nodeCount();
}

/** Products whose build tree contains this node. */
function productsUsing(id: string): NodeData[] {
  ensureIndex();
  const out: NodeData[] = [];
  for (const pid of nodeProducts.get(id) ?? []) {
    const p = getNode(pid);
    if (p) out.push(p);
  }
  return out;
}

/** Other products that share the most components with this product. */
function relatedProducts(productId: string, limit = 5): { node: NodeData; shared: number }[] {
  ensureIndex();
  const mine = productNodes.get(productId);
  if (!mine) return [];
  const out: { node: NodeData; shared: number }[] = [];
  for (const [pid, set] of productNodes) {
    if (pid === productId) continue;
    let c = 0;
    for (const x of mine) if (set.has(x)) c++;
    const node = getNode(pid);
    if (c > 0 && node) out.push({ node, shared: c });
  }
  return out.sort((a, b) => b.shared - a.shared).slice(0, limit);
}

function labourHours(id: string): number {
  const h = 0.3 + totalParts(id) * 0.01;
  return h >= 10 ? Math.round(h) : Math.round(h * 10) / 10;
}

export interface GraphData {
  root: string;
  related: string[];
  nodes: { data: Record<string, unknown> }[];
  edges: { data: Record<string, unknown> }[];
}

export function buildGraphData(root: NodeData): GraphData {
  const nodes: GraphData['nodes'] = [];
  const edges: GraphData['edges'] = [];
  const seen = new Set<string>();
  let truncated = false;

  const kindOf = (n: NodeData) => {
    if (n.id === root.id) return 'root';
    if (n.kind === 'part') return 'part';
    return productsUsing(n.id).length > 1 ? 'shared' : 'asm';
  };
  const addNode = (n: NodeData) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    const expandable = (n.bom?.length ?? 0) > 0;
    const meta =
      n.kind === 'part' ? 'part' : `${totalParts(n.id).toLocaleString()} parts · ~${labourHours(n.id)}h`;
    nodes.push({
      data: {
        id: n.id,
        name: n.name,
        meta,
        label: `${n.name}\n${meta}`,
        kind: kindOf(n),
        url: `/item/${n.id}`,
        expandable: expandable ? '1' : '0',
      },
    });
  };

  addNode(root);
  // BFS over the whole reachable graph (capped). Collapse is done client-side.
  const queue = [root.id];
  while (queue.length) {
    const pid = queue.shift()!;
    children(pid).forEach(({ node: c, qty }, i) => {
      const isNew = !seen.has(c.id);
      if (isNew && seen.size >= MAX_NODES) {
        truncated = true;
        return;
      }
      addNode(c);
      edges.push({ data: { id: `${pid}__${c.id}__${i}`, source: pid, target: c.id, qtyLabel: `×${qty}` } });
      if (isNew && (c.bom?.length ?? 0) > 0) queue.push(c.id);
    });
  }

  // Related products (dashed, always visible).
  const related: string[] = [];
  const rel =
    root.kind === 'product'
      ? relatedProducts(root.id, 5)
      : productsUsing(root.id)
          .filter((p) => p.id !== root.id)
          .slice(0, 5)
          .map((node) => ({ node, shared: 0 }));
  for (const r of rel) {
    const rid = `rel:${r.node.id}`;
    related.push(rid);
    nodes.push({
      data: { id: rid, name: r.node.name, meta: 'product', label: r.node.name, kind: 'other', url: `/item/${r.node.id}`, expandable: '0' },
    });
    edges.push({
      data: { id: `rel__${r.node.id}`, source: root.id, target: rid, rel: root.kind === 'product' ? `shares ${r.shared}` : 'used by' },
    });
  }

  if (truncated) {
    nodes.push({
      data: { id: 'trunc', name: '… more', meta: 'graph capped', label: '… more (capped)', kind: 'part', url: `/item/${root.id}`, expandable: '0' },
    });
  }

  return { root: root.id, related, nodes, edges };
}
