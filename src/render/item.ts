// The item page, ported from src/pages/item/[slug].astro. Milestone-1 scope:
// trail, title, infobox, article stub, BOM table, used-in chips. The build
// graph, galleries, vendor sourcing, and written articles follow in later
// slices; their sections are simply absent until then.
import { esc } from '../html.ts';
import { nodeIcon } from '../icons.ts';
import {
  currentRev,
  flattenBom,
  getNode,
  lineCount,
  parents,
  primaryPath,
  totalParts,
  verificationOfNode,
  type BomRow,
  type NodeData,
} from '../nodes.ts';
import { snapshotOf } from '../changesets.ts';
import { imageFor, ogCardPath } from '../images.ts';
import { articleWordCount, renderArticle } from '../markdown.ts';
import type { ItemModel } from '../models.ts';
import { graphSection } from './graph-section.ts';
import { gallerySection, sourcingSection } from './item-extras.ts';
import { modelSection } from './models.ts';
import { isIndexableNode, seoDescription, seoTitle } from '../seo.ts';
import { page } from './base.ts';
import { rail } from './rail.ts';

const KIND_LABEL = { product: 'Product', assembly: 'Assembly', part: 'Part' } as const;

export interface ItemPageOpts {
  /** Render a historical revision read-only with a banner. */
  asOfRev?: number;
  /** Transitive where-used from the FFS graph sidecar; null/absent hides the line. */
  productsUsing?: { count: number; top: { id: string; name: string }[] } | null;
  /** Accepted 3D model + source files for this node; null/absent renders the
   *  "Add a 3D model" invitation instead of the viewer. */
  model?: ItemModel | null;
}

