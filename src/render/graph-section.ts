// The interactive build & assembly graph section, ported from the graph block
// of src/pages/item/[slug].astro. Emits the section shell plus the graph data
// as an embedded JSON script; /static/graph.js hydrates it lazily (Cytoscape
// only loads once the section scrolls into view).
import { buildGraphData } from '../buildgraph.ts';
import type { NodeData } from '../nodes.ts';

export function graphSection(node: NodeData): string {
  // The site renders the graph only for products and assemblies.
  if (node.kind === 'part') return '';
  const graphData = buildGraphData(node);
  return `<section class="buildgraph">
          <div class="sec-head">
            <h2>Build &amp; assembly graph</h2>
            <span class="sec-n">expand / collapse · shared sub-assemblies converge · links to related products · est. labour</span>
          </div>
          <div class="bg-legend">
            <span class="lg prod">product / assembly</span>
            <span class="lg shared">shared across products</span>
            <span class="lg part">atomic part</span>
            <span class="lg other">related product</span>
          </div>
          <div class="bg-canvas" id="bgcanvas">
            <div class="bg-tools">
              <button type="button" data-z="in" title="Zoom in">+</button>
              <button type="button" data-z="out" title="Zoom out">−</button>
              <button type="button" data-z="fit" title="Fit to view">Fit</button>
              <button type="button" data-z="expand" title="Expand all">Expand all</button>
              <button type="button" data-z="collapse" title="Collapse all">Collapse</button>
              <button type="button" data-z="share" title="Share or download this graph as an image">↗ Share</button>
              <button type="button" data-z="full" title="Fullscreen">⤢</button>
            </div>
            <div id="cy"></div>
            <div class="bg-info" id="cyinfo" hidden></div>
            <span class="bg-wm" aria-hidden="true">BOMwiki</span>
          </div>
          <p class="bg-hint">Tap an assembly to expand/collapse · tap a part to open it · use “Open page” for any node · drag to pan, scroll to zoom.</p>
          <script type="application/json" id="graphdata">${JSON.stringify(graphData).replaceAll('<', '\\u003c')}</script>
        </section>`;
}
