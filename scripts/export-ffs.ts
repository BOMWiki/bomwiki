// Exports the live catalog graph as CSVs for the FFS graph sidecar and,
// unless --csv-only, loads them into a running ffsd via LOAD_NODES /
// LOAD_EDGES (upsert). A full refresh that also drops stale edges is done
// by deploy/ffs-refresh.sh, which rebuilds the database file from these
// CSVs and restarts the daemon.
//
// Usage: node scripts/export-ffs.ts [outDir] [--csv-only]
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { allNodes, loadGraph } from '../src/nodes.ts';
import { pool } from '../src/db.ts';

const outDir = resolve(process.argv[2] ?? 'reports/ffs-export');
const csvOnly = process.argv.includes('--csv-only');
const FFS_HOST = process.env.FFS_HOST ?? '127.0.0.1';
const FFS_PORT = Number(process.env.FFS_PORT ?? 8464);

function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function ffsCommand(line: string, timeoutMs = 600_000): Promise<string> {
  return new Promise((resolvep, reject) => {
    const sock = net.connect({ host: FFS_HOST, port: FFS_PORT });
    let buf = '';
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`ffsd timeout on: ${line.slice(0, 60)}`));
    }, timeoutMs);
    sock.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    sock.on('connect', () => sock.write(`${line}\n`));
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      // First line is the ready banner; the reply to our command follows.
      const lines = buf.split('\n').filter((l) => l && !l.startsWith('OK ffsd ready'));
      if (!lines.length) return;
      clearTimeout(timer);
      sock.destroy();
      if (lines[0].startsWith('ERR')) reject(new Error(lines[0]));
      else resolvep(lines[0]);
    });
  });
}

await loadGraph(process.env.DATABASE_URL ?? 'postgres:///bomwiki_dev');

mkdirSync(outDir, { recursive: true });
const nodeLines = ['id,name,kind'];
const edgeLines = ['parent_id,child_id,qty'];
for (const node of allNodes()) {
  nodeLines.push(`${csv(node.id)},${csv(node.name)},${node.kind}`);
  for (const line of node.bom ?? []) {
    edgeLines.push(`${csv(node.id)},${csv(line.id)},${line.qty}`);
  }
}
const nodesCsv = join(outDir, 'nodes.csv');
const edgesCsv = join(outDir, 'edges.csv');
writeFileSync(nodesCsv, nodeLines.join('\n') + '\n');
writeFileSync(edgesCsv, edgeLines.join('\n') + '\n');
console.log(`${nodeLines.length - 1} nodes, ${edgeLines.length - 1} edges -> ${outDir}`);

if (!csvOnly) {
  console.log(await ffsCommand(`LOAD_NODES Item id ${nodesCsv}`));
  console.log(await ffsCommand(`LOAD_EDGES HAS_PART Item id parent_id Item id child_id ${edgesCsv}`));
}

await pool.end();
