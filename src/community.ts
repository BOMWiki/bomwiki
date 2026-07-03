// Community data: profiles, contributions, discussions, watches, and the
// site-wide recent-changes feed.
import { pool } from './db.ts';
import { hasNul } from './html.ts';

export interface PublicUser {
  id: number;
  handle: string;
  role: string;
  blocked: boolean;
  displayName?: string;
  affiliation?: string;
  bio?: string;
  website?: string;
  /** Self-authored user page, markdown with [[wiki-links]]. */
  profileMd?: string;
  joined: string;
}

export interface ContributionStats {
  accepted: number;
  pending: number;
  rejected: number;
  nodesTouched: number;
}

/** The rest of a person's public footprint: discussions, review work, and
 *  when they were last active anywhere (edit or comment). */
export interface ProfileExtras {
  comments: number;
  reviews: number;
  verifications: number;
  lastActive: string | null;
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
    id: Number(r.id),
    handle: r.handle,
    role: r.role,
    blocked: Boolean(r.blocked),
    displayName: r.display_name ?? undefined,
    affiliation: r.affiliation ?? undefined,
    bio: r.bio ?? undefined,
    website: r.website ?? undefined,
    profileMd: r.profile_md ?? undefined,
    joined: r.created_at.toISOString(),
  };
}

export async function getUserByHandle(handle: string): Promise<PublicUser | null> {
  const res = await pool.query(
    'select id, handle, role, blocked, display_name, affiliation, bio, website, profile_md, created_at from users where handle = $1',
    [handle],
  );
  return res.rows.length ? mapUser(res.rows[0]) : null;
}

/** Save the self-authored user page; empty clears it. */
export async function setProfilePage(userId: number, md: string | null): Promise<void> {
  await pool.query('update users set profile_md = $2 where id = $1', [userId, md]);
}

/** Block or unblock an account. Blocking kills its sessions and pending
 *  changesets in one motion; unblocking restores nothing automatically. */
export async function setBlocked(userId: number, blocked: boolean): Promise<void> {
  await pool.query('update users set blocked = $2 where id = $1', [userId, blocked]);
  if (blocked) {
    await pool.query('delete from sessions where user_id = $1', [userId]);
    await pool.query(
      "update changesets set status = 'rejected', decided_at = now() where author_id = $1 and status = 'pending'",
      [userId],
    );
  }
}

export async function setRole(
  userId: number,
  role: 'contributor' | 'reviewer' | 'admin',
): Promise<void> {
  await pool.query("update users set role = $2 where id = $1 and role <> 'system'", [userId, role]);
}

export async function isBlocked(userId: number): Promise<boolean> {
  const res = await pool.query('select blocked from users where id = $1', [userId]);
  return Boolean(res.rows[0]?.blocked);
}

export async function updateProfile(
  userId: number,
  fields: { displayName?: string; affiliation?: string; bio?: string; website?: string },
): Promise<void> {
  await pool.query(
    'update users set display_name = $2, affiliation = $3, bio = $4, website = $5 where id = $1',
    [
      userId,
      fields.displayName ?? null,
      fields.affiliation ?? null,
      fields.bio ?? null,
      fields.website ?? null,
    ],
  );
}

export async function profileExtras(userId: number): Promise<ProfileExtras> {
  const res = await pool.query(
    `select
       (select count(*)::int from comments where author_id = $1) as comments,
       (select count(*)::int from changesets
          where reviewer_id = $1 and author_id <> $1 and status <> 'pending') as reviews,
       (select count(*)::int from verification_events where user_id = $1) as verifications,
       greatest(
         (select max(created_at) from changesets where author_id = $1),
         (select max(created_at) from comments where author_id = $1)
       ) as last_active`,
    [userId],
  );
  const r = res.rows[0];
  return {
    comments: r.comments,
    reviews: r.reviews,
    verifications: r.verifications,
    lastActive: r.last_active ? r.last_active.toISOString() : null,
  };
}

export interface ContributorRow {
  handle: string;
  displayName?: string;
  role: string;
  joined: string;
  accepted: number;
  lastActive: string | null;
}

/** Everyone with at least one accepted edit, most productive first, plus
 *  reviewers and admins even before their first edit. Backs /contributors. */
export async function listContributors(limit = 100): Promise<ContributorRow[]> {
  const res = await pool.query(
    `select u.handle, u.display_name, u.role, u.created_at,
            count(c.id) filter (where c.status = 'accepted')::int as accepted,
            max(c.created_at) as last_active
     from users u
     left join changesets c on c.author_id = u.id
     where u.role <> 'system' and not u.blocked
     group by u.id
     having count(c.id) filter (where c.status = 'accepted') > 0
        or u.role in ('reviewer', 'admin')
     order by accepted desc, u.created_at asc
     limit ${limit}`,
  );
  return res.rows.map((r) => ({
    handle: r.handle,
    displayName: r.display_name ?? undefined,
    role: r.role,
    joined: r.created_at.toISOString(),
    accepted: r.accepted,
    lastActive: r.last_active ? r.last_active.toISOString() : null,
  }));
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
    id: Number(r.id),
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

const MAX_COMMENTS_PER_HOUR = 10;
const MAX_COMMENTS_PER_HOUR_TRUSTED = 60;
const MAX_LINKS_UNTRUSTED = 2;

/** Live comment limits, exported for the /policies page. */
export const COMMENT_POLICY = {
  hourlyNew: MAX_COMMENTS_PER_HOUR,
  hourlyTrusted: MAX_COMMENTS_PER_HOUR_TRUSTED,
  linksUntrusted: MAX_LINKS_UNTRUSTED,
};

export async function addComment(
  nodeId: string,
  authorId: number,
  body: string,
  parentId: number | undefined,
  trusted: boolean,
): Promise<{ error?: string }> {
  const text = body.trim();
  if (!text) return { error: 'empty comment' };
  if (text.length > 5000) return { error: 'comment too long' };
  if (hasNul(text)) return { error: 'comment may not contain null bytes' };
  // Link caps and rate limits: discussions publish instantly, so they are the
  // natural first target for link spam. New accounts get tight caps.
  if (!trusted) {
    const links = text.match(/https?:\/\//gi)?.length ?? 0;
    if (links > MAX_LINKS_UNTRUSTED) {
      return { error: `new accounts may include at most ${MAX_LINKS_UNTRUSTED} links per comment` };
    }
  }
  const recent = await pool.query(
    "select count(*)::int as c from comments where author_id = $1 and created_at > now() - interval '1 hour'",
    [authorId],
  );
  if (recent.rows[0].c >= (trusted ? MAX_COMMENTS_PER_HOUR_TRUSTED : MAX_COMMENTS_PER_HOUR)) {
    return { error: 'rate limit: too many comments in the last hour' };
  }
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
