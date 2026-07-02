// Server-rendered search results. The header form submits here; the same
// searchNodes index backs the editor's part picker.
import { esc } from '../html.ts';
import { nodeIcon } from '../icons.ts';
import { imageFor } from '../images.ts';
import { getNode, searchNodes } from '../nodes.ts';
import { page } from './base.ts';

export function searchPage(q: string): string {
  const hits = q.trim() ? searchNodes(q, 50) : [];
  const body = `<div class="review">
    <h1>Search</h1>
    <form method="get" action="/search" class="login-form">
      <input type="search" name="q" value="${esc(q)}" placeholder="Search ${'BOMwiki'}" autofocus />
      <button>Search</button>
    </form>
    ${
      q.trim()
        ? `<p class="stub">${hits.length === 50 ? 'First 50 matches' : `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`} for "${esc(q)}".</p>`
        : '<p class="stub">Search 192k products, assemblies, and parts by name.</p>'
    }
    <div class="cards search-cards">
      ${hits
        .map((h) => {
          const node = getNode(h.id)!;
          const img = imageFor(node);
          const icon = img
            ? `<img class="c-ic c-photo" src="${esc(img.thumb ?? img.url)}" alt="" loading="lazy" width="64" height="64" />`
            : `<svg class="c-ic" viewBox="0 0 96 96" aria-hidden="true">${nodeIcon(node)}</svg>`;
          return `<a class="card" href="/item/${h.id}/">
            ${icon}
            <div class="c-body">
              <span class="c-n">${esc(h.name)}</span>
              <span class="c-s">${esc(node.summary ?? '')}</span>
              <span class="c-m">${esc(h.kind)}${h.usedIn ? ` · used in ${h.usedIn}` : ''}</span>
            </div>
          </a>`;
        })
        .join('\n')}
    </div>
  </div>`;

  return page({
    title: q.trim() ? `${q} — search | BOMwiki` : 'Search | BOMwiki',
    description: 'Search BOMwiki products, assemblies, and parts.',
    path: '/search',
    indexable: false,
    body,
    extraCss: ['/static/domain.css', '/static/edit.css'],
  });
}
