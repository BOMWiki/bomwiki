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
      <p>The catalog began as machine-generated content and is being verified page by page — every page shows its verification status honestly. Read <a href="/about/verification">how verification works</a>, <a href="/intelligence">the analysis engine behind it</a>, <a href="/about/governance">how the site is governed</a>, and the <a href="/policies">contribution policies</a>.</p>
      <p>Every proposed change is screened by <b>bomwiki-intelligence</b>, a deterministic BOM-analysis engine that checks structure and function coverage before a reviewer sees it — <a href="/about/verification">how verification works</a> explains what it can and cannot vouch for. Machine actions (catalog checks, cleanup passes) run under the <a href="/user/steward-bot">steward-bot</a> account, with the same public history and revertability as any contributor.</p>
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
      <p>Two layers run on every change. First, hard structural rules the wiki itself enforces and nobody can bypass: no dangling part references, no cycles (nothing may transitively contain itself), no duplicate lines, integer quantities. Second, <b>bomwiki-intelligence</b>, a deterministic BOM-analysis engine that treats each product as a graph of parts and functions. It rolls the bill of materials up into a function profile (store energy, transmit motion, connect electrically…), flags parts that serve no identifiable function, spots assemblies that look like candidates for integration or standardization, and screens the whole catalog for mass-generation fingerprints: boilerplate summaries repeated across pages, cloned BOM shapes, quantity outliers. Every proposed change is analyzed against the product it touches, and reviewers see the findings alongside the diff before accepting.</p>
      <h2 class="si-h">Where machine verification is heading</h2>
      <p>The same engine contains validators that need richer data than most pages carry yet: interface compatibility (a 5&nbsp;mm shaft cannot enter a 6&nbsp;mm bore), manufacturing-process feasibility, and sourcing feasibility. As the community adds specs, ports, and tolerances to pages, those checks activate — machine verification gets stricter as the wiki gets richer, and the two ratchet together. The same validators also gate machine-drafted content: nothing generated reaches a reviewer without passing the deterministic checks first.</p>
      <h2 class="si-h">Estimates on pages</h2>
      <p>Sourcing tables pair companies known to make a kind of item with <b>algorithmic estimates</b> of price band, minimum order, and lead time. These are derived from part counts and category heuristics — they are not quotes, offers, or claims about the named companies.</p>
      <p>Wrong photo, wrong fact, wrong part? Every page has an Edit button and a Discussion tab — corrections are the point.</p>
    </div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function intelligencePage(): string {
  return page({
    title: 'BOM Intelligence | BOMwiki',
    description:
      'The deterministic analysis engine behind BOMwiki: products as function graphs, machine review of every change, hard gates on generated content.',
    path: '/intelligence',
    indexable: true,
    body: `<div class="review">
      <h1>BOM Intelligence</h1>
      <p>Behind BOMwiki runs a deterministic analysis engine — <b>bomwiki-intelligence</b> — built on one idea: a bill of materials is not a list, it is a <b>graph of functions</b>. A drill is "store energy, convert it to motion, transmit it to a chuck, survive a human hand." Parts are how those functions get realized. Analyzing products at the function level, rather than as part numbers, is what lets a machine say useful things about hardware it has never seen.</p>

      <h2 class="si-h">What it does on BOMwiki today</h2>
      <ul class="rv-lines">
        <li><b>Reviews every proposed change.</b> When anyone proposes an edit, the engine re-analyzes the affected product and attaches findings next to the diff in the review queue — a reviewer never accepts blind.</li>
        <li><b>Rolls up function profiles.</b> Every product's tree is summarized by what it does (store energy, transmit motion, connect electrically…), which exposes parts serving no identifiable function and assemblies that contradict their product's nature.</li>
        <li><b>Screens the catalog.</b> Periodic sweeps score every product for mass-generation fingerprints — boilerplate descriptions, cloned BOM shapes, quantity outliers — feeding the cleanup worklist and the machine-checked tier of <a href="/about/verification">verification</a>.</li>
        <li><b>Guards structure absolutely.</b> Cycles, dangling references, duplicate lines, and nonsense quantities are rejected at the door on every edit. These gates cannot be argued with, which is the point.</li>
      </ul>

      <h2 class="si-h">The philosophy: deterministic gates, honest limits</h2>
      <p>Generative systems produce plausible content; plausibility is exactly what a checker must not trust. So the engine is built the opposite way — deterministic graph algorithms whose findings are reproducible and explainable, never a model's opinion. And its limits are stated rather than hidden: it can prove a BOM is <i>coherent</i>; it cannot prove a BOM is <i>true</i>. Truth on BOMwiki comes from people and evidence — the engine's job is to make sure human attention lands where it matters, and that incoherent content never wastes it.</p>

      <h2 class="si-h">Where it goes next</h2>
      <p>The engine already contains validators that activate as pages gain richer data: <b>interface compatibility</b> (a 5&nbsp;mm shaft cannot enter a 6&nbsp;mm bore — physical connections checked across a whole tree), <b>process feasibility</b> (can this routing actually be built on real machines), and <b>sourcing feasibility</b> (can these parts arrive by a date). Each new spec, port, or tolerance the community adds makes the machine stricter. It also gates generation: when a draft BOM is machine-proposed from required functions, it reaches a reviewer only after passing every deterministic check.</p>

      <h2 class="si-h">For builders: the analysis interface is open</h2>
      <p>The wiki engine (open source) talks to the analyzer over a small HTTP contract: <code>POST /api/analyze</code> with a JSON snapshot — <code>items</code>, <code>products</code>, <code>bom_lines</code>, and optionally richer sections (specs, ports, suppliers) — returning a structured review. Anyone running their own BOMwiki instance can implement that contract with their own analyzer; the engine treats it as an optional sidecar and works without one. The analyzer itself is not open source.</p>

      <p class="stub">See also: <a href="/about/verification">how verification works</a> · <a href="/about/governance">governance</a> · <a href="/policies">policies</a></p>
    </div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function governancePage(): string {
  return page({
    title: 'Governance | BOMwiki',
    description: 'Who runs BOMwiki and how editorial decisions are made.',
    path: '/about/governance',
    indexable: true,
    body: `<div class="review">
      <h1>Governance</h1>
      <p>BOMwiki is young, and this page describes how it is actually run today — not an aspiration. As the community grows, expect this page to change; it is versioned like everything else here.</p>

      <h2 class="si-h">Who runs it</h2>
      <ul class="rv-lines">
        <li><b>Founder-admin:</b> <a href="/user/sd">sd</a> (<a href="https://x.com/protosphinx" rel="noopener">@protosphinx</a>) built and operates the site, holds final say on disputes, policy, and moderation, and appoints reviewers. BOMwiki is founder-led at this stage — the honest term for it.</li>
        <li><b>Reviewers:</b> trusted contributors who staff the <a href="/review">review queue</a>, verify pages against evidence, and curate the homepage and domain taxonomy. Active contributors with a good record get promoted; there is no application form yet — consistent good edits are the application.</li>
        <li><b>Contributors:</b> anyone with an account. New accounts' changes wait for review; the <a href="/policies">trust ladder</a> is earned automatically.</li>
        <li><b><a href="/user/steward-bot">steward-bot</a>:</b> the automation account. It runs catalog checks and cleanup passes under the same rules as everyone — attributed, public history, revertable, blockable.</li>
      </ul>

      <h2 class="si-h">How editorial works</h2>
      <ul class="rv-lines">
        <li><b>Changes:</b> propose → machine analysis attaches findings → review → live. Trusted contributors publish directly; everything is versioned and revertable, so mistakes are cheap.</li>
        <li><b>Disagreements:</b> each page's Discussion tab is the venue. Norms that emerge there (like "BOMs describe the built thing; packaging extras live on the product page") become the house style. If discussion deadlocks, the admin decides.</li>
        <li><b>Truth:</b> the <a href="/about/verification">verification system</a> is the editorial backbone — pages carry their status honestly, and only human-verified pages are offered to search engines. Evidence beats seniority.</li>
        <li><b>Estimates and machine content</b> are labeled as such, everywhere, always. That rule outranks everything else on this page.</li>
      </ul>

      <h2 class="si-h">Funding and independence</h2>
      <p>BOMwiki is personally funded by its founder. There is no advertising, no sponsored placement, and no pay-for-verification. Vendor tables are algorithmic estimates, not paid listings — companies cannot buy their way in or out.</p>

      <h2 class="si-h">Licensing and openness</h2>
      <p>The wiki engine is being released as open source. The content license for contributions is being finalized and will be announced here; until then, contributors retain their rights and grant BOMwiki permission to display and adapt their edits within the wiki.</p>

      <h2 class="si-h">Contact</h2>
      <p>For moderation, takedown, or security matters: use any page's Discussion tab for content issues, or email the administrator. Security reports about the software are especially welcome.</p>
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
