// Deterministic public-agent construction replay for the canonical V5
// turbofan. Exact geometry/browser/performance evidence lives in
// studio-v5-benchmarks-check.ts; this gate proves no private fixture mutation
// or turbofan-specific operation is required to author the document.

// @ts-expect-error Browser-native modules intentionally have no declarations.
import { cadCapabilityManifest } from '../static/studio-agent-service.js';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { solveStudioV5Assembly } from '../static/studio-v5-assembly.js';
import { buildCanonicalTurbofan, TURBOFAN_IDS } from './studio-v5-release-fixtures.ts';

const construction = buildCanonicalTurbofan();
const manifest = cadCapabilityManifest({ exactKernel: false });
const available = new Set(manifest.operations.filter((entry: any) => entry.state === 'available').map((entry: any) => entry.kind));
const operations = construction.log.flatMap((transaction: any) => transaction.operations);
const unadvertised = [...new Set(operations.map((operation: any) => operation.kind).filter((kind: string) => !available.has(kind)))];
const forbidden = operations.filter((operation: any) =>
  /turbofan|import|mesh|brep|fixture/i.test(operation.kind) || operation.kind === 'project.replace');
const solution = solveStudioV5Assembly(construction.project, TURBOFAN_IDS.rootAssembly);
const parts = construction.project.partDefinitions.length;
const bodies = construction.project.partDefinitions.flatMap((part: any) => part.bodies).length;
const patterns = construction.project.assemblyDefinitions.flatMap((assembly: any) => assembly.occurrencePatterns).length;
const mates = construction.project.assemblyDefinitions.flatMap((assembly: any) => assembly.mates);
const pass = unadvertised.length === 0 && forbidden.length === 0 && solution.errors.length === 0 && solution.state === 'fully-constrained' &&
  parts >= 15 && bodies >= 24 && solution.leafOccurrences.length >= 100 && patterns >= 8 &&
  mates.filter((mate: any) => mate.kind === 'concentric').length >= 8 && mates.filter((mate: any) => mate.kind === 'distance').length >= 8;

console.log(JSON.stringify({
  benchmark: 'CAD_STUDIO_V5_COMPLEX_MODELING_SPEC.md#40',
  status: pass ? 'public-command-replay-pass' : 'fail',
  noCheatRule: 'No turbofan-specific operation, imported finished geometry, private JSON mutation, DOM automation, or Computer Use.',
  constructionTransactions: construction.log.length,
  operationCount: operations.length,
  unadvertised,
  forbiddenKinds: forbidden.map((operation: any) => operation.kind),
  structure: { parts, bodies, solvedOccurrences: solution.leafOccurrences.length, patterns, mates: mates.length, solverState: solution.state },
  solverErrors: solution.errors,
}, null, 2));

if (!pass) process.exitCode = 1;
