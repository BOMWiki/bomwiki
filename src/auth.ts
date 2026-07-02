// Milestone-2 auth: one admin, logged in with a shared token from the
// environment. Milestone 3 replaces the login mechanism with email magic
// links; sessions and roles stay as they are.
import { randomBytes } from 'node:crypto';
import type http from 'node:http';
import { pool } from './db.ts';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin';
const ADMIN_HANDLE = process.env.ADMIN_HANDLE ?? 'sd';
const SESSION_DAYS = 30;

// Whether the magic link may be shown on-screen instead of emailed. This is
// ONLY safe in local development: rendering the link to whoever requested it
// is account takeover. Production must leave this off (no mailer is wired yet,
// so production sign-in via magic link is intentionally inert until one is).
const DEV_SHOW_MAGIC_LINK =
  process.env.DEV_SHOW_MAGIC_LINK === '1' ||
  (process.env.DEV_SHOW_MAGIC_LINK !== '0' && process.env.NODE_ENV !== 'production');

export interface Session {
  userId: number;
  handle: string;
  role: string;
}

export async function login(token: string): Promise<string | null> {
  if (token !== ADMIN_TOKEN) return null;
  const user = await pool.query(
    `insert into users (handle, role) values ($1, 'admin')
     on conflict (handle) do update set role = 'admin'
     returning id`,
    [ADMIN_HANDLE],
  );
  const session = randomBytes(32).toString('hex');
  await pool.query(
    `insert into sessions (token, user_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`,
    [session, user.rows[0].id],
  );
  return session;
}

export function sessionCookie(req: http.IncomingMessage): string | null {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === 'bw_sess' && v) return v;
  }
  return null;
}

export async function getSession(req: http.IncomingMessage): Promise<Session | null> {
  const token = sessionCookie(req);
  if (!token) return null;
  // Blocked accounts lose their sessions immediately, not at next login.
  const res = await pool.query(
    `select u.id, u.handle, u.role from sessions s join users u on u.id = s.user_id
     where s.token = $1 and s.expires_at > now() and not u.blocked`,
    [token],
  );
  if (res.rows.length === 0) return null;
  return { userId: Number(res.rows[0].id), handle: res.rows[0].handle, role: res.rows[0].role };
}

export async function logout(req: http.IncomingMessage): Promise<void> {
  const token = sessionCookie(req);
  if (token) await pool.query('delete from sessions where token = $1', [token]);
}

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface MagicLinkResult {
  // Present only when DEV_SHOW_MAGIC_LINK is on; never sent to the browser in
  // production, where the link must be delivered to the account's own inbox.
  devLink?: string;
  // True whenever a request was accepted (existing or newly created account).
  // The response to the user is identical either way so it can't be used to
  // probe which emails are registered.
  sent?: boolean;
  error?: string;
}

/** Signup or returning login: both produce a one-time magic link. In dev the
 *  link is surfaced directly; production mails it (mailer not yet wired). */
export async function requestMagicLink(email: string, handle?: string): Promise<MagicLinkResult> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) return { error: 'Enter a valid email address.' };

  const existing = await pool.query('select id, blocked from users where email = $1', [normalized]);
  let userId: number;
  if (existing.rows.length) {
    // A blocked account gets the same "sent" response as everyone else (no
    // probing which emails are blocked), but no link is created.
    if (existing.rows[0].blocked) return { sent: true };
    userId = existing.rows[0].id;
  } else {
    const wanted = (handle ?? '').trim().toLowerCase();
    if (!HANDLE_RE.test(wanted)) {
      return { error: 'Pick a handle: 3-30 characters, lowercase letters, digits, - or _.' };
    }
    const taken = await pool.query('select 1 from users where handle = $1', [wanted]);
    if (taken.rows.length) return { error: 'That handle is taken.' };
    const created = await pool.query(
      "insert into users (email, handle, role) values ($1, $2, 'contributor') returning id",
      [normalized, wanted],
    );
    userId = created.rows[0].id;
  }

  const token = randomBytes(24).toString('hex');
  await pool.query(
    "insert into magic_links (token, user_id, expires_at) values ($1, $2, now() + interval '30 minutes')",
    [token, userId],
  );
  const link = `/auth/${token}`;
  if (DEV_SHOW_MAGIC_LINK) return { sent: true, devLink: link };
  // Production: the link goes only to the account's own inbox, never back to
  // the caller. An unconfigured mailer means sign-in is inert, not leaky.
  const { sendMagicLinkEmail } = await import('./mailer.ts');
  await sendMagicLinkEmail(normalized, link);
  return { sent: true };
}

/** Complete a magic link: one-time use, creates a session. */
export async function verifyMagicLink(token: string): Promise<string | null> {
  const res = await pool.query(
    `update magic_links set used_at = now()
     where token = $1 and used_at is null and expires_at > now()
     returning user_id`,
    [token],
  );
  if (res.rows.length === 0) return null;
  const session = randomBytes(32).toString('hex');
  await pool.query(
    `insert into sessions (token, user_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`,
    [session, res.rows[0].user_id],
  );
  return session;
}
