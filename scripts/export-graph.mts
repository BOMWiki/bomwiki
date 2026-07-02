// Dumps the current site's merged node graph to JSON for the importer.
// Runs with tsx because src/lib/tree.ts is TypeScript with JSON imports.
// This is the only place the engine touches the old data pipeline; once
// the database is the source of truth this script is retired.
import { writeFileSync } from 'node:fs';
// authoringNodes, not allNodes: the site derives parent order, breadcrumbs,
// and "used in" order from the authored array's insertion order, so the
// import must preserve exactly that order in the pos column.
import { authoringNodes } from '../../src/lib/tree';
import { CONTENT } from '../../src/data/content';

const out = authoringNodes.map((n) => {
  const content = CONTENT[n.id];
  return {
    id: n.id,
    name: n.n,
    kind: n.k,
    ...(n.d ? { domain: n.d } : {}),
    ...(n.s ? { summary: n.s } : {}),
    ...(n.std ? { standard: n.std } : {}),
    ...(n.mat ? { material: n.mat } : {}),
    ...(n.bom?.length
      ? { bom: n.bom.map(([id, qty, note]) => ({ id, qty, ...(note ? { note } : {}) })) }
      : {}),
    ...(content?.body ? { article: content.body } : {}),
    ...(content?.specs?.length ? { specs: content.specs } : {}),
  };
});

const path = process.argv[2] ?? '/tmp/bomwiki-graph-export.json';
writeFileSync(path, JSON.stringify(out));
console.log(`${out.length} nodes -> ${path}`);
