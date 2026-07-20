// Item-page 3D model section, the model upload page, and the review-queue
// card for pending model submissions. Follows the item-extras.ts contract:
// section helpers return '<section>…</section>' or ''.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { esc, fmtWhen } from '../html.ts';
import { PUBLIC_DIR } from '../images.ts';
import {
  MODEL_LICENSES,
  type ItemModel,
  type ItemModelFile,
  type ModeledItem,
  type MyPendingModel,
  type PendingModel,
} from '../models.ts';
import { getNode, type NodeData } from '../nodes.ts';
import { page } from './base.ts';

export function fmtBytes(n: number): string {
  if (n < 1_000_000) return `${Math.max(1, Math.round(n / 1000))} KB`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)} MB`;
}

function licenseLink(license: string): string {
  const l = MODEL_LICENSES[license];
  if (!l) return esc(license);
  return `<a href="${l.url}" target="_blank" rel="license noopener">${esc(l.name)}</a>`;
}

function fileUrl(f: ItemModelFile): string {
  return `/models/${f.sha256}.${f.ext}`;
}

/** The "3D model" section. Always rendered on current (non-historical) item
 *  pages: with a model it carries the click-to-activate viewer and credits,
 *  without one it is the standing invitation to contribute — the layer's
 *  equivalent of the "Suggest a photo" line. */
export function modelSection(node: NodeData, model: ItemModel | null): string {
  const addUrl = `/item/${node.id}/model/upload`;
  const display = model?.display ?? null;
  const sources = model?.sources ?? [];

  const sourcesHtml =
    sources.length === 0
      ? ''
      : `<div class="mv-sources">
        <p class="mv-src-h">CAD source files</p>
        <ul>
          ${sources
            .map(
              (f) =>
                `<li><a href="${fileUrl(f)}" rel="nofollow">${f.ext === 'fcstd' ? 'FreeCAD' : f.ext === 'scad' ? 'OpenSCAD' : f.ext.toUpperCase()} (${fmtBytes(f.bytes)})</a> · ${licenseLink(f.license)} · ${esc(f.attribution)}</li>`,
            )
            .join('\n')}
        </ul>
      </div>`;

  if (!display && sources.length === 0) {
    return `<section class="cadsec">
        <div class="sec-head"><h2>3D model</h2></div>
        <p class="stub">No 3D model yet. Have a CAD file of this? <a href="${addUrl}">Add a 3D model</a> — STL renders right on this page; STEP, FreeCAD, and OpenSCAD sources are welcome too (openly licensed, like all <a href="/cad">3D models on BOMwiki</a>).</p>
      </section>`;
  }

  const poster = existsSync(join(PUBLIC_DIR, 'img', 'cad', `${node.id}.png`))
    ? `<img class="mv-poster" src="/img/cad/${node.id}.png" alt="" aria-hidden="true" loading="lazy" decoding="async" />`
    : '';
  const viewerHtml = !display
    ? ''
    : `<div class="mv-stage" id="bw-model-stage">
        ${poster}
        <button class="mv-activate" id="bw-model-activate" type="button">
          <span class="mv-cube" aria-hidden="true"></span>View in 3D
        </button>
        <p class="mv-hint">Loads the viewer and a ${fmtBytes(display.bytes)} model. Drag to rotate, scroll or pinch to zoom.</p>
      </div>
      <p class="mv-credit">3D model: ${esc(display.attribution)} · ${licenseLink(display.license)} · <a href="/cad/${node.id}">Open in CAD player</a> · <a href="${fileUrl(display)}" rel="nofollow">Download STL (${fmtBytes(display.bytes)})</a></p>`;

  const data = !display
    ? ''
    : `<script type="application/json" id="bw-model-data">${JSON.stringify({
        url: fileUrl(display),
        name: node.name,
        triangles: display.triangles,
        // Deliberately unversioned: STLLoader/OrbitControls import
        // './three.module.min.js' without a ?v, and module identity is by
        // exact URL — a versioned copy here would make the browser load a
        // second three instance alongside the loaders' one.
        three: '/static/vendor/three.module.min.js',
        stlLoader: '/static/vendor/STLLoader.js',
        orbitControls: '/static/vendor/OrbitControls.js',
      }).replaceAll('<', '\\u003c')}</script>`;

  return `<section class="cadsec">
        <div class="sec-head">
          <h2>3D model</h2>
          <span class="sec-n">${display ? 'interactive' : `${sources.length} source ${sources.length === 1 ? 'file' : 'files'}`} · <a href="${addUrl}">add or replace</a></span>
        </div>
        ${data}
        ${viewerHtml}
        ${sourcesHtml}
      </section>`;
}

/** The dedicated upload page (mirrors /new): uncached, adapts to sign-in
 *  state server-side, driven by static/model-upload.js. */
export function modelUploadPage(
  node: NodeData,
  signedIn: boolean,
  mine: MyPendingModel[],
): string {
  const mineHtml =
    mine.length === 0
      ? ''
      : `<h2 class="si-h">Your queued submissions for this page</h2>
      ${mine
        .map(
          (m) => `<section class="rv-cs"><div class="rv-head">
            <p class="rv-node"><a href="/models/${m.sha256}.${m.ext}" rel="nofollow">${m.ext.toUpperCase()} file</a> · ${esc(m.license)} · ${m.kind}</p>
            <span class="rv-meta">submitted ${fmtWhen(m.createdAt)} · awaiting review</span>
          </div>
          <div class="rv-actions"><form method="post" action="/model/${m.id}/withdraw"><button>Withdraw</button></form></div>
          </section>`,
        )
        .join('\n')}`;

  const form = `
      <div id="bw-model-upload">
      <script type="application/json" id="bw-upload-data">${JSON.stringify({
        nodeId: node.id,
        name: node.name,
      }).replaceAll('<', '\\u003c')}</script>
      <form class="settings-form" id="bw-mu-form">
        <label class="opt">CAD file
          <input type="file" name="file" id="bw-mu-file" accept=".stl,.step,.stp,.fcstd,.scad" required />
        </label>
        <p class="stub">STL (up to 50 MB, 1.5M triangles) becomes the page's interactive 3D view. STEP (50 MB), FreeCAD (25 MB), and OpenSCAD (1 MB) files are offered as downloads.</p>
        <fieldset class="mu-license">
          <legend>License for this contribution</legend>
          <label class="opt"><input type="radio" name="license" value="CC0" /> CC0 — public domain, no attribution required</label>
          <label class="opt"><input type="radio" name="license" value="CC-BY" checked /> CC BY 4.0 — reuse with attribution</label>
          <label class="opt"><input type="radio" name="license" value="CC-BY-SA" /> CC BY-SA 4.0 — attribution, share-alike</label>
        </fieldset>
        <label class="opt">Attribution name (shown in the credit line)
          <input type="text" name="attribution" id="bw-mu-attribution" maxlength="120" required />
        </label>
        <label class="opt">Note for reviewers (optional: source, measurement basis, version)
          <textarea name="note" id="bw-mu-note" maxlength="2000" rows="3"></textarea>
        </label>
        <label class="opt"><input type="checkbox" name="attest" id="bw-mu-attest" required /> This is my own work, or I am authorized to publish it under the selected license.</label>
        <div class="rv-actions"><button class="rv-accept" id="bw-mu-submit" type="submit">Upload and submit</button></div>
        <p class="rv-notice" id="bw-mu-status" hidden></p>
      </form>
      </div>
      <noscript><p class="rv-notice">Uploading a model needs JavaScript.</p></noscript>`;

  return page({
    title: `Add a 3D model: ${node.name} | BOMwiki`,
    description: `Contribute an openly licensed 3D model for ${node.name}.`,
    path: `/item/${node.id}/model/upload`,
    indexable: false,
    body: `<div class="review"><h1>Add a 3D model</h1>
      <p class="stub">For <a href="/item/${node.id}/">${esc(node.name)}</a>. Your first submissions go through review, same as edits; established contributors publish directly. By submitting you license the file to everyone under the license you pick below.</p>
      ${
        signedIn
          ? form + mineHtml
          : `<p class="stub"><a href="/login">Sign in</a> to add a model. Reading is open to everyone; contributing needs an account so every file has a name and a license behind it.</p>`
      }</div>`,
    extraCss: ['/static/edit.css', '/static/model.css'],
    scripts: signedIn ? ['/static/model-upload.js'] : [],
  });
}

/** The /cad hub: a visual gallery selling the model layer — thumbnail cards
 *  for every item with geometry, the story of how the seed set was built,
 *  and the contribute pitch. The site's linkable, indexable front door. */
export function cadHubPage(items: ModeledItem[], totalItems: number): string {
  const named = items
    .map((m) => ({ m, node: getNode(m.nodeId) }))
    .filter((x): x is { m: ModeledItem; node: NodeData } => Boolean(x.node))
    .sort((a, b) => a.node.name.localeCompare(b.node.name));

  const card = ({ m, node }: { m: ModeledItem; node: NodeData }): string => {
    const thumb = existsSync(join(PUBLIC_DIR, 'img', 'cad', `${node.id}.png`))
      ? `/img/cad/${node.id}.png`
      : null;
    const meta = m.display
      ? `${m.display.triangles ? `${(m.display.triangles / 1000).toFixed(m.display.triangles < 10_000 ? 1 : 0)}k triangles · ` : ''}${esc(m.display.license)}`
      : `${m.sourceCount} source ${m.sourceCount === 1 ? 'file' : 'files'}`;
    return `<a class="ch-card" href="/cad/${node.id}">
        <span class="ch-pic">${
          thumb
            ? `<img src="${thumb}" alt="3D model of ${esc(node.name)}" loading="lazy" decoding="async" width="480" height="360" />`
            : `<span class="ch-noshot" aria-hidden="true"></span>`
        }</span>
        <span class="ch-name">${esc(node.name)}</span>
        <span class="ch-meta">${meta} · spin it ↗</span>
      </a>`;
  };

  const gallery =
    named.length === 0
      ? `<p class="stub">Nothing yet — the first accepted model lands here.</p>`
      : `<div class="ch-grid">${named.map(card).join('\n')}</div>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: '3D models on BOMwiki',
    description:
      'Openly licensed 3D models and CAD source files attached to BOMwiki product, assembly, and part pages.',
    url: 'https://bomwiki.com/cad',
  };

  return page({
    title: '3D models & CAD files | BOMwiki',
    description:
      'Free, openly licensed 3D models for real hardware: spin them in the browser, download the STL, replace them with better ones. The CAD layer of the bill-of-materials encyclopedia.',
    path: '/cad',
    indexable: true,
    ogImage: '/og/page/cad.png',
    jsonLd: [jsonLd],
    body: `<div class="review cadhub"><h1>3D models</h1>
      <p class="ch-lede">An encyclopedia that tells you what a machine is made of should also <b>show you the parts</b>. That's this layer: real geometry on the pages of real hardware. Click a card, hit <b>View in 3D</b>, and grab it with your mouse — every model is openly licensed, so you can download the STL and use it for anything.</p>
      <p class="ch-lede"><a class="cp-dl cp-dl-main" href="/cad/studio">Open the CAD Studio <span>model something right now — free, in your browser, no signup</span></a></p>

      <h2 class="si-h">The collection <span class="rv-meta">${named.length.toLocaleString()} of ${totalItems.toLocaleString()} pages have geometry — help fix that ratio</span></h2>
      ${gallery}

      <h2 class="si-h">How the first models were built</h2>
      <p class="stub">The seed set is <b>parametric</b>: a generator script turns published dimensions — ISO&nbsp;4014 for the hex bolt, ISO&nbsp;4032 for its nut, a 608 bearing's 8×22×7&nbsp;mm envelope, a module-2 helical gear pair — into watertight STL meshes, and the same script can emit any size on demand. They are honest reference geometry with simplifications noted on each page (threads drawn as a helix, bearing cages omitted), published as <a href="https://creativecommons.org/publicdomain/zero/1.0/" rel="license noopener">CC0</a> so there is nothing to ask permission for. Modeled the real thing properly in FreeCAD or SolidWorks? <b>Replace them.</b> Upgrades go through the same review as any edit.</p>

      <h2 class="si-h">Put your parts in the encyclopedia</h2>
      <p class="stub">Open the page for anything you've modeled and use its <b>Add a 3D model</b> link. STL up to 50&nbsp;MB / 1.5M triangles renders in the viewer; STEP (50&nbsp;MB), FreeCAD (25&nbsp;MB), and OpenSCAD (1&nbsp;MB) ride along as source downloads. You pick the license — CC0, <a href="https://creativecommons.org/licenses/by/4.0/" rel="license noopener">CC&nbsp;BY</a>, or <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license noopener">CC&nbsp;BY-SA</a> — and your name goes in the credit line on the page, permanently. First submissions get human review, same trust ladder as edits. Not sure where to start? <a href="/products">Browse all products</a> or open a <a href="/random">random page</a> and see what's missing.</p>
    </div>`,
    extraCss: ['/static/edit.css', '/static/model.css'],
  });
}

