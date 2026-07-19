// BOMwiki CAD Studio: zero-signup solid modeling in the browser.
// Tinkercad-style core loop: drop primitives, move/rotate/scale with gizmos,
// mark shapes as solid or hole, then export — solids are unioned and holes
// subtracted (three-bvh-csg) into one binary STL. Scene autosaves to
// localStorage. Everything runs client-side; no account, no upload.
(async () => {
  const stage = document.getElementById('bw-studio');
  if (!stage) return;

  let THREE, OrbitControls, TransformControls, CSG;
  try {
    [THREE, { OrbitControls }, { TransformControls }, CSG] = await Promise.all([
      import('/static/vendor/three.module.min.js'),
      import('/static/vendor/OrbitControls.js'),
      import('/static/vendor/TransformControls.js'),
      import('/static/vendor/three-bvh-csg.module.js'),
    ]);
  } catch (e) {
    stage.innerHTML = '<p class="mv-error">The studio failed to load. Check your connection and reload.</p>';
    return;
  }

  // --- scene ---------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x778, 1.5));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(60, 120, 90);
  scene.add(dir);
  const grid = new THREE.GridHelper(200, 40, 0xb5bfca, 0xe2e7ec);
  scene.add(grid);

  const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  camera.position.set(90, 80, 130);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.target.set(0, 15, 0);

  const gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.setTranslationSnap(1);
  gizmo.setRotationSnap((15 * Math.PI) / 180);
  scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);
  gizmo.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
    if (!e.value) queueSave();
  });

  // --- objects -------------------------------------------------------------
  const SOLID_MAT = new THREE.MeshStandardMaterial({ color: 0x9fb0c3, metalness: 0.1, roughness: 0.65 });
  const HOLE_MAT = new THREE.MeshStandardMaterial({
    color: 0xe08a7a,
    metalness: 0.05,
    roughness: 0.7,
    transparent: true,
    opacity: 0.55,
  });
  const SELECT_EMISSIVE = 0x1a4a80;

  const PRIMITIVES = {
    box: () => new THREE.BoxGeometry(20, 20, 20),
    cylinder: () => new THREE.CylinderGeometry(10, 10, 20, 48),
    sphere: () => new THREE.SphereGeometry(10, 32, 20),
    cone: () => new THREE.CylinderGeometry(0, 10, 20, 48),
    hex: () => new THREE.CylinderGeometry(10, 10, 20, 6),
    wedge: () => new THREE.CylinderGeometry(10, 10, 20, 3),
    torus: () => new THREE.TorusGeometry(10, 4, 16, 48).rotateX(-Math.PI / 2),
  };

  const objects = [];
  let selected = null;

  function addObject(type, state) {
    const geo = PRIMITIVES[type]?.();
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, SOLID_MAT.clone());
    mesh.userData.type = type;
    mesh.userData.hole = false;
    if (state) {
      mesh.position.fromArray(state.p);
      mesh.rotation.fromArray(state.r);
      mesh.scale.fromArray(state.s);
      if (state.hole) setHole(mesh, true);
    } else {
      // Sit on the grid, offset a touch so stacked adds stay visible.
      mesh.position.set((objects.length % 5) * 6 - 12, type === 'torus' ? 4 : 10, 0);
    }
    scene.add(mesh);
    objects.push(mesh);
    if (!state) {
      select(mesh);
      queueSave();
    }
    return mesh;
  }

  function setHole(mesh, hole) {
    mesh.userData.hole = hole;
    const sel = selected === mesh;
    mesh.material = (hole ? HOLE_MAT : SOLID_MAT).clone();
    if (sel) mesh.material.emissive.setHex(SELECT_EMISSIVE);
  }

  function select(mesh) {
    if (selected) selected.material.emissive.setHex(0);
    selected = mesh;
    if (mesh) {
      mesh.material.emissive.setHex(SELECT_EMISSIVE);
      gizmo.attach(mesh);
    } else {
      gizmo.detach();
    }
    syncPanel();
  }

  function removeObject(mesh) {
    const i = objects.indexOf(mesh);
    if (i >= 0) objects.splice(i, 1);
    if (selected === mesh) select(null);
    scene.remove(mesh);
    mesh.geometry.dispose();
    queueSave();
  }

  // --- picking -------------------------------------------------------------
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    downAt = [e.clientX, e.clientY];
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    if (gizmo.dragging) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(objects, false)[0];
    select(hit ? hit.object : null);
  });

  // --- toolbar / panel -----------------------------------------------------
  const $ = (id) => document.getElementById(id);
  document.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => addObject(b.dataset.add)),
  );
  document.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode)),
  );
  function setMode(m) {
    gizmo.setMode(m);
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  }
  setMode('translate');

  function syncPanel() {
    const panel = $('bw-sel');
    if (!selected) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    $('bw-sel-type').textContent = selected.userData.type;
    $('bw-sel-hole').checked = selected.userData.hole;
    const box = new THREE.Box3().setFromObject(selected);
    const s = new THREE.Vector3();
    box.getSize(s);
    const mm = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
    $('bw-sel-dims').textContent = mm(s.x) + ' × ' + mm(s.z) + ' × ' + mm(s.y) + ' mm';
  }
  $('bw-sel-hole').addEventListener('change', (e) => {
    if (selected) {
      setHole(selected, e.target.checked);
      queueSave();
    }
  });
  $('bw-sel-dup').addEventListener('click', () => {
    if (!selected) return;
    const st = objState(selected);
    st.p[0] += 12;
    const m = addObject(st.t, st);
    select(m);
    queueSave();
  });
  $('bw-sel-del').addEventListener('click', () => selected && removeObject(selected));

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'g') setMode('translate');
    if (e.key === 'r') setMode('rotate');
    if (e.key === 's') setMode('scale');
    if ((e.key === 'Backspace' || e.key === 'Delete' || e.key === 'x') && selected) removeObject(selected);
    if (e.key === 'd' && selected) $('bw-sel-dup').click();
  });

  // --- CSG + export --------------------------------------------------------
  function combined() {
    const ev = new CSG.Evaluator();
    ev.useGroups = false;
    const brush = (mesh) => {
      const b = new CSG.Brush(mesh.geometry.clone());
      b.position.copy(mesh.position);
      b.rotation.copy(mesh.rotation);
      b.scale.copy(mesh.scale);
      b.updateMatrixWorld(true);
      return b;
    };
    let acc = null;
    for (const o of objects) if (!o.userData.hole) acc = acc ? ev.evaluate(acc, brush(o), CSG.ADDITION) : brush(o);
    if (!acc) return null;
    for (const o of objects) if (o.userData.hole) acc = ev.evaluate(acc, brush(o), CSG.SUBTRACTION);
    return acc.geometry;
  }

  function exportStl() {
    if (!objects.length) return say('Add a shape first.');
    let geo;
    try {
      geo = combined();
    } catch (err) {
      return say('Boolean merge failed on this arrangement — try separating overlapping shapes slightly.');
    }
    if (!geo) return say('Everything is marked as a hole — nothing solid to export.');
    // three is Y-up, printers and CAD are Z-up.
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    const pos = geo.getAttribute('position');
    const tri = pos.count / 3;
    const buf = new ArrayBuffer(84 + tri * 50);
    const dv = new DataView(buf);
    dv.setUint32(80, tri, true);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    let off = 84;
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      n.copy(b).sub(a).cross(new THREE.Vector3().copy(c).sub(a)).normalize();
      for (const v of [n, a, b, c]) {
        dv.setFloat32(off, v.x, true);
        dv.setFloat32(off + 4, v.y, true);
        dv.setFloat32(off + 8, v.z, true);
        off += 12;
      }
      off += 2;
    }
    const blob = new Blob([buf], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const aEl = document.createElement('a');
    aEl.href = url;
    aEl.download = 'bomwiki-studio.stl';
    aEl.click();
    URL.revokeObjectURL(url);
    say('Exported ' + tri.toLocaleString() + ' triangles. Print it, or add it to a BOMwiki page.');
  }
  $('bw-export').addEventListener('click', exportStl);
  $('bw-clear').addEventListener('click', () => {
    if (!confirm('Clear the whole scene?')) return;
    [...objects].forEach(removeObject);
    say('Cleared.');
  });

  function say(msg) {
    const el = $('bw-studio-msg');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(say.t);
    say.t = setTimeout(() => (el.hidden = true), 6000);
  }

  // --- persistence ---------------------------------------------------------
  const KEY = 'bw-studio-scene-v1';
  const objState = (o) => ({
    t: o.userData.type,
    hole: o.userData.hole,
    p: o.position.toArray(),
    r: o.rotation.toArray().slice(0, 3),
    s: o.scale.toArray(),
  });
  let saveTimer;
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(objects.map(objState)));
      } catch {}
      syncPanel();
    }, 400);
  }
  gizmo.addEventListener('objectChange', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      queueSave();
    }, 300);
  });
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
    for (const st of saved) addObject(st.t, st);
    if (saved.length) say('Restored your last session — everything stays in this browser.');
  } catch {}
  if (!objects.length) {
    // A starter scene beats an empty void: box with a cylinder hole.
    addObject('box', { t: 'box', hole: false, p: [0, 10, 0], r: [0, 0, 0], s: [1.6, 1, 1.6] });
    addObject('cylinder', { t: 'cylinder', hole: true, p: [0, 10, 0], r: [0, 0, 0], s: [0.55, 1.2, 0.55] });
  }

  // --- loop ----------------------------------------------------------------
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();
  renderer.setAnimationLoop(() => {
    orbit.update();
    renderer.render(scene, camera);
  });
})();
