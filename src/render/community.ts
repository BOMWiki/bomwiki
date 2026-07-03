// Views for accounts and community: sign-in, recent changes, profiles,
// settings, discussions, watchlist. All reuse the review-queue styling.
import type {
  ChangeRow,
  ContributionStats,
  ContributorRow,
  ProfileExtras,
  PublicUser,
  Topic,
  WatchEvent,
} from '../community.ts';
import type { EmailPrefs } from '../emails.ts';
import { DOMAINS } from '../domains.ts';
import { esc, fmtWhen, summaryLines } from '../html.ts';
import { renderArticle } from '../markdown.ts';
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
      <p class="stub">Every accepted change, newest first. This is where patrolling happens. The people behind the edits are on the <a href="/contributors">contributors</a> page.</p>
      ${changeList(rows, false)}</div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function profilePage(
  user: PublicUser,
  stats: ContributionStats,
  extras: ProfileExtras,
  rows: ChangeRow[],
  opts: {
    adminView?: boolean;
    ownProfile?: boolean;
    /** Display names of the domains most of their accepted edits fall in. */
    domains?: string[];
    notice?: string;
  } = {},
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
  // The byline under the name: who they are, where they edit, when they were
  // last seen. Only lines with content appear.
  const byline = [
    user.affiliation ? esc(user.affiliation) : '',
    `joined ${esc(user.joined.slice(0, 10))}`,
    extras.lastActive ? `last active ${fmtWhen(extras.lastActive)}` : '',
    opts.domains?.length ? `edits mostly in ${opts.domains.map(esc).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const isReviewer = user.role === 'admin' || user.role === 'reviewer';
  const website = user.website
    ? `<p class="stub"><a href="${esc(user.website)}" rel="nofollow ugc noopener noreferrer">${esc(user.website.replace(/^https?:\/\//, ''))}</a></p>`
    : '';
  const emptyState = rows.length
    ? ''
    : opts.ownProfile
      ? `<p class="stub">No edits yet. Open a <a href="/random">random page</a> and check one quantity against something you own, or start with the <a href="/help/editing">editing help</a>.</p>`
      : `<p class="stub">No edits yet.</p>`;
  // The self-authored user page, wiki-style: markdown through the same
  // pipeline as articles. A blocked account's page is hidden, not deleted.
  const userPage =
    user.profileMd && !user.blocked
      ? `<section class="pf-page prose">${renderArticle(user.profileMd)}</section>
         ${opts.ownProfile ? `<p class="stub"><a href="/user/${esc(user.handle)}/page">Edit your page</a></p>` : ''}`
      : opts.ownProfile
        ? `<p class="stub">Make this page yours: <a href="/user/${esc(user.handle)}/page">write an about page</a>. Markdown, with [[wiki-links]] to the pages you know best. Some people keep a resume here; some list the machines on their bench.</p>`
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
      <p class="stub">${byline}${opts.ownProfile ? ` · <a href="/settings">edit your profile</a>` : ''}</p>
      ${user.bio ? `<p>${esc(user.bio)}</p>` : ''}
      ${website}
      ${userPage}
      <section class="rv-cs"><div class="pf-stats">
        <span><b>${stats.accepted}</b> accepted</span>
        <span><b>${stats.nodesTouched}</b> pages touched</span>
        <span><b>${stats.pending}</b> pending</span>
        <span><b>${stats.rejected}</b> rejected</span>
        <span><b>${extras.comments}</b> discussion posts</span>
        ${isReviewer ? `<span><b>${extras.reviews}</b> reviews</span>` : ''}
        ${isReviewer && extras.verifications ? `<span><b>${extras.verifications}</b> verifications</span>` : ''}
      </div></section>
      <h2 class="si-h">Contributions</h2>
      ${emptyState}
      ${changeList(rows, true)}</div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function profilePageEditor(
  user: PublicUser,
  opts: { adminEdit?: boolean; error?: string } = {},
): string {
  return page({
    title: `Edit your page | BOMwiki`,
    description: 'Your user page.',
    path: `/user/${user.handle}/page`,
    indexable: false,
    body: `<div class="review">
      <nav class="trail"><a href="/user/${esc(user.handle)}">${esc(user.handle)}</a><span class="sep">›</span><span class="cur">Your page</span></nav>
      <h1>${opts.adminEdit ? `Edit ${esc(user.handle)}'s page (admin)` : 'Your page'}</h1>
      ${opts.error ? `<p class="rv-notice">${esc(opts.error)}</p>` : ''}
      <p class="stub">This renders at the top of <a href="/user/${esc(user.handle)}">your public profile</a>. Markdown: headings with <code>##</code>, lists with <code>-</code>, links as <code>[text](url)</code>, and <code>[[node-id]]</code> links straight to a BOMwiki page. Whatever you want people to know: a resume, the machines you work on, the pages you steward. Public, like everything else here.</p>
      <form method="post" action="/user/${esc(user.handle)}/page" class="settings-form pf-page-form">
        <textarea name="page" rows="18" maxlength="20000" placeholder="## Who I am&#10;&#10;Mechanical engineer, ten years in pump manufacturing.&#10;&#10;## Pages I steward&#10;&#10;- [[centrifugal-pump]]&#10;- [[gate-valve]]">${esc(user.profileMd ?? '')}</textarea>
        <div class="rv-actions"><button>Save</button></div>
      </form></div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function newPagePage(signedIn: boolean): string {
  return page({
    title: 'Create a page | BOMwiki',
    description: 'Start a new product, assembly, or part page on BOMwiki.',
    path: '/new',
    indexable: false,
    body: `<div class="review"><h1>Create a page</h1>
      ${
        signedIn
          ? `<p class="stub">Start a new page for a product, assembly, or part. Give it a name, say what it is, and list the parts it is built from. New pages go through review before they go live, same as any edit. Not sure it is missing? <a href="/search">Search first</a>.</p>
      <div id="bw-new" data-signedin="1"></div>
      <script type="application/json" id="bw-domains">${JSON.stringify(DOMAINS.map((d) => ({ slug: d.slug, name: d.name }))).replaceAll('<', '\\u003c')}</script>
      <noscript><p class="rv-notice">Creating a page needs JavaScript. You can still <a href="/search">search</a> and edit existing pages without it.</p></noscript>`
          : `<p class="stub"><a href="/login">Sign in</a> to create a page. Reading is open to everyone; editing needs an account so every change has a name behind it.</p>`
      }</div>`,
    extraCss: ['/static/edit.css'],
    scripts: ['/static/new.js'],
  });
}

export function contributorsPage(rows: ContributorRow[], totalMembers: number): string {
  return page({
    title: 'Contributors | BOMwiki',
    description: 'The people who build BOMwiki.',
    path: '/contributors',
    indexable: false,
    body: `<div class="review"><h1>Contributors</h1>
      <p class="stub">The people who build BOMwiki: everyone with at least one accepted edit, most edits first. ${totalMembers} ${totalMembers === 1 ? 'member' : 'members'} in total. Automated cleanup runs under <a href="/user/steward-bot">steward-bot</a> and is labeled as machine work. <a href="/changes">Recent changes</a> shows what everyone is doing right now; <a href="/photos-needed">pages needing photos</a> is a good way to help without editing.</p>
      ${rows.length === 0 ? '<p class="stub">Nobody yet. The first accepted edit puts you here.</p>' : ''}
      ${rows
        .map((u) => {
          const tag =
            u.handle === 'steward-bot' ? 'machine' : u.role !== 'contributor' ? u.role : '';
          return `<section class="rv-cs">
        <div class="rv-head">
          <p class="rv-node"><a href="/user/${esc(u.handle)}">${esc(u.displayName ? `${u.displayName} (${u.handle})` : u.handle)}</a>${tag ? ` <span class="htag">${esc(tag)}</span>` : ''}</p>
          <span class="rv-meta">${u.accepted} accepted ${u.accepted === 1 ? 'edit' : 'edits'} · joined ${esc(u.joined.slice(0, 10))}${u.lastActive ? ` · last active ${fmtWhen(u.lastActive)}` : ''}</span>
        </div>
      </section>`;
        })
        .join('\n')}</div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function unsubscribePage(handle: string | null): string {
  return page({
    title: 'Unsubscribed | BOMwiki',
    description: 'Email preferences updated.',
    path: '/email/unsubscribe',
    indexable: false,
    body: `<div class="review">
      ${
        handle
          ? `<h1>You are unsubscribed</h1>
      <p>No more digests or notifications for <b>${esc(handle)}</b>. Sign-in links still work; they are how you get into your account.</p>
      <p class="stub">Changed your mind, or want just some of it back? <a href="/settings">Email preferences</a> has individual switches.</p>`
          : `<h1>That link does not work</h1>
      <p>The unsubscribe link is stale or was copied incompletely. You can change everything from your <a href="/settings">settings</a> instead.</p>`
      }</div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function settingsPage(user: PublicUser, prefs: EmailPrefs, saved = false): string {
  const check = (on: boolean) => (on ? ' checked' : '');
  const emailSection = prefs.hasEmail
    ? `<h2 class="si-h">Email</h2>
      <p class="stub">Your email is never shown to anyone. Sign-in links always work; everything below is optional.</p>
      <form method="post" action="/settings/email" class="settings-form">
        <label class="opt"><input type="checkbox" name="digest" value="weekly"${check(prefs.digest === 'weekly')} /> Weekly digest: changes to pages you watch, your edits under review, and what happened on the site</label>
        <label class="opt"><input type="checkbox" name="decisions"${check(prefs.notifyDecisions)} /> When a change you proposed is accepted or rejected</label>
        <label class="opt"><input type="checkbox" name="replies"${check(prefs.notifyReplies)} /> When someone replies to your discussion topic</label>
        <button>Save email preferences</button>
      </form>`
    : `<h2 class="si-h">Email</h2>
      <p class="stub">This account has no email address (admin token sign-in), so it gets no email.</p>`;
  return page({
    title: 'Settings | BOMwiki',
    description: 'Your public profile.',
    path: '/settings',
    indexable: false,
    body: `<div class="review"><h1>Settings</h1>
      ${saved ? '<p class="rv-notice">Saved.</p>' : ''}
      <h2 class="si-h">Your public profile</h2>
      <p class="stub">Everything here is public. Signed in as ${esc(user.handle)} · <a href="/user/${esc(user.handle)}">view your page</a>.</p>
      <form method="post" action="/settings" class="settings-form">
        <label>Display name <input type="text" name="displayName" value="${esc(user.displayName ?? '')}" maxlength="60" /></label>
        <label>Affiliation <input type="text" name="affiliation" value="${esc(user.affiliation ?? '')}" maxlength="120" placeholder="Company, university, independent…" /></label>
        <label>Website <input type="url" name="website" value="${esc(user.website ?? '')}" maxlength="200" placeholder="https://…" /></label>
        <label>Bio <textarea name="bio" rows="4" maxlength="1000">${esc(user.bio ?? '')}</textarea></label>
        <button>Save</button>
      </form>
      ${emailSection}
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
