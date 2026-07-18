// Community email: the welcome note, changeset-decision and talk-reply
// notifications, and the weekly digest. Authentication mail (magic links)
// lives in mailer.ts and auth.ts; everything HERE is engagement mail, so
// every message respects per-user preferences, counts against a daily cap,
// and carries the same one-click unsubscribe. With the mailer unconfigured
// all of it is inert.
import { randomBytes } from 'node:crypto';
import { TRUST_POLICY } from './changesets.ts';
import { pool } from './db.ts';
import { mailerConfigured, sendEmail, SITE_ORIGIN } from './mailer.ts';
import { getNode } from './nodes.ts';

// A reply storm or a reviewer clearing a backlog must not become an email
// storm: notification mail (not the digest, not the welcome) stops for the
// day once this many have gone out to one person.
const MAX_NOTIFICATIONS_PER_DAY = 10;

const DIGEST_INTERVAL = "6 days 12 hours"; // weekly, with slack for the hour gate
const DIGEST_UTC_HOURS = [15, 16, 17]; // morning US, late afternoon EU
const TICK_MS = 15 * 60 * 1000;

interface Recipient {
  id: number;
  email: string;
  handle: string;
  token: string;
  digest: 'off' | 'weekly';
  notifyDecisions: boolean;
  notifyReplies: boolean;
}

/** Load a user as an email recipient; null when they cannot receive mail
 *  (no email, blocked, system account). Mints the unsubscribe token on
 *  first use; the guarded update keeps concurrent minters agreeing. */
async function recipient(userId: number): Promise<Recipient | null> {
  const res = await pool.query(
    `select id, email, handle, role, blocked, email_token, digest,
            notify_decisions, notify_replies
     from users where id = $1`,
    [userId],
  );
  const r = res.rows[0];
  if (!r || !r.email || r.blocked || r.role === 'system') return null;
  let token: string | null = r.email_token;
  if (!token) {
    const minted = randomBytes(24).toString('hex');
    const set = await pool.query(
      'update users set email_token = $2 where id = $1 and email_token is null',
      [userId, minted],
    );
    token = set.rowCount
      ? minted
      : (await pool.query('select email_token from users where id = $1', [userId])).rows[0]
          .email_token;
  }
  return {
    id: Number(r.id),
    email: r.email,
    handle: r.handle,
    token: token!,
    digest: r.digest,
    notifyDecisions: r.notify_decisions,
    notifyReplies: r.notify_replies,
  };
}

function footer(r: Recipient): string {
  return `

--
You get this email because you have a BOMwiki account.
Email preferences: ${SITE_ORIGIN}/settings
Unsubscribe from everything except sign-in links: ${SITE_ORIGIN}/email/unsubscribe/${r.token}`;
}

