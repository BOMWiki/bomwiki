import type { PendingChangeset } from '../changesets.ts';
import { esc } from '../html.ts';
import { getNode } from '../nodes.ts';
import { page } from './base.ts';

function summaryLines(summary: string): string {
  return summary
    .split('\n')
    .map((line) => `<li>${esc(line)}</li>`)
    .join('');
}

export function reviewPage(pending: PendingChangeset[], notice?: string): string {
  const body = `<div class="review">
    <h1>Review queue</h1>
    ${notice ? `<p class="rv-notice">${esc(notice)}</p>` : ''}
    ${pending.length === 0 ? '<p class="stub">Nothing pending. All caught up.</p>' : ''}
    ${pending
      .map(
        (cs) => `<section class="rv-cs">
      <div class="rv-head">
        <h2>Change #${cs.id}${cs.summary ? ` · ${esc(cs.summary)}` : ''}</h2>
        <span class="rv-meta">by ${esc(cs.author)} · ${esc(cs.createdAt.slice(0, 16).replace('T', ' '))} · ${cs.edits.length} ${cs.edits.length === 1 ? 'node' : 'nodes'}</span>
      </div>
      ${cs.edits
        .map(
          (e) => `<div class="rv-edit">
        <p class="rv-node">${e.op === 'create' ? 'New: ' : ''}<a href="/item/${e.nodeId}/">${esc(getNode(e.nodeId)?.name ?? e.nodeId)}</a> <code>${e.nodeId}</code></p>
        <ul class="rv-lines">${summaryLines(e.summary)}</ul>
      </div>`,
        )
        .join('')}
      ${
        cs.analysis?.length
          ? `<div class="rv-analysis">
        <p class="rv-an-h">Machine findings</p>
        <ul class="rv-lines">${cs.analysis
          .map((f) => `<li class="an-${esc(f.severity)}">${esc(f.text)}</li>`)
          .join('')}</ul>
      </div>`
          : ''
      }
      <div class="rv-actions">
        <form method="post" action="/review/${cs.id}/accept"><button class="rv-accept">Accept</button></form>
        <form method="post" action="/review/${cs.id}/reject"><button>Reject</button></form>
      </div>
    </section>`,
      )
      .join('\n')}
  </div>`;

  return page({
    title: 'Review queue | BOMwiki',
    description: 'Pending changes awaiting review.',
    path: '/review',
    indexable: false,
    body,
    extraCss: ['/static/edit.css'],
  });
}
