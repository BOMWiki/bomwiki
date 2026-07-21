# CAD Studio V5 implementation status

Last updated: 2026-07-21

Branch: `codex/cad-v5-slice-5a-schema`

Specification: `CAD_STUDIO_V5_COMPLEX_MODELING_SPEC.md`

Production baseline: `wiki/engine@2d52f4cd2`

Status: Slice 5A schema boundary implemented, review-hardened, and verified; not wired into the production Studio runtime

## Product finding that triggered V5

The production Studio was used to build a turbofan-like model from the editable Round spacer template. The result could produce an outer ring, a circular pattern of flat extrusions, and a revolved spinner, but it remained a single crude ducted fan rather than a credible engine assembly.

That attempt established the missing capability boundary:

- no practical multi-body/component structure;
- no shaped, twisted blade Loft;
- no general Sweep workflow;
- no reusable datum-plane and transform system;
- no real assembly hierarchy or mates;
- no non-destructive section/cutaway view;
- no interference, clearance, mass, or structure-preserving export proof.

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

Production does not satisfy any V5 release gate yet. The detached schema boundary below is implementation progress, not a claim that production reads or rebuilds schema-5 projects.

## Slice 5A schema-boundary progress

Implemented on this branch:

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

Deliberately not implemented here:

- production file-open/save wiring;
- schema-5 worker protocol or OpenCascade rebuild support;
- multi-body result evaluation and rendering;
- new UI commands, body tree, Loft, Sweep, transforms, assemblies, inspection, or interchange changes.

The `v5-schema` gate remains open because the temporary schema-4 adapter must be replaced and verified against the final V4 fixtures before schema 5 becomes a production document format.

## Next implementation action

When schema 4 is stable, replace the opaque adapter with the final deterministic schema-4-to-5 migration and run every canonical V4 fixture through the schema-5 round-trip suite. Then begin Slice 5A's worker/result protocol for explicit bodies without changing the current production document loader prematurely.

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

## Verification for this implementation branch

- `npm run typecheck` — pass
- `npm run studio:v5:migration` — 118/118 schema-5 checks pass
- `npm run studio:check` — 277/277 production Studio checks pass
- `git diff --check` — pass

No production runtime wiring, deployment configuration, or live state changed in this slice.
