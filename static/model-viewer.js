// CAD viewer for item and /cad player pages. The page ships only this small
// activator; three.js (vendored ES modules) and the model bytes load on
// activation — click on item pages, immediately where data-auto="1".
// Viewer features: grid floor, feature-edge overlay, shaded/wireframe
// toggle, zoom-to-fit, fullscreen, bounding-box dimensions in mm.
(() => {
  const dataEl = document.getElementById('bw-model-data');
  const stage = document.getElementById('bw-model-stage');
  const btn = document.getElementById('bw-model-activate');
  if (!dataEl || !stage || !btn) return;

  let data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch {
    return;
  }

  function fail(msg) {
    stage.innerHTML =
      '<p class="mv-error">' +
      msg +
      ' You can still <a href="' +
      data.url +
      '" rel="nofollow">download the STL</a>.</p>';
  }

  function hasWebGL() {
    try {
      const c = document.createElement('canvas');
      return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  }

  async function activate() {
    if (!hasWebGL()) {
      fail('Your browser has no WebGL support, so the 3D view cannot start.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Loading model…';
    let THREE, STLLoader, OrbitControls, geometry;
    try {
      [THREE, { STLLoader }, { OrbitControls }] = await Promise.all([
        import(data.three),
        import(data.stlLoader),
        import(data.orbitControls),
      ]);
      const buf = await (await fetch(data.url)).arrayBuffer();
      geometry = new STLLoader().parse(buf);
    } catch {
      fail('The 3D view failed to load.');
      return;
    }

    stage.innerHTML = '';
    stage.classList.add('mv-live');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777788, 1.5));
    const dir = new THREE.DirectionalLight(0xffffff, 1.3);
    dir.position.set(1, 2, 1.5);
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-1.5, 0.5, -1);
    scene.add(fill);

    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = Math.max(size.x, size.y, size.z) || 1;

    const solid = new THREE.MeshStandardMaterial({
      color: 0x9fb0c3,
      metalness: 0.15,
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const wire = new THREE.MeshBasicMaterial({ color: 0x39485a, wireframe: true });
    const mesh = new THREE.Mesh(geometry, solid);
    mesh.position.sub(center);

    // STL is Z-up; three is Y-up. Group carries the tilt so grid/axes stay flat.
    const group = new THREE.Group();
    group.add(mesh);

    // Feature edges make it read as CAD, not clay. Skipped on huge meshes —
    // EdgesGeometry is O(n log n) and the overlay would be solid noise anyway.
    const triCount = geometry.getAttribute('position').count / 3;
    let edges = null;
    if (triCount <= 250_000) {
      edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 25),
        new THREE.LineBasicMaterial({ color: 0x2c3e50 }),
      );
      edges.position.copy(mesh.position);
      group.add(edges);
    }
    group.rotation.x = -Math.PI / 2;
    // Sit the model on the grid: after rotation, model min-Z maps to bottom.
    group.position.y = -(box.min.z - center.z);
    scene.add(group);

    // Grid floor sized to the part, minor lines ~1/20 of the span.
    const span = Math.max(size.x, size.y) * 2.2;
    const grid = new THREE.GridHelper(span, 22, 0xb5bfca, 0xe2e7ec);
    scene.add(grid);

    const camera = new THREE.PerspectiveCamera(40, 1, radius / 100, radius * 30);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, size.z / 2, 0);

    function fit() {
      camera.position.set(radius * 1.2, radius * 0.9, radius * 1.6);
      controls.target.set(0, size.z / 2, 0);
      controls.update();
    }
    fit();

    // Toolbar + dimensions readout
    const mm = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
    const hud = document.createElement('div');
    hud.className = 'mv-hud';
    hud.innerHTML =
      '<span class="mv-dims">' + mm(size.x) + ' × ' + mm(size.y) + ' × ' + mm(size.z) + ' mm</span>' +
      '<span class="mv-tools">' +
      '<button type="button" data-act="fit" title="Zoom to fit">⤢ Fit</button>' +
      '<button type="button" data-act="wire" title="Shaded / wireframe">◫ Wire</button>' +
      '<button type="button" data-act="full" title="Fullscreen">⛶ Full</button>' +
      '</span>';
    stage.appendChild(hud);
    hud.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'fit') fit();
      if (act === 'wire') {
        mesh.material = mesh.material === solid ? wire : solid;
        if (edges) edges.visible = mesh.material === solid;
        e.target.classList.toggle('on', mesh.material === wire);
      }
      if (act === 'full') {
        if (document.fullscreenElement) document.exitFullscreen();
        else stage.requestFullscreen?.();
      }
    });

    function resize() {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(stage);
    resize();

    // Render only while the stage is on screen; an open viewer scrolled out
    // of view stops burning frames.
    let visible = true;
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
    }).observe(stage);

    renderer.setAnimationLoop(() => {
      if (!visible) return;
      controls.update();
      renderer.render(scene, camera);
    });
  }

  btn.addEventListener('click', activate);
  // Dedicated CAD player pages opt into loading immediately; item pages
  // stay click-to-activate so the encyclopedia read costs nothing.
  if (stage.dataset.auto === '1') activate();
})();
