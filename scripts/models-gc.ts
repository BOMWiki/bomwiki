// Garbage-collect the model store. Three kinds of leftovers accumulate by
// design (uploads are registered before any submission exists, withdrawals
// delete the submission but not the file):
//   1. model_files rows no submission ever came to reference — dropped, with
//      their disk file, after a grace period.
//   2. stray files on disk with no model_files row (a crashed upload's
//      rename that won its race but lost the insert).
//   3. abandoned tmp/ streams.
// Run manually or from cron; safe to run while the engine is serving.
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/db.ts';
import { MODELS_DIR, modelFilePath } from '../src/models.ts';

const GRACE_DAYS = Number(process.env.MODELS_GC_GRACE_DAYS ?? 7);
const TMP_MAX_AGE_MS = 24 * 3_600_000;

let removed = 0;

// 1. Unreferenced model_files past the grace period.
const orphans = await pool.query(
  `delete from model_files f
   where not exists (select 1 from model_submissions s where s.sha256 = f.sha256)
     and f.created_at < now() - make_interval(days => $1)
   returning f.sha256, f.ext`,
  [GRACE_DAYS],
);
for (const row of orphans.rows) {
  await unlink(modelFilePath(row.sha256, row.ext)).catch(() => {});
  removed++;
  console.log(`removed unreferenced upload ${row.sha256}.${row.ext}`);
}

// 2. Disk files with no DB row (older than the grace period, so a file whose
// insert is in flight right now is never touched).
const filesDir = path.join(MODELS_DIR, 'files');
const known = new Set(
  (await pool.query('select sha256, ext from model_files')).rows.map(
    (r) => `${r.sha256}.${r.ext}`,
  ),
);
for (const name of await readdir(filesDir).catch(() => [] as string[])) {
  if (known.has(name)) continue;
  const p = path.join(filesDir, name);
  const st = await stat(p).catch(() => null);
  if (!st || Date.now() - st.mtimeMs < GRACE_DAYS * 24 * 3_600_000) continue;
  await unlink(p).catch(() => {});
  removed++;
  console.log(`removed stray file ${name}`);
}

// 3. Abandoned tmp streams.
const tmpDir = path.join(MODELS_DIR, 'tmp');
for (const name of await readdir(tmpDir).catch(() => [] as string[])) {
  const p = path.join(tmpDir, name);
  const st = await stat(p).catch(() => null);
  if (!st || Date.now() - st.mtimeMs < TMP_MAX_AGE_MS) continue;
  await unlink(p).catch(() => {});
  removed++;
  console.log(`removed abandoned tmp stream ${name}`);
}

console.log(`models-gc done: ${removed} file(s) removed`);
await pool.end();