function unsubscribeHeaders(r: Recipient): Record<string, string> {
  return {
    'List-Unsubscribe': `<${SITE_ORIGIN}/email/unsubscribe/${r.token}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

async function underDailyCap(userId: number): Promise<boolean> {
  const res = await pool.query(
    `select count(*)::int as n from email_log
     where user_id = $1 and kind in ('decision', 'reply')
       and created_at > now() - interval '1 day'`,
    [userId],
  );
  return res.rows[0].n < MAX_NOTIFICATIONS_PER_DAY;
}

async function deliver(
  r: Recipient,
  kind: 'welcome' | 'decision' | 'reply' | 'digest',
  subject: string,
  body: string,
): Promise<boolean> {
  const ok = await sendEmail({
    to: r.email,
    subject,
    text: body + footer(r),
    headers: unsubscribeHeaders(r),
  });
  if (ok) await pool.query('insert into email_log (user_id, kind) values ($1, $2)', [r.id, kind]);
  return ok;
}

/** Turn off everything except sign-in links for the holder of a token.
 *  Returns the handle for the confirmation page, or null for a bad token. */
export async function unsubscribeByToken(token: string): Promise<string | null> {
  const res = await pool.query(
    `update users set digest = 'off', notify_decisions = false, notify_replies = false
     where email_token = $1 returning handle`,
    [token],
  );
  return res.rows.length ? res.rows[0].handle : null;
}

export interface EmailPrefs {
  digest: 'off' | 'weekly';
  notifyDecisions: boolean;
  notifyReplies: boolean;
  hasEmail: boolean;
}

export async function getEmailPrefs(userId: number): Promise<EmailPrefs> {
  const res = await pool.query(
    'select digest, notify_decisions, notify_replies, email from users where id = $1',
    [userId],
  );
  const r = res.rows[0];
  return {
    digest: r.digest,
    notifyDecisions: r.notify_decisions,
    notifyReplies: r.notify_replies,
    hasEmail: Boolean(r.email),
  };
}

export async function setEmailPrefs(
  userId: number,
  prefs: { digest: 'off' | 'weekly'; notifyDecisions: boolean; notifyReplies: boolean },
): Promise<void> {
  await pool.query(
    'update users set digest = $2, notify_decisions = $3, notify_replies = $4 where id = $1',
    [userId, prefs.digest, prefs.notifyDecisions, prefs.notifyReplies],
  );
}

/** First-sign-in welcome. Claims users.welcomed_at atomically, so repeated
 *  sign-ins and double-clicked magic links can never send it twice. */
export async function sendWelcome(userId: number): Promise<void> {
  if (!mailerConfigured()) return;
  const claim = await pool.query(
    'update users set welcomed_at = now() where id = $1 and welcomed_at is null',
    [userId],
  );
  if (!claim.rowCount) return;
  const r = await recipient(userId);
  if (!r) return;
  const body = `You have an account on BOMwiki, the openly editable encyclopedia of what things are made of.

What you can do now:

1. Fix something. Every page has an Edit button; if you already know the fix, make it. Your first edits go through review, and after ${TRUST_POLICY.autoconfirmEdits} accepted edits${TRUST_POLICY.autoconfirmDays > 0 ? ` plus ${TRUST_POLICY.autoconfirmDays} days on the site` : ''} your changes publish directly.
   ${SITE_ORIGIN}/help/editing

2. Watch pages you know. The Watch button on any page adds it to your watchlist, and changes to watched pages arrive in your weekly digest.
   ${SITE_ORIGIN}/watchlist

3. Say who you are. A display name, an affiliation, and a line of bio make your edits easier to trust.
   ${SITE_ORIGIN}/settings

Not sure where to start? Open a random page and check one quantity against something you own:
${SITE_ORIGIN}/random`;
  await deliver(r, 'welcome', `Welcome to BOMwiki, ${r.handle}`, body);
}

/** Tell an author their changeset was decided. Skipped for self-decided
 *  (autoconfirmed) changes, per preference, and past the daily cap. */
export async function notifyDecision(
  changesetId: number,
  decision: 'accepted' | 'rejected',
  reviewerId: number,
): Promise<void> {
  if (!mailerConfigured()) return;
  const cs = await pool.query(
    `select c.author_id, (select handle from users where id = $2) as reviewer
     from changesets c where c.id = $1`,
    [changesetId, reviewerId],
  );
  if (!cs.rows.length) return;
  const authorId = Number(cs.rows[0].author_id);
  if (authorId === reviewerId) return;
  const r = await recipient(authorId);
  if (!r || !r.notifyDecisions) return;
  if (!(await underDailyCap(r.id))) return;

  const edits = await pool.query(
    'select node_id, summary from changeset_edits where changeset_id = $1 order by id',
    [changesetId],
  );
  const lines = edits.rows
    .map((e) => {
      const name = getNode(e.node_id)?.name ?? e.node_id;
      const first = String(e.summary ?? '').split('\n')[0];
      return `- ${name}: ${first}\n  ${SITE_ORIGIN}/item/${e.node_id}/`;
    })
    .join('\n');

  if (decision === 'accepted') {
    const body = `Your change #${changesetId} was accepted by ${cs.rows[0].reviewer} and is live.

${lines}

Track your changes: ${SITE_ORIGIN}/user/${r.handle}`;
    await deliver(r, 'decision', 'Your BOMwiki change is live', body);
  } else {
    const body = `Your change #${changesetId} was reviewed by ${cs.rows[0].reviewer} and not accepted.

${lines}

A rejection usually means the reviewer could not confirm the change, not that it was unwelcome. If you have a source, raise it on the page's Discussion tab, or propose the change again with the evidence in the summary.

The change: ${SITE_ORIGIN}/changeset/${changesetId}`;
    await deliver(r, 'decision', `Your BOMwiki change #${changesetId} was not accepted`, body);
  }
}

/** Tell an uploader their 3D model submission was decided. Same rules as
 *  changeset decisions: self-decided (autoconfirmed) never notifies, and the
 *  per-day notification cap applies. */
