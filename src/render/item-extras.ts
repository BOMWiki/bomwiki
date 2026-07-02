// Gallery and sourcing sections for the item page, ported from
// src/pages/item/[slug].astro. Markup and class names match the original
// page exactly; static/item.css already styles .gallery/.gal-grid and
// .sourcing/.src-table. Galleries come from the old site's data file (path
// configurable, same pattern as images.ts).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from '../html.ts';
import type { NodeData } from '../nodes.ts';
import { priceBand, vendorsFor } from '../vendors.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const GALLERIES_JSON =
  process.env.GALLERIES_JSON ?? path.join(here, '..', '..', '..', 'src', 'data', 'galleries.json');

interface GalleryEntry {
  title: string;
  page: string;
  /** Self-hosted copy under /img/gallery; entries without one are not shown. */
  file?: string;
}

const GALLERIES: Record<string, GalleryEntry[]> = existsSync(GALLERIES_JSON)
  ? JSON.parse(readFileSync(GALLERIES_JSON, 'utf8'))
  : {};

/** The "Diagrams & photos" section, or '' when this node has no gallery. */
export function gallerySection(nodeId: string): string {
  const gallery = (GALLERIES[nodeId] ?? []).filter((g) => g.file);
  if (gallery.length === 0) return '';
  return `<section class="gallery">
        <div class="sec-head"><h2>Diagrams &amp; photos</h2></div>
        <div class="gal-grid">
          ${gallery
            .map(
              (g) => `<figure class="gal-fig">
            <a href="${esc(g.page)}" target="_blank" rel="noopener" title="${esc(g.title)} (Wikimedia Commons)">
              <img src="${esc(g.file!)}" alt="${esc(g.title)}" loading="lazy" decoding="async" />
            </a>
            <figcaption>${esc(g.title)} · Commons</figcaption>
          </figure>`,
            )
            .join('\n')}
        </div>
      </section>`;
}

/** The "Sourcing: likely vendors" section. Always rendered (like the site):
 *  the table body is simply empty for the rare product with no known makers. */
export function sourcingSection(node: NodeData): string {
  const vendors = vendorsFor(node);
  const band = priceBand(node);
  return `<section class="sourcing">
        <div class="src-head">
          <h2>Sourcing: possible vendors</h2>
          <span class="src-note"><b>Prices, MOQ, and lead times are algorithmic estimates</b> — not quotes, and not claims about these companies. Company mappings are curated by keyword; est. price band ${esc(band)}. <a href="/about/verification">How estimates work</a></span>
        </div>
        <div class="src-scroll">
          <table class="src-table">
            <thead>
              <tr><th>Vendor</th><th>HQ</th><th>Specialty</th><th>MOQ</th><th>Lead time</th></tr>
            </thead>
            <tbody>
              ${vendors
                .map(
                  (v) => `<tr>
                <td class="v-cell">
                  <div class="v-top"><span class="v-flag">${v.flag}</span><a class="v-name" href="https://${esc(v.url)}" target="_blank" rel="nofollow noopener">${esc(v.name)}</a></div>
                  <a class="v-url" href="https://${esc(v.url)}" target="_blank" rel="nofollow noopener">${esc(v.url)} ↗</a>
                </td>
                <td>${esc(v.hq)}</td>
                <td class="v-type">${esc(v.type)}</td>
                <td class="mq">${esc(v.moq)}</td>
                <td class="mq">${esc(v.lead)}</td>
              </tr>`,
                )
                .join('\n')}
            </tbody>
          </table>
        </div>
      </section>`;
}
