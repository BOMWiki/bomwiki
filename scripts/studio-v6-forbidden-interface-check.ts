import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

let passed = 0;
let failed = 0;
function check(name: string, condition: unknown, detail?: unknown) {
  if (condition) {
    passed++;
    console.log('  PASS', name);
  } else {
    failed++;
    console.error('  FAIL', name, detail ?? '');
  }
}

console.log('\nCAD Studio V6 forbidden-interface audit');
const engineRoot = join(import.meta.dirname, '..');
const productionFiles = [
  'static/studio-v6-interaction.js',
  'scripts/studio-agent-mcp.ts',
];
const forbidden = [
  ['DOM globals', /\b(?:document|window)\s*\./],
  ['DOM selectors', /\b(?:querySelector|querySelectorAll|getElementById|XPath)\b/],
  ['browser automation imports', /\b(?:puppeteer|playwright|selenium|webdriver)\b/i],
  ['simulated input', /\b(?:PointerEvent|KeyboardEvent|MouseEvent|dispatchEvent)\b/],
  ['coordinate control', /\b(?:clientX|clientY|screenX|screenY|wheelDelta|dragPath)\b/],
  ['synthetic click control', /\.click\s*\(/],
] as const;

for (const file of productionFiles) {
  const source = await readFile(join(engineRoot, file), 'utf8');
  const executableSource = source.split('\n')
    .filter((line) => !line.trimStart().startsWith('import '))
    .join('\n')
    // Action and event IDs intentionally contain values such as
    // "document.activate". Mask literals/comments so the audit detects
    // executable browser-global access rather than protocol vocabulary.
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ');
  const hits = forbidden.filter(([, pattern]) => pattern.test(executableSource)).map(([label]) => label);
  check(`${file} contains no forbidden UI-control interface`, hits.length === 0, hits);
}

const coreSkill = await readFile(join(engineRoot, 'skills/bomwiki-cad/SKILL.md'), 'utf8');
check('portable skill explicitly rejects pixel and DOM control',
  /Never use Computer Use/.test(coreSkill) &&
  /DOM inspection/.test(coreSkill) &&
  /pointer coordinates/.test(coreSkill));
check('portable skill requires revisioned semantic UI and preview/commit',
  /expectedUiRevision/.test(coreSkill) &&
  /cad_preview/.test(coreSkill) &&
  /cad_commit/.test(coreSkill));

console.log(`\n${passed}/${passed + failed} forbidden-interface checks passed`);
if (failed) process.exitCode = 1;
