// BOMwiki CAD Studio V4 foundation: parametric CAD in the browser, no signup.
// Geometry runs in a dedicated worker on OpenCascade WebAssembly (via replicad), the
// same B-rep kernel family desktop CAD uses — so features are exact solids,
// dimensions are millimetres, and export includes STEP, not just mesh STL.
//
// The document is a feature history: each feature is a 2D sketch (rectangles,
// circles, polygons with typed dimensions) plus an operation — extrude, cut,
// or revolve. Rebuild replays the history through the kernel, so any
// dimension can be edited later and the part regenerates. The document
// persists a local command/recovery journal in IndexedDB and round-trips as a
// validated JSON project file. localStorage remains a legacy import fallback.
(async () => {
  const stage = document.getElementById('bw-studio');
  if (!stage) return;
  const $ = (id) => document.getElementById(id);
  const say = (msg, sticky) => {
    const el = $('bw-studio-msg');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(say.t);
    if (!sticky) say.t = setTimeout(() => (el.hidden = true), 6000);
  };
  const appEl = document.querySelector('.cadstudio-app');
  const helpDialog = $('bw-help');
  const SEEDED = 'bw-studio-v2-seeded';
  const WELCOME = 'bw-studio-welcome-v1';
  const TOUR_SEEN = 'bw-studio-tour-v1';
  const templatesReady = import('/static/studio-templates.js');
  const storageStateEl = $('bw-storage-state');
  const setStorageState = (state, detail = '') => {
    if (!storageStateEl) return;
    const labels = { saved: 'Saved locally', saving: 'Saving…', unavailable: 'Storage unavailable' };
    storageStateEl.dataset.state = state;
    storageStateEl.querySelector('span').textContent = labels[state] || labels.unavailable;
    storageStateEl.title = detail || (state === 'unavailable' ? 'Local recovery is unavailable. Modeling and export still work.' : '');
  };
  let storageAvailable = true;
  const journalReady = import('/static/studio-storage.js')
    .then(({ openStudioJournal }) => openStudioJournal())
    .then((journal) => {
      setStorageState('saved');
      return journal;
    })
    .catch((error) => {
      setStorageState('unavailable', String(error?.message || error));
      return null;
    });
  const documentToolsReady = import('/static/studio-document.js');
  const hasFlag = (key) => {
    try {
      return Boolean(localStorage.getItem(key));
    } catch {
      storageAvailable = false;
      return false;
    }
  };
  const setFlag = (key) => {
    try {
      localStorage.setItem(key, '1');
    } catch {}
  };
  const hideWelcome = () => {
    const welcome = $('bw-welcome');
    if (welcome) welcome.hidden = true;
  };
  const showWelcome = () => {
    const welcome = $('bw-welcome');
    if (welcome) welcome.hidden = false;
  };
  const openHelp = () => {
    if (!helpDialog) return;
    if (typeof helpDialog.showModal === 'function') {
      if (!helpDialog.open) helpDialog.showModal();
    } else {
      helpDialog.setAttribute('open', '');
    }
  };
  const closeHelp = () => {
    if (!helpDialog) return;
    if (typeof helpDialog.close === 'function' && helpDialog.open) helpDialog.close();
    else helpDialog.removeAttribute('open');
  };
  $('bw-help-open')?.addEventListener('click', openHelp);
  $('bw-help-status')?.addEventListener('click', openHelp);
  $('bw-help-close')?.addEventListener('click', closeHelp);
  $('bw-welcome-help')?.addEventListener('click', openHelp);
  $('bw-help-tour')?.addEventListener('click', () => {
    closeHelp();
    startTour(doc.features.length ? 'part' : 'empty');
  });
  $('bw-help-templates')?.addEventListener('click', () => {
    closeHelp();
    openTemplateLibrary();
  });
  helpDialog?.addEventListener('click', (e) => {
    if (e.target === helpDialog) closeHelp();
  });

  const recoveryDialog = $('bw-recover');
  const recoveryList = $('bw-recovery-list');
  let recoveryEntries = new Map();
  let studioReadyForProjects = false;
  const closeRecovery = () => {
    if (!recoveryDialog) return;
    if (typeof recoveryDialog.close === 'function') recoveryDialog.close();
    else recoveryDialog.removeAttribute('open');
  };
  async function openRecovery() {
    if (!recoveryDialog || !recoveryList) return;
    if (!studioReadyForProjects) return say('Studio is still starting — try Recover again in a moment.');
    const journal = await journalReady;
    if (!journal) return say('Local recovery is unavailable in this browser.');
    let snapshots;
    try {
      snapshots = await journal.listRecovery();
    } catch (error) {
      setStorageState('unavailable', String(error?.message || error));
      return say('Local recovery could not be read. Modeling and export still work.');
    }
    recoveryEntries = new Map(snapshots.map((snapshot) => [snapshot.snapshotId, snapshot]));
    recoveryList.replaceChildren();
    const groups = new Map();
    for (const snapshot of snapshots) {
      if (!groups.has(snapshot.projectId)) groups.set(snapshot.projectId, []);
      groups.get(snapshot.projectId).push(snapshot);
    }
    for (const [groupProjectId, entries] of groups) {
      const projectItem = document.createElement('li');
      projectItem.className = 'ws-recovery-project';
      const heading = document.createElement('h3');
      heading.textContent = entries[0].title || 'Untitled part';
      if (groupProjectId === projectId) {
        const current = document.createElement('span');
        current.textContent = 'CURRENT';
        heading.appendChild(current);
      }
      const states = document.createElement('ol');
      for (const snapshot of entries) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.recover = snapshot.snapshotId;
        const label = document.createElement('b');
        label.textContent = snapshot.label || 'Committed state';
        const time = document.createElement('time');
        time.dateTime = snapshot.updatedAt;
        time.textContent = new Date(snapshot.updatedAt).toLocaleString();
        const detail = document.createElement('small');
        detail.textContent = snapshot.featureCount + ' feature' + (snapshot.featureCount === 1 ? '' : 's');
        button.append(label, time, detail);
        item.appendChild(button);
        states.appendChild(item);
      }
      projectItem.append(heading, states);
      recoveryList.appendChild(projectItem);
    }
    $('bw-recovery-empty').hidden = snapshots.length > 0;
    if (typeof recoveryDialog.showModal === 'function') recoveryDialog.showModal();
    else recoveryDialog.setAttribute('open', '');
  }
  $('bw-recover-open')?.addEventListener('click', openRecovery);
  $('bw-recover-close')?.addEventListener('click', closeRecovery);
  recoveryDialog?.addEventListener('click', (event) => {
    if (event.target === recoveryDialog) closeRecovery();
  });
  recoveryList?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-recover]');
    const snapshot = button && recoveryEntries.get(button.dataset.recover);
    if (!snapshot) return;
    let recovered;
    let targetProject = null;
    try {
      const { prepareStudioDocument } = await documentToolsReady;
      recovered = prepareStudioDocument(snapshot.document);
    } catch (error) {
      return say('Could not recover project: ' + String(error?.message || error));
    }
    if (snapshot.projectId !== projectId) {
      try {
        const journal = await journalReady;
        const stored = journal ? await journal.loadProject(snapshot.projectId) : null;
        const { prepareStudioDocument } = await documentToolsReady;
        targetProject = stored ? hydrateProjectRecord(stored, prepareStudioDocument) : null;
      } catch (error) {
        setStorageState('unavailable', String(error?.message || error));
        return say('Could not read that project journal. Modeling and export still work.');
      }
    }
    closeRecovery();
    startOperation(() => {
      if (snapshot.projectId === projectId) {
        commit('Restore recovered state', () => recovered);
      } else if (targetProject) {
        projectId = targetProject.projectId;
        doc = targetProject.document;
        undoStack.splice(0, undoStack.length, ...targetProject.undoStack);
        redoStack.splice(0, redoStack.length, ...targetProject.redoStack);
        trimHistoryStacks();
        commit('Restore recovered state', () => recovered);
      } else {
        projectId = snapshot.projectId || makeProjectId();
        doc = normalizeDoc(recovered);
        undoStack.length = 0;
        redoStack.length = 0;
        afterDocumentChange();
      }
      say('Recovered ' + (snapshot.title || 'local project') + '.');
    });
  });

  const fullscreenLabel = $('bw-fullscreen-label');
  const fullscreenButton = $('bw-fullscreen');
  const syncFullscreen = () => {
    const on = document.fullscreenElement === appEl;
    fullscreenButton?.setAttribute('aria-pressed', String(on));
    if (fullscreenLabel) fullscreenLabel.textContent = on ? 'Exit full screen' : 'Full screen';
  };
  fullscreenButton?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (appEl?.requestFullscreen) await appEl.requestFullscreen();
      else say('Full screen is not available in this browser.');
    } catch {
      say('Full screen is not available in this browser.');
    }
  });
  document.addEventListener('fullscreenchange', () => {
    syncFullscreen();
    requestAnimationFrame(() => resize());
  });
  syncFullscreen();

  // --- three viewer --------------------------------------------------------
  let THREE, OrbitControls;
  try {
    [THREE, { OrbitControls }] = await Promise.all([
      import('/static/vendor/three.module.min.js'),
      import('/static/vendor/OrbitControls.js'),
    ]);
  } catch {
    stage.innerHTML = '<p class="mv-error">The studio failed to load. Check your connection and reload.</p>';
    return;
  }
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x778, 1.5));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(60, 120, 90);
  scene.add(dirLight);
  const grid = new THREE.GridHelper(200, 40, 0x567089, 0x2b3b4b);
  scene.add(grid);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 8000);
  camera.position.set(90, 80, 130);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.target.set(0, 15, 0);

  const partGroup = new THREE.Group();
  // Kernel space is Z-up (CAD convention); three is Y-up.
  partGroup.rotation.x = -Math.PI / 2;
  scene.add(partGroup);
  const MAT = new THREE.MeshStandardMaterial({ color: 0xa7b8c9, metalness: 0.16, roughness: 0.56, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const EDGE_MAT = new THREE.LineBasicMaterial({ color: 0x30475c });

  // On phones the site header wraps and its height varies, so the fixed
  // calc() in CSS overshoots — measure and pin the app to the viewport.
  function fitAppHeight() {
    if (!appEl) return;
    if (!window.matchMedia('(max-width: 760px)').matches) {
      appEl.style.height = '';
      return;
    }
    const top = Math.max(0, appEl.getBoundingClientRect().top);
    appEl.style.height = Math.max(320, window.innerHeight - top) + 'px';
    syncSheetBottom();
  }
  // Bottom sheets must stop above the mobile tab bar, or they swallow its
  // taps. The offset is measured because the strip heights can wrap.
  function syncSheetBottom() {
    const tabs = document.getElementById('bw-mtabs');
    if (!tabs) return;
    const r = tabs.getBoundingClientRect();
    if (r.height > 0) {
      document.documentElement.style.setProperty('--bw-sheet-bottom', Math.max(0, window.innerHeight - r.top) + 'px');
    }
  }
  window.addEventListener('resize', fitAppHeight);
  fitAppHeight();

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    sketch.resize();
    fitAppHeight();
  }
  new ResizeObserver(resize).observe(stage);
  // Render only while the stage is actually visible — an open studio tab in
  // the background must not drain a phone's battery.
  let stageVisible = true;
  new IntersectionObserver((entries) => {
    // Last entry, not first: a batch can carry [hidden, visible] and the
    // stale first entry would freeze the render loop.
    stageVisible = entries[entries.length - 1].isIntersecting;
  }).observe(stage);
  // No document.hidden check: browsers already stop the animation-frame
  // loop in hidden tabs, and some embedded webviews report hidden wrongly.
  renderer.setAnimationLoop(() => {
    if (!stageVisible) return;
    orbit.update();
    renderer.render(scene, camera);
  });

  // --- kernel worker (lazy, revisioned) -----------------------------------
  // OpenCascade never runs on the UI thread. Each request carries a project
  // and document revision; visual replies older than the latest requested
  // rebuild are ignored below.
  let kernelWorker = null;
  let kernelReady = null;
  let kernelRequestSeq = 0;
  let documentRevision = 0;
  let latestRequestedRevision = -1;
  let latestAppliedRevision = -1;
  const kernelPending = new Map();
  const appliedRevisionLog = [];
  const KERNEL_REQUEST_TIMEOUT = 90_000;
  let kernelGeneration = 0;
  let kernelRestarting = false;
  let kernelRestartCount = 0;
  let nextKernelReplyDelay = 0;

  function rejectKernelPending(error) {
    for (const pending of kernelPending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    kernelPending.clear();
  }

  function scheduleKernelRestart() {
    if (kernelRestarting) return;
    kernelRestarting = true;
    kernelRestartCount++;
    setTimeout(async () => {
      try {
        await loadKernel();
        if (doc.features.length) rebuild();
        else kernelRestarting = false;
      } catch (error) {
        say('The CAD kernel could not restart. Reload to retry: ' + String(error?.message || error), true);
      }
    }, 0);
  }

  function handleKernelFailure(worker, error, restart = true) {
    if (worker && worker !== kernelWorker) return;
    try {
      worker?.terminate();
    } catch {}
    kernelWorker = null;
    kernelReady = null;
    rejectKernelPending(error);
    say('The CAD kernel worker stopped. Restarting from your last committed state…', true);
    if (restart) scheduleKernelRestart();
  }

  function loadKernel() {
    if (kernelReady) return kernelReady;
    say('Loading the CAD kernel (one-time ~11 MB download, then cached)…', true);
    kernelReady = new Promise((resolve, reject) => {
      const worker = new Worker('/static/studio-kernel.worker.js', { type: 'module' });
      kernelWorker = worker;
      kernelGeneration++;
      worker.addEventListener('message', (event) => {
        if (worker !== kernelWorker) return;
        const message = event.data;
        if (message?.kind === 'kernel-status') {
          if (message.status === 'ready') {
            say('Kernel ready.');
            resolve(worker);
          } else if (message.status === 'failed') {
            const error = new Error(message.message || 'The CAD kernel failed to load.');
            reject(error);
            handleKernelFailure(worker, error);
          }
          return;
        }
        const pending = kernelPending.get(message?.requestId);
        if (!pending) return;
        kernelPending.delete(message.requestId);
        clearTimeout(pending.timer);
        if (message.kind === 'kernel-error') pending.reject(new Error(message.message || 'Kernel request failed.'));
        else pending.resolve(message);
      });
      worker.addEventListener('error', (event) => {
        if (worker !== kernelWorker) return;
        const error = new Error(event.message || 'The CAD kernel worker stopped.');
        reject(error);
        handleKernelFailure(worker, error);
      });
    });
    return kernelReady;
  }

  async function kernelCall(kind, revision) {
    const worker = await loadKernel();
    const requestId = ++kernelRequestSeq;
    const request = {
      requestId,
      projectId,
      revision,
      kind,
      document: deepCopy(doc),
    };
    if (nextKernelReplyDelay) {
      request.delayMs = nextKernelReplyDelay;
      nextKernelReplyDelay = 0;
    }
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!kernelPending.delete(requestId)) return;
        const error = new Error('The CAD kernel did not respond in time.');
        reject(error);
        handleKernelFailure(worker, error);
      }, KERNEL_REQUEST_TIMEOUT);
      kernelPending.set(requestId, { resolve, reject, timer });
    });
    try {
      worker.postMessage(request);
    } catch (error) {
      const pending = kernelPending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      kernelPending.delete(requestId);
      handleKernelFailure(worker, error);
      return response;
    }
    return response;
  }

  // --- document ------------------------------------------------------------
  const KEY = 'bw-studio-doc-v2';
  const makeProjectId = () => crypto.randomUUID?.() || 'project-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  let projectId = makeProjectId();
  let doc = { title: 'Untitled part', units: 'mm', features: [], params: [] };
  let meshBounds = null; // last applied worker mesh bounds
  // Rebuild errors are derived state, never stored in the document (they
  // would leak into undo snapshots and project files).
  const buildErrors = new Map(); // feature id -> message

  const deepCopy = (o) => JSON.parse(JSON.stringify(o));
  function normalizeDoc(d) {
    const out = d && typeof d === 'object' ? d : {};
    if (!Array.isArray(out.features)) out.features = [];
    if (!Array.isArray(out.params)) out.params = [];
    out.schemaVersion = 3; // transitional V3 input; Slice 4B migrates it to schema 4
    if (typeof out.title !== 'string' || !out.title.trim()) out.title = 'Untitled part';
    if (out.units !== 'in') out.units = 'mm';
    out.features = out.features.filter((f) => f && typeof f === 'object');
    out.params = out.params.filter((p) => p && typeof p === 'object' && typeof p.name === 'string');
    for (const f of out.features) delete f.error; // legacy derived field
    return out;
  }

  // --- undo / redo -----------------------------------------------------------
  // Snapshot-based command stack. Every document mutation goes through
  // commit(); undo/redo/file-open/clear restore via replaceDocument() — the
  // single pipeline that re-renders and rebuilds.
  const undoStack = []; // [{label, snap}]
  const redoStack = [];
  const STACK_MAX = 100;
  const STACK_BYTES_MAX = 16 * 1024 * 1024;
  const utf8 = new TextEncoder();

  const historyEntryBytes = (entry) => utf8.encode(entry.snap).byteLength + utf8.encode(entry.label || '').byteLength;
  function trimHistoryStacks() {
    while (undoStack.length + redoStack.length > STACK_MAX) {
      if (undoStack.length) undoStack.shift();
      else redoStack.shift();
    }
    let bytes = [...undoStack, ...redoStack].reduce((total, entry) => total + historyEntryBytes(entry), 0);
    while (bytes > STACK_BYTES_MAX && (undoStack.length || redoStack.length)) {
      // Preserve the nearest redo step; redo[0] is the farthest future state.
      const removed = undoStack.length ? undoStack.shift() : redoStack.shift();
      bytes -= historyEntryBytes(removed);
    }
  }

  function stringPatch(before, after) {
    let start = 0;
    const shared = Math.min(before.length, after.length);
    while (start < shared && before.charCodeAt(start) === after.charCodeAt(start)) start++;
    let beforeEnd = before.length;
    let afterEnd = after.length;
    while (beforeEnd > start && afterEnd > start && before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)) {
      beforeEnd--;
      afterEnd--;
    }
    return { start, remove: beforeEnd - start, insert: after.slice(start, afterEnd) };
  }

  function applyStringPatch(before, patch) {
    if (
      !patch || !Number.isInteger(patch.start) || !Number.isInteger(patch.remove) || patch.start < 0 || patch.remove < 0 ||
      patch.start + patch.remove > before.length || typeof patch.insert !== 'string'
    ) throw new Error('Stored command history is invalid.');
    return before.slice(0, patch.start) + patch.insert + before.slice(patch.start + patch.remove);
  }

  function encodeHistory() {
    const current = JSON.stringify(doc);
    const documents = [...undoStack.map((entry) => entry.snap), current, ...redoStack.slice().reverse().map((entry) => entry.snap)];
    const labels = [...undoStack.map((entry) => entry.label), ...redoStack.slice().reverse().map((entry) => entry.label)];
    const commands = [];
    for (let index = 0; index < labels.length; index++) {
      commands.push({ label: labels[index], ...stringPatch(documents[index], documents[index + 1]) });
    }
    return { version: 1, base: documents[0], commands, cursor: undoStack.length };
  }

  function decodeHistory(history) {
    if (!history || history.version !== 1 || typeof history.base !== 'string' || !Array.isArray(history.commands)) {
      throw new Error('Stored command history is invalid.');
    }
    if (history.commands.length > STACK_MAX || !Number.isInteger(history.cursor) || history.cursor < 0 || history.cursor > history.commands.length) {
      throw new Error('Stored command history cursor is invalid.');
    }
    const documents = [history.base];
    for (const command of history.commands) {
      if (typeof command?.label !== 'string') throw new Error('Stored command label is invalid.');
      documents.push(applyStringPatch(documents.at(-1), command));
    }
    const decodedUndo = history.commands.slice(0, history.cursor).map((command, index) => ({ label: command.label, snap: documents[index] }));
    const decodedRedo = [];
    for (let index = history.commands.length - 1; index >= history.cursor; index--) {
      decodedRedo.push({ label: history.commands[index].label, snap: documents[index + 1] });
    }
    return { current: documents[history.cursor], undoStack: decodedUndo, redoStack: decodedRedo };
  }

  function hydrateProjectRecord(record, prepareStudioDocument) {
    const document = normalizeDoc(prepareStudioDocument(record.document));
    let restoredUndo = [];
    let restoredRedo = [];
    try {
      if (record.history) {
        const restored = decodeHistory(record.history);
        if (restored.current !== JSON.stringify(document)) throw new Error('Stored command cursor does not match the active document.');
        restoredUndo = restored.undoStack;
        restoredRedo = restored.redoStack;
      } else {
        // One-time compatibility with the first V4 foundation increment.
        restoredUndo = Array.isArray(record.undoStack) ? record.undoStack.slice(-STACK_MAX) : [];
        restoredRedo = Array.isArray(record.redoStack) ? record.redoStack.slice(-STACK_MAX) : [];
      }
    } catch {
      // A corrupt command tail must never prevent the last committed document
      // from opening. It is discarded and replaced on the next successful save.
      restoredUndo = [];
      restoredRedo = [];
    }
    return { projectId: record.projectId || makeProjectId(), document, undoStack: restoredUndo, redoStack: restoredRedo };
  }

  function syncHistoryActions() {
    const undoButton = $('bw-undo');
    const redoButton = $('bw-redo');
    if (undoButton) undoButton.disabled = undoStack.length === 0;
    if (redoButton) redoButton.disabled = redoStack.length === 0;
  }

  function commit(label, mutate) {
    // Run the mutation (and normalization) BEFORE touching the stacks: a
    // throwing mutation must leave undo history exactly as it was.
    const snap = JSON.stringify(doc);
    let replacement;
    try {
      replacement = mutate();
      if (replacement) replacement = normalizeDoc(replacement);
    } catch (err) {
      doc = normalizeDoc(JSON.parse(snap)); // paranoia: undo partial mutation
      throw err;
    }
    undoStack.push({ label, snap });
    redoStack.length = 0;
    trimHistoryStacks();
    if (replacement) doc = replacement;
    afterDocumentChange(label);
  }

  // Shared post-change pipeline: prune dead selection, persist, re-render,
  // rebuild. Used by commit() and replaceDocument().
  function afterDocumentChange(recoveryLabel = null) {
    if (selectedFeatureId && !doc.features.some((f) => f.id === selectedFeatureId)) selectedFeatureId = null;
    save(recoveryLabel);
    renderParams();
    renderHistory();
    renderContext();
    syncHistoryActions();
    rebuild();
  }

  function replaceDocument(snapJson) {
    doc = normalizeDoc(JSON.parse(snapJson));
    afterDocumentChange();
  }

  function undo() {
    if (mode.kind !== 'idle' && mode.kind !== 'rebuilding') return say('Finish or cancel the current action first.');
    if (!undoStack.length) return say('Nothing to undo.');
    const entry = undoStack.pop();
    redoStack.push({ label: entry.label, snap: JSON.stringify(doc) });
    trimHistoryStacks();
    replaceDocument(entry.snap);
    say('Undid: ' + entry.label);
  }
  function redo() {
    if (mode.kind !== 'idle' && mode.kind !== 'rebuilding') return say('Finish or cancel the current action first.');
    if (!redoStack.length) return say('Nothing to redo.');
    const entry = redoStack.pop();
    undoStack.push({ label: entry.label, snap: JSON.stringify(doc) });
    trimHistoryStacks();
    replaceDocument(entry.snap);
    say('Redid: ' + entry.label);
  }

  // --- mode coordinator -----------------------------------------------------
  // One discriminated state object owns "what is the user doing". Every
  // editor announces open/close through setMode; entering a working mode
  // from another working mode is a coordination bug (the feature buttons
  // cancel the previous owner first), surfaced via console + label.
  let mode = { kind: 'idle' };
  const MODE_TEXT = {
    idle: () => (buildErrors.size ? 'A feature is failing — edit or delete it in History' : 'Ready — pick a feature to start'),
    'choose-face': (m) => OP_LABEL[m.feat] + ' · click a flat face, or use the base plane',
    sketching: (m) => 'Sketch · ' + m.tool + ' — click to place, type exact numbers below',
    'picking-edges': (m) => OP_LABEL[m.feat] + ' · click edges on the part (' + m.count + ' picked)',
    'picking-faces': (m) => 'Shell · pick the opening faces (' + m.count + ' picked)',
    rebuilding: () => 'Rebuilding…',
  };
  const isWorking = (k) => k !== 'idle' && k !== 'rebuilding';
  const modeLog = []; // recent mode kinds, for the automated checks
  let currentOpType = null; // feature type owning the active operation (ribbon pressed state)
  let preferredWorkspace = 'solid';
  let activeWorkspace = 'solid';
  const WORKSPACE_META = {
    solid: ['Solid tools', 'Create material from a profile'],
    sketch: ['Sketch tools', 'Draw and edit a closed profile'],
    modify: ['Modify tools', 'Refine edges and hollow the body'],
    inspect: ['Inspect tools', 'Orient and frame the part'],
  };
  function showWorkspace(name, forced) {
    if (!WORKSPACE_META[name]) return false;
    if (name === 'sketch' && mode.kind !== 'sketching' && !forced) return false;
    activeWorkspace = name;
    if (!forced && name !== 'sketch') preferredWorkspace = name;
    document.querySelectorAll('[data-workspace]').forEach((b) => {
      const on = b.dataset.workspace === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('[data-workspace-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.workspacePanel !== name;
    });
    const meta = WORKSPACE_META[name];
    if ($('bw-workspace-name')) $('bw-workspace-name').textContent = meta[0];
    if ($('bw-workspace-hint')) $('bw-workspace-hint').textContent = meta[1];
    requestAnimationFrame(() => resize());
    return true;
  }
  document.querySelectorAll('[data-workspace]').forEach((b) =>
    b.addEventListener('click', () => showWorkspace(b.dataset.workspace, false)),
  );
  function setMode(next) {
    modeLog.push(next.kind);
    if (modeLog.length > 200) modeLog.shift();
    if (isWorking(mode.kind) && isWorking(next.kind) && mode.kind !== next.kind) {
      console.warn('mode conflict:', mode.kind, '->', next.kind);
    }
    mode = next;
    const text = (MODE_TEXT[mode.kind] || (() => ''))(mode);
    const el = $('bw-mode');
    if (el) el.textContent = text;
    const cmd = $('bw-cmd-mode');
    if (cmd) cmd.textContent = text;
    const actions = $('bw-cmd-actions');
    if (actions) actions.hidden = !(mode.kind === 'sketching' || mode.kind === 'picking-edges' || mode.kind === 'picking-faces');
    const rib = document.getElementById('rib-sketch');
    if (rib) rib.hidden = mode.kind !== 'sketching';
    const sketchTab = document.querySelector('[data-workspace="sketch"]');
    if (sketchTab) sketchTab.disabled = mode.kind !== 'sketching';
    if (mode.kind === 'sketching') showWorkspace('sketch', true);
    else if (mode.kind === 'picking-edges' || mode.kind === 'picking-faces') showWorkspace('modify', true);
    else if (mode.kind === 'choose-face') showWorkspace('solid', true);
    else if (mode.kind === 'idle') showWorkspace(preferredWorkspace, true);
    if (!isWorking(mode.kind)) currentOpType = null;
    document.querySelectorAll('[data-feat]').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.feat === currentOpType && isWorking(mode.kind) ? 'true' : 'false');
      b.classList.toggle('on', b.dataset.feat === currentOpType && isWorking(mode.kind));
    });
    renderContext();
  }
  const refreshModeLabel = () => setMode(mode);

  // Keyboard: global shortcuts must not fire while a field has focus.
  const inField = () => {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  };
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || inField()) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((k === 'z' && e.shiftKey) || k === 'y') {
      e.preventDefault();
      redo();
    }
  });

  // --- named parameters + expressions --------------------------------------
  // Dimensions may be plain numbers or expressions over the parameters
  // panel ("wall*2 + 1"). Tiny recursive-descent evaluator — numbers,
  // + - * / ( ) and parameter names only, no eval().
  function evalExpr(input, params) {
    if (typeof input === 'number') return input;
    const s = String(input);
    let i = 0;
    const skip = () => {
      while (s[i] === ' ') i++;
    };
    function factor() {
      skip();
      if (s[i] === '(') {
        i++;
        const v = expr();
        skip();
        if (s[i] !== ')') throw new Error('missing )');
        i++;
        return v;
      }
      if (s[i] === '-') {
        i++;
        return -factor();
      }
      let m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
      if (m) {
        i += m[0].length;
        if (!(m[0] in params)) throw new Error('unknown parameter "' + m[0] + '"');
        return params[m[0]];
      }
      m = /^\d+(\.\d+)?/.exec(s.slice(i));
      if (m) {
        i += m[0].length;
        return Number(m[0]);
      }
      throw new Error('bad expression');
    }
    function term() {
      let v = factor();
      for (;;) {
        skip();
        if (s[i] === '*') {
          i++;
          v *= factor();
        } else if (s[i] === '/') {
          i++;
          v /= factor();
        } else return v;
      }
    }
    function expr() {
      let v = term();
      for (;;) {
        skip();
        if (s[i] === '+') {
          i++;
          v += term();
        } else if (s[i] === '-') {
          i++;
          v -= term();
        } else return v;
      }
    }
    const v = expr();
    skip();
    if (i < s.length) throw new Error('bad expression');
    if (!Number.isFinite(v)) throw new Error('expression is not a number');
    return v;
  }
  const paramMap = () => Object.fromEntries((doc.params || []).map((p) => [p.name, p.value]));
  /** Strict: throws with a clear message (used at rebuild). */
  const N = (v) => evalExpr(v, paramMap());
  /** Safe: for canvas drawing — falls back so a bad expression can't blank
   *  the sketcher while the user is mid-edit. */
  const NS = (v, fb) => {
    try {
      return evalExpr(v, paramMap());
    } catch {
      return fb ?? 0;
    }
  };

  function newId() {
    return Math.random().toString(36).slice(2, 8);
  }

  const OP_LABEL = { extrude: 'Extrude', cut: 'Cut', revolve: 'Revolve', fillet: 'Fillet', chamfer: 'Chamfer', shell: 'Shell' };

  async function rebuild() {
    const revision = ++documentRevision;
    latestRequestedRevision = revision;
    if (mode.kind === 'idle' || mode.kind === 'rebuilding') setMode({ kind: 'rebuilding' });
    if (!doc.features.length) {
      setMeshData(null);
      buildErrors.clear();
      latestAppliedRevision = revision;
      // If the kernel has been used, release its retained B-rep after any
      // older queued rebuild. Do not create/load the worker for a blank first run.
      if (kernelWorker) kernelCall('release', revision).catch(() => {});
      renderHistory();
      const emptyError = $('bw-cmd-err');
      if (emptyError) emptyError.textContent = '';
      if (mode.kind === 'rebuilding') setMode({ kind: 'idle' });
      return;
    }
    let response;
    try {
      response = await kernelCall('rebuild', revision);
    } catch (error) {
      if (revision === latestRequestedRevision) {
        say('The CAD kernel failed: ' + String(error?.message || error), true);
        if (mode.kind === 'rebuilding') setMode({ kind: 'idle' });
      }
      return;
    }
    // A slow earlier rebuild must never overwrite a newer requested state.
    if (response.revision !== latestRequestedRevision) return;
    latestAppliedRevision = response.revision;
    appliedRevisionLog.push(response.revision);
    if (appliedRevisionLog.length > 200) appliedRevisionLog.shift();
    kernelRestarting = false;
    buildErrors.clear();
    for (const error of response.errors || []) buildErrors.set(error.featureId, error.message);
    try {
      setMeshData(response.mesh);
    } catch {
      say('Display meshing failed.', false);
    }
    renderHistory();
    const failed = (response.errors || [])[0];
    const errEl = $('bw-cmd-err');
    if (errEl) errEl.textContent = failed ? OP_LABEL[failed.featureType] + ' failed: ' + failed.message : '';
    if (mode.kind === 'idle' || mode.kind === 'rebuilding') setMode({ kind: 'idle' });
    if (failed) say(OP_LABEL[failed.featureType] + ' failed: ' + failed.message);
  }

  // Topology metadata is extracted in the worker. The UI stores signatures
  // only; it never retains OpenCascade wrappers on the main thread.
  const faceSig = (face) => deepCopy(face.sig || face);
  const faceMatches = (sig, face) => {
    const candidate = face.sig || face;
    if (!candidate?.p || !candidate?.n) return false;
    return (
      Math.hypot(candidate.p[0] - sig.p[0], candidate.p[1] - sig.p[1], candidate.p[2] - sig.p[2]) < 0.05 &&
      candidate.n[0] * sig.n[0] + candidate.n[1] * sig.n[1] + candidate.n[2] * sig.n[2] > 0.999
    );
  };

  let edgeLines = []; // pickable Line objects with userData.sig
  let solidMesh = null; // the shaded mesh, for face raycasts
  let faceRanges = []; // [{t0, t1, faceId}] triangle ranges per B-rep face
  let faceByHash = new Map(); // faceId -> serializable planar-face metadata

  function setMeshData(mesh) {
    while (partGroup.children.length) {
      const c = partGroup.children.pop();
      c.geometry?.dispose();
      if (c.material && c.material !== MAT) c.material.dispose?.();
    }
    edgeLines = [];
    solidMesh = null;
    faceRanges = [];
    faceByHash = new Map();
    meshBounds = mesh?.bounds ?? null;
    if (!mesh) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
    if (mesh.normals) geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
    if (!mesh.normals) geo.computeVertexNormals();
    solidMesh = new THREE.Mesh(geo, MAT);
    partGroup.add(solidMesh);
    for (const g of mesh.faceGroups || []) {
      faceRanges.push({ t0: g.start / 3, t1: (g.start + g.count) / 3, faceId: g.faceId });
    }
    for (const face of mesh.planarFaces || []) faceByHash.set(face.faceId, face);
    // Exact B-rep edge polylines and signatures were extracted in the worker.
    for (const edge of mesh.edges || []) {
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.BufferAttribute(edge.points, 3));
      const line = new THREE.Line(lineGeometry, EDGE_MAT.clone());
      line.userData.sig = edge.sig;
      partGroup.add(line);
      edgeLines.push(line);
    }
  }

  // --- history panel -------------------------------------------------------
  function renderHistory() {
    const list = $('bw-history');
    list.innerHTML = '';
    if ($('bw-project-name')) $('bw-project-name').textContent = doc.title;
    if ($('bw-tree-project-name')) $('bw-tree-project-name').textContent = doc.title;
    const featureMark = { extrude: 'EX', cut: 'CU', revolve: 'RV', fillet: 'FL', chamfer: 'CH', shell: 'SH' };
    doc.features.forEach((f, i) => {
      const li = document.createElement('li');
      li.className = 'hist-item' + (buildErrors.has(f.id) ? ' err' : '') + (f.id === selectedFeatureId ? ' sel' : '');
      li.dataset.sel = f.id;
      li.dataset.feature = f.type;
      const dims =
        f.type === 'fillet' || f.type === 'chamfer'
          ? 'r ' + f.r + ' mm · ' + f.edges.length + ' edge' + (f.edges.length === 1 ? '' : 's')
          : f.type === 'shell'
            ? f.t + ' mm walls · ' + f.faces.length + ' opening' + (f.faces.length === 1 ? '' : 's')
            : f.type === 'revolve'
              ? 'profile ×' + f.sketch.shapes.length
              : (f.through ? 'through' : f.h + ' mm') + ' · ' + f.sketch.shapes.length + ' shape' + (f.sketch.shapes.length === 1 ? '' : 's') + (f.onFace ? ' · on face' : '') + (f.pattern?.n > 1 ? ' · ×' + f.pattern.n : '');
      li.innerHTML =
        '<button type="button" class="hi-sel" data-sel="' + f.id + '" aria-pressed="' + (f.id === selectedFeatureId) + '">' +
        '<span class="hi-glyph" aria-hidden="true">' + (featureMark[f.type] || 'FT') + '</span>' +
        '<span class="hi-n">' + (i + 1) + '. ' + OP_LABEL[f.type] + '</span>' +
        '<span class="hi-d">' + dims + (buildErrors.has(f.id) ? ' · FAILED' : '') + '</span>' +
        '</button>' +
        '<span class="hi-a"><button data-edit="' + f.id + '">Edit</button><button data-del="' + f.id + '">×</button></span>';
      list.appendChild(li);
    });
    $('bw-hist-empty').hidden = doc.features.length > 0;
    const st = $('bw-status-feat');
    if (st) st.textContent = doc.features.length + ' feature' + (doc.features.length === 1 ? '' : 's');
    const summary = $('bw-tree-summary');
    if (summary) summary.textContent = doc.features.length + ' feature' + (doc.features.length === 1 ? '' : 's');
  }

  $('bw-history').addEventListener('click', (e) => {
    const editId = e.target.dataset?.edit, delId = e.target.dataset?.del;
    if (!editId && !delId) {
      const li = e.target.closest('.hist-item');
      if (li) {
        const fromKeyboard = e.target.closest('.hi-sel');
        selectFeature(li.dataset.sel === selectedFeatureId ? null : li.dataset.sel);
        if (fromKeyboard) $('bw-history').querySelector('.hi-sel[data-sel="' + li.dataset.sel + '"]')?.focus();
      }
      return;
    }
    if (delId) {
      startOperation(() => {
        const gone = doc.features.find((f) => f.id === delId);
        commit('Delete ' + (gone ? OP_LABEL[gone.type].toLowerCase() : 'feature'), () => {
          doc.features = doc.features.filter((f) => f.id !== delId);
        });
      });
    }
    if (editId) {
      const f = doc.features.find((x) => x.id === editId);
      if (f) startOperation(() => openEditorFor(f));
    }
  });

  // --- parameters panel ----------------------------------------------------
  function renderParams() {
    const wrap = $('bw-params');
    const escAttr = (v) => String(v).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    wrap.innerHTML = (doc.params || [])
      .map(
        (p, i) =>
          '<div class="param-row">' +
          '<input type="text" data-pname="' + i + '" value="' + escAttr(p.name) + '" spellcheck="false" />' +
          '<span>=</span>' +
          '<input type="text" inputmode="decimal" data-pval="' + i + '" value="' + escAttr(p.value) + '" />' +
          '<button data-pdel="' + i + '" title="Remove">×</button>' +
          '</div>',
      )
      .join('');
    wrap.querySelectorAll('[data-pname]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const name = inp.value.trim();
        const i = Number(inp.dataset.pname);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          say('Parameter names are letters, digits and _, starting with a letter.');
          inp.value = doc.params[i].name;
          return;
        }
        if (doc.params.some((p, j) => j !== i && p.name === name)) {
          say('There is already a parameter called "' + name + '".');
          inp.value = doc.params[i].name;
          return;
        }
        commit('Rename parameter', () => {
          doc.params[i].name = name;
        });
      }),
    );
    wrap.querySelectorAll('[data-pval]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const i = Number(inp.dataset.pval);
        const v = Number(inp.value);
        if (!Number.isFinite(v)) {
          say('Parameter values are plain numbers (expressions live in the dimension fields).');
          inp.value = doc.params[i].value;
          return;
        }
        commit('Set ' + doc.params[i].name + ' = ' + v, () => {
          doc.params[i].value = v;
        });
      }),
    );
    wrap.querySelectorAll('[data-pdel]').forEach((btn) =>
      btn.addEventListener('click', () => {
        commit('Delete parameter', () => {
          doc.params.splice(Number(btn.dataset.pdel), 1);
        });
      }),
    );
  }
  $('bw-param-add').addEventListener('click', () => {
    let i = 1;
    while ((doc.params || []).some((p) => p.name === 'p' + i)) i++;
    commit('Add parameter', () => {
      doc.params.push({ name: 'p' + i, value: 10 });
    });
  });

  // --- persistence ---------------------------------------------------------
  let storageWriteSequence = 0;
  let latestStorageWrite = Promise.resolve();
  function save(recoveryLabel = null) {
    try {
      localStorage.setItem(KEY, JSON.stringify(doc));
    } catch {}
    const writeSequence = ++storageWriteSequence;
    setStorageState('saving');
    const state = {
      projectId,
      title: doc.title,
      document: deepCopy(doc),
      history: encodeHistory(),
    };
    latestStorageWrite = journalReady.then((journal) => {
      if (!journal) throw new Error('IndexedDB is unavailable.');
      const snapshot = recoveryLabel
        ? { snapshotId: crypto.randomUUID?.() || newId() + '-' + Date.now(), label: recoveryLabel }
        : null;
      return journal.persistState(state, snapshot);
    }).then(() => {
      if (writeSequence === storageWriteSequence) setStorageState('saved');
    }).catch((error) => {
      if (writeSequence === storageWriteSequence) setStorageState('unavailable', String(error?.message || error));
    });
    return latestStorageWrite;
  }
  async function load() {
    const { prepareStudioDocument } = await documentToolsReady;
    const journal = await journalReady;
    if (journal) {
      try {
        const active = await journal.loadActive();
        if (active?.document && Array.isArray(active.document.features)) {
          const restored = hydrateProjectRecord(active, prepareStudioDocument);
          projectId = restored.projectId;
          doc = restored.document;
          undoStack.splice(0, undoStack.length, ...restored.undoStack);
          redoStack.splice(0, redoStack.length, ...restored.redoStack);
          trimHistoryStacks();
          return;
        }
      } catch (error) {
        setStorageState('unavailable', String(error?.message || error));
      }
    }
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && Array.isArray(d.features)) doc = normalizeDoc(prepareStudioDocument(d));
      else doc = normalizeDoc(doc);
    } catch {}
    // Import the compatibility localStorage document into the durable journal.
    save();
  }
  $('bw-save-file').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'part.bomcad.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('bw-open-btn')?.addEventListener('click', () => $('bw-open-file').click());
  $('bw-open-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // allow re-opening the same file later
    file.text().then(async (t) => {
      let d;
      try {
        const { parseStudioProject } = await documentToolsReady;
        d = parseStudioProject(t);
      } catch (error) {
        return say('Could not open project: ' + String(error?.message || error));
      }
      // Replacing the document while an editor is open must go through the
      // coordinator: prompt for a dirty draft, cancel editors, then switch
      // projects atomically without merging their command journals.
      startOperation(() => {
        projectId = makeProjectId();
        doc = normalizeDoc(d);
        undoStack.length = 0;
        redoStack.length = 0;
        afterDocumentChange();
        setFlag(SEEDED);
        setFlag(WELCOME);
        hideWelcome();
        say('Project opened.');
      });
    });
  });

  // --- export --------------------------------------------------------------
  async function exportBlob(kind) {
    if (!doc.features.length) return say('Add a feature first.');
    let response;
    try {
      response = await kernelCall(kind === 'step' ? 'export-step' : 'export-stl', documentRevision);
    } catch (error) {
      return say('Export failed: ' + String(error?.message || error));
    }
    if (!response.blob || response.errors?.length) {
      return say('A feature is failing (marked red) — fix or delete it first, so the exported file matches your design.');
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(response.blob);
    a.download = kind === 'step' ? 'part.step' : 'part.stl';
    a.click();
    URL.revokeObjectURL(a.href);
    say(kind === 'step' ? 'STEP exported — opens in FreeCAD and every real CAD package.' : 'STL exported — ready to print.');
  }
  $('bw-export-stl').addEventListener('click', () => exportBlob('stl'));
  $('bw-export-step').addEventListener('click', () => exportBlob('step'));
  $('bw-clear').addEventListener('click', () => {
    const hasDirtyDraft = isWorking(mode.kind) && activeDraftDirty();
    const warning = hasDirtyDraft
      ? 'Discard the unfinished edit and clear the whole part? Undo can restore the saved part, but not the unfinished edit.'
      : 'Clear the whole part? (Undo can bring it back.)';
    if (!confirm(warning)) return;
    startOperation(() => {
      commit('Clear part', () => ({ ...doc, features: [], params: [] }));
    }, { discardConfirmed: true });
  });

  // --- 2D sketcher ---------------------------------------------------------
  const sketch = (() => {
    const wrap = $('bw-sketch');
    const canvas = $('bw-sketch-canvas');
    const ctx = canvas.getContext('2d');
    let feature = null; // DRAFT copy being edited; the document is untouched until Apply
    let isNew = false;
    let tool = 'rect';
    let pending = null; // in-progress placement
    let view = { cx: 0, cy: 0, pxPerMm: 6 };
    let selShape = null;
    let refOutline = [];

    function wrapOpenMode() {
      setMode({ kind: 'sketching', tool: 'rect', featureType: feature.type });
    }
    let openedJson = '';
    let openedFields = '';
    let openerEl = null;
    let deferredCommit = null;
    // Operation values live in DOM fields until Apply copies them into the
    // draft — dirty detection must see them too, or a typed Height/Pattern
    // is silently dropped when another operation starts.
    const opFieldsNow = () =>
      JSON.stringify([
        $('bw-sk-op-h').value,
        $('bw-sk-through').checked,
        $('bw-sk-pat').value,
        $('bw-sk-pat-n').value,
        $('bw-sk-pat-a').value,
        $('bw-sk-pat-b').value,
      ]);
    function open(f, opts) {
      // Transactional edit: work on a deep copy so Cancel discards
      // everything and undo snapshots never see half-applied changes.
      // A caller (the face picker) can pass the control that started the
      // whole operation so focus returns there, not to the face bar it
      // just hid.
      openerEl = (opts && opts.opener) || document.activeElement;
      currentOpType = f.type;
      isNew = !doc.features.some((x) => x.id === f.id);
      feature = deepCopy(f);
      openedJson = JSON.stringify(feature);
      refOutline = opts?.refOutline || [];
      // Select from the DRAFT — selecting from the original would route the
      // dimension panel's mutations straight into the committed document.
      selShape = feature.sketch.shapes[feature.sketch.shapes.length - 1] || null;
      wrap.hidden = false;
      $('bw-sk-title').textContent = (isNew ? 'New ' : 'Edit ') + OP_LABEL[f.type].toLowerCase();
      $('bw-sk-op-h').value = f.h ?? 20;
      $('bw-sk-through').checked = Boolean(f.through);
      $('bw-sk-h-row').hidden = f.type === 'revolve';
      $('bw-sk-through-row').hidden = f.type !== 'cut';
      $('bw-sk-pat-row').hidden = f.type === 'revolve';
      $('bw-sk-pat').value = f.pattern?.kind || 'none';
      $('bw-sk-pat-n').value = f.pattern?.n || 4;
      $('bw-sk-pat-a').value = f.pattern?.kind === 'circular' ? (f.pattern?.cx ?? 0) : (f.pattern?.dx ?? 10);
      $('bw-sk-pat-b').value = f.pattern?.kind === 'circular' ? (f.pattern?.cy ?? 0) : (f.pattern?.dy ?? 0);
      syncPatternFields();
      $('bw-sk-hint').textContent =
        f.type === 'revolve'
          ? 'Lathe profile: x is radius from the axis (keep shapes at x ≥ 0), y is height. It spins around the left edge.'
          : f.onFace
            ? 'Sketching on the picked face — its outline is dashed. Extrude grows out of the face; Cut digs into it.'
            : 'Draw on the top plane, millimetres. Click-click to place; type exact numbers below.';
      wrapOpenMode();
      setTool('rect');
      resize();
      // Centre the view on what matters: the face outline (its plane origin
      // can be far from the face itself) and any existing shapes. Without
      // this, sketch-on-face can open onto empty grid with the face off
      // screen entirely.
      const xs = [], ys = [];
      for (const poly of refOutline) for (const p of poly) { xs.push(p[0]); ys.push(p[1]); }
      for (const s of f.sketch.shapes) {
        if (s.kind === 'rect') { const w = NS(s.w, 1), h = NS(s.h, 1), x = NS(s.x, 0), y = NS(s.y, 0); xs.push(x - w / 2, x + w / 2); ys.push(y - h / 2, y + h / 2); }
        else if (s.kind === 'circle') { const r = NS(s.r, 1), x = NS(s.x, 0), y = NS(s.y, 0); xs.push(x - r, x + r); ys.push(y - r, y + r); }
        else if (s.kind === 'poly') for (const p of s.pts) { xs.push(p[0]); ys.push(p[1]); }
      }
      if (xs.length) {
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        view.cx = (minX + maxX) / 2;
        view.cy = (minY + maxY) / 2;
        const span = Math.max(maxX - minX, maxY - minY, 10);
        const px = Math.min(canvas.width, canvas.height) / dpr();
        view.pxPerMm = Math.min(40, Math.max(0.4, (px * 0.7) / span));
      } else {
        view.cx = 0;
        view.cy = 0;
      }
      draw2d();
      syncShapePanel();
      openedFields = opFieldsNow();
    }
    // The two pattern number fields mean ΔX/ΔY for linear runs and centre
    // X/Y for circular rings; relabel as the kind changes.
    function syncPatternFields() {
      const kind = $('bw-sk-pat').value;
      $('bw-sk-pat-nums').hidden = kind === 'none';
      $('bw-sk-pat-la').textContent = kind === 'circular' ? 'centre X' : 'ΔX';
      $('bw-sk-pat-lb').textContent = kind === 'circular' ? 'centre Y' : 'ΔY';
    }
    $('bw-sk-pat').addEventListener('change', syncPatternFields);

    // Read a dimension field: keeps plain numbers as numbers, keeps valid
    // expressions as strings, throws (with the field name) otherwise.
    function readDim(id, label) {
      const raw = $(id).value.trim();
      try {
        N(raw);
      } catch (err) {
        throw new Error(label + ': ' + String(err?.message || err));
      }
      return /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
    }

    function close(applyIt) {
      if (applyIt) {
        try {
          feature.h = readDim('bw-sk-op-h', 'Height');
          feature.through = $('bw-sk-through').checked;
          const patKind = $('bw-sk-pat').value;
          if (patKind === 'none' || feature.type === 'revolve') {
            delete feature.pattern;
          } else {
            const n = Math.min(100, Math.max(2, Math.round(Number($('bw-sk-pat-n').value) || 2)));
            const a = readDim('bw-sk-pat-a', patKind === 'circular' ? 'Centre X' : 'ΔX');
            const b = readDim('bw-sk-pat-b', patKind === 'circular' ? 'Centre Y' : 'ΔY');
            feature.pattern =
              patKind === 'circular' ? { kind: 'circular', n, cx: a, cy: b } : { kind: 'linear', n, dx: a, dy: b };
            if (patKind === 'linear' && NS(a, 0) === 0 && NS(b, 0) === 0) {
              return say('A linear pattern needs a spacing — set ΔX or ΔY.');
            }
          }
        } catch (err) {
          return say(String(err?.message || err));
        }
        if (!feature.sketch.shapes.length) return say('Draw at least one shape.');
        // A face sketch drawn outside the face makes detached geometry —
        // warn (non-blocking) so a floating boss isn't a mystery.
        if (refOutline.length) {
          const xs = [], ys = [];
          for (const poly of refOutline) for (const p of poly) { xs.push(p[0]); ys.push(p[1]); }
          const inX = (v) => v >= Math.min(...xs) - 1 && v <= Math.max(...xs) + 1;
          const inY = (v) => v >= Math.min(...ys) - 1 && v <= Math.max(...ys) + 1;
          const stray = feature.sketch.shapes.some((s) => {
            const c = s.kind === 'poly' ? s.pts[0] : [s.x, s.y];
            return !inX(c[0]) || !inY(c[1]);
          });
          if (stray) say('Heads up: part of your sketch is outside the face outline (dashed) — it may not attach to the part.');
        }
        const draft = feature;
        if (!isNew && !doc.features.some((x) => x.id === draft.id)) {
          // The feature was deleted while this editor was open (undo, history
          // delete): applying would resurrect it.
          say('That feature no longer exists — nothing to apply.');
        } else {
          // Commit after the mode returns to idle (below) so the rebuild's
          // Rebuilding state is announced instead of being masked by the
          // still-open editor mode.
          const wasNew = isNew;
          deferredCommit = () =>
            commit((wasNew ? 'Add ' : 'Edit ') + OP_LABEL[draft.type].toLowerCase(), () => {
              const i = doc.features.findIndex((x) => x.id === draft.id);
              if (i >= 0) doc.features[i] = draft;
              else doc.features.push(draft);
            });
        }
      }
      wrap.hidden = true;
      feature = null;
      pending = null;
      setMode({ kind: 'idle' });
      if (deferredCommit) {
        const run = deferredCommit;
        deferredCommit = null;
        run();
      }
      if (openerEl && document.contains(openerEl)) openerEl.focus();
      openerEl = null;
    }
    $('bw-sk-apply').addEventListener('click', () => close(true));
    $('bw-sk-cancel').addEventListener('click', () => close(false));

    function setTool(t) {
      tool = t;
      pending = null;
      if (feature) setMode({ kind: 'sketching', tool: t, featureType: feature.type });
      document.querySelectorAll('[data-sktool]').forEach((b) => {
        b.classList.toggle('on', b.dataset.sktool === t);
        b.setAttribute('aria-pressed', b.dataset.sktool === t ? 'true' : 'false');
      });
      draw2d();
    }
    document.querySelectorAll('[data-sktool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.sktool)));

    const toMm = (px, py) => {
      const r = canvas.getBoundingClientRect();
      return [
        Math.round(view.cx + (px - r.left - r.width / 2) / view.pxPerMm),
        Math.round(view.cy - (py - r.top - r.height / 2) / view.pxPerMm),
      ];
    };
    const toPx = (x, y) => [
      canvas.width / 2 / dpr() + (x - view.cx) * view.pxPerMm,
      canvas.height / 2 / dpr() - (y - view.cy) * view.pxPerMm,
    ];
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      const r = wrap.getBoundingClientRect();
      const w = r.width, h = r.height - 96;
      canvas.width = Math.max(50, w * dpr());
      canvas.height = Math.max(50, h * dpr());
      canvas.style.width = w + 'px';
      canvas.style.height = h - 0 + 'px';
      draw2d();
    }

    function draw2d() {
      if (wrap.hidden) return;
      const w = canvas.width / dpr(), h = canvas.height / dpr();
      ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
      ctx.clearRect(0, 0, w, h);
      // grid
      const step = view.pxPerMm >= 4 ? 1 : view.pxPerMm >= 1.2 ? 5 : 10;
      ctx.strokeStyle = '#24313f';
      ctx.lineWidth = 1;
      const x0 = Math.floor(view.cx - w / 2 / view.pxPerMm), x1 = Math.ceil(view.cx + w / 2 / view.pxPerMm);
      const y0 = Math.floor(view.cy - h / 2 / view.pxPerMm), y1 = Math.ceil(view.cy + h / 2 / view.pxPerMm);
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        const [px] = toPx(x, 0);
        ctx.strokeStyle = x === 0 ? '#6d8db0' : x % (step * 5) === 0 ? '#2e3f52' : '#24313f';
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();
      }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        const [, py] = toPx(0, y);
        ctx.strokeStyle = y === 0 ? '#6d8db0' : y % (step * 5) === 0 ? '#2e3f52' : '#24313f';
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
        ctx.stroke();
      }
      if (!feature) return;
      // reference outline of the face being sketched on
      if (refOutline.length) {
        ctx.strokeStyle = '#8fa7c0';
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 1.5;
        for (const poly of refOutline) {
          ctx.beginPath();
          poly.forEach((p, i) => {
            const [px, py] = toPx(p[0], p[1]);
            i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          });
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      // shapes
      for (const s of feature.sketch.shapes) {
        ctx.strokeStyle = s === selShape ? '#4c9aff' : '#cfdcea';
        ctx.fillStyle = s === selShape ? 'rgba(76,154,255,0.16)' : 'rgba(207,220,234,0.08)';
        ctx.lineWidth = 2;
        pathShape(s);
        ctx.fill();
        ctx.stroke();
      }
      // pending
      if (pending) {
        ctx.strokeStyle = '#e67e22';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        pathShape(pending);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    function pathShape(s) {
      ctx.beginPath();
      if (s.kind === 'rect') {
        const w = NS(s.w, 1), h = NS(s.h, 1), x = NS(s.x, 0), y = NS(s.y, 0);
        const [px, py] = toPx(x - w / 2, y + h / 2);
        ctx.rect(px, py, w * view.pxPerMm, h * view.pxPerMm);
      } else if (s.kind === 'circle') {
        const [px, py] = toPx(NS(s.x, 0), NS(s.y, 0));
        ctx.arc(px, py, Math.max(0.1, NS(s.r, 1)) * view.pxPerMm, 0, Math.PI * 2);
      } else if (s.kind === 'poly') {
        s.pts.forEach((p, i) => {
          const [px, py] = toPx(p[0], p[1]);
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
        if (s.closed !== false) ctx.closePath();
      }
    }

    // pointer handling: click-click placement, wheel zoom, drag-pan (2nd button or two fingers not handled; single-pointer pan via 'pan' tool)
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      view.pxPerMm = Math.min(40, Math.max(0.4, view.pxPerMm * f));
      draw2d();
    }, { passive: false });
    let panFrom = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (tool === 'pan' || e.button === 1) {
        panFrom = [e.clientX, e.clientY, view.cx, view.cy];
        canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (panFrom) {
        view.cx = panFrom[2] - (e.clientX - panFrom[0]) / view.pxPerMm;
        view.cy = panFrom[3] + (e.clientY - panFrom[1]) / view.pxPerMm;
        draw2d();
        return;
      }
      if (pending) {
        updatePending(...toMm(e.clientX, e.clientY));
        draw2d();
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (panFrom) {
        panFrom = null;
        return;
      }
      if (e.button !== 0) return;
      const [mx, my] = toMm(e.clientX, e.clientY);
      clickAt(mx, my, e);
    });
    canvas.addEventListener('dblclick', () => {
      if (pending?.kind !== 'poly') return;
      // The closing double-click also registered as ordinary clicks, so the
      // point list carries duplicates; collapse them (and a wrapped-around
      // last point) before handing the profile to the kernel.
      const pts = [];
      for (const p of pending.pts) {
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.5) pts.push(p);
      }
      while (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.5) pts.pop();
      if (pts.length < 3) return say('A polygon needs at least three points — click them, then double-click to close.');
      const shape = { kind: 'poly', pts, closed: true };
      feature.sketch.shapes.push(shape);
      selShape = shape;
      pending = null;
      draw2d();
      syncShapePanel();
    });

    function clickAt(mx, my) {
      if (tool === 'rect') {
        if (!pending) pending = { kind: 'rect', ax: mx, ay: my, x: mx, y: my, w: 0, h: 0 };
        else commitPending();
      } else if (tool === 'circle') {
        if (!pending) pending = { kind: 'circle', x: mx, y: my, r: 0 };
        else commitPending();
      } else if (tool === 'poly') {
        if (!pending) pending = { kind: 'poly', pts: [[mx, my], [mx, my]], closed: false };
        else pending.pts.push([mx, my]);
      } else if (tool === 'select') {
        // Not findLast: ES2023, missing on the older mobile browsers this
        // studio explicitly targets.
        selShape = null;
        for (let i = feature.sketch.shapes.length - 1; i >= 0; i--) {
          if (hitShape(feature.sketch.shapes[i], mx, my)) {
            selShape = feature.sketch.shapes[i];
            break;
          }
        }
        syncShapePanel();
        draw2d();
      }
    }
    function updatePending(mx, my) {
      if (pending.kind === 'rect') {
        pending.w = Math.max(1, Math.abs(mx - pending.ax));
        pending.h = Math.max(1, Math.abs(my - pending.ay));
        pending.x = (mx + pending.ax) / 2;
        pending.y = (my + pending.ay) / 2;
      } else if (pending.kind === 'circle') {
        pending.r = Math.max(1, Math.round(Math.hypot(mx - pending.x, my - pending.y)));
      } else if (pending.kind === 'poly') {
        pending.pts[pending.pts.length - 1] = [mx, my];
      }
    }
    function commitPending() {
      const s = pending;
      // Two clicks in the same spot make degenerate geometry the kernel
      // rejects much later with a cryptic error — catch it here instead.
      if (s.kind === 'rect' && (s.w < 1 || s.h < 1)) {
        return say('Click the opposite corner a little further away (1 mm minimum).');
      }
      if (s.kind === 'circle' && s.r < 0.5) {
        return say('Click the edge of the circle away from the centre (0.5 mm minimum radius).');
      }
      delete s.ax;
      delete s.ay;
      pending = null;
      feature.sketch.shapes.push(s);
      selShape = s;
      syncShapePanel();
      draw2d();
    }
    function hitShape(s, x, y) {
      if (s.kind === 'rect') return Math.abs(x - NS(s.x, 0)) <= NS(s.w, 1) / 2 && Math.abs(y - NS(s.y, 0)) <= NS(s.h, 1) / 2;
      if (s.kind === 'circle') return Math.hypot(x - NS(s.x, 0), y - NS(s.y, 0)) <= NS(s.r, 1);
      if (s.kind === 'poly') {
        let inside = false;
        const p = s.pts;
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          if (p[i][1] > y !== p[j][1] > y && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
        }
        return inside;
      }
      return false;
    }

    // exact-dimension panel for the selected shape
    function syncShapePanel() {
      const p = $('bw-sk-dims');
      if (!selShape) {
        p.innerHTML = '<span class="sk-note">Nothing selected.</span>';
        return;
      }
      const s = selShape;
      // Dimension fields accept parameter expressions ("wall*2"), so they
      // are text inputs showing the raw stored value.
      const escAttr = (v) => String(v).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
      const num = (label, key, val) =>
        '<label>' + label + ' <input type="text" inputmode="decimal" data-dim="' + key + '" value="' + escAttr(val) + '" /></label>';
      const dia = typeof s.r === 'number' ? s.r * 2 : '(' + s.r + ')*2';
      if (s.kind === 'rect') p.innerHTML = num('W', 'w', s.w) + num('H', 'h', s.h) + num('X', 'x', s.x) + num('Y', 'y', s.y) + '<button id="bw-sk-delshape">Delete shape</button>';
      else if (s.kind === 'circle') p.innerHTML = num('Ø', 'd', dia) + num('X', 'x', s.x) + num('Y', 'y', s.y) + '<button id="bw-sk-delshape">Delete shape</button>';
      else p.innerHTML = '<span class="sk-note">Polygon · ' + s.pts.length + ' points</span><button id="bw-sk-delshape">Delete shape</button>';
      p.querySelectorAll('[data-dim]').forEach((inp) =>
        inp.addEventListener('change', () => {
          const raw = inp.value.trim();
          const k = inp.dataset.dim;
          let value;
          try {
            const evaluated = N(raw);
            value = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
            if ((k === 'w' || k === 'h' || k === 'd') && evaluated < 0.1) throw new Error('too small');
          } catch (err) {
            say('Not a usable value: ' + String(err?.message || err));
            return;
          }
          if (k === 'd') s.r = typeof value === 'number' ? value / 2 : '(' + value + ')/2';
          else s[k] = value;
          draw2d();
        }),
      );
      $('bw-sk-delshape')?.addEventListener('click', () => {
        feature.sketch.shapes = feature.sketch.shapes.filter((x) => x !== selShape);
        selShape = null;
        syncShapePanel();
        draw2d();
      });
    }

    return {
      open,
      resize,
      isOpen: () => !wrap.hidden,
      cancel: () => {
        if (!wrap.hidden) close(false);
      },
      isDirty: () => Boolean(feature) && (Boolean(pending) || JSON.stringify(feature) !== openedJson || opFieldsNow() !== openedFields),
    };
  })();

  // --- edge picker (fillet / chamfer) --------------------------------------
  const picker = (() => {
    const bar = $('bw-pick');
    let feature = null;
    let isNew = false;
    let touched = false;
    let openedR = '';
    let openerEl = null;
    const SEL = 0xe67e22;

    function open(f) {
      if (!edgeLines.length) return say('Build something first — fillets round the edges of an existing part.');
      openerEl = document.activeElement;
      currentOpType = f.type;
      touched = false;
      isNew = !doc.features.some((x) => x.id === f.id);
      feature = deepCopy(f); // transactional: document untouched until Apply
      setMode({ kind: 'picking-edges', feat: feature.type, count: 0 });
      bar.hidden = false;
      $('bw-pick-title').textContent = (isNew ? 'New ' : 'Edit ') + OP_LABEL[f.type].toLowerCase();
      $('bw-pick-r').value = f.r ?? 2;
      openedR = $('bw-pick-r').value;
      // Preselect edges whose signature still matches (edit case).
      for (const line of edgeLines) {
        const on = line.userData.sig && f.edges.some((sig) => sigMatches2(sig, line.userData.sig));
        line.material.color.setHex(on ? SEL : 0x2c3e50);
        line.userData.picked = on;
      }
      syncCount();
    }
    // Signature-vs-signature comparison (both already quantized).
    const sigMatches2 = (a, b) =>
      Math.abs(a.l - b.l) < 0.05 && Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]) < 0.05;

    function close(applyIt) {
      if (applyIt && feature) {
        const raw = $('bw-pick-r').value.trim();
        try {
          N(raw);
        } catch (err) {
          return say('Radius: ' + String(err?.message || err));
        }
        feature.r = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
        const picked = edgeLines.filter((l) => l.userData.picked).map((l) => l.userData.sig);
        if (picked.length) feature.edges = picked;
        else if (isNew) return say('Pick at least one edge (click the dark lines on the part).');
        // else: editing — the feature's own rounding replaced the original
        // edges on screen, so a radius-only edit keeps the stored edges.
        const draft = feature;
        let run = null;
        if (!isNew && !doc.features.some((x) => x.id === draft.id)) {
          say('That feature no longer exists — nothing to apply.');
        } else {
          const wasNew = isNew;
          run = () =>
            commit((wasNew ? 'Add ' : 'Edit ') + OP_LABEL[draft.type].toLowerCase(), () => {
              const i = doc.features.findIndex((x) => x.id === draft.id);
              if (i >= 0) doc.features[i] = draft;
              else doc.features.push(draft);
            });
        }
        for (const line of edgeLines) line.userData.picked = false;
        bar.hidden = true;
        feature = null;
        setMode({ kind: 'idle' });
        if (run) run();
      } else {
        for (const line of edgeLines) line.material.color.setHex(0x2c3e50);
        bar.hidden = true;
        feature = null;
        setMode({ kind: 'idle' });
      }
      if (openerEl && document.contains(openerEl)) openerEl.focus();
      openerEl = null;
    }
    $('bw-pick-apply').addEventListener('click', () => close(true));
    $('bw-pick-cancel').addEventListener('click', () => close(false));
    function syncCount() {
      const n = edgeLines.filter((l) => l.userData.picked).length;
      $('bw-pick-count').textContent = n + ' picked';
      if (feature) setMode({ kind: 'picking-edges', feat: feature.type, count: n });
    }

    // Click-to-toggle edges (with a drag guard so orbiting doesn't pick).
    const ray = new THREE.Raycaster();
    ray.params.Line = { threshold: 1.2 };
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => {
      down = [e.clientX, e.clientY];
    });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!feature || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ptr = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(edgeLines, false)[0];
      if (!hit || !hit.object.userData.sig) return;
      const line = hit.object;
      line.userData.picked = !line.userData.picked;
      line.material.color.setHex(line.userData.picked ? SEL : 0x2c3e50);
      touched = true;
      syncCount();
    });

    return {
      open,
      cancel: () => feature && close(false),
      active: () => Boolean(feature),
      isDirty: () => Boolean(feature) && (touched || $('bw-pick-r').value !== openedR),
    };
  })();

  // Debug handle for automated tests; not part of the public surface.
  window.__bwStudio = {
    edges: () => edgeLines.length,
    visible: () => stageVisible,
    frame: () => {
      orbit.update();
      renderer.render(scene, camera);
    },
    top: () => {
      if (Array.isArray(meshBounds) && meshBounds.length === 2) return meshBounds[1][2];
      if (Array.isArray(meshBounds) && meshBounds.length === 6) return meshBounds[5];
      return null;
    },
    errors: () => doc.features.filter((f) => buildErrors.has(f.id)).map((f) => f.type + ': ' + buildErrors.get(f.id)),
    mode: () => mode,
    modeLog: () => [...modeLog],
    cameraDir: () => {
      const d = camera.position.clone().sub(orbit.target).normalize();
      return [d.x, d.y, d.z];
    },
    ndcOfPartCenter: () => {
      if (!solidMesh) return null;
      solidMesh.geometry.computeBoundingSphere();
      const bs = solidMesh.geometry.boundingSphere;
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      const v = new THREE.Vector3(bs.center.x, bs.center.z, -bs.center.y).project(camera);
      return [v.x, v.y];
    },
    undoDepth: () => undoStack.length,
    redoDepth: () => redoStack.length,
    documentRevision: () => documentRevision,
    appliedRevision: () => latestAppliedRevision,
    appliedRevisionLog: () => [...appliedRevisionLog],
    projectId: () => projectId,
    kernelWorkerActive: () => Boolean(kernelWorker),
    kernelGeneration: () => kernelGeneration,
    kernelRestartCount: () => kernelRestartCount,
    failKernelForTest: () => kernelWorker && handleKernelFailure(kernelWorker, new Error('Simulated worker failure.')),
    delayNextKernelReply: (milliseconds) => {
      nextKernelReplyDelay = Math.max(0, Math.min(5000, Number(milliseconds) || 0));
    },
    rebuildForTest: () => rebuild(),
    flushStorage: async () => {
      await latestStorageWrite;
      return (await journalReady)?.flush();
    },
    recovery: async () => (await journalReady)?.listRecovery() || [],
    journalState: async () => (await journalReady)?.loadActive() || null,
    exportForTest: async (kind) => {
      const response = await kernelCall(kind === 'step' ? 'export-step' : 'export-stl', documentRevision);
      return { size: response.blob?.size || 0, type: response.blob?.type || '', errors: response.errors || [] };
    },
    undoLabels: () => undoStack.map((e) => e.label),
    docJson: () => JSON.stringify(doc),
    triCount: () => {
      const g = solidMesh?.geometry;
      return g ? (g.getIndex() ? g.getIndex().count / 3 : g.getAttribute('position').count / 3) : 0;
    },
    pickAt: (fx, fy) => {
      const ray = new THREE.Raycaster();
      ray.params.Line = { threshold: 1.5 };
      ray.setFromCamera(new THREE.Vector2(fx * 2 - 1, -(fy * 2 - 1)), camera);
      const hit = ray.intersectObjects(edgeLines, false)[0];
      return hit ? { sig: hit.object.userData.sig, dist: hit.distance } : null;
    },
    faces: () => faceByHash.size,
    ndcOfOrigin: () => {
      const v = new THREE.Vector3(0, 5, 0).project(camera);
      return [v.x, v.y];
    },
    rayMeshAt: (fx, fy) => {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(fx * 2 - 1, -(fy * 2 - 1)), camera);
      const hit = solidMesh ? ray.intersectObject(solidMesh, false)[0] : null;
      return hit ? { faceIndex: hit.faceIndex, dist: Math.round(hit.distance) } : null;
    },
    pickFace: (i) => {
      // Test shortcut: return the sig of the i-th planar face.
      const face = [...faceByHash.values()][i];
      return face ? faceSig(face) : null;
    },
    pickSigs: (n) => {
      // Toggle the first n distinct pickable edges directly (test shortcut).
      const out = [];
      for (const l of edgeLines) {
        if (out.length >= n) break;
        if (l.userData.sig) {
          l.userData.picked = true;
          out.push(l.userData.sig);
        }
      }
      return out;
    },
  };

  // Copy one B-rep face's triangles into a standalone highlight mesh (no
  // shared GPU buffers — disposing shared attributes would strip the main
  // mesh). Used by the face picker and the shell picker.
  function buildFaceHighlight(range, color, opacity) {
    if (!solidMesh) return null;
    const posAttr = solidMesh.geometry.getAttribute('position');
    const idx = solidMesh.geometry.getIndex().array;
    const arr = new Float32Array((range.t1 - range.t0) * 9);
    let o = 0;
    for (let t = range.t0 * 3; t < range.t1 * 3; t++) {
      const vi = idx[t];
      arr[o++] = posAttr.getX(vi);
      arr[o++] = posAttr.getY(vi);
      arr[o++] = posAttr.getZ(vi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: opacity ?? 0.5,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    partGroup.add(mesh);
    return mesh;
  }
  function dropHighlight(mesh) {
    if (!mesh) return;
    partGroup.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  // --- shell picker (hollow a part, pick the opening faces) ----------------
  const shellPick = (() => {
    const bar = $('bw-shell');
    let feature = null;
    let isNew = false;
    let cycleIdx = -1;
    let cycleMesh = null; // orange preview of the cycled face
    let touched = false;
    let openedT = '';
    let openerEl = null;
    let deferredCommit = null;
    const picked = new Map(); // faceId -> {sig, mesh}

    const planarRanges = () => faceRanges.filter((r) => faceByHash.has(r.faceId));

    function open(f) {
      if (!solidMesh || !faceByHash.size) return say('Build something first — Shell hollows an existing part.');
      openerEl = document.activeElement;
      currentOpType = 'shell';
      touched = false;
      isNew = !doc.features.some((x) => x.id === f.id);
      feature = deepCopy(f); // transactional: document untouched until Apply
      setMode({ kind: 'picking-faces', count: 0 });
      cycleIdx = -1;
      bar.hidden = false;
      $('bw-shell-title').textContent = (isNew ? 'New ' : 'Edit ') + 'shell';
      $('bw-shell-t').value = f.t ?? 2;
      openedT = $('bw-shell-t').value;
      // Preselect openings whose signature still matches (edit case). After
      // a shell has applied, its opening faces are gone from the display
      // shape, so this often finds nothing — thickness-only edits still work.
      picked.clear();
      for (const r of planarRanges()) {
        const face = faceByHash.get(r.faceId);
        if (f.faces?.some((sig) => faceMatches(sig, face))) {
          picked.set(r.faceId, { sig: faceSig(face), mesh: buildFaceHighlight(r, 0x2e8b57, 0.55) });
        }
      }
      syncCount();
    }
    function close(applyIt) {
      if (applyIt && feature) {
        const raw = $('bw-shell-t').value.trim();
        try {
          N(raw);
        } catch (err) {
          return say('Walls: ' + String(err?.message || err));
        }
        feature.t = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
        const sigs = [...picked.values()].map((p) => p.sig);
        if (sigs.length) feature.faces = sigs;
        else if (isNew) return say('Pick at least one face to open — that face becomes the mouth of the hollow.');
        // else: edit with no re-pick keeps the stored openings (they are not
        // visible on the shelled part), so thickness edits just work.
        const draft = feature;
        if (!isNew && !doc.features.some((x) => x.id === draft.id)) {
          say('That feature no longer exists — nothing to apply.');
        } else {
          const wasNew = isNew;
          deferredCommit = () =>
            commit((wasNew ? 'Add ' : 'Edit ') + 'shell', () => {
              const i = doc.features.findIndex((x) => x.id === draft.id);
              if (i >= 0) doc.features[i] = draft;
              else doc.features.push(draft);
            });
        }
      }
      for (const p of picked.values()) dropHighlight(p.mesh);
      picked.clear();
      dropHighlight(cycleMesh);
      cycleMesh = null;
      bar.hidden = true;
      feature = null;
      setMode({ kind: 'idle' });
      if (deferredCommit) {
        const run = deferredCommit;
        deferredCommit = null;
        run();
      }
      if (openerEl && document.contains(openerEl)) openerEl.focus();
      openerEl = null;
    }
    $('bw-shell-apply').addEventListener('click', () => close(true));
    $('bw-shell-cancel').addEventListener('click', () => close(false));
    function syncCount() {
      $('bw-shell-count').textContent = picked.size + ' opening' + (picked.size === 1 ? '' : 's');
      if (feature) setMode({ kind: 'picking-faces', count: picked.size });
    }

    function toggleRange(range) {
      touched = true;
      const had = picked.get(range.faceId);
      if (had) {
        dropHighlight(had.mesh);
        picked.delete(range.faceId);
      } else {
        const face = faceByHash.get(range.faceId);
        picked.set(range.faceId, { sig: faceSig(face), mesh: buildFaceHighlight(range, 0x2e8b57, 0.55) });
      }
      syncCount();
    }
    $('bw-shell-next').addEventListener('click', () => {
      const list = planarRanges();
      if (!list.length) return;
      cycleIdx = (cycleIdx + 1) % list.length;
      dropHighlight(cycleMesh);
      cycleMesh = buildFaceHighlight(list[cycleIdx], 0xe67e22, 0.45);
    });
    $('bw-shell-toggle').addEventListener('click', () => {
      const list = planarRanges();
      if (cycleIdx >= 0 && list[cycleIdx]) toggleRange(list[cycleIdx]);
    });

    const ray = new THREE.Raycaster();
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => {
      down = [e.clientX, e.clientY];
    });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!feature || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      if (!solidMesh) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObject(solidMesh, false)[0];
      if (!hit) return;
      const range = faceRanges.find((r) => hit.faceIndex >= r.t0 && hit.faceIndex < r.t1);
      if (!range || !faceByHash.has(range.faceId)) return say('That surface is curved — pick a flat face.');
      toggleRange(range);
    });

    return {
      open,
      cancel: () => feature && close(false),
      active: () => Boolean(feature),
      isDirty: () => Boolean(feature) && (touched || $('bw-shell-t').value !== openedT),
    };
  })();

  // --- face picker (sketch-on-face for extrude / cut) ----------------------
  const facePick = (() => {
    const bar = $('bw-face');
    let draft = null;
    let cycleIdx = -1;
    let highlight = null;

    let openerEl = null;
    function open(f) {
      openerEl = document.activeElement;
      currentOpType = f.type;
      draft = f;
      cycleIdx = -1;
      setMode({ kind: 'choose-face', feat: f.type });
      bar.hidden = false;
      $('bw-face-use').hidden = true;
      $('bw-face-title').textContent = 'New ' + OP_LABEL[f.type].toLowerCase();
    }
    function close(toSketch) {
      // Capture the opener BEFORE hiding the bar — hiding blurs the clicked
      // button, so document.activeElement would already be <body>.
      const opener = openerEl && document.contains(openerEl) ? openerEl : null;
      bar.hidden = true;
      draft = null;
      clearHighlight();
      $('bw-face-use').hidden = true;
      setMode({ kind: 'idle' });
      openerEl = null;
      // On cancel, restore focus here; on hand-off, pass the opener to the
      // sketcher so it restores focus to the ribbon button that started it.
      if (toSketch) return opener;
      if (opener) opener.focus();
      return null;
    }
    $('bw-face-base').addEventListener('click', () => {
      const f = draft;
      const opener = close(true);
      sketch.open(f, { opener });
    });
    $('bw-face-cancel').addEventListener('click', () => close(false));

    // Step-through selection: precision clicks are hard on phones, and flat
    // faces can hide behind each other. Next face highlights each planar
    // face in turn; Use this face takes it.
    const planarRanges = () => faceRanges.filter((r) => faceByHash.has(r.faceId));
    function clearHighlight() {
      dropHighlight(highlight);
      highlight = null;
    }
    function showHighlight(range) {
      clearHighlight();
      highlight = buildFaceHighlight(range, 0xe67e22, 0.5);
    }
    $('bw-face-next').addEventListener('click', () => {
      const list = planarRanges();
      if (!list.length) return say('No flat faces to sketch on yet.');
      cycleIdx = (cycleIdx + 1) % list.length;
      showHighlight(list[cycleIdx]);
      $('bw-face-use').hidden = false;
    });
    $('bw-face-use').addEventListener('click', () => {
      const list = planarRanges();
      const face = cycleIdx >= 0 && list[cycleIdx] && faceByHash.get(list[cycleIdx].faceId);
      if (!face) return;
      chooseFace(face);
    });

    function chooseFace(face) {
      const f = draft;
      f.onFace = faceSig(face);
      const outline = deepCopy(face.outline || []);
      const opener = close(true);
      sketch.open(f, { refOutline: outline, opener });
    }

    const ray = new THREE.Raycaster();
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => {
      down = [e.clientX, e.clientY];
    });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!draft || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      if (!solidMesh) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObject(solidMesh, false)[0];
      if (!hit) return;
      const range = faceRanges.find((r) => hit.faceIndex >= r.t0 && hit.faceIndex < r.t1);
      const face = range && faceByHash.get(range.faceId);
      if (!face) return say('That surface is curved — pick a flat face.');
      chooseFace(face);
    });

    return { open, cancel: () => close(false), active: () => Boolean(draft) };
  })();


  // --- view presets ---------------------------------------------------------
  // Fixed directions (three.js is Y-up here); centre and distance come from
  // the real part bounds — partGroup rotates -90° about X, so a CAD-space
  // bounding-sphere centre (x,y,z) sits at world (x, z, -y).
  function partView() {
    if (!solidMesh) return { c: new THREE.Vector3(0, 5, 0), r: 60 };
    solidMesh.geometry.computeBoundingSphere();
    const bs = solidMesh.geometry.boundingSphere;
    return {
      c: new THREE.Vector3(bs.center.x, bs.center.z, -bs.center.y),
      r: Math.max(10, bs.radius * 2.1),
    };
  }
  function partRadius() {
    return partView().r;
  }
  const VIEW_DIRS = {
    top: [0, 1, 0.0001],
    front: [0, 0.0001, 1],
    right: [1, 0.0001, 0],
    iso: [1, 0.8, 1],
  };
  function syncViewPressed(name) {
    document.querySelectorAll('[data-view], [data-cube-view]').forEach((b) => {
      const viewName = b.dataset.view || b.dataset.cubeView;
      if (viewName === 'fit') return; // Fit is momentary, not a state
      b.setAttribute('aria-pressed', viewName === name ? 'true' : 'false');
      b.classList.toggle('on', viewName === name);
    });
  }
  function setView(name) {
    const { c, r } = partView();
    if (name === 'fit') {
      const dir = camera.position.clone().sub(orbit.target).normalize();
      orbit.target.copy(c);
      camera.position.copy(c.clone().add(dir.multiplyScalar(r * 1.4)));
      orbit.update();
      return;
    }
    const d = VIEW_DIRS[name];
    if (!d) return;
    const v = new THREE.Vector3(d[0], d[1], d[2]).normalize().multiplyScalar(r * 1.6);
    camera.position.copy(c.clone().add(v));
    orbit.target.copy(c);
    orbit.update();
    syncViewPressed(name);
  }
  // Hand-orbiting leaves the preset views; drop their pressed state.
  orbit.addEventListener('start', () => syncViewPressed(null));
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('[data-cube-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.cubeView)));
  $('bw-tree-base')?.addEventListener('click', () => {
    setView('top');
    say('Base plane selected · looking normal to XY.');
  });
  let navMode = 'orbit';
  function setNavMode(name) {
    if (name !== 'orbit' && name !== 'pan') return;
    navMode = name;
    orbit.mouseButtons.LEFT = name === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    document.querySelectorAll('[data-nav-mode]').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.navMode === name ? 'true' : 'false');
    });
    say(name === 'pan' ? 'Pan mode · drag the canvas to move the view.' : 'Orbit mode · drag the canvas to rotate the part.');
  }
  document.querySelectorAll('[data-nav-mode]').forEach((b) => b.addEventListener('click', () => setNavMode(b.dataset.navMode)));
  $('bw-undo')?.addEventListener('click', undo);
  $('bw-redo')?.addEventListener('click', redo);

  // Double-click a flat face in idle: align the view to its normal.
  renderer.domElement.addEventListener('dblclick', (e) => {
    if (mode.kind !== 'idle' || !solidMesh) return;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1),
      camera,
    );
    const hit = ray.intersectObject(solidMesh, false)[0];
    if (!hit) return;
    const range = faceRanges.find((rr) => hit.faceIndex >= rr.t0 && hit.faceIndex < rr.t1);
    const face = range && faceByHash.get(range.faceId);
    if (!face) return;
    const n = face.sig.n;
    // CAD Z-up normal -> three Y-up direction
    const dir = new THREE.Vector3(n[0], n[2], -n[1]).normalize();
    const r = partRadius();
    camera.position.copy(orbit.target.clone().add(dir.multiplyScalar(r * 1.6)));
    orbit.update();
  });

  // --- operation coordinator -----------------------------------------------
  // Single entry point for anything that opens an editor (feature buttons,
  // history Edit, context Edit). A working mode with untouched state is
  // dropped silently; touched state asks before being discarded.
  function activeDraftDirty() {
    if (mode.kind === 'sketching') return sketch.isDirty();
    if (mode.kind === 'picking-edges') return picker.isDirty();
    if (mode.kind === 'picking-faces') return shellPick.isDirty();
    return false;
  }
  function cancelAllEditors() {
    sketch.cancel();
    picker.cancel();
    shellPick.cancel();
    facePick.cancel();
  }
  function startOperation(fn, opts) {
    if (isWorking(mode.kind)) {
      if (!opts?.discardConfirmed && activeDraftDirty() && !window.confirm('Discard the unfinished edit in progress?')) return false;
      cancelAllEditors();
    }
    fn();
    return true;
  }

  // --- editable component templates --------------------------------------
  const templateDialog = $('bw-templates');
  let templateLibrary = [];
  let templateCategories = [];
  let templateCategory = 'All parts';
  let selectedTemplate = null;
  let templateLibraryFromWelcome = false;

  const previewFamily = (preview) => {
    if (/tray|lid|case|battery/.test(preview)) return 'tray';
    if (/ring|spacer|collar|knob|pulley|bushing|hub|pin|flange|servo/.test(preview)) return 'round';
    if (/hook|phone/.test(preview)) return 'profile';
    if (/mount|bracket|bearing|drill|template|comb|bench|camera|tie/.test(preview)) return 'mount';
    return 'plate';
  };
  function templatePreviewSvg(template) {
    const family = previewFamily(template.preview);
    if (family === 'round') {
      return '<svg viewBox="0 0 240 160" role="img"><ellipse class="solid" cx="120" cy="83" rx="66" ry="42"/><ellipse class="edge" cx="120" cy="72" rx="66" ry="42"/><ellipse class="edge" cx="120" cy="72" rx="22" ry="14"/><path class="hidden-edge" d="M54 72v12m132-12v12M98 72v11m44-11v11"/></svg>';
    }
    if (family === 'tray') {
      return '<svg viewBox="0 0 240 160" role="img"><path class="solid" d="m48 52 82-28 65 30-82 31zM48 52v50l65 31 82-31V54M65 61v32l49 23 62-23V61"/><path class="edge" d="m65 61 64-22 47 22-62 24z"/></svg>';
    }
    if (family === 'profile') {
      return '<svg viewBox="0 0 240 160" role="img"><path class="solid" d="M71 130V36h30v52h45V54h29v68h-18v-14h-74v22z"/><path class="hidden-edge" d="m71 36 13-8h30l-13 8m74 18 12-8v68l-12 8"/></svg>';
    }
    if (family === 'mount') {
      return '<svg viewBox="0 0 240 160" role="img"><path class="solid" d="m40 57 112-32 50 35-112 34zM40 57v34l50 35 112-34V60"/><ellipse class="edge" cx="79" cy="65" rx="7" ry="4"/><ellipse class="edge" cx="151" cy="45" rx="7" ry="4"/><ellipse class="edge" cx="106" cy="83" rx="7" ry="4"/><ellipse class="edge" cx="177" cy="63" rx="7" ry="4"/></svg>';
    }
    return '<svg viewBox="0 0 240 160" role="img"><path class="solid" d="m42 56 110-31 47 33-109 34zM42 56v35l48 34 109-34V58"/><ellipse class="edge" cx="120" cy="68" rx="16" ry="9"/><path class="hidden-edge" d="M104 68v34m32-34v24"/></svg>';
  }
  function templateMiniFamily(template) {
    const family = previewFamily(template.preview);
    return family === 'round' ? 'knob' : family === 'tray' ? 'tray' : family === 'mount' ? 'mount' : 'plate';
  }
  function setTemplateSelection(template) {
    selectedTemplate = template;
    document.querySelectorAll('.ws-template-card').forEach((card) => card.setAttribute('aria-selected', String(card.dataset.templateId === template?.id)));
    $('bw-template-use').disabled = !template;
    if (!template) return;
    $('bw-template-category').textContent = template.category + ' · ' + template.document.features.length + ' feature' + (template.document.features.length === 1 ? '' : 's');
    $('bw-template-name').textContent = template.name;
    $('bw-template-description').textContent = template.description;
    $('bw-template-size').textContent = template.size;
    $('bw-template-level').textContent = template.difficulty;
    $('bw-template-preview').innerHTML = templatePreviewSvg(template);
    const recipe = $('bw-template-recipe');
    recipe.replaceChildren(...template.recipe.map((step) => {
      const li = document.createElement('li');
      li.textContent = step;
      return li;
    }));
  }
  function renderTemplateLibrary() {
    const query = String($('bw-template-search')?.value || '').trim().toLowerCase();
    const filtered = templateLibrary.filter((template) => {
      const inCategory = templateCategory === 'All parts' || template.category === templateCategory;
      const haystack = [template.name, template.category, template.description, ...template.tags].join(' ').toLowerCase();
      return inCategory && (!query || haystack.includes(query));
    });
    const list = $('bw-template-list');
    list.replaceChildren();
    for (const template of filtered) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'ws-template-card';
      card.dataset.templateId = template.id;
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', String(template.id === selectedTemplate?.id));
      const mini = document.createElement('span');
      mini.className = 'ws-template-mini';
      mini.dataset.shape = templateMiniFamily(template);
      mini.setAttribute('aria-hidden', 'true');
      const name = document.createElement('b');
      name.textContent = template.name;
      const detail = document.createElement('small');
      detail.textContent = template.document.features.length + ' feature' + (template.document.features.length === 1 ? '' : 's') + ' · ' + template.document.params.length + ' parameters';
      card.append(mini, name, detail);
      card.addEventListener('click', () => setTemplateSelection(template));
      card.addEventListener('dblclick', () => useTemplate(template));
      list.appendChild(card);
    }
    $('bw-template-count').textContent = filtered.length + ' part' + (filtered.length === 1 ? '' : 's');
    if (!selectedTemplate || !filtered.includes(selectedTemplate)) setTemplateSelection(filtered[0] || null);
  }
  async function ensureTemplateLibrary() {
    if (templateLibrary.length) return;
    const module = await templatesReady;
    templateLibrary = module.STUDIO_TEMPLATES;
    templateCategories = module.STUDIO_TEMPLATE_CATEGORIES;
    const nav = $('bw-template-categories');
    for (const category of ['All parts', ...templateCategories]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.templateCategory = category;
      const label = document.createElement('b');
      label.textContent = category;
      const count = document.createElement('span');
      count.textContent = String(category === 'All parts' ? templateLibrary.length : templateLibrary.filter((item) => item.category === category).length).padStart(2, '0');
      button.append(label, count);
      button.addEventListener('click', () => {
        templateCategory = category;
        nav.querySelectorAll('button').forEach((entry) => entry.setAttribute('aria-pressed', String(entry === button)));
        renderTemplateLibrary();
      });
      nav.appendChild(button);
    }
    nav.firstElementChild?.setAttribute('aria-pressed', 'true');
    renderTemplateLibrary();
  }
  async function openTemplateLibrary() {
    templateLibraryFromWelcome = !$('bw-welcome')?.hidden;
    if (templateLibraryFromWelcome) hideWelcome();
    await ensureTemplateLibrary();
    if (typeof templateDialog?.showModal === 'function') {
      if (!templateDialog.open) templateDialog.showModal();
    } else templateDialog?.setAttribute('open', '');
    requestAnimationFrame(() => $('bw-template-search')?.focus());
  }
  function closeTemplateLibrary(used = false) {
    if (typeof templateDialog?.close === 'function' && templateDialog.open) templateDialog.close();
    else templateDialog?.removeAttribute('open');
    if (!used && templateLibraryFromWelcome && !hasFlag(WELCOME)) showWelcome();
    templateLibraryFromWelcome = false;
  }
  async function useTemplate(template) {
    if (!template) return;
    if (doc.features.length && !window.confirm('Start a new part from “' + template.name + '”? Your current part will remain in Recover.')) return;
    if (!startOperation(() => {})) return;
    if (doc.features.length) await save('Before opening ' + template.name);
    const { prepareStudioDocument } = await documentToolsReady;
    projectId = makeProjectId();
    doc = normalizeDoc(prepareStudioDocument(structuredClone(template.document)));
    undoStack.length = 0;
    redoStack.length = 0;
    selectedFeatureId = null;
    finishWelcome();
    closeTemplateLibrary(true);
    afterDocumentChange('Started from ' + template.name);
    say('Opened “' + template.name + '” — select a feature or parameter to change it.');
    if (!hasFlag(TOUR_SEEN)) setTimeout(() => startTour('part'), 350);
  }
  $('bw-templates-open')?.addEventListener('click', openTemplateLibrary);
  $('bw-welcome-templates')?.addEventListener('click', openTemplateLibrary);
  $('bw-templates-close')?.addEventListener('click', () => closeTemplateLibrary());
  $('bw-template-search')?.addEventListener('input', renderTemplateLibrary);
  $('bw-template-use')?.addEventListener('click', () => useTemplate(selectedTemplate));
  templateDialog?.addEventListener('click', (event) => {
    if (event.target === templateDialog) closeTemplateLibrary();
  });
  templateDialog?.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeTemplateLibrary();
  });
  document.querySelectorAll('[data-welcome-template]').forEach((button) => button.addEventListener('click', async () => {
    await ensureTemplateLibrary();
    useTemplate(templateLibrary.find((template) => template.id === button.dataset.welcomeTemplate));
  }));

  // --- first-run walkthrough ---------------------------------------------
  const tourEl = $('bw-tour');
  let tourIndex = 0;
  let tourKind = 'part';
  let tourTarget = null;
  let tourReturnWelcome = false;
  const partTour = [
    { title: 'Your feature recipe', copy: 'This is the ordered construction history. Click any feature to inspect or edit it.', target: () => window.matchMedia('(max-width: 760px)').matches ? $('bw-mtab-history') : document.querySelector('#bw-history .hi-sel') },
    { title: 'Edit the driving numbers', copy: 'Selected features expose their dimensions here. Change a value and the whole part rebuilds.', prepare: () => doc.features[0] && selectFeature(doc.features[0].id), target: () => document.querySelector('#bw-context input') || $('bw-side') },
    { title: 'Control the view', copy: 'Orbit to inspect the solid. Fit always brings the complete part back into view.', target: () => document.querySelector('.ws-nav-rail [data-cube-view="fit"]') },
    { title: 'Keep or export the result', copy: 'Save keeps an editable project file. STEP opens in other CAD tools; STL goes to a slicer.', target: () => window.matchMedia('(max-width: 760px)').matches ? $('bw-mtab-project') : $('bw-save-file') },
  ];
  const emptyTour = [
    { title: 'Start from proven geometry', copy: 'Templates are editable feature recipes, not locked meshes. Open one and change the named dimensions.', target: () => window.matchMedia('(max-width: 760px)').matches ? $('bw-mtab-project') : $('bw-templates-open') },
    { title: 'Or build from a sketch', copy: 'Extrude starts a profile on the base plane. Draw a closed shape, enter a height, then Apply.', target: () => document.querySelector('[data-feat="extrude"]') },
    { title: 'Stay oriented', copy: 'Use Orbit and Pan to inspect the model; Fit brings all geometry back into view.', target: () => document.querySelector('.ws-nav-rail [data-cube-view="fit"]') },
    { title: 'Your work stays editable', copy: 'Save downloads the complete parametric project. STEP and STL are available when the part is ready.', target: () => window.matchMedia('(max-width: 760px)').matches ? $('bw-mtab-project') : $('bw-save-file') },
  ];
  const sketchTour = [
    { title: 'Choose a shape', copy: 'Rectangle, Circle, and Polygon create closed profiles. Start with Rectangle for your first part.', target: () => document.querySelector('[data-sktool="rect"]') },
    { title: 'Draw on the grid', copy: 'Click two corners. Then select the shape to type exact width, height, and position.', target: () => $('bw-sketch-canvas') },
    { title: 'Set the solid height', copy: 'This driving dimension controls how far the profile extrudes.', target: () => $('bw-sk-op-h') },
    { title: 'Apply the feature', copy: 'Apply commits the preview to History. Escape cancels without changing the part.', target: () => $('bw-sk-apply') },
  ];
  function tourSteps() {
    return tourKind === 'sketch' ? sketchTour : tourKind === 'part' ? partTour : emptyTour;
  }
  function clearTourTarget() {
    tourTarget?.classList.remove('ws-tour-target');
    tourTarget = null;
  }
  function renderTourStep() {
    const steps = tourSteps();
    const step = steps[tourIndex];
    clearTourTarget();
    step.prepare?.();
    tourTarget = step.target?.();
    tourTarget?.classList.add('ws-tour-target');
    tourTarget?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    $('bw-tour-step').textContent = (tourIndex + 1) + ' of ' + steps.length;
    $('bw-tour-title').textContent = step.title;
    $('bw-tour-copy').textContent = step.copy;
    $('bw-tour-back').disabled = tourIndex === 0;
    $('bw-tour-next').textContent = tourIndex === steps.length - 1 ? 'Finish' : 'Next';
  }
  function startTour(kind = doc.features.length ? 'part' : 'empty') {
    tourReturnWelcome = !$('bw-welcome')?.hidden;
    closeHelp();
    closeTemplateLibrary(true);
    hideWelcome();
    tourKind = kind;
    tourIndex = 0;
    tourEl.hidden = false;
    renderTourStep();
    $('bw-tour-next')?.focus();
  }
  function finishTour() {
    clearTourTarget();
    tourEl.hidden = true;
    setFlag(TOUR_SEEN);
    if (tourReturnWelcome && !doc.features.length && !hasFlag(WELCOME)) showWelcome();
    tourReturnWelcome = false;
  }
  $('bw-tour-next')?.addEventListener('click', () => {
    if (tourIndex >= tourSteps().length - 1) finishTour();
    else {
      tourIndex++;
      renderTourStep();
    }
  });
  $('bw-tour-back')?.addEventListener('click', () => {
    if (tourIndex > 0) {
      tourIndex--;
      renderTourStep();
    }
  });
  $('bw-tour-skip')?.addEventListener('click', finishTour);
  function openEditorFor(f) {
    if (f.type === 'fillet' || f.type === 'chamfer') picker.open(f);
    else if (f.type === 'shell') shellPick.open(f);
    else sketch.open(f);
  }

  // --- mobile panel tabs (Model / Parameters / Project bottom sheets) -------
  // Sheet state lives on the application root because the model tree and the
  // inspector sit on opposite sides of the canvas on desktop.
  const sideEl = appEl;
  function syncMtabs() {
    const p = $('bw-mtab-params'), h = $('bw-mtab-history'), j = $('bw-mtab-project');
    if (p) p.setAttribute('aria-pressed', sideEl.classList.contains('m-open-params') ? 'true' : 'false');
    if (h) h.setAttribute('aria-pressed', sideEl.classList.contains('m-open-history') ? 'true' : 'false');
    if (j) j.setAttribute('aria-pressed', sideEl.classList.contains('m-open-project') ? 'true' : 'false');
  }
  function toggleSheet(cls) {
    syncSheetBottom();
    const wasOpen = sideEl.classList.contains(cls);
    sideEl.classList.remove('m-open-params', 'm-open-history', 'm-open-project');
    if (!wasOpen) {
      // The properties sheet and a tab sheet share the bottom edge — close
      // the selection so they never stack.
      if (selectedFeatureId) selectFeature(null);
      sideEl.classList.add(cls);
    }
    syncMtabs();
  }
  $('bw-mtab-params')?.addEventListener('click', () => toggleSheet('m-open-params'));
  $('bw-mtab-history')?.addEventListener('click', () => toggleSheet('m-open-history'));
  $('bw-mtab-project')?.addEventListener('click', () => toggleSheet('m-open-project'));
  $('bw-project-actions')?.addEventListener('click', () => {
    if (window.matchMedia('(max-width: 760px)').matches) {
      sideEl.classList.remove('m-open-project');
      syncMtabs();
    }
  });

  // --- selection + context properties panel ---------------------------------
  let selectedFeatureId = null;
  function selectFeature(id) {
    selectedFeatureId = id;
    if (id) {
      sideEl.classList.remove('m-open-params', 'm-open-history', 'm-open-project');
      syncMtabs();
    }
    renderHistory();
    renderContext();
  }
  function renderContext() {
    const wrap = $('bw-context-wrap');
    const panel = $('bw-context');
    const empty = $('bw-inspector-empty');
    const kind = $('bw-inspector-kind');
    if (!panel) return;
    const holder = wrap || panel;
    const f = doc.features.find((x) => x.id === selectedFeatureId);
    if (mode.kind !== 'idle' || !f) {
      holder.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    if (kind) kind.textContent = OP_LABEL[f.type] + ' properties';
    syncSheetBottom();
    const escAttr = (v) => String(v).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    const field = (label, key, val) =>
      '<label>' + label + ' <input type="text" inputmode="decimal" data-cx="' + key + '" value="' + escAttr(val) + '" /><span class="err-msg" hidden></span></label>';
    const stat = (label, val) => '<p class="ctx-stat">' + label + ': ' + escAttr(val) + '</p>';
    let fields = '';
    if (f.type === 'extrude') {
      fields += field('Height (mm)', 'h', f.h);
    } else if (f.type === 'cut') {
      fields +=
        '<label class="ctx-check"><input type="checkbox" data-cxthrough="1"' + (f.through ? ' checked' : '') + ' /> Through all</label>';
      if (!f.through) fields += field('Depth (mm)', 'h', f.h ?? 10);
    } else if (f.type === 'revolve') {
      fields += stat('Profile shapes', f.sketch.shapes.length);
    } else if (f.type === 'fillet' || f.type === 'chamfer') {
      fields += field('Radius (mm)', 'r', f.r) + stat('Edges', f.edges.length);
    } else if (f.type === 'shell') {
      fields += field('Walls (mm)', 't', f.t) + stat('Openings', f.faces.length);
    }
    if (f.type === 'extrude' || f.type === 'cut') {
      fields += stat('Shapes', f.sketch.shapes.length);
      if (f.onFace) fields += stat('Plane', 'on face');
      if (f.pattern) {
        const circ = f.pattern.kind === 'circular';
        const patField = (label, key, val) =>
          '<label>' + label + ' <input type="text" inputmode="decimal" data-cxpat="' + key + '" value="' + escAttr(val) + '" /><span class="err-msg" hidden></span></label>';
        fields += stat('Pattern', f.pattern.kind);
        fields += patField('Count', 'n', f.pattern.n);
        fields += patField(circ ? 'Centre X' : 'ΔX (mm)', 'a', circ ? f.pattern.cx : f.pattern.dx);
        fields += patField(circ ? 'Centre Y' : 'ΔY (mm)', 'b', circ ? f.pattern.cy : f.pattern.dy);
      }
    }
    // Which named parameters this feature's expressions reference. Only
    // dimension fields can hold expressions — walking the whole feature
    // would false-match a parameter named like a structural enum
    // ('cut', 'rect', 'linear', …) against f.type / shape.kind / pattern.kind.
    if ((doc.params || []).length) {
      const exprs = [];
      const num = (v) => {
        if (typeof v === 'string') exprs.push(v);
      };
      num(f.h);
      num(f.r);
      num(f.t);
      for (const sh of f.sketch?.shapes || []) {
        num(sh.w); num(sh.h); num(sh.r); num(sh.x); num(sh.y);
        for (const pt of sh.pts || []) { num(pt[0]); num(pt[1]); }
      }
      if (f.pattern) { num(f.pattern.dx); num(f.pattern.dy); num(f.pattern.cx); num(f.pattern.cy); }
      const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const used = doc.params.map((pp) => pp.name).filter((n) => exprs.some((x) => new RegExp('\\b' + escRe(n) + '\\b').test(x)));
      if (used.length) fields += stat('Uses parameters', used.join(', '));
    }
    const err = buildErrors.get(f.id);
    panel.innerHTML =
      '<p class="ctx-t">' + OP_LABEL[f.type] + '</p>' +
      '<p class="ctx-sub">' + (err ? 'FAILED: ' + escAttr(err) : 'feature ' + (doc.features.indexOf(f) + 1) + ' of ' + doc.features.length) + '</p>' +
      fields +
      '<div class="ctx-actions"><button type="button" data-cxedit="1">Edit</button><button type="button" data-cxdel="1">Delete</button></div>';
    holder.hidden = false;
    panel.querySelectorAll('[data-cx]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const key = inp.dataset.cx;
        const raw = inp.value.trim();
        const errEl = inp.parentElement.querySelector('.err-msg');
        try {
          N(raw);
        } catch (err2) {
          // Inline error: mark the field, keep the bad value on screen so
          // the user can fix it rather than retype it.
          inp.classList.add('field-err');
          if (errEl) {
            errEl.textContent = String(err2?.message || err2);
            errEl.hidden = false;
          }
          return;
        }
        inp.classList.remove('field-err');
        if (errEl) errEl.hidden = true;
        const value = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
        const draft = deepCopy(f);
        draft[key] = value;
        commit('Edit ' + OP_LABEL[f.type].toLowerCase(), () => {
          const i = doc.features.findIndex((x) => x.id === draft.id);
          if (i >= 0) doc.features[i] = draft;
        });
      }),
    );
    panel.querySelectorAll('[data-cxpat]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const key = inp.dataset.cxpat;
        const raw = inp.value.trim();
        const errEl = inp.parentElement.querySelector('.err-msg');
        const bad = (msg) => {
          inp.classList.add('field-err');
          if (errEl) {
            errEl.textContent = msg;
            errEl.hidden = false;
          }
        };
        let value;
        if (key === 'n') {
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 2 || n > 100) return bad('Count must be a whole number from 2 to 100.');
          value = n;
        } else {
          try {
            N(raw);
          } catch (err2) {
            return bad(String(err2?.message || err2));
          }
          value = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
        }
        inp.classList.remove('field-err');
        if (errEl) errEl.hidden = true;
        // Apply onto the CURRENT feature at commit time (not a deepCopy of
        // the render-time f) so a quick tab between pattern fields never
        // reverts a sibling field that committed a microtask earlier.
        commit('Edit ' + OP_LABEL[f.type].toLowerCase() + ' pattern', () => {
          const cur = doc.features.find((x) => x.id === f.id);
          if (!cur || !cur.pattern) return;
          const circ = cur.pattern.kind === 'circular';
          if (key === 'n') cur.pattern.n = value;
          else if (key === 'a') cur.pattern[circ ? 'cx' : 'dx'] = value;
          else cur.pattern[circ ? 'cy' : 'dy'] = value;
        });
      }),
    );
    panel.querySelector('[data-cxthrough]')?.addEventListener('change', (e) => {
      const draft = deepCopy(f);
      draft.through = e.target.checked;
      if (!draft.through && !(draft.h > 0) && typeof draft.h !== 'string') draft.h = 10;
      commit('Edit ' + OP_LABEL[f.type].toLowerCase(), () => {
        const i = doc.features.findIndex((x) => x.id === draft.id);
        if (i >= 0) doc.features[i] = draft;
      });
    });
    panel.querySelector('[data-cxedit]').addEventListener('click', () => {
      startOperation(() => openEditorFor(f));
    });
    panel.querySelector('[data-cxdel]').addEventListener('click', () => {
      commit('Delete ' + OP_LABEL[f.type].toLowerCase(), () => {
        doc.features = doc.features.filter((x) => x.id !== f.id);
      });
    });
  }

  // --- global keys: Escape, Enter, Delete, F, Space-pan ---------------------
  const cancelCurrent = () => {
    if (mode.kind === 'sketching') $('bw-sk-cancel').click();
    else if (mode.kind === 'picking-edges') $('bw-pick-cancel').click();
    else if (mode.kind === 'picking-faces') $('bw-shell-cancel').click();
    else if (mode.kind === 'choose-face') $('bw-face-cancel').click();
    else if (selectedFeatureId) selectFeature(null);
  };
  const applyCurrent = () => {
    if (mode.kind === 'sketching') $('bw-sk-apply').click();
    else if (mode.kind === 'picking-edges') $('bw-pick-apply').click();
    else if (mode.kind === 'picking-faces') $('bw-shell-apply').click();
  };
  $('bw-cmd-apply')?.addEventListener('click', () => applyCurrent());
  $('bw-cmd-cancel')?.addEventListener('click', () => cancelCurrent());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (helpDialog?.open) {
        e.preventDefault();
        closeHelp();
        return;
      }
      if (inField()) {
        document.activeElement.blur();
        return;
      }
      cancelCurrent();
      return;
    }
    if (inField()) {
      // Enter inside a numeric field commits that field (blur fires the
      // change handler); it must not also Apply the whole editor.
      if (e.key === 'Enter') document.activeElement.blur();
      return; // every other global key defers to the field
    }
    if (e.key === 'Enter') applyCurrent();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && mode.kind === 'idle' && selectedFeatureId) {
      const f = doc.features.find((x) => x.id === selectedFeatureId);
      if (f) {
        commit('Delete ' + OP_LABEL[f.type].toLowerCase(), () => {
          doc.features = doc.features.filter((x) => x.id !== f.id);
        });
        selectFeature(null);
      }
    } else if (e.key === 'f' && mode.kind === 'idle') setView('fit');
    else if (e.key === ' ' && mode.kind === 'idle') {
      e.preventDefault();
      orbit.mouseButtons.LEFT = THREE.MOUSE.PAN;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') orbit.mouseButtons.LEFT = navMode === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  });

  // --- feature buttons -----------------------------------------------------
  document.querySelectorAll('[data-feat]').forEach((b) =>
    b.addEventListener('click', () => {
      startOperation(() => {
        loadKernel(); // start the download while the user sketches
        const t = b.dataset.feat;
        if (t === 'fillet' || t === 'chamfer') {
          picker.open({ id: newId(), type: t, r: 2, edges: [] });
        } else if (t === 'shell') {
          shellPick.open({ id: newId(), type: t, t: 2, faces: [] });
        } else {
          const draft = { id: newId(), type: t, sketch: { shapes: [], z: 0 }, h: 20, through: t === 'cut' };
          // With a part on screen, extrude and cut can target any flat face;
          // the base plane stays one click away.
          if ((t === 'extrude' || t === 'cut') && solidMesh && faceByHash.size) facePick.open(draft);
          else sketch.open(draft);
        }
      });
    }),
  );

  function starterDocument() {
    return {
      title: 'Starter plate',
      units: 'mm',
      params: [
        { name: 'size', value: 40 },
        { name: 'hole', value: 8 },
      ],
      features: [
        { id: newId(), type: 'extrude', sketch: { shapes: [{ kind: 'rect', x: 0, y: 0, w: 'size', h: 'size' }], z: 0 }, h: 5 },
        { id: newId(), type: 'cut', sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 'hole/2' }], z: 5 }, h: 10, through: true },
      ],
    };
  }
  function finishWelcome() {
    setFlag(WELCOME);
    setFlag(SEEDED);
    hideWelcome();
  }
  $('bw-welcome-start')?.addEventListener('click', () => {
    // Starting blank is a deliberate project choice. Persist that choice so
    // reload never replaces the user's empty canvas with the example part.
    projectId = makeProjectId();
    doc = normalizeDoc({ title: 'Untitled part', units: 'mm', params: [], features: [] });
    undoStack.length = 0;
    redoStack.length = 0;
    finishWelcome();
    save();
    renderParams();
    renderHistory();
    rebuild();
    document.querySelector('[data-feat="extrude"]')?.click();
    if (!hasFlag(TOUR_SEEN)) setTimeout(() => startTour('sketch'), 150);
  });
  $('bw-welcome-open')?.addEventListener('click', () => $('bw-open-file')?.click());

  // --- boot ----------------------------------------------------------------
  await load();
  studioReadyForProjects = true;
  resize();
  renderHistory();
  renderParams();
  syncHistoryActions();
  // Prototype-v1 scenes (the retired primitives studio) are incompatible;
  // tell the user once, never touch the old key.
  try {
    if (localStorage.getItem('bw-studio-scene-v1') && !localStorage.getItem('bw-studio-v1-notice')) {
      // A persistent banner, not say(): later status messages must not bury
      // it. The seen-flag is stored only when the user dismisses it.
      const b = document.createElement('div');
      b.id = 'bw-v1-notice';
      b.innerHTML =
        'A scene from the old prototype studio was found. It is incompatible with the parametric studio and has been left untouched. ' +
        '<button type="button">Got it</button>';
      b.querySelector('button').addEventListener('click', () => {
        try {
          localStorage.setItem('bw-studio-v1-notice', '1');
        } catch {}
        b.remove();
      });
      stage.appendChild(b);
    }
  } catch {}
  const alreadySeeded = hasFlag(SEEDED);
  const welcomeSeen = hasFlag(WELCOME);
  if (doc.features.length) {
    setFlag(SEEDED);
    setFlag(WELCOME);
    hideWelcome();
    say('Restored your part — rebuilding…');
    rebuild();
  } else if (alreadySeeded) {
    // The user has been here and deliberately has an empty document (for
    // example after Clear + reload, or undoing everything): keep it empty.
    hideWelcome();
    rebuild();
  } else if (!welcomeSeen && storageAvailable) {
    // A brand-new user gets an explicit starting decision over the real
    // modeling canvas. No sample geometry is silently inserted.
    rebuild();
    showWelcome();
  } else {
    // Compatibility path for users that dismissed the old landing but have
    // not yet persisted a project. It is also the resilient fallback when
    // browser storage is unavailable and first-run state cannot be retained.
    doc = normalizeDoc(starterDocument());
    setFlag(SEEDED);
    save();
    renderParams();
    rebuild();
  }
})();
