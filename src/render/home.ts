// The home page, ported from src/pages/index.astro: a McMaster-style product
// directory (image tiles grouped by domain, with an anchor rail) plus the
// Wikipedia-style portal boxes, all derived from the live catalog. The site's
// materialart module (commodity icons for raw-material tiles) has no engine
// counterpart, so those tiles fall back to nodeIcon like everything else.
import { esc } from '../html.ts';
import { nodeIcon } from '../icons.ts';
import { imageFor } from '../images.ts';
import { DOMAINS } from '../domains.ts';
import {
  allNodes,
  getNode,
  nodeCount,
  productList,
  productsByDomain,
  totalCatalogParts,
  totalParts,
  type NodeData,
  verificationOfNode,
} from '../nodes.ts';
import { getSetting, settingMeta } from '../site-settings.ts';
import { page } from './base.ts';

// Seed featured pool: used until reviewers curate their own via
// /admin/homepage (site_settings 'featured-pool'). The pool is editorial
// content with attribution, not code.
const DEFAULT_FEATURED_POOL = [
  'airliner',
  'reusable-launch-vehicle',
  'excavator',
  'espresso-machine',
  'smartphone',
];

interface HomeStats {
  nodeCountAtBuild: number;
  products: NodeData[];
  byProductId: Map<string, NodeData>;
  groups: { slug: string; name: string; ps: NodeData[] }[];
  largest: { p: NodeData; parts: number }[];
  mostReused: { n: NodeData; c: number }[];
  mostDistinct: { p: NodeData; c: number }[];
  deepest: { p: NodeData; d: number }[];
  rawMaterials: { p: NodeData; c: number }[];
}

// The portal stats need a full product-containment pass (every product's
// subtree), which is too heavy to redo per request. Computed lazily on the
// first homePage() call and reused until the graph changes; nodeCount() is
// the cheap staleness check (accepted edits that add/remove nodes bump it).
let cache: HomeStats | null = null;

