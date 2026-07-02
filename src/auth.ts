// Milestone-2 auth: one admin, logged in with a shared token from the
// environment. Milestone 3 replaces the login mechanism with email magic
// links; sessions and roles stay as they are.
import { randomBytes } from 'node:crypto';
import type http from 'node:http';
import { pool } from './db.ts';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin';
const ADMIN_HANDLE = process.env.ADMIN_HANDLE ?? 'sd';
const SESSION_DAYS = 30;

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
  const res = await pool.query(
    `select u.id, u.handle, u.role from sessions s join users u on u.id = s.user_id
     where s.token = $1 and s.expires_at > now()`,
    [token],
  );
  if (res.rows.length === 0) return null;
  return { userId: res.rows[0].id, handle: res.rows[0].handle, role: res.rows[0].role };
}

export async function logout(req: http.IncomingMessage): Promise<void> {
  const token = sessionCookie(req);
  if (token) await pool.query('delete from sessions where token = $1', [token]);
}

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface MagicLinkResult {
  link?: string;
  error?: string;
}

/** Signup or returning login: both produce a one-time magic link. In dev the
 *  link is surfaced directly; production (milestone 5) mails it instead. */
export async function requestMagicLink(email: string, handle?: string): Promise<MagicLinkResult> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) return { error: 'Enter a valid email address.' };

  const existing = await pool.query('select id from users where email = $1', [normalized]);
  let userId: number;
  if (existing.rows.length) {
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
  return { link: `/auth/${token}` };
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
