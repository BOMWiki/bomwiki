# Semantic visible UI

Call `cad_ui` capabilities and snapshot before control. Start with the compact summary. Request `detail: "schemas"` for only the controls, commands, or actions needed for the current task; use the larger `catalog` response only when an unknown human control must be discovered and `full` only for audits. Use only action IDs, workspace IDs, view IDs, field IDs, and entity references advertised for the connected Studio version.

## Apply interactions

Send `action: "apply"` with:

- the current `expectedUiRevision`;
- one atomic list of typed semantic actions;
- an optional correlation ID;
- optional presentation metadata.

Refresh the snapshot after `UI_REVISION_CONFLICT`. Do not replay the old batch until its targets are still valid.

The released profile includes document/workspace activation; multi-entity and exact face/edge/vertex selection; tree reveal/expand/collapse; normal panels, inspector, history, and diagnostics; explicit camera, exact selection fit, display, saved section, and saved exploded-view control; presentation choreography; and observable narration.

For an advertised visible command:

1. select its stable target first;
2. `command.open` the stable command ID;
3. bind selection fields with `command.bindSelection`;
4. populate typed fields with `command.setInput`;
5. call `command.preview`;
6. verify the returned exact evidence, transaction hash, document hash, and visible preview state;
7. commit only that preview through `cad_commit`, or use `command.cancel`.

`assembly.component-transform` is the first released visible command. Its `occurrence` field accepts exactly one stable occurrence reference and its `transform` field accepts one rigid finite 4×4 matrix. Read the live command capability before use; do not infer other command support from the ribbon.

## Verify

Wait for `presentation.stepSettled` and `ui.changed`. Compare the returned snapshot with the intended workspace, selection, tree reveal, inspector, and viewport. UI revision and document revision are independent.

Semantic UI actions are ephemeral. `command.preview` delegates to the same revision-bound transaction service as direct `cad_preview`; only `cad_commit` persists geometry.
