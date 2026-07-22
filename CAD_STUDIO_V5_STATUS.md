# CAD Studio V5 implementation status

Last updated: 2026-07-22

Specification: `CAD_STUDIO_V5_COMPLEX_MODELING_SPEC.md`

Candidate branch: `codex/cad-v5-completion`

Integration baseline: `origin/wiki/engine@3f1430e90cc38368677a4cde3005322f7e237ec1`

The turbofan conformance benchmark from `92bb3f1271915ad23298b4de541a393899fa653a` is incorporated in this branch.

## Release truth

The implementation branch is a **local automated V5 candidate**, not a completed or deployed V5 release.

The broad capability work, canonical fixtures, exact-kernel regressions, browser regressions, agent replay, performance evidence, and accessibility evidence pass locally. Six visual artifacts have been captured and hash-verified, but the required human visual review is still pending. Protected CI for the previously pushed candidate exposed software-WebGL frame-pacing misses on the reference runner; the branch now combines extension-independent exact batching with a body-aware interaction LOD and adaptive software-rasterizer resolution. That path passes the forced-SwiftShader gate locally but still requires protected-CI reproduction. Merge, CI-only deployment, incognito production verification, and final release signoff have not happened for this candidate.

Do not describe this branch as production V5 until all remaining release steps below are complete.

## Pending-list implementation result

All twelve items from the 2026-07-22 pending implementation list now have generic implementation and automated regression coverage on this branch:

| # | Pending item | Candidate implementation |
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
| 12 | Performance, accessibility, visual, release evidence | Automated performance and accessibility gates pass; six review artifacts and an aggregate release manifest are generated. Human visual and live gates remain pending. |

This table means implementation candidate, not release completion.

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

## Current local automated evidence

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
- `npm run studio:agent:release-check` — local automated candidate pass.
- `STUDIO_PERF_FORCE_SOFTWARE_WEBGL=1 npm run studio:v5:performance` — 14/14 under forced SwiftShader; cold/warm exact rebuild 1,859.0/13.9 ms, zero-positive-pair full interference 2,300.6 ms, orbit frame p95 17.5 ms with 8 exact scene/cap draws plus 4 body-aware interaction draws, tree-selection p95 8.1 ms, section-drag p95 19.0 ms, 12-blade source-edit median 57.5 ms and p95 1,611.6 ms, and verified exact idle-quality restoration.
- `npm run studio:v5:accessibility` — 14/14.
- `npm run studio:v5:visual` — six hash-verified artifacts captured; status remains `awaiting-human-review`.
- `npm run studio:v5:release-check` — every automated suite passed and the aggregate status is `automated-candidate-pass-human-review-required`.

Generated evidence under `var/` is deliberately not source-controlled. Protected CI uploads it as a run artifact.

One earlier local inspection run reached 22 successful exact assertions and then terminated with a transient OpenCascade/WASM `memory access out of bounds`; the immediate isolated rerun and the final 45/45 confirming run passed. The previously protected run also passed this inspection stage. This remains recorded as a runner/kernel flake to watch in the final protected run rather than being treated as a product pass by retry alone.

## Remaining limitations and release gates

Implementation does not remove these honest boundaries:

- the visual artifacts need explicit human review against §40.11 before the visual gate can close;
- protected PR CI must reproduce all suites and upload the final evidence artifact;
- this candidate has not been merged, deployed, or verified in a fresh/incognito production profile;
- section caps are non-destructive renderer stencil caps over exact clipped boundaries; they are not new persisted B-rep cap faces and do not alter normal export geometry;
- third-party STEP recovery does not invent native sketches, feature history, mates, PMI/GD&T, or vendor-specific semantics that are absent or unsupported in the source;
- the canonical turbofan is an educational geometric/assembly benchmark, not an aerodynamic, thermal, structural, manufacturing, or certification model;
- mobile remains an inspection and light-edit boundary rather than a complete authoring workstation;
- browsers using software WebGL render at half-resolution while idle and use a 0.2x body-aware bounds LOD while actively orbiting, selecting, or dragging a section, then restore exact shaded tessellation, edges, and section caps automatically after 180 ms; hardware WebGL and explicit evidence capture retain full requested device resolution and exact geometry;
- long-running browser kernel work remains worker-isolated, but there is no universal cross-vendor CAD interoperability guarantee.

## Release gates

Local automated implementation evidence is present for the schema, multi-body, datums/transforms, advanced shapes, patterns, assemblies, inspection, interchange, performance, accessibility, turbofan, generality, and agent scopes. They become release-pass evidence only when the protected delivery record is green and the required review is accepted.

- [x] local automated schema/migration candidate
- [x] local automated multi-body candidate
- [x] local automated datums/transforms candidate
- [x] local automated advanced-shapes candidate
- [x] local automated patterns candidate
- [x] local automated assemblies candidate
- [x] local automated inspection candidate
- [x] local automated interchange candidate
- [x] local automated performance candidate
- [x] local automated accessibility candidate
- [x] local automated turbofan/generality candidate
- [x] local automated agent candidate
- [ ] human `v5-visual` review
- [ ] protected CI evidence for the reviewed commit
- [ ] merge to `wiki/engine`
- [ ] CI-only engine deployment
- [ ] incognito live verification and `v5-live`
- [ ] final release-gate signoff

Gate definitions and normative evidence remain in §§36–40 of the V5 specification.
