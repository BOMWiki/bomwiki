// The operator dashboard: one page answering "what is going on" — who has
// signed up, what they are editing, what state the content is in, and
// whether the sidecars are alive. Admin-only and noindex; every number
// links to the tool that acts on it.
import { esc, fmtWhen } from '../html.ts';
import { nodeCount } from '../nodes.ts';
import { page } from './base.ts';

export interface AdminDashData {
  users: { total: number; new7: number; reviewers: number; admins: number; blocked: number };
  recentUsers: { handle: string; role: string; blocked: boolean; joined: string; edits: number }[];
  changes: {
    pending: number;
    accepted: number;
    rejected: number;
    proposed7: number;
    accepted7: number;
  };
  recentChangesets: { id: number; author: string; status: string; summary: string; when: string }[];
  comments: { total: number; last7: number };
  verification: Record<string, number>;
  verifyEvents7: number;
  health: { intel: boolean; ffs: number | null; mail: boolean };
}

const chip = (ok: boolean, label: string, detail: string): string =>
  `<span class="adm-chip ${ok ? 'adm-ok' : 'adm-down'}">${esc(label)}: ${esc(detail)}</span>`;

export function adminDashPage(d: AdminDashData, notice?: string): string {
  const vf = (s: string): number => d.verification[s] ?? 0;
  return page({
    title: 'Admin | BOMwiki',
    description: 'Operator dashboard.',
    path: '/admin',
    indexable: false,
    body: `<div class="review">
      <h1>Admin</h1>
      ${notice ? `<p class="rv-notice">${esc(notice)}</p>` : ''}
      <p class="stub">Tools: <a href="/review">review queue (${d.changes.pending})</a> · <a href="/changes">recent changes</a> · <a href="/admin/domains">domains</a> · <a href="/admin/homepage">homepage curation</a></p>

      <section class="rv-cs"><div class="pf-stats">
        <span><b>${d.users.total.toLocaleString()}</b> accounts</span>
        <span><b>${d.users.new7}</b> new this week</span>
        <span><b>${d.changes.proposed7}</b> changesets this week</span>
        <span><b>${d.changes.accepted7}</b> accepted this week</span>
        <span><b>${d.comments.last7}</b> comments this week</span>
        <span><b>${d.verifyEvents7}</b> verification events this week</span>
      </div></section>

      <h2 class="si-h">Health</h2>
      <p class="adm-health">
        ${chip(d.health.intel, 'analyzer', d.health.intel ? 'up' : 'down')}
        ${chip(d.health.ffs !== null, 'graph (FFS)', d.health.ffs !== null ? `up · ${d.health.ffs.toLocaleString()} nodes` : 'down')}
        ${chip(d.health.mail, 'mail', d.health.mail ? 'configured' : 'no API key')}
      </p>

      <h2 class="si-h">Content</h2>
      <section class="rv-cs"><div class="pf-stats">
        <span><b>${nodeCount().toLocaleString()}</b> pages</span>
        <span><b>${vf('human-verified').toLocaleString()}</b> human-verified</span>
        <span><b>${vf('machine-checked').toLocaleString()}</b> machine-checked</span>
        <span><b>${vf('unverified').toLocaleString()}</b> unverified</span>
        <span><b>${d.changes.accepted.toLocaleString()}</b> changesets accepted all-time</span>
        <span><b>${d.changes.rejected.toLocaleString()}</b> rejected</span>
        <span><b>${d.comments.total.toLocaleString()}</b> comments</span>
      </div></section>

      <h2 class="si-h">Merge duplicate pages</h2>
      <form method="post" action="/admin/redirect" class="adm-merge">
        <input type="text" name="from" placeholder="duplicate id (e.g. ev-car)" required />
        <span>&#8594;</span>
        <input type="text" name="to" placeholder="canonical id (e.g. electric-car)" required />
        <button>Redirect</button>
      </form>
      <p class="stub">The duplicate 301s to the canonical page and leaves listings and search. Its history stays; deleting the redirect row undoes the merge.</p>

      <h2 class="si-h">Newest accounts</h2>
      <table class="bi-table">
        <thead><tr><th>handle</th><th>role</th><th>joined</th><th>changesets</th></tr></thead>
        <tbody>
        ${d.recentUsers
          .map(
            (u) =>
              `<tr><td><a href="/user/${esc(u.handle)}">${esc(u.handle)}</a>${u.blocked ? ' <span class="htag mod-blocked">blocked</span>' : ''}</td><td>${esc(u.role)}</td><td>${fmtWhen(u.joined)}</td><td>${u.edits}</td></tr>`,
          )
          .join('\n        ')}
        </tbody>
      </table>

      <h2 class="si-h">Latest changesets</h2>
      <table class="bi-table">
        <thead><tr><th>when</th><th>author</th><th>status</th><th>summary</th></tr></thead>
        <tbody>
        ${d.recentChangesets
          .map(
            (c) =>
              `<tr><td>${fmtWhen(c.when)}</td><td><a href="/user/${esc(c.author)}">${esc(c.author)}</a></td><td><span class="cs-status ${esc(c.status)}">${esc(c.status)}</span></td><td>${esc(c.summary)}</td></tr>`,
          )
          .join('\n        ')}
        </tbody>
      </table>
    </div>`,
    extraCss: ['/static/edit.css'],
  });
}
