// Camera scan page: lock onto one object, capture a still, and match it to
// the catalog via POST /api/photo-bom. Ported from the retired static site's
// scan.astro; same behavior, plain JS.
const shell = document.getElementById('scanShell');
const video = document.getElementById('scanVideo');
const photo = document.getElementById('scanPhoto');
const hud = document.getElementById('scanHud');
const ctx = hud.getContext('2d');
const guide = document.querySelector('.scan-guide');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const shutterBtn = document.getElementById('shutterBtn');
const retakeBtn = document.getElementById('retakeBtn');
const panelRetake = document.getElementById('panelRetake');
const closeScan = document.getElementById('closeScan');
const scanStatus = document.getElementById('scanStatus');
const scanMode = document.getElementById('scanMode');
const scanReadout = document.getElementById('scanReadout');
const lockFill = document.getElementById('lockFill');
const resultEmpty = document.getElementById('resultEmpty');
const resultLoading = document.getElementById('resultLoading');
const resultError = document.getElementById('resultError');
const resultMatch = document.getElementById('resultMatch');
const errorUpload = document.getElementById('errorUpload');
const errorRetake = document.getElementById('errorRetake');
const errorTitle = document.getElementById('errorTitle');
const errorText = document.getElementById('errorText');
const resultKind = document.getElementById('resultKind');
const matchTitle = document.getElementById('matchTitle');
const matchSummary = document.getElementById('matchSummary');
const matchConfidence = document.getElementById('matchConfidence');
const matchParts = document.getElementById('matchParts');
const matchLines = document.getElementById('matchLines');
const openFullBom = document.getElementById('openFullBom');
const bomPreview = document.getElementById('bomPreview');
const alternates = document.getElementById('alternates');
const scanClues = document.getElementById('scanClues');
const dropZone = document.getElementById('dropZone');

const sample = document.createElement('canvas');
sample.width = 72;
sample.height = 54;
const sx = sample.getContext('2d', { willReadFrequently: true });

let stream = null;
let raf = 0;
let lastFrame = performance.now();
let lastSample = 0;
let prevLuma = null;
let lock = 0;
let lockedOnce = false;
let lastBox = null;
let analyzing = false;

function setMode(mode, readout = '') {
  scanMode.textContent = mode;
  scanReadout.textContent = readout;
}

function setStatus(text) {
  scanStatus.textContent = text;
}

function setState(state) {
  shell.dataset.state = state;
}

function showPanel(which) {
  resultEmpty.hidden = which !== 'empty';
  resultLoading.hidden = which !== 'loading';
  resultError.hidden = which !== 'error';
  resultMatch.hidden = which !== 'match';
}

function syncCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = hud.getBoundingClientRect();
  hud.width = Math.max(1, Math.floor(rect.width * dpr));
  hud.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function targetRect() {
  const w = hud.clientWidth;
  const h = hud.clientHeight;
  if (w <= 860) {
    const topPad = Math.max(112, h * 0.13);
    const bottomPad = Math.max(172, h * 0.22);
    const availH = Math.max(260, h - topPad - bottomPad);
    const boxW = Math.min(w - 42, 420, availH * 0.86);
    const boxH = Math.min(availH, Math.max(260, boxW * 1.06));
    const y = topPad + Math.max(0, (availH - boxH) * 0.38);
    return { x: (w - boxW) / 2, y, w: boxW, h: boxH };
  }
  const aspect = h > w ? 1.05 : 0.88;
  const maxW = Math.min(w * 0.84, 900);
  const maxH = Math.min(h * 0.68, 760);
  let boxW = maxW;
  let boxH = boxW * aspect;
  if (boxH > maxH) {
    boxH = maxH;
    boxW = boxH / aspect;
  }
  let y = (h - boxH) / 2 - 12;
  y = Math.max(74, Math.min(y, Math.max(74, h - boxH - 154)));
  return { x: (w - boxW) / 2, y, w: boxW, h: boxH };
}

function syncGuide(t) {
  guide.style.setProperty('--guide-x', `${t.x}px`);
  guide.style.setProperty('--guide-y', `${t.y}px`);
  guide.style.setProperty('--guide-w', `${t.w}px`);
  guide.style.setProperty('--guide-h', `${t.h}px`);
}

