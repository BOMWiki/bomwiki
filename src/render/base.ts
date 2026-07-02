import { esc } from '../html.ts';
import { nodeCount, totalCatalogParts } from '../nodes.ts';

export interface PageOpts {
  title: string;
  description: string;
  path: string;
  indexable: boolean;
  body: string;
  extraCss?: string[];
  scripts?: string[];
}

// The site shell, ported from src/layouts/Base.astro. Same markup and class
// names so the extracted CSS applies unchanged. Analytics intentionally
// omitted until the engine serves production traffic.
export function page(opts: PageOpts): string {
  const canonical = `https://bomwiki.com${opts.path}`;
  const css = ['/static/base.css', ...(opts.extraCss ?? [])]
    .map((href) => `<link rel="stylesheet" href="${href}" />`)
    .join('\n    ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${esc(opts.description)}" />
    <title>${esc(opts.title)}</title>
    <link rel="canonical" href="${esc(canonical)}" />
    ${opts.indexable ? '' : '<meta name="robots" content="noindex,follow" />'}
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    ${css}
  </head>
  <body>
    <header class="site">
      <a class="brand" href="/" aria-label="BOMwiki, the bill-of-materials encyclopedia home">
        <span class="b-name">BOMwiki</span>
        <span class="b-sub">the bill-of-materials encyclopedia</span>
      </a>
      <a class="rev" href="/about/numbers/" title="How these are counted">${totalCatalogParts.toLocaleString()} parts mapped · ${nodeCount().toLocaleString()} items</a>
    </header>
    <main>
${opts.body}
    </main>
    <footer class="site">
      <span>BOMwiki · made by <a href="https://x.com/protosphinx" rel="me noopener">@protosphinx</a> on NEO · runs on <a href="https://ffsdb.com" rel="noopener">FFS</a> · <a href="/about/">about</a>.</span>
    </footer>
    ${(opts.scripts ?? []).map((src) => `<script src="${src}" defer></script>`).join('\n    ')}
  </body>
</html>
`;
}
