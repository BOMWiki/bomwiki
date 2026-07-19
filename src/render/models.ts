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
    body: `<div class="review cadstudio">
      <nav class="trail"><a href="/cad">3D models</a><span class="sep">›</span><span class="cur">CAD Studio</span></nav>
      <section class="cs-hero">
        <div class="cs-hero-text">
          <h1>Design real parts, right in this tab</h1>
          <p class="cs-tag">Free parametric CAD on a real kernel (OpenCascade in WebAssembly). Sketch in mm, extrude, cut, revolve — export STEP and STL. No account, no install, works offline after the first load.</p>
        </div>
        <a class="cp-dl cp-dl-main cs-go" href="#studio">Start modeling</a>
      </section>
      <div class="studio-wrap" id="studio">
        <div class="studio-rail">
          <span class="sr-h">Add a feature</span>
          <button type="button" class="sr-accent" data-feat="extrude">⬒ Extrude</button>
          <button type="button" data-feat="cut">⛶ Cut</button>
          <button type="button" data-feat="revolve">◎ Revolve</button>
          <button type="button" data-feat="fillet">◠ Fillet</button>
          <button type="button" data-feat="chamfer">⟋ Chamfer</button>
          <span class="sr-h">History</span>
          <ol id="bw-history" class="hist"></ol>
          <p id="bw-hist-empty" class="sk-note">No features yet. Start with Extrude.</p>
          <span class="sr-h">Export</span>
          <button type="button" class="sr-accent" id="bw-export-step">⭳ STEP (CAD)</button>
          <button type="button" id="bw-export-stl">⭳ STL (print)</button>
          <span class="sr-h">Project</span>
          <button type="button" id="bw-save-file">Save file</button>
          <label class="sr-file">Open file<input type="file" id="bw-open-file" accept=".json" hidden /></label>
          <button type="button" id="bw-clear">Clear</button>
        </div>
        <div id="bw-studio">
          <div id="bw-face" class="pick-bar" hidden>
            <b id="bw-face-title"></b>
            <span class="sk-note">Click a flat face of the part, or step through them</span>
            <button type="button" id="bw-face-next">Next face</button>
            <button type="button" class="sr-accent" id="bw-face-use" hidden>✓ Use this face</button>
            <button type="button" id="bw-face-base">Use the base plane</button>
            <button type="button" id="bw-face-cancel">Cancel</button>
          </div>
          <div id="bw-pick" class="pick-bar" hidden>
            <b id="bw-pick-title"></b>
            <span class="sk-note">Click edges on the part to pick them</span>
            <span id="bw-pick-count" class="sk-note">0 picked</span>
            <label>Radius <input type="number" id="bw-pick-r" value="2" step="0.5" min="0.1" /> mm</label>
            <button type="button" class="sr-accent" id="bw-pick-apply">✓ Apply</button>
            <button type="button" id="bw-pick-cancel">Cancel</button>
          </div>
          <p id="bw-studio-msg" hidden></p>
          <div id="bw-sketch" hidden>
            <div class="sk-top">
              <b id="bw-sk-title"></b>
              <span class="sk-tools">
                <button type="button" data-sktool="rect">▭ Rect</button>
                <button type="button" data-sktool="circle">◯ Circle</button>
                <button type="button" data-sktool="poly">△ Polygon</button>
                <button type="button" data-sktool="select">☝ Select</button>
                <button type="button" data-sktool="pan">✋ Pan</button>
              </span>
              <span class="sk-op">
                <label id="bw-sk-h-row">Height <input type="number" id="bw-sk-op-h" value="20" step="1" /> mm</label>
                <label id="bw-sk-through-row"><input type="checkbox" id="bw-sk-through" /> through all</label>
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
      </div>
      <section class="cs-learn">
        <h2 class="si-h">Your first part in two minutes</h2>
        <ol class="cs-steps">
          <li><b>Look at the starter part.</b> The studio opens with a 40&nbsp;mm plate with a hole through it — two features you can inspect: <i>1.&nbsp;Extrude</i> and <i>2.&nbsp;Cut</i> in the History panel.</li>
          <li><b>Change a number.</b> Hit <i>Edit</i> on the Extrude, click the rectangle, type a new width, Apply. The part rebuilds. That's what parametric means — the model is the recipe, not the result.</li>
          <li><b>Add your own feature.</b> Click <i>Extrude</i>, draw a rectangle with two clicks, type the height, Apply. It fuses into the part.</li>
          <li><b>Drill it.</b> Click <i>Cut</i>, draw a circle where the hole goes, tick <i>through all</i>, Apply.</li>
          <li><b>Ship it.</b> <i>STL</i> goes straight to a 3D printer. <i>STEP</i> opens in FreeCAD, SolidWorks, or Fusion when you graduate to bigger tools — nothing you make here is locked in.</li>
        </ol>
      </section>
      <section class="cs-help">
        <h2 class="si-h">Reference</h2>
        <div class="cs-cols">
          <div>
            <b>Sketching</b>
            <p>Rect and Circle: click two corners / centre then edge. Polygon: click each point, double-click to close. Select a shape to type exact X, Y, W, H or Ø in millimetres. Scroll to zoom the grid, Pan tool to move around.</p>
          </div>
          <div>
            <b>Features</b>
            <p>Extrude raises your sketch by a height. Cut removes material downward — "through all" drills the whole part. Revolve treats the sketch as a lathe profile: x is the radius from the axis, y is height, spun around the vertical. Fillet and Chamfer round or bevel edges: click the edges on the part, type a radius, Apply.</p>
          </div>
          <div>
            <b>Your files</b>
            <p>The part autosaves in this browser. "Save file" downloads the project as JSON — keep it, email it, reopen it anywhere with "Open file". Export STEP or STL any time; both are yours, no watermarks, no license.</p>
          </div>
        </div>
      </section>
      <section class="cs-faq">
        <h2 class="si-h">Straight answers</h2>
        <p><b>Is it really free?</b> Yes. The studio is part of the open-source BOMwiki engine (AGPL-3.0). No tiers, no seat licenses, no expiring trial.</p>
        <p><b>Where does my design go?</b> Nowhere. Modeling happens entirely on your device; nothing is uploaded unless you choose to publish a model to a BOMwiki page.</p>
        <p><b>Will it replace Fusion or SolidWorks?</b> Not yet — there's no sketch-on-face or assemblies today, and big models will feel heavy. It's honest CAD for real parts: brackets, plates, spacers, knobs, lathe profiles, now with fillets and chamfers. The STEP files it makes are first-class citizens anywhere.</p>
        <p><b>What runs underneath?</b> OpenCascade, a 25-year-old industrial B-rep kernel, compiled to WebAssembly — plus <a href="https://replicad.xyz" rel="noopener">replicad</a> and three.js. <a href="https://github.com/BOMWiki/bomwiki" rel="noopener">Read the source</a>.</p>
        <p><b>Made something worth keeping?</b> <a href="/cad">Publish it to a BOMwiki page</a> — your name in the credit, your part in the encyclopedia.</p>
      </section>
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
