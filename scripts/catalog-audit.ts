// One-time catalog audit through the bomwiki-intelligence sidecar: every
// product's subtree is analyzed; the report aggregates complexity
// candidates and function coverage. Writes markdown to stdout target path.
import { writeFileSync } from 'node:fs';
import { projectSubtree } from '../src/analysis.ts';
import { getNode, loadGraph, nodeCount } from '../src/nodes.ts';
import { pool } from '../src/db.ts';

const INTEL_URL = process.env.INTEL_URL ?? 'http://127.0.0.1:8799';
const OUT = process.argv[2] ?? 'reports/catalog-audit.md';
const CONCURRENCY = 8;

await loadGraph(process.env.DATABASE_URL ?? 'postgres:///bomwiki_dev');
const products = (await pool.query("select id from nodes where kind = 'product' order by pos")).rows.map(
  (r) => r.id as string,
);
await pool.end();
console.log(`auditing ${products.length} products over ${nodeCount().toLocaleString()} nodes`);

interface Candidate {
  productId: string;
  itemId: string;
  name: string;
  childCount: number;
  dominantFunction: string;
}

const candidates: Candidate[] = [];
const unknownByProduct = new Map<string, number>();
const functionTotals = new Map<string, number>();
let analyzed = 0;
let failed = 0;

async function auditOne(productId: string): Promise<void> {
  const root = getNode(productId);
  if (!root) return;
  const snapshot = projectSubtree(productId, new Map());
  try {
    const res = await fetch(`${INTEL_URL}/api/analyze?product=${encodeURIComponent(productId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: snapshot.items,
        products: [{ id: productId, name: root.name, root_item_id: productId }],
        bom_lines: snapshot.bom_lines,
      }),
    });
    if (!res.ok) {
      failed++;
      return;
    }
    const review = (await res.json()).bom_review;
    for (const c of review?.complexity_candidates ?? []) {
      candidates.push({
        productId,
        itemId: c.item_id,
        name: c.name,
        childCount: c.child_count,
        dominantFunction: c.dominant_function ?? 'unknown',
      });
    }
    const profile =
      review?.function_profile?.functions ?? review?.requirement_traceability?.function_profile ?? [];
    for (const f of profile) {
      functionTotals.set(f.function, (functionTotals.get(f.function) ?? 0) + (f.item_count ?? 0));
      if (f.function_id === 'unknown') {
        unknownByProduct.set(productId, f.item_count ?? 0);
      }
    }
    analyzed++;
  } catch {
    failed++;
  }
}

const queue = [...products];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const id = queue.shift()!;
      await auditOne(id);
      if ((analyzed + failed) % 500 === 0) console.log(`${analyzed + failed}/${products.length}`);
    }
  }),
);

const topCandidates = [...candidates].sort((a, b) => b.childCount - a.childCount).slice(0, 25);
const topUnknown = [...unknownByProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
const topFunctions = [...functionTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

const lines = [
  '# Catalog audit via bomwiki-intelligence',
  '',
  `Products analyzed: ${analyzed} of ${products.length} (${failed} failed).`,
  `Complexity candidates flagged: ${candidates.length}.`,
  `Products with unknown-function items: ${unknownByProduct.size}.`,
  '',
  '## Largest complexity candidates (integration/standardization prompts)',
  '',
  '| Item | Product | Direct children | Dominant function |',
  '|---|---|---|---|',
  ...topCandidates.map(
    (c) => `| ${c.name} (\`${c.itemId}\`) | \`${c.productId}\` | ${c.childCount} | ${c.dominantFunction} |`,
  ),
  '',
  '## Products with the most unknown-function items',
  '',
  '| Product | Unknown-function items |',
  '|---|---|',
  ...topUnknown.map(([id, n]) => `| ${getNode(id)?.name ?? id} (\`${id}\`) | ${n} |`),
  '',
  '## Function coverage across the catalog (item counts)',
  '',
  '| Function | Items |',
  '|---|---|',
  ...topFunctions.map(([f, n]) => `| ${f} | ${n.toLocaleString()} |`),
  '',
];

writeFileSync(OUT, lines.join('\n'));
console.log(`report -> ${OUT}`);