/** A dedicated CAD player page at /cad/:id — the model is the whole point:
 *  auto-loading viewer, downloads, provenance, tools, and browsing through
 *  the collection. The item page stays the encyclopedia entry and links here. */
export function cadModelPage(
  node: NodeData,
  model: ItemModel,
  usedIn: { count: number; top: { id: string; name: string }[] } | null,
  prev: { id: string; name: string } | null,
  next: { id: string; name: string } | null,
): string {
  const display = model.display;
  const thumb = existsSync(join(PUBLIC_DIR, 'img', 'cad', `${node.id}.png`))
    ? `/img/cad/${node.id}.png`
    : null;

  const stage = display
    ? `<div class="mv-stage cp-stage" id="bw-model-stage" data-auto="1">
        ${thumb ? `<img class="mv-poster" src="${thumb}" alt="" aria-hidden="true" decoding="async" />` : ''}
        <button class="mv-activate" id="bw-model-activate" type="button">
          <span class="mv-cube" aria-hidden="true"></span>View in 3D
        </button>
        <p class="mv-hint">Drag to rotate · scroll or pinch to zoom</p>
      </div>
      <script type="application/json" id="bw-model-data">${JSON.stringify({
        url: fileUrl(display),
        name: node.name,
        triangles: display.triangles,
        three: '/static/vendor/three.module.min.js',
        stlLoader: '/static/vendor/STLLoader.js',
        orbitControls: '/static/vendor/OrbitControls.js',
      }).replaceAll('<', '\\u003c')}</script>`
    : `<div class="mv-stage cp-stage">${
        thumb
          ? `<img class="mv-poster" src="${thumb}" alt="Render of ${esc(node.name)}" decoding="async" />`
          : '<span class="ch-noshot" aria-hidden="true"></span>'
      }</div>`;

  const downloads = [
    ...(display
      ? [
          `<a class="cp-dl cp-dl-main" href="${fileUrl(display)}" rel="nofollow">Download STL <span>${fmtBytes(display.bytes)} · ${esc(display.license)}</span></a>`,
        ]
      : []),
    ...model.sources.map(
      (f) =>
        `<a class="cp-dl" href="${fileUrl(f)}" rel="nofollow">${f.ext === 'fcstd' ? 'FreeCAD source' : f.ext === 'scad' ? 'OpenSCAD source' : `${f.ext.toUpperCase()} source`} <span>${fmtBytes(f.bytes)} · ${esc(f.license)}</span></a>`,
    ),
  ].join('\n');

  const provenance = display ?? model.sources[0];
  const jsonLd = display
    ? [
        {
          '@context': 'https://schema.org',
          '@type': '3DModel',
          name: `${node.name} 3D model`,
          creator: { '@type': 'Person', name: provenance.attribution },
          license: MODEL_LICENSES[provenance.license]?.url,
          image: thumb ? `https://bomwiki.com${thumb}` : undefined,
          encoding: [
            {
              '@type': 'MediaObject',
              contentUrl: `https://bomwiki.com${fileUrl(display)}`,
              encodingFormat: 'model/stl',
            },
          ],
          isPartOf: 'https://bomwiki.com/cad',
        },
      ]
    : [];

  return page({
    title: `${node.name} 3D model — free ${display ? 'STL' : 'CAD file'} (${provenance.license}) | BOMwiki`,
    description: `Interactive 3D model of a ${node.name.toLowerCase()}: spin it in the browser, download the ${display ? 'STL' : 'CAD file'} free under ${provenance.license}, or contribute a better one. Part of BOMwiki's open CAD collection.`,
    path: `/cad/${node.id}`,
    indexable: true,
    ogImage: thumb ?? undefined,
    jsonLd,
    body: `<div class="review cadplayer">
      <nav class="trail"><a href="/cad">3D models</a><span class="sep">›</span><span class="cur">${esc(node.name)}</span></nav>
      <h1>${esc(node.name)} <span class="htag">3D model</span></h1>
      <p class="cp-meta">By ${esc(provenance.attribution)} · ${licenseLink(provenance.license)}${display?.triangles ? ` · ${display.triangles.toLocaleString()} triangles` : ''} · <a href="/item/${node.id}/">encyclopedia page: what it is and where it's used ›</a></p>
      ${stage}
      <div class="cp-downloads">${downloads}</div>
      ${provenance.note ? `<p class="stub cp-note">${esc(provenance.note)}</p>` : ''}
      ${
        usedIn && usedIn.count > 0
          ? `<p class="stub">This part appears in <b>${usedIn.count.toLocaleString()}</b> ${usedIn.count === 1 ? 'product' : 'products'} on BOMwiki, including ${usedIn.top
              .slice(0, 5)
              .map((p) => `<a href="/item/${p.id}/">${esc(p.name)}</a>`)
              .join(', ')}.</p>`
          : ''
      }
      <h2 class="si-h">Open it, remix it — with free tools</h2>
      <p class="stub">Every file here works with free software: <a href="https://www.freecad.org/" rel="noopener">FreeCAD</a> for parametric solid modeling, <a href="https://openscad.org/" rel="noopener">OpenSCAD</a> for code-driven parts, <a href="https://www.blender.org/" rel="noopener">Blender</a> for meshes. The license${MODEL_LICENSES[provenance.license] ? ` (${esc(MODEL_LICENSES[provenance.license].name)})` : ''} lets you print it, modify it, and ship it in your own projects.</p>
      <h2 class="si-h">Make it better</h2>
      <p class="stub">This is ${provenance.attribution === 'BOMwiki parametric' ? 'generated reference geometry — accurate to published dimensions, but not a substitute for a properly modeled part' : 'a community contribution'}. If you've modeled the real thing, <a href="/item/${node.id}/model/upload">upload your version</a>; accepted replacements take over this page with your name in the credit.</p>
      <nav class="cp-pager">
        ${prev ? `<a href="/cad/${prev.id}">‹ ${esc(prev.name)}</a>` : '<span></span>'}
        <a href="/cad">All 3D models</a>
        ${next ? `<a href="/cad/${next.id}">${esc(next.name)} ›</a>` : '<span></span>'}
      </nav>
    </div>`,
    extraCss: ['/static/edit.css', '/static/item.css', '/static/model.css'],
    scripts: display ? ['/static/model-viewer.js'] : [],
  });
}

