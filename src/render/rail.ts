// Compact domain rail, ported from src/components/ProductRail.astro. Lists
// the domains; only the current one — if any — expands with its products.
import { DOMAINS } from '../domains.ts';
import { esc } from '../html.ts';
import { productsByDomain } from '../nodes.ts';

export function rail(active?: string, domain?: string): string {
  const groups = DOMAINS.map((d) => ({ ...d, count: productsByDomain(d.slug).length })).filter(
    (d) => d.count > 0,
  );
  const open = domain ? groups.find((d) => d.slug === domain) : undefined;
  const openProducts = open ? productsByDomain(open.slug) : [];

  const items = groups
    .map((d) => {
      const prods =
        open?.slug === d.slug
          ? `<ul class="rail-prods">${openProducts
              .map(
                (p) =>
                  `<li><a href="/item/${p.id}/"${active === p.id ? ' class="on"' : ''}>${esc(p.name)}</a></li>`,
              )
              .join('')}</ul>`
          : '';
      return `<li${open?.slug === d.slug ? ' class="cur"' : ''}><a href="/domain/${d.slug}/">${esc(d.name)}</a><span class="n">${d.count}</span>${prods}</li>`;
    })
    .join('\n      ');

  return `<input type="checkbox" id="rail-toggle" class="rail-cb" />
  <label for="rail-toggle" class="rail-sum">Browse products</label>
  <aside class="rail">
    <p class="rail-h">Domains</p>
    <ul class="rail-doms">
      ${items}
    </ul>
  </aside>`;
}
