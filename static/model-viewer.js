// Click-to-activate STL viewer for item pages. The page ships only this small
// activator; three.js (vendored ES modules) and the model bytes load on the
// first click, so an unopened viewer costs the page nothing.
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
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777788, 1.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(1, 2, 1.5);
    scene.add(dir);

    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = Math.max(size.x, size.y, size.z) || 1;

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0x9fb0c3, metalness: 0.15, roughness: 0.65 }),
    );
    mesh.position.sub(center);
    // Most CAD exports are Z-up; three is Y-up. Tilt so the model stands
    // upright instead of lying on its back.
    const group = new THREE.Group();
    group.add(mesh);
    group.rotation.x = -Math.PI / 2;
    scene.add(group);

    const camera = new THREE.PerspectiveCamera(45, 1, radius / 100, radius * 20);
    camera.position.set(radius * 1.1, radius * 0.8, radius * 1.5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

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
