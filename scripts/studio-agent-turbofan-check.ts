// The final agent release benchmark depends on generic advanced V5 operations.
// This check must fail loudly until those operations are genuinely available;
// it is never permitted to replace them with a turbofan-specific generator.
// @ts-expect-error Browser-native module intentionally has no declarations.
import { cadCapabilityManifest } from '../static/studio-agent-service.js';

const required = [
  'datum.createPlane',
  'body.transform',
  'feature.loft',
  'feature.sweep',
  'pattern.circular',
  'component.insert',
  'mate.create',
  'section.create',
];
const manifest = cadCapabilityManifest({ exactKernel: false });
const operations = new Map(manifest.operations.map((entry: any) => [entry.kind, entry]));
const blocked = required.flatMap((kind) => {
  const capability: any = operations.get(kind);
  return capability?.state === 'available' ? [] : [{ kind, reasonCode: capability?.disabledReasonCode || 'CAPABILITY_NOT_IMPLEMENTED' }];
});

console.log(JSON.stringify({
  benchmark: 'CAD_STUDIO_V5_COMPLEX_MODELING_SPEC.md#40',
  status: blocked.length ? 'blocked' : 'ready-for-construction-replay',
  noCheatRule: 'No turbofan-specific operation, imported finished geometry, private JSON mutation, DOM automation, or Computer Use.',
  blocked,
}, null, 2));

if (blocked.length) process.exitCode = 2;
