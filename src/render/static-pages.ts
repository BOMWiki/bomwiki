// Public documentation pages. Numbers render from the live constants and
// counts, so what these pages say is what the server enforces.
import { TRUST_POLICY } from '../changesets.ts';
import { COMMENT_POLICY } from '../community.ts';
import { nodeCount, totalCatalogParts } from '../nodes.ts';
import { page } from './base.ts';

export function aboutPage(): string {
  return page({
    title: 'About | BOMwiki',
    description: 'What BOMwiki is and how it works.',
    path: '/about/',
    indexable: true,
    body: `<div class="review">
      <h1>About BOMwiki</h1>
      <p>BOMwiki is a free, openly editable encyclopedia of bills of materials: what things are made of, exploded down to individual screws, bearings, and cells. It currently maps ${totalCatalogParts.toLocaleString()} parts across ${nodeCount().toLocaleString()} items.</p>
      <p>Anyone can open an account and edit. Every page is versioned; every change is attributed and reversible. New contributors' edits are reviewed before going live; trusted contributors publish directly. Disagreements go to each page's Discussion tab.</p>
      <p>The catalog began as machine-generated content and is being verified page by page — every page shows its verification status honestly. Read <a href="/about/verification">how verification works</a> and the <a href="/policies">contribution policies</a>.</p>
      <p>Machine actions (catalog checks, cleanup passes) run under the <a href="/user/steward-bot">steward-bot</a> account, with the same public history and revertability as any contributor.</p>
    </div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function verificationPage(): string {
  return page({
    title: 'How verification works | BOMwiki',
    description: 'Verification statuses, machine checks, and their limits.',
    path: '/about/verification',
    indexable: true,
    body: `<div class="review">
      <h1>How verification works</h1>
      <p>Every page carries one of three statuses, shown in its infobox:</p>
      <ul class="rv-lines">
        <li><b>unverified</b> — machine-generated content nobody has vouched for. Treat details as provisional.</li>
        <li><b>machine-checked</b> — automated consistency checks pass: the structure is coherent (no duplicate or self-referencing BOM lines, sane quantities, function profile without obvious gaps, no mass-generation fingerprints). Set by <a href="/user/steward-bot">steward-bot</a>. A machine cannot confirm the page matches the real product — that is exactly what this status does NOT claim.</li>
        <li><b>human-verified</b> — a reviewer confirmed the page against evidence (a standard designation, service documentation, a teardown, direct experience) and recorded that evidence. Only human-verified pages are offered to search engines.</li>
      </ul>
      <h2 class="si-h">What the machine checks</h2>
      <p>The consistency signals: repeated boilerplate summaries across many pages, bill-of-materials shapes cloned between products, quantity outliers, parts mapping to no known function, and function profiles that contradict the product's nature. Pages scoring clean on all signals are marked machine-checked; the worst-scoring pages go to a cleanup worklist for human attention. Structural rules (no cycles, no dangling references, integer quantities) are enforced on every edit and cannot be bypassed.</p>
      <h2 class="si-h">Estimates on pages</h2>
      <p>Sourcing tables pair companies known to make a kind of item with <b>algorithmic estimates</b> of price band, minimum order, and lead time. These are derived from part counts and category heuristics — they are not quotes, offers, or claims about the named companies.</p>
      <p>Wrong photo, wrong fact, wrong part? Every page has an Edit button and a Discussion tab — corrections are the point.</p>
    </div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function policiesPage(): string {
  const t = TRUST_POLICY;
  const c = COMMENT_POLICY;
  return page({
    title: 'Contribution policies | BOMwiki',
    description: 'The trust ladder, rate limits, and moderation rules.',
    path: '/policies',
    indexable: true,
    body: `<div class="review">
      <h1>Contribution policies</h1>
      <p>These are the values the server enforces right now — this page renders from the live configuration.</p>
      <h2 class="si-h">The trust ladder</h2>
      <ul class="rv-lines">
        <li>New accounts' changes wait in the <a href="/review">review queue</a> until a reviewer accepts them.</li>
        <li>After <b>${t.autoconfirmEdits} accepted changes</b> and <b>${t.autoconfirmDays} day(s)</b> of account age, your edits publish immediately.</li>
        <li>Reviewers and admins always publish directly and staff the queue. Active contributors get promoted.</li>
      </ul>
      <h2 class="si-h">Rate limits</h2>
      <ul class="rv-lines">
        <li>Pending changes per account: ${t.maxPending}</li>
        <li>Proposals per hour: ${t.hourlyNew} (new accounts) / ${t.hourlyTrusted} (trusted)</li>
        <li>Comments per hour: ${c.hourlyNew} (new) / ${c.hourlyTrusted} (trusted); at most ${c.linksUntrusted} links per comment until trusted</li>
      </ul>
      <h2 class="si-h">Moderation</h2>
      <ul class="rv-lines">
        <li>Everything is public and permanent: your handle appears on every change.</li>
        <li>Admins can block accounts (ending sessions and rejecting their pending queue) and revert all of an account's live edits in one action.</li>
        <li>External links in contributed content carry nofollow — link spam earns nothing here.</li>
      </ul>
    </div>`,
    extraCss: ['/static/edit.css'],
  });
}