export async function notifyModelDecision(
  submissionId: number,
  decision: 'accepted' | 'rejected',
  reviewerId: number,
): Promise<void> {
  if (!mailerConfigured()) return;
  const sub = await pool.query(
    `select s.uploader_id, s.node_id, s.kind,
            (select handle from users where id = $2) as reviewer
     from model_submissions s where s.id = $1`,
    [submissionId, reviewerId],
  );
  if (!sub.rows.length) return;
  const uploaderId = Number(sub.rows[0].uploader_id);
  if (uploaderId === reviewerId) return;
  const r = await recipient(uploaderId);
  if (!r || !r.notifyDecisions) return;
  if (!(await underDailyCap(r.id))) return;

  const nodeId: string = sub.rows[0].node_id;
  const name = getNode(nodeId)?.name ?? nodeId;
  const pageUrl = `${SITE_ORIGIN}/item/${nodeId}/`;
  if (decision === 'accepted') {
    const what =
      sub.rows[0].kind === 'display'
        ? `is live as the page's 3D view`
        : `is listed under the page's CAD source files`;
    await deliver(
      r,
      'decision',
      'Your BOMwiki 3D model is live',
      `Your 3D model for ${name} was accepted by ${sub.rows[0].reviewer} and ${what}.\n\n${pageUrl}`,
    );
  } else {
    await deliver(
      r,
      'decision',
      'Your BOMwiki 3D model was not accepted',
      `Your 3D model for ${name} was reviewed by ${sub.rows[0].reviewer} and not accepted.\n\nA rejection usually means the reviewer could not confirm the model matches the real thing, or the license situation was unclear. If you can add context, raise it on the page's Discussion tab and submit again.\n\n${pageUrl}`,
    );
  }
}

/** Tell a topic author someone replied. Self-replies never notify. */
export async function notifyReply(
  parentCommentId: number,
  replier: { userId: number; handle: string },
  subject: { title: string; talkPath: string },
  replyBody: string,
): Promise<void> {
  if (!mailerConfigured()) return;
  const parent = await pool.query('select author_id from comments where id = $1', [
    parentCommentId,
  ]);
  if (!parent.rows.length) return;
  const authorId = Number(parent.rows[0].author_id);
  if (authorId === replier.userId) return;
  const r = await recipient(authorId);
  if (!r || !r.notifyReplies) return;
  if (!(await underDailyCap(r.id))) return;

  const snippet = replyBody.length > 400 ? `${replyBody.slice(0, 397)}...` : replyBody;
  const body = `${replier.handle} replied to your topic in the discussion on ${subject.title}:

${snippet
  .split('\n')
  .map((l) => `> ${l}`)
  .join('\n')}

Continue the discussion: ${SITE_ORIGIN}${subject.talkPath}`;
  await deliver(r, 'reply', `${replier.handle} replied to you on "${subject.title}"`, body);
}

export interface Digest {
  subject: string;
  text: string;
}

/** Build one user's digest covering activity since `sinceIso`. Returns null
 *  when there is nothing worth sending (no personal activity and a quiet
 *  site); the caller still advances the clock so quiet weeks stay quiet. */