// A deliberately small CAD-specific icon family. These stay inline so every
// command inherits the ribbon's currentColor in normal, hover, and active
// states without another asset request or an operating-system glyph fallback.
const STUDIO_ICON_PATHS = {
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.35 2.35 0 0 1 4.5 1c0 1.7-2.3 2-2.3 3.7"/><path d="M12 17.2h.01"/>',
  fullscreen: '<path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  circle: '<circle cx="12" cy="12" r="7.5"/>',
  polygon: '<path d="m12 3.8 8 6.2-3 9.2H7L4 10z"/>',
  select: '<path d="m5.5 3.5 11.2 9.8-5.3.8-2.8 5z"/><path d="m12.1 14 3 5.2"/>',
  pan: '<path d="M8.2 11V6.8a1.35 1.35 0 0 1 2.7 0V10m0-4.9a1.35 1.35 0 0 1 2.7 0V10m0-3.9a1.35 1.35 0 0 1 2.7 0v5m0-2.5a1.35 1.35 0 0 1 2.7 0v4.1c0 4.3-2.5 7.3-6.6 7.3h-.7c-2.1 0-3.3-.8-4.7-2.5L4.6 15a1.45 1.45 0 0 1 2.1-2z"/>',
  extrude: '<path d="M4 13.5h10v6H4z"/><path d="m4 13.5 4-3h10v6l-4 3"/><path d="M14 13.5v6M8 10.5V4m0 0L5.8 6.2M8 4l2.2 2.2"/>',
  cut: '<path d="m4 8.5 8-4 8 4-8 4z"/><path d="M4 8.5v8l8 4 8-4v-8M12 12.5v8"/><path d="M12 4.5v8m0 0-2.2-2.2m2.2 2.2 2.2-2.2"/>',
  revolve: '<path d="M11 4v16"/><path d="M9 7H6v10h3"/><path d="M14.5 6.2c3.1.8 5 2.8 5 5.8 0 2.5-1.4 4.4-3.8 5.4"/><path d="m15.4 14.7.3 2.7 2.6-.8"/>',
  fillet: '<path d="M5 19v-7a7 7 0 0 1 7-7h7"/><path d="M8.5 19v-6.5a4 4 0 0 1 4-4H19"/>',
  chamfer: '<path d="M5 19v-7l7-7h7"/><path d="M8.5 19v-5.5l5-5H19"/>',
  shell: '<path d="M5 5v11l7 4 7-4V5"/><path d="M8.5 7v7l3.5 2 3.5-2V7"/><path d="m5 5 7 4 7-4M8.5 7l3.5 2 3.5-2"/>',
  top: '<path d="m3.5 8 8.5-4.5L20.5 8 12 12.5z" fill="currentColor" opacity=".22"/><path d="m3.5 8 8.5-4.5L20.5 8 12 12.5zM3.5 8v8L12 20.5l8.5-4.5V8M12 12.5v8"/>',
  front: '<path d="m3.5 8 8.5 4.5v8L3.5 16z" fill="currentColor" opacity=".22"/><path d="m3.5 8 8.5-4.5L20.5 8 12 12.5zM3.5 8v8L12 20.5l8.5-4.5V8M12 12.5v8"/>',
  right: '<path d="m12 12.5 8.5-4.5v8L12 20.5z" fill="currentColor" opacity=".22"/><path d="m3.5 8 8.5-4.5L20.5 8 12 12.5zM3.5 8v8L12 20.5l8.5-4.5V8M12 12.5v8"/>',
  iso: '<path d="m3.5 8 8.5-4.5L20.5 8 12 12.5zM3.5 8v8L12 20.5l8.5-4.5V8M12 12.5v8"/><circle cx="12" cy="12.5" r="1" fill="currentColor" stroke="none"/>',
  fit: '<path d="M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4"/><path d="m8 10 4-2 4 2-4 2zM8 10v4l4 2 4-2v-4M12 12v4"/>',
  undo: '<path d="M9 7 5 11l4 4"/><path d="M5.5 11H14a5 5 0 0 1 5 5v2"/>',
  redo: '<path d="m15 7 4 4-4 4"/><path d="M18.5 11H10a5 5 0 0 0-5 5v2"/>',
  save: '<path d="M6 3.5h9l3 3V20H6z"/><path d="M9 3.5v5h6v-4M12 11v6m0 0-2.3-2.3M12 17l2.3-2.3"/>',
  open: '<path d="M3.5 7.5h6l2-2h9v12.8H3.5z"/><path d="M3.5 10h17M12 12v5m0-5-2 2m2-2 2 2"/>',
  clear: '<path d="M6 5h12M9 5V3.5h6V5M7.5 8v11.5h9V8"/><path d="m10 11 4 4m0-4-4 4"/>',
  step: '<path d="m4 8 8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8"/><path d="M17 12v5m0 0-2-2m2 2 2-2"/>',
  stl: '<path d="m4 18 8-14 8 14z"/><path d="m8 11 8 7m0-7-8 7M12 4v14"/><path d="M19 4v5m0 0-2-2m2 2 2-2"/>',
} as const;

