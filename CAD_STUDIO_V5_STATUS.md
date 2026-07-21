# CAD Studio V5 implementation status

Last updated: 2026-07-21

Status branch: `codex/cad-v5-runtime`

Specification: `CAD_STUDIO_V5_COMPLEX_MODELING_SPEC.md`

Production baseline: `wiki/engine@0d1a5aef9`

Status: Slice 5A schema boundary is merged; the Slice 5A-runtime implementation candidate passes its local acceptance gate but is not merged, deployed, or live-verified, so every V5 release gate remains open

## Product finding that triggered V5

The production Studio was used twice to build a turbofan-like model from the editable Round spacer template. The result could produce an outer ring, a circular pattern of flat extrusions, and a revolved spinner, but it remained a single crude ducted fan rather than a credible engine assembly. The second attempt confirmed that more rings and a higher blade count only decorate the same limitation; they do not create axial stages, shaped blades, independent bodies, or inspectable engine structure.

That attempt established the missing capability boundary:

- no practical multi-body/component structure;
- no shaped, twisted blade Loft;
- no general Sweep workflow;
- no reusable datum-plane and transform system;
- no real assembly hierarchy or mates;
- no non-destructive section/cutaway view;
- no interference, clearance, mass, or structure-preserving export proof.
- no objective browser benchmark that rejects a ring-with-spokes result before release.

V5 addresses those generic CAD gaps. It must not solve the benchmark with a turbofan-only generator or opaque template geometry.

## Dependency

V5 depends on the V4 precision and trust foundation described in `CAD_STUDIO_V4_SPEC.md`, especially:

- schema-4 migration and stable sketch/constraint identity;
- transactional Apply/Cancel and document commands;
- owner-aware topology references;
- worker-based rebuild and stale-revision safety;
- constrained sketches, profile validity, exact previews, and recovery.

V5 schema-5 implementation should not begin by replacing or bypassing unfinished V4 contracts. The first V5 implementation work may prepare compatible data boundaries and tests while V4 completes, but release gates remain ordered.

## Current production capabilities

Production already has:

- OpenCascade B-rep evaluation through replicad;
- Extrude, Cut, Revolve, Fillet, Chamfer, Shell, and profile patterns;
- basic sketch-on-face and edge/face picking;
- parameters, expressions, history, undo/redo, local persistence, STEP/STL export;
- full-screen precision workspace, ribbon, model tree, inspector, and editable templates;
- direct sketch-to-solid Press/Pull.

Production does not satisfy any V5 release gate yet. The schema boundary below is merged implementation progress. The multi-body behavior described afterward exists only on the current implementation branch until review, CI, merge, deployment, and live verification occur.

## Slice 5A schema-boundary progress

Implemented and merged in Slice 5A:

- schema-5 TypeScript types for projects, document references, parameters, materials, datums, sketches, part features, bodies, parts, assemblies, occurrences, mates, occurrence patterns, exploded views, sections, and resources;
- a detached browser-native validation boundary with explicit size, count, depth, generated-occurrence, decoded-resource, and MIME limits;
- separate 20 MiB canonical-document, 100 MiB decoded-resource, and 160 MiB encoded-file budgets with a bounded linear canonical-base64 validator;
- safe expression parsing, unknown-parameter rejection, finite evaluation, and project-to-part/assembly parameter scope resolution without `eval` or `Function`;
- project-wide ID namespaces and reference validation for feature inputs, sketch supports, body ownership, materials, parts, assemblies, occurrence paths, mates, patterns, root documents, and resource payloads;
- consistency checks proving every body history agrees with its features' new-body, surface, add, subtract, or intersect result policies;
- cycle detection for parameter expressions, feature dependencies, occurrence parenting, and recursive assembly containment;
- deterministic migration of production schema-3 files into one part and one initial body;
- a temporary opaque schema-4 migration adapter that preserves unknown V4 feature and sketch data until the final schema-4 contract lands;
- exact schema-5 round trips, detached return values, preservation of unknown safe extensions and feature result policies, and mutation-safe refusal of malformed input;
- 118 focused schema checks covering round trips, migrations, safe expressions, body/result ownership, owner-aware references, occurrence paths and overrides, duplicate-reference rejection, typed record containers, cycles, independent document/resource budgets, large and non-canonical resources, newer schemas, and unchanged input on every rejection fixture;
- the protected `engine-studio` PR workflow now runs the V5 schema suite alongside typecheck and the production browser/kernel suite.

