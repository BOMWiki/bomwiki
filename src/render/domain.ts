// Domain hub pages, ported from src/pages/domain/[slug].astro. The
// raw-materials domain's curated sub-sections stay with the old data files
// for now (they're candidates for DB-backed curation later); every other
// domain is a single card grid.
import { DOMAINS } from '../domains.ts';
import { esc } from '../html.ts';
import { nodeIcon } from '../icons.ts';
import { imageFor } from '../images.ts';
import { productsByDomain, totalParts, type NodeData } from '../nodes.ts';
import { page } from './base.ts';
import { rail } from './rail.ts';

function card(p: NodeData): string {
  const img = imageFor(p);
  const icon = img
    ? `<img class="c-ic c-photo" src="${esc(img.thumb ?? img.url)}" alt="${esc(p.name)}" loading="lazy" decoding="async" width="64" height="64" />`
    : `<svg class="c-ic" viewBox="0 0 96 96" role="img" aria-label="${esc(p.name)}">${nodeIcon(p)}</svg>`;
  return `<a class="card" href="/item/${p.id}/">
    ${icon}
    <div class="c-body">
      <span class="c-n">${esc(p.name)}</span>
      <span class="c-s">${esc(p.summary ?? '')}</span>
      <span class="c-m">${totalParts(p.id).toLocaleString()} parts · ${p.bom?.length ?? 0} subsystems</span>
    </div>
  </a>`;
}

export function domainPage(slug: string): string | null {
  const dom = DOMAINS.find((d) => d.slug === slug);
  if (!dom) return null;
  const ps = productsByDomain(slug);
  if (ps.length === 0) return null;

  const listLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${dom.name}: parts lists & bills of materials`,
    url: `https://bomwiki.com/domain/${slug}/`,
    numberOfItems: ps.length,
    itemListElement: ps.slice(0, 100).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: p.name,
      url: `https://bomwiki.com/item/${p.id}/`,
    })),
  };

  const body = `<div class="explorer">
    ${rail(undefined, slug)}
    <div class="pane">
      <nav class="trail"><a href="/">Domains</a> <span class="sep">›</span> <span class="cur">${esc(dom.name)}</span></nav>
      <h1>${esc(dom.name)}</h1>
      <p class="blurb">${ps.length} ${ps.length === 1 ? 'product' : 'products'}, each exploded into a recursive bill of materials. Open one and keep clicking down to the bolts.</p>
      <section class="card-section">
        <div class="cards">
          ${ps.map(card).join('\n')}
        </div>
      </section>
    </div>
  </div>`;

  return page({
    title: `${dom.name}: parts lists & bills of materials | BOMwiki`,
    description: `Bills of materials for ${ps.length} ${dom.name.toLowerCase()} products, exploded down to atomic parts, showing what each one is made of, with specs and vendors.`,
    path: `/domain/${slug}/`,
    indexable: true,
    jsonLd: [listLd],
    body,
    extraCss: ['/static/domain.css', '/static/rail.css'],
  });
}
