import { esc, fmtWhen, summaryLines } from '../html.ts';
import { currentRev, type NodeData } from '../nodes.ts';
import { page } from './base.ts';

export interface RevisionRow {
  rev: number;
  author: string;
  createdAt: string;
  summary: string;
  changesetId: number;
}

export function historyPage(node: NodeData, revisions: RevisionRow[], isAdmin: boolean): string {
  const head = currentRev(node.id);
  const body = `<div class="review">
    <nav class="trail"><a href="/item/${node.id}/">${esc(node.name)}</a><span class="sep">›</span><span class="cur">History</span></nav>
    <h1>History: ${esc(node.name)}</h1>
    <p class="stub">${revisions.length} ${revisions.length === 1 ? 'revision' : 'revisions'}. Every revision is the complete page as it stood; revert restores an old revision as a new change.</p>
    ${revisions
      .map(
        (r) => `<section class="rv-cs">
      <div class="rv-head">
        <h2>r${r.rev}${r.rev === head ? ' · current' : ''}</h2>
        <span class="rv-meta">by ${esc(r.author)} · ${fmtWhen(r.createdAt)} · change #${r.changesetId}</span>
      </div>
      <ul class="rv-lines">${summaryLines(r.summary)}</ul>
      <div class="rv-actions">
        <a class="rv-view" href="/item/${node.id}/rev/${r.rev}">View this revision</a>
        ${
          isAdmin && r.rev !== head
            ? `<form method="post" action="/item/${node.id}/revert/${r.rev}"><button>Revert to r${r.rev}</button></form>`
            : ''
        }
      </div>
    </section>`,
      )
      .join('\n')}
  </div>`;

  return page({
    title: `History: ${node.name} | BOMwiki`,
    description: `Revision history of ${node.name}.`,
    path: `/item/${node.id}/history`,
    indexable: false,
    body,
    extraCss: ['/static/edit.css'],
  });
}