function drawHud() {
  const w = hud.clientWidth;
  const h = hud.clientHeight;
  ctx.clearRect(0, 0, w, h);
  const t = targetRect();
  syncGuide(t);

  // Dim everything outside the target frame; the frame itself stays clear.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(0, 0, w, h);
  ctx.clearRect(t.x, t.y, t.w, t.h);

  if (lastBox) {
    const bx = t.x + lastBox.x * t.w;
    const by = t.y + lastBox.y * t.h;
    const bw = lastBox.w * t.w;
    const bh = lastBox.h * t.h;
    ctx.strokeStyle = lock > 0.55 ? 'rgba(90, 200, 160, 0.95)' : 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 10);
    ctx.stroke();
  }
}

function sampleFrame(now, dt) {
  if (now - lastSample < 90 || video.readyState < 2 || analyzing || lockedOnce) return;
  lastSample = now;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  const cropW = Math.floor(vw * 0.62);
  const cropH = Math.floor(vh * 0.46);
  const cropX = Math.floor((vw - cropW) / 2);
  const cropY = Math.floor((vh - cropH) / 2);
  sx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, sample.width, sample.height);
  const data = sx.getImageData(0, 0, sample.width, sample.height).data;
  const luma = new Uint8ClampedArray(sample.width * sample.height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    luma[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }

  let strong = 0;
  let motion = 0;
  let minX = sample.width;
  let minY = sample.height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 1; y < sample.height - 1; y++) {
    for (let x = 1; x < sample.width - 1; x++) {
      const idx = y * sample.width + x;
      const gx = Math.abs(luma[idx - 1] - luma[idx + 1]);
      const gy = Math.abs(luma[idx - sample.width] - luma[idx + sample.width]);
      const g = gx + gy;
      if (g > 46) {
        strong++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      if (prevLuma) motion += Math.abs(luma[idx] - prevLuma[idx]);
    }
  }
  const pixels = (sample.width - 2) * (sample.height - 2);
  const edgeScore = strong / pixels;
  const motionScore = prevLuma ? motion / pixels / 255 : 0.02;
  prevLuma = luma;

  if (strong > 12) {
    const pad = 5;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(sample.width, maxX + pad);
    maxY = Math.min(sample.height, maxY + pad);
    lastBox = {
      x: minX / sample.width,
      y: minY / sample.height,
      w: Math.max(0.16, (maxX - minX) / sample.width),
      h: Math.max(0.18, (maxY - minY) / sample.height),
      score: edgeScore,
    };
  }

  const usefulBox = lastBox && lastBox.w * lastBox.h > 0.08;
  const isStable = edgeScore > 0.045 && motionScore < 0.06 && usefulBox;
  if (isStable) {
    lock = Math.min(1, lock + dt / 1600);
    setStatus(lock > 0.75 ? 'Object lock. Capturing.' : 'Hold steady');
  } else {
    lock = Math.max(0, lock - dt / 850);
    setStatus(edgeScore > 0.035 ? 'Center the object and hold still' : 'Point at one object');
  }
  lockFill.style.width = `${Math.round(lock * 100)}%`;
  scanReadout.textContent = `${Math.round(lock * 100)}%`;

  if (lock >= 1 && !lockedOnce) {
    lockedOnce = true;
    void captureFrame('auto');
  }
}

function loop(now) {
  const dt = Math.min(80, now - lastFrame);
  lastFrame = now;
  sampleFrame(now, dt);
  drawHud();
  raf = requestAnimationFrame(loop);
}

async function startCamera() {
  setState('camera');
  showPanel('empty');
  setMode('Camera', '0%');
  setStatus('Point the camera at one object');
  photo.hidden = true;
  video.hidden = false;
  lock = 0;
  lockedOnce = false;
  analyzing = false;
  prevLuma = null;
  lastBox = null;
  lockFill.style.width = '0%';

  if (!navigator.mediaDevices?.getUserMedia) {
    showError('Camera not available', 'Upload a photo from this device instead.');
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    showError('Camera blocked', 'Allow camera access, or upload a photo.');
  }
}

function stopCamera() {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
}

async function captureFrame(source) {
  if (analyzing || video.readyState < 2) return;
  analyzing = true;
  setState('captured');
  setMode(source === 'auto' ? 'Auto capture' : 'Manual capture', '100%');
  setStatus('Image captured');
  const fullDataUrl = resizeVideoFrame(video, 1280);
  const target = resizeVideoTarget(video, 1280);
  photo.src = fullDataUrl;
  photo.hidden = false;
  video.hidden = true;
  stopCamera();
  await analyze(target.dataUrl, { source, width: target.width, height: target.height, crop: target.crop });
}

