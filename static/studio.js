// BOMwiki CAD Studio v2: real parametric CAD in the browser, no signup.
// Geometry runs on OpenCascade compiled to WebAssembly (via replicad), the
// same B-rep kernel family desktop CAD uses — so features are exact solids,
// dimensions are millimetres, and export includes STEP, not just mesh STL.
//
// The document is a feature history: each feature is a 2D sketch (rectangles,
// circles, polygons with typed dimensions) plus an operation — extrude, cut,
// or revolve. Rebuild replays the history through the kernel, so any
// dimension can be edited later and the part regenerates. The document
// autosaves to localStorage and round-trips as a small JSON project file.
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
  const grid = new THREE.GridHelper(200, 40, 0xb5bfca, 0xe2e7ec);
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
  const MAT = new THREE.MeshStandardMaterial({ color: 0x9fb0c3, metalness: 0.12, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const EDGE_MAT = new THREE.LineBasicMaterial({ color: 0x2c3e50 });

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    sketch.resize();
  }
  new ResizeObserver(resize).observe(stage);
  renderer.setAnimationLoop(() => {
    orbit.update();
    renderer.render(scene, camera);
  });

  // --- kernel (lazy, with progress) ---------------------------------------
  let rc = null; // replicad module
  let kernelReady = null;
  function loadKernel() {
    if (kernelReady) return kernelReady;
    say('Loading the CAD kernel (one-time ~11 MB download, then cached)…', true);
    kernelReady = (async () => {
      const [replicad, ocFactory] = await Promise.all([
        import('/static/vendor/replicad.module.js'),
        import('/static/vendor/replicad-oc.module.js'),
      ]);
      const OC = await ocFactory.default({
        locateFile: () => '/static/vendor/replicad_single.wasm',
      });
      replicad.setOC(OC);
      rc = replicad;
      say('Kernel ready.');
      return replicad;
    })();
    kernelReady.catch(() => say('The CAD kernel failed to load. Reload to retry.', true));
    return kernelReady;
  }

  // --- document ------------------------------------------------------------
  const KEY = 'bw-studio-doc-v2';
  let doc = { features: [] };
  let currentShape = null; // last successful kernel shape

  function newId() {
    return Math.random().toString(36).slice(2, 8);
  }

  const OP_LABEL = { extrude: 'Extrude', cut: 'Cut', revolve: 'Revolve' };

  function shapeToDrawing(s) {
    if (s.kind === 'rect') {
      return rc.drawRectangle(s.w, s.h).translate(s.x, s.y);
    }
    if (s.kind === 'circle') {
      return rc.drawCircle(s.r).translate(s.x, s.y);
    }
    if (s.kind === 'poly') {
      let pen = rc.draw([s.pts[0][0], s.pts[0][1]]);
      for (let i = 1; i < s.pts.length; i++) pen = pen.lineTo([s.pts[i][0], s.pts[i][1]]);
      return pen.close();
    }
    throw new Error('unknown shape');
  }

  function featureSolid(f) {
    // Union all sketch shapes, then apply the operation.
    let solids = [];
    for (const s of f.sketch.shapes) {
      const drawing = shapeToDrawing(s);
      if (f.type === 'revolve') {
        // Lathe: the sketch is a radial profile (x = radius, y = height),
        // revolved around the vertical axis.
        const sk = drawing.sketchOnPlane('XZ');
        solids.push(sk.revolve());
      } else {
        const sk = drawing.sketchOnPlane('XY', f.sketch.z || 0);
        const h = f.type === 'cut' && f.through ? 10000 : f.h;
        const solid = sk.extrude(f.type === 'cut' ? -Math.abs(h) : h);
        solids.push(f.type === 'cut' && f.flip ? solid.mirror('XY') : solid);
      }
    }
    let out = solids[0];
    for (let i = 1; i < solids.length; i++) out = out.fuse(solids[i]);
    return out;
  }

  async function rebuild() {
    if (!doc.features.length) {
      setMesh(null);
      currentShape = null;
      renderHistory();
      return;
    }
    await loadKernel();
    let acc = null;
    let failed = null;
    for (const f of doc.features) {
      try {
        const solid = featureSolid(f);
        if (f.type === 'cut') {
          if (acc) acc = acc.cut(solid);
        } else {
          acc = acc ? acc.fuse(solid) : solid;
        }
        f.error = null;
      } catch (err) {
        f.error = String(err?.message || err);
        failed = f;
      }
    }
    currentShape = acc;
    try {
      setMesh(acc);
    } catch {
      say('Display meshing failed.', false);
    }
    renderHistory();
    if (failed) say(OP_LABEL[failed.type] + ' failed: ' + failed.error);
  }

  function setMesh(shape) {
    while (partGroup.children.length) {
      const c = partGroup.children.pop();
      c.geometry?.dispose();
    }
    if (!shape) return;
    const m = shape.mesh({ tolerance: 0.05, angularTolerance: 0.3 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(m.vertices, 3));
    if (m.normals) geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
    geo.setIndex(m.triangles);
    if (!m.normals) geo.computeVertexNormals();
    partGroup.add(new THREE.Mesh(geo, MAT));
    partGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), EDGE_MAT));
  }

  // --- history panel -------------------------------------------------------
  function renderHistory() {
    const list = $('bw-history');
    list.innerHTML = '';
    doc.features.forEach((f, i) => {
      const li = document.createElement('li');
      li.className = 'hist-item' + (f.error ? ' err' : '');
      const dims =
        f.type === 'revolve'
          ? 'profile ×' + f.sketch.shapes.length
          : (f.through ? 'through' : f.h + ' mm') + ' · ' + f.sketch.shapes.length + ' shape' + (f.sketch.shapes.length === 1 ? '' : 's');
      li.innerHTML =
        '<span class="hi-n">' + (i + 1) + '. ' + OP_LABEL[f.type] + '</span>' +
        '<span class="hi-d">' + dims + (f.error ? ' · FAILED' : '') + '</span>' +
        '<span class="hi-a"><button data-edit="' + f.id + '">Edit</button><button data-del="' + f.id + '">×</button></span>';
      list.appendChild(li);
    });
    $('bw-hist-empty').hidden = doc.features.length > 0;
  }
  $('bw-history').addEventListener('click', (e) => {
    const editId = e.target.dataset?.edit, delId = e.target.dataset?.del;
    if (delId) {
      doc.features = doc.features.filter((f) => f.id !== delId);
      save();
      rebuild();
    }
    if (editId) sketch.open(doc.features.find((f) => f.id === editId));
  });

  // --- persistence ---------------------------------------------------------
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(doc));
    } catch {}
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && Array.isArray(d.features)) doc = d;
    } catch {}
  }
  $('bw-save-file').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'part.bomcad.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('bw-open-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((t) => {
      try {
        const d = JSON.parse(t);
        if (!Array.isArray(d.features)) throw new Error('bad file');
        doc = d;
        save();
        rebuild();
        say('Project opened.');
      } catch {
        say('That is not a studio project file.');
      }
    });
  });

  // --- export --------------------------------------------------------------
  async function exportBlob(kind) {
    if (!doc.features.length) return say('Add a feature first.');
    await rebuild();
    if (!currentShape) return say('Nothing solid to export — fix the failed feature.');
    const blob = kind === 'step' ? currentShape.blobSTEP() : currentShape.blobSTL({ tolerance: 0.03, angularTolerance: 0.3 });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = kind === 'step' ? 'part.step' : 'part.stl';
    a.click();
    URL.revokeObjectURL(a.href);
    say(kind === 'step' ? 'STEP exported — opens in FreeCAD and every real CAD package.' : 'STL exported — ready to print.');
  }
  $('bw-export-stl').addEventListener('click', () => exportBlob('stl'));
  $('bw-export-step').addEventListener('click', () => exportBlob('step'));
  $('bw-clear').addEventListener('click', () => {
    if (!confirm('Clear the whole part?')) return;
    doc = { features: [] };
    save();
    rebuild();
  });

  // --- 2D sketcher ---------------------------------------------------------
  const sketch = (() => {
    const wrap = $('bw-sketch');
    const canvas = $('bw-sketch-canvas');
    const ctx = canvas.getContext('2d');
    let feature = null; // feature being edited
    let isNew = false;
    let tool = 'rect';
    let pending = null; // in-progress placement
    let view = { cx: 0, cy: 0, pxPerMm: 6 };
    let selShape = null;

    function open(f) {
      feature = f;
      isNew = !doc.features.includes(f);
      selShape = f.sketch.shapes[f.sketch.shapes.length - 1] || null;
      wrap.hidden = false;
      $('bw-sk-title').textContent = (isNew ? 'New ' : 'Edit ') + OP_LABEL[f.type].toLowerCase();
      $('bw-sk-op-h').value = f.h ?? 20;
      $('bw-sk-through').checked = Boolean(f.through);
      $('bw-sk-h-row').hidden = f.type === 'revolve';
      $('bw-sk-through-row').hidden = f.type !== 'cut';
      $('bw-sk-hint').textContent =
        f.type === 'revolve'
          ? 'Lathe profile: x is radius from the axis (keep shapes at x ≥ 0), y is height. It spins around the left edge.'
          : 'Draw on the top plane, millimetres. Click-click to place; type exact numbers below.';
      setTool('rect');
      resize();
      draw2d();
      syncShapePanel();
    }
    function close(applyIt) {
      if (applyIt) {
        feature.h = Number($('bw-sk-op-h').value) || 20;
        feature.through = $('bw-sk-through').checked;
        if (!feature.sketch.shapes.length) return say('Draw at least one shape.');
        if (isNew) doc.features.push(feature);
        save();
        rebuild();
      }
      wrap.hidden = true;
      feature = null;
      pending = null;
    }
    $('bw-sk-apply').addEventListener('click', () => close(true));
    $('bw-sk-cancel').addEventListener('click', () => close(false));

    function setTool(t) {
      tool = t;
      pending = null;
      document.querySelectorAll('[data-sktool]').forEach((b) => b.classList.toggle('on', b.dataset.sktool === t));
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
      ctx.strokeStyle = '#eef1f4';
      ctx.lineWidth = 1;
      const x0 = Math.floor(view.cx - w / 2 / view.pxPerMm), x1 = Math.ceil(view.cx + w / 2 / view.pxPerMm);
      const y0 = Math.floor(view.cy - h / 2 / view.pxPerMm), y1 = Math.ceil(view.cy + h / 2 / view.pxPerMm);
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        const [px] = toPx(x, 0);
        ctx.strokeStyle = x === 0 ? '#8aa0b8' : x % (step * 5) === 0 ? '#dfe4ea' : '#eef1f4';
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();
      }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        const [, py] = toPx(0, y);
        ctx.strokeStyle = y === 0 ? '#8aa0b8' : y % (step * 5) === 0 ? '#dfe4ea' : '#eef1f4';
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
        ctx.stroke();
      }
      if (!feature) return;
      // shapes
      for (const s of feature.sketch.shapes) {
        ctx.strokeStyle = s === selShape ? '#0b5cad' : '#1a3550';
        ctx.fillStyle = s === selShape ? 'rgba(11,92,173,0.10)' : 'rgba(26,53,80,0.06)';
        ctx.lineWidth = 2;
        pathShape(s);
        ctx.fill();
        ctx.stroke();
      }
      // pending
      if (pending) {
        ctx.strokeStyle = '#0b5cad';
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
        const [px, py] = toPx(s.x - s.w / 2, s.y + s.h / 2);
        ctx.rect(px, py, s.w * view.pxPerMm, s.h * view.pxPerMm);
      } else if (s.kind === 'circle') {
        const [px, py] = toPx(s.x, s.y);
        ctx.arc(px, py, Math.max(0.1, s.r) * view.pxPerMm, 0, Math.PI * 2);
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
      if (pending?.kind === 'poly' && pending.pts.length >= 3) {
        pending.pts.pop(); // drop the move-preview point
        pending.closed = true;
        feature.sketch.shapes.push(pending);
        selShape = pending;
        pending = null;
        draw2d();
        syncShapePanel();
      }
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
        selShape = feature.sketch.shapes.findLast((s) => hitShape(s, mx, my)) || null;
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
      delete s.ax;
      delete s.ay;
      pending = null;
      feature.sketch.shapes.push(s);
      selShape = s;
      syncShapePanel();
      draw2d();
    }
    function hitShape(s, x, y) {
      if (s.kind === 'rect') return Math.abs(x - s.x) <= s.w / 2 && Math.abs(y - s.y) <= s.h / 2;
      if (s.kind === 'circle') return Math.hypot(x - s.x, y - s.y) <= s.r;
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
      const num = (label, key, val) =>
        '<label>' + label + ' <input type="number" step="0.5" data-dim="' + key + '" value="' + val + '" /></label>';
      if (s.kind === 'rect') p.innerHTML = num('W', 'w', s.w) + num('H', 'h', s.h) + num('X', 'x', s.x) + num('Y', 'y', s.y) + '<button id="bw-sk-delshape">Delete shape</button>';
      else if (s.kind === 'circle') p.innerHTML = num('Ø', 'd', s.r * 2) + num('X', 'x', s.x) + num('Y', 'y', s.y) + '<button id="bw-sk-delshape">Delete shape</button>';
      else p.innerHTML = '<span class="sk-note">Polygon · ' + s.pts.length + ' points</span><button id="bw-sk-delshape">Delete shape</button>';
      p.querySelectorAll('[data-dim]').forEach((inp) =>
        inp.addEventListener('change', () => {
          const v = Number(inp.value) || 0;
          const k = inp.dataset.dim;
          if (k === 'd') s.r = Math.max(0.5, v / 2);
          else s[k] = k === 'w' || k === 'h' ? Math.max(0.5, v) : v;
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

    return { open, resize };
  })();

  // --- feature buttons -----------------------------------------------------
  document.querySelectorAll('[data-feat]').forEach((b) =>
    b.addEventListener('click', () => {
      loadKernel(); // start the download while the user sketches
      sketch.open({ id: newId(), type: b.dataset.feat, sketch: { shapes: [], z: 0 }, h: 20, through: b.dataset.feat === 'cut' });
    }),
  );

  // --- boot ----------------------------------------------------------------
  load();
  resize();
  renderHistory();
  if (doc.features.length) {
    say('Restored your part — rebuilding…');
    rebuild();
  } else {
    // A worked example beats an empty screen: 40x40 plate, 5mm high,
    // with an 8mm hole through the middle. Fully editable.
    doc = {
      features: [
        { id: newId(), type: 'extrude', sketch: { shapes: [{ kind: 'rect', x: 0, y: 0, w: 40, h: 40 }], z: 0 }, h: 5 },
        { id: newId(), type: 'cut', sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 4 }], z: 5 }, h: 10, through: true },
      ],
    };
    save();
    rebuild();
  }
})();
