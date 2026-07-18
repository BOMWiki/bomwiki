import type { ChangesetDetail, PendingChangeset } from '../changesets.ts';
import { esc, fmtWhen, summaryLines } from '../html.ts';
import type { PendingModel } from '../models.ts';
import { getNode } from '../nodes.ts';
import { page } from './base.ts';
import { modelReviewCard } from './models.ts';

/** One changeset as a card: header, per-node diff lines, machine findings,
 *  and whatever action row fits the viewer. Shared by the review queue and
 *  the public changeset page so they cannot drift. */
export function changesetCard(cs: PendingChangeset, actionsHtml: string, titleHtml = ''): string {
  return `<section class="rv-cs">
      <div class="rv-head">
        <h2>Change #${cs.id}${cs.summary ? ` · ${esc(cs.summary)}` : ''}${titleHtml}</h2>
        <span class="rv-meta">by <a href="/user/${esc(cs.author)}">${esc(cs.author)}</a> · ${fmtWhen(cs.createdAt)} · ${cs.edits.length} ${cs.edits.length === 1 ? 'node' : 'nodes'}</span>
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
      ${actionsHtml}
    </section>`;
}

const reviewActions = (id: number): string => `<div class="rv-actions">
        <form method="post" action="/review/${id}/accept"><button class="rv-accept">Accept</button></form>
        <form method="post" action="/review/${id}/reject"><button>Reject</button></form>
      </div>`;

export function reviewPage(
  pending: PendingChangeset[],
  notice?: string,
  pendingModels: PendingModel[] = [],
): string {
  const body = `<div class="review">
    <h1>Review queue</h1>
    ${notice ? `<p class="rv-notice">${esc(notice)}</p>` : ''}
    ${pending.length === 0 && pendingModels.length === 0 ? '<p class="stub">Nothing pending. All caught up.</p>' : ''}
    ${pending.map((cs) => changesetCard(cs, reviewActions(cs.id))).join('\n')}
    ${pendingModels.length ? `<h2 class="si-h">3D model submissions</h2>` : ''}
    ${pendingModels.map((m) => modelReviewCard(m)).join('\n')}
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

export interface ChangesetViewer {
  userId: number | null;
  role: string | null;
}

/** The public page for one changeset: where a contributor tracks their
 *  proposal after submitting. Readable by anyone; actions depend on who
 *  is looking. */
export function changesetPage(cs: ChangesetDetail, viewer: ChangesetViewer): string {
  const isAuthor = viewer.userId !== null && viewer.userId === cs.authorId;
  const isReviewer = viewer.role === 'admin' || viewer.role === 'reviewer';
  const statusLabel = cs.withdrawn ? 'withdrawn' : cs.status;
  const statusHtml = ` <span class="cs-status ${esc(cs.status)}">${esc(statusLabel)}</span>`;

  const explain =
    cs.status === 'pending'
      ? isAuthor
        ? `<p class="rv-notice">Your change is in the <b>review queue</b>. A reviewer will accept it onto the live page or reject it with the reasons visible here. Nothing further is needed from you; check back here or on <a href="/user/${esc(cs.author)}">your profile</a>, where all your changes are listed. Spotted a mistake in it? Withdraw below and propose a corrected version.</p>`
        : `<p class="rv-notice">This change is awaiting review. It is not yet part of any live page.</p>`
      : cs.withdrawn
        ? `<p class="rv-notice">Withdrawn by the author on ${fmtWhen(cs.decidedAt ?? '')}. It was never applied.</p>`
        : cs.status === 'accepted'
          ? `<p class="rv-notice">Accepted${cs.reviewer ? ` by <a href="/user/${esc(cs.reviewer)}">${esc(cs.reviewer)}</a>` : ''} on ${fmtWhen(cs.decidedAt ?? '')}. It is live on the pages below; each page's History tab shows the resulting revision.</p>`
          : `<p class="rv-notice">Rejected${cs.reviewer ? ` by <a href="/user/${esc(cs.reviewer)}">${esc(cs.reviewer)}</a>` : ''} on ${fmtWhen(cs.decidedAt ?? '')}. The live pages were not changed. Rework it and propose again, or raise it on the page's Discussion tab.</p>`;

  const actions =
    cs.status !== 'pending'
      ? ''
      : isReviewer
        ? `<div class="rv-actions">
        <form method="post" action="/review/${cs.id}/accept"><button class="rv-accept">Accept</button></form>
        <form method="post" action="/review/${cs.id}/reject"><button>Reject</button></form>
      </div>`
        : isAuthor
          ? `<div class="rv-actions"><form method="post" action="/changeset/${cs.id}/withdraw"><button>Withdraw this change</button></form></div>`
          : '';

  return page({
    title: `Change #${cs.id} | BOMwiki`,
    description: `Changeset #${cs.id} by ${cs.author}.`,
    path: `/changeset/${cs.id}`,
    indexable: false,
    body: `<div class="review">
      <h1>Change #${cs.id}</h1>
      ${explain}
      ${changesetCard(cs, actions, statusHtml)}
    </div>`,
    extraCss: ['/static/edit.css'],
  });
}
