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
  const v5RuntimeTools = await import('/static/studio-v5-runtime-document.js');
  const agentTools = await import('/static/studio-agent-service.js');
  const v5ModelingTools = await import('/static/studio-v5-modeling.js');
  const v5AssemblyTools = await import('/static/studio-v5-assembly.js');
  const v5InspectionTools = await import('/static/studio-v5-inspection.js');
  const prepareStoredDocument = (candidate, prepareLegacy) =>
    v5RuntimeTools.isStudioV5Project(candidate)
      ? v5RuntimeTools.decorateStudioV5Project(v5RuntimeTools.canonicalStudioV5Project(candidate))
      : prepareLegacy(candidate);
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
      recovered = prepareStoredDocument(snapshot.document, prepareStudioDocument);
    } catch (error) {
      return say('Could not recover project: ' + String(error?.message || error));
    }
    if (snapshot.projectId !== projectId) {
      try {
        const journal = await journalReady;
        const stored = journal ? await journal.loadProject(snapshot.projectId) : null;
        const { prepareStudioDocument } = await documentToolsReady;
        targetProject = stored ? hydrateProjectRecord(stored, (candidate) => prepareStoredDocument(candidate, prepareStudioDocument)) : null;
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
        resetAgentForProjectChange('Recovered another project');
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
  let THREE, OrbitControls, TransformControls;
  try {
    [THREE, { OrbitControls }, { TransformControls }] = await Promise.all([
      import('/static/vendor/three.module.min.js'),
      import('/static/vendor/OrbitControls.js'),
      import('/static/vendor/TransformControls.js'),
    ]);
  } catch {
    stage.innerHTML = '<p class="mv-error">The studio failed to load. Check your connection and reload.</p>';
    return;
  }
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
  renderer.localClippingEnabled = true;
  const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const debugRendererInfo = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
  const rendererName = debugRendererInfo
    ? String(renderer.getContext().getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL) || '')
    : '';
  const softwareWebgl = /swiftshader|llvmpipe|software/i.test(rendererName);
  // A software rasterizer cannot sustain a full-resolution 1.6 MP CAD view,
  // even after draw-call batching. Keep its idle canvas readable at half
  // resolution, use a coarse buffer only while manipulating, and reserve the
  // requested device resolution for explicit evidence/image capture.
  const fullPixelRatio = softwareWebgl ? Math.min(devicePixelRatio, 0.5) : devicePixelRatio;
  const interactivePixelRatio = softwareWebgl ? Math.min(fullPixelRatio, 0.2) : fullPixelRatio;
  let currentPixelRatio = fullPixelRatio;
  let interactiveResolutionTimer = null;
  renderer.setPixelRatio(fullPixelRatio);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', '3D modeling canvas');
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
  const transformControls = new TransformControls(camera, renderer.domElement);
  const transformHelper = transformControls.getHelper();
  transformControls.enabled = false;
  transformHelper.visible = false;
  transformControls.setSize(0.82);
  scene.add(transformHelper);
  let transformPreview = null;
  let gizmoPointerActive = false;
  transformControls.addEventListener('mouseDown', () => {
    gizmoPointerActive = true;
    orbit.enabled = false;
  });
  transformControls.addEventListener('mouseUp', () => {
    orbit.enabled = true;
    setTimeout(() => { gizmoPointerActive = false; }, 0);
  });

  const partGroup = new THREE.Group();
  // Kernel space is Z-up (CAD convention); three is Y-up.
  partGroup.rotation.x = -Math.PI / 2;
  scene.add(partGroup);
  const MAT = new THREE.MeshStandardMaterial({ color: 0xa7b8c9, metalness: 0.16, roughness: 0.56, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const EDGE_MAT = new THREE.LineBasicMaterial({ color: 0x30475c });
  let sceneBatchObjects = [];
  let sceneInteractiveBatchObjects = [];
  let sceneInteractiveSolidBatchEntries = new Map();
  let sceneInteractiveTriangleCount = 0;
  let sceneProxyObjects = [];

  function renderScene() {
    const useBatches = sceneBatchObjects.length > 0 && !transformPreview && mode.kind !== 'picking-edges';
    if (!useBatches) return renderer.render(scene, camera);
    // SwiftShader remains vertex-bound on the largest assemblies even at a
    // tiny drawing-buffer resolution. During a pointer gesture, render a
    // body-aware bounds LOD (same placement, visibility, color, and clipping)
    // and omit the exact stencil/edge passes. The exact tessellation and caps
    // stay resident and return automatically at the idle-quality boundary.
    const useInteractiveBatches = softwareWebgl
      && currentPixelRatio === interactivePixelRatio
      && sceneInteractiveBatchObjects.length > 0;
    const visibleBatches = useInteractiveBatches ? sceneInteractiveBatchObjects : sceneBatchObjects;
    const visibility = sceneProxyObjects.map((object) => [object, object.visible]);
    const capVisibility = useInteractiveBatches
      ? sectionCapObjects.map((object) => [object, object.visible])
      : [];
    for (const [object] of visibility) object.visible = false;
    for (const object of sceneBatchObjects) object.visible = false;
    for (const object of sceneInteractiveBatchObjects) object.visible = false;
    for (const [object] of capVisibility) object.visible = false;
    for (const object of visibleBatches) object.visible = true;
    try { renderer.render(scene, camera); }
    finally {
      for (const object of visibleBatches) object.visible = false;
      for (const [object, visible] of capVisibility) object.visible = visible;
      for (const [object, visible] of visibility) object.visible = visible;
    }
  }

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
  // The Studio used to redraw the complete scene on every animation frame,
  // even while the camera and model were idle. That continuously saturated
  // software-rendered/headless browsers and also competed with the kernel
  // worker for CPU during exact rebuild and inspection work. Keep the rAF
  // loop for OrbitControls damping, but only submit WebGL work when controls
  // changed or application state dirtied the scene.
  let sceneRenderDirty = true;
  const requestSceneRender = () => { sceneRenderDirty = true; };
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
    requestSceneRender();
  }
  function beginInteractiveResolution() {
    if (interactivePixelRatio >= fullPixelRatio) return;
    clearTimeout(interactiveResolutionTimer);
    interactiveResolutionTimer = null;
    if (currentPixelRatio === interactivePixelRatio) return;
    currentPixelRatio = interactivePixelRatio;
    renderer.setPixelRatio(currentPixelRatio);
    requestSceneRender();
  }
  function endInteractiveResolution() {
    if (interactivePixelRatio >= fullPixelRatio) return;
    clearTimeout(interactiveResolutionTimer);
    interactiveResolutionTimer = setTimeout(() => {
      interactiveResolutionTimer = null;
      if (currentPixelRatio === fullPixelRatio) return;
      currentPixelRatio = fullPixelRatio;
      renderer.setPixelRatio(currentPixelRatio);
      requestSceneRender();
    }, 180);
  }
  function pulseInteractiveResolution() {
    beginInteractiveResolution();
    endInteractiveResolution();
  }
  orbit.addEventListener('start', beginInteractiveResolution);
  orbit.addEventListener('end', endInteractiveResolution);
  transformControls.addEventListener('mouseDown', beginInteractiveResolution);
  transformControls.addEventListener('mouseUp', endInteractiveResolution);
  appEl?.addEventListener('pointerdown', beginInteractiveResolution, { capture: true });
  appEl?.addEventListener('pointerup', endInteractiveResolution, { capture: true });
  new ResizeObserver(resize).observe(stage);
  // Render only while the stage is actually visible — an open studio tab in
  // the background must not drain a phone's battery.
  let stageVisible = true;
  new IntersectionObserver((entries) => {
    // Last entry, not first: a batch can carry [hidden, visible] and the
    // stale first entry would freeze the render loop.
    stageVisible = entries[entries.length - 1].isIntersecting;
    if (stageVisible) requestSceneRender();
  }).observe(stage);
  for (const eventName of ['click', 'change', 'input', 'keydown', 'pointermove']) {
    appEl?.addEventListener(eventName, requestSceneRender, { capture: true });
  }
  // No document.hidden check: browsers already stop the animation-frame
  // loop in hidden tabs, and some embedded webviews report hidden wrongly.
  renderer.setAnimationLoop(() => {
    if (!stageVisible) return;
    const controlsChanged = orbit.update();
    if (!sceneRenderDirty && !controlsChanged) return;
    sceneRenderDirty = false;
    renderScene();
  });

  // --- kernel worker (lazy, revisioned) -----------------------------------
  // OpenCascade never runs on the UI thread. Each request carries a project
  // and document revision; visual replies older than the latest requested
  // rebuild are ignored below.
  let kernelWorker = null;
  let kernelReady = null;
  let kernelWorkerProjectId = null;
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
  let successfulV5Rebuilds = 0;
  const KERNEL_COMPACTION_REBUILD_INTERVAL = 15;

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
    successfulV5Rebuilds = 0;
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
            // Do not bury a more useful project-open/import success message
            // when a fresh project-scoped worker finishes loading.
            if (/^Loading the CAD kernel/.test($('bw-studio-msg')?.textContent || '')) say('Kernel ready.');
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

  async function kernelCall(kind, revision, options = {}) {
    // OpenCascade writers/readers and retained TopoDS wrappers are scoped to
    // one canonical project. A document replacement therefore gets a fresh
    // worker instead of inheriting allocator/cache state from the previous
    // project (especially after STEP interchange).
    if (kernelWorker && kernelWorkerProjectId && kernelWorkerProjectId !== projectId) {
      const previousWorker = kernelWorker;
      try { previousWorker.terminate(); } catch {}
      kernelWorker = null;
      kernelReady = null;
      kernelWorkerProjectId = null;
      successfulV5Rebuilds = 0;
      kernelRestarting = false;
      kernelRestartCount++;
      rejectKernelPending(new Error('The CAD kernel reset because the active project changed.'));
    }
    const worker = await loadKernel();
    kernelWorkerProjectId = projectId;
    const requestId = ++kernelRequestSeq;
    const request = {
      requestId,
      projectId,
      revision,
      kind,
      ...(kind === 'import-step-v5' ? {} : { document: deepCopy(options.document || doc) }),
    };
    if (Array.isArray(options.bodyIds)) request.bodyIds = [...options.bodyIds];
    if (Array.isArray(options.pairBodyIds)) request.pairBodyIds = [...options.pairBodyIds];
    if (options.blob instanceof Blob) request.blob = options.blob;
    if (options.filename) request.filename = String(options.filename);
    if (options.mode) request.mode = options.mode;
    if (options.freezePrefix) request.freezePrefix = String(options.freezePrefix);
    if (options.tolerance != null) request.tolerance = Number(options.tolerance);
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

  async function importStepWithKernelRecovery(blob, filename, revision) {
    try {
      return await kernelCall('import-step-v5', revision, { blob, filename });
    } catch (error) {
      const message = String(error?.message || error);
      if (!/reading STEP geometry:\s*(?:null function|memory access out of bounds)|Failed to load STEP file/i.test(message)) throw error;
      const failedWorker = kernelWorker;
      try { failedWorker?.terminate(); } catch {}
      if (failedWorker === kernelWorker) {
        kernelWorker = null;
        kernelReady = null;
        kernelRestartCount++;
      }
      say('The CAD kernel reset after a STEP reader fault. Retrying the import once…', true);
      return kernelCall('import-step-v5', revision, { blob, filename });
    }
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
  const bodyBuildErrors = new Map(); // body id -> message
  let selectedBodyId = null;
  let selectedOccurrenceId = null;
  let selectedMateId = null;
  let selectedDatumId = null;
  let selectedSketchId = null;
  let isolatedBodyId = null;
  let selectionFilter = 'auto';
  const exportBodyIds = new Set();
  let lastBodyResults = [];
  let lastEvaluationTrace = null;
  // Command revisions are distinct from asynchronous kernel rebuild
  // revisions. Humans and agents share this one persistent-edit sequence.
  let commandRevision = 0;
  let liveAgentService = null;
  let activeAgentConnection = null;
  let agentCommitInProgress = false;
  let pendingPairingWindow = null;
  let pendingPairingOrigin = null;
  let lastInspection = null;

  const deepCopy = (o) => JSON.parse(JSON.stringify(o));
  const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  function setTreeItemSemantics(element, options = {}) {
    element.setAttribute('role', 'treeitem');
    element.setAttribute('aria-level', String(options.level || 1));
    element.setAttribute('aria-selected', String(Boolean(options.selected)));
    if (options.expanded != null) element.setAttribute('aria-expanded', String(Boolean(options.expanded)));
    if (options.count != null) element.setAttribute('aria-setsize', String(Math.max(1, Number(options.count) || 1)));
    const states = [
      options.hidden ? 'hidden' : 'visible',
      options.suppressed ? 'suppressed' : null,
      options.failed ? 'failed' : null,
      options.count != null ? options.count + ' occurrences' : null,
    ].filter(Boolean);
    if (options.label) element.setAttribute('aria-label', options.label + (states.length ? ', ' + states.join(', ') : ''));
  }
  function normalizeDoc(d) {
    if (v5RuntimeTools.isStudioV5Project(d)) return v5RuntimeTools.prepareStudioV5RuntimeProject(d);
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

  function ensureAgentActivityElement() {
    let element = $('bw-agent-activity');
    if (element) return element;
    element = document.createElement('button');
    element.type = 'button';
    element.id = 'bw-agent-activity';
    element.className = 'ws-agent-activity';
    element.hidden = true;
    element.innerHTML = '<span aria-hidden="true"></span><b>Agent</b><small>Disconnected</small>';
    element.addEventListener('click', openAgentSessionDialog);
    document.querySelector('.ws-document')?.appendChild(element);
    return element;
  }

  function updateAgentActivity(message, actor = 'agent') {
    const element = ensureAgentActivityElement();
    if (!activeAgentConnection) {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    element.dataset.state = actor === 'error' ? 'error' : actor === 'human' ? 'attention' : 'connected';
    element.querySelector('b').textContent = activeAgentConnection.clientLabel;
    element.querySelector('small').textContent = message;
    element.title = message + ' · click to disconnect';
  }

  function resetAgentForProjectChange(reason) {
    commandRevision = 0;
    if (activeAgentConnection) revokeAgentConnection(reason || 'Project changed');
    liveAgentService = null;
  }

  async function ensureLiveAgentService() {
    if (!v5RuntimeTools.isStudioV5Project(doc)) {
      const migrated = v5RuntimeTools.migrateStudioDocumentToV5(doc, { projectId });
      commit('Upgrade project for structured agent access', () => migrated, { actor: 'human' });
    }
    if (liveAgentService) return liveAgentService;
    liveAgentService = new agentTools.CadCommandService({
      project: doc,
      revision: commandRevision,
      kernel: {
        validate: async (candidate) => kernelCall('validate-v5', documentRevision, { document: candidate }),
      },
      commitAdapter: async (command) => {
        if (command.historyAction) {
          if (command.expectedRevision !== commandRevision) {
            throw new agentTools.CadAgentError('REVISION_CONFLICT', 'History command targets a stale project revision.', {
              expectedRevision: command.expectedRevision,
              actualRevision: commandRevision,
            });
          }
          if (command.historyAction === 'undo') undo();
          else if (command.historyAction === 'redo') redo();
          else throw new agentTools.CadAgentError('UNKNOWN_HISTORY_ACTION', 'Unknown live history action.');
          return { project: doc, revision: commandRevision };
        }
        agentCommitInProgress = true;
        try {
          commit(command.label, () => command.project, { actor: command.actor || 'agent', transactionId: command.transactionId });
        } finally {
          agentCommitInProgress = false;
        }
        updateAgentActivity('Committed: ' + command.label, 'agent');
        return { project: doc, revision: commandRevision };
      },
    });
    return liveAgentService;
  }

  function approvedPermissionContext(requested) {
    const allowed = new Set([
      'project.read',
      'project.edit',
      'artifact.render',
      'artifact.export-project',
      'artifact.export-step',
      'artifact.export-stl',
    ]);
    const granted = (Array.isArray(requested?.granted) ? requested.granted : ['project.read'])
      .filter((permission) => allowed.has(permission));
    if (!granted.includes('project.read')) granted.unshift('project.read');
    return {
      granted,
      projectIds: [projectId],
      ...(Array.isArray(requested?.operationKinds) ? { operationKinds: requested.operationKinds.filter((kind) => typeof kind === 'string') } : {}),
      ...(Number.isInteger(requested?.maxCommits) ? { maxCommits: requested.maxCommits } : {}),
      ...(typeof requested?.expiresAt === 'string' ? { expiresAt: requested.expiresAt } : {}),
    };
  }

  async function activateAgentConnection(options = {}) {
    if (activeAgentConnection) throw new agentTools.CadAgentError('SESSION_ALREADY_CONNECTED', 'Another agent session is already connected.');
    const service = await ensureLiveAgentService();
    const sessionId = typeof options.sessionId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(options.sessionId)
      ? options.sessionId
      : 'studio-' + (crypto.randomUUID?.() || newId() + '-' + Date.now());
    const connectionToken = crypto.randomUUID?.() || newId() + '-' + newId() + '-' + Date.now();
    const mode = ['read-only', 'preview-required', 'scoped-auto-commit'].includes(options.mode) ? options.mode : 'preview-required';
    const permissionContext = approvedPermissionContext(options.permissionContext);
    if (mode === 'read-only') permissionContext.granted = permissionContext.granted.filter((permission) => permission !== 'project.edit');
    activeAgentConnection = {
      sessionId,
      connectionToken,
      clientLabel: String(options.clientLabel || 'Local CAD agent').trim().slice(0, 80) || 'Local CAD agent',
      permissionContext,
      mode,
      paused: false,
      previews: new Map(),
      bridgeWindow: options.bridgeWindow || null,
      bridgeOrigin: options.bridgeOrigin || null,
      connectedAt: new Date().toISOString(),
    };
    service.previews.clear();
    updateAgentActivity('Connected · revision ' + commandRevision, 'agent');
    return {
      protocol: agentTools.CAD_AGENT_PROTOCOL,
      sessionId,
      projectId,
      revision: commandRevision,
      connectionToken,
      permissionContext: deepCopy(activeAgentConnection.permissionContext),
      mode: activeAgentConnection.mode,
      capabilities: service.capabilities(),
    };
  }

  function requestAgentConnection(options = {}) {
    if (activeAgentConnection) return Promise.reject(new agentTools.CadAgentError('SESSION_ALREADY_CONNECTED', 'Another agent session is already connected.'));
    return new Promise((resolve, reject) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'ws-agent-pair';
      const clientLabel = String(options.clientLabel || 'Local CAD agent').trim().slice(0, 80) || 'Local CAD agent';
      const permissions = approvedPermissionContext(options.permissionContext).granted;
      dialog.innerHTML =
        '<form method="dialog"><p class="ws-agent-kicker">STRUCTURED AGENT ACCESS</p>' +
        '<h2></h2><p>This connection uses typed CAD commands, not screen control. Every edit is previewed, revision-checked, validated, visible in History, and undoable.</p>' +
        '<dl><dt>Project</dt><dd></dd><dt>Permissions</dt><dd></dd></dl>' +
        '<div><button value="cancel">Deny</button><button value="approve" class="primary">Connect</button></div></form>';
      dialog.querySelector('h2').textContent = clientLabel + ' wants to connect';
      dialog.querySelectorAll('dd')[0].textContent = doc.title;
      dialog.querySelectorAll('dd')[1].textContent = permissions.join(', ');
      const requestedMode = ['read-only', 'preview-required', 'scoped-auto-commit'].includes(options.mode) ? options.mode : 'preview-required';
      dialog.querySelector('dl').insertAdjacentHTML('beforeend', '<dt>Mode</dt><dd></dd>');
      dialog.querySelector('dl dd:last-child').textContent = requestedMode === 'scoped-auto-commit' ? 'Scoped auto-commit' : requestedMode === 'read-only' ? 'Read only' : 'Preview approval required';
      document.body.appendChild(dialog);
      dialog.addEventListener('close', async () => {
        const approved = dialog.returnValue === 'approve';
        dialog.remove();
        if (!approved) {
          reject(new agentTools.CadAgentError('CONNECTION_DENIED', 'The user denied the agent connection.'));
          return;
        }
        try {
          resolve(await activateAgentConnection({ ...options, clientLabel }));
        } catch (error) {
          reject(error);
        }
      }, { once: true });
      dialog.showModal();
    });
  }

  function revokeAgentConnection(reason = 'Disconnected', notifyBridge = true) {
    const previous = activeAgentConnection;
    if (liveAgentService) liveAgentService.previews.clear();
    activeAgentConnection = null;
    const element = $('bw-agent-activity');
    if (element) element.hidden = true;
    if (notifyBridge && previous?.bridgeWindow && !previous.bridgeWindow.closed) {
      previous.bridgeWindow.postMessage({ source: 'bomwiki-cad-studio', message: { type: 'session.revoked', reason } }, previous.bridgeOrigin);
    }
    say(reason + '.');
  }

  function requestAgentCommitApproval(previewId) {
    const preview = activeAgentConnection?.previews.get(previewId);
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'ws-agent-pair';
      const changeSet = preview?.changeSet || {};
      const count = (key) => Array.isArray(changeSet[key]) ? changeSet[key].length : 0;
      dialog.innerHTML =
        '<form method="dialog"><p class="ws-agent-kicker">AGENT PREVIEW</p><h2>Apply this CAD change?</h2>' +
        '<p></p><dl><dt>Creates</dt><dd></dd><dt>Updates</dt><dd></dd><dt>Deletes</dt><dd></dd><dt>Revision</dt><dd></dd></dl>' +
        '<div><button value="reject">Reject</button><button value="approve" class="primary">Apply change</button></div></form>';
      dialog.querySelector('p:not(.ws-agent-kicker)').textContent = preview?.label || 'The connected agent wants to commit its validated preview.';
      const values = dialog.querySelectorAll('dd');
      values[0].textContent = String(count('created'));
      values[1].textContent = String(count('updated'));
      values[2].textContent = String(count('deleted'));
      values[3].textContent = String(commandRevision);
      document.body.appendChild(dialog);
      dialog.addEventListener('close', () => {
        const approved = dialog.returnValue === 'approve';
        dialog.remove();
        resolve(approved);
      }, { once: true });
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        dialog.close('reject');
      });
      dialog.showModal();
    });
  }

  async function handleLiveAgentRequest(connectionToken, envelope) {
    if (!activeAgentConnection || connectionToken !== activeAgentConnection.connectionToken) {
      throw new agentTools.CadAgentError('SESSION_NOT_FOUND', 'The live Studio agent session is not connected.');
    }
    if (activeAgentConnection.paused) throw new agentTools.CadAgentError('SESSION_PAUSED', 'The user paused this agent session.');
    const service = await ensureLiveAgentService();
    const request = {
      ...deepCopy(envelope),
      protocol: agentTools.CAD_AGENT_PROTOCOL,
      sessionId: activeAgentConnection.sessionId,
      projectId,
      permissionContext: deepCopy(activeAgentConnection.permissionContext),
    };
    if (request.payload?.kind === 'commit' && activeAgentConnection.mode === 'read-only') {
      throw new agentTools.CadAgentError('PERMISSION_DENIED', 'This live Studio session is read only.');
    }
    if (request.payload?.kind === 'commit' && activeAgentConnection.mode === 'preview-required' && envelope.expectedRevision === commandRevision && activeAgentConnection.previews.has(request.payload.previewId)) {
      const approved = await requestAgentCommitApproval(request.payload.previewId);
      if (!approved) throw new agentTools.CadAgentError('USER_REJECTED_PREVIEW', 'The user rejected this CAD preview.');
    }
    updateAgentActivity(request.payload?.kind === 'preview' ? 'Validating preview…' : 'Working…', 'agent');
    const response = await service.request(request);
    if (response.status === 'ok' && request.payload?.kind === 'preview') {
      activeAgentConnection.previews.set(response.result.previewId, {
        label: request.payload.transaction?.label,
        changeSet: deepCopy(response.result.changeSet),
      });
    }
    if (request.payload?.kind === 'commit') activeAgentConnection.previews.delete(request.payload.previewId);
    const successMessage = request.payload?.kind === 'preview'
      ? 'Preview ready'
      : request.payload?.kind === 'commit'
        ? 'Committed · revision ' + response.revision
        : 'Revision ' + response.revision;
    updateAgentActivity(
      response.status === 'ok' ? successMessage : response.diagnostics?.[0]?.code || 'Request failed',
      response.status === 'ok' ? 'agent' : 'error',
    );
    return response;
  }

  Object.defineProperty(window, 'bomwikiCadAgent', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      protocol: agentTools.CAD_AGENT_PROTOCOL,
      capabilities: () => agentTools.cadCapabilityManifest({ exactKernel: true }),
      requestConnection: (options) => requestAgentConnection(options),
      request: (connectionToken, envelope) => handleLiveAgentRequest(connectionToken, envelope),
      disconnect: (connectionToken) => {
        if (!activeAgentConnection || connectionToken !== activeAgentConnection.connectionToken) return false;
        revokeAgentConnection('Agent disconnected');
        return true;
      },
      status: () => activeAgentConnection
        ? { connected: true, sessionId: activeAgentConnection.sessionId, clientLabel: activeAgentConnection.clientLabel, projectId, revision: commandRevision, mode: activeAgentConnection.mode, paused: activeAgentConnection.paused }
        : { connected: false, projectId, revision: commandRevision },
    }),
  });

  function openAgentSessionDialog() {
    if (!activeAgentConnection) return openLoopbackPairDialog();
    const dialog = document.createElement('dialog');
    dialog.className = 'ws-agent-pair';
    dialog.innerHTML =
      '<form method="dialog"><p class="ws-agent-kicker">AGENT ACTIVITY</p><h2></h2><p></p>' +
      '<dl><dt>Mode</dt><dd></dd><dt>Project</dt><dd></dd><dt>Revision</dt><dd></dd><dt>Status</dt><dd></dd></dl>' +
      '<div><button value="close">Close</button><button value="pause"></button><button value="revoke" class="ws-agent-danger">Disconnect</button></div></form>';
    dialog.querySelector('h2').textContent = activeAgentConnection.clientLabel;
    dialog.querySelector('p:not(.ws-agent-kicker)').textContent = 'This client uses structured, revision-controlled CAD commands. It cannot inspect the page or control the pointer.';
    const values = dialog.querySelectorAll('dd');
    values[0].textContent = activeAgentConnection.mode;
    values[1].textContent = doc.title;
    values[2].textContent = String(commandRevision);
    values[3].textContent = activeAgentConnection.paused ? 'Paused by you' : 'Connected';
    dialog.querySelector('[value="pause"]').textContent = activeAgentConnection.paused ? 'Resume' : 'Pause';
    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => {
      const action = dialog.returnValue;
      dialog.remove();
      if (!activeAgentConnection) return;
      if (action === 'pause') {
        activeAgentConnection.paused = !activeAgentConnection.paused;
        updateAgentActivity(activeAgentConnection.paused ? 'Paused by you' : 'Connected · revision ' + commandRevision, activeAgentConnection.paused ? 'human' : 'agent');
      } else if (action === 'revoke') revokeAgentConnection('Disconnected by user');
    }, { once: true });
    dialog.showModal();
  }

  function validatedPairingUrl(raw) {
    let url;
    try {
      url = new URL(String(raw || '').trim());
    } catch {
      throw new agentTools.CadAgentError('INVALID_PAIRING_URL', 'Paste the complete pairing URL returned by the local BOMwiki CAD MCP server.');
    }
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.pathname !== '/pair' || !url.hash.slice(1) || url.username || url.password) {
      throw new agentTools.CadAgentError('INVALID_PAIRING_URL', 'Pairing URLs must use the local http://127.0.0.1:<port>/pair#<secret> bridge.');
    }
    return url;
  }

  function openLoopbackPairDialog() {
    if (activeAgentConnection) return openAgentSessionDialog();
    closeHelp();
    const dialog = document.createElement('dialog');
    dialog.className = 'ws-agent-pair';
    dialog.innerHTML =
      '<form><p class="ws-agent-kicker">LOCAL MCP CONNECTION</p><h2>Connect a CAD agent</h2>' +
      '<p>In your agent, call <code>cad_session</code> with action <code>connect</code>. Paste the returned loopback URL here. Studio will show the client and permissions before anything is shared.</p>' +
      '<label class="ws-agent-url">Pairing URL<input type="url" autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:…/pair#…"></label>' +
      '<p class="ws-agent-inline-error" role="alert" hidden></p>' +
      '<div><button type="button" value="cancel">Cancel</button><button type="submit" class="primary">Open pairing</button></div></form>';
    document.body.appendChild(dialog);
    const input = dialog.querySelector('input');
    const error = dialog.querySelector('.ws-agent-inline-error');
    dialog.querySelector('[value="cancel"]').addEventListener('click', () => dialog.close());
    dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const url = validatedPairingUrl(input.value);
        url.searchParams.set('studioOrigin', location.origin);
        const popup = window.open(url.href, 'bomwiki-cad-agent-pair', 'popup,width=520,height=560');
        if (!popup) throw new agentTools.CadAgentError('PAIRING_POPUP_BLOCKED', 'Allow this user-requested local pairing window, then try again.');
        pendingPairingWindow = popup;
        pendingPairingOrigin = url.origin;
        dialog.close();
        say('Local agent bridge opened — review the connection request next.');
      } catch (reason) {
        error.textContent = String(reason?.message || reason);
        error.hidden = false;
        input.focus();
      }
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
    input.focus();
  }

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
    }
    return btoa(binary);
  }

  async function liveAgentArtifact(args) {
    if (args.path) throw new agentTools.CadAgentError('LIVE_PATH_NOT_AVAILABLE', 'A browser session cannot write an arbitrary host path. Request the artifact data and let the MCP host save it within its approved output root.');
    const format = args.format;
    const permission = format === 'project' ? 'artifact.export-project' : format === 'step' ? 'artifact.export-step' : format === 'stl' ? 'artifact.export-stl' : 'artifact.render';
    if (!activeAgentConnection.permissionContext.granted.includes(permission)) throw new agentTools.CadAgentError('PERMISSION_DENIED', 'Permission "' + permission + '" is required.');
    let bytes;
    let mediaType;
    let manifest = null;
    if (format === 'project') {
      bytes = new TextEncoder().encode(JSON.stringify(v5RuntimeTools.canonicalStudioV5Project(doc), null, 2) + '\n');
      mediaType = 'application/json';
    } else if (format === 'step' || format === 'stl') {
      const response = await kernelCall(format === 'step' ? 'export-step' : 'export-stl', documentRevision, { bodyIds: selectedExportBodyIds() });
      if (!response.blob || response.errors?.length) throw new agentTools.CadAgentError('ARTIFACT_EXPORT_FAILED', response.errors?.[0]?.message || 'The exact CAD export failed.');
      bytes = new Uint8Array(await response.blob.arrayBuffer());
      mediaType = response.blob.type || (format === 'step' ? 'model/step' : 'model/stl');
      manifest = response.manifest || null;
    } else {
      throw new agentTools.CadAgentError('CAPABILITY_DISABLED', 'Live render transfer is not available in this runtime.', { repairOptions: [{ kind: 'inspect-capabilities', capability: 'artifact.render', reasonCode: 'LIVE_RENDER_TRANSFER_NOT_AVAILABLE' }] });
    }
    if (bytes.byteLength > 1024 * 1024) throw new agentTools.CadAgentError('ARTIFACT_TOO_LARGE_FOR_LOOPBACK', 'This artifact exceeds the 1 MiB live-transfer limit. Use the normal Studio download or a headless output path.');
    return {
      format,
      bytes: bytes.byteLength,
      mediaType,
      sha256: await sha256Hex(bytes),
      dataBase64: bytesToBase64(bytes),
      documentHash: v5RuntimeTools.studioV5CanonicalHash(doc),
      ...(manifest ? { manifest } : {}),
    };
  }

  async function handleLoopbackTool(tool, rawArgs, requestId) {
    if (!activeAgentConnection) throw new agentTools.CadAgentError('SESSION_NOT_FOUND', 'The live Studio session is not connected.');
    const args = deepCopy(rawArgs || {});
    delete args.sessionId;
    if (tool === 'cad_artifact') return liveAgentArtifact(args);
    let payload;
    if (tool === 'cad_inspect') payload = { kind: 'inspect', query: args.query || {} };
    else if (tool === 'cad_query') payload = { kind: 'query', query: args.query || {} };
    else if (tool === 'cad_preview') payload = { kind: 'preview', transaction: args.transaction };
    else if (tool === 'cad_commit') payload = { kind: 'commit', previewId: args.previewId };
    else if (tool === 'cad_history') payload = { kind: 'history', ...args };
    else throw new agentTools.CadAgentError('TOOL_NOT_FOUND', 'Unsupported live Studio tool "' + tool + '".');
    const envelope = agentTools.createCadAgentRequest({
      requestId,
      sessionId: activeAgentConnection.sessionId,
      projectId,
      expectedRevision: Number.isInteger(args.expectedRevision) ? args.expectedRevision : undefined,
      permissionContext: activeAgentConnection.permissionContext,
      payload,
    });
    const response = await handleLiveAgentRequest(activeAgentConnection.connectionToken, envelope);
    if (response.status !== 'ok') {
      const diagnostic = response.diagnostics?.[0] || {};
      throw new agentTools.CadAgentError(diagnostic.code || 'CAD_TOOL_FAILED', diagnostic.message || 'The live Studio request failed.', diagnostic);
    }
    return tool === 'cad_inspect' || tool === 'cad_query'
      ? { revision: response.revision, result: response.result }
      : response.result;
  }

  function postToPairingWindow(message) {
    const target = activeAgentConnection?.bridgeWindow || pendingPairingWindow;
    const origin = activeAgentConnection?.bridgeOrigin || pendingPairingOrigin;
    if (target && !target.closed && origin) target.postMessage({ source: 'bomwiki-cad-studio', message }, origin);
  }

  window.addEventListener('message', async (event) => {
    if (event.data?.source !== 'bomwiki-cad-loopback' || !event.data.message) return;
    const expectedWindow = activeAgentConnection?.bridgeWindow || pendingPairingWindow;
    const expectedOrigin = activeAgentConnection?.bridgeOrigin || pendingPairingOrigin;
    if (!expectedWindow || event.source !== expectedWindow || event.origin !== expectedOrigin) return;
    const message = event.data.message;
    if (message.type === 'bridge.close') {
      pendingPairingWindow = null;
      pendingPairingOrigin = null;
      if (activeAgentConnection) revokeAgentConnection(String(message.reason || 'Local agent disconnected'), false);
      else say(String(message.reason || 'Local agent disconnected') + '.');
      return;
    }
    if (message.type === 'pairing.request') {
      if (message.protocol !== agentTools.CAD_AGENT_PROTOCOL || typeof message.sessionId !== 'string') {
        postToPairingWindow({ type: 'pairing.denied', message: 'Unsupported CAD agent protocol.' });
        return;
      }
      try {
        const connection = await requestAgentConnection({
          sessionId: message.sessionId,
          clientLabel: message.clientLabel,
          permissionContext: message.permissionContext,
          mode: message.mode,
          bridgeWindow: event.source,
          bridgeOrigin: event.origin,
        });
        pendingPairingWindow = null;
        pendingPairingOrigin = null;
        postToPairingWindow({
          type: 'pairing.approved',
          projectId: connection.projectId,
          revision: connection.revision,
          permissionContext: connection.permissionContext,
          mode: connection.mode,
          capabilities: connection.capabilities,
        });
      } catch (reason) {
        postToPairingWindow({ type: 'pairing.denied', message: String(reason?.message || reason) });
      }
      return;
    }
    if (message.type === 'tool.request' && typeof message.id === 'string' && typeof message.tool === 'string') {
      try {
        const result = await handleLoopbackTool(message.tool, message.args, message.id);
        postToPairingWindow({ type: 'tool.response', id: message.id, ok: true, result });
      } catch (reason) {
        postToPairingWindow({
          type: 'tool.response',
          id: message.id,
          ok: false,
          error: { code: reason?.code || 'CAD_TOOL_FAILED', message: String(reason?.message || reason), ...(reason?.details ? { details: reason.details } : {}) },
        });
      }
    }
  });

  $('bw-help-agent')?.addEventListener('click', openLoopbackPairDialog);

  function synchronizeAgentAfterHostChange(label, actor = 'human', transactionId = null) {
    if (!liveAgentService || agentCommitInProgress || !v5RuntimeTools.isStudioV5Project(doc)) return;
    liveAgentService.synchronize(doc, commandRevision, { label, actor, ...(transactionId ? { transactionId } : {}) });
    updateAgentActivity(actor === 'human' ? 'Project changed by you' : label, actor);
  }

  function commit(label, mutate, metadata = {}) {
    // Run the mutation (and normalization) BEFORE touching the stacks: a
    // throwing mutation must leave undo history exactly as it was.
    const snap = JSON.stringify(doc);
    const previous = doc;
    let replacement;
    try {
      doc = normalizeDoc(JSON.parse(snap));
      replacement = mutate();
      doc = normalizeDoc(replacement || doc);
    } catch (err) {
      doc = previous;
      throw err;
    }
    undoStack.push({ label, snap });
    redoStack.length = 0;
    trimHistoryStacks();
    commandRevision++;
    afterDocumentChange(label);
    synchronizeAgentAfterHostChange(label, metadata.actor || 'human', metadata.transactionId || null);
  }

  function commitHumanOperations(label, operations) {
    const base = v5RuntimeTools.isStudioV5Project(doc)
      ? doc
      : v5RuntimeTools.migrateStudioDocumentToV5(doc, { projectId });
    const transactionId = 'human-' + (crypto.randomUUID?.() || newId() + '-' + Date.now());
    const applied = agentTools.applyCadTransaction(base, {
      transactionId,
      label,
      expectedRevision: commandRevision,
      atomic: true,
      operations,
      metadata: { actor: 'human', clientLabel: 'Studio UI' },
    });
    commit(label, () => applied.project, { actor: 'human', transactionId });
    return applied;
  }

  function featureOperationForDraft(draft, wasNew) {
    if (!wasNew) {
      const patch = {};
      for (const key of ['name', 'h', 'through', 'r', 't', 'edges', 'faces', 'sketch', 'pattern', 'resultPolicy', 'inputRefs']) {
        if (draft[key] !== undefined) patch[key] = deepCopy(draft[key]);
      }
      if (draft.pattern === undefined) patch.pattern = null;
      return { kind: 'feature.update', input: { featureId: draft.id, patch } };
    }
    const input = {
      id: draft.id,
      name: draft.name || OP_LABEL[draft.type],
      inputRefs: deepCopy(draft.inputRefs || []),
    };
    if (draft.resultPolicy !== undefined) input.resultPolicy = deepCopy(draft.resultPolicy);
    if (draft.sketch) input.sketch = deepCopy(draft.sketch);
    if (draft.h !== undefined) input.height = draft.h;
    if (draft.through !== undefined) input.through = draft.through;
    if (draft.r !== undefined) input.radius = draft.r;
    if (draft.t !== undefined) input.thickness = draft.t;
    if (draft.edges) input.edges = deepCopy(draft.edges);
    if (draft.faces) input.faces = deepCopy(draft.faces);
    if (draft.resultPolicy?.bodyName) input.bodyName = draft.resultPolicy.bodyName;
    return { kind: 'feature.' + draft.type, input };
  }

  function commitFeatureDraft(label, draft, wasNew) {
    if (draft.pattern) {
      commit(label, () => {
        if (v5RuntimeTools.isStudioV5Project(doc)) {
          return v5RuntimeTools.configureStudioV5Feature(doc, draft, {
            resultPolicy: draft.resultPolicy,
            bodyName: draft.resultPolicy?.bodyName,
          });
        }
        const index = doc.features.findIndex((feature) => feature.id === draft.id);
        if (index >= 0) doc.features[index] = draft;
        else doc.features.push(draft);
      });
      return;
    }
    const operations = [featureOperationForDraft(draft, wasNew)];
    return commitHumanOperations(label, operations);
  }

  // Shared post-change pipeline: prune dead selection, persist, re-render,
  // rebuild. Used by commit() and replaceDocument().
  function afterDocumentChange(recoveryLabel = null) {
    lastInspection = null;
    if (selectedFeatureId && !doc.features.some((f) => f.id === selectedFeatureId)) selectedFeatureId = null;
    if (v5RuntimeTools.isStudioV5Project(doc)) {
      if (doc.rootDocument?.kind === 'part') {
        const part = v5RuntimeTools.studioV5RootPart(doc);
        const currentPatternIds = new Set((part.bodyPatterns || []).map((pattern) => pattern.id));
        const bodyIds = new Set([
          ...part.bodies.map((body) => body.id),
          ...lastBodyResults.filter((entry) => currentPatternIds.has(entry.patternInstance?.patternId)).map((entry) => entry.bodyId),
        ]);
        const datumIds = new Set(part.referenceGeometry.map((datum) => datum.id));
        const sketchIds = new Set(part.sketches.map((sketch) => sketch.id));
        if (selectedBodyId && !bodyIds.has(selectedBodyId)) selectedBodyId = null;
        if (selectedDatumId && !datumIds.has(selectedDatumId)) selectedDatumId = null;
        if (selectedSketchId && !sketchIds.has(selectedSketchId)) selectedSketchId = null;
        if (isolatedBodyId && !bodyIds.has(isolatedBodyId)) isolatedBodyId = null;
        for (const bodyId of [...exportBodyIds]) if (!bodyIds.has(bodyId)) exportBodyIds.delete(bodyId);
        selectedOccurrenceId = null;
        selectedMateId = null;
      } else {
        const assembly = v5RuntimeTools.studioV5RootAssembly(doc);
        const occurrenceIds = new Set([
          ...assembly.occurrences.map((entry) => entry.id),
          ...lastBodyResults.map((entry) => entry.occurrenceInstance?.occurrenceId).filter(Boolean),
        ]);
        const mateIds = new Set(assembly.mates.map((entry) => entry.id));
        const bodyIds = new Set(lastBodyResults.map((entry) => entry.bodyId));
        if (selectedOccurrenceId && !occurrenceIds.has(selectedOccurrenceId)) selectedOccurrenceId = null;
        if (selectedMateId && !mateIds.has(selectedMateId)) selectedMateId = null;
        if (selectedBodyId && !bodyIds.has(selectedBodyId)) selectedBodyId = null;
        if (isolatedBodyId && !bodyIds.has(isolatedBodyId)) isolatedBodyId = null;
        for (const bodyId of [...exportBodyIds]) if (!bodyIds.has(bodyId)) exportBodyIds.delete(bodyId);
        selectedDatumId = null;
        selectedSketchId = null;
      }
    } else {
      selectedBodyId = null;
      selectedDatumId = null;
      selectedSketchId = null;
      selectedOccurrenceId = null;
      selectedMateId = null;
      isolatedBodyId = null;
      exportBodyIds.clear();
    }
    save(recoveryLabel);
    renderParams();
    renderHistory();
    renderContext();
    syncHistoryActions();
    rebuild({ treePreRendered: true });
  }

  function replaceDocument(snapJson) {
    doc = normalizeDoc(JSON.parse(snapJson));
    afterDocumentChange();
  }

  function undo() {
    if ($('bw-v5-command')?.open) return say('Apply or cancel the active command first.');
    if (mode.kind !== 'idle' && mode.kind !== 'rebuilding') return say('Finish or cancel the current action first.');
    if (!undoStack.length) return say('Nothing to undo.');
    const entry = undoStack.pop();
    redoStack.push({ label: entry.label, snap: JSON.stringify(doc) });
    trimHistoryStacks();
    replaceDocument(entry.snap);
    commandRevision++;
    synchronizeAgentAfterHostChange('Undo ' + entry.label, 'human');
    say('Undid: ' + entry.label);
  }
  function redo() {
    if ($('bw-v5-command')?.open) return say('Apply or cancel the active command first.');
    if (mode.kind !== 'idle' && mode.kind !== 'rebuilding') return say('Finish or cancel the current action first.');
    if (!redoStack.length) return say('Nothing to redo.');
    const entry = redoStack.pop();
    undoStack.push({ label: entry.label, snap: JSON.stringify(doc) });
    trimHistoryStacks();
    replaceDocument(entry.snap);
    commandRevision++;
    synchronizeAgentAfterHostChange('Redo ' + entry.label, 'human');
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
    sketching: (m) => m.prompt || ('Sketch · ' + m.tool + ' — click to place, type exact numbers below'),
    'press-pull': (m) => 'Press / Pull · ' + m.height + ' mm — drag the solid or type a distance · Enter to finish',
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
    home: ['Home', 'Common modeling and project commands'],
    sketch: ['Sketch', 'Draw and edit a closed profile'],
    solid: ['3D modeling', 'Create and refine solid bodies'],
    assembly: ['Assembly', 'Insert reusable components and solve explicit mates'],
    view: ['View', 'Orient, frame, and inspect the part'],
    manage: ['Manage', 'Project files, recovery, and history'],
    output: ['Output', 'Export manufacturing and project files'],
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
  // Ribbon tabs may surface the same real command in more than one context.
  // Proxies keep one canonical control per command, avoiding duplicate IDs and
  // duplicate feature state while preserving the dense desktop-CAD ribbon.
  document.querySelectorAll('[data-command-target]').forEach((b) =>
    b.addEventListener('click', () => {
      const target = $(b.dataset.commandTarget);
      if (target) target.click();
    }),
  );
  document.querySelectorAll('[data-command-feat]').forEach((b) =>
    b.addEventListener('click', () => {
      const target = document.querySelector('[data-feat="' + b.dataset.commandFeat + '"]');
      if (target) target.click();
    }),
  );
  document.querySelectorAll('[data-command-view]').forEach((b) =>
    b.addEventListener('click', () => {
      const target = document.querySelector('[data-view="' + b.dataset.commandView + '"]');
      if (target) target.click();
    }),
  );
  function setMode(next) {
    // Passive recovery notices must never sit on top of an active modeling
    // command. Starting work dismisses them immediately; their content stays
    // available in Project > Recover.
    if (isWorking(next.kind) && next.kind !== mode.kind) hideTransitionToast(true);
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
    if (actions) actions.hidden = !(mode.kind === 'sketching' || mode.kind === 'press-pull' || mode.kind === 'picking-edges' || mode.kind === 'picking-faces');
    const rib = document.getElementById('rib-sketch');
    if (rib) rib.hidden = mode.kind !== 'sketching';
    const sketchTab = document.querySelector('[data-workspace="sketch"]');
    if (sketchTab) sketchTab.disabled = mode.kind !== 'sketching';
    if (mode.kind === 'sketching') showWorkspace('sketch', true);
    else if (mode.kind === 'press-pull') showWorkspace('solid', true);
    else if (mode.kind === 'picking-edges' || mode.kind === 'picking-faces') showWorkspace('solid', true);
    else if (mode.kind === 'choose-face') showWorkspace('solid', true);
    else if (mode.kind === 'idle') showWorkspace(preferredWorkspace, true);
    if (!isWorking(mode.kind)) currentOpType = null;
    document.querySelectorAll('[data-feat]').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.feat === currentOpType && isWorking(mode.kind) ? 'true' : 'false');
      b.classList.toggle('on', b.dataset.feat === currentOpType && isWorking(mode.kind));
    });
    document.querySelectorAll('[data-command-feat]').forEach((b) => {
      const on = b.dataset.commandFeat === currentOpType && isWorking(mode.kind);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('on', on);
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

  const OP_LABEL = { extrude: 'Extrude', cut: 'Cut', revolve: 'Revolve', draft: 'Draft', thicken: 'Thicken', 'boolean-split-side': 'Split', 'imported-step': 'Independent B-rep', fillet: 'Fillet', chamfer: 'Chamfer', shell: 'Shell', boolean: 'Boolean', transform: 'Transform', loft: 'Loft', sweep: 'Sweep', pattern: 'Pattern', mate: 'Mate', assembly: 'Assembly' };

  const v5Dialog = $('bw-v5-command');
  const v5Fields = $('bw-v5-command-fields');
  const v5Error = $('bw-v5-command-error');
  const attr = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const field = (label, name, value, options = {}) =>
    '<label' + (options.wide ? ' class="is-wide"' : '') + '>' + label + '<input name="' + name + '" value="' + attr(value) + '"' + (options.type ? ' type="' + options.type + '"' : '') + ' /></label>';
  const selectField = (label, name, entries, value, wide = false) =>
    '<label' + (wide ? ' class="is-wide"' : '') + '>' + label + '<select name="' + name + '">' + entries.map((entry) => '<option value="' + attr(entry.id) + '"' + (entry.id === value ? ' selected' : '') + '>' + attr(entry.name) + '</option>').join('') + '</select></label>';
  const textareaField = (label, name, value) => '<label class="is-wide">' + label + '<textarea name="' + name + '">' + String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</textarea></label>';

  function setV5FormValue(name, value) {
    const input = v5Fields?.querySelector('[name="' + name + '"]');
    if (input) input.value = String(Math.round(value * 1e6) / 1e6);
  }

  function endTransformPreview(reset = true) {
    if (transformPreview?.previewObjects && reset) {
      for (const entry of transformPreview.previewObjects) {
        entry.object.matrix.copy(entry.matrix);
        entry.object.matrixAutoUpdate = false;
      }
    }
    if (transformPreview?.object && reset) {
      transformPreview.object.position.copy(transformPreview.position);
      transformPreview.object.quaternion.copy(transformPreview.quaternion);
      transformPreview.object.scale.copy(transformPreview.scale);
      transformPreview.object.updateMatrixWorld(true);
    }
    transformControls.detach();
    transformControls.enabled = false;
    transformHelper.visible = false;
    if (transformPreview?.anchor) partGroup.remove(transformPreview.anchor);
    transformPreview = null;
    orbit.enabled = true;
  }

  function beginAssemblyTransformPreview(occurrence) {
    endTransformPreview();
    const bodyIds = new Set(lastBodyResults
      .filter((entry) => entry.occurrenceInstance?.occurrencePath?.[0] === occurrence.id)
      .map((entry) => entry.bodyId));
    const previewObjects = [
      ...[...bodyMeshes].filter(([bodyId]) => bodyIds.has(bodyId)).map(([, object]) => object),
      ...edgeLines.filter((line) => bodyIds.has(line.userData.bodyId)),
    ].map((object) => ({ object, matrix: object.matrix.clone() }));
    if (!previewObjects.length) return false;
    const anchor = new THREE.Object3D();
    anchor.matrix.fromArray(cadMatrixToScene(occurrence.baseTransform));
    anchor.matrix.decompose(anchor.position, anchor.quaternion, anchor.scale);
    anchor.updateMatrixWorld(true);
    partGroup.add(anchor);
    transformPreview = {
      command: 'assembly-transform', occurrenceId: occurrence.id, bodyId: previewObjects[0].object.userData.bodyId,
      object: anchor, anchor, previewObjects,
      position: anchor.position.clone(), quaternion: anchor.quaternion.clone(), scale: anchor.scale.clone(),
      anchorMatrix: anchor.matrix.clone(),
    };
    const mode = v5Fields.querySelector('[name="gizmoMode"]')?.value || 'translate';
    const snap = Math.max(mode === 'rotate' ? 0.1 : 0.001, Number(v5Fields.querySelector('[name="gizmoSnap"]')?.value) || (mode === 'rotate' ? 15 : 1));
    transformControls.setMode(mode);
    transformControls.setSpace('local');
    transformControls.setTranslationSnap(mode === 'translate' ? snap : null);
    transformControls.setRotationSnap(mode === 'rotate' ? snap * Math.PI / 180 : null);
    transformControls.attach(anchor);
    transformControls.enabled = true;
    transformHelper.visible = true;
    return true;
  }

  function beginTransformPreview(command, feature = null) {
    endTransformPreview();
    if (!['move', 'copy', 'rotate'].includes(command)) return false;
    const previewBodyId = feature?.createdBodyId || feature?.sourceBodyId || v5Dialog.dataset.bodyId;
    const object = bodyMeshes.get(previewBodyId);
    if (!object) return false;
    transformPreview = {
      command,
      bodyId: previewBodyId,
      object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
      baseTranslation: feature?.transform?.translation ? [...feature.transform.translation] : [0, 0, 0],
      baseAngle: Number(feature?.transform?.angle || 0),
    };
    transformControls.setMode(command === 'rotate' ? 'rotate' : 'translate');
    transformControls.setSpace('local');
    const snap = Number(v5Fields.querySelector('[name="gizmoSnap"]')?.value || (command === 'rotate' ? 15 : 1));
    transformControls.setTranslationSnap(command === 'rotate' ? null : Math.max(0.001, snap));
    transformControls.setRotationSnap(command === 'rotate' ? Math.max(0.1, snap) * Math.PI / 180 : null);
    transformControls.attach(object);
    transformControls.enabled = true;
    transformHelper.visible = true;
    return true;
  }

  transformControls.addEventListener('objectChange', () => {
    const preview = transformPreview;
    if (!preview?.object) return;
    if (preview.command === 'assembly-transform') {
      preview.object.updateMatrix();
      const delta = preview.object.matrix.clone().multiply(preview.anchorMatrix.clone().invert());
      for (const entry of preview.previewObjects) {
        entry.object.matrix.multiplyMatrices(delta, entry.matrix);
        entry.object.matrixAutoUpdate = false;
      }
      const cad = sceneMatrixToCad(preview.object.matrix.toArray());
      const matrixInput = v5Fields.querySelector('[name="matrix"]');
      if (matrixInput) matrixInput.value = cad.map((value) => Math.abs(value) < 1e-12 ? 0 : Math.round(value * 1e9) / 1e9).join(', ');
      return;
    }
    if (preview.command === 'move' || preview.command === 'copy') {
      const delta = preview.object.position.clone().sub(preview.position);
      setV5FormValue('tx', preview.baseTranslation[0] + delta.x);
      setV5FormValue('ty', preview.baseTranslation[1] + delta.y);
      setV5FormValue('tz', preview.baseTranslation[2] + delta.z);
      return;
    }
    const delta = preview.quaternion.clone().invert().multiply(preview.object.quaternion).normalize();
    const angle = 2 * Math.acos(Math.max(-1, Math.min(1, delta.w)));
    const denominator = Math.sqrt(Math.max(0, 1 - delta.w * delta.w));
    const axis = denominator > 1e-7 ? [delta.x / denominator, delta.y / denominator, delta.z / denominator] : [1, 0, 0];
    const dominant = axis.map(Math.abs).indexOf(Math.max(...axis.map(Math.abs)));
    const axisId = ['datum-origin-x', 'datum-origin-y', 'datum-origin-z'][dominant];
    const axisInput = v5Fields.querySelector('[name="axisDatumId"]');
    if (axisInput) axisInput.value = axisId;
    setV5FormValue('angle', preview.baseAngle + angle * Math.sign(axis[dominant] || 1) * 180 / Math.PI);
  });

  v5Fields?.addEventListener('change', (event) => {
    if (!transformPreview || !['gizmoSnap', 'gizmoMode'].includes(event.target?.name)) return;
    const selectedMode = transformPreview.command === 'assembly-transform'
      ? v5Fields.querySelector('[name="gizmoMode"]')?.value || 'translate'
      : transformPreview.command === 'rotate' ? 'rotate' : 'translate';
    const snap = Math.max(selectedMode === 'rotate' ? 0.1 : 0.001, Number(v5Fields.querySelector('[name="gizmoSnap"]')?.value) || 0);
    transformControls.setMode(selectedMode);
    transformControls.setTranslationSnap(selectedMode === 'translate' ? snap : null);
    transformControls.setRotationSnap(selectedMode === 'rotate' ? snap * Math.PI / 180 : null);
  });

  function v5PartCandidate() {
    return v5RuntimeTools.isStudioV5Project(doc)
      ? v5RuntimeTools.canonicalStudioV5Project(doc)
      : v5RuntimeTools.migrateStudioDocumentToV5(doc, { projectId });
  }

  function ensureOriginDatums(candidate) {
    const definitions = [
      { id: 'datum-origin-point', name: 'Origin', kind: 'point', definition: { mode: 'coordinates', coordinates: [0, 0, 0] } },
      { id: 'datum-origin-xy', name: 'XY plane', kind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [0, 0, 1], xDirection: [1, 0, 0] } },
      { id: 'datum-origin-yz', name: 'YZ plane', kind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [1, 0, 0], xDirection: [0, 1, 0] } },
      { id: 'datum-origin-zx', name: 'ZX plane', kind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [0, 1, 0], xDirection: [0, 0, 1] } },
      { id: 'datum-origin-x', name: 'X axis', kind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [1, 0, 0] } },
      { id: 'datum-origin-y', name: 'Y axis', kind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [0, 1, 0] } },
      { id: 'datum-origin-z', name: 'Z axis', kind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [0, 0, 1] } },
      { id: 'datum-origin-cs', name: 'World coordinates', kind: 'coordinate-system', definition: { mode: 'principal', origin: [0, 0, 0], xDirection: [1, 0, 0], zDirection: [0, 0, 1] } },
    ];
    let next = candidate;
    for (const definition of definitions) {
      const part = v5RuntimeTools.studioV5RootPart(next);
      if (!part.referenceGeometry.some((datum) => datum.id === definition.id)) next = v5RuntimeTools.createStudioV5Datum(next, definition);
    }
    return next;
  }

  function formNumber(form, name, fallback = 0) {
    const value = form.elements.namedItem(name)?.value?.trim();
    if (value == null || value === '') return fallback;
    return /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
  }

  function formVector(form, prefix, fallback = [0, 0, 0]) {
    return ['x', 'y', 'z'].map((axis, index) => formNumber(form, prefix + axis, fallback[index]));
  }

  function renderPlaneCommandFields(candidate, datum = null, forcedMode = null) {
    const part = v5RuntimeTools.studioV5RootPart(candidate);
    const definition = datum?.definition || {};
    const mode = forcedMode || definition.mode || 'offset';
    const planes = part.referenceGeometry.filter((entry) => entry.kind === 'plane' && entry.id !== datum?.id);
    const axes = part.referenceGeometry.filter((entry) => entry.kind === 'axis');
    const points = part.referenceGeometry.filter((entry) => entry.kind === 'point');
    const modes = [
      ['offset', 'Offset from plane'], ['angle', 'Angle about axis'], ['three-point', 'Through three points'],
      ['point-normal', 'Point and normal'], ['midplane', 'Mid-plane'], ['curve-normal', 'Normal to curve'],
    ];
    v5Fields.innerHTML =
      field('Name', 'name', datum?.name || 'Construction plane', { wide: true }) +
      '<label class="is-wide">Mode<select name="mode">' + modes.map(([id, name]) => '<option value="' + id + '"' + (id === mode ? ' selected' : '') + '>' + name + '</option>').join('') + '</select></label>' +
      (mode === 'offset'
        ? selectField('Reference plane', 'referenceDatumId', planes, definition.referenceDatumId || 'datum-origin-yz', true) + field('Signed offset', 'offset', definition.offset ?? 10, { wide: true })
        : mode === 'angle'
          ? selectField('Reference plane', 'referenceDatumId', planes, definition.referenceDatumId || 'datum-origin-yz') + selectField('Rotation axis', 'axisDatumId', axes, definition.axisDatumId || 'datum-origin-z') + field('Angle (deg)', 'angle', definition.angle ?? 15, { wide: true })
          : mode === 'midplane'
            ? selectField('First plane', 'firstDatumId', planes, definition.firstDatumId || planes[0]?.id) + selectField('Second plane', 'secondDatumId', planes, definition.secondDatumId || planes[1]?.id)
            : mode === 'three-point'
              ? [0, 1, 2].map((index) => field('Point ' + (index + 1) + ' X,Y,Z', 'point' + index, (definition.points?.[index] || [[0, 0, 0], [0, 10, 0], [0, 0, 10]][index]).join(','), { wide: true })).join('')
              : (points.length ? selectField('Point datum', 'pointDatumId', points, definition.pointDatumId || points[0]?.id, true) : '') +
                field(mode === 'curve-normal' ? 'Curve tangent X,Y,Z' : 'Normal X,Y,Z', 'normalCsv', (definition.normal || definition.tangent || [1, 0, 0]).join(','), { wide: true }));
    v5Fields.querySelector('[name="mode"]')?.addEventListener('change', (event) => renderPlaneCommandFields(candidate, datum, event.target.value));
  }

  function parseCsvVector(value, label) {
    const values = String(value || '').split(',').map((entry) => Number(entry.trim()));
    if (values.length !== 3 || values.some((entry) => !Number.isFinite(entry))) throw new Error(label + ' must be three comma-separated numbers.');
    return values;
  }

  function planeDefinitionFromForm(form) {
    const mode = form.elements.namedItem('mode').value;
    if (mode === 'offset') return { mode, referenceDatumId: form.elements.namedItem('referenceDatumId').value, offset: formNumber(form, 'offset') };
    if (mode === 'angle') return { mode, referenceDatumId: form.elements.namedItem('referenceDatumId').value, axisDatumId: form.elements.namedItem('axisDatumId').value, angle: formNumber(form, 'angle') };
    if (mode === 'midplane') return { mode, firstDatumId: form.elements.namedItem('firstDatumId').value, secondDatumId: form.elements.namedItem('secondDatumId').value };
    if (mode === 'three-point') return { mode, points: [0, 1, 2].map((index) => parseCsvVector(form.elements.namedItem('point' + index).value, 'Plane point')) };
    const vector = parseCsvVector(form.elements.namedItem('normalCsv').value, mode === 'curve-normal' ? 'Curve tangent' : 'Plane normal');
    return { mode, pointDatumId: form.elements.namedItem('pointDatumId')?.value || 'datum-origin-point', [mode === 'curve-normal' ? 'tangent' : 'normal']: vector };
  }

  function renderTransformCommandFields(candidate, command, feature = null) {
    const part = v5RuntimeTools.studioV5RootPart(candidate);
    const transform = feature?.transform || {};
    const planes = part.referenceGeometry.filter((entry) => entry.kind === 'plane');
    const axes = part.referenceGeometry.filter((entry) => entry.kind === 'axis');
    if (command === 'move' || command === 'copy') {
      const vector = transform.translation || [0, 0, 0];
      v5Fields.innerHTML = field('ΔX', 'tx', vector[0]) + field('ΔY', 'ty', vector[1]) + field('ΔZ', 'tz', vector[2]) + field('Handle snap (mm)', 'gizmoSnap', 1, { wide: true }) + '<p class="is-wide">Drag the 3D axis handles or enter exact offsets.' + (command === 'copy' ? ' The copied body remains linked to its source feature history.' : '') + '</p>';
    } else if (command === 'rotate') {
      v5Fields.innerHTML = selectField('Axis', 'axisDatumId', axes, transform.axisDatumId || 'datum-origin-x', true) + field('Angle (deg)', 'angle', transform.angle ?? 15) + field('Handle snap (deg)', 'gizmoSnap', 15) + '<p class="is-wide">Drag a 3D rotation ring or enter an exact angle.</p>';
    } else if (command === 'mirror') {
      v5Fields.innerHTML = selectField('Mirror plane', 'planeDatumId', planes, transform.planeDatumId || 'datum-origin-yz', true) + '<label class="is-wide"><input type="checkbox" name="moveOriginal"' + (feature && feature.resultPolicy?.kind !== 'new-body' ? ' checked' : '') + ' /> Move original instead of creating linked mirror</label>';
    } else if (command === 'scale') {
      v5Fields.innerHTML = field('Uniform factor', 'factor', transform.factor ?? 1.2, { wide: true }) + field('Centre X', 'cx', transform.center?.[0] ?? 0) + field('Centre Y', 'cy', transform.center?.[1] ?? 0) + field('Centre Z', 'cz', transform.center?.[2] ?? 0);
    } else {
      const frames = part.referenceGeometry.filter((entry) => entry.kind === 'plane' || entry.kind === 'axis' || entry.kind === 'coordinate-system');
      v5Fields.innerHTML = selectField('From reference', 'fromDatumId', frames, transform.fromDatumId || 'datum-origin-yz') + selectField('To reference', 'toDatumId', frames, transform.toDatumId || planes.find((entry) => entry.id !== 'datum-origin-yz')?.id || 'datum-origin-yz') + field('Offset', 'offset', transform.offset ?? 0) + '<label><input type="checkbox" name="flip"' + (transform.flip ? ' checked' : '') + ' /> Flip alignment</label>';
    }
  }

  function transformFromForm(form, command) {
    if (command === 'move' || command === 'copy') return { mode: command, translation: formVector(form, 't') };
    if (command === 'rotate') return { mode: command, axisDatumId: form.elements.namedItem('axisDatumId').value, angle: formNumber(form, 'angle') };
    if (command === 'mirror') return { mode: command, planeDatumId: form.elements.namedItem('planeDatumId').value };
    if (command === 'scale') return { mode: command, factor: formNumber(form, 'factor', 1), center: formVector(form, 'c') };
    return { mode: 'align', fromDatumId: form.elements.namedItem('fromDatumId').value, toDatumId: form.elements.namedItem('toDatumId').value, offset: formNumber(form, 'offset'), flip: form.elements.namedItem('flip').checked };
  }

  const formatPointRows = (points) => (points || []).map((point) => point.join(', ')).join('\n');

  function parsePointRows(value, dimensions, label) {
    const rows = String(value || '').split(/\r?\n/).map((row) => row.trim()).filter((row) => row && !row.startsWith('#'));
    const points = rows.map((row, index) => {
      const values = row.split(/[\s,;]+/).filter(Boolean);
      if (values.length !== dimensions) throw new Error(label + ' row ' + (index + 1) + ' must contain ' + dimensions + ' coordinates.');
      return values.map((entry) => /^-?\d+(?:\.\d+)?$/.test(entry) ? Number(entry) : entry);
    });
    return points;
  }

  function renderSketchCommandFields(candidate, command, sketch = null) {
    const part = v5RuntimeTools.studioV5RootPart(candidate);
    const entity = sketch?.entities?.[0] || {};
    const role = command === 'profile' ? 'profile' : 'path';
    const defaults = role === 'profile'
      ? [[20, 0], [8, 3], [-16, 2], [-20, 0], [-16, -2], [8, -3]]
      : [[0, 0, 0], [30, 0, 0], [60, 15, 0]];
    v5Fields.innerHTML =
      field('Name', 'name', sketch?.name || (role === 'profile' ? 'Profile' : 'Path'), { wide: true }) +
      '<label>Curve type<select name="curveKind"><option value="spline"' + (entity.kind !== 'polyline' ? ' selected' : '') + '>Spline</option><option value="polyline"' + (entity.kind === 'polyline' ? ' selected' : '') + '>Polyline</option></select></label>' +
      (role === 'profile'
        ? selectField('Support plane', 'planeDatumId', part.referenceGeometry.filter((entry) => entry.kind === 'plane'), sketch?.support?.ownerId || 'datum-origin-yz')
        : '<p>Paths use world-space X, Y, Z coordinates.</p>') +
      textareaField(role === 'profile' ? 'Closed profile points — X, Y per row' : 'Path points — X, Y, Z per row', 'points', formatPointRows(entity.points || defaults));
  }

  function optionalSketchSelect(label, name, entries, value) {
    return '<label>' + label + '<select name="' + name + '"><option value="">None</option>' + entries.map((entry) => '<option value="' + attr(entry.id) + '"' + (entry.id === value ? ' selected' : '') + '>' + attr(entry.name) + '</option>').join('') + '</select></label>';
  }

  function renderAdvancedShapeFields(candidate, command, feature = null) {
    const part = v5RuntimeTools.studioV5RootPart(candidate);
    const profiles = part.sketches.filter((entry) => entry.extensions?.studioRole === 'profile');
    const paths = part.sketches.filter((entry) => entry.extensions?.studioRole === 'path');
    if (command === 'loft') {
      const ids = feature?.sections?.map((entry) => entry.sketchId) || profiles.slice(0, 3).map((entry) => entry.id);
      const continuity = feature?.continuity || {};
      v5Fields.innerHTML = field('Name', 'name', feature?.name || 'Loft', { wide: true }) +
        textareaField('Ordered profile sketch IDs — one per row', 'sectionIds', ids.join('\n')) +
        optionalSketchSelect('Guide curve', 'guideSketchId', paths, feature?.guideSketchIds?.[0] || '') +
        optionalSketchSelect('Centreline', 'centerlineSketchId', paths, feature?.centerlineSketchId || '') +
        '<label>Start continuity<select name="startContinuity"><option value="free">Free</option><option value="tangent"' + (continuity.start === 'tangent' ? ' selected' : '') + '>Tangent</option><option value="curvature"' + (continuity.start === 'curvature' ? ' selected' : '') + '>Curvature</option></select></label>' +
        '<label>End continuity<select name="endContinuity"><option value="free">Free</option><option value="tangent"' + (continuity.end === 'tangent' ? ' selected' : '') + '>Tangent</option><option value="curvature"' + (continuity.end === 'curvature' ? ' selected' : '') + '>Curvature</option></select></label>' +
        '<label class="is-wide"><input type="checkbox" name="ruled"' + (feature?.ruled ? ' checked' : '') + ' /> Ruled instead of smooth Loft</label>';
    } else {
      const orientation = feature?.orientation || 'minimum-twist';
      v5Fields.innerHTML = field('Name', 'name', feature?.name || 'Sweep', { wide: true }) +
        selectField('Profile', 'profileSketchId', profiles, feature?.profileSketchId || profiles[0]?.id) +
        selectField('Path', 'pathSketchId', paths, feature?.pathSketchId || paths[0]?.id) +
        '<label>Orientation<select name="orientation">' + [
          ['path-normal', 'Path normal'], ['minimum-twist', 'Minimum twist'], ['fixed', 'Fixed direction'], ['reference', 'Selected reference'], ['guide', 'Guide rail'], ['controlled-twist', 'Controlled twist'],
        ].map(([id, name]) => '<option value="' + id + '"' + (id === orientation ? ' selected' : '') + '>' + name + '</option>').join('') + '</select></label>' +
        optionalSketchSelect('Guide rail', 'guideSketchId', paths.filter((entry) => entry.id !== (feature?.pathSketchId || paths[0]?.id)), feature?.guideSketchId || '') +
        field('Twist angle', 'twistAngle', feature?.twistAngle ?? 0) + field('End scale', 'scaleEnd', feature?.scaleEnd ?? 1) +
        field('Reference X', 'rx', feature?.referenceDirection?.[0] ?? 0) + field('Reference Y', 'ry', feature?.referenceDirection?.[1] ?? 0) + field('Reference Z', 'rz', feature?.referenceDirection?.[2] ?? 1);
    }
  }

  function advancedFeatureFromForm(form, command) {
    if (command === 'loft') {
      const sectionIds = String(form.elements.namedItem('sectionIds').value || '').split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
      const guideSketchId = form.elements.namedItem('guideSketchId').value;
      const centerlineSketchId = form.elements.namedItem('centerlineSketchId').value;
      return {
        name: form.elements.namedItem('name').value.trim(), sections: sectionIds,
        guideSketchIds: guideSketchId ? [guideSketchId] : [], centerlineSketchId: centerlineSketchId || null,
        continuity: { start: form.elements.namedItem('startContinuity').value, end: form.elements.namedItem('endContinuity').value },
        ruled: form.elements.namedItem('ruled').checked,
      };
    }
    return {
      name: form.elements.namedItem('name').value.trim(),
      profileSketchId: form.elements.namedItem('profileSketchId').value,
      pathSketchId: form.elements.namedItem('pathSketchId').value,
      guideSketchId: form.elements.namedItem('guideSketchId').value || null,
      orientation: form.elements.namedItem('orientation').value,
      twistAngle: formNumber(form, 'twistAngle'), scaleEnd: formNumber(form, 'scaleEnd', 1),
      referenceDirection: formVector(form, 'r', [0, 0, 1]), transition: 'round',
    };
  }

  function bodyTopologyChoices(bodyId, kind, stored = []) {
    const current = kind === 'face'
      ? [...faceByHash.values()].filter((entry) => entry.bodyId === bodyId).map((entry) => entry.sig)
      : edgeLines.filter((entry) => entry.userData.bodyId === bodyId).flatMap(edgeSignaturesForLine);
    const choices = [];
    for (const signature of [...stored, ...current]) {
      if (!signature || choices.some((entry) => JSON.stringify(entry) === JSON.stringify(signature))) continue;
      choices.push(signature);
    }
    return choices;
  }

  function topologySelect(label, name, choices, selected, multiple) {
    const selectedKeys = new Set((selected || []).map((entry) => JSON.stringify(entry)));
    return '<label class="is-wide">' + label + '<select name="' + name + '"' + (multiple ? ' multiple size="6"' : '') + '>' +
      choices.map((signature, index) => {
        const description = signature.n
          ? 'Face ' + (index + 1) + ' · centre ' + signature.p.join(', ') + ' · normal ' + signature.n.join(', ')
          : 'Edge ' + (index + 1) + ' · midpoint ' + signature.p.join(', ') + ' · length ' + signature.l;
        return '<option value="' + index + '"' + (selectedKeys.has(JSON.stringify(signature)) ? ' selected' : '') + '>' + attr(description) + '</option>';
      }).join('') + '</select></label>';
  }

  function renderAdvancedModifierFields(candidate, command, feature = null) {
    const part = v5RuntimeTools.studioV5RootPart(candidate);
    const profiles = part.sketches.filter((entry) => entry.extensions?.studioRole === 'profile');
    const axes = part.referenceGeometry.filter((entry) => entry.kind === 'axis');
    const planes = part.referenceGeometry.filter((entry) => entry.kind === 'plane');
    if (command === 'revolve-advanced') {
      v5Fields.innerHTML = field('Name', 'name', feature?.name || 'Partial revolve', { wide: true }) +
        selectField('Profile', 'profileSketchId', profiles, feature?.profileSketchId || profiles[0]?.id) +
        selectField('Axis', 'axisDatumId', axes, feature?.axisDatumId || axes[0]?.id) +
        field('Sweep angle (deg)', 'angle', feature?.angle ?? 180) + field('Start angle (deg)', 'startAngle', feature?.startAngle ?? 0) +
        '<label class="is-wide"><input type="checkbox" name="symmetric"' + (feature?.symmetric ? ' checked' : '') + ' /> Symmetric about the profile plane start direction</label>';
      return;
    }
    const featureBodyId = feature?.type === 'thicken' ? feature.sourceBodyId : feature?.resultPolicy?.targetBodyIds?.[0];
    const bodyId = featureBodyId || selectedBodyId;
    const body = part.bodies.find((entry) => entry.id === bodyId);
    const stored = command === 'variable-fillet' ? (feature?.edges || []) : (feature?.faces || []);
    const kind = command === 'variable-fillet' ? 'edge' : 'face';
    const choices = bodyTopologyChoices(bodyId, kind, stored);
    v5Dialog.__topologyChoices = choices;
    const common = field('Name', 'name', feature?.name || ({ draft: 'Draft', thicken: 'Thicken', 'variable-fillet': 'Variable fillet' })[command] + ' ' + (body?.name || 'body'), { wide: true }) +
      selectField('Body', 'bodyId', body ? [body] : [], bodyId, true);
    if (command === 'draft') {
      v5Fields.innerHTML = common + selectField('Neutral plane', 'neutralPlaneDatumId', planes, feature?.neutralPlaneDatumId || planes[0]?.id, true) +
        field('Draft angle (deg)', 'angle', feature?.angle ?? 5) +
        topologySelect('Faces — use Command/Ctrl to select more than one', 'topology', choices, feature?.faces || [], true) +
        '<label><input type="checkbox" name="flip"' + (feature?.flip ? ' checked' : '') + ' /> Flip angle</label>' +
        '<label><input type="checkbox" name="tangentPropagation"' + (feature?.tangentPropagation !== false ? ' checked' : '') + ' /> Tangent propagation</label>';
    } else if (command === 'thicken') {
      v5Fields.innerHTML = common + field('New body name', 'bodyName', part.bodies.find((entry) => entry.createdByFeatureId === feature?.id)?.name || feature?.resultPolicy?.bodyName || (body?.name || 'Body') + ' thickened face', { wide: true }) +
        field('Thickness', 'thickness', feature?.thickness ?? 2) + topologySelect('One planar source face', 'topology', choices, feature?.faces || [], false) +
        '<label><input type="checkbox" name="symmetric"' + (feature?.symmetric ? ' checked' : '') + ' /> Symmetric thickness</label>' +
        '<label><input type="checkbox" name="flip"' + (feature?.flip ? ' checked' : '') + ' /> Flip direction</label>';
    } else {
      v5Fields.innerHTML = common + field('Start radius', 'startRadius', feature?.variableRadii?.[0]?.startRadius ?? 1) +
        field('End radius', 'endRadius', feature?.variableRadii?.[0]?.endRadius ?? 3) +
        topologySelect('Edges — use Command/Ctrl to select more than one', 'topology', choices, feature?.edges || [], true) +
        '<label class="is-wide"><input type="checkbox" name="tangentPropagation"' + (feature?.tangentPropagation ? ' checked' : '') + ' /> Tangent propagation</label>';
    }
  }

  function advancedModifierFromForm(form, command) {
    const topology = [...form.elements.namedItem('topology').selectedOptions].map((entry) => v5Dialog.__topologyChoices[Number(entry.value)]);
    const common = { name: form.elements.namedItem('name').value.trim(), bodyId: form.elements.namedItem('bodyId').value };
    if (command === 'draft') return {
      ...common, faces: topology, neutralPlaneDatumId: form.elements.namedItem('neutralPlaneDatumId').value,
      angle: formNumber(form, 'angle'), flip: form.elements.namedItem('flip').checked,
      tangentPropagation: form.elements.namedItem('tangentPropagation').checked,
    };
    if (command === 'thicken') return {
      ...common, faces: topology, bodyName: form.elements.namedItem('bodyName').value.trim(), thickness: formNumber(form, 'thickness'),
      symmetric: form.elements.namedItem('symmetric').checked, flip: form.elements.namedItem('flip').checked,
    };
    return {
      ...common, edges: topology, startRadius: formNumber(form, 'startRadius'), endRadius: formNumber(form, 'endRadius'),
      tangentPropagation: form.elements.namedItem('tangentPropagation').checked,
    };
  }

  function renderBooleanSplitFields(candidate) {
    const part = v5RuntimeTools.studioV5RootPart(candidate);
    const target = part.bodies.find((entry) => entry.id === selectedBodyId);
    const tools = part.bodies.filter((entry) => entry.id !== target?.id && !entry.suppressed);
    v5Fields.innerHTML = field('Name', 'name', 'Split ' + (target?.name || 'body'), { wide: true }) +
      selectField('Target body', 'targetBodyId', target ? [target] : [], target?.id, true) +
      selectField('Splitting tool body', 'toolBodyId', tools, tools[0]?.id, true) +
      '<label><input type="checkbox" name="keepOriginal" /> Keep original target visible</label>' +
      '<label><input type="checkbox" name="keepTools" checked /> Keep tool visible</label>';
  }

  function renderBodyPatternFields(candidate, pattern = null) {
    const part = v5RuntimeTools.studioV5RootPart(candidate);
    const kind = pattern?.kind || 'circular';
    const referenceByRole = Object.fromEntries((pattern?.references || []).map((reference) => [reference.semanticPath?.role, reference.ownerId]));
    const axes = part.referenceGeometry.filter((entry) => entry.kind === 'axis' || entry.kind === 'coordinate-system');
    const planes = part.referenceGeometry.filter((entry) => entry.kind === 'plane');
    const paths = part.sketches.filter((entry) => entry.extensions?.studioRole === 'path');
    const sourceBodyId = pattern?.sourceBodyId || selectedBodyId;
    v5Fields.innerHTML =
      field('Name', 'name', pattern?.name || 'Body pattern', { wide: true }) +
      selectField('Source body', 'sourceBodyId', part.bodies, sourceBodyId) +
      '<label>Type<select name="patternKind">' + [['circular', 'Circular'], ['linear', 'Linear'], ['curve', 'Curve'], ['mirror', 'Mirror']]
        .map(([id, name]) => '<option value="' + id + '"' + (id === kind ? ' selected' : '') + '>' + name + '</option>').join('') + '</select></label>' +
      '<label>Result<select name="outputMode"><option value="linked"' + (pattern?.outputMode !== 'union' ? ' selected' : '') + '>Linked occurrences</option><option value="union"' + (pattern?.outputMode === 'union' ? ' selected' : '') + '>Fuse to one solid</option></select></label>' +
      field('Count', 'count', pattern?.definition?.count ?? 12) +
      selectField('Axis', 'axisDatumId', axes, referenceByRole.axis || axes[0]?.id) +
      selectField('Direction', 'directionDatumId', axes, referenceByRole.direction || axes[0]?.id) +
      selectField('Second direction (optional)', 'directionDatumId2', [{ id: '', name: 'No second direction' }, ...axes], referenceByRole['direction-2'] || '') +
      field('Second direction count', 'count2', pattern?.definition?.count2 ?? 2) +
      selectField('Mirror plane', 'planeDatumId', planes, referenceByRole.plane || planes[0]?.id) +
      selectField('Curve path', 'pathSketchId', paths, referenceByRole.path || paths[0]?.id) +
      '<label>Distribution<select name="distribution">' + [['full', 'Full circle'], ['spacing', 'Equal spacing'], ['extent', 'Total extent'], ['equal', 'Equal on curve'], ['table', 'Table values']]
        .map(([id, name]) => '<option value="' + id + '"' + (id === (pattern?.definition?.distribution || (kind === 'circular' ? 'full' : 'spacing')) ? ' selected' : '') + '>' + name + '</option>').join('') + '</select></label>' +
      field('Linear spacing', 'spacing', pattern?.definition?.spacing ?? 10) +
      field('Linear extent', 'extent', pattern?.definition?.extent ?? 100) +
      field('Second direction spacing', 'spacing2', pattern?.definition?.spacing2 ?? 10) +
      field('Second direction extent', 'extent2', pattern?.definition?.extent2 ?? 100) +
      field('Total angle', 'totalAngle', pattern?.definition?.totalAngle ?? 360) +
      field('Spacing angle', 'spacingAngle', pattern?.definition?.spacingAngle ?? 30) +
      '<label>Orientation<select name="orientation">' + [['rotate', 'Rotate with axis'], ['preserve', 'Preserve source'], ['alternating', 'Alternating'], ['tangent', 'Path tangent'], ['fixed', 'Fixed on path']]
        .map(([id, name]) => '<option value="' + id + '"' + (id === (pattern?.definition?.orientation || 'rotate') ? ' selected' : '') + '>' + name + '</option>').join('') + '</select></label>' +
      field('Radial offset / step', 'radialOffset', pattern?.definition?.radialOffset ?? 0) +
      field('Axial offset / step', 'axialOffset', pattern?.definition?.axialOffset ?? 0) +
      field('Skipped indices', 'skippedIndices', (pattern?.skippedIndices || []).join(','), { wide: true }) +
      textareaField('Table positions/angles/curve parameters — one per generated instance', 'tableValues', formatPointRows((pattern?.definition?.positions || pattern?.definition?.angles || pattern?.definition?.parameters || []).map((value) => [value]))) +
      textareaField('Second direction table positions', 'tableValues2', formatPointRows((pattern?.definition?.positions2 || []).map((value) => [value]))) +
      '<label class="is-wide"><input type="checkbox" name="symmetric"' + (pattern?.definition?.symmetric ? ' checked' : '') + ' /> Symmetric distribution</label>' +
      '<label class="is-wide"><input type="checkbox" name="symmetric2"' + (pattern?.definition?.symmetric2 ? ' checked' : '') + ' /> Symmetric second direction</label>';
    const kindControl = v5Fields.querySelector('[name="patternKind"]');
    const distributionControl = v5Fields.querySelector('[name="distribution"]');
    const orientationControl = v5Fields.querySelector('[name="orientation"]');
    const syncPatternPolicies = (force = false) => {
      const policies = {
        circular: { distributions: ['full', 'spacing', 'extent', 'table'], distribution: 'full', orientations: ['rotate', 'preserve', 'alternating'], orientation: 'rotate' },
        linear: { distributions: ['spacing', 'extent', 'table'], distribution: 'spacing', orientations: ['preserve', 'alternating'], orientation: 'preserve' },
        curve: { distributions: ['equal', 'spacing', 'extent', 'table'], distribution: 'equal', orientations: ['tangent', 'fixed'], orientation: 'tangent' },
        mirror: { distributions: ['full'], distribution: 'full', orientations: ['preserve'], orientation: 'preserve' },
      }[kindControl.value];
      if (force || !policies.distributions.includes(distributionControl.value)) distributionControl.value = policies.distribution;
      if (force || !policies.orientations.includes(orientationControl.value)) orientationControl.value = policies.orientation;
    };
    kindControl.addEventListener('change', () => syncPatternPolicies(true));
    syncPatternPolicies(false);
  }

  function bodyPatternFromForm(form) {
    const kind = form.elements.namedItem('patternKind').value;
    const tableValues = String(form.elements.namedItem('tableValues').value || '').split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean).map((entry) => /^-?\d+(?:\.\d+)?$/.test(entry) ? Number(entry) : entry);
    const tableValues2 = String(form.elements.namedItem('tableValues2').value || '').split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean).map((entry) => /^-?\d+(?:\.\d+)?$/.test(entry) ? Number(entry) : entry);
    const skippedIndices = String(form.elements.namedItem('skippedIndices').value || '').split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean).map(Number);
    const directions = [form.elements.namedItem('directionDatumId').value, form.elements.namedItem('directionDatumId2').value].filter(Boolean);
    return {
      name: form.elements.namedItem('name').value.trim(),
      sourceBodyId: form.elements.namedItem('sourceBodyId').value,
      kind,
      outputMode: form.elements.namedItem('outputMode').value,
      count: form.elements.namedItem('count').value,
      distribution: form.elements.namedItem('distribution').value,
      symmetric: form.elements.namedItem('symmetric').checked,
      orientation: form.elements.namedItem('orientation').value,
      skippedIndices,
      directionDatumIds: directions,
      count2: form.elements.namedItem('count2').value,
      distribution2: form.elements.namedItem('distribution').value === 'table' ? 'table' : form.elements.namedItem('distribution').value,
      symmetric2: form.elements.namedItem('symmetric2').checked,
      spacing2: form.elements.namedItem('spacing2').value,
      extent2: form.elements.namedItem('extent2').value,
      positions2: tableValues2,
      axisDatumId: form.elements.namedItem('axisDatumId').value,
      planeDatumId: form.elements.namedItem('planeDatumId').value,
      pathSketchId: form.elements.namedItem('pathSketchId').value,
      spacing: form.elements.namedItem('spacing').value,
      extent: form.elements.namedItem('extent').value,
      totalAngle: form.elements.namedItem('totalAngle').value,
      spacingAngle: form.elements.namedItem('spacingAngle').value,
      radialOffset: form.elements.namedItem('radialOffset').value,
      axialOffset: form.elements.namedItem('axialOffset').value,
      ...(kind === 'linear' ? { positions: tableValues } : kind === 'circular' ? { angles: tableValues } : { parameters: tableValues }),
    };
  }

  function assemblyDefinitionOptions(candidate) {
    const rootAssemblyId = candidate.rootDocument?.kind === 'assembly' ? candidate.rootDocument.assemblyId : null;
    return [
      ...candidate.partDefinitions.map((part) => ({ id: 'part:' + part.id, name: 'Part · ' + part.name })),
      ...candidate.assemblyDefinitions.filter((assembly) => assembly.id !== rootAssemblyId).map((assembly) => ({ id: 'assembly:' + assembly.id, name: 'Subassembly · ' + assembly.name })),
    ];
  }

  function documentReferenceFromOption(value) {
    const [kind, id] = String(value || '').split(':');
    if (kind === 'part') return { kind, partId: id };
    if (kind === 'assembly') return { kind, assemblyId: id };
    throw new Error('Choose a reusable part or subassembly definition.');
  }

  function assemblyReferenceOptions(candidate) {
    const assembly = v5RuntimeTools.studioV5RootAssembly(candidate);
    const options = [];
    for (const occurrence of assembly.occurrences) {
      options.push({ id: occurrence.id + '|', name: occurrence.name + ' · component origin' });
      if (occurrence.definition.kind !== 'part') continue;
      const part = candidate.partDefinitions.find((entry) => entry.id === occurrence.definition.partId);
      for (const datum of part?.referenceGeometry || []) options.push({ id: occurrence.id + '|' + datum.id, name: occurrence.name + ' · ' + datum.name + ' (' + datum.kind + ')' });
      const results = lastBodyResults.filter((entry) => entry.occurrenceInstance?.occurrencePath?.length === 1 && entry.occurrenceInstance.occurrencePath[0] === occurrence.id);
      for (const result of results) {
        const faces = [...faceByHash.values()].filter((entry) => entry.bodyId === result.bodyId);
        faces.forEach((face, index) => options.push({
          id: occurrence.id + '|body:' + result.sourceBodyId + ':face:' + index,
          name: occurrence.name + ' · ' + result.bodyName.split(' / ').at(-1) + ' planar face ' + (index + 1),
          reference: {
            ownerKind: 'body', ownerId: result.sourceBodyId, occurrencePath: [occurrence.id],
            semanticPath: { topologyKind: 'planar-face', bodyId: result.sourceBodyId },
            signature: { ...face.sig, topologyKind: 'planar-face' },
          },
        }));
      }
    }
    return options;
  }

  function assemblyGeometryReference(value, role) {
    const topology = v5Dialog.__assemblyReferences?.find((entry) => entry.id === value)?.reference;
    if (topology) return { ...structuredClone(topology), semanticPath: { ...(topology.semanticPath || {}), role } };
    const [occurrenceId, ownerId] = String(value || '').split('|');
    if (!occurrenceId) throw new Error('Choose a component reference.');
    return ownerId
      ? { ownerKind: 'datum', ownerId, occurrencePath: [occurrenceId], semanticPath: { role }, signature: { role } }
      : { ownerKind: 'occurrence', ownerId: occurrenceId, occurrencePath: [occurrenceId], semanticPath: { role }, signature: { role } };
  }

  function parseParameterOverrides(value) {
    const overrides = {};
    for (const [index, row] of String(value || '').split(/\r?\n/).entries()) {
      const line = row.trim();
      if (!line) continue;
      const separator = line.indexOf('=');
      if (separator <= 0 || !line.slice(separator + 1).trim()) throw new Error('Variant row ' + (index + 1) + ' must use name = expression.');
      const name = line.slice(0, separator).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Variant parameter "' + name + '" is invalid.');
      overrides[name] = line.slice(separator + 1).trim();
    }
    return overrides;
  }

  function openAssemblyCommand(command, mateKind = null, mateId = null) {
    if (!v5Dialog || !v5Fields || !v5RuntimeTools.isStudioV5Project(doc)) return;
    const candidate = v5RuntimeTools.decorateStudioV5Project(v5RuntimeTools.canonicalStudioV5Project(doc));
    const isCreate = command === 'create';
    if (isCreate && candidate.rootDocument?.kind !== 'part') return say('Create Assembly starts from the active part.');
    if (!isCreate && candidate.rootDocument?.kind !== 'assembly') return say('Open or create an assembly before using this command.');
    const assembly = !isCreate ? v5RuntimeTools.studioV5RootAssembly(candidate) : null;
    const editedMate = mateId ? assembly?.mates.find((entry) => entry.id === mateId) : null;
    const selectedOccurrence = assembly?.occurrences.find((entry) => entry.id === selectedOccurrenceId);
    const definitions = assemblyDefinitionOptions(candidate);
    const occurrences = assembly?.occurrences || [];
    v5Dialog.dataset.command = 'assembly-' + command;
    v5Dialog.dataset.mateKind = mateKind || '';
    v5Dialog.dataset.mateId = mateId || '';
    v5Dialog.dataset.occurrenceId = selectedOccurrence?.id || '';
    v5Dialog.dataset.datumId = '';
    v5Dialog.dataset.featureId = '';
    v5Dialog.dataset.sketchId = '';
    v5Dialog.dataset.patternId = '';
    $('bw-v5-command-kind').textContent = command === 'mate' ? 'Assembly constraint' : command === 'pattern' ? 'Linked component occurrences' : 'Assembly structure';
    $('bw-v5-command-title').textContent = command === 'create' ? 'Create assembly from this part'
      : command === 'insert' ? 'Insert reusable component'
      : command === 'linked' ? 'Create linked duplicate'
      : command === 'independent' ? 'Make component independent'
      : command === 'replace' ? 'Replace component definition'
      : command === 'variant' ? 'Edit component variant parameters'
      : command === 'transform' ? 'Move or rotate component occurrence'
      : command === 'pattern' ? 'Create component pattern'
      : ((editedMate ? 'Edit ' : '') + mateKind[0].toUpperCase() + mateKind.slice(1) + ' mate');
    v5Error.textContent = '';
    if (command === 'create') {
      const part = v5RuntimeTools.studioV5RootPart(candidate);
      v5Fields.innerHTML = field('Assembly name', 'name', part.name + ' assembly', { wide: true }) + field('First occurrence name', 'occurrenceName', part.name + ':1', { wide: true }) +
        '<label class="is-wide"><input type="checkbox" name="fixed" checked /> Fix first component at its current origin</label>';
    } else if (command === 'insert') {
      v5Fields.innerHTML = selectField('Definition', 'definition', definitions, definitions[0]?.id) + field('Occurrence name', 'name', 'Component:' + (occurrences.length + 1), { wide: true }) +
        field('X', 'x', 0) + field('Y', 'y', 0) + field('Z', 'z', 0) + '<label class="is-wide"><input type="checkbox" name="fixed" /> Fix at base transform</label>';
    } else if (command === 'linked') {
      if (!selectedOccurrence) return say('Select a direct component occurrence to duplicate.');
      v5Fields.innerHTML = field('Occurrence name', 'name', selectedOccurrence.name + ' linked', { wide: true }) +
        field('X', 'x', selectedOccurrence.baseTransform[12]) + field('Y', 'y', selectedOccurrence.baseTransform[13]) + field('Z', 'z', selectedOccurrence.baseTransform[14]);
    } else if (command === 'independent') {
      if (!selectedOccurrence || selectedOccurrence.definition.kind !== 'part') return say('Select a direct part occurrence to make independent.');
      const source = candidate.partDefinitions.find((entry) => entry.id === selectedOccurrence.definition.partId);
      v5Fields.innerHTML = field('Independent part name', 'name', source.name + ' independent', { wide: true });
    } else if (command === 'replace') {
      if (!selectedOccurrence) return say('Select a direct component occurrence to replace.');
      const current = selectedOccurrence.definition.kind + ':' + (selectedOccurrence.definition.partId || selectedOccurrence.definition.assemblyId);
      v5Fields.innerHTML = selectField('Replacement definition', 'definition', definitions, current);
    } else if (command === 'variant') {
      if (!selectedOccurrence || selectedOccurrence.definition.kind !== 'part') return say('Select a direct part occurrence to configure as a variant.');
      const part = candidate.partDefinitions.find((entry) => entry.id === selectedOccurrence.definition.partId);
      if (!part?.parameters?.length) return say('This component definition has no editable parameters.');
      const existing = selectedOccurrence.parameterOverrides || {};
      const rows = part.parameters.map((parameter) => parameter.name + ' = ' + (existing[parameter.name] ?? parameter.value));
      v5Fields.innerHTML = textareaField('Parameter overrides — one name = expression per line', 'parameterOverrides', rows.join('\n')) +
        '<p class="is-wide">Occurrences with the same overrides share one exact cached variant; other values remain independent.</p>';
    } else if (command === 'transform') {
      if (!selectedOccurrence) return say('Select a direct component occurrence to transform.');
      if (selectedOccurrence.fixed || assembly.mates.some((mate) => !mate.suppressed && mate.occurrenceIds.includes(selectedOccurrence.id))) {
        return say('Suppress the component’s driving mates or Fixed constraint before direct manipulation.');
      }
      v5Fields.innerHTML = '<label>Handle mode<select name="gizmoMode"><option value="translate">Translate</option><option value="rotate">Rotate</option></select></label>' +
        field('Snap', 'gizmoSnap', 1) + textareaField('Rigid 4×4 transform', 'matrix', selectedOccurrence.baseTransform.join(', '));
    } else if (command === 'pattern') {
      if (!selectedOccurrence) return say('Select a direct component occurrence to pattern.');
      v5Fields.innerHTML = field('Pattern name', 'name', selectedOccurrence.name + ' pattern', { wide: true }) +
        '<label>Type<select name="patternKind"><option value="circular">Circular</option><option value="linear">Linear</option></select></label>' +
        field('Generated count', 'generatedCount', 5) + field('Spacing', 'spacing', 25) + field('Total angle', 'totalAngle', 360);
    } else {
      const references = assemblyReferenceOptions(candidate);
      v5Dialog.__assemblyReferences = references;
      const moving = editedMate?.occurrenceIds.at(-1) || selectedOccurrence?.id || occurrences[1]?.id || occurrences[0]?.id;
      const anchor = editedMate?.occurrenceIds[0] || occurrences.find((entry) => entry.id !== moving)?.id || occurrences[0]?.id;
      const referenceFor = (occurrenceId) => references.find((entry) => entry.id.startsWith(occurrenceId + '|') && entry.id !== occurrenceId + '|')?.id || occurrenceId + '|';
      const storedReference = (index, fallback) => {
        const reference = editedMate?.references?.[index];
        if (!reference) return fallback;
        if (reference.ownerKind === 'body') {
          const matched = references.find((entry) => entry.reference?.ownerId === reference.ownerId && entry.reference.occurrencePath[0] === reference.occurrencePath[0] &&
            JSON.stringify(entry.reference.signature) === JSON.stringify(reference.signature));
          return matched?.id || fallback;
        }
        return reference.occurrencePath[0] + '|' + (reference.ownerKind === 'datum' ? reference.ownerId : '');
      };
      v5Fields.innerHTML = field('Mate name', 'name', editedMate?.name || mateKind[0].toUpperCase() + mateKind.slice(1) + ' mate', { wide: true }) +
        selectField('Anchor component', 'anchorOccurrenceId', occurrences, anchor) + selectField('Moving component', 'movingOccurrenceId', occurrences, moving) +
        selectField('Anchor reference', 'anchorReference', references, storedReference(0, referenceFor(anchor))) + selectField('Moving reference', 'movingReference', references, storedReference(1, referenceFor(moving))) +
        field(mateKind === 'angle' ? 'Angle' : 'Offset / distance', 'value', editedMate?.value ?? 0) + '<label class="is-wide"><input type="checkbox" name="flip"' + (editedMate?.extensions?.flip ? ' checked' : '') + ' /> Flip alignment direction</label>';
    }
    v5Dialog.__candidate = candidate;
    const usesGizmo = command === 'transform';
    v5Dialog.classList.toggle('with-gizmo', usesGizmo);
    if (usesGizmo && typeof v5Dialog.show === 'function') v5Dialog.show();
    else if (typeof v5Dialog.showModal === 'function') v5Dialog.showModal();
    else v5Dialog.setAttribute('open', '');
    if (usesGizmo && !beginAssemblyTransformPreview(selectedOccurrence)) {
      v5Fields.insertAdjacentHTML('beforeend', '<p class="is-wide">The exact component geometry is still rebuilding; reopen Move / rotate when it is visible.</p>');
    }
  }

  function applyAssemblyForm(candidate, command, mateKind, occurrenceId, mateId, form) {
    if (command === 'create') return v5RuntimeTools.createStudioV5AssemblyFromPart(candidate, {
      id: 'assembly-' + newId(), occurrenceId: 'occurrence-' + newId(), name: form.elements.namedItem('name').value.trim(),
      occurrenceName: form.elements.namedItem('occurrenceName').value.trim(), fixed: form.elements.namedItem('fixed').checked,
    });
    if (command === 'insert') return v5RuntimeTools.createStudioV5ComponentOccurrence(candidate, {
      id: 'occurrence-' + newId(), name: form.elements.namedItem('name').value.trim(),
      definition: documentReferenceFromOption(form.elements.namedItem('definition').value),
      baseTransform: v5AssemblyTools.studioV5TranslationMatrix(['x', 'y', 'z'].map((name) => Number(form.elements.namedItem(name).value))),
      fixed: form.elements.namedItem('fixed').checked,
    });
    if (command === 'linked') return v5RuntimeTools.duplicateStudioV5LinkedOccurrence(candidate, occurrenceId, {
      id: 'occurrence-' + newId(), name: form.elements.namedItem('name').value.trim(),
      baseTransform: v5AssemblyTools.studioV5TranslationMatrix(['x', 'y', 'z'].map((name) => Number(form.elements.namedItem(name).value))),
    });
    if (command === 'independent') return v5RuntimeTools.makeStudioV5OccurrenceIndependent(candidate, occurrenceId, {
      partId: 'part-independent-' + newId(), name: form.elements.namedItem('name').value.trim(),
    });
    if (command === 'replace') return v5RuntimeTools.replaceStudioV5ComponentOccurrence(candidate, occurrenceId, documentReferenceFromOption(form.elements.namedItem('definition').value));
    if (command === 'variant') return v5RuntimeTools.updateStudioV5ComponentOccurrence(candidate, occurrenceId, {
      parameterOverrides: parseParameterOverrides(form.elements.namedItem('parameterOverrides').value),
    });
    if (command === 'transform') {
      const matrix = String(form.elements.namedItem('matrix').value || '').split(/[\s,]+/).filter(Boolean).map(Number);
      if (matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value))) throw new Error('Component transform must contain 16 finite numbers.');
      return v5RuntimeTools.updateStudioV5ComponentOccurrence(candidate, occurrenceId, { baseTransform: matrix });
    }
    if (command === 'pattern') {
      const kind = form.elements.namedItem('patternKind').value;
      return v5RuntimeTools.createStudioV5OccurrencePattern(candidate, {
        id: 'occurrence-pattern-' + newId(), name: form.elements.namedItem('name').value.trim(), kind,
        sourceOccurrenceIds: [occurrenceId], generatedCount: Number(form.elements.namedItem('generatedCount').value),
        definition: kind === 'circular'
          ? { axis: [0, 0, 1], center: [0, 0, 0], totalAngle: form.elements.namedItem('totalAngle').value }
          : { direction: [0, 0, 1], spacing: form.elements.namedItem('spacing').value },
      });
    }
    const fixed = mateKind === 'fixed';
    const anchorId = form.elements.namedItem('anchorOccurrenceId').value;
    const movingId = form.elements.namedItem('movingOccurrenceId').value;
    const mateInput = {
      id: mateId || 'mate-' + newId(), name: form.elements.namedItem('name').value.trim(), kind: mateKind,
      occurrenceIds: fixed ? [movingId] : [anchorId, movingId],
      references: fixed ? [] : [assemblyGeometryReference(form.elements.namedItem('anchorReference').value, 'anchor'), assemblyGeometryReference(form.elements.namedItem('movingReference').value, 'moving')],
      ...(['distance', 'angle', 'coincident', 'concentric', 'tangent'].includes(mateKind) ? { value: form.elements.namedItem('value').value } : {}),
      extensions: { flip: form.elements.namedItem('flip').checked },
    };
    return mateId ? v5RuntimeTools.updateStudioV5AssemblyMate(candidate, mateId, mateInput) : v5RuntimeTools.createStudioV5AssemblyMate(candidate, mateInput);
  }

  function inspectionResultsForSelection() {
    if (exportBodyIds.size) return lastBodyResults.filter((entry) => exportBodyIds.has(entry.bodyId));
    if (selectedOccurrenceId) {
      const assembly = v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly' ? v5RuntimeTools.studioV5RootAssembly(doc) : null;
      const direct = assembly?.occurrences.some((entry) => entry.id === selectedOccurrenceId);
      return lastBodyResults.filter((entry) => direct
        ? entry.occurrenceInstance?.occurrencePath?.[0] === selectedOccurrenceId
        : entry.occurrenceInstance?.occurrenceId === selectedOccurrenceId);
    }
    if (selectedBodyId) return lastBodyResults.filter((entry) => entry.bodyId === selectedBodyId);
    return [];
  }

  function openInspectionCommand(command) {
    if (!v5Dialog || !v5Fields || !v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'assembly') return say('Inspection authoring requires an assembly document.');
    let candidate = v5RuntimeTools.decorateStudioV5Project(v5RuntimeTools.canonicalStudioV5Project(doc));
    const assembly = v5RuntimeTools.studioV5RootAssembly(candidate);
    const selectedOccurrence = assembly.occurrences.find((entry) => entry.id === selectedOccurrenceId);
    v5Dialog.dataset.command = 'inspection-' + command;
    v5Dialog.dataset.occurrenceId = selectedOccurrence?.id || '';
    v5Dialog.dataset.mateKind = '';
    v5Dialog.dataset.mateId = '';
    v5Dialog.dataset.datumId = '';
    v5Dialog.dataset.featureId = '';
    v5Dialog.dataset.sketchId = '';
    v5Dialog.dataset.patternId = '';
    v5Dialog.dataset.bodyId = '';
    $('bw-v5-command-kind').textContent = command === 'material' ? 'Engineering appearance' : command === 'stage' ? 'Axial model structure' : command === 'measure' ? 'Persistent exact measurement' : 'Display-only assembly view';
    $('bw-v5-command-title').textContent = command === 'section' ? 'Save non-destructive section'
      : command === 'explode' ? 'Save exploded view step'
      : command === 'stage' ? 'Create axial stage group'
      : command === 'measure' ? 'Save measurement'
      : 'Assign material and appearance';
    v5Error.textContent = '';
    if (command === 'section') {
      v5Fields.innerHTML = field('Section name', 'name', 'Longitudinal half section', { wide: true }) +
        '<label>Mode<select name="sectionKind"><option value="plane">Single plane</option><option value="quarter">Quarter section</option><option value="box">Three-plane box</option></select></label>' +
        field('Offset', 'offset', 0) + field('Scope occurrence ID (blank = all)', 'scopeOccurrenceId', selectedOccurrence?.id || '', { wide: true }) +
        '<label><input type="checkbox" name="cap" checked /> Section cap</label><label><input type="checkbox" name="reverse" /> Reverse</label>' +
        field('Hatch spacing', 'hatchSpacing', 8) + field('Hatch angle', 'hatchAngle', 45) + field('Cap fill', 'capFillColor', '#d7e0e5') + field('Hatch color', 'hatchColor', '#243746');
    } else if (command === 'explode') {
      if (!selectedOccurrence) return say('Select a direct component occurrence to explode.');
      v5Fields.innerHTML = field('View name', 'name', 'Service exploded view', { wide: true }) +
        field('Translate X', 'x', 0) + field('Translate Y', 'y', 0) + field('Translate Z', 'z', 40);
    } else if (command === 'stage') {
      const distances = assembly.mates.filter((mate) => mate.kind === 'distance');
      const occurrenceIds = distances.map((mate) => mate.occurrenceIds.at(-1));
      if (!distances.length) return say('Create Distance mates before grouping axial stages.');
      const firstStation = Number(distances[0].value);
      const secondStation = Number(distances[1]?.value);
      const numericStart = Number.isFinite(firstStation) ? firstStation : 0;
      const numericSpacing = Number.isFinite(secondStation) ? secondStation - numericStart : 25;
      v5Fields.innerHTML = field('Group name', 'name', 'Axial engine stages', { wide: true }) +
        textareaField('Ordered occurrence IDs', 'occurrenceIds', occurrenceIds.join('\n')) + textareaField('Matching Distance mate IDs', 'distanceMateIds', distances.map((mate) => mate.id).join('\n')) +
        field('First station', 'start', numericStart) + field('Stage spacing', 'spacing', numericSpacing) +
        '<label class="is-wide"><input type="checkbox" name="visible" checked /> Show every stage in this group</label>';
    } else if (command === 'measure') {
      const selected = inspectionResultsForSelection();
      if (!selected.length) return say('Select a body or component before saving a measurement.');
      const bodyIds = selected.map((entry) => entry.bodyId);
      const defaultKind = bodyIds.length === 2 ? 'minimum-clearance' : 'bounding-box';
      v5Fields.innerHTML = field('Measurement name', 'name', defaultKind === 'minimum-clearance' ? 'Component clearance' : 'Body envelope', { wide: true }) +
        '<label>Type<select name="measurementKind"><option value="bounding-box"' + (defaultKind === 'bounding-box' ? ' selected' : '') + '>Bounding box</option><option value="minimum-clearance"' + (defaultKind === 'minimum-clearance' ? ' selected' : '') + '>Minimum clearance</option></select></label>' +
        textareaField('Exact runtime body IDs', 'bodyIds', bodyIds.join('\n'));
    } else if (command === 'material') {
      candidate = v5InspectionTools.ensureStudioV5GenericMaterials(candidate);
      const result = inspectionResultsForSelection()[0];
      const partId = result?.occurrenceInstance?.definition?.partId || (candidate.rootDocument?.kind === 'part' ? candidate.rootDocument.partId : null);
      const sourceBodyId = result?.sourceBodyId || result?.bodyId;
      if (!partId || !sourceBodyId) return say('Select a component body before assigning a material.');
      v5Dialog.dataset.partId = partId;
      v5Dialog.dataset.sourceBodyId = sourceBodyId;
      v5Fields.innerHTML = selectField('Generic editable material', 'materialId', candidate.materials, candidate.materials[0]?.id, true) +
        '<p class="is-wide">Density drives exact mass properties. Generic values remain explicitly editable placeholders.</p>';
    }
    v5Dialog.__candidate = candidate;
    if (typeof v5Dialog.showModal === 'function') v5Dialog.showModal();
    else v5Dialog.setAttribute('open', '');
  }

  function applyInspectionForm(candidate, command, occurrenceId, form) {
    if (command === 'section') {
      const kind = form.elements.namedItem('sectionKind').value;
      const offset = Number(form.elements.namedItem('offset').value);
      const normals = kind === 'plane' ? [[1, 0, 0]] : kind === 'quarter' ? [[1, 0, 0], [0, 1, 0]] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      const scope = form.elements.namedItem('scopeOccurrenceId').value.trim();
      return v5InspectionTools.createStudioV5SectionView(candidate, {
        id: 'section-' + newId(), name: form.elements.namedItem('name').value.trim(), kind,
        definition: {
          planes: normals.map((normal) => ({ normal, offset })), cap: form.elements.namedItem('cap').checked, reverse: form.elements.namedItem('reverse').checked, scopeOccurrenceIds: scope ? [scope] : [],
          hatch: { enabled: true, spacing: Number(form.elements.namedItem('hatchSpacing').value), angle: Number(form.elements.namedItem('hatchAngle').value), fillColor: form.elements.namedItem('capFillColor').value, color: form.elements.namedItem('hatchColor').value },
        },
      });
    }
    if (command === 'explode') return v5InspectionTools.createStudioV5ExplodedView(candidate, {
      id: 'exploded-' + newId(), name: form.elements.namedItem('name').value.trim(),
      steps: [{ occurrenceIds: [occurrenceId], translation: ['x', 'y', 'z'].map((name) => Number(form.elements.namedItem(name).value)) }],
    });
    if (command === 'stage') {
      const ids = (name) => form.elements.namedItem(name).value.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
      return v5InspectionTools.createStudioV5AxialStageGroup(candidate, {
        id: 'stage-group-' + newId(), name: form.elements.namedItem('name').value.trim(), axis: [0, 0, 1],
        occurrenceIds: ids('occurrenceIds'), distanceMateIds: ids('distanceMateIds'),
        start: Number(form.elements.namedItem('start').value), spacing: Number(form.elements.namedItem('spacing').value), visible: form.elements.namedItem('visible').checked,
      });
    }
    if (command === 'measure') {
      const bodyIds = form.elements.namedItem('bodyIds').value.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
      return v5InspectionTools.createStudioV5Measurement(candidate, {
        id: 'measurement-' + newId(), name: form.elements.namedItem('name').value.trim(),
        kind: form.elements.namedItem('measurementKind').value, definition: { bodyIds },
      });
    }
    if (command === 'material') {
      const materialId = form.elements.namedItem('materialId').value;
      let next = v5InspectionTools.assignStudioV5BodyMaterial(candidate, v5Dialog.dataset.partId, v5Dialog.dataset.sourceBodyId, materialId);
      const material = next.materials.find((entry) => entry.id === materialId);
      if (occurrenceId && material?.appearanceId) next = v5InspectionTools.assignStudioV5OccurrenceAppearance(next, occurrenceId, material.appearanceId);
      return next;
    }
    throw new Error('Unsupported inspection command.');
  }

  function closeV5Command() {
    endTransformPreview();
    v5Dialog?.classList.remove('with-gizmo');
    if (typeof v5Dialog?.close === 'function' && v5Dialog.open) v5Dialog.close();
    else v5Dialog?.removeAttribute('open');
  }

  function openV5Command(command, datumId = null, featureId = null, sketchId = null, patternId = null) {
    if (!v5Dialog || !v5Fields) return;
    if (v5Dialog.open) closeV5Command();
    let candidate;
    try { candidate = ensureOriginDatums(v5PartCandidate()); }
    catch (error) { return say(String(error?.message || error)); }
    const part = v5RuntimeTools.studioV5RootPart(candidate);
    const feature = featureId ? part.features.find((entry) => entry.id === featureId && (
      entry.type === 'transform' || entry.type === 'loft' || entry.type === 'sweep' ||
      (entry.type === 'revolve' && entry.profileSketchId) || entry.type === 'draft' || entry.type === 'thicken' ||
      (entry.type === 'fillet' && Array.isArray(entry.variableRadii))
    )) : null;
    const datum = datumId ? part.referenceGeometry.find((entry) => entry.id === datumId) : null;
    const sketch = sketchId ? part.sketches.find((entry) => entry.id === sketchId) : null;
    const pattern = patternId ? (part.bodyPatterns || []).find((entry) => entry.id === patternId) : null;
    const transformCommands = new Set(['move', 'copy', 'rotate', 'mirror', 'scale', 'align']);
    const modifierCommands = new Set(['draft', 'thicken', 'variable-fillet']);
    if (transformCommands.has(command) && !feature && !part.bodies.some((body) => body.id === selectedBodyId)) return say('Select a body before using a transform command.');
    if (modifierCommands.has(command) && !feature && !part.bodies.some((body) => body.id === selectedBodyId)) return say('Select a body before using this advanced modifier.');
    if (command === 'split' && !part.bodies.some((body) => body.id === selectedBodyId)) return say('Select a target body before using Boolean Split.');
    if (command === 'split' && part.bodies.filter((body) => !body.suppressed).length < 2) return say('Boolean Split requires a separate exact tool body.');
    if (command === 'pattern' && !pattern && !part.bodies.some((body) => body.id === selectedBodyId)) return say('Select a source body before creating a pattern.');
    v5Dialog.dataset.command = command;
    v5Dialog.dataset.datumId = datumId || '';
    v5Dialog.dataset.featureId = featureId || '';
    v5Dialog.dataset.sketchId = sketchId || '';
    v5Dialog.dataset.patternId = patternId || '';
    v5Dialog.dataset.occurrenceId = '';
    v5Dialog.dataset.mateKind = '';
    v5Dialog.dataset.mateId = '';
    v5Dialog.dataset.bodyId = feature?.sourceBodyId || feature?.resultPolicy?.targetBodyIds?.[0] || selectedBodyId || '';
    $('bw-v5-command-kind').textContent = command === 'plane' ? 'Reference geometry' : command === 'profile' || command === 'path' ? 'Editable sketch geometry' : command === 'loft' || command === 'sweep' || command === 'revolve-advanced' || modifierCommands.has(command) ? 'Advanced shape' : command === 'pattern' ? 'Linked body occurrences' : command === 'split' ? 'Boolean body operation' : 'Body transform';
    $('bw-v5-command-title').textContent = command === 'plane'
      ? (datum ? 'Edit ' + datum.name : 'Construction plane')
      : command === 'profile' || command === 'path'
        ? (sketch ? 'Edit ' + sketch.name : 'Create ' + command)
        : command === 'loft' || command === 'sweep' || command === 'revolve-advanced' || modifierCommands.has(command)
          ? (feature ? 'Edit ' + feature.name : 'Create ' + command)
          : command === 'split' ? 'Split body with another body'
          : command === 'pattern'
            ? (pattern ? 'Edit ' + pattern.name : 'Create body pattern')
          : (command[0].toUpperCase() + command.slice(1) + ' body');
    v5Error.textContent = '';
    if (command === 'plane') renderPlaneCommandFields(candidate, datum);
    else if (command === 'profile' || command === 'path') renderSketchCommandFields(candidate, command, sketch);
    else if (command === 'loft' || command === 'sweep') renderAdvancedShapeFields(candidate, command, feature);
    else if (command === 'revolve-advanced' || modifierCommands.has(command)) renderAdvancedModifierFields(candidate, command, feature);
    else if (command === 'pattern') renderBodyPatternFields(candidate, pattern);
    else if (command === 'split') renderBooleanSplitFields(candidate);
    else renderTransformCommandFields(candidate, command, feature);
    v5Dialog.__candidate = candidate;
    const usesGizmo = ['move', 'copy', 'rotate'].includes(command);
    v5Dialog.classList.toggle('with-gizmo', usesGizmo);
    if (usesGizmo && typeof v5Dialog.show === 'function') v5Dialog.show();
    else if (typeof v5Dialog.showModal === 'function') v5Dialog.showModal();
    else v5Dialog.setAttribute('open', '');
    if (usesGizmo && !beginTransformPreview(command, feature)) {
      v5Fields.insertAdjacentHTML('beforeend', '<p class="is-wide">The exact numeric controls remain available while this body is rebuilding.</p>');
    }
  }

  $('bw-v5-command-cancel')?.addEventListener('click', closeV5Command);
  v5Dialog?.addEventListener('cancel', (event) => { event.preventDefault(); closeV5Command(); });
  $('bw-v5-command-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const command = v5Dialog.dataset.command;
    const datumId = v5Dialog.dataset.datumId || null;
    const featureId = v5Dialog.dataset.featureId || null;
    const sketchId = v5Dialog.dataset.sketchId || null;
    const patternId = v5Dialog.dataset.patternId || null;
    const occurrenceId = v5Dialog.dataset.occurrenceId || null;
    const mateKind = v5Dialog.dataset.mateKind || null;
    const mateId = v5Dialog.dataset.mateId || null;
    const bodyId = v5Dialog.dataset.bodyId;
    const sourceRevision = documentRevision;
    const sourceHash = v5RuntimeTools.isStudioV5Project(doc) ? v5RuntimeTools.studioV5CanonicalHash(doc) : JSON.stringify(doc);
    let candidate = v5Dialog.__candidate;
    try {
      if (command.startsWith('assembly-')) {
        candidate = applyAssemblyForm(candidate, command.slice('assembly-'.length), mateKind, occurrenceId, mateId, form);
      } else if (command.startsWith('inspection-')) {
        candidate = applyInspectionForm(candidate, command.slice('inspection-'.length), occurrenceId, form);
      } else if (command === 'plane') {
        const definition = planeDefinitionFromForm(form);
        const name = form.elements.namedItem('name').value.trim();
        candidate = datumId
          ? v5RuntimeTools.updateStudioV5Datum(candidate, datumId, { name, definition })
          : v5RuntimeTools.createStudioV5Datum(candidate, { id: 'datum-' + newId(), name, kind: 'plane', definition });
      } else if (command === 'profile' || command === 'path') {
        const patch = {
          name: form.elements.namedItem('name').value.trim(), kind: form.elements.namedItem('curveKind').value,
          points: parsePointRows(form.elements.namedItem('points').value, command === 'profile' ? 2 : 3, command === 'profile' ? 'Profile' : 'Path'),
          ...(command === 'profile' ? { planeDatumId: form.elements.namedItem('planeDatumId').value } : {}),
        };
        candidate = sketchId
          ? v5RuntimeTools.updateStudioV5AdvancedSketch(candidate, sketchId, patch)
          : command === 'profile'
            ? v5RuntimeTools.createStudioV5ProfileSketch(candidate, { id: 'sketch-profile-' + newId(), ...patch })
            : v5RuntimeTools.createStudioV5PathSketch(candidate, { id: 'sketch-path-' + newId(), ...patch });
      } else if (command === 'loft' || command === 'sweep') {
        const patch = advancedFeatureFromForm(form, command);
        candidate = featureId
          ? v5RuntimeTools.updateStudioV5AdvancedFeature(candidate, featureId, patch)
          : command === 'loft'
            ? v5RuntimeTools.createStudioV5LoftFeature(candidate, { id: 'feature-loft-' + newId(), ...patch, bodyName: patch.name })
            : v5RuntimeTools.createStudioV5SweepFeature(candidate, { id: 'feature-sweep-' + newId(), ...patch, bodyName: patch.name });
      } else if (command === 'revolve-advanced') {
        const patch = {
          name: form.elements.namedItem('name').value.trim(), profileSketchId: form.elements.namedItem('profileSketchId').value,
          axisDatumId: form.elements.namedItem('axisDatumId').value, angle: formNumber(form, 'angle'),
          startAngle: formNumber(form, 'startAngle'), symmetric: form.elements.namedItem('symmetric').checked,
        };
        candidate = featureId
          ? v5RuntimeTools.updateStudioV5AdvancedFeature(candidate, featureId, patch)
          : v5RuntimeTools.createStudioV5RevolveFeature(candidate, { id: 'feature-revolve-' + newId(), ...patch, bodyName: patch.name });
      } else if (command === 'draft' || command === 'thicken' || command === 'variable-fillet') {
        const patch = advancedModifierFromForm(form, command);
        candidate = featureId
          ? v5RuntimeTools.updateStudioV5AdvancedFeature(candidate, featureId, patch)
          : command === 'draft'
            ? v5RuntimeTools.createStudioV5DraftFeature(candidate, { id: 'feature-draft-' + newId(), ...patch })
            : command === 'thicken'
              ? v5RuntimeTools.createStudioV5ThickenFeature(candidate, { id: 'feature-thicken-' + newId(), ...patch })
              : v5RuntimeTools.createStudioV5VariableFilletFeature(candidate, { id: 'feature-variable-fillet-' + newId(), ...patch });
      } else if (command === 'split') {
        candidate = v5RuntimeTools.createStudioV5BooleanSplit(candidate, {
          id: 'split-' + newId(), name: form.elements.namedItem('name').value.trim(),
          targetBodyId: form.elements.namedItem('targetBodyId').value, toolBodyId: form.elements.namedItem('toolBodyId').value,
          keepOriginal: form.elements.namedItem('keepOriginal').checked, keepTools: form.elements.namedItem('keepTools').checked,
        });
      } else if (command === 'pattern') {
        const patch = bodyPatternFromForm(form);
        candidate = patternId
          ? v5RuntimeTools.updateStudioV5BodyPattern(candidate, patternId, patch)
          : v5RuntimeTools.createStudioV5BodyPattern(candidate, { id: 'pattern-' + newId(), ...patch });
      } else {
        const transform = transformFromForm(form, command);
        if (featureId) candidate = v5RuntimeTools.updateStudioV5TransformFeature(candidate, featureId, { transform });
        else candidate = v5RuntimeTools.createStudioV5TransformFeature(candidate, {
          id: 'transform-' + newId(), bodyId, mode: command, transform,
          copy: command === 'copy',
          moveOriginal: form.elements.namedItem('moveOriginal')?.checked === true,
        });
      }
      const validation = await kernelCall('validate-v5', documentRevision, { document: candidate });
      const currentHash = v5RuntimeTools.isStudioV5Project(doc) ? v5RuntimeTools.studioV5CanonicalHash(doc) : JSON.stringify(doc);
      if (documentRevision !== sourceRevision || currentHash !== sourceHash) throw new Error('The project changed during preview. Reopen the command on the current revision.');
      if (validation.errors?.length) throw new Error(validation.errors[0].message);
      const subject = command.startsWith('assembly-') ? command.slice('assembly-'.length).replace('-', ' ')
        : command.startsWith('inspection-') ? command.slice('inspection-'.length).replace('-', ' ')
        : command === 'plane' ? 'construction plane' : command === 'profile' || command === 'path' ? command + ' sketch' : command === 'loft' || command === 'sweep' || command === 'revolve-advanced' || command === 'draft' || command === 'thicken' || command === 'variable-fillet' ? command + ' feature' : command === 'pattern' ? 'body pattern' : command === 'split' ? 'Boolean Split' : command + ' transform';
      commit((featureId || datumId || sketchId || patternId || mateId ? 'Edit ' : 'Create ') + subject, () => candidate);
      closeV5Command();
    } catch (error) {
      v5Error.textContent = String(error?.message || error);
    }
  });

  document.querySelectorAll('[data-v5-command]').forEach((button) => button.addEventListener('click', () => openV5Command(button.dataset.v5Command)));
  document.querySelectorAll('[data-assembly-command]').forEach((button) => button.addEventListener('click', () => {
    const command = button.dataset.assemblyCommand;
    try {
      if (command === 'edit-context') {
        if (!selectedOccurrenceId) return say('Select a direct part component to edit in context.');
        return commit('Edit component in assembly context', () => v5RuntimeTools.enterStudioV5AssemblyContext(doc, selectedOccurrenceId));
      }
      if (command === 'exit-context') return commit('Return to assembly', () => v5RuntimeTools.exitStudioV5AssemblyContext(doc));
      openAssemblyCommand(command);
    } catch (error) { say(String(error?.message || error)); }
  }));
  document.querySelectorAll('[data-assembly-mate]').forEach((button) => button.addEventListener('click', () => openAssemblyCommand('mate', button.dataset.assemblyMate)));

  async function runV5Inspection(inspectionMode) {
    if (!v5RuntimeTools.isStudioV5Project(doc)) return say('Engineering inspection requires a schema-5 project.');
    const selected = inspectionMode === 'measurements' ? [] : inspectionResultsForSelection().map((entry) => entry.bodyId);
    if (inspectionMode === 'clearance' && selected.length !== 2) return say('Select exactly two bodies or one two-body subassembly for clearance.');
    const sourceRevision = documentRevision;
    const sourceHash = v5RuntimeTools.studioV5CanonicalHash(doc);
    try {
      const options = {
        mode: inspectionMode,
        ...((inspectionMode === 'interference' && selected.length === 0) || inspectionMode === 'measurements' ? {} : { bodyIds: selected }),
        ...(inspectionMode === 'clearance' ? { pairBodyIds: selected } : {}),
      };
      const response = await kernelCall('inspect-v5', documentRevision, options);
      if (sourceRevision !== documentRevision || sourceHash !== v5RuntimeTools.studioV5CanonicalHash(doc)) return say('Inspection became stale after the project changed. Run it again.');
      if (!response.inspection) return say('Inspection failed: ' + (response.errors?.[0]?.message || 'No inspection result was produced.'));
      lastInspection = { ...response.inspection, errors: response.errors || [] };
      renderContext();
      if (response.errors?.length) return say('Inspection needs review: ' + response.errors[0].message);
      const count = lastInspection.bodyCount;
      const interferenceCount = lastInspection.pairs.filter((pair) => pair.interferenceVolumeMm3 > 1e-8).length;
      say(inspectionMode === 'interference' ? interferenceCount + ' interfering pair' + (interferenceCount === 1 ? '' : 's') + ' found.' : inspectionMode === 'clearance' ? 'Exact minimum clearance calculated.' : inspectionMode === 'measurements' ? lastInspection.measurementResults.length + ' saved measurement' + (lastInspection.measurementResults.length === 1 ? '' : 's') + ' evaluated.' : 'Mass and health updated for ' + count + ' bod' + (count === 1 ? 'y.' : 'ies.'));
    } catch (error) { say('Inspection failed: ' + String(error?.message || error)); }
  }

  document.querySelectorAll('[data-inspection-command]').forEach((button) => button.addEventListener('click', () => {
    const command = button.dataset.inspectionCommand;
    if (['section', 'explode', 'stage', 'material', 'measure'].includes(command)) openInspectionCommand(command);
    else runV5Inspection(command);
  }));
  document.querySelectorAll('[data-display-mode]').forEach((button) => button.addEventListener('click', () => {
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'assembly') return say('Assembly display modes require an assembly document.');
    const displayMode = button.dataset.displayMode;
    commit('Set ' + displayMode + ' display', () => v5InspectionTools.setStudioV5DisplayMode(doc, displayMode));
  }));

  let preRenderedAssemblyTreeReuseCount = 0;
  function assemblyTreeResultFingerprint() {
    const trace = lastEvaluationTrace || {};
    return JSON.stringify({
      bodies: lastBodyResults.map((entry) => ({
        id: entry.bodyId,
        name: entry.bodyName,
        visible: entry.visible,
        suppressed: entry.suppressed,
        occurrenceId: entry.occurrenceInstance?.occurrenceId || null,
        occurrencePath: entry.occurrenceInstance?.occurrencePath || null,
      })).sort((left, right) => left.id.localeCompare(right.id)),
      featureErrors: [...buildErrors].sort(([left], [right]) => left.localeCompare(right)),
      bodyErrors: [...bodyBuildErrors].sort(([left], [right]) => left.localeCompare(right)),
      solverState: trace.solverState || null,
      degreesOfFreedom: trace.degreesOfFreedom || null,
      conflicts: trace.conflicts || null,
    });
  }

  async function rebuild(options = {}) {
    const revision = ++documentRevision;
    const previousAssemblyTreeResult = assemblyTreeResultFingerprint();
    latestRequestedRevision = revision;
    if (mode.kind === 'idle' || mode.kind === 'rebuilding') setMode({ kind: 'rebuilding' });
    if (!doc.features.length && !(v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly')) {
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
      // OpenCascade's Emscripten allocator cannot return grown linear-memory
      // pages to the browser. Recreate the isolated worker at a bounded edit
      // interval so transient preview/rebuild peaks do not become retained
      // process memory. The committed document and GPU template cache remain
      // authoritative; the replacement worker performs an ordinary cold
      // rebuild and preserves selections/history.
      if (v5RuntimeTools.isStudioV5Project(doc)
        && successfulV5Rebuilds >= KERNEL_COMPACTION_REBUILD_INTERVAL
        && kernelWorker
        && kernelPending.size === 0) {
        kernelWorker.terminate();
        kernelWorker = null;
        kernelReady = null;
        successfulV5Rebuilds = 0;
        kernelRestartCount++;
      }
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
    if (v5RuntimeTools.isStudioV5Project(doc)) successfulV5Rebuilds++;
    appliedRevisionLog.push(response.revision);
    if (appliedRevisionLog.length > 200) appliedRevisionLog.shift();
    kernelRestarting = false;
    buildErrors.clear();
    bodyBuildErrors.clear();
    for (const error of response.errors || []) {
      if (error.featureId) buildErrors.set(error.featureId, error.message);
      if (error.bodyId) bodyBuildErrors.set(error.bodyId, error.message);
    }
    try {
      if (Array.isArray(response.bodies)) {
        lastBodyResults = response.bodies.map((body) => ({
          bodyId: body.bodyId,
          bodyName: body.bodyName,
          visible: body.visible,
          suppressed: body.suppressed,
          geometry: body.geometry,
          error: body.error,
          lastValid: body.lastValid,
          patternInstance: body.patternInstance || null,
          occurrenceInstance: body.occurrenceInstance || null,
          sourceBodyId: body.sourceBodyId || body.bodyId,
          sourceKey: body.sourceKey || null,
        }));
        const runtimeBodyIds = new Set(lastBodyResults.map((body) => body.bodyId));
        if (selectedBodyId && !runtimeBodyIds.has(selectedBodyId)) selectedBodyId = null;
        if (isolatedBodyId && !runtimeBodyIds.has(isolatedBodyId)) isolatedBodyId = null;
        for (const bodyId of [...exportBodyIds]) if (!runtimeBodyIds.has(bodyId)) exportBodyIds.delete(bodyId);
        lastEvaluationTrace = response.evaluation || null;
        setBodyMeshData(response.bodies);
      } else {
        lastBodyResults = [];
        lastEvaluationTrace = null;
        setMeshData(response.mesh);
      }
    } catch {
      say('Display meshing failed.', false);
    }
    const canReusePreRenderedAssemblyTree = options.treePreRendered === true
      && v5RuntimeTools.isStudioV5Project(doc)
      && doc.rootDocument?.kind === 'assembly'
      && previousAssemblyTreeResult === assemblyTreeResultFingerprint();
    if (canReusePreRenderedAssemblyTree) {
      preRenderedAssemblyTreeReuseCount++;
      syncBodyMeshState();
    }
    else renderHistory();
    const failed = (response.errors || [])[0];
    const errEl = $('bw-cmd-err');
    if (errEl) errEl.textContent = failed ? (OP_LABEL[failed.featureType] || 'Body') + ' failed: ' + failed.message : '';
    if (mode.kind === 'idle' || mode.kind === 'rebuilding') setMode({ kind: 'idle' });
    if (failed) say((OP_LABEL[failed.featureType] || 'Body') + ' failed: ' + failed.message);
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

  let edgeLines = []; // one pickable/rendered LineSegments batch per body
  let solidMesh = null; // the shaded mesh, for face raycasts
  let faceRanges = []; // [{t0, t1, faceId}] triangle ranges per B-rep face
  let faceByHash = new Map(); // faceId -> serializable planar-face metadata
  let bodyMeshes = new Map(); // body id -> independently selectable shaded mesh
  let bodyTemplateCache = new Map(); // source key -> reusable GPU geometry and topology
  let sectionCapObjects = [];
  let sectionCapFingerprint = null;
  let sceneBatchFingerprint = null;
  let sceneSolidBatchEntries = new Map();

  function edgeBatch(edges = []) {
    const positions = [];
    const entries = [];
    for (const edge of edges) {
      const points = edge.points || [];
      const start = positions.length / 3;
      for (let offset = 0; offset + 5 < points.length; offset += 3) {
        positions.push(
          points[offset], points[offset + 1], points[offset + 2],
          points[offset + 3], points[offset + 4], points[offset + 5],
        );
      }
      const count = positions.length / 3 - start;
      if (count) entries.push({ start, count, sig: edge.sig });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return { geometry, entries };
  }

  const edgeSignatureKey = (signature) => JSON.stringify(signature || null);
  function edgeSignatureForHit(hit) {
    const entries = hit?.object?.userData?.edgeEntries || [];
    const vertexIndex = Number(hit?.index ?? -1);
    return entries.find((entry) => vertexIndex >= entry.start && vertexIndex < entry.start + entry.count)?.sig || null;
  }
  function edgeSignaturesForLine(line) {
    return (line.userData.edgeEntries || []).map((entry) => entry.sig).filter(Boolean);
  }
  function clearEdgeSelectionOverlay(line) {
    const overlay = line.userData.selectionOverlay;
    if (!overlay) return;
    line.remove(overlay);
    overlay.geometry?.dispose?.();
    overlay.material?.dispose?.();
    line.userData.selectionOverlay = null;
  }
  function setEdgePickedSignatures(line, signatures = []) {
    line.userData.pickedSignatures = new Set(signatures.map(edgeSignatureKey));
    line.material.color.set(line.userData.baseColor || 0x30475c);
    clearEdgeSelectionOverlay(line);
    if (!line.userData.pickedSignatures.size) return;
    const source = line.geometry?.getAttribute?.('position');
    if (!source) return;
    const positions = [];
    for (const entry of line.userData.edgeEntries || []) {
      if (!line.userData.pickedSignatures.has(edgeSignatureKey(entry.sig))) continue;
      for (let index = entry.start; index < entry.start + entry.count; index++) {
        positions.push(source.getX(index), source.getY(index), source.getZ(index));
      }
    }
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = EDGE_MAT.clone();
    material.color.set(0xe67e22);
    material.clippingPlanes = line.material.clippingPlanes;
    material.clipIntersection = line.material.clipIntersection;
    const overlay = new THREE.LineSegments(geometry, material);
    overlay.renderOrder = 2;
    line.add(overlay);
    line.userData.selectionOverlay = overlay;
  }

  function clearSceneBatches() {
    for (const object of [...sceneBatchObjects, ...sceneInteractiveBatchObjects]) {
      object.parent?.remove(object);
      object.material?.dispose?.();
      object.geometry?.dispose?.();
      object.dispose?.();
    }
    sceneBatchObjects = [];
    sceneInteractiveBatchObjects = [];
    sceneProxyObjects = [];
    sceneBatchFingerprint = null;
    sceneSolidBatchEntries = new Map();
    sceneInteractiveSolidBatchEntries = new Map();
    sceneInteractiveTriangleCount = 0;
  }

  const clippingStyle = (material) => (material?.clippingPlanes || [])
    .map((plane) => [plane.normal.x, plane.normal.y, plane.normal.z, plane.constant]);

  // BatchedMesh relies on WEBGL_multi_draw for one physical draw. Chrome's
  // software renderer and older integrated GPUs do not expose that extension,
  // so a 160-body assembly silently falls back to hundreds of draws. Merge the
  // already-tessellated instance geometry instead: exact per-body meshes stay
  // available as hidden picking proxies, while each visible material bucket is
  // one physical draw on every WebGL2 implementation.
  function mergedMeshGeometry(meshes, includeColors = false) {
    const positions = [];
    const normals = [];
    const colors = [];
    const indices = [];
    const entries = [];
    const hasNormals = meshes.every((mesh) => Boolean(mesh.geometry.getAttribute('normal')));
    const point = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3();
    let vertexOffset = 0;
    for (const mesh of meshes) {
      const source = mesh.geometry.getAttribute('position');
      const sourceNormal = mesh.geometry.getAttribute('normal');
      const sourceIndex = mesh.geometry.getIndex();
      normalMatrix.getNormalMatrix(mesh.matrix);
      const start = vertexOffset;
      for (let index = 0; index < source.count; index++) {
        point.set(source.getX(index), source.getY(index), source.getZ(index)).applyMatrix4(mesh.matrix);
        positions.push(point.x, point.y, point.z);
        if (hasNormals) {
          normal.set(sourceNormal.getX(index), sourceNormal.getY(index), sourceNormal.getZ(index)).applyNormalMatrix(normalMatrix);
          normals.push(normal.x, normal.y, normal.z);
        }
        if (includeColors) colors.push(mesh.material.color.r, mesh.material.color.g, mesh.material.color.b);
      }
      if (sourceIndex) {
        for (let index = 0; index < sourceIndex.count; index++) indices.push(vertexOffset + sourceIndex.getX(index));
      } else {
        for (let index = 0; index < source.count; index++) indices.push(vertexOffset + index);
      }
      vertexOffset += source.count;
      entries.push({ bodyId: mesh.userData.bodyId, start, count: source.count, colorHex: mesh.material.color.getHex() });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    if (hasNormals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    else geometry.computeVertexNormals();
    if (includeColors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return { geometry, entries };
  }

  function syncSolidBatchColors(meshes, entries) {
    const touched = new Set();
    for (const mesh of meshes) {
      const entry = entries.get(mesh.userData.bodyId);
      const colorHex = mesh.material.color.getHex();
      if (!entry || entry.colorHex === colorHex) continue;
      const attribute = entry.batch.geometry.getAttribute('color');
      for (let index = entry.start; index < entry.start + entry.count; index++) {
        attribute.setXYZ(index, mesh.material.color.r, mesh.material.color.g, mesh.material.color.b);
      }
      entry.colorHex = colorHex;
      touched.add(attribute);
    }
    for (const attribute of touched) attribute.needsUpdate = true;
  }

  function syncSceneSolidBatchColors(meshes) {
    syncSolidBatchColors(meshes, sceneSolidBatchEntries);
    syncSolidBatchColors(meshes, sceneInteractiveSolidBatchEntries);
  }

  function interactionBoundsGeometry(mesh) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    if (!bounds || bounds.isEmpty()) return null;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    // Avoid zero-area boxes for sheet-like imported geometry while keeping
    // the preview faithful to the body's actual local bounds.
    size.set(Math.max(size.x, 0.02), Math.max(size.y, 0.02), Math.max(size.z, 0.02));
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    geometry.translate(center.x, center.y, center.z);
    return geometry;
  }

  function buildInteractiveSolidBatch(meshes) {
    const proxies = [];
    for (const mesh of meshes) {
      const geometry = interactionBoundsGeometry(mesh);
      if (!geometry) continue;
      const proxy = new THREE.Mesh(geometry, mesh.material);
      proxy.matrix.copy(mesh.matrix);
      proxy.matrixAutoUpdate = false;
      proxy.userData.bodyId = mesh.userData.bodyId;
      proxies.push(proxy);
    }
    if (!proxies.length) return;
    const merged = mergedMeshGeometry(proxies, true);
    for (const proxy of proxies) proxy.geometry.dispose();
    const material = meshes[0].material.clone();
    material.color.set(0xffffff);
    material.emissive?.setHex(0x000000);
    material.vertexColors = true;
    const batch = new THREE.Mesh(merged.geometry, material);
    for (const entry of merged.entries) sceneInteractiveSolidBatchEntries.set(entry.bodyId, { batch, ...entry });
    batch.frustumCulled = false;
    batch.visible = false;
    batch.userData.sceneInteractiveSolidBatch = true;
    partGroup.add(batch);
    sceneInteractiveBatchObjects.push(batch);
    sceneInteractiveTriangleCount += merged.geometry.getIndex()?.count / 3 || 0;
  }

  function rebuildSceneBatches() {
    const visibleMeshes = [...bodyMeshes.values()].filter((entry) => entry.visible);
    const visibleLines = edgeLines.filter((entry) => entry.visible);
    const fingerprint = JSON.stringify({
      solids: visibleMeshes.map((mesh) => [mesh.userData.bodyId, mesh.geometry.uuid, mesh.matrix.toArray(), clippingStyle(mesh.material), mesh.material.wireframe, mesh.material.metalness, mesh.material.roughness, mesh.material.opacity, mesh.material.transparent, mesh.material.depthWrite]),
      edges: visibleLines.map((line) => [line.userData.bodyId, line.geometry.uuid, line.matrix.toArray(), clippingStyle(line.material), line.material.clipIntersection, line.userData.baseColor]),
    });
    if (fingerprint === sceneBatchFingerprint && sceneBatchObjects.length) {
      syncSceneSolidBatchColors(visibleMeshes);
      return;
    }
    clearSceneBatches();
    sceneBatchFingerprint = fingerprint;
    sceneProxyObjects = [...bodyMeshes.values(), ...edgeLines];
    const solidBuckets = new Map();
    for (const mesh of visibleMeshes) {
      const material = mesh.material;
      const key = JSON.stringify({
        wireframe: material.wireframe, metalness: material.metalness, roughness: material.roughness,
        opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite,
        clipIntersection: material.clipIntersection, clipping: clippingStyle(material),
      });
      const bucket = solidBuckets.get(key) || [];
      bucket.push(mesh); solidBuckets.set(key, bucket);
    }
    for (const meshes of solidBuckets.values()) {
      const material = meshes[0].material.clone();
      material.color.set(0xffffff);
      material.emissive?.setHex(0x000000);
      material.vertexColors = true;
      const merged = mergedMeshGeometry(meshes, true);
      const batch = new THREE.Mesh(merged.geometry, material);
      for (const entry of merged.entries) sceneSolidBatchEntries.set(entry.bodyId, { batch, ...entry });
      batch.frustumCulled = false;
      batch.visible = false;
      batch.userData.sceneSolidBatch = true;
      partGroup.add(batch); sceneBatchObjects.push(batch);
      buildInteractiveSolidBatch(meshes);
    }
    const edgeBuckets = new Map();
    for (const line of visibleLines) {
      const key = JSON.stringify({ clipIntersection: line.material.clipIntersection, clipping: clippingStyle(line.material) });
      const bucket = edgeBuckets.get(key) || [];
      bucket.push(line); edgeBuckets.set(key, bucket);
    }
    for (const lines of edgeBuckets.values()) {
      const positions = [];
      const colors = [];
      const color = new THREE.Color();
      for (const line of lines) {
        const source = line.geometry.getAttribute('position');
        const matrix = line.matrix.elements;
        const selected = line.userData.pickedSignatures || new Set();
        for (const entry of line.userData.edgeEntries || []) {
          color.set(selected.has(edgeSignatureKey(entry.sig)) ? 0xe67e22 : line.userData.baseColor || 0x30475c);
          for (let index = entry.start; index < entry.start + entry.count; index++) {
            const x = source.getX(index); const y = source.getY(index); const z = source.getZ(index);
            positions.push(
              matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
              matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
              matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
            );
            colors.push(color.r, color.g, color.b);
          }
        }
      }
      if (!positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        clippingPlanes: lines[0].material.clippingPlanes,
        clipIntersection: lines[0].material.clipIntersection,
      });
      const batch = new THREE.LineSegments(geometry, material);
      batch.frustumCulled = false;
      batch.visible = false;
      batch.userData.sceneEdgeBatch = true;
      partGroup.add(batch); sceneBatchObjects.push(batch);
    }
  }

  function setMeshData(mesh) {
    // A document rebuild can finish while a new Press / Pull draft is already
    // visible. Replace only committed geometry so that late kernel output does
    // not erase the live draft preview underneath the user's pointer.
    const draftPreviews = partGroup.children.filter((child) => child.userData?.pressPullPreview);
    clearSceneBatches();
    for (const c of [...partGroup.children]) {
      partGroup.remove(c);
      if (draftPreviews.includes(c)) continue;
      c.geometry?.dispose();
      if (c.material && c.material !== MAT) c.material.dispose?.();
    }
    edgeLines = [];
    solidMesh = null;
    bodyMeshes = new Map();
    faceRanges = [];
    faceByHash = new Map();
    for (const template of bodyTemplateCache.values()) {
      template.geometry.dispose();
      template.edgeGeometry?.dispose();
    }
    bodyTemplateCache = new Map();
    meshBounds = mesh?.bounds ?? null;
    if (!mesh) {
      for (const preview of draftPreviews) partGroup.add(preview);
      return;
    }
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
    // Render them as one disconnected LineSegments batch so a complex part
    // does not become one GPU draw call per topological edge.
    const edges = edgeBatch(mesh.edges || []);
    if (edges.entries.length) {
      const line = new THREE.LineSegments(edges.geometry, EDGE_MAT.clone());
      line.userData.edgeEntries = edges.entries;
      line.userData.baseColor = 0x30475c;
      setEdgePickedSignatures(line);
      partGroup.add(line);
      edgeLines.push(line);
    }
    // Keep the translucent draft above the rebuilt committed body.
    for (const preview of draftPreviews) partGroup.add(preview);
  }

  function boundsPair(bounds) {
    if (Array.isArray(bounds) && bounds.length === 2) return bounds;
    if (Array.isArray(bounds) && bounds.length === 6) return [bounds.slice(0, 3), bounds.slice(3, 6)];
    return null;
  }

    function cadMatrixToScene(matrix) {
    const cadToScene = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
    const sceneToCad = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
    return v5AssemblyTools.studioV5MultiplyMatrices(cadToScene, v5AssemblyTools.studioV5MultiplyMatrices(matrix, sceneToCad));
  }

  function sceneMatrixToCad(matrix) {
    const cadToScene = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
    const sceneToCad = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
    return v5AssemblyTools.studioV5MultiplyMatrices(sceneToCad, v5AssemblyTools.studioV5MultiplyMatrices(matrix, cadToScene));
  }

  function activeSectionPlanes(result) {
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'assembly') return { planes: [], intersection: false };
    const assembly = v5RuntimeTools.studioV5RootAssembly(doc);
    const section = assembly.sectionViews.find((entry) => entry.id === assembly.metadata?.activeSectionViewId);
    if (!section) return { planes: [], intersection: false };
    const scope = section.definition.scopeOccurrenceIds || [];
    if (scope.length && !scope.some((occurrenceId) => result?.occurrenceInstance?.occurrencePath?.includes(occurrenceId))) return { planes: [], intersection: false };
    const direction = section.definition.reverse ? -1 : 1;
    const planes = section.definition.planes.map((plane) => {
      const cadNormal = plane.normal.map((entry) => entry * direction);
      const normal = new THREE.Vector3(cadNormal[0], cadNormal[2], -cadNormal[1]).normalize();
      const cadPoint = plane.normal.map((entry) => entry * Number(plane.offset || 0));
      const point = new THREE.Vector3(cadPoint[0], cadPoint[2], -cadPoint[1]);
      return new THREE.Plane(normal, -normal.dot(point));
    });
    return { planes, intersection: section.kind !== 'plane', cap: section.definition.cap !== false };
  }

  function clearSectionCaps(resetFingerprint = true) {
    const geometries = new Set();
    for (const object of sectionCapObjects) {
      object.parent?.remove(object);
      object.material?.map?.dispose?.();
      object.material?.dispose?.();
      if (object.geometry) geometries.add(object.geometry);
      object.dispose?.();
    }
    for (const geometry of geometries) geometry.dispose?.();
    sectionCapObjects = [];
    if (resetFingerprint) sectionCapFingerprint = null;
  }

  function sectionHatchTexture(hatch, worldSize = 64) {
    const size = 64;
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d');
    context.fillStyle = hatch.fillColor || '#d7e0e5'; context.fillRect(0, 0, size, size);
    context.translate(size / 2, size / 2); context.rotate(Number(hatch.angle || 45) * Math.PI / 180); context.translate(-size / 2, -size / 2);
    context.strokeStyle = hatch.color || '#243746'; context.lineWidth = 2;
    const spacing = Math.max(4, Math.min(32, Number(hatch.spacing || 8)));
    for (let x = -size; x <= size * 2; x += spacing) { context.beginPath(); context.moveTo(x, -size); context.lineTo(x, size * 2); context.stroke(); }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(Math.max(1, worldSize / size), Math.max(1, worldSize / size));
    return texture;
  }

  function rebuildSectionCaps() {
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'assembly') {
      clearSectionCaps();
      return;
    }
    const assembly = v5RuntimeTools.studioV5RootAssembly(doc);
    const section = assembly.sectionViews.find((entry) => entry.id === assembly.metadata?.activeSectionViewId);
    if (!section?.definition?.cap) {
      clearSectionCaps();
      return;
    }
    const scope = section.definition.scopeOccurrenceIds || [];
    const eligible = [...bodyMeshes].filter(([bodyId, mesh]) => {
      const result = lastBodyResults.find((entry) => entry.bodyId === bodyId);
      return mesh.visible && (!scope.length || scope.some((occurrenceId) => result?.occurrenceInstance?.occurrencePath?.includes(occurrenceId)));
    });
    if (!eligible.length) {
      clearSectionCaps();
      return;
    }
    const fingerprint = JSON.stringify({
      section: section.definition,
      eligible: eligible.map(([bodyId, mesh]) => [bodyId, mesh.geometry.uuid, mesh.matrix.toArray()]),
    });
    if (fingerprint === sectionCapFingerprint && sectionCapObjects.length) return;
    clearSectionCaps(false);
    sectionCapFingerprint = fingerprint;
    const capBounds = new THREE.Box3();
    for (const [, mesh] of eligible) capBounds.expandByObject(mesh);
    const capCenter = capBounds.getCenter(new THREE.Vector3());
    const capSpan = capBounds.getSize(new THREE.Vector3());
    const capSize = Math.max(10, capSpan.length() * 1.15);
    const sampleResult = lastBodyResults.find((entry) => entry.bodyId === eligible[0][0]);
    const sectionState = activeSectionPlanes(sampleResult);
    for (const [planeIndex, plane] of sectionState.planes.entries()) {
      const stencilGeometry = mergedMeshGeometry(eligible.map(([, mesh]) => mesh)).geometry;
      for (const [side, operation] of [[THREE.BackSide, THREE.IncrementWrapStencilOp], [THREE.FrontSide, THREE.DecrementWrapStencilOp]]) {
        const material = new THREE.MeshBasicMaterial({
          depthWrite: false, depthTest: false, colorWrite: false, side, clippingPlanes: sectionState.planes,
          stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc,
          stencilFail: operation, stencilZFail: operation, stencilZPass: operation,
        });
        const stencil = new THREE.Mesh(stencilGeometry, material);
        stencil.frustumCulled = false;
        stencil.renderOrder = planeIndex + 1;
        stencil.userData.sectionCapStencil = true;
        stencil.userData.sectionCapStencilBatch = true;
        stencil.userData.sectionCapStencilCount = eligible.length;
        partGroup.add(stencil); sectionCapObjects.push(stencil);
      }
      const hatch = section.definition.hatch || {};
      const capMaterial = new THREE.MeshBasicMaterial({
        map: hatch.enabled === false ? null : sectionHatchTexture(hatch, capSize), color: hatch.fillColor || '#d7e0e5', side: THREE.DoubleSide,
        clippingPlanes: sectionState.planes.filter((_, index) => index !== planeIndex),
        stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
        stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
      });
      const cap = new THREE.Mesh(new THREE.PlaneGeometry(capSize, capSize), capMaterial);
      const point = plane.projectPoint(capCenter, new THREE.Vector3());
      cap.position.copy(point);
      cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal.clone().normalize());
      cap.userData.sectionCapCenter = capCenter.clone();
      cap.userData.sectionPlaneNormal = plane.normal.clone();
      cap.userData.sectionPlaneIndex = planeIndex;
      cap.renderOrder = planeIndex + 1.1; cap.userData.sectionCapPlane = true;
      cap.onAfterRender = (activeRenderer) => activeRenderer.clearStencil();
      scene.add(cap); sectionCapObjects.push(cap);
    }
  }

  function bodyAppearance(result) {
    if (!v5RuntimeTools.isStudioV5Project(doc)) return null;
    const appearances = v5InspectionTools.studioV5AppearanceMap(doc);
    const partId = result?.occurrenceInstance?.definition?.partId || doc.rootDocument?.partId;
    const part = doc.partDefinitions.find((entry) => entry.id === partId);
    const body = part?.bodies.find((entry) => entry.id === result?.sourceBodyId || entry.id === result?.bodyId);
    const occurrencePath = result?.occurrenceInstance?.occurrencePath || [];
    const occurrences = doc.rootDocument?.kind === 'assembly' ? doc.assemblyDefinitions.flatMap((assembly) => assembly.occurrences) : [];
    const occurrence = [...occurrencePath].reverse().map((id) => occurrences.find((entry) => entry.id === id)).find(Boolean)
      || occurrences.find((entry) => entry.id === result?.occurrenceInstance?.sourceOccurrenceId);
    const material = body?.materialId ? doc.materials.find((entry) => entry.id === body.materialId) : null;
    const appearanceId = occurrence?.appearanceOverrideId || body?.appearanceId || material?.appearanceId || part?.defaultAppearanceId || doc.metadata?.defaultAppearanceId;
    return appearances.get(appearanceId) || null;
  }

  function syncInspectionDisplay(bodyId, mesh, result) {
    const explodedByOccurrence = v5InspectionTools.studioV5ActiveExplodedTransforms(doc);
    let exploded = v5AssemblyTools.studioV5IdentityMatrix();
    let hasExplodedDelta = false;
    for (const occurrenceId of result?.occurrenceInstance?.occurrencePath || []) {
      const delta = explodedByOccurrence.get(occurrenceId);
      if (!delta) continue;
      exploded = v5AssemblyTools.studioV5MultiplyMatrices(delta, exploded);
      hasExplodedDelta = true;
    }
    const solved = new THREE.Matrix4().fromArray(mesh.userData.solvedMatrix || v5AssemblyTools.studioV5IdentityMatrix());
    if (hasExplodedDelta) mesh.matrix.multiplyMatrices(new THREE.Matrix4().fromArray(cadMatrixToScene(exploded)), solved);
    else mesh.matrix.copy(solved);
    mesh.matrixAutoUpdate = false;
    const section = activeSectionPlanes(result);
    mesh.material.clippingPlanes = section.planes;
    mesh.material.clipIntersection = section.intersection;
    mesh.material.clipShadows = section.cap === true;
    const appearance = bodyAppearance(result);
    const displayMode = v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly'
      ? v5RuntimeTools.studioV5RootAssembly(doc).metadata?.displayMode || 'shaded-edges'
      : 'shaded-edges';
    mesh.material.wireframe = displayMode === 'wireframe';
    if (appearance) {
      mesh.material.metalness = Math.max(0, Math.min(1, Number(appearance.metallic ?? 0.16)));
      mesh.material.roughness = Math.max(0, Math.min(1, Number(appearance.roughness ?? 0.56)));
      mesh.material.opacity = Math.max(0.05, Math.min(1, Number(appearance.opacity ?? 1)));
      mesh.material.transparent = mesh.material.opacity < 0.999;
      mesh.material.depthWrite = mesh.material.opacity >= 0.999;
    } else {
      mesh.material.metalness = 0.16; mesh.material.roughness = 0.56; mesh.material.opacity = 1; mesh.material.transparent = false; mesh.material.depthWrite = true;
    }
    if (displayMode === 'ghost') {
      mesh.material.opacity = Math.min(mesh.material.opacity, 0.24);
      mesh.material.transparent = true;
      mesh.material.depthWrite = false;
    } else if (displayMode === 'hidden-line') {
      mesh.material.metalness = 0;
      mesh.material.roughness = 1;
      mesh.material.opacity = 0.12;
      mesh.material.transparent = true;
      mesh.material.depthWrite = true;
    }
    mesh.userData.displayMode = displayMode;
    return appearance;
  }

  function syncBodyMeshState() {
    const isAssembly = v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly';
    const part = v5RuntimeTools.isStudioV5Project(doc) && !isAssembly ? v5RuntimeTools.studioV5RootPart(doc) : null;
    const linesByBody = new Map(edgeLines.map((line) => [line.userData.bodyId, line]));
    for (const [bodyId, mesh] of bodyMeshes) {
      const result = lastBodyResults.find((entry) => entry.bodyId === bodyId);
      const instance = result?.patternInstance;
      const source = !isAssembly && (instance ? part?.bodies.find((entry) => entry.id === instance.sourceBodyId) : part?.bodies.find((entry) => entry.id === bodyId));
      const pattern = !isAssembly && instance ? (part?.bodyPatterns || []).find((entry) => entry.id === instance.patternId) : null;
      const occurrenceSelected = selectedOccurrenceId && result?.occurrenceInstance?.occurrencePath?.includes(selectedOccurrenceId);
      const occurrenceIsolated = appEl?.dataset.isolateOccurrence && result?.occurrenceInstance?.occurrencePath?.includes(appEl.dataset.isolateOccurrence);
      const replacedByFusion = !instance && !isAssembly && (part?.bodyPatterns || []).some((entry) =>
        entry.sourceBodyId === bodyId && entry.outputMode === 'union' && entry.visible !== false && !entry.suppressed);
      const shown = isAssembly
        ? Boolean(result && result.visible !== false && !result.suppressed && (!isolatedBodyId || isolatedBodyId === bodyId) && (!appEl?.dataset.isolateOccurrence || occurrenceIsolated))
        : Boolean(source && source.visible && !source.suppressed && !replacedByFusion && (!instance || (pattern && pattern.visible !== false && !pattern.suppressed)) &&
          (!isolatedBodyId || isolatedBodyId === bodyId || (instance && isolatedBodyId === source.id)));
      mesh.visible = shown;
      const appearance = syncInspectionDisplay(bodyId, mesh, result);
      const selected = bodyId === selectedBodyId || occurrenceSelected;
      mesh.material.color.set(selected ? 0x67b7f0 : bodyBuildErrors.has(bodyId) ? 0xc47168 : appearance?.baseColor || 0xa7b8c9);
      mesh.material.emissive?.setHex(selected ? 0x102f46 : 0x000000);
      const line = linesByBody.get(bodyId);
      if (line) {
        line.visible = shown && !['shaded', 'ghost', 'wireframe'].includes(mesh.userData.displayMode);
        line.matrix.copy(mesh.matrix); line.matrixAutoUpdate = false;
        line.userData.baseColor = appearance?.edgeColor || 0x30475c;
        if (!line.userData.pickedSignatures?.size) line.material.color.set(line.userData.baseColor);
        const section = activeSectionPlanes(result);
        line.material.clippingPlanes = section.planes;
        line.material.clipIntersection = section.intersection;
        if (line.userData.selectionOverlay) {
          line.userData.selectionOverlay.material.clippingPlanes = section.planes;
          line.userData.selectionOverlay.material.clipIntersection = section.intersection;
        }
      }
    }
    // Demand-driven rendering may not submit a frame before callers perform
    // picking or query rendered bounds. Keep the CAD-to-scene parent rotation
    // and every reused child transform current at the same state boundary.
    partGroup.updateMatrixWorld(true);
    const activeBodyId = part?.metadata?.activeBodyId;
    const activeMesh = bodyMeshes.get(activeBodyId);
    const selectedMesh = bodyMeshes.get(selectedBodyId);
    // A legacy-to-V5 typed command changes the document synchronously while
    // its first multi-body worker reply is still in flight. Keep the valid
    // legacy display/picking mesh during that brief hand-off; an empty body
    // response still clears it in setBodyMeshData() before reaching here.
    if (bodyMeshes.size) {
      solidMesh = (activeMesh?.visible && activeMesh) || (selectedMesh?.visible && selectedMesh) || [...bodyMeshes.values()].find((mesh) => mesh.visible) || null;
    }
    const aggregate = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
    for (const mesh of bodyMeshes.values()) {
      if (!mesh.visible) continue;
      const pair = boundsPair(mesh.userData.bounds);
      if (!pair) continue;
      for (let axis = 0; axis < 3; axis++) {
        aggregate[0][axis] = Math.min(aggregate[0][axis], pair[0][axis]);
        aggregate[1][axis] = Math.max(aggregate[1][axis], pair[1][axis]);
      }
    }
    meshBounds = Number.isFinite(aggregate[0][0]) ? aggregate : null;
    rebuildSectionCaps();
    rebuildSceneBatches();
    requestSceneRender();
  }

  function setBodyMeshData(bodies) {
    const draftPreviews = partGroup.children.filter((child) => child.userData?.pressPullPreview);
    clearSceneBatches();
    clearSectionCaps();
    const previousMeshes = bodyMeshes;
    const previousLines = edgeLines;
    const previousLinesByBody = new Map(previousLines.map((line) => [line.userData.bodyId, line]));
    const previouslyManaged = new Set([...previousMeshes.values(), ...previousLines, ...draftPreviews]);
    for (const child of [...partGroup.children]) if (!previouslyManaged.has(child)) {
      partGroup.remove(child);
      child.geometry?.dispose?.();
      if (child.material && child.material !== MAT && child.material !== EDGE_MAT) child.material.dispose?.();
    }
    const nextLines = [];
    solidMesh = null;
    const nextMeshes = new Map();
    faceRanges = [];
    faceByHash = new Map();
    for (const bodyResult of bodies.filter((entry) => entry.mesh)) {
      const mesh = bodyResult.mesh;
      const sourceKey = bodyResult.renderSourceKey || bodyResult.sourceKey || bodyResult.sourceBodyId || bodyResult.bodyId;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
      if (mesh.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
      if (!mesh.normals) geometry.computeVertexNormals();
      const edges = edgeBatch(mesh.edges || []);
      const previous = bodyTemplateCache.get(sourceKey);
      if (previous) {
        previous.geometry.dispose();
        previous.edgeGeometry?.dispose();
      }
      bodyTemplateCache.set(sourceKey, {
        geometry, faceGroups: mesh.faceGroups || [], planarFaces: mesh.planarFaces || [],
        edgeGeometry: edges.geometry, edgeEntries: edges.entries,
      });
    }
    const usedSourceKeys = new Set(bodies.map((bodyResult) => bodyResult.renderSourceKey || bodyResult.sourceKey || bodyResult.sourceBodyId || bodyResult.bodyId));
    for (const [sourceKey, template] of bodyTemplateCache) if (!usedSourceKeys.has(sourceKey)) {
      template.geometry.dispose();
      template.edgeGeometry?.dispose();
      bodyTemplateCache.delete(sourceKey);
    }
    for (const bodyResult of bodies) {
      const sourceKey = bodyResult.renderSourceKey || bodyResult.sourceKey || bodyResult.sourceBodyId || bodyResult.bodyId;
      const template = bodyTemplateCache.get(sourceKey);
      if (!template) continue;
      const shaded = previousMeshes.get(bodyResult.bodyId) || new THREE.Mesh(template.geometry, MAT.clone());
      shaded.geometry = template.geometry;
      shaded.userData.bodyId = bodyResult.bodyId;
      shaded.userData.bounds = bodyResult.geometry?.bounds || bodyResult.mesh?.bounds || null;
      shaded.userData.solvedMatrix = Array.isArray(bodyResult.renderTransform) && bodyResult.renderTransform.length === 16 ? [...bodyResult.renderTransform] : v5AssemblyTools.studioV5IdentityMatrix();
      if (Array.isArray(bodyResult.renderTransform) && bodyResult.renderTransform.length === 16) {
        shaded.matrix.fromArray(bodyResult.renderTransform);
        shaded.matrixAutoUpdate = false;
      } else {
        shaded.matrix.identity();
        shaded.matrixAutoUpdate = false;
      }
      if (shaded.parent !== partGroup) partGroup.add(shaded);
      nextMeshes.set(bodyResult.bodyId, shaded);
      for (const group of template.faceGroups) {
        faceRanges.push({ t0: group.start / 3, t1: (group.start + group.count) / 3, faceId: group.faceId, bodyId: bodyResult.bodyId, mesh: shaded });
      }
      for (const face of template.planarFaces) {
        faceByHash.set(bodyResult.bodyId + ':' + face.faceId, { ...face, bodyId: bodyResult.bodyId });
      }
      if (template.edgeEntries.length) {
        const line = previousLinesByBody.get(bodyResult.bodyId) || new THREE.LineSegments(template.edgeGeometry, EDGE_MAT.clone());
        line.geometry = template.edgeGeometry;
        line.userData.edgeEntries = template.edgeEntries;
        line.userData.bodyId = bodyResult.bodyId;
        line.userData.baseColor ||= 0x30475c;
        setEdgePickedSignatures(line);
        line.userData.solvedMatrix = [...shaded.userData.solvedMatrix];
        if (Array.isArray(bodyResult.renderTransform) && bodyResult.renderTransform.length === 16) {
          line.matrix.fromArray(bodyResult.renderTransform);
          line.matrixAutoUpdate = false;
        } else {
          line.matrix.identity();
          line.matrixAutoUpdate = false;
        }
        if (line.parent !== partGroup) partGroup.add(line);
        nextLines.push(line);
      }
    }
    for (const [bodyId, mesh] of previousMeshes) if (!nextMeshes.has(bodyId)) {
      partGroup.remove(mesh);
      mesh.material?.dispose?.();
    }
    const retainedLines = new Set(nextLines);
    for (const line of previousLines) if (!retainedLines.has(line)) {
      clearEdgeSelectionOverlay(line);
      partGroup.remove(line);
      line.material?.dispose?.();
    }
    bodyMeshes = nextMeshes;
    edgeLines = nextLines;
    for (const preview of draftPreviews) if (preview.parent !== partGroup) partGroup.add(preview);
    // rebuild() immediately follows this geometry swap with renderHistory(),
    // whose body-tree pass synchronizes visibility, appearance, placement,
    // bounds, and section caps. Running the same pass here rebuilt every
    // section stencil twice for each exact edit.
  }

  const faceForRange = (range) => range && faceByHash.get(range.bodyId ? range.bodyId + ':' + range.faceId : range.faceId);
  const rangeForHit = (hit) => hit && faceRanges.find((range) =>
    (!range.mesh || range.mesh === hit.object) && hit.faceIndex >= range.t0 && hit.faceIndex < range.t1,
  );

  // --- body + history tree -------------------------------------------------
  function renderDatums() {
    const tree = $('bw-datum-tree');
    const summary = $('bw-datum-summary');
    if (!tree) return;
    tree.replaceChildren();
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'part') {
      if (summary) summary.textContent = '0 references';
      return;
    }
    const part = v5RuntimeTools.studioV5RootPart(doc);
    let resolution;
    try { resolution = v5ModelingTools.resolveStudioV5Datums(doc, part.id); } catch {}
    if (summary) summary.textContent = part.referenceGeometry.length + ' reference' + (part.referenceGeometry.length === 1 ? '' : 's');
    for (const datum of part.referenceGeometry) {
      const datumError = resolution?.errors?.get(datum.id);
      const row = document.createElement('div');
      row.className = 'datum-row';
      row.dataset.datumId = datum.id;
      row.dataset.broken = String(Boolean(datumError));
      setTreeItemSemantics(row, { selected: datum.id === selectedDatumId, suppressed: datum.suppressed, failed: Boolean(datumError), label: datum.name });
      const select = document.createElement('button');
      select.type = 'button';
      select.dataset.datumAction = 'select';
      select.innerHTML = '<span>' + datum.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</span><small>' + datum.kind + (datum.suppressed ? ' · suppressed' : '') + (datumError ? ' · repair required' : '') + '</small>';
      if (datumError) select.title = String(datumError?.message || datumError);
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.dataset.datumAction = 'edit';
      edit.textContent = datumError ? 'Repair' : '⋯';
      edit.title = (datumError ? 'Repair ' : 'Edit ') + datum.name;
      row.append(select, edit);
      tree.appendChild(row);
    }
  }

  function renderAdvancedSketches() {
    const tree = $('bw-sketch-tree');
    const summary = $('bw-sketch-summary');
    if (!tree) return;
    tree.replaceChildren();
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'part') {
      if (summary) summary.textContent = '0 sketches';
      return;
    }
    const sketches = v5RuntimeTools.studioV5RootPart(doc).sketches.filter((sketch) => sketch.extensions?.studioRole === 'profile' || sketch.extensions?.studioRole === 'path');
    if (summary) summary.textContent = sketches.length + ' sketch' + (sketches.length === 1 ? '' : 'es');
    for (const sketch of sketches) {
      const row = document.createElement('div');
      row.className = 'datum-row';
      row.dataset.sketchId = sketch.id;
      setTreeItemSemantics(row, { selected: sketch.id === selectedSketchId, suppressed: sketch.suppressed, label: sketch.name });
      const select = document.createElement('button');
      select.type = 'button'; select.dataset.sketchAction = 'select';
      select.innerHTML = '<span>' + sketch.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</span><small>' + sketch.extensions.studioRole + ' · ' + (sketch.entities[0]?.kind || 'curve') + '</small>';
      const edit = document.createElement('button');
      edit.type = 'button'; edit.dataset.sketchAction = 'edit'; edit.textContent = '⋯'; edit.title = 'Edit ' + sketch.name;
      row.append(select, edit); tree.appendChild(row);
    }
  }

  function renderBodyPatterns() {
    const tree = $('bw-pattern-tree');
    const summary = $('bw-pattern-summary');
    if (!tree) return;
    tree.replaceChildren();
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'part') {
      if (summary) summary.textContent = '0 patterns';
      return;
    }
    const part = v5RuntimeTools.studioV5RootPart(doc);
    const patterns = part.bodyPatterns || [];
    if (summary) summary.textContent = patterns.length + ' pattern' + (patterns.length === 1 ? '' : 's');
    for (const pattern of patterns) {
      const row = document.createElement('div');
      row.className = 'datum-row pattern-row' + (buildErrors.has(pattern.id) ? ' is-broken' : '');
      row.dataset.patternId = pattern.id;
      const select = document.createElement('button');
      select.type = 'button'; select.dataset.patternAction = 'edit';
      const generated = lastBodyResults.filter((entry) => entry.patternInstance?.patternId === pattern.id && entry.visible !== false);
      setTreeItemSemantics(row, {
        selected: generated.some((entry) => entry.bodyId === selectedBodyId), expanded: true,
        hidden: pattern.visible === false, failed: buildErrors.has(pattern.id), count: generated.length + 1, label: pattern.name,
      });
      select.innerHTML = '<span>' + pattern.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</span><small>' +
        (buildErrors.has(pattern.id) ? 'FAILED · Repair references' : pattern.kind + ' · ' + (pattern.outputMode === 'union' ? 'fused solid' : (generated.length + 1) + ' active instances')) + '</small>';
      const visibility = document.createElement('button');
      visibility.type = 'button'; visibility.dataset.patternAction = 'visibility'; visibility.textContent = pattern.visible === false ? '○' : '●'; visibility.title = pattern.visible === false ? 'Show pattern' : 'Hide pattern';
      const remove = document.createElement('button');
      remove.type = 'button'; remove.dataset.patternAction = 'delete'; remove.textContent = '×'; remove.title = 'Delete ' + pattern.name;
      const dissolve = document.createElement('button');
      dissolve.type = 'button'; dissolve.dataset.patternAction = 'dissolve'; dissolve.textContent = 'D'; dissolve.title = 'Dissolve generated occurrences into independent exact bodies';
      row.append(select, visibility, dissolve, remove); tree.appendChild(row);
      for (const result of generated) {
        const child = document.createElement('div');
        child.className = 'pattern-instance-row' + (result.bodyId === selectedBodyId ? ' is-selected' : '');
        child.dataset.patternInstanceId = result.bodyId;
        child.dataset.patternId = pattern.id;
        child.dataset.patternIndex = String(result.patternInstance.index);
        setTreeItemSemantics(child, { level: 2, selected: result.bodyId === selectedBodyId, hidden: result.visible === false, label: result.bodyName });
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.patternInstanceAction = 'select'; button.textContent = result.bodyName;
        const exportLabel = document.createElement('label');
        exportLabel.title = 'Select ' + result.bodyName + ' for export';
        const exportBox = document.createElement('input');
        exportBox.type = 'checkbox'; exportBox.dataset.bodyExport = result.bodyId; exportBox.checked = exportBodyIds.has(result.bodyId);
        exportLabel.appendChild(exportBox);
        const skip = document.createElement('button');
        skip.type = 'button'; skip.dataset.patternInstanceAction = 'skip'; skip.textContent = 'Skip';
        const independent = document.createElement('button');
        independent.type = 'button'; independent.dataset.patternInstanceAction = 'independent'; independent.textContent = 'Independent';
        child.append(button, exportLabel, skip, independent); tree.appendChild(child);
      }
    }
  }

  function renderAssemblyTree() {
    const isAssembly = v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly';
    if (appEl) appEl.dataset.documentKind = isAssembly ? 'assembly' : 'part';
    const partOnly = ['bw-part-origin'];
    for (const id of partOnly) if ($(id)) $(id).hidden = isAssembly;
    document.querySelector('.ws-datums')?.toggleAttribute('hidden', isAssembly);
    document.querySelector('.ws-sketches')?.toggleAttribute('hidden', isAssembly);
    document.querySelector('.ws-patterns')?.toggleAttribute('hidden', isAssembly);
    document.querySelector('.wsp-history')?.toggleAttribute('hidden', isAssembly);
    if ($('bw-assembly-components')) $('bw-assembly-components').hidden = !isAssembly;
    if ($('bw-assembly-mates')) $('bw-assembly-mates').hidden = !isAssembly;
    if ($('bw-assembly-inspection')) $('bw-assembly-inspection').hidden = !isAssembly;
    if ($('bw-document-suffix')) $('bw-document-suffix').textContent = isAssembly ? '— Assembly Design' : '— Part Design';
    if ($('bw-tree-document-kind')) $('bw-tree-document-kind').textContent = isAssembly ? 'Solved component structure' : 'Parametric body';
    const tree = $('bw-assembly-tree');
    const mateTree = $('bw-mate-tree');
    const inspectionTree = $('bw-inspection-tree');
    if (!tree || !mateTree || !inspectionTree) return;
    tree.replaceChildren(); mateTree.replaceChildren(); inspectionTree.replaceChildren();
    if (!isAssembly) {
      if ($('bw-assembly-summary')) $('bw-assembly-summary').textContent = '0 occurrences';
      if ($('bw-mate-summary')) $('bw-mate-summary').textContent = '0 mates';
      if ($('bw-inspection-summary')) $('bw-inspection-summary').textContent = '0 saved';
      return;
    }
    const assembly = v5RuntimeTools.studioV5RootAssembly(doc);
    if ($('bw-assembly-summary')) $('bw-assembly-summary').textContent = assembly.occurrences.length + ' occurrences';
    if ($('bw-mate-summary')) $('bw-mate-summary').textContent = assembly.mates.length + ' mates · ' + (lastEvaluationTrace?.solverState || 'solving');
    const definitionName = (reference) => reference.kind === 'part'
      ? doc.partDefinitions.find((entry) => entry.id === reference.partId)?.name
      : doc.assemblyDefinitions.find((entry) => entry.id === reference.assemblyId)?.name;
    for (const occurrence of assembly.occurrences) {
      const row = document.createElement('div');
      row.className = 'assembly-row' + (occurrence.id === selectedOccurrenceId ? ' is-selected' : '') + (occurrence.suppressed ? ' is-suppressed' : '');
      row.dataset.occurrenceId = occurrence.id;
      const occurrenceResults = lastBodyResults.filter((entry) => entry.occurrenceInstance?.occurrencePath?.[0] === occurrence.id);
      const occurrenceLeafCount = new Set(occurrenceResults.map((entry) => entry.occurrenceInstance?.occurrenceId).filter(Boolean)).size;
      setTreeItemSemantics(row, {
        selected: occurrence.id === selectedOccurrenceId, expanded: true, hidden: occurrence.visible === false,
        suppressed: occurrence.suppressed, failed: !definitionName(occurrence.definition), count: Math.max(1, occurrenceLeafCount), label: occurrence.name,
      });
      const select = document.createElement('button');
      select.type = 'button'; select.dataset.occurrenceAction = 'select';
      const dof = lastEvaluationTrace?.degreesOfFreedom?.[occurrence.id];
      select.innerHTML = '<span>' + escapeHtml(occurrence.name) + '</span><small>' + escapeHtml(definitionName(occurrence.definition) || 'Missing definition') +
        ' · ' + (occurrence.fixed || dof === 0 ? 'fully constrained' : (dof ?? 6) + ' DOF') + '</small>';
      const visibility = document.createElement('button');
      visibility.type = 'button'; visibility.dataset.occurrenceAction = 'visibility'; visibility.textContent = occurrence.visible ? '●' : '○'; visibility.title = occurrence.visible ? 'Hide component' : 'Show component';
      const suppress = document.createElement('button');
      suppress.type = 'button'; suppress.dataset.occurrenceAction = 'suppress'; suppress.textContent = occurrence.suppressed ? 'R' : 'S'; suppress.title = occurrence.suppressed ? 'Restore component' : 'Suppress component';
      row.append(select, visibility, suppress); tree.appendChild(row);
      const leaves = new Map();
      for (const result of lastBodyResults.filter((entry) => entry.occurrenceInstance?.occurrencePath?.[0] === occurrence.id)) {
        const runtimeOccurrenceId = result.occurrenceInstance.occurrenceId;
        if (!leaves.has(runtimeOccurrenceId)) leaves.set(runtimeOccurrenceId, []);
        leaves.get(runtimeOccurrenceId).push(result);
      }
      for (const [runtimeOccurrenceId, results] of leaves) {
        const child = document.createElement('div');
        child.className = 'assembly-leaf-row' + (runtimeOccurrenceId === selectedOccurrenceId ? ' is-selected' : '');
        child.dataset.runtimeOccurrenceId = runtimeOccurrenceId;
        setTreeItemSemantics(child, { level: 2, selected: runtimeOccurrenceId === selectedOccurrenceId, hidden: results.every((entry) => entry.visible === false), label: results[0].bodyName });
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.runtimeOccurrenceAction = 'select'; button.textContent = results[0].bodyName.split(' / ').slice(0, -1).join(' / ') || results[0].bodyName;
        const exportLabel = document.createElement('label'); exportLabel.title = 'Select component solids for export';
        const exportBox = document.createElement('input'); exportBox.type = 'checkbox'; exportBox.dataset.occurrenceExport = runtimeOccurrenceId;
        exportBox.checked = results.every((entry) => exportBodyIds.has(entry.bodyId)); exportBox.setAttribute('aria-label', 'Select ' + (results[0].bodyName || runtimeOccurrenceId) + ' solids for export'); exportLabel.appendChild(exportBox);
        child.append(button, exportLabel); tree.appendChild(child);
      }
    }
    for (const pattern of assembly.occurrencePatterns) {
      const row = document.createElement('div'); row.className = 'assembly-pattern-row'; row.dataset.occurrencePatternId = pattern.id;
      setTreeItemSemantics(row, { expanded: true, count: pattern.generatedCount, label: pattern.name });
      row.innerHTML = '<span>' + escapeHtml(pattern.name) + '</span><small>' + pattern.kind + ' · ' + pattern.generatedCount + ' generated</small>';
      tree.appendChild(row);
      const generated = new Map();
      for (const result of lastBodyResults.filter((entry) => entry.occurrenceInstance?.patternInstance?.patternId === pattern.id)) {
        const occurrenceId = result.occurrenceInstance.occurrenceId;
        if (!generated.has(occurrenceId)) generated.set(occurrenceId, []);
        generated.get(occurrenceId).push(result);
      }
      for (const [occurrenceId, results] of generated) {
        const child = document.createElement('div');
        child.className = 'assembly-leaf-row' + (occurrenceId === selectedOccurrenceId ? ' is-selected' : '');
        child.dataset.runtimeOccurrenceId = occurrenceId;
        setTreeItemSemantics(child, { level: 2, selected: occurrenceId === selectedOccurrenceId, hidden: results.every((entry) => entry.visible === false), label: results[0].bodyName });
        const button = document.createElement('button'); button.type = 'button'; button.dataset.runtimeOccurrenceAction = 'select';
        button.textContent = results[0].bodyName.split(' / ').slice(0, -1).join(' / ') || results[0].bodyName;
        const exportLabel = document.createElement('label'); exportLabel.title = 'Select generated component solids for export';
        const exportBox = document.createElement('input'); exportBox.type = 'checkbox'; exportBox.dataset.occurrenceExport = occurrenceId;
        exportBox.checked = results.every((entry) => exportBodyIds.has(entry.bodyId)); exportBox.setAttribute('aria-label', 'Select ' + (results[0].bodyName || occurrenceId) + ' solids for export'); exportLabel.appendChild(exportBox);
        child.append(button, exportLabel); tree.appendChild(child);
      }
    }
    for (const mate of assembly.mates) {
      const row = document.createElement('div');
      row.className = 'mate-row' + (mate.id === selectedMateId ? ' is-selected' : '') + (mate.suppressed ? ' is-suppressed' : '') +
        (lastEvaluationTrace?.conflicts?.some((set) => set.includes(mate.id)) ? ' is-failed' : '');
      row.dataset.mateId = mate.id;
      setTreeItemSemantics(row, {
        selected: mate.id === selectedMateId, suppressed: mate.suppressed,
        failed: lastEvaluationTrace?.conflicts?.some((set) => set.includes(mate.id)), label: mate.name,
      });
      const select = document.createElement('button'); select.type = 'button'; select.dataset.mateAction = 'select';
      select.innerHTML = '<span>' + escapeHtml(mate.name) + '</span><small>' + mate.kind + (mate.value != null ? ' · ' + escapeHtml(mate.value) : '') + '</small>';
      const suppress = document.createElement('button'); suppress.type = 'button'; suppress.dataset.mateAction = 'suppress'; suppress.textContent = mate.suppressed ? 'R' : 'S'; suppress.title = mate.suppressed ? 'Restore mate' : 'Suppress mate';
      suppress.setAttribute('aria-label', suppress.title + ' ' + mate.name);
      const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.mateAction = 'delete'; remove.textContent = '×'; remove.title = 'Delete mate'; remove.setAttribute('aria-label', 'Delete mate ' + mate.name);
      row.append(select, suppress, remove); mateTree.appendChild(row);
    }
    const stageGroups = v5InspectionTools.studioV5AxialStageGroups(doc);
    const savedMeasurements = v5InspectionTools.studioV5Measurements(doc);
    const savedCount = assembly.sectionViews.length + assembly.explodedViews.length + stageGroups.length + savedMeasurements.length;
    if ($('bw-inspection-summary')) $('bw-inspection-summary').textContent = savedCount + ' saved';
    const addViewRow = (record, kindLabel, active, kind) => {
      const row = document.createElement('div'); row.className = 'inspection-row' + (active ? ' is-active' : '');
      row.dataset.inspectionKind = kind; row.dataset.inspectionId = record.id;
      setTreeItemSemantics(row, { selected: active, label: record.name + ', ' + kindLabel });
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.dataset.inspectionAction = 'toggle';
      toggle.innerHTML = '<span>' + escapeHtml(record.name) + '</span><small>' + kindLabel + (active ? ' · active' : '') + '</small>';
      const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.inspectionAction = 'delete'; remove.textContent = '×'; remove.title = 'Delete saved ' + kindLabel; remove.setAttribute('aria-label', remove.title + ' ' + record.name);
      row.append(toggle, remove); inspectionTree.appendChild(row);
    };
    for (const section of assembly.sectionViews) addViewRow(section, section.kind + ' section', assembly.metadata?.activeSectionViewId === section.id, 'section');
    for (const exploded of assembly.explodedViews) addViewRow(exploded, 'exploded view', assembly.metadata?.activeExplodedViewId === exploded.id, 'explode');
    for (const group of stageGroups) {
      const row = document.createElement('div'); row.className = 'inspection-row stage-group-row'; row.dataset.inspectionKind = 'stage'; row.dataset.inspectionId = group.id;
      setTreeItemSemantics(row, { expanded: true, hidden: !group.visible, count: group.occurrenceIds.length, label: group.name });
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.dataset.inspectionAction = 'visibility';
      toggle.innerHTML = '<span>' + escapeHtml(group.name) + '</span><small>' + group.occurrenceIds.length + ' stages · ' + group.spacing + ' mm · ' + (group.visible ? 'shown' : 'hidden') + '</small>';
      const less = document.createElement('button'); less.type = 'button'; less.dataset.inspectionAction = 'spacing-less'; less.textContent = '−'; less.title = 'Reduce stage spacing by 5 mm';
      const more = document.createElement('button'); more.type = 'button'; more.dataset.inspectionAction = 'spacing-more'; more.textContent = '+'; more.title = 'Increase stage spacing by 5 mm';
      row.append(toggle, less, more); inspectionTree.appendChild(row);
      group.occurrenceIds.forEach((occurrenceId, index) => {
        const occurrence = assembly.occurrences.find((entry) => entry.id === occurrenceId);
        const mate = assembly.mates.find((entry) => entry.id === group.distanceMateIds[index]);
        const child = document.createElement('div'); child.className = 'assembly-leaf-row stage-leaf-row';
        setTreeItemSemantics(child, { level: 2, hidden: !group.visible, label: occurrence?.name || occurrenceId });
        child.innerHTML = '<span>' + escapeHtml(occurrence?.name || occurrenceId) + '</span><small>' + escapeHtml(mate?.value ?? 'missing') + ' mm</small>';
        inspectionTree.appendChild(child);
      });
    }
    for (const measurement of savedMeasurements) {
      const result = lastInspection?.measurementResults?.find((entry) => entry.id === measurement.id);
      const row = document.createElement('div'); row.className = 'inspection-row measurement-row' + (result?.valid === false ? ' is-failed' : '');
      row.dataset.inspectionKind = 'measurement'; row.dataset.inspectionId = measurement.id;
      setTreeItemSemantics(row, { failed: result?.valid === false, label: measurement.name + ', ' + measurement.kind + ' measurement' });
      const evaluate = document.createElement('button'); evaluate.type = 'button'; evaluate.dataset.inspectionAction = 'evaluate';
      const value = result?.valid ? (Array.isArray(result.value) ? result.value.map((entry) => Number(entry).toFixed(3)).join(' × ') : Number(result.value).toFixed(3)) + ' ' + result.unit : result?.error || 'saved';
      evaluate.innerHTML = '<span>' + escapeHtml(measurement.name) + '</span><small>' + escapeHtml(measurement.kind) + ' · ' + escapeHtml(value) + '</small>';
      const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.inspectionAction = 'delete'; remove.textContent = '×'; remove.title = 'Delete saved measurement'; remove.setAttribute('aria-label', 'Delete saved measurement ' + measurement.name);
      row.append(evaluate, remove); inspectionTree.appendChild(row);
    }
  }

  function renderBodies() {
    const list = $('bw-bodies');
    const empty = $('bw-bodies-empty');
    const activeLabel = $('bw-active-body-label');
    if (!list) return;
    list.replaceChildren();
    if (!v5RuntimeTools.isStudioV5Project(doc)) {
      if (empty) {
        empty.hidden = false;
        empty.textContent = doc.features.length
          ? 'Legacy single body · use + to create another body.'
          : 'The first solid feature creates a body.';
      }
      if (activeLabel) activeLabel.textContent = 'Legacy single body';
      return;
    }
    if (doc.rootDocument?.kind !== 'part') {
      if (empty) empty.hidden = true;
      if (activeLabel) activeLabel.textContent = 'Assembly occurrences';
      syncBodyMeshState();
      return;
    }
    const part = v5RuntimeTools.studioV5RootPart(doc);
    const activeBodyId = part.metadata?.activeBodyId;
    const activeBody = part.bodies.find((body) => body.id === activeBodyId);
    if (activeLabel) activeLabel.textContent = activeBody ? 'Active: ' + activeBody.name : 'No active body';
    if (empty) {
      empty.hidden = part.bodies.length > 0;
      empty.textContent = 'The first solid feature creates a body.';
    }
    for (const body of part.bodies) {
      const result = lastBodyResults.find((entry) => entry.bodyId === body.id);
      const item = document.createElement('li');
      item.className = 'body-row' +
        (body.id === selectedBodyId ? ' is-selected' : '') +
        (body.id === activeBodyId ? ' is-active' : '') +
        (body.suppressed ? ' is-suppressed' : '') +
        (bodyBuildErrors.has(body.id) ? ' is-failed' : '');
      item.dataset.bodyId = body.id;
      setTreeItemSemantics(item, {
        selected: body.id === selectedBodyId, hidden: body.visible === false, suppressed: body.suppressed,
        failed: bodyBuildErrors.has(body.id), label: body.name + (body.id === activeBodyId ? ', active body' : ''),
      });

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'body-select';
      select.dataset.bodyAction = 'select';
      select.setAttribute('aria-pressed', String(body.id === selectedBodyId));
      select.textContent = body.name;
      const detail = document.createElement('small');
      detail.textContent = body.suppressed
        ? 'SUPPRESSED'
        : bodyBuildErrors.has(body.id)
          ? 'FAILED · last valid shown'
          : result?.geometry
            ? result.geometry.solidCount + ' exact solid · ' + Math.round(result.geometry.volume * 100) / 100 + ' mm³'
            : body.kind;
      select.appendChild(detail);

      const actions = document.createElement('span');
      actions.className = 'body-actions';
      const action = (code, label, title) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.bodyAction = code;
        button.textContent = label;
        button.title = title;
        button.setAttribute('aria-label', title + ' ' + body.name);
        actions.appendChild(button);
      };
      action('activate', 'A', body.id === activeBodyId ? 'Active body' : 'Activate body');
      action('visibility', body.visible ? 'V' : 'H', body.visible ? 'Hide body' : 'Show body');
      action('isolate', isolatedBodyId === body.id ? 'ALL' : 'I', isolatedBodyId === body.id ? 'Restore all bodies' : 'Isolate body');
      action('rename', 'N', 'Rename body');
      action('suppress', body.suppressed ? 'R' : 'S', body.suppressed ? 'Restore body' : 'Suppress body');
      const exportLabel = document.createElement('label');
      exportLabel.title = 'Include ' + body.name + ' in selected-body export';
      const exportBox = document.createElement('input');
      exportBox.type = 'checkbox';
      exportBox.dataset.bodyExport = body.id;
      exportBox.checked = exportBodyIds.has(body.id);
      exportBox.setAttribute('aria-label', 'Select ' + body.name + ' for export');
      exportLabel.appendChild(exportBox);
      actions.appendChild(exportLabel);
      action('delete', '×', 'Delete body and dependent features');
      item.append(select, actions);
      list.appendChild(item);
    }
    syncBodyMeshState();
  }

  function selectBody(bodyId) {
    pulseInteractiveResolution();
    selectedBodyId = bodyId;
    const result = lastBodyResults.find((entry) => entry.bodyId === bodyId);
    if (result?.occurrenceInstance) selectedOccurrenceId = result.occurrenceInstance.occurrenceId;
    selectedFeatureId = null;
    if (bodyId) {
      sideEl?.classList.remove('m-open-params', 'm-open-history', 'm-open-project');
      syncMtabs?.();
    }
    renderBodies();
    renderHistory();
    renderContext();
    if (result) {
      const occurrencePath = result.occurrenceInstance?.occurrencePath?.join(' / ');
      say('Selected ' + (result.occurrenceInstance ? 'component body' : 'body') + ': ' + result.bodyName + (occurrencePath ? ' · occurrence path ' + occurrencePath : '') + '.');
    }
  }

  function selectOccurrence(occurrenceId) {
    pulseInteractiveResolution();
    selectedOccurrenceId = occurrenceId;
    selectedMateId = null;
    const result = lastBodyResults.find((entry) => entry.occurrenceInstance?.occurrenceId === occurrenceId);
    selectedBodyId = result?.bodyId || null;
    for (const row of document.querySelectorAll('[data-occurrence-id], [data-runtime-occurrence-id]')) {
      const rowOccurrenceId = row.dataset.occurrenceId || row.dataset.runtimeOccurrenceId;
      const selected = rowOccurrenceId === selectedOccurrenceId;
      row.classList.toggle('is-selected', selected);
      row.setAttribute('aria-selected', String(selected));
    }
    for (const row of document.querySelectorAll('[data-mate-id]')) {
      row.classList.remove('is-selected');
      row.setAttribute('aria-selected', 'false');
    }
    renderContext();
    syncBodyMeshState();
    if (result) say('Selected component occurrence: ' + (result.occurrenceInstance?.occurrencePath?.join(' / ') || occurrenceId) + ' · exact body.');
  }

  $('bw-bodies')?.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-body-export]');
    if (!checkbox) return;
    if (checkbox.checked) exportBodyIds.add(checkbox.dataset.bodyExport);
    else exportBodyIds.delete(checkbox.dataset.bodyExport);
  });

  $('bw-bodies')?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-body-id]');
    const control = event.target.closest('[data-body-action]');
    if (!row || !control || !v5RuntimeTools.isStudioV5Project(doc)) return;
    const bodyId = row.dataset.bodyId;
    const part = v5RuntimeTools.studioV5RootPart(doc);
    const body = part.bodies.find((entry) => entry.id === bodyId);
    if (!body) return;
    const action = control.dataset.bodyAction;
    if (action === 'select') return selectBody(body.id === selectedBodyId ? null : body.id);
    if (action === 'isolate') {
      isolatedBodyId = isolatedBodyId === body.id ? null : body.id;
      renderBodies();
      say(isolatedBodyId ? 'Isolated ' + body.name + '.' : 'All visible bodies restored.');
      return;
    }
    if (action === 'rename') {
      selectBody(body.id);
      requestAnimationFrame(() => $('bw-context')?.querySelector('[data-body-name]')?.focus());
      return;
    }
    if (action === 'activate') {
      commitHumanOperations('Activate ' + body.name, [{ kind: 'body.activate', input: { bodyId: body.id } }]);
      return;
    }
    if (action === 'visibility') {
      commitHumanOperations((body.visible ? 'Hide ' : 'Show ') + body.name, [{ kind: 'body.setVisibility', input: { bodyId: body.id, visible: !body.visible } }]);
      return;
    }
    if (action === 'suppress') {
      commitHumanOperations((body.suppressed ? 'Restore ' : 'Suppress ') + body.name, [{ kind: 'body.suppress', input: { bodyId: body.id, suppressed: !body.suppressed } }]);
      return;
    }
    if (action === 'delete') {
      commitHumanOperations('Delete body ' + body.name, [{ kind: 'body.delete', input: { bodyId: body.id } }]);
    }
  });

  $('bw-datum-tree')?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-datum-id]');
    const action = event.target.closest('[data-datum-action]')?.dataset.datumAction;
    if (!row || !action || !v5RuntimeTools.isStudioV5Project(doc)) return;
    selectedDatumId = row.dataset.datumId;
    selectedBodyId = null;
    selectedFeatureId = null;
    if (action === 'edit') {
      const datum = v5RuntimeTools.studioV5RootPart(doc).referenceGeometry.find((entry) => entry.id === selectedDatumId);
      if (datum?.kind === 'plane') openV5Command('plane', selectedDatumId);
      else say('This increment edits construction planes; axes, points, and coordinate systems remain selectable references.');
    }
    renderDatums();
  });

  $('bw-sketch-tree')?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-sketch-id]');
    const action = event.target.closest('[data-sketch-action]')?.dataset.sketchAction;
    if (!row || !action || !v5RuntimeTools.isStudioV5Project(doc)) return;
    selectedSketchId = row.dataset.sketchId;
    selectedDatumId = null; selectedBodyId = null; selectedFeatureId = null;
    if (action === 'edit') {
      const sketch = v5RuntimeTools.studioV5RootPart(doc).sketches.find((entry) => entry.id === selectedSketchId);
      if (sketch?.extensions?.studioRole === 'profile' || sketch?.extensions?.studioRole === 'path') openV5Command(sketch.extensions.studioRole, null, null, sketch.id);
    }
    renderAdvancedSketches();
  });

  $('bw-pattern-tree')?.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-body-export]');
    if (!checkbox) return;
    if (checkbox.checked) exportBodyIds.add(checkbox.dataset.bodyExport);
    else exportBodyIds.delete(checkbox.dataset.bodyExport);
  });

  async function materializePatternOccurrences(pattern, bodyIds, dissolve) {
    if (pattern.outputMode === 'union') return say('Switch this pattern to Linked occurrences before dissolving or making one occurrence independent.');
    const sourceRevision = documentRevision;
    const sourceHash = v5RuntimeTools.studioV5CanonicalHash(doc);
    const freezePrefix = 'materialized-' + newId();
    try {
      const response = await kernelCall('freeze-pattern-v5', documentRevision, { bodyIds, freezePrefix });
      if (documentRevision !== sourceRevision || v5RuntimeTools.studioV5CanonicalHash(doc) !== sourceHash) {
        throw new Error('The project changed while exact pattern bodies were being materialized. Run the command again.');
      }
      if (response.errors?.length) throw new Error(response.errors[0].message);
      const next = v5RuntimeTools.materializeStudioV5PatternOccurrences(doc, pattern.id, response.records, { dissolve });
      commit(dissolve ? 'Dissolve ' + pattern.name : 'Make pattern occurrence independent', () => next);
      const bodyId = response.records.at(-1)?.body?.id;
      if (bodyId) selectBody(bodyId);
    } catch (error) {
      say('Pattern materialization failed: ' + String(error?.message || error));
    }
  }

  $('bw-pattern-tree')?.addEventListener('click', (event) => {
    if (!v5RuntimeTools.isStudioV5Project(doc)) return;
    const part = v5RuntimeTools.studioV5RootPart(doc);
    const instance = event.target.closest('[data-pattern-instance-id]');
    const instanceAction = event.target.closest('[data-pattern-instance-action]')?.dataset.patternInstanceAction;
    if (instance && instanceAction) {
      if (instanceAction === 'select') return selectBody(instance.dataset.patternInstanceId === selectedBodyId ? null : instance.dataset.patternInstanceId);
      if (instanceAction === 'skip') {
        const pattern = (part.bodyPatterns || []).find((entry) => entry.id === instance.dataset.patternId);
        if (!pattern) return;
        const skippedIndices = [...new Set([...(pattern.skippedIndices || []), Number(instance.dataset.patternIndex)])];
        commit('Skip ' + pattern.name + ' occurrence ' + instance.dataset.patternIndex, () => v5RuntimeTools.updateStudioV5BodyPattern(doc, pattern.id, { skippedIndices }));
        return;
      }
      if (instanceAction === 'independent') {
        const pattern = (part.bodyPatterns || []).find((entry) => entry.id === instance.dataset.patternId);
        if (pattern) materializePatternOccurrences(pattern, [instance.dataset.patternInstanceId], false);
        return;
      }
    }
    const row = event.target.closest('[data-pattern-id]');
    const action = event.target.closest('[data-pattern-action]')?.dataset.patternAction;
    if (!row || !action) return;
    const pattern = (part.bodyPatterns || []).find((entry) => entry.id === row.dataset.patternId);
    if (!pattern) return;
    if (action === 'edit') return openV5Command('pattern', null, null, null, pattern.id);
    if (action === 'visibility') return commit((pattern.visible === false ? 'Show ' : 'Hide ') + pattern.name, () => v5RuntimeTools.updateStudioV5BodyPattern(doc, pattern.id, { visible: pattern.visible === false }));
    if (action === 'dissolve') {
      const bodyIds = lastBodyResults.filter((entry) => entry.patternInstance?.patternId === pattern.id && !entry.patternInstance?.fused && entry.visible !== false).map((entry) => entry.bodyId);
      if (!bodyIds.length) return say('This pattern has no active linked occurrences to dissolve.');
      materializePatternOccurrences(pattern, bodyIds, true);
      return;
    }
    if (action === 'delete') commit('Delete ' + pattern.name, () => v5RuntimeTools.deleteStudioV5BodyPattern(doc, pattern.id));
  });

  $('bw-assembly-tree')?.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-occurrence-export]');
    if (!checkbox) return;
    const results = lastBodyResults.filter((entry) => entry.occurrenceInstance?.occurrenceId === checkbox.dataset.occurrenceExport);
    for (const result of results) {
      if (checkbox.checked) exportBodyIds.add(result.bodyId);
      else exportBodyIds.delete(result.bodyId);
    }
  });

  $('bw-assembly-tree')?.addEventListener('click', (event) => {
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'assembly') return;
    const runtime = event.target.closest('[data-runtime-occurrence-id]');
    if (runtime && event.target.closest('[data-runtime-occurrence-action="select"]')) return selectOccurrence(runtime.dataset.runtimeOccurrenceId);
    const row = event.target.closest('[data-occurrence-id]');
    const action = event.target.closest('[data-occurrence-action]')?.dataset.occurrenceAction;
    if (!row || !action) return;
    const assembly = v5RuntimeTools.studioV5RootAssembly(doc);
    const occurrence = assembly.occurrences.find((entry) => entry.id === row.dataset.occurrenceId);
    if (!occurrence) return;
    if (action === 'select') return selectOccurrence(occurrence.id);
    if (action === 'visibility') return commit((occurrence.visible ? 'Hide ' : 'Show ') + occurrence.name, () => v5RuntimeTools.updateStudioV5ComponentOccurrence(doc, occurrence.id, { visible: !occurrence.visible }));
    if (action === 'suppress') return commit((occurrence.suppressed ? 'Restore ' : 'Suppress ') + occurrence.name, () => v5RuntimeTools.updateStudioV5ComponentOccurrence(doc, occurrence.id, { suppressed: !occurrence.suppressed }));
  });

  $('bw-mate-tree')?.addEventListener('click', (event) => {
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'assembly') return;
    const row = event.target.closest('[data-mate-id]');
    const action = event.target.closest('[data-mate-action]')?.dataset.mateAction;
    if (!row || !action) return;
    const mate = v5RuntimeTools.studioV5RootAssembly(doc).mates.find((entry) => entry.id === row.dataset.mateId);
    if (!mate) return;
    if (action === 'select') {
      selectedMateId = mate.id; selectedOccurrenceId = null; selectedBodyId = null; renderHistory(); renderContext(); say('Selected ' + mate.kind + ' mate: ' + mate.name + '.'); return;
    }
    if (action === 'suppress') return commit((mate.suppressed ? 'Restore ' : 'Suppress ') + mate.name, () => v5RuntimeTools.updateStudioV5AssemblyMate(doc, mate.id, { suppressed: !mate.suppressed }));
    if (action === 'delete') return commit('Delete ' + mate.name, () => v5RuntimeTools.deleteStudioV5AssemblyMate(doc, mate.id));
  });

  $('bw-inspection-tree')?.addEventListener('click', (event) => {
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'assembly') return;
    const row = event.target.closest('[data-inspection-kind]');
    const action = event.target.closest('[data-inspection-action]')?.dataset.inspectionAction;
    if (!row || !action) return;
    const assembly = v5RuntimeTools.studioV5RootAssembly(doc);
    const id = row.dataset.inspectionId;
    if (row.dataset.inspectionKind === 'section') {
      const active = assembly.metadata?.activeSectionViewId === id;
      if (action === 'toggle') return commit((active ? 'Turn off ' : 'Activate ') + 'section view', () => v5InspectionTools.activateStudioV5SectionView(doc, active ? null : id));
      if (action === 'delete') return commit('Delete section view', () => v5InspectionTools.deleteStudioV5SectionView(doc, id));
    }
    if (row.dataset.inspectionKind === 'explode') {
      const active = assembly.metadata?.activeExplodedViewId === id;
      if (action === 'toggle') return commit((active ? 'Turn off ' : 'Activate ') + 'exploded view', () => v5InspectionTools.activateStudioV5ExplodedView(doc, active ? null : id));
      if (action === 'delete') return commit('Delete exploded view', () => v5InspectionTools.deleteStudioV5ExplodedView(doc, id));
    }
    if (row.dataset.inspectionKind === 'stage') {
      const group = v5InspectionTools.studioV5AxialStageGroups(doc).find((entry) => entry.id === id);
      if (!group) return;
      if (action === 'visibility') return commit((group.visible ? 'Hide ' : 'Show ') + group.name, () => v5InspectionTools.updateStudioV5AxialStageGroup(doc, id, { visible: !group.visible }));
      if (action === 'spacing-less' || action === 'spacing-more') return commit('Edit ' + group.name + ' spacing', () => v5InspectionTools.updateStudioV5AxialStageGroup(doc, id, { spacing: group.spacing + (action === 'spacing-more' ? 5 : -5) }));
    }
    if (row.dataset.inspectionKind === 'measurement') {
      if (action === 'evaluate') return runV5Inspection('measurements');
      if (action === 'delete') return commit('Delete measurement', () => v5InspectionTools.deleteStudioV5Measurement(doc, id));
    }
  });

  // --- history panel -------------------------------------------------------
  function renderHistory() {
    const list = $('bw-history');
    list.innerHTML = '';
    renderBodies();
    renderDatums();
    renderAdvancedSketches();
    renderBodyPatterns();
    renderAssemblyTree();
    const assemblyRoot = v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly';
    if (assemblyRoot && activeWorkspace === 'solid') showWorkspace('assembly', false);
    if (!assemblyRoot && activeWorkspace === 'assembly') showWorkspace('solid', false);
    if ($('bw-project-name')) $('bw-project-name').textContent = doc.title;
    if ($('bw-tab-project-name')) $('bw-tab-project-name').textContent = doc.title;
    if ($('bw-tree-project-name')) $('bw-tree-project-name').textContent = doc.title;
    const featureMark = { extrude: 'EX', cut: 'CU', revolve: 'RV', draft: 'DR', thicken: 'TH', 'boolean-split-side': 'SP', 'imported-step': 'BR', fillet: 'FL', chamfer: 'CH', shell: 'SH', boolean: 'BO', transform: 'TR', loft: 'LF', sweep: 'SW' };
    const historyPart = v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'part' ? v5RuntimeTools.studioV5RootPart(doc) : null;
    const rollbackFeatureId = historyPart?.metadata?.rollbackFeatureId || null;
    const rollbackIndex = rollbackFeatureId ? doc.features.findIndex((feature) => feature.id === rollbackFeatureId) : -1;
    doc.features.forEach((f, i) => {
      const li = document.createElement('li');
      li.className = 'hist-item' + (buildErrors.has(f.id) ? ' err' : '') + (f.id === selectedFeatureId ? ' sel' : '') + (f.id === rollbackFeatureId ? ' rollback' : '') + (rollbackIndex >= 0 && i > rollbackIndex ? ' rolled-back' : '');
      li.dataset.sel = f.id;
      li.dataset.feature = f.type;
      li.draggable = Boolean(historyPart);
      const dims =
        f.type === 'loft'
          ? f.sections.length + ' sections · ' + (f.guideSketchIds?.length || 0) + ' guide'
        : f.type === 'sweep'
          ? f.orientation + ' · twist ' + (f.twistAngle ?? 0) + '°'
        : f.type === 'transform'
          ? (f.transform?.mode || f.operation || 'transform') + (f.resultPolicy?.kind === 'new-body' ? ' · linked body' : ' · ' + (f.resultPolicy?.targetBodyIds?.length || 1) + ' body')
        : f.type === 'boolean'
          ? (f.operation || f.resultPolicy?.kind || 'boolean') + ' · ' + (f.toolBodyIds?.length || 0) + ' tool body'
        : f.type === 'draft'
          ? f.angle + '° · ' + f.faces.length + ' face' + (f.faces.length === 1 ? '' : 's')
        : f.type === 'thicken'
          ? f.thickness + ' mm · linked face body'
        : f.type === 'boolean-split-side'
          ? f.side + ' side · body tool'
        : f.type === 'imported-step'
          ? 'independent exact B-rep · no parametric source history'
        : f.type === 'fillet' || f.type === 'chamfer'
          ? (f.variableRadii?.length ? 'r ' + f.variableRadii[0].startRadius + '→' + f.variableRadii[0].endRadius : 'r ' + f.r) + ' mm · ' + f.edges.length + ' edge' + (f.edges.length === 1 ? '' : 's')
          : f.type === 'shell'
            ? f.t + ' mm walls · ' + f.faces.length + ' opening' + (f.faces.length === 1 ? '' : 's')
            : f.type === 'revolve'
              ? f.profileSketchId ? f.angle + '° partial · editable profile' : 'profile ×' + f.sketch.shapes.length
              : (f.through ? 'through' : f.h + ' mm') + ' · ' + f.sketch.shapes.length + ' shape' + (f.sketch.shapes.length === 1 ? '' : 's') + (f.onFace ? ' · on face' : '') + (f.pattern?.n > 1 ? ' · ×' + f.pattern.n : '');
      li.innerHTML =
        '<button type="button" class="hi-sel" data-sel="' + f.id + '" aria-pressed="' + (f.id === selectedFeatureId) + '">' +
        '<span class="hi-glyph" aria-hidden="true">' + (featureMark[f.type] || 'FT') + '</span>' +
        '<span class="hi-n">' + (i + 1) + '. ' + OP_LABEL[f.type] + '</span>' +
        '<span class="hi-d">' + dims + (buildErrors.has(f.id) ? ' · FAILED' : '') + '</span>' +
        '</button>' +
        '<span class="hi-a">' +
        (historyPart ? '<button data-move-feature="up" title="Move earlier" aria-label="Move ' + OP_LABEL[f.type] + ' earlier"' + (i === 0 ? ' disabled' : '') + '>↑</button><button data-move-feature="down" title="Move later" aria-label="Move ' + OP_LABEL[f.type] + ' later"' + (i === doc.features.length - 1 ? ' disabled' : '') + '>↓</button><button data-rollback-feature="' + f.id + '" title="' + (f.id === rollbackFeatureId ? 'Clear rollback marker' : 'Roll back after this feature') + '" aria-pressed="' + (f.id === rollbackFeatureId) + '">⏮</button>' : '') +
        (f.type === 'boolean' || f.type === 'boolean-split-side' || f.type === 'imported-step' ? '' : '<button data-edit="' + f.id + '">' + (buildErrors.has(f.id) ? 'Repair' : 'Edit') + '</button>') + '<button data-del="' + f.id + '">×</button></span>';
      list.appendChild(li);
    });
    $('bw-hist-empty').hidden = doc.features.length > 0;
    const st = $('bw-status-feat');
    if (st) st.textContent = doc.features.length + ' feature' + (doc.features.length === 1 ? '' : 's');
    const summary = $('bw-tree-summary');
    if (summary) summary.textContent = doc.features.length + ' feature' + (doc.features.length === 1 ? '' : 's');
    // Kernel replies rebuild the history DOM. If the guided tour is pointing
    // at a feature row while that happens, rebind its highlight to the fresh
    // node instead of leaving the walkthrough visibly detached.
    const openTour = $('bw-tour');
    if (openTour && !openTour.hidden) queueMicrotask(() => {
      if (!openTour.hidden) refreshTourTarget();
    });
  }

  $('bw-history').addEventListener('click', (e) => {
    const editId = e.target.dataset?.edit, delId = e.target.dataset?.del;
    const moveDirection = e.target.dataset?.moveFeature;
    const rollbackId = e.target.dataset?.rollbackFeature;
    if (moveDirection || rollbackId) {
      if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'part') return;
      try {
        if (rollbackId) {
          const part = v5RuntimeTools.studioV5RootPart(doc);
          return commit(part.metadata?.rollbackFeatureId === rollbackId ? 'Clear rollback marker' : 'Set rollback marker', () =>
            v5RuntimeTools.setStudioV5RollbackMarker(doc, part.metadata?.rollbackFeatureId === rollbackId ? null : rollbackId));
        }
        const row = e.target.closest('.hist-item');
        const index = doc.features.findIndex((feature) => feature.id === row?.dataset.sel);
        if (index < 0) return;
        const beforeFeatureId = moveDirection === 'up'
          ? doc.features[index - 1]?.id
          : doc.features[index + 2]?.id || null;
        commit('Reorder feature history', () => v5RuntimeTools.reorderStudioV5Feature(doc, row.dataset.sel, beforeFeatureId));
      } catch (error) { say('Cannot reorder history: ' + String(error?.message || error)); }
      return;
    }
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
        commitHumanOperations('Delete ' + (gone ? OP_LABEL[gone.type].toLowerCase() : 'feature'), [{ kind: 'feature.delete', input: { featureId: delId } }]);
      });
    }
    if (editId) {
      const f = doc.features.find((x) => x.id === editId);
      if (f?.type === 'transform') openV5Command(f.transform?.mode || f.operation || 'move', null, f.id);
      else if (f?.type === 'loft' || f?.type === 'sweep') openV5Command(f.type, null, f.id);
      else if (f?.type === 'revolve' && f.profileSketchId) openV5Command('revolve-advanced', null, f.id);
      else if (f?.type === 'draft' || f?.type === 'thicken' || (f?.type === 'fillet' && Array.isArray(f.variableRadii))) openV5Command(f.type === 'fillet' ? 'variable-fillet' : f.type, null, f.id);
      else if (f) startOperation(() => openEditorFor(f));
    }
  });

  let draggedHistoryFeatureId = null;
  $('bw-history').addEventListener('dragstart', (event) => {
    const row = event.target.closest('.hist-item');
    if (!row?.draggable) return;
    draggedHistoryFeatureId = row.dataset.sel;
    row.classList.add('dragging');
    event.dataTransfer?.setData('text/plain', draggedHistoryFeatureId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  $('bw-history').addEventListener('dragover', (event) => {
    if (!draggedHistoryFeatureId || !event.target.closest('.hist-item')) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  });
  $('bw-history').addEventListener('drop', (event) => {
    const target = event.target.closest('.hist-item');
    if (!draggedHistoryFeatureId || !target || target.dataset.sel === draggedHistoryFeatureId) return;
    event.preventDefault();
    try {
      commit('Reorder feature history', () => v5RuntimeTools.reorderStudioV5Feature(doc, draggedHistoryFeatureId, target.dataset.sel));
    } catch (error) { say('Cannot reorder history: ' + String(error?.message || error)); }
  });
  $('bw-history').addEventListener('dragend', () => {
    draggedHistoryFeatureId = null;
    $('bw-history').querySelectorAll('.dragging').forEach((row) => row.classList.remove('dragging'));
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
        commitHumanOperations('Rename parameter', [{
          kind: 'parameter.update',
          input: { ...(doc.params[i].id ? { parameterId: doc.params[i].id } : { parameterName: doc.params[i].name }), name },
        }]);
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
        commitHumanOperations('Set ' + doc.params[i].name + ' = ' + v, [{
          kind: 'parameter.update',
          input: { ...(doc.params[i].id ? { parameterId: doc.params[i].id } : { parameterName: doc.params[i].name }), value: v },
        }]);
      }),
    );
    wrap.querySelectorAll('[data-pdel]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const parameter = doc.params[Number(btn.dataset.pdel)];
        commitHumanOperations('Delete parameter', [{
          kind: 'parameter.delete',
          input: parameter.id ? { parameterId: parameter.id } : { parameterName: parameter.name },
        }]);
      }),
    );
  }
  $('bw-param-add').addEventListener('click', () => {
    let i = 1;
    while ((doc.params || []).some((p) => p.name === 'p' + i)) i++;
    commitHumanOperations('Add parameter', [{
      kind: 'parameter.create',
      input: { id: 'parameter-' + newId(), name: 'p' + i, value: 10 },
    }]);
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
        if (active?.document && (active.document.schemaVersion === 5 || Array.isArray(active.document.features))) {
          const restored = hydrateProjectRecord(active, (candidate) => prepareStoredDocument(candidate, prepareStudioDocument));
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
      if (d && (d.schemaVersion === 5 || Array.isArray(d.features))) doc = normalizeDoc(prepareStoredDocument(d, prepareStudioDocument));
      else doc = normalizeDoc(doc);
    } catch {}
    // Import the compatibility localStorage document into the durable journal.
    save();
  }
  $('bw-save-file').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = v5RuntimeTools.isStudioV5Project(doc) ? 'project.bomcad.json' : 'part.bomcad.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('bw-open-btn')?.addEventListener('click', () => $('bw-open-file').click());
  $('bw-open-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // allow re-opening the same file later
    let d;
    let importManifest = null;
    const isStep = /\.(step|stp)$/i.test(file.name);
    if (isStep) {
      const importProjectId = projectId;
      const importRevision = documentRevision;
      try {
        const response = await importStepWithKernelRecovery(file, file.name, importRevision);
        if (projectId !== importProjectId || documentRevision !== importRevision) {
          return say('STEP import was discarded because the project changed while the file was loading.');
        }
        d = v5RuntimeTools.decorateStudioV5Project(v5RuntimeTools.canonicalStudioV5Project(response.project));
        importManifest = response.manifest;
      } catch (error) {
        return say('Could not import STEP: ' + String(error?.message || error));
      }
    } else {
      try {
        d = v5RuntimeTools.parseOrMigrateStudioV5RuntimeProject(await file.text());
      } catch (error) {
        return say('Could not open project: ' + String(error?.message || error));
      }
    }
    // Replacing the document while an editor is open must go through the
    // coordinator: prompt for a dirty draft, cancel editors, then switch
    // projects atomically without merging their command journals.
    startOperation(() => {
      projectId = d.projectId || makeProjectId();
      doc = normalizeDoc(d);
      undoStack.length = 0;
      redoStack.length = 0;
      afterDocumentChange();
      resetAgentForProjectChange('Opened another project');
      setFlag(SEEDED);
      setFlag(WELCOME);
      hideWelcome();
      say(importManifest
        ? 'STEP imported as ' + importManifest.bodyCount + ' exact bod' + (importManifest.bodyCount === 1 ? 'y definition' : 'y definitions') +
          (importManifest.importMode === 'bomwiki-solved-hierarchy'
            ? ' with solved assembly hierarchy.'
            : importManifest.importMode === 'external-product-hierarchy'
              ? ' with recovered external product hierarchy.'
              : ' with a flat solid fallback; external product hierarchy was not available.')
        : 'Project opened.');
    });
  });

  // --- export --------------------------------------------------------------
  function selectedExportBodyIds() {
    if (!v5RuntimeTools.isStudioV5Project(doc)) return [];
    if (exportBodyIds.size) return [...exportBodyIds];
    if (selectedBodyId) return [selectedBodyId];
    return lastBodyResults.filter((body) => body.visible !== false && !body.suppressed && body.geometry?.valid).map((body) => body.bodyId);
  }
  async function exportBlob(kind) {
    const hasExportableBodies = v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly'
      ? lastBodyResults.some((body) => body.visible !== false && !body.suppressed && body.geometry?.valid)
      : Boolean(doc.features.length);
    if (!hasExportableBodies) return say('Add a feature or visible component body first.');
    let response;
    try {
      response = await kernelCall(kind === 'step' ? 'export-step' : 'export-stl', documentRevision, {
        bodyIds: selectedExportBodyIds(),
      });
    } catch (error) {
      return say('Export failed: ' + String(error?.message || error));
    }
    if (!response.blob || response.errors?.length) {
      return say('A feature is failing (marked red) — fix or delete it first, so the exported file matches your design.');
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(response.blob);
    const count = response.manifest?.bodyCount || 1;
    a.download = kind === 'step' ? (count === 1 ? 'selected-body.step' : 'selected-bodies.step') : (count === 1 ? 'selected-body.stl' : 'selected-bodies.stl');
    a.click();
    URL.revokeObjectURL(a.href);
    say(kind === 'step'
      ? 'STEP exported with ' + count + ' named bod' + (count === 1 ? 'y' : 'ies') + ' in millimetres.'
      : 'STL exported with ' + count + ' selected bod' + (count === 1 ? 'y' : 'ies') + ' (STL does not preserve names or units).');
  }
  $('bw-export-stl').addEventListener('click', () => exportBlob('stl'));
  $('bw-export-step').addEventListener('click', () => exportBlob('step'));
  $('bw-clear').addEventListener('click', () => {
    startOperation(openClearDecision, { nextLabel: 'clear this part' });
  });

  // --- 2D sketcher ---------------------------------------------------------
  const sketch = (() => {
    const wrap = $('bw-sketch');
    const canvas = $('bw-sketch-canvas');
    const ctx = canvas.getContext('2d');
    const pressPull = $('bw-presspull');
    let feature = null; // DRAFT copy being edited; the document is untouched until Apply
    let isNew = false;
    let tool = 'rect';
    let pending = null; // in-progress placement
    let view = { cx: 0, cy: 0, pxPerMm: 6 };
    let selShape = null;
    let refOutline = [];
    let previewGroup = null;
    let previewCamera = null;
    let pullDrag = null;

    function wrapOpenMode() {
      setMode({ kind: 'sketching', tool, featureType: feature.type });
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
        $('bw-sk-result')?.value,
        $('bw-sk-body-name')?.value,
        $('bw-sk-target')?.value,
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
      const resultRow = $('bw-sk-result-row');
      const isV5 = v5RuntimeTools.isStudioV5Project(doc);
      const part = isV5 ? v5RuntimeTools.studioV5RootPart(doc) : null;
      const policy = f.resultPolicy || null;
      resultRow.hidden = !(isV5 || policy);
      if (!resultRow.hidden) {
        const activeBodyId = part?.metadata?.activeBodyId;
        $('bw-sk-result').value = policy?.kind || (activeBodyId ? (f.type === 'cut' ? 'subtract' : 'add') : 'new-body');
        const created = part?.bodies.find((body) => body.createdByFeatureId === f.id);
        $('bw-sk-body-name').value = created?.name || policy?.bodyName || 'Body ' + ((part?.bodies.length || 0) + 1);
        const target = $('bw-sk-target');
        target.replaceChildren();
        for (const body of part?.bodies || []) {
          const option = document.createElement('option');
          option.value = body.id;
          option.textContent = body.name;
          target.appendChild(option);
        }
        target.value = policy?.targetBodyIds?.[0] || activeBodyId || target.options[0]?.value || '';
        syncResultFields();
      }
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
    function syncResultFields() {
      const kind = $('bw-sk-result').value;
      $('bw-sk-body-name-row').hidden = kind !== 'new-body';
      $('bw-sk-target-row').hidden = kind === 'new-body';
    }
    $('bw-sk-result')?.addEventListener('change', syncResultFields);

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
      if (!pressPull.hidden) leavePressPull(false);
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
        if (!$('bw-sk-result-row').hidden) {
          const resultKind = $('bw-sk-result').value;
          if (resultKind === 'new-body') {
            const bodyName = $('bw-sk-body-name').value.trim();
            if (!bodyName) return say('Name the new body before applying.');
            feature.resultPolicy = { kind: 'new-body', bodyName };
            feature.createdBodyId ||= 'body-' + feature.id;
          } else {
            const targetBodyId = $('bw-sk-target').value;
            if (!targetBodyId) return say('Choose a target body.');
            feature.resultPolicy = resultKind === 'add'
              ? { kind: 'add', targetBodyIds: [targetBodyId] }
              : { kind: resultKind, targetBodyIds: [targetBodyId], keepTools: false };
          }
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
            commitFeatureDraft((wasNew ? 'Add ' : 'Edit ') + OP_LABEL[draft.type].toLowerCase(), draft, wasNew);
        }
      }
      wrap.hidden = true;
      pressPull.hidden = true;
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
      if (feature) {
        const prompt = t === 'line' ? 'Line · specify first point' : null;
        setMode({ kind: 'sketching', tool: t, featureType: feature.type, prompt });
      }
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

    function threeShape(s) {
      const shape = new THREE.Shape();
      if (s.kind === 'rect') {
        const sw = NS(s.w, 1), sh = NS(s.h, 1), sx = NS(s.x, 0), sy = NS(s.y, 0);
        shape.moveTo(sx - sw / 2, sy - sh / 2);
        shape.lineTo(sx + sw / 2, sy - sh / 2);
        shape.lineTo(sx + sw / 2, sy + sh / 2);
        shape.lineTo(sx - sw / 2, sy + sh / 2);
        shape.closePath();
      } else if (s.kind === 'circle') {
        shape.absarc(NS(s.x, 0), NS(s.y, 0), Math.max(0.1, NS(s.r, 1)), 0, Math.PI * 2, false);
      } else if (s.kind === 'poly') {
        s.pts.forEach((p, i) => i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1]));
        shape.closePath();
      }
      return shape;
    }

    function dropPressPullPreview() {
      if (!previewGroup) return;
      partGroup.remove(previewGroup);
      previewGroup.traverse((child) => {
        child.geometry?.dispose?.();
        child.material?.dispose?.();
      });
      previewGroup = null;
    }

    function renderPressPullPreview(height, frameIt = false) {
      if (!feature || !selShape) return;
      dropPressPullPreview();
      const depth = Math.max(0.5, Math.min(10000, Number(height) || 0.5));
      feature.h = depth;
      $('bw-sk-op-h').value = String(depth);
      $('bw-presspull-h').value = String(depth);
      $('bw-presspull-readout').textContent = (Number.isInteger(depth) ? depth : depth.toFixed(1)) + ' mm';
      const geometry = new THREE.ExtrudeGeometry(threeShape(selShape), {
        depth,
        bevelEnabled: false,
        curveSegments: 48,
      });
      geometry.translate(0, 0, NS(feature.sketch.z, 0));
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0x66a9da, metalness: 0.08, roughness: 0.48, transparent: true, opacity: 0.88 }),
      );
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 24),
        new THREE.LineBasicMaterial({ color: 0xd9f0ff, transparent: true, opacity: 0.82 }),
      );
      previewGroup = new THREE.Group();
      previewGroup.userData.pressPullPreview = true;
      previewGroup.add(mesh, edges);
      partGroup.add(previewGroup);
      if (frameIt) {
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        const centre = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const worldCentre = new THREE.Vector3(centre.x, centre.z, -centre.y);
        const radius = Math.max(18, size.length() * 0.72);
        orbit.target.copy(worldCentre);
        camera.position.copy(worldCentre).add(new THREE.Vector3(radius * 1.05, radius * 0.82, radius * 1.28));
        camera.near = Math.max(0.05, radius / 100);
        camera.far = Math.max(8000, radius * 80);
        camera.updateProjectionMatrix();
        orbit.update();
      }
      setMode({ kind: 'press-pull', featureType: feature.type, height: depth });
    }

    function canPressPull() {
      return Boolean(
        feature && isNew && selShape && feature.type === 'extrude' && !feature.onFace && !feature.pattern && feature.sketch.shapes.length === 1,
      );
    }

    function startPressPull() {
      if (!canPressPull()) return say('Press / Pull is available for one base-plane Extrude profile.');
      pending = null;
      previewCamera = {
        position: camera.position.clone(),
        target: orbit.target.clone(),
        near: camera.near,
        far: camera.far,
      };
      wrap.hidden = true;
      pressPull.hidden = false;
      appEl?.classList.add('is-presspull');
      orbit.enabled = false;
      renderPressPullPreview(Math.max(0.5, NS(feature.h, 20)), true);
      requestAnimationFrame(() => renderer.domElement.focus());
    }

    function leavePressPull(returnToSketch, keepPreviewView = false) {
      pullDrag = null;
      dropPressPullPreview();
      pressPull.hidden = true;
      appEl?.classList.remove('is-presspull');
      orbit.enabled = true;
      if (!keepPreviewView && previewCamera) {
        camera.position.copy(previewCamera.position);
        orbit.target.copy(previewCamera.target);
        camera.near = previewCamera.near;
        camera.far = previewCamera.far;
        camera.updateProjectionMatrix();
        orbit.update();
      }
      if (returnToSketch && feature) {
        wrap.hidden = false;
        setTool('select');
        resize();
        draw2d();
        requestAnimationFrame(() => canvas.focus());
      }
      previewCamera = null;
    }

    function applyPressPull() {
      if (!feature) return;
      const height = Number($('bw-presspull-h').value);
      if (!Number.isFinite(height) || height < 0.5 || height > 10000) {
        say('Press / Pull distance must be between 0.5 and 10,000 mm.');
        return;
      }
      feature.h = height;
      $('bw-sk-op-h').value = String(height);
      // Preserve the view the user chose while shaping the solid. Back and
      // Cancel restore the pre-command camera; a successful Apply should not
      // make the finished part jump away from the preview.
      leavePressPull(false, true);
      close(true);
    }

    $('bw-presspull-apply').addEventListener('click', applyPressPull);
    $('bw-presspull-back').addEventListener('click', () => leavePressPull(true));
    $('bw-presspull-h').addEventListener('input', (event) => {
      const height = Number(event.target.value);
      if (Number.isFinite(height) && height >= 0.5 && height <= 10000) renderPressPullPreview(height);
    });

    renderer.domElement.addEventListener('pointerdown', (event) => {
      if (mode.kind !== 'press-pull' || event.button !== 0) return;
      event.preventDefault();
      pullDrag = { pointerId: event.pointerId, y: event.clientY, height: Math.max(0.5, Number($('bw-presspull-h').value) || 0.5) };
      renderer.domElement.setPointerCapture(event.pointerId);
    });
    renderer.domElement.addEventListener('pointermove', (event) => {
      if (!pullDrag || event.pointerId !== pullDrag.pointerId) return;
      const height = Math.max(0.5, Math.min(10000, Math.round((pullDrag.height + (pullDrag.y - event.clientY) / 3) * 2) / 2));
      renderPressPullPreview(height);
    });
    const finishPullDrag = (event) => {
      if (!pullDrag || event.pointerId !== pullDrag.pointerId) return;
      pullDrag = null;
      try { renderer.domElement.releasePointerCapture(event.pointerId); } catch {}
    };
    renderer.domElement.addEventListener('pointerup', finishPullDrag);
    renderer.domElement.addEventListener('pointercancel', finishPullDrag);

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
        if (pending.snapClose) {
          ctx.fillStyle = 'rgba(230,126,34,0.14)';
          ctx.fill();
        }
        ctx.stroke();
        ctx.setLineDash([]);
        if (tool === 'line' && pending.kind === 'poly') drawLineFeedback(pending);
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

    function drawLineFeedback(line) {
      const committed = line.pts.slice(0, -1);
      const cursor = line.pts[line.pts.length - 1];
      for (let i = 0; i < committed.length; i++) {
        const [px, py] = toPx(committed[i][0], committed[i][1]);
        ctx.beginPath();
        ctx.fillStyle = i === 0 && line.snapClose ? '#65c18c' : '#ecf3f9';
        ctx.arc(px, py, i === 0 ? 4.2 : 3.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#15202a';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      const previous = committed[committed.length - 1];
      if (!previous || !cursor) return;
      const dx = cursor[0] - previous[0], dy = cursor[1] - previous[1];
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const [px, py] = toPx((previous[0] + cursor[0]) / 2, (previous[1] + cursor[1]) / 2);
      const label = line.snapClose ? 'CLOSE PROFILE' : length.toFixed(1) + ' mm  ' + Math.round(angle) + '°';
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(12,19,26,.94)';
      ctx.fillRect(px - tw / 2 - 6, py - 25, tw + 12, 19);
      ctx.strokeStyle = line.snapClose ? '#65c18c' : '#536b80';
      ctx.strokeRect(px - tw / 2 - 6, py - 25, tw + 12, 19);
      ctx.fillStyle = line.snapClose ? '#9fe1b8' : '#d9e5ee';
      ctx.fillText(label, px - tw / 2, py - 11);
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
      if (tool !== 'poly' || pending?.kind !== 'poly') return;
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

    function finishLineProfile() {
      if (tool !== 'line' || pending?.kind !== 'poly') return false;
      const pts = [];
      for (const point of pending.pts.slice(0, -1)) {
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= 0.5) pts.push(point);
      }
      if (pts.length < 3) {
        say('A closed profile needs at least three connected lines.');
        return false;
      }
      const shape = { kind: 'poly', pts, closed: true };
      feature.sketch.shapes.push(shape);
      selShape = shape;
      pending = null;
      setTool('select');
      draw2d();
      syncShapePanel();
      say('Closed profile recognised — the region is ready to Press / Pull.');
      return true;
    }

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
      } else if (tool === 'line') {
        if (!pending) {
          pending = { kind: 'poly', pts: [[mx, my], [mx, my]], closed: false, sourceTool: 'line', snapClose: false };
          setMode({ kind: 'sketching', tool: 'line', featureType: feature.type, prompt: 'Line · specify next point · click the first endpoint to close' });
        } else {
          const first = pending.pts[0];
          const committed = pending.pts.slice(0, -1);
          const closeDistance = Math.max(0.75, 10 / view.pxPerMm);
          if (committed.length >= 3 && Math.hypot(mx - first[0], my - first[1]) <= closeDistance) {
            finishLineProfile();
          } else {
            pending.pts[pending.pts.length - 1] = [mx, my];
            pending.pts.push([mx, my]);
            pending.snapClose = false;
            draw2d();
          }
        }
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
        const first = pending.pts[0];
        const committed = pending.pts.slice(0, -1);
        const closeDistance = Math.max(0.75, 10 / view.pxPerMm);
        pending.snapClose = tool === 'line' && committed.length >= 3 && Math.hypot(mx - first[0], my - first[1]) <= closeDistance;
        pending.pts[pending.pts.length - 1] = pending.snapClose ? [...first] : [mx, my];
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
      else p.innerHTML = '<span class="sk-note">Closed region · ' + s.pts.length + ' edges</span><button id="bw-sk-delshape">Delete shape</button>';
      if (canPressPull()) p.insertAdjacentHTML('beforeend', '<button type="button" class="sk-pull" id="bw-sk-presspull">Press / Pull ↕</button>');
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
      $('bw-sk-presspull')?.addEventListener('click', startPressPull);
    }

    return {
      open,
      resize,
      isOpen: () => Boolean(feature),
      cancel: () => {
        if (feature) close(false);
      },
      cancelStep: () => {
        if (!pending) return false;
        pending = null;
        setMode({ kind: 'sketching', tool, featureType: feature.type, prompt: tool === 'line' ? 'Line · specify first point' : null });
        draw2d();
        return true;
      },
      finishPending: () => finishLineProfile(),
      applyPressPull,
      backFromPressPull: () => leavePressPull(true),
      previewTriangles: () => {
        const mesh = previewGroup?.children?.find((child) => child.isMesh);
        const g = mesh?.geometry;
        return g ? (g.getIndex() ? g.getIndex().count / 3 : g.getAttribute('position').count / 3) : 0;
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
        const selected = edgeSignaturesForLine(line).filter((candidate) => f.edges.some((sig) => sigMatches2(sig, candidate)));
        setEdgePickedSignatures(line, selected);
      }
      syncCount();
      // A deferred command handoff can leave focus in the now-hidden sketch
      // form. Put keyboard ownership on the canvas so Escape reliably cancels
      // the picker instead of merely blurring a stale input.
      renderer.domElement.focus({ preventScroll: true });
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
        const picked = edgeLines.flatMap((line) => edgeSignaturesForLine(line)
          .filter((signature) => line.userData.pickedSignatures?.has(edgeSignatureKey(signature))));
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
            commitFeatureDraft((wasNew ? 'Add ' : 'Edit ') + OP_LABEL[draft.type].toLowerCase(), draft, wasNew);
        }
        for (const line of edgeLines) setEdgePickedSignatures(line);
        bar.hidden = true;
        feature = null;
        setMode({ kind: 'idle' });
        if (run) run();
      } else {
        for (const line of edgeLines) setEdgePickedSignatures(line);
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
      const n = edgeLines.reduce((total, line) => total + (line.userData.pickedSignatures?.size || 0), 0);
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
      const signature = edgeSignatureForHit(hit);
      if (!hit || !signature) return;
      const line = hit.object;
      const selected = new Set(line.userData.pickedSignatures || []);
      const key = edgeSignatureKey(signature);
      if (selected.has(key)) selected.delete(key); else selected.add(key);
      setEdgePickedSignatures(line, edgeSignaturesForLine(line).filter((candidate) => selected.has(edgeSignatureKey(candidate))));
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
    edges: () => edgeLines.reduce((total, line) => total + edgeSignaturesForLine(line).length, 0),
    edgeDrawObjects: () => edgeLines.length,
    sceneBatchDrawObjects: () => sceneBatchObjects.length
      + sectionCapObjects.filter((entry) => entry.userData.sectionCapStencil).length
      + sectionCapObjects.filter((entry) => entry.userData.sectionCapPlane).length,
    sceneBatchBodyCount: () => sceneSolidBatchEntries.size,
    sceneInteractiveBatchDrawObjects: () => sceneInteractiveBatchObjects.length,
    sceneInteractiveBodyCount: () => sceneInteractiveSolidBatchEntries.size,
    sceneInteractiveTriangleCount: () => sceneInteractiveTriangleCount,
    sceneBatchesExtensionIndependent: () => [...sceneBatchObjects, ...sceneInteractiveBatchObjects, ...sectionCapObjects]
      .every((entry) => !entry.isBatchedMesh),
    renderResolutionState: () => ({
      rendererName, softwareWebgl, devicePixelRatio, fullPixelRatio, interactivePixelRatio, currentPixelRatio,
      interactionLodActive: softwareWebgl && currentPixelRatio === interactivePixelRatio && sceneInteractiveBatchObjects.length > 0,
    }),
    beginInteractiveResolutionForTest: beginInteractiveResolution,
    endInteractiveResolutionForTest: endInteractiveResolution,
    visible: () => stageVisible,
    gizmoState: () => ({
      attached: Boolean(transformPreview?.object && transformControls.object),
      bodyId: transformPreview?.bodyId || null,
      mode: transformControls.mode,
      translationSnap: transformControls.translationSnap,
      rotationSnapDegrees: transformControls.rotationSnap == null ? null : transformControls.rotationSnap * 180 / Math.PI,
      helperVisible: transformHelper.visible,
      occurrenceId: transformPreview?.occurrenceId || null,
    }),
    gizmoTranslateForTest: (translation) => {
      if (!transformPreview?.object || !['move', 'copy', 'assembly-transform'].includes(transformPreview.command)) return false;
      transformPreview.object.position.copy(transformPreview.position).add(new THREE.Vector3(...translation));
      transformPreview.object.updateMatrixWorld(true);
      transformControls.dispatchEvent({ type: 'objectChange' });
      return true;
    },
    gizmoRotateForTest: (axis, degrees) => {
      if (!transformPreview?.object || !['rotate', 'assembly-transform'].includes(transformPreview.command)) return false;
      const delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), degrees * Math.PI / 180);
      transformPreview.object.quaternion.copy(transformPreview.quaternion).multiply(delta);
      transformPreview.object.updateMatrixWorld(true);
      transformControls.dispatchEvent({ type: 'objectChange' });
      return true;
    },
    frame: () => {
      orbit.update();
      renderScene();
    },
    captureFrameForTest: () => {
      const previousPixelRatio = currentPixelRatio;
      if (currentPixelRatio !== devicePixelRatio) {
        currentPixelRatio = devicePixelRatio;
        renderer.setPixelRatio(currentPixelRatio);
      }
      resize(); orbit.update(); renderScene();
      const captured = {
        dataUrl: renderer.domElement.toDataURL('image/png'),
        width: renderer.domElement.width, height: renderer.domElement.height,
        stageWidth: stage.clientWidth, stageHeight: stage.clientHeight,
      };
      if (currentPixelRatio !== previousPixelRatio) {
        currentPixelRatio = previousPixelRatio;
        renderer.setPixelRatio(currentPixelRatio);
        requestSceneRender();
      }
      return captured;
    },
    setViewForTest: (name) => { setView(name); renderScene(); },
    setCameraDirectionForTest: (direction, scale = 1.6) => {
      const { c, r } = partView();
      const d = new THREE.Vector3(...direction).normalize().multiplyScalar(r * Number(scale || 1.6));
      camera.position.copy(c.clone().add(d)); orbit.target.copy(c); orbit.update(); renderScene();
      return { position: camera.position.toArray(), target: orbit.target.toArray() };
    },
    selectionFilter: () => selectionFilter,
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
    exportForTest: async (kind, bodyIds = selectedExportBodyIds()) => {
      const response = await kernelCall(kind === 'step' ? 'export-step' : 'export-stl', documentRevision, { bodyIds });
      return {
        size: response.blob?.size || 0,
        type: response.blob?.type || '',
        errors: response.errors || [],
        manifest: response.manifest || null,
        text: kind === 'step' && response.blob ? await response.blob.text() : '',
      };
    },
    importStepForTest: async (blob, filename = 'import.step') => {
      const response = await importStepWithKernelRecovery(blob, filename, documentRevision);
      return { project: response.project, manifest: response.manifest };
    },
    undoLabels: () => undoStack.map((e) => e.label),
    docJson: () => JSON.stringify(doc),
    canonicalHash: () => v5RuntimeTools.isStudioV5Project(doc) ? v5RuntimeTools.studioV5CanonicalHash(doc) : null,
    commandRevision: () => commandRevision,
    agentConnection: () => activeAgentConnection ? {
      sessionId: activeAgentConnection.sessionId,
      connectionToken: activeAgentConnection.connectionToken,
      clientLabel: activeAgentConnection.clientLabel,
      permissionContext: deepCopy(activeAgentConnection.permissionContext),
    } : null,
    connectAgentForTest: (options) => activateAgentConnection({ ...options, mode: options?.mode || 'scoped-auto-commit' }),
    agentRequestForTest: (connectionToken, envelope) => handleLiveAgentRequest(connectionToken, envelope),
    disconnectAgentForTest: (connectionToken) => window.bomwikiCadAgent.disconnect(connectionToken),
    bodyResults: () => deepCopy(lastBodyResults),
    patternInstanceIds: () => lastBodyResults.filter((entry) => entry.patternInstance).map((entry) => entry.bodyId),
    renderGeometryCount: () => new Set([...bodyMeshes.values()].map((mesh) => mesh.geometry)).size,
    renderBufferBytes: () => [...new Set([...bodyMeshes.values()].map((mesh) => mesh.geometry))].reduce((total, geometry) => {
      const attributes = Object.values(geometry.attributes || {});
      return total + attributes.reduce((sum, attribute) => sum + (attribute.array?.byteLength || 0), 0) + (geometry.index?.array?.byteLength || 0);
    }, 0),
    preRenderedAssemblyTreeReuseCount: () => preRenderedAssemblyTreeReuseCount,
    kernelMemoryForTest: async () => (await kernelCall('memory-stats', documentRevision)).memory,
    renderedBodyBounds: (bodyId) => {
      const mesh = bodyMeshes.get(bodyId);
      if (!mesh) return null;
      const bounds = new THREE.Box3().setFromObject(mesh);
      return [[bounds.min.x, bounds.min.y, bounds.min.z], [bounds.max.x, bounds.max.y, bounds.max.z]];
    },
    evaluationTrace: () => deepCopy(lastEvaluationTrace),
    inspectionResult: () => deepCopy(lastInspection),
    activeSectionViewId: () => v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly' ? v5RuntimeTools.studioV5RootAssembly(doc).metadata?.activeSectionViewId || null : null,
    activeExplodedViewId: () => v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly' ? v5RuntimeTools.studioV5RootAssembly(doc).metadata?.activeExplodedViewId || null : null,
    axialStageGroups: () => v5InspectionTools.studioV5AxialStageGroups(doc),
    measurements: () => v5InspectionTools.studioV5Measurements(doc),
    displayMode: () => v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly' ? v5RuntimeTools.studioV5RootAssembly(doc).metadata?.displayMode || 'shaded-edges' : 'shaded-edges',
    sectionCapState: () => ({
      planes: sectionCapObjects.filter((entry) => entry.userData.sectionCapPlane).length,
      capPositions: sectionCapObjects.filter((entry) => entry.userData.sectionCapPlane)
        .map((entry) => entry.position.toArray()),
      stencilMeshes: sectionCapObjects.filter((entry) => entry.userData.sectionCapStencil)
        .reduce((total, entry) => total + (entry.userData.sectionCapStencilCount || 1), 0),
      stencilDrawObjects: sectionCapObjects.filter((entry) => entry.userData.sectionCapStencil).length,
      extensionIndependent: sectionCapObjects.filter((entry) => entry.userData.sectionCapStencil)
        .every((entry) => !entry.isBatchedMesh),
    }),
    sectionPlaneOffsetForTest: (offset) => {
      pulseInteractiveResolution();
      const nextOffset = Number(offset || 0);
      let updated = 0;
      const materials = new Set([
        ...[...bodyMeshes.values()].map((mesh) => mesh.material),
        ...edgeLines.map((line) => line.material),
        ...sceneBatchObjects.map((object) => object.material),
        ...sceneInteractiveBatchObjects.map((object) => object.material),
        ...sectionCapObjects.map((object) => object.material),
      ]);
      for (const material of materials) for (const plane of material?.clippingPlanes || []) {
        plane.constant = -nextOffset;
        updated++;
      }
      for (const cap of sectionCapObjects.filter((object) => object.userData.sectionCapPlane)) {
        const normal = cap.userData.sectionPlaneNormal;
        const center = cap.userData.sectionCapCenter;
        if (normal && center) cap.position.copy(center).addScaledVector(normal, nextOffset - normal.dot(center));
      }
      requestSceneRender();
      return updated;
    },
    rootKind: () => v5RuntimeTools.isStudioV5Project(doc) ? doc.rootDocument?.kind : 'legacy-part',
    bodyIds: () => v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'part' ? v5RuntimeTools.studioV5RootPart(doc).bodies.map((body) => body.id) : lastBodyResults.map((body) => body.bodyId),
    datumIds: () => v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'part' ? v5RuntimeTools.studioV5RootPart(doc).referenceGeometry.map((datum) => datum.id) : [],
    sketchIds: () => v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'part' ? v5RuntimeTools.studioV5RootPart(doc).sketches.map((sketch) => sketch.id) : [],
    datumErrors: () => {
      if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'part') return [];
      const resolved = v5ModelingTools.resolveStudioV5Datums(doc, v5RuntimeTools.studioV5RootPart(doc).id);
      return [...resolved.errors].map(([datumId, error]) => ({ datumId, message: error.message }));
    },
    activeBodyId: () => v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'part' ? v5RuntimeTools.studioV5RootPart(doc).metadata?.activeBodyId || null : null,
    selectedBodyId: () => selectedBodyId,
    selectedOccurrenceId: () => selectedOccurrenceId,
    occurrenceIds: () => v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly' ? v5RuntimeTools.studioV5RootAssembly(doc).occurrences.map((entry) => entry.id) : [],
    mateIds: () => v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly' ? v5RuntimeTools.studioV5RootAssembly(doc).mates.map((entry) => entry.id) : [],
    visibleBodyIds: () => [...bodyMeshes].filter(([, mesh]) => mesh.visible).map(([bodyId]) => bodyId),
    selectBodyForTest: (bodyId) => selectBody(bodyId),
    selectOccurrenceForTest: (occurrenceId) => selectOccurrence(occurrenceId),
    openAssemblyTransformForTest: (occurrenceId) => {
      selectOccurrence(occurrenceId);
      openAssemblyCommand('transform');
      return Boolean(transformPreview?.command === 'assembly-transform');
    },
    attemptBodyBooleanForTest: (operation, targetBodyId, toolBodyId) => attemptBodyBoolean(operation, targetBodyId, toolBodyId),
    ndcOfBodyCenter: (bodyId) => {
      const mesh = bodyMeshes.get(bodyId);
      if (!mesh) return null;
      mesh.geometry.computeBoundingSphere();
      mesh.updateWorldMatrix(true, false);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      const center = mesh.localToWorld(mesh.geometry.boundingSphere.center.clone()).project(camera);
      return [center.x, center.y];
    },
    bodyDisplayState: (bodyId) => {
      const mesh = bodyMeshes.get(bodyId);
      return mesh ? { matrix: mesh.matrix.toArray(), clippingPlanes: mesh.material.clippingPlanes?.length || 0, color: '#' + mesh.material.color.getHexString(), opacity: mesh.material.opacity } : null;
    },
    topologyBodyIds: () => ({
      edges: [...new Set(edgeLines.map((line) => line.userData.bodyId).filter(Boolean))],
      faces: [...new Set([...faceByHash.values()].map((face) => face.bodyId).filter(Boolean))],
    }),
    triCount: () => {
      const meshes = bodyMeshes.size ? [...bodyMeshes.values()] : solidMesh ? [solidMesh] : [];
      return meshes.reduce((total, mesh) => {
        const geometry = mesh.geometry;
        return total + (geometry.getIndex() ? geometry.getIndex().count / 3 : geometry.getAttribute('position').count / 3);
      }, 0);
    },
    pressPullPreviewTriangles: () => sketch.previewTriangles(),
    pickAt: (fx, fy) => {
      const ray = new THREE.Raycaster();
      ray.params.Line = { threshold: 1.5 };
      ray.setFromCamera(new THREE.Vector2(fx * 2 - 1, -(fy * 2 - 1)), camera);
      const hit = ray.intersectObjects(edgeLines, false)[0];
      const signature = edgeSignatureForHit(hit);
      return hit && signature ? { sig: signature, dist: hit.distance } : null;
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
        const selected = edgeSignaturesForLine(l).filter((signature) => l.userData.pickedSignatures?.has(edgeSignatureKey(signature)));
        for (const signature of edgeSignaturesForLine(l)) {
          if (out.length >= n) break;
          if (!selected.some((candidate) => edgeSignatureKey(candidate) === edgeSignatureKey(signature))) selected.push(signature);
          out.push(signature);
        }
        setEdgePickedSignatures(l, selected);
        if (out.length >= n) break;
      }
      return out;
    },
  };

  // Copy one B-rep face's triangles into a standalone highlight mesh (no
  // shared GPU buffers — disposing shared attributes would strip the main
  // mesh). Used by the face picker and the shell picker.
  function buildFaceHighlight(range, color, opacity) {
    const sourceMesh = range?.mesh || solidMesh;
    if (!sourceMesh) return null;
    const posAttr = sourceMesh.geometry.getAttribute('position');
    const idx = sourceMesh.geometry.getIndex().array;
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

    const planarRanges = () => faceRanges.filter((range) => (!range.mesh || range.mesh === solidMesh) && faceForRange(range));

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
        const face = faceForRange(r);
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
            commitFeatureDraft((wasNew ? 'Add ' : 'Edit ') + 'shell', draft, wasNew);
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
        const face = faceForRange(range);
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
      const range = rangeForHit(hit);
      if (!faceForRange(range)) return say('That surface is curved — pick a flat face.');
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
    const planarRanges = () => faceRanges.filter((range) => (!range.mesh || range.mesh === solidMesh) && faceForRange(range));
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
      const face = cycleIdx >= 0 && list[cycleIdx] && faceForRange(list[cycleIdx]);
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
      const range = rangeForHit(hit);
      const face = faceForRange(range);
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
    const aggregate = bodyMeshes.size && boundsPair(meshBounds);
    if (aggregate) {
      const center = [0, 1, 2].map((axis) => (aggregate[0][axis] + aggregate[1][axis]) / 2);
      const radius = Math.hypot(
        aggregate[1][0] - aggregate[0][0],
        aggregate[1][1] - aggregate[0][1],
        aggregate[1][2] - aggregate[0][2],
      ) / 2;
      return {
        c: new THREE.Vector3(center[0], center[2], -center[1]),
        r: Math.max(10, radius * 2.1),
      };
    }
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

  let bodyPickDown = null;
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (!gizmoPointerActive && mode.kind === 'idle' && bodyMeshes.size) bodyPickDown = [event.clientX, event.clientY];
  });
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (gizmoPointerActive || !bodyPickDown || mode.kind !== 'idle' || Math.hypot(event.clientX - bodyPickDown[0], event.clientY - bodyPickDown[1]) > 5) {
      bodyPickDown = null;
      return;
    }
    bodyPickDown = null;
    const rect = renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    ), camera);
    const hit = ray.intersectObjects(
      selectionFilter === 'edge' ? edgeLines.filter((line) => line.visible) : [...bodyMeshes.values()].filter((mesh) => mesh.visible),
      false,
    )[0];
    if (hit?.object?.userData?.bodyId) {
      const bodyId = hit.object.userData.bodyId;
      const result = lastBodyResults.find((entry) => entry.bodyId === bodyId);
      if (selectionFilter === 'component' && result?.occurrenceInstance?.occurrenceId) selectOccurrence(result.occurrenceInstance.occurrenceId);
      else {
        selectBody(bodyId);
        if (selectionFilter === 'face') {
          const range = rangeForHit(hit);
          say('Selected face ' + (range?.faceId || 'geometry') + ' on ' + (result?.bodyName || bodyId) + '.');
        } else if (selectionFilter === 'edge') say('Selected edge ' + (edgeSignatureForHit(hit)?.kind || 'geometry') + ' on ' + (result?.bodyName || bodyId) + '.');
      }
    }
  });

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
    const range = rangeForHit(hit);
    const face = faceForRange(range);
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
    if (mode.kind === 'sketching' || mode.kind === 'press-pull') return sketch.isDirty();
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
  const draftDecision = $('bw-draft-decision');
  const clearDecision = $('bw-clear-decision');
  const transitionToast = $('bw-transition-toast');
  let queuedOperation = null;
  let transitionUndo = null;
  let transitionTimer = null;
  let transitionHideTimer = null;

  function focusActiveWorkspace() {
    if (mode.kind === 'sketching') $('bw-sketch-canvas')?.focus();
    else renderer.domElement.focus();
  }
  function closeDecision(dialog) {
    if (typeof dialog?.close === 'function' && dialog.open) dialog.close();
    else dialog?.removeAttribute('open');
  }
  function runOperation(fn) {
    try {
      const result = fn();
      if (result?.catch) result.catch((error) => say('Could not continue: ' + String(error?.message || error)));
    } catch (error) {
      say('Could not continue: ' + String(error?.message || error));
    }
  }
  function keepEditing() {
    queuedOperation = null;
    closeDecision(draftDecision);
    requestAnimationFrame(focusActiveWorkspace);
  }
  function takeQueuedOperation() {
    const request = queuedOperation;
    queuedOperation = null;
    closeDecision(draftDecision);
    return request;
  }
  function openDraftDecision(fn, opts = {}) {
    queuedOperation = { fn, opts };
    const next = opts.nextLabel || 'continue';
    $('bw-draft-decision-copy').textContent = 'Apply the unfinished edit before you ' + next + ', discard only the draft, or keep editing.';
    if (typeof draftDecision?.showModal === 'function') {
      if (!draftDecision.open) draftDecision.showModal();
    } else draftDecision?.setAttribute('open', '');
    requestAnimationFrame(() => $('bw-draft-keep')?.focus());
  }
  $('bw-draft-keep')?.addEventListener('click', keepEditing);
  $('bw-draft-discard')?.addEventListener('click', () => {
    const request = takeQueuedOperation();
    if (!request) return;
    cancelAllEditors();
    runOperation(request.fn);
    // Closing a modal restores its prior focus after this click handler. Move
    // focus back to the newly opened command on the next frame so its Escape
    // and Enter keys are owned by that command, not a now-hidden draft field.
    requestAnimationFrame(focusActiveWorkspace);
  });
  $('bw-draft-apply')?.addEventListener('click', () => {
    const request = takeQueuedOperation();
    if (!request) return;
    applyCurrent();
    if (isWorking(mode.kind)) {
      requestAnimationFrame(focusActiveWorkspace);
      return;
    }
    runOperation(request.fn);
    requestAnimationFrame(focusActiveWorkspace);
  });
  draftDecision?.addEventListener('cancel', (event) => {
    event.preventDefault();
    keepEditing();
  });
  draftDecision?.addEventListener('click', (event) => {
    if (event.target === draftDecision) keepEditing();
  });

  function closeClearDecision() {
    closeDecision(clearDecision);
    requestAnimationFrame(focusActiveWorkspace);
  }
  function openClearDecision() {
    if (typeof clearDecision?.showModal === 'function') {
      if (!clearDecision.open) clearDecision.showModal();
    } else clearDecision?.setAttribute('open', '');
    requestAnimationFrame(() => $('bw-clear-cancel')?.focus());
  }
  $('bw-clear-cancel')?.addEventListener('click', closeClearDecision);
  $('bw-clear-confirm')?.addEventListener('click', () => {
    closeDecision(clearDecision);
    commit('Clear part', () => {
      if (!v5RuntimeTools.isStudioV5Project(doc)) return { ...doc, features: [], params: [] };
      const candidate = v5RuntimeTools.canonicalStudioV5Project(doc);
      const part = v5RuntimeTools.studioV5RootPart(candidate);
      candidate.parameters = [];
      part.features = [];
      part.featureOrder = [];
      part.bodies = [];
      part.metadata = { ...(part.metadata || {}), activeBodyId: null };
      return v5RuntimeTools.prepareStudioV5RuntimeProject(candidate);
    });
    requestAnimationFrame(focusActiveWorkspace);
  });
  clearDecision?.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeClearDecision();
  });
  clearDecision?.addEventListener('click', (event) => {
    if (event.target === clearDecision) closeClearDecision();
  });

  function hideTransitionToast(immediate = false) {
    clearTimeout(transitionTimer);
    clearTimeout(transitionHideTimer);
    transitionUndo = null;
    if (!transitionToast || transitionToast.hidden) return;
    if (immediate) {
      transitionToast.classList.remove('is-visible');
      transitionToast.hidden = true;
      return;
    }
    transitionToast.classList.remove('is-visible');
    transitionHideTimer = setTimeout(() => {
      transitionToast.hidden = true;
    }, 190);
  }
  function showTransitionToast(title, detail, undo = null) {
    if (!transitionToast) return;
    clearTimeout(transitionTimer);
    clearTimeout(transitionHideTimer);
    transitionUndo = undo;
    $('bw-transition-title').textContent = title;
    $('bw-transition-detail').textContent = detail;
    $('bw-transition-undo').hidden = !undo;
    transitionToast.hidden = false;
    transitionToast.classList.remove('is-visible');
    requestAnimationFrame(() => transitionToast.classList.add('is-visible'));
    transitionTimer = setTimeout(hideTransitionToast, 5200);
  }
  $('bw-transition-close')?.addEventListener('click', hideTransitionToast);
  $('bw-transition-undo')?.addEventListener('click', () => {
    const undo = transitionUndo;
    hideTransitionToast();
    if (undo) runOperation(undo);
  });

  function startOperation(fn, opts) {
    if (isWorking(mode.kind)) {
      if (!opts?.discardConfirmed && activeDraftDirty()) {
        openDraftDecision(fn, opts);
        return false;
      }
      cancelAllEditors();
    }
    runOperation(fn);
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
  function projectTransitionSnapshot() {
    return {
      projectId,
      document: deepCopy(doc),
      undoStack: deepCopy(undoStack),
      redoStack: deepCopy(redoStack),
      title: doc.title,
    };
  }
  async function restoreTemplateTransition(previous, openedTitle) {
    await save('Before restoring ' + previous.title);
    projectId = previous.projectId;
    doc = normalizeDoc(deepCopy(previous.document));
    undoStack.splice(0, undoStack.length, ...deepCopy(previous.undoStack));
    redoStack.splice(0, redoStack.length, ...deepCopy(previous.redoStack));
    selectedFeatureId = null;
    afterDocumentChange('Restored previous part');
    resetAgentForProjectChange('Restored previous project');
    focusActiveWorkspace();
    requestAnimationFrame(focusActiveWorkspace);
    showTransitionToast('Previous part restored', '“' + openedTitle + '” remains available in Recover.');
  }
  async function openTemplateNow(template) {
    const previous = doc.features.length || doc.params.length ? projectTransitionSnapshot() : null;
    const journal = previous ? await journalReady : null;
    let previousSavedToRecovery = false;
    if (previous) {
      await save('Before opening ' + template.name);
      previousSavedToRecovery = Boolean(journal && storageStateEl?.dataset.state === 'saved');
    }
    const { prepareStudioDocument } = await documentToolsReady;
    projectId = makeProjectId();
    doc = normalizeDoc(prepareStudioDocument(structuredClone(template.document)));
    undoStack.length = 0;
    redoStack.length = 0;
    selectedFeatureId = null;
    finishWelcome();
    closeTemplateLibrary(true);
    afterDocumentChange('Started from ' + template.name);
    resetAgentForProjectChange('Opened a template');
    showTransitionToast(
      'Opened “' + template.name + '”',
      previous
        ? previousSavedToRecovery
          ? 'Your previous part was saved to Recover.'
          : 'Local recovery is unavailable — use Undo now.'
        : 'Ready to edit.',
      previous ? () => restoreTemplateTransition(previous, template.name) : null,
    );
    // The project title and dialog state update synchronously. Restore focus
    // in that same transition so keyboard navigation cannot observe a loaded
    // template whose active element is the now-closed dialog control.
    focusActiveWorkspace();
    requestAnimationFrame(focusActiveWorkspace);
    if (!hasFlag(TOUR_SEEN)) setTimeout(() => startTour('part'), 350);
  }
  async function useTemplate(template) {
    if (!template) return;
    if (isWorking(mode.kind) && activeDraftDirty() && templateDialog?.open) closeTemplateLibrary(true);
    startOperation(() => openTemplateNow(template), { nextLabel: 'open “' + template.name + '”' });
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
  function refreshTourTarget() {
    const step = tourSteps()[tourIndex];
    clearTourTarget();
    tourTarget = step?.target?.() || null;
    tourTarget?.classList.add('ws-tour-target');
    tourTarget?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  function renderTourStep() {
    const steps = tourSteps();
    const step = steps[tourIndex];
    clearTourTarget();
    step.prepare?.();
    refreshTourTarget();
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
    if (id) selectedBodyId = null;
    if (id) {
      sideEl.classList.remove('m-open-params', 'm-open-history', 'm-open-project');
      syncMtabs();
    }
    renderHistory();
    renderBodies();
    renderContext();
    const feature = doc.features.find((entry) => entry.id === id);
    if (feature) say('Selected feature: ' + (feature.name || OP_LABEL[feature.type] || feature.type) + ' · ' + feature.type + '.');
  }

  async function attemptBodyBoolean(operation, targetBodyId, toolBodyId) {
    if (!v5RuntimeTools.isStudioV5Project(doc)) return false;
    const sourceRevision = documentRevision;
    const sourceHash = v5RuntimeTools.studioV5CanonicalHash(doc);
    let candidate;
    const featureId = 'boolean-' + newId();
    try {
      candidate = agentTools.applyCadTransaction(doc, {
        transactionId: 'human-boolean-' + featureId,
        label: 'Preview body Boolean',
        expectedRevision: commandRevision,
        atomic: true,
        operations: [{
          kind: operation === 'add' ? 'boolean.union' : 'boolean.' + operation,
          input: { id: featureId, targetBodyId, toolBodyId, keepTools: true },
        }],
        metadata: { actor: 'human', clientLabel: 'Studio UI' },
      }).project;
    } catch (error) {
      say(String(error?.message || error));
      return false;
    }
    let response;
    try {
      response = await kernelCall('validate-v5', documentRevision, { document: candidate });
    } catch (error) {
      say('Boolean preview failed: ' + String(error?.message || error));
      return false;
    }
    if (documentRevision !== sourceRevision || !v5RuntimeTools.isStudioV5Project(doc) || v5RuntimeTools.studioV5CanonicalHash(doc) !== sourceHash) {
      say('The project changed while the Boolean was being checked — run it again on the current bodies.');
      return false;
    }
    if (response.errors?.length) {
      say('Boolean not applied: ' + response.errors[0].message);
      return false;
    }
    const part = v5RuntimeTools.studioV5RootPart(candidate);
    const target = part.bodies.find((body) => body.id === targetBodyId);
    const tool = part.bodies.find((body) => body.id === toolBodyId);
    const label = (operation === 'add' ? 'Union ' : operation === 'intersect' ? 'Intersect ' : 'Subtract ') + tool.name + (operation === 'subtract' ? ' from ' : ' with ') + target.name;
    commitHumanOperations(label, [{
      kind: operation === 'add' ? 'boolean.union' : 'boolean.' + operation,
      input: { id: featureId, targetBodyId, toolBodyId, keepTools: true },
    }]);
    selectBody(targetBodyId);
    return true;
  }

  function renderContext() {
    const wrap = $('bw-context-wrap');
    const panel = $('bw-context');
    const empty = $('bw-inspector-empty');
    const kind = $('bw-inspector-kind');
    if (!panel) return;
    const holder = wrap || panel;
    const assemblyRoot = v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly';
    const selectedBody = v5RuntimeTools.isStudioV5Project(doc) && !assemblyRoot
      ? v5RuntimeTools.studioV5RootPart(doc).bodies.find((body) => body.id === selectedBodyId)
      : null;
    if (mode.kind === 'idle' && lastInspection) {
      if (empty) empty.hidden = true;
      if (kind) kind.textContent = lastInspection.mode === 'interference' ? 'Interference results' : lastInspection.mode === 'clearance' ? 'Clearance result' : lastInspection.mode === 'measurements' ? 'Saved measurements' : 'Mass & geometry health';
      const aggregate = lastInspection.aggregate;
      const pairs = lastInspection.pairs || [];
      const massText = aggregate.massKg == null
        ? 'unknown · ' + Number(aggregate.knownMassKg || 0).toFixed(6) + ' kg known'
        : Number(aggregate.massKg).toFixed(6) + ' kg';
      panel.innerHTML = '<p class="ctx-t">Revision-keyed engineering inspection</p>' +
        '<p class="ctx-sub">' + escapeHtml(lastInspection.revisionKey) + ' · ' + lastInspection.bodyCount + ' exact bodies</p>' +
        '<p class="ctx-stat">Volume: ' + Number(aggregate.volumeMm3).toFixed(3) + ' mm³</p>' +
        '<p class="ctx-stat">Surface area: ' + Number(aggregate.surfaceAreaMm2).toFixed(3) + ' mm²</p>' +
        '<p class="ctx-stat">Mass: ' + massText + (aggregate.missingMaterialBodyIds.length ? ' · ' + aggregate.missingMaterialBodyIds.length + ' missing material' : '') + '</p>' +
        '<p class="ctx-stat">B-rep health: ' + (aggregate.valid ? 'valid' : 'review required') + '</p>' +
        (lastInspection.errors?.length ? '<p class="err-msg">' + escapeHtml(lastInspection.errors[0].message) + (lastInspection.errors.length > 1 ? ' · ' + (lastInspection.errors.length - 1) + ' more' : '') + '</p>' : '') +
        (pairs.length ? '<div class="inspection-results">' + pairs.map((pair) => '<p class="ctx-stat">' + escapeHtml(pair.leftBodyId) + ' ↔ ' + escapeHtml(pair.rightBodyId) + ': ' +
          (pair.interferenceVolumeMm3 > 1e-8 ? Number(pair.interferenceVolumeMm3).toFixed(3) + ' mm³ interference' : Number(pair.minimumClearanceMm ?? 0).toFixed(3) + ' mm clearance') + '</p>').join('') + '</div>' : '') +
        (lastInspection.measurementResults?.length ? '<div class="inspection-results">' + lastInspection.measurementResults.map((measurement) => '<p class="ctx-stat">' + escapeHtml(measurement.name) + ': ' +
          (measurement.valid ? escapeHtml(Array.isArray(measurement.value) ? measurement.value.map((entry) => Number(entry).toFixed(3)).join(' × ') : Number(measurement.value).toFixed(3)) + ' ' + escapeHtml(measurement.unit) : escapeHtml(measurement.error)) + '</p>').join('') + '</div>' : '') +
        '<div class="ctx-body-actions"><button type="button" data-inspection-context="clear">Close results</button></div>';
      holder.hidden = false;
      panel.querySelector('[data-inspection-context="clear"]')?.addEventListener('click', () => { lastInspection = null; renderContext(); });
      return;
    }
    if (mode.kind === 'idle' && assemblyRoot && selectedMateId) {
      const mate = v5RuntimeTools.studioV5RootAssembly(doc).mates.find((entry) => entry.id === selectedMateId);
      if (mate) {
        const conflict = lastEvaluationTrace?.conflicts?.find((set) => set.includes(mate.id));
        if (empty) empty.hidden = true;
        if (kind) kind.textContent = 'Mate properties';
        panel.innerHTML = '<p class="ctx-t">' + escapeHtml(mate.name) + '</p><p class="ctx-sub">' + mate.kind + ' mate</p>' +
          '<p class="ctx-stat">Occurrences: ' + mate.occurrenceIds.map(escapeHtml).join(' → ') + '</p>' +
          '<p class="ctx-stat">References: ' + mate.references.map((reference) => escapeHtml(reference.ownerId)).join(' ↔ ') + '</p>' +
          '<p class="ctx-stat">Value: ' + escapeHtml(mate.value ?? 'none') + '</p>' +
          '<p class="ctx-stat">Removes DOF: ' + ({ fixed: 6, coincident: 3, concentric: 4, distance: 1, angle: 1, parallel: 2, perpendicular: 1, tangent: 1, revolute: 5, slider: 5 }[mate.kind] || 0) + '</p>' +
          (conflict ? '<p class="err-msg">Conflict set: ' + conflict.map(escapeHtml).join(', ') + '</p>' : '') +
          '<div class="ctx-body-actions"><button type="button" data-mate-context="edit">Edit mate</button><button type="button" data-mate-context="suppress">' + (mate.suppressed ? 'Restore' : 'Suppress') + '</button><button type="button" class="is-danger" data-mate-context="delete">Delete mate</button></div>';
        holder.hidden = false;
        panel.querySelector('[data-mate-context="edit"]')?.addEventListener('click', () => openAssemblyCommand('mate', mate.kind, mate.id));
        panel.querySelector('[data-mate-context="suppress"]')?.addEventListener('click', () => commit((mate.suppressed ? 'Restore ' : 'Suppress ') + mate.name, () => v5RuntimeTools.updateStudioV5AssemblyMate(doc, mate.id, { suppressed: !mate.suppressed })));
        panel.querySelector('[data-mate-context="delete"]')?.addEventListener('click', () => commit('Delete ' + mate.name, () => v5RuntimeTools.deleteStudioV5AssemblyMate(doc, mate.id)));
        return;
      }
    }
    if (mode.kind === 'idle' && assemblyRoot && selectedOccurrenceId) {
      const assembly = v5RuntimeTools.studioV5RootAssembly(doc);
      const occurrence = assembly.occurrences.find((entry) => entry.id === selectedOccurrenceId);
      const selectedOccurrenceResults = lastBodyResults.filter((entry) => occurrence
        ? entry.occurrenceInstance?.occurrencePath?.[0] === occurrence.id
        : entry.occurrenceInstance?.occurrenceId === selectedOccurrenceId);
      const result = selectedOccurrenceResults[0];
      const path = result?.occurrenceInstance?.occurrencePath || (occurrence ? [occurrence.id] : []);
      const definition = occurrence?.definition || result?.occurrenceInstance?.definition;
      const definitionName = definition?.kind === 'part'
        ? doc.partDefinitions.find((entry) => entry.id === definition.partId)?.name
        : doc.assemblyDefinitions.find((entry) => entry.id === definition?.assemblyId)?.name;
      const affectedMates = occurrence ? assembly.mates.filter((mate) => mate.occurrenceIds.includes(occurrence.id)).length : 0;
      const affectedPatterns = occurrence ? assembly.occurrencePatterns.filter((pattern) => pattern.sourceOccurrenceIds.includes(occurrence.id)).length : 0;
      if (empty) empty.hidden = true;
      if (kind) kind.textContent = occurrence ? 'Component occurrence' : 'Generated occurrence';
      panel.innerHTML = '<p class="ctx-t">' + escapeHtml(occurrence?.name || result?.bodyName || selectedOccurrenceId) + '</p>' +
        '<p class="ctx-sub">' + escapeHtml(definitionName || 'Linked component') + '</p>' +
        '<p class="ctx-stat">Occurrence path: ' + path.map(escapeHtml).join(' / ') + '</p>' +
        '<p class="ctx-stat">Solver: ' + (occurrence?.fixed || lastEvaluationTrace?.degreesOfFreedom?.[occurrence?.id] === 0 ? 'fully constrained' : (lastEvaluationTrace?.degreesOfFreedom?.[occurrence?.id] ?? 'derived') + ' DOF') + '</p>' +
        '<p class="ctx-stat">Exact bodies: ' + selectedOccurrenceResults.length + '</p>' +
        (occurrence ? '<p class="ctx-stat">Delete affects: ' + affectedMates + ' mate(s), ' + affectedPatterns + ' pattern(s)</p>' : '') +
        (occurrence ? '<div class="ctx-body-actions"><button type="button" data-occurrence-context="visibility">' + (occurrence.visible ? 'Hide' : 'Show') + '</button><button type="button" data-occurrence-context="suppress">' + (occurrence.suppressed ? 'Restore' : 'Suppress') + '</button><button type="button" data-occurrence-context="isolate">' + (appEl?.dataset.isolateOccurrence ? 'Show all' : 'Isolate') + '</button>' +
          (occurrence.definition.kind === 'part' ? '<button type="button" data-occurrence-context="edit">Edit in context</button><button type="button" data-occurrence-context="variant">Component variant</button><button type="button" data-occurrence-context="independent">Make independent</button>' : '') +
          '<button type="button" data-occurrence-context="transform">Move / rotate</button>' +
          '<button type="button" data-occurrence-context="linked">Linked duplicate</button><button type="button" class="is-danger" data-occurrence-context="delete">Delete component</button></div>' : '') +
        '<div class="ctx-body-actions"><button type="button" data-occurrence-context="export">Select component for export</button></div>';
      holder.hidden = false;
      panel.querySelectorAll('[data-occurrence-context]').forEach((button) => button.addEventListener('click', () => {
        const action = button.dataset.occurrenceContext;
        if (action === 'export') {
          for (const body of selectedOccurrenceResults) exportBodyIds.add(body.bodyId);
          renderHistory(); return;
        }
        if (!occurrence) return;
        if (action === 'visibility') commit((occurrence.visible ? 'Hide ' : 'Show ') + occurrence.name, () => v5RuntimeTools.updateStudioV5ComponentOccurrence(doc, occurrence.id, { visible: !occurrence.visible }));
        else if (action === 'suppress') commit((occurrence.suppressed ? 'Restore ' : 'Suppress ') + occurrence.name, () => v5RuntimeTools.updateStudioV5ComponentOccurrence(doc, occurrence.id, { suppressed: !occurrence.suppressed }));
        else if (action === 'isolate') {
          if (appEl.dataset.isolateOccurrence) delete appEl.dataset.isolateOccurrence;
          else appEl.dataset.isolateOccurrence = occurrence.id;
          syncBodyMeshState(); renderContext();
        } else if (action === 'edit') commit('Edit ' + occurrence.name + ' in context', () => v5RuntimeTools.enterStudioV5AssemblyContext(doc, occurrence.id));
        else if (action === 'transform') openAssemblyCommand('transform');
        else if (action === 'variant') openAssemblyCommand('variant');
        else if (action === 'independent') openAssemblyCommand('independent');
        else if (action === 'linked') openAssemblyCommand('linked');
        else if (action === 'delete') commit('Delete ' + occurrence.name, () => v5RuntimeTools.deleteStudioV5ComponentOccurrence(doc, occurrence.id));
      }));
      return;
    }
    const selectedPatternResult = lastBodyResults.find((entry) => entry.bodyId === selectedBodyId && entry.patternInstance);
    if (mode.kind === 'idle' && selectedPatternResult && v5RuntimeTools.isStudioV5Project(doc)) {
      const part = v5RuntimeTools.studioV5RootPart(doc);
      const pattern = (part.bodyPatterns || []).find((entry) => entry.id === selectedPatternResult.patternInstance.patternId);
      const source = part.bodies.find((entry) => entry.id === selectedPatternResult.patternInstance.sourceBodyId);
      const escapeText = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      if (empty) empty.hidden = true;
      if (kind) kind.textContent = 'Pattern occurrence';
      panel.innerHTML =
        '<p class="ctx-t">' + escapeText(selectedPatternResult.bodyName) + '</p>' +
        '<p class="ctx-sub">Linked generated occurrence</p>' +
        '<p class="ctx-stat">Pattern: ' + escapeText(pattern?.name || selectedPatternResult.patternInstance.patternId) + '</p>' +
        '<p class="ctx-stat">Source: ' + escapeText(source?.name || selectedPatternResult.patternInstance.sourceBodyId) + '</p>' +
        '<p class="ctx-stat">Stable index: ' + selectedPatternResult.patternInstance.index + '</p>' +
        '<p class="ctx-stat">Exact solids: ' + (selectedPatternResult.geometry?.solidCount ?? 'not built') + '</p>' +
        '<div class="ctx-body-actions"><button type="button" data-pattern-context="edit">Edit pattern</button><button type="button" data-pattern-context="skip">Skip occurrence</button></div>';
      holder.hidden = false;
      panel.querySelector('[data-pattern-context="edit"]')?.addEventListener('click', () => pattern && openV5Command('pattern', null, null, null, pattern.id));
      panel.querySelector('[data-pattern-context="skip"]')?.addEventListener('click', () => {
        if (!pattern) return;
        commit('Skip ' + pattern.name + ' occurrence ' + selectedPatternResult.patternInstance.index, () => v5RuntimeTools.updateStudioV5BodyPattern(doc, pattern.id, {
          skippedIndices: [...new Set([...(pattern.skippedIndices || []), selectedPatternResult.patternInstance.index])],
        }));
      });
      return;
    }
    if (mode.kind === 'idle' && selectedBody) {
      const part = v5RuntimeTools.studioV5RootPart(doc);
      const active = v5RuntimeTools.studioV5ActiveBody(doc);
      const result = lastBodyResults.find((entry) => entry.bodyId === selectedBody.id);
      if (empty) empty.hidden = true;
      if (kind) kind.textContent = 'Body properties';
      const escAttr = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
      panel.innerHTML =
        '<p class="ctx-t">' + escAttr(selectedBody.name) + '</p>' +
        '<p class="ctx-sub">' + (bodyBuildErrors.has(selectedBody.id) ? 'FAILED · last valid body remains visible' : selectedBody.kind + ' body') + '</p>' +
        '<label class="ctx-body-name">Name <input type="text" data-body-name value="' + escAttr(selectedBody.name) + '" maxlength="200" /></label>' +
        '<p class="ctx-stat">ID: ' + escAttr(selectedBody.id) + '</p>' +
        '<p class="ctx-stat">Created by: ' + escAttr(selectedBody.createdByFeatureId) + '</p>' +
        '<p class="ctx-stat">Owned features: ' + selectedBody.featureIds.length + '</p>' +
        '<p class="ctx-stat">Exact solids: ' + (result?.geometry?.solidCount ?? 'not built') + '</p>' +
        '<p class="ctx-stat">State: ' + (selectedBody.suppressed ? 'suppressed' : selectedBody.visible ? 'visible' : 'hidden') + (selectedBody.id === active?.id ? ' · active' : '') + '</p>' +
        (bodyBuildErrors.has(selectedBody.id) ? '<p class="err-msg">' + escAttr(bodyBuildErrors.get(selectedBody.id)) + '</p>' : '') +
        '<div class="ctx-body-actions">' +
          '<button type="button" data-body-context="active">Make active</button>' +
          '<button type="button" data-body-context="visibility">' + (selectedBody.visible ? 'Hide' : 'Show') + '</button>' +
          '<button type="button" data-body-context="isolate">' + (isolatedBodyId === selectedBody.id ? 'Show all' : 'Isolate') + '</button>' +
          '<button type="button" data-body-context="suppress">' + (selectedBody.suppressed ? 'Restore' : 'Suppress') + '</button>' +
          (active && active.id !== selectedBody.id
            ? '<button type="button" data-body-context="subtract">Subtract from active</button><button type="button" data-body-context="intersect">Intersect with active</button><button type="button" data-body-context="add">Union with active</button>'
            : '') +
          '<button type="button" class="is-danger" data-body-context="delete">Delete body</button>' +
        '</div>';
      holder.hidden = false;
      panel.querySelector('[data-body-name]')?.addEventListener('change', (event) => {
        const nextName = event.target.value.trim();
        try {
          commitHumanOperations('Rename body', [{ kind: 'body.rename', input: { bodyId: selectedBody.id, name: nextName } }]);
        } catch (error) {
          event.target.value = selectedBody.name;
          say(String(error?.message || error));
        }
      });
      panel.querySelectorAll('[data-body-context]').forEach((button) => button.addEventListener('click', () => {
        const action = button.dataset.bodyContext;
        if (action === 'active') commitHumanOperations('Activate ' + selectedBody.name, [{ kind: 'body.activate', input: { bodyId: selectedBody.id } }]);
        else if (action === 'visibility') commitHumanOperations((selectedBody.visible ? 'Hide ' : 'Show ') + selectedBody.name, [{ kind: 'body.setVisibility', input: { bodyId: selectedBody.id, visible: !selectedBody.visible } }]);
        else if (action === 'suppress') commitHumanOperations((selectedBody.suppressed ? 'Restore ' : 'Suppress ') + selectedBody.name, [{ kind: 'body.suppress', input: { bodyId: selectedBody.id, suppressed: !selectedBody.suppressed } }]);
        else if (action === 'isolate') {
          isolatedBodyId = isolatedBodyId === selectedBody.id ? null : selectedBody.id;
          renderBodies();
          renderContext();
        } else if (action === 'delete') commitHumanOperations('Delete body ' + selectedBody.name, [{ kind: 'body.delete', input: { bodyId: selectedBody.id } }]);
        else if (active && active.id !== selectedBody.id && (action === 'subtract' || action === 'intersect' || action === 'add')) {
          attemptBodyBoolean(action, active.id, selectedBody.id);
        }
      }));
      return;
    }
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
      fields += f.profileSketchId
        ? stat('Profile sketch', f.profileSketchId) + stat('Axis', f.axisDatumId) + stat('Angle', f.angle + '°') + stat('Start angle', f.startAngle + '°')
        : stat('Profile shapes', f.sketch.shapes.length);
    } else if (f.type === 'draft') {
      fields += stat('Neutral plane', f.neutralPlaneDatumId) + stat('Angle', f.angle + '°') + stat('Faces', f.faces.length);
    } else if (f.type === 'thicken') {
      fields += stat('Source body', f.sourceBodyId) + stat('Thickness', f.thickness + ' mm') + stat('Faces', f.faces.length);
    } else if (f.type === 'fillet' || f.type === 'chamfer') {
      fields += f.variableRadii?.length
        ? stat('Start radius', f.variableRadii[0].startRadius + ' mm') + stat('End radius', f.variableRadii[0].endRadius + ' mm') + stat('Edges', f.edges.length)
        : field('Radius (mm)', 'r', f.r) + stat('Edges', f.edges.length);
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
      '<div class="ctx-actions">' + (f.type === 'boolean' ? '' : '<button type="button" data-cxedit="1">Edit</button>') + '<button type="button" data-cxdel="1">Delete</button></div>';
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
        commitFeatureDraft('Edit ' + OP_LABEL[f.type].toLowerCase(), draft, false);
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
        const pattern = deepCopy(doc.features.find((x) => x.id === f.id)?.pattern);
        if (!pattern) return;
        if (key === 'n') pattern.n = value;
        else if (key === 'a') pattern[pattern.kind === 'circular' ? 'cx' : 'dx'] = value;
        else pattern[pattern.kind === 'circular' ? 'cy' : 'dy'] = value;
        commit('Edit ' + OP_LABEL[f.type].toLowerCase() + ' pattern', () => {
          const current = doc.features.find((feature) => feature.id === f.id);
          if (current) current.pattern = pattern;
        });
      }),
    );
    panel.querySelector('[data-cxthrough]')?.addEventListener('change', (e) => {
      const draft = deepCopy(f);
      draft.through = e.target.checked;
      if (!draft.through && !(draft.h > 0) && typeof draft.h !== 'string') draft.h = 10;
      commitFeatureDraft('Edit ' + OP_LABEL[f.type].toLowerCase(), draft, false);
    });
    panel.querySelector('[data-cxedit]')?.addEventListener('click', () => {
      if (f.type === 'transform') openV5Command(f.transform?.mode || f.operation || 'move', null, f.id);
      else if (f.type === 'loft' || f.type === 'sweep') openV5Command(f.type, null, f.id);
      else if (f.type === 'revolve' && f.profileSketchId) openV5Command('revolve-advanced', null, f.id);
      else if (f.type === 'draft' || f.type === 'thicken' || (f.type === 'fillet' && Array.isArray(f.variableRadii))) openV5Command(f.type === 'fillet' ? 'variable-fillet' : f.type, null, f.id);
      else startOperation(() => openEditorFor(f));
    });
    panel.querySelector('[data-cxdel]').addEventListener('click', () => {
      commitHumanOperations('Delete ' + OP_LABEL[f.type].toLowerCase(), [{ kind: 'feature.delete', input: { featureId: f.id } }]);
    });
  }

  // --- global keys: Escape, Enter, Delete, F, Space-pan ---------------------
  function cancelCurrent() {
    if (mode.kind === 'sketching') {
      if (!sketch.cancelStep()) $('bw-sk-cancel').click();
    }
    else if (mode.kind === 'press-pull') sketch.backFromPressPull();
    else if (mode.kind === 'picking-edges') $('bw-pick-cancel').click();
    else if (mode.kind === 'picking-faces') $('bw-shell-cancel').click();
    else if (mode.kind === 'choose-face') $('bw-face-cancel').click();
    else if (selectedFeatureId) selectFeature(null);
  }
  function applyCurrent() {
    if (mode.kind === 'sketching') {
      if (!sketch.finishPending()) $('bw-sk-apply').click();
    }
    else if (mode.kind === 'press-pull') sketch.applyPressPull();
    else if (mode.kind === 'picking-edges') $('bw-pick-apply').click();
    else if (mode.kind === 'picking-faces') $('bw-shell-apply').click();
  }
  function selectedDirectOccurrence() {
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'assembly') return null;
    return v5RuntimeTools.studioV5RootAssembly(doc).occurrences.find((entry) => entry.id === selectedOccurrenceId) || null;
  }
  function isolateKeyboardSelection() {
    const occurrence = selectedDirectOccurrence();
    if (occurrence) {
      if (appEl.dataset.isolateOccurrence === occurrence.id) delete appEl.dataset.isolateOccurrence;
      else appEl.dataset.isolateOccurrence = occurrence.id;
      isolatedBodyId = null; syncBodyMeshState(); renderContext();
      say(appEl.dataset.isolateOccurrence ? 'Isolated component ' + occurrence.name + '.' : 'All components restored.');
      return true;
    }
    if (selectedBodyId) {
      isolatedBodyId = isolatedBodyId === selectedBodyId ? null : selectedBodyId;
      if (appEl?.dataset.isolateOccurrence) delete appEl.dataset.isolateOccurrence;
      syncBodyMeshState(); renderBodies(); renderContext();
      const body = lastBodyResults.find((entry) => entry.bodyId === selectedBodyId);
      say(isolatedBodyId ? 'Isolated body ' + (body?.bodyName || selectedBodyId) + '.' : 'All bodies restored.');
      return true;
    }
    say('Select a body or direct component before using Isolate.');
    return false;
  }
  function hideKeyboardSelection() {
    const occurrence = selectedDirectOccurrence();
    if (occurrence) {
      commit('Hide ' + occurrence.name, () => v5RuntimeTools.updateStudioV5ComponentOccurrence(doc, occurrence.id, { visible: false }));
      return true;
    }
    if (selectedBodyId && v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'part') {
      commitHumanOperations('Hide selected body', [{ kind: 'body.setVisibility', input: { bodyId: selectedBodyId, visible: false } }]);
      return true;
    }
    say('Select a body or direct component before using Hide.');
    return false;
  }
  function showAllKeyboardSelection() {
    isolatedBodyId = null;
    if (appEl?.dataset.isolateOccurrence) delete appEl.dataset.isolateOccurrence;
    if (v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'part') {
      const hidden = v5RuntimeTools.studioV5RootPart(doc).bodies.filter((entry) => !entry.visible);
      if (hidden.length) commitHumanOperations('Show all bodies', hidden.map((body) => ({ kind: 'body.setVisibility', input: { bodyId: body.id, visible: true } })));
      else { syncBodyMeshState(); renderBodies(); }
    } else if (v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly') {
      const hidden = v5RuntimeTools.studioV5RootAssembly(doc).occurrences.filter((entry) => !entry.visible);
      if (hidden.length) commit('Show all components', () => hidden.reduce((candidate, occurrence) => v5RuntimeTools.updateStudioV5ComponentOccurrence(candidate, occurrence.id, { visible: true }), doc));
      else syncBodyMeshState();
    }
    say('All model items are visible.');
  }
  function toggleKeyboardSection() {
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'assembly') return say('Section views require an assembly document.');
    const assembly = v5RuntimeTools.studioV5RootAssembly(doc);
    const section = assembly.sectionViews.find((entry) => entry.id === assembly.metadata?.activeSectionViewId) || assembly.sectionViews[0];
    if (!section) return say('Save a section view before using Shift+S.');
    const active = assembly.metadata?.activeSectionViewId === section.id;
    commit((active ? 'Turn off ' : 'Activate ') + section.name, () => v5InspectionTools.activateStudioV5SectionView(doc, active ? null : section.id));
  }
  function editKeyboardSelection() {
    if (selectedMateId && v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly') {
      const mate = v5RuntimeTools.studioV5RootAssembly(doc).mates.find((entry) => entry.id === selectedMateId);
      if (mate) { openAssemblyCommand('mate', mate.kind, mate.id); return true; }
    }
    if (selectedFeatureId) {
      const edit = $('bw-history')?.querySelector('[data-edit="' + CSS.escape(selectedFeatureId) + '"]');
      if (edit) { edit.click(); return true; }
    }
    say('Select an editable feature or mate before using Edit.');
    return false;
  }
  function suppressKeyboardSelection() {
    if (selectedMateId && v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly') {
      const mate = v5RuntimeTools.studioV5RootAssembly(doc).mates.find((entry) => entry.id === selectedMateId);
      if (mate) { commit((mate.suppressed ? 'Restore ' : 'Suppress ') + mate.name, () => v5RuntimeTools.updateStudioV5AssemblyMate(doc, mate.id, { suppressed: !mate.suppressed })); return true; }
    }
    const occurrence = selectedDirectOccurrence();
    if (occurrence) { commit((occurrence.suppressed ? 'Restore ' : 'Suppress ') + occurrence.name, () => v5RuntimeTools.updateStudioV5ComponentOccurrence(doc, occurrence.id, { suppressed: !occurrence.suppressed })); return true; }
    if (selectedBodyId && v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'part') {
      const body = v5RuntimeTools.studioV5RootPart(doc).bodies.find((entry) => entry.id === selectedBodyId);
      if (body) { commitHumanOperations((body.suppressed ? 'Restore ' : 'Suppress ') + body.name, [{ kind: 'body.suppress', input: { bodyId: body.id, suppressed: !body.suppressed } }]); return true; }
    }
    if (selectedFeatureId) {
      const feature = doc.features.find((entry) => entry.id === selectedFeatureId);
      if (feature) { commitHumanOperations((feature.suppressed ? 'Restore ' : 'Suppress ') + (feature.name || feature.type), [{ kind: 'feature.suppress', input: { featureId: feature.id, suppressed: !feature.suppressed } }]); return true; }
    }
    say('Select a feature, body, component, or mate before using Suppress.');
    return false;
  }
  function cycleSelectionFilter() {
    const filters = ['auto', 'component', 'body', 'face', 'edge'];
    selectionFilter = filters[(filters.indexOf(selectionFilter) + 1) % filters.length];
    if (appEl) appEl.dataset.selectionFilter = selectionFilter;
    say('Selection filter: ' + ({ auto: 'Auto', component: 'Components', body: 'Bodies', face: 'Faces', edge: 'Edges' }[selectionFilter]) + '.');
  }
  $('bw-cmd-apply')?.addEventListener('click', () => applyCurrent());
  $('bw-cmd-cancel')?.addEventListener('click', () => cancelCurrent());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (draftDecision?.open) {
        e.preventDefault();
        keepEditing();
        return;
      }
      if (clearDecision?.open) {
        e.preventDefault();
        closeClearDecision();
        return;
      }
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
      if (e.key === 'Enter') {
        document.activeElement.blur();
        if (mode.kind === 'press-pull') sketch.applyPressPull();
      }
      return; // every other global key defers to the field
    }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && mode.kind === 'idle') {
      const key = e.key.toLowerCase();
      if (e.key === 'F6') { e.preventDefault(); cycleSelectionFilter(); return; }
      if (key === 'i' && !e.shiftKey) { e.preventDefault(); isolateKeyboardSelection(); return; }
      if (key === 'h') { e.preventDefault(); e.shiftKey ? showAllKeyboardSelection() : hideKeyboardSelection(); return; }
      if (key === 'm') {
        e.preventDefault();
        if (e.shiftKey) openInspectionCommand('measure');
        else if (selectedDirectOccurrence()) openAssemblyCommand('transform');
        else openV5Command('move');
        return;
      }
      if (key === 's' && e.shiftKey) { e.preventDefault(); toggleKeyboardSection(); return; }
      if (key === 'e') { e.preventDefault(); e.shiftKey ? suppressKeyboardSelection() : editKeyboardSelection(); return; }
    }
    if (e.key === 'Enter') applyCurrent();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && mode.kind === 'idle' && selectedFeatureId) {
      const f = doc.features.find((x) => x.id === selectedFeatureId);
      if (f) {
        commitHumanOperations('Delete ' + OP_LABEL[f.type].toLowerCase(), [{ kind: 'feature.delete', input: { featureId: f.id } }]);
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
        const activeBody = v5RuntimeTools.isStudioV5Project(doc) ? v5RuntimeTools.studioV5ActiveBody(doc) : null;
        const resultPolicy = activeBody
          ? t === 'cut'
            ? { kind: 'subtract', targetBodyIds: [activeBody.id], keepTools: false }
            : { kind: 'add', targetBodyIds: [activeBody.id] }
          : null;
        if (t === 'fillet' || t === 'chamfer') {
          picker.open({ id: newId(), type: t, r: 2, edges: [], ...(resultPolicy ? { resultPolicy } : {}) });
        } else if (t === 'shell') {
          shellPick.open({ id: newId(), type: t, t: 2, faces: [], ...(resultPolicy ? { resultPolicy } : {}) });
        } else {
          const draft = { id: newId(), type: t, sketch: { shapes: [], z: 0 }, h: 20, through: t === 'cut', ...(resultPolicy ? { resultPolicy } : {}) };
          // With a part on screen, extrude and cut can target any flat face;
          // the base plane stays one click away.
          if ((t === 'extrude' || t === 'cut') && solidMesh && faceByHash.size) facePick.open(draft);
          else sketch.open(draft);
        }
      });
    }),
  );

  $('bw-body-new')?.addEventListener('click', () => {
    startOperation(() => {
      loadKernel();
      const index = v5RuntimeTools.isStudioV5Project(doc)
        ? v5RuntimeTools.studioV5RootPart(doc).bodies.length + 1
        : 1;
      sketch.open({
        id: newId(),
        type: 'extrude',
        sketch: { shapes: [], z: 0 },
        h: 20,
        through: false,
        resultPolicy: { kind: 'new-body', bodyName: 'Body ' + index },
      });
    });
  });

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
    resetAgentForProjectChange('Started a blank project');
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
