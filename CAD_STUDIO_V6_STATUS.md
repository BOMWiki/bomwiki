# CAD Studio V6 status

Date: 2026-07-24

Branch: `codex/cad-studio-v6`

Release status: **production promotion authorized by the product owner on
2026-07-24 with external npm publication explicitly deferred; I0-I4, all 48
normal commands, literal full production-UI parity, real packaged Codex-host
operation, both acceptance recordings, and the canonical editable-turbofan
construction/change gate passed locally and in protected CI; the V6 runtime was
first deployed as `wiki/engine@45ca9bedf150ba7e1288b05e5a5ded9393013529`
by run `30067178988`, and public verification correctly blocked the formal
release claim when the visible shell still identified itself as V5. The formal
V6 production release is the first protected `wiki/engine` revision containing
the corrected V6 identity that passes CI, deploys through `deploy-engine`, and
verifies on `/cad/studio`.**

The implementation contract is [CAD_STUDIO_V6_AGENT_NATIVE_SPEC.md](CAD_STUDIO_V6_AGENT_NATIVE_SPEC.md). V6 makes the real CAD application semantically operable by compatible agents without Computer Use, DOM targeting, pointer/keyboard simulation, or a separate demo-only path.

Complete semantic UI control is the V6 release floor, not an optional layer after I0. “Complete” means every human-operable production Studio control, not a hand-picked subset called released. The candidate must visibly operate the normal workspace, tree, selection, inspector, camera, display and inspection state, every command and typed field, exact previews, approvals, commits, history, recovery, and artifact flow through versioned semantic calls. A state service or partial command adapter set is not releasable as V6.

## Implemented in the I0 runtime

- Versioned UI profile `bomwiki.cad.agentic-ui/v1`.
- One revision-controlled `CadStudioInteractionRuntime` for ephemeral visible interaction.
- Complete profile action and event vocabularies. Every action has a closed schema and explicit `available` or `disabled` state; unreleased actions fail closed instead of disappearing from negotiation.
- Complete bounded I0 snapshot shape for active document, workspace, command, selection, tree, panels, camera/display/inspection/render state, presentation, narration, connection, and independent UI/document revisions.
- Stable capability registry, deterministic manifest hash, bounded event buffer, filtered event waiting, diagnostics, and advertised limits.
- Layered capability discovery: compact complete summaries by default, a
  control catalog only when an unknown control must be found, targeted schema
  batches capped at 20 IDs, and an explicit complete-audit form. Document
  discovery is `12.8 KiB` instead of `89.1 KiB` by default and UI discovery is
  `25.9 KiB` instead of `259.5 KiB`, without removing any capability identity,
  state, schema, or protected full-manifest path.
- Released semantic action subset:
  - workspace activation;
  - body, occurrence, and feature selection/clear;
  - model-tree reveal;
  - normal entity inspector;
  - top/front/right/isometric standard view and visible-model fit-all;
  - presentation mode;
  - observable-action narration mode.
- Shared Studio controller path: agent calls use the same workspace, selection, inspector, and camera functions as human controls.
- Renderer-backed settlement: every released semantic action produces a real frame after the current kernel revision, records rendered document/kernel/UI revisions, emits `render.completed`, and only then emits `presentation.stepSettled`.
- Human workspace, selection, camera, panel, and active-command changes advance the same UI revision, so stale agent batches fail closed.
- Transactional UI rollback: a failed or interrupted batch restores agent-owned scopes while preserving semantic scopes touched by the human during the batch.
- Serialized UI snapshots are rejected above 512 KiB; event payloads, batches, waits, visible holds, and settlement waits are bounded.
- Local bridge exchange uses bounded long-poll wakeups rather than a 140 ms polling floor.
- Movie-style visible narration generated from capability templates, with correlation IDs and an accessible live region. It does not expose prompts or private reasoning.
- Live-only MCP tools `cad_ui` and `cad_events`; headless sessions return `SESSION_NOT_VISIBLE`.
- Explicit least-privilege `ui.read`, `ui.select`, `ui.navigate`, `ui.present-demo`, and `ui.present-narration` grants in the visible approval flow; draft and preview grants remain separate.
- Canonical host-neutral `bomwiki-cad` skill plus seven progressive references, exposed as installable files and MCP resources with a package checksum.
- Deterministic runtime, complete union, size-limit, renderer-settlement, selective rollback, MCP resource/tool, permission, conflict, event-wait, performance, observer-only browser, and separate simulated-human browser coverage.

