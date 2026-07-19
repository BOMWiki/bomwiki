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
  let doc = { features: [], params: [] };
  let currentShape = null; // last successful kernel shape
  // Rebuild errors are derived state, never stored in the document (they
  // would leak into undo snapshots and project files).
  const buildErrors = new Map(); // feature id -> message

  const deepCopy = (o) => JSON.parse(JSON.stringify(o));
  function normalizeDoc(d) {
    const out = d && typeof d === 'object' ? d : {};
    if (!Array.isArray(out.features)) out.features = [];
    if (!Array.isArray(out.params)) out.params = [];
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

  function commit(label, mutate) {
    undoStack.push({ label, snap: JSON.stringify(doc) });
    if (undoStack.length > STACK_MAX) undoStack.shift();
    redoStack.length = 0;
    const replacement = mutate();
    if (replacement) doc = normalizeDoc(replacement);
    save();
    renderParams();
    renderHistory();
    rebuild();
  }

  function replaceDocument(snapJson) {
    doc = normalizeDoc(JSON.parse(snapJson));
    save();
    renderParams();
    renderHistory();
    rebuild();
  }

  function undo() {
    if (!undoStack.length) return say('Nothing to undo.');
    const entry = undoStack.pop();
    redoStack.push({ label: entry.label, snap: JSON.stringify(doc) });
    replaceDocument(entry.snap);
    say('Undid: ' + entry.label);
  }
  function redo() {
    if (!redoStack.length) return say('Nothing to redo.');
    const entry = redoStack.pop();
    undoStack.push({ label: entry.label, snap: JSON.stringify(doc) });
    replaceDocument(entry.snap);
    say('Redid: ' + entry.label);
  }

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

  // Repeat a 2D drawing as a linear run or a circular ring (bolt circles,
  // hole grids). Done at drawing level: one boolean per copy in 2D beats a
  // 3D fuse per copy by an order of magnitude.
  function patternedDrawing(drawing, pat) {
    if (!pat) return drawing;
    const n = Math.min(100, Math.max(1, Math.round(NS(pat.n, 1))));
    if (n <= 1) return drawing;
    let out = drawing;
    for (let i = 1; i < n; i++) {
      out = out.fuse(
        pat.kind === 'circular'
          ? drawing.rotate((360 / n) * i, [N(pat.cx ?? 0), N(pat.cy ?? 0)])
          : drawing.translate(N(pat.dx ?? 0) * i, N(pat.dy ?? 0) * i),
      );
    }
    return out;
  }

  function shapeToDrawing(s) {
    if (s.kind === 'rect') {
      return rc.drawRectangle(Math.max(0.1, N(s.w)), Math.max(0.1, N(s.h))).translate(N(s.x), N(s.y));
    }
    if (s.kind === 'circle') {
      return rc.drawCircle(Math.max(0.05, N(s.r))).translate(N(s.x), N(s.y));
    }
    if (s.kind === 'poly') {
      let pen = rc.draw([s.pts[0][0], s.pts[0][1]]);
      for (let i = 1; i < s.pts.length; i++) pen = pen.lineTo([s.pts[i][0], s.pts[i][1]]);
      return pen.close();
    }
    throw new Error('unknown shape');
  }

  // Highest Z of a shape, for measuring cut depth from the part's top face.
  function topOf(shape) {
    try {
      const b = shape.boundingBox?.bounds;
      if (Array.isArray(b) && b.length === 2) return b[1][2];
      if (Array.isArray(b) && b.length === 6) return b[5];
    } catch {}
    return 1000; // unknown: cut from far above, which degrades to through-all
  }

  function featureSolid(f, zTop, acc) {
    // Sketch-on-face: re-find the face on the part built so far by its
    // geometric signature and sketch on its plane. Extrude grows outward
    // along the face normal; cut digs inward.
    let facePlane = null;
    if (f.onFace) {
      const face = acc ? acc.faces.find((fc) => faceMatches(f.onFace, fc)) : null;
      if (!face) throw new Error('the picked face no longer exists — edit or delete this feature');
      facePlane = rc.makePlaneFromFace(face);
    }
    // Union all sketch shapes, then apply the operation.
    let solids = [];
    for (const s of f.sketch.shapes) {
      const drawing = patternedDrawing(shapeToDrawing(s), f.pattern);
      if (f.type === 'revolve') {
        // Lathe: the sketch is a radial profile (x = radius, y = height),
        // revolved around the vertical axis.
        const sk = drawing.sketchOnPlane('XZ');
        solids.push(sk.revolve());
      } else if (f.type === 'cut') {
        const depth = f.through ? 0 : Math.max(0.1, N(f.h));
        if (facePlane) {
          solids.push(drawing.sketchOnPlane(facePlane).extrude(-(f.through ? 10000 : depth)));
        } else {
          // Base-plane cuts remove material as the user sees it: through-all
          // spans the build volume; a finite depth is measured down from the
          // part's top face (base sketches all live on the ground plane).
          const sk = f.through
            ? drawing.sketchOnPlane('XY', -5000)
            : drawing.sketchOnPlane('XY', (zTop ?? 0) - depth);
          solids.push(sk.extrude(f.through ? 10000 : depth + 1000));
        }
      } else {
        const sk = facePlane
          ? drawing.sketchOnPlane(facePlane)
          : drawing.sketchOnPlane('XY', f.sketch.z || 0);
        solids.push(sk.extrude(Math.max(0.1, N(f.h))));
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
        if (f.type === 'fillet' || f.type === 'chamfer') {
          if (!acc) throw new Error('nothing to round yet');
          let hit = 0;
          const radius = Math.max(0.1, N(f.r));
          const next = acc[f.type]((edge) => {
            const on = f.edges.some((sig) => sigMatches(sig, edge));
            if (on) hit++;
            return on ? radius : 0;
          });
          if (!hit) throw new Error('the picked edges no longer exist — edit or delete this feature');
          acc = next;
        } else if (f.type === 'shell') {
          if (!acc) throw new Error('nothing to hollow yet');
          let hit = 0;
          const next = acc.shell(-Math.max(0.2, Math.abs(N(f.t))), (fd) =>
            fd.when(({ element }) => {
              const on = f.faces.some((sig) => faceMatches(sig, element));
              if (on) hit++;
              return on;
            }),
          );
          if (!hit) throw new Error('the picked faces no longer exist — edit or delete this feature');
          acc = next;
        } else if (f.type === 'cut') {
          const solid = featureSolid(f, acc ? topOf(acc) : 0, acc);
          if (acc) acc = acc.cut(solid);
        } else {
          const solid = featureSolid(f, 0, acc);
          acc = acc ? acc.fuse(solid) : solid;
        }
        buildErrors.delete(f.id);
      } catch (err) {
        let msg = String(err?.message || err);
        // The kernel build without exception decoding throws bare numbers.
        if (/^\d+$/.test(msg) || /^Error$/i.test(msg)) {
          msg =
            f.type === 'shell'
              ? 'the kernel could not hollow this shape — try different walls, another opening face, or shell earlier in the history'
              : f.type === 'fillet' || f.type === 'chamfer'
                ? 'the kernel refused — try a smaller radius or fewer edges'
                : 'the kernel rejected this sketch — check for overlapping or self-crossing shapes';
        } else if ((f.type === 'fillet' || f.type === 'chamfer') && !/no longer exist/.test(msg)) {
          msg += ' — try a smaller radius';
        }
        buildErrors.set(f.id, msg);
        failed = f;
      }
    }
    const prev = currentShape;
    currentShape = acc;
    try {
      setMesh(acc);
    } catch {
      say('Display meshing failed.', false);
    }
    // Release the previous kernel shape explicitly — GC finalizers reclaim
    // WASM memory too slowly on low-RAM devices. After setMesh, so the
    // face/edge maps never briefly point at freed wrappers.
    try {
      if (prev && prev !== acc) prev.delete();
    } catch {}
    renderHistory();
    if (failed) say(OP_LABEL[failed.type] + ' failed: ' + buildErrors.get(failed.id));
  }

  // Edge identity across rebuilds: OCCT hash codes are not stable between
  // kernel runs, so features that reference edges (fillet/chamfer) store a
  // geometric signature — midpoint + length — and re-match on rebuild.
  const edgeSig = (edge) => {
    const p = edge.pointAt(0.5);
    return { p: [p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]].map((v) => Math.round(v * 100) / 100), l: Math.round(edge.length * 100) / 100 };
  };
  const sigMatches = (sig, edge) => {
    const p = edge.pointAt(0.5);
    const q = [p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]];
    return (
      Math.abs(edge.length - sig.l) < 0.05 &&
      Math.hypot(q[0] - sig.p[0], q[1] - sig.p[1], q[2] - sig.p[2]) < 0.05
    );
  };

  // Faces get the same treatment for sketch-on-face features.
  const faceSig = (face) => {
    const c = face.center;
    const n = face.normalAt();
    const q = (v) => Math.round(v * 100) / 100;
    return { p: [q(c.x), q(c.y), q(c.z)], n: [q(n.x), q(n.y), q(n.z)] };
  };
  const faceMatches = (sig, face) => {
    if (face.geomType !== 'PLANE') return false;
    const c = face.center;
    const n = face.normalAt();
    return (
      Math.hypot(c.x - sig.p[0], c.y - sig.p[1], c.z - sig.p[2]) < 0.05 &&
      n.x * sig.n[0] + n.y * sig.n[1] + n.z * sig.n[2] > 0.999
    );
  };

  let edgeLines = []; // pickable Line objects with userData.sig
  let solidMesh = null; // the shaded mesh, for face raycasts
  let faceRanges = []; // [{t0, t1, faceId}] triangle ranges per B-rep face
  let faceByHash = new Map(); // faceId -> face wrapper (planar only)

  function setMesh(shape) {
    while (partGroup.children.length) {
      const c = partGroup.children.pop();
      c.geometry?.dispose();
      if (c.material && c.material !== MAT) c.material.dispose?.();
    }
    edgeLines = [];
    solidMesh = null;
    faceRanges = [];
    faceByHash = new Map();
    if (!shape) return;
    const m = shape.mesh({ tolerance: 0.05, angularTolerance: 0.3 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(m.vertices, 3));
    if (m.normals) geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
    geo.setIndex(m.triangles);
    if (!m.normals) geo.computeVertexNormals();
    solidMesh = new THREE.Mesh(geo, MAT);
    partGroup.add(solidMesh);
    for (const g of m.faceGroups || []) {
      faceRanges.push({ t0: g.start / 3, t1: (g.start + g.count) / 3, faceId: g.faceId });
    }
    for (const face of shape.faces) {
      try {
        if (face.geomType === 'PLANE') faceByHash.set(face.hashCode, face);
      } catch {}
    }
    // Exact B-rep edges from the kernel, one pickable polyline per edge.
    try {
      const me = shape.meshEdges();
      const byHash = new Map(shape.edges.map((e) => [e.hashCode, e]));
      for (const g of me.edgeGroups || []) {
        const pts = new Float32Array(me.lines.slice(g.start * 3, (g.start + g.count) * 3));
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const line = new THREE.Line(lg, EDGE_MAT.clone());
        const edge = byHash.get(g.edgeId);
        if (edge) line.userData.sig = edgeSig(edge);
        partGroup.add(line);
        edgeLines.push(line);
      }
    } catch {}
  }

  // --- history panel -------------------------------------------------------
  function renderHistory() {
    const list = $('bw-history');
    list.innerHTML = '';
    doc.features.forEach((f, i) => {
      const li = document.createElement('li');
      li.className = 'hist-item' + (buildErrors.has(f.id) ? ' err' : '');
      const dims =
        f.type === 'fillet' || f.type === 'chamfer'
          ? 'r ' + f.r + ' mm · ' + f.edges.length + ' edge' + (f.edges.length === 1 ? '' : 's')
          : f.type === 'shell'
            ? f.t + ' mm walls · ' + f.faces.length + ' opening' + (f.faces.length === 1 ? '' : 's')
            : f.type === 'revolve'
              ? 'profile ×' + f.sketch.shapes.length
              : (f.through ? 'through' : f.h + ' mm') + ' · ' + f.sketch.shapes.length + ' shape' + (f.sketch.shapes.length === 1 ? '' : 's') + (f.onFace ? ' · on face' : '') + (f.pattern?.n > 1 ? ' · ×' + f.pattern.n : '');
      li.innerHTML =
        '<span class="hi-n">' + (i + 1) + '. ' + OP_LABEL[f.type] + '</span>' +
        '<span class="hi-d">' + dims + (buildErrors.has(f.id) ? ' · FAILED' : '') + '</span>' +
        '<span class="hi-a"><button data-edit="' + f.id + '">Edit</button><button data-del="' + f.id + '">×</button></span>';
      list.appendChild(li);
    });
    $('bw-hist-empty').hidden = doc.features.length > 0;
  }
  $('bw-history').addEventListener('click', (e) => {
    const editId = e.target.dataset?.edit, delId = e.target.dataset?.del;
    if (delId) {
      const gone = doc.features.find((f) => f.id === delId);
      commit('Delete ' + (gone ? OP_LABEL[gone.type].toLowerCase() : 'feature'), () => {
        doc.features = doc.features.filter((f) => f.id !== delId);
      });
    }
    if (editId) {
      const f = doc.features.find((x) => x.id === editId);
      if (f.type === 'fillet' || f.type === 'chamfer') picker.open(f);
      else if (f.type === 'shell') shellPick.open(f);
      else sketch.open(f);
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
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(doc));
    } catch {}
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && Array.isArray(d.features)) doc = normalizeDoc(d);
      else doc = normalizeDoc(doc);
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
        commit('Open project', () => normalizeDoc(d));
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
    if (doc.features.some((f) => buildErrors.has(f.id))) {
      return say('A feature is failing (marked red) — fix or delete it first, so the exported file matches your design.');
    }
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
    if (!confirm('Clear the whole part? (Undo can bring it back.)')) return;
    commit('Clear part', () => ({ features: [], params: [] }));
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

    function open(f, opts) {
      // Transactional edit: work on a deep copy so Cancel discards
      // everything and undo snapshots never see half-applied changes.
      isNew = !doc.features.some((x) => x.id === f.id);
      feature = deepCopy(f);
      refOutline = opts?.refOutline || [];
      selShape = f.sketch.shapes[f.sketch.shapes.length - 1] || null;
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
        commit((isNew ? 'Add ' : 'Edit ') + OP_LABEL[draft.type].toLowerCase(), () => {
          const i = doc.features.findIndex((x) => x.id === draft.id);
          if (i >= 0) doc.features[i] = draft;
          else doc.features.push(draft);
        });
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
      // reference outline of the face being sketched on
      if (refOutline.length) {
        ctx.strokeStyle = '#9aa7b4';
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

    return { open, resize, isOpen: () => !wrap.hidden };
  })();

  // --- edge picker (fillet / chamfer) --------------------------------------
  const picker = (() => {
    const bar = $('bw-pick');
    let feature = null;
    let isNew = false;
    const SEL = 0xe67e22;

    function open(f) {
      if (!edgeLines.length) return say('Build something first — fillets round the edges of an existing part.');
      isNew = !doc.features.some((x) => x.id === f.id);
      feature = deepCopy(f); // transactional: document untouched until Apply
      bar.hidden = false;
      $('bw-pick-title').textContent = (isNew ? 'New ' : 'Edit ') + OP_LABEL[f.type].toLowerCase();
      $('bw-pick-r').value = f.r ?? 2;
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
        commit((isNew ? 'Add ' : 'Edit ') + OP_LABEL[draft.type].toLowerCase(), () => {
          const i = doc.features.findIndex((x) => x.id === draft.id);
          if (i >= 0) doc.features[i] = draft;
          else doc.features.push(draft);
        });
        for (const line of edgeLines) line.userData.picked = false;
      } else {
        for (const line of edgeLines) line.material.color.setHex(0x2c3e50);
      }
      bar.hidden = true;
      feature = null;
    }
    $('bw-pick-apply').addEventListener('click', () => close(true));
    $('bw-pick-cancel').addEventListener('click', () => close(false));
    function syncCount() {
      $('bw-pick-count').textContent = edgeLines.filter((l) => l.userData.picked).length + ' picked';
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
      syncCount();
    });

    return { open, cancel: () => feature && close(false), active: () => Boolean(feature) };
  })();

  // Debug handle for automated tests; not part of the public surface.
  window.__bwStudio = {
    edges: () => edgeLines.length,
    visible: () => stageVisible,
    frame: () => {
      orbit.update();
      renderer.render(scene, camera);
    },
    top: () => (currentShape ? topOf(currentShape) : null),
    errors: () => doc.features.filter((f) => buildErrors.has(f.id)).map((f) => f.type + ': ' + buildErrors.get(f.id)),
    undoDepth: () => undoStack.length,
    redoDepth: () => redoStack.length,
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
    const picked = new Map(); // faceId -> {sig, mesh}

    const planarRanges = () => faceRanges.filter((r) => faceByHash.has(r.faceId));

    function open(f) {
      if (!solidMesh || !faceByHash.size) return say('Build something first — Shell hollows an existing part.');
      isNew = !doc.features.some((x) => x.id === f.id);
      feature = deepCopy(f); // transactional: document untouched until Apply
      cycleIdx = -1;
      bar.hidden = false;
      $('bw-shell-title').textContent = (isNew ? 'New ' : 'Edit ') + 'shell';
      $('bw-shell-t').value = f.t ?? 2;
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
        commit((isNew ? 'Add ' : 'Edit ') + 'shell', () => {
          const i = doc.features.findIndex((x) => x.id === draft.id);
          if (i >= 0) doc.features[i] = draft;
          else doc.features.push(draft);
        });
      }
      for (const p of picked.values()) dropHighlight(p.mesh);
      picked.clear();
      dropHighlight(cycleMesh);
      cycleMesh = null;
      bar.hidden = true;
      feature = null;
    }
    $('bw-shell-apply').addEventListener('click', () => close(true));
    $('bw-shell-cancel').addEventListener('click', () => close(false));
    function syncCount() {
      $('bw-shell-count').textContent = picked.size + ' opening' + (picked.size === 1 ? '' : 's');
    }

    function toggleRange(range) {
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

    return { open, cancel: () => feature && close(false), active: () => Boolean(feature) };
  })();

  // --- face picker (sketch-on-face for extrude / cut) ----------------------
  const facePick = (() => {
    const bar = $('bw-face');
    let draft = null;
    let cycleIdx = -1;
    let highlight = null;

    function open(f) {
      draft = f;
      cycleIdx = -1;
      bar.hidden = false;
      $('bw-face-use').hidden = true;
      $('bw-face-title').textContent = 'New ' + OP_LABEL[f.type].toLowerCase();
    }
    function close() {
      bar.hidden = true;
      draft = null;
      clearHighlight();
      $('bw-face-use').hidden = true;
    }
    $('bw-face-base').addEventListener('click', () => {
      const f = draft;
      close();
      sketch.open(f);
    });
    $('bw-face-cancel').addEventListener('click', close);

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
      let outline = [];
      try {
        outline = faceOutline(face, rc.makePlaneFromFace(face));
      } catch {}
      close();
      sketch.open(f, { refOutline: outline });
    }

    // Project the chosen face's outline into its own plane so the sketcher
    // can show where you are on the part.
    function faceOutline(face, plane) {
      const polys = [];
      try {
        for (const edge of face.edges) {
          const pts = [];
          for (let i = 0; i <= 8; i++) {
            const p = edge.pointAt(i / 8);
            const l = plane.toLocalCoords(p);
            pts.push([l.x ?? l[0], l.y ?? l[1]]);
          }
          polys.push(pts);
        }
      } catch {}
      return polys;
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

    return { open, cancel: close, active: () => Boolean(draft) };
  })();

  // --- feature buttons -----------------------------------------------------
  document.querySelectorAll('[data-feat]').forEach((b) =>
    b.addEventListener('click', () => {
      // The rail sits outside the sketch overlay, so guard against silently
      // discarding an in-progress sketch; and never run two pick modes at
      // once — the 3D click handlers would both fire.
      if (sketch.isOpen()) return say('Finish or cancel the current sketch first.');
      picker.cancel();
      facePick.cancel();
      shellPick.cancel();
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
    }),
  );

  // --- boot ----------------------------------------------------------------
  load();
  resize();
  renderHistory();
  renderParams();
  // Prototype-v1 scenes (the retired primitives studio) are incompatible;
  // tell the user once, never touch the old key.
  try {
    if (localStorage.getItem('bw-studio-scene-v1') && !localStorage.getItem('bw-studio-v1-notice')) {
      localStorage.setItem('bw-studio-v1-notice', '1');
      say('A scene from the old prototype studio was found. It is incompatible with the parametric studio and has been left untouched.', true);
    }
  } catch {}
  const SEEDED = 'bw-studio-v2-seeded';
  if (doc.features.length) {
    try {
      localStorage.setItem(SEEDED, '1');
    } catch {}
    say('Restored your part — rebuilding…');
    rebuild();
  } else if (localStorage.getItem(SEEDED)) {
    // The user has been here and deliberately has an empty document (for
    // example after Clear + reload, or undoing everything): keep it empty.
    rebuild();
  } else {
    // A worked example beats an empty screen: a parametric plate — size and
    // hole driven by the two parameters, so editing them teaches the idea.
    doc = {
      params: [
        { name: 'size', value: 40 },
        { name: 'hole', value: 8 },
      ],
      features: [
        { id: newId(), type: 'extrude', sketch: { shapes: [{ kind: 'rect', x: 0, y: 0, w: 'size', h: 'size' }], z: 0 }, h: 5 },
        { id: newId(), type: 'cut', sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 'hole/2' }], z: 5 }, h: 10, through: true },
      ],
    };
    try {
      localStorage.setItem(SEEDED, '1');
    } catch {}
    save();
    renderParams();
    rebuild();
  }
})();