Implemented by the Slice 5A-runtime candidate on this branch:

- schema-5 file open/save, local journal persistence, recovery, canonical undo/redo snapshots, and schema-3/schema-4 migration through the production document path;
- a schema-5 worker protocol that evaluates, caches, meshes, reports errors for, and returns multiple named exact body results;
- exact `new-body`, `add`, `subtract`, and `intersect` policies for current solid feature types, plus explicit refusal of unsupported surface results;
- stable body IDs, feature ownership, explicit active-body behavior, per-body visibility/suppression, last-valid recovery, and affected-chain incremental rebuild traces;
- per-body rendering, canvas/tree selection and highlighting, owner-scoped face/edge metadata, and body-aware error state;
- body-tree select, activate, rename, show/hide, isolate, suppress/restore, export-select, and dependency-aware delete controls without a broader UI redesign;
- exact preflight for explicit body Boolean edits, including stale-validation refusal before document or undo-stack mutation;
- selected-body named STEP export and selected-body STL export with an exact manifest for body/solid count, millimetre units, names, and bounds;
- focused document, kernel, and visible-browser coverage for all ten Slice 5A-runtime acceptance steps.

Deliberately not implemented by this candidate:

- surface-producing features; current solid features reject the `surface` policy explicitly;
- datum geometry, transforms, Loft, Sweep, advanced patterns, assemblies, mates, sectioning, inspection, structured assembly interchange, or the §40 turbofan;
- schema-4 final-contract replacement, live verification, or closure of any V5 release gate.

The `v5-schema` gate remains open because the temporary schema-4 adapter must be replaced and verified against the final V4 fixtures before schema 5 becomes a production document format.

## Next implementation action

Review the Slice 5A-runtime candidate, require its full local and protected-CI suites to remain green, then merge and live-verify it separately before considering `v5-multibody` gate closure. In parallel, replace the temporary opaque schema-4 adapter once the final schema-4 format is stable. Do not begin Loft UI or assembly controls until the multi-body result has been merged and verified without unintended fusion.

The browser benchmark in §40 is now the normative V5 conformance test. Progress screenshots do not close a gate unless the underlying project also passes its structural, editability, validity, and round-trip assertions.

## Release gates

All gates are open:

- [ ] `v5-schema`
- [ ] `v5-multibody`
- [ ] `v5-datums-transforms`
- [ ] `v5-advanced-shapes`
- [ ] `v5-patterns`
- [ ] `v5-assemblies`
- [ ] `v5-inspection`
- [ ] `v5-interchange`
- [ ] `v5-performance`
- [ ] `v5-accessibility`
- [ ] `v5-visual`
- [ ] `v5-turbofan`
- [ ] `v5-generality`
- [ ] `v5-live`

Gate definitions and required evidence are in §36 of the V5 specification.

## Last verified implementation evidence

- `npm run typecheck` — pass
- `npm run studio:v5:migration` — 118/118 schema-5 checks pass
- `npm run studio:v5:runtime:document` — 18/18 canonical document, dependency, and transaction checks pass
- `npm run studio:v5:runtime:kernel` — 14/14 exact OpenCascade body, cache, failure, and export checks pass
- `npm run studio:v5:runtime:browser` — 49/49 visible ten-step acceptance, renderer/topology, transactional-control, and mobile body-tree checks pass
- `npm run studio:check` — 277/277 production Studio checks pass
- `git diff --check` — pass

This evidence is local to the implementation branch. It does not claim merge, deployment, live behavior, or V5 completion.