## Current automated evidence

- `npm run studio:v6:interaction` — 40/40 passed.
- `npm run studio:v6:forbidden` — 4/4 passed.
- `npm run studio:agent:mcp` — 37/37 passed, including the closed
  revision-bound preview-query schema, explicit visible/silent presentation,
  closed normal-host permission discovery, compact document discovery,
  targeted schema retrieval, and fail-closed rejection of unadvertised schema
  IDs.
- `npm run studio:v6:package:check` — 8/8 passed, including a byte-identical second build, embedded source/protocol/skill identity, guarded exact-SHA publication intent, public scoped-package metadata, and a dry-run assertion that the alpha candidate cannot replace npm's stable `latest` tag.
- The guarded publisher defaults to a no-write plan, embeds the exact source
  commit and protocol/skill identity, rejects dirty or mismatched publication,
  requires an exact confirmation, and re-downloads the registry tarball to
  prove SHA-256 and `next`-tag parity after an authenticated publish.
- `npm run studio:v6:host-conformance` — 9/9 passed.
- `npm run studio:v6:codex-host-smoke` — 7/7 passed with Codex CLI
  `0.145.0-alpha.30` loading the clean-installed `@bomwiki/cad-mcp`
  `6.0.0-alpha.1` tarball, reading skill `0.6.0`, obtaining one named accessible
  approval, and visibly controlling the normal View workspace, model tree,
  selected body, inspector, and fit path through 11 successful MCP calls with
  no shell/browser/Computer Use action and no application page/request error.
  This evidence is explicitly local and must be repeated against production.
- `npm run studio:v6:ui-inventory` — 16/16 passed; the corrected literal denominator is 260 top-level controls plus 263 typed fields across 48 normal commands. Of the top-level controls, 248 are directly available, 12 are explicitly contextual, all 260 are accounted for, and 0 are missing or orphaned. Accounted coverage is 100%; direct agent-operable coverage is reported separately as 95.38% so browser activation, an inactive Sketch workspace, and explicit human connection/session/preview authority remain visible rather than being mislabeled as agent actions. Every expanded dynamic action now owns a concrete observable `data-v6-control-id`; no expanded control is accepted only because it belongs to a generic dynamic family. Every persistent control counted as available maps to exact `cad_preview` + `cad_commit`, a `project.edit` grant, and advertised document operations; every inspector command redirect resolves to a released normal command with draft authority; Create body is bound to the normal extrude editor in forced new-body mode; pattern independence/dissolve use kernel-generated exact records through the normal visible transaction path; and project replacement preserves the approved agent session while publishing the new project/revision scope.
- `npm run studio:v6:observer` — 130/130 passed, including all 48 normal commands, Help/templates/recovery/tour/Clear surfaces, direct welcome and library template use, blank-project start, structured recovery entry restore, visible project-transition Undo/dismiss, cross-project session continuity, bounded integrity-checked project and STEP import through both normal Open surfaces, rejection of inconsistent import metadata/chunks before replacement, structured Exit settlement before normal navigation, coordinate-free 2D sketch-canvas edits and selected-shape dimension/selection/deletion controls, semantic 3D viewport coverage, datum/sketch selection, all seven concrete model-tree section controls with human-state capture and transactional rollback, explicitly identified human connection/preview approvals, the conditional legacy-project notice, dynamic assembly/part tree and inspector selection/isolation/export/evaluation controls, rollback of failed dynamic batches, persistent parameter creation/rename/value/deletion, persistent body, feature reorder/rollback/deletion, saved-inspection activation/spacing/deletion, datum/sketch/body-pattern editing, pattern visibility/skipped-occurrence/deletion, exact kernel-backed pattern independence and dissolve with visible preview/approval/persistence/render/Undo, all three inspector Boolean shortcuts, all three inspector feature-pattern fields, all four normal sketch-operation feature-pattern controls, unfinished-draft Keep/Discard/Apply controls with failed-batch restoration and queued continuation, exact destructive Clear preview/approval/persistence/Undo, assembly occurrence/mate visibility/suppression/deletion through a normal visible exact-preview surface, selected-feature/datum/sketch/pattern/mate/occurrence redirects into normal command panels, explicit new-body creation, preview-required approval, atomic commit, local and recovery persistence, destructive-delete confirmation, Undo recovery, direct-preview cancellation and normal-field restoration, immediate inspections, sketch and viewport modes, face/shell/Press-Pull lifecycles, exact Undo/Redo renderer settlement, serialized durable history, reload recovery, transactional normal-form human edits, exact re-preview, visible Apply, and cancel.
- `npm run studio:v6:i3:document` — 16/16 passed, including selected-mate
  update parity and immutable revision-bound preview snapshots for exact
  candidate queries.