function homeStats(): HomeStats {
  if (cache && cache.nodeCountAtBuild === nodeCount()) return cache;

  const products = productList();
  const byProductId = new Map(products.map((p) => [p.id, p]));
  const groups = DOMAINS.map((d) => ({ ...d, ps: productsByDomain(d.slug) })).filter(
    (d) => d.ps.length > 0,
  );

  // Product containment, mirroring src/lib/tree.ts's productNodes/nodeProducts:
  // walk each product's subtree once (per-product visited set guards revisits
  // and cycles), collecting node -> distinct-product count plus each product's
  // distinct-component count. Only the counts are kept, not the sets.
  const inProducts = new Map<string, number>();
  const distinctOf = new Map<string, number>();
  for (const p of products) {
    const sub = new Set<string>();
    const visited = new Set<string>([p.id]);
    const queue: string[] = [p.id];
    while (queue.length) {
      const id = queue.pop()!;
      for (const line of getNode(id)?.bom ?? []) {
        sub.add(line.id);
        if (!visited.has(line.id)) {
          visited.add(line.id);
          queue.push(line.id);
        }
      }
    }
    distinctOf.set(p.id, sub.size);
    for (const nid of sub) inProducts.set(nid, (inProducts.get(nid) ?? 0) + 1);
  }

  const largest = products
    .map((p) => ({ p, parts: totalParts(p.id) }))
    .sort((a, b) => b.parts - a.parts)
    .slice(0, 8);

  // Most-reused components: the leaves and sub-assemblies the most distinct
  // products bottom out in — the graph's hub analysis.
  const mostReused: { n: NodeData; c: number }[] = [];
  for (const n of allNodes()) {
    if (n.kind === 'product') continue;
    const c = inProducts.get(n.id) ?? 0;
    if (c > 1) mostReused.push({ n, c });
  }
  mostReused.sort((a, b) => b.c - a.c);
  mostReused.splice(10);

  const mostDistinct = products
    .map((p) => ({ p, c: distinctOf.get(p.id) ?? 0 }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 8);

  // Deepest bills of materials: longest product -> ... -> raw-material chain.
  // Memoized, cycle-guarded (a back-edge reads the provisional 0).
  const depthMemo = new Map<string, number>();
  const depthOf = (id: string): number => {
    const hit = depthMemo.get(id);
    if (hit !== undefined) return hit;
    depthMemo.set(id, 0);
    const kids = getNode(id)?.bom ?? [];
    const d = kids.length ? 1 + Math.max(...kids.map((line) => depthOf(line.id))) : 0;
    depthMemo.set(id, d);
    return d;
  };
  const deepest = products
    .map((p) => ({ p, d: depthOf(p.id) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 8);

  // The material layer: commodities ranked by how many products depend on them.
  const rawMaterials = productsByDomain('raw-materials')
    .map((p) => ({ p, c: inProducts.get(p.id) ?? 0 }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 8);

  cache = {
    nodeCountAtBuild: nodeCount(),
    products,
    byProductId,
    groups,
    largest,
    mostReused,
    mostDistinct,
    deepest,
    rawMaterials,
  };
  return cache;
}

const item = (id: string, name: string) => `<a href="/item/${id}/">${esc(name)}</a>`;

export async function homePage(): Promise<string> {
  const s = homeStats();
  const nc = nodeCount();
  const { products } = s;
  // Groups come fresh each render (not from the stats cache) so domain
  // curation at /admin/domains shows up immediately; the expensive
  // graph-wide stats stay cached.
  const groups = DOMAINS.map((d) => ({ ...d, ps: productsByDomain(d.slug) })).filter(
    (d) => d.ps.length > 0,
  );

  // Editorial content comes from site_settings, curated by reviewers with
  // attribution; the hardcoded values are only the pre-curation seed.
  const pool = await getSetting<string[]>('featured-pool', DEFAULT_FEATURED_POOL);
  const curatedFacts = await getSetting<string[]>('did-you-know', []);
  const poolMeta = await settingMeta('featured-pool');
  const welcome = await getSetting<{ title: string; subtitle: string }>('welcome', {
    title: 'Everything is BOM',
    subtitle:
      'Every product is exploded into the parts it is built from, down to individual screws, bearings, and cells.',
  });

  const featureDay = Math.floor(Date.now() / 86_400_000);
  const poolIds = pool.filter((id) => s.byProductId.has(id));
  const featured =
    (poolIds.length ? s.byProductId.get(poolIds[featureDay % poolIds.length]) : undefined) ??
    products[0];
  const featuredImg = featured ? imageFor(featured) : undefined;
  const featuredParts = featured ? totalParts(featured.id) : 0;
  const featuredLines = featured?.bom?.length ?? 0;

  // Numbers that come from rolled-up page data are stated as facts about
  // BOMwiki's mapping, rounded to two significant figures. Exact seven-digit
  // figures would claim a precision the underlying (largely unverified)
  // content does not have. Exact counts stay only for the wiki's own totals.
  const approx = (n: number): string => {
    if (n >= 1_000_000) return `about ${(Math.round(n / 100_000) / 10).toLocaleString()} million`;
    if (n >= 10_000) return `about ${(Math.round(n / 1000) * 1000).toLocaleString()}`;
    return `about ${n.toLocaleString()}`;
  };

  // Curated facts (reviewer-edited, plain text) lead; computed facts follow.
  // Facts naming specific items only appear when those items exist.
  const didYouKnow: string[] = curatedFacts.map((f) => esc(f));
  if (getNode('airliner'))
    didYouKnow.push(
      `that BOMwiki's ${item('airliner', 'commercial airliner')} page maps ${approx(totalParts('airliner'))} individual parts, down to each rivet`,
    );
  if (getNode('espresso-machine') && getNode('excavator'))
    didYouKnow.push(
      `that the same ball bearing is a single entry here, linked to every machine that uses it, so an ${item('espresso-machine', 'espresso machine')} and an ${item('excavator', 'excavator')} sit one click apart`,
    );
  if (s.largest[0])
    didYouKnow.push(
      `that the largest bill of materials on BOMwiki, the ${item(s.largest[0].p.id, s.largest[0].p.name.toLowerCase())}, rolls up to ${approx(s.largest[0].parts)} parts`,
    );
  if (getNode('smartphone'))
    didYouKnow.push(
      `that a ${item('smartphone', 'smartphone')}'s bill of materials runs all the way down to mined lithium, cobalt, and rare-earth ores`,
    );
  didYouKnow.push(
    `that BOMwiki maps ${totalCatalogParts.toLocaleString()} parts across ${nc.toLocaleString()} distinct items in ${groups.length} domains`,
  );

  // The summary comes from the page (largely unverified content), so it is
  // clamped to its first two sentences and the page's verification status is
  // shown beside the name. Curation controls are reviewer chrome: the link
  // is hidden until the session check confirms a reviewer is looking.
  const featSummary = (() => {
    const s2 = featured?.summary ?? '';
    const sentences = s2.match(/[^.!?]+[.!?]+/g) ?? [s2];
    const short = sentences.slice(0, 2).join(' ').trim();
    return short.length > 240 ? `${short.slice(0, 237).trimEnd()}…` : short;
  })();
  const featVerification = featured ? verificationOfNode(featured.id) : 'unverified';
  const featuredBox = featured
    ? `<section class="pbox feat">
        <h2 class="pbh">Featured product</h2>
        <div class="pbc">
          ${
            featuredImg
              ? `<a href="/item/${featured.id}/"><img class="featimg" src="${esc(featuredImg.thumb ?? featuredImg.url)}" alt="${esc(featured.name)}" width="150" height="98" loading="eager" fetchpriority="high" decoding="async" /></a>`
              : ''
          }
          <div class="feat-body">
            <p>
              <a href="/item/${featured.id}/"><strong>${esc(featured.name)}</strong></a>${
                featVerification !== 'human-verified'
                  ? ` <span class="vf-tag vf-${featVerification}">${featVerification}</span>`
                  : ''
              }. ${esc(featSummary)}
              Its bill of materials on BOMwiki rolls up to ${approx(featuredParts)} parts across ${featuredLines}
              top-level assemblies. <a href="/item/${featured.id}/">Full bill of materials →</a>
            </p>
            <p class="feat-meta">Featured product rotates daily · <a href="/home/talk">discuss</a><span id="bw-curate" hidden> · <a href="/admin/homepage">curate</a>${
              poolMeta
                ? ` · pool by <a href="/user/${esc(poolMeta.updatedBy)}">${esc(poolMeta.updatedBy)}</a>`
                : ''
            }</span></p>
          </div>
        </div>
      </section>
      <script>
        fetch('/api/session').then(function (r) { return r.json(); }).then(function (s) {
          var c = document.getElementById('bw-curate');
          if (c && (s.role === 'admin' || s.role === 'reviewer')) c.hidden = false;
        });
      </script>`
    : '';

  // The homepage explains what BOMwiki is and offers ways in. The full tile
  // directory (4,879 products, most of the old page's weight) lives at
  // /products; the stats boxes moved there with it.
  //
  // The old static site linked domains as /#<slug> anchors; those links are
  // still out in the wild. Fragments never reach the server, so the redirect
  // to the real domain page has to happen client side.
  const legacyHashRedirect = `<script>(function(){var d=${JSON.stringify(
    groups.map((g) => g.slug),
  )};var h=location.hash.slice(1);if(d.indexOf(h)>=0)location.replace('/domain/'+h+'/');})();</script>`;
  const body = `    ${legacyHashRedirect}<div class="wrap home-short">
      <div class="pane">
        <div class="welcome">
          <p class="wtitle">${esc(welcome.title)}</p>
          <p class="wsub">
            <strong>BOMwiki</strong> is the free <a href="/about/">bill-of-materials encyclopedia</a>.
            ${esc(welcome.subtitle)}
          </p>
          <p class="wedit">
            Anyone can edit. Changes from new contributors are reviewed before going live, and every
            page shows its <a href="/about/verification">verification status</a>.
            <a href="/about/">More about BOMwiki</a>.
          </p>
          <p class="wcounts">
            ${products.length.toLocaleString()} products · ${totalCatalogParts.toLocaleString()} parts mapped ·
            ${nc.toLocaleString()} items · ${groups.length} domains
          </p>
        </div>

        <div class="explain">
          <div class="exp">
            <h3>How a BOM page works</h3>
            <p>Open any product and its bill of materials unfolds: assemblies, sub-assemblies, parts, and quantities, all the way down. Every part is a single entry shared across the whole catalog, so a correction to one bearing fixes every machine that uses it.</p>
            <p class="exp-l">${getNode('airliner') ? `<a href="/item/airliner/">See the airliner &#8594;</a>` : `<a href="/random">Open a random product &#8594;</a>`}</p>
          </div>
          <div class="exp">
            <h3>Machine review on every change</h3>
            <p>Each proposed edit is checked by <b>BOM Intelligence</b>, a deterministic analysis engine. It rejects broken structure outright (cycles, dangling parts, nonsense quantities) and reads products as graphs of functions, so reviewers see machine findings beside every diff.</p>
            <p class="exp-l"><a href="/intelligence">How the engine works &#8594;</a></p>
          </div>
          <div class="exp">
            <h3>Verification is earned</h3>
            <p>Every page carries a status: unverified, machine-checked, or human-verified. Machine-checked means the graph is coherent; human-verified means a person checked it against evidence, and only those pages are offered to search engines.</p>
            <p class="exp-l"><a href="/about/verification">The verification system &#8594;</a></p>
          </div>
          <div class="exp">
            <h3>Edit it, get credit</h3>
            <p>Sign in with an email address and propose a change from any page's Edit button. New contributors' changes are reviewed first; after a few accepted changes you publish directly. Every revision is attributed to your public profile, so your work is visible and citable.</p>
            <p class="exp-l"><a href="/help/editing">How to edit &#8594;</a> · <a href="/login">Create an account &#8594;</a></p>
          </div>
        </div>

        <div class="portal">
          ${featuredBox}

          <section class="pbox">
            <h2 class="pbh">Did you know…</h2>
            <ul class="pbc dyk">
              ${didYouKnow.map((f) => `<li>… ${f}?</li>`).join('\n              ')}
            </ul>
          </section>

          <section class="pbox wide">
            <h2 class="pbh">
              Browse
              <a class="rndbtn" href="/random">Random product →</a>
            </h2>
            <ul class="pbc domgrid">
              ${groups.map((d) => `<li><a href="/domain/${d.slug}/">${esc(d.name)}</a> <span class="lp">${d.ps.length}</span></li>`).join('\n              ')}
            </ul>
            <p class="pbc note"><a href="/products">All ${products.length.toLocaleString()} products on one page →</a></p>
          </section>
        </div>
      </div>
    </div>`;

  const siteLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'BOMwiki',
    alternateName: 'the bill-of-materials encyclopedia',
    url: 'https://bomwiki.com/',
    description: `Explorable bills of materials for ${products.length.toLocaleString()} products, ${totalCatalogParts.toLocaleString()} parts mapped.`,
  };
  const orgLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'BOMwiki',
    url: 'https://bomwiki.com/',
    logo: 'https://bomwiki.com/favicon.png',
    description:
      'A free encyclopedia of bills of materials showing what products are made of, exploded down to atomic parts.',
    founder: { '@type': 'Person', name: 'Shashank Dixit', sameAs: 'https://x.com/protosphinx' },
    sameAs: ['https://x.com/protosphinx'],
  };

  return page({
    title: 'BOMwiki: Bill of Materials Encyclopedia | Everything Is BOM',
    description: `BOMwiki explodes any of ${products.length.toLocaleString()} products into its full bill of materials, ${totalCatalogParts.toLocaleString()} parts mapped, down to individual screws, bearings, and cells. Everything is BOM.`,
    path: '/',
    indexable: true,
    ogType: 'website',
    extraCss: ['/static/home.css'],
    jsonLd: [siteLd, orgLd],
    body,
  });
}

const tile = (p: NodeData, gi: number, pi: number): string => {
  const img = imageFor(p);
  const media = img
    ? `<img src="${esc(img.thumb ?? img.url)}" alt="" width="160" height="104" loading="${gi === 0 && pi < 6 ? 'eager' : 'lazy'}" decoding="async" />`
    : `<svg viewBox="0 0 96 96" role="img" aria-label="${esc(p.name)}">${nodeIcon(p)}</svg>`;
  return `<a class="t" href="/item/${p.id}/">
          ${media}
          <span class="tn">${esc(p.name)}</span>
          <span class="tm">${totalParts(p.id).toLocaleString()} parts</span>
        </a>`;
};

/** The full product directory: every product as an image tile, grouped by
 *  domain with an anchor rail, plus the graph-wide stats boxes. This is the
 *  old homepage's heavy half, one click away from the new short homepage. */
export function productsPage(): string {
  const s = homeStats();
  const nc = nodeCount();
  const { products } = s;
  const groups = DOMAINS.map((d) => ({ ...d, ps: productsByDomain(d.slug) })).filter(
    (d) => d.ps.length > 0,
  );
  const avgParts = products.length ? Math.round(totalCatalogParts / products.length) : 0;
  const maxDepth = s.deepest[0]?.d ?? 0;
  const topReused = s.mostReused[0];

  const body = `    <div class="wrap">
      <nav class="rail" aria-label="Domains">
        <p class="rail-h">Domains</p>
        <ul>
          ${groups.map((d) => `<li><a href="#${d.slug}">${esc(d.name)}</a> <span class="n">${d.ps.length}</span></li>`).join('\n          ')}
        </ul>
      </nav>

      <div class="pane">
        <div class="welcome">
          <p class="wtitle">All products</p>
          <p class="wcounts">
            ${products.length.toLocaleString()} products · ${totalCatalogParts.toLocaleString()} parts mapped ·
            ${nc.toLocaleString()} items · ${groups.length} domains · <a href="/random">random product →</a>
          </p>
        </div>

        <div class="portal">
          <section class="pbox">
            <h2 class="pbh">Most-reused components</h2>
            <p class="pbc note">The parts the most products bottom out in, the catalog's shared hubs.</p>
            <ol class="pbc ranklist">
              ${s.mostReused.map(({ n, c }) => `<li>${item(n.id, n.name)} <span class="lp">in ${c.toLocaleString()} products</span></li>`).join('\n              ')}
            </ol>
          </section>

          <section class="pbox">
            <h2 class="pbh">Most distinct components</h2>
            <p class="pbc note">Widest variety of unique part types, not just the most repeated parts.</p>
            <ol class="pbc ranklist">
              ${s.mostDistinct.map(({ p, c }) => `<li>${item(p.id, p.name)} <span class="lp">${c.toLocaleString()} distinct parts</span></li>`).join('\n              ')}
            </ol>
          </section>

          <section class="pbox">
            <h2 class="pbh">Down to raw materials</h2>
            <p class="pbc note">Every chain ends here. Commodities ranked by how many products depend on them.</p>
            <ol class="pbc ranklist">
              ${s.rawMaterials.map(({ p, c }) => `<li>${item(p.id, p.name)} <span class="lp">${c > 0 ? `in ${c.toLocaleString()} products` : 'material'}</span></li>`).join('\n              ')}
            </ol>
          </section>

          <section class="pbox">
            <h2 class="pbh">BOMwiki by the numbers</h2>
            <div class="pbc">
              <table class="nums">
                <tbody>
                  <tr><td>Products mapped</td><td>${products.length.toLocaleString()}</td></tr>
                  <tr><td>Total parts rolled up</td><td>${totalCatalogParts.toLocaleString()}</td></tr>
                  <tr><td>Distinct items in the graph</td><td>${nc.toLocaleString()}</td></tr>
                  <tr><td>Average parts per product</td><td>${avgParts.toLocaleString()}</td></tr>
                  <tr><td>Deepest bill of materials</td><td>${maxDepth} levels</td></tr>
                  ${topReused ? `<tr><td>Most-reused component</td><td>${esc(topReused.n.name)} (${topReused.c.toLocaleString()})</td></tr>` : ''}
                  <tr><td>Domains covered</td><td>${groups.length}</td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        ${groups
          .map(
            (d, gi) => `<section id="${d.slug}" class="dom">
          <h2><a class="da" href="/domain/${d.slug}/">${esc(d.name)}</a> <span class="dn">(${d.ps.length})</span></h2>
          <div class="tiles">
          ${d.ps.map((p, pi) => tile(p, gi, pi)).join('\n          ')}
          </div>
        </section>`,
          )
          .join('\n\n        ')}
      </div>
    </div>`;

  return page({
    title: 'All products | BOMwiki',
    description: `Every product on BOMwiki: ${products.length.toLocaleString()} bills of materials grouped by domain.`,
    path: '/products',
    indexable: true,
    ogType: 'website',
    body,
    extraCss: ['/static/home.css'],
  });
}
