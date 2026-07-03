// Views for accounts and community: sign-in, recent changes, profiles,
// settings, discussions, watchlist. All reuse the review-queue styling.
import type {
  ChangeRow,
  ContributionStats,
  PublicUser,
  Topic,
  WatchEvent,
} from '../community.ts';
import { esc, fmtWhen, summaryLines } from '../html.ts';
import { getNode, verificationOfNode, type NodeData } from '../nodes.ts';
import { page } from './base.ts';

function changeList(rows: ChangeRow[], showStatus: boolean): string {
  if (!rows.length) return '<p class="stub">Nothing yet.</p>';
  return rows
    .map(
      (c) => `<section class="rv-cs">
    <div class="rv-head">
      <h2><a href="/changeset/${c.id}">Change #${c.id}</a>${c.summary ? ` · ${esc(c.summary)}` : ''}${showStatus ? ` <span class="cs-status ${c.status}">${c.status}</span>` : ''}</h2>
      <span class="rv-meta">by <a href="/user/${esc(c.author)}">${esc(c.author)}</a> · ${fmtWhen(c.createdAt)}</span>
    </div>
    ${c.edits
      .map(
        (e) => `<div class="rv-edit">
      <p class="rv-node">${e.op === 'create' ? 'New: ' : ''}<a href="/item/${e.nodeId}/">${esc(getNode(e.nodeId)?.name ?? e.nodeId)}</a></p>
      <ul class="rv-lines">${summaryLines(e.summary)}</ul>
    </div>`,
      )
      .join('')}
  </section>`,
    )
    .join('\n');
}

