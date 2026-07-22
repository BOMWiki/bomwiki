import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { cadCapabilityManifest } from '../static/studio-agent-service.js';
import { buildCanonicalTurbofan, buildGearboxFixture, buildRobotJointFixture } from './studio-v5-release-fixtures.ts';
import { evidenceRoot, sha256File, sha256Json } from './studio-v5-evidence-support.ts';

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, '..');
const repoRoot = join(engineRoot, '..');
const manifestPath = join(engineRoot, 'var', 'studio-v5-release-manifest.json');
const releaseAttestationPath = join(engineRoot, 'CAD_STUDIO_V5_RELEASE_ATTESTATION.json');
const validateOnly = process.argv.includes('--validate-evidence');

const commands = [
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['migration', process.execPath, ['--experimental-strip-types', 'scripts/studio-v5-schema-check.ts']],
  ['slice-5a-runtime', process.execPath, ['--experimental-strip-types', 'scripts/studio-v5-runtime-check.ts', 'all']],
  ['datums-transforms', process.execPath, ['--experimental-strip-types', 'scripts/studio-v5-datums-check.ts', 'all']],
  ['advanced-shapes', process.execPath, ['--experimental-strip-types', 'scripts/studio-v5-shapes-check.ts', 'all']],
  ['patterns', process.execPath, ['--experimental-strip-types', 'scripts/studio-v5-patterns-check.ts', 'all']],
  ['assemblies', process.execPath, ['--experimental-strip-types', 'scripts/studio-v5-assemblies-check.ts', 'all']],
  ['inspection', process.execPath, ['--experimental-strip-types', 'scripts/studio-v5-inspection-check.ts', 'all']],
  ['interchange', process.execPath, ['--experimental-strip-types', 'scripts/studio-v5-interchange-check.ts', 'all']],
  ['ten-capabilities', process.execPath, ['--experimental-strip-types', 'scripts/studio-v5-ten-capability-check.ts', 'all']],
  ['canonical-benchmarks', process.execPath, ['--experimental-strip-types', 'scripts/studio-v5-benchmarks-check.ts', 'all']],
  ['production-studio', process.execPath, ['--experimental-strip-types', 'scripts/studio-check.ts']],
  ['agent-core', process.execPath, ['--experimental-strip-types', 'scripts/studio-agent-check.ts', 'all']],
  ['agent-headless', process.execPath, ['--experimental-strip-types', 'scripts/studio-agent-headless-check.ts']],
  ['agent-mcp', process.execPath, ['--experimental-strip-types', 'scripts/studio-agent-mcp-check.ts']],
  ['agent-browser-parity', process.execPath, ['--experimental-strip-types', 'scripts/studio-agent-browser-check.ts']],
  ['agent-turbofan', process.execPath, ['--experimental-strip-types', 'scripts/studio-agent-turbofan-check.ts']],
  ['agent-release', process.execPath, ['--experimental-strip-types', 'scripts/studio-agent-release-check.ts']],
  ['accessibility', process.execPath, ['--experimental-strip-types', 'scripts/studio-v5-accessibility-check.ts']],
  ['performance', process.execPath, ['--experimental-strip-types', 'scripts/studio-v5-performance-check.ts']],
  ['visual-capture', process.execPath, ['--experimental-strip-types', 'scripts/studio-v5-visual-check.ts']],
] as const;