export function itemPage(node: NodeData, opts: ItemPageOpts = {}): string {
  const historical = opts.asOfRev !== undefined;
  const kindLabel = KIND_LABEL[node.kind];
  const trail = primaryPath(node.id);
  // For a historical revision, everything must come from the snapshot itself —
  // the live graph reflects the current version. We render this revision's own
  // BOM lines (one level; names resolved from current nodes where they still
  // exist), and omit live-graph-derived figures (total parts, used-in) that
  // can't be reconstructed as-of a past date.
  const lines = historical ? (node.bom?.length ?? 0) : lineCount(node.id);
  const tp = historical ? 0 : totalParts(node.id);
  const ups = historical ? [] : parents(node.id);
  const bomRows = historical
    ? (node.bom ?? []).map((line, i): BomRow => {
        const child = getNode(line.id);
        return {
          num: `${i + 1}`,
          level: 1,
          node: child ?? { id: line.id, name: line.id, kind: 'part' },
          qty: line.qty,
          ext: line.qty,
          childLines: child ? lineCount(child.id) : 0,
          subtreeParts: 0,
          hasMore: false,
        };
      })
    : flattenBom(node.id, 3);

  const trailHtml = trail
    .map((t, i) =>
      i === trail.length - 1
        ? `<span class="sep">›</span><span class="cur">${esc(t.name)}</span>`
        : `<span class="sep">›</span><a href="/item/${t.id}/">${esc(t.name)}</a>`,
    )
    .join('');

  const specs = [
    ...(node.specs ?? []).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`),
    ...(lines > 0 ? [`<tr><th>Direct parts</th><td>${lines}</td></tr>`] : []),
    ...(!historical && node.kind !== 'part'
      ? [`<tr><th>Total parts</th><td>${tp.toLocaleString()}</td></tr>`]
      : []),
    ...(node.material ? [`<tr><th>Material</th><td>${esc(node.material)}</td></tr>`] : []),
    ...(node.standard ? [`<tr><th>Standard</th><td>${esc(node.standard)}</td></tr>`] : []),
    ...(ups.length > 0
      ? [
          `<tr><th>Used in</th><td>${ups.length} ${ups.length === 1 ? 'assembly' : 'assemblies'}</td></tr>`,
        ]
      : []),
    `<tr><th>Class</th><td>${kindLabel}</td></tr>`,
    ...(!historical
      ? [
          `<tr><th>Status</th><td><span class="vf-tag vf-${verificationOfNode(node.id)}">${verificationOfNode(node.id)}</span></td></tr>`,
        ]
      : []),
  ].join('');

  const bomHtml =
    bomRows.length === 0
      ? ''
      : `<section class="bom">
        <div class="sec-head">
          <h2>Bill of materials for ${esc(node.name)}</h2>
          <span class="sec-n">${
            historical
              ? `${lines} top-level ${lines === 1 ? 'line' : 'lines'} as of r${opts.asOfRev}`
              : `${lines} top-level ${lines === 1 ? 'line' : 'lines'} · ${bomRows.length} rows shown · ${tp.toLocaleString()} parts total · indented to 3 levels`
          }</span>
        </div>
        <div class="bom-scroll">
          <table class="bomtable">
            <thead>
              <tr>
                <th class="c-num">#</th>
                <th>Item / sub-assembly</th>
                <th class="c-pn">Part no.</th>
                <th class="num c-qty">Qty/assy</th>
                <th class="num c-ext">Ext. qty</th>
                <th class="num c-parts">Parts</th>
                <th class="c-type">Type</th>
              </tr>
            </thead>
            <tbody>
              ${bomRows
                .map(
                  (r) => `<tr class="lvl${r.level} ${r.node.kind}">
                <td class="c-num bnum">${r.num}</td>
                <td class="bitem">
                  <span class="indent" style="width:${(r.level - 1) * 22}px"></span>
                  <svg class="rthumb" viewBox="0 0 96 96">${nodeIcon(r.node)}</svg>
                  <a href="/item/${r.node.id}/" class="rname">${esc(r.node.name)}</a>
                  ${r.childLines > 0 ? `<span class="sub">${r.childLines} parts</span>` : ''}
                  ${r.hasMore ? `<a class="more" href="/item/${r.node.id}/">+ deeper ›</a>` : ''}
                </td>
                <td class="c-pn mono">${r.node.id}</td>
                <td class="num c-qty">${r.qty}×</td>
                <td class="num c-ext">${r.ext.toLocaleString()}</td>
                <td class="num c-parts">${r.node.kind === 'part' ? '·' : r.subtreeParts.toLocaleString()}</td>
                <td class="c-type"><span class="tb ${r.node.kind}">${r.node.kind}</span></td>
              </tr>`,
                )
                .join('\n')}
            </tbody>
          </table>
        </div>
      </section>`;

  const pu = opts.productsUsing;
  const appearsHtml =
    !pu || node.kind === 'product'
      ? ''
      : `<p class="usedin-products">Appears in <b>${pu.count.toLocaleString()}</b> ${pu.count === 1 ? 'product' : 'products'}: ${pu.top
          .map((p) => `<a href="/item/${p.id}/">${esc(p.name)}</a>`)
          .join(', ')}${pu.count > pu.top.length ? `, and ${(pu.count - pu.top.length).toLocaleString()} more` : ''}. <span class="uip-src">Graph query · <a href="/project/engine">how this is computed</a></span></p>`;

  const usedInHtml =
    ups.length === 0 && !appearsHtml
      ? ''
      : `<section class="usedin">
        ${
          ups.length === 0
            ? ''
            : `<h2>Used in ${ups.length} ${ups.length === 1 ? 'assembly' : 'assemblies'}</h2>
        <div class="chips">
          ${ups
            .map(
              (u) =>
                `<a class="chip" href="/item/${u.id}/"><svg viewBox="0 0 96 96">${nodeIcon(u)}</svg><span>${esc(u.name)}</span></a>`,
            )
            .join('\n')}
        </div>`
        }
        ${appearsHtml}
      </section>`;

  const railDomain = trail[0]?.kind === 'product' ? trail[0].domain : node.domain;
  const heroImg = imageFor(node);

  const editData = historical
    ? ''
    : `<script type="application/json" id="bw-edit-data">${JSON.stringify({
        id: node.id,
        rev: currentRev(node.id),
        data: snapshotOf(node),
        // Display names for the node's BOM children, so the editor labels
        // rows from data instead of scraping the rendered table.
        names: Object.fromEntries(
          (node.bom ?? []).map((line) => [line.id, getNode(line.id)?.name ?? line.id]),
        ),
      }).replaceAll('<', '\\u003c')}</script>`;
  const verification = verificationOfNode(node.id);
  const verifyBanner = historical
    ? ''
    : verification === 'human-verified'
      ? ''
      : verification === 'machine-checked'
        ? `<p class="vf-banner vf-machine">Machine-checked by <a href="/user/steward-bot">steward-bot</a>, not yet human-verified: consistency checks pass, but a person hasn't confirmed it against the real thing (<a href="/about/verification">what this means</a>). <a href="/item/${node.id}/talk">Discuss</a> or verify it below if you know this hardware.</p>`
        : `<p class="vf-banner vf-none">This page is machine-generated and unverified (<a href="/about/verification">what this means</a>). Treat details as provisional. If you know this hardware, <a href="/item/${node.id}/talk">weigh in</a> or correct it directly with Edit.</p>`;
  const verifyForm = historical
    ? ''
    : `<form method="post" action="/item/${node.id}/verify" class="vf-form" id="bw-verify-form" hidden>
        <span class="vf-h">Set verification (reviewers)</span>
        <select name="status">
          <option value="human-verified">human-verified</option>
          <option value="machine-checked">machine-checked</option>
          <option value="unverified">unverified</option>
        </select>
        <input type="text" name="note" placeholder="Evidence: standard, teardown, source URL…" />
        <button>Save</button>
      </form>`;
  const banner = historical
    ? `<p class="rev-banner">You are viewing r${opts.asOfRev} of this page, not the current version. <a href="/item/${node.id}/">Go to current</a> · <a href="/item/${node.id}/history">history</a></p>`
    : verifyBanner;
  const actions = historical
    ? ''
    : `<div class="page-actions">
          <a class="pa-btn" href="/item/${node.id}/talk">Discussion</a>
          <a class="pa-btn" href="/item/${node.id}/history">History</a>
          <form method="post" action="/item/${node.id}/watch" class="pa-form"><button class="pa-btn">Watch</button></form>
          <button class="pa-btn" type="button" id="bw-edit-btn" hidden>Edit this page</button>
        </div>`;

  const body = `      <div class="explorer">
      ${rail(node.kind === 'product' ? node.id : undefined, railDomain)}
      <div class="pane">
        ${editData}
        ${banner}
        <nav class="trail"><a href="/">Products</a>${trailHtml}</nav>
        ${actions}
        <h1 class="wtitle">${esc(node.name)} <span class="htag ${node.kind}">${kindLabel}</span></h1>
        ${node.aliases?.length ? `<p class="aka">Also known as: ${node.aliases.map((a) => esc(a)).join(', ')}</p>` : ''}
        <aside class="infobox">
          ${
            heroImg
              ? `<a class="ib-imglink" href="${esc(heroImg.page ?? heroImg.url)}" target="_blank" rel="noopener" title="Photo: ${esc(heroImg.title)} (Wikimedia Commons)">
            <img class="ib-img" src="${esc(heroImg.thumb ?? heroImg.url)}" alt="${esc(node.name)}" width="240" height="168" loading="eager" fetchpriority="high" decoding="async" />
            <span class="ib-credit">${esc(heroImg.title)} · Commons ↗</span>
          </a>
          <a class="ib-report" href="/item/${node.id}/talk?topic=photo">Report photo</a>`
              : `<svg class="ib-img ib-svg" viewBox="0 0 96 96" role="img" aria-label="${esc(node.name)}">${nodeIcon(node)}</svg>
          ${historical ? '' : `<p class="ib-nophoto">No photo yet. Seen one of these? <a href="/item/${node.id}/talk?topic=add-photo">Suggest a photo</a>.</p>`}`
          }
          ${node.summary ? `<p class="ib-cap">${esc(node.summary)}</p>` : ''}
          <table class="ib-specs"><tbody>${specs}</tbody></table>
          ${verifyForm}
        </aside>
        <div class="article">
          ${
            node.article
              ? `<div class="prose">${renderArticle(node.article)}</div>`
              : `<p class="stub">${node.summary ? esc(node.summary) + ' ' : ''}A full specification article for this item is being written. Meanwhile its bill of materials and connections are below.</p>`
          }
        </div>
        ${historical ? '' : gallerySection(node.id)}
        ${historical ? '' : modelSection(node, opts.model ?? null)}
        ${historical ? '' : graphSection(node)}
        ${bomHtml}
        ${usedInHtml}
        ${historical ? '' : sourcingSection(node)}
        ${node.article ? `<p class="wc">${articleWordCount(node.article).toLocaleString()}-word article</p>` : ''}
      </div>
    </div>`;

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Products', item: 'https://bomwiki.com/' },
      ...trail.map((t, i) => ({
        '@type': 'ListItem',
        position: i + 2,
        name: t.name,
        item: `https://bomwiki.com/item/${t.id}/`,
      })),
    ],
  };

  return page({
    title: seoTitle(node),
    description: seoDescription(node),
    path: `/item/${node.id}/`,
    indexable: isIndexableNode(node),
    ogType: 'article',
    ogImage: ogCardPath(node.id),
    jsonLd: historical ? [] : [breadcrumbLd],
    body,
    extraCss: [
      '/static/item.css',
      '/static/rail.css',
      '/static/edit.css',
      ...(historical ? [] : ['/static/model.css']),
    ],
    scripts: historical
      ? []
      : [
          '/static/edit.js',
          '/static/graph.js',
          // The viewer script is a tiny activator; three.js itself loads only
          // on click. Included only when there is a model to view.
          ...(opts.model?.display ? ['/static/model-viewer.js'] : []),
        ],
  });
}