function resizeVideoFrame(source, maxSide) {
  const w = source.videoWidth || 1280;
  const h = source.videoHeight || 720;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.84);
}

function resizeVideoTarget(source, maxSide) {
  const vw = source.videoWidth || 1280;
  const vh = source.videoHeight || 720;
  const stageW = Math.max(1, hud.clientWidth || source.clientWidth || 1280);
  const stageH = Math.max(1, hud.clientHeight || source.clientHeight || 720);
  const frame = targetRect();
  const scaleToCss = Math.max(stageW / vw, stageH / vh);
  const drawnW = vw * scaleToCss;
  const drawnH = vh * scaleToCss;
  const offsetX = (stageW - drawnW) / 2;
  const offsetY = (stageH - drawnH) / 2;

  const pad = 0.08;
  const cssX = frame.x - frame.w * pad;
  const cssY = frame.y - frame.h * pad;
  const cssW = frame.w * (1 + pad * 2);
  const cssH = frame.h * (1 + pad * 2);
  const sx0 = (cssX - offsetX) / scaleToCss;
  const sy0 = (cssY - offsetY) / scaleToCss;
  const sx1 = (cssX + cssW - offsetX) / scaleToCss;
  const sy1 = (cssY + cssH - offsetY) / scaleToCss;

  const cx = Math.max(0, Math.min(vw - 1, sx0));
  const cy = Math.max(0, Math.min(vh - 1, sy0));
  const cw = Math.max(1, Math.min(vw - cx, sx1 - cx));
  const ch = Math.max(1, Math.min(vh - cy, sy1 - cy));
  const outScale = Math.min(1, maxSide / Math.max(cw, ch));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(cw * outScale));
  c.height = Math.max(1, Math.round(ch * outScale));
  c.getContext('2d').drawImage(source, cx, cy, cw, ch, 0, 0, c.width, c.height);
  return { dataUrl: c.toDataURL('image/jpeg', 0.86), width: c.width, height: c.height, crop: 'scan-target' };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function resizeFile(file, maxSide) {
  const src = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await loadImage(src);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { dataUrl: c.toDataURL('image/jpeg', 0.84), width: c.width, height: c.height };
}

function apiUrl() {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return local && location.port !== '4400' ? 'http://127.0.0.1:8787/api/photo-bom' : '/api/photo-bom';
}

async function analyze(imageDataUrl, hints) {
  setState('analyzing');
  showPanel('loading');
  setMode('Analyzing', '');
  setStatus('Matching to BOMwiki');

  try {
    const response = await fetch(apiUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        imageDataUrl,
        clientHints: {
          ...hints,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          platform: navigator.platform,
        },
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.status === 'error') {
      throw new Error((data && data.message) || `Scanner service returned ${response.status}`);
    }
    renderResult(data);
  } catch (err) {
    const friendly = friendlyAnalyzeError(err);
    showError(friendly.title, friendly.text);
  } finally {
    analyzing = false;
  }
}

function friendlyAnalyzeError(err) {
  const message = err instanceof Error ? err.message : '';
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return {
      title: 'Scanner API is offline',
      text: 'The scanner service is not reachable from this page.',
    };
  }
  if (/404|not found|scanner service returned/i.test(message)) {
    return {
      title: 'Scanner API is not connected',
      text: 'The scanner service did not accept the request. Try again in a minute.',
    };
  }
  return {
    title: 'Could not analyze image',
    text: message || 'The scanner service did not respond.',
  };
}

function showError(title, text) {
  setState('error');
  showPanel('error');
  setMode('Upload ready', '');
  setStatus('Upload or retake');
  errorTitle.textContent = title;
  errorText.textContent = text;
}

function pct(v) {
  return `${Math.max(0, Math.min(100, Math.round((v ?? 0) * 100)))}%`;
}

