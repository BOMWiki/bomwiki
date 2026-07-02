// Cleanup triage over the imported catalog: score every product by signals
// that correlate with generated-and-wrong content, write a ranked worklist,
// and bulk-mark the cleanest pages 'machine-checked' (never 'human-verified'
// — that word is reserved for people).
//
// Signals (each 0..1, weighted):
//   boilerplate  — the product's summaries repeat pan-catalog stock phrasing
//   cloneShape   — its BOM shape (child count sequence) is shared by many
//                  other products, a mass-generation tell
//   qtyOutliers  — quantities far outside the catalog's distribution
//   fnUnknown    — sidecar: share of items mapping to no known function
//   fnMismatch   — sidecar: dominant function disagrees with product kind
import { writeFileSync } from 'node:fs';
import { projectSubtree } from '../src/analysis.ts';
import { pool } from '../src/db.ts';
import { getNode, loadGraph, type NodeData } from '../src/nodes.ts';

const INTEL_URL = process.env.INTEL_URL ?? 'http://127.0.0.1:8799';
const OUT = process.argv[2] ?? 'reports/cleanup-worklist.md';
const MARK_CLEAN = process.argv.includes('--mark-clean');
const CONCURRENCY = 8;

await loadGraph(process.env.DATABASE_URL ?? 'postgres:///bomwiki_dev');
const products = (
  await pool.query("select id from nodes where kind = 'product' and not deleted order by pos")
).rows.map((r) => r.id as string);

// --- catalog-wide baselines ---
const summaryCount = new Map<string, number>();
const shapeCount = new Map<string, number>();
const qtys: number[] = [];

function subtreeNodes(rootId: string): NodeData[] {
  const seen = new Set<string>();
  const out: NodeData[] = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = getNode(id);
    if (!node) continue;
    out.push(node);
    for (const line of node.bom ?? []) queue.push(line.id);
  }
  return out;
}

function shapeOf(rootId: string): string {
  // The child-count sequence of the top two levels, a cheap structural hash.
  const root = getNode(rootId);
  const counts = (root?.bom ?? []).map((l) => getNode(l.id)?.bom?.length ?? 0);
  return `${root?.bom?.length ?? 0}:${counts.join(',')}`;
}

for (const id of products) {
  shapeCount.set(shapeOf(id), (shapeCount.get(shapeOf(id)) ?? 0) + 1);
  for (const node of subtreeNodes(id)) {
    if (node.summary) {
      const key = node.summary.toLowerCase().replace(/\d+/g, '#');
      summaryCount.set(key, (summaryCount.get(key) ?? 0) + 1);
    }
    for (const line of node.bom ?? []) qtys.push(line.qty);
  }
}
qtys.sort((a, b) => a - b);
const q99 = qtys[Math.floor(qtys.length * 0.99)] ?? 1000;

interface Score {
  id: string;
  name: string;
  total: number;
  parts: Record<string, number>;
}

const scores: Score[] = [];
let done = 0;

async function scoreProduct(id: string): Promise<void> {
  const root = getNode(id);
  if (!root) return;
  const nodes = subtreeNodes(id);

  const withSummary = nodes.filter((n) => n.summary);
  const boilerplate = withSummary.length
    ? withSummary.filter(
        (n) => (summaryCount.get(n.summary!.toLowerCase().replace(/\d+/g, '#')) ?? 0) >= 5,
      ).length / withSummary.length
    : 0.5; // no summaries at all is itself a mild signal

  const clones = shapeCount.get(shapeOf(id)) ?? 1;
  const cloneShape = clones >= 10 ? 1 : clones >= 4 ? 0.6 : clones >= 2 ? 0.3 : 0;

  let lines = 0;
  let outliers = 0;
  for (const n of nodes) {
    for (const l of n.bom ?? []) {
      lines++;
      if (l.qty > q99) outliers++;
    }
  }
  const qtyOutliers = lines ? Math.min(1, (outliers / lines) * 10) : 0;

  let fnUnknown = 0;
  let fnMismatch = 0;
  try {
    const snapshot = projectSubtree(id, new Map());
    const res = await fetch(`${INTEL_URL}/api/analyze?product=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: snapshot.items,
        products: [{ id, name: root.name, root_item_id: id }],
        bom_lines: snapshot.bom_lines,
      }),
    });
    if (res.ok) {
      const review = (await res.json()).bom_review;
      const profile =
        review?.function_profile?.functions ??
        review?.requirement_traceability?.function_profile ??
        [];
      const totalItems = profile.reduce((s: number, f: any) => s + (f.item_count ?? 0), 0);
      const unknown = profile.find((f: any) => f.function_id === 'unknown');
      fnUnknown = totalItems ? (unknown?.item_count ?? 0) / totalItems : 0;
      const dominant = profile[0]?.function_id ?? '';
      // Weak heuristic on purpose: only flag the flagrant case where a
      // powered product profile shows zero energy/motion functions.
      const powered = /motor|engine|electric|battery|powered|machine/i.test(root.name);
      const hasPower = profile.some((f: any) => /energy|motion|convert/i.test(f.function_id ?? ''));
      fnMismatch = powered && profile.length > 0 && !hasPower ? 1 : 0;
      void dominant;
    }
  } catch {
    // Sidecar down: structural signals still stand.
  }

  const parts = { boilerplate, cloneShape, qtyOutliers, fnUnknown, fnMismatch };
  const total =
    boilerplate * 0.3 + cloneShape * 0.25 + qtyOutliers * 0.15 + fnUnknown * 0.2 + fnMismatch * 0.1;
  scores.push({ id, name: root.name, total, parts });
  done++;
  if (done % 500 === 0) console.log(`${done}/${products.length}`);
}

const queue = [...products];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await scoreProduct(queue.shift()!);
  }),
);

scores.sort((a, b) => b.total - a.total);
const worst = scores.slice(0, 50);
const cleanest = scores.filter((s) => s.total < 0.15);

const fmt = (n: number) => n.toFixed(2);
writeFileSync(
  OUT,
  [
    '# Cleanup worklist (suspicion-ranked)',
    '',
    `Scored ${scores.length} products. Signals: boilerplate summaries, cloned BOM shapes, quantity outliers, unknown-function share, function/kind mismatch.`,
    `Cleanest tier (score < 0.15): ${cleanest.length} products${MARK_CLEAN ? ' — marked machine-checked' : ''}.`,
    '',
    '| # | Product | Score | boiler | clone | qty | fn? | mismatch |',
    '|---|---|---|---|---|---|---|---|',
    ...worst.map(
      (s, i) =>
        `| ${i + 1} | ${s.name} (\`${s.id}\`) | ${fmt(s.total)} | ${fmt(s.parts.boilerplate)} | ${fmt(s.parts.cloneShape)} | ${fmt(s.parts.qtyOutliers)} | ${fmt(s.parts.fnUnknown)} | ${fmt(s.parts.fnMismatch)} |`,
    ),
    '',
  ].join('\n'),
);
console.log(`worklist -> ${OUT} (worst: ${worst[0]?.name} @ ${fmt(worst[0]?.total ?? 0)})`);

if (MARK_CLEAN && cleanest.length) {
  await pool.query(
    "update nodes set verification = 'machine-checked' where id = any($1::text[]) and verification = 'unverified'",
    [cleanest.map((s) => s.id)],
  );
  console.log(`marked ${cleanest.length} cleanest products machine-checked`);
}
await pool.end();
