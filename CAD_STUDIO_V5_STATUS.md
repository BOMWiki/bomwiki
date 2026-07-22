# CAD Studio V5 implementation status

Last updated: 2026-07-22

Previously live-verified production baseline: `wiki/engine@fbf5f65e220d06f3e360b63c2fafdb8875d00fd8`

Delivery: `codex/cad-v5-conformance`, PR #121. Protected CI, merge, deployment, and live-verification records are authoritative for current production availability.

Specification: `CAD_STUDIO_V5_COMPLEX_MODELING_SPEC.md`

Integration baseline: `origin/wiki/engine@6233215df`

Status: The Slice 5A schema boundary, multi-body runtime, and structured agent foundation for the released operations are merged, deployed, and live-verified. PR #121 integrates the rebased Slice 5B datum/transform, 5C profile/advanced-shape, 5D linked-body-pattern, 5E assembly/mate, and 5F inspection/display/interchange implementations, which pass their local acceptance gates. Its conformance matrix maps the original ten broad capability gaps to 10 document, 10 exact-kernel, and 10 visible-browser assertions. Delivery of this implementation progress does not close a V5 release gate; every V5 release gate remains open.

Delivery stack: the rebased datum/transform commit adds Slice 5B on top of the deployed Slice 5A runtime and agent foundation. Delivery does not by itself close `v5-datums-transforms`.

Delivery stack: the shapes commit adds the Slice 5C profile, Loft, Sweep, and twisted-blade kernel increment on top of Slice 5B. Delivery does not by itself close `v5-advanced-shapes`.

Delivery stack: the patterns commit adds the Slice 5D linked exact body-pattern runtime on top of Slice 5C. It does not close the broader `v5-patterns` gate while feature-level fusion, dissolve, repair, and the remaining topology fixtures are open.

Delivery stack: the assemblies commit adds the Slice 5E reusable-component, nested-occurrence, and explicit-mate runtime on top of Slice 5D. It does not close `v5-assemblies` while general constraint-graph diagnostics, occurrence parameter variants, external-reference authoring, and structured assembly interchange remain open.

Delivery stack: the inspection commit adds the first Slice 5F increment for non-destructive section/explode display state, material-backed appearances and mass, exact geometry health primitives, interference/clearance, and mate-driven axial stage groups on top of Slice 5E. It does not close `v5-inspection` or `v5-interchange` while exact cap rendering and the full measurement/health contract remain open.

Delivery stack: the interchange commit adds a Slice 5F structured STEP increment on top of inspection: genuine nested XCAF product/component export, exact multi-solid import, reusable BOMwiki solved-hierarchy round-trip, external-file flat-solid fallback, imported-body persistence/recovery, and structured re-export. It does not close `v5-interchange` while arbitrary third-party STEP product hierarchy recovery, external names/colors/materials, and the remaining Slice 5F evidence are open.

Integrated implementation: `codex/cad-v5-conformance` adds the ten-capability regression matrix on top of the delivery stack. It verifies the generic editable document contract, exact OpenCascade results, and public browser surface for every capability that the production turbofan experiment found missing. It does not add a turbofan template or generator, does not satisfy the canonical §40 turbofan/generality benchmark, and does not close any V5 release gate.

## Original ten-capability gap list

All ten broad capability classes are implemented and regression-covered in the PR #121 integration stack. "Implemented" means the generic capability exists in that delivery stack; current production availability must be confirmed from its protected delivery record, and it does not mean V5 release completion.