export function signinPage(
  opts: { error?: string; sent?: boolean; devLink?: string } = {},
): string {
  return page({
    title: 'Sign in or create an account | BOMwiki',
    description: 'Sign in to edit BOMwiki.',
    path: '/login',
    indexable: false,
    body: `<div class="review"><h1>Sign in or create an account</h1>
      ${opts.error ? `<p class="rv-notice">${esc(opts.error)}</p>` : ''}
      ${
        opts.sent
          ? `<section class="rv-cs"><p>If that email has an account, a sign-in link is on its way. Check your inbox.</p>
             ${
               opts.devLink
                 ? `<p class="stub">Development mode: the link is shown here instead of emailed. <a href="${esc(opts.devLink)}">Complete sign-in</a></p>`
                 : ''
             }</section>`
          : ''
      }
      <section class="rv-cs">
        <h2 class="si-h">Email sign-in</h2>
        <p class="stub">Editing is public: your handle appears on every change you make, permanently. Your email is never shown.</p>
        <form method="post" action="/auth/request" class="login-form login-col">
          <input type="email" name="email" placeholder="you@example.com" required />
          <input type="text" name="handle" placeholder="Handle (new accounts only)" />
          <button>Send magic link</button>
        </form>
      </section>
      <section class="rv-cs">
        <h2 class="si-h">Admin token</h2>
        <form method="post" action="/login" class="login-form">
          <input type="password" name="token" placeholder="Admin token" />
          <button>Sign in</button>
        </form>
      </section></div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function changesPage(rows: ChangeRow[]): string {
  return page({
    title: 'Recent changes | BOMwiki',
    description: 'Every accepted change across BOMwiki, newest first.',
    path: '/changes',
    indexable: false,
    body: `<div class="review"><h1>Recent changes</h1>
      <p class="stub">Every accepted change, newest first. This is where patrolling happens.</p>
      ${changeList(rows, false)}</div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function profilePage(
  user: PublicUser,
  stats: ContributionStats,
  rows: ChangeRow[],
  opts: { adminView?: boolean; notice?: string } = {},
): string {
  const name = user.displayName ? `${esc(user.displayName)} (${esc(user.handle)})` : esc(user.handle);
  const modControls =
    opts.adminView && user.role !== 'admin' && user.role !== 'system'
      ? `<section class="rv-cs mod-panel">
        <p class="rv-an-h">Moderation (admins only)</p>
        <div class="rv-actions">
          ${
            user.blocked
              ? `<form method="post" action="/admin/user/${esc(user.handle)}/unblock"><button>Unblock</button></form>`
              : `<form method="post" action="/admin/user/${esc(user.handle)}/block"><button class="mod-danger">Block account</button></form>`
          }
          <form method="post" action="/admin/user/${esc(user.handle)}/mass-revert"><button class="mod-danger">Revert all their live edits</button></form>
          ${
            user.role === 'reviewer'
              ? `<form method="post" action="/admin/user/${esc(user.handle)}/make-contributor"><button>Remove reviewer</button></form>`
              : `<form method="post" action="/admin/user/${esc(user.handle)}/make-reviewer"><button>Make reviewer</button></form>`
          }
        </div>
      </section>`
      : '';
  return page({
    title: `${user.handle} | BOMwiki`,
    description: `Contributions of ${user.handle} on BOMwiki.`,
    path: `/user/${user.handle}`,
    indexable: false,
    body: `<div class="review">
      ${opts.notice ? `<p class="rv-notice">${esc(opts.notice)}</p>` : ''}
      <h1>${name}${user.role !== 'contributor' ? ` <span class="htag">${esc(user.role)}</span>` : ''}${user.blocked ? ' <span class="htag mod-blocked">blocked</span>' : ''}</h1>
      ${modControls}
      <p class="stub">${user.affiliation ? esc(user.affiliation) + ' · ' : ''}joined ${esc(user.joined.slice(0, 10))}</p>
      ${user.bio ? `<p>${esc(user.bio)}</p>` : ''}
      <section class="rv-cs"><div class="pf-stats">
        <span><b>${stats.accepted}</b> accepted</span>
        <span><b>${stats.nodesTouched}</b> pages touched</span>
        <span><b>${stats.pending}</b> pending</span>
        <span><b>${stats.rejected}</b> rejected</span>
      </div></section>
      <h2 class="si-h">Contributions</h2>
      ${changeList(rows, true)}</div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function settingsPage(user: PublicUser, saved = false): string {
  return page({
    title: 'Settings | BOMwiki',
    description: 'Your public profile.',
    path: '/settings',
    indexable: false,
    body: `<div class="review"><h1>Your public profile</h1>
      ${saved ? '<p class="rv-notice">Saved.</p>' : ''}
      <p class="stub">Everything here is public. Signed in as ${esc(user.handle)} · <a href="/user/${esc(user.handle)}">view your page</a>.</p>
      <form method="post" action="/settings" class="settings-form">
        <label>Display name <input type="text" name="displayName" value="${esc(user.displayName ?? '')}" maxlength="60" /></label>
        <label>Affiliation <input type="text" name="affiliation" value="${esc(user.affiliation ?? '')}" maxlength="120" placeholder="Company, university, independent…" /></label>
        <label>Bio <textarea name="bio" rows="4" maxlength="1000">${esc(user.bio ?? '')}</textarea></label>
        <button>Save</button>
      </form>
      <form method="post" action="/logout" class="settings-form"><button>Sign out</button></form>
      </div>`,
    extraCss: ['/static/edit.css'],
  });
}

export interface TalkSubject {
  /** Comment-table subject key: a node id, or a reserved page key like 'home'. */
  key: string;
  title: string;
  backHref: string;
  /** Where the post/reply forms submit and resolve redirects return. */
  talkPath: string;
  /** One line of context under the heading: what this page is. */
  summary?: string;
  /** Small chips next to the context line, e.g. kind and verification. */
  chips?: string[];
  historyHref?: string;
}

export function talkSubjectForNode(node: NodeData): TalkSubject {
  return {
    key: node.id,
    title: node.name,
    backHref: `/item/${node.id}/`,
    talkPath: `/item/${node.id}/talk`,
    summary: node.summary,
    chips: [
      { product: 'Product', assembly: 'Assembly', part: 'Part' }[node.kind],
      verificationOfNode(node.id),
    ],
    historyHref: `/item/${node.id}/history`,
  };
}

export const HOME_TALK: TalkSubject = {
  key: 'home',
  title: 'Homepage',
  backHref: '/',
  talkPath: '/home/talk',
  summary:
    'What the homepage says, which products are featured, and how the welcome copy reads. Curation changes are made by reviewers; this is where to argue for them.',
};

function firstSentence(text: string): string {
  const m = text.match(/^[^.!?]+[.!?]/);
  const s = (m?.[0] ?? text).trim();
  return s.length > 180 ? `${s.slice(0, 177).trimEnd()}…` : s;
}

export function talkPage(
  subject: TalkSubject,
  topics: Topic[],
  signedIn: boolean,
  canModerate: boolean,
  prefill = '',
): string {
  const open = topics.filter((t) => !t.resolved);
  const resolved = topics.filter((t) => t.resolved);
  const replyCount = topics.reduce((n, t) => n + t.replies.length, 0);

  const topic = (t: Topic): string => `<section class="rv-cs${t.resolved ? ' t-resolved' : ''}">
        <div class="rv-head">
          <p class="rv-node"><a href="/user/${esc(t.author)}">${esc(t.author)}</a> <span class="rv-meta">· ${fmtWhen(t.createdAt)}${t.resolved ? ' · resolved' : ''}${t.replies.length ? ` · ${t.replies.length} ${t.replies.length === 1 ? 'reply' : 'replies'}` : ''}</span></p>
        </div>
        <p class="t-body">${esc(t.body)}</p>
        ${t.replies
          .map(
            (r) => `<div class="t-reply">
          <p class="rv-node"><a href="/user/${esc(r.author)}">${esc(r.author)}</a> <span class="rv-meta">· ${fmtWhen(r.createdAt)}</span></p>
          <p class="t-body">${esc(r.body)}</p>
        </div>`,
          )
          .join('')}
        ${
          signedIn && !t.resolved
            ? `${canModerate ? `<form method="post" action="/talk/${t.id}/resolve" id="resolve-${t.id}"></form>` : ''}
        <form method="post" action="${esc(subject.talkPath)}" class="talk-form t-replyform">
          <input type="hidden" name="parent_id" value="${t.id}" />
          <textarea name="body" rows="2" placeholder="Reply…" required></textarea>
          <div class="rv-actions"><button>Reply</button>${canModerate ? `<button form="resolve-${t.id}" class="t-resolvebtn" title="Close this topic as settled">Mark resolved</button>` : ''}</div>
        </form>`
            : ''
        }
      </section>`;

  return page({
    title: `Discussion: ${subject.title} | BOMwiki`,
    description: `Discussion about ${subject.title}.`,
    path: subject.talkPath,
    indexable: false,
    body: `<div class="review">
      <nav class="trail"><a href="${esc(subject.backHref)}">${esc(subject.title)}</a><span class="sep">›</span><span class="cur">Discussion</span></nav>
      <h1>Discussion: ${esc(subject.title)}</h1>
      <p class="talk-sub">
        ${(subject.chips ?? []).map((c) => `<span class="vf-tag${c === 'machine-checked' || c === 'human-verified' || c === 'unverified' ? ` vf-${c}` : ''}">${esc(c)}</span>`).join(' ')}
        ${subject.summary ? `${esc(firstSentence(subject.summary))} · ` : ''}<a href="${esc(subject.backHref)}">View page</a>${subject.historyHref ? ` · <a href="${esc(subject.historyHref)}">History</a>` : ''}
      </p>
      <div class="talk-help">
        <b>This page is for disagreements and questions</b> about ${esc(subject.title)}: a part that does not belong, a quantity that looks wrong, a photo that shows the wrong thing, a claim that needs evidence. Norms that emerge here become the house style; if discussion deadlocks, a <a href="/about/governance">reviewer or the admin</a> decides. If you already know the fix, <a href="/help/editing">edit the page directly</a> instead of asking permission. Comments are public and attributed to your profile.
      </div>
      ${
        signedIn
          ? `<form method="post" action="${esc(subject.talkPath)}" class="talk-form">
        <textarea name="body" rows="3" placeholder="Start a topic. Say what looks wrong, and how you know." required>${esc(prefill)}</textarea>
        <button>Post topic</button>
      </form>`
          : `<p class="stub"><a href="/login">Sign in</a> to start a topic. Reading is open to everyone.</p>`
      }
      <h2 class="si-h talk-count">${
        topics.length === 0
          ? 'No topics yet'
          : `${open.length} open ${open.length === 1 ? 'topic' : 'topics'}${resolved.length ? ` · ${resolved.length} resolved` : ''}${replyCount ? ` · ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}` : ''}`
      }</h2>
      ${topics.length === 0 ? `<p class="stub">Nothing has been raised about this page. If something looks wrong to you, you are probably not the only one: start the first topic.</p>` : ''}
      ${open.map(topic).join('\n')}
      ${resolved.length ? `<h2 class="si-h talk-count">Resolved</h2>` : ''}
      ${resolved.map(topic).join('\n')}</div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function homepageAdminPage(opts: {
  pool: string[];
  facts: string[];
  welcome: { title: string; subtitle: string };
  meta: { updatedBy: string; updatedAt: string } | null;
  notice?: string;
}): string {
  return page({
    title: 'Curate the homepage | BOMwiki',
    description: 'Featured pool and did-you-know facts.',
    path: '/admin/homepage',
    indexable: false,
    body: `<div class="review"><h1>Curate the homepage</h1>
      ${opts.notice ? `<p class="rv-notice">${esc(opts.notice)}</p>` : ''}
      <p class="stub">Reviewers decide what the homepage features. The featured product rotates daily through the pool below; curated facts appear above the computed ones. ${
        opts.meta
          ? `Last edited by <a href="/user/${esc(opts.meta.updatedBy)}">${esc(opts.meta.updatedBy)}</a> · ${fmtWhen(opts.meta.updatedAt)}.`
          : 'Currently using the launch seed.'
      }</p>
      <form method="post" action="/admin/homepage" class="settings-form">
        <label>Welcome banner title
          <input type="text" name="welcomeTitle" maxlength="60" value="${esc(opts.welcome.title)}" />
        </label>
        <label>Welcome banner subtitle
          <textarea name="welcomeSubtitle" rows="2" maxlength="300">${esc(opts.welcome.subtitle)}</textarea>
        </label>
        <label>Featured pool (one product id per line)
          <textarea name="pool" rows="8">${esc(opts.pool.join('\n'))}</textarea>
        </label>
        <label>Did-you-know facts (one per line, plain text; shown before the computed facts)
          <textarea name="facts" rows="6">${esc(opts.facts.join('\n'))}</textarea>
        </label>
        <button>Save</button>
      </form></div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function watchlistPage(events: WatchEvent[]): string {
  return page({
    title: 'Watchlist | BOMwiki',
    description: 'Recent changes to pages you watch.',
    path: '/watchlist',
    indexable: false,
    body: `<div class="review"><h1>Watchlist</h1>
      <p class="stub">Recent revisions to pages you watch.</p>
      ${events.length === 0 ? '<p class="stub">Nothing yet. Use the Watch button on any page.</p>' : ''}
      ${events
        .map(
          (e) => `<section class="rv-cs">
        <div class="rv-head">
          <p class="rv-node"><a href="/item/${e.nodeId}/">${esc(getNode(e.nodeId)?.name ?? e.nodeId)}</a> r${e.rev} <span class="rv-meta">· by <a href="/user/${esc(e.author)}">${esc(e.author)}</a> · ${fmtWhen(e.createdAt)}</span></p>
        </div>
        <ul class="rv-lines">${summaryLines(e.summary)}</ul>
      </section>`,
        )
        .join('\n')}</div>`,
    extraCss: ['/static/edit.css'],
  });
}
