// Structural parity between the engine (port 4400) and the Astro site
// (port 4321) for a sample of nodes. Compares the content the engine claims
// to have ported: title, h1, breadcrumb links, BOM rows (find number, part
// id, qty, ext qty), and used-in chip ids. Sections the engine deliberately
// doesn't render yet (build graph, vendors, galleries, articles) are out of
// scope and tracked as known gaps.
const ASTRO = process.env.ASTRO_URL ?? 'http://localhost:4321';
const ENGINE = process.env.ENGINE_URL ?? 'http://localhost:4400';

const SAMPLE = process.argv.slice(2);
if (SAMPLE.length === 0) {
  console.error('usage: parity.ts <node-id> [...]');
  process.exit(2);
}

interface Extract {
  title: string;
  h1: string;
  trail: string[];
  bom: string[];
  usedIn: string[];
}

function extract(html: string): Extract {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  const h1 = (html.match(/<h1 class="wtitle"[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const trailBlock = html.match(/<nav class="trail"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
  const trail = [...trailBlock.matchAll(/href="\/item\/([a-z0-9-]+)\/"/g)].map((m) => m[1]);

  const bom: string[] = [];
  const rowRe = /<tr class="lvl(\d+)[^"]*"[^>]*>([\s\S]*?)<\/tr>/g;
  for (const m of html.matchAll(rowRe)) {
    const row = m[2];
    const num = row.match(/class="c-num bnum"[^>]*>([^<]*)</)?.[1]?.trim();
    const id = row.match(/class="c-pn mono"[^>]*>([^<]*)</)?.[1]?.trim();
    const qty = row.match(/class="num c-qty"[^>]*>([^<]*)</)?.[1]?.trim();
    const ext = row.match(/class="num c-ext"[^>]*>([^<]*)</)?.[1]?.trim();
    if (num && id) bom.push(`${num} ${id} ${qty} ${ext}`);
  }

  const usedBlock = html.match(/<section class="usedin"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? '';
  const usedIn = [...usedBlock.matchAll(/href="\/item\/([a-z0-9-]+)\/"/g)].map((m) => m[1]);
  return { title, h1, trail, bom, usedIn };
}

async function fetchPage(base: string, id: string): Promise<string> {
  const res = await fetch(`${base}/item/${id}/`);
  if (!res.ok) throw new Error(`${base}/item/${id}/ -> ${res.status}`);
  return res.text();
}

function diff(field: string, a: unknown, b: unknown): string | null {
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  return as === bs ? null : `  ${field}:\n    astro:  ${as.slice(0, 300)}\n    engine: ${bs.slice(0, 300)}`;
}

let failures = 0;
for (const id of SAMPLE) {
  const [astroHtml, engineHtml] = await Promise.all([
    fetchPage(ASTRO, id),
    fetchPage(ENGINE, id),
  ]);
  const a = extract(astroHtml);
  const e = extract(engineHtml);
  const problems = [
    diff('title', a.title, e.title),
    diff('h1', a.h1, e.h1),
    diff('trail', a.trail, e.trail),
    diff('bom-rows', a.bom, e.bom),
    diff('used-in', a.usedIn, e.usedIn),
  ].filter(Boolean);
  if (problems.length) {
    failures++;
    console.log(`FAIL ${id}`);
    for (const p of problems) console.log(p);
  } else {
    console.log(`ok   ${id} (${a.bom.length} bom rows, ${a.usedIn.length} used-in)`);
  }
}

process.exit(failures ? 1 : 0);