export async function buildDigest(userId: number, sinceIso: string): Promise<Digest | null> {
  const [userQ, watchQ, mineQ, siteQ, topQ, queueQ] = await Promise.all([
    pool.query('select handle, role from users where id = $1', [userId]),
    // One row per watched page, not per revision: a busy page is one line
    // ("5 changes by alice, sd"), not five.
    pool.query(
      `select r.node_id,
              count(*)::int as n,
              (array_agg(r.summary order by r.rev desc))[1] as latest,
              array_agg(distinct u.handle) as authors
       from watches w
       join revisions r on r.node_id = w.node_id
       join changesets c on c.id = r.changeset_id
       join users u on u.id = c.author_id
       where w.user_id = $1 and r.created_at > $2 and c.author_id <> $1
       group by r.node_id
       order by max(r.rev) desc limit 8`,
      [userId, sinceIso],
    ),
    pool.query(
      `select
         count(*) filter (where status = 'pending')::int as pending,
         count(*) filter (where status = 'accepted' and decided_at > $2)::int as accepted,
         count(*) filter (where status = 'rejected' and decided_at > $2)::int as rejected
       from changesets where author_id = $1`,
      [userId, sinceIso],
    ),
    pool.query(
      `select
         (select count(*)::int from changesets where status = 'accepted' and decided_at > $1) as edits,
         (select count(distinct author_id)::int from changesets where status = 'accepted' and decided_at > $1) as people,
         (select count(*)::int from users where created_at > $1 and role <> 'system') as joined`,
      [sinceIso],
    ),
    pool.query(
      `select node_id, count(*)::int as n from revisions
       where created_at > $1 group by node_id order by n desc limit 3`,
      [sinceIso],
    ),
    pool.query(`select count(*)::int as n from changesets where status = 'pending'`),
  ]);
  const user = userQ.rows[0];
  if (!user) return null;
  const watch = watchQ.rows;
  const mine = mineQ.rows[0];
  const site = siteQ.rows[0];
  const isReviewer = user.role === 'admin' || user.role === 'reviewer';
  const queue = Number(queueQ.rows[0].n);

  const personal = watch.length > 0 || mine.pending > 0 || mine.accepted > 0 || mine.rejected > 0;
  if (!personal && site.edits === 0 && !(isReviewer && queue > 0)) return null;

  const sections: string[] = [];

  if (watch.length) {
    sections.push(
      `PAGES YOU WATCH\n\n${watch
        .map((w) => {
          const name = getNode(w.node_id)?.name ?? w.node_id;
          const latest = String(w.latest ?? '').split('\n')[0] || 'edited';
          const all = w.authors as string[];
          const authors =
            all.length > 3 ? `${all.slice(0, 3).join(', ')} and ${all.length - 3} others` : all.join(', ');
          const what =
            w.n === 1 ? `${latest} (by ${authors})` : `${w.n} changes by ${authors}; latest: ${latest}`;
          return `- ${name}: ${what}\n  ${SITE_ORIGIN}/item/${w.node_id}/`;
        })
        .join('\n')}`,
    );
  }

  if (mine.pending || mine.accepted || mine.rejected) {
    const bits: string[] = [];
    if (mine.accepted) bits.push(`${mine.accepted} accepted this week`);
    if (mine.rejected) bits.push(`${mine.rejected} not accepted`);
    if (mine.pending) bits.push(`${mine.pending} waiting for review`);
    sections.push(`YOUR EDITS\n\n- ${bits.join(', ')}\n  ${SITE_ORIGIN}/user/${user.handle}`);
  }

  if (isReviewer && queue > 0) {
    sections.push(
      `REVIEW QUEUE\n\n- ${queue} ${queue === 1 ? 'change' : 'changes'} waiting for a reviewer\n  ${SITE_ORIGIN}/review`,
    );
  }

  if (site.edits > 0) {
    const busiest = topQ.rows
      .map((t) => getNode(t.node_id)?.name ?? t.node_id)
      .filter(Boolean)
      .join(', ');
    const pulse = [
      `- ${site.edits} accepted ${site.edits === 1 ? 'change' : 'changes'} by ${site.people} ${site.people === 1 ? 'person' : 'people'}`,
      site.joined > 0 ? `- ${site.joined} new ${site.joined === 1 ? 'member' : 'members'}` : '',
      busiest ? `- Busiest pages: ${busiest}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    sections.push(`AROUND THE SITE\n\n${pulse}`);
  }

  const subject = watch.length
    ? `${watch.length} ${watch.length === 1 ? 'page' : 'pages'} you watch changed on BOMwiki`
    : site.edits > 0
      ? `This week on BOMwiki: ${site.edits} ${site.edits === 1 ? 'change' : 'changes'} across the catalog`
      : 'Your BOMwiki week';

  const text = `Hi ${user.handle}, here is your BOMwiki week.

${sections.join('\n\n')}

Find something to fix: ${SITE_ORIGIN}/random`;
  return { subject, text };
}

/** Send every due weekly digest. The clock advances when a user is picked
 *  up, before the send: a failed or skipped digest is dropped, never
 *  duplicated. Exported so a smoke test or an operator can run one tick. */
export async function sendDueDigests(now = new Date()): Promise<number> {
  if (!mailerConfigured()) return 0;
  if (!DIGEST_UTC_HOURS.includes(now.getUTCHours())) return 0;
  const due = await pool.query(
    `with due as (
       select id, coalesce(digest_sent_at, created_at) as since from users
       where digest = 'weekly' and email is not null and not blocked and role <> 'system'
         and coalesce(digest_sent_at, created_at) < now() - interval '${DIGEST_INTERVAL}'
       for update skip locked
     )
     update users u set digest_sent_at = now() from due
     where u.id = due.id
     returning u.id, due.since`,
  );
  let sent = 0;
  for (const row of due.rows) {
    const r = await recipient(Number(row.id));
    if (!r || r.digest !== 'weekly') continue;
    const digest = await buildDigest(r.id, row.since.toISOString());
    if (!digest) continue;
    if (await deliver(r, 'digest', digest.subject, digest.text)) sent++;
  }
  if (due.rows.length) console.log(`digests: ${sent} sent of ${due.rows.length} due`);
  return sent;
}

/** Start the in-process digest clock. State lives in the database
 *  (users.digest_sent_at), so restarts and multiple ticks are harmless. */
export function startDigestTicker(): void {
  if (!mailerConfigured()) {
    console.log('digests: mailer unconfigured, ticker off');
    return;
  }
  const tick = () => void sendDueDigests().catch((err) => console.error('digest tick failed:', err));
  setInterval(tick, TICK_MS).unref();
  setTimeout(tick, 60 * 1000).unref();
}
