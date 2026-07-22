import { asset } from '../assets.ts';
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
  /** Social-card image (site-relative or absolute); defaults to the brand card. */
  ogImage?: string;
  /** 'website' for the home page, 'article' elsewhere. */
  ogType?: 'website' | 'article';
  /** JSON-LD objects to embed (e.g. BreadcrumbList, TechArticle). */
  jsonLd?: unknown[];
  /** Optional route-level body class for application shells and other
   *  deliberately non-document layouts. */
  bodyClass?: string;
}

// The site shell, ported from src/layouts/Base.astro. Same markup and class
// names so the extracted CSS applies unchanged. Analytics intentionally
// omitted until the engine serves production traffic.
const SITE = 'https://bomwiki.com';

export function page(opts: PageOpts): string {
  const canonical = `${SITE}${opts.path}`;
  const ogImage = opts.ogImage
    ? opts.ogImage.startsWith('http')
      ? opts.ogImage
      : `${SITE}${opts.ogImage}`
    : `${SITE}/og-card-v2.png`;
  const ogType = opts.ogType ?? (opts.path === '/' ? 'website' : 'article');
  const css = ['/static/base.css', ...(opts.extraCss ?? [])]
    .map((href) => `<link rel="stylesheet" href="${asset(href)}" />`)
    .join('\n    ');
  const jsonLd = (opts.jsonLd ?? [])
    .map(
      (obj) =>
        `<script type="application/ld+json">${JSON.stringify(obj).replaceAll('<', '\\u003c')}</script>`,
    )
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
    <meta property="og:site_name" content="BOMwiki" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:title" content="${esc(opts.title)}" />
    <meta property="og:description" content="${esc(opts.description)}" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta property="og:image" content="${esc(ogImage)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(opts.title)}" />
    <meta name="twitter:description" content="${esc(opts.description)}" />
    <meta name="twitter:image" content="${esc(ogImage)}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    ${css}
    ${jsonLd}
  </head>
  <body${opts.bodyClass ? ` class="${esc(opts.bodyClass)}"` : ''}>
    <header class="site">
      <a class="brand" href="/" aria-label="BOMwiki, the bill-of-materials encyclopedia home">
        <span class="b-name">BOMwiki</span>
        <span class="b-sub">the bill-of-materials encyclopedia</span>
      </a>
      <div class="site-mid">
        <form class="hdr-search" method="get" action="/search">
          <input type="search" name="q" placeholder="Search BOMwiki" aria-label="Search the catalog" autocomplete="off" />
          <a class="scan-entry" href="/scan/" aria-label="Scan an object" title="Scan an object">
            <span class="scan-glyph" aria-hidden="true"></span>
          </a>
        </form>
        <nav class="site-nav">
          <a href="/new">New page</a>
          <a href="/changes">Recent changes</a>
          <span id="bw-acct"><a href="/login">Sign in</a></span>
        </nav>
      </div>
      <a class="rev" href="/about/numbers/" title="How these are counted">${totalCatalogParts.toLocaleString()} parts mapped · ${nodeCount().toLocaleString()} items</a>
    </header>
    <script>
      fetch('/api/session').then((r) => r.json()).then((s) => {
        if (!s.handle) return;
        document.getElementById('bw-acct').innerHTML =
          '· <a href="/watchlist">Watchlist</a> · <a href="/user/' + s.handle + '">' + s.handle + '</a>';
      });
    </script>
    <main>
${opts.body}
    </main>
    <footer class="site proj-footer">
      <p class="pf-brand">
        <img src="${asset('/static/mark.svg')}" width="18" height="18" alt="" />
        <b>The BOMwiki Project</b>
        <span class="pf-motto">How everything is made, free to everyone.</span>
      </p>
      <p class="pf-links">
        <a href="/project">the project</a> · <a href="/project/engine">engine</a> · <a href="/about/">about</a> ·
        <a href="/about/governance">governance</a> · <a href="/about/verification">verification</a> ·
        <a href="/intelligence">intelligence</a> · <a href="/research">research</a> · <a href="/policies">policies</a> ·
        <a href="/help/editing">how to edit</a> · <a href="/products">all products</a> ·
        <a href="/cad">3D models</a> ·
        <a href="https://github.com/BOMWiki" rel="noopener">GitHub</a>
      </p>
      <p class="pf-credit">Engine <a href="https://github.com/BOMWiki/bomwiki" rel="noopener">open source, AGPL-3.0</a> · made by <a href="https://x.com/protosphinx" rel="me noopener">@protosphinx</a> on NEO · graph queries on <a href="https://ffsdb.com" rel="noopener">FFS</a>.</p>
    </footer>
    ${(opts.scripts ?? []).map((src) => `<script src="${asset(src)}" defer></script>`).join('\n    ')}
  </body>
</html>
`;
}