| # | Capability | Current implementation evidence |
| --- | --- | --- |
| 1 | Construction planes | Implemented on this branch: offset, angled, three-point, curve-normal, and mid-plane definitions resolve as editable datums. |
| 2 | Multiple independent bodies | Deployed in Slice 5A and extended here: named body ownership, axial placement, visibility, suppression, selection, and result policies evaluate as independent exact solids. |
| 3 | Body transforms/alignment | Implemented on this branch: Move, Rotate, Align, linked Copy, Mirror, and uniform Scale remain editable history. |
| 4 | Loft and Sweep | Implemented on this branch: ordered-profile solid Lofts and path/guide/orientation-aware solid Sweeps produce exact valid bodies. |
| 5 | Twisted multi-section blades | Implemented through the generic Plane + spline Profile + Loft workflow; the regression fixture uses three editable tapered/twisted sections rather than a blade-only primitive. |
| 6 | Editable feature patterns | Implemented as linked exact body patterns with editable source, references, count, distribution, orientation, skips, stable occurrence IDs, and shared source geometry. Feature-result fusion remains a documented broader-pattern limitation. |
| 7 | Selected-body Booleans | Deployed in Slice 5A: body-aware Add, Subtract, Intersect, and explicit retained-tool behavior with transactional preflight. |
| 8 | Assemblies and mates | Implemented on this branch: reusable parts, nested assemblies, lightweight occurrences, component patterns, and ten explicit mate kinds with deterministic constraint state. |
| 9 | Section/cutaway views | Implemented as saved non-destructive render clipping that leaves exact geometry and normal export unchanged. Exact generated cap faces/fill/hatch remain open. |
| 10 | Visibility, model tree, and axial stage spacing | Implemented across Slice 5A and this branch: body/component trees, independent visibility/suppression/isolation, saved axial groups, ordered stages, and mate-driven spacing. |

The integrated `studio:v5:capabilities` gate proves these rows with 30 checks: one canonical-document assertion, one exact OpenCascade assertion, and one visible-browser assertion per row. The individual Slice 5A–5F suites remain the deeper acceptance evidence for edits, invalid-draft refusal, undo/redo, persistence, recovery, export, and feature-specific edge cases.

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
- direct sketch-to-solid Press/Pull;
- schema-5 multi-body creation, ownership, selection, visibility, suppression, deletion, and selected-body Boolean operations;
- structured local agent operation for the released project, parameter, feature, body, and Boolean commands through headless, MCP, and visible-session adapters.

Production does not satisfy any complete V5 release gate yet. The schema boundary, Slice 5A multi-body behavior, and applicable agent foundation below are deployed implementation progress; the advanced capabilities and their release evidence remain on the current branch.

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
- 135 focused schema checks covering round trips, migrations, safe expressions, body/result ownership, linked body-pattern roles/policies/budgets, owner-aware references, occurrence paths and overrides, rigid right-handed component transforms, mate cardinality, duplicate-reference rejection, typed record containers, cycles, independent document/resource budgets, large and non-canonical resources, newer schemas, and unchanged input on every rejection fixture;
- the protected `engine-studio` PR workflow now runs the V5 schema suite alongside typecheck and the production browser/kernel suite.

Implemented by the deployed Slice 5A runtime:

- schema-5 file open/save, local journal persistence, recovery, canonical undo/redo snapshots, and schema-3/schema-4 migration through the production document path;
- a schema-5 worker protocol that evaluates, caches, meshes, reports errors for, and returns multiple named exact body results;
- exact `new-body`, `add`, `subtract`, and `intersect` policies for current solid feature types, plus explicit refusal of unsupported surface results;
- stable body IDs, feature ownership, explicit active-body behavior, per-body visibility/suppression, last-valid recovery, and affected-chain incremental rebuild traces;
- per-body rendering, canvas/tree selection and highlighting, owner-scoped face/edge metadata, and body-aware error state;
- body-tree select, activate, rename, show/hide, isolate, suppress/restore, export-select, and dependency-aware delete controls without a broader UI redesign;
- exact preflight for explicit body Boolean edits, including stale-validation refusal before document or undo-stack mutation;
- selected-body named STEP export and selected-body STL export with an exact manifest for body/solid count, millimetre units, names, and bounds;
- focused document, kernel, and visible-browser coverage for all ten Slice 5A-runtime acceptance steps.

Deliberately not implemented by the deployed Slice 5A runtime:

- surface-producing features; current solid features reject the `surface` policy explicitly;
- datum geometry, transforms, Loft, Sweep, advanced patterns, assemblies, mates, sectioning, inspection, structured assembly interchange, or the §40 turbofan;
- schema-4 final-contract replacement or closure of any V5 release gate.

Implemented by the deployed agent-operability foundation:

- a shared typed command/query service used by converted human UI actions, direct tests, the headless CLI, MCP, and the live Studio bridge;
- capability discovery, stable semantic inspection, detached exact previews, atomic commit, expected-revision conflict, protocol idempotency, undo/redo, semantic change sets, and structured diagnostics;
- headless project operation and an eight-tool MCP stdio adapter with path and permission confinement;
- an expiring loopback-only live pairing flow with visible client/scope/mode approval, default per-commit approval, activity, pause/resume, revoke, and project-change invalidation;
- direct/headless/MCP/visible-loopback parity for the released simple-feature, body, and Boolean operations;
- truthful disabled capability reasons for advanced operations that are not yet wired through the agent protocol.

