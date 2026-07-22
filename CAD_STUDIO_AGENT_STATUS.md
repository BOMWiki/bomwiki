# CAD Studio agent-operability status

Last updated: 2026-07-22

Protocol: `bomwiki.cad.agent/v1`

Release branch: `codex/cad-v5-release`

Status: The V5 release exposes the advanced document surface through the shared typed command/query service. Direct, headless, MCP, visible-session, canonical public-command replay, protected CI, candidate deployment, live asset verification, and product-owner release authorization are complete. The release promotion still follows the protected `wiki/engine` PR and CI-only deployment path.

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

## Release evidence

- `npm run studio:agent:core` — 50/50.
- `npm run studio:agent:headless` — 11/11.
- `npm run studio:agent:mcp` — 24/24.
- `npm run studio:agent:parity` — 28/28.
- `npm run studio:agent:turbofan` — `public-command-replay-pass`.
- `npm run studio:agent:release-check` — `automated-candidate-pass` with core, headless, MCP, live parity, public turbofan replay, and V5 benchmark subchecks passing; automation deliberately does not self-issue the human release approval.
- protected engine CI `29923634939` — pass for reviewed head `13f1a5a90b3d6d6e78b1a62f128da4ff16cb81b1`.
- integrated candidate `wiki/engine@304c197b828cb21ad8a27407c8ae843132cf3bab` — deployed by CI run `29927875536` and verified on the public Studio route.
- product-owner attestation — checked in as `CAD_STUDIO_V5_RELEASE_ATTESTATION.json` and validated by the aggregate V5 release gate.

## Supported boundaries

- headless operation without an exact-kernel adapter remains document-semantic only and truthfully refuses exact render/STEP assertions;
- imported third-party STEP is exact geometry plus supported hierarchy/metadata, not reconstructed native parametric history, mates, or PMI;
- the canonical turbofan is a generic CAD operability benchmark, not an engineering simulation or certification artifact.

The `v5-agent` surface is part of the V5 production release. Future capability changes must preserve the typed manifest, atomic preview/commit semantics, exact-evidence refusal rules, and the protected release path.
