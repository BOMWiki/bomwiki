import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Static asset URLs carry a content-hash version so browsers and the CDN can
// cache them hard without ever serving a stale stylesheet against new HTML.
// The hash covers every file in static/ (vendor included) and is computed
// once at startup; a deploy restarts the engine, so it always reflects what
// is on disk.
const staticDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'static');

function hashStaticDir(): string {
  const h = createHash('sha1');
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        h.update(entry.name);
        h.update(readFileSync(full));
      }
    }
  };
  walk(staticDir);
  return h.digest('hex').slice(0, 12);
}

export const assetVersion = hashStaticDir();

/** Version a site-relative /static/ URL: '/static/base.css' -> '/static/base.css?v=<hash>'. */
export function asset(path: string): string {
  return `${path}?v=${assetVersion}`;
}
