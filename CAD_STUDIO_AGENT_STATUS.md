# CAD Studio agent-operability status

Last updated: 2026-07-22

Protocol: `bomwiki.cad.agent/v1`

Candidate branch: `codex/cad-v5-completion`

Status: The V5 candidate exposes the advanced document surface through the shared typed command/query service and passes local direct, headless, MCP, visible-session, and canonical public-command replay gates. This is local candidate evidence only. Protected CI, human visual review, merge, deployment, live verification, and final `v5-agent` release signoff remain pending.

## Available operation families

- project and unit edits;
- parameters and expressions;
- datum planes, axes, points, and coordinate systems;
- profile/path sketches;
- Extrude, Cut, Revolve, Loft, Sweep, Draft, Thicken, Fillet, Chamfer, Shell, feature edit/suppress/delete, and history reorder/rollback;
- body activation, rename, visibility, suppression, deletion, transform/copy/mirror/align/scale, repair, and linked patterns;
- body-aware Union, Subtract, Intersect, and Split;
- part and assembly creation, component insertion/update/delete/replace/copy, variants, nested assemblies, component patterns, and mate create/update/delete;
- sections, exploded views, axial stages, measurements, materials, appearances, and display modes;
- structured project inspection, semantic tree/entity/dependency/history queries, preview, commit, undo/redo, and bounded artifacts.

All mutations use expected revisions, detached previews, atomic transactions, semantic change sets, stable IDs, structured diagnostics, and normal undoable document history. The visible Studio uses exact worker preflight; headless sessions refuse to fabricate exact B-rep/render evidence when an exact adapter is unavailable.

## Adapter and safety evidence

- direct library, CLI, MCP stdio, and visible Studio share the same operation manifest and transaction service;
- MCP exposes the eight stable CAD tools and confines file access to the approved root;
- live pairing is loopback-only, expiring, no-store, permission-scoped, visibly approved, pausable, revocable, and project/revision bound;
- stale previews, expired scopes, unknown operations, cross-project edits, traversal, permission enlargement, and mid-transaction failures fail closed without mutation;
- exact preview/commit results appear as ordinary editable features, bodies, components, mates, and history entries;
- advanced V5 replay does not use private JSON mutation, a turbofan-only operation, DOM automation, Computer Use, or imported finished geometry.

## Canonical public-command replay

`npm run studio:agent:turbofan` rebuilds the canonical project through 27 transactions containing 363 advertised operations:

- 22 parts;
- 25 source bodies;
- 159 solved occurrences;
- 9 linked patterns;
- 62 mates;
- fully constrained, with no solver errors;
- no unadvertised or forbidden operation kind.

The same release gate also runs exact/browser turbofan benchmarks plus gearbox and robot-joint generality fixtures.

## Last local evidence

- `npm run studio:agent:core` — 50/50.
- `npm run studio:agent:headless` — 11/11.
- `npm run studio:agent:mcp` — 24/24.
- `npm run studio:agent:parity` — 28/28.
- `npm run studio:agent:turbofan` — `public-command-replay-pass`.
- `npm run studio:agent:release-check` — `automated-candidate-pass` with core, headless, MCP, live parity, public turbofan replay, and V5 benchmark subchecks passing.

## Remaining boundaries

- no release claim until protected CI reproduces the evidence for the reviewed commit;
- no live claim until merge, CI-only deployment, and fresh-profile production verification;
- no visual signoff until a human accepts the six captured views;
- headless operation without an exact-kernel adapter remains document-semantic only and truthfully refuses exact render/STEP assertions;
- imported third-party STEP is exact geometry plus supported hierarchy/metadata, not reconstructed native parametric history, mates, or PMI;
- the canonical turbofan is a generic CAD operability benchmark, not an engineering simulation or certification artifact.

The `v5-agent` implementation candidate is locally green. The release gate remains open until protected evidence, human review, and live verification are complete.