- `npm run studio:v6:i4:contract` — 7/7 passed.
- `npm run studio:v6:foundation` — complete I0-I4 local aggregate passed.
- `npm run studio:v6:acceptance` — the default non-recording ten-step
  normal-operation gate. Recording is intentionally excluded from ordinary
  local and protected CI runs.
- `npm run studio:v6:acceptance:recording` — explicit opt-in replay only; it
  previously passed 15/15 including the recording-presentation checks.
- `npm run studio:v6:turbofan-demo:recording` — explicit opt-in only. Its last
  requested run passed 10/10 locally. It starts from an
  empty document, builds the canonical editable turbofan through nine public
  preview/commit transaction groups with no import/template shortcut, proves
  the canonical hash, performs the visible rear-compressor 12 mm clearance
  change through the normal mate editor, verifies exact preview clearance and
  zero interference before committing the identical direct/visible hash,
  opens the longitudinal section, exports only the selected stage, persists and
  recovers the project, and emits one uncut recording plus matching trusted
  WebVTT/SRT and a CAD-only transcript.
- `npm run studio:v6:release-check` — the default non-recording release gate:
  foundation, exact-kernel, package, host-conformance, browser, ten-step
  acceptance, and typecheck. Viewport video capture and full demo tracks run
  only through the explicit `:recording` commands above; the normal gate still
  validates the small VTT/SRT export API as an agent capability.
- Exact-head protected CI run `30064711027` passed all 31 enforced phases in
  `11m23s` for head `589329ec8b944f676b296c0d0e6d3912899f6f6c`.
  V6 evidence artifact `8585971844` has digest
  `sha256:20bb639a740f782e50e49f9d5d64a319d1b54a069475b5218f97e9e3db82a1eb`.
- Protected evidence includes the normal-operation recording plus the uncut
  editable-turbofan construction/change recording, matching trusted
  WebVTT/SRT, exact preview/commit evidence, selected-stage export, persistence
  recovery, and the forbidden-interface audit.
- CI reliability note: the unchanged first attempt encountered a transient OpenCascade WebAssembly memory fault, and attempt 2 recorded one `5117.2 ms` p95 rebuild sample against the unchanged `5000 ms` ceiling. Attempt 3 passed both exact-kernel and performance gates without relaxing either contract.
- Latest performance evidence:
  - in-process capability p95 `0.123 ms`, snapshot p95 `0.019 ms`;
  - live loopback capability p95 `25.09 ms`, snapshot p95 `22.85 ms`.
- `npm run typecheck` — passed.
- `quick_validate.py engine/skills/bomwiki-cad` — passed.
- Compatibility: `studio:agent:core` 51/51, `studio:agent:headless` 11/11, `studio:agent:parity` 28/28, and `studio:check` 282/282 passed.

