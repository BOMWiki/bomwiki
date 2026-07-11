import { asset } from '../assets.ts';

// The camera scan page, ported from the retired static site's scan.astro.
// It is a self-contained full-viewport shell (own topbar and close button),
// so it skips the site chrome entirely. The client script drives the camera,
// captures a still, and POSTs it to /api/photo-bom.
export function scanPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="description" content="Scan a physical object and match it to a BOMwiki bill of materials." />
    <title>Scan an object | BOMwiki</title>
    <link rel="canonical" href="https://bomwiki.com/scan/" />
    <meta name="robots" content="noindex,follow" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${asset('/static/base.css')}" />
    <link rel="stylesheet" href="${asset('/static/scan.css')}" />
  </head>
  <body>
  <section class="scan-shell" id="scanShell" data-state="starting">
    <header class="scan-top">
      <a class="scan-brand" href="/" aria-label="BOMwiki home">
        <span class="b-name">BOMwiki</span>
        <span class="b-sub">object scanner</span>
      </a>
      <div class="scan-readout" aria-live="polite">
        <span id="scanMode">Starting camera</span>
        <b id="scanReadout"></b>
      </div>
      <button class="scan-close" id="closeScan" type="button">Close</button>
    </header>

    <div class="scan-body">
    <div class="scan-stage" id="dropZone">
      <video id="scanVideo" autoplay muted playsinline></video>
      <img id="scanPhoto" alt="Captured object" hidden />
      <canvas id="scanHud" aria-hidden="true"></canvas>

      <div class="scan-guide" aria-hidden="true">
        <span class="g-corner g-tl"></span>
        <span class="g-corner g-tr"></span>
        <span class="g-corner g-bl"></span>
        <span class="g-corner g-br"></span>
      </div>

      <div class="scan-status">
        <p id="scanStatus">Point the camera at one object</p>
        <div class="lock-meter" aria-hidden="true"><span id="lockFill"></span></div>
      </div>

      <div class="scan-controls">
        <button class="tool-btn" id="uploadBtn" type="button">Upload</button>
        <button class="shutter" id="shutterBtn" type="button" aria-label="Capture object"><span></span></button>
        <button class="tool-btn" id="retakeBtn" type="button">Retake</button>
      </div>

      <input id="fileInput" type="file" accept="image/*" capture="environment" hidden />
    </div>

    <aside class="scan-result" id="resultPanel" aria-live="polite">
      <div class="result-handle" aria-hidden="true"></div>
      <div class="result-empty" id="resultEmpty">
        <p class="result-k">BOM preview</p>
        <h1>Hold an object in the frame.</h1>
        <p>The scanner will lock on, take one still image, and match it to BOMwiki.</p>
      </div>

      <div class="result-loading" id="resultLoading" hidden>
        <p class="result-k">Analyzing</p>
        <h2>Reading the object shape.</h2>
        <div class="pulse-bar" aria-hidden="true"><span></span></div>
      </div>

      <div class="result-error" id="resultError" hidden>
        <p class="result-k">Scan paused</p>
        <h2 id="errorTitle">Scanner unavailable</h2>
        <p id="errorText">Try uploading a clearer photo.</p>
        <div class="error-actions">
          <button class="secondary-action" id="errorUpload" type="button">Upload photo</button>
          <button class="secondary-action" id="errorRetake" type="button">Retake</button>
        </div>
      </div>

      <div class="result-match" id="resultMatch" hidden>
        <p class="result-k" id="resultKind">Match</p>
        <h2 id="matchTitle">Object</h2>
        <p class="match-summary" id="matchSummary"></p>
        <div class="match-stats">
          <span><b id="matchConfidence">0%</b> confidence</span>
          <span><b id="matchParts">0</b> parts</span>
          <span><b id="matchLines">0</b> top lines</span>
        </div>
        <div class="match-actions">
          <a class="primary-action" id="openFullBom" href="/">Open full BOM</a>
          <button class="secondary-action" id="panelRetake" type="button">Retake</button>
        </div>
        <div class="bom-preview" id="bomPreview"></div>
        <div class="alternates" id="alternates"></div>
        <p class="clues" id="scanClues"></p>
      </div>
    </aside>
    </div>
  </section>
  <script src="${asset('/static/scan.js')}" defer></script>
  </body>
</html>
`;
}