The complete deployed evidence and current agent limitations are recorded in `CAD_STUDIO_AGENT_STATUS.md`. This branch does not close `v5-agent`: the new datums, transforms, Loft, Sweep, linked-pattern, assembly, mate, and inspection operations still need typed agent command/query parity and generic protocol replay evidence.

## Stacked Slice 5B datum/transform candidate

Implemented on `codex/cad-v5-datums`:

- stable part-owned plane, axis, point, coordinate-system, sketch, body, and feature reference ownership;
- exact principal, offset, angled, three-point, point/normal, curve-normal, and mid-plane frame resolution with parameter expressions, dependency cycles, and explicit repair errors;
- history features for numeric Move/Translate, Rotate, plane/axis/coordinate-system Align, linked Copy, linked or move-original Mirror, and uniform Scale;
- OpenCascade evaluation of those transform features without baked raw placement, including source-linked body dependencies and exact cache invalidation when a controlling datum changes;
- canonical safe feature reorder and rollback-marker primitives, source-before-copy order validation, and last-valid downstream-body recovery for broken datum references;
- visible Plane, Move, Rotate, Copy, Mirror, Align, and Scale commands using the existing ribbon, tree, inspector, transactional Apply/Cancel, exact preflight, undo/redo, persistence, and body selection paths;
- a datum tree that identifies broken references and reopens construction-plane definitions for repair;
- focused canonical-document, exact-kernel, and visible-browser Slice 5B regression coverage.

Still deliberately open in Slice 5B:

- the 3D transform manipulator/drag handles and snapping workflow;
- visible history drag-reorder/rollback controls (the canonical commands and exact tests exist, but their normal UI is not yet exposed);
- topology repair choices beyond stable body ownership and explicit broken-datum diagnostics;
- creation editors for arbitrary user axes, points, and coordinate systems beyond the selectable origin set and canonical command/data boundary;
- merge, protected CI evidence, deployment, live verification, and `v5-datums-transforms` gate closure.

## Stacked Slice 5C profile/advanced-shape candidate

Implemented on `codex/cad-v5-shapes`:

- ordinary part-owned profile and path sketches with stable IDs, parameter-evaluated point data, plane support for profiles, closed polyline or C1 spline profiles, validation, dependency references, edit/delete document commands, and round-trip persistence;
- visible Profile and Path commands and a profile/path model-tree group using the existing command dialog, transaction coordinator, worker preflight, undo/redo, and recovery paths;
- solid Loft features with ordered section references, explicit start-index/direction mapping in the canonical document, smooth or ruled exact OpenCascade evaluation, optional guide/centreline source references, start/end continuity settings, and in-place edits that preserve history position and downstream body ownership;
- solid Sweep features with editable profile/path/guide references, path-normal, minimum-twist, fixed-direction, selected-reference-vector, guide, and controlled-twist modes, plus linear end scale and transition policy;
- a closed C1 spline construction that produces exact-valid smooth airfoil Lofts rather than approximated splines closed by a discontinuous line;
- real `BRepCheck_Analyzer` validation for every schema-5 body result, in addition to one-solid and positive-volume checks;
- affected-body cache signatures that include sketch content and supporting datum state, last-valid recovery for a failed Loft/Sweep, and unaffected-chain reuse;
- a generic three-body fixture proving a three-section spline blade with 30% chord reduction, 6–18% local thickness, 20-degree root-to-tip twist, a smooth exact solid Loft, an inlet Loft, and a controlled-twist scaled Sweep;
- visible browser creation and editing of Profiles, Lofts, and Sweeps, exact-body rendering, transactional invalid-draft refusal, recovery, and no native dialogs;
- focused canonical-document, exact-kernel, and visible-browser Slice 5C regression coverage, now included in the protected `engine-studio` workflow.

Still deliberately open in Slice 5C:

- the current Loft guide is validated against every section and retained as an editable dependency, but the exact Loft builder does not yet constrain the surface to that rail; only one guide is accepted;
- open-profile/surface/thin-wall Loft and Sweep results, closed/periodic Loft, automatic mapping, and visible per-section start-point/reversal controls;
- seam, mapping, self-intersection, and continuity previews; continuity currently uses the OpenCascade builder setting rather than verified adjacent-face boundary constraints;
- integrated spline handles, projected/intersection curves, bounded DXF/SVG/profile-resource import, and plane-supported path editing rather than pasted world-space path coordinates;
- an editable blade-root/platform treatment and the required compressor and turbine three-section blade definitions;
- Draft, Thicken, variable Fillet, selected-axis/partial Revolve, To-face/Between/Symmetric extents, and the remaining §14 advanced-shape features;
- merge, protected CI evidence, deployment, live verification, and `v5-advanced-shapes` gate closure.

## Stacked Slice 5D linked-body-pattern candidate

Implemented on `codex/cad-v5-patterns`:

- a first-class part-owned body-pattern record with one source body, stable direction/axis/path/plane references, count/extent/spacing/table policy, orientation, visibility, suppression, skipped ordinals, and stable derived occurrence IDs;
- exact linked circular, one- or two-direction linear, curve, and mirror pattern evaluation, including symmetric distribution, alternating linear/circular orientation, radial/axial circular offsets, and arc-length curve spacing/extent;
- source-edit, count, axis/direction/path, skip, visibility, and name changes through affected-chain cache signatures, with last-valid generated results after source/reference failure;
- OpenCascade rigid occurrences that retain shared source topology locations instead of copying the underlying B-rep, plus one shared browser geometry and per-occurrence render matrices rather than repeated mesh payloads;
- individually selectable generated occurrence results in the model tree, exact placement rendering, per-pattern visibility, occurrence skip, export selection, and selected-occurrence named STEP/STL export;
- visible Pattern create/edit controls through the existing command dialog, including source, type, references, counts, distribution, orientation, offsets, skips, table values, and optional second linear direction;
- canonical undo/redo, byte-identical save/reopen, journal recovery, transactional invalid-Apply refusal, stable selection across count edits, and deterministic picker keyboard ownership after deferred command handoff;
- a generic editable three-section blade fixture proving `12 → 14` fan count, source-tip propagation, axis edits, stable identities, one pattern record rather than copied histories, exact B-rep validity, shared runtime geometry, and selected-blade export;
- focused canonical-document, exact-kernel, and visible-browser Slice 5D body-pattern coverage, included in the protected `engine-studio` workflow.

Still deliberately open in Slice 5D:

- feature-level patterns that fuse repeated feature results back into a target body; this candidate patterns exact source bodies as linked occurrences;
- Dissolve/Make independent, individually suppressed (rather than skipped) generated occurrences, and a repair editor for broken pattern references;
- curve guide-surface orientation and selectable edge/vector directions beyond datum axes and coordinate systems;
- assembly component patterns, which belong to Slice 5E;
- Boolean Split, multi-target Subtract UI, retained/consumed tool diagnostics, pattern-to-Boolean topology lineage fixtures, and the remaining §15 reliability work;
- protected CI evidence, merge, deployment, live verification, and `v5-patterns` gate closure.

## Stacked Slice 5E assembly/mate candidate

Implemented on `codex/cad-v5-assemblies`:

- assembly-root project loading through the production document, journal, undo/redo, recovery, worker, render, and export paths instead of the prior root-part-only rejection;
- reusable linked part definitions, lightweight part and nested-subassembly occurrences, rigid right-handed base transforms, full occurrence breadcrumbs, visibility/suppression propagation, stable derived component-pattern occurrence IDs, and shared source meshes across repeated components;
- detached document commands for Create assembly, Insert component, Linked duplicate, Make independent with fully remapped definition identity, Replace with incompatible-mate pruning, Delete with dependent-mate/pattern cleanup, edit-in-context entry/return, and circular/linear component patterns;
- a deterministic rigid mate solver for Fixed, Coincident, Concentric, Distance, Angle, Parallel, Perpendicular, Tangent, Revolute, and Slider relationships with parameter expressions, remaining-degree-of-freedom reporting, redundant-relation reporting, explicit two-mate conflict sets, and last-valid solved-transform recovery;
- exact OpenCascade evaluation of each source part once, composed nested and solved occurrence placement, one shared browser `BufferGeometry` per source body, individually selectable occurrence bodies, source-edit propagation, affected-part cache reuse, and unchanged placement after source edits;
- placed selected-component and complete-assembly STEP/STL export with exact solids, named occurrence/body paths, component/body/solid counts, millimetre units, transforms, and bounds in the export manifest;
- an Assembly workspace added to the existing Studio shell with component/mate trees, constraint state, select/show/hide/suppress/isolate/export controls, visible insertion/duplication/independence/replacement/pattern commands, all ten mate editors, conflict state, edit-in-context, transactional Apply/Cancel, persistence, and desktop-authoring/mobile-inspection behavior;
- a generic five-part, nested fan-rotor/shaft/nacelle/compressor/turbine module fixture with explicit concentric/distance/angle/fixed placement and a lightweight axial component pattern;
- 48 focused canonical-document/solver, exact-worker, and visible-browser checks, plus protected-workflow wiring and clean inherited Slice 5A–5D gates.