The observer phase performs the required simulated-human connection and preview approvals, then performs no manual CAD/UI action. All tested workspace, selection, tree, inspector, camera, command-draft, exact-preview, commit, cancellation, and narration changes travel through the loopback CAD tools or the same normal command form; the browser reads visible state only. A separately labelled simulated-human phase uses normal controls to verify shared workspace, camera, panel, pause, and recovery state capture.

## Implemented in the I1 candidate

- Fixed local discovery at `http://127.0.0.1:49784/.well-known/bomwiki-cad`.
- Studio-first connection from **Connect agent** with no URL or secret copy/paste.
- Agent-first launch URL that redirects to Studio with a short-lived fragment nonce; the remote server does not receive the nonce.
- Origin-bound hidden local relay and one normal visible Studio approval showing client, skill, scopes, mode, and expiry.
- Distinct pairing, permission, and recovery deadlines.
- Human pause blocks new work, cancels cancellable requests, interrupts recording holds, and transactionally restores agent-owned UI state.
- Reload recovery through a bounded reconnect action and a second visible approval; canonical project ID and document revision survive reload.
- Permission expiry and revocation terminate the bridge with typed states.
- Skill `0.2.0` documents fixed discovery, agent-first launch, pause, expiry, and recovery.
- A publishable `@bomwiki/cad-mcp` npm artifact is built from canonical sources, installed into a clean temporary consumer, and invoked through standard MCP.
- A separate host-neutral MCP client loads the canonical skill, connects with one approval, performs visible semantic Studio navigation, records its CAD-only tool transcript, and exits cleanly.

## I1 automated evidence

- `npm run studio:v6:package:check` — 8/8 passed.
- `npm run studio:agent:mcp` — 28/28 passed.
- `npm run studio:v6:observer` — 17/17 passed.
- `npm run studio:v6:host-conformance` — 6/6 passed.
- `npm run studio:v6:interaction` — 26/26 passed, including pause interruption and rollback.
- `quick_validate.py engine/skills/bomwiki-cad` — passed.

## Implemented in the I2 runtime

- Complete released semantic navigation surface:
  - active document and workspace;
  - multi-entity and exact face/edge/vertex selection;
  - tree reveal plus real expandable assembly-row expand/collapse;
  - inspector, Project, diagnostics, and history surfaces;
  - standard and explicit camera state, fit-all, and exact rendered fit-selection bounds;
  - display mode, saved section, saved exploded view, and clear-inspection controls.
- Closed typed `SubshapeRef` schemas for exact face, edge, and vertex topology. Selector, pointer, and coordinate leakage fail before UI control.
- Kernel-derived face, edge, and vertex signatures that remain byte-stable across warm rebuilds.
- Canvas overlays for multi-selection and selected faces, edges, and vertices, with section-clipping parity.
- Real Project revisions in a separate revision surface without changing the ordinary feature-history contract.
- Recording-mode choreography for workspace, panel, tree, selection, inspection, camera, display, section, explode, history, diagnostics, focus, and renderer settlement.
- Structured readiness waits instead of fixed sleeps, including deterministic renderer settlement when an occluded browser suspends its ambient frame loop.
- Transactional cancellation of an in-flight camera animation on human pause, followed by exact camera rollback.
- Shared human/agent UI revisions for workspace, camera, panels, selection, and other semantic scopes; stale actions fail closed.
- Observer-only browser coverage over a real editable robot-joint assembly. After the visible connection approval, every CAD/UI action travels through the public loopback tools.

## I2 automated evidence

- `npm run studio:v6:interaction` — 31/31 passed.
- `npm run studio:v6:i2:document` — 4/4 passed.
- `npm run studio:v6:i2:kernel` — 5/5 passed.
- `npm run studio:v6:observer` — 22/22 passed.
- Latest live loopback performance:
  - capability p95 `25.65 ms`;
  - snapshot p95 `25.04 ms`.
- `npm run studio:v6:foundation` — complete I0-I2 aggregate passed.
- Compatibility: `studio:check` 282/282, `studio:agent:parity` 28/28, `studio:agent:core` 50/50, and `studio:agent:headless` 11/11 passed.

