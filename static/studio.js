// BOMwiki CAD Studio V6: agent-native parametric multi-body and assembly CAD in the browser, no signup.
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
  const v6InteractionTools = await import('/static/studio-v6-interaction.js');
  const v5ModelingTools = await import('/static/studio-v5-modeling.js');
  const v5AssemblyTools = await import('/static/studio-v5-assembly.js');
  const v5InspectionTools = await import('/static/studio-v5-inspection.js');
  // Dynamic controls receive the same stable identity advertised by the V6
  // registry. This is deliberately selector-to-contract plumbing, not an
  // agent click layer: semantic actions still enter through bomwikiCadUi.
  const V6_DYNAMIC_CONTROL_BINDINGS = Object.freeze([
    ['#bw-agent-activity', 'app.agent-activity.open'],
    ['.ws-agent-pair button[value="close"]', 'app.agent-activity.close'],
    ['.ws-agent-pair button[value="revoke"]', 'app.agent-activity.disconnect'],
    ['[data-pattern-instance-id] [data-pattern-instance-action="select"]', 'tree.entity.pattern-instance.select'],
    ['[data-pattern-instance-id] [data-pattern-instance-action="skip"]', 'tree.entity.pattern-instance.skip'],
    ['[data-pattern-instance-id] [data-pattern-instance-action="independent"]', 'tree.entity.pattern-instance.independent'],
    ['[data-pattern-instance-id] [data-body-export]', 'tree.entity.pattern-instance.export'],
    ['[data-pattern-action="edit"]', 'tree.entity.pattern.edit'],
    ['[data-pattern-action="visibility"]', 'tree.entity.pattern.visibility'],
    ['[data-pattern-action="dissolve"]', 'tree.entity.pattern.dissolve'],
    ['[data-pattern-action="delete"]', 'tree.entity.pattern.delete'],
    ['.hi-sel[data-sel]', 'tree.feature.select'],
    ['[data-move-feature="up"]', 'tree.feature.move-earlier'],
    ['[data-move-feature="down"]', 'tree.feature.move-later'],
    ['[data-rollback-feature]', 'tree.feature.rollback-toggle'],
    ['[data-edit]', 'tree.feature.edit'],
    ['[data-del]', 'tree.feature.delete'],
    ['.hist-item[draggable="true"]', 'tree.feature.drag-reorder'],
    ['[data-body-id] [data-body-action="select"]', 'tree.body.select'],
    ['[data-body-id] [data-body-action="activate"]', 'tree.body.activate'],
    ['[data-body-id] [data-body-action="visibility"]', 'tree.body.visibility'],
    ['[data-body-id] [data-body-action="isolate"]', 'tree.body.isolate'],
    ['[data-body-id] [data-body-action="rename"]', 'tree.body.rename'],
    ['[data-body-id] [data-body-action="suppress"]', 'tree.body.suppress'],
    ['[data-body-id] [data-body-export]', 'tree.body.export'],
    ['[data-body-id] [data-body-action="delete"]', 'tree.body.delete'],
    ['[data-occurrence-id] [data-occurrence-action="expand"]', 'tree.assembly.occurrence.expand'],
    ['[data-occurrence-id] [data-occurrence-action="select"]', 'tree.assembly.occurrence.select'],
    ['[data-occurrence-id] [data-occurrence-action="visibility"]', 'tree.assembly.occurrence.visibility'],
    ['[data-occurrence-id] [data-occurrence-action="suppress"]', 'tree.assembly.occurrence.suppress'],
    ['[data-runtime-occurrence-id] [data-occurrence-export]', 'tree.assembly.occurrence.export'],
    ['[data-runtime-occurrence-id] [data-runtime-occurrence-action="select"]', 'tree.assembly.runtime-occurrence.select'],
    ['[data-mate-id] [data-mate-action="select"]', 'tree.assembly.mate.select'],
    ['[data-mate-id] [data-mate-action="suppress"]', 'tree.assembly.mate.suppress'],
    ['[data-mate-id] [data-mate-action="delete"]', 'tree.assembly.mate.delete'],
    ['[data-inspection-kind="section"] [data-inspection-action="toggle"]', 'tree.inspection.section.toggle'],
    ['[data-inspection-kind="section"] [data-inspection-action="delete"]', 'tree.inspection.section.delete'],
    ['[data-inspection-kind="explode"] [data-inspection-action="toggle"]', 'tree.inspection.explode.toggle'],
    ['[data-inspection-kind="explode"] [data-inspection-action="delete"]', 'tree.inspection.explode.delete'],
    ['[data-inspection-kind="stage"] [data-inspection-action="visibility"]', 'tree.inspection.stage.visibility'],
    ['[data-inspection-kind="stage"] [data-inspection-action="spacing-less"]', 'tree.inspection.stage.spacing-less'],
    ['[data-inspection-kind="stage"] [data-inspection-action="spacing-more"]', 'tree.inspection.stage.spacing-more'],
    ['[data-inspection-kind="measurement"] [data-inspection-action="evaluate"]', 'tree.inspection.measurement.evaluate'],
    ['[data-inspection-kind="measurement"] [data-inspection-action="delete"]', 'tree.inspection.measurement.delete'],
    ['[data-pname]', 'parameter.row.rename'],
    ['[data-pval]', 'parameter.row.set-value'],
    ['[data-pdel]', 'parameter.row.delete'],
    ['.ws-template-card', 'template.card.select'],
    ['[data-recover]', 'recovery.entry.restore'],
    ['[data-inspection-context="clear"]', 'inspector.context.inspection.clear'],
    ['[data-mate-context="edit"]', 'inspector.context.mate.edit'],
    ['[data-mate-context="suppress"]', 'inspector.context.mate.suppress'],
    ['[data-mate-context="delete"]', 'inspector.context.mate.delete'],
    ['[data-occurrence-context="visibility"]', 'inspector.context.occurrence.visibility'],
    ['[data-occurrence-context="suppress"]', 'inspector.context.occurrence.suppress'],
    ['[data-occurrence-context="isolate"]', 'inspector.context.occurrence.isolate'],
    ['[data-occurrence-context="edit"]', 'inspector.context.occurrence.edit-context'],
    ['[data-occurrence-context="variant"]', 'inspector.context.occurrence.variant'],
    ['[data-occurrence-context="independent"]', 'inspector.context.occurrence.independent'],
    ['[data-occurrence-context="transform"]', 'inspector.context.occurrence.transform'],
    ['[data-occurrence-context="linked"]', 'inspector.context.occurrence.linked'],
    ['[data-occurrence-context="delete"]', 'inspector.context.occurrence.delete'],
    ['[data-occurrence-context="export"]', 'inspector.context.occurrence.export'],
    ['[data-pattern-context="edit"]', 'inspector.context.pattern.edit'],
    ['[data-pattern-context="skip"]', 'inspector.context.pattern.skip'],
    ['[data-body-name]', 'inspector.context.body.rename'],
    ['[data-body-context="active"]', 'inspector.context.body.activate'],
    ['[data-body-context="visibility"]', 'inspector.context.body.visibility'],
    ['[data-body-context="isolate"]', 'inspector.context.body.isolate'],
    ['[data-body-context="suppress"]', 'inspector.context.body.suppress'],
    ['[data-body-context="subtract"]', 'inspector.context.body.subtract'],
    ['[data-body-context="intersect"]', 'inspector.context.body.intersect'],
    ['[data-body-context="add"]', 'inspector.context.body.union'],
    ['[data-body-context="delete"]', 'inspector.context.body.delete'],
    ['[data-cx]', 'inspector.context.feature.dimension'],
    ['[data-cxthrough]', 'inspector.context.feature.through'],
    ['[data-cxpat="n"]', 'inspector.context.feature.pattern-count'],
    ['[data-cxpat="a"]', 'inspector.context.feature.pattern-a'],
    ['[data-cxpat="b"]', 'inspector.context.feature.pattern-b'],
    ['[data-cxedit]', 'inspector.context.feature.edit'],
    ['[data-cxdel]', 'inspector.context.feature.delete'],
    ['#bw-v5-command-form input, #bw-v5-command-form select, #bw-v5-command-form textarea', 'dialog.command.field'],
    ['[data-template-category]', 'dialog.template.category'],
  ]);
  function labelV6DynamicControls(root = document) {
    for (const [selector, controlId] of V6_DYNAMIC_CONTROL_BINDINGS) {
      const matches = root instanceof Element && root.matches(selector) ? [root] : [];
      const descendants = typeof root.querySelectorAll === 'function' ? root.querySelectorAll(selector) : [];
      for (const element of [...matches, ...descendants]) {
        if (!element.dataset.v6ControlId) element.dataset.v6ControlId = controlId;
      }
    }
    const pauseButtons = [
      ...(root instanceof Element && root.matches('.ws-agent-pair button[value="pause"]') ? [root] : []),
      ...(typeof root.querySelectorAll === 'function' ? root.querySelectorAll('.ws-agent-pair button[value="pause"]') : []),
    ];
    for (const button of pauseButtons) {
      button.dataset.v6ControlId = /^resume$/i.test(button.textContent.trim())
        ? 'app.agent-activity.resume'
        : 'app.agent-activity.pause';
    }
  }
  labelV6DynamicControls();
  new MutationObserver(() => labelV6DynamicControls())
    .observe(document.body, { childList: true, subtree: true });
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
  const markWelcomeReady = () => {
    const welcome = $('bw-welcome');
    if (!welcome) return;
    welcome.setAttribute('aria-busy', 'false');
    welcome.querySelectorAll('[data-welcome-boot-disabled]').forEach((button) => {
      button.disabled = false;
      button.removeAttribute('data-welcome-boot-disabled');
    });
    const status = $('bw-welcome-status');
    if (status) status.hidden = true;
    const shell = window.__bwStudioShell || {};
    shell.welcomeReadyAt = performance.now();
    window.__bwStudioShell = shell;
    performance.mark?.('bw-studio-welcome-ready');
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
  async function restoreRecoveryEntry(snapshot, { preserveAgent = false } = {}) {
    if (!snapshot) throw new Error('That recovery entry is no longer available.');
    let recovered;
    let targetProject = null;
    try {
      const { prepareStudioDocument } = await documentToolsReady;
      recovered = prepareStoredDocument(snapshot.document, prepareStudioDocument);
    } catch (error) {
      throw new Error('Could not recover project: ' + String(error?.message || error));
    }
    if (snapshot.projectId !== projectId) {
      try {
        const journal = await journalReady;
        const stored = journal ? await journal.loadProject(snapshot.projectId) : null;
        const { prepareStudioDocument } = await documentToolsReady;
        targetProject = stored ? hydrateProjectRecord(stored, (candidate) => prepareStoredDocument(candidate, prepareStudioDocument)) : null;
      } catch (error) {
        setStorageState('unavailable', String(error?.message || error));
        throw new Error('Could not read that project journal. Modeling and export still work.');
      }
    }
    closeRecovery();
    if (snapshot.projectId === projectId) {
      commit('Restore recovered state', () => recovered, { actor: preserveAgent ? 'agent' : 'human' });
    } else if (targetProject) {
      projectId = targetProject.projectId;
      doc = targetProject.document;
      commandRevision = targetProject.commandRevision;
      undoStack.splice(0, undoStack.length, ...targetProject.undoStack);
      redoStack.splice(0, redoStack.length, ...targetProject.redoStack);
      trimHistoryStacks();
      resetAgentForProjectChange('Recovered another project', {
        preserveConnection: preserveAgent,
        keepRevision: true,
      });
      commit('Restore recovered state', () => recovered, { actor: preserveAgent ? 'agent' : 'human' });
    } else {
      projectId = snapshot.projectId || makeProjectId();
      doc = normalizeDoc(recovered);
      undoStack.length = 0;
      redoStack.length = 0;
      resetAgentForProjectChange('Recovered another project', { preserveConnection: preserveAgent });
      afterDocumentChange();
      if (preserveAgent) emitAgentProjectTransition('Recovered another project');
    }
    say('Recovered ' + (snapshot.title || 'local project') + '.');
    return {
      snapshotId: snapshot.snapshotId,
      projectId,
      revision: commandRevision,
      title: doc.title,
      documentHash: v5RuntimeTools.isStudioV5Project(doc) ? v5RuntimeTools.studioV5CanonicalHash(doc) : null,
    };
  }
  recoveryList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-recover]');
    const snapshot = button && recoveryEntries.get(button.dataset.recover);
    if (!snapshot) return;
    startOperation(() => restoreRecoveryEntry(snapshot), {
      nextLabel: 'restore “' + (snapshot.title || 'local project') + '”',
    });
  });

  const fullscreenLabel = $('bw-fullscreen-label');
  const fullscreenButton = $('bw-fullscreen');
  const syncFullscreen = () => {
    const on = document.fullscreenElement === appEl;
    fullscreenButton?.setAttribute('aria-pressed', String(on));
    if (fullscreenLabel) fullscreenLabel.textContent = on ? 'Exit full screen' : 'Full screen';
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (appEl?.requestFullscreen) await appEl.requestFullscreen();
      else say('Full screen is not available in this browser.');
      return document.fullscreenElement === appEl;
    } catch {
      say('Full screen is not available in this browser.');
      return false;
    }
  };
  fullscreenButton?.addEventListener('click', toggleFullscreen);
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
  let renderSerial = 0;
  let lastRenderedDocumentRevision = 0;
  let lastRenderedKernelRevision = -1;
  let lastRenderedUiRevision = 0;
  const renderSettlementWaiters = new Set();

  function completeRenderedFrame() {
    renderSerial++;
    lastRenderedKernelRevision = latestAppliedRevision;
    if (latestAppliedRevision >= latestRequestedRevision) lastRenderedDocumentRevision = commandRevision;
    if (v6InteractionRuntime) lastRenderedUiRevision = Math.max(lastRenderedUiRevision, v6InteractionRuntime.uiRevision);
    for (const resolve of renderSettlementWaiters) resolve(renderSerial);
    renderSettlementWaiters.clear();
  }

  function renderScene() {
    const useBatches = sceneBatchObjects.length > 0 && !transformPreview && mode.kind !== 'picking-edges';
    if (!useBatches) {
      renderer.render(scene, camera);
      completeRenderedFrame();
      return;
    }
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
    completeRenderedFrame();
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

  function makeKernelRequest(kind, revision, options = {}) {
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
    return request;
  }

  function isolatedKernelCall(kind, revision, options = {}) {
    // OpenCascade's STEP/STL writer mutates process-global kernel state and,
    // in the vendored WASM build, can poison a later modeling allocation.
    // Run exports in a disposable worker so the authoritative modeling cache
    // and every subsequent edit remain in an untouched allocator.
    const request = makeKernelRequest(kind, revision, options);
    return new Promise((resolve, reject) => {
      const worker = new Worker('/static/studio-kernel.worker.js', { type: 'module' });
      let posted = false;
      let settled = false;
      const timer = setTimeout(() => {
        finish(reject, new Error('The isolated CAD export worker did not respond in time.'));
      }, KERNEL_REQUEST_TIMEOUT);
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch {}
        callback(value);
      };
      worker.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.kind === 'kernel-status') {
          if (message.status === 'ready' && !posted) {
            posted = true;
            try { worker.postMessage(request); }
            catch (error) { finish(reject, error); }
          } else if (message.status === 'failed') {
            finish(reject, new Error(message.message || 'The isolated CAD export kernel failed to load.'));
          }
          return;
        }
        if (message?.requestId !== request.requestId) return;
        if (message.kind === 'kernel-error') finish(reject, new Error(message.message || 'The isolated CAD export failed.'));
        else finish(resolve, message);
      });
      worker.addEventListener('error', (event) => {
        finish(reject, new Error(event.message || 'The isolated CAD export worker stopped.'));
      });
    });
  }

  async function kernelCall(kind, revision, options = {}) {
    if (kind === 'export-step' || kind === 'export-stl') {
      return isolatedKernelCall(kind, revision, options);
    }
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
    const request = makeKernelRequest(kind, revision, options);
    const requestId = request.requestId;
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
  let localAgentBridgeFrame = null;
  let localAgentBridgeTimer = null;
  const LOCAL_AGENT_BRIDGE_PORT = 49784;
  const LOCAL_AGENT_BRIDGE_ORIGIN = 'http://127.0.0.1:' + LOCAL_AGENT_BRIDGE_PORT;
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
    const restoredRevision = Number.isInteger(record.commandRevision) && record.commandRevision >= 0
      ? record.commandRevision
      : restoredUndo.length + restoredRedo.length;
    return {
      projectId: record.projectId || makeProjectId(),
      document,
      undoStack: restoredUndo,
      redoStack: restoredRedo,
      commandRevision: restoredRevision,
    };
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

  function labelAgentDialog(dialog, id) {
    const heading = dialog.querySelector('h2');
    const description = dialog.querySelector('p:not(.ws-agent-kicker)');
    if (heading) {
      heading.id = id + '-title';
      dialog.setAttribute('aria-labelledby', heading.id);
    }
    if (description) {
      description.id = id + '-description';
      dialog.setAttribute('aria-describedby', description.id);
    }
  }

  function resetAgentForProjectChange(reason, options = {}) {
    if (options.keepRevision !== true) commandRevision = 0;
    liveAgentService = null;
    if (!activeAgentConnection) return;
    if (options.preserveConnection === true) {
      activeAgentConnection.previews.clear();
      activeAgentConnection.permissionContext.projectIds = [projectId];
      updateAgentActivity(reason || 'Project changed', 'agent');
      return;
    }
    revokeAgentConnection(reason || 'Project changed');
  }

  function emitAgentProjectTransition(label) {
    v6InteractionRuntime?.emit('document.changed', {
      revision: commandRevision,
      label,
      actor: 'agent',
      projectTransition: true,
      documentHash: v5RuntimeTools.isStudioV5Project(doc) ? v5RuntimeTools.studioV5CanonicalHash(doc) : null,
    }, { actor: 'agent', uiRevision: v6InteractionRuntime.uiRevision });
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
          if (command.historyAction === 'undo') undo({ actor: 'agent' });
          else if (command.historyAction === 'redo') redo({ actor: 'agent' });
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
      visibleStudio: true,
    });
    return liveAgentService;
  }

  function approvedPermissionContext(requested) {
    const allowed = new Set([
      'project.read',
      'project.edit',
      'project.replace',
      'project.recover',
      'artifact.render',
      'artifact.export-project',
      'artifact.export-step',
      'artifact.export-stl',
      'artifact.export-narration',
      'ui.read',
      'ui.select',
      'ui.navigate',
      'ui.command-draft',
      'ui.present-preview',
      'ui.present-demo',
      'ui.present-narration',
      'ui.wait-events',
      'session.launch-visible',
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
    if (mode === 'read-only') {
      const mutatingPermissions = new Set(['project.edit', 'project.replace', 'project.recover']);
      permissionContext.granted = permissionContext.granted.filter((permission) => !mutatingPermissions.has(permission));
    }
    v6NarrationCueLog.length = 0;
    activeAgentConnection = {
      sessionId,
      connectionToken,
      clientLabel: String(options.clientLabel || 'Local CAD agent').trim().slice(0, 80) || 'Local CAD agent',
      skillVersion: typeof options.skillVersion === 'string' ? options.skillVersion.slice(0, 40) : 'unknown',
      permissionContext,
      mode,
      paused: false,
      recovered: options.resume === true,
      previews: new Map(),
      bridgeWindow: options.bridgeWindow || null,
      bridgeOrigin: options.bridgeOrigin || null,
      connectedAt: new Date().toISOString(),
    };
    service.previews.clear();
    updateAgentActivity('Connected · revision ' + commandRevision, 'agent');
    say(options.resume ? 'CAD agent reconnected.' : 'CAD agent connected.');
    return {
      protocol: agentTools.CAD_AGENT_PROTOCOL,
      sessionId,
      projectId,
      revision: commandRevision,
      uiRevision: getV6InteractionRuntime().snapshot().uiRevision,
      connectionToken,
      permissionContext: deepCopy(activeAgentConnection.permissionContext),
      mode: activeAgentConnection.mode,
      capabilities: service.capabilities({ detail: 'summary' }),
    };
  }

  function requestAgentConnection(options = {}) {
    if (activeAgentConnection) return Promise.reject(new agentTools.CadAgentError('SESSION_ALREADY_CONNECTED', 'Another agent session is already connected.'));
    return new Promise((resolve, reject) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'ws-agent-pair';
      const clientLabel = String(options.clientLabel || 'Local CAD agent').trim().slice(0, 80) || 'Local CAD agent';
      const permissions = approvedPermissionContext(options.permissionContext).granted;
      const expiry = typeof options.expiresAt === 'string' && Number.isFinite(Date.parse(options.expiresAt))
        ? new Date(options.expiresAt).toLocaleString()
        : 'Session policy default';
      dialog.innerHTML =
        '<form method="dialog"><p class="ws-agent-kicker">STRUCTURED AGENT ACCESS</p>' +
        '<h2></h2><p>This connection uses typed CAD commands, not screen control. Every edit is previewed, revision-checked, validated, visible in History, and undoable.</p>' +
        '<dl><dt>Project</dt><dd></dd><dt>Permissions</dt><dd></dd><dt>Skill</dt><dd></dd><dt>Expires</dt><dd></dd></dl>' +
        '<div><button value="cancel" data-v6-control-id="app.agent.connection-deny">Deny</button><button value="approve" class="primary" data-v6-control-id="app.agent.connection-approve">Connect</button></div></form>';
      labelAgentDialog(dialog, 'bw-agent-connect');
      dialog.querySelector('h2').textContent = clientLabel + ' wants to connect';
      dialog.querySelectorAll('dd')[0].textContent = doc.title;
      dialog.querySelectorAll('dd')[1].textContent = permissions.join(', ');
      dialog.querySelectorAll('dd')[2].textContent = String(options.skillVersion || 'Not reported');
      dialog.querySelectorAll('dd')[3].textContent = expiry;
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
    v6InteractionRuntime?.interrupt?.('SESSION_REVOKED', reason);
    v6InteractionRuntime?.emit?.('session.revoked', { reason }, { actor: 'human' });
    activeAgentConnection = null;
    v6InteractionRuntime = null;
    v6RevealedEntity = null;
    if (appEl?.dataset.agentRevealedEntity) delete appEl.dataset.agentRevealedEntity;
    hideV6Narration();
    const element = $('bw-agent-activity');
    if (element) element.hidden = true;
    clearTimeout(localAgentBridgeTimer);
    localAgentBridgeTimer = null;
    localAgentBridgeFrame?.remove();
    localAgentBridgeFrame = null;
    pendingPairingWindow = null;
    pendingPairingOrigin = null;
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
        '<div><button value="reject" data-v6-control-id="app.agent.preview-reject">Reject</button><button value="approve" class="primary" data-v6-control-id="app.agent.preview-approve">Apply change</button></div></form>';
      labelAgentDialog(dialog, 'bw-agent-preview-approval');
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
    if (request.payload?.kind === 'commit') {
      if (response.status === 'ok') activeAgentConnection.previews.clear();
      else activeAgentConnection.previews.delete(request.payload.previewId);
    }
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
    labelAgentDialog(dialog, 'bw-agent-session');
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
        if (activeAgentConnection.paused) {
          liveAgentService?.previews.clear();
          v6InteractionRuntime?.interrupt?.('SESSION_PAUSED', 'The user paused this agent session.');
          v6InteractionRuntime?.emit?.('session.paused', { reason: 'Paused by user' }, { actor: 'human' });
          postToPairingWindow({ type: 'session.paused', reason: 'The user paused this Studio session.' });
        } else {
          v6InteractionRuntime?.emit?.('session.resumed', {}, { actor: 'human' });
          postToPairingWindow({ type: 'session.resumed' });
        }
        updateAgentActivity(activeAgentConnection.paused ? 'Paused by you' : 'Connected · revision ' + commandRevision, activeAgentConnection.paused ? 'human' : 'agent');
      } else if (action === 'revoke') revokeAgentConnection('Disconnected by user');
    }, { once: true });
    dialog.showModal();
  }

  function openLoopbackPairDialog(options = {}) {
    if (activeAgentConnection) return openAgentSessionDialog();
    closeHelp();
    const nonce = typeof options.nonce === 'string' && /^[A-Za-z0-9-]{20,200}$/.test(options.nonce)
      ? options.nonce
      : '';
    localAgentBridgeFrame?.remove();
    clearTimeout(localAgentBridgeTimer);
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'BOMwiki CAD local agent bridge';
    const url = new URL('/pair', LOCAL_AGENT_BRIDGE_ORIGIN);
    url.searchParams.set('studioOrigin', location.origin);
    url.searchParams.set('embed', '1');
    if (nonce) url.searchParams.set('nonce', nonce);
    frame.src = url.href;
    localAgentBridgeFrame = frame;
    pendingPairingWindow = frame.contentWindow;
    pendingPairingOrigin = url.origin;
    document.body.appendChild(frame);
    pendingPairingWindow = frame.contentWindow;
    localAgentBridgeTimer = setTimeout(() => {
      if (activeAgentConnection || localAgentBridgeFrame !== frame) return;
      frame.remove();
      localAgentBridgeFrame = null;
      pendingPairingWindow = null;
      pendingPairingOrigin = null;
      say('No local BOMwiki CAD agent is waiting. Start the integration and choose Connect agent again.', true);
    }, 5000);
    say(options.recovery ? 'Finding the local agent session to recover…' : 'Finding the local CAD agent…');
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

  function base64ToBytes(encoded) {
    if (typeof encoded !== 'string' || encoded.length > 512 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new agentTools.CadAgentError('INVALID_ARTIFACT_REQUEST', 'The import chunk is not bounded base64 data.');
    }
    let binary;
    try {
      binary = atob(encoded);
    } catch {
      throw new agentTools.CadAgentError('INVALID_ARTIFACT_REQUEST', 'The import chunk is not valid base64 data.');
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function boundedArtifactDimension(value, fallback) {
    const dimension = value == null ? fallback : value;
    if (!Number.isInteger(dimension) || dimension < 128 || dimension > 2048) {
      throw new agentTools.CadAgentError('INVALID_ARTIFACT_DIMENSION', 'Render dimensions must be integers from 128 to 2048 pixels.');
    }
    return dimension;
  }

  function resolveArtifactBodyScope(args = {}, options = {}) {
    const allowedKinds = new Set(['body', 'occurrence', 'part', 'assembly']);
    const scopeDocument = options.document || doc;
    const scopeBodyResults = (options.bodyResults || lastBodyResults).map((entry) => entry.body
      ? {
          bodyId: entry.body.id,
          bodyName: entry.body.name,
          sourceBodyId: entry.sourceBodyId || entry.body.id,
          occurrenceInstance: entry.occurrenceInstance || null,
          geometry: { valid: entry.valid === true },
          visible: entry.visible !== false,
          suppressed: entry.suppressed === true,
        }
      : entry);
    const explicit = Array.isArray(args.entities) ? args.entities : null;
    if (explicit && (explicit.length < 1 || explicit.length > 100)) {
      throw new agentTools.CadAgentError('INVALID_ARTIFACT_SCOPE', 'Artifact entity scope requires between 1 and 100 stable references.');
    }
    if (args.scope != null && !['selection', 'visible-model'].includes(args.scope)) {
      throw new agentTools.CadAgentError('INVALID_ARTIFACT_SCOPE', 'Artifact scope must be selection or visible-model.');
    }
    const selectedRefs = currentV6Selections().map((entry) => deepCopy(entry.owner || entry));
    const mode = explicit ? 'entities' : args.scope || (selectedRefs.length ? 'selection' : 'visible-model');
    const requestedEntities = explicit || (mode === 'selection' ? selectedRefs : []);
    const candidates = scopeBodyResults.filter((entry) => entry.geometry?.valid && !entry.suppressed);
    const resolved = new Set();
    if (mode === 'visible-model') {
      for (const entry of candidates) if (entry.visible !== false) resolved.add(entry.bodyId);
    } else {
      for (const ref of requestedEntities) {
        if (!ref || typeof ref !== 'object' || !allowedKinds.has(ref.kind) || typeof ref.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(ref.id)) {
          throw new agentTools.CadAgentError('INVALID_ARTIFACT_SCOPE', 'Artifact entities require stable body, occurrence, part, or assembly references.');
        }
        let matched = false;
        for (const entry of candidates) {
          const occurrence = entry.occurrenceInstance;
          if (ref.kind === 'body' && (entry.bodyId === ref.id || entry.sourceBodyId === ref.id)) {
            resolved.add(entry.bodyId);
            matched = true;
          } else if (ref.kind === 'occurrence' && occurrence?.occurrencePath?.includes(ref.id)) {
            resolved.add(entry.bodyId);
            matched = true;
          }
          else if (ref.kind === 'part' && (
            occurrence?.definition?.partId === ref.id ||
            (scopeDocument.rootDocument?.kind === 'part' && scopeDocument.rootDocument.partId === ref.id)
          )) {
            resolved.add(entry.bodyId);
            matched = true;
          } else if (ref.kind === 'assembly' && scopeDocument.rootDocument?.kind === 'assembly' && scopeDocument.rootDocument.assemblyId === ref.id) {
            resolved.add(entry.bodyId);
            matched = true;
          }
        }
        if (!matched) {
          throw new agentTools.CadAgentError('MISSING_REFERENCE', `${ref.kind} "${ref.id}" has no exact exportable body in the current result.`);
        }
      }
    }
    if (!resolved.size) throw new agentTools.CadAgentError('ARTIFACT_SCOPE_EMPTY', 'The requested artifact scope has no exact exportable bodies.');
    const bodyIds = [...resolved].sort();
    const bodies = bodyIds.map((bodyId) => {
      const entry = scopeBodyResults.find((candidate) => candidate.bodyId === bodyId);
      return {
        bodyId,
        bodyName: entry?.bodyName || bodyId,
        sourceBodyId: entry?.sourceBodyId || bodyId,
        occurrenceId: entry?.occurrenceInstance?.occurrenceId || null,
        occurrencePath: deepCopy(entry?.occurrenceInstance?.occurrencePath || []),
      };
    });
    return { mode, requestedEntities: deepCopy(requestedEntities), bodyIds, bodies };
  }

  async function captureV6ModelRender(scope, width, height) {
    const exportScene = new THREE.Scene();
    exportScene.background = scene.background?.clone?.() || scene.background || null;
    exportScene.environment = scene.environment || null;
    for (const child of scene.children) if (child.isLight) exportScene.add(child.clone());
    const exportGroup = new THREE.Group();
    exportGroup.position.copy(partGroup.position);
    exportGroup.quaternion.copy(partGroup.quaternion);
    exportGroup.scale.copy(partGroup.scale);
    exportGroup.updateMatrix();
    exportScene.add(exportGroup);
    const selected = new Set(scope.bodyIds);
    const linesByBody = new Map(edgeLines.map((line) => [line.userData.bodyId, line]));
    for (const bodyId of selected) {
      const mesh = bodyMeshes.get(bodyId);
      if (!mesh) throw new agentTools.CadAgentError('RENDER_SCOPE_NOT_AVAILABLE', `Body "${bodyId}" has no rendered exact mesh.`);
      const meshClone = mesh.clone(true);
      meshClone.visible = true;
      exportGroup.add(meshClone);
      const line = linesByBody.get(bodyId);
      if (line) {
        const lineClone = line.clone(true);
        lineClone.visible = line.visible;
        exportGroup.add(lineClone);
      }
    }
    exportGroup.updateMatrixWorld(true);
    const exportCamera = camera.clone();
    exportCamera.aspect = width / height;
    exportCamera.updateProjectionMatrix();
    const target = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: true,
      stencilBuffer: true,
    });
    target.texture.colorSpace = renderer.outputColorSpace;
    const previousTarget = renderer.getRenderTarget();
    const pixels = new Uint8Array(width * height * 4);
    try {
      renderer.setRenderTarget(target);
      renderer.clear(true, true, true);
      renderer.render(exportScene, exportCamera);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    } finally {
      renderer.setRenderTarget(previousTarget);
      target.dispose();
    }
    const flipped = new Uint8ClampedArray(pixels.length);
    const rowBytes = width * 4;
    for (let row = 0; row < height; row++) {
      flipped.set(pixels.subarray(row * rowBytes, (row + 1) * rowBytes), (height - row - 1) * rowBytes);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new agentTools.CadAgentError('RENDER_TRANSFER_FAILED', 'A 2D encoder is unavailable for the model render.');
    context.putImageData(new ImageData(flipped, width, height), 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new agentTools.CadAgentError('RENDER_TRANSFER_FAILED', 'Studio could not encode the model render.');
    return new Uint8Array(await blob.arrayBuffer());
  }

  function subtitleTimestamp(milliseconds, separator) {
    const bounded = Math.max(0, Math.round(milliseconds));
    const hours = Math.floor(bounded / 3_600_000);
    const minutes = Math.floor((bounded % 3_600_000) / 60_000);
    const seconds = Math.floor((bounded % 60_000) / 1000);
    const millis = bounded % 1000;
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':') +
      separator + String(millis).padStart(3, '0');
  }

  function narrationArtifact(format) {
    const trustedSources = new Set(['capability-template', 'presentation-template', 'evidence-template', 'attention-template']);
    const cues = v6NarrationCueLog
      .filter((entry) => entry.state === 'completed' && Number.isFinite(entry.completedAtMs) && trustedSources.has(entry.source))
      .map((entry) => ({ ...entry, text: String(entry.text || '').replace(/\s+/g, ' ').trim() }))
      .filter((entry) => entry.text);
    const origin = cues[0]?.startedAtMs || 0;
    const blocks = cues.map((cue, index) => {
      const start = Math.max(0, cue.startedAtMs - origin);
      const end = Math.max(start + 250, cue.completedAtMs - origin);
      const timing = format === 'webvtt'
        ? `${subtitleTimestamp(start, '.')} --> ${subtitleTimestamp(end, '.')}`
        : `${subtitleTimestamp(start, ',')} --> ${subtitleTimestamp(end, ',')}`;
      return format === 'webvtt'
        ? `${cue.cueId}\n${timing}\n${cue.text}`
        : `${index + 1}\n${timing}\n${cue.text}`;
    });
    const text = format === 'webvtt' ? `WEBVTT\n\n${blocks.join('\n\n')}${blocks.length ? '\n' : ''}` : `${blocks.join('\n\n')}${blocks.length ? '\n' : ''}`;
    return {
      bytes: new TextEncoder().encode(text),
      mediaType: format === 'webvtt' ? 'text/vtt; charset=utf-8' : 'application/x-subrip; charset=utf-8',
      manifest: {
        kind: 'visible-narration',
        visibleOnly: true,
        cueCount: cues.length,
        cues: cues.map(({ cueId, correlationId, kind, source }) => ({ cueId, correlationId, kind, source })),
      },
    };
  }

  const MAX_LIVE_IMPORT_BYTES = 32 * 1024 * 1024;
  const MAX_LIVE_IMPORT_TRANSFERS = 4;
  const LIVE_IMPORT_TTL_MS = 2 * 60 * 1000;
  const liveImportTransfers = new Map();

  function pruneLiveImportTransfers() {
    const cutoff = Date.now() - LIVE_IMPORT_TTL_MS;
    for (const [transferId, transfer] of liveImportTransfers) {
      if (transfer.createdAt < cutoff) liveImportTransfers.delete(transferId);
    }
  }

  function requireLiveImportTransfer(transferId) {
    pruneLiveImportTransfers();
    const transfer = liveImportTransfers.get(transferId);
    if (!transfer) {
      throw new agentTools.CadAgentError('ARTIFACT_TRANSFER_MISSING', 'The bounded import transfer is missing or expired.');
    }
    return transfer;
  }

  async function liveAgentImportArtifact(args) {
    if (!activeAgentConnection.permissionContext.granted.includes('project.replace')) {
      throw new agentTools.CadAgentError('PERMISSION_DENIED', 'Permission "project.replace" is required.');
    }
    const action = args.action;
    if (action === 'import.begin') {
      const unknownKeys = Object.keys(args).filter((key) =>
        !['action', 'transferId', 'format', 'filename', 'bytes', 'sha256', 'totalChunks'].includes(key));
      if (unknownKeys.length) {
        throw new agentTools.CadAgentError('INVALID_ARTIFACT_REQUEST', 'The import-begin request contains unadvertised fields.', { unknownKeys });
      }
      pruneLiveImportTransfers();
      if (liveImportTransfers.size >= MAX_LIVE_IMPORT_TRANSFERS) {
        throw new agentTools.CadAgentError('LIMIT_PENDING_REQUESTS', 'Studio already has four bounded import transfers in progress.');
      }
      if (
        typeof args.transferId !== 'string' || !/^import-[A-Za-z0-9-]{20,200}$/.test(args.transferId) ||
        !['project', 'step'].includes(args.format) ||
        typeof args.filename !== 'string' || !args.filename || args.filename.length > 240 ||
        !Number.isInteger(args.bytes) || args.bytes < 1 || args.bytes > MAX_LIVE_IMPORT_BYTES ||
        typeof args.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(args.sha256) ||
        !Number.isInteger(args.totalChunks) ||
        args.totalChunks !== Math.ceil(args.bytes / (192 * 1024)) ||
        args.totalChunks > 256
      ) {
        throw new agentTools.CadAgentError('INVALID_ARTIFACT_REQUEST', 'The import transfer metadata is invalid or exceeds its advertised bounds.');
      }
      liveImportTransfers.set(args.transferId, {
        transferId: args.transferId,
        format: args.format,
        filename: args.filename,
        bytes: args.bytes,
        sha256: args.sha256,
        totalChunks: args.totalChunks,
        chunks: new Array(args.totalChunks),
        createdAt: Date.now(),
      });
      return { transferId: args.transferId, ready: true, totalChunks: args.totalChunks };
    }
    if (action === 'import.chunk') {
      const unknownKeys = Object.keys(args).filter((key) =>
        !['action', 'transferId', 'index', 'dataBase64'].includes(key));
      if (unknownKeys.length) {
        throw new agentTools.CadAgentError('INVALID_ARTIFACT_REQUEST', 'The import-chunk request contains unadvertised fields.', { unknownKeys });
      }
      const transfer = requireLiveImportTransfer(args.transferId);
      if (!Number.isInteger(args.index) || args.index < 0 || args.index >= transfer.totalChunks) {
        throw new agentTools.CadAgentError('INVALID_ARTIFACT_REQUEST', 'The import chunk index is outside the advertised transfer.');
      }
      const chunk = base64ToBytes(args.dataBase64);
      const expectedChunkBytes = args.index === transfer.totalChunks - 1
        ? transfer.bytes - (args.index * 192 * 1024)
        : 192 * 1024;
      if (chunk.byteLength !== expectedChunkBytes) {
        throw new agentTools.CadAgentError('ARTIFACT_IMPORT_SIZE', 'The import chunk does not match its declared bounded transfer size.');
      }
      transfer.chunks[args.index] = chunk;
      return { transferId: transfer.transferId, index: args.index, bytes: chunk.byteLength, accepted: true };
    }
    if (action === 'import.abort') {
      const unknownKeys = Object.keys(args).filter((key) => !['action', 'transferId'].includes(key));
      if (unknownKeys.length) {
        throw new agentTools.CadAgentError('INVALID_ARTIFACT_REQUEST', 'The import-abort request contains unadvertised fields.', { unknownKeys });
      }
      const removed = liveImportTransfers.delete(args.transferId);
      return { transferId: args.transferId, aborted: removed };
    }
    if (action !== 'import.commit') {
      throw new agentTools.CadAgentError('INVALID_ARTIFACT_REQUEST', 'The live import action is not advertised.');
    }
    const unknownKeys = Object.keys(args).filter((key) => !['action', 'transferId'].includes(key));
    if (unknownKeys.length) {
      throw new agentTools.CadAgentError('INVALID_ARTIFACT_REQUEST', 'The import-commit request contains unadvertised fields.', { unknownKeys });
    }
    const transfer = requireLiveImportTransfer(args.transferId);
    if (transfer.chunks.filter((chunk) => chunk instanceof Uint8Array).length !== transfer.totalChunks) {
      throw new agentTools.CadAgentError('ARTIFACT_TRANSFER_MISSING', 'The import transfer is incomplete.');
    }
    const bytes = new Uint8Array(transfer.chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of transfer.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (bytes.byteLength !== transfer.bytes || await sha256Hex(bytes) !== transfer.sha256) {
      liveImportTransfers.delete(transfer.transferId);
      throw new agentTools.CadAgentError('ARTIFACT_TRANSFER_INTEGRITY', 'The imported artifact failed byte-count or SHA-256 validation.');
    }
    liveImportTransfers.delete(transfer.transferId);
    if (v6AgentCommandDraft || isWorking(mode.kind) || v5Dialog?.open) {
      throw new agentTools.CadAgentError('COMMAND_BLOCKED', 'Finish or cancel the active command before importing another project.');
    }
    const imported = await prepareImportedProject(bytes, transfer.format, transfer.filename);
    if (v6AgentCommandDraft || isWorking(mode.kind) || v5Dialog?.open) {
      throw new agentTools.CadAgentError('COMMAND_BLOCKED', 'A command opened while the artifact was loading; the project was not replaced.');
    }
    const result = await activateImportedProject(imported, transfer.filename, { preserveAgent: true });
    const runtime = getV6InteractionRuntime();
    runtime.emit('artifact.completed', {
      direction: 'import',
      format: transfer.format,
      bytes: transfer.bytes,
      sha256: transfer.sha256,
      documentHash: result.documentHash,
      importManifest: deepCopy(result.importManifest),
    }, { actor: 'agent', uiRevision: runtime.uiRevision });
    return {
      ...result,
      direction: 'import',
      format: transfer.format,
      bytes: transfer.bytes,
      sha256: transfer.sha256,
    };
  }

  async function liveAgentArtifact(args) {
    if (typeof args.action === 'string' && args.action.startsWith('import.')) {
      return liveAgentImportArtifact(args);
    }
    if (args.path) throw new agentTools.CadAgentError('LIVE_PATH_NOT_AVAILABLE', 'A browser session cannot write an arbitrary host path. Request the artifact data and let the MCP host save it within its approved output root.');
    const unknownKeys = Object.keys(args).filter((key) => !['format', 'scope', 'entities', 'width', 'height'].includes(key));
    if (unknownKeys.length) {
      throw new agentTools.CadAgentError('INVALID_ARTIFACT_REQUEST', 'The artifact request contains unadvertised fields.', { unknownKeys });
    }
    if (args.entities && args.scope) {
      throw new agentTools.CadAgentError('INVALID_ARTIFACT_SCOPE', 'Choose either explicit stable entities or a semantic selection/visible-model scope.');
    }
    const format = args.format;
    const permission = format === 'project'
      ? 'artifact.export-project'
      : format === 'step'
        ? 'artifact.export-step'
        : format === 'stl'
          ? 'artifact.export-stl'
          : format === 'png'
            ? 'artifact.render'
            : ['webvtt', 'srt'].includes(format)
              ? 'artifact.export-narration'
              : null;
    if (!permission) throw new agentTools.CadAgentError('CAPABILITY_DISABLED', `Artifact format "${format}" is not advertised.`);
    if (!activeAgentConnection.permissionContext.granted.includes(permission)) throw new agentTools.CadAgentError('PERMISSION_DENIED', 'Permission "' + permission + '" is required.');
    let bytes;
    let mediaType;
    let manifest = null;
    if (format === 'project') {
      if (args.scope || args.entities || args.width || args.height) throw new agentTools.CadAgentError('INVALID_ARTIFACT_SCOPE', 'Project export always contains the complete canonical project.');
      bytes = new TextEncoder().encode(JSON.stringify(v5RuntimeTools.canonicalStudioV5Project(doc), null, 2) + '\n');
      mediaType = 'application/json';
    } else if (format === 'step' || format === 'stl') {
      if (args.width || args.height) throw new agentTools.CadAgentError('INVALID_ARTIFACT_SCOPE', 'CAD exports do not accept render dimensions.');
      const scope = resolveArtifactBodyScope(args);
      const response = await kernelCall(format === 'step' ? 'export-step' : 'export-stl', documentRevision, { bodyIds: scope.bodyIds });
      if (!response.blob || response.errors?.length) throw new agentTools.CadAgentError('ARTIFACT_EXPORT_FAILED', response.errors?.[0]?.message || 'The exact CAD export failed.');
      bytes = new Uint8Array(await response.blob.arrayBuffer());
      mediaType = response.blob.type || (format === 'step' ? 'model/step' : 'model/stl');
      manifest = { ...(response.manifest || {}), kind: 'selected-entity-cad', scope };
    } else if (format === 'png') {
      const scope = resolveArtifactBodyScope(args);
      const width = boundedArtifactDimension(args.width, 720);
      const height = boundedArtifactDimension(args.height, 405);
      bytes = await captureV6ModelRender(scope, width, height);
      mediaType = 'image/png';
      const snapshot = v6StudioSnapshot();
      manifest = {
        kind: 'model-only-render',
        width,
        height,
        scope,
        camera: snapshot.viewport.camera,
        displayMode: snapshot.viewport.displayMode,
        activeSectionId: snapshot.viewport.activeSectionId || null,
        activeExplodedViewId: snapshot.viewport.activeExplodedViewId || null,
        renderedDocumentRevision: snapshot.viewport.renderedDocumentRevision,
        renderedKernelRevision: snapshot.viewport.renderedKernelRevision,
        browserChromeIncluded: false,
      };
    } else {
      if (args.scope || args.entities || args.width || args.height) throw new agentTools.CadAgentError('INVALID_ARTIFACT_SCOPE', 'Narration exports contain the completed visible cue track.');
      ({ bytes, mediaType, manifest } = narrationArtifact(format));
    }
    if (bytes.byteLength > 1024 * 1024) throw new agentTools.CadAgentError('ARTIFACT_TOO_LARGE_FOR_LOOPBACK', 'This artifact exceeds the 1 MiB live-transfer limit. Use the normal Studio download or a headless output path.');
    const result = {
      format,
      bytes: bytes.byteLength,
      mediaType,
      sha256: await sha256Hex(bytes),
      dataBase64: bytesToBase64(bytes),
      documentHash: v5RuntimeTools.studioV5CanonicalHash(doc),
      ...(manifest ? { manifest } : {}),
    };
    getV6InteractionRuntime().emit('artifact.completed', {
      format,
      bytes: result.bytes,
      mediaType,
      sha256: result.sha256,
      documentHash: result.documentHash,
      manifest: deepCopy(manifest),
    }, { actor: 'agent', uiRevision: getV6InteractionRuntime().uiRevision });
    const narrationTemplateId = ['project', 'step', 'stl', 'png'].includes(format)
      ? `artifact-${format}`
      : null;
    if (narrationTemplateId) {
      await getV6InteractionRuntime().presentTrustedNarration({
        templateId: narrationTemplateId,
        correlationId: `artifact-${format}-${result.sha256.slice(0, 12)}`,
      });
    }
    return result;
  }

  let v6InteractionRuntime = null;
  let v6RevealedEntity = null;
  let v6FramedEntities = [];
  let v6FramedBounds = null;
  let v6SemanticSelection = [];
  let v6SelectionOverlayObjects = [];
  let v6TopologyCache = null;
  let v6CameraTransitionGeneration = 0;
  const v6TreeExpansion = new Map();
  const v6PanelOpen = new Map([
    ['model-tree', true],
    ['inspector', true],
    ['project', true],
    ['history', true],
    ['diagnostics', false],
  ]);
  let v6HistoryRevision = null;
  let v6FocusedActionId = null;
  let v6ProjectSheetRequested = false;
  let v6DisplayModeOverride;
  let v6ActiveSectionOverride;
  let v6ActiveExplodedViewOverride;
  let v6AgentCommandDraft = null;
  let v6VisiblePreview = null;
  let v6DirectParameterPreviewOperations = [];
  let v6SemanticBatchBasePreviewId = null;
  const v6DeferredPreviewCancellations = new Set();
  const v6NarrationCueLog = [];
  let v6DraftSequence = 0;
  let v6ClosingCommand = false;
  let v6ApplyingSemanticAction = false;
  let v6ObservedHostState = null;
  let v6HostCaptureQueued = false;
  let activeViewName = 'iso';

  function noteV6HostUiChange(kind, payload = {}) {
    if (!v6InteractionRuntime || v6ApplyingSemanticAction) return;
    v6InteractionRuntime.hostChanged(kind, payload, { actor: 'human' });
    v6ObservedHostState = v6ComparableHostState(v6StudioSnapshot());
  }

  function primaryV6EntitySelection() {
    if (selectedMateId) return { kind: 'mate', id: selectedMateId };
    if (selectedOccurrenceId) return { kind: 'occurrence', id: selectedOccurrenceId };
    if (selectedBodyId) return { kind: 'body', id: selectedBodyId };
    if (selectedFeatureId) return { kind: 'feature', id: selectedFeatureId };
    if (selectedDatumId) return { kind: 'datum', id: selectedDatumId };
    if (selectedSketchId) return { kind: 'sketch', id: selectedSketchId };
    return null;
  }

  function currentV6Selections() {
    if (v6SemanticSelection.length) return deepCopy(v6SemanticSelection);
    const primary = primaryV6EntitySelection();
    return primary ? [primary] : [];
  }

  function currentV6Selection() {
    return currentV6Selections()[0] || null;
  }

  function v6CanonicalKey(value) {
    if (Array.isArray(value)) return '[' + value.map(v6CanonicalKey).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + v6CanonicalKey(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }

  function v6StableHash(value) {
    const text = v6CanonicalKey(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function v6TopologyInventory() {
    if (v6TopologyCache) return v6TopologyCache;
    const items = [];
    for (const [bodyId, mesh] of bodyMeshes) {
      for (const face of mesh.userData.topologyFaces || []) {
        const signature = { kind: 'face', ...deepCopy(face.sig) };
        items.push({
          owner: { kind: 'body', id: bodyId },
          stableId: 'face:' + String(face.faceId),
          topologySignature: signature,
          expectedGeometry: face.geomType === 'PLANE' ? 'plane'
            : face.geomType === 'CYLINDER' ? 'cylinder'
              : face.geomType === 'CONE' ? 'cone'
                : 'other',
          _faceId: face.faceId,
        });
      }
    }
    for (const line of edgeLines) {
      for (const entry of line.userData.edgeEntries || []) {
        const signature = { kind: 'edge', ...deepCopy(entry.sig) };
        items.push({
          owner: { kind: 'body', id: line.userData.bodyId },
          stableId: 'edge:' + v6StableHash(signature),
          topologySignature: signature,
          expectedGeometry: entry.sig?.curveType === 'LINE' ? 'line' : entry.sig?.curveType === 'CIRCLE' ? 'circle' : 'other',
          _line: line,
          _entry: entry,
        });
      }
    }
    for (const [bodyId, mesh] of bodyMeshes) {
      for (const vertex of mesh.userData.topologyVertices || []) {
        const point = deepCopy(vertex.sig?.p);
        if (!Array.isArray(point) || point.length !== 3) continue;
        const vertexSignature = { kind: 'vertex', p: point };
        items.push({
          owner: { kind: 'body', id: bodyId },
          stableId: 'vertex:' + v6StableHash(vertexSignature),
          topologySignature: vertexSignature,
          expectedGeometry: 'other',
          _point: point,
        });
      }
    }
    v6TopologyCache = items;
    return v6TopologyCache;
  }

  function v6PublicTopologyInventory() {
    return v6TopologyInventory().map(({ _faceId, _line, _entry, _point, ...entry }) => deepCopy(entry));
  }

  function v6SelectionRefKey(ref) {
    return v6CanonicalKey(ref);
  }

  function v6SubshapeExists(ref) {
    return v6TopologyInventory().some((candidate) =>
      candidate.owner.kind === ref.owner?.kind &&
      candidate.owner.id === ref.owner?.id &&
      candidate.stableId === ref.stableId &&
      v6CanonicalKey(candidate.topologySignature) === v6CanonicalKey(ref.topologySignature));
  }

  function v6EntityExists(entity) {
    if (entity?.owner) return v6SubshapeExists(entity);
    if (entity.kind === 'feature') return doc.features.some((entry) => entry.id === entity.id);
    if (entity.kind === 'parameter') return (doc.params || []).some((entry) => entry.id === entity.id);
    if (entity.kind === 'body') {
      if (lastBodyResults.some((entry) => entry.bodyId === entity.id)) return true;
      return v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'part'
        && v5RuntimeTools.studioV5RootPart(doc).bodies.some((entry) => entry.id === entity.id);
    }
    if (entity.kind === 'occurrence') {
      if (lastBodyResults.some((entry) => entry.occurrenceInstance?.occurrenceId === entity.id)) return true;
      return v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly'
        && v5RuntimeTools.studioV5RootAssembly(doc).occurrences.some((entry) => entry.id === entity.id);
    }
    if (!v5RuntimeTools.isStudioV5Project(doc)) return false;
    if (doc.rootDocument?.kind === 'part') {
      const part = v5RuntimeTools.studioV5RootPart(doc);
      if (entity.kind === 'datum') return part.referenceGeometry.some((entry) => entry.id === entity.id);
      if (entity.kind === 'sketch') return part.sketches.some((entry) => entry.id === entity.id);
      if (entity.kind === 'body-pattern') return (part.bodyPatterns || []).some((entry) => entry.id === entity.id);
    }
    if (doc.rootDocument?.kind === 'assembly') {
      const assembly = v5RuntimeTools.studioV5RootAssembly(doc);
      if (entity.kind === 'mate') return assembly.mates.some((entry) => entry.id === entity.id);
      if (entity.kind === 'occurrence-pattern') return assembly.occurrencePatterns.some((entry) => entry.id === entity.id);
      if (entity.kind === 'section') return assembly.sectionViews.some((entry) => entry.id === entity.id);
      if (entity.kind === 'exploded-view') return assembly.explodedViews.some((entry) => entry.id === entity.id);
      if (entity.kind === 'measurement') return v5InspectionTools.studioV5Measurements(doc).some((entry) => entry.id === entity.id);
      if (entity.kind === 'stage-group') return v5InspectionTools.studioV5AxialStageGroups(doc).some((entry) => entry.id === entity.id);
    }
    return false;
  }

  const V6_TREE_INVOKE_OPERATIONS = Object.freeze({
    body: new Set(['select', 'isolate', 'export', 'pattern-instance.select', 'pattern-instance.independent', 'pattern-instance.export']),
    'body-pattern': new Set(['pattern.dissolve']),
    datum: new Set(['datum.select']),
    sketch: new Set(['sketch.select']),
    occurrence: new Set(['occurrence.expand', 'occurrence.select', 'occurrence.export', 'runtime-occurrence.select']),
    feature: new Set(['select']),
    mate: new Set(['mate.select']),
    measurement: new Set(['measurement.evaluate']),
  });

  const V6_INSPECTOR_INVOKE_OPERATIONS = new Set([
    'inspection.clear',
    'body.isolate',
    'occurrence.isolate',
    'occurrence.export',
  ]);

  function v6TreeInvocationSupported(entity, operation) {
    return Boolean(V6_TREE_INVOKE_OPERATIONS[entity?.kind]?.has(operation));
  }

  function clearV6Selection() {
    v6SemanticSelection = [];
    selectedFeatureId = null;
    selectedBodyId = null;
    selectedOccurrenceId = null;
    selectedMateId = null;
    selectedDatumId = null;
    selectedSketchId = null;
    renderHistory();
    renderBodies();
    renderContext();
    syncBodyMeshState();
    syncV6TreeSelectionClasses();
  }

  function selectV6Entity(entity) {
    const target = entity?.owner || entity;
    if (target.kind === 'body') selectBody(target.id);
    else if (target.kind === 'occurrence') selectOccurrence(target.id);
    else if (target.kind === 'feature') selectFeature(target.id);
    else if (target.kind === 'mate') selectMate(target.id);
    else if (target.kind === 'datum') {
      selectedDatumId = target.id;
      selectedSketchId = null;
      selectedBodyId = null;
      selectedFeatureId = null;
      renderDatums();
      renderAdvancedSketches();
    } else if (target.kind === 'sketch') {
      selectedSketchId = target.id;
      selectedDatumId = null;
      selectedBodyId = null;
      selectedFeatureId = null;
      renderDatums();
      renderAdvancedSketches();
    } else if (target.kind === 'body-pattern') {
      selectedDatumId = null;
      selectedSketchId = null;
      selectedBodyId = null;
      selectedFeatureId = null;
      renderBodyPatterns();
    }
  }

  function setV6SemanticSelection(selection) {
    const unique = [];
    const seen = new Set();
    for (const ref of selection) {
      const key = v6SelectionRefKey(ref);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(deepCopy(ref));
      }
    }
    if (!unique.length) return clearV6Selection();
    selectV6Entity(unique[0]);
    v6SemanticSelection = unique;
    renderContext();
    syncBodyMeshState();
    syncV6TreeSelectionClasses();
  }

  function showV6Narration(cue) {
    const overlay = $('bw-agent-narration');
    const text = $('bw-agent-narration-text');
    const live = $('bw-agent-narration-live');
    if (!overlay || !text) return;
    overlay.dataset.kind = cue.kind;
    overlay.dataset.cueId = cue.cueId;
    overlay.dataset.correlationId = cue.correlationId;
    overlay.dataset.state = 'visible';
    overlay.dataset.avoidDialog = v5Dialog?.open ? 'true' : 'false';
    text.textContent = cue.text;
    overlay.hidden = false;
    if (live) live.textContent = cue.text;
    const existing = v6NarrationCueLog.find((entry) => entry.cueId === cue.cueId);
    if (!existing) {
      v6NarrationCueLog.push({
        cueId: cue.cueId,
        correlationId: cue.correlationId,
        kind: cue.kind,
        text: cue.text,
        source: cue.source,
        startedAtMs: performance.now(),
        completedAtMs: null,
        state: 'visible',
      });
      if (v6NarrationCueLog.length > 1000) v6NarrationCueLog.splice(0, v6NarrationCueLog.length - 1000);
    }
  }

  function completeV6Narration(cue, { persist } = {}) {
    const overlay = $('bw-agent-narration');
    if (!overlay || overlay.dataset.cueId !== cue.cueId) return;
    overlay.dataset.state = 'completed';
    if (!persist) overlay.hidden = true;
    const entry = v6NarrationCueLog.find((candidate) => candidate.cueId === cue.cueId);
    if (entry) {
      entry.completedAtMs = performance.now();
      entry.state = cue.state;
    }
  }

  function hideV6Narration() {
    const overlay = $('bw-agent-narration');
    const live = $('bw-agent-narration-live');
    if (overlay) overlay.hidden = true;
    if (live) live.textContent = '';
  }

  function v6ActiveDocumentRef() {
    if (v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'part') {
      return { kind: 'part', id: doc.rootDocument.partId };
    }
    if (v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly') {
      return { kind: 'assembly', id: doc.rootDocument.assemblyId };
    }
    return { kind: 'legacy-part', id: projectId };
  }

  function v6PanelState() {
    const selection = currentV6Selection();
    return [...v6PanelOpen].map(([panelId, open]) => ({
      panelId,
      open,
      ...(panelId === 'inspector' && selection ? { target: deepCopy(selection.owner || selection) } : {}),
    }));
  }

  const V6_TREE_SECTION_ELEMENT_IDS = Object.freeze({
    origin: 'bw-part-origin',
    datums: 'bw-tree-section-datums',
    sketches: 'bw-tree-section-sketches',
    patterns: 'bw-tree-section-patterns',
    components: 'bw-assembly-components',
    mates: 'bw-assembly-mates',
    inspection: 'bw-assembly-inspection',
  });
  const v6ProgrammaticTreeSectionStates = new Map();

  function v6TreeSectionState() {
    return Object.entries(V6_TREE_SECTION_ELEMENT_IDS).map(([sectionId, elementId]) => {
      const element = $(elementId);
      return {
        sectionId,
        expanded: Boolean(element?.open),
        visible: Boolean(element && !element.hidden),
      };
    });
  }

  function setV6TreeSectionExpanded(sectionId, expanded) {
    const element = $(V6_TREE_SECTION_ELEMENT_IDS[sectionId]);
    if (!element || element.hidden) {
      throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'The requested model-tree section is not visible in the active document.', {
        sectionId,
        repairOptions: [{ kind: 'activate-compatible-document' }],
      });
    }
    setV6TreeSectionOpen(sectionId, expanded);
    requestSceneRender();
    return { sectionId, expanded: element.open };
  }

  function setV6TreeSectionOpen(sectionId, expanded) {
    const element = $(V6_TREE_SECTION_ELEMENT_IDS[sectionId]);
    if (!element || element.open === expanded) return;
    v6ProgrammaticTreeSectionStates.set(sectionId, expanded);
    element.open = expanded;
  }

  function v6ExpandedEntities() {
    const expanded = [];
    if (v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly') {
      const assembly = v5RuntimeTools.studioV5RootAssembly(doc);
      for (const occurrence of assembly.occurrences) {
        const entity = { kind: 'occurrence', id: occurrence.id };
        if (v6TreeExpansion.get(v6SelectionRefKey(entity)) !== false) expanded.push(entity);
      }
    }
    for (const [key, value] of v6TreeExpansion) {
      if (!value) continue;
      try {
        const entity = JSON.parse(key);
        if (entity?.kind && entity?.id && !expanded.some((entry) => entry.kind === entity.kind && entry.id === entity.id)) expanded.push(entity);
      } catch {}
    }
    return expanded.slice(0, 100);
  }

  function v6ActiveCommandState() {
    if (v6AgentCommandDraft) {
      return {
        commandId: v6AgentCommandDraft.commandId,
        state: v6AgentCommandDraft.state,
        draftId: v6AgentCommandDraft.draftId,
        baseRevision: v6AgentCommandDraft.baseRevision,
        transactionId: v6AgentCommandDraft.transactionId,
        ...(v6AgentCommandDraft.editEntity
          ? { editEntity: deepCopy(v6AgentCommandDraft.editEntity) }
          : {}),
        ...(v6AgentCommandDraft.bootstrapOperations?.length
          ? { bootstrapOperations: deepCopy(v6AgentCommandDraft.bootstrapOperations) }
          : {}),
        ...(v6AgentCommandDraft.materialContext
          ? { materialContext: deepCopy(v6AgentCommandDraft.materialContext) }
          : {}),
        inputValues: deepCopy(v6AgentCommandDraft.inputValues),
        boundSelections: deepCopy(v6AgentCommandDraft.boundSelections),
        generatedIds: deepCopy(v6AgentCommandDraft.generatedIds || {}),
        diagnostics: deepCopy(v6AgentCommandDraft.diagnostics),
        ...(sketch.isOpen() ? { toolId: sketch.activeTool() } : {}),
        ...(sketch.isOpen() && sketch.selectedShapeIndex() >= 0
          ? { selectedShapeIndex: sketch.selectedShapeIndex() }
          : {}),
        ...(isWorking(mode.kind) ? { stage: mode.kind } : {}),
      };
    }
    if (['idle', 'rebuilding'].includes(mode.kind)) return undefined;
    return {
      commandId: currentOpType || mode.kind,
      state: 'draft',
      inputValues: {},
      boundSelections: {},
      diagnostics: [],
    };
  }

  function v6SurfaceState() {
    return {
      help: { open: Boolean(helpDialog?.open) },
      templates: {
        open: Boolean(templateDialog?.open),
        selectedTemplateId: selectedTemplate?.id || null,
        category: templateCategory,
        search: String($('bw-template-search')?.value || ''),
      },
      recovery: {
        open: Boolean(recoveryDialog?.open),
        entryIds: [...recoveryEntries.keys()].slice(0, 200),
        entries: [...recoveryEntries.values()].slice(0, 200).map((entry) => ({
          snapshotId: entry.snapshotId,
          projectId: entry.projectId,
          title: entry.title,
          label: entry.label,
          featureCount: entry.featureCount,
          updatedAt: entry.updatedAt,
        })),
      },
      clear: { open: Boolean(clearDecision?.open) },
      draftDecision: {
        open: Boolean(draftDecision?.open),
        nextLabel: String(queuedOperation?.opts?.nextLabel || ''),
        controlId: String(queuedOperation?.opts?.controlId || ''),
      },
      transition: {
        open: Boolean(transitionToast && !transitionToast.hidden),
        title: String($('bw-transition-title')?.textContent || ''),
        undoAvailable: Boolean(transitionUndo),
      },
      tour: {
        open: Boolean(tourEl && !tourEl.hidden),
        kind: tourKind,
        index: tourIndex,
        count: tourSteps().length,
      },
      welcome: { open: Boolean($('bw-welcome') && !$('bw-welcome').hidden) },
      fullscreen: { active: document.fullscreenElement === appEl },
    };
  }

  function v6StudioSnapshot() {
    const selection = currentV6Selections();
    const assembly = v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly'
      ? v5RuntimeTools.studioV5RootAssembly(doc)
      : null;
    const renderState = buildErrors.size || bodyBuildErrors.size
      ? 'failed'
      : mode.kind === 'rebuilding' || latestAppliedRevision < latestRequestedRevision
        ? 'rebuilding'
        : sceneRenderDirty
          ? 'rendering'
          : 'idle';
    const activeCommand = v6ActiveCommandState();
    return {
      activeDocument: v6ActiveDocumentRef(),
      workspaceId: activeWorkspace,
      ...(activeCommand ? { activeCommand } : {}),
      selection: deepCopy(selection),
      tree: {
        ...(v6RevealedEntity ? { revealed: deepCopy(v6RevealedEntity) } : {}),
        expanded: v6ExpandedEntities(),
        sections: v6TreeSectionState(),
        exportBodyIds: [...exportBodyIds].sort().slice(0, 1000),
      },
      panels: v6PanelState(),
      surfaces: v6SurfaceState(),
      inspection: lastInspection ? deepCopy(lastInspection) : null,
      viewport: {
        viewId: activeViewName,
        camera: {
          position: camera.position.toArray(),
          target: orbit.target.toArray(),
          up: camera.up.toArray(),
          projection: 'perspective',
        },
        displayMode: activeV6DisplayMode(),
        navigationMode: navMode,
        framedEntities: deepCopy(v6FramedEntities),
        ...(v6FramedBounds ? { framedBounds: deepCopy(v6FramedBounds) } : {}),
        ...(activeV6SectionId() ? { activeSectionId: activeV6SectionId() } : {}),
        ...(activeV6ExplodedViewId() ? { activeExplodedViewId: activeV6ExplodedViewId() } : {}),
        ...(isolatedBodyId ? { isolatedBodyId } : {}),
        ...(appEl?.dataset.isolateOccurrence ? { isolatedOccurrenceId: appEl.dataset.isolateOccurrence } : {}),
        renderState,
        renderedDocumentRevision: lastRenderedDocumentRevision,
        renderedKernelRevision: lastRenderedKernelRevision,
        renderedUiRevision: lastRenderedUiRevision,
      },
      connection: {
        clientLabel: activeAgentConnection?.clientLabel || 'No connected agent',
        mode: activeAgentConnection?.mode || 'disconnected',
        paused: Boolean(activeAgentConnection?.paused),
      },
      ...(v6VisiblePreview ? {
        preview: {
          previewId: v6VisiblePreview.previewId,
          baseRevision: v6VisiblePreview.baseRevision,
          visible: v6VisiblePreview.visible,
          highlightedEntities: deepCopy(v6VisiblePreview.highlightedEntities),
          validation: deepCopy(v6VisiblePreview.validation),
          evidence: deepCopy(v6VisiblePreview.evidence),
          transactionHash: v6VisiblePreview.transactionHash,
          documentHashAfter: v6VisiblePreview.changeSet?.documentHashAfter,
        },
      } : {}),
      ...(v6HistoryRevision != null ? { history: { visibleRevision: v6HistoryRevision } } : {}),
      ...(v6FocusedActionId ? { focusedActionId: v6FocusedActionId } : {}),
    };
  }

  function v6ComparableHostState(snapshot) {
    return {
      document: snapshot.activeDocument,
      workspace: snapshot.workspaceId,
      selection: snapshot.selection,
      tree: snapshot.tree,
      panels: snapshot.panels,
      surfaces: snapshot.surfaces,
      inspection: snapshot.inspection,
      viewport: snapshot.viewport,
      command: snapshot.activeCommand || null,
    };
  }

  function captureV6HumanState(event) {
    if (event?.target?.closest?.('#bw-agent-activity, .ws-agent-pair')) return;
    if (!v6InteractionRuntime || v6ApplyingSemanticAction || v6HostCaptureQueued) return;
    v6HostCaptureQueued = true;
    queueMicrotask(() => {
      v6HostCaptureQueued = false;
      if (!v6InteractionRuntime || v6ApplyingSemanticAction) return;
      const snapshot = v6StudioSnapshot();
      const current = v6ComparableHostState(snapshot);
      const previous = v6ObservedHostState || current;
      const scopes = Object.keys(current).filter((scope) =>
        JSON.stringify(current[scope]) !== JSON.stringify(previous[scope]));
      if (!scopes.length) return;
      v6InteractionRuntime.hostChanged('ui.changed', { scopes }, { actor: 'human' });
      v6ObservedHostState = v6ComparableHostState(v6StudioSnapshot());
    });
  }

  function captureV6HumanTreeToggle(event) {
    if (!event?.target?.matches?.('[data-tree-section]')) return;
    const sectionId = event.target.dataset.treeSection;
    if (v6ProgrammaticTreeSectionStates.get(sectionId) === event.target.open) {
      v6ProgrammaticTreeSectionStates.delete(sectionId);
      return;
    }
    v6ProgrammaticTreeSectionStates.delete(sectionId);
    captureV6HumanState(event);
  }

  function validateV6UiAction(action) {
    if (action.kind === 'document.activate' && action.documentId !== v6ActiveDocumentRef().id) {
      throw new v6InteractionTools.CadUiError('ACTIVE_DOCUMENT_CHANGED', 'The requested document is not an open Studio document.', {
        activeDocument: v6ActiveDocumentRef(),
        repairOptions: [{ kind: 'refresh-ui-state' }],
      });
    }
    if (action.kind === 'workspace.activate' && !WORKSPACE_META[action.workspaceId]) {
      throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'Workspace "' + action.workspaceId + '" is not available.');
    }
    if (action.kind === 'workspace.activate' && action.workspaceId === 'sketch') {
      throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'Sketch workspace activation is available only through an active sketch command.');
    }
    if (['selection.set', 'selection.add', 'selection.remove', 'tree.reveal', 'tree.expand', 'tree.collapse', 'inspector.showEntity'].includes(action.kind) && !v6EntityExists(action.entity)) {
      throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'The requested entity is not present in the current document.', {
        entity: action.entity,
        repairOptions: [{ kind: 'refresh-project-tree' }],
      });
    }
    if (action.kind === 'tree.invoke') {
      if (!v6EntityExists(action.entity)) {
        throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'The requested dynamic tree entity is not present in the current document.', {
          entity: action.entity,
          repairOptions: [{ kind: 'refresh-project-tree' }],
        });
      }
      if (!v6TreeInvocationSupported(action.entity, action.operation)) {
        throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'That dynamic tree operation is not released for this entity kind.');
      }
    }
    if (action.kind === 'tree.setSectionExpanded') {
      const element = $(V6_TREE_SECTION_ELEMENT_IDS[action.sectionId]);
      if (!element || element.hidden) {
        throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'The requested model-tree section is not visible in the active document.', {
          sectionId: action.sectionId,
          repairOptions: [{ kind: 'activate-compatible-document' }],
        });
      }
    }
    if (action.kind === 'inspector.invoke' && !V6_INSPECTOR_INVOKE_OPERATIONS.has(action.operation)) {
      throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'That dynamic inspector operation is not released.');
    }
    if (action.kind === 'viewport.standardView' && !VIEW_DIRS[action.viewId]) {
      throw new v6InteractionTools.CadUiError('VIEW_NOT_AVAILABLE', 'View "' + action.viewId + '" is not available.');
    }
    if (action.kind === 'viewport.setCamera') {
      if (action.camera.projection !== 'perspective') {
        throw new v6InteractionTools.CadUiError('VIEW_NOT_AVAILABLE', 'This renderer currently advertises a perspective camera only.');
      }
      const position = new THREE.Vector3().fromArray(action.camera.position);
      const target = new THREE.Vector3().fromArray(action.camera.target);
      const up = new THREE.Vector3().fromArray(action.camera.up);
      const direction = target.clone().sub(position);
      if (direction.lengthSq() < 1e-12 || up.lengthSq() < 1e-12 || Math.abs(direction.normalize().dot(up.normalize())) > 0.9999) {
        throw new v6InteractionTools.CadUiError('VIEW_NOT_AVAILABLE', 'Camera position, target, and up must define a non-degenerate view.');
      }
    }
    if (action.kind === 'viewport.setDisplayMode' && !['shaded', 'shaded-edges', 'wireframe', 'hidden-line', 'ghost'].includes(action.displayModeId)) {
      throw new v6InteractionTools.CadUiError('VIEW_NOT_AVAILABLE', 'Display mode "' + action.displayModeId + '" is not available.');
    }
    const assembly = v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly'
      ? v5RuntimeTools.studioV5RootAssembly(doc)
      : null;
    if (action.kind === 'viewport.activateSection' && !assembly?.sectionViews.some((entry) => entry.id === action.sectionId)) {
      throw new v6InteractionTools.CadUiError('VIEW_NOT_AVAILABLE', 'The requested saved section does not exist.');
    }
    if (action.kind === 'viewport.activateExplodedView' && !assembly?.explodedViews.some((entry) => entry.id === action.explodedViewId)) {
      throw new v6InteractionTools.CadUiError('VIEW_NOT_AVAILABLE', 'The requested saved exploded view does not exist.');
    }
    if (['panel.open', 'panel.close'].includes(action.kind) && !v6PanelOpen.has(action.panelId)) {
      throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'Panel "' + action.panelId + '" is not advertised.');
    }
    if (['tree.expand', 'tree.collapse'].includes(action.kind) && !v6TreeEntityExpandable(action.entity)) {
      throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'Only occurrence rows with visible model-tree children can be expanded or collapsed.', {
        entity: action.entity,
        repairOptions: [{ kind: 'select-expandable-occurrence' }],
      });
    }
    if (action.kind === 'history.showRevision' && action.revision > commandRevision) {
      throw new v6InteractionTools.CadUiError('VIEW_NOT_AVAILABLE', 'Revision ' + action.revision + ' is newer than the active project revision.');
    }
    if (action.kind === 'history.undo' && !undoStack.length) {
      throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'There is no project transaction to undo.');
    }
    if (action.kind === 'history.redo' && !redoStack.length) {
      throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'There is no project transaction to redo.');
    }
    if (['history.undo', 'history.redo'].includes(action.kind) && (v6AgentCommandDraft || isWorking(mode.kind) || v5Dialog?.open)) {
      throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'Finish or cancel the active command before changing project history.');
    }
    if (action.kind === 'control.invoke') {
      const supported = new Set([
        'project.templates',
        'project.clear',
        'body.create',
        'app.help',
        'dialog.clear.cancel',
        'dialog.draft.keep',
        'dialog.draft.discard',
        'dialog.template.close',
        'dialog.help.close',
        'dialog.recovery.close',
        'dialog.tour.back',
        'dialog.tour.next',
        'dialog.tour.skip',
        'welcome.templates',
        'welcome.help',
        'help.tour',
        'help.templates',
        'notice.legacy-dismiss',
      ]);
      if (!supported.has(action.controlId)) {
        throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'The requested normal Studio control is not released through control.invoke.');
      }
    }
    if (action.kind === 'control.setValue' && action.controlId !== 'template.search') {
      throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'The requested normal Studio field is not released through control.setValue.');
    }
    if (action.kind === 'template.select' && templateLibrary.length && !templateLibrary.some((entry) => entry.id === action.templateId)) {
      throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'The requested template is not present in the loaded template library.');
    }
    if (action.kind === 'template.filter' && templateCategories.length && !['All parts', ...templateCategories].includes(action.category)) {
      throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'The requested template category is not advertised.');
    }
    if (action.kind === 'template.use') {
      if (v6AgentCommandDraft || isWorking(mode.kind) || v5Dialog?.open) {
        throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'Finish or cancel the active command before opening a template.');
      }
      if (!templateDialog?.open && $('bw-welcome')?.hidden) {
        throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'Open the normal template library or welcome surface before using a template.');
      }
      if (templateLibrary.length && !templateLibrary.some((entry) => entry.id === action.templateId)) {
        throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'The requested template is not present in the loaded template library.');
      }
    }
    if (action.kind === 'project.newBlank') {
      if ($('bw-welcome')?.hidden) {
        throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'The blank-sketch control is available from the normal welcome surface.');
      }
      if (v6AgentCommandDraft || isWorking(mode.kind) || v5Dialog?.open) {
        throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'Finish or cancel the active command before starting a blank project.');
      }
    }
    if (action.kind === 'recovery.restore') {
      if (!recoveryDialog?.open || !recoveryEntries.has(action.snapshotId)) {
        throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'Open recovery and choose one of its advertised entry IDs before restoring.');
      }
      if (v6AgentCommandDraft || isWorking(mode.kind) || v5Dialog?.open) {
        throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'Finish or cancel the active command before restoring a project.');
      }
    }
    if (action.kind === 'transition.undo' && (!transitionToast || transitionToast.hidden || !transitionUndo)) {
      throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'There is no undoable project transition.');
    }
    if (action.kind === 'transition.dismiss' && (!transitionToast || transitionToast.hidden)) {
      throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'There is no project transition notification to dismiss.');
    }
    if (action.kind === 'command.open') {
      const commandDefinition = v6CommandDefinition(action.commandId);
      const modelCommand = action.commandId.startsWith('model.');
      const supportedVisibleCommand =
        modelCommand ||
        action.commandId.startsWith('assembly.') ||
        action.commandId.startsWith('inspection.');
      if (commandDefinition?.state !== 'available' || !supportedVisibleCommand) {
        throw new v6InteractionTools.CadUiError('COMMAND_NOT_AVAILABLE', 'The requested normal Studio command is not advertised.');
      }
      if (modelCommand && doc.rootDocument?.kind !== 'part') {
        throw new v6InteractionTools.CadUiError('COMMAND_NOT_AVAILABLE', 'This modeling command requires an active part document or assembly edit context.');
      }
      const createAssembly = action.commandId === 'assembly.create';
      const exitAssemblyContext = action.commandId === 'assembly.exit-context';
      const hasAssemblyEditContext = Boolean(
        doc.metadata?.editContext?.assemblyId &&
        doc.assemblyDefinitions?.some((entry) => entry.id === doc.metadata.editContext.assemblyId),
      );
      if (!modelCommand && (
        (createAssembly && (doc.rootDocument?.kind !== 'part' || hasAssemblyEditContext)) ||
        (exitAssemblyContext && !hasAssemblyEditContext) ||
        (!createAssembly && !exitAssemblyContext && !assembly)
      )) {
        throw new v6InteractionTools.CadUiError('COMMAND_NOT_AVAILABLE', createAssembly
          ? 'Create Assembly requires an active part document.'
          : exitAssemblyContext
            ? 'Return to assembly requires an active assembly edit context.'
            : 'This command requires an active assembly document.');
      }
      // Selection and command-context preconditions are deliberately checked by
      // openV6AgentCommand/openAssemblyCommand during ordered application. A
      // batch may establish its selection in an earlier action, so inspecting
      // the pre-batch selection here would reject a valid atomic sequence.
    }
    if (action.kind === 'command.bindSelection') {
      const field = v6AdvertisedCommandField(action.fieldId);
      if (field?.kind !== 'selection') {
        throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', 'No advertised visible command has such a selection field.');
      }
      if (
        action.entities.length < (field.minItems || 0) ||
        action.entities.length > (field.maxItems || 100)
      ) {
        throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', field.label + ' has invalid selection cardinality.');
      }
      for (const entity of action.entities) {
        const selectionKind = entity.owner ? entity.topologySignature.kind : entity.kind;
        if (!field.selectionKinds.includes(selectionKind)) {
          throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', field.label + ' does not accept ' + selectionKind + ' selections.');
        }
      }
      if (v6AgentCommandDraft?.commandId === 'assembly.component-transform' && action.fieldId === 'occurrence') {
        const occurrence = assembly?.occurrences.find((entry) => entry.id === action.entities[0]?.id);
        if (!occurrence) throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', 'The selected occurrence is not a direct child of the active assembly.');
        if (occurrence.fixed || assembly.mates.some((mate) => !mate.suppressed && mate.occurrenceIds.includes(occurrence.id))) {
          throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'The selected component is fixed or driven by an active mate.');
        }
      }
    }
    if (action.kind === 'command.setInput' || action.kind === 'command.clearInput') {
      const field = v6AdvertisedCommandField(action.fieldId);
      if (!field || field.kind === 'selection') {
        throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', 'No advertised visible command has such a typed input field.');
      }
      if (action.kind === 'command.setInput') {
        const value = action.value;
        if (field.kind === 'boolean' && typeof value !== 'boolean') {
          throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', field.label + ' requires a boolean.');
        }
        if (field.kind === 'enum' && !field.values.includes(value)) {
          throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', field.label + ' is outside the advertised enum.');
        }
        if (field.kind === 'vector3' && (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))) {
          throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', field.label + ' requires three finite numbers.');
        }
        if (field.kind === 'matrix4' && (!Array.isArray(value) || value.length !== 16 || !value.every(Number.isFinite))) {
          throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', field.label + ' requires 16 finite numbers.');
        }
      }
    }
  }

  function scheduleV6PresentationFrame(callback) {
    let fired = false;
    const timer = setTimeout(() => {
      if (fired) return;
      fired = true;
      callback(performance.now());
    }, 16);
    requestAnimationFrame((time) => {
      if (fired) return;
      fired = true;
      clearTimeout(timer);
      callback(time);
    });
  }

  function waitForV6PresentationFrame() {
    return new Promise((resolve) => scheduleV6PresentationFrame(resolve));
  }

  async function revealV6TreeEntity(entity) {
    if (entity.kind === 'occurrence') {
      showWorkspace('assembly', false);
      renderAssemblyTree();
    } else {
      renderHistory();
      renderBodies();
    }
    await waitForV6PresentationFrame();
    const candidates = entity.kind === 'body'
      ? document.querySelectorAll('[data-body-id]')
      : entity.kind === 'occurrence'
        ? document.querySelectorAll('[data-occurrence-id], [data-runtime-occurrence-id]')
        : document.querySelectorAll('#bw-history [data-sel]');
    const row = [...candidates].find((candidate) => {
      if (entity.kind === 'body') return candidate.dataset.bodyId === entity.id;
      if (entity.kind === 'occurrence') return (candidate.dataset.occurrenceId || candidate.dataset.runtimeOccurrenceId) === entity.id;
      return candidate.dataset.sel === entity.id;
    });
    if (!row) {
      throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'The entity exists but has no visible model-tree row.', {
        entity,
        repairOptions: [{ kind: 'refresh-project-tree' }],
      });
    }
    document.querySelectorAll('.is-agent-revealed').forEach((candidate) => candidate.classList.remove('is-agent-revealed'));
    row.classList.add('is-agent-revealed');
    row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return row.getAttribute('aria-label') || row.textContent?.trim() || entity.id;
  }

  function setV6TreeExpanded(entity, expanded) {
    v6TreeExpansion.set(v6SelectionRefKey(entity), expanded);
    renderAssemblyTree();
    const row = [...document.querySelectorAll('[data-occurrence-id], [data-runtime-occurrence-id], [data-body-id], #bw-history [data-sel]')]
      .find((candidate) =>
        (candidate.dataset.occurrenceId || candidate.dataset.runtimeOccurrenceId || candidate.dataset.bodyId || candidate.dataset.sel) === entity.id);
    if (row) row.setAttribute('aria-expanded', String(expanded));
    requestSceneRender();
    return { entity: deepCopy(entity), expanded };
  }

  function v6TreeEntityExpandable(entity) {
    if (entity?.kind !== 'occurrence') return false;
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'assembly') return false;
    return v5RuntimeTools.studioV5RootAssembly(doc).occurrences.some((entry) => entry.id === entity.id);
  }

  function renderV6Diagnostics(diagnosticId = null) {
    const body = $('bw-v6-diagnostics-body');
    if (!body) return [];
    const diagnostics = [
      ...[...buildErrors].map(([id, message]) => ({ id, message: String(message) })),
      ...[...bodyBuildErrors].map(([id, message]) => ({ id, message: String(message) })),
    ].filter((entry) => !diagnosticId || entry.id === diagnosticId);
    body.replaceChildren();
    if (!diagnostics.length) {
      const empty = document.createElement('p');
      empty.className = 'ctx-sub';
      empty.textContent = diagnosticId ? 'No current diagnostic matches ' + diagnosticId + '.' : 'No current kernel or document diagnostics.';
      body.appendChild(empty);
    } else {
      for (const diagnostic of diagnostics) {
        const item = document.createElement('div');
        item.className = 'v6-diagnostic';
        item.dataset.diagnosticId = diagnostic.id;
        item.textContent = diagnostic.id + ': ' + diagnostic.message;
        body.appendChild(item);
      }
    }
    return diagnostics;
  }

  function syncV6PanelVisibility() {
    appEl.classList.toggle('v6-model-tree-closed', !v6PanelOpen.get('model-tree'));
    appEl.classList.toggle('v6-inspector-closed', !v6PanelOpen.get('inspector') && !v6PanelOpen.get('diagnostics'));
    appEl.classList.toggle('v6-project-closed', !v6PanelOpen.get('project'));
    appEl.classList.toggle('v6-history-closed', !v6PanelOpen.get('history'));
    const diagnostics = $('bw-v6-diagnostics');
    if (diagnostics) diagnostics.hidden = !v6PanelOpen.get('diagnostics');
    if (v6PanelOpen.get('diagnostics')) {
      $('bw-context-wrap')?.toggleAttribute('hidden', true);
      $('bw-inspector-empty')?.toggleAttribute('hidden', true);
    } else {
      renderContext();
    }
    sideEl?.classList.toggle('m-open-project', Boolean(v6ProjectSheetRequested && v6PanelOpen.get('project') && window.matchMedia('(max-width: 760px)').matches));
    syncMtabs?.();
    requestSceneRender();
  }

  async function setV6Panel(panelId, open) {
    v6PanelOpen.set(panelId, open);
    if (panelId === 'project') v6ProjectSheetRequested = open;
    if (panelId === 'diagnostics' && open) {
      v6PanelOpen.set('inspector', true);
    }
    if (panelId === 'inspector' && open) v6PanelOpen.set('diagnostics', false);
    if (panelId === 'history' && open) v6PanelOpen.set('model-tree', true);
    syncV6PanelVisibility();
    await waitForV6PresentationFrame();
    if (panelId === 'history' && open) $('bw-history')?.scrollIntoView({ block: 'nearest' });
    return { panelId, open: Boolean(v6PanelOpen.get(panelId)) };
  }

  function v6CameraTargetForStandardView(viewId) {
    const { c, r } = partView();
    const direction = VIEW_DIRS[viewId];
    if (!direction) return null;
    const vector = new THREE.Vector3(...direction).normalize().multiplyScalar(r * 1.6);
    return { position: c.clone().add(vector), target: c, up: new THREE.Vector3(0, 1, 0) };
  }

  async function transitionV6Camera(next, { mode = 'normal', transition = 'cut' } = {}) {
    const generation = ++v6CameraTransitionGeneration;
    const startPosition = camera.position.clone();
    const startTarget = orbit.target.clone();
    const startUp = camera.up.clone();
    const duration = transition === 'animate' ? (mode === 'recording' ? 700 : 260) : 0;
    if (duration) {
      const started = performance.now();
      await new Promise((resolve, reject) => {
        const frame = (time) => {
          if (generation !== v6CameraTransitionGeneration) {
            reject(new v6InteractionTools.CadUiError('SESSION_PAUSED', 'The visible camera transition was interrupted.'));
            return;
          }
          const fraction = Math.min(1, (time - started) / duration);
          const eased = fraction < 0.5 ? 2 * fraction * fraction : 1 - Math.pow(-2 * fraction + 2, 2) / 2;
          camera.position.lerpVectors(startPosition, next.position, eased);
          orbit.target.lerpVectors(startTarget, next.target, eased);
          camera.up.lerpVectors(startUp, next.up, eased).normalize();
          camera.updateProjectionMatrix();
          orbit.update();
          requestSceneRender();
          if (fraction < 1) scheduleV6PresentationFrame(frame);
          else resolve();
        };
        scheduleV6PresentationFrame(frame);
      });
    } else {
      camera.position.copy(next.position);
      orbit.target.copy(next.target);
      camera.up.copy(next.up).normalize();
      camera.updateProjectionMatrix();
      orbit.update();
      requestSceneRender();
    }
  }

  function v6BoundsForSelection(selection) {
    partGroup.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    let found = false;
    const addMesh = (mesh) => {
      if (!mesh?.visible) return;
      bounds.expandByObject(mesh);
      found = true;
    };
    const addPoint = (point, object) => {
      if (!object) return;
      const world = new THREE.Vector3().fromArray(point);
      object.localToWorld(world);
      bounds.expandByPoint(world);
      found = true;
    };
    const addFace = (match) => {
      const range = faceRanges.find((entry) => entry.bodyId === match.owner.id && entry.faceId === match._faceId);
      const mesh = range?.mesh;
      const position = mesh?.geometry?.getAttribute?.('position');
      const index = mesh?.geometry?.getIndex?.();
      if (!mesh || !position || !index) return;
      mesh.updateMatrixWorld(true);
      for (let triangleIndex = range.t0 * 3; triangleIndex < range.t1 * 3; triangleIndex++) {
        const vertexIndex = index.getX(triangleIndex);
        addPoint([position.getX(vertexIndex), position.getY(vertexIndex), position.getZ(vertexIndex)], mesh);
      }
    };
    const addEdge = (match) => {
      const line = match._line;
      const position = line?.geometry?.getAttribute?.('position');
      if (!line || !position || !match._entry) return;
      line.updateMatrixWorld(true);
      for (let vertexIndex = match._entry.start; vertexIndex < match._entry.start + match._entry.count; vertexIndex++) {
        addPoint([position.getX(vertexIndex), position.getY(vertexIndex), position.getZ(vertexIndex)], line);
      }
    };
    const topology = v6TopologyInventory();
    for (const ref of selection) {
      if (ref.owner) {
        const match = topology.find((candidate) => candidate.stableId === ref.stableId && candidate.owner.id === ref.owner.id);
        if (!match) continue;
        if (match.topologySignature.kind === 'face') addFace(match);
        else if (match.topologySignature.kind === 'edge') addEdge(match);
        else addPoint(match.topologySignature.p, bodyMeshes.get(match.owner.id));
        continue;
      }
      if (ref.kind === 'body') addMesh(bodyMeshes.get(ref.id));
      if (ref.kind === 'occurrence') {
        for (const result of lastBodyResults.filter((entry) => entry.occurrenceInstance?.occurrencePath?.includes(ref.id))) addMesh(bodyMeshes.get(result.bodyId));
      }
      if (ref.kind === 'feature') {
        const feature = doc.features.find((entry) => entry.id === ref.id);
        const ids = [feature?.createdBodyId, ...(feature?.resultPolicy?.targetBodyIds || [])].filter(Boolean);
        for (const id of ids) addMesh(bodyMeshes.get(id));
      }
    }
    return found && !bounds.isEmpty() ? bounds : null;
  }

  async function fitV6Bounds(bounds, context) {
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(0.5, size.length() / 2);
    const direction = camera.position.clone().sub(orbit.target);
    if (direction.lengthSq() < 1e-12) direction.set(1, 0.8, 1);
    direction.normalize();
    const distance = Math.max(4, radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.18);
    await transitionV6Camera({
      position: center.clone().add(direction.multiplyScalar(distance)),
      target: center,
      up: camera.up.clone(),
    }, context);
    return {
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      center: center.toArray(),
      size: size.toArray(),
    };
  }

  function focusV6Action(actionId) {
    document.querySelectorAll('[data-v6-focused-action="true"]').forEach((element) => delete element.dataset.v6FocusedAction);
    const targets = {
      'model-tree': $('bw-tree'),
      inspector: $('bw-side'),
      project: $('bw-project-actions'),
      history: $('bw-history'),
      diagnostics: $('bw-v6-diagnostics'),
      viewport: $('bw-studio'),
    };
    const capabilitySurface = actionId.startsWith('viewport.')
      ? targets.viewport
      : actionId.startsWith('selection.') || actionId.startsWith('tree.')
        ? targets['model-tree']
        : actionId.startsWith('inspector.')
          ? targets.inspector
          : actionId.startsWith('history.')
            ? targets.history
            : actionId.startsWith('diagnostics.')
              ? targets.diagnostics
              : actionId.startsWith('panel.')
                ? targets.project
                : actionId.startsWith('workspace.')
                  ? document.querySelector('[data-workspace="' + CSS.escape(activeWorkspace) + '"]')
                  : null;
    const target = targets[actionId] || capabilitySurface || document.querySelector('[data-workspace="' + CSS.escape(actionId) + '"]');
    if (!target) throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'No visible Studio surface is registered for action "' + actionId + '".');
    target.dataset.v6FocusedAction = 'true';
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    v6FocusedActionId = actionId;
    return { actionId, visible: true };
  }

  function emitV6CommandEvent(kind, payload, context = {}, actor = 'agent') {
    const runtime = getV6InteractionRuntime();
    return runtime.emit(kind, payload, {
      actor,
      correlationId: context.correlationId || null,
      uiRevision: context.targetUiRevision ?? runtime.uiRevision,
    });
  }

  function v6CommandOccurrence(draft = v6AgentCommandDraft) {
    const occurrenceId = draft?.boundSelections?.occurrence?.[0]?.id;
    if (!occurrenceId || !v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'assembly') return null;
    return v5RuntimeTools.studioV5RootAssembly(doc).occurrences.find((entry) => entry.id === occurrenceId) || null;
  }

  function renderV6CommandPreview() {
    const surface = $('bw-v6-command-preview');
    const title = $('bw-v6-command-preview-title');
    const summary = $('bw-v6-command-preview-summary');
    const evidence = $('bw-v6-command-preview-evidence');
    const apply = $('bw-v5-command-apply');
    if (!surface || !title || !summary || !evidence || !apply) return;
    const preview = v6VisiblePreview;
    const draft = v6AgentCommandDraft;
    surface.hidden = !preview?.visible;
    apply.disabled = Boolean(draft) && !preview?.visible;
    apply.textContent = preview?.visible ? 'Apply exact preview' : draft ? 'Preview required' : 'Apply';
    v5Dialog?.toggleAttribute('data-v6-agent-command', Boolean(draft));
    if (!preview?.visible) {
      title.textContent = draft?.state === 'blocked' ? 'Preview needs attention' : 'Ready to preview';
      summary.textContent = '';
      evidence.replaceChildren();
      return;
    }
    const changeSet = preview.changeSet || {};
    const counts = {
      created: changeSet.created?.length || 0,
      updated: changeSet.updated?.length || 0,
      deleted: changeSet.deleted?.length || 0,
    };
    title.textContent = preview.validation?.valid ? 'Exact validation passed' : 'Preview blocked';
    summary.textContent =
      `${counts.created} created · ${counts.updated} updated · ${counts.deleted} deleted. ` +
      'The document remains unchanged until this exact preview is committed.' +
      (preview.confirmation?.required ? ' Confirmation is required for this destructive change.' : '');
    evidence.replaceChildren();
    const rows = [
      ['Revision', String(preview.baseRevision)],
      ['Transaction', preview.transactionHash],
      ['Document hash', preview.changeSet?.documentHashAfter || 'unavailable'],
      ['Kernel', preview.validation?.exactGeometry ? 'exact geometry valid' : 'exact validation unavailable'],
      ['Bodies', String(preview.evidence?.bodyResults?.length || 0)],
      ['Approval', preview.confirmation?.required ? 'required · destructive change' : 'required by session policy'],
    ];
    for (const [label, value] of rows) {
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      evidence.append(term, detail);
    }
  }

  function setV6TransformPreviewMatrix(matrix) {
    const occurrence = v6CommandOccurrence();
    if (!occurrence) throw new v6InteractionTools.CadUiError('COMMAND_FIELD_REQUIRED', 'The visible transform draft has no component occurrence.');
    if (!transformPreview?.object || transformPreview.occurrenceId !== occurrence.id) {
      if (!beginAssemblyTransformPreview(occurrence)) {
        throw new v6InteractionTools.CadUiError('RENDER_SETTLEMENT_TIMEOUT', 'The selected component has no rendered geometry for visible preview.');
      }
    }
    transformPreview.object.matrix.fromArray(cadMatrixToScene(matrix));
    transformPreview.object.matrix.decompose(
      transformPreview.object.position,
      transformPreview.object.quaternion,
      transformPreview.object.scale,
    );
    transformPreview.object.updateMatrixWorld(true);
    transformControls.dispatchEvent({ type: 'objectChange' });
    requestSceneRender();
  }

  function cancelV6PreviewServiceRecord(previewId) {
    if (!previewId) return;
    liveAgentService?.cancelPreview(previewId);
    activeAgentConnection?.previews.delete(previewId);
  }

  function cancelV6PreviewRecord() {
    const previewId = v6VisiblePreview?.previewId;
    if (previewId) {
      if (v6ApplyingSemanticAction && previewId === v6SemanticBatchBasePreviewId) {
        v6DeferredPreviewCancellations.add(previewId);
      } else {
        cancelV6PreviewServiceRecord(previewId);
      }
    }
    v6VisiblePreview = null;
    if (v6AgentCommandDraft) {
      v6AgentCommandDraft.previewId = null;
      if (v6AgentCommandDraft.state !== 'blocked') v6AgentCommandDraft.state = 'draft';
    }
    renderV6CommandPreview();
  }

  function invalidateV6CommandPreview() {
    cancelV6PreviewRecord();
    endTransformPreview(true);
    const occurrence = v6CommandOccurrence();
    if (v6AgentCommandDraft?.commandId === 'assembly.component-transform' && occurrence) beginAssemblyTransformPreview(occurrence);
  }

  function v6CommandDefinition(commandId = v6AgentCommandDraft?.commandId) {
    return v6InteractionTools.cadUiCapabilityManifest().commands.find((entry) => entry.id === commandId) || null;
  }

  function v6CommandField(fieldId) {
    return v6CommandDefinition()?.fields.find((entry) => entry.id === fieldId) || null;
  }

  function v6AdvertisedCommandField(fieldId) {
    const active = v6CommandField(fieldId);
    if (active) return active;
    const candidates = v6InteractionTools.cadUiCapabilityManifest().commands
      .filter((entry) => entry.state === 'available')
      .flatMap((entry) => entry.fields)
      .filter((entry) => entry.id === fieldId);
    if (!candidates.length) return null;
    const field = deepCopy(candidates[0]);
    if (field.kind === 'enum') {
      field.values = [...new Set(candidates.flatMap((entry) => entry.values || []))];
    } else if (field.kind === 'selection') {
      field.selectionKinds = [...new Set(candidates.flatMap((entry) => entry.selectionKinds || []))];
      field.minItems = Math.min(...candidates.map((entry) => entry.minItems || 0));
      field.maxItems = Math.max(...candidates.map((entry) => entry.maxItems || 100));
    }
    return field;
  }

  function v6AssemblyCommandRoute(commandId) {
    if (commandId.startsWith('assembly.mate.')) {
      return { command: 'mate', mateKind: commandId.slice('assembly.mate.'.length) };
    }
    return {
      command: commandId === 'assembly.component-transform'
        ? 'transform'
        : commandId.slice('assembly.'.length),
      mateKind: null,
    };
  }

  function v6InspectionCommandRoute(commandId) {
    return { command: commandId.slice('inspection.'.length) };
  }

  function v6ModelCommandRoute(commandId) {
    return { command: commandId.slice('model.'.length) };
  }

  const V6_BASIC_MODEL_COMMANDS = new Set([
    'model.extrude',
    'model.cut',
    'model.revolve',
    'model.fillet',
    'model.chamfer',
    'model.shell',
  ]);

  function v6FormControl(name) {
    return $('bw-v5-command-form')?.elements?.namedItem?.(name) || null;
  }

  function v6FormText(name) {
    return String(v6FormControl(name)?.value ?? '').trim();
  }

  function v6FormNumber(name, fallback = 0) {
    const value = Number(v6FormControl(name)?.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function v6FormBoolean(name) {
    return v6FormControl(name)?.checked === true;
  }

  function v6DefinitionSelection(value) {
    const [kind, id] = String(value || '').split(':');
    if (!id || !['part', 'assembly'].includes(kind)) {
      throw new v6InteractionTools.CadUiError('COMMAND_FIELD_REQUIRED', 'Choose a reusable part or assembly definition.');
    }
    return { kind, id };
  }

  function v6MateReferenceSelection(value) {
    const stored = v5Dialog.__assemblyReferences?.find((entry) => entry.id === value)?.reference;
    if (stored?.ownerKind === 'body') {
      const signature = stored.signature || {};
      const topologyKind = signature.kind || signature.topologyKind || (signature.n ? 'face' : signature.l != null ? 'edge' : 'vertex');
      return {
        owner: { kind: 'body', id: stored.ownerId },
        stableId: 'mate-' + topologyKind + '-' + v6CanonicalKey({ ownerId: stored.ownerId, signature }).replace('fnv1a32:', ''),
        topologySignature: {
          kind: topologyKind,
          p: deepCopy(signature.p || [0, 0, 0]),
          ...(topologyKind === 'face' ? { n: deepCopy(signature.n || [0, 0, 1]) } : {}),
          ...(topologyKind === 'edge' ? {
            l: Number(signature.l) || 0,
            curveType: signature.curveType || 'other',
            ...(Number.isFinite(signature.r) ? { r: signature.r } : {}),
            ...(signature.c ? { c: deepCopy(signature.c) } : {}),
          } : {}),
        },
      };
    }
    const [occurrenceId, datumId] = String(value || '').split('|');
    if (datumId) return { kind: 'datum', id: datumId };
    if (occurrenceId) return { kind: 'occurrence', id: occurrenceId };
    throw new v6InteractionTools.CadUiError('COMMAND_FIELD_REQUIRED', 'Choose a stable assembly geometry reference.');
  }

  function v6ModelTopologySelection(bodyId, kind, signature) {
    const topologySignature = {
      ...deepCopy(signature),
      kind,
      p: deepCopy(signature?.p || [0, 0, 0]),
    };
    return {
      owner: { kind: 'body', id: bodyId },
      stableId: 'model-' + kind + '-' + v6CanonicalKey({ bodyId, topologySignature }).replace('fnv1a32:', ''),
      topologySignature,
    };
  }

  function v6InitialAssemblyDraft(commandId, identity = null) {
    const route = v6AssemblyCommandRoute(commandId);
    const occurrenceId = v5Dialog.dataset.occurrenceId || selectedOccurrenceId || null;
    const activeAssembly = doc.rootDocument?.kind === 'assembly'
      ? v5RuntimeTools.studioV5RootAssembly(doc)
      : doc.assemblyDefinitions?.find((entry) => entry.id === doc.metadata?.editContext?.assemblyId);
    const occurrence = occurrenceId
      ? activeAssembly?.occurrences.find((entry) => entry.id === occurrenceId)
      : null;
    const base = {
      commandId,
      draftId: identity?.draftId || `draft-${++v6DraftSequence}-${commandRevision}`,
      transactionId: identity?.transactionId || `visible-${crypto.randomUUID?.() || commandRevision + '-' + Date.now()}`,
      baseRevision: commandRevision,
      state: 'draft',
      inputValues: {},
      boundSelections: {},
      generatedIds: deepCopy(identity?.generatedIds || {}),
      diagnostics: [],
      previewId: null,
    };
    if (route.command === 'create') {
      base.inputValues = {
        name: v6FormText('name'),
        occurrenceName: v6FormText('occurrenceName'),
        fixed: v6FormBoolean('fixed'),
      };
      base.generatedIds.assemblyId ||= 'assembly-' + newId();
      base.generatedIds.occurrenceId ||= 'occurrence-' + newId();
    } else if (route.command === 'insert') {
      base.inputValues = {
        name: v6FormText('name'),
        translation: ['x', 'y', 'z'].map((name) => v6FormNumber(name)),
        fixed: v6FormBoolean('fixed'),
      };
      base.boundSelections.definition = [v6DefinitionSelection(v6FormText('definition'))];
      base.generatedIds.occurrenceId ||= 'occurrence-' + newId();
    } else if (route.command === 'linked') {
      base.inputValues = {
        name: v6FormText('name'),
        translation: ['x', 'y', 'z'].map((name) => v6FormNumber(name)),
      };
      base.boundSelections.occurrence = [{ kind: 'occurrence', id: occurrence.id }];
      base.generatedIds.occurrenceId ||= 'occurrence-' + newId();
    } else if (route.command === 'independent') {
      base.inputValues = { name: v6FormText('name') };
      base.boundSelections.occurrence = [{ kind: 'occurrence', id: occurrence.id }];
      base.generatedIds.partId ||= 'part-independent-' + newId();
    } else if (route.command === 'replace') {
      base.boundSelections.occurrence = [{ kind: 'occurrence', id: occurrence.id }];
      base.boundSelections.definition = [v6DefinitionSelection(v6FormText('definition'))];
    } else if (route.command === 'variant') {
      base.inputValues = {
        parameterOverrides: String(v6FormControl('parameterOverrides')?.value || '')
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      };
      base.boundSelections.occurrence = [{ kind: 'occurrence', id: occurrence.id }];
    } else if (route.command === 'transform') {
      const matrix = String(v6FormControl('matrix')?.value || '')
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      base.inputValues = {
        gizmoMode: v6FormText('gizmoMode') || 'translate',
        gizmoSnap: v6FormNumber('gizmoSnap', 1),
        ...(matrix.length === 16 && matrix.every(Number.isFinite) ? { transform: matrix } : {}),
      };
      base.boundSelections.occurrence = [{ kind: 'occurrence', id: occurrence.id }];
      if (!base.inputValues.transform) {
        base.state = 'blocked';
        base.diagnostics = [{
          code: 'COMMAND_FIELD_INVALID',
          severity: 'error',
          message: 'Rigid 4×4 transform requires 16 finite numbers.',
          fieldId: 'transform',
        }];
      }
    } else if (route.command === 'edit-context') {
      base.boundSelections.occurrence = [{ kind: 'occurrence', id: occurrence.id }];
    } else if (route.command === 'pattern') {
      base.inputValues = {
        name: v6FormText('name'),
        patternKind: v6FormText('patternKind'),
        generatedCount: v6FormNumber('generatedCount', 1),
        spacing: v6FormNumber('spacing'),
        totalAngle: v6FormNumber('totalAngle', 360),
      };
      base.boundSelections.occurrence = [{ kind: 'occurrence', id: occurrence.id }];
      base.generatedIds.patternId ||= 'occurrence-pattern-' + newId();
    } else if (route.command === 'mate') {
      const fixed = route.mateKind === 'fixed';
      const mateId = v5Dialog.dataset.mateId || '';
      const anchorOccurrenceId = v6FormText('anchorOccurrenceId');
      const movingOccurrenceId = v6FormText('movingOccurrenceId');
      base.inputValues = {
        name: v6FormText('name'),
        value: v6FormNumber('value'),
        flip: v6FormBoolean('flip'),
      };
      base.boundSelections = {
        movingOccurrence: [{ kind: 'occurrence', id: movingOccurrenceId }],
        ...(fixed ? {} : {
          anchorOccurrence: [{ kind: 'occurrence', id: anchorOccurrenceId }],
          anchorReference: [v6MateReferenceSelection(v6FormText('anchorReference'))],
          movingReference: [v6MateReferenceSelection(v6FormText('movingReference'))],
        }),
      };
      if (mateId) {
        base.editEntity = { kind: 'mate', id: mateId };
        base.generatedIds.mateId = mateId;
      } else {
        base.generatedIds.mateId ||= 'mate-' + newId();
      }
    }
    return base;
  }

  function v6InitialInspectionDraft(commandId, identity = null) {
    const route = v6InspectionCommandRoute(commandId);
    const base = {
      commandId,
      draftId: identity?.draftId || `draft-${++v6DraftSequence}-${commandRevision}`,
      transactionId: identity?.transactionId || `visible-${crypto.randomUUID?.() || commandRevision + '-' + Date.now()}`,
      baseRevision: commandRevision,
      state: 'draft',
      inputValues: {},
      boundSelections: {},
      generatedIds: deepCopy(identity?.generatedIds || {}),
      diagnostics: [],
      previewId: null,
    };
    if (route.command === 'section') {
      const scopeOccurrenceId = v6FormText('scopeOccurrenceId');
      base.inputValues = {
        name: v6FormText('name'),
        sectionKind: v6FormText('sectionKind'),
        offset: v6FormNumber('offset'),
        cap: v6FormBoolean('cap'),
        reverse: v6FormBoolean('reverse'),
        hatchSpacing: v6FormNumber('hatchSpacing'),
        hatchAngle: v6FormNumber('hatchAngle'),
        capFillColor: v6FormText('capFillColor'),
        hatchColor: v6FormText('hatchColor'),
      };
      if (scopeOccurrenceId) base.boundSelections.scopeOccurrence = [{ kind: 'occurrence', id: scopeOccurrenceId }];
      base.generatedIds.sectionId ||= 'section-' + newId();
    } else if (route.command === 'explode') {
      const occurrenceId = v5Dialog.dataset.occurrenceId || selectedOccurrenceId;
      base.inputValues = {
        name: v6FormText('name'),
        translation: ['x', 'y', 'z'].map((name) => v6FormNumber(name)),
      };
      if (occurrenceId) base.boundSelections.occurrence = [{ kind: 'occurrence', id: occurrenceId }];
      base.generatedIds.explodedViewId ||= 'exploded-' + newId();
    } else if (route.command === 'stage') {
      const ids = (name) => v6FormText(name).split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
      base.inputValues = {
        name: v6FormText('name'),
        occurrenceIds: ids('occurrenceIds'),
        distanceMateIds: ids('distanceMateIds'),
        start: v6FormNumber('start'),
        spacing: v6FormNumber('spacing'),
        visible: v6FormBoolean('visible'),
      };
      base.generatedIds.stageGroupId ||= 'stage-group-' + newId();
    } else if (route.command === 'measure') {
      const bodyIds = v6FormText('bodyIds').split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
      base.inputValues = {
        name: v6FormText('name'),
        measurementKind: v6FormText('measurementKind'),
      };
      base.boundSelections.bodies = bodyIds.map((id) => ({ kind: 'body', id }));
      base.generatedIds.measurementId ||= 'measurement-' + newId();
    } else if (route.command === 'material') {
      const partId = v5Dialog.dataset.partId || '';
      const bodyId = v5Dialog.dataset.sourceBodyId || '';
      const occurrenceId = v5Dialog.dataset.occurrenceId || '';
      const materialId = v6FormText('materialId');
      const material = v5Dialog.__candidate?.materials?.find((entry) => entry.id === materialId);
      if (bodyId) base.boundSelections.body = [{ kind: 'body', id: bodyId }];
      if (materialId) base.boundSelections.material = [{ kind: 'material', id: materialId }];
      base.materialContext = {
        partId,
        bodyId,
        ...(occurrenceId ? { occurrenceId } : {}),
        ...(material?.appearanceId ? { appearanceId: material.appearanceId } : {}),
      };
      base.bootstrapOperations = [{ kind: 'material.ensureGeneric', input: {} }];
    }
    return base;
  }

  function v6InitialModelDraft(commandId, identity = null) {
    const route = v6ModelCommandRoute(commandId);
    const form = $('bw-v5-command-form');
    const base = {
      commandId,
      draftId: identity?.draftId || `draft-${++v6DraftSequence}-${commandRevision}`,
      transactionId: identity?.transactionId || `visible-${crypto.randomUUID?.() || commandRevision + '-' + Date.now()}`,
      baseRevision: commandRevision,
      state: 'draft',
      inputValues: {},
      boundSelections: {},
      generatedIds: deepCopy(identity?.generatedIds || {}),
      diagnostics: [],
      previewId: null,
    };
    let editedEntity = v5Dialog.dataset.datumId
      ? { kind: 'datum', id: v5Dialog.dataset.datumId }
      : v5Dialog.dataset.sketchId
        ? { kind: 'sketch', id: v5Dialog.dataset.sketchId }
        : v5Dialog.dataset.patternId
          ? { kind: 'body-pattern', id: v5Dialog.dataset.patternId }
          : v5Dialog.dataset.featureId
            ? { kind: 'feature', id: v5Dialog.dataset.featureId }
            : null;
    if (editedEntity) base.editEntity = editedEntity;
    if (V6_BASIC_MODEL_COMMANDS.has(commandId)) {
      const feature = commandId === 'model.shell'
        ? shellPick.snapshot()
        : commandId === 'model.fillet' || commandId === 'model.chamfer'
          ? picker.snapshot()
          : facePick.active()
            ? facePick.snapshot()
            : sketch.snapshot();
      if (!feature) {
        throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'The normal Studio feature editor is not active.');
      }
      if (!editedEntity && doc.features.some((entry) => entry.id === feature.id)) {
        editedEntity = { kind: 'feature', id: feature.id };
        base.editEntity = editedEntity;
      }
      base.generatedIds.featureId ||= feature.id;
      if (commandId === 'model.extrude' || commandId === 'model.cut' || commandId === 'model.revolve') {
        base.inputValues = {
          sketch: deepCopy(feature.sketch?.shapes || []),
          sketchZ: deepCopy(feature.sketch?.z ?? 0),
          ...(commandId === 'model.revolve' ? {} : { height: deepCopy(feature.h ?? 20) }),
          ...(commandId === 'model.cut' ? { through: feature.through === true } : {}),
          ...(commandId === 'model.revolve' ? {} : {
            patternKind: feature.pattern?.kind || 'none',
            patternCount: deepCopy(feature.pattern?.n ?? 4),
            patternA: deepCopy(feature.pattern?.kind === 'circular' ? (feature.pattern?.cx ?? 0) : (feature.pattern?.dx ?? 10)),
            patternB: deepCopy(feature.pattern?.kind === 'circular' ? (feature.pattern?.cy ?? 0) : (feature.pattern?.dy ?? 0)),
          }),
          resultPolicy: feature.resultPolicy?.kind || 'new-body',
          bodyName: feature.resultPolicy?.bodyName || 'Body 1',
        };
        if (feature.resultPolicy?.targetBodyIds?.[0]) {
          base.boundSelections.targetBody = [{ kind: 'body', id: feature.resultPolicy.targetBodyIds[0] }];
        }
        if (feature.onFace) {
          const support = v6TopologyInventory().find((entry) =>
            entry.owner?.kind === 'body' &&
            (!feature.inputRefs?.[0]?.ownerId || entry.owner.id === feature.inputRefs[0].ownerId) &&
            entry.topologySignature?.kind === 'face' &&
            faceMatches(feature.onFace, entry.topologySignature));
          if (support) {
            base.boundSelections.supportFace = [deepCopy({
              owner: support.owner,
              stableId: support.stableId,
              topologySignature: support.topologySignature,
              expectedGeometry: support.expectedGeometry,
            })];
          }
        }
      } else if (commandId === 'model.fillet' || commandId === 'model.chamfer') {
        base.inputValues = { radius: deepCopy(feature.r ?? 2) };
        base.boundSelections.edges = picker.semanticSelections();
      } else {
        const bodyId = feature.resultPolicy?.targetBodyIds?.[0] || selectedBodyId;
        base.inputValues = { thickness: deepCopy(feature.t ?? 2) };
        if (bodyId) base.boundSelections.body = [{ kind: 'body', id: bodyId }];
        base.boundSelections.faces = shellPick.semanticSelections();
      }
      return base;
    }
    const documentPart = v5RuntimeTools.studioV5RootPart(doc);
    const candidatePart = v5RuntimeTools.studioV5RootPart(v5Dialog.__candidate);
    base.bootstrapOperations = candidatePart.referenceGeometry
      .filter((entry) =>
        entry.id.startsWith('datum-origin-') &&
        !documentPart.referenceGeometry.some((existing) => existing.id === entry.id))
      .map((entry) => ({
        kind: 'datum.create',
        input: {
          id: entry.id,
          name: entry.name,
          datumKind: entry.kind,
          definition: deepCopy(entry.definition),
        },
      }));
    const select = (fieldId, kind, id) => {
      if (id) base.boundSelections[fieldId] = [{ kind, id }];
    };
    const selectMany = (fieldId, kind, ids) => {
      const values = (ids || []).filter(Boolean).map((id) => ({ kind, id }));
      if (values.length) base.boundSelections[fieldId] = values;
    };
    if (route.command === 'split') {
      base.inputValues = {
        name: v6FormText('name'),
        keepOriginal: v6FormBoolean('keepOriginal'),
        keepTools: v6FormBoolean('keepTools'),
      };
      select('targetBody', 'body', v6FormText('targetBodyId'));
      select('toolBody', 'body', v6FormText('toolBodyId'));
      base.generatedIds.splitId ||= 'split-' + newId();
    } else if (route.command === 'plane') {
      const definition = planeDefinitionFromForm(form);
      base.inputValues = { name: v6FormText('name'), mode: definition.mode };
      if (definition.mode === 'offset') {
        base.inputValues.offset = definition.offset;
        select('referenceDatum', 'datum', definition.referenceDatumId);
      } else if (definition.mode === 'angle') {
        base.inputValues.angle = definition.angle;
        select('referenceDatum', 'datum', definition.referenceDatumId);
        select('axisDatum', 'datum', definition.axisDatumId);
      } else if (definition.mode === 'midplane') {
        select('firstDatum', 'datum', definition.firstDatumId);
        select('secondDatum', 'datum', definition.secondDatumId);
      } else if (definition.mode === 'three-point') {
        base.inputValues.points = definition.points;
      } else {
        base.inputValues.normal = definition.normal || definition.tangent;
        select('pointDatum', 'datum', definition.pointDatumId);
      }
      base.generatedIds.datumId ||= editedEntity?.kind === 'datum' ? editedEntity.id : 'datum-' + newId();
    } else if (route.command === 'profile' || route.command === 'path') {
      const profile = route.command === 'profile';
      base.inputValues = {
        name: v6FormText('name'),
        curveKind: v6FormText('curveKind'),
        points: parsePointRows(v6FormControl('points')?.value, profile ? 2 : 3, profile ? 'Profile' : 'Path'),
      };
      if (profile) select('planeDatum', 'datum', v6FormText('planeDatumId'));
      base.generatedIds.sketchId ||= editedEntity?.kind === 'sketch' ? editedEntity.id : 'sketch-' + route.command + '-' + newId();
    } else if (route.command === 'loft') {
      const patch = advancedFeatureFromForm(form, route.command);
      base.inputValues = {
        name: patch.name,
        startContinuity: patch.continuity.start,
        endContinuity: patch.continuity.end,
        ruled: patch.ruled,
      };
      selectMany('sections', 'sketch', patch.sections);
      selectMany('guideSketch', 'sketch', patch.guideSketchIds);
      select('centerlineSketch', 'sketch', patch.centerlineSketchId);
      base.generatedIds.featureId ||= 'feature-loft-' + newId();
    } else if (route.command === 'sweep') {
      const patch = advancedFeatureFromForm(form, route.command);
      base.inputValues = {
        name: patch.name,
        orientation: patch.orientation,
        twistAngle: patch.twistAngle,
        scaleEnd: patch.scaleEnd,
        referenceDirection: patch.referenceDirection,
      };
      select('profileSketch', 'sketch', patch.profileSketchId);
      select('pathSketch', 'sketch', patch.pathSketchId);
      select('guideSketch', 'sketch', patch.guideSketchId);
      base.generatedIds.featureId ||= 'feature-sweep-' + newId();
    } else if (route.command === 'revolve-advanced') {
      base.inputValues = {
        name: v6FormText('name'),
        angle: formNumber(form, 'angle'),
        startAngle: formNumber(form, 'startAngle'),
        symmetric: v6FormBoolean('symmetric'),
      };
      select('profileSketch', 'sketch', v6FormText('profileSketchId'));
      select('axisDatum', 'datum', v6FormText('axisDatumId'));
      base.generatedIds.featureId ||= 'feature-revolve-' + newId();
    } else if (['draft', 'thicken', 'variable-fillet'].includes(route.command)) {
      const patch = advancedModifierFromForm(form, route.command);
      const bodyId = patch.bodyId;
      base.inputValues = { name: patch.name };
      select('body', 'body', bodyId);
      if (route.command === 'draft') {
        Object.assign(base.inputValues, {
          angle: patch.angle,
          flip: patch.flip,
          tangentPropagation: patch.tangentPropagation,
        });
        select('neutralPlane', 'datum', patch.neutralPlaneDatumId);
        base.boundSelections.faces = patch.faces.map((signature) => v6ModelTopologySelection(bodyId, 'face', signature));
      } else if (route.command === 'thicken') {
        Object.assign(base.inputValues, {
          bodyName: patch.bodyName,
          thickness: patch.thickness,
          symmetric: patch.symmetric,
          flip: patch.flip,
        });
        base.boundSelections.faces = patch.faces.map((signature) => v6ModelTopologySelection(bodyId, 'face', signature));
      } else {
        Object.assign(base.inputValues, {
          startRadius: patch.startRadius,
          endRadius: patch.endRadius,
          tangentPropagation: patch.tangentPropagation,
        });
        base.boundSelections.edges = patch.edges.map((signature) => v6ModelTopologySelection(bodyId, 'edge', signature));
      }
      base.generatedIds.featureId ||= 'feature-' + route.command + '-' + newId();
    } else if (route.command === 'pattern') {
      const patch = bodyPatternFromForm(form);
      base.inputValues = {
        name: patch.name,
        patternKind: patch.kind,
        outputMode: patch.outputMode,
        count: patch.count,
        distribution: patch.distribution,
        symmetric: patch.symmetric,
        orientation: patch.orientation,
        count2: patch.count2,
        symmetric2: patch.symmetric2,
        spacing2: patch.spacing2,
        extent2: patch.extent2,
        tableValues2: patch.positions2,
        spacing: patch.spacing,
        extent: patch.extent,
        totalAngle: patch.totalAngle,
        spacingAngle: patch.spacingAngle,
        radialOffset: patch.radialOffset,
        axialOffset: patch.axialOffset,
        tableValues: patch.positions || patch.angles || patch.parameters || [],
        skippedIndices: patch.skippedIndices,
      };
      select('sourceBody', 'body', patch.sourceBodyId);
      selectMany('directionDatums', 'datum', patch.directionDatumIds);
      select('axisDatum', 'datum', patch.axisDatumId);
      select('planeDatum', 'datum', patch.planeDatumId);
      select('pathSketch', 'sketch', patch.pathSketchId);
      base.generatedIds.patternId ||= editedEntity?.kind === 'body-pattern' ? editedEntity.id : 'pattern-' + newId();
    } else if (['move', 'copy', 'rotate', 'mirror', 'scale', 'align'].includes(route.command)) {
      const transform = transformFromForm(form, route.command);
      const bodyId = v5Dialog.dataset.bodyId || selectedBodyId;
      select('body', 'body', bodyId);
      if (route.command === 'move' || route.command === 'copy') {
        base.inputValues.translation = transform.translation;
        base.inputValues.gizmoSnap = formNumber(form, 'gizmoSnap', 1);
      } else if (route.command === 'rotate') {
        base.inputValues.angle = transform.angle;
        base.inputValues.gizmoSnap = formNumber(form, 'gizmoSnap', 15);
        select('axisDatum', 'datum', transform.axisDatumId);
      } else if (route.command === 'mirror') {
        base.inputValues.moveOriginal = v6FormBoolean('moveOriginal');
        select('planeDatum', 'datum', transform.planeDatumId);
      } else if (route.command === 'scale') {
        base.inputValues.factor = transform.factor;
        base.inputValues.center = transform.center;
      } else {
        base.inputValues.offset = transform.offset;
        base.inputValues.flip = transform.flip;
        select('fromDatum', 'datum', transform.fromDatumId);
        select('toDatum', 'datum', transform.toDatumId);
      }
      base.generatedIds.featureId ||= 'transform-' + newId();
    }
    return base;
  }

  function v6InitialVisibleCommandDraft(commandId, identity = null) {
    return commandId.startsWith('model.')
      ? v6InitialModelDraft(commandId, identity)
      : commandId.startsWith('assembly.')
      ? v6InitialAssemblyDraft(commandId, identity)
      : v6InitialInspectionDraft(commandId, identity);
  }

  function v6SetFormControl(name, value) {
    const control = v6FormControl(name);
    if (!control) return false;
    if (control.type === 'checkbox') control.checked = Boolean(value);
    else {
      const requested = String(value ?? '');
      control.value = requested;
      if (control.tagName === 'SELECT' && control.value !== requested) return false;
    }
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function v6SetVisibleCommandFormInput(fieldId, value) {
    if (V6_BASIC_MODEL_COMMANDS.has(v6AgentCommandDraft?.commandId)) {
      if (v6AgentCommandDraft.commandId === 'model.shell') return shellPick.setSemanticInput(fieldId, value);
      if (v6AgentCommandDraft.commandId === 'model.fillet' || v6AgentCommandDraft.commandId === 'model.chamfer') {
        return picker.setSemanticInput(fieldId, value);
      }
      return sketch.setSemanticInput(fieldId, value);
    }
    if (fieldId === 'translation') {
      if (!Array.isArray(value) || value.length !== 3) return false;
      const prefix = v6AgentCommandDraft?.commandId.startsWith('model.') ? 't' : '';
      return ['x', 'y', 'z'].every((name, index) => v6SetFormControl(prefix + name, value[index]));
    }
    if (fieldId === 'center') return ['x', 'y', 'z'].every((name, index) => v6SetFormControl('c' + name, value[index]));
    if (fieldId === 'referenceDirection') return ['x', 'y', 'z'].every((name, index) => v6SetFormControl('r' + name, value[index]));
    if (fieldId === 'normal') return v6SetFormControl('normalCsv', value.join(', '));
    if (fieldId === 'points') {
      if (v6AgentCommandDraft?.commandId === 'model.plane') {
        return value.length === 3 && value.every((point, index) => v6SetFormControl('point' + index, point.join(', ')));
      }
      return v6SetFormControl('points', formatPointRows(value));
    }
    if (fieldId === 'transform') return v6SetFormControl('matrix', value.join(', '));
    if (fieldId === 'parameterOverrides') return v6SetFormControl('parameterOverrides', value.join('\n'));
    if (fieldId === 'occurrenceIds' || fieldId === 'distanceMateIds') return v6SetFormControl(fieldId, value.join('\n'));
    if (fieldId === 'tableValues' || fieldId === 'tableValues2') return v6SetFormControl(fieldId, value.join('\n'));
    if (fieldId === 'skippedIndices') return v6SetFormControl(fieldId, value.join(', '));
    return v6SetFormControl(fieldId, value);
  }

  function v6SetTopologyFormSelection(entities) {
    const select = v6FormControl('topology');
    if (!select || !v5Dialog.__topologyChoices) return false;
    const comparable = (signature) => {
      const copy = deepCopy(signature || {});
      delete copy.kind;
      return v6CanonicalKey(copy);
    };
    const wanted = new Set(entities.map((entry) => comparable(entry.topologySignature)));
    let matched = 0;
    [...select.options].forEach((option) => {
      const selected = wanted.has(comparable(v5Dialog.__topologyChoices[Number(option.value)]));
      option.selected = selected;
      if (selected) matched++;
    });
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return matched === wanted.size;
  }

  function v6RestoreModelDraftForm(skipFieldId) {
    for (const [inputFieldId, value] of Object.entries(v6AgentCommandDraft.inputValues)) {
      v6SetVisibleCommandFormInput(inputFieldId, value);
    }
    for (const [selectionFieldId, values] of Object.entries(v6AgentCommandDraft.boundSelections)) {
      if (selectionFieldId === skipFieldId || ['body', 'targetBody', 'sourceBody'].includes(selectionFieldId)) continue;
      v6SetVisibleCommandFormSelection(selectionFieldId, values);
    }
  }

  function v6ReopenModelCommandForBody(fieldId, bodyId) {
    selectedBodyId = bodyId;
    setV6SemanticSelection([{ kind: 'body', id: bodyId }]);
    const command = v6ModelCommandRoute(v6AgentCommandDraft.commandId).command;
    v6ClosingCommand = true;
    try {
      openV5Command(command);
    } finally {
      v6ClosingCommand = false;
    }
    if (!v5Dialog?.open) return false;
    v6RestoreModelDraftForm(fieldId);
    return true;
  }

  function v6ModelSelectionExists(entity) {
    if (entity?.owner) return v6EntityExists(entity.owner);
    if (v6EntityExists(entity)) return true;
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'part') return false;
    const part = v5RuntimeTools.studioV5RootPart(doc);
    if (entity.kind === 'datum') return part.referenceGeometry.some((entry) => entry.id === entity.id);
    if (entity.kind === 'sketch') return part.sketches.some((entry) => entry.id === entity.id);
    return false;
  }

  function v6SetVisibleCommandFormSelection(fieldId, entities) {
    const entity = entities[0];
    if (V6_BASIC_MODEL_COMMANDS.has(v6AgentCommandDraft?.commandId)) {
      if (v6AgentCommandDraft.commandId === 'model.shell') return shellPick.setSemanticSelection(fieldId, entities);
      if (v6AgentCommandDraft.commandId === 'model.fillet' || v6AgentCommandDraft.commandId === 'model.chamfer') {
        return picker.setSemanticSelection(fieldId, entities);
      }
      return sketch.setSemanticSelection(fieldId, entities);
    }
    if (v6AgentCommandDraft?.commandId === 'inspection.material') {
      if (fieldId === 'material') return v6SetFormControl('materialId', entity?.id || '');
      if (fieldId === 'body') {
        const result = lastBodyResults.find((entry) => entry.sourceBodyId === entity?.id || entry.bodyId === entity?.id);
        if (!result) return false;
        selectedBodyId = result.bodyId;
        const occurrenceId = result.occurrenceInstance?.occurrencePath?.[0] || result.occurrenceInstance?.occurrenceId || null;
        if (occurrenceId) selectedOccurrenceId = occurrenceId;
        setV6SemanticSelection([{ kind: 'body', id: result.bodyId }]);
        v6ClosingCommand = true;
        try {
          openInspectionCommand('material');
        } finally {
          v6ClosingCommand = false;
        }
        const materialId = v6AgentCommandDraft.boundSelections.material?.[0]?.id;
        if (materialId) v6SetFormControl('materialId', materialId);
        return v5Dialog?.open && v5Dialog.dataset.sourceBodyId === entity.id;
      }
    }
    if (
      v6AgentCommandDraft?.commandId.startsWith('model.') &&
      ['body', 'targetBody', 'sourceBody'].includes(fieldId)
    ) {
      return Boolean(entity?.id) && v6ReopenModelCommandForBody(fieldId, entity.id);
    }
    if (fieldId === 'targetBody') return v6SetFormControl('targetBodyId', entity?.id || '');
    if (fieldId === 'toolBody') return v6SetFormControl('toolBodyId', entity?.id || '');
    if (fieldId === 'body') return v6SetFormControl('bodyId', entity?.id || '');
    if (fieldId === 'sourceBody') return v6SetFormControl('sourceBodyId', entity?.id || '');
    if (fieldId === 'sections') return v6SetFormControl('sectionIds', entities.map((entry) => entry.id).join('\n'));
    if (fieldId === 'directionDatums') {
      return v6SetFormControl('directionDatumId', entities[0]?.id || '') &&
        v6SetFormControl('directionDatumId2', entities[1]?.id || '');
    }
    if (fieldId === 'faces' || fieldId === 'edges') return v6SetTopologyFormSelection(entities);
    const modelSelectionControls = {
      referenceDatum: 'referenceDatumId',
      axisDatum: 'axisDatumId',
      firstDatum: 'firstDatumId',
      secondDatum: 'secondDatumId',
      pointDatum: 'pointDatumId',
      planeDatum: 'planeDatumId',
      fromDatum: 'fromDatumId',
      toDatum: 'toDatumId',
      profileSketch: 'profileSketchId',
      pathSketch: 'pathSketchId',
      guideSketch: 'guideSketchId',
      centerlineSketch: 'centerlineSketchId',
      neutralPlane: 'neutralPlaneDatumId',
    };
    if (modelSelectionControls[fieldId]) return v6SetFormControl(modelSelectionControls[fieldId], entity?.id || '');
    if (fieldId === 'scopeOccurrence') return v6SetFormControl('scopeOccurrenceId', entity?.id || '');
    if (fieldId === 'bodies') return v6SetFormControl('bodyIds', entities.map((entry) => entry.id).join('\n'));
    if (fieldId === 'definition') {
      return v6SetFormControl('definition', entity.kind + ':' + entity.id);
    }
    if (fieldId === 'anchorOccurrence') return v6SetFormControl('anchorOccurrenceId', entity.id);
    if (fieldId === 'movingOccurrence') return v6SetFormControl('movingOccurrenceId', entity.id);
    if (fieldId === 'anchorReference' || fieldId === 'movingReference') {
      const occurrenceField = fieldId === 'anchorReference' ? 'anchorOccurrence' : 'movingOccurrence';
      const occurrenceId = v6AgentCommandDraft.boundSelections[occurrenceField]?.[0]?.id;
      let optionValue = '';
      if (!entity.owner && entity.kind === 'occurrence') optionValue = entity.id + '|';
      else if (!entity.owner && entity.kind === 'datum') optionValue = occurrenceId + '|' + entity.id;
      else {
        const match = v5Dialog.__assemblyReferences?.find((entry) =>
          entry.reference?.ownerId === entity.owner?.id &&
          JSON.stringify(entry.reference?.signature?.p) === JSON.stringify(entity.topologySignature?.p));
        optionValue = match?.id || '';
      }
      return Boolean(optionValue) && v6SetFormControl(fieldId, optionValue);
    }
    if (fieldId === 'occurrence') {
      selectedOccurrenceId = entity.id;
      setV6SemanticSelection([{ kind: 'occurrence', id: entity.id }]);
      v5Dialog.dataset.occurrenceId = entity.id;
      if (v6AgentCommandDraft.commandId !== 'assembly.component-transform') {
        if (v6AgentCommandDraft.commandId.startsWith('assembly.')) {
          const route = v6AssemblyCommandRoute(v6AgentCommandDraft.commandId);
          openAssemblyCommand(route.command, route.mateKind);
        } else {
          openInspectionCommand(v6InspectionCommandRoute(v6AgentCommandDraft.commandId).command);
        }
        for (const [inputFieldId, value] of Object.entries(v6AgentCommandDraft.inputValues)) {
          v6SetVisibleCommandFormInput(inputFieldId, value);
        }
      }
      return true;
    }
    return false;
  }

  function v6CommandIdForEditableFeature(feature) {
    if (!feature) return null;
    if (feature.type === 'extrude') return 'model.extrude';
    if (feature.type === 'cut') return 'model.cut';
    if (feature.type === 'revolve') return feature.profileSketchId ? 'model.revolve-advanced' : 'model.revolve';
    if (feature.type === 'fillet') return Array.isArray(feature.variableRadii) ? 'model.variable-fillet' : 'model.fillet';
    if (feature.type === 'chamfer') return 'model.chamfer';
    if (feature.type === 'shell') return 'model.shell';
    if (feature.type === 'loft') return 'model.loft';
    if (feature.type === 'sweep') return 'model.sweep';
    if (feature.type === 'draft') return 'model.draft';
    if (feature.type === 'thicken') return 'model.thicken';
    if (feature.type === 'transform') {
      const mode = feature.transform?.mode || feature.operation;
      return ['move', 'copy', 'rotate', 'mirror', 'scale', 'align'].includes(mode) ? `model.${mode}` : null;
    }
    return null;
  }

  function openV6AgentCommand(commandId, context, { forceNewBody = false } = {}) {
    const commandDefinition = v6CommandDefinition(commandId);
    const supportedVisibleCommand =
      commandId.startsWith('model.') ||
      commandId.startsWith('assembly.') ||
      commandId.startsWith('inspection.');
    if (commandDefinition?.state !== 'available' || !supportedVisibleCommand) {
      throw new v6InteractionTools.CadUiError('COMMAND_NOT_AVAILABLE', 'The requested visible command is not advertised.');
    }
    if (v6AgentCommandDraft) {
      throw new v6InteractionTools.CadUiError('COMMAND_ALREADY_OPEN', 'Finish or cancel the current visible command before opening another.');
    }
    if (v5Dialog?.open || isWorking(mode.kind)) {
      throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'A human-authored Studio command is already open.');
    }
    if (!v5RuntimeTools.isStudioV5Project(doc)) throw new v6InteractionTools.CadUiError('COMMAND_NOT_AVAILABLE', 'Visible V6 commands require a schema-5 project.');
    showWorkspace(commandId.startsWith('model.') ? 'solid' : 'assembly', false);
    const bodyRef = currentV6Selections().find((entry) => !entry.owner && entry.kind === 'body');
    if (bodyRef) selectedBodyId = bodyRef.id;
    const occurrenceRef = currentV6Selections().find((entry) => !entry.owner && entry.kind === 'occurrence');
    if (occurrenceRef) {
      selectedOccurrenceId = occurrenceRef.id;
      selectedBodyId = lastBodyResults.find((entry) => entry.occurrenceInstance?.occurrencePath?.[0] === occurrenceRef.id)?.bodyId || null;
    }
    const selectedEditableFeature = selectedFeatureId
      ? doc.features.find((entry) =>
          entry.id === selectedFeatureId && v6CommandIdForEditableFeature(entry) === commandId)
      : null;
    const selectedDatum = currentV6Selections().find((entry) => !entry.owner && entry.kind === 'datum');
    const selectedSketch = currentV6Selections().find((entry) => !entry.owner && entry.kind === 'sketch');
    const selectedPattern = currentV6Selections().find((entry) => !entry.owner && entry.kind === 'body-pattern');
    if (V6_BASIC_MODEL_COMMANDS.has(commandId)) {
      if (selectedEditableFeature && !forceNewBody) openEditorFor(selectedEditableFeature);
      else {
        openBasicFeatureCommand(v6ModelCommandRoute(commandId).command, {
          semantic: true,
          selections: currentV6Selections(),
          forceNewBody,
        });
      }
    } else if (commandId.startsWith('model.')) {
      const route = v6ModelCommandRoute(commandId);
      if (route.command === 'plane') openV5Command(route.command, selectedDatum?.id || null);
      else if (route.command === 'profile' || route.command === 'path') {
        openV5Command(route.command, null, null, selectedSketch?.id || null);
      } else if (route.command === 'pattern') {
        openV5Command(route.command, null, null, null, selectedPattern?.id || null);
      } else openV5Command(route.command, null, selectedEditableFeature?.id);
    } else if (commandId.startsWith('assembly.')) {
      const route = v6AssemblyCommandRoute(commandId);
      const selectedMate = route.command === 'mate' && selectedMateId && doc.rootDocument?.kind === 'assembly'
        ? v5RuntimeTools.studioV5RootAssembly(doc).mates.find((entry) =>
            entry.id === selectedMateId && entry.kind === route.mateKind)
        : null;
      openAssemblyCommand(route.command, route.mateKind, selectedMate?.id);
    } else {
      openInspectionCommand(v6InspectionCommandRoute(commandId).command);
    }
    const normalSurfaceOpen = V6_BASIC_MODEL_COMMANDS.has(commandId)
      ? sketch.isOpen() || picker.active() || shellPick.active() || facePick.active()
      : v5Dialog?.open;
    if (!normalSurfaceOpen) throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'Studio could not open the normal ' + commandDefinition.label + ' panel.');
    v6AgentCommandDraft = v6InitialVisibleCommandDraft(commandId);
    v6VisiblePreview = null;
    renderV6CommandPreview();
    emitV6CommandEvent('command.draftChanged', {
      reason: 'opened',
      activeCommand: v6ActiveCommandState(),
    }, context);
    return { activeCommand: v6ActiveCommandState(), panelVisible: true };
  }

  function bindV6CommandSelection(fieldId, entities, context) {
    const field = v6CommandField(fieldId);
    if (!v6AgentCommandDraft || field?.kind !== 'selection') {
      throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', 'No visible command accepts that selection field.');
    }
    if (entities.length < (field.minItems || 0) || entities.length > (field.maxItems || 100)) {
      throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', field.label + ' has invalid selection cardinality.');
    }
    for (const entity of entities) {
      const selectionKind = entity.owner ? entity.topologySignature.kind : entity.kind;
      if (!field.selectionKinds.includes(selectionKind)) {
        throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', field.label + ' does not accept ' + selectionKind + ' selections.');
      }
      if (v6AgentCommandDraft.commandId.startsWith('model.')) {
        const transientOriginDatum = !entity.owner &&
          entity.kind === 'datum' &&
          v6AgentCommandDraft.bootstrapOperations?.some((operation) =>
            operation.kind === 'datum.create' && operation.input?.id === entity.id);
        if (!v6ModelSelectionExists(entity) && !transientOriginDatum) {
          throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', field.label + ' must reference geometry in the active part.');
        }
      }
    }
    invalidateV6CommandPreview();
    v6AgentCommandDraft.boundSelections[fieldId] = deepCopy(entities);
    if (!v6SetVisibleCommandFormSelection(fieldId, entities)) {
      throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', 'Studio could not bind that semantic selection to the normal command field.');
    }
    if (v6AgentCommandDraft.commandId === 'assembly.component-transform' && fieldId === 'occurrence') {
      const assembly = v5RuntimeTools.studioV5RootAssembly(doc);
      const occurrence = assembly.occurrences.find((entry) => entry.id === entities[0]?.id);
      if (!occurrence) throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', 'The selected occurrence is not in the active assembly.');
      v6AgentCommandDraft.inputValues.transform = deepCopy(occurrence.baseTransform);
      const matrixInput = v5Fields?.querySelector('[name="matrix"]');
      if (matrixInput) matrixInput.value = occurrence.baseTransform.join(', ');
      beginAssemblyTransformPreview(occurrence);
    }
    if (v6AgentCommandDraft.commandId === 'inspection.material') {
      const materialId = v6AgentCommandDraft.boundSelections.material?.[0]?.id || v6FormText('materialId');
      const material = v5Dialog.__candidate?.materials?.find((entry) => entry.id === materialId);
      v6AgentCommandDraft.materialContext = {
        partId: v5Dialog.dataset.partId || '',
        bodyId: v5Dialog.dataset.sourceBodyId || '',
        ...(v5Dialog.dataset.occurrenceId ? { occurrenceId: v5Dialog.dataset.occurrenceId } : {}),
        ...(material?.appearanceId ? { appearanceId: material.appearanceId } : {}),
      };
    }
    v6AgentCommandDraft.baseRevision = commandRevision;
    v6AgentCommandDraft.state = 'draft';
    v6AgentCommandDraft.diagnostics = [];
    renderV6CommandPreview();
    emitV6CommandEvent('command.draftChanged', {
      reason: 'selection-bound',
      fieldId,
      activeCommand: v6ActiveCommandState(),
    }, context);
    return { fieldId, entities: deepCopy(v6AgentCommandDraft.boundSelections[fieldId]) };
  }

  function setV6CommandInput(fieldId, value, context) {
    const field = v6CommandField(fieldId);
    if (!v6AgentCommandDraft || !field || field.kind === 'selection') {
      throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', 'No visible command accepts that input field.');
    }
    const validValue =
      (field.kind === 'boolean' && typeof value === 'boolean') ||
      (field.kind === 'enum' && typeof value === 'string' && field.values.includes(value)) ||
      (field.kind === 'text' && typeof value === 'string') ||
      (field.kind === 'number-or-expression' && (
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.trim().length > 0)
      )) ||
      (field.kind === 'vector3' && Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) ||
      (field.kind === 'matrix4' && Array.isArray(value) && value.length === 16 && value.every(Number.isFinite)) ||
      ((field.kind === 'list' || field.kind === 'points') && Array.isArray(value));
    if (!validValue) {
      throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', field.label + ' does not accept that typed value.');
    }
    invalidateV6CommandPreview();
    if (!v6SetVisibleCommandFormInput(fieldId, value)) {
      throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', 'Studio could not write that typed value to the normal command field.');
    }
    v6AgentCommandDraft.inputValues[fieldId] = deepCopy(value);
    v6AgentCommandDraft.state = 'draft';
    v6AgentCommandDraft.diagnostics = [];
    if (v6AgentCommandDraft.commandId === 'assembly.component-transform' && fieldId === 'transform') {
      setV6TransformPreviewMatrix(value);
    }
    renderV6CommandPreview();
    emitV6CommandEvent('command.draftChanged', {
      reason: 'input-set',
      fieldId,
      activeCommand: v6ActiveCommandState(),
    }, context);
    return { fieldId, value: deepCopy(value) };
  }

  function clearV6CommandInput(fieldId, context) {
    const field = v6CommandField(fieldId);
    if (!v6AgentCommandDraft || !field || field.kind === 'selection') {
      throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', 'No visible command accepts that input field.');
    }
    invalidateV6CommandPreview();
    delete v6AgentCommandDraft.inputValues[fieldId];
    v6SetVisibleCommandFormInput(fieldId, field.kind === 'boolean' ? false : field.kind === 'list' ? [] : '');
    const required = field.required === true;
    v6AgentCommandDraft.state = required ? 'blocked' : 'draft';
    v6AgentCommandDraft.diagnostics = required ? [{
      code: 'COMMAND_FIELD_REQUIRED',
      severity: 'error',
      message: field.label + ' is required.',
      fieldId,
    }] : [];
    v5Error.textContent = required ? field.label + ' is required before preview.' : '';
    renderV6CommandPreview();
    emitV6CommandEvent('command.draftChanged', {
      reason: 'input-cleared',
      fieldId,
      activeCommand: v6ActiveCommandState(),
    }, context);
    return { fieldId, cleared: true };
  }

  async function previewV6AgentCommand(context) {
    if (!v6AgentCommandDraft) throw new v6InteractionTools.CadUiError('COMMAND_NOT_OPEN', 'Open an advertised command before requesting preview.');
    if (v6AgentCommandDraft.baseRevision !== commandRevision) {
      throw new v6InteractionTools.CadUiError('REVISION_CONFLICT', 'The project changed after this command draft opened.', {
        expectedRevision: v6AgentCommandDraft.baseRevision,
        actualRevision: commandRevision,
        repairOptions: [{ kind: 'refresh-command-draft' }],
      });
    }
    if (v6VisiblePreview) cancelV6PreviewRecord();
    v6AgentCommandDraft.state = 'validating';
    v6AgentCommandDraft.diagnostics = [];
    v5Error.textContent = '';
    renderV6CommandPreview();
    emitV6CommandEvent('preview.started', {
      commandId: v6AgentCommandDraft.commandId,
      draftId: v6AgentCommandDraft.draftId,
      baseRevision: commandRevision,
    }, context);
    try {
      const built = v6InteractionTools.buildCadUiCommandTransaction({
        draft: v6AgentCommandDraft,
        expectedRevision: commandRevision,
        transactionId: v6AgentCommandDraft.transactionId,
      });
      const draftFingerprint = v6CanonicalKey({
        draftId: v6AgentCommandDraft.draftId,
        baseRevision: v6AgentCommandDraft.baseRevision,
        inputValues: v6AgentCommandDraft.inputValues,
        boundSelections: v6AgentCommandDraft.boundSelections,
        generatedIds: v6AgentCommandDraft.generatedIds,
        editEntity: v6AgentCommandDraft.editEntity,
        bootstrapOperations: v6AgentCommandDraft.bootstrapOperations,
        materialContext: v6AgentCommandDraft.materialContext,
      });
      const service = await ensureLiveAgentService();
      const preview = await service.preview(built.transaction, activeAgentConnection.permissionContext);
      const currentDraftFingerprint = v6AgentCommandDraft
        ? v6CanonicalKey({
            draftId: v6AgentCommandDraft.draftId,
            baseRevision: v6AgentCommandDraft.baseRevision,
            inputValues: v6AgentCommandDraft.inputValues,
            boundSelections: v6AgentCommandDraft.boundSelections,
            generatedIds: v6AgentCommandDraft.generatedIds,
            editEntity: v6AgentCommandDraft.editEntity,
            bootstrapOperations: v6AgentCommandDraft.bootstrapOperations,
            materialContext: v6AgentCommandDraft.materialContext,
          })
        : null;
      if (currentDraftFingerprint !== draftFingerprint || commandRevision !== preview.baseRevision) {
        service.cancelPreview(preview.previewId);
        throw new v6InteractionTools.CadUiError('UI_REVISION_CONFLICT', 'The visible command draft changed during exact preview.', {
          repairOptions: [{ kind: 'refresh-command-draft' }, { kind: 'preview-again' }],
        });
      }
      const visibleCandidate = agentTools.applyCadTransaction(doc, built.transaction);
      if (visibleCandidate.changeSet.documentHashAfter !== preview.changeSet.documentHashAfter) {
        cancelV6PreviewServiceRecord(preview.previewId);
        throw new v6InteractionTools.CadUiError('PREVIEW_PARITY_FAILED', 'Visible-command and direct transaction hashes do not match.');
      }
      activeAgentConnection.previews.set(preview.previewId, {
        label: built.transaction.label,
        changeSet: deepCopy(preview.changeSet),
      });
      v6AgentCommandDraft.state = 'preview';
      v6AgentCommandDraft.previewId = preview.previewId;
      v6VisiblePreview = {
        ...deepCopy(preview),
        visible: true,
        transactionHash: built.transactionHash,
        transaction: deepCopy(built.transaction),
        highlightedEntities: Object.values(v6AgentCommandDraft.boundSelections)
          .flat()
          .map((entry) => deepCopy(entry.owner || entry))
          .map((entry) => {
            if (v6AgentCommandDraft.commandId !== 'inspection.material' || entry.kind !== 'body') return entry;
            const runtimeBody = lastBodyResults.find((result) =>
              result.sourceBodyId === entry.id || result.bodyId === entry.id);
            return runtimeBody ? { kind: 'body', id: runtimeBody.bodyId } : entry;
          })
          .filter((entry, index, values) =>
            values.findIndex((candidate) => candidate.kind === entry.kind && candidate.id === entry.id) === index),
      };
      if (v6AgentCommandDraft.commandId === 'assembly.component-transform') {
        setV6TransformPreviewMatrix(v6AgentCommandDraft.inputValues.transform);
      } else {
        setV6SemanticSelection(v6VisiblePreview.highlightedEntities.filter((entry) => v6EntityExists(entry)));
        requestSceneRender();
      }
      renderV6CommandPreview();
      emitV6CommandEvent('preview.ready', {
        previewId: preview.previewId,
        baseRevision: preview.baseRevision,
        transactionHash: built.transactionHash,
        documentHashAfter: preview.changeSet.documentHashAfter,
        validation: preview.validation,
        highlightedEntities: deepCopy(v6VisiblePreview.highlightedEntities),
      }, context);
      return {
        ...deepCopy(preview),
        transactionHash: built.transactionHash,
        visible: true,
        directVisibleHashParity: true,
      };
    } catch (error) {
      if (v6AgentCommandDraft) {
        v6AgentCommandDraft.state = 'blocked';
        v6AgentCommandDraft.diagnostics = [{
          code: error?.code || 'PREVIEW_REJECTED',
          severity: 'error',
          message: String(error?.message || error),
        }];
        v5Error.textContent = String(error?.message || error);
      }
      renderV6CommandPreview();
      emitV6CommandEvent('preview.rejected', {
        code: error?.code || 'PREVIEW_REJECTED',
        message: String(error?.message || error),
      }, context);
      throw error;
    }
  }

  function presentV6Preview(previewId) {
    if (!v6VisiblePreview || v6VisiblePreview.previewId !== previewId) {
      throw new v6InteractionTools.CadUiError('PREVIEW_EXPIRED', 'The requested visible preview is not active.');
    }
    v6VisiblePreview.visible = true;
    v6AgentCommandDraft.state = 'preview';
    if (v6AgentCommandDraft.commandId === 'assembly.component-transform') {
      setV6TransformPreviewMatrix(v6AgentCommandDraft.inputValues.transform);
    }
    renderV6CommandPreview();
    return { previewId, visible: true };
  }

  function dismissV6Preview() {
    if (!v6VisiblePreview) return { previewId: null, visible: false };
    const previewId = v6VisiblePreview.previewId;
    v6VisiblePreview.visible = false;
    if (v6AgentCommandDraft?.commandId === 'assembly.component-transform') endTransformPreview(true);
    renderV6CommandPreview();
    return { previewId, visible: false };
  }

  function v6TransactionHighlightedEntities(transaction) {
    const candidates = [];
    const fieldKinds = [
      ['bodyId', 'body'],
      ['targetBodyId', 'body'],
      ['toolBodyId', 'body'],
      ['featureId', 'feature'],
      ['occurrenceId', 'occurrence'],
      ['mateId', 'mate'],
      ['measurementId', 'measurement'],
      ['parameterId', 'parameter'],
      ['sectionId', 'section'],
      ['explodedViewId', 'exploded-view'],
      ['groupId', 'stage-group'],
      ['patternId', 'body-pattern'],
      ['targetBodyId', 'body'],
      ['toolBodyId', 'body'],
    ];
    for (const operation of transaction?.operations || []) {
      for (const [field, kind] of fieldKinds) {
        const id = operation.input?.[field];
        if (typeof id === 'string') candidates.push({ kind, id });
      }
    }
    return candidates.filter((entry, index, values) =>
      v6EntityExists(entry) &&
      values.findIndex((candidate) => candidate.kind === entry.kind && candidate.id === entry.id) === index);
  }

  function v6TransactionOperationLabel(operation) {
    const input = operation?.input || {};
    const part = v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'part'
      ? v5RuntimeTools.studioV5RootPart(doc)
      : null;
    const body = typeof input.bodyId === 'string' && v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'part'
      ? part?.bodies.find((entry) => entry.id === input.bodyId)
      : null;
    const assembly = v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly'
      ? v5RuntimeTools.studioV5RootAssembly(doc)
      : null;
    const occurrence = typeof input.occurrenceId === 'string'
      ? assembly?.occurrences.find((entry) => entry.id === input.occurrenceId)
      : null;
    const mate = typeof input.mateId === 'string'
      ? assembly?.mates.find((entry) => entry.id === input.mateId)
      : null;
    const feature = typeof input.featureId === 'string'
      ? doc.features.find((entry) => entry.id === input.featureId)
      : null;
    const beforeFeature = typeof input.beforeFeatureId === 'string'
      ? doc.features.find((entry) => entry.id === input.beforeFeatureId)
      : null;
    const section = typeof input.sectionId === 'string'
      ? assembly?.sectionViews.find((entry) => entry.id === input.sectionId)
      : null;
    const explodedView = typeof input.explodedViewId === 'string'
      ? assembly?.explodedViews.find((entry) => entry.id === input.explodedViewId)
      : null;
    const stageGroup = typeof input.groupId === 'string' && assembly
      ? v5InspectionTools.studioV5AxialStageGroups(doc).find((entry) => entry.id === input.groupId)
      : null;
    const measurement = typeof input.measurementId === 'string' && assembly
      ? v5InspectionTools.studioV5Measurements(doc).find((entry) => entry.id === input.measurementId)
      : null;
    const pattern = typeof input.patternId === 'string'
      ? (part?.bodyPatterns || []).find((entry) => entry.id === input.patternId)
      : null;
    const targetBody = typeof input.targetBodyId === 'string'
      ? part?.bodies.find((entry) => entry.id === input.targetBodyId)
      : null;
    const toolBody = typeof input.toolBodyId === 'string'
      ? part?.bodies.find((entry) => entry.id === input.toolBodyId)
      : null;
    const parameter = typeof input.parameterId === 'string'
      ? (doc.params || []).find((entry) => entry.id === input.parameterId)
      : typeof input.parameterName === 'string'
        ? (doc.params || []).find((entry) => entry.name === input.parameterName)
        : null;
    const bodyName = body?.name || input.bodyId || 'body';
    const occurrenceName = occurrence?.name || input.occurrenceId || 'component';
    const mateName = mate?.name || input.mateId || 'mate';
    const featureName = feature?.name || input.featureId || 'feature';
    const sectionName = section?.name || input.sectionId || 'section view';
    const explodedViewName = explodedView?.name || input.explodedViewId || 'exploded view';
    const stageGroupName = stageGroup?.name || input.groupId || 'stage group';
    const measurementName = measurement?.name || input.measurementId || 'measurement';
    const patternName = pattern?.name || input.patternId || 'body pattern';
    const targetBodyName = targetBody?.name || input.targetBodyId || 'target body';
    const toolBodyName = toolBody?.name || input.toolBodyId || 'tool body';
    const parameterName = parameter?.name || input.parameterName || input.name || 'parameter';
    if (operation.kind === 'parameter.create') return `Create parameter ${input.name} = ${input.value}`;
    if (operation.kind === 'project.clear') return 'Clear all editable project structure';
    if (operation.kind === 'parameter.update' && input.name != null && input.value != null) {
      return `Rename ${parameterName} to ${input.name} and set it to ${input.value}`;
    }
    if (operation.kind === 'parameter.update' && input.name != null) return `Rename ${parameterName} to ${input.name}`;
    if (operation.kind === 'parameter.update' && input.value != null) return `Set ${parameterName} = ${input.value}`;
    if (operation.kind === 'parameter.delete') return `Delete parameter ${parameterName}`;
    if (operation.kind === 'feature.reorder') {
      return input.beforeFeatureId
        ? `Move ${featureName} before ${beforeFeature?.name || input.beforeFeatureId}`
        : `Move ${featureName} to the end of history`;
    }
    if (operation.kind === 'feature.rollback') return input.featureId ? `Roll back after ${featureName}` : 'Clear rollback marker';
    if (operation.kind === 'feature.delete') return `Delete ${featureName} and dependent structure`;
    if (operation.kind === 'section.activate') return input.sectionId ? `Activate ${sectionName}` : 'Turn off the active section view';
    if (operation.kind === 'section.delete') return `Delete ${sectionName}`;
    if (operation.kind === 'exploded.activate') return input.explodedViewId ? `Activate ${explodedViewName}` : 'Turn off the active exploded view';
    if (operation.kind === 'exploded.delete') return `Delete ${explodedViewName}`;
    if (operation.kind === 'stage.update' && typeof input.patch?.visible === 'boolean') {
      return `${input.patch.visible ? 'Show' : 'Hide'} ${stageGroupName}`;
    }
    if (operation.kind === 'stage.update' && input.patch?.spacing != null) {
      return `Set ${stageGroupName} spacing to ${input.patch.spacing} mm`;
    }
    if (operation.kind === 'measurement.delete') return `Delete ${measurementName}`;
    if (
      operation.kind === 'pattern.update' &&
      typeof input.patch?.visible === 'boolean' &&
      Array.isArray(input.patch?.skippedIndices)
    ) {
      const indices = input.patch.skippedIndices.join(', ') || 'none';
      return `${input.patch.visible ? 'Show' : 'Hide'} ${patternName} and set skipped occurrences to ${indices}`;
    }
    if (operation.kind === 'pattern.update' && typeof input.patch?.visible === 'boolean') {
      return `${input.patch.visible ? 'Show' : 'Hide'} ${patternName}`;
    }
    if (operation.kind === 'pattern.update' && Array.isArray(input.patch?.skippedIndices)) {
      return `Set ${patternName} skipped occurrences to ${input.patch.skippedIndices.join(', ') || 'none'}`;
    }
    if (operation.kind === 'pattern.update') return `Update ${patternName}`;
    if (operation.kind === 'pattern.delete') return `Delete ${patternName}`;
    if (operation.kind === 'pattern.materialize') {
      return input.dissolve
        ? `Dissolve ${patternName} into ${input.records?.length || 0} independent exact bodies`
        : `Make ${patternName} occurrence ${input.records?.[0]?.patternIndex || ''} independent`;
    }
    if (operation.kind === 'boolean.subtract') return `Subtract ${toolBodyName} from ${targetBodyName}`;
    if (operation.kind === 'boolean.intersect') return `Intersect ${toolBodyName} with ${targetBodyName}`;
    if (operation.kind === 'boolean.union') return `Union ${toolBodyName} with ${targetBodyName}`;
    if (operation.kind === 'feature.update' && input.patch?.pattern) {
      const nextPattern = input.patch.pattern;
      const first = nextPattern.kind === 'circular'
        ? `centre ${nextPattern.cx}, ${nextPattern.cy}`
        : `spacing ${nextPattern.dx}, ${nextPattern.dy}`;
      return `Set ${featureName} pattern to ${nextPattern.n} occurrences · ${first}`;
    }
    if (operation.kind === 'body.rename') return `Rename ${bodyName} to ${input.name}`;
    if (operation.kind === 'body.activate') return `Make ${bodyName} the active body`;
    if (operation.kind === 'body.setVisibility') return `${input.visible ? 'Show' : 'Hide'} ${bodyName}`;
    if (operation.kind === 'body.suppress') return `${input.suppressed ? 'Suppress' : 'Restore'} ${bodyName}`;
    if (operation.kind === 'body.delete') return `Delete ${bodyName} and dependent structure`;
    if (operation.kind === 'component.update' && typeof input.patch?.visible === 'boolean') {
      return `${input.patch.visible ? 'Show' : 'Hide'} ${occurrenceName}`;
    }
    if (operation.kind === 'component.update' && typeof input.patch?.suppressed === 'boolean') {
      return `${input.patch.suppressed ? 'Suppress' : 'Restore'} ${occurrenceName}`;
    }
    if (operation.kind === 'component.delete') return `Delete ${occurrenceName} and dependent assembly structure`;
    if (operation.kind === 'mate.update' && typeof input.patch?.suppressed === 'boolean') {
      return `${input.patch.suppressed ? 'Suppress' : 'Restore'} ${mateName}`;
    }
    if (operation.kind === 'mate.delete') return `Delete ${mateName}`;
    return operation.kind;
  }

  async function presentV6DirectTransactionPreview(preview, transaction, options = {}) {
    if (!v5Dialog || !v5Fields) return false;
    if (v6AgentCommandDraft && v6AgentCommandDraft.commandId !== 'document.transaction') return false;
    if (v6AgentCommandDraft?.commandId === 'document.transaction') {
      clearV6AgentCommandState({ cancelPreview: true });
    }
    const transactionHash = 'fnv1a32:' + v6StableHash(transaction);
    const label = String(transaction?.label || 'Agent CAD transaction');
    const highlightedEntities = v6TransactionHighlightedEntities(transaction);
    for (const key of ['datumId', 'featureId', 'sketchId', 'patternId', 'occurrenceId', 'mateKind', 'mateId', 'bodyId']) {
      delete v5Dialog.dataset[key];
    }
    v5Dialog.dataset.command = 'document-transaction';
    $('bw-v5-command-kind').textContent = 'Agent transaction';
    $('bw-v5-command-title').textContent = label;
    v5Fields.replaceChildren();
    const description = document.createElement('p');
    description.className = 'is-wide';
    description.textContent = 'Review the exact validated document operations below. The editable project remains unchanged until Apply.';
    const operations = document.createElement('ol');
    operations.className = 'is-wide';
    for (const operation of transaction?.operations || []) {
      const item = document.createElement('li');
      item.dataset.operationKind = operation.kind;
      item.textContent = v6TransactionOperationLabel(operation);
      operations.appendChild(item);
    }
    v5Fields.append(description, operations);
    if (v5Error) v5Error.textContent = '';
    v6AgentCommandDraft = {
      commandId: 'document.transaction',
      draftId: `direct-preview-${preview.previewId}`,
      transactionId: transaction.transactionId,
      baseRevision: preview.baseRevision,
      state: 'preview',
      inputValues: {},
      boundSelections: {},
      generatedIds: {},
      diagnostics: [],
      previewId: preview.previewId,
    };
    v6VisiblePreview = {
      ...deepCopy(preview),
      visible: true,
      transactionHash,
      transaction: deepCopy(transaction),
      highlightedEntities,
    };
    v6DirectParameterPreviewOperations = deepCopy(
      (transaction?.operations || []).filter((operation) => operation.kind.startsWith('parameter.')),
    );
    if (v6DirectParameterPreviewOperations.length) renderParams();
    if (highlightedEntities.length) {
      setV6SemanticSelection(highlightedEntities);
      const renameOperation = transaction?.operations?.find((operation) => operation.kind === 'body.rename');
      const bodyNameInput = renameOperation?.input?.bodyId === selectedBodyId
        ? $('bw-context')?.querySelector('[data-body-name]')
        : null;
      if (bodyNameInput) {
        bodyNameInput.value = String(renameOperation.input.name);
        bodyNameInput.dataset.agentDraft = 'true';
      }
    }
    if (!v5Dialog.open) {
      if (typeof v5Dialog.showModal === 'function') v5Dialog.showModal();
      else v5Dialog.setAttribute('open', '');
    }
    renderV6CommandPreview();
    requestSceneRender();
    const runtime = getV6InteractionRuntime();
    if (options.emit !== false) {
      runtime.hostChanged('preview.ready', {
        previewId: preview.previewId,
        baseRevision: preview.baseRevision,
        transactionHash,
        documentHashAfter: preview.changeSet?.documentHashAfter,
        validation: preview.validation,
        highlightedEntities: deepCopy(highlightedEntities),
        source: options.source || 'cad_preview',
      }, { actor: 'agent' });
    }
    if (options.settle !== false) {
      await waitForV6UiSettlement(null, { targetUiRevision: runtime.uiRevision });
    }
    return true;
  }

  function clearV6AgentCommandState({ cancelPreview = true } = {}) {
    const resetDirectTransactionSurface = v6AgentCommandDraft?.commandId === 'document.transaction';
    if (cancelPreview) cancelV6PreviewRecord();
    else v6VisiblePreview = null;
    v6AgentCommandDraft = null;
    v6DirectParameterPreviewOperations = [];
    endTransformPreview(true);
    if (resetDirectTransactionSurface) {
      renderContext();
      renderParams();
    }
    renderV6CommandPreview();
  }

  function closeActiveV6CommandSurface() {
    if (sketch.isOpen()) sketch.cancel();
    else if (picker.active()) picker.cancel();
    else if (shellPick.active()) shellPick.cancel();
    else if (facePick.active()) facePick.cancel();
    else closeV5Command();
  }

  async function commitV6VisiblePreviewFromHuman() {
    if (!v6AgentCommandDraft) return false;
    if (!v6VisiblePreview?.visible || !v6AgentCommandDraft.previewId) {
      const message = 'Run the exact preview before applying this agent-visible command.';
      if (v5Error) v5Error.textContent = message;
      say(message);
      return false;
    }
    const committedPreviewId = v6AgentCommandDraft.previewId;
    const transactionHash = v6VisiblePreview.transactionHash;
    try {
      const service = await ensureLiveAgentService();
      const result = await service.commit(
        committedPreviewId,
        v6AgentCommandDraft.baseRevision,
        activeAgentConnection.permissionContext,
        { actor: 'agent' },
      );
      activeAgentConnection.previews.clear();
      v6ClosingCommand = true;
      try {
        clearV6AgentCommandState({ cancelPreview: false });
        closeActiveV6CommandSurface();
      } finally {
        v6ClosingCommand = false;
      }
      const runtime = getV6InteractionRuntime();
      runtime.hostChanged('commit.applied', {
        previewId: committedPreviewId,
        revision: result.revision,
        transactionHash,
        changeSet: result.changeSet,
        historyEntry: result.historyEntry,
        approvedBy: 'human',
      }, { actor: 'human' });
      runtime.emit('history.changed', {
        revision: result.revision,
        historyEntry: result.historyEntry,
      }, { actor: 'human', uiRevision: runtime.uiRevision });
      const request = draftDecision?.open ? takeQueuedOperation() : null;
      if (request) runOperation(request.fn);
      return true;
    } catch (error) {
      const message = String(error?.message || error);
      if (v5Error) v5Error.textContent = message;
      say(message);
      return false;
    }
  }

  async function commitV6VisiblePreviewFromAgent(context = {}) {
    if (!v6AgentCommandDraft || !v6VisiblePreview?.visible || !v6AgentCommandDraft.previewId) {
      throw new v6InteractionTools.CadUiError('PREVIEW_REQUIRED', 'Run the exact visible preview before committing this command.');
    }
    if (v6AgentCommandDraft.baseRevision !== commandRevision) {
      throw new v6InteractionTools.CadUiError('REVISION_CONFLICT', 'The visible preview targets an older project revision.', {
        expectedRevision: v6AgentCommandDraft.baseRevision,
        actualRevision: commandRevision,
      });
    }
    const previewId = v6AgentCommandDraft.previewId;
    if (activeAgentConnection.mode === 'preview-required') {
      const approved = await requestAgentCommitApproval(previewId);
      if (!approved) {
        throw new v6InteractionTools.CadUiError('USER_REJECTED_PREVIEW', 'The user rejected this CAD preview.');
      }
    }
    const service = await ensureLiveAgentService();
    const transactionHash = v6VisiblePreview.transactionHash;
    const result = await service.commit(
      previewId,
      v6AgentCommandDraft.baseRevision,
      activeAgentConnection.permissionContext,
      { actor: 'agent' },
    );
    activeAgentConnection.previews.clear();
    v6ClosingCommand = true;
    try {
      clearV6AgentCommandState({ cancelPreview: false });
      closeActiveV6CommandSurface();
    } finally {
      v6ClosingCommand = false;
    }
    const request = draftDecision?.open ? takeQueuedOperation() : null;
    if (request) runOperation(request.fn);
    emitV6CommandEvent('commit.applied', {
      previewId,
      revision: result.revision,
      transactionHash,
      changeSet: result.changeSet,
      historyEntry: result.historyEntry,
      approvedBy: activeAgentConnection.mode === 'preview-required' ? 'human' : 'agent-policy',
    }, context);
    emitV6CommandEvent('history.changed', {
      revision: result.revision,
      historyEntry: result.historyEntry,
    }, context);
    return {
      revision: result.revision,
      projectId: result.projectId,
      changeSet: deepCopy(result.changeSet),
      historyEntry: deepCopy(result.historyEntry),
      transactionHash,
    };
  }

  function cancelV6DraftFromHumanSurface() {
    if (!v6AgentCommandDraft || v6ClosingCommand) return;
    const draftId = v6AgentCommandDraft.draftId;
    clearV6AgentCommandState({ cancelPreview: true });
    if (v6InteractionRuntime && !v6ApplyingSemanticAction) {
      v6InteractionRuntime.hostChanged('command.draftChanged', {
        reason: 'cancelled-by-human',
        draftId,
        activeCommand: null,
      }, { actor: 'human' });
    }
  }

  function setV6BodyExportSelection(bodyIds, selected) {
    for (const bodyId of bodyIds) {
      if (selected) exportBodyIds.add(bodyId);
      else exportBodyIds.delete(bodyId);
    }
    renderBodies();
    renderBodyPatterns();
    renderAssemblyTree();
    return {
      selected,
      bodyIds: [...bodyIds].sort(),
      exportBodyIds: [...exportBodyIds].sort(),
    };
  }

  function toggleV6BodyExportSelection(bodyId) {
    return setV6BodyExportSelection([bodyId], !exportBodyIds.has(bodyId));
  }

  function toggleV6OccurrenceExportSelection(occurrenceId) {
    const bodyIds = lastBodyResults
      .filter((entry) =>
        entry.occurrenceInstance?.occurrenceId === occurrenceId ||
        entry.occurrenceInstance?.occurrencePath?.[0] === occurrenceId)
      .map((entry) => entry.bodyId);
    if (!bodyIds.length) {
      throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'That occurrence has no exact bodies available for export.');
    }
    return setV6BodyExportSelection(bodyIds, !bodyIds.every((bodyId) => exportBodyIds.has(bodyId)));
  }

  function isolateV6Body(bodyId) {
    isolatedBodyId = isolatedBodyId === bodyId ? null : bodyId;
    renderBodies();
    renderContext();
    requestSceneRender();
    return { isolatedBodyId };
  }

  function isolateV6Occurrence(occurrenceId) {
    if (appEl.dataset.isolateOccurrence === occurrenceId) delete appEl.dataset.isolateOccurrence;
    else appEl.dataset.isolateOccurrence = occurrenceId;
    syncBodyMeshState();
    renderAssemblyTree();
    renderContext();
    requestSceneRender();
    return { isolatedOccurrenceId: appEl.dataset.isolateOccurrence || null };
  }

  async function previewV6PatternMaterialization(entity, operation) {
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'part') {
      throw new v6InteractionTools.CadUiError('COMMAND_NOT_AVAILABLE', 'Pattern materialization requires an active part document.');
    }
    if (v6AgentCommandDraft) {
      throw new v6InteractionTools.CadUiError('COMMAND_ALREADY_OPEN', 'Finish or cancel the current visible command before materializing a pattern.');
    }
    const part = v5RuntimeTools.studioV5RootPart(doc);
    let pattern;
    let bodyIds;
    let dissolve = false;
    if (operation === 'pattern-instance.independent') {
      const result = lastBodyResults.find((entry) => entry.bodyId === entity.id);
      const patternId = result?.patternInstance?.patternId;
      pattern = (part.bodyPatterns || []).find((entry) => entry.id === patternId);
      bodyIds = pattern && result && !result.patternInstance?.fused ? [result.bodyId] : [];
    } else if (operation === 'pattern.dissolve') {
      pattern = (part.bodyPatterns || []).find((entry) => entry.id === entity.id);
      dissolve = true;
      bodyIds = pattern
        ? lastBodyResults
            .filter((entry) =>
              entry.patternInstance?.patternId === pattern.id &&
              !entry.patternInstance?.fused &&
              entry.visible !== false)
            .map((entry) => entry.bodyId)
        : [];
    }
    if (!pattern) throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'That editable body pattern is not present.');
    if (pattern.outputMode === 'union') {
      throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'Switch this pattern to Linked occurrences before materializing it.');
    }
    if (!bodyIds.length) {
      throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'This pattern has no active linked occurrences to materialize.');
    }
    const sourceRevision = documentRevision;
    const sourceHash = v5RuntimeTools.studioV5CanonicalHash(doc);
    const freezePrefix = 'materialized-' + newId();
    const response = await kernelCall('freeze-pattern-v5', documentRevision, { bodyIds, freezePrefix });
    if (documentRevision !== sourceRevision || v5RuntimeTools.studioV5CanonicalHash(doc) !== sourceHash) {
      throw new v6InteractionTools.CadUiError('REVISION_CONFLICT', 'The project changed while exact pattern bodies were being materialized.');
    }
    if (response.errors?.length || !response.records?.length) {
      throw new v6InteractionTools.CadUiError('KERNEL_VALIDATION_FAILED', response.errors?.[0]?.message || 'The exact kernel did not return materialized occurrence records.');
    }
    const label = dissolve
      ? 'Dissolve ' + pattern.name
      : 'Make ' + pattern.name + ' occurrence ' + response.records[0].patternIndex + ' independent';
    const transaction = {
      transactionId: 'visible-pattern-materialize-' + newId(),
      label,
      expectedRevision: commandRevision,
      operations: [{
        kind: 'pattern.materialize',
        input: {
          patternId: pattern.id,
          records: deepCopy(response.records),
          dissolve,
        },
      }],
      atomic: true,
      metadata: { actor: 'agent' },
    };
    const service = await ensureLiveAgentService();
    const preview = await service.preview(
      transaction,
      activeAgentConnection.permissionContext,
      { trustedGenerated: true },
    );
    activeAgentConnection.previews.set(preview.previewId, {
      label,
      changeSet: deepCopy(preview.changeSet),
    });
    try {
      const visible = await presentV6DirectTransactionPreview(preview, transaction, {
        emit: false,
        settle: false,
        source: 'tree.invoke',
      });
      if (!visible) throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'Studio could not present the exact pattern materialization preview.');
    } catch (error) {
      cancelV6PreviewServiceRecord(preview.previewId);
      throw error;
    }
    getV6InteractionRuntime().emit('kernel.completed', {
      queryKind: 'pattern.materialization',
      exactGeometry: true,
      bodyIds,
      patternId: pattern.id,
    }, { actor: 'agent', uiRevision: getV6InteractionRuntime().uiRevision });
    return {
      operation,
      preview: {
        ...deepCopy(preview),
        visible: true,
        transactionHash: v6VisiblePreview?.transactionHash || null,
      },
      materializedBodyIds: response.records.map((record) => record.body.id),
      patternId: pattern.id,
      bodyIds,
      dissolve,
    };
  }

  async function runV6VisibleInspection(inspectionId) {
    const inspectionMode = inspectionId === 'properties' ? 'mass-health' : inspectionId;
    const result = await executeV5Inspection(inspectionMode);
    v6PanelOpen.set('inspector', true);
    v6PanelOpen.set('diagnostics', false);
    sideEl?.classList.remove('m-open-history', 'm-open-project');
    sideEl?.classList.add('m-open-params');
    syncMtabs?.();
    syncV6PanelVisibility();
    renderContext();
    return {
      inspectionId,
      exactGeometry: true,
      result: deepCopy(result),
    };
  }

  function invokeV6SketchShapeAction(action, context) {
    if (!v6AgentCommandDraft || !sketch.isOpen() || !Array.isArray(v6AgentCommandDraft.inputValues?.sketch)) {
      throw new v6InteractionTools.CadUiError('COMMAND_NOT_OPEN', 'A normal sketch command must be open before editing one of its shapes.');
    }
    const shapes = deepCopy(v6AgentCommandDraft.inputValues.sketch);
    const shape = shapes[action.shapeIndex];
    if (!shape) {
      throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'The requested sketch shape is not present in the active draft.', {
        shapeIndex: action.shapeIndex,
        repairOptions: [{ kind: 'refresh-ui-state' }],
      });
    }
    if (action.kind === 'sketch.shape.select') {
      if (!sketch.setSemanticShapeSelection(action.shapeIndex)) {
        throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'Studio could not select the requested sketch shape.');
      }
      return { shapeIndex: action.shapeIndex, shape: deepCopy(shape) };
    }
    if (action.kind === 'sketch.shape.delete') {
      shapes.splice(action.shapeIndex, 1);
      setV6CommandInput('sketch', shapes, context);
      if (shapes.length) sketch.setSemanticShapeSelection(Math.min(action.shapeIndex, shapes.length - 1));
      return {
        shapeIndex: action.shapeIndex,
        deleted: true,
        selectedShapeIndex: sketch.selectedShapeIndex(),
        shapeCount: shapes.length,
      };
    }
    const propertyKinds = {
      w: ['rect'],
      h: ['rect'],
      x: ['rect', 'circle'],
      y: ['rect', 'circle'],
      d: ['circle'],
    };
    if (!propertyKinds[action.property]?.includes(shape.kind)) {
      throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', `Sketch ${shape.kind} shapes do not expose ${action.property}.`);
    }
    try {
      const evaluated = N(action.value);
      if (['w', 'h', 'd'].includes(action.property) && evaluated < 0.1) throw new Error('dimension is too small');
    } catch (error) {
      throw new v6InteractionTools.CadUiError('COMMAND_FIELD_INVALID', 'Sketch shape dimension is not a usable finite value.', {
        property: action.property,
        cause: String(error?.message || error),
      });
    }
    if (action.property === 'd') {
      shape.r = typeof action.value === 'number' ? action.value / 2 : `(${action.value})/2`;
    } else {
      shape[action.property] = deepCopy(action.value);
    }
    setV6CommandInput('sketch', shapes, context);
    sketch.setSemanticShapeSelection(action.shapeIndex);
    return {
      shapeIndex: action.shapeIndex,
      property: action.property,
      value: deepCopy(action.value),
      shape: deepCopy(shapes[action.shapeIndex]),
    };
  }

  async function invokeV6TreeAction(action) {
    const { entity, operation } = action;
    if (entity.kind === 'body') {
      if (operation === 'select' || operation === 'pattern-instance.select') {
        setV6SemanticSelection([entity]);
        return { operation, selection: currentV6Selections() };
      }
      if (operation === 'isolate') return { operation, ...isolateV6Body(entity.id) };
      if (operation === 'export' || operation === 'pattern-instance.export') {
        return { operation, ...toggleV6BodyExportSelection(entity.id) };
      }
      if (operation === 'pattern-instance.independent') {
        return previewV6PatternMaterialization(entity, operation);
      }
    }
    if (entity.kind === 'body-pattern' && operation === 'pattern.dissolve') {
      return previewV6PatternMaterialization(entity, operation);
    }
    if ((entity.kind === 'datum' && operation === 'datum.select') ||
        (entity.kind === 'sketch' && operation === 'sketch.select')) {
      setV6SemanticSelection([entity]);
      return { operation, selection: currentV6Selections() };
    }
    if (entity.kind === 'occurrence') {
      if (operation === 'occurrence.expand') {
        const key = v6SelectionRefKey(entity);
        const currentlyExpanded = v6TreeExpansion.get(key) !== false;
        return { operation, ...setV6TreeExpanded(entity, !currentlyExpanded) };
      }
      if (operation === 'occurrence.select' || operation === 'runtime-occurrence.select') {
        setV6SemanticSelection([entity]);
        return { operation, selection: currentV6Selections() };
      }
      if (operation === 'occurrence.export') {
        return { operation, ...toggleV6OccurrenceExportSelection(entity.id) };
      }
    }
    if (entity.kind === 'feature' && operation === 'select') {
      setV6SemanticSelection([entity]);
      return { operation, selection: currentV6Selections() };
    }
    if (entity.kind === 'mate' && operation === 'mate.select') {
      setV6SemanticSelection([entity]);
      return { operation, selection: currentV6Selections() };
    }
    if (entity.kind === 'measurement' && operation === 'measurement.evaluate') {
      return { operation, ...(await runV6VisibleInspection('measurements')) };
    }
    throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'The requested dynamic tree action has no released adapter.');
  }

  function invokeV6InspectorAction(operation) {
    if (operation === 'inspection.clear') {
      if (!lastInspection) throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'The inspector has no result to close.');
      lastInspection = null;
      renderContext();
      return { operation, inspection: null };
    }
    if (operation === 'body.isolate') {
      if (!selectedBodyId) throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'Select a body before using the inspector isolate action.');
      return { operation, ...isolateV6Body(selectedBodyId) };
    }
    if (operation === 'occurrence.isolate') {
      if (!selectedOccurrenceId) throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'Select an occurrence before using the inspector isolate action.');
      return { operation, ...isolateV6Occurrence(selectedOccurrenceId) };
    }
    if (operation === 'occurrence.export') {
      if (!selectedOccurrenceId) throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'Select an occurrence before using the inspector export action.');
      const bodyIds = lastBodyResults
        .filter((entry) =>
          entry.occurrenceInstance?.occurrenceId === selectedOccurrenceId ||
          entry.occurrenceInstance?.occurrencePath?.[0] === selectedOccurrenceId)
        .map((entry) => entry.bodyId);
      if (!bodyIds.length) throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'The selected occurrence has no exact bodies available for export.');
      return { operation, ...setV6BodyExportSelection(bodyIds, true) };
    }
    throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'The requested dynamic inspector action has no released adapter.');
  }

  async function applyV6UiAction(action, context = {}) {
    v6ApplyingSemanticAction = true;
    try {
      if (action.kind === 'document.activate') {
        return { activeDocument: v6ActiveDocumentRef() };
      }
      if (action.kind === 'workspace.activate') {
        showWorkspace(action.workspaceId, false);
        return { workspaceId: activeWorkspace };
      }
      if (action.kind === 'selection.set') {
        setV6SemanticSelection([action.entity]);
        return { selection: currentV6Selections() };
      }
      if (action.kind === 'selection.add') {
        setV6SemanticSelection([...currentV6Selections(), action.entity]);
        return { selection: currentV6Selections() };
      }
      if (action.kind === 'selection.remove') {
        const removeKey = v6SelectionRefKey(action.entity);
        const next = currentV6Selections().filter((entry) => v6SelectionRefKey(entry) !== removeKey);
        if (next.length) setV6SemanticSelection(next);
        else clearV6Selection();
        return { selection: currentV6Selections() };
      }
      if (action.kind === 'selection.clear') {
        clearV6Selection();
        return { selection: [] };
      }
      if (action.kind === 'tree.reveal') {
        v6RevealedEntity = deepCopy(action.entity);
        appEl.dataset.agentRevealedEntity = action.entity.id;
        const reveal = revealV6TreeEntity(action.entity);
        v6ApplyingSemanticAction = false;
        const label = await reveal;
        return { revealed: deepCopy(v6RevealedEntity), label };
      }
      if (action.kind === 'tree.expand') return setV6TreeExpanded(action.entity, true);
      if (action.kind === 'tree.collapse') return setV6TreeExpanded(action.entity, false);
      if (action.kind === 'tree.setSectionExpanded') return setV6TreeSectionExpanded(action.sectionId, action.expanded);
      if (action.kind === 'inspector.showEntity') {
        setV6SemanticSelection([action.entity]);
        v6PanelOpen.set('inspector', true);
        v6PanelOpen.set('diagnostics', false);
        sideEl?.classList.remove('m-open-history', 'm-open-project');
        sideEl?.classList.add('m-open-params');
        syncMtabs?.();
        renderContext();
        syncV6PanelVisibility();
        return { entity: deepCopy(currentV6Selection()), visible: true };
      }
      if (action.kind === 'viewport.standardView') {
        const next = v6CameraTargetForStandardView(action.viewId);
        await transitionV6Camera(next, context);
        activeViewName = action.viewId;
        syncViewPressed(activeViewName);
        return { viewId: activeViewName };
      }
      if (action.kind === 'viewport.fitAll') {
        const bounds = new THREE.Box3();
        partGroup.updateMatrixWorld(true);
        for (const mesh of bodyMeshes.values()) if (mesh.visible) bounds.expandByObject(mesh);
        if (bounds.isEmpty()) throw new v6InteractionTools.CadUiError('VIEW_NOT_AVAILABLE', 'There is no visible model to fit.');
        v6FramedBounds = await fitV6Bounds(bounds, context);
        activeViewName = 'fit';
        v6FramedEntities = [];
        return { viewId: activeViewName, framedEntities: [], renderedBounds: deepCopy(v6FramedBounds) };
      }
      if (action.kind === 'viewport.fitSelection') {
        const selection = currentV6Selections();
        const bounds = v6BoundsForSelection(selection);
        if (!bounds) throw new v6InteractionTools.CadUiError('VIEW_NOT_AVAILABLE', 'The current semantic selection has no rendered bounds.');
        v6FramedBounds = await fitV6Bounds(bounds, context);
        const framed = new Map();
        for (const entry of selection) {
          const owner = deepCopy(entry.owner || entry);
          framed.set(owner.kind + ':' + owner.id, owner);
        }
        v6FramedEntities = [...framed.values()];
        activeViewName = 'fit-selection';
        syncViewPressed(null);
        return { viewId: activeViewName, framedEntities: deepCopy(v6FramedEntities), renderedBounds: deepCopy(v6FramedBounds) };
      }
      if (action.kind === 'viewport.setCamera') {
        await transitionV6Camera({
          position: new THREE.Vector3().fromArray(action.camera.position),
          target: new THREE.Vector3().fromArray(action.camera.target),
          up: new THREE.Vector3().fromArray(action.camera.up),
        }, context);
        activeViewName = null;
        v6FramedEntities = [];
        v6FramedBounds = null;
        syncViewPressed(null);
        return { camera: deepCopy(v6StudioSnapshot().viewport.camera) };
      }
      if (action.kind === 'viewport.setDisplayMode') {
        v6DisplayModeOverride = action.displayModeId;
        document.querySelectorAll('[data-display-mode]').forEach((button) => {
          const active = button.dataset.displayMode === action.displayModeId;
          button.classList.toggle('on', active);
          button.setAttribute('aria-pressed', String(active));
        });
        syncBodyMeshState();
        rebuildSceneBatches();
        return { displayMode: activeV6DisplayMode(), persistent: false };
      }
      if (action.kind === 'viewport.setNavigationMode') {
        setNavMode(action.navigationMode);
        return { navigationMode: navMode };
      }
      if (action.kind === 'viewport.activateSection') {
        v6ActiveSectionOverride = action.sectionId;
        syncBodyMeshState();
        rebuildSectionCaps();
        renderAssemblyTree();
        return { activeSectionId: activeV6SectionId(), persistent: false };
      }
      if (action.kind === 'viewport.activateExplodedView') {
        v6ActiveExplodedViewOverride = action.explodedViewId;
        syncBodyMeshState();
        rebuildSectionCaps();
        renderAssemblyTree();
        return { activeExplodedViewId: activeV6ExplodedViewId(), persistent: false };
      }
      if (action.kind === 'viewport.clearInspectionView') {
        v6ActiveSectionOverride = null;
        v6ActiveExplodedViewOverride = null;
        syncBodyMeshState();
        rebuildSectionCaps();
        renderAssemblyTree();
        return { activeSectionId: null, activeExplodedViewId: null, persistent: false };
      }
      if (action.kind === 'panel.open') return setV6Panel(action.panelId, true);
      if (action.kind === 'panel.close') return setV6Panel(action.panelId, false);
      if (action.kind === 'history.showRevision') {
        v6HistoryRevision = action.revision;
        await setV6Panel('history', true);
        renderHistory();
        const row = document.querySelector('[data-v6-revision="' + action.revision + '"]');
        if (!row) {
          throw new v6InteractionTools.CadUiError('VIEW_NOT_AVAILABLE', 'Revision ' + action.revision + ' is not retained in the visible project history.');
        }
        $('bw-v6-revision-history')?.setAttribute('data-visible-revision', String(action.revision));
        row.classList.add('is-agent-revealed');
        row.scrollIntoView({ block: 'nearest' });
        say('Project revision ' + action.revision + (action.revision === commandRevision ? ' is current.' : ' is available in the undo history.'));
        return { revision: action.revision, current: action.revision === commandRevision };
      }
      if (action.kind === 'history.undo' || action.kind === 'history.redo') {
        const beforeRevision = commandRevision;
        if (action.kind === 'history.undo') undo();
        else redo();
        if (commandRevision === beforeRevision) {
          throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'Studio could not change project history.');
        }
        return {
          historyAction: action.kind.slice('history.'.length),
          revision: commandRevision,
          documentHash: v5RuntimeTools.studioV5CanonicalHash(doc),
        };
      }
      if (action.kind === 'control.invoke') {
        switch (action.controlId) {
          case 'project.templates':
          case 'welcome.templates':
            await openTemplateLibrary();
            break;
          case 'project.clear':
            startOperation(openClearDecision, { nextLabel: 'clear the project', controlId: 'project.clear' });
            break;
          case 'body.create':
            openV6AgentCommand('model.extrude', context, { forceNewBody: true });
            break;
          case 'app.help':
          case 'welcome.help':
            openHelp();
            break;
          case 'dialog.template.close':
            closeTemplateLibrary();
            break;
          case 'dialog.help.close':
            closeHelp();
            break;
          case 'dialog.clear.cancel':
            closeClearDecision();
            break;
          case 'dialog.draft.keep':
            if (!draftDecision?.open) {
              throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'There is no unfinished-edit decision to keep.');
            }
            keepEditing();
            break;
          case 'dialog.draft.discard':
            if (!discardDraftAndContinue()) {
              throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'There is no unfinished-edit decision to discard.');
            }
            break;
          case 'dialog.recovery.close':
            closeRecovery();
            break;
          case 'dialog.tour.back':
            moveTour(-1);
            break;
          case 'dialog.tour.next':
            moveTour(1);
            break;
          case 'dialog.tour.skip':
            finishTour();
            break;
          case 'help.tour':
            closeHelp();
            startTour(doc.features.length ? 'part' : 'empty');
            break;
          case 'help.templates':
            closeHelp();
            await openTemplateLibrary();
            break;
          case 'notice.legacy-dismiss':
            $('bw-v1-notice-dismiss')?.click();
            break;
          default:
            throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'Unsupported normal Studio control.');
        }
        return { controlId: action.controlId, surfaces: v6SurfaceState() };
      }
      if (action.kind === 'control.setValue') {
        $('bw-template-search').value = String(action.value);
        renderTemplateLibrary();
        return { controlId: action.controlId, value: String(action.value), surfaces: v6SurfaceState() };
      }
      if (action.kind === 'template.select') {
        await ensureTemplateLibrary();
        const template = templateLibrary.find((entry) => entry.id === action.templateId);
        if (!template) {
          throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'The requested template is not present in the loaded template library.');
        }
        setTemplateSelection(template);
        return { templateId: selectedTemplate?.id || null, surfaces: v6SurfaceState() };
      }
      if (action.kind === 'template.filter') {
        await ensureTemplateLibrary();
        if (!['All parts', ...templateCategories].includes(action.category)) {
          throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'The requested template category is not advertised.');
        }
        templateCategory = action.category;
        renderTemplateLibrary();
        return { category: templateCategory, surfaces: v6SurfaceState() };
      }
      if (action.kind === 'template.use') {
        await ensureTemplateLibrary();
        const template = templateLibrary.find((entry) => entry.id === action.templateId);
        if (!template) {
          throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'The requested template is not present in the loaded template library.');
        }
        setTemplateSelection(template);
        await openTemplateNow(template, { preserveAgent: true });
        return {
          templateId: template.id,
          projectId,
          revision: commandRevision,
          title: doc.title,
          documentHash: v5RuntimeTools.studioV5CanonicalHash(doc),
          surfaces: v6SurfaceState(),
        };
      }
      if (action.kind === 'project.newBlank') {
        return startBlankProject({ preserveAgent: true, context });
      }
      if (action.kind === 'recovery.open') {
        await openRecovery();
        return { surfaces: v6SurfaceState() };
      }
      if (action.kind === 'recovery.restore') {
        const snapshot = recoveryEntries.get(action.snapshotId);
        if (!snapshot) {
          throw new v6InteractionTools.CadUiError('SELECTION_AMBIGUOUS', 'That recovery entry is no longer available.');
        }
        return restoreRecoveryEntry(snapshot, { preserveAgent: true });
      }
      if (action.kind === 'transition.undo') {
        return undoProjectTransition();
      }
      if (action.kind === 'transition.dismiss') {
        hideTransitionToast(true);
        return { surfaces: v6SurfaceState() };
      }
      if (action.kind === 'application.fullscreen') {
        const active = await toggleFullscreen();
        return { active };
      }
      if (action.kind === 'application.navigate') {
        return { target: action.target, navigationPending: true };
      }
      if (action.kind === 'inspection.run') {
        return runV6VisibleInspection(action.inspectionId);
      }
      if (action.kind === 'sketch.setTool') {
        if (!sketch.setSemanticTool(action.toolId)) {
          throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'The requested sketch tool is not available.');
        }
        return { toolId: sketch.activeTool() };
      }
      if (['sketch.shape.select', 'sketch.shape.update', 'sketch.shape.delete'].includes(action.kind)) {
        return invokeV6SketchShapeAction(action, context);
      }
      if (action.kind === 'command.advance') {
        let advanced = false;
        if (action.controlId === 'model.face.next') advanced = facePick.nextFace();
        else if (action.controlId === 'model.face.use') advanced = facePick.useSelectedFace();
        else if (action.controlId === 'model.face.base') advanced = facePick.useBasePlane();
        else if (action.controlId === 'model.shell.next') advanced = shellPick.nextFace();
        else if (action.controlId === 'model.shell.toggle') advanced = shellPick.toggleSelectedFace();
        else if (action.controlId === 'sketch.presspull.start') advanced = sketch.startPressPull();
        else if (action.controlId === 'sketch.presspull.back') advanced = sketch.backFromPressPull();
        if (!advanced || !v6AgentCommandDraft) {
          throw new v6InteractionTools.CadUiError('COMMAND_BLOCKED', 'The requested lifecycle control is not available in the active normal command state.');
        }
        cancelV6PreviewRecord();
        const current = v6AgentCommandDraft;
        const refreshed = v6InitialVisibleCommandDraft(current.commandId, current);
        v6AgentCommandDraft = {
          ...current,
          ...refreshed,
          baseRevision: commandRevision,
          state: 'draft',
          diagnostics: [],
          previewId: null,
        };
        renderV6CommandPreview();
        emitV6CommandEvent('command.draftChanged', {
          reason: 'advanced',
          controlId: action.controlId,
          activeCommand: v6ActiveCommandState(),
        }, context);
        return { controlId: action.controlId, activeCommand: v6ActiveCommandState() };
      }
      if (action.kind === 'tree.invoke') return invokeV6TreeAction(action);
      if (action.kind === 'inspector.invoke') return invokeV6InspectorAction(action.operation);
      if (action.kind === 'diagnostics.show') {
        const diagnostics = renderV6Diagnostics(action.diagnosticId);
        await setV6Panel('diagnostics', true);
        return { diagnosticId: action.diagnosticId || null, count: diagnostics.length };
      }
      if (action.kind === 'command.open') {
        return openV6AgentCommand(action.commandId, context);
      }
      if (action.kind === 'command.bindSelection') {
        return bindV6CommandSelection(action.fieldId, action.entities, context);
      }
      if (action.kind === 'command.setInput') {
        return setV6CommandInput(action.fieldId, action.value, context);
      }
      if (action.kind === 'command.clearInput') {
        return clearV6CommandInput(action.fieldId, context);
      }
      if (action.kind === 'command.preview') {
        return await previewV6AgentCommand(context);
      }
      if (action.kind === 'command.commit') {
        return await commitV6VisiblePreviewFromAgent(context);
      }
      if (action.kind === 'command.cancel') {
        if (!v6AgentCommandDraft) {
          throw new v6InteractionTools.CadUiError('COMMAND_NOT_OPEN', 'There is no visible command draft to cancel.');
        }
        const draftId = v6AgentCommandDraft?.draftId || null;
        v6ClosingCommand = true;
        try {
          clearV6AgentCommandState({ cancelPreview: true });
          closeActiveV6CommandSurface();
        } finally {
          v6ClosingCommand = false;
        }
        emitV6CommandEvent('command.draftChanged', { reason: 'cancelled', draftId, activeCommand: null }, context);
        return { draftId, cancelled: true };
      }
      if (action.kind === 'preview.present') {
        return presentV6Preview(action.previewId);
      }
      if (action.kind === 'preview.dismiss') {
        return dismissV6Preview();
      }
      if (action.kind === 'presentation.focusAction') {
        return focusV6Action(action.actionId);
      }
      if (action.kind === 'presentation.waitForSettled') {
        return { correlationId: action.correlationId || context.correlationId, waiting: true };
      }
      if (action.kind === 'narration.setMode') {
        if (action.mode === 'off') hideV6Narration();
        return { mode: action.mode };
      }
      if (action.kind === 'presentation.setMode') {
        return { mode: action.mode };
      }
      throw new v6InteractionTools.CadUiError('UI_CAPABILITY_DISABLED', 'Unsupported Studio UI action.');
    } finally {
      v6ApplyingSemanticAction = false;
    }
  }

  async function restoreV6UiSnapshot(snapshot, { scopes = [], preserveScopes = [] } = {}) {
    const restore = new Set(scopes);
    const preserve = new Set(preserveScopes);
    v6ApplyingSemanticAction = true;
    try {
      if (restore.has('workspace') && snapshot.workspaceId) showWorkspace(snapshot.workspaceId, true);
      if (restore.has('selection')) {
        const selection = (snapshot.selection || []).filter(v6EntityExists);
        if (selection.length) setV6SemanticSelection(selection);
        else clearV6Selection();
      }
      if (restore.has('tree')) {
        document.querySelectorAll('.is-agent-revealed').forEach((candidate) => candidate.classList.remove('is-agent-revealed'));
        v6RevealedEntity = snapshot.tree?.revealed ? deepCopy(snapshot.tree.revealed) : null;
        if (v6RevealedEntity) appEl.dataset.agentRevealedEntity = v6RevealedEntity.id;
        else delete appEl.dataset.agentRevealedEntity;
        v6TreeExpansion.clear();
        const expandedKeys = new Set((snapshot.tree?.expanded || []).map(v6SelectionRefKey));
        if (v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly') {
          for (const occurrence of v5RuntimeTools.studioV5RootAssembly(doc).occurrences) {
            const entity = { kind: 'occurrence', id: occurrence.id };
            v6TreeExpansion.set(v6SelectionRefKey(entity), expandedKeys.has(v6SelectionRefKey(entity)));
          }
        }
        for (const section of snapshot.tree?.sections || []) {
          setV6TreeSectionOpen(section.sectionId, Boolean(section.expanded));
        }
        exportBodyIds.clear();
        for (const bodyId of snapshot.tree?.exportBodyIds || []) {
          if (lastBodyResults.some((entry) => entry.bodyId === bodyId)) exportBodyIds.add(bodyId);
        }
        renderBodies();
        renderBodyPatterns();
        renderAssemblyTree();
        if (v6RevealedEntity && !preserve.has('workspace')) await revealV6TreeEntity(v6RevealedEntity);
      }
      if (restore.has('panels')) {
        lastInspection = snapshot.inspection ? deepCopy(snapshot.inspection) : null;
        for (const panel of snapshot.panels || []) if (v6PanelOpen.has(panel.panelId)) v6PanelOpen.set(panel.panelId, Boolean(panel.open));
        v6HistoryRevision = snapshot.history?.visibleRevision ?? null;
        syncV6PanelVisibility();
        renderHistory();
      }
      if (restore.has('surfaces') && snapshot.surfaces) {
        const surfaces = snapshot.surfaces;
        if (surfaces.help?.open) openHelp();
        else closeHelp();
        if (surfaces.templates?.open) {
          await openTemplateLibrary();
          if (surfaces.templates.category && ['All parts', ...templateCategories].includes(surfaces.templates.category)) {
            templateCategory = surfaces.templates.category;
          }
          if ($('bw-template-search')) $('bw-template-search').value = String(surfaces.templates.search || '');
          renderTemplateLibrary();
          const selected = templateLibrary.find((entry) => entry.id === surfaces.templates.selectedTemplateId);
          if (selected) setTemplateSelection(selected);
        } else {
          closeTemplateLibrary(true);
        }
        if (surfaces.recovery?.open) await openRecovery();
        else closeRecovery();
        if (surfaces.clear?.open) openClearDecision();
        else closeClearDecision();
        if (surfaces.tour?.open) {
          startTour(surfaces.tour.kind);
          tourIndex = Math.max(0, Math.min(tourSteps().length - 1, surfaces.tour.index || 0));
          renderTourStep();
        } else {
          clearTourTarget();
          tourEl.hidden = true;
          tourReturnWelcome = false;
        }
        if (surfaces.welcome?.open) showWelcome();
        else hideWelcome();
        if (Boolean(document.fullscreenElement === appEl) !== Boolean(surfaces.fullscreen?.active)) {
          await toggleFullscreen();
        }
      }
      if (restore.has('viewport') && snapshot.viewport?.camera) {
        v6CameraTransitionGeneration++;
        camera.position.fromArray(snapshot.viewport.camera.position);
        orbit.target.fromArray(snapshot.viewport.camera.target);
        camera.up.fromArray(snapshot.viewport.camera.up);
        camera.updateProjectionMatrix();
        orbit.update();
        activeViewName = snapshot.viewport.viewId || null;
        v6FramedEntities = deepCopy(snapshot.viewport.framedEntities || []);
        v6FramedBounds = deepCopy(snapshot.viewport.framedBounds || null);
        v6DisplayModeOverride = snapshot.viewport.displayMode;
        setNavMode(snapshot.viewport.navigationMode || 'orbit');
        v6ActiveSectionOverride = snapshot.viewport.activeSectionId ?? null;
        v6ActiveExplodedViewOverride = snapshot.viewport.activeExplodedViewId ?? null;
        isolatedBodyId = snapshot.viewport.isolatedBodyId || null;
        if (snapshot.viewport.isolatedOccurrenceId) appEl.dataset.isolateOccurrence = snapshot.viewport.isolatedOccurrenceId;
        else delete appEl.dataset.isolateOccurrence;
        syncViewPressed(activeViewName);
        syncBodyMeshState();
        rebuildSectionCaps();
        renderAssemblyTree();
        requestSceneRender();
      }
      if (restore.has('command')) {
        const command = snapshot.activeCommand;
        if (
          command?.draftId &&
          (
            command.commandId?.startsWith('model.') ||
            command.commandId?.startsWith('assembly.') ||
            command.commandId?.startsWith('inspection.')
          )
        ) {
          v6ClosingCommand = true;
          try {
            clearV6AgentCommandState({ cancelPreview: true });
            closeActiveV6CommandSurface();
          } finally {
            v6ClosingCommand = false;
          }
          openV6AgentCommand(command.commandId, {}, {
            forceNewBody:
              command.commandId === 'model.extrude' &&
              !command.editEntity &&
              command.inputValues?.resultPolicy === 'new-body',
          });
          const normalSurfaceOpen = V6_BASIC_MODEL_COMMANDS.has(command.commandId)
            ? sketch.isOpen() || picker.active() || shellPick.active() || facePick.active()
            : v5Dialog?.open;
          if (normalSurfaceOpen) {
            v6AgentCommandDraft = {
              commandId: command.commandId,
              draftId: command.draftId,
              transactionId: command.transactionId,
              baseRevision: command.baseRevision,
              state: command.state,
              inputValues: deepCopy(command.inputValues || {}),
              boundSelections: deepCopy(command.boundSelections || {}),
              generatedIds: deepCopy(command.generatedIds || {}),
              diagnostics: deepCopy(command.diagnostics || []),
              previewId: snapshot.preview?.previewId || null,
              ...(command.editEntity ? { editEntity: deepCopy(command.editEntity) } : {}),
              ...(command.bootstrapOperations?.length
                ? { bootstrapOperations: deepCopy(command.bootstrapOperations) }
                : {}),
              ...(command.materialContext
                ? { materialContext: deepCopy(command.materialContext) }
                : {}),
            };
            for (const [fieldId, entities] of Object.entries(v6AgentCommandDraft.boundSelections)) {
              v6SetVisibleCommandFormSelection(fieldId, entities);
            }
            for (const [fieldId, value] of Object.entries(v6AgentCommandDraft.inputValues)) {
              v6SetVisibleCommandFormInput(fieldId, value);
            }
            if (Number.isInteger(command.selectedShapeIndex)) {
              sketch.setSemanticShapeSelection(command.selectedShapeIndex);
            }
          }
        } else {
          v6ClosingCommand = true;
          try {
            clearV6AgentCommandState({ cancelPreview: true });
            if (v5Dialog?.open) closeV5Command();
          } finally {
            v6ClosingCommand = false;
          }
        }
      }
      if (restore.has('preview')) {
        const preview = snapshot.preview;
        if (preview?.previewId) {
          if (v6VisiblePreview?.previewId && v6VisiblePreview.previewId !== preview.previewId) {
            liveAgentService?.cancelPreview(v6VisiblePreview.previewId);
          }
          const retained = v6VisiblePreview?.previewId === preview.previewId ? v6VisiblePreview : {};
          v6VisiblePreview = {
            ...retained,
            previewId: preview.previewId,
            baseRevision: preview.baseRevision,
            visible: Boolean(preview.visible),
            highlightedEntities: deepCopy(preview.highlightedEntities || []),
            validation: deepCopy(preview.validation || { valid: false, exactGeometry: false, diagnostics: [] }),
            evidence: deepCopy(preview.evidence || retained.evidence || {}),
            transactionHash: preview.transactionHash,
            changeSet: {
              ...(retained.changeSet || {}),
              documentHashAfter: preview.documentHashAfter,
            },
          };
          if (v6AgentCommandDraft) v6AgentCommandDraft.previewId = preview.previewId;
          if (preview.visible && v6AgentCommandDraft?.inputValues?.transform) {
            setV6TransformPreviewMatrix(v6AgentCommandDraft.inputValues.transform);
          } else {
            endTransformPreview(true);
          }
        } else {
          cancelV6PreviewRecord();
          endTransformPreview(true);
        }
        renderV6CommandPreview();
      }
      if (restore.has('surfaces') && snapshot.surfaces?.draftDecision) {
        const decision = snapshot.surfaces.draftDecision;
        if (decision.open && decision.controlId === 'project.clear') {
          openDraftDecision(openClearDecision, {
            nextLabel: decision.nextLabel || 'clear the project',
            controlId: 'project.clear',
          });
        } else {
          queuedOperation = null;
          closeDecision(draftDecision);
        }
      }
      if (restore.has('presentation')) {
        document.querySelectorAll('[data-v6-focused-action="true"]').forEach((element) => delete element.dataset.v6FocusedAction);
        v6FocusedActionId = snapshot.focusedActionId || null;
        if (v6FocusedActionId) focusV6Action(v6FocusedActionId);
      }
    } finally {
      v6ApplyingSemanticAction = false;
    }
  }

  function waitForV6RenderedFrame(timeoutMs) {
    const before = renderSerial;
    return new Promise((resolve, reject) => {
      let complete = false;
      const done = (serial) => {
        if (complete || serial <= before) return;
        complete = true;
        clearTimeout(timer);
        clearTimeout(forceTimer);
        renderSettlementWaiters.delete(done);
        resolve(serial);
      };
      const forceTimer = setTimeout(() => {
        if (complete || renderSerial > before) return;
        try {
          sceneRenderDirty = false;
          renderScene();
        } catch (error) {
          complete = true;
          clearTimeout(timer);
          renderSettlementWaiters.delete(done);
          reject(new v6InteractionTools.CadUiError('RENDER_SETTLEMENT_TIMEOUT', 'Studio could not force a renderer frame for semantic settlement.', {
            renderSerial,
            cause: String(error?.message || error),
          }));
        }
      }, 32);
      const timer = setTimeout(() => {
        if (complete) return;
        complete = true;
        clearTimeout(forceTimer);
        renderSettlementWaiters.delete(done);
        reject(new v6InteractionTools.CadUiError('RENDER_SETTLEMENT_TIMEOUT', 'Studio did not produce a renderer frame before the semantic settlement deadline.', {
          renderSerial,
          timeoutMs,
        }));
      }, timeoutMs);
      renderSettlementWaiters.add(done);
      requestSceneRender();
    });
  }

  async function waitForV6UiSettlement(_action, { targetUiRevision, timeoutMs = 10_000 } = {}) {
    const started = performance.now();
    const deadline = started + timeoutMs;
    while (latestRequestedRevision > latestAppliedRevision) {
      if (performance.now() >= deadline) {
        throw new v6InteractionTools.CadUiError('RENDER_SETTLEMENT_TIMEOUT', 'The CAD kernel did not reach the requested renderer revision before settlement.', {
          latestRequestedRevision,
          latestAppliedRevision,
          timeoutMs,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
    const settledRenderSerial = await waitForV6RenderedFrame(remaining);
    lastRenderedUiRevision = targetUiRevision;
    v6ObservedHostState = v6ComparableHostState(v6StudioSnapshot());
    return {
      renderSerial: settledRenderSerial,
      renderedDocumentRevision: lastRenderedDocumentRevision,
      renderedKernelRevision: lastRenderedKernelRevision,
      renderedUiRevision: lastRenderedUiRevision,
      renderState: 'idle',
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
    };
  }

  function getV6InteractionRuntime() {
    if (!v6InteractionRuntime) {
      v6InteractionRuntime = new v6InteractionTools.CadStudioInteractionRuntime({
        projectId: () => projectId,
        documentRevision: () => commandRevision,
        studioVersion: '6.0.0-i4',
        adapter: {
          snapshot: v6StudioSnapshot,
          validateAction: validateV6UiAction,
          applyAction: applyV6UiAction,
          restoreSnapshot: restoreV6UiSnapshot,
          waitForSettled: waitForV6UiSettlement,
          interrupt: () => { v6CameraTransitionGeneration++; },
          showNarration: showV6Narration,
          completeNarration: completeV6Narration,
        },
      });
      v6ObservedHostState = v6ComparableHostState(v6StudioSnapshot());
      v6InteractionRuntime.emit('session.connected', {
        clientLabel: activeAgentConnection?.clientLabel || 'Local CAD agent',
        mode: activeAgentConnection?.mode || 'preview-required',
        recovered: Boolean(activeAgentConnection?.recovered),
      }, { actor: 'agent' });
      if (activeAgentConnection?.recovered) {
        v6InteractionRuntime.emit('document.recovered', {
          projectId,
          revision: commandRevision,
          documentHash: v5RuntimeTools.isStudioV5Project(doc) ? v5RuntimeTools.studioV5CanonicalHash(doc) : null,
        }, { actor: 'agent' });
      }
    }
    return v6InteractionRuntime;
  }

  for (const eventName of ['click', 'change', 'input', 'keydown']) {
    appEl?.addEventListener(eventName, captureV6HumanState);
  }
  appEl?.addEventListener('toggle', captureV6HumanTreeToggle, true);

  async function handleLoopbackTool(tool, rawArgs, requestId) {
    if (!activeAgentConnection) throw new agentTools.CadAgentError('SESSION_NOT_FOUND', 'The live Studio session is not connected.');
    if (activeAgentConnection.paused) throw new agentTools.CadAgentError('SESSION_PAUSED', 'The user paused this agent session.');
    const args = deepCopy(rawArgs || {});
    delete args.sessionId;
    if (tool === 'cad_artifact') return liveAgentArtifact(args);
    if (tool === 'cad_ui' || tool === 'cad_events') {
      const runtime = getV6InteractionRuntime();
      const granted = activeAgentConnection.permissionContext.granted;
      if (!granted.includes('ui.read')) throw new agentTools.CadAgentError('PERMISSION_DENIED', 'Permission "ui.read" is required.');
      if (tool === 'cad_events') {
        if (!granted.includes('ui.wait-events')) throw new agentTools.CadAgentError('PERMISSION_DENIED', 'Permission "ui.wait-events" is required.');
        return runtime.events(args);
      }
      if (args.action === 'capabilities') return runtime.capabilities({
        detail: args.detail,
        controlIds: args.controlIds,
        commandIds: args.commandIds,
        actionIds: args.actionIds,
      });
      if (args.action === 'snapshot') return runtime.snapshot();
      if (args.action === 'narrate') {
        if (!granted.includes('ui.present-narration')) {
          throw new agentTools.CadAgentError('PERMISSION_DENIED', 'Permission "ui.present-narration" is required.');
        }
        const expectedUiRevision = Number(args.expectedUiRevision);
        if (!Number.isInteger(expectedUiRevision) || expectedUiRevision !== runtime.uiRevision) {
          throw new agentTools.CadAgentError('UI_REVISION_CONFLICT', 'Narration targets a stale Studio UI revision.', {
            expectedUiRevision: args.expectedUiRevision,
            actualUiRevision: runtime.uiRevision,
          });
        }
        const allowed = new Set(runtime.manifest.trustedNarrationTemplates.map((entry) => entry.id));
        if (!allowed.has(args.templateId)) {
          throw new agentTools.CadAgentError('UI_CAPABILITY_DISABLED', 'Only advertised Studio-owned presentation templates may be requested.');
        }
        return runtime.presentTrustedNarration({
          templateId: args.templateId,
          values: args.values,
          correlationId: args.correlationId,
        });
      }
      if (args.action === 'apply') {
        v6SemanticBatchBasePreviewId = v6VisiblePreview?.previewId || null;
        v6DeferredPreviewCancellations.clear();
        try {
          const result = await runtime.apply(args, { permissions: granted });
          for (const previewId of v6DeferredPreviewCancellations) {
            if (previewId !== v6VisiblePreview?.previewId) cancelV6PreviewServiceRecord(previewId);
          }
          return result;
        } catch (error) {
          v6DeferredPreviewCancellations.clear();
          throw error;
        } finally {
          v6SemanticBatchBasePreviewId = null;
          v6DeferredPreviewCancellations.clear();
        }
      }
      throw new agentTools.CadAgentError('INVALID_ACTION', 'Unknown cad_ui action.');
    }
    if (tool === 'cad_query' && args.query?.kind === 'geometry.topology') {
      if (!activeAgentConnection.permissionContext.granted.includes('project.read')) {
        throw new agentTools.CadAgentError('PERMISSION_DENIED', 'Permission "project.read" is required.');
      }
      const query = args.query;
      const topologyKind = query.topologyKind;
      const bodyId = query.bodyId;
      const candidates = v6PublicTopologyInventory().filter((entry) =>
        (!topologyKind || entry.topologySignature.kind === topologyKind) &&
        (!bodyId || entry.owner.id === bodyId));
      const offset = Math.max(0, Number.isInteger(query.offset) ? query.offset : 0);
      const limit = Math.max(1, Math.min(1000, Number.isInteger(query.limit) ? query.limit : 250));
      return {
        revision: commandRevision,
        result: {
          exactGeometry: true,
          offset,
          limit,
          total: candidates.length,
          items: candidates.slice(offset, offset + limit),
        },
      };
    }
    if (tool === 'cad_query' && ['geometry.health', 'assembly.clearance', 'assembly.interference'].includes(args.query?.kind)) {
      if (!activeAgentConnection.permissionContext.granted.includes('project.read')) {
        throw new agentTools.CadAgentError('PERMISSION_DENIED', 'Permission "project.read" is required.');
      }
      if ((args.previewId == null) !== (args.expectedRevision == null)) {
        throw new agentTools.CadAgentError('INVALID_QUERY_SCOPE', 'Preview-scoped queries require both previewId and expectedRevision.');
      }
      if (args.presentation != null && !['visible', 'silent'].includes(args.presentation)) {
        throw new agentTools.CadAgentError('INVALID_QUERY_PRESENTATION', 'Query presentation must be visible or silent.');
      }
      const canPresentNarration =
        activeAgentConnection.permissionContext.granted.includes('ui.present-narration');
      if (args.presentation === 'visible' && !canPresentNarration) {
        throw new agentTools.CadAgentError('PERMISSION_DENIED', 'Permission "ui.present-narration" is required for visible query presentation.');
      }
      const query = args.query;
      const preview = args.previewId == null
        ? null
        : liveAgentService.previewSnapshot(args.previewId, args.expectedRevision);
      const queryDocument = preview?.project || doc;
      if (query.entities && query.bodyIds) {
        throw new agentTools.CadAgentError('INVALID_QUERY_SCOPE', 'Choose either stable entities or bodyIds for an exact inspection.');
      }
      const scope = resolveArtifactBodyScope({
        ...(Array.isArray(query.entities) ? { entities: query.entities } : {}),
        ...(Array.isArray(query.bodyIds) ? { entities: query.bodyIds.map((id) => ({ kind: 'body', id })) } : {}),
        ...(!query.entities && !query.bodyIds ? { scope: query.scope || 'visible-model' } : {}),
      }, {
        document: queryDocument,
        ...(preview ? { bodyResults: preview.evidence.bodyResults } : {}),
      });
      if (query.kind === 'assembly.clearance' && scope.bodyIds.length !== 2) {
        throw new agentTools.CadAgentError('SELECTION_AMBIGUOUS', 'Exact clearance requires exactly two resolved bodies.');
      }
      const mode = query.kind === 'geometry.health'
        ? 'mass-health'
        : query.kind === 'assembly.clearance'
          ? 'clearance'
          : 'interference';
      const response = await kernelCall('inspect-v5', preview?.baseRevision ?? documentRevision, {
        document: queryDocument,
        mode,
        bodyIds: scope.bodyIds,
        ...(mode === 'clearance' ? { pairBodyIds: scope.bodyIds } : {}),
      });
      if (!response.inspection || response.errors?.length) {
        throw new agentTools.CadAgentError('KERNEL_INSPECTION_FAILED', response.errors?.[0]?.message || 'The exact inspection did not produce a result.');
      }
      const result = {
        ...deepCopy(response.inspection),
        exactGeometry: true,
        scope,
        documentHash: preview?.documentHash || v5RuntimeTools.studioV5CanonicalHash(doc),
        ...(preview ? {
          previewId: preview.previewId,
          baseRevision: preview.baseRevision,
          previewScoped: true,
        } : {}),
      };
      getV6InteractionRuntime().emit('kernel.completed', {
        queryKind: query.kind,
        exactGeometry: true,
        bodyIds: scope.bodyIds,
        ...(preview ? { previewId: preview.previewId, previewScoped: true } : {}),
      }, { actor: 'agent', uiRevision: getV6InteractionRuntime().uiRevision });
      const templateId = query.kind === 'geometry.health'
        ? 'geometry-health'
        : query.kind === 'assembly.clearance'
          ? 'assembly-clearance'
          : query.kind === 'assembly.interference' && scope.bodyIds.length === 2 && response.inspection.pairs.length === 0
            ? 'assembly-interference-clear'
          : 'assembly-interference';
      if (args.presentation !== 'silent' && canPresentNarration) {
        await getV6InteractionRuntime().presentTrustedNarration({
          templateId,
          ...(templateId === 'assembly-clearance'
            ? { values: { minimumClearanceMm: response.inspection.pairs[0]?.minimumClearanceMm } }
            : templateId === 'assembly-interference-clear'
              ? {}
              : { values: { bodyCount: scope.bodyIds.length } }),
          correlationId: `query-${query.kind}-${preview?.previewId || commandRevision}`,
        });
      }
      return {
        revision: preview?.baseRevision ?? commandRevision,
        ...(preview ? { previewId: preview.previewId } : {}),
        result,
      };
    }
    let payload;
    if (tool === 'cad_inspect') payload = { kind: 'inspect', query: args.query || {} };
    else if (tool === 'cad_query') payload = { kind: 'query', query: args.query || {} };
    else if (tool === 'cad_preview') payload = { kind: 'preview', transaction: args.transaction };
    else if (tool === 'cad_commit') payload = { kind: 'commit', previewId: args.previewId };
    else if (tool === 'cad_history') payload = { kind: 'history', ...args };
    else throw new agentTools.CadAgentError('TOOL_NOT_FOUND', 'Unsupported live Studio tool "' + tool + '".');
    if (tool === 'cad_commit' && v6AgentCommandDraft?.baseRevision !== undefined && v6AgentCommandDraft.baseRevision !== commandRevision) {
      await getV6InteractionRuntime().presentTrustedNarration({
        templateId: 'revision-conflict',
        correlationId: `revision-conflict-${commandRevision}`,
      });
      throw new agentTools.CadAgentError('REVISION_CONFLICT', 'The visible command targets an older project revision.', {
        expectedRevision: v6AgentCommandDraft.baseRevision,
        actualRevision: commandRevision,
        repairOptions: [{ kind: 'inspect-changes-since' }, { kind: 'refresh-command-draft' }],
      });
    }
    if (tool === 'cad_commit' && v6AgentCommandDraft && v6AgentCommandDraft.previewId !== args.previewId) {
      throw new agentTools.CadAgentError('PREVIEW_NOT_CURRENT', 'The requested preview is not the exact preview currently attached to the visible command draft.');
    }
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
    if (tool === 'cad_preview') {
      const clearDecisionWasOpen =
        Boolean(clearDecision?.open) &&
        args.transaction?.operations?.some((operation) => operation.kind === 'project.clear');
      if (clearDecisionWasOpen) closeDecision(clearDecision);
      try {
        const visible = await presentV6DirectTransactionPreview(response.result, args.transaction);
        response.result.visible = visible;
        if (visible) response.result.transactionHash = v6VisiblePreview?.transactionHash || null;
      } catch (error) {
        cancelV6PreviewServiceRecord(response.result.previewId);
        if (clearDecisionWasOpen) openClearDecision();
        throw error;
      }
    }
    if (tool === 'cad_history' && ['undo', 'redo'].includes(args.action)) {
      const runtime = getV6InteractionRuntime();
      runtime.hostChanged('history.changed', {
        historyAction: args.action,
        revision: response.result.revision,
        documentHash: v5RuntimeTools.studioV5CanonicalHash(doc),
      }, { actor: 'agent' });
      await Promise.all([
        latestStorageWrite,
        waitForV6UiSettlement(null, {
          targetUiRevision: runtime.uiRevision,
        }),
      ]);
      runtime.emit('history.changed', {
        historyAction: args.action,
        revision: response.result.revision,
        documentHash: v5RuntimeTools.studioV5CanonicalHash(doc),
      }, { actor: 'agent', uiRevision: runtime.uiRevision });
    }
    if (tool === 'cad_commit') {
      const result = response.result;
      const visibleMatch = v6VisiblePreview?.previewId === args.previewId;
      const transactionHash = visibleMatch ? v6VisiblePreview.transactionHash : null;
      if (visibleMatch) {
        v6ClosingCommand = true;
        try {
          clearV6AgentCommandState({ cancelPreview: false });
          closeActiveV6CommandSurface();
        } finally {
          v6ClosingCommand = false;
        }
      }
      const runtime = getV6InteractionRuntime();
      runtime.hostChanged('commit.applied', {
        previewId: args.previewId,
        revision: result.revision,
        ...(transactionHash ? { transactionHash } : {}),
        changeSet: result.changeSet,
        historyEntry: result.historyEntry,
        approvedBy: 'agent-host',
      }, { actor: 'agent' });
      runtime.emit('history.changed', {
        revision: result.revision,
        historyEntry: result.historyEntry,
      }, { actor: 'agent', uiRevision: runtime.uiRevision });
      await runtime.presentTrustedNarration({
        templateId: 'commit-applied',
        values: { revision: result.revision },
        correlationId: `commit-${result.historyEntry?.transactionId || result.revision}`,
      });
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
    clearTimeout(localAgentBridgeTimer);
    localAgentBridgeTimer = null;
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
          skillVersion: message.skillVersion,
          expiresAt: message.expiresAt,
          resume: message.resume === true,
          bridgeWindow: event.source,
          bridgeOrigin: event.origin,
        });
        pendingPairingWindow = null;
        pendingPairingOrigin = null;
        postToPairingWindow({
          type: 'pairing.approved',
          projectId: connection.projectId,
          revision: connection.revision,
          uiRevision: connection.uiRevision,
          permissionContext: connection.permissionContext,
          mode: connection.mode,
          capabilities: connection.capabilities,
        });
      } catch (reason) {
        postToPairingWindow({ type: 'pairing.denied', message: String(reason?.message || reason) });
      }
      return;
    }
    if (message.type === 'tool.cancel' && typeof message.id === 'string') {
      v6InteractionRuntime?.interrupt?.('SESSION_PAUSED', String(message.reason || 'The user interrupted this request.'));
      return;
    }
    if (message.type === 'tool.request' && typeof message.id === 'string' && typeof message.tool === 'string') {
      try {
        const result = await handleLoopbackTool(message.tool, message.args, message.id);
        postToPairingWindow({ type: 'tool.response', id: message.id, ok: true, result });
        const navigation = message.tool === 'cad_ui' &&
          message.args?.action === 'apply' &&
          Array.isArray(message.args?.actions) &&
          message.args.actions.length === 1 &&
          message.args.actions[0]?.kind === 'application.navigate' &&
          message.args.actions[0]?.target === 'cad-home';
        if (navigation) {
          // Deliver the structured settlement before unloading Studio. The
          // agent never has to infer success from a severed bridge, while the
          // visible page still follows the same /cad link as the human Exit.
          setTimeout(() => window.location.assign('/cad'), 120);
        }
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

  function consumeAgentLaunchFragment() {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const nonce = fragment.get('bomwiki-cad-pair');
    const port = Number(fragment.get('bomwiki-cad-port'));
    const recovery = fragment.get('bomwiki-cad-recovery') === '1';
    if (!nonce) return;
    history.replaceState(null, '', location.pathname + location.search);
    if (port !== LOCAL_AGENT_BRIDGE_PORT || !/^[A-Za-z0-9-]{20,200}$/.test(nonce)) {
      say('The local CAD agent launch request is invalid or uses an unsupported bridge.', true);
      return;
    }
    queueMicrotask(() => openLoopbackPairDialog({ nonce, recovery }));
  }

  consumeAgentLaunchFragment();

  function synchronizeAgentAfterHostChange(label, actor = 'human', transactionId = null) {
    if (!liveAgentService || agentCommitInProgress || !v5RuntimeTools.isStudioV5Project(doc)) return;
    liveAgentService.synchronize(doc, commandRevision, { label, actor, ...(transactionId ? { transactionId } : {}) });
    activeAgentConnection?.previews.clear();
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
    if (v6AgentCommandDraft && !agentCommitInProgress) {
      cancelV6PreviewRecord();
      v6AgentCommandDraft.state = 'blocked';
      v6AgentCommandDraft.diagnostics = [{
        code: 'REVISION_CONFLICT',
        severity: 'error',
        message: 'The project changed while this visible command was open. Refresh the command on the current revision.',
      }];
      endTransformPreview(true);
      renderV6CommandPreview();
      v6InteractionRuntime?.hostChanged('command.draftChanged', {
        reason: 'document-changed',
        activeCommand: v6ActiveCommandState(),
      }, { actor: metadata.actor || 'human' });
    }
    afterDocumentChange(label);
    synchronizeAgentAfterHostChange(label, metadata.actor || 'human', metadata.transactionId || null);
    v6InteractionRuntime?.emit('document.changed', {
      revision: commandRevision,
      label,
      actor: metadata.actor || 'human',
      ...(metadata.transactionId ? { transactionId: metadata.transactionId } : {}),
      documentHash: v5RuntimeTools.isStudioV5Project(doc) ? v5RuntimeTools.studioV5CanonicalHash(doc) : null,
    }, { actor: metadata.actor || 'human', uiRevision: v6InteractionRuntime.uiRevision });
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
      for (const key of ['name', 'h', 'through', 'r', 't', 'edges', 'faces', 'sketch', 'pattern', 'resultPolicy', 'inputRefs', 'onFace']) {
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
    if (draft.onFace) input.onFace = deepCopy(draft.onFace);
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

  function undo(metadata = {}) {
    const actor = metadata.actor || 'human';
    if ($('bw-v5-command')?.open) return say('Apply or cancel the active command first.');
    if (mode.kind !== 'idle' && mode.kind !== 'rebuilding') return say('Finish or cancel the current action first.');
    if (!undoStack.length) return say('Nothing to undo.');
    const entry = undoStack.pop();
    redoStack.push({ label: entry.label, snap: JSON.stringify(doc) });
    trimHistoryStacks();
    commandRevision++;
    replaceDocument(entry.snap);
    synchronizeAgentAfterHostChange('Undo ' + entry.label, actor);
    v6InteractionRuntime?.emit('document.changed', {
      revision: commandRevision,
      label: 'Undo ' + entry.label,
      actor,
      documentHash: v5RuntimeTools.isStudioV5Project(doc) ? v5RuntimeTools.studioV5CanonicalHash(doc) : null,
    }, { actor, uiRevision: v6InteractionRuntime.uiRevision });
    say('Undid: ' + entry.label);
  }
  function redo(metadata = {}) {
    const actor = metadata.actor || 'human';
    if ($('bw-v5-command')?.open) return say('Apply or cancel the active command first.');
    if (mode.kind !== 'idle' && mode.kind !== 'rebuilding') return say('Finish or cancel the current action first.');
    if (!redoStack.length) return say('Nothing to redo.');
    const entry = redoStack.pop();
    undoStack.push({ label: entry.label, snap: JSON.stringify(doc) });
    trimHistoryStacks();
    commandRevision++;
    replaceDocument(entry.snap);
    synchronizeAgentAfterHostChange('Redo ' + entry.label, actor);
    v6InteractionRuntime?.emit('document.changed', {
      revision: commandRevision,
      label: 'Redo ' + entry.label,
      actor,
      documentHash: v5RuntimeTools.isStudioV5Project(doc) ? v5RuntimeTools.studioV5CanonicalHash(doc) : null,
    }, { actor, uiRevision: v6InteractionRuntime.uiRevision });
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
  function showWorkspace(name, forced, actor = 'system') {
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
    if (actor === 'human') noteV6HostUiChange('ui.changed', { workspace: { activeId: name } });
    return true;
  }
  document.querySelectorAll('[data-workspace]').forEach((b) =>
    b.addEventListener('click', () => showWorkspace(b.dataset.workspace, false, 'human')),
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
      if (v6AgentCommandDraft && !v6ApplyingSemanticAction) {
        cancelV6PreviewRecord();
        v6AgentCommandDraft.inputValues.transform = cad.map((value) => Math.abs(value) < 1e-12 ? 0 : Math.round(value * 1e9) / 1e9);
        v6AgentCommandDraft.state = 'draft';
        v6AgentCommandDraft.diagnostics = [];
        v6InteractionRuntime?.hostChanged('command.draftChanged', {
          reason: 'human-gizmo',
          fieldId: 'transform',
          activeCommand: v6ActiveCommandState(),
        }, { actor: 'human' });
      }
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

  const captureV6HumanCommandInput = (event) => {
    const fieldId = event.target?.name || event.target?.dataset?.dim || event.target?.id || '';
    if (
      !v6AgentCommandDraft ||
      (
        !v6AgentCommandDraft.commandId.startsWith('model.') &&
        !v6AgentCommandDraft.commandId.startsWith('assembly.') &&
        !v6AgentCommandDraft.commandId.startsWith('inspection.')
      ) ||
      v6ApplyingSemanticAction ||
      !fieldId
    ) return;
    cancelV6PreviewRecord();
    const current = v6AgentCommandDraft;
    try {
      const parsed = v6InitialVisibleCommandDraft(current.commandId, current);
      v6AgentCommandDraft = {
        ...parsed,
        draftId: current.draftId,
        transactionId: current.transactionId,
        generatedIds: current.generatedIds,
        baseRevision: commandRevision,
        previewId: null,
      };
      v5Error.textContent = v6AgentCommandDraft.diagnostics[0]?.message || '';
    } catch (error) {
      v6AgentCommandDraft.state = 'blocked';
      v6AgentCommandDraft.diagnostics = [{
        code: error?.code || 'COMMAND_FIELD_INVALID',
        severity: 'error',
        message: String(error?.message || error),
        fieldId,
      }];
      v5Error.textContent = String(error?.message || error);
    }
    renderV6CommandPreview();
    v6InteractionRuntime?.hostChanged('command.draftChanged', {
      reason: 'human-input',
      fieldId,
      activeCommand: v6ActiveCommandState(),
    }, { actor: 'human' });
  };
  v5Fields?.addEventListener('input', captureV6HumanCommandInput);
  v5Fields?.addEventListener('change', captureV6HumanCommandInput);

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
    const isExitContext = command === 'exit-context';
    if (isCreate && (candidate.rootDocument?.kind !== 'part' || candidate.metadata?.editContext)) return say('Create Assembly starts from a standalone active part.');
    if (
      !isCreate &&
      !isExitContext &&
      candidate.rootDocument?.kind !== 'assembly'
    ) return say('Open or create an assembly before using this command.');
    if (
      isExitContext &&
      !candidate.assemblyDefinitions.some((entry) => entry.id === candidate.metadata?.editContext?.assemblyId)
    ) return say('No assembly component is currently being edited in context.');
    const assembly = isCreate
      ? null
      : candidate.rootDocument?.kind === 'assembly'
        ? v5RuntimeTools.studioV5RootAssembly(candidate)
        : candidate.assemblyDefinitions.find((entry) => entry.id === candidate.metadata.editContext.assemblyId);
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
      : command === 'edit-context' ? 'Edit component in assembly context'
      : command === 'exit-context' ? 'Return to assembly'
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
    } else if (command === 'edit-context') {
      if (!selectedOccurrence || selectedOccurrence.definition.kind !== 'part') return say('Select a direct part component to edit in context.');
      v5Fields.innerHTML = '<p class="is-wide">Open <strong>' + attr(selectedOccurrence.name) + '</strong> for in-context part editing. The assembly remains the owning document.</p>';
    } else if (command === 'exit-context') {
      if (!candidate.metadata?.editContext) return say('No assembly component is currently being edited in context.');
      v5Fields.innerHTML = '<p class="is-wide">Return from the active component edit context to the owning assembly.</p>';
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
    if (!v5Dialog.open) {
      if (usesGizmo && typeof v5Dialog.show === 'function') v5Dialog.show();
      else if (typeof v5Dialog.showModal === 'function') v5Dialog.showModal();
      else v5Dialog.setAttribute('open', '');
    }
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
    if (command === 'edit-context') return v5RuntimeTools.enterStudioV5AssemblyContext(candidate, occurrenceId);
    if (command === 'exit-context') return v5RuntimeTools.exitStudioV5AssemblyContext(candidate);
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
    if (v6SemanticSelection.length) {
      try {
        const scope = resolveArtifactBodyScope({ entities: currentV6Selections().map((entry) => entry.owner || entry) });
        if (scope.bodyIds.length) return lastBodyResults.filter((entry) => scope.bodyIds.includes(entry.bodyId));
      } catch {}
    }
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
    if (!v5Dialog.open) {
      if (typeof v5Dialog.showModal === 'function') v5Dialog.showModal();
      else v5Dialog.setAttribute('open', '');
    }
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
    const cancelledDraftId = v6AgentCommandDraft?.draftId || null;
    if (v6AgentCommandDraft && !v6ClosingCommand) {
      clearV6AgentCommandState({ cancelPreview: true });
      if (v6InteractionRuntime && !v6ApplyingSemanticAction) {
        v6InteractionRuntime.hostChanged('command.draftChanged', {
          reason: 'cancelled-by-human',
          draftId: cancelledDraftId,
          activeCommand: null,
        }, { actor: 'human' });
      }
    }
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
    if (!v5Dialog.open) {
      if (usesGizmo && typeof v5Dialog.show === 'function') v5Dialog.show();
      else if (typeof v5Dialog.showModal === 'function') v5Dialog.showModal();
      else v5Dialog.setAttribute('open', '');
    }
    if (usesGizmo && !beginTransformPreview(command, feature)) {
      v5Fields.insertAdjacentHTML('beforeend', '<p class="is-wide">The exact numeric controls remain available while this body is rebuilding.</p>');
    }
  }

  $('bw-v5-command-cancel')?.addEventListener('click', closeV5Command);
  v5Dialog?.addEventListener('cancel', (event) => { event.preventDefault(); closeV5Command(); });
  $('bw-v5-command-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (v6AgentCommandDraft) {
      await commitV6VisiblePreviewFromHuman();
      return;
    }
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
      openAssemblyCommand(command);
    } catch (error) { say(String(error?.message || error)); }
  }));
  document.querySelectorAll('[data-assembly-mate]').forEach((button) => button.addEventListener('click', () => openAssemblyCommand('mate', button.dataset.assemblyMate)));

  async function executeV5Inspection(inspectionMode) {
    if (!v5RuntimeTools.isStudioV5Project(doc)) throw new Error('Engineering inspection requires a schema-5 project.');
    const selected = inspectionMode === 'measurements' ? [] : inspectionResultsForSelection().map((entry) => entry.bodyId);
    if (inspectionMode === 'clearance' && selected.length !== 2) throw new Error('Select exactly two bodies or one two-body subassembly for clearance.');
    const sourceRevision = documentRevision;
    const sourceHash = v5RuntimeTools.studioV5CanonicalHash(doc);
    const options = {
      mode: inspectionMode,
      ...((inspectionMode === 'interference' && selected.length === 0) || inspectionMode === 'measurements' ? {} : { bodyIds: selected }),
      ...(inspectionMode === 'clearance' ? { pairBodyIds: selected } : {}),
    };
    const response = await kernelCall('inspect-v5', documentRevision, options);
    if (sourceRevision !== documentRevision || sourceHash !== v5RuntimeTools.studioV5CanonicalHash(doc)) {
      throw new Error('Inspection became stale after the project changed. Run it again.');
    }
    if (!response.inspection) throw new Error(response.errors?.[0]?.message || 'No inspection result was produced.');
    lastInspection = { ...response.inspection, errors: response.errors || [] };
    renderContext();
    if (response.errors?.length) throw new Error(response.errors[0].message);
    return lastInspection;
  }

  async function runV5Inspection(inspectionMode) {
    try {
      const result = await executeV5Inspection(inspectionMode);
      const count = result.bodyCount;
      const interferenceCount = result.pairs.filter((pair) => pair.interferenceVolumeMm3 > 1e-8).length;
      say(inspectionMode === 'interference' ? interferenceCount + ' interfering pair' + (interferenceCount === 1 ? '' : 's') + ' found.' : inspectionMode === 'clearance' ? 'Exact minimum clearance calculated.' : inspectionMode === 'measurements' ? result.measurementResults.length + ' saved measurement' + (result.measurementResults.length === 1 ? '' : 's') + ' evaluated.' : 'Mass and health updated for ' + count + ' bod' + (count === 1 ? 'y.' : 'ies.'));
    } catch (error) {
      say('Inspection failed: ' + String(error?.message || error));
    }
  }

  document.querySelectorAll('[data-inspection-command]').forEach((button) => button.addEventListener('click', () => {
    const command = button.dataset.inspectionCommand;
    if (['section', 'explode', 'stage', 'material', 'measure'].includes(command)) openInspectionCommand(command);
    else runV5Inspection(command);
  }));
  document.querySelectorAll('[data-display-mode]').forEach((button) => button.addEventListener('click', () => {
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'assembly') return say('Assembly display modes require an assembly document.');
    const displayMode = button.dataset.displayMode;
    v6DisplayModeOverride = undefined;
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

  function activeV6DisplayMode() {
    if (v6DisplayModeOverride !== undefined) return v6DisplayModeOverride;
    return v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly'
      ? v5RuntimeTools.studioV5RootAssembly(doc).metadata?.displayMode || 'shaded-edges'
      : 'shaded-edges';
  }

  function activeV6SectionId() {
    if (v6ActiveSectionOverride !== undefined) return v6ActiveSectionOverride;
    return v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly'
      ? v5RuntimeTools.studioV5RootAssembly(doc).metadata?.activeSectionViewId || null
      : null;
  }

  function activeV6ExplodedViewId() {
    if (v6ActiveExplodedViewOverride !== undefined) return v6ActiveExplodedViewOverride;
    return v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly'
      ? v5RuntimeTools.studioV5RootAssembly(doc).metadata?.activeExplodedViewId || null
      : null;
  }

  function activeV6ExplodedTransforms() {
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'assembly') return new Map();
    if (v6ActiveExplodedViewOverride === undefined) return v5InspectionTools.studioV5ActiveExplodedTransforms(doc);
    const assembly = v5RuntimeTools.studioV5RootAssembly(doc);
    const active = assembly.explodedViews.find((entry) => entry.id === v6ActiveExplodedViewOverride);
    const transforms = new Map();
    if (!active) return transforms;
    for (const step of active.steps) {
      for (const occurrenceId of step.occurrenceIds) {
        transforms.set(occurrenceId, v5AssemblyTools.studioV5MultiplyMatrices(
          step.deltaTransform,
          transforms.get(occurrenceId) || v5AssemblyTools.studioV5IdentityMatrix(),
        ));
      }
    }
    return transforms;
  }

  function activeSectionPlanes(result) {
    if (!v5RuntimeTools.isStudioV5Project(doc) || doc.rootDocument?.kind !== 'assembly') return { planes: [], intersection: false };
    const assembly = v5RuntimeTools.studioV5RootAssembly(doc);
    const section = assembly.sectionViews.find((entry) => entry.id === activeV6SectionId());
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
    const section = assembly.sectionViews.find((entry) => entry.id === activeV6SectionId());
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

  function v6SelectedBodyIds() {
    const ids = new Set();
    for (const ref of currentV6Selections()) {
      if (ref.owner?.kind === 'body') ids.add(ref.owner.id);
      if (ref.kind === 'body') ids.add(ref.id);
      if (ref.kind === 'occurrence') {
        for (const result of lastBodyResults.filter((entry) => entry.occurrenceInstance?.occurrencePath?.includes(ref.id))) ids.add(result.bodyId);
      }
      if (ref.kind === 'feature') {
        const feature = doc.features.find((entry) => entry.id === ref.id);
        if (feature?.createdBodyId) ids.add(feature.createdBodyId);
        for (const id of feature?.resultPolicy?.targetBodyIds || []) ids.add(id);
      }
    }
    return ids;
  }

  function syncV6TreeSelectionClasses() {
    const selections = currentV6Selections();
    const entityKeys = new Set(selections.map((entry) => entry.owner || entry).map((entry) => entry.kind + ':' + entry.id));
    for (const row of document.querySelectorAll('[data-body-id], [data-occurrence-id], [data-runtime-occurrence-id], #bw-history [data-sel]')) {
      const kind = row.dataset.bodyId
        ? 'body'
        : row.dataset.occurrenceId || row.dataset.runtimeOccurrenceId
          ? 'occurrence'
          : 'feature';
      const id = row.dataset.bodyId || row.dataset.occurrenceId || row.dataset.runtimeOccurrenceId || row.dataset.sel;
      const selected = entityKeys.has(kind + ':' + id);
      row.classList.toggle('is-agent-selected', selected && selections.length > 1);
      if (selected && selections.length > 1) row.setAttribute('aria-selected', 'true');
    }
  }

  function clearV6SelectionOverlays() {
    for (const object of v6SelectionOverlayObjects) {
      object.parent?.remove(object);
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    }
    v6SelectionOverlayObjects = [];
  }

  function v6SelectionClippingPlanes(bodyId) {
    const result = lastBodyResults.find((entry) => entry.bodyId === bodyId);
    return result ? activeSectionPlanes(result).planes : [];
  }

  function updateV6SelectionVisuals() {
    clearV6SelectionOverlays();
    const topology = v6TopologyInventory();
    for (const ref of currentV6Selections().filter((entry) => entry.owner)) {
      const match = topology.find((entry) =>
        entry.owner.id === ref.owner.id &&
        entry.stableId === ref.stableId &&
        v6CanonicalKey(entry.topologySignature) === v6CanonicalKey(ref.topologySignature));
      if (!match) continue;
      if (match.topologySignature.kind === 'face') {
        const range = faceRanges.find((entry) => entry.bodyId === match.owner.id && entry.faceId === match._faceId);
        const overlay = buildFaceHighlight(range, 0x2ea8ff, 0.62);
        if (overlay && range?.mesh) {
          overlay.material.clippingPlanes = v6SelectionClippingPlanes(match.owner.id);
          overlay.matrix.copy(range.mesh.matrix);
          overlay.matrixAutoUpdate = false;
          overlay.userData.v6SelectionKind = 'face';
          v6SelectionOverlayObjects.push(overlay);
        }
      } else if (match.topologySignature.kind === 'edge' && match._line && match._entry) {
        const source = match._line.geometry?.getAttribute?.('position');
        if (!source) continue;
        const positions = [];
        for (let index = match._entry.start; index < match._entry.start + match._entry.count; index++) {
          positions.push(source.getX(index), source.getY(index), source.getZ(index));
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({
          color: 0x2ea8ff,
          linewidth: 2,
          clippingPlanes: v6SelectionClippingPlanes(match.owner.id),
        });
        const overlay = new THREE.LineSegments(geometry, material);
        overlay.matrix.copy(match._line.matrix);
        overlay.matrixAutoUpdate = false;
        overlay.renderOrder = 5;
        overlay.userData.v6SelectionKind = 'edge';
        partGroup.add(overlay);
        v6SelectionOverlayObjects.push(overlay);
      } else if (match.topologySignature.kind === 'vertex' && match._point) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(match._point, 3));
        const material = new THREE.PointsMaterial({
          color: 0x2ea8ff,
          size: 9,
          sizeAttenuation: false,
          clippingPlanes: v6SelectionClippingPlanes(match.owner.id),
        });
        const overlay = new THREE.Points(geometry, material);
        const owner = bodyMeshes.get(match.owner.id);
        if (owner) overlay.matrix.copy(owner.matrix);
        overlay.matrixAutoUpdate = false;
        overlay.renderOrder = 6;
        overlay.userData.v6SelectionKind = 'vertex';
        partGroup.add(overlay);
        v6SelectionOverlayObjects.push(overlay);
      }
    }
    requestSceneRender();
  }

  function syncInspectionDisplay(bodyId, mesh, result) {
    const explodedByOccurrence = activeV6ExplodedTransforms();
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
    const displayMode = activeV6DisplayMode();
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
    const semanticBodyIds = v6SelectedBodyIds();
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
      const selected = bodyId === selectedBodyId || occurrenceSelected || semanticBodyIds.has(bodyId);
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
    updateV6SelectionVisuals();
    syncV6TreeSelectionClasses();
    rebuildSectionCaps();
    rebuildSceneBatches();
    requestSceneRender();
  }

  function setBodyMeshData(bodies) {
    clearV6SelectionOverlays();
    v6TopologyCache = null;
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
        topologyFaces: mesh.topologyFaces || [], edgeGeometry: edges.geometry, edgeEntries: edges.entries,
        topologyVertices: mesh.topologyVertices || [],
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
      shaded.userData.topologyFaces = template.topologyFaces || [];
      shaded.userData.topologyVertices = template.topologyVertices || [];
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
      select.dataset.v6ControlId = 'tree.entity.datum.select';
      select.innerHTML = '<span>' + datum.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</span><small>' + datum.kind + (datum.suppressed ? ' · suppressed' : '') + (datumError ? ' · repair required' : '') + '</small>';
      if (datumError) select.title = String(datumError?.message || datumError);
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.dataset.datumAction = 'edit';
      edit.dataset.v6ControlId = 'tree.entity.datum.edit';
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
      select.dataset.v6ControlId = 'tree.entity.sketch.select';
      select.innerHTML = '<span>' + sketch.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</span><small>' + sketch.extensions.studioRole + ' · ' + (sketch.entities[0]?.kind || 'curve') + '</small>';
      const edit = document.createElement('button');
      edit.type = 'button'; edit.dataset.sketchAction = 'edit'; edit.textContent = '⋯'; edit.title = 'Edit ' + sketch.name;
      edit.dataset.v6ControlId = 'tree.entity.sketch.edit';
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
      const occurrenceEntity = { kind: 'occurrence', id: occurrence.id };
      const occurrenceExpanded = v6TreeExpansion.get(v6SelectionRefKey(occurrenceEntity)) !== false;
      const row = document.createElement('div');
      row.className = 'assembly-row' + (occurrence.id === selectedOccurrenceId ? ' is-selected' : '') +
        (occurrence.suppressed ? ' is-suppressed' : '') +
        (v6RevealedEntity?.kind === 'occurrence' && v6RevealedEntity.id === occurrence.id ? ' is-agent-revealed' : '');
      row.dataset.occurrenceId = occurrence.id;
      const occurrenceResults = lastBodyResults.filter((entry) => entry.occurrenceInstance?.occurrencePath?.[0] === occurrence.id);
      const occurrenceLeafCount = new Set(occurrenceResults.map((entry) => entry.occurrenceInstance?.occurrenceId).filter(Boolean)).size;
      setTreeItemSemantics(row, {
        selected: occurrence.id === selectedOccurrenceId, expanded: occurrenceExpanded, hidden: occurrence.visible === false,
        suppressed: occurrence.suppressed, failed: !definitionName(occurrence.definition), count: Math.max(1, occurrenceLeafCount), label: occurrence.name,
      });
      const expand = document.createElement('button');
      expand.type = 'button'; expand.dataset.occurrenceAction = 'expand';
      expand.textContent = occurrenceExpanded ? '▾' : '▸';
      expand.title = (occurrenceExpanded ? 'Collapse ' : 'Expand ') + occurrence.name;
      expand.setAttribute('aria-label', expand.title);
      const select = document.createElement('button');
      select.type = 'button'; select.dataset.occurrenceAction = 'select';
      const dof = lastEvaluationTrace?.degreesOfFreedom?.[occurrence.id];
      select.innerHTML = '<span>' + escapeHtml(occurrence.name) + '</span><small>' + escapeHtml(definitionName(occurrence.definition) || 'Missing definition') +
        ' · ' + (occurrence.fixed || dof === 0 ? 'fully constrained' : (dof ?? 6) + ' DOF') + '</small>';
      const visibility = document.createElement('button');
      visibility.type = 'button'; visibility.dataset.occurrenceAction = 'visibility'; visibility.textContent = occurrence.visible ? '●' : '○'; visibility.title = occurrence.visible ? 'Hide component' : 'Show component';
      const suppress = document.createElement('button');
      suppress.type = 'button'; suppress.dataset.occurrenceAction = 'suppress'; suppress.textContent = occurrence.suppressed ? 'R' : 'S'; suppress.title = occurrence.suppressed ? 'Restore component' : 'Suppress component';
      row.append(expand, select, visibility, suppress); tree.appendChild(row);
      const leaves = new Map();
      for (const result of lastBodyResults.filter((entry) => entry.occurrenceInstance?.occurrencePath?.[0] === occurrence.id)) {
        const runtimeOccurrenceId = result.occurrenceInstance.occurrenceId;
        if (!leaves.has(runtimeOccurrenceId)) leaves.set(runtimeOccurrenceId, []);
        leaves.get(runtimeOccurrenceId).push(result);
      }
      for (const [runtimeOccurrenceId, results] of leaves) {
        const child = document.createElement('div');
        child.className = 'assembly-leaf-row' + (runtimeOccurrenceId === selectedOccurrenceId ? ' is-selected' : '') +
          (v6RevealedEntity?.kind === 'occurrence' && v6RevealedEntity.id === runtimeOccurrenceId ? ' is-agent-revealed' : '');
        child.dataset.runtimeOccurrenceId = runtimeOccurrenceId;
        child.dataset.v6TreeParent = v6SelectionRefKey(occurrenceEntity);
        child.hidden = !occurrenceExpanded;
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
        child.className = 'assembly-leaf-row' + (occurrenceId === selectedOccurrenceId ? ' is-selected' : '') +
          (v6RevealedEntity?.kind === 'occurrence' && v6RevealedEntity.id === occurrenceId ? ' is-agent-revealed' : '');
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
    for (const section of assembly.sectionViews) addViewRow(section, section.kind + ' section', activeV6SectionId() === section.id, 'section');
    for (const exploded of assembly.explodedViews) addViewRow(exploded, 'exploded view', activeV6ExplodedViewId() === exploded.id, 'explode');
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
        (bodyBuildErrors.has(body.id) ? ' is-failed' : '') +
        (v6RevealedEntity?.kind === 'body' && v6RevealedEntity.id === body.id ? ' is-agent-revealed' : '');
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
    if (!v6ApplyingSemanticAction) v6SemanticSelection = [];
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
    noteV6HostUiChange('selection.changed', { selection: currentV6Selection() });
  }

  function selectOccurrence(occurrenceId) {
    if (!v6ApplyingSemanticAction) v6SemanticSelection = [];
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
    noteV6HostUiChange('selection.changed', { selection: currentV6Selection() });
  }

  function selectMate(mateId) {
    if (!v6ApplyingSemanticAction) v6SemanticSelection = [];
    pulseInteractiveResolution();
    const mate = v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'assembly'
      ? v5RuntimeTools.studioV5RootAssembly(doc).mates.find((entry) => entry.id === mateId)
      : null;
    if (!mate) return;
    selectedMateId = mate.id;
    selectedOccurrenceId = null;
    selectedBodyId = null;
    selectedFeatureId = null;
    renderHistory();
    renderAssemblyTree();
    renderContext();
    say('Selected ' + mate.kind + ' mate: ' + mate.name + '.');
    noteV6HostUiChange('selection.changed', { selection: currentV6Selection() });
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
    if (action === 'expand') {
      const entity = { kind: 'occurrence', id: occurrence.id };
      const key = v6SelectionRefKey(entity);
      v6TreeExpansion.set(key, v6TreeExpansion.get(key) === false);
      renderAssemblyTree();
      noteV6HostUiChange('ui.changed', { scopes: ['tree'] });
      return;
    }
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
    if (action === 'select') return selectMate(mate.id);
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
      const active = activeV6SectionId() === id;
      v6ActiveSectionOverride = undefined;
      if (action === 'toggle') return commit((active ? 'Turn off ' : 'Activate ') + 'section view', () => v5InspectionTools.activateStudioV5SectionView(doc, active ? null : id));
      if (action === 'delete') return commit('Delete section view', () => v5InspectionTools.deleteStudioV5SectionView(doc, id));
    }
    if (row.dataset.inspectionKind === 'explode') {
      const active = activeV6ExplodedViewId() === id;
      v6ActiveExplodedViewOverride = undefined;
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
  function renderV6RevisionHistory() {
    const list = $('bw-v6-revision-history');
    if (!list) return;
    list.replaceChildren();
    const retained = undoStack.slice(-Math.min(undoStack.length, 20));
    const firstRevision = Math.max(0, commandRevision - retained.length);
    const rows = retained.map((entry, index) => ({
      revision: firstRevision + index,
      label: entry.label || 'Previous document state',
      current: false,
    }));
    rows.push({ revision: commandRevision, label: 'Current document state', current: true });
    for (const entry of rows) {
      const item = document.createElement('li');
      item.className = 'v6-revision-item' +
        (entry.revision === v6HistoryRevision ? ' is-agent-revealed' : '');
      item.dataset.v6Revision = String(entry.revision);
      item.setAttribute('aria-label', 'Project revision ' + entry.revision + ': ' + entry.label);
      if (entry.current) item.setAttribute('aria-current', 'true');
      item.innerHTML =
        '<span class="hi-glyph" aria-hidden="true">R' + entry.revision + '</span>' +
        '<span class="hi-n">Project revision ' + entry.revision + '</span>' +
        '<small>' + escapeHtml(entry.label) + (entry.current ? ' · current' : '') + '</small>';
      list.appendChild(item);
    }
  }

  function renderHistory() {
    const list = $('bw-history');
    list.innerHTML = '';
    renderV6RevisionHistory();
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
      li.className = 'hist-item' + (buildErrors.has(f.id) ? ' err' : '') + (f.id === selectedFeatureId ? ' sel' : '') +
        (f.id === rollbackFeatureId ? ' rollback' : '') + (rollbackIndex >= 0 && i > rollbackIndex ? ' rolled-back' : '') +
        (v6RevealedEntity?.kind === 'feature' && v6RevealedEntity.id === f.id ? ' is-agent-revealed' : '');
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
          '<div class="param-row" data-parameter-id="' + escAttr(p.id || p.name) + '">' +
          '<input type="text" data-pname="' + i + '" value="' + escAttr(p.name) + '" spellcheck="false" />' +
          '<span>=</span>' +
          '<input type="text" inputmode="decimal" data-pval="' + i + '" value="' + escAttr(p.value) + '" />' +
          '<button data-pdel="' + i + '" title="Remove">×</button>' +
          '</div>',
      )
      .join('');
    for (const operation of v6DirectParameterPreviewOperations) {
      const input = operation.input || {};
      if (operation.kind === 'parameter.create') {
        const row = document.createElement('div');
        row.className = 'param-row is-agent-revealed';
        row.dataset.parameterId = String(input.id || 'new-parameter');
        row.dataset.agentDraft = 'create';
        row.setAttribute('aria-label', `Preview new parameter ${input.name} = ${input.value}`);
        const name = document.createElement('input');
        name.type = 'text';
        name.value = String(input.name ?? '');
        name.readOnly = true;
        name.dataset.agentDraft = 'true';
        name.dataset.previewParameterName = 'true';
        name.spellcheck = false;
        const equals = document.createElement('span');
        equals.textContent = '=';
        const value = document.createElement('input');
        value.type = 'text';
        value.inputMode = 'decimal';
        value.value = String(input.value ?? '');
        value.readOnly = true;
        value.dataset.agentDraft = 'true';
        value.dataset.previewParameterValue = 'true';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.disabled = true;
        remove.title = 'Pending parameter creation';
        remove.textContent = '×';
        row.append(name, equals, value, remove);
        wrap.appendChild(row);
        continue;
      }
      const parameter = typeof input.parameterId === 'string'
        ? (doc.params || []).find((entry) => entry.id === input.parameterId)
        : (doc.params || []).find((entry) => entry.name === input.parameterName);
      if (!parameter) continue;
      const row = wrap.querySelector(`[data-parameter-id="${CSS.escape(parameter.id || parameter.name)}"]`);
      if (!row) continue;
      row.classList.add('is-agent-revealed');
      row.dataset.agentDraft = operation.kind === 'parameter.delete' ? 'delete' : 'update';
      if (operation.kind === 'parameter.delete') {
        row.setAttribute('aria-label', `Preview deletion of parameter ${parameter.name}`);
        row.querySelectorAll('input,button').forEach((control) => control.dataset.agentDeletePreview = 'true');
        continue;
      }
      const name = row.querySelector('[data-pname]');
      const value = row.querySelector('[data-pval]');
      if (input.name != null && name) name.value = String(input.name);
      if (input.value != null && value) value.value = String(input.value);
      row.querySelectorAll('input').forEach((control) => control.dataset.agentDraft = 'true');
      row.setAttribute('aria-label',
        `Preview parameter ${input.name ?? parameter.name} = ${input.value ?? parameter.value}`);
    }
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
      commandRevision,
    };
    const previousStorageWrite = latestStorageWrite;
    latestStorageWrite = previousStorageWrite.catch(() => {}).then(() => journalReady).then((journal) => {
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
          commandRevision = restored.commandRevision;
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
    if (v5RuntimeTools.isStudioV5Project(doc)) projectId = doc.projectId;
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
  async function prepareImportedProject(bytes, format, filename) {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error('The selected artifact is empty.');
    if (format === 'step') {
      const importProjectId = projectId;
      const importRevision = documentRevision;
      const response = await importStepWithKernelRecovery(
        new Blob([bytes], { type: 'model/step' }),
        filename,
        importRevision,
      );
      if (projectId !== importProjectId || documentRevision !== importRevision) {
        throw new agentTools.CadAgentError('REVISION_CONFLICT', 'STEP import was discarded because the project changed while the file was loading.');
      }
      return {
        document: v5RuntimeTools.decorateStudioV5Project(v5RuntimeTools.canonicalStudioV5Project(response.project)),
        manifest: response.manifest,
      };
    }
    return {
      document: v5RuntimeTools.parseOrMigrateStudioV5RuntimeProject(new TextDecoder().decode(bytes)),
      manifest: null,
    };
  }

  function importedProjectMessage(importManifest) {
    return importManifest
      ? 'STEP imported as ' + importManifest.bodyCount + ' exact bod' + (importManifest.bodyCount === 1 ? 'y definition' : 'y definitions') +
        (importManifest.importMode === 'bomwiki-solved-hierarchy'
          ? ' with solved assembly hierarchy.'
          : importManifest.importMode === 'external-product-hierarchy'
            ? ' with recovered external product hierarchy.'
            : ' with a flat solid fallback; external product hierarchy was not available.')
      : 'Project opened.';
  }

  async function activateImportedProject(imported, filename, { preserveAgent = false } = {}) {
    await save('Before opening ' + filename);
    projectId = imported.document.projectId || makeProjectId();
    doc = normalizeDoc(imported.document);
    undoStack.length = 0;
    redoStack.length = 0;
    resetAgentForProjectChange('Opened another project', { preserveConnection: preserveAgent });
    setFlag(SEEDED);
    setFlag(WELCOME);
    hideWelcome();
    afterDocumentChange('Opened ' + filename);
    const message = importedProjectMessage(imported.manifest);
    say(message);
    let settledUiRevision = null;
    if (preserveAgent) {
      const runtime = getV6InteractionRuntime();
      runtime.hostChanged('document.changed', {
        revision: commandRevision,
        label: 'Opened ' + filename,
        actor: 'agent',
        projectTransition: true,
        documentHash: v5RuntimeTools.studioV5CanonicalHash(doc),
      }, { actor: 'agent' });
      await Promise.all([
        latestStorageWrite,
        waitForV6UiSettlement(null, { targetUiRevision: runtime.uiRevision }),
      ]);
      settledUiRevision = runtime.uiRevision;
    }
    return {
      projectId,
      revision: commandRevision,
      title: doc.title,
      documentHash: v5RuntimeTools.studioV5CanonicalHash(doc),
      importManifest: deepCopy(imported.manifest),
      message,
      ...(settledUiRevision === null ? {} : { uiRevision: settledUiRevision }),
    };
  }

  $('bw-open-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // allow re-opening the same file later
    let imported;
    const format = /\.(step|stp)$/i.test(file.name) ? 'step' : 'project';
    try {
      imported = await prepareImportedProject(new Uint8Array(await file.arrayBuffer()), format, file.name);
    } catch (error) {
      return say((format === 'step' ? 'Could not import STEP: ' : 'Could not open project: ') + String(error?.message || error));
    }
    // Replacing the document while an editor is open must go through the
    // coordinator: prompt for a dirty draft, cancel editors, then switch
    // projects atomically without merging their command journals.
    startOperation(() => activateImportedProject(imported, file.name), {
      nextLabel: 'open “' + file.name + '”',
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
    wrap.addEventListener('input', captureV6HumanCommandInput);
    wrap.addEventListener('change', captureV6HumanCommandInput);
    pressPull.addEventListener('input', captureV6HumanCommandInput);
    pressPull.addEventListener('change', captureV6HumanCommandInput);
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
    // Constraint-driven sketches: the draft's sketch.constrained is the
    // source of truth; the solver renders solved geometry and the panel
    // edits driving dimensions. Legacy shapes stay the display fallback.
    let solverModulePromise = null;
    let solverModule = null; // resolved module — lets post-preload work run synchronously
    let solvedConstrained = null; // last solve of the draft's constrained sketch
    let solveGeneration = 0;
    let dimBadgeHits = []; // canvas-space boxes for click-to-edit dimensions
    const isConstrained = () => Boolean(feature?.sketch?.constrained);
    function ensureSolver() {
      if (!solverModulePromise) {
        solverModulePromise = import('/static/studio-sketch-solver.js').then((module) => (solverModule = module));
      }
      return solverModulePromise;
    }
    let inferModulePromise = null;
    let inferModule = null;
    function ensureInfer() {
      if (!inferModulePromise) {
        inferModulePromise = import('/static/studio-sketch-infer.js').then((module) => (inferModule = module));
      }
      return inferModulePromise;
    }
    // Once open() has preloaded a module, callers run synchronously so the
    // close-click -> region-recognized flow has no visible async gap.
    function withModule(loaded, ensure, run) {
      if (loaded()) { run(); return; }
      ensure().then(() => run()).catch(() => {});
    }
    // Drawing on a blank sketch (or on an already-constrained one) builds
    // constrained geometry with inferred constraints instead of legacy shapes.
    const constrainedDrawing = () => isConstrained() || feature?.sketch?.shapes?.length === 0;
    function materializeConstrainedChain(rawPts) {
      withModule(() => inferModule && solverModule, () => Promise.all([ensureInfer(), ensureSolver()]), () => {
        const infer = inferModule;
        const existing = feature?.sketch?.constrained || null;
        const prefix = 'sk' + (existing ? existing.entities.length : 0);
        const working = { entities: existing ? [...existing.entities] : [], constraints: [] };
        const hasFixed = working.entities.some((entity) => entity.kind === 'point' && entity.fixed);
        const newEntities = [];
        const newConstraints = [];
        const anchorIds = [];
        let pointSeq = 0;
        let lineSeq = 0;
        let prevId = null;
        const snapRadiusMm = Math.max(0.75, 10 / view.pxPerMm);
        for (let index = 0; index <= rawPts.length; index++) {
          const isClose = index === rawPts.length;
          const raw = isClose ? rawPts[0] : rawPts[index];
          const placement = infer.inferLinePlacement({ sketch: working, fromPointId: prevId, at: raw, snapRadiusMm });
          let pointId = placement.coincidentWith;
          if (isClose && !pointId) pointId = anchorIds[0];
          if (!pointId) {
            pointId = prefix + '-p' + (pointSeq++);
            const entity = { id: pointId, kind: 'point', at: [placement.at[0], placement.at[1]], ...(!hasFixed && index === 0 ? { fixed: true } : {}) };
            working.entities.push(entity);
            newEntities.push(entity);
          }
          if (prevId && prevId !== pointId) {
            const lineId = prefix + '-l' + (lineSeq++);
            const line = { id: lineId, kind: 'line', a: prevId, b: pointId };
            working.entities.push(line);
            newEntities.push(line);
            for (const inferred of placement.constraints) newConstraints.push({ ...inferred, line: lineId });
          }
          if (!isClose) anchorIds.push(pointId);
          prevId = pointId;
        }
        feature.sketch.constrained = {
          entities: [...(existing?.entities || []), ...newEntities],
          constraints: [...(existing?.constraints || []), ...newConstraints],
        };
        resolveConstrained();
        syncDofPill();
        syncShapePanel();
        captureV6HumanCommandInput({ target: { name: 'sketch' } });
      });
    }
    function materializeConstrainedRecipe(shape) {
      withModule(() => inferModule && solverModule, () => Promise.all([ensureInfer(), ensureSolver()]), () => {
        const infer = inferModule;
        const existing = feature?.sketch?.constrained || null;
        const prefix = 'sk' + (existing ? existing.entities.length : 0);
        const recipe = shape.kind === 'rect'
          ? infer.constrainedRectangle({ corner: [shape.ax, shape.ay], opposite: [2 * shape.x - shape.ax, 2 * shape.y - shape.ay], idPrefix: prefix })
          : infer.constrainedCircle({ center: [shape.x, shape.y], radiusPoint: [shape.x + shape.r, shape.y], idPrefix: prefix });
        if (!recipe) {
          say('Click the opposite corner a little further away (1 mm minimum).');
          return;
        }
        if (existing?.entities.some((entity) => entity.kind === 'point' && entity.fixed)) {
          for (const entity of recipe.entities) delete entity.fixed;
        }
        feature.sketch.constrained = existing
          ? { entities: [...existing.entities, ...recipe.entities], constraints: [...existing.constraints, ...recipe.constraints] }
          : recipe;
        resolveConstrained();
        syncDofPill();
        syncShapePanel();
        captureV6HumanCommandInput({ target: { name: 'sketch' } });
      });
    }
    function sampleArcPoints(segment, steps) {
      const [cx, cy] = segment.center;
      const start = Math.atan2(segment.a[1] - cy, segment.a[0] - cx);
      const end = Math.atan2(segment.b[1] - cy, segment.b[0] - cx);
      let delta = end - start;
      if (segment.ccw === false) { while (delta >= 0) delta -= Math.PI * 2; }
      else { while (delta <= 0) delta += Math.PI * 2; }
      const radius = Math.hypot(segment.a[0] - cx, segment.a[1] - cy);
      return Array.from({ length: steps + 1 }, (_, index) => {
        const angle = start + (delta * index) / steps;
        return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
      });
    }
    function constrainedLoopsToShapes(loops) {
      const shapes = [];
      for (const loop of loops) {
        if (loop.kind === 'circle') { shapes.push({ kind: 'circle', x: loop.center[0], y: loop.center[1], r: loop.r }); continue; }
        const pts = [];
        for (const segment of loop.segments) {
          if (!pts.length) pts.push([segment.a[0], segment.a[1]]);
          if (segment.kind === 'line') { pts.push([segment.b[0], segment.b[1]]); continue; }
          for (const p of sampleArcPoints(segment, 32).slice(1)) pts.push(p);
        }
        if (pts.length > 1) {
          const first = pts[0], last = pts[pts.length - 1];
          if (Math.abs(first[0] - last[0]) <= 1e-9 && Math.abs(first[1] - last[1]) <= 1e-9) pts.pop();
        }
        shapes.push({ kind: 'poly', pts, closed: true });
      }
      return shapes;
    }
    function resolveConstrained() {
      if (!isConstrained()) return;
      const constrained = feature.sketch.constrained;
      const ticket = ++solveGeneration;
      withModule(() => solverModule, ensureSolver, () => {
        const solver = solverModule;
        if (ticket !== solveGeneration || !feature?.sketch || feature.sketch.constrained !== constrained) return;
        let result;
        try {
          result = solver.solveSketch(constrained, { resolveDimension: (value) => N(value) });
        } catch (error) {
          solvedConstrained = { status: 'invalid', diagnostics: [{ message: String(error?.message || error) }], byId: new Map() };
          syncDofPill();
          return;
        }
        const byId = new Map((result.entities || []).map((entity) => [entity.id, entity]));
        if (result.status === 'ok') {
          const loopResult = solver.constraintSketchToLoops(constrained, { presolved: result });
          solvedConstrained = { ...result, byId, loops: loopResult.status === 'ok' ? loopResult.loops : null };
          if (loopResult.status === 'ok') {
            feature.sketch.shapes = constrainedLoopsToShapes(loopResult.loops);
            // Constrained mode has no shape-level selection; keep the latest
            // regenerated profile selected so Press / Pull stays reachable.
            selShape = feature.sketch.shapes[feature.sketch.shapes.length - 1] || null;
          }
        } else {
          solvedConstrained = { ...result, byId, loops: null };
        }
        syncDofPill();
        draw2d();
      });
    }
    function syncDofPill() {
      const pill = $('bw-sk-dof');
      if (!pill) return;
      if (!isConstrained()) { pill.hidden = true; return; }
      pill.hidden = false;
      if (!solvedConstrained) { pill.className = 'sk-dof is-open'; pill.textContent = 'Solving…'; return; }
      if (solvedConstrained.status === 'ok') {
        if (solvedConstrained.dof === 0) { pill.className = 'sk-dof is-defined'; pill.textContent = 'Fully defined'; }
        else { pill.className = 'sk-dof is-open'; pill.textContent = solvedConstrained.dof + ' DOF remaining'; }
      } else {
        const first = (solvedConstrained.diagnostics || [])[0];
        pill.className = 'sk-dof is-conflict';
        pill.textContent = 'Conflict' + (first?.constraintId ? ': ' + first.constraintId : first?.constraintKind ? ': ' + first.constraintKind : '');
      }
    }

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
      solvedConstrained = null;
      setTool(isConstrained() ? 'select' : 'rect');
      syncDofPill();
      // Preload the solver and inference modules so drawing and dimension
      // edits run without a visible async gap.
      ensureSolver();
      ensureInfer();
      if (isConstrained()) resolveConstrained();
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

    function snapshot() {
      if (!feature) return null;
      const next = deepCopy(feature);
      next.h = readDim(pressPull.hidden ? 'bw-sk-op-h' : 'bw-presspull-h', 'Height');
      next.through = $('bw-sk-through').checked;
      const patternKind = $('bw-sk-pat').value;
      if (feature.type === 'revolve' || patternKind === 'none') {
        delete next.pattern;
      } else {
        const n = Number($('bw-sk-pat-n').value);
        const a = readDim('bw-sk-pat-a', patternKind === 'circular' ? 'Centre X' : 'ΔX');
        const b = readDim('bw-sk-pat-b', patternKind === 'circular' ? 'Centre Y' : 'ΔY');
        next.pattern = patternKind === 'circular'
          ? { kind: 'circular', n, cx: a, cy: b }
          : { kind: 'linear', n, dx: a, dy: b };
      }
      if (!$('bw-sk-result-row').hidden) {
        const kind = $('bw-sk-result').value;
        next.resultPolicy = kind === 'new-body'
          ? { kind, bodyName: $('bw-sk-body-name').value.trim() }
          : {
              kind,
              targetBodyIds: [$('bw-sk-target').value],
              ...(kind === 'subtract' || kind === 'intersect' ? { keepTools: false } : {}),
            };
      }
      return next;
    }

    function setSemanticInput(fieldId, value) {
      if (!feature) return false;
      if (fieldId === 'sketch') {
        if (!Array.isArray(value)) return false;
        feature.sketch.shapes = deepCopy(value);
        selShape = feature.sketch.shapes.at(-1) || null;
        draw2d();
        syncShapePanel();
        return true;
      }
      if (fieldId === 'height') {
        $('bw-sk-op-h').value = String(value);
        if (!pressPull.hidden) {
          $('bw-presspull-h').value = String(value);
          const numeric = Number(value);
          if (Number.isFinite(numeric) && numeric >= 0.5 && numeric <= 10000) renderPressPullPreview(numeric);
        }
        feature.h = deepCopy(value);
        return true;
      }
      if (fieldId === 'through') {
        $('bw-sk-through').checked = Boolean(value);
        feature.through = Boolean(value);
        return true;
      }
      if (fieldId === 'patternKind') {
        $('bw-sk-pat').value = String(value);
        if ($('bw-sk-pat').value !== String(value)) return false;
        syncPatternFields();
        return true;
      }
      if (fieldId === 'patternCount') {
        $('bw-sk-pat-n').value = String(value);
        return true;
      }
      if (fieldId === 'patternA') {
        $('bw-sk-pat-a').value = String(value);
        return true;
      }
      if (fieldId === 'patternB') {
        $('bw-sk-pat-b').value = String(value);
        return true;
      }
      if (fieldId === 'resultPolicy') {
        $('bw-sk-result').value = String(value);
        if ($('bw-sk-result').value !== String(value)) return false;
        syncResultFields();
        return true;
      }
      if (fieldId === 'bodyName') {
        $('bw-sk-body-name').value = String(value ?? '');
        return true;
      }
      return false;
    }

    function setSemanticSelection(fieldId, entities) {
      if (!feature) return false;
      if (fieldId === 'targetBody') {
        const bodyId = entities[0]?.id || '';
        $('bw-sk-target').value = bodyId;
        return Boolean(bodyId) && $('bw-sk-target').value === bodyId;
      }
      if (fieldId !== 'supportFace') return false;
      if (!entities.length) {
        delete feature.onFace;
        feature.inputRefs = (feature.inputRefs || []).filter((entry) => entry.semanticPath?.role !== 'support-face');
        refOutline = [];
        draw2d();
        return true;
      }
      const ref = entities[0];
      const match = v6TopologyInventory().find((entry) =>
        entry.owner.id === ref.owner?.id &&
        entry.stableId === ref.stableId &&
        v6CanonicalKey(entry.topologySignature) === v6CanonicalKey(ref.topologySignature));
      const range = match && faceRanges.find((entry) => entry.bodyId === match.owner.id && entry.faceId === match._faceId);
      const face = faceForRange(range);
      if (!face) return false;
      feature.onFace = faceSig(face);
      feature.inputRefs = [
        ...(feature.inputRefs || []).filter((entry) => entry.semanticPath?.role !== 'support-face'),
        {
          ownerKind: 'body',
          ownerId: ref.owner.id,
          semanticPath: { role: 'support-face' },
          signature: deepCopy(ref.topologySignature),
        },
      ];
      refOutline = deepCopy(face.outline || []);
      draw2d();
      return true;
    }

    function close(applyIt) {
      if (applyIt && v6AgentCommandDraft) {
        void commitV6VisiblePreviewFromHuman();
        return;
      }
      if (!applyIt) cancelV6DraftFromHumanSurface();
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
        if (isConstrained() && solvedConstrained && solvedConstrained.status !== 'ok') {
          return say('Resolve the sketch conflict before applying — ' + ((solvedConstrained.diagnostics || [])[0]?.message || 'constraints do not solve.'));
        }
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
      // shapes (constrained sketches draw exact solved entities instead)
      if (isConstrained()) {
        drawConstrainedSketch();
      } else {
        for (const s of feature.sketch.shapes) {
          ctx.strokeStyle = s === selShape ? '#4c9aff' : '#cfdcea';
          ctx.fillStyle = s === selShape ? 'rgba(76,154,255,0.16)' : 'rgba(207,220,234,0.08)';
          ctx.lineWidth = 2;
          pathShape(s);
          ctx.fill();
          ctx.stroke();
        }
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
    function drawConstrainedSketch() {
      dimBadgeHits = [];
      const constrained = feature.sketch.constrained;
      const byId = solvedConstrained?.byId || new Map();
      const entMap = new Map(constrained.entities.map((entity) => [entity.id, entity]));
      const at = (id) => byId.get(id)?.at || entMap.get(id)?.at || [0, 0];
      // solid geometry
      ctx.lineWidth = 2;
      for (const entity of constrained.entities) {
        ctx.strokeStyle = entity.construction ? '#7a90a8' : '#cfdcea';
        ctx.setLineDash(entity.construction ? [4, 4] : []);
        if (entity.kind === 'line') {
          const [ax, ay] = toPx(...at(entity.a));
          const [bx, by] = toPx(...at(entity.b));
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        } else if (entity.kind === 'circle') {
          const solved = byId.get(entity.id);
          const radius = Math.max(0.05, solved?.solvedR ?? NS(entity.r, 1));
          const [cx, cy] = toPx(...at(entity.center));
          ctx.beginPath(); ctx.arc(cx, cy, radius * view.pxPerMm, 0, Math.PI * 2); ctx.stroke();
        } else if (entity.kind === 'arc') {
          const pts = sampleArcPoints({ center: at(entity.center), a: at(entity.a), b: at(entity.b), ccw: entity.ccw !== false }, 40);
          ctx.beginPath();
          pts.forEach((p, index) => {
            const [px, py] = toPx(p[0], p[1]);
            index ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          });
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      // points (fixed points ringed green)
      for (const entity of constrained.entities) {
        if (entity.kind !== 'point') continue;
        const [px, py] = toPx(...at(entity.id));
        ctx.fillStyle = '#9fd1ff';
        ctx.beginPath(); ctx.arc(px, py, entity.fixed ? 4 : 3, 0, Math.PI * 2); ctx.fill();
        if (entity.fixed) { ctx.strokeStyle = '#65c18c'; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
      // constraint badges + dimension labels
      const lineMid = (line) => { const a = at(line.a), b = at(line.b); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
      const GLYPH = { horizontal: 'H', vertical: 'V', parallel: '∥', perpendicular: '⊥', tangent: '⌒', equal: '=', concentric: '◎', midpoint: '◈', symmetric: '⇔', pointOnLine: '⌁', pointOnCircle: '◦' };
      const anchorOf = (constraint) => {
        const ref = (id) => (id ? entMap.get(id) : null);
        const line = ref(constraint.line);
        if (line) return lineMid(line);
        const circle = ref(constraint.circle);
        if (circle) return at(circle.center);
        const a = ref(constraint.a);
        if (a) {
          if (a.kind === 'line') return lineMid(a);
          if (a.kind === 'circle' || a.kind === 'arc') return at(a.center);
          const pa = at(constraint.a);
          const pb = constraint.b && entMap.get(constraint.b) ? at(constraint.b) : pa;
          return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
        }
        if (ref(constraint.point)) return at(constraint.point);
        return null;
      };
      ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let stack = 0;
      for (const constraint of constrained.constraints || []) {
        if (constraint.kind === 'coincident') continue;
        const anchor = anchorOf(constraint);
        if (!anchor) continue;
        const [px, py] = toPx(anchor[0], anchor[1]);
        if (constraint.value === undefined) {
          const glyph = GLYPH[constraint.kind];
          if (!glyph) continue;
          ctx.fillStyle = 'rgba(36,49,63,0.9)';
          ctx.beginPath(); ctx.arc(px + 11, py - 11, 8, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#8fd0a6';
          ctx.fillText(glyph, px + 11, py - 11);
          continue;
        }
        let resolved = null;
        try { resolved = N(constraint.value); } catch { /* label falls back to the raw expression */ }
        const label = (constraint.kind === 'radius' ? 'R' : constraint.kind === 'angle' ? '∠' : '') +
          (resolved === null ? String(constraint.value) : String(Math.round(resolved * 100) / 100)) +
          (constraint.kind === 'angle' ? '°' : ' mm') +
          (typeof constraint.value === 'string' ? ' ƒ' : '');
        const tw = ctx.measureText(label).width + 12;
        const bx = px - tw / 2, by = py + 10 + (stack % 2) * 19, bh = 16;
        ctx.fillStyle = 'rgba(20,28,38,0.92)';
        ctx.strokeStyle = '#4c9aff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, tw, bh, 4); else ctx.rect(bx, by, tw, bh);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#cfe4ff';
        ctx.fillText(label, bx + tw / 2, by + bh / 2 + 0.5);
        dimBadgeHits.push({ x: bx, y: by, w: tw, h: bh, index: (constrained.constraints || []).indexOf(constraint) });
        stack++;
      }
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
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
      captureV6HumanCommandInput({ target: { name: 'sketch' } });
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
      if (constrainedDrawing()) {
        pending = null;
        materializeConstrainedChain(pts);
        setTool('select');
        draw2d();
        syncShapePanel();
        return true;
      }
      const shape = { kind: 'poly', pts, closed: true };
      feature.sketch.shapes.push(shape);
      selShape = shape;
      pending = null;
      setTool('select');
      draw2d();
      syncShapePanel();
      say('Closed profile recognised — the region is ready to Press / Pull.');
      captureV6HumanCommandInput({ target: { name: 'sketch' } });
      return true;
    }

    function clickAt(mx, my) {
      if (isConstrained()) {
        // Dimension badges are click-to-edit; draw tools fall through and
        // materialize new constrained geometry alongside the existing sketch.
        const [cpx, cpy] = toPx(mx, my);
        const hit = dimBadgeHits.find((box) => cpx >= box.x && cpx <= box.x + box.w && cpy >= box.y && cpy <= box.y + box.h);
        if (hit && tool === 'select') { focusConstraintDim(hit.index); return; }
        if (tool === 'select') return;
        if (tool === 'poly') {
          say('Polygon stays a free shape — use Line to draw constrained profiles.');
          return;
        }
      }
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
      if (constrainedDrawing() && (s.kind === 'rect' || s.kind === 'circle')) {
        pending = null;
        materializeConstrainedRecipe(s);
        draw2d();
        return;
      }
      delete s.ax;
      delete s.ay;
      pending = null;
      feature.sketch.shapes.push(s);
      selShape = s;
      syncShapePanel();
      draw2d();
      captureV6HumanCommandInput({ target: { name: 'sketch' } });
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
    function syncConstraintPanel() {
      const p = $('bw-sk-dims');
      const constrained = feature.sketch.constrained;
      const escAttr = (v) => String(v).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
      const dims = (constrained.constraints || [])
        .map((constraint, index) => ({ constraint, index }))
        .filter(({ constraint }) => constraint.value !== undefined);
      const labelOf = (constraint) => constraint.id
        || (constraint.kind === 'radius' ? 'R ' + (constraint.circle || '') : constraint.kind === 'angle' ? '∠ ' + (constraint.a || '') : constraint.kind + ' ' + (constraint.line || constraint.a || ''));
      p.innerHTML =
        '<span class="sk-note">Constrained · ' + constrained.entities.length + ' entities · ' + (constrained.constraints || []).length + ' constraints</span>' +
        dims.map(({ constraint, index }) =>
          '<label>' + escAttr(labelOf(constraint)) + ' <input type="text" inputmode="decimal" data-cdim="' + index + '" data-v6-control-id="sketch.constraint.dimension" value="' + escAttr(constraint.value) + '" /></label>').join('');
      if (canPressPull()) {
        p.insertAdjacentHTML('beforeend', '<button type="button" class="sk-pull" id="bw-sk-presspull">Press / Pull ↕</button>');
        $('bw-sk-presspull')?.addEventListener('click', startPressPull);
      }
      p.querySelectorAll('[data-cdim]').forEach((inp) =>
        inp.addEventListener('change', () => {
          const raw = inp.value.trim();
          const constraint = (constrained.constraints || [])[Number(inp.dataset.cdim)];
          if (!constraint) return;
          try {
            const evaluated = N(raw);
            if ((constraint.kind === 'radius' || constraint.kind === 'length' || constraint.kind === 'distance') && evaluated <= 0) throw new Error('must be positive');
          } catch (err) {
            say('Not a usable value: ' + String(err?.message || err));
            return;
          }
          constraint.value = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
          resolveConstrained();
          captureV6HumanCommandInput({ target: { name: 'sketch' } });
        }),
      );
    }
    function focusConstraintDim(index) {
      syncShapePanel();
      const input = $('bw-sk-dims').querySelector('[data-cdim="' + index + '"]');
      if (input) { input.focus(); input.select?.(); }
    }
    function syncShapePanel() {
      const p = $('bw-sk-dims');
      if (isConstrained()) {
        syncConstraintPanel();
        return;
      }
      if (!selShape) {
        p.innerHTML = '<span class="sk-note">Nothing selected.</span>';
        return;
      }
      const s = selShape;
      // Dimension fields accept parameter expressions ("wall*2"), so they
      // are text inputs showing the raw stored value.
      const escAttr = (v) => String(v).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
      const dimensionControlIds = {
        w: 'sketch.shape.dimension.w',
        h: 'sketch.shape.dimension.h',
        x: 'sketch.shape.dimension.x',
        y: 'sketch.shape.dimension.y',
        d: 'sketch.shape.dimension.d',
      };
      const num = (label, key, val) =>
        '<label>' + label + ' <input type="text" inputmode="decimal" data-dim="' + key + '" data-v6-control-id="' + dimensionControlIds[key] + '" value="' + escAttr(val) + '" /></label>';
      const dia = typeof s.r === 'number' ? s.r * 2 : '(' + s.r + ')*2';
      if (s.kind === 'rect') p.innerHTML = num('W', 'w', s.w) + num('H', 'h', s.h) + num('X', 'x', s.x) + num('Y', 'y', s.y) + '<button id="bw-sk-delshape" data-v6-control-id="sketch.shape.delete">Delete shape</button>';
      else if (s.kind === 'circle') p.innerHTML = num('Ø', 'd', dia) + num('X', 'x', s.x) + num('Y', 'y', s.y) + '<button id="bw-sk-delshape" data-v6-control-id="sketch.shape.delete">Delete shape</button>';
      else p.innerHTML = '<span class="sk-note">Closed region · ' + s.pts.length + ' edges</span><button id="bw-sk-delshape" data-v6-control-id="sketch.shape.delete">Delete shape</button>';
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
          captureV6HumanCommandInput({ target: { name: 'sketch' } });
        }),
      );
      $('bw-sk-delshape')?.addEventListener('click', () => {
        feature.sketch.shapes = feature.sketch.shapes.filter((x) => x !== selShape);
        selShape = null;
        syncShapePanel();
        draw2d();
        captureV6HumanCommandInput({ target: { name: 'sketch' } });
      });
      $('bw-sk-presspull')?.addEventListener('click', startPressPull);
    }

    return {
      open,
      resize,
      isOpen: () => Boolean(feature),
      activeTool: () => tool,
      setSemanticTool: (toolId) => {
        if (!feature || !['line', 'rect', 'circle', 'poly', 'select', 'pan'].includes(toolId)) return false;
        setTool(toolId);
        return true;
      },
      selectedShapeIndex: () => feature && selShape ? feature.sketch.shapes.indexOf(selShape) : -1,
      setSemanticShapeSelection: (shapeIndex) => {
        if (!feature || !Number.isInteger(shapeIndex) || shapeIndex < 0 || shapeIndex >= feature.sketch.shapes.length) return false;
        selShape = feature.sketch.shapes[shapeIndex];
        syncShapePanel();
        draw2d();
        return true;
      },
      snapshot,
      setSemanticInput,
      setSemanticSelection,
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
      startPressPull: () => {
        if (!canPressPull()) return false;
        startPressPull();
        return true;
      },
      backFromPressPull: () => {
        if (pressPull.hidden || !feature) return false;
        leavePressPull(true);
        return true;
      },
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
    bar.addEventListener('input', captureV6HumanCommandInput);
    bar.addEventListener('change', captureV6HumanCommandInput);
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
      if (applyIt && v6AgentCommandDraft) {
        void commitV6VisiblePreviewFromHuman();
        return;
      }
      if (!applyIt) cancelV6DraftFromHumanSurface();
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
      captureV6HumanCommandInput({ target: { name: 'edges' } });
    }

    function semanticSelections() {
      const selected = [];
      for (const entry of v6TopologyInventory()) {
        if (entry.topologySignature?.kind !== 'edge' || !entry._line || !entry._entry) continue;
        if (entry._line.userData.pickedSignatures?.has(edgeSignatureKey(entry._entry.sig))) {
          selected.push(deepCopy({
            owner: entry.owner,
            stableId: entry.stableId,
            topologySignature: entry.topologySignature,
            expectedGeometry: entry.expectedGeometry,
          }));
        }
      }
      return selected;
    }

    function snapshot() {
      if (!feature) return null;
      const next = deepCopy(feature);
      const raw = $('bw-pick-r').value.trim();
      next.r = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
      const selections = semanticSelections();
      if (selections.length) {
        next.edges = selections.map((entry) => {
          const signature = deepCopy(entry.topologySignature);
          delete signature.kind;
          return signature;
        });
      }
      return next;
    }

    function setSemanticInput(fieldId, value) {
      if (!feature || fieldId !== 'radius') return false;
      $('bw-pick-r').value = String(value);
      feature.r = deepCopy(value);
      return true;
    }

    function setSemanticSelection(fieldId, entities) {
      if (!feature || fieldId !== 'edges') return false;
      const matches = [];
      for (const ref of entities) {
        const match = v6TopologyInventory().find((entry) =>
          entry.topologySignature?.kind === 'edge' &&
          entry.owner.id === ref.owner?.id &&
          entry.stableId === ref.stableId &&
          v6CanonicalKey(entry.topologySignature) === v6CanonicalKey(ref.topologySignature));
        if (!match?._line || !match?._entry) return false;
        matches.push(match);
      }
      for (const line of edgeLines) setEdgePickedSignatures(line);
      for (const line of edgeLines) {
        const signatures = matches.filter((entry) => entry._line === line).map((entry) => entry._entry.sig);
        if (signatures.length) setEdgePickedSignatures(line, signatures);
      }
      touched = true;
      syncCount();
      return true;
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
      snapshot,
      semanticSelections,
      setSemanticInput,
      setSemanticSelection,
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
    agentPreviewIds: () => [...(activeAgentConnection?.previews?.keys() || [])],
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
    frameDigestForTest: () => {
      orbit.update();
      renderScene();
      const gl = renderer.getContext();
      gl.finish();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let hash = 0x811c9dc5;
      let nonzero = 0;
      for (const value of pixels) {
        if (value) nonzero++;
        hash ^= value;
        hash = Math.imul(hash, 0x01000193);
      }
      return { hash: (hash >>> 0).toString(16).padStart(8, '0'), nonzero };
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
    bar.addEventListener('input', captureV6HumanCommandInput);
    bar.addEventListener('change', captureV6HumanCommandInput);
    let feature = null;
    let isNew = false;
    let cycleIdx = -1;
    let cycleMesh = null; // orange preview of the cycled face
    let touched = false;
    let openedT = '';
    let openerEl = null;
    let deferredCommit = null;
    const picked = new Map(); // faceId -> {sig, mesh}

    const targetBodyId = () => feature?.resultPolicy?.targetBodyIds?.[0] || selectedBodyId || null;
    const planarRanges = () => faceRanges.filter((range) =>
      (!targetBodyId() || range.bodyId === targetBodyId()) && faceForRange(range));

    function open(f) {
      if (!bodyMeshes.size || !faceByHash.size) return say('Build something first — Shell hollows an existing part.');
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
          picked.set(r.bodyId + ':' + r.faceId, { sig: faceSig(face), mesh: buildFaceHighlight(r, 0x2e8b57, 0.55) });
        }
      }
      syncCount();
    }
    function close(applyIt) {
      if (applyIt && v6AgentCommandDraft) {
        void commitV6VisiblePreviewFromHuman();
        return;
      }
      if (!applyIt) cancelV6DraftFromHumanSurface();
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
      captureV6HumanCommandInput({ target: { name: 'faces' } });
    }

    function semanticSelections() {
      const ownerBodyId = targetBodyId();
      const selections = [];
      for (const item of picked.values()) {
        const match = v6TopologyInventory().find((entry) =>
          entry.owner.id === ownerBodyId &&
          entry.topologySignature?.kind === 'face' &&
          faceMatches(item.sig, entry.topologySignature));
        if (match) {
          selections.push(deepCopy({
            owner: match.owner,
            stableId: match.stableId,
            topologySignature: match.topologySignature,
            expectedGeometry: match.expectedGeometry,
          }));
        }
      }
      return selections;
    }

    function snapshot() {
      if (!feature) return null;
      const next = deepCopy(feature);
      const raw = $('bw-shell-t').value.trim();
      next.t = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
      const selections = semanticSelections();
      if (selections.length) {
        next.faces = selections.map((entry) => {
          const signature = deepCopy(entry.topologySignature);
          delete signature.kind;
          return signature;
        });
      }
      return next;
    }

    function setSemanticInput(fieldId, value) {
      if (!feature || fieldId !== 'thickness') return false;
      $('bw-shell-t').value = String(value);
      feature.t = deepCopy(value);
      return true;
    }

    function setSemanticSelection(fieldId, entities) {
      if (!feature) return false;
      if (fieldId === 'body') {
        const bodyId = entities[0]?.id || '';
        if (!bodyId || !bodyMeshes.has(bodyId)) return false;
        feature.resultPolicy = { kind: 'add', targetBodyIds: [bodyId] };
        for (const item of picked.values()) dropHighlight(item.mesh);
        picked.clear();
        syncCount();
        return true;
      }
      if (fieldId !== 'faces') return false;
      const matches = [];
      for (const ref of entities) {
        const match = v6TopologyInventory().find((entry) =>
          entry.topologySignature?.kind === 'face' &&
          entry.owner.id === ref.owner?.id &&
          entry.stableId === ref.stableId &&
          v6CanonicalKey(entry.topologySignature) === v6CanonicalKey(ref.topologySignature));
        const range = match && faceRanges.find((entry) =>
          entry.bodyId === match.owner.id && entry.faceId === match._faceId);
        if (!range || !faceForRange(range)) return false;
        matches.push(range);
      }
      for (const item of picked.values()) dropHighlight(item.mesh);
      picked.clear();
      for (const range of matches) {
        const face = faceForRange(range);
        picked.set(range.bodyId + ':' + range.faceId, {
          sig: faceSig(face),
          mesh: buildFaceHighlight(range, 0x2e8b57, 0.55),
        });
      }
      touched = true;
      syncCount();
      return true;
    }

    function toggleRange(range) {
      touched = true;
      const key = range.bodyId + ':' + range.faceId;
      const had = picked.get(key);
      if (had) {
        dropHighlight(had.mesh);
        picked.delete(key);
      } else {
        const face = faceForRange(range);
        picked.set(key, { sig: faceSig(face), mesh: buildFaceHighlight(range, 0x2e8b57, 0.55) });
      }
      syncCount();
    }
    function nextFace() {
      const list = planarRanges();
      if (!list.length) return false;
      cycleIdx = (cycleIdx + 1) % list.length;
      dropHighlight(cycleMesh);
      cycleMesh = buildFaceHighlight(list[cycleIdx], 0xe67e22, 0.45);
      return true;
    }
    $('bw-shell-next').addEventListener('click', nextFace);
    function toggleSelectedFace() {
      const list = planarRanges();
      if (cycleIdx < 0 || !list[cycleIdx]) return false;
      toggleRange(list[cycleIdx]);
      return true;
    }
    $('bw-shell-toggle').addEventListener('click', toggleSelectedFace);

    const ray = new THREE.Raycaster();
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => {
      down = [e.clientX, e.clientY];
    });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!feature || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const targetMesh = bodyMeshes.get(targetBodyId()) || solidMesh;
      if (!targetMesh) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObject(targetMesh, false)[0];
      if (!hit) return;
      const range = rangeForHit(hit);
      if (!faceForRange(range)) return say('That surface is curved — pick a flat face.');
      toggleRange(range);
    });

    return {
      open,
      cancel: () => feature && close(false),
      active: () => Boolean(feature),
      snapshot,
      semanticSelections,
      setSemanticInput,
      setSemanticSelection,
      nextFace,
      toggleSelectedFace,
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
    function useBasePlane() {
      const f = draft;
      const opener = close(true);
      sketch.open(f, { opener });
      return true;
    }
    $('bw-face-base').addEventListener('click', useBasePlane);
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
    function nextFace() {
      const list = planarRanges();
      if (!list.length) {
        say('No flat faces to sketch on yet.');
        return false;
      }
      cycleIdx = (cycleIdx + 1) % list.length;
      showHighlight(list[cycleIdx]);
      $('bw-face-use').hidden = false;
      return true;
    }
    $('bw-face-next').addEventListener('click', nextFace);
    function useSelectedFace() {
      const list = planarRanges();
      const face = cycleIdx >= 0 && list[cycleIdx] && faceForRange(list[cycleIdx]);
      if (!face) return false;
      chooseFace(face, list[cycleIdx]);
      return true;
    }
    $('bw-face-use').addEventListener('click', useSelectedFace);

    function chooseFace(face, range = null) {
      const f = draft;
      f.onFace = faceSig(face);
      if (range?.bodyId) {
        f.inputRefs = [{
          ownerKind: 'body',
          ownerId: range.bodyId,
          semanticPath: { role: 'support-face' },
          signature: { kind: 'face', ...deepCopy(faceSig(face)) },
        }];
      }
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
      chooseFace(face, range);
    });

    return {
      open,
      cancel: () => close(false),
      active: () => Boolean(draft),
      snapshot: () => draft ? deepCopy(draft) : null,
      nextFace,
      useSelectedFace,
      useBasePlane,
    };
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
      activeViewName = 'fit';
      noteV6HostUiChange('ui.changed', { viewport: { viewId: activeViewName } });
      return;
    }
    const d = VIEW_DIRS[name];
    if (!d) return;
    const v = new THREE.Vector3(d[0], d[1], d[2]).normalize().multiplyScalar(r * 1.6);
    camera.position.copy(c.clone().add(v));
    orbit.target.copy(c);
    orbit.update();
    activeViewName = name;
    syncViewPressed(name);
    noteV6HostUiChange('ui.changed', { viewport: { viewId: activeViewName } });
  }
  // Hand-orbiting leaves the preset views; drop their pressed state.
  orbit.addEventListener('start', () => {
    activeViewName = null;
    syncViewPressed(null);
  });
  orbit.addEventListener('end', () => noteV6HostUiChange('ui.changed', { viewport: { viewId: null } }));
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
  function discardDraftAndContinue() {
    const request = takeQueuedOperation();
    if (!request) return false;
    cancelAllEditors();
    runOperation(request.fn);
    // Closing a modal restores its prior focus after this click handler. Move
    // focus back to the newly opened command on the next frame so its Escape
    // and Enter keys are owned by that command, not a now-hidden draft field.
    requestAnimationFrame(focusActiveWorkspace);
    return true;
  }
  $('bw-draft-discard')?.addEventListener('click', discardDraftAndContinue);
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
    commitHumanOperations('Clear part', [{ kind: 'project.clear', input: {} }]);
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
  async function undoProjectTransition() {
    const undo = transitionUndo;
    if (!undo) throw new Error('There is no project transition available to undo.');
    hideTransitionToast(true);
    await undo();
    return {
      projectId,
      revision: commandRevision,
      title: doc.title,
      documentHash: v5RuntimeTools.isStudioV5Project(doc) ? v5RuntimeTools.studioV5CanonicalHash(doc) : null,
    };
  }
  $('bw-transition-close')?.addEventListener('click', hideTransitionToast);
  $('bw-transition-undo')?.addEventListener('click', () => runOperation(undoProjectTransition));

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
      commandRevision,
      title: doc.title,
    };
  }
  async function restoreTemplateTransition(previous, openedTitle, { preserveAgent = false } = {}) {
    await save('Before restoring ' + previous.title);
    projectId = previous.projectId;
    doc = normalizeDoc(deepCopy(previous.document));
    undoStack.splice(0, undoStack.length, ...deepCopy(previous.undoStack));
    redoStack.splice(0, redoStack.length, ...deepCopy(previous.redoStack));
    commandRevision = previous.commandRevision;
    selectedFeatureId = null;
    resetAgentForProjectChange('Restored previous project', {
      preserveConnection: preserveAgent,
      keepRevision: true,
    });
    afterDocumentChange('Restored previous part');
    if (preserveAgent) emitAgentProjectTransition('Restored previous project');
    focusActiveWorkspace();
    requestAnimationFrame(focusActiveWorkspace);
    showTransitionToast('Previous part restored', '“' + openedTitle + '” remains available in Recover.');
  }
  async function openTemplateNow(template, { preserveAgent = false } = {}) {
    const previous = doc.features.length || doc.params.length ? projectTransitionSnapshot() : null;
    const journal = previous ? await journalReady : null;
    let previousSavedToRecovery = false;
    if (previous) {
      await save('Before opening ' + template.name);
      previousSavedToRecovery = Boolean(journal && storageStateEl?.dataset.state === 'saved');
    }
    const { prepareStudioDocument } = await documentToolsReady;
    projectId = makeProjectId();
    const prepared = prepareStudioDocument(structuredClone(template.document));
    doc = normalizeDoc(preserveAgent
      ? v5RuntimeTools.migrateStudioDocumentToV5(prepared, { projectId })
      : prepared);
    undoStack.length = 0;
    redoStack.length = 0;
    selectedFeatureId = null;
    finishWelcome();
    closeTemplateLibrary(true);
    resetAgentForProjectChange('Opened a template', { preserveConnection: preserveAgent });
    afterDocumentChange('Started from ' + template.name);
    if (preserveAgent) emitAgentProjectTransition('Opened template ' + template.name);
    showTransitionToast(
      'Opened “' + template.name + '”',
      previous
        ? previousSavedToRecovery
          ? 'Your previous part was saved to Recover.'
          : 'Local recovery is unavailable — use Undo now.'
        : 'Ready to edit.',
      previous ? () => restoreTemplateTransition(previous, template.name, { preserveAgent }) : null,
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
  function moveTour(direction) {
    if (direction > 0) {
      if (tourIndex >= tourSteps().length - 1) finishTour();
      else {
        tourIndex++;
        renderTourStep();
      }
    } else if (tourIndex > 0) {
      tourIndex--;
      renderTourStep();
    }
  }
  $('bw-tour-next')?.addEventListener('click', () => moveTour(1));
  $('bw-tour-back')?.addEventListener('click', () => moveTour(-1));
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
    const open = !wasOpen;
    if (cls === 'm-open-params') v6PanelOpen.set('inspector', open);
    if (cls === 'm-open-history') {
      v6PanelOpen.set('model-tree', open);
      v6PanelOpen.set('history', open);
    }
    if (cls === 'm-open-project') {
      v6PanelOpen.set('project', open);
      v6ProjectSheetRequested = open;
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
    if (!v6ApplyingSemanticAction) v6SemanticSelection = [];
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
    noteV6HostUiChange('selection.changed', { selection: currentV6Selection() });
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
  function openBasicFeatureCommand(type, { semantic = false, selections = [], forceNewBody = false } = {}) {
    loadKernel();
    const activeBody = v5RuntimeTools.isStudioV5Project(doc) ? v5RuntimeTools.studioV5ActiveBody(doc) : null;
    const semanticBodyId = selections.find((entry) => entry.kind === 'body')?.id
      || selections.find((entry) => entry.owner?.kind === 'body')?.owner.id
      || null;
    const targetBodyId = forceNewBody ? null : semanticBodyId || activeBody?.id || null;
    const nextBodyIndex = v5RuntimeTools.isStudioV5Project(doc) && doc.rootDocument?.kind === 'part'
      ? v5RuntimeTools.studioV5RootPart(doc).bodies.length + 1
      : 1;
    const resultPolicy = targetBodyId
      ? type === 'cut'
        ? { kind: 'subtract', targetBodyIds: [targetBodyId], keepTools: false }
        : { kind: 'add', targetBodyIds: [targetBodyId] }
      : { kind: 'new-body', bodyName: 'Body ' + nextBodyIndex };
    if (type === 'fillet' || type === 'chamfer') {
      picker.open({ id: newId(), type, r: 2, edges: [], resultPolicy });
      if (semantic) {
        const edges = selections.filter((entry) => entry.owner && entry.topologySignature?.kind === 'edge');
        if (edges.length) picker.setSemanticSelection('edges', edges);
      }
      return;
    }
    if (type === 'shell') {
      shellPick.open({ id: newId(), type, t: 2, faces: [], resultPolicy });
      if (semantic) {
        const faces = selections.filter((entry) => entry.owner && entry.topologySignature?.kind === 'face');
        if (faces.length) {
          shellPick.setSemanticSelection('body', [{ kind: 'body', id: faces[0].owner.id }]);
          shellPick.setSemanticSelection('faces', faces);
        }
      }
      return;
    }
    const draft = {
      id: newId(),
      type,
      sketch: { shapes: [], z: 0 },
      h: 20,
      through: type === 'cut',
      resultPolicy,
    };
    const support = semantic && (type === 'extrude' || type === 'cut')
      ? selections.find((entry) => entry.owner && entry.topologySignature?.kind === 'face')
      : null;
    if (support) {
      const match = v6TopologyInventory().find((entry) =>
        entry.owner.id === support.owner.id &&
        entry.stableId === support.stableId &&
        v6CanonicalKey(entry.topologySignature) === v6CanonicalKey(support.topologySignature));
      const range = match && faceRanges.find((entry) => entry.bodyId === match.owner.id && entry.faceId === match._faceId);
      const face = faceForRange(range);
      if (face) {
        draft.onFace = faceSig(face);
        draft.inputRefs = [{
          ownerKind: 'body',
          ownerId: support.owner.id,
          semanticPath: { role: 'support-face' },
          signature: deepCopy(support.topologySignature),
        }];
        sketch.open(draft, { refOutline: deepCopy(face.outline || []) });
        return;
      }
    }
    if (!forceNewBody && (type === 'extrude' || type === 'cut') && solidMesh && faceByHash.size) facePick.open(draft);
    else sketch.open(draft);
  }

  document.querySelectorAll('[data-feat]').forEach((b) =>
    b.addEventListener('click', () => {
      startOperation(() => {
        openBasicFeatureCommand(b.dataset.feat);
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
  function startBlankProject({ preserveAgent = false, context = null } = {}) {
    // Starting blank is a deliberate project choice. Persist that choice so
    // reload never replaces the user's empty canvas with the example part.
    projectId = makeProjectId();
    const blank = { title: 'Untitled part', units: 'mm', params: [], features: [] };
    doc = normalizeDoc(preserveAgent
      ? v5RuntimeTools.migrateStudioDocumentToV5(blank, { projectId })
      : blank);
    undoStack.length = 0;
    redoStack.length = 0;
    resetAgentForProjectChange('Started a blank project', { preserveConnection: preserveAgent });
    finishWelcome();
    afterDocumentChange('Started a blank project');
    if (preserveAgent) {
      emitAgentProjectTransition('Started a blank project');
      return {
        projectId,
        revision: commandRevision,
        documentHash: v5RuntimeTools.studioV5CanonicalHash(doc),
        ...openV6AgentCommand('model.extrude', context, { forceNewBody: true }),
      };
    }
    document.querySelector('[data-feat="extrude"]')?.click();
    if (!hasFlag(TOUR_SEEN)) setTimeout(() => startTour('sketch'), 150);
    return { projectId, revision: commandRevision };
  }
  $('bw-welcome-start')?.addEventListener('click', () => {
    startBlankProject();
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
        '<button type="button" id="bw-v1-notice-dismiss">Got it</button>';
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
    hideWelcome();
    rebuild();
  }
  markWelcomeReady();
})();
