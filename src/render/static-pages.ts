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
      <p>BOMwiki is a free, openly editable encyclopedia of bills of materials: what products are made of, exploded down to individual parts. It currently maps ${totalCatalogParts.toLocaleString()} parts across ${nodeCount().toLocaleString()} items. It is the flagship of <a href="/project">The BOMwiki Project</a>, whose software is <a href="https://github.com/BOMWiki/bomwiki" rel="noopener">open source</a>.</p>
      <p>Anyone can open an account and edit; <a href="/help/editing">here is how</a>. Every page is versioned, and every change is attributed and reversible. New contributors' edits are reviewed before going live; trusted contributors publish directly. Disagreements go to each page's Discussion tab.</p>
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
      'How the analysis engine behind BOMwiki works: function taxonomies, graph algorithms, machine review of every change, layered validators, and the open analysis interface.',
    path: '/intelligence',
    indexable: true,
    body: `<div class="review bi">
      <h1>BOM Intelligence</h1>
      <p>BOMwiki runs beside an analysis engine called <b>bomwiki-intelligence</b>. It is a Rust program that reads a snapshot of a product's bill of materials and checks it with deterministic graph algorithms. The wiki sends it every proposed change before a reviewer sees it, sweeps the whole catalog through it on a schedule, and uses its results to award the machine-checked tier of <a href="/about/verification">verification</a>. This page explains how it works in enough detail that you can judge the findings it produces. The implementation is closed source; the interface it speaks is open and documented at the bottom.</p>

      <h2 class="si-h">Products are function graphs</h2>
      <p>A part number tells a machine nothing. "608ZZ" and "deep-groove ball bearing, 8&thinsp;mm bore" are the same object, and neither string says what the object is for. So the engine's first move is to leave the part-number world entirely and tag every item against a fixed taxonomy of <b>20 mechanical functions</b>: store_energy, convert_energy, transmit_motion, guide_motion, fasten_join, support_structure, protect_enclose, seal_contain, regulate_flow, thermal_manage, sense_measure, control_compute, connect_electrical, communicate_signal, display_information, human_interface, process_material, filter_clean, provide_safety, store_material.</p>
      <p>Tagging is deterministic. Each function carries a set of seed phrases; item names and summaries are normalized and matched against them; every tag records the exact phrase that produced it as evidence. There is no model in the loop, so the same item always gets the same tag and every tag can be traced back to the words that earned it.</p>
      <p>Once items carry functions, a product stops being a list of part numbers and becomes a <b>function profile</b>: the rollup of every function in its subtree, weighted by quantity. That representation is what lets a machine say useful things about hardware it has never seen. A cordless drill and an angle grinder share no part numbers, but both decompose into store energy, convert it to rotation, transmit it to a work surface, and keep fingers out.</p>

      <figure class="bi-fig">
        <svg viewBox="0 0 740 268" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif" font-size="11">
          <g stroke="#c8ccd1" stroke-width="1">
            <line x1="210" y1="38" x2="53" y2="78"/><line x1="210" y1="38" x2="138" y2="78"/><line x1="210" y1="38" x2="216" y2="78"/><line x1="210" y1="38" x2="291" y2="78"/><line x1="210" y1="38" x2="363" y2="78"/>
            <line x1="53" y1="100" x2="37" y2="150"/><line x1="53" y1="100" x2="101" y2="150"/>
            <line x1="138" y1="100" x2="154" y2="150"/><line x1="138" y1="100" x2="211" y2="150"/>
            <line x1="216" y1="100" x2="284" y2="150"/><line x1="216" y1="100" x2="365" y2="150"/>
            <line x1="363" y1="100" x2="438" y2="150"/>
          </g>
          <text x="40" y="130" fill="#54595d" font-size="10">&#215;10</text>
          <text x="252" y="130" fill="#54595d" font-size="10">&#215;3</text>
          <text x="412" y="130" fill="#54595d" font-size="10">&#215;14</text>
          <g>
            <rect x="150" y="14" width="120" height="24" rx="3" fill="#fff" stroke="#a2a9b1" stroke-width="1.5"/><text x="210" y="30" text-anchor="middle" fill="#202122">cordless drill</text>
            <rect x="10" y="78" width="86" height="22" rx="3" fill="#fff" stroke="#b26a00" stroke-width="1.5"/><text x="53" y="93" text-anchor="middle" fill="#202122">battery pack</text>
            <rect x="106" y="78" width="64" height="22" rx="3" fill="#fff" stroke="#3366cc" stroke-width="1.5"/><text x="138" y="93" text-anchor="middle" fill="#202122">motor</text>
            <rect x="180" y="78" width="72" height="22" rx="3" fill="#fff" stroke="#14866d" stroke-width="1.5"/><text x="216" y="93" text-anchor="middle" fill="#202122">gearbox</text>
            <rect x="262" y="78" width="58" height="22" rx="3" fill="#fff" stroke="#14866d" stroke-width="1.5"/><text x="291" y="93" text-anchor="middle" fill="#202122">chuck</text>
            <rect x="330" y="78" width="66" height="22" rx="3" fill="#fff" stroke="#54595d" stroke-width="1.5"/><text x="363" y="93" text-anchor="middle" fill="#202122">housing</text>
            <rect x="2" y="150" width="70" height="20" rx="3" fill="#fff" stroke="#b26a00" stroke-width="1.5"/><text x="37" y="164" text-anchor="middle" fill="#202122">18650 cell</text>
            <rect x="80" y="150" width="42" height="20" rx="3" fill="#fff" stroke="#2f6f8f" stroke-width="1.5"/><text x="101" y="164" text-anchor="middle" fill="#202122">BMS</text>
            <rect x="130" y="150" width="48" height="20" rx="3" fill="#fff" stroke="#3366cc" stroke-width="1.5"/><text x="154" y="164" text-anchor="middle" fill="#202122">rotor</text>
            <rect x="186" y="150" width="50" height="20" rx="3" fill="#fff" stroke="#3366cc" stroke-width="1.5"/><text x="211" y="164" text-anchor="middle" fill="#202122">stator</text>
            <rect x="244" y="150" width="80" height="20" rx="3" fill="#fff" stroke="#14866d" stroke-width="1.5"/><text x="284" y="164" text-anchor="middle" fill="#202122">planet gear</text>
            <rect x="332" y="150" width="66" height="20" rx="3" fill="#fff" stroke="#14866d" stroke-width="1.5"/><text x="365" y="164" text-anchor="middle" fill="#202122">ring gear</text>
            <rect x="406" y="150" width="64" height="20" rx="3" fill="#fff" stroke="#8657c4" stroke-width="1.5"/><text x="438" y="164" text-anchor="middle" fill="#202122">M3 screw</text>
          </g>
          <line x1="500" y1="10" x2="500" y2="240" stroke="#c8ccd1" stroke-width="1"/>
          <text x="520" y="26" fill="#202122" font-weight="600" font-size="12">function rollup</text>
          <g font-size="10.5">
            <rect x="520" y="42" width="10" height="10" fill="#b26a00"/><text x="536" y="51" fill="#202122">store_energy</text><rect x="632" y="43" width="55" height="8" fill="#b26a00" opacity="0.25"/><text x="692" y="51" fill="#54595d">11</text>
            <rect x="520" y="64" width="10" height="10" fill="#3366cc"/><text x="536" y="73" fill="#202122">convert_energy</text><rect x="632" y="65" width="15" height="8" fill="#3366cc" opacity="0.25"/><text x="692" y="73" fill="#54595d">3</text>
            <rect x="520" y="86" width="10" height="10" fill="#14866d"/><text x="536" y="95" fill="#202122">transmit_motion</text><rect x="632" y="87" width="30" height="8" fill="#14866d" opacity="0.25"/><text x="692" y="95" fill="#54595d">6</text>
            <rect x="520" y="108" width="10" height="10" fill="#8657c4"/><text x="536" y="117" fill="#202122">fasten_join</text><rect x="632" y="109" width="70" height="8" fill="#8657c4" opacity="0.25"/><text x="692" y="117" fill="#54595d">14</text>
            <rect x="520" y="130" width="10" height="10" fill="#2f6f8f"/><text x="536" y="139" fill="#202122">control_compute</text><rect x="632" y="131" width="5" height="8" fill="#2f6f8f" opacity="0.25"/><text x="692" y="139" fill="#54595d">1</text>
            <rect x="520" y="152" width="10" height="10" fill="#54595d"/><text x="536" y="161" fill="#202122">protect_enclose</text><rect x="632" y="153" width="5" height="8" fill="#54595d" opacity="0.25"/><text x="692" y="161" fill="#54595d">1</text>
          </g>
          <text x="520" y="196" fill="#54595d" font-size="10.5">the same profile computed for every</text>
          <text x="520" y="210" fill="#54595d" font-size="10.5">product in the catalog, from a fixed</text>
          <text x="520" y="224" fill="#54595d" font-size="10.5">taxonomy of 20 functions</text>
        </svg>
        <figcaption class="bi-cap">Fig. 1 &middot; The same product seen two ways: a part tree (colored by tagged function) and its function rollup. Items that map to no function are flagged as weakly justified.</figcaption>
      </figure>

      <p>The profile does immediate editorial work. An item whose name and summary match no function lands in the <b>unknown</b> bucket and gets flagged as weakly justified: a candidate for renaming, removal, or better evidence. A product whose profile contradicts its nature, say a kettle dominated by transmit_motion, directs reviewer attention before any human has read the page.</p>

      <h2 class="si-h">The shape of the catalog</h2>
      <p>The whole catalog is one directed graph: about 192,000 items connected by parent-child BOM lines, rolling up to about 30 million part positions across roughly 4,900 products. Two properties matter for analysis.</p>
      <p><b>Parts are shared.</b> A 608 ball bearing is a single entry with many parents, so evidence attached to it once serves every machine that uses it, and a correction propagates everywhere in one edit. Quantities multiply along paths during explosion: 2 gearboxes &#215; 3 planet gears &#215; 1 bearing is 6 bearings, and the largest page on the site rolls up to about 5.6 million parts this way.</p>
      <p><b>The graph is acyclic.</b> A part cannot contain itself at any depth. The wiki engine enforces this at write time by walking ancestors before accepting any BOM line, and the analyzer independently re-derives it with its own traversal, so a cycle would have to slip past two unrelated implementations. Degree and depth statistics from the same traversal feed the complexity check: an assembly with an unusual number of direct children is flagged as an integration or standardization candidate, with its dominant function attached for context.</p>

      <figure class="bi-fig">
        <svg viewBox="0 0 740 208" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif" font-size="11">
          <g stroke="#c8ccd1" stroke-width="1">
            <line x1="105" y1="40" x2="85" y2="84"/>
            <line x1="265" y1="40" x2="260" y2="84"/>
          </g>
          <g stroke="#3366cc" stroke-width="1.2">
            <line x1="85" y1="106" x2="160" y2="156"/>
            <line x1="260" y1="106" x2="200" y2="156"/>
          </g>
          <rect x="40" y="16" width="130" height="24" rx="3" fill="#fff" stroke="#a2a9b1" stroke-width="1.5"/><text x="105" y="32" text-anchor="middle" fill="#202122">espresso machine</text>
          <rect x="210" y="16" width="110" height="24" rx="3" fill="#fff" stroke="#a2a9b1" stroke-width="1.5"/><text x="265" y="32" text-anchor="middle" fill="#202122">angle grinder</text>
          <rect x="30" y="84" width="110" height="22" rx="3" fill="#fff" stroke="#c8ccd1" stroke-width="1.5"/><text x="85" y="99" text-anchor="middle" fill="#202122">vibration pump</text>
          <rect x="200" y="84" width="120" height="22" rx="3" fill="#fff" stroke="#c8ccd1" stroke-width="1.5"/><text x="260" y="99" text-anchor="middle" fill="#202122">spindle assembly</text>
          <rect x="120" y="156" width="120" height="24" rx="3" fill="#eaf3ff" stroke="#3366cc" stroke-width="1.5"/><text x="180" y="172" text-anchor="middle" fill="#202122">608 ball bearing</text>
          <text x="252" y="172" fill="#54595d" font-size="10.5">one entry, many parents</text>
          <line x1="430" y1="10" x2="430" y2="196" stroke="#c8ccd1" stroke-width="1"/>
          <rect x="490" y="30" width="80" height="22" rx="3" fill="#fff" stroke="#c8ccd1" stroke-width="1.5"/><text x="530" y="45" text-anchor="middle" fill="#202122">gearbox</text>
          <rect x="560" y="120" width="110" height="22" rx="3" fill="#fff" stroke="#c8ccd1" stroke-width="1.5"/><text x="615" y="135" text-anchor="middle" fill="#202122">planet carrier</text>
          <line x1="545" y1="52" x2="600" y2="120" stroke="#c8ccd1" stroke-width="1"/>
          <path d="M 560 128 C 470 120 460 70 487 54" fill="none" stroke="#b32424" stroke-width="1.3" stroke-dasharray="4 3"/>
          <text x="466" y="99" fill="#b32424" font-weight="600" font-size="13">&#10007;</text>
          <text x="452" y="176" fill="#54595d" font-size="10.5">a part containing its own ancestor is rejected</text>
          <text x="452" y="190" fill="#54595d" font-size="10.5">at write time; the catalog stays a verified DAG</text>
        </svg>
        <figcaption class="bi-cap">Fig. 2 &middot; The catalog is a directed acyclic graph. Shared parts have one page and many parents; cycles cannot be written.</figcaption>
      </figure>

      <h2 class="si-h">What happens to every proposed change</h2>
      <p>Analysis is wired into the edit loop itself. The pipeline below runs on every proposed changeset, from any account, before a human reviewer looks at it.</p>

      <figure class="bi-fig">
        <svg viewBox="0 0 740 336" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif" font-size="11">
          <g stroke="#a2a9b1" stroke-width="1.2">
            <line x1="150" y1="44" x2="150" y2="62"/><line x1="150" y1="98" x2="150" y2="116"/><line x1="150" y1="152" x2="150" y2="170"/><line x1="150" y1="206" x2="150" y2="224"/><line x1="150" y1="260" x2="150" y2="278"/>
            <path d="M 146 58 L 150 64 L 154 58" fill="none"/><path d="M 146 112 L 150 118 L 154 112" fill="none"/><path d="M 146 166 L 150 172 L 154 166" fill="none"/><path d="M 146 220 L 150 226 L 154 220" fill="none"/><path d="M 146 274 L 150 280 L 154 274" fill="none"/>
          </g>
          <rect x="20" y="10" width="260" height="34" rx="3" fill="#fff" stroke="#a2a9b1" stroke-width="1.5"/><text x="150" y="31" text-anchor="middle" fill="#202122" font-weight="600">proposed changeset</text>
          <rect x="20" y="64" width="260" height="34" rx="3" fill="#fff" stroke="#b32424" stroke-width="1.5"/><text x="150" y="85" text-anchor="middle" fill="#202122" font-weight="600">structural gates (wiki engine)</text>
          <rect x="20" y="118" width="260" height="34" rx="3" fill="#fff" stroke="#a2a9b1" stroke-width="1.5"/><text x="150" y="139" text-anchor="middle" fill="#202122" font-weight="600">subtree projection</text>
          <rect x="20" y="172" width="260" height="34" rx="3" fill="#fff" stroke="#3366cc" stroke-width="1.5" stroke-dasharray="5 3"/><text x="150" y="193" text-anchor="middle" fill="#202122" font-weight="600">POST /api/analyze &#8594; sidecar</text>
          <rect x="20" y="226" width="260" height="34" rx="3" fill="#fff" stroke="#a2a9b1" stroke-width="1.5"/><text x="150" y="247" text-anchor="middle" fill="#202122" font-weight="600">findings attached to the changeset</text>
          <rect x="20" y="280" width="260" height="34" rx="3" fill="#fff" stroke="#14866d" stroke-width="1.5"/><text x="150" y="301" text-anchor="middle" fill="#202122" font-weight="600">human decision</text>
          <g fill="#54595d" font-size="10.5">
            <text x="310" y="28">from any account, via the on-page editor</text>
            <text x="310" y="78">references must exist, quantities must be sane, no duplicate</text>
            <text x="310" y="92">lines, no cycles. <tspan fill="#b32424">Failures are rejected outright, never stored.</tspan></text>
            <text x="310" y="132">the affected product trees with the edits overlaid: analysis sees</text>
            <text x="310" y="146">the catalog as it would look if accepted. Up to 3 roots, 20,000 nodes.</text>
            <text x="310" y="186">4-second budget. If the sidecar is down or slow there are simply</text>
            <text x="310" y="200">no machine findings; analysis is advisory and never blocks an edit.</text>
            <text x="310" y="240">stored with the changeset, shown beside the diff in the</text>
            <text x="310" y="254"><a href="/review" fill="#3366cc">review queue</a></text>
            <text x="310" y="294">on accept, the proposal is three-way merged with the live page,</text>
            <text x="310" y="308">revalidated, and the merged result that ships is analyzed again</text>
          </g>
        </svg>
        <figcaption class="bi-cap">Fig. 3 &middot; The change pipeline. Structural checks are binding and run in the wiki engine itself; analyzer findings are advisory context for the human reviewer.</figcaption>
      </figure>

      <p>Two details are worth pausing on. First, <b>projection</b>: the analyzer never sees the edit as a diff. The wiki walks the affected product trees with the proposed edits overlaid on the live graph, so the analysis describes the future state of the catalog, including interactions between the edit and parts of the tree the editor never touched. Second, <b>re-analysis at accept time</b>: because concurrent edits are merged field by field, what actually ships can differ from what was proposed, so the merged result is analyzed again and the findings on record always describe what went live.</p>

      <h2 class="si-h">Layered validators</h2>
      <p>The engine is built as independent validator layers over one graph. Each layer engages when the data it needs exists, returns a verdict of PASS or REVIEW plus a score from 0 to 1, and reports what it could not check, so a passing score on thin data never masquerades as a passing score on rich data.</p>

      <table class="bi-table">
        <thead><tr><th>layer</th><th>what it checks</th><th>data that engages it</th><th>status on BOMwiki</th></tr></thead>
        <tbody>
          <tr><td>structure</td><td>dangling references, duplicate lines, quantity sanity, cycles</td><td>BOM lines alone</td><td>live, binding</td></tr>
          <tr><td>function</td><td>taxonomy tags, rollups, weakly justified items, complexity outliers</td><td>item names and summaries</td><td>live, advisory</td></tr>
          <tr><td>interface compatibility</td><td>mated connections agree on diameter, thread pitch, pin count, voltage, current, pressure, flow</td><td>interface ports and numeric specs on parts</td><td>dormant until pages carry port data</td></tr>
          <tr><td>process feasibility</td><td>routing steps form a valid sequence and each operation fits a real machine's force, torque, bed size, and accuracy, with time rollups</td><td>routings, machines, tooling</td><td>dormant</td></tr>
          <tr><td>sourcing feasibility</td><td>whether every part can arrive by a required date given lead times, freight, customs, open orders, and supplier ratings</td><td>supplier and logistics records</td><td>dormant</td></tr>
        </tbody>
      </table>

      <p>The interface layer shows the flavor of the dormant checks. Parts declare typed ports carrying numeric keys (<code>shaft_diameter_mm</code>, <code>bore_diameter_mm</code>, <code>thread_pitch_mm</code>, <code>pin_count</code>, <code>voltage_v</code>, <code>current_a</code>, <code>pressure_bar</code>, <code>flow_lpm</code>). Declared connections are validated against rules; where no connections are declared, the engine infers plausible ones from the tree and validates those. A failed connection produces both an issue and, when the catalog contains a bridging part, a repair suggestion.</p>

      <figure class="bi-fig">
        <svg viewBox="0 0 740 168" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif" font-size="11">
          <rect x="60" y="18" width="190" height="70" rx="3" fill="#fff" stroke="#a2a9b1" stroke-width="1.5"/>
          <text x="74" y="38" fill="#202122" font-weight="600">DC motor</text>
          <text x="74" y="56" fill="#54595d" font-size="10.5">port: shaft</text>
          <text x="74" y="72" fill="#202122" font-size="10.5" font-family="monospace">shaft_diameter_mm: 5.0</text>
          <rect x="490" y="18" width="200" height="70" rx="3" fill="#fff" stroke="#a2a9b1" stroke-width="1.5"/>
          <text x="504" y="38" fill="#202122" font-weight="600">planetary gearbox</text>
          <text x="504" y="56" fill="#54595d" font-size="10.5">port: input bore</text>
          <text x="504" y="72" fill="#202122" font-size="10.5" font-family="monospace">bore_diameter_mm: 6.0</text>
          <line x1="250" y1="53" x2="355" y2="53" stroke="#b32424" stroke-width="1.3"/>
          <line x1="385" y1="53" x2="490" y2="53" stroke="#b32424" stroke-width="1.3"/>
          <text x="362" y="58" fill="#b32424" font-weight="600" font-size="14">&#10007;</text>
          <text x="370" y="118" text-anchor="middle" fill="#b32424" font-size="11">issue: shaft 5.0 mm does not match bore 6.0 mm</text>
          <text x="370" y="140" text-anchor="middle" fill="#14866d" font-size="11">suggestion: 5 mm to 6 mm shaft coupler, found in the catalog</text>
        </svg>
        <figcaption class="bi-cap">Fig. 4 &middot; An interface check. Both parts exist and the BOM is structurally valid, but the connection is physically impossible. This is the class of error part numbers can never surface.</figcaption>
      </figure>

      <p>This is the practical reason BOMwiki asks editors for specs and not just part lists. Every port, tolerance, or spec a contributor adds moves a page from "the machine checked its shape" toward "the machine checked its physics."</p>

      <h2 class="si-h">The catalog sweep</h2>
      <p>Beyond per-change review, the engine periodically sweeps the entire graph. The sweep computes suspicion signals for every product: boilerplate summaries repeated across unrelated items, cloned BOM shapes (identical child structures under different names), quantity outliers, items with no parents, and references to pages that do not exist. Products that pass hold the <b>machine-checked</b> tier; the rest sit on a public cleanup worklist. Machine-checked asserts coherence only. The tier above it, human-verified, is granted by people citing evidence, and it is the only tier BOMwiki offers to search engines. The methodology and its current counts live on the <a href="/about/verification">verification page</a>.</p>

      <h2 class="si-h">Deterministic by design</h2>
      <p>A checker must not share the failure modes of the content it checks. The largest risk to a BOM catalog is plausible generated content, and a generative checker rates plausibility highly by construction. So every check above is a graph algorithm: reproducible, since the same snapshot always yields the same findings, and explainable, since every finding carries the path, the count, or the seed phrase that produced it. There is no confidence score anywhere in the system that cannot be traced to arithmetic.</p>
      <p>The limits are stated just as plainly. The engine can prove a BOM is coherent. It cannot prove a BOM is true. A perfectly consistent tree of parts that were never in the real product passes every structural check. Truth on BOMwiki comes from people citing evidence; the engine's job is to make incoherence impossible to publish and to point reviewers at the pages most worth their attention.</p>
      <p>The same layers also gate generation rather than compete with it. The engine emits grounded feature packs (graph statistics, function profiles, rollups) that ranking or drafting models can consume, and any machine-drafted candidate BOM must pass every deterministic gate before a reviewer ever sees it.</p>

      <h2 class="si-h">The open interface</h2>
      <p>The <a href="https://github.com/BOMWiki/bomwiki" rel="noopener">wiki engine</a> is open source and treats the analyzer as an optional sidecar behind one HTTP endpoint. Anyone running their own instance can implement the same contract with their own analyzer, and the wiki works fully without one.</p>
      <pre class="bi-code">POST /api/analyze?product=drill-cordless
{
  "items": [
    { "id": "drill-cordless", "name": "Cordless drill",
      "description": "Handheld 18 V drill driver", "item_type": "product" },
    { "id": "motor-dc", "name": "DC motor",
      "description": "Brushless outrunner", "item_type": "part" }
  ],
  "products": [
    { "id": "drill-cordless", "name": "Cordless drill",
      "root_item_id": "drill-cordless" }
  ],
  "bom_lines": [
    { "parent_id": "drill-cordless", "child_id": "motor-dc", "quantity": 1 }
  ]
}</pre>
      <pre class="bi-code">200 OK (abridged)
{
  "bom_review": {
    "function_profile": { "functions": [
      { "function_id": "convert_energy", "function": "Convert energy", "item_count": 1 },
      { "function_id": "unknown",        "function": "Unknown",        "item_count": 1 }
    ] },
    "complexity_candidates": [
      { "item_id": "drill-cordless", "name": "Cordless drill",
        "child_count": 1, "dominant_function": "convert_energy" }
    ]
  }
}</pre>
      <p>The snapshot accepts richer optional sections (<code>interface_ports</code>, <code>compatibility_rules</code>, <code>routings</code>, <code>machines</code>, <code>supplier_parts</code>, <code>cost_records</code>), and each one a caller supplies engages the corresponding validator layer in the response.</p>

      <p class="stub">See also: <a href="/about/verification">how verification works</a> · <a href="/about/governance">governance</a> · <a href="/help/editing">how to edit</a> · <a href="/policies">policies</a></p>
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
      <p>BOMwiki is young. This page describes how it is actually run today, and it will change as the community grows. The site is part of <a href="/project">The BOMwiki Project</a>.</p>

      <h2 class="si-h">Who runs it</h2>
      <ul class="rv-lines">
        <li><b>Founder-admin:</b> Shashank Dixit (<a href="/user/sphinx">sphinx</a>/<a href="/user/sd">sd</a>, <a href="https://x.com/protosphinx" rel="noopener">@protosphinx</a>) built and operates the site, holds final say on disputes, policy, and moderation, and appoints reviewers. BOMwiki is founder-led at this stage.</li>
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
      <p>The wiki engine is open source under AGPL-3.0 at <a href="https://github.com/BOMWiki/bomwiki" rel="noopener">github.com/BOMWiki/bomwiki</a>. Anyone may run or modify it; anyone offering a modified version as a service must publish their changes under the same terms. The analysis sidecar is not open source; its <a href="/intelligence">interface is documented</a> so instances can supply their own.</p>
      <p>The content license for contributions is being finalized and will be announced here. Until then, contributors retain their rights and grant BOMwiki permission to display and adapt their edits within the wiki.</p>

      <h2 class="si-h">Contact</h2>
      <p>For content issues, use the page's Discussion tab. For moderation, takedown, or security matters, email <a href="mailto:admin@bomwiki.com">admin@bomwiki.com</a>. Security reports about the software are especially welcome.</p>
    </div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function projectPage(): string {
  return page({
    title: 'The BOMwiki Project | BOMwiki',
    description:
      'The mission: every bill of materials in the world, free to everyone. What the project is, why, and what is open.',
    path: '/project',
    indexable: true,
    body: `<div class="review">
      <h1>The BOMwiki Project</h1>
      <p class="motto">How everything is made, free to everyone.</p>

      <h2 class="si-h">The mission</h2>
      <p>The goal of this project is to map every bill of materials in the world: what each product is made of, down to individual parts, in one shared graph anyone can read and improve.</p>
      <p>We believe that is a net good, because manufacturing is a net good. Almost everything that keeps people alive and comfortable is manufactured, and the knowledge of how those things are put together is mostly locked inside companies. Opening it lowers the barrier to making, repairing, sourcing, competing, and learning. A student can see what is inside a wind turbine. A repair shop can find the part that actually fails. A founder can price a product before building it. An engineer in a country with no industrial base can study how the industrial world is assembled.</p>
      <p>BOMwiki serves that mission the way Wikipedia serves general knowledge: openly editable, versioned, argued over in public, and honest about what has and has not been verified.</p>

      <h2 class="si-h">What is open</h2>
      <ul class="rv-lines">
        <li><b>The engine</b> (this website's software) is open source under AGPL-3.0: <a href="https://github.com/BOMWiki/bomwiki" rel="noopener">github.com/BOMWiki/bomwiki</a>. Anyone can run their own BOMwiki. See <a href="/project/engine">the engine page</a>.</li>
        <li><b>The content</b> is openly editable and versioned here on the site. It lives in the project's database, not on GitHub; its license is being finalized, and periodic public data dumps are planned so the content is as portable as the code.</li>
        <li><b>The analyzer</b> (BOM Intelligence) is not open source, but <a href="/intelligence">its interface is documented</a> so any instance can plug in its own.</li>
      </ul>

      <h2 class="si-h">Repositories</h2>
      <ul class="rv-lines">
        <li><a href="https://github.com/BOMWiki/bomwiki" rel="noopener">BOMWiki/bomwiki</a>: the wiki engine (AGPL-3.0). <a href="/project/engine">About this repo</a>.</li>
        <li><a href="https://github.com/BOMWiki/.github" rel="noopener">BOMWiki/.github</a>: project profile and brand assets, including the logo.</li>
      </ul>

      <h2 class="si-h">Take part</h2>
      <ul class="rv-lines">
        <li>Fix a page: <a href="/help/editing">how editing works</a>.</li>
        <li>Improve the engine: <a href="https://github.com/BOMWiki/bomwiki" rel="noopener">pull requests welcome</a>.</li>
        <li>Read <a href="/about/governance">how the project is run</a> and <a href="/about/verification">how truth is handled</a>.</li>
      </ul>
    </div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function enginePage(): string {
  return page({
    title: 'The engine | BOMwiki',
    description: 'About the open source software that runs BOMwiki.',
    path: '/project/engine',
    indexable: true,
    body: `<div class="review">
      <h1>The engine</h1>
      <p>The software running this site is open source under AGPL-3.0: <a href="https://github.com/BOMWiki/bomwiki" rel="noopener">github.com/BOMWiki/bomwiki</a>.</p>
      <h2 class="si-h">What it is</h2>
      <p>A wiki engine built for bills of materials rather than prose. Pages are nodes in one graph; edits are full-snapshot revisions grouped into changesets; concurrent edits merge field by field; structural rules (no cycles, no dangling references) are enforced on every change. It includes the review queue, the trust ladder, discussions, watchlists, verification statuses, and moderation tools you see on this site.</p>
      <h2 class="si-h">What it is built with</h2>
      <p>Node.js and Postgres, deliberately without a web framework: plain TypeScript template functions, plain CSS, and three runtime dependencies. The aim is software that anyone who knows the web platform can read and patch, in 2036 as well as now.</p>
      <p>Two optional sidecars extend it. The <a href="/intelligence">analyzer</a> reviews proposed changes. The graph sidecar is <a href="https://ffsdb.com" rel="noopener">FFS</a>, a graph database holding a nightly copy of the catalog; it serves whole-graph traversals such as the "appears in N products" line on part pages, computed as a Cypher query over the full 192,000-item graph. Both degrade the same way: if the sidecar is down, the feature is absent and the wiki keeps working.</p>
      <h2 class="si-h">Running your own</h2>
      <p>The <a href="https://github.com/BOMWiki/bomwiki#quickstart" rel="noopener">README quickstart</a> goes from empty database to a working wiki in a few commands. You can seed it from a JSON catalog or start empty and build pages in the editor. The analyzer is optional: implement <a href="/intelligence">the documented interface</a> or run without machine findings. The graph sidecar is optional the same way: anything answering the same wire protocol works, and scripts/export-ffs.ts produces the CSVs it loads.</p>
      <h2 class="si-h">License</h2>
      <p>AGPL-3.0. Use it, modify it, run it commercially; if you offer a modified version as a service, publish your modifications under the same terms. Contributions are licensed the same way.</p>
    </div>`,
    extraCss: ['/static/edit.css'],
  });
}

export function helpEditingPage(): string {
  return page({
    title: 'How to edit | BOMwiki',
    description: 'A practical guide to editing BOMwiki pages.',
    path: '/help/editing',
    indexable: true,
    body: `<div class="review">
      <h1>How to edit</h1>
      <p>Every page on BOMwiki can be corrected by anyone with an account. This page walks through the whole loop.</p>

      <h2 class="si-h">1. Get an account</h2>
      <p><a href="/login">Sign in</a> with your email; you will get a one-time link, no password. Pick a handle: it appears publicly on every change you make, permanently. Your email is never shown.</p>

      <h2 class="si-h">2. Edit a page</h2>
      <p>Open any product, assembly, or part and press <b>Edit this page</b>. The page itself becomes the editor:</p>
      <ul class="rv-lines">
        <li><b>Fields</b>: summary, material, standard, and aliases are plain text boxes.</li>
        <li><b>Bill of materials</b>: each row has a quantity and a note. Remove a row with the × button. Add one by typing a part name; the picker searches all ${nodeCount().toLocaleString()} existing items and shows how widely each is used, so you can pick the canonical part. If it truly does not exist, the last option creates it.</li>
        <li><b>Article</b>: markdown, with <code>[[part-id]]</code> to link other pages (use <code>[[part-id|shown text]]</code> to change the label). Links to pages that do not exist yet show red.</li>
        <li><b>Specs</b>: label and value rows for the infobox.</li>
      </ul>
      <p>As you type, the change bar lists what you have changed in plain language. That exact list is what reviewers and the page history show.</p>

      <h2 class="si-h">3. Propose</h2>
      <p>Press <b>Propose</b>. If you are new, your change goes to the <a href="/review">review queue</a>, where the analysis engine attaches findings and a reviewer accepts or rejects it. After ${TRUST_POLICY.autoconfirmEdits} accepted changes and ${TRUST_POLICY.autoconfirmDays} day(s), your edits publish immediately. See <a href="/policies">the live thresholds</a>.</p>

      <h2 class="si-h">4. After it is live</h2>
      <ul class="rv-lines">
        <li>Every page's <b>History</b> tab shows each revision with its author; any revision can be viewed or reverted.</li>
        <li><b>Watch</b> a page to see later changes to it on your <a href="/watchlist">watchlist</a>.</li>
        <li>Disagree with someone's edit? Use the page's <b>Discussion</b> tab. Facts are settled by evidence.</li>
      </ul>

      <h2 class="si-h">What makes a good edit</h2>
      <ul class="rv-lines">
        <li>Describe the built thing. Packaging, spares, and accessories belong on the product page, not inside assemblies.</li>
        <li>Prefer existing shared parts over creating near-duplicates; the picker's "used in N products" is the hint.</li>
        <li>If you know the page matches the real product, say how in the discussion; a reviewer can mark it <a href="/about/verification">human-verified</a>.</li>
        <li>Estimates stay labeled as estimates. That rule has no exceptions.</li>
      </ul>
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
