// Community data: profiles, contributions, discussions, watches, and the
// site-wide recent-changes feed.
import { pool } from './db.ts';

export interface PublicUser {
  id: number;
  handle: string;
  role: string;
  displayName?: string;
  affiliation?: string;
  bio?: string;
  joined: string;
}

export interface ContributionStats {
  accepted: number;
  pending: number;
  rejected: number;
  nodesTouched: number;
}

export interface ChangeRow {
  id: number;
  author: string;
  status: string;
  createdAt: string;
  summary: string | null;
  edits: { nodeId: string; op: string; summary: string }[];
}

export interface Topic {
  id: number;
  author: string;
  body: string;
  resolved: boolean;
  createdAt: string;
  replies: { id: number; author: string; body: string; createdAt: string }[];
}

function mapUser(r: any): PublicUser {
  return {
    id: r.id,
    handle: r.handle,
    role: r.role,
    displayName: r.display_name ?? undefined,
    affiliation: r.affiliation ?? undefined,
    bio: r.bio ?? undefined,
    joined: r.created_at.toISOString(),
  };
}

export async function getUserByHandle(handle: string): Promise<PublicUser | null> {
  const res = await pool.query(
    'select id, handle, role, display_name, affiliation, bio, created_at from users where handle = $1',
    [handle],
  );
  return res.rows.length ? mapUser(res.rows[0]) : null;
}

export async function updateProfile(
  userId: number,
  fields: { displayName?: string; affiliation?: string; bio?: string },
): Promise<void> {
  await pool.query(
    'update users set display_name = $2, affiliation = $3, bio = $4 where id = $1',
    [userId, fields.displayName ?? null, fields.affiliation ?? null, fields.bio ?? null],
  );
}

export async function contributionStats(userId: number): Promise<ContributionStats> {
  const res = await pool.query(
    `select
       count(*) filter (where c.status = 'accepted')::int as accepted,
       count(*) filter (where c.status = 'pending')::int as pending,
       count(*) filter (where c.status = 'rejected')::int as rejected,
       count(distinct e.node_id) filter (where c.status = 'accepted')::int as nodes
     from changesets c join changeset_edits e on e.changeset_id = c.id
     where c.author_id = $1`,
    [userId],
  );
  const r = res.rows[0];
  return { accepted: r.accepted, pending: r.pending, rejected: r.rejected, nodesTouched: r.nodes };
}

async function changeRows(where: string, params: unknown[], limit: number): Promise<ChangeRow[]> {
  const res = await pool.query(
    `select c.id, u.handle as author, c.status, c.created_at, c.summary,
            json_agg(json_build_object('nodeId', e.node_id, 'op', e.op, 'summary', e.summary) order by e.id) as edits
     from changesets c
     join users u on u.id = c.author_id
     join changeset_edits e on e.changeset_id = c.id
     ${where}
     group by c.id, u.handle
     order by c.id desc
     limit ${limit}`,
    params,
  );
  return res.rows.map((r) => ({
    id: r.id,
    author: r.author,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    summary: r.summary,
    edits: r.edits,
  }));
}

export async function recentChanges(limit = 50): Promise<ChangeRow[]> {
  return changeRows("where c.status = 'accepted'", [], limit);
}

export async function contributionsOf(userId: number, limit = 50): Promise<ChangeRow[]> {
  return changeRows('where c.author_id = $1', [userId], limit);
}

export async function topicsFor(nodeId: string): Promise<Topic[]> {
  const res = await pool.query(
    `select c.id, c.parent_id, c.body, c.resolved, c.created_at, u.handle as author
     from comments c join users u on u.id = c.author_id
     where c.node_id = $1 order by c.id`,
    [nodeId],
  );
  const topics = new Map<number, Topic>();
  for (const r of res.rows) {
    if (r.parent_id === null) {
      topics.set(Number(r.id), {
        id: Number(r.id),
        author: r.author,
        body: r.body,
        resolved: r.resolved,
        createdAt: r.created_at.toISOString(),
        replies: [],
      });
    } else {
      topics.get(Number(r.parent_id))?.replies.push({
        id: Number(r.id),
        author: r.author,
        body: r.body,
        createdAt: r.created_at.toISOString(),
      });
    }
  }
  return [...topics.values()].reverse();
}

export async function addComment(
  nodeId: string,
  authorId: number,
  body: string,
  parentId?: number,
): Promise<{ error?: string }> {
  const text = body.trim();
  if (!text) return { error: 'empty comment' };
  if (text.length > 5000) return { error: 'comment too long' };
  if (parentId) {
    const parent = await pool.query(
      'select 1 from comments where id = $1 and node_id = $2 and parent_id is null',
      [parentId, nodeId],
    );
    if (!parent.rows.length) return { error: 'no such topic' };
  }
  await pool.query(
    'insert into comments (node_id, parent_id, author_id, body) values ($1, $2, $3, $4)',
    [nodeId, parentId ?? null, authorId, text],
  );
  return {};
}

export async function setTopicResolved(commentId: number, resolved: boolean): Promise<string | null> {
  const res = await pool.query(
    'update comments set resolved = $2 where id = $1 and parent_id is null returning node_id',
    [commentId, resolved],
  );
  return res.rows.length ? res.rows[0].node_id : null;
}

export async function toggleWatch(userId: number, nodeId: string): Promise<boolean> {
  const del = await pool.query('delete from watches where user_id = $1 and node_id = $2', [
    userId,
    nodeId,
  ]);
  if (del.rowCount) return false;
  await pool.query('insert into watches (user_id, node_id) values ($1, $2)', [userId, nodeId]);
  return true;
}

export async function isWatching(userId: number, nodeId: string): Promise<boolean> {
  const res = await pool.query('select 1 from watches where user_id = $1 and node_id = $2', [
    userId,
    nodeId,
  ]);
  return res.rows.length > 0;
}

export interface WatchEvent {
  nodeId: string;
  rev: number;
  author: string;
  createdAt: string;
  summary: string;
}

export async function watchlistFeed(userId: number, limit = 50): Promise<WatchEvent[]> {
  const res = await pool.query(
    `select r.node_id, r.rev, r.created_at, r.summary, u.handle as author
     from watches w
     join revisions r on r.node_id = w.node_id
     join changesets c on c.id = r.changeset_id
     join users u on u.id = c.author_id
     where w.user_id = $1
     order by r.rev desc limit ${limit}`,
    [userId],
  );
  return res.rows.map((r) => ({
    nodeId: r.node_id,
    rev: Number(r.rev),
    author: r.author,
    createdAt: r.created_at.toISOString(),
    summary: r.summary ?? '',
  }));
}