type StudioIconName = keyof typeof STUDIO_ICON_PATHS;

function studioIcon(name: StudioIconName, className = 'wsr-i'): string {
  return `<span class="${className}" aria-hidden="true"><svg class="ws-icon" data-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" focusable="false">${STUDIO_ICON_PATHS[name]}</svg></span>`;
}

/** The CAD Studio: zero-signup solid modeling in the browser. The page is a
 *  static shell; static/studio.js is the whole application. */
export function cadStudioPage(): string {
  return page({
    title: 'CAD Studio — free browser CAD, no signup | BOMwiki',
    description:
      'Model real parts in your browser in seconds: drop shapes, cut holes, export STL. No account, no install, nothing to learn first. Free CAD for hobbyists from BOMwiki.',
    path: '/cad/studio',
    indexable: true,
    ogImage: '/og/page/cad-studio.png',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'BOMwiki CAD Studio',
        applicationCategory: 'DesignApplication',
        operatingSystem: 'Any (web browser)',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        url: 'https://bomwiki.com/cad/studio',
      },
    ],
    bodyClass: 'cadstudio-route',
    body: `<div class="cadstudio-app" id="studio">
      <header class="ws-appbar">
        <a class="ws-brand" href="/cad" aria-label="Back to BOMwiki 3D models">
          <span class="ws-brand-mark" aria-hidden="true">BW</span>
          <span><b>BOMwiki CAD</b><small>Parametric part studio</small></span>
        </a>
        <div class="ws-document" aria-label="Current document">
          <span class="ws-document-kind">PART</span>
          <span class="ws-project-name">Untitled part</span>
          <span class="ws-local"><i aria-hidden="true"></i> Local autosave</span>
        </div>
        <div class="ws-app-actions">
          <div class="ws-edit-actions" aria-label="Edit history">
            <button type="button" class="ws-quick-btn" id="bw-undo" title="Undo (Ctrl+Z)" aria-label="Undo">${studioIcon('undo', 'ws-quick-icon')}</button>
            <button type="button" class="ws-quick-btn" id="bw-redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${studioIcon('redo', 'ws-quick-icon')}</button>
          </div>
          <div class="ws-file-actions" id="bw-project-actions" aria-label="Project and export">
            <button type="button" class="ws-quick-btn ws-quick-labeled" id="bw-save-file" title="Download project file">${studioIcon('save', 'ws-quick-icon')}<span>Save</span></button>
            <button type="button" class="ws-quick-btn ws-quick-labeled" id="bw-open-btn" title="Open project file">${studioIcon('open', 'ws-quick-icon')}<span>Open</span></button>
            <input type="file" id="bw-open-file" accept=".json" hidden />
            <button type="button" class="ws-quick-btn" id="bw-clear" title="Clear part" aria-label="Clear part">${studioIcon('clear', 'ws-quick-icon')}<span class="ws-clear-label">Clear</span></button>
            <span class="ws-action-divider" aria-hidden="true"></span>
            <button type="button" class="ws-quick-btn ws-export-btn" id="bw-export-step" title="Export STEP"><span>STEP</span>${studioIcon('step', 'ws-quick-icon')}</button>
            <button type="button" class="ws-quick-btn ws-export-btn" id="bw-export-stl" title="Export STL"><span>STL</span>${studioIcon('stl', 'ws-quick-icon')}</button>
          </div>
          <button type="button" class="ws-quick-btn" id="bw-help-open" aria-label="Help" title="Help">${studioIcon('help', 'ws-quick-icon')}</button>
          <button type="button" class="ws-quick-btn" id="bw-fullscreen" aria-pressed="false" title="Full screen">
            ${studioIcon('fullscreen', 'ws-quick-icon')}<span class="ws-visually-hidden" id="bw-fullscreen-label">Full screen</span>
          </button>
        </div>
      </header>
      <section class="ws-ribbon" aria-label="CAD workspaces">
        <div class="ws-workspace-bar">
          <nav class="ws-workspaces" role="tablist" aria-label="Tool workspaces">
            <button type="button" role="tab" data-workspace="solid" aria-selected="true" aria-controls="ws-panel-solid">Solid</button>
            <button type="button" role="tab" data-workspace="sketch" aria-selected="false" aria-controls="ws-panel-sketch" disabled title="Available while editing a sketch">Sketch</button>
            <button type="button" role="tab" data-workspace="modify" aria-selected="false" aria-controls="ws-panel-modify">Modify</button>
            <button type="button" role="tab" data-workspace="inspect" aria-selected="false" aria-controls="ws-panel-inspect">Inspect</button>
          </nav>
          <div class="ws-workspace-state"><span aria-hidden="true"></span><b id="bw-workspace-name">Solid tools</b><small id="bw-workspace-hint">Create material from a profile</small></div>
        </div>
        <div class="ws-ribbon-panel" id="ws-panel-solid" role="tabpanel" data-workspace-panel="solid">
          <div class="ws-group">
            <span class="wsg-title">Create solid</span>
            <div class="wsg-tools">
              <button type="button" class="wsr-btn wsr-accent" data-feat="extrude" aria-pressed="false" title="Extrude a closed profile">${studioIcon('extrude')}<span class="wsr-label">Extrude</span><small>Raise profile</small></button>
              <button type="button" class="wsr-btn" data-feat="cut" aria-pressed="false" title="Remove material with a profile">${studioIcon('cut')}<span class="wsr-label">Cut</span><small>Remove material</small></button>
              <button type="button" class="wsr-btn" data-feat="revolve" aria-pressed="false" title="Revolve a profile around its axis">${studioIcon('revolve')}<span class="wsr-label">Revolve</span><small>Turn profile</small></button>
            </div>
          </div>
        </div>
        <div class="ws-ribbon-panel" id="ws-panel-sketch" role="tabpanel" data-workspace-panel="sketch" hidden>
          <div class="ws-group" id="rib-sketch" hidden>
            <span class="wsg-title">Draw and constrain</span>
            <div class="wsg-tools">
              <button type="button" class="wsr-btn" data-sktool="rect" aria-pressed="false">${studioIcon('rect')}<span class="wsr-label">Rectangle</span><small>Two corners</small></button>
              <button type="button" class="wsr-btn" data-sktool="circle" aria-pressed="false">${studioIcon('circle')}<span class="wsr-label">Circle</span><small>Centre + edge</small></button>
              <button type="button" class="wsr-btn" data-sktool="poly" aria-pressed="false">${studioIcon('polygon')}<span class="wsr-label">Polygon</span><small>Closed profile</small></button>
              <button type="button" class="wsr-btn" data-sktool="select" aria-pressed="false">${studioIcon('select')}<span class="wsr-label">Select</span><small>Edit geometry</small></button>
              <button type="button" class="wsr-btn" data-sktool="pan" aria-pressed="false">${studioIcon('pan')}<span class="wsr-label">Pan</span><small>Move canvas</small></button>
            </div>
          </div>
        </div>
        <div class="ws-ribbon-panel" id="ws-panel-modify" role="tabpanel" data-workspace-panel="modify" hidden>
          <div class="ws-group">
            <span class="wsg-title">Refine solid</span>
            <div class="wsg-tools">
              <button type="button" class="wsr-btn" data-feat="fillet" aria-pressed="false">${studioIcon('fillet')}<span class="wsr-label">Fillet</span><small>Round edges</small></button>
              <button type="button" class="wsr-btn" data-feat="chamfer" aria-pressed="false">${studioIcon('chamfer')}<span class="wsr-label">Chamfer</span><small>Bevel edges</small></button>
              <button type="button" class="wsr-btn" data-feat="shell" aria-pressed="false">${studioIcon('shell')}<span class="wsr-label">Shell</span><small>Hollow body</small></button>
            </div>
          </div>
        </div>
        <div class="ws-ribbon-panel" id="ws-panel-inspect" role="tabpanel" data-workspace-panel="inspect" hidden>
          <div class="ws-group">
            <span class="wsg-title">Orient and inspect</span>
            <div class="wsg-tools">
              <button type="button" class="wsr-btn" data-view="top" aria-pressed="false">${studioIcon('top')}<span class="wsr-label">Top</span><small>XY plane</small></button>
              <button type="button" class="wsr-btn" data-view="front" aria-pressed="false">${studioIcon('front')}<span class="wsr-label">Front</span><small>XZ plane</small></button>
              <button type="button" class="wsr-btn" data-view="right" aria-pressed="false">${studioIcon('right')}<span class="wsr-label">Right</span><small>YZ plane</small></button>
              <button type="button" class="wsr-btn" data-view="iso" aria-pressed="false">${studioIcon('iso')}<span class="wsr-label">Isometric</span><small>3D view</small></button>
              <button type="button" class="wsr-btn" data-view="fit" aria-pressed="false">${studioIcon('fit')}<span class="wsr-label">Fit</span><small>Frame part</small></button>
            </div>
          </div>
        </div>
      </section>
      <div class="ws-main">
        <aside class="ws-tree" id="bw-tree" aria-label="Model tree">
          <div class="ws-panel-cap"><span>MODEL</span><small id="bw-tree-summary">2 features</small></div>
          <div class="ws-tree-document">
            ${studioIcon('iso', 'ws-tree-icon')}
            <span><b>Untitled part</b><small>Parametric body</small></span>
          </div>
          <details class="ws-origin" open>
            <summary><span>Origin</span><small>Reference geometry</small></summary>
            <button type="button" id="bw-tree-base" title="Look normal to the base plane">
              ${studioIcon('top', 'ws-tree-icon')}<span>Base plane</span><kbd>XY</kbd>
            </button>
          </details>
          <div class="wsp wsp-grow wsp-history">
            <div class="wsp-head"><b>Feature history</b><span class="ws-tree-rule"></span></div>
            <div class="wsp-body">
              <ol id="bw-history" class="hist"></ol>
              <p id="bw-hist-empty" class="sk-note">No features yet. Start with Extrude.</p>
            </div>
          </div>
        </aside>
        <div id="bw-studio">
          <p id="bw-mode" class="mode-label" role="status" aria-live="polite"><span aria-hidden="true"></span>Ready</p>
          <div class="ws-viewcube" aria-label="View cube">
            <div class="ws-viewcube-shape">
              <button type="button" class="vc-face vc-top" data-cube-view="top" aria-label="Top view">TOP</button>
              <button type="button" class="vc-face vc-front" data-cube-view="front" aria-label="Front view">FRONT</button>
              <button type="button" class="vc-face vc-right" data-cube-view="right" aria-label="Right view">RIGHT</button>
            </div>
            <button type="button" class="vc-iso" data-cube-view="iso">ISO</button>
          </div>
          <div class="ws-nav-rail" role="toolbar" aria-label="Canvas navigation">
            <button type="button" data-nav-mode="orbit" aria-pressed="true" title="Orbit with left drag">${studioIcon('revolve', 'ws-hud-icon')}<span>Orbit</span></button>
            <button type="button" data-nav-mode="pan" aria-pressed="false" title="Pan with left drag">${studioIcon('pan', 'ws-hud-icon')}<span>Pan</span></button>
            <button type="button" data-cube-view="fit" title="Fit part (F)">${studioIcon('fit', 'ws-hud-icon')}<span>Fit</span></button>
          </div>
          <div class="ws-axis-triad" aria-label="World axes: X red, Y green, Z blue">
            <span class="axis-x">X</span><span class="axis-y">Y</span><span class="axis-z">Z</span><i aria-hidden="true"></i>
          </div>
          <section id="bw-welcome" class="ws-welcome" aria-labelledby="bw-welcome-title" hidden>
            <div class="ws-welcome-card">
              <p class="ws-welcome-kicker">New part</p>
              <h1 id="bw-welcome-title">Start with a sketch</h1>
              <p class="ws-welcome-lede">Draw a closed profile on the base plane, then turn it into a solid.</p>
              <ol class="ws-welcome-steps">
                <li><b>Choose Extrude</b><span>Starts a sketch on the base plane.</span></li>
                <li><b>Draw the profile</b><span>Place a rectangle, circle, or polygon.</span></li>
                <li><b>Set the height</b><span>Enter a dimension and apply the feature.</span></li>
              </ol>
              <div class="ws-welcome-actions">
                <button type="button" class="ws-primary" id="bw-welcome-start">Start sketch <span aria-hidden="true">→</span></button>
                <button type="button" id="bw-welcome-sample">Open example part</button>
                <button type="button" id="bw-welcome-open">Open a project</button>
              </div>
              <button type="button" class="ws-help-link" id="bw-welcome-help">Learn the controls</button>
            </div>
          </section>
          <div id="bw-face" class="pick-bar" hidden>
            <b id="bw-face-title"></b>
            <span class="sk-note">Click a flat face of the part, or step through them</span>
            <button type="button" id="bw-face-next">Next face</button>
            <button type="button" class="sr-accent" id="bw-face-use" hidden>✓ Use this face</button>
            <button type="button" id="bw-face-base">Use the base plane</button>
            <button type="button" id="bw-face-cancel">Cancel</button>
          </div>
          <div id="bw-shell" class="pick-bar" hidden>
            <b id="bw-shell-title"></b>
            <span class="sk-note">Click the faces to open up (or step through them)</span>
            <span id="bw-shell-count" class="sk-note">0 openings</span>
            <button type="button" id="bw-shell-next">Next face</button>
            <button type="button" id="bw-shell-toggle">Toggle this face</button>
            <label>Walls <input type="text" inputmode="decimal" id="bw-shell-t" value="2" /> mm</label>
            <button type="button" class="sr-accent" id="bw-shell-apply">✓ Apply</button>
            <button type="button" id="bw-shell-cancel">Cancel</button>
          </div>
          <div id="bw-pick" class="pick-bar" hidden>
            <b id="bw-pick-title"></b>
            <span class="sk-note">Click edges on the part to pick them</span>
            <span id="bw-pick-count" class="sk-note">0 picked</span>
            <label>Radius <input type="text" inputmode="decimal" id="bw-pick-r" value="2" /> mm</label>
            <button type="button" class="sr-accent" id="bw-pick-apply">✓ Apply</button>
            <button type="button" id="bw-pick-cancel">Cancel</button>
          </div>
          <p id="bw-studio-msg" hidden></p>
          <div id="bw-sketch" hidden>
            <div class="sk-top">
              <b id="bw-sk-title"></b>
              <span class="sk-op">
                <label id="bw-sk-h-row">Height <input type="text" inputmode="decimal" id="bw-sk-op-h" value="20" /> mm</label>
                <label id="bw-sk-through-row"><input type="checkbox" id="bw-sk-through" /> through all</label>
                <span id="bw-sk-pat-row">
                  <label>Pattern <select id="bw-sk-pat">
                    <option value="none">none</option>
                    <option value="linear">linear</option>
                    <option value="circular">circular</option>
                  </select></label>
                  <span id="bw-sk-pat-nums" hidden>
                    <label>× <input type="number" id="bw-sk-pat-n" value="4" min="2" max="100" step="1" /></label>
                    <label><span id="bw-sk-pat-la">ΔX</span> <input type="text" inputmode="decimal" id="bw-sk-pat-a" value="10" /></label>
                    <label><span id="bw-sk-pat-lb">ΔY</span> <input type="text" inputmode="decimal" id="bw-sk-pat-b" value="0" /></label>
                  </span>
                </span>
              </span>
              <span class="sk-actions">
                <button type="button" class="sr-accent" id="bw-sk-apply">✓ Apply</button>
                <button type="button" id="bw-sk-cancel">Cancel</button>
              </span>
            </div>
            <canvas id="bw-sketch-canvas"></canvas>
            <div class="sk-bottom">
              <span id="bw-sk-hint" class="sk-note"></span>
              <span id="bw-sk-dims"></span>
            </div>
          </div>
          <noscript><p class="mv-error">The studio needs JavaScript.</p></noscript>
        </div>
        <aside class="ws-side" id="bw-side" aria-label="Properties inspector">
          <div class="ws-panel-cap"><span>INSPECTOR</span><small>Selection properties</small></div>
          <div class="ws-inspector-empty" id="bw-inspector-empty">
            ${studioIcon('select', 'ws-inspector-empty-icon')}
            <b>No feature selected</b>
            <p>Choose a feature in the model tree to inspect dimensions, parameters, and rebuild state.</p>
          </div>
          <div class="wsp" id="bw-context-wrap" hidden>
            <div class="wsp-head"><b id="bw-inspector-kind">Feature properties</b><span class="ws-selection-live">LIVE</span></div>
            <div id="bw-context" class="wsp-body"></div>
          </div>
          <div class="wsp wsp-params wsp-grow">
            <div class="wsp-head"><span><b>Parameters</b><small>Reusable dimensions</small></span><button type="button" id="bw-param-add" title="Add parameter">＋</button></div>
            <div class="wsp-body"><div id="bw-params"></div></div>
          </div>
        </aside>
      </div>
      <div class="ws-mtabs" id="bw-mtabs">
        <button type="button" id="bw-mtab-history" aria-pressed="false">Model</button>
        <button type="button" id="bw-mtab-params" aria-pressed="false">Parameters</button>
        <button type="button" id="bw-mtab-project" aria-pressed="false">Project</button>
      </div>
      <div class="ws-cmd">
        <span class="ws-command-prompt" aria-hidden="true">›</span>
        <span id="bw-cmd-mode">Ready</span>
        <span id="bw-cmd-err" class="ws-cmd-err"></span>
        <span class="ws-command-help">Enter to apply · Esc to cancel</span>
        <span class="ws-cmd-actions" id="bw-cmd-actions" hidden>
          <button type="button" id="bw-cmd-apply">✓ Apply</button>
          <button type="button" id="bw-cmd-cancel">Cancel</button>
        </span>
      </div>
      <div class="ws-status">
        <span class="ws-status-mode">PART DESIGN</span>
        <span>mm</span>
        <span>Grid 1 mm · Angle 15°</span>
        <span id="bw-status-feat">0 features</span>
        <span class="ws-status-right"><span class="ws-kernel-state"><i aria-hidden="true"></i> Local kernel</span><button type="button" id="bw-help-status">Help</button><a href="/cad">Exit studio</a></span>
      </div>
      <dialog id="bw-help" class="ws-help" aria-labelledby="bw-help-title">
        <div class="ws-help-shell">
          <header class="ws-help-head">
            <div><span>Help</span><h2 id="bw-help-title">CAD Studio</h2></div>
            <button type="button" id="bw-help-close" aria-label="Close Help">×</button>
          </header>
          <div class="ws-help-body">
      <section class="cs-learn">
        <h3>Build your first part</h3>
        <ol class="cs-steps">
          <li><b>Start a sketch.</b> Choose <i>Extrude</i>, then use the base plane or select a flat face.</li>
          <li><b>Draw a closed profile.</b> Place a rectangle, circle, or polygon. Select it to type exact dimensions.</li>
          <li><b>Make it solid.</b> Enter the height and choose <i>Apply</i>. Every later feature appears in History.</li>
          <li><b>Cut or refine it.</b> Add holes with <i>Cut</i>; round edges with <i>Fillet</i>; hollow it with <i>Shell</i>.</li>
          <li><b>Export it.</b> Use <i>STEP</i> for other CAD tools or <i>STL</i> for a slicer.</li>
        </ol>
      </section>
      <section class="cs-help">
        <h3>Reference</h3>
        <div class="cs-cols">
          <div>
            <b>Sketching</b>
            <p>Rect and Circle: click two corners / centre then edge. Polygon: click each point, double-click to close. Select a shape to type exact X, Y, W, H or Ø in millimetres. Scroll to zoom the grid, Pan tool to move around.</p>
          </div>
          <div>
            <b>Features</b>
            <p>Extrude raises your sketch by a height. Cut removes material downward — "through all" drills the whole part. Revolve treats the sketch as a lathe profile: x is the radius from the axis, y is height, spun around the vertical. Fillet and Chamfer round or bevel edges; Shell hollows the part with picked opening faces. Patterns repeat a sketch as rows or rings. Define parameters (<code>wall = 2.5</code>) and type <code>wall*2</code> in any dimension — change the parameter and the whole part rebuilds.</p>
          </div>
          <div>
            <b>Your files</b>
            <p>The part autosaves in this browser. "Save file" downloads the project as JSON — keep it, email it, reopen it anywhere with "Open file". Export STEP or STL any time; both are yours, no watermarks, no license.</p>
          </div>
        </div>
      </section>
      <section class="cs-shortcuts">
        <h3>Keyboard</h3>
        <dl>
          <div><dt>Esc</dt><dd>Cancel the current operation</dd></div>
          <div><dt>Enter</dt><dd>Apply the current operation</dd></div>
          <div><dt>Ctrl / ⌘ Z</dt><dd>Undo</dd></div>
          <div><dt>Shift + Ctrl / ⌘ Z</dt><dd>Redo</dd></div>
          <div><dt>F</dt><dd>Fit the part to the view</dd></div>
          <div><dt>Delete</dt><dd>Delete the selected feature</dd></div>
        </dl>
      </section>
      <section class="cs-faq">
        <h3>Straight answers</h3>
        <p><b>Is it really free?</b> Yes. The studio is part of the open-source BOMwiki engine (AGPL-3.0). No tiers, no seat licenses, no expiring trial.</p>
        <p><b>Where does my design go?</b> Nowhere. Modeling happens entirely on your device; nothing is uploaded unless you choose to publish a model to a BOMwiki page.</p>
        <p><b>Will it replace Fusion or SolidWorks?</b> Not yet — there are no assemblies or technical drawings, and big models will feel heavy. What it does have is real: sketching on any flat face, fillets, chamfers, shell, patterns, named parameters, and undo/redo across everything. It's honest CAD for real parts — brackets, plates, spacers, knobs, lathe profiles — and the STEP files it makes are first-class citizens anywhere.</p>
        <p><b>What runs underneath?</b> OpenCascade, a 25-year-old industrial B-rep kernel, compiled to WebAssembly — plus <a href="https://replicad.xyz" rel="noopener">replicad</a> and three.js. <a href="https://github.com/BOMWiki/bomwiki" rel="noopener">Read the source</a>.</p>
        <p><b>Made something worth keeping?</b> <a href="/cad">Publish it to a BOMwiki page</a> — your name in the credit, your part in the encyclopedia.</p>
      </section>
          </div>
        </div>
      </dialog>
    </div>`,
    extraCss: ['/static/edit.css', '/static/model.css', '/static/studio.css'],
    scripts: ['/static/studio.js'],
  });
}

