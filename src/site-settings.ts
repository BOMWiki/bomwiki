// Curated site content: small keyed JSON documents with attribution.
// Currently: the homepage's featured pool and did-you-know facts.
import { pool } from './db.ts';

const cache = new Map<string, { value: unknown; at: number }>();
const TTL_MS = 60_000;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const res = await pool.query('select value from site_settings where key = $1', [key]);
  const value = res.rows.length ? (res.rows[0].value as T) : fallback;
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function setSetting(key: string, value: unknown, userId: number): Promise<void> {
  await pool.query(
    `insert into site_settings (key, value, updated_by) values ($1, $2, $3)
     on conflict (key) do update set value = $2, updated_by = $3, updated_at = now()`,
    [key, JSON.stringify(value), userId],
  );
  cache.delete(key);
}

export async function settingMeta(
  key: string,
): Promise<{ updatedBy: string; updatedAt: string } | null> {
  const res = await pool.query(
    `select u.handle, s.updated_at from site_settings s join users u on u.id = s.updated_by
     where s.key = $1`,
    [key],
  );
  if (!res.rows.length) return null;
  return { updatedBy: res.rows[0].handle, updatedAt: res.rows[0].updated_at.toISOString() };
}

export async function stewardBotId(): Promise<number> {
  const res = await pool.query("select id from users where handle = 'steward-bot'");
  return Number(res.rows[0].id);
}