Still deliberately open in Slice 5E:

- the solver handles deterministic rigid placement and direct duplicate-relation conflicts; it does not yet solve arbitrary nonlinear closed constraint graphs or compute a globally minimal conflict set across unrelated geometric constraints;
- visible mate authoring currently resolves component origins and named part datums; direct planar/cylindrical face, vertex, circular-centre, and topology-repair selection remain open;
- occurrence parameter overrides validate in the schema but do not yet produce independently cached per-occurrence geometry variants;
- edit-in-context stores and restores an explicit occurrence breadcrumb, but Project/Include external-reference creation, cross-part dependency-cycle diagnostics, and Break/Lock reference commands are not yet exposed;
- component patterns currently provide circular and linear lightweight occurrences around document-space axes; curve patterns, skips, dissolve, Make independent for generated occurrences, and pattern repair remain open;
- replacement prunes datum mates that cannot resolve in the new definition, but there is no interactive compatible-topology remap/repair preview;
- assembly manipulation is numeric/tree-driven; a 3D component triad, drag preview, snapping, and mate preview animation are not implemented;
- true multi-product STEP import, explicit STEP product hierarchy round-trip, assembly materials, interference, measurement, mass, section/explode state, and saved axial-stage groups belong to Slice 5F;
- the deployed `studio:agent:*` command/query surface remains limited to the released simple-feature, body, and Boolean operations; the new assembly operations are not yet exposed through typed direct/headless/MCP parity;
- protected CI evidence, merge, deployment, live verification, and `v5-assemblies` gate closure.

## Stacked Slice 5F inspection/display candidate

Implemented on `codex/cad-v5-inspection`:

- saved single-plane, two-plane quarter, and three-plane box section records with direction reversal, numeric offset, direct or nested occurrence scope, active/off playback, transactional create/delete, persistence, recovery, and display-only identity that never enters feature history or changes export geometry;
- saved exploded views with occurrence-scoped rigid delta transforms, including nested occurrence targets, composed on top of solved placement only so mates, exact inspection, mass properties, and normal export remain unchanged;
- nine clearly generic and editable placeholder materials with densities and material-linked base color, metallic, roughness, opacity, and edge color, plus source-body material and direct/nested occurrence appearance assignment;
- exact-worker volume, surface area, centre of volume/mass, density-backed mass, explicit unknown-mass semantics when any density is missing, solid/shell/face/edge/vertex counts, B-rep validity, and current-build failure propagation rather than silently healthy omitted bodies;
- broad-phase bounds pruning followed by exact OpenCascade intersection volume for interference, and an explicitly disposed exact distance tool for solved-placement clearance;
- revision-keyed/stale-invalidated inspection results, complete-assembly or selected-body/component scope, transaction-safe invalid-command refusal, and last-valid/error-aware display behavior;
- persisted axial stage groups that store ordered occurrences and matching Distance mates, update actual mate station values from start/spacing, and change group visibility without suppression, deletion, or geometry duplication;
- visible Section, Explode, Axial stages, Material, Mass & health, Clearance, and Interference commands in the existing Assembly workspace, a saved Views & stages tree, and touch-sized mobile playback/inspection controls without an unrelated UI redesign;
- 37 focused document, exact-worker, and visible-browser checks, protected-workflow wiring, and clean inherited schema plus Slice 5A–5E and production Studio gates.

Implemented on `codex/cad-v5-interchange`:

- complete-assembly STEP export as an actual XCAF document with named reusable body definitions, part products, nested assembly products, solved component locations, explicit generated component-pattern occurrences, and STEP `NEXT_ASSEMBLY_USAGE_OCCURRENCE` relationships rather than a flat list of placed solids;
- a bounded BOMwiki hierarchy sidecar inside the otherwise valid STEP file so this bundled kernel can restore stable part/assembly IDs and solved hierarchy despite lacking the XCAF STEP-reader bindings needed to traverse imported product labels;
- worker-only `.step`/`.stp` import limited to 50 MiB, exact STEP B-rep reading, solid separation, sidecar/geometry consistency matching, inverse-placement recovery of reusable local body definitions, and explicit refusal of malformed or mismatched files;
- schema-5 imported bodies represented as one `imported-step` new-body feature plus an embedded exact B-rep resource, with cache signatures that include resource content and explicit `no-parametric-feature-history`/`no-mate-recovery` metadata;
- honest external STEP fallback to one fixed multi-body part containing every exact solid when no BOMwiki sidecar exists; it does not claim product names, hierarchy, colors, mates, or parametric history that the bundled reader cannot recover;
- production Open support for JSON, STEP, and STP; imported projects replace the current document through the existing transaction coordinator, clear unrelated undo/redo history, persist to the journal, recover byte-identically, render all occurrences, and re-export structured STEP;
- selected-body export remains a single normally placed exact STEP solid and does not advertise complete assembly hierarchy;
- 20 focused document, exact-worker, and visible-browser interchange checks, including repeated export/import lifecycle coverage, genuine STEP relationship assertions, exact seven-occurrence rebuild, hidden-product pruning, external fallback, invalid/stale-file refusal, browser transaction identity, persistence/recovery, and structured re-export.

Still deliberately open in Slice 5F:

- the saved cap flag currently controls clipping/shadow behavior but does not generate exact cap faces or the required configurable cap fill/hatch treatment; datum-linked/rotated interactive plane authoring and combined saved cutaway camera/ghost state also remain open;
- standalone appearance records/editors, face overrides, double-sided surface display, wireframe/hidden-line/ghost modes, curvature/zebra analysis, and presentation-quality environment/shadows;
- point/edge/face/radius/diameter/angle/wall-thickness/bounding-box-coordinate measurement and persistent referenced measurement records; the current visible Measure boundary is exact body/component clearance plus aggregate properties;
- principal moments and axes of inertia, exact free-edge/non-manifold enumeration, thickness/minimum-feature estimates, self-intersection diagnostics, and the exact first feature that introduced invalidity;
- selectable/highlighted interference regions, named expected-contact suppression sets, and visible contact-tolerance editing;
- the bundled WASM exposes the XCAF writer but not `STEPCAFControl_Reader`/label-sequence bindings, so BOMwiki-authored STEP restores its stable solved hierarchy through the bounded sidecar; arbitrary third-party STEP currently imports exact solids through a flat fallback instead of recovering its external product tree, names, colors, materials, or units other than the V5 millimetre boundary;
- imported STEP restores exact B-reps and solved reusable hierarchy only; it intentionally does not invent native sketches, parametric feature history, mates, component patterns, occurrence variants, external references, section/explode state, or materials;
- AP242 metadata/PMI, assembly-material round-trip, explicit import unit conversion/confirmation, partial-import selection/reporting, external name/color recovery, and multi-part STL packaging remain unimplemented;
- mobile remains an inspection/playback boundary rather than an authoring workspace;
- protected CI evidence, merge, deployment, live verification, and `v5-inspection`/`v5-interchange` gate closure.

The `v5-schema` gate remains open because the temporary schema-4 adapter must be replaced and verified against the final V4 fixtures before schema 5 becomes a production document format.

## Next implementation action

Review the rebased integration diff and protected CI before considering any merge. After the generic capability stack is landed and live-verified, continue Slice 5F with exact cap presentation, the remaining measurement/health contract, import-unit/external-product metadata support, and multi-part packaging; add typed agent parity for each advanced operation; then build the canonical public-tool Slice 5G turbofan/generality projects and performance/accessibility/visual evidence while keeping every explicit limitation above open. In parallel, replace the temporary opaque schema-4 adapter once the final schema-4 format is stable.

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
- [ ] `v5-agent`
- [ ] `v5-live`

Gate definitions and required evidence are in §36 of the V5 specification.

## Last verified implementation evidence

