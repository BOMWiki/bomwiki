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
import { getNode, type NodeData } from '../nodes.ts';
import { page } from './base.ts';

function changeList(rows: ChangeRow[], showStatus: boolean): string {
  if (!rows.length) return '<p class="stub">Nothing yet.</p>';
  return rows
    .map(
      (c) => `<section class="rv-cs">
    <div class="rv-head">
      <h2>Change #${c.id}${c.summary ? ` · ${esc(c.summary)}` : ''}${showStatus ? ` <span class="cs-status ${c.status}">${c.status}</span>` : ''}</h2>
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
                 ? `<p class="stub">Development mode — the link is shown here instead of emailed: <a href="${esc(opts.devLink)}">Complete sign-in</a></p>`
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
): string {
  const name = user.displayName ? `${esc(user.displayName)} (${esc(user.handle)})` : esc(user.handle);
  return page({
    title: `${user.handle} | BOMwiki`,
    description: `Contributions of ${user.handle} on BOMwiki.`,
    path: `/user/${user.handle}`,
    indexable: false,
    body: `<div class="review">
      <h1>${name}${user.role !== 'contributor' ? ` <span class="htag">${esc(user.role)}</span>` : ''}</h1>
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

export function talkPage(node: NodeData, topics: Topic[], signedIn: boolean, canModerate: boolean): string {
  return page({
    title: `Discussion: ${node.name} | BOMwiki`,
    description: `Discussion about ${node.name}.`,
    path: `/item/${node.id}/talk`,
    indexable: false,
    body: `<div class="review">
      <nav class="trail"><a href="/item/${node.id}/">${esc(node.name)}</a><span class="sep">›</span><span class="cur">Discussion</span></nav>
      <h1>Discussion: ${esc(node.name)}</h1>
      ${
        signedIn
          ? `<form method="post" action="/item/${node.id}/talk" class="talk-form">
        <textarea name="body" rows="3" placeholder="Start a topic — disagreements about this page's structure or facts go here." required></textarea>
        <button>Post topic</button>
      </form>`
          : `<p class="stub"><a href="/login">Sign in</a> to join the discussion.</p>`
      }
      ${topics.length === 0 ? '<p class="stub">No discussions yet.</p>' : ''}
      ${topics
        .map(
          (t) => `<section class="rv-cs${t.resolved ? ' t-resolved' : ''}">
        <div class="rv-head">
          <p class="rv-node"><a href="/user/${esc(t.author)}">${esc(t.author)}</a> <span class="rv-meta">· ${fmtWhen(t.createdAt)}${t.resolved ? ' · resolved' : ''}</span></p>
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
            ? `<form method="post" action="/item/${node.id}/talk" class="talk-form t-replyform">
          <input type="hidden" name="parent_id" value="${t.id}" />
          <textarea name="body" rows="2" placeholder="Reply…" required></textarea>
          <div class="rv-actions"><button>Reply</button></div>
        </form>
        ${canModerate ? `<form method="post" action="/talk/${t.id}/resolve" class="talk-form t-resolveform"><button>Resolve</button></form>` : ''}`
            : ''
        }
      </section>`,
        )
        .join('\n')}</div>`,
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
