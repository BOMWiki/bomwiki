# CAD Studio V5 implementation status

Last updated: 2026-07-22

Specification: `CAD_STUDIO_V5_COMPLEX_MODELING_SPEC.md`

Release branch: `codex/cad-v5-release`

Reviewed implementation: `codex/cad-v5-completion@13f1a5a90b3d6d6e78b1a62f128da4ff16cb81b1`

Integrated and verified candidate: `wiki/engine@304c197b828cb21ad8a27407c8ae843132cf3bab`

The turbofan conformance benchmark from `92bb3f1271915ad23298b4de541a393899fa653a` is incorporated in this branch.

## Release truth

CAD Studio V5 is **approved for protected production promotion**.

The reviewed implementation passed the full protected release workflow in run `29923634939`, merged as `wiki/engine@304c197b828cb21ad8a27407c8ae843132cf3bab`, deployed through the CI-only engine workflow in run `29927875536`, and was verified on the public Studio route with the expected static asset hash. The six protected-CI visual artifacts are pinned in `CAD_STUDIO_V5_RELEASE_ATTESTATION.json`; the BOMwiki product owner accepted the review questions and explicitly authorized production promotion on 2026-07-22.

This release promotion updates the public V5 identity and Help truth, and makes the owner attestation part of the aggregate release gate. The first protected `wiki/engine` revision containing those changes that passes CI, merges, deploys through `deploy-engine`, and verifies on `/cad/studio` is the formal V5 production release. Until that delivery record is green, this branch is release-approved source rather than a live-release claim.

## Pending-list implementation result

All twelve items from the 2026-07-22 pending implementation list now have generic implementation and automated regression coverage on this branch:

| # | Pending item | V5 implementation |
| --- | --- | --- |
| 1 | Final schema-4 to schema-5 migration | Strict deterministic migration replaces the opaque adapter and is covered by final V4 fixtures, identity, limit, and refusal checks. |
| 2 | 3D handles, snapping, reorder, repair | Body/component `TransformControls`, numeric and snap paths, history reorder/rollback, and owner-aware reference repair are transactional and undoable. |
| 3 | Advanced shapes | Multi-section Loft, controlled Sweep, Draft, Thicken, variable Fillet, and partial/selected-axis Revolve evaluate as exact editable features. |
| 4 | Pattern completion and Split | Linked body patterns support fusion, dissolve, independence, repair, and Boolean Split with warm-cache and browser coverage. |
| 5 | Advanced assemblies | Mate solving, topology/datum selection, occurrence variants, replacement repair, conflicts, nested reuse, and 3D manipulation are covered. |
| 6 | Section and appearance | Saved exact-boundary stencil caps with configurable fill/hatch plus shaded, edged, wireframe, hidden-line, and ghost display modes are covered. |
| 7 | Measurement, health, interference | Referenced measurements, mass properties, B-rep health, exact clearance, and broad-phase plus exact interference are available and revision-safe. |
| 8 | STEP hierarchy and metadata | XCAF hierarchy, names, colors, materials, source units, unit normalization, reusable definitions, and solved placements round-trip through bounded import/export. |
| 9 | Agent parity | Typed direct, headless, MCP, and visible-session operations cover the advanced V5 document surface and preserve atomic preview/commit semantics. |
| 10 | Canonical turbofan | A checked-in editable turbofan is replayed exclusively through 363 advertised generic operations; no template-only generator or finished imported geometry is used. |
| 11 | Generality fixtures | Checked-in gearbox and robot-joint projects use the same public operations and pass exact rebuild and structured STEP gates. |
| 12 | Performance, accessibility, visual, release evidence | Automated performance and accessibility gates pass; six protected-CI review artifacts are pinned, owner-approved, and consumed by the aggregate release manifest. |

This table records the implemented V5 scope. Production status still follows the protected delivery invariant above.

## Slice 5A-runtime acceptance gate

The original ten-step Slice 5A-runtime contract remains explicitly covered:

1. create/open a real multi-body schema-5 document;
2. evaluate independent named exact solids in one worker rebuild;
3. render and select each body with owner-scoped topology;
4. apply body-aware new/add/subtract/intersect result policies;
5. select, activate, rename, show/hide, isolate, suppress, restore, and delete from the body tree;
6. reject invalid or stale edits before document/history mutation;
7. keep successful edits as one undoable/redoable transaction;
8. save, reopen, journal, recover, and migrate through the production document path;
9. retain last-valid unaffected results and report failed dependency chains; and
10. export the selected body only as named exact STEP/STL geometry.

The acceptance suite has separate canonical-document, exact-kernel, and public-browser assertions, including recovery, stale-result refusal, and mobile tree controls.

## Canonical benchmark evidence

The checked-in turbofan is a normal schema-5 project constructed through public operations:

- 22 editable part definitions;
- 25 source bodies;
- 159 solved leaf occurrences;
- 9 linked occurrence patterns;
- 62 explicit mates with a fully constrained solver result;
- 162 evaluated runtime bodies;
- 140,488 displayed triangles in the final local performance run;
- 3,224 exact edge signatures retained in 162 selectable body-level proxies and rendered in 8 total scene/cap draw objects using extension-independent merged buffers rather than a `WEBGL_multi_draw` fallback;
- a 4-draw, 1,932-triangle body-aware bounds LOD representing the same 161 visible exact results only during software-WebGL pointer interaction;
- zero unintended exact interference pairs after adding explicit inlet, casing, rotor, bearing, and shaft clearances;
- named axial stations, a longitudinal section, exploded view, materials, measurements, and four material groups;
- fan root/mid/tip spline profiles with taper and twist;
- compressor and turbine root/mid/tip coordinate-loop Lofts, including a linked hot-section row;
- canonical save/reopen, edit/undo/redo, persistence/recovery, structured STEP, and public-agent replay.