- `npm run typecheck` — pass
- `npm run studio:v5:migration` — 135/135 schema-5 checks pass
- `npm run studio:v5:runtime:document` — 18/18 canonical document, dependency, and transaction checks pass
- `npm run studio:v5:runtime:kernel` — 14/14 exact OpenCascade body, cache, failure, and export checks pass
- `npm run studio:v5:runtime:browser` — 49/49 visible ten-step acceptance, renderer/topology, transactional-control, and mobile body-tree checks pass
- `npm run studio:check` — 278/278 production Studio checks pass
- `npm run studio:v5:datums:document` — 18/18 datum, transform, reorder, rollback, dependency, repair, and round-trip checks pass
- `npm run studio:v5:datums:kernel` — 10/10 exact transform, placement, full-frame alignment, dependency, rollback, and last-valid checks pass
- `npm run studio:v5:datums:browser` — 11/11 visible Plane/Align/Mirror, transactional, undo/redo, recovery, and no-native-dialog checks pass
- `npm run studio:v5:shapes:document` — 11/11 profile, Loft/Sweep reference, twisted-blade, validation, history-order, and round-trip checks pass
- `npm run studio:v5:shapes:kernel` — 7/7 exact Loft/Sweep, B-rep validity, dependency rebuild, cache, and last-valid checks pass
- `npm run studio:v5:shapes:browser` — 13/13 visible Profile/Loft/Sweep create/edit, rendering, transaction, recovery, and no-native-dialog checks pass
- `npm run studio:v5:patterns:document` — 11/11 linked-record, source/reference, two-direction/curve/mirror, memory-shape, transaction, delete, and round-trip checks pass
- `npm run studio:v5:patterns:kernel` — 15/15 exact occurrence, shared-topology/render-transform, source/count/axis/skip, last-valid, export, linear/curve/mirror checks pass
- `npm run studio:v5:patterns:browser` — 13/13 visible create/edit, shared rendering, stable selection, source propagation, skip/undo, visibility/cache, touch-target sizing, selected export, persistence/recovery, and no-native-dialog checks pass
- `npm run studio:v5:assembly:document` — 16/16 reusable-definition, nested-transform/diagnostic/pattern propagation, all-mate-kind, conflict, transaction, edit-context, replacement, independent-copy, delete, and round-trip checks pass
- `npm run studio:v5:assembly:kernel` — 12/12 exact occurrence, solved placement, shared mesh, nested component patterns, source/mate edit, visibility, root/nested last-valid conflict, and selected/complete STEP checks pass
- `npm run studio:v5:assembly:browser` — 20/20 visible create/insert/mate/edit/undo, deletion-impact, invalid transaction, linked/independent/replace/pattern, nested tree/selection/export, visibility, recovery, edit-context, mobile, and no-native-dialog checks pass
- `npm run studio:v5:inspection:document` — 13/13 material/appearance, nested-scope section/explode, axial-stage transaction, invalid-command, and round-trip checks pass
- `npm run studio:v5:inspection:kernel` — 10/10 exact property/health/failure, unknown/known mass, interference/clearance, display-state isolation, normal export, and stage-placement checks pass
- `npm run studio:v5:inspection:browser` — 14/14 visible command, clipping/explode/appearance, inspection, stage-tree, export, recovery, mobile, and no-native-dialog checks pass
- `npm run studio:v5:interchange:document` — 3/3 imported-resource ownership, canonical round-trip/limitation, and content-identity checks pass
- `npm run studio:v5:interchange:kernel` — 9/9 XCAF hierarchy, exact reusable import/rebuild, repeated round-trip, hidden-product pruning, external fallback, selected export, and invalid-file checks pass
- `npm run studio:v5:interchange:browser` — 8/8 visible Open, exact hierarchy rendering, imported-resource boundary, persistence/recovery, structured re-export, stale/invalid transaction, and no-native-dialog checks pass
- `npm run studio:v5:capabilities` — 30/30 original-gap checks pass: 10 canonical document, 10 exact OpenCascade, and 10 visible browser assertions
- `npm run studio:agent:core` — 46/46 protocol, query, transaction, alias, security, handoff, and multi-body checks pass
- `npm run studio:agent:headless` — 10/10 CLI checks pass
- `npm run studio:agent:mcp` — 23/23 MCP lifecycle, tools, idempotent retry, permissions, filesystem, and loopback-pairing checks pass
- `npm run studio:agent:parity` — 28/28 direct, exact visible-Studio, localhost bridge, approval, pause/revoke, MCP-side disconnect, and handoff checks pass
- `git diff --check` — pass

This evidence is local to the implementation branch. It does not claim merge, deployment, live behavior, or V5 completion.
