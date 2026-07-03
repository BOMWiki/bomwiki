// Generate social cards for the doc and hub pages (the ones that aren't a
// catalog node, so they have no /og/<id> card). On-brand: Wikipedia-gray,
// serif title, a line-art motif, and the site's question as the footer.
// Offline ops tool — renders SVG to PNG with rsvg-convert and writes to an
// output dir that is then deployed to PUBLIC_DIR/og/page/. Not a runtime
// dependency of the engine.
//
//   node scripts/gen-page-cards.mjs [outDir]   (default: ./og-page-cards)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const INK = '#202122';
const MUTED = '#54595d';
const LINE = '#c8ccd1';
const RULE = '#a2a9b1';
const LINK = '#3366cc';
const PANEL = '#f8f9fa';
// Stroke attributes as a helper so no element ever sets stroke twice
// (browsers tolerate a redefined attribute; libxml/rsvg rejects it).
const st = (color = MUTED, w = 3) =>
  `fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const fs = (fill, color = MUTED, w = 3) =>
  `fill="${fill}" stroke="${color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

// A distinct line-art motif per page, drawn around a 300x300 box (placed right).
const MOTIF = {
  // Exploded cube: the brand mark, for the top-level pages.
  explode: `<g transform="translate(150 150)">
    <path d="M-70 -20 L0 -55 L70 -20 L0 15 Z" ${fs(PANEL)}/>
    <path d="M-70 -20 L-70 45 L0 80 L0 15 Z" ${fs('#eef1f4')}/>
    <path d="M70 -20 L70 45 L0 80 L0 15 Z" ${fs('#e4e8ec')}/>
    <path d="M0 -95 L45 -70 M0 -95 L-45 -70" ${st(RULE)}/>
    <path d="M-105 30 L-80 5 M115 30 L80 5" ${st(RULE)}/>
  </g>`,
  gear: `<g transform="translate(150 150)">${Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180, x = 92 * Math.cos(a), y = 92 * Math.sin(a);
    return `<rect x="${(x - 10).toFixed(1)}" y="${(y - 10).toFixed(1)}" width="20" height="20" ${fs(PANEL, MUTED, 2.5)} transform="rotate(${i * 30} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }).join('')}<circle r="66" ${fs(PANEL)}/><circle r="26" ${fs('#fff')}/></g>`,
  shield: `<g transform="translate(150 150)"><path d="M0 -90 L75 -58 V10 Q75 70 0 95 Q-75 70 -75 10 V-58 Z" ${fs(PANEL)}/><path d="M-34 2 L-8 34 L44 -34" ${st(LINK, 7)}/></g>`,
  scales: `<g transform="translate(150 150)"><path d="M0 -80 V70 M-56 84 H56" ${st()}/><path d="M-72 -46 H72" ${st()}/><circle cx="0" cy="-80" r="8" ${fs(PANEL)}/><path d="M-72 -46 L-96 12 H-48 Z" ${fs(PANEL)}/><path d="M72 -46 L48 12 H96 Z" ${fs(PANEL)}/></g>`,
  cpu: `<g transform="translate(150 150)"><rect x="-60" y="-60" width="120" height="120" rx="8" ${fs(PANEL)}/><rect x="-28" y="-28" width="56" height="56" rx="4" ${fs('#fff')}/>${[-40, -14, 14, 40].map((o) => `<path d="M${o} -60 V-86 M${o} 60 V86 M-60 ${o} H-86 M60 ${o} H86" ${st(MUTED, 2.5)}/>`).join('')}</g>`,
  page: `<g transform="translate(150 150)"><path d="M-58 -84 H30 L58 -56 V84 H-58 Z" ${fs(PANEL)}/><path d="M30 -84 V-56 H58" ${st()}/><path d="M-38 -20 H38 M-38 6 H38 M-38 32 H14" ${st(RULE, 2.5)}/></g>`,
  people: `<g transform="translate(150 150)"><circle cx="-40" cy="-30" r="26" ${fs(PANEL)}/><circle cx="42" cy="-38" r="22" ${fs('#fff')}/><path d="M-86 66 Q-86 8 -40 8 Q6 8 6 66" ${fs(PANEL)}/><path d="M6 66 Q6 16 42 16 Q86 16 86 66" ${fs('#fff')}/></g>`,
  camera: `<g transform="translate(150 150)"><rect x="-78" y="-44" width="156" height="104" rx="10" ${fs(PANEL)}/><circle r="34" ${fs('#fff')}/><circle r="15" ${fs(PANEL)}/><rect x="-52" y="-64" width="40" height="22" rx="4" ${fs(PANEL)}/></g>`,
  plus: `<g transform="translate(150 150)"><rect x="-80" y="-80" width="160" height="160" rx="14" ${fs(PANEL)}/><path d="M0 -42 V42 M-42 0 H42" ${st(LINK, 8)}/></g>`,
};

