// The 3D model layer: storage, format sniffing, and the submission lifecycle
// for user-contributed CAD files attached to item pages.
//
// Files are content-addressed (sha256) on disk under MODELS_DIR — never inside
// PUBLIC_DIR, which is read-only to the engine in production (ProtectSystem=
// strict + ReadOnlyPaths in the unit; prod sets MODELS_DIR via StateDirectory).
// The moderation state lives in Postgres (schema/0013_models.sql): a file is
// served publicly only while an accepted submission references its sha, so
// pending uploads are quarantined by a DB check at the serving route, not by
// moving files around.
//
// STL is the display format (rendered by the in-browser viewer); STEP,
// FreeCAD, and OpenSCAD files are accepted as downloadable source attachments.
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { open, rename, stat, unlink } from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAutoconfirmed } from './changesets.ts';
import { pool } from './db.ts';
import { getNode } from './nodes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MODELS_DIR = process.env.MODELS_DIR ?? path.join(here, '..', 'var', 'models');
const filesDir = path.join(MODELS_DIR, 'files');
const tmpDir = path.join(MODELS_DIR, 'tmp');
mkdirSync(filesDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

export type ModelExt = 'stl' | 'step' | 'fcstd' | 'scad';
export type ModelFormat = 'stl-binary' | 'stl-ascii' | 'step' | 'freecad' | 'openscad';

// 'stp' is accepted at upload and normalized to 'step' so one content hash
// can never exist under two names.
const EXT_ALIASES: Record<string, ModelExt> = {
  stl: 'stl',
  step: 'step',
  stp: 'step',
  fcstd: 'fcstd',
  scad: 'scad',
};

const SIZE_LIMITS: Record<ModelExt, number> = {
  stl: 50_000_000,
  step: 50_000_000,
  fcstd: 25_000_000,
  scad: 1_000_000,
};

// Above this the viewer becomes a tab-killer, not a reference drawing.
const MAX_TRIANGLES = 1_500_000;

export const MODEL_MIME: Record<ModelExt, string> = {
  stl: 'model/stl',
  step: 'application/step',
  fcstd: 'application/octet-stream',
  scad: 'application/octet-stream',
};

/** License deed links for credit lines; the keys are the only values the
 *  submit endpoint (and the DB check constraint) accept. */
export const MODEL_LICENSES: Record<string, { name: string; url: string }> = {
  CC0: { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  'CC-BY': { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
  'CC-BY-SA': { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
};

export function modelFilePath(sha256: string, ext: string): string {
  return path.join(filesDir, `${sha256}.${ext}`);
}

export type UploadResult =
  | { ok: true; sha256: string; bytes: number; format: ModelFormat; triangles: number | null }
  | { ok: false; status: number; code: string; message: string };

/** Stream an upload body to a temp file while hashing, sniff the format, and
 *  register the content-addressed file. The caller has already authenticated
 *  and rate-limited the request. */
export async function receiveUpload(
  req: http.IncomingMessage,
  extRaw: string,
  uploaderId: number,
): Promise<UploadResult> {
  const ext = EXT_ALIASES[extRaw.toLowerCase()];
  if (!ext) {
    return {
      ok: false,
      status: 422,
      code: 'bad_ext',
      message: 'Supported file types: .stl, .step, .stp, .FCStd, .scad.',
    };
  }
  const limit = SIZE_LIMITS[ext];
  const tmpPath = path.join(tmpDir, `${randomBytes(12).toString('hex')}.upload`);
  const hash = createHash('sha256');
  let bytes = 0;
  const out = createWriteStream(tmpPath, { flags: 'wx' });
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > limit) throw new Error('too_large');
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
    }
    await new Promise<void>((resolve, reject) => {
      out.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    out.destroy();
    await unlink(tmpPath).catch(() => {});
    if (err instanceof Error && err.message === 'too_large') {
      return {
        ok: false,
        status: 413,
        code: 'too_large',
        message: `File too large: the limit for .${ext} is ${Math.round(limit / 1_000_000)} MB.`,
      };
    }
    throw err;
  }

  const sniffed = await sniff(tmpPath, ext, bytes);
  if ('error' in sniffed) {
    await unlink(tmpPath).catch(() => {});
    return { ok: false, status: 422, code: 'bad_file', message: sniffed.error };
  }

  const sha256 = hash.digest('hex');
  const finalPath = modelFilePath(sha256, ext);
  // Content-addressed, so a name collision means the identical file is
  // already stored; the fresh temp copy is redundant either way.
  if (await stat(finalPath).then(() => true, () => false)) {
    await unlink(tmpPath).catch(() => {});
  } else {
    await rename(tmpPath, finalPath);
  }
  await pool.query(
    `insert into model_files (sha256, ext, format, bytes, triangles, uploader_id)
     values ($1, $2, $3, $4, $5, $6) on conflict (sha256) do nothing`,
    [sha256, ext, sniffed.format, bytes, sniffed.triangles, uploaderId],
  );
  return { ok: true, sha256, bytes, format: sniffed.format, triangles: sniffed.triangles };
}

type Sniffed = { format: ModelFormat; triangles: number | null } | { error: string };

async function sniff(tmpPath: string, ext: ModelExt, bytes: number): Promise<Sniffed> {
  const fh = await open(tmpPath, 'r');
  try {
    const headLen = Math.min(bytes, 4096);
    const head = Buffer.alloc(headLen);
    await fh.read(head, 0, headLen, 0);

    if (ext === 'stl') {
      // Binary first: many binary STLs begin their 80-byte header with the
      // word "solid", so the size equation, not the header text, decides.
      if (bytes >= 84) {
        const tri = head.readUInt32LE(80);
        if (bytes === 84 + 50 * tri) {
          if (tri === 0) return { error: 'This STL contains no triangles.' };
          if (tri > MAX_TRIANGLES) {
            return {
              error: `Model too detailed for the web viewer: ${tri.toLocaleString()} triangles (limit ${MAX_TRIANGLES.toLocaleString()}). Export a coarser mesh.`,
            };
          }
          return { format: 'stl-binary', triangles: tri };
        }
      }
      const headText = head.toString('latin1');
      if (/^\s*solid\b/.test(headText) && headText.includes('facet normal')) {
        const triangles = await countOccurrences(fh, bytes, 'endfacet');
        if (triangles === 0) return { error: 'This STL contains no triangles.' };
        if (triangles > MAX_TRIANGLES) {
          return {
            error: `Model too detailed for the web viewer: ${triangles.toLocaleString()} triangles (limit ${MAX_TRIANGLES.toLocaleString()}). Export a coarser mesh.`,
          };
        }
        return { format: 'stl-ascii', triangles };
      }
      return { error: 'Not a valid STL file (neither binary nor ASCII structure found).' };
    }

    if (ext === 'step') {
      const headText = head.toString('latin1');
      if (headText.includes('ISO-10303-21') && headText.includes('HEADER;')) {
        return { format: 'step', triangles: null };
      }
      return { error: 'Not a valid STEP file (missing ISO-10303-21 header).' };
    }

    if (ext === 'fcstd') {
      if (head.length >= 4 && head.readUInt32LE(0) === 0x04034b50) {
        return { format: 'freecad', triangles: null };
      }
      return { error: 'Not a valid FreeCAD file (not a zip archive).' };
    }

    // scad: plain text source, small cap, just refuse binary junk.
    const whole = Buffer.alloc(bytes);
    await fh.read(whole, 0, bytes, 0);
    if (whole.includes(0)) return { error: 'Not a valid OpenSCAD file (binary content).' };
    return { format: 'openscad', triangles: null };
  } finally {
    await fh.close();
  }
}

/** Count needle occurrences in a file without holding it in memory. */
async function countOccurrences(
  fh: Awaited<ReturnType<typeof open>>,
  bytes: number,
  needle: string,
): Promise<number> {
  const chunkSize = 1 << 20;
  const overlap = needle.length - 1;
  const buf = Buffer.alloc(chunkSize + overlap);
  let count = 0;
  let carry = '';
  for (let pos = 0; pos < bytes; pos += chunkSize) {
    const len = Math.min(chunkSize, bytes - pos);
    await fh.read(buf, 0, len, pos);
    const text = carry + buf.toString('latin1', 0, len);
    let i = -1;
    while ((i = text.indexOf(needle, i + 1)) !== -1) count++;
    carry = text.slice(-overlap);
    // Avoid double-counting matches fully inside the carry on the next round.
    if (carry.includes(needle)) carry = '';
  }
  return count;
}

// --- submissions -----------------------------------------------------------

const MAX_PENDING_MODELS = 5;
const MAX_MODELS_PER_HOUR = 10;
const MAX_MODELS_PER_HOUR_AUTOCONFIRMED = 30;

export interface SubmitInput {
  sha256?: unknown;
  nodeId?: unknown;
  license?: unknown;
  attribution?: unknown;
  attest?: unknown;
  note?: unknown;
}

export type SubmitResult = { errors: string[] } | { id: number; live: boolean };

/** Validate and create a model submission. Mirrors proposeChangeset's trust
 *  model: autoconfirmed submitters are accepted immediately with themselves
 *  as reviewer, everyone else lands in the review queue. */
export async function createSubmission(
  author: { userId: number; role: string },
  input: SubmitInput,
): Promise<SubmitResult> {
  const errors: string[] = [];
  const sha256 = typeof input.sha256 === 'string' ? input.sha256 : '';
  const nodeId = typeof input.nodeId === 'string' ? input.nodeId : '';
  const license = typeof input.license === 'string' ? input.license : '';
  const attribution = typeof input.attribution === 'string' ? input.attribution.trim() : '';
  const note = typeof input.note === 'string' ? input.note.trim() : '';

  if (!/^[a-f0-9]{64}$/.test(sha256)) errors.push('bad file reference');
  if (!getNode(nodeId)) errors.push(`unknown page: ${nodeId || '(missing)'}`);
  if (!MODEL_LICENSES[license]) errors.push('license must be CC0, CC-BY, or CC-BY-SA');
  if (!attribution) errors.push('attribution name is required');
  if (attribution.length > 120) errors.push('attribution is too long (120 characters max)');
  if (note.length > 2000) errors.push('note is too long (2000 characters max)');
  if (attribution.includes('\u0000') || note.includes('\u0000')) errors.push('text contains NUL');
  if (input.attest !== true) {
    errors.push('you must confirm this is your own work or that you may license it');
  }
  if (errors.length) return { errors };

  const fileQ = await pool.query(
    `select uploader_id, format,
            exists(select 1 from model_submissions where sha256 = $1 and status = 'accepted') as public
     from model_files where sha256 = $1`,
    [sha256],
  );
  if (!fileQ.rows.length) return { errors: ['file not found; upload it first'] };
  const file = fileQ.rows[0];
  if (Number(file.uploader_id) !== author.userId && !file.public) {
    return { errors: ['file not found; upload it first'] };
  }

  const privileged = author.role === 'admin' || author.role === 'reviewer';
  const autoconfirmed = await isAutoconfirmed(author.userId, author.role);
  if (!privileged) {
    const limits = await pool.query(
      `select count(*) filter (where status = 'pending')::int as pending,
              count(*) filter (where created_at > now() - interval '1 hour')::int as last_hour
       from model_submissions where uploader_id = $1`,
      [author.userId],
    );
    if (!autoconfirmed && limits.rows[0].pending >= MAX_PENDING_MODELS) {
      return { errors: ['you have too many models waiting for review; please wait for those first'] };
    }
    const hourly = autoconfirmed ? MAX_MODELS_PER_HOUR_AUTOCONFIRMED : MAX_MODELS_PER_HOUR;
    if (limits.rows[0].last_hour >= hourly) {
      return { errors: ['rate limit: too many model submissions in the last hour'] };
    }
  }

  const kind = String(file.format).startsWith('stl') ? 'display' : 'source';
  const ins = await pool.query(
    `insert into model_submissions (node_id, sha256, kind, license, attribution, note, uploader_id)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [nodeId, sha256, kind, license, attribution, note || null, author.userId],
  );
  const id = Number(ins.rows[0].id);
  if (autoconfirmed) {
    const decided = await decideSubmission(id, author.userId, 'accepted');
    return { id, live: decided.ok };
  }
  return { id, live: false };
}

export async function decideSubmission(
  id: number,
  reviewerId: number,
  decision: 'accepted' | 'rejected',
): Promise<{ ok: boolean; error?: string; nodeId?: string }> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const row = await client.query(
      'select node_id, kind from model_submissions where id = $1 and status = $2 for update',
      [id, 'pending'],
    );
    if (!row.rows.length) {
      await client.query('rollback');
      return { ok: false, error: 'not pending (already decided or withdrawn)' };
    }
    await client.query(
      'update model_submissions set status = $2, reviewer_id = $3, decided_at = now() where id = $1',
      [id, decision, reviewerId],
    );
    if (decision === 'accepted' && row.rows[0].kind === 'display') {
      await client.query(
        `insert into node_models (node_id, submission_id) values ($1, $2)
         on conflict (node_id) do update set submission_id = excluded.submission_id, updated_at = now()`,
        [row.rows[0].node_id, id],
      );
    }
    await client.query('commit');
    return { ok: true, nodeId: row.rows[0].node_id };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Uploader withdraws a pending submission. Deleting the row (rather than a
 *  status flip) keeps the queue clean; nothing references pending rows, and
 *  the orphaned file is left for the GC sweep. */
export async function withdrawSubmission(id: number, userId: number): Promise<string | null> {
  const res = await pool.query(
    `delete from model_submissions where id = $1 and uploader_id = $2 and status = 'pending'
     returning node_id`,
    [id, userId],
  );
  return res.rows.length ? res.rows[0].node_id : null;
}

export interface MyPendingModel {
  id: number;
  sha256: string;
  ext: string;
  kind: 'display' | 'source';
  license: string;
  createdAt: string;
}

/** The signed-in user's own queued submissions for one node, so the upload
 *  page can show them with withdraw buttons. */
export async function myPendingForNode(nodeId: string, userId: number): Promise<MyPendingModel[]> {
  const res = await pool.query(
    `select s.id, s.sha256, s.kind, s.license, s.created_at, f.ext
     from model_submissions s join model_files f on f.sha256 = s.sha256
     where s.node_id = $1 and s.uploader_id = $2 and s.status = 'pending'
     order by s.created_at desc`,
    [nodeId, userId],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    sha256: r.sha256,
    ext: r.ext,
    kind: r.kind,
    license: r.license,
    createdAt: r.created_at.toISOString(),
  }));
}

export interface PendingModel {
  id: number;
  nodeId: string;
  sha256: string;
  ext: string;
  format: string;
  bytes: number;
  triangles: number | null;
  kind: 'display' | 'source';
  license: string;
  attribution: string;
  note: string | null;
  uploader: string;
  createdAt: string;
}

export async function listPendingSubmissions(): Promise<PendingModel[]> {
  const res = await pool.query(
    `select s.id, s.node_id, s.sha256, s.kind, s.license, s.attribution, s.note, s.created_at,
            f.ext, f.format, f.bytes, f.triangles, u.handle as uploader
     from model_submissions s
     join model_files f on f.sha256 = s.sha256
     join users u on u.id = s.uploader_id
     where s.status = 'pending'
     order by s.created_at asc`,
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    nodeId: r.node_id,
    sha256: r.sha256,
    ext: r.ext,
    format: r.format,
    bytes: Number(r.bytes),
    triangles: r.triangles === null ? null : Number(r.triangles),
    kind: r.kind,
    license: r.license,
    attribution: r.attribution,
    note: r.note,
    uploader: r.uploader,
    createdAt: r.created_at.toISOString(),
  }));
}

export interface ItemModelFile {
  sha256: string;
  ext: string;
  format: string;
  bytes: number;
  triangles: number | null;
  license: string;
  attribution: string;
}

export interface ItemModel {
  display: ItemModelFile | null;
  sources: ItemModelFile[];
}

/** Everything the item page shows for one node: the current display model
 *  (if any) plus accepted source files, newest decision first. */
export async function modelForNode(nodeId: string): Promise<ItemModel | null> {
  const [displayQ, sourcesQ] = await Promise.all([
    pool.query(
      `select s.sha256, s.license, s.attribution, f.ext, f.format, f.bytes, f.triangles
       from node_models nm
       join model_submissions s on s.id = nm.submission_id
       join model_files f on f.sha256 = s.sha256
       where nm.node_id = $1`,
      [nodeId],
    ),
    pool.query(
      `select distinct on (s.sha256)
              s.sha256, s.license, s.attribution, f.ext, f.format, f.bytes, f.triangles
       from model_submissions s
       join model_files f on f.sha256 = s.sha256
       where s.node_id = $1 and s.status = 'accepted' and s.kind = 'source'
       order by s.sha256, s.decided_at desc`,
      [nodeId],
    ),
  ]);
  const toFile = (r: Record<string, unknown>): ItemModelFile => ({
    sha256: String(r.sha256),
    ext: String(r.ext),
    format: String(r.format),
    bytes: Number(r.bytes),
    triangles: r.triangles === null ? null : Number(r.triangles),
    license: String(r.license),
    attribution: String(r.attribution),
  });
  const display = displayQ.rows.length ? toFile(displayQ.rows[0]) : null;
  const sources = sourcesQ.rows.map(toFile);
  if (!display && sources.length === 0) return null;
  return { display, sources };
}

export type FileAccess = 'public' | 'private' | 'none';

/** Who may fetch a stored file: everyone once any accepted submission
 *  references it; before that only the uploader and reviewers (so they can
 *  preview the pending model). */
export async function fileAccess(
  sha256: string,
  viewer: { userId: number; role: string } | null,
): Promise<FileAccess> {
  const res = await pool.query(
    `select uploader_id,
            exists(select 1 from model_submissions where sha256 = $1 and status = 'accepted') as public
     from model_files where sha256 = $1`,
    [sha256],
  );
  if (!res.rows.length) return 'none';
  if (res.rows[0].public) return 'public';
  if (!viewer) return 'none';
  if (viewer.role === 'admin' || viewer.role === 'reviewer') return 'private';
  if (Number(res.rows[0].uploader_id) === viewer.userId) return 'private';
  return 'none';
}
