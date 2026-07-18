// Item-page 3D model section, the model upload page, and the review-queue
// card for pending model submissions. Follows the item-extras.ts contract:
// section helpers return '<section>…</section>' or ''.
import { esc, fmtWhen } from '../html.ts';
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

  const viewerHtml = !display
    ? ''
    : `<div class="mv-stage" id="bw-model-stage">
        <button class="mv-activate" id="bw-model-activate" type="button">
          <span class="mv-cube" aria-hidden="true"></span>View in 3D
        </button>
        <p class="mv-hint">Loads the viewer and a ${fmtBytes(display.bytes)} model. Drag to rotate, scroll or pinch to zoom.</p>
      </div>
      <p class="mv-credit">3D model: ${esc(display.attribution)} · ${licenseLink(display.license)} · <a href="${fileUrl(display)}" rel="nofollow">Download STL (${fmtBytes(display.bytes)})</a>${display.triangles ? ` · ${display.triangles.toLocaleString()} triangles` : ''}</p>`;

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

/** The /cad hub: what the model layer is, every item that has one, and how
 *  to contribute. The site's linkable, indexable front door for CAD. */
export function cadHubPage(items: ModeledItem[], totalItems: number): string {
  const named = items
    .map((m) => ({ m, node: getNode(m.nodeId) }))
    .filter((x): x is { m: ModeledItem; node: NodeData } => Boolean(x.node))
    .sort((a, b) => a.node.name.localeCompare(b.node.name));

  const listHtml =
    named.length === 0
      ? `<p class="stub">No models yet — the layer is brand new. The first accepted contribution will be listed here.</p>`
      : `<p class="pn-list">${named
          .map(({ m, node }) => {
            const bits = [
              m.display ? `viewable` : '',
              m.sourceCount ? `${m.sourceCount} source ${m.sourceCount === 1 ? 'file' : 'files'}` : '',
              m.display?.license ?? '',
            ]
              .filter(Boolean)
              .join(', ');
            return `<a href="/item/${node.id}/">${esc(node.name)}</a> <span class="rv-meta">(${bits})</span>`;
          })
          .join(' · ')}</p>`;

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
      'Openly licensed 3D models and CAD files for the products, assemblies, and parts on BOMwiki. View STL models in the browser, download STEP and FreeCAD sources, or contribute your own.',
    path: '/cad',
    indexable: true,
    jsonLd: [jsonLd],
    body: `<div class="review"><h1>3D models</h1>
      <p class="stub">BOMwiki pages can carry an openly licensed 3D model next to their bill of materials. STL models render right on the page in an interactive viewer; STEP, FreeCAD, and OpenSCAD source files are offered as downloads. Every model names its author and carries a <a href="https://creativecommons.org/publicdomain/zero/1.0/" rel="license noopener">CC0</a>, <a href="https://creativecommons.org/licenses/by/4.0/" rel="license noopener">CC&nbsp;BY</a>, or <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license noopener">CC&nbsp;BY-SA</a> license, so everything here is free to reuse.</p>

      <h2 class="si-h">Items with 3D models <span class="rv-meta">(${named.length.toLocaleString()} of ${totalItems.toLocaleString()} pages)</span></h2>
      ${listHtml}

      <h2 class="si-h">Contribute a model</h2>
      <p class="stub">Open the page for something you have modeled and use its <b>Add a 3D model</b> link (in the 3D model section). Uploads need an account; your first submissions go through review, the same trust ladder as edits. Accepted formats: STL up to 50&nbsp;MB and 1.5&nbsp;million triangles for the viewer, STEP up to 50&nbsp;MB, FreeCAD up to 25&nbsp;MB, and OpenSCAD up to 1&nbsp;MB as source downloads. You pick the license and attribution at upload. Not sure where to start? <a href="/products">Browse all products</a> or open a <a href="/random">random page</a>.</p>
    </div>`,
    extraCss: ['/static/edit.css'],
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