## Implemented in the I3 runtime

- One source-owned literal production-UI registry covering 260 individually addressable top-level human controls and 263 typed fields across 48 normal commands. Every expanded dynamic action has its own observable production control identity; the inventory reports available, contextual, missing, and orphan controls without slice-relative relabeling.
- Twenty released assembly command adapters: create/insert/linked duplicate/make independent/replace/variant/component transform/edit context/exit context/component pattern plus Fixed, Coincident, Concentric, Distance, Angle, Parallel, Perpendicular, Tangent, Revolute, and Slider mates.
- Seventeen released advanced-modeling adapters: Boolean Split, Construction Plane, Align Body, Profile, Path, Loft, Sweep, Partial Revolve, Draft, Thicken, Variable Fillet, Body Pattern, Move, Copy, Rotate, Mirror, and Scale. Each uses the existing production dialog and its real field set.
- Advanced-modeling transactions opened on a fresh schema-5 part atomically bootstrap only the canonical origin datums required by the normal human dialog; exact preview/cancel evidence proves those implicit datums never leak into the committed document.
- Four released saved-inspection command adapters: Section View, Exploded View, Axial Stage Group, and Saved Measurement. Material assignment and the immediate Properties/Measurements/Clearance/Interference result surfaces remain outside this milestone.
- Direct semantic actions open the existing normal dialogs, bind stable entity and topology selections, populate their normal typed fields, and drive the normal transform gizmo where applicable without selectors, coordinates, pointer events, keyboard synthesis, or a parallel agent-only panel.
- `command.preview` builds one revision-bound ordinary document transaction and exact-validates it through the same `CadCommandService` path as direct `cad_preview`.
- The detached transform changes the real renderer while leaving the document byte-identical until commit.
- The normal dialog presents exact validation, change counts, transaction hash, canonical result-document hash, body evidence, and an explicit **Apply exact preview** action.
- Visible and direct preview paths prove the same canonical document hash and exact kernel evidence.
- Preview-required connections register the visible preview and stop at a normal human approval before agent commit; the same visible dialog can also apply the exact preview directly.
- Commit advances exactly one ordinary document revision, closes the draft and detached preview, updates the renderer and revision history, and preserves normal undoable/editable assembly structure.
- Cancel, stale document revision, stale UI revision, changed fields, gizmo edits, pause, and failed multi-action batches invalidate or transactionally restore drafts and previews without a hidden document edit.
- Structured `command.draftChanged`, `preview.started`, `preview.ready`, `preview.rejected`, `commit.applied`, `history.changed`, renderer, and settlement events remain free of selectors, pointer data, prompts, and private reasoning.
- Canonical skill `0.3.0` documents the advertised visible-command workflow and direct/visible parity requirement.

## I3 automated evidence

- `npm run studio:v6:ui-inventory` — 6/6 passed.
- `npm run studio:v6:i3:document` — 8/8 passed.
- `npm run studio:v6:interaction` — 35/35 passed.
- `npm run studio:v6:observer` — 44/44 passed against the exact browser worker, including all 20 assembly commands and the four released saved-inspection dialogs.
- `npm run studio:v6:package:check` — 8/8 passed.
- `npm run studio:v6:host-conformance` — 6/6 passed.
- `quick_validate.py engine/skills/bomwiki-cad` — passed.
- Compatibility: `studio:check` 282/282 and `studio:agent:parity` 28/28 passed.

## Implemented in the I4 runtime candidate

