# CAD Studio agent-operability status

Last updated: 2026-07-21

Implementation branch: `codex/cad-agent-operation`

Stacked dependency: `codex/cad-v5-runtime@55d28afd6`

Specification: `CAD_STUDIO_AGENT_OPERABILITY_SPEC.md`

Protocol: `bomwiki.cad.agent/v1`

Status: The agent foundation required to operate the current Slice 5A feature set is implemented as a review candidate on top of the unmerged Slice 5A multi-body runtime. It covers the applicable A0–A4 command, inspection, headless, MCP, live-pairing, and multi-body contracts, but it does not claim every A0–A4 release requirement. The candidate is not merged, deployed, or live-verified. The final `v5-agent` gate remains open because exact headless kernel parity, long-job progress/cancellation, advanced V5 operations, performance evidence, and the canonical turbofan replay do not exist yet.

## What this candidate implements

- one transport-independent `CadCommandService` for typed inspection, preview, validation, commit, undo, redo, revision conflicts, idempotent protocol requests, semantic change sets, and exact-kernel evidence;
- normal Studio parameter, feature, body, Boolean, and project actions routed through the same typed transaction boundary while preserving legacy pattern behavior;
- schema-versioned capability discovery with per-operation JSON input schemas and explicit disabled-reason codes;
- stable project, part, parameter, feature, and body identities plus paginated tree, entity, dependency, search, validity, geometry, and history queries;
- detached expiring previews, atomic transactions, transaction-local aliases, permission scopes, expected revisions, commit budgets, and structured diagnostics;
- a headless `bomcad` CLI for capability inspection, project inspection, validation, preview, apply, and deterministic replay inside an approved project root;
- an MCP 2025-11-25 stdio server exposing exactly `cad_capabilities`, `cad_session`, `cad_inspect`, `cad_query`, `cad_preview`, `cad_commit`, `cad_history`, and `cad_artifact`;
- filesystem root confinement, symlink/traversal refusal, explicit read/edit/save/export permissions, session close, and no fabricated exact geometry in a headless session without a kernel adapter;
- a real loopback-only live Studio bridge: MCP returns an expiring pairing URL, the user opens it from Studio Help, Studio displays the client/scopes/mode, and no project data is shared before approval;
- live `read-only`, `preview-required`, and explicitly approved `scoped-auto-commit` modes;
- visible agent activity, per-commit approval in the default mode, Pause, Resume, Revoke, project-change invalidation, and normal undoable History entries;
- exact visible-Studio preview validation through the production OpenCascade worker, plus project/STEP/STL live artifact transfer up to the declared loopback budget;
- direct-library, headless, MCP, visible Studio, loopback, human-agent handoff, and multi-body regression suites.

## Available typed operations

- `project.rename`, `project.setUnits`;
- `parameter.create`, `parameter.update`, `parameter.delete`;
- `feature.extrude`, `feature.cut`, `feature.revolve`, `feature.fillet`, `feature.chamfer`, `feature.shell`, `feature.update`, `feature.suppress`, `feature.delete`;
- `body.activate`, `body.rename`, `body.setVisibility`, `body.suppress`, `body.delete`;
- `boolean.union`, `boolean.subtract`, `boolean.intersect`.

Every available operation is previewable and atomic. Agent-created geometry appears as ordinary editable features and bodies in the same Studio tree used by human edits.

## Deliberately disabled and truthfully reported

- datum planes/axes and body transforms;
- Loft, Sweep, and twisted multi-section blade construction;
- source-linked feature/body/component patterns;
- Boolean Split;
- components, assemblies, occurrences, and mates;
- section/cutaway views;
- headless exact STEP/STL/render without an exact-kernel adapter;
- live PNG render transfer;
- artifacts larger than the 1 MiB live-loopback transfer budget;
- asynchronous long-job IDs, progress events, and active kernel cancellation;
- exact headless B-rep/render/export parity without an installed exact-kernel adapter.

The legacy profile pattern UI remains usable for existing Studio projects, but it is not advertised to agents as a V5 linked-pattern operation.

## Release truth

The following statement is accurate for this candidate:

> BOMwiki CAD has a structured agent foundation: local agents can discover the operations currently implemented, inspect projects, preview and commit permission-scoped multi-body edits through MCP/headless tools, and pair with a visible Studio session without screen automation.

The following statements are **not** yet allowed:

- “all CAD features are agent operable”;
- “an agent can build the canonical turbofan”;
- “the V5 agent gate is closed”;
- “this is deployed to production.”

`npm run studio:agent:turbofan` and `npm run studio:agent:release-check` intentionally return a blocked status until the generic advanced capabilities exist. They must never pass through a turbofan-specific generator, imported finished geometry, private project mutation, DOM automation, or Computer Use.

## Last verified local evidence

- `npm run typecheck` — pass;
- `npm run studio:v5:migration` — 118/118;
- `npm run studio:v5:runtime` — 81/81;
- `npm run studio:check` — 277/277;
- `npm run studio:agent:core` — 46/46, including same-transaction body-alias targeting and fail-closed permission expiry;
- `npm run studio:agent:headless` — 10/10;
- `npm run studio:agent:mcp` — 23/23, including transport-level duplicate-request replay;
- `npm run studio:agent:parity` — 28/28, including real localhost pairing, visible preview approval, pause/resume/revoke, MCP-side disconnect propagation, exact multi-body preview, and revision-conflict handoff;
- `git diff --check` — pass.

## Next gate

Review and merge the Slice 5A runtime first, then review this stacked candidate and repeat protected CI/live pairing smoke verification. Agent Slice A5 must add command/query parity in the same PR as each datum, transform, Loft, Sweep, linked-pattern, assembly, mate, section, inspection, and interchange capability. Agent Slice A6 then constructs and verifies the canonical turbofan exclusively through those generic public tools.