/** One pending model submission as a review-queue card. */
export function modelReviewCard(m: PendingModel): string {
  return `<section class="rv-cs">
      <div class="rv-head">
        <h2>Model #${m.id} · ${m.kind === 'display' ? 'STL for viewer' : `${m.ext.toUpperCase()} source file`}</h2>
        <span class="rv-meta">by <a href="/user/${esc(m.uploader)}">${esc(m.uploader)}</a> · ${fmtWhen(m.createdAt)}</span>
      </div>
      <div class="rv-edit">
        <p class="rv-node">For <a href="/item/${m.nodeId}/">${m.nodeId}</a> · <a href="/models/${m.sha256}.${m.ext}" rel="nofollow">inspect the file</a> (${fmtBytes(m.bytes)}${m.triangles ? `, ${m.triangles.toLocaleString()} triangles` : ''})</p>
        <ul class="rv-lines">
          <li>License ${esc(m.license)} · attribution "${esc(m.attribution)}"</li>
          ${m.note ? `<li>Note: ${esc(m.note)}</li>` : ''}
        </ul>
      </div>
      <div class="rv-actions">
        <form method="post" action="/review/model/${m.id}/accept"><button class="rv-accept">Accept</button></form>
        <form method="post" action="/review/model/${m.id}/reject"><button>Reject</button></form>
      </div>
    </section>`;
}