// key -> file path under PUBLIC_DIR/og/page/<key>.png, referenced as ogImage.
const PAGES = [
  { key: 'home', title: 'BOMwiki', tagline: 'The open encyclopedia of what everything is made of.', motif: 'explode', big: true },
  { key: 'products', title: 'Every product, exploded', tagline: '4,900+ products mapped down to the last screw.', motif: 'gear' },
  { key: 'help-editing', title: 'How to edit', tagline: 'Anyone can fix a quantity, add a part, or write a page.', motif: 'page' },
  { key: 'governance', title: 'Governance', tagline: 'Who decides, and how disagreements get settled.', motif: 'scales' },
  { key: 'verification', title: 'How verification works', tagline: 'Unverified, machine-checked, human-verified.', motif: 'shield' },
  { key: 'intelligence', title: 'BOM Intelligence', tagline: 'The machine that checks every change before a person sees it.', motif: 'cpu' },
  { key: 'project', title: 'The BOMwiki Project', tagline: 'The mission, the engine, and how to help.', motif: 'explode' },
  { key: 'engine', title: 'The engine', tagline: 'Open source. Node and Postgres, no framework.', motif: 'cpu' },
  { key: 'policies', title: 'Policies', tagline: 'The trust ladder, rate limits, and moderation.', motif: 'page' },
  { key: 'about', title: 'About BOMwiki', tagline: 'A community-built map of how things are made.', motif: 'explode' },
  { key: 'contributors', title: 'Contributors', tagline: 'The people building the BOM of the world.', motif: 'people' },
  { key: 'photos-needed', title: 'Pages needing photos', tagline: 'Help put a real photo on every machine.', motif: 'camera' },
  { key: 'new', title: 'Create a page', tagline: 'Start a new product, assembly, or part from scratch.', motif: 'plus' },
];

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Break a title into at most two lines near the middle so long titles wrap
// instead of overflowing the card.
function titleLines(title) {
  if (title.length <= 20) return [title];
  const words = title.split(' ');
  let a = '', b = '';
  for (const w of words) {
    if (a.length < title.length / 2) a += (a ? ' ' : '') + w;
    else b += (b ? ' ' : '') + w;
  }
  return b ? [a, b] : [a];
}

function card(p) {
  const lines = titleLines(p.title);
  const size = p.big ? 92 : lines.length > 1 ? 66 : 76;
  const startY = 300 - (lines.length - 1) * (size * 0.6);
  const titleSvg = lines
    .map((l, i) => `<text x="90" y="${startY + i * size * 1.15}" font-family="Georgia, 'Times New Roman', serif" font-size="${size}" fill="${INK}">${esc(l)}</text>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#ffffff"/>
  <rect width="1200" height="630" fill="none" stroke="${LINE}" stroke-width="2"/>
  <rect x="0" y="0" width="1200" height="10" fill="${LINK}"/>
  <g opacity="0.5">${Array.from({ length: 13 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100}" y2="630" stroke="${PANEL}" stroke-width="1"/>`).join('')}${Array.from({ length: 7 }, (_, i) => `<line x1="0" y1="${i * 100}" x2="1200" y2="${i * 100}" stroke="${PANEL}" stroke-width="1"/>`).join('')}</g>
  <text x="90" y="120" font-family="Georgia, serif" font-size="34" fill="${INK}">BOMwiki</text>
  <line x1="90" y1="145" x2="230" y2="145" stroke="${RULE}" stroke-width="2"/>
  ${titleSvg}
  <text x="90" y="470" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="30" fill="${MUTED}">${esc(p.tagline)}</text>
  <text x="90" y="560" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="26" fill="${LINK}">bomwiki.com</text>
  <text x="1110" y="560" text-anchor="end" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="22" fill="${RULE}">What is everything made of?</text>
  <g transform="translate(760 150)">${MOTIF[p.motif]}</g>
</svg>`;
}

const outDir = process.argv[2] || join(process.cwd(), 'og-page-cards');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const p of PAGES) {
  const svgPath = join(outDir, `${p.key}.svg`);
  const pngPath = join(outDir, `${p.key}.png`);
  writeFileSync(svgPath, card(p));
  execFileSync('rsvg-convert', ['-w', '1200', '-h', '630', svgPath, '-o', pngPath]);
  rmSync(svgPath);
  console.log(`wrote ${pngPath}`);
}
console.log(`\n${PAGES.length} cards in ${outDir}`);
