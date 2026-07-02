// Photo resolution, ported from src/lib/images.ts. Real photos come from
// Wikimedia Commons, self-hosted under PUBLIC_DIR/img with 240px thumbs.
// The mapping file and the public assets still live in the old site's tree;
// both paths are configurable so production can point anywhere.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NodeData } from './nodes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.resolve(
  process.env.PUBLIC_DIR ?? path.join(here, '..', '..', 'public'),
);
const IMAGES_JSON = process.env.IMAGES_JSON ?? path.join(here, '..', '..', 'src', 'data', 'images.json');

export interface ItemImage {
  url: string;
  title: string;
  page?: string;
  local?: string;
  thumb?: string;
  key?: string;
  exact?: boolean;
}

const IMAGES: Record<string, ItemImage> = existsSync(IMAGES_JSON)
  ? JSON.parse(readFileSync(IMAGES_JSON, 'utf8'))
  : {};

const ASSET_VERSION = process.env.PUBLIC_ASSET_VERSION || '3';
const bust = (p: string) => `${p}?v=${ASSET_VERSION}`;
const assetExistsCache = new Map<string, boolean>();

function publicAssetExists(publicPath: string): boolean {
  if (!publicPath.startsWith('/')) return false;
  const normalized = path.normalize(publicPath.replace(/^\/+/, ''));
  if (normalized.startsWith('..')) return false;
  const diskPath = path.join(PUBLIC_DIR, normalized);
  const cached = assetExistsCache.get(diskPath);
  if (cached !== undefined) return cached;
  const ok = existsSync(diskPath);
  assetExistsCache.set(diskPath, ok);
  return ok;
}

/** Category resolver injected by the vendors module (avoids a cycle: vendors
 *  needs nodes, images needs vendors' categories). Until it's set, only
 *  exact-id images resolve. */
let categoryForNode: ((node: NodeData) => string) | null = null;
export function setCategoryResolver(fn: (node: NodeData) => string): void {
  categoryForNode = fn;
}

export function imageFor(node: NodeData): ItemImage | undefined {
  const exact = IMAGES[node.id];
  const key = exact ? node.id : categoryForNode ? `cat:${categoryForNode(node)}` : undefined;
  const im = exact ?? (key ? IMAGES[key] : undefined);
  if (!im) return undefined;
  const local = im.local && publicAssetExists(im.local) ? im.local : undefined;
  const url = local ? bust(local) : im.url;
  const thumbPath = local?.replace('/img/', '/img/thumb/').replace(/\.\w+$/, '.jpg');
  const thumb = thumbPath && publicAssetExists(thumbPath) ? bust(thumbPath) : url;
  return { ...im, url, thumb, key: key ?? node.id, exact: Boolean(exact) };
}

/** Per-page social card (1200x630) when one was generated for this id. */
export function ogCardPath(id: string): string | undefined {
  const p = `/og/${id}.jpg`;
  return publicAssetExists(p) ? p : undefined;
}
