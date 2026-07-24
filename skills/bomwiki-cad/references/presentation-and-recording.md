# Presentation and recording

Presentation changes pacing and visibility only. It never changes geometry, validation, permissions, or commit semantics.

## Modes

- `instant`: deterministic tests or fast ephemeral UI batches.
- `normal`: ordinary visible CAD use without artificial pointer or typing latency.
- `recording`: Studio holds meaningful states long enough to be legible.

Use semantic UI actions for workspace, tree, selection, inspector, camera, preview, and review state. Wait for structured settled events instead of fixed sleeps. Do not simulate cursor wandering, typing, hover exploration, mistakes, or dramatic retries.

## Narration

Narration subtitles describe observable intent, action, confirmed evidence, warnings, or required attention. They must never contain hidden chain-of-thought, raw prompts, secrets, credentials, private paths, or unsupported claims.

Only Studio-owned evidence templates may produce outcome language such as passed, solved, saved, rendered, or exported. Capability, evidence, and attention cues are correlated with their structured action or result events; agents cannot supply arbitrary subtitle text. Export WebVTT or SRT only with `artifact.export-narration`; the returned manifest and cue count must match the completed visible cue track.

Use `cad_ui` with `action: "narrate"` only with an ID advertised in
`trustedNarrationTemplates`, the current `expectedUiRevision`, and the bounded
numeric values declared by that template. This is the deliberate presentation
track for an agent's observable plan and action; it is not arbitrary caption
injection. Evidence queries continue to own their result language.

When an edit must be checked before commit, pass the exact `previewId` and
`expectedRevision` to `cad_query`. Use `presentation: "silent"` only for
bounded computational refinement such as an exact clearance solve. Repeat the
converged query with `presentation: "visible"` so the recording shows the
verified result before the matching preview is committed.

## Editable turbofan sequence

The canonical V6 complex-modeling recording starts from an empty schema-5
document and constructs the turbofan through ordinary typed transactions. It
must not import the finished project or use a recording-only template.

1. Establish layout parameters, origin datums, and the root assembly.
2. Build the nacelle sections, lofted shell, inlet lip, bypass passage, core
   casing, fan blade, compressor/turbine blade families, shafts, disks,
   combustor, nozzle, supports, and bearings.
3. Create the nested fan subassembly, reusable blade-row patterns, mates,
   materials, and saved inspection state.
4. Fit the whole model after each committed construction stage, then present a
   clean full turbofan hero view.
5. Locate the rear compressor stator and combustor, switch to a ghosted
   internal view, and measure their exact current clearance.
6. Open the normal distance-mate editor, solve the axial value against
   preview-scoped exact clearance, visibly present the converged preview, and
   verify no interference before commit.
7. Commit the same preview hash as one reversible transaction, open the
   longitudinal section, export only the selected compressor stage, persist the
   native project, and prove reload recovery.
8. End on a clean sectional turbofan view and export matching WebVTT/SRT.

The recording evidence must include one uncut video, exact canonical hashes,
the selected-stage artifact hash and scope, project persistence/recovery
hashes, the CAD-only tool transcript, and a forbidden-interface audit.

Before a recorded visible demo, announce readiness and wait for the user’s explicit go. Then use recording mode and deliberate settled milestones.
