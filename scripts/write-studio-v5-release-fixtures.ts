import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCanonicalTurbofan, buildGearboxFixture, buildRobotJointFixture } from './studio-v5-release-fixtures.ts';

const output = join(import.meta.dirname, '..', 'fixtures', 'cad-v5');
await mkdir(output, { recursive: true });
for (const [slug, construction] of [
  ['turbofan-v5', buildCanonicalTurbofan()],
  ['gearbox-v5', buildGearboxFixture()],
  ['robot-joint-v5', buildRobotJointFixture()],
] as const) {
  await writeFile(join(output, `${slug}.bomcad.json`), JSON.stringify(construction.project, null, 2) + '\n');
  await writeFile(join(output, `${slug}.construction-log.json`), JSON.stringify(construction.log, null, 2) + '\n');
}
console.log(`Wrote canonical V5 fixtures to ${output}`);
