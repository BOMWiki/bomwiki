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