The gearbox and robot-joint fixtures separately prove that the operations are not turbofan-specific.

## Automated and protected evidence

- `npm run typecheck` — pass.
- `npm run studio:v5:migration` — 162/162.
- `npm run studio:v5:runtime` — 84/84 across the Slice 5A document, kernel, and browser gate.
- `npm run studio:v5:datums` — 48/48.
- `npm run studio:v5:shapes` — 53/53.
- `npm run studio:v5:patterns` — 56/56.
- `npm run studio:v5:assembly` — 58/58.
- `npm run studio:v5:inspection` — 45/45, including extension-independent exact-boundary stencil batching and live cap/clip-plane motion.
- `npm run studio:v5:interchange` — 22/22.
- `npm run studio:v5:capabilities` — 30/30, with one document, kernel, and browser assertion for each original broad capability.
- `npm run studio:v5:benchmarks` — 26/26 across canonical documents, exact OpenCascade, dependency-scoped project-parameter invalidation, public browser, gearbox, and robot joint.
- `npm run studio:agent:core` — 50/50.
- `npm run studio:agent:headless` — 11/11.
- `npm run studio:agent:mcp` — 24/24.
- `npm run studio:agent:parity` — 28/28.
- `npm run studio:agent:turbofan` — 363 public operations replayed; 22 parts, 25 bodies, 159 solved occurrences, 9 patterns, and 62 mates.
- `npm run studio:agent:release-check` — automated agent candidate pass; owner approval is recorded separately because automation cannot perform visual review.
- `STUDIO_PERF_FORCE_SOFTWARE_WEBGL=1 npm run studio:v5:performance` — 14/14 under forced SwiftShader; cold/warm exact rebuild 1,859.0/13.9 ms, zero-positive-pair full interference 2,300.6 ms, orbit frame p95 17.5 ms with 8 exact scene/cap draws plus 4 body-aware interaction draws, tree-selection p95 8.1 ms, section-drag p95 19.0 ms, 12-blade source-edit median 57.5 ms and p95 1,611.6 ms, and verified exact idle-quality restoration.
- `npm run studio:v5:accessibility` — 14/14.
- `npm run studio:v5:visual` — six hash-verified artifacts captured; capture automation deliberately emits `awaiting-human-review` and cannot self-approve.
- `npm run studio:v5:release-check` — combines fresh automated evidence with the checked-in product-owner attestation and reports `v5-release-approved-protected-delivery-required`.
- protected engine CI `29923634939` — pass for reviewed head `13f1a5a90b3d6d6e78b1a62f128da4ff16cb81b1`; all 27 workflow stages, including evidence upload and enforcement, passed.
- candidate deployment `29927875536` — pass for integrated engine `304c197b828cb21ad8a27407c8ae843132cf3bab`; production `studio.js` matched SHA-256 `5ffc4d35d89550473cef6145524b398528ffdcb6146cb4360b7f2b80284df6c7`.

Generated evidence under `var/` is deliberately not source-controlled. Protected CI uploads it as a run artifact.

One earlier local inspection run reached 22 successful exact assertions and then terminated with a transient OpenCascade/WASM `memory access out of bounds`; the immediate isolated rerun and the final 45/45 confirming run passed. The previously protected run also passed this inspection stage. This remains recorded as a runner/kernel flake to watch in the final protected run rather than being treated as a product pass by retry alone.

## Supported boundaries

V5 keeps these honest product boundaries:

- section caps are non-destructive renderer stencil caps over exact clipped boundaries; they are not new persisted B-rep cap faces and do not alter normal export geometry;
- third-party STEP recovery does not invent native sketches, feature history, mates, PMI/GD&T, or vendor-specific semantics that are absent or unsupported in the source;
- the canonical turbofan is an educational geometric/assembly benchmark, not an aerodynamic, thermal, structural, manufacturing, or certification model;
- mobile remains an inspection and light-edit boundary rather than a complete authoring workstation;
- browsers using software WebGL render at half-resolution while idle and use a 0.2x body-aware bounds LOD while actively orbiting, selecting, or dragging a section, then restore exact shaded tessellation, edges, and section caps automatically after 180 ms; hardware WebGL and explicit evidence capture retain full requested device resolution and exact geometry;
- long-running browser kernel work remains worker-isolated, but there is no universal cross-vendor CAD interoperability guarantee.

## Release gates

- [x] schema/migration, multi-body, datums/transforms, advanced shapes, patterns, assemblies, inspection, interchange, performance, and accessibility
- [x] canonical turbofan and gearbox/robot-joint generality proof
- [x] direct, headless, MCP, and visible-session agent parity
- [x] protected CI evidence for the reviewed implementation
- [x] merge and CI-only candidate deployment
- [x] public route and exact static-asset verification
- [x] human `v5-visual` review and product-owner release authorization

The release promotion commit must still pass the same protected CI, merge, CI-only deployment, and public-route verification before the V5 label is served. Those delivery facts belong to the immutable workflow record and the release handoff rather than a pre-deployment source checkbox.

Gate definitions and normative evidence remain in §§36–40 of the V5 specification.
