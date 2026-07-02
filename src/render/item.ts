// The item page, ported from src/pages/item/[slug].astro. Milestone-1 scope:
// trail, title, infobox, article stub, BOM table, used-in chips. The build
// graph, galleries, vendor sourcing, and written articles follow in later
// slices; their sections are simply absent until then.
import { esc } from '../html.ts';
import { nodeIcon } from '../icons.ts';
import {
  currentRev,
  flattenBom,
  lineCount,
  parents,
  primaryPath,
  totalParts,
  type NodeData,
} from '../nodes.ts';
import { isIndexableNode, seoDescription, seoTitle } from '../seo.ts';
import { page } from './base.ts';
import { rail } from './rail.ts';

const KIND_LABEL = { product: 'Product', assembly: 'Assembly', part: 'Part' } as const;

export interface ItemPageOpts {
  /** Render a historical revision read-only with a banner. */
  asOfRev?: number;
}

export function itemPage(node: NodeData, opts: ItemPageOpts = {}): string {
  const kindLabel = KIND_LABEL[node.kind];
  const trail = primaryPath(node.id);
  const lines = lineCount(node.id);
  const tp = totalParts(node.id);
  const ups = parents(node.id);
  const bomRows = flattenBom(node.id, 3);

  const trailHtml = trail
    .map((t, i) =>
      i === trail.length - 1
        ? `<span class="sep">›</span><span class="cur">${esc(t.name)}</span>`
        : `<span class="sep">›</span><a href="/item/${t.id}/">${esc(t.name)}</a>`,
    )
    .join('');

  const specs = [
    ...(lines > 0 ? [`<tr><th>Direct parts</th><td>${lines}</td></tr>`] : []),
    ...(node.kind !== 'part'
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
  ].join('');

  const bomHtml =
    bomRows.length === 0
      ? ''
      : `<section class="bom">
        <div class="sec-head">
          <h2>Bill of materials</h2>
          <span class="sec-n">${lines} top-level ${lines === 1 ? 'line' : 'lines'} · ${bomRows.length} rows shown · ${tp.toLocaleString()} parts total · indented to 3 levels</span>
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

  const usedInHtml =
    ups.length === 0
      ? ''
      : `<section class="usedin">
        <h2>Used in ${ups.length} ${ups.length === 1 ? 'assembly' : 'assemblies'}</h2>
        <div class="chips">
          ${ups
            .map(
              (u) =>
                `<a class="chip" href="/item/${u.id}/"><svg viewBox="0 0 96 96">${nodeIcon(u)}</svg><span>${esc(u.name)}</span></a>`,
            )
            .join('\n')}
        </div>
      </section>`;

  const railDomain = trail[0]?.kind === 'product' ? trail[0].domain : node.domain;

  const historical = opts.asOfRev !== undefined;
  const editData = historical
    ? ''
    : `<script type="application/json" id="bw-edit-data">${JSON.stringify({
        id: node.id,
        rev: currentRev(node.id),
        data: (({ id, ...data }) => data)(node),
      }).replaceAll('<', '\\u003c')}</script>`;
  const banner = historical
    ? `<p class="rev-banner">You are viewing r${opts.asOfRev} of this page, not the current version. <a href="/item/${node.id}/">Go to current</a> · <a href="/item/${node.id}/history">history</a></p>`
    : '';
  const actions = historical
    ? ''
    : `<div class="page-actions">
          <a class="pa-btn" href="/item/${node.id}/history">History</a>
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
        <aside class="infobox">
          <svg class="ib-img ib-svg" viewBox="0 0 96 96" role="img" aria-label="${esc(node.name)}">${nodeIcon(node)}</svg>
          ${node.summary ? `<p class="ib-cap">${esc(node.summary)}</p>` : ''}
          <table class="ib-specs"><tbody>${specs}</tbody></table>
        </aside>
        <div class="article">
          <p class="stub">${node.summary ? esc(node.summary) + ' ' : ''}A full specification article for this item is being written. Meanwhile its bill of materials and connections are below.</p>
        </div>
        ${bomHtml}
        ${usedInHtml}
      </div>
    </div>`;

  return page({
    title: seoTitle(node),
    description: seoDescription(node),
    path: `/item/${node.id}/`,
    indexable: isIndexableNode(node),
    body,
    extraCss: ['/static/item.css', '/static/rail.css', '/static/edit.css'],
    scripts: historical ? [] : ['/static/edit.js'],
  });
}