- Exact live `geometry.health`, `assembly.clearance`, and `assembly.interference` queries with stable entity/body scopes, canonical document hashes, and structured kernel-completion evidence. The same queries can bind to an unexpired revision-bound preview, evaluate its exact candidate document before commit, and visibly or silently present the result without mutating committed state.
- Closed selected-entity scopes for body, occurrence, part, and assembly STEP/STL exports; invalid, empty, ambiguous, and unadvertised scopes fail closed.
- Model-only PNG transfer from the exact rendered body scope, current camera, display, section/explode, and rendered revisions. The manifest explicitly records `browserChromeIncluded: false`.
- Visible-narration WebVTT and SRT export containing completed capability-template cues only, with no prompts, private reasoning, credentials, or unsupported result language.
- Host-side artifact saving only inside an approved writable root with an independent byte-count, format, and SHA-256 integrity check before write.
- Explicit `artifact.export-narration`, `ui.wait-events`, and `session.launch-visible` permissions. Agent-first and recovery launch URLs are withheld without the visible-launch grant.
- Structured document, recovery, exact-kernel, render, and artifact completion events; event payloads never contain transferred bytes or UI-control data.
- Human document edits invalidate detached/visible previews, refuse stale commits with `REVISION_CONFLICT`, and remain visible through structured history before rebind/re-preview.
- Reload recovery refreshes capability, document, UI, exact evidence, and event state while every pre-reload preview becomes non-committable.
- Disconnect followed by a read-only reconnect proves final-state inspection without edit authority; expiry and revocation remain typed terminal states.
- Full-duplex loopback settlement so Studio approval, pause, responses, and lifecycle changes cannot sit behind a pending host long poll.
- Accessibility coverage for named/described/focused connection and preview approvals plus the polite accessible narration surface.
- Canonical skill `0.6.0` documents exact preview-scoped inspection, trusted
  presentation templates, the editable-turbofan recording sequence, artifact
  scope, narration export, recovery refresh, visible-launch authority, and
  bounded targeted capability discovery for normal agents.
- Studio-owned trusted narration covers capability, evidence, conflict, and attention templates. It never accepts arbitrary agent subtitle text, and its dialog-aware placement stays legible beside normal command UI.

## I4 local automated evidence

- `npm run studio:v6:i4:contract` — 7/7 passed.
- `npm run studio:v6:observer` — 41/41 passed against the exact browser worker.
- `npm run studio:agent:mcp` — 36/36 passed.
- `npm run studio:v6:host-conformance` — 9/9 passed, including an approved-root selected-body PNG written by a second MCP host.
- `npm run studio:v6:package:check` — 8/8 passed.
- `npm run studio:v6:forbidden` — 4/4 passed.
- `npm run studio:v6:acceptance` — default non-recording ten-step gate.
- `npm run studio:v6:acceptance:recording` — explicit opt-in recording replay.
- `quick_validate.py engine/skills/bomwiki-cad` — passed.
- Compatibility: `studio:agent:core` 50/50, `studio:agent:headless` 11/11, `studio:agent:parity` 28/28, and `studio:check` 282/282 passed.

The local acceptance runner loads the canonical skill through MCP, uses the
host-neutral CAD tools for every agent operation, captures structured evidence
for the separately labelled human approvals/edit, exports selected CAD and
narration artifacts, and writes a SHA-bound evidence manifest. The default
runner does not capture video. The optional recording observer records only; it
does not perform agent CAD/UI work.

## Deferred or awaiting production verification

- The corrected local literal full production-UI parity gate is complete: all 260 top-level controls and all 263 typed command fields are accounted for, with 248 top-level controls semantically available, 12 explicitly contextual, and 0 missing or orphaned. Native browser fullscreen remains contextual because the browser requires transient human activation; inactive Sketch workspace entry and explicit connection, session, approval, and help-to-connect controls likewise remain visibly human-, state-, or browser-authority-gated by design.
- External publication of the installable package is explicitly deferred by
  the product owner. The reviewed engine already ships the same bridge,
  canonical skill, and MCP resources; npm is an optional third-party
  distribution channel and is not a V6 production gate.
- Production still needs the normal Codex-host smoke, host-neutral production
  conformance repeat, and live route/asset verification against the deployed
  exact SHA.
- The canonical robot-joint and editable-turbofan recordings contain
  Studio-owned action/evidence narration only, with no prompt or
  private-reasoning subtitles. The product owner explicitly authorized
  production promotion on 2026-07-24.
- The reviewed commit has not yet been merged or deployed, so the production V6
  release claim remains pending until the CI-only deployment and live checks
  pass.
