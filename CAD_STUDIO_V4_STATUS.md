# CAD Studio V4 implementation status

Last updated: 2026-07-20

Branch: `codex/cad-v4-spec`

Specification: `CAD_STUDIO_V4_SPEC.md`

Production baseline: `wiki/engine@c28e3b35365839cb8083110c5dc5aeda3d29adf0`

This branch is implementation work only. It is not approved for merge or production deployment yet.

## Completed UX increment — editable template cabinet and first run

- 28 editable parametric starter parts ship across Basics, Mounting, Mechanical, Enclosures, and Workshop.
- Every starter has a stable ID, search/category metadata, named parameters, a valid feature history, nominal envelope, difficulty, and visible feature recipe.
- The full-screen first run now offers four practical quick starters, Browse all templates, Blank sketch, and Open project; it states that templates are editable CAD rather than locked meshes.
- Templates is a permanent project command after onboarding. The cabinet supports category filters, immediate search, selected-part blueprint/recipe inspection, and double-click or explicit Open.
- Starting from a template creates a separate project, resets its command journal, and saves an existing part to Recover after confirmation.
- The first template launches a four-step walkthrough anchored to the real feature tree, Inspector dimension, Fit control, and Save action. Blank sketch uses the live sketch tools, and Help can replay the walkthrough.
- Desktop and 375 px layouts were visually reviewed in the in-app browser. The mobile cabinet is a deliberate categories → parts → detail flow with 44 px controls, no horizontal overflow, and no list/detail overlap.
- The frontend-design direction is a dense parts cabinet with orthographic silhouettes and an exposed construction recipe, not a marketing-card gallery.

Verified:

- `npm run typecheck`
- `npm run studio:check` — 233 checks
- all 28 templates pass the production project-file boundary and rebuild through OpenCascade as nonempty solids with zero feature errors
- desktop first run, desktop cabinet, anchored tour, and mobile cabinet visual passes
- `git diff --check`

## Current increment — trusted document and kernel foundation

Completed:

- OpenCascade initialization, rebuild, exact meshing, topology extraction, STEP export, and STL export run in a dedicated module worker.
- Kernel requests carry project and document revisions; deterministic delayed-reply coverage proves stale rebuild replies never reach the visible mesh.
- A stopped or timed-out kernel worker is discarded, restarted once, and replays the last committed document automatically.
- Typed display buffers are transferred to the UI; OpenCascade wrappers and B-rep shapes stay inside the worker.
- Clear and empty-project switches explicitly release the retained worker shape.
- IndexedDB stores the active project, up to 100 delta-encoded command entries/cursor within a 16 MiB decoded-history budget, and the last 20 committed recovery snapshots.
- Undo/redo and project identity survive reload; a valid file Open starts a separate project journal.
- Project > Recover groups local states by project, preserves the target project's existing journal, and makes restoration undoable.
- The document bar reports `Saving…`, `Saved locally`, or `Storage unavailable`; storage failure never blocks modeling or export.
- A detached document boundary formalizes shipped unversioned documents as schema-3 migration inputs, preserves unknown fields, applies resource limits, and refuses newer schemas without changing live state.
- The browser suite uses isolated profiles so IndexedDB behavior is tested rather than accidentally shared between scenarios.

Verified:

- `npm run typecheck`
- `npm run studio:check` — included in the current 233-check branch suite
- desktop visual pass of the recovery panel at `1440 × 900`
- focused cross-project recovery, worker-restart, storage-denial, cut-first, stale-reply, STEP, and STL regressions
- `git diff --check`

## Remaining before Slice 4A is complete

- final schema-4 entity/group/constraint format and deterministic schema-3-to-4 migration fixtures;
- stable IDs for parameters, sketches, entities, groups, constraints, and external references;
- semantic topology lineage plus unique geometric fallback and ambiguous-reference refusal;
- shared canvas/tree/inspector selection model;
- Slice 4A performance, memory, and migration fixture gates.

## Next implementation step

Build the schema-4 sketch model and migration harness without changing sketch interaction yet. The current renderer can then consume migrated profile output while Slice 4B replaces the legacy primitive editor with the constraint solver.
