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
      <p>BOMwiki is a free, openly editable encyclopedia of bills of materials: what products are made of, exploded down to individual parts. It currently maps ${totalCatalogParts.toLocaleString()} parts across ${nodeCount().toLocaleString()} items.</p>
      <p>Anyone can open an account and edit. Every page is versioned, and every change is attributed and reversible. New contributors' edits are reviewed before going live; trusted contributors publish directly. Disagreements go to each page's Discussion tab.</p>
      <p>The catalog began as machine-generated content and is being verified page by page. Every page shows its verification status. Read <a href="/about/verification">how verification works</a>, <a href="/intelligence">the analysis engine behind it</a>, <a href="/about/governance">how the site is governed</a>, and the <a href="/policies">contribution policies</a>.</p>
      <p>Every proposed change is screened by <b>bomwiki-intelligence</b>, an analysis engine that checks structure and function coverage before a reviewer sees the change. Machine actions such as catalog checks and cleanup passes run under the <a href="/user/steward-bot">steward-bot</a> account, with the same public history and revertability as any contributor.</p>
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
        <li><b>unverified</b>: machine-generated content that nobody has vouched for. Treat details as provisional.</li>
        <li><b>machine-checked</b>: automated consistency checks pass. The structure is coherent: no duplicate or self-referencing BOM lines, sane quantities, a function profile without obvious gaps, no mass-generation fingerprints. Set by <a href="/user/steward-bot">steward-bot</a>. A machine cannot confirm that the page matches the real product, and this status does not claim that.</li>
        <li><b>human-verified</b>: a reviewer confirmed the page against evidence (a standard designation, service documentation, a teardown, or direct experience) and recorded that evidence. Only human-verified pages are offered to search engines.</li>
      </ul>
      <h2 class="si-h">What the machine checks</h2>
      <p>Two layers run on every change. The first is structural rules the wiki enforces on every edit and that cannot be bypassed: no dangling part references, no cycles (nothing may transitively contain itself), no duplicate lines, integer quantities. The second is <b>bomwiki-intelligence</b>, an analysis engine that treats each product as a graph of parts and functions. It rolls the bill of materials up into a function profile (store energy, transmit motion, connect electrically, and so on), flags parts that serve no identifiable function, spots assemblies that look like candidates for integration or standardization, and screens the catalog for signs of mass generation: boilerplate descriptions, cloned BOM shapes, quantity outliers. Reviewers see the engine's findings next to the diff before accepting a change.</p>
      <h2 class="si-h">Where machine verification is heading</h2>
      <p>The same engine contains validators that need richer data than most pages carry yet: interface compatibility (a 5&nbsp;mm shaft cannot enter a 6&nbsp;mm bore), manufacturing-process feasibility, and sourcing feasibility. As the community adds specs, ports, and tolerances to pages, those checks activate. The validators also gate machine-drafted content: nothing generated reaches a reviewer without passing the deterministic checks first.</p>
      <h2 class="si-h">Estimates on pages</h2>
      <p>Sourcing tables pair companies known to make a kind of item with <b>algorithmic estimates</b> of price band, minimum order, and lead time. These are derived from part counts and category heuristics. They are not quotes, offers, or claims about the named companies.</p>
      <p>If something on a page is wrong, use its Edit button or Discussion tab.</p>
    </div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function intelligencePage(): string {
  return page({
    title: 'BOM Intelligence | BOMwiki',
    description:
      'The analysis engine behind BOMwiki: products as function graphs, machine review of every change, hard gates on generated content.',
    path: '/intelligence',
    indexable: true,
    body: `<div class="review">
      <h1>BOM Intelligence</h1>
      <p>Behind BOMwiki runs an analysis engine called <b>bomwiki-intelligence</b>. It treats a bill of materials as a graph of functions. A drill, to the engine, is "store energy, convert it to motion, transmit it to a chuck," and parts are how those functions get realized. Analyzing products at the function level is what lets a machine say useful things about hardware it has never seen.</p>

      <h2 class="si-h">What it does on BOMwiki today</h2>
      <ul class="rv-lines">
        <li><b>Reviews every proposed change.</b> When anyone proposes an edit, the engine re-analyzes the affected product and attaches findings next to the diff in the review queue.</li>
        <li><b>Rolls up function profiles.</b> Every product's tree is summarized by what it does, which exposes parts serving no identifiable function and assemblies that contradict their product's nature.</li>
        <li><b>Screens the catalog.</b> Periodic sweeps score every product for signs of mass generation, such as boilerplate descriptions, cloned BOM shapes, and quantity outliers. The scores feed the cleanup worklist and the machine-checked tier of <a href="/about/verification">verification</a>.</li>
        <li><b>Guards structure.</b> Cycles, dangling references, duplicate lines, and nonsense quantities are rejected automatically on every edit and cannot be overridden.</li>
      </ul>

      <h2 class="si-h">Why it is deterministic</h2>
      <p>Generative systems produce plausible content, and plausible-but-wrong content is what a checker exists to catch. So the engine uses deterministic graph algorithms whose findings are reproducible and explainable. Its limits are stated: it can prove a BOM is coherent. It cannot prove a BOM is true. Truth on BOMwiki comes from people and evidence; the engine's job is to direct reviewer attention and to keep incoherent content out entirely.</p>

      <h2 class="si-h">Where it goes next</h2>
      <p>The engine already contains validators that activate as pages gain richer data: <b>interface compatibility</b> (physical connections checked across a whole tree), <b>process feasibility</b> (whether a routing can be built on real machines), and <b>sourcing feasibility</b> (whether parts can arrive by a date). Each spec, port, or tolerance the community adds makes the checks stricter. The engine also gates generation: when a draft BOM is machine-proposed from required functions, it reaches a reviewer only after passing every deterministic check.</p>

      <h2 class="si-h">For builders: the analysis interface is open</h2>
      <p>The wiki engine (open source) talks to the analyzer over a small HTTP contract: <code>POST /api/analyze</code> with a JSON snapshot containing <code>items</code>, <code>products</code>, <code>bom_lines</code>, and optionally richer sections (specs, ports, suppliers). It returns a structured review. Anyone running their own BOMwiki instance can implement that contract with their own analyzer; the engine treats it as an optional sidecar and works without one. The analyzer itself is not open source.</p>

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
      <p>BOMwiki is young. This page describes how it is actually run today, and it will change as the community grows.</p>

      <h2 class="si-h">Who runs it</h2>
      <ul class="rv-lines">
        <li><b>Founder-admin:</b> <a href="/user/sd">sd</a> (<a href="https://x.com/protosphinx" rel="noopener">@protosphinx</a>) built and operates the site, holds final say on disputes, policy, and moderation, and appoints reviewers. BOMwiki is founder-led at this stage.</li>
        <li><b>Reviewers:</b> trusted contributors who staff the <a href="/review">review queue</a>, verify pages against evidence, and curate the homepage and domain taxonomy. Reviewers are promoted based on their edit history; there is no application form yet.</li>
        <li><b>Contributors:</b> anyone with an account. New accounts' changes wait for review; the <a href="/policies">trust ladder</a> is earned automatically.</li>
        <li><b><a href="/user/steward-bot">steward-bot</a>:</b> the automation account. It runs catalog checks and cleanup passes under the same rules as everyone: its actions are attributed and public, and it can be reverted or blocked like any account.</li>
      </ul>

      <h2 class="si-h">How editorial works</h2>
      <ul class="rv-lines">
        <li><b>Changes:</b> propose, machine analysis attaches findings, review, live. Trusted contributors publish directly. Everything is versioned and revertable.</li>
        <li><b>Disagreements:</b> each page's Discussion tab is the venue. Norms that emerge there become the house style. If discussion deadlocks, the admin decides.</li>
        <li><b>Truth:</b> the <a href="/about/verification">verification system</a> is the editorial backbone. Pages carry their status, and only human-verified pages are offered to search engines. Disputes about facts are settled by evidence.</li>
        <li><b>Labeling:</b> estimates and machine content are labeled as such, everywhere, always. This rule outranks everything else on this page.</li>
      </ul>

      <h2 class="si-h">Funding and independence</h2>
      <p>BOMwiki is personally funded by its founder. There is no advertising, no sponsored placement, and no paid verification. Vendor tables are algorithmic estimates, and companies cannot pay to appear in them or to be removed from them.</p>

      <h2 class="si-h">Licensing and openness</h2>
      <p>The wiki engine is being released as open source. The content license for contributions is being finalized and will be announced here. Until then, contributors retain their rights and grant BOMwiki permission to display and adapt their edits within the wiki.</p>

      <h2 class="si-h">Contact</h2>
      <p>For content issues, use the page's Discussion tab. For moderation, takedown, or security matters, email the administrator. Security reports about the software are especially welcome.</p>
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
      <p>This page renders from the live server configuration, so the values below are the values being enforced.</p>
      <h2 class="si-h">The trust ladder</h2>
      <ul class="rv-lines">
        <li>New accounts' changes wait in the <a href="/review">review queue</a> until a reviewer accepts them.</li>
        <li>After <b>${t.autoconfirmEdits} accepted changes</b> and <b>${t.autoconfirmDays} day(s)</b> of account age, your edits publish immediately.</li>
        <li>Reviewers and admins publish directly and staff the queue. Active contributors get promoted.</li>
      </ul>
      <h2 class="si-h">Rate limits</h2>
      <ul class="rv-lines">
        <li>Pending changes per account: ${t.maxPending}</li>
        <li>Proposals per hour: ${t.hourlyNew} for new accounts, ${t.hourlyTrusted} for trusted accounts</li>
        <li>Comments per hour: ${c.hourlyNew} for new accounts, ${c.hourlyTrusted} for trusted accounts; at most ${c.linksUntrusted} links per comment until trusted</li>
      </ul>
      <h2 class="si-h">Moderation</h2>
      <ul class="rv-lines">
        <li>Everything is public and permanent: your handle appears on every change.</li>
        <li>Admins can block accounts, which ends their sessions and rejects their pending queue, and can revert all of an account's live edits in one action.</li>
        <li>External links in contributed content carry nofollow, so they gain no search ranking.</li>
      </ul>
    </div>`,
    extraCss: ['/static/edit.css'],
  });
}