function run(name: string, executable: string, args: readonly string[]) {
  if (validateOnly) return { status: 'delegated-to-calling-ci', exitCode: null, outputSha256: null, outputTail: [] };
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(executable, [...args], { cwd: engineRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = (result.stdout || '') + (result.stderr || '');
  process.stdout.write(output);
  return {
    status: result.status === 0 ? 'pass' : 'fail', exitCode: result.status,
    outputSha256: createHash('sha256').update(output).digest('hex'), outputTail: output.trim().split('\n').slice(-12),
  };
}

function evidence(relativePath: string) {
  const path = join(evidenceRoot, relativePath);
  if (!existsSync(path)) return { path, status: 'missing', reason: 'required evidence manifest does not exist' };
  try { return { path, status: 'present', sha256: sha256File(path), manifest: JSON.parse(readFileSync(path, 'utf8')) }; }
  catch (error) { return { path, status: 'invalid', reason: String((error as Error).message || error) }; }
}

function sourceJson(path: string) {
  if (!existsSync(path)) return { path, status: 'missing', reason: 'required source attestation does not exist' };
  try { return { path, status: 'present', sha256: sha256File(path), manifest: JSON.parse(readFileSync(path, 'utf8')) }; }
  catch (error) { return { path, status: 'invalid', reason: String((error as Error).message || error) }; }
}

const checks = Object.fromEntries(commands.map(([name, executable, args]) => [name, run(name, executable, args)]));
const fixtures = {
  turbofan: buildCanonicalTurbofan(), gearbox: buildGearboxFixture(), robotJoint: buildRobotJointFixture(),
};
const expectedTurbofanHash = sha256Json(fixtures.turbofan.project);
const evidenceManifests = {
  performance: evidence('performance/performance-manifest.json'),
  accessibility: evidence('accessibility/accessibility-manifest.json'),
  visual: evidence('visual/visual-manifest.json'),
};
const releaseAttestationEvidence = sourceJson(releaseAttestationPath);
const performance = (evidenceManifests.performance as any).manifest;
const accessibility = (evidenceManifests.accessibility as any).manifest;
const visual = (evidenceManifests.visual as any).manifest;
const releaseAttestation = (releaseAttestationEvidence as any).manifest;
const evidenceValid = performance?.status === 'pass' && performance?.projectHash === expectedTurbofanHash
  && accessibility?.status === 'pass' && accessibility?.projectHash === expectedTurbofanHash
  && visual?.status === 'awaiting-human-review' && visual?.projectHash === expectedTurbofanHash
  && Array.isArray(visual?.captures) && visual.captures.length >= 6
  && visual.captures.every((capture: any) => existsSync(capture.path) && sha256File(capture.path) === capture.sha256);
const requiredReviewQuestions = Array.isArray(visual?.reviewerQuestions) ? visual.reviewerQuestions : [];
const attestedAnswers = new Map(Array.isArray(releaseAttestation?.answers)
  ? releaseAttestation.answers.map((answer: any) => [answer?.question, answer?.approved === true])
  : []);
const attestedCaptures = Array.isArray(releaseAttestation?.visualEvidence?.captures)
  ? releaseAttestation.visualEvidence.captures
  : [];
const requiredCaptureIds = [...(visual?.requiredDesktopCaptures || []), ...(visual?.supplementaryCaptures || [])];
const attestedCaptureHashes = new Map<string, string>(attestedCaptures.map((capture: any) => [capture?.id, capture?.sha256] as [string, string]));
const humanReviewValid = releaseAttestationEvidence.status === 'present'
  && releaseAttestation?.status === 'approved-for-production'
  && releaseAttestation?.reviewedCandidate?.protectedCiStatus === 'pass'
  && releaseAttestation?.reviewedCandidate?.candidateDeploymentStatus === 'pass'
  && releaseAttestation?.visualEvidence?.projectHash === expectedTurbofanHash
  && releaseAttestation?.visualEvidence?.constructionLogHash === sha256Json(fixtures.turbofan.log)
  && requiredReviewQuestions.length === 6
  && attestedAnswers.size === 6
  && requiredReviewQuestions.every((question: string) => attestedAnswers.get(question) === true)
  && requiredCaptureIds.length === 6
  && attestedCaptureHashes.size === 6
  && requiredCaptureIds.every((id: string) => /^[a-f0-9]{64}$/.test(attestedCaptureHashes.get(id) || ''));
const automatedChecksPass = validateOnly || Object.values(checks).every((entry: any) => entry.status === 'pass');
const capabilities = cadCapabilityManifest({ exactKernel: true });
const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim() || null;
const dirty = Boolean(spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim());
const manifest = {
  generatedAt: new Date().toISOString(), sourceCommit, dirtyWorkingTree: dirty,
  validationMode: validateOnly ? 'calling-ci-plus-evidence-manifests' : 'standalone-full-suite',
  schemaVersion: 5, browserVersion: performance?.browser || accessibility?.browser || null,
  kernelVersion: capabilities.kernelVersion, protocolVersion: capabilities.protocolVersion,
  fixtures: Object.fromEntries(Object.entries(fixtures).map(([name, fixture]) => [name, {
    projectId: fixture.project.projectId, projectHash: sha256Json(fixture.project), constructionLogHash: sha256Json(fixture.log),
  }])),
  checks, evidence: { ...evidenceManifests, releaseAttestation: releaseAttestationEvidence },
  gates: {
    automated: automatedChecksPass && evidenceValid ? 'pass' : 'fail',
    performance: performance?.status || 'missing', accessibility: accessibility?.status || 'missing',
    visualEvidence: visual?.status || 'missing', humanVisualReview: humanReviewValid ? 'approved-by-product-owner-attestation' : 'pending',
    liveDeployment: humanReviewValid ? 'candidate-live-release-sha-requires-protected-promotion' : 'not-run-by-local-release-check',
    finalReleaseSignoff: humanReviewValid ? 'approved-for-protected-production-promotion' : 'blocked-until-human-review-and-live-verification',
  },
  status: automatedChecksPass && evidenceValid && humanReviewValid ? 'v5-release-approved-protected-delivery-required' : 'failed',
};

mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
console.log(`\n${JSON.stringify({ status: manifest.status, manifestPath, humanVisualReview: manifest.gates.humanVisualReview }, null, 2)}`);
if (!automatedChecksPass || !evidenceValid || !humanReviewValid) process.exitCode = 1;