function renderResult(data) {
  const matches = data.matches ?? [];
  const best = matches[0];
  if (!best) {
    showError('No confident match', data.object ? `Try another angle of the ${data.object}.` : 'Try a clearer photo with one object centered.');
    return;
  }

  setState('result');
  showPanel('match');
  if (data.status !== 'matched') {
    resultKind.textContent = 'No confident BOMwiki match';
    matchTitle.textContent = data.object ? `Looks like ${data.object}` : 'Object not in catalog yet';
    matchSummary.textContent = 'The scanner identified the object, but the catalog match was too weak to show a BOM preview.';
    matchConfidence.textContent = pct(data.confidence);
    matchParts.textContent = '-';
    matchLines.textContent = '-';
    openFullBom.hidden = true;
    setMode('Suggestions', pct(data.confidence));
    setStatus('No confident BOMwiki match');
    bomPreview.innerHTML = '<p class="small-note">Try a closer crop, or add this product to BOMwiki before expecting a BOM preview.</p>';
    alternates.innerHTML = matches.length
      ? `<h3>Closest catalog items</h3>${matches.slice(0, 5).map((m) => `<a href="${escapeHtml(m.url)}"><span>${escapeHtml(m.name)}</span><b>${pct(m.confidence)}</b></a>`).join('')}`
      : '';
    const clues = (data.clues ?? []).filter(Boolean).slice(0, 4);
    scanClues.textContent = clues.length ? `Visible clues: ${clues.join(', ')}` : '';
    return;
  }

  resultKind.textContent = 'BOMwiki match';
  matchTitle.textContent = best.name;
  matchSummary.textContent = best.summary || best.domainName || 'Existing BOMwiki item';
  matchConfidence.textContent = pct(best.confidence ?? data.confidence);
  matchParts.textContent = best.partsTotal.toLocaleString();
  matchLines.textContent = best.directLines.toLocaleString();
  openFullBom.hidden = false;
  openFullBom.href = best.url;
  setMode(data.status === 'matched' ? 'Matched' : 'Suggestions', pct(best.confidence ?? data.confidence));
  setStatus(data.status === 'matched' ? 'BOM preview ready' : 'Review closest matches');

  const rows = (best.top ?? []).slice(0, 8);
  bomPreview.innerHTML = rows.length
    ? `<h3>Top-level bill of materials</h3>
      <table>
        <thead><tr><th>Item</th><th>Qty</th><th>Parts</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td><a href="${escapeHtml(r.url)}">${escapeHtml(r.name)}</a><span>${escapeHtml(r.kind)}${r.note ? ` - ${escapeHtml(r.note)}` : ''}</span></td>
            <td>${r.qty}x</td>
            <td>${r.partsTotal.toLocaleString()}</td>
          </tr>`).join('')}</tbody>
      </table>`
    : '<p class="small-note">This item does not have top-level assembly rows.</p>';

  const alts = matches.slice(1, 5);
  alternates.innerHTML = alts.length
    ? `<h3>Other possibilities</h3>${alts.map((m) => `<a href="${escapeHtml(m.url)}"><span>${escapeHtml(m.name)}</span><b>${pct(m.confidence)}</b></a>`).join('')}`
    : '';

  const clues = (data.clues ?? []).filter(Boolean).slice(0, 4);
  scanClues.textContent = clues.length ? `Visible clues: ${clues.join(', ')}` : '';
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showError('Unsupported file', 'Choose a JPEG, PNG, WebP, or camera photo.');
    return;
  }
  stopCamera();
  setState('captured');
  setMode('Uploaded', '');
  setStatus('Image loaded');
  showPanel('loading');
  try {
    const resized = await resizeFile(file, 1280);
    photo.src = resized.dataUrl;
    photo.hidden = false;
    video.hidden = true;
    await analyze(resized.dataUrl, { source: 'upload', width: resized.width, height: resized.height });
  } catch (err) {
    showError('Could not read image', 'Try a different photo.');
  }
}

uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => void handleFile(fileInput.files && fileInput.files[0]));
shutterBtn.addEventListener('click', () => void captureFrame('manual'));
retakeBtn.addEventListener('click', () => void startCamera());
panelRetake.addEventListener('click', () => void startCamera());
errorUpload.addEventListener('click', () => fileInput.click());
errorRetake.addEventListener('click', () => void startCamera());
closeScan.addEventListener('click', () => { stopCamera(); window.location.href = '/'; });

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  shell.classList.add('is-dragging');
});
dropZone.addEventListener('dragleave', () => shell.classList.remove('is-dragging'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  shell.classList.remove('is-dragging');
  void handleFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
});
document.addEventListener('paste', (event) => {
  const file = Array.from((event.clipboardData && event.clipboardData.files) || []).find((f) => f.type.startsWith('image/'));
  if (file) void handleFile(file);
});
window.addEventListener('resize', syncCanvas);
window.addEventListener('pagehide', stopCamera);

syncCanvas();
raf = requestAnimationFrame(loop);
void startCamera();
