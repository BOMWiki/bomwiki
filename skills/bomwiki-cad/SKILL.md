---
name: bomwiki-cad
description: Operate BOMwiki CAD Studio through its semantic MCP protocol for real part modeling, assemblies, inspection, visible UI control, persistence, and exports. Use when an agent must inspect or change a BOMwiki CAD project, visibly operate Studio without Computer Use or browser automation, verify exact CAD evidence, recover from conflicts, or present and record a CAD workflow.
---

# BOMwiki CAD

Use the `bomwiki-cad` MCP tools as the only CAD control surface. Treat capability manifests and returned revisions as authoritative.

## Core workflow

1. Call `cad_capabilities` before planning. Its default compact summary preserves every capability ID and state without flooding the agent context. Request `detail: "schemas"` with only the `operationKinds` or `queryKinds` needed for the current task; use `detail: "full"` only for a manifest audit. Read `bomwiki-cad://skills/core` when this installed copy and the advertised skill version differ.
2. Open or connect the intended session with the minimum scopes. For visible work, use Studio-first fixed local discovery or open the returned agent-first launch URL; never ask the user to copy or paste a pairing URL. Confirm the project ID, session kind, protocol, skill compatibility, expiry, and granted permissions after approval.
3. For visible Studio work, call `cad_ui` with `action: "capabilities"` and then `action: "snapshot"`. The default UI summary includes every command/action identity and parity count. Use `detail: "catalog"` only to discover an unknown human control, or `detail: "schemas"` with the specific `controlIds`, `commandIds`, or `actionIds` you will use. Record the document and UI revisions.
4. Inspect semantic project state with `cad_inspect`. Use stable entity IDs and subshape references returned by tools.
5. Apply visible, non-persistent interaction through `cad_ui`; pass `expectedUiRevision` for every action batch.
6. For every persistent edit, use either direct `cad_preview` or an advertised visible command ending in `command.preview`. Verify the change set, exact evidence, and direct/visible hash parity when present, then call `cad_commit` with the preview ID and expected document revision.
7. Wait with `cad_events` only for event kinds advertised by the live UI manifest. For other work, use the structured tool result and re-inspection. Do not infer completion from elapsed time or issue blind sleeps.
8. Re-inspect the affected entities, exact geometry or solve state, history, renderer revision, and any requested unchanged assertions. To validate a ghosted edit before commit, bind `cad_query` to the exact `previewId` and `expectedRevision`; do not substitute committed-document evidence.
9. Save or export only with explicit permission. Report the final revisions, changes, evidence, artifacts, and remaining limitations.

If Studio reloads, wait for `SESSION_RECOVERY_REQUIRED`, call `cad_session` with `action: "reconnect"`, open the returned launch URL, and refresh capabilities, document state, UI state, and events after recovery approval. Stop cancellable work immediately on pause and do not resume until `session.resumed`.

## Safety rules

- Never use Computer Use, browser automation, DOM inspection, selectors, screenshots, pointer coordinates, keyboard events, or arbitrary page evaluation to operate CAD.
- Never edit project JSON directly or call kernel constructors outside advertised commands.
- Never turn a UI action into a persistent geometry change. Persistent work always uses preview and commit.
- Never claim exact geometry, a successful solve, a saved file, or an exported artifact without the corresponding structured evidence.
- Never silently rebase a stale document or UI revision. Inspect intervening changes and re-preview.
- Never guess a capability from a toolbar label. If it is absent or disabled in the manifest, report that limitation.

## Load only the relevant reference

- Sessions, scopes, and connection: [sessions-and-permissions.md](references/sessions-and-permissions.md)
- Semantic visible UI control: [semantic-ui.md](references/semantic-ui.md)
- Parts and feature history: [part-modeling.md](references/part-modeling.md)
- Components, transforms, and mates: [assemblies-and-mates.md](references/assemblies-and-mates.md)
- Measurements, health, rendering, and exports: [inspection-and-artifacts.md](references/inspection-and-artifacts.md)
- Revision conflicts, failures, and recovery: [conflicts-and-recovery.md](references/conflicts-and-recovery.md)
- Deliberate visible presentation, narration, and recording: [presentation-and-recording.md](references/presentation-and-recording.md)

Use recording guidance only when the user requests a visible presentation or recording. Normal CAD use stays in normal presentation mode.
