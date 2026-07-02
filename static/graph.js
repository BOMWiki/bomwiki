// Interactive build & assembly graph, ported from the inline script in
// src/pages/item/[slug].astro. Cytoscape + Dagre are served as classic UMD
// vendor scripts under /static/vendor/ and only injected when the graph
// section actually scrolls into view, so readers who stop at the specs never
// pay for them.
(() => {
  const section = document.getElementById('bgcanvas');
  if (!section) return;

  // Sequentially inject the vendor bundles (classic scripts, window globals):
  // cytoscape first so cytoscape-dagre can see window.cytoscape, dagre next,
  // then the layout adapter. Memoized so share/export and the observer can
  // both call it.
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(s);
    });
  }
  let vendorPromise;
  function ensureVendors() {
    if (!vendorPromise) {
      vendorPromise = loadScript('/static/vendor/cytoscape.min.js')
        .then(() => loadScript('/static/vendor/dagre.min.js'))
        .then(() => loadScript('/static/vendor/cytoscape-dagre.js'));
    }
    return vendorPromise;
  }

  let __started = false, __resolveReady;
  const __ready = new Promise((r) => (__resolveReady = r));
  // Let the share/download bar drive the graph: load it on demand and export a
  // branded PNG (BOMwiki wordmark + product name header, site footer).
  window.__bomwikiEnsureGraph = () => { if (!__started) { __started = true; start(); } return __ready; };
  window.__bomwikiExportGraph = async () => {
    const cy = await window.__bomwikiEnsureGraph();
    cy.fit(undefined, 30);
    const dataUrl = cy.png({ full: true, scale: 2, bg: '#ffffff' });
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const pad = 30, header = 92, footer = 50;
    const W = Math.max(img.width + pad * 2, 1000);
    const c = document.createElement('canvas');
    c.width = W; c.height = img.height + header + footer;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
    x.textBaseline = 'middle';
    x.fillStyle = '#3366cc'; x.font = 'bold 34px Georgia, "Times New Roman", serif';
    x.fillText('BOMwiki', pad, header / 2);
    const wmW = x.measureText('BOMwiki').width;
    x.fillStyle = '#202122'; x.font = '22px -apple-system, "Segoe UI", Roboto, sans-serif';
    let name = document.title.replace(/\s*\|.*$/, '');
    const maxW = W - pad * 2 - wmW - 24;
    while (x.measureText(name).width > maxW && name.length > 4) name = name.slice(0, -2);
    if (name !== document.title.replace(/\s*\|.*$/, '')) name = name.trim() + '…';
    x.fillText(name, pad + wmW + 24, header / 2 + 1);
    x.drawImage(img, (W - img.width) / 2, header);
    x.fillStyle = '#54595d'; x.font = '15px -apple-system, "Segoe UI", Roboto, sans-serif';
    x.fillText('bomwiki.com  ·  EVERYTHING IS BOM', pad, header + img.height + footer / 2);
    return await new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
  };
  // Toolbar Share button: native share sheet with the branded PNG where
  // supported (mobile), otherwise download it (desktop).
  async function shareGraph() {
    const m = location.pathname.match(/\/item\/([^/]+)/);
    const id = m ? m[1] : 'bomwiki';
    try {
      const blob = await window.__bomwikiExportGraph();
      const file = new File([blob], id + '-bom-graph.png', { type: 'image/png' });
      const nav = navigator;
      if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ title: document.title.replace(/\s*\|.*$/, ''), url: location.href, files: [file] });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = file.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
    } catch (e) { /* user cancelled or export failed */ }
  }
  const start = async () => {
   try {
    await ensureVendors();
    const cytoscape = window.cytoscape;
    cytoscape.use(window.cytoscapeDagre);

    const data = JSON.parse(document.getElementById('graphdata').textContent);
    const canvas = document.getElementById('bgcanvas');
    const info = document.getElementById('cyinfo');
    const isNarrow = () => window.matchMedia('(max-width: 640px)').matches;
    const graphPadding = () => (isNarrow() ? 22 : 38);

    const cy = cytoscape({
      container: document.getElementById('cy'),
      elements: { nodes: data.nodes, edges: data.edges },
      wheelSensitivity: 0.25,
      minZoom: 0.05, maxZoom: 4,
      style: [
        { selector: 'node', style: { 'background-color': '#ffffff', 'border-width': 1, 'border-color': '#a2a9b1', 'label': 'data(label)', 'text-wrap': 'wrap', 'text-max-width': '130', 'font-size': '9px', 'text-valign': 'center', 'text-halign': 'center', 'width': 'label', 'height': 'label', 'padding': '7px', 'shape': 'round-rectangle', 'color': '#202122', 'line-height': 1.25 } },
        { selector: 'node[kind="root"]', style: { 'background-color': '#eaf3ff', 'border-color': '#3366cc', 'border-width': 2, 'font-weight': 'bold' } },
        { selector: 'node[kind="shared"]', style: { 'background-color': '#fef6e7', 'border-color': '#ac6600' } },
        { selector: 'node[kind="part"]', style: { 'background-color': '#f8f9fa', 'border-color': '#a2a9b1', 'color': '#54595d' } },
        { selector: 'node[kind="other"]', style: { 'background-color': '#ffffff', 'border-color': '#3366cc', 'border-style': 'dashed', 'color': '#3366cc' } },
        { selector: 'node[expandable="1"]', style: { 'border-width': 2 } },
        { selector: 'edge', style: { 'width': 1, 'line-color': '#c8ccd1', 'target-arrow-color': '#c8ccd1', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.8, 'curve-style': 'bezier', 'label': 'data(qtyLabel)', 'font-size': '8px', 'color': '#54595d', 'text-background-color': '#fff', 'text-background-opacity': 1, 'text-background-padding': '1' } },
        { selector: 'edge[rel]', style: { 'line-style': 'dashed', 'line-color': '#3366cc', 'target-arrow-color': '#3366cc', 'label': 'data(rel)', 'color': '#3366cc' } },
        { selector: '.faded', style: { 'opacity': 0.12 } },
      ],
    });

    const rootId = data.root;
    const expanded = new Set([rootId]);
    const childMap = new Map();
    data.edges.forEach((e) => { if (e.data.rel) return; (childMap.get(e.data.source) ?? childMap.set(e.data.source, []).get(e.data.source)).push(e.data.target); });

    function recompute() {
      const visible = new Set([rootId]);
      const q = [rootId];
      while (q.length) {
        const x = q.shift();
        if (!expanded.has(x)) continue;
        for (const t of childMap.get(x) ?? []) if (!visible.has(t)) { visible.add(t); q.push(t); }
      }
      data.related.forEach((id) => visible.add(id));
      cy.batch(() => {
        cy.nodes().forEach((n) => n.style('display', visible.has(n.id()) ? 'element' : 'none'));
        cy.edges().forEach((e) => {
          const s = e.source().id(), t = e.target().id();
          const ok = visible.has(s) && visible.has(t) && (e.data('rel') || expanded.has(s));
          e.style('display', ok ? 'element' : 'none');
        });
      });
    }
    function relayout(fit = true) {
      const visible = cy.elements().filter((ele) => ele.style('display') !== 'none');
      cy.layout({
        name: 'dagre',
        rankDir: 'TB',
        nodeSep: isNarrow() ? 18 : 28,
        edgeSep: 10,
        rankSep: isNarrow() ? 58 : 82,
        padding: graphPadding(),
        fit,
        animate: false,
      }).run();
      if (fit) cy.fit(visible, graphPadding());
    }

    cy.on('tap', 'node', (evt) => {
      const n = evt.target, id = n.id();
      info.innerHTML = `<b>${n.data('name')}</b> <span>${n.data('meta') || ''}</span> <a href="${n.data('url')}">Open page ↗</a>`;
      info.hidden = false;
      cy.elements().removeClass('faded');
      const hood = n.closedNeighborhood();
      cy.elements().difference(hood).addClass('faded');
      if (n.data('kind') === 'other' || n.data('expandable') !== '1') { window.location.href = n.data('url'); return; }
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      recompute(); relayout(false);
    });
    cy.on('tap', (e) => { if (e.target === cy) { cy.elements().removeClass('faded'); info.hidden = true; } });

    const refit = () => cy.fit(cy.elements().filter((ele) => ele.style('display') !== 'none'), graphPadding());
    canvas.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => {
      const a = b.getAttribute('data-z');
      if (a === 'in') cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
      else if (a === 'out') cy.zoom({ level: cy.zoom() / 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
      else if (a === 'fit') refit();
      else if (a === 'expand') { cy.nodes('[expandable="1"]').forEach((n) => expanded.add(n.id())); recompute(); relayout(); }
      else if (a === 'collapse') { expanded.clear(); expanded.add(rootId); recompute(); relayout(); }
      else if (a === 'share') shareGraph();
      else if (a === 'full') { if (!document.fullscreenElement) canvas.requestFullscreen?.(); else document.exitFullscreen?.(); }
    }));
    document.addEventListener('fullscreenchange', () => setTimeout(() => { cy.resize(); refit(); }, 150));
    window.addEventListener('resize', () => setTimeout(() => { cy.resize(); relayout(true); }, 150));

    recompute();
    relayout();
    __resolveReady(cy);
   } catch (e) {
     console.error('build graph failed', e);
     const el = document.getElementById('cy');
     if (el) el.innerHTML = '<div style="padding:24px;color:#54595d;font-size:13px">The interactive graph could not load. The full breakdown is in the Bill of materials below.</div>';
   }
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); window.__bomwikiEnsureGraph(); }
    }, { rootMargin: '600px' });
    io.observe(section);
  } else {
    window.__bomwikiEnsureGraph();
  }
})();
