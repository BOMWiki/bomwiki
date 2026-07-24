# BOMwiki CAD Studio — agentic UI, interoperable agent operation, and skills specification

Status: production promotion approved after V6 I0-I4, literal full
production-UI parity, both acceptance recordings, and the exact-head protected
CI pass; external registry publication is an optional follow-on and production
host verification remains pending until deployment

Target release: CAD Studio V6 — Agent-Native CAD

Baseline:

- production CAD Studio V5 at `wiki/engine@ab532c6df9d361617ee41b83bf246f4243841f4c`;
- `CAD_STUDIO_AGENT_OPERABILITY_SPEC.md`;
- `CAD_STUDIO_AGENT_STATUS.md`;
- protocol `bomwiki.cad.agent/v1`;
- existing shared command service, headless adapter, MCP stdio server, and consented live-Studio loopback bridge.

Versioned additive profile: `bomwiki.cad.agentic-ui/v1`

Primary product proof:

> A supported MCP-capable agent loads the versioned BOMwiki CAD skill, connects to production Studio with one visible user approval, and completes a real editable mechanical-design workflow through structured CAD and direct semantic UI calls. The agent inspects, selects, models, assembles, validates, handles a human revision conflict, saves, exports, and leaves the visible application ready for continued human use without Computer Use, browser automation, DOM access, CSS selectors, pointer coordinates, keyboard events, or private project mutation.

Secondary presentation proof:

> The same direct UI calls can run in recording mode so workspaces change, panels open, tree nodes expand, entities select, the camera moves, fields populate, previews appear, and commits land in a clean visible sequence suitable for an uncut demonstration.

## 1. Product decision

BOMwiki CAD should be a first-class tool that software agents can actually operate, not merely a CAD file format that an offline script can modify.

The existing V5 agent layer proves structured document operations. This specification adds the missing interactive product layer:

1. a supported agent can discover and connect to the real visible Studio;
2. the agent can inspect both canonical CAD state and user-visible Studio state;
3. the agent can control selection, model-tree focus, workspace, panels, camera, display, section, explode, and preview presentation semantically;
4. the agent can invoke normal CAD commands and show their inputs and previews in the ordinary Studio UI;
5. humans can see, interrupt, approve, edit, undo, and resume the same session;
6. the agent never drives pixels or reads the page DOM;
7. a versioned skill teaches any compatible agent the correct workflow without granting private capabilities.

The browser remains the visible CAD client. It is not the automation API.

The direct UI API must produce the normal visible Studio states. It is not a hidden control plane whose only visible effect is a finished model.

## 2. What “including the UI” means

The requirement is not satisfied merely because an agent commit eventually causes the canvas to redraw.

An agent has interactive UI parity only when it can, through versioned structured tools:

- identify the active project, document, workspace, panel, tool, selection, view, and pending preview;
- activate a part or assembly document;
- activate a released workspace or command by stable semantic ID;
- select, add, remove, and clear stable entity or subshape references;
- reveal an entity in the model tree and control relevant tree expansion;
- frame the model or selected entities;
- apply standard or explicit cameras and display modes;
- activate saved section and exploded views;
- open the normal inspector or operation panel for a known semantic target;
- present an agent transaction in the normal preview UI;
- expose the exact input values, affected entities, validation state, and change summary;
- observe UI and document changes produced by the human;
- wait for rebuild, solve, render, approval, conflict, save, and export events;
- leave the visible Studio in a coherent, ordinary human-operable state.

Interactive UI parity does **not** mean pretending to be a mouse. It does not require button-by-button imitation when a semantic command is available.

It does mean that user-meaningful interface transitions happen visibly:

- activating Assembly opens the Assembly ribbon/workspace;
- revealing a component expands the required model-tree path;
- selecting a shaft highlights it in the tree, canvas, and inspector;
- starting Mate opens the normal Mate panel;
- setting a diameter or distance visibly updates the normal field;
- requesting preview visibly shows preview geometry and validation;
- applying a commit visibly updates the tree, history, canvas, and status;
- changing view animates or cuts the real camera according to the selected presentation mode.

A person recording the screen should see a clean CAD workflow that feels directly operated. The difference is that Studio receives stable semantic actions instead of mouse and keyboard input.

## 3. Current baseline and exact gap

V5 already provides:

- typed capability discovery;
- structured project, tree, entity, dependency, geometry, and history inspection;
- detached preview and revision-bound atomic commit;
- shared UI/direct/headless/MCP document behavior;
- exact browser-kernel preflight for live sessions;
- loopback-only, permission-scoped, visible pairing;
- pause, revoke, undo/redo, project export, STEP, and STL boundaries;
- agent-created features and components in normal human-editable history.

V5 does not yet provide a supported external contract for:

- Studio UI capability discovery;
- active workspace, active tool, active panel, selection, tree, camera, and viewport state;
- semantic UI actions;
- a structured UI event stream;
- normal operation-panel draft state controlled by an agent;
- guaranteed visible preview presentation;
- render completion tied to a UI-state revision;
- host-neutral installation/discovery, versioned agent skills, and real agent-host acceptance tests;
- pairing without copying a loopback URL into a Studio form.

Those are the scope of this specification. Existing document operations remain governed by `bomwiki.cad.agent/v1`.

## 4. User and job

Primary user:

- a person working with a compatible software agent and CAD Studio side by side on a desktop;
- the person wants to describe mechanical work conversationally, watch or inspect the result in Studio, intervene at any time, and continue without translating every change into manual clicks.

Primary job:

> Let an agent inspect, construct, revise, assemble, and verify a real editable CAD project while the human retains a visible, trustworthy, interruptible Studio session.

Representative workflows:

- “Open this pump assembly, isolate the impeller, measure the shaft clearance, and show me the section.”
- “Increase the bearing spacing to 42 mm, preview the dependent changes, then apply it.”
- “Create a concentric mate between this shaft and the selected bearing.”
- “Switch to the assembly workspace, frame the gearbox, explode it, and export the selected housing.”
- “I changed the bracket manually. Reinspect it and continue with the motor mount.”
- “Record a clean demo of creating this mate, opening the section, changing the parameter, and exporting the result.”

## 5. Product principles

1. **Semantic, not visual automation.** Stable entity, command, field, panel, workspace, and view IDs replace pixels, selectors, and labels.
2. **One document truth.** UI and agent mutations use `CadCommandService`; no UI-only or agent-only geometry path exists.
3. **Two revisions.** Canonical document changes and ephemeral UI changes have independent monotonic revisions.
4. **Visible work.** Agent selection, preview, progress, commit, conflict, and errors are visible in Studio.
5. **Human control.** Connection, permissions, pacing, preview approval, pause, revoke, save, and export remain user-controlled.
6. **No silent guesses.** Missing or ambiguous entity, subshape, command, or field references fail with typed repair choices.
7. **Capability truth.** Agents act only on advertised document and UI capabilities.
8. **Normal CAD output.** Agent work remains editable, inspectable, undoable, recoverable, and exportable.
9. **Useful without screenshots.** Every required decision can be made from structured state and exact CAD evidence.
10. **Optional visual review.** A model render may supplement structured evidence but cannot be required to locate or operate UI controls.
11. **Recordable choreography.** Direct UI actions create deliberate visible transitions and completion events, so an agent can run a polished demo without cursor movement or fixed sleeps.
12. **Agent portability.** MCP defines the callable interface and a versioned skill bundle teaches correct use without relying on one model vendor or agent host.

## 6. Release boundary

### 6.1 Required

- an installable host-neutral BOMwiki CAD MCP integration;
- a versioned BOMwiki CAD skill bundle available both as installable files and MCP resources;
- one-click or one-link connection to a visible production Studio;
- explicit in-Studio approval before project data is shared;
- no copy/paste pairing ceremony in the final product flow;
- structured UI capability manifest;
- structured UI snapshot and incremental event stream;
- semantic UI actions with expected-UI-revision control;
- semantic command-draft and visible-preview presentation;
- visible action choreography with instant, normal, and recording presentation modes;
- document and UI adapter parity;
- normal preview/commit, undo/redo, persistence, recovery, render, and export behavior;
- a deterministic no-Computer-Use conformance client;
- a real Codex-host production smoke plus a host-neutral MCP conformance run with auditable tool transcripts;
- an observer-only browser test proving the visible UI reflects structured agent calls.

### 6.2 Explicitly not required

- a hosted autonomous CAD service;
- an embedded LLM inside Studio;
- arbitrary browser control;
- DOM, accessibility-tree, CSS, XPath, screenshot, pointer, or keyboard APIs exposed to the CAD agent;
- general webpage navigation;
- natural-language execution inside the geometry kernel;
- background editing of unapproved browser tabs or projects;
- collaborative multiplayer editing;
- engineering simulation, manufacturing approval, or design certification;
- reproducing hover states, cursor travel, missed clicks, or human input latency.

## 7. Architecture

```text
Compatible agent host
(Codex first; any conforming MCP client)
  │
  │ versioned skill + MCP structured CAD/UI tools
  ▼
BOMwiki CAD local integration
  │
  │ authenticated loopback messages
  ▼
Visible CAD Studio session
  ├── CadStudioSessionService ── UI state and events
  ├── CadCommandService ──────── canonical preview/commit/history
  ├── kernel worker ──────────── exact geometry/solve/export
  └── normal tree/inspector/canvas/operation panels
```

Required ownership:

- `CadCommandService` owns persistent project mutation;
- `CadStudioSessionService` owns ephemeral Studio interaction state;
- the renderer observes canonical project state plus Studio view state;
- the MCP adapter forwards typed requests and never reads the page;
- the Studio bridge validates session, scope, project, document revision, and UI revision;
- no transport may invoke private UI functions or mutate DOM state directly.

## 8. Agent integration and skill contract

### 8.1 Host-neutral integration

The deliverable includes a supported MCP integration containing:

- the stable tools in §16;
- standard MCP initialization, tool discovery, annotations, resources, and version reporting;
- local process startup and shutdown;
- explicit filesystem roots for headless projects and exports;
- local visible-Studio connection support;
- compatibility reporting for protocol, UI profile, Studio, kernel, and skills;
- no dependency on Codex-only tool names, approvals, conversation state, or browser surfaces.

Codex is the first real agent host used for product acceptance. It receives no private tool or behavior unavailable to another conforming MCP client.

The integration must not grant an agent:

- shell execution through CAD;
- arbitrary network requests;
- browser cookies or storage;
- unrelated file access;
- arbitrary JavaScript evaluation;
- generic browser or desktop control.

The integration is unavailable when it is merely checked into the repository but cannot be installed and called from a normal supported agent session.

### 8.2 Required skill bundle

The integration ships with a versioned `bomwiki-cad` skill. A tool list alone is insufficient because agents also need the correct operating discipline.

The canonical skill package contains:

```text
skills/bomwiki-cad/
  SKILL.md
  references/
    sessions-and-permissions.md
    semantic-ui.md
    part-modeling.md
    assemblies-and-mates.md
    inspection-and-artifacts.md
    conflicts-and-recovery.md
    presentation-and-recording.md
```

`SKILL.md` must teach the agent to:

1. call capability discovery before planning;
2. load only the relevant reference for the current job;
3. connect to the intended project and confirm scopes;
4. inspect document and UI revisions before acting;
5. use stable entity/subshape references rather than names or positions alone;
6. use direct semantic UI calls for visible Studio operation;
7. use `cad_preview` before every persistent commit;
8. verify exact geometry, solve state, diagnostics, and unchanged assertions;
9. wait on structured events rather than guessing from time;
10. recover from stale revisions, invalid references, kernel failures, reloads, and user intervention;
11. keep normal-use, recording, and headless workflows distinct;
12. save or export only with explicit permission;
13. leave a concise human-readable handoff with revision, changes, evidence, and limitations.

The skill must not:

- hardcode a toolbar position, label, entity ID, or capability that can be discovered;
- tell the agent to use Computer Use, browser automation, DOM inspection, coordinates, or screenshots for control;
- hide validation failures or retry destructive operations blindly;
- grant permissions or tools;
- encode a private geometry shortcut;
- treat a recording script as the normal operating workflow.

### 8.3 Skill distribution

The same canonical content is exposed through:

- installable Agent Skills-compatible files for hosts that support skills;
- MCP resources such as `bomwiki-cad://skills/core` and the reference resources above;
- a versioned package artifact with checksums;
- human documentation generated from the same source.

Agents without native skill installation can read the MCP resource before work. Host-specific wrappers may add installation metadata but cannot change the normative operating rules.

Production Studio ships the canonical skill resources and local bridge as part
of the reviewed engine release. Publishing the same host-neutral bundle to an
external registry such as npm is an optional distribution channel for
third-party hosts, not a prerequisite for the Studio V6 production release.

### 8.4 Skill compatibility and truth

The capability response includes:

```ts
type CadSkillCompatibility = {
  skillId: 'bomwiki-cad';
  skillVersion: string;
  documentProtocolRange: string;
  uiProfileRange: string;
  studioVersionRange: string;
  resourceUris: string[];
  packageSha256: string;
};
```

Rules:

- the skill queries capabilities at runtime instead of assuming them;
- an incompatible skill produces `SKILL_VERSION_UNSUPPORTED` before mutation;
- protocol behavior remains authoritative when prose and the manifest disagree;
- skill updates require scenario tests and checksums;
- the agent reports the skill version in its session handshake and audit trail;
- no product capability is considered agent-ready until its skill guidance and examples are updated.

### 8.5 Skill conformance

Skill tests use natural-language task fixtures but deterministic expected tool invariants:

- the agent discovers capabilities first;
- it selects the intended project and semantic targets;
- it never invokes forbidden control surfaces;
- it previews before commit;
- it handles stale revisions explicitly;
- it verifies results and leaves the project usable;
- recording mode is used only when requested.

Exact geometry and document results remain deterministic release gates. The skill test evaluates tool choice and safety invariants, not hidden reasoning or prose style.

## 9. Connection experience

### 9.1 Preferred Studio-first flow

1. The user opens `https://bomwiki.com/cad/studio`.
2. The agent host starts the local BOMwiki CAD integration and creates a pending session.
3. The user chooses **Connect agent** in Studio.
4. Studio opens or contacts the fixed local bridge and receives the agent host, client label, skill version, requested project, scopes, mode, expiry, and budgets.
5. Studio displays the request before sharing project data.
6. The user approves once.
7. The agent receives the project ID, document revision, UI revision, capability hashes, skill compatibility, and current session state.

There is no URL copy/paste.

### 9.2 Agent-first flow

When Studio is not open, `cad_session connect` may return a safe production launch URL. Opening it shows Studio and the pending approval. The URL fragment may carry a short-lived pairing nonce but must not expose project data, credentials, or a reusable token to the remote server.

The integration may offer `launchVisible: true` only when the user’s request authorizes opening Studio. Opening a page is not permission to edit a project.

### 9.3 Connection rules

- loopback transport only for V1;
- one active write-capable agent per project;
- read-only observers may be supported later;
- session token is memory-only and bound to origin, client, project, scopes, and expiry;
- reload may resume only through a short recovery handshake approved by policy;
- replacing the project requires explicit `project.replace`, clears stale project-owned drafts/previews/selections, and atomically narrows the existing session scope to the returned project ID without expanding its granted permission kinds;
- pause blocks new work and cancels cancellable pending work;
- revoke invalidates the session immediately;
- closing either side closes or expires the bridge cleanly.

## 10. UI capability manifest

The agent starts interactive work with `cad_ui` action `capabilities`.

```ts
type CadUiCapabilityManifest = {
  profile: 'bomwiki.cad.agentic-ui/v1';
  studioVersion: string;
  documentProtocol: 'bomwiki.cad.agent/v1';
  workspaces: UiCapability[];
  commands: UiCommandCapability[];
  panels: UiCapability[];
  selectionKinds: EntityRef['kind'][];
  subshapeSelection: Array<'face' | 'edge' | 'vertex'>;
  views: UiCapability[];
  displayModes: UiCapability[];
  actions: UiActionCapability[];
  events: string[];
  eventCapabilities: Array<{
    id: string;
    state: 'available' | 'disabled';
    disabledReasonCode?: string;
  }>;
  presentationModes: Array<'instant' | 'normal' | 'recording'>;
  narrationModes: Array<'off' | 'concise' | 'detailed' | 'recording'>;
  presentationStates: Array<'idle' | 'transitioning' | 'holding' | 'waiting'>;
  transitionCapabilities: UiTransitionCapability[];
  limits: CadUiLimits;
  manifestHash: string;
};
```

Rules:

- stable IDs, schemas, and state are authoritative;
- labels and ribbon position are descriptive only;
- disabled commands include a stable reason code;
- a command cannot be advertised unless the normal UI and document transaction builder support it;
- manifest changes require a versioned compatibility decision and conformance updates.

Capability discovery is layered so complete control does not flood an agent's
working context:

- `cad_capabilities` defaults to a complete compact ID/state summary;
- `cad_capabilities` with `detail: "schemas"` returns full schemas only for
  the requested `operationKinds` and `queryKinds`, in batches of at most 20;
- `cad_ui` capabilities defaults to full command/action identity, field IDs,
  parity counts, and high-level UI state without the 260-control payload;
- `cad_ui` `catalog` is used only to discover an unknown human control;
- `cad_ui` `schemas` returns only requested control, command, and action
  definitions, in batches of at most 20;
- `full` remains available for protected audits and produces the same
  authoritative manifest identity.

Unknown IDs, unknown discovery fields, oversized batches, and schema requests
without a target fail closed. A connection handshake also carries only compact
document capability state; it never silently re-embeds the full schema catalog.

## 11. UI state model

```ts
type CadUiSnapshot = {
  profile: 'bomwiki.cad.agentic-ui/v1';
  projectId: string;
  documentRevision: number;
  uiRevision: number;
  activeDocument: EntityRef;
  workspaceId: string;
  activeCommand?: {
    commandId: string;
    state: 'draft' | 'validating' | 'preview' | 'blocked';
    inputValues: Record<string, unknown>;
    boundSelections: Record<string, Array<EntityRef | SubshapeRef>>;
    diagnostics: CadDiagnostic[];
  };
  selection: Array<EntityRef | SubshapeRef>;
  tree: {
    revealed?: EntityRef;
    expanded: EntityRef[];
  };
  panels: Array<{ panelId: string; open: boolean; target?: EntityRef }>;
  viewport: {
    viewId?: string;
    camera: CadCameraState;
    displayMode: string;
    framedEntities: EntityRef[];
    activeSectionId?: string;
    activeExplodedViewId?: string;
    renderState: 'idle' | 'rebuilding' | 'rendering' | 'failed';
    renderedDocumentRevision: number;
    renderedKernelRevision: number;
    renderedUiRevision: number;
  };
  preview?: {
    previewId: string;
    baseRevision: number;
    visible: boolean;
    highlightedEntities: EntityRef[];
    validation: ValidationSummary;
  };
  presentation: {
    mode: 'instant' | 'normal' | 'recording';
    state: 'idle' | 'transitioning' | 'holding' | 'waiting';
    activeActionId?: string;
    activeActionLabel?: string;
  };
  narration: {
    mode: 'off' | 'concise' | 'detailed' | 'recording';
  };
  connection: {
    clientLabel: string;
    mode: string;
    paused: boolean;
  };
};
```

UI snapshots are bounded and do not contain:

- HTML;
- DOM nodes;
- CSS selectors;
- pixel positions;
- arbitrary page text;
- cookies, storage, or unrelated browser state.

## 12. UI actions

UI mutations are atomic batches with `expectedUiRevision`. Persistent changes still require document preview and commit.

Required action families:

### 12.1 Documents and workspaces

- `document.activate`
- `workspace.activate`

### 12.2 Selection and tree

- `selection.set`
- `selection.add`
- `selection.remove`
- `selection.clear`
- `tree.reveal`
- `tree.expand`
- `tree.collapse`

Selections use stable entity or subshape references. “Click the third body” is invalid.

### 12.3 Viewport

- `viewport.fitAll`
- `viewport.fitSelection`
- `viewport.standardView`
- `viewport.setCamera`
- `viewport.setDisplayMode`
- `viewport.activateSection`
- `viewport.activateExplodedView`
- `viewport.clearInspectionView`

Explicit camera input uses bounded position/target/up or quaternion/projection data. It never uses drag distance or screen coordinates.

### 12.4 Panels

- `panel.open`
- `panel.close`
- `inspector.showEntity`
- `history.showRevision`
- `diagnostics.show`

### 12.5 Normal command draft

- `command.open`
- `command.bindSelection`
- `command.setInput`
- `command.clearInput`
- `command.preview`
- `command.cancel`

Command and field IDs come from the UI manifest. `command.preview` converts the visible draft into the same typed `CadTransaction` accepted by `cad_preview`. The returned preview must match a direct transaction preview by canonical document hash and exact evidence.

### 12.6 Preview presentation

- `preview.present`
- `preview.dismiss`

`preview.present` shows the standard operation/agent preview surface, semantic change summary, diagnostics, affected tree rows, and canvas highlights. It cannot commit.

### 12.7 Direct visible choreography

- `presentation.setMode`
- `presentation.focusAction`
- `presentation.waitForSettled`

Every semantic UI action supports presentation metadata:

```ts
type CadUiPresentation = {
  mode?: 'instant' | 'normal' | 'recording';
  transition?: 'cut' | 'animate';
  minimumVisibleMs?: number;
  statusText?: string;
};
```

Rules:

- `instant` changes UI state on the next render and is intended for tests or fast batch work;
- `normal` uses the ordinary Studio transition behavior without artificial mouse latency;
- `recording` guarantees that each meaningful state becomes visibly settled before the next action begins;
- recording-mode pacing is implemented by Studio, not by the agent issuing blind sleep calls;
- `minimumVisibleMs` is bounded by the capability manifest and cannot stall a session indefinitely;
- field population may be immediate or use a short value transition, but it never synthesizes keystrokes;
- camera motion uses the normal camera controller with semantic start/end states, not drag paths;
- opening a panel, changing a ribbon, revealing a tree item, presenting a preview, and completing a commit each emit a settled event;
- persistent CAD work remains governed by preview/commit regardless of presentation mode;
- presentation metadata cannot change geometry, validation, permissions, or the canonical transaction.

The goal is a crisp, legible demonstration. The agent should not simulate cursor wandering, typing mistakes, hover exploration, or retries for dramatic effect.

### 12.8 Agent narration and subtitle track

Studio may show movie-style subtitles along the lower edge of the modeling viewport. These are an **observable action narration track**, not private model reasoning.

```ts
type CadNarrationCue = {
  cueId: string;
  correlationId: string;
  kind: 'intent' | 'action' | 'evidence' | 'warning' | 'attention';
  text: string;
  source:
    | 'capability-template'
    | 'presentation-template'
    | 'evidence-template'
    | 'attention-template';
  entityRefs?: Array<EntityRef | SubshapeRef>;
  documentRevision: number;
  uiRevision: number;
  state: 'queued' | 'visible' | 'completed' | 'cancelled';
};
```

Examples:

- `Inspecting the shaft and bearing references`
- `Previewing a concentric mate`
- `Exact solve passed — 0 remaining degrees of freedom`
- `Bearing spacing changed by you — refreshing the preview`
- `Waiting for approval to replace the component`

Rules:

- cues describe what the agent is doing, what structured evidence was returned, or what attention is required;
- cues never expose hidden chain-of-thought, internal reasoning tokens, raw prompts, credentials, private paths, or unrelated context;
- completion language such as `passed`, `saved`, `exported`, or `rendered` is emitted only from confirmed application events;
- capability definitions provide deterministic narration templates for normal action and evidence states;
- the agent may request only an advertised Studio-owned presentation template
  with bounded typed substitution values; it cannot inject arbitrary subtitle
  text or override evidence-derived outcome text;
- narration mode is `off`, `concise`, `detailed`, or `recording`;
- normal mode defaults to concise, recording mode defaults to detailed, and the user can change or hide it;
- subtitles avoid critical geometry and controls, support responsive placement, high contrast, text scaling, reduced motion, and an accessible live-region equivalent;
- cues are correlated with the action trace and may be exported as WebVTT or SRT when artifact permission permits;
- exported subtitle tracks contain only visible cues, never hidden prompts or reasoning;
- narration does not delay CAD execution unless recording presentation explicitly requests a bounded hold.

The released narration control action is `narration.setMode`. It changes only
the observable cue surface and never authorizes CAD mutation.

The live `cad_ui` tool also supports `action: 'narrate'` for an ID in the
advertised `trustedNarrationTemplates` catalog. It requires
`ui.present-narration` and the current `expectedUiRevision`. The template,
wording, permitted numeric values, redaction policy, and cue lifecycle remain
owned by Studio.

## 13. Document mutation flow

Two equivalent flows are supported.

### 13.1 Document-first flow

1. The agent inspects document and UI state.
2. The agent calls `cad_preview` with a typed transaction and `presentation: 'visible'`.
3. Studio shows the normal preview and returns its UI revision.
4. The agent inspects validation and exact evidence.
5. The agent calls `cad_commit` when permitted.
6. Studio commits one normal undoable command and emits document/UI events.

### 13.2 Visible-command flow

1. The agent opens an advertised command with `cad_ui`.
2. The agent binds stable selections and typed input values.
3. Studio shows the same normal command panel a human would inspect.
4. The agent requests `command.preview`.
5. The normal `cad_preview` contract runs.
6. Commit still occurs only through `cad_commit`.

The two flows must produce identical canonical document, identities, exact geometry evidence, and history semantics.

No `cad_ui` action may directly persist geometry.

### 13.3 Preview-scoped exact inspection

An agent may bind `cad_query` to an unexpired `previewId` and its
`expectedRevision`. Studio evaluates health, clearance, or interference against
the exact candidate project held by that preview, without mutating the
committed document.

- the query fails if either preview binding field is missing, stale, expired,
  or revision-conflicted;
- stable entity scope resolves against the preview body inventory;
- the result returns the preview ID, base revision, candidate document hash,
  exact-kernel evidence, and `previewScoped: true`;
- `presentation: 'visible'` emits the normal trusted evidence cue;
- `presentation: 'silent'` is allowed only to suppress duplicate narration
  during bounded computational refinement; it never suppresses structured
  kernel events or changes permissions;
- the final converged result is repeated visibly before commit in a recorded
  workflow;
- commit still accepts only the exact preview ID and revision that were
  inspected.

## 14. Events and waiting

The agent must not infer completion from elapsed time.

`cad_events` returns or waits for structured events after a session cursor:

- `session.connected`
- `session.paused`
- `session.resumed`
- `session.revoked`
- `document.changed`
- `document.recovered`
- `ui.changed`
- `selection.changed`
- `command.draftChanged`
- `preview.started`
- `preview.ready`
- `preview.rejected`
- `commit.applied`
- `history.changed`
- `kernel.progress`
- `kernel.completed`
- `kernel.failed`
- `assembly.solveChanged`
- `render.completed`
- `artifact.completed`
- `human.attentionRequired`
- `presentation.stepStarted`
- `presentation.stepSettled`
- `narration.cueStarted`
- `narration.cueCompleted`

Each event includes:

- monotonically ordered cursor;
- project ID;
- document and UI revisions;
- actor;
- stable affected entities;
- bounded payload;
- correlation ID;
- timestamp.

The event buffer is bounded. If a cursor expires, the client receives `EVENT_CURSOR_EXPIRED` and refreshes full state.

## 15. Visual and render evidence

The agent operates without screenshots, but it may inspect CAD output.

Required evidence:

- structured viewport state;
- rendered document/UI revisions;
- visible body/occurrence counts;
- camera and active inspection-view state;
- exact body/assembly evidence;
- optional model-only PNG render through `cad_artifact`;
- render checksum and scene manifest.

A model render is a CAD artifact, not a browser screenshot. It may be used to review the design but cannot be the only proof that selection, command state, permissions, or commit behavior is correct.

The production agent adapter never receives browser chrome screenshots.

## 16. MCP tool surface

The existing tools remain:

- `cad_capabilities`
- `cad_session`
- `cad_inspect`
- `cad_query`
- `cad_preview`
- `cad_commit`
- `cad_history`
- `cad_artifact`

This profile adds:

### `cad_ui`

Read or atomically change semantic Studio interaction state.

Required actions:

- `capabilities`
- `snapshot`
- `apply`
- `narrate`

`apply` accepts an expected UI revision and an atomic list of advertised UI actions.

### `cad_events`

Read or wait for structured session, document, UI, kernel, render, and artifact events.

Required inputs:

- `sessionId`
- optional `afterCursor`
- optional event-kind filter
- bounded `waitMs`

It is read-only and does not keep an unbounded server-side subscription.

## 17. Permissions

Existing document and artifact permissions remain. This profile adds:

```ts
type CadUiPermission =
  | 'ui.read'
  | 'ui.select'
  | 'ui.navigate'
  | 'ui.command-draft'
  | 'ui.present-preview'
  | 'ui.present-demo'
  | 'ui.present-narration'
  | 'ui.wait-events'
  | 'session.launch-visible';
```

Rules:

- `ui.read` does not imply project read;
- project read does not imply UI control;
- UI navigation does not imply document edit;
- command draft does not imply preview or commit;
- preview presentation does not imply commit;
- view-only UI actions may be session-scoped and non-persistent;
- saved visibility, section, explode, or view changes use normal document commands when persistence is requested;
- external link navigation is never a CAD UI permission;
- file dialogs are never driven through UI tools;
- export remains an artifact permission.

## 18. Concurrency, recovery, and pacing

### 18.1 Revisions

- persistent operations require `expectedRevision`;
- UI batches require `expectedUiRevision`;
- an action that depends on both includes both;
- document commit increments document revision and produces at least one UI revision;
- human selection or camera changes increment only UI revision;
- stale UI actions fail with `UI_REVISION_CONFLICT`;
- no action silently rebases.

### 18.2 Recovery

- reload restores canonical project state through normal persistence;
- agent session recovery requires the original still-valid local integration and policy;
- stale previews are never restored as committable;
- the agent refreshes capabilities, project summary, UI snapshot, and events after reconnect;
- last valid geometry remains visible after cancellable or failed work.

### 18.3 Pacing

The session exposes:

- `instant` — permitted ephemeral UI state changes apply on the next render;
- `normal` — normal Studio transitions are visible without mouse or typing delay;
- `recording` — Studio holds and settles meaningful UI states long enough for a legible recording and pauses at defined preview or review milestones.

The agent waits on structured settled or milestone events rather than fixed sleeps. Pacing changes presentation only. It never changes validation, permissions, or commit semantics.

## 19. Safety and forbidden interfaces

The production agent/CAD runtime must not import or expose:

- Computer Use;
- Playwright, Puppeteer, Selenium, WebDriver, AppleScript, or desktop automation;
- DOM or accessibility-tree querying;
- CSS selectors or XPath;
- screenshots for UI targeting;
- pointer coordinates, wheel deltas, drag paths, or keyboard events;
- arbitrary browser evaluation;
- direct project JSON mutation;
- direct kernel constructors that bypass released commands.

Browser automation is allowed only in the observer test harness. Observer tests may assert that structured calls caused the expected visible UI, but they may not perform the agent’s CAD actions.

A forbidden-interface audit is a release gate.

## 20. Diagnostics

Required profile-specific codes include:

- `UI_PROFILE_UNSUPPORTED`
- `UI_CAPABILITY_DISABLED`
- `UI_REVISION_CONFLICT`
- `ACTIVE_DOCUMENT_CHANGED`
- `SELECTION_KIND_UNSUPPORTED`
- `SELECTION_AMBIGUOUS`
- `COMMAND_NOT_ADVERTISED`
- `COMMAND_FIELD_UNKNOWN`
- `COMMAND_INPUT_INVALID`
- `COMMAND_SELECTION_INCOMPLETE`
- `PREVIEW_NOT_PRESENTED`
- `VIEW_NOT_AVAILABLE`
- `EVENT_CURSOR_EXPIRED`
- `UI_SNAPSHOT_TOO_LARGE`
- `EVENT_PAYLOAD_TOO_LARGE`
- `RENDER_SETTLEMENT_TIMEOUT`
- `PAIRING_NOT_AVAILABLE`
- `PAIRING_APPROVAL_REQUIRED`
- `SESSION_NOT_VISIBLE`
- `USER_REJECTED_PREVIEW`
- `SESSION_PAUSED`
- `SESSION_REVOKED`

Diagnostics include stable repair options such as refresh UI state, reveal entity, request a permitted scope, rebind a selection, reopen a command, regenerate preview, or reconnect.

## 21. Performance budgets

After Studio and the kernel are ready:

- UI capability manifest: p95 under `100 ms`;
- UI snapshot: p95 under `100 ms`;
- selection/tree/panel action acknowledgement: p95 under `100 ms`;
- standard view or fit acknowledgement: p95 under `150 ms`;
- event delivery after local UI/document change: p95 under `100 ms`;
- preview presentation after preview completion: p95 under `150 ms`;
- presentation-settled event: within the advertised transition plus hold duration and `100 ms`;
- MCP plus loopback overhead excluding CAD/rebuild/render work: p95 under `35 ms`;
- UI event buffer: at least `1,000` events or `10 minutes`, whichever is smaller;
- `cad_events` wait: maximum `30 seconds` per call;
- UI action batch: maximum `50` actions;
- UI snapshot: maximum `512 KiB`.

## 22. Test architecture

### 22.1 Protocol tests

- profile negotiation;
- manifest schema and stable IDs;
- UI snapshot serialization;
- every UI action and event union member;
- size, count, depth, and timeout limits;
- unknown or disabled IDs fail closed.

### 22.2 Skill tests

- skill package structure, metadata, checksums, and resource URIs;
- protocol/UI-profile compatibility and explicit incompatibility refusal;
- capability discovery before task planning;
- stable-reference selection instead of name/position guessing;
- preview-before-commit and exact-result verification;
- revision-conflict, reference-repair, cancellation, and reconnect workflows;
- normal-use guidance remains primary and recording guidance is loaded only when requested;
- installable skill files and MCP resources contain the same canonical version;
- Codex and the host-neutral client receive equivalent normative guidance.

### 22.3 UI-state tests

- active document/workspace/panel/command;
- selection and subshape ownership;
- tree reveal/expand/collapse;
- camera, fit, display, section, and explode;
- preview presentation;
- recording-mode workspace, panel, tree, selection, field, camera, preview, and commit transitions;
- narration truth, lifecycle, placement, accessibility, and redaction;
- independent document/UI revisions;
- render revision synchronization.

### 22.4 Command parity tests

For every released visible command:

1. build the transaction through the normal human UI adapter;
2. build it through `command.open`/`command.setInput`;
3. submit the equivalent direct `cad_preview`;
4. compare canonical document hash, exact evidence, diagnostics, identities, and visible preview summary.

### 22.5 Observer-only browser tests

The test client performs all CAD and UI actions through MCP.

A separate browser observer may read visible state to assert:

- the requested workspace is active;
- the semantic selection is highlighted;
- the correct tree entity is revealed;
- the normal operation panel shows the requested values;
- preview, progress, conflict, and commit are visible;
- camera/section/explode state matches the structured snapshot;
- recording-mode actions become visibly settled in the specified order;
- subtitle cues match the correlated structured action/evidence events and never expose hidden reasoning;
- no page errors occur.

The browser observer cannot click, type, select, navigate, or call private Studio test functions on behalf of the agent.

### 22.6 Real agent-host interoperability

A normal Codex session is the first real host to repeat the canonical acceptance gate. A second host-neutral MCP conformance client repeats the same protocol and UI sequence without Codex-specific behavior. Evidence includes:

- agent host, client, and skill versions;
- agent tool-call transcript;
- protocol and capability hashes;
- project and UI revision log;
- project, render, and export checksums;
- visible observer evidence;
- one uncut visible-session recording captured by the observer while the agent performs the actions through CAD tools;
- exported WebVTT/SRT cue track matching the visible recording when narration is enabled;
- forbidden-interface audit.

The transcript must contain only BOMwiki CAD tools for CAD/UI operation. Shell may start the local integration in development, but cannot mutate the project or drive Studio. The observer may record the visible page but cannot perform any CAD or UI action.

## 23. Acceptance gates

### 23.1 Ten-step normal-operation gate

The canonical acceptance project is the checked-in robot-joint assembly because it exercises reusable parts, transforms, mates, selection, inspection, and export without repeating the turbofan release benchmark.

The primary pass runs in normal presentation mode from a supported agent session:

1. **Load and discover** — load the compatible `bomwiki-cad` skill, call document and UI capability manifests, record skill/manifest hashes, and verify required tools are available.
2. **Connect** — connect to production Studio with one visible user approval and no URL copy/paste.
3. **Inspect** — read project summary and UI snapshot; identify the active assembly, workspace, selection, camera, and revisions.
4. **Navigate visibly** — activate the Assembly workspace, reveal the shaft occurrence in the model tree, select it, open its inspector, and fit the selection through direct UI calls.
5. **Draft visibly** — open the component-transform or mate command through `cad_ui`, bind stable references, set typed values, and show the normal command panel.
6. **Preview exactly** — produce a visible exact preview; verify change set, valid geometry/solve evidence, highlighted entities, and unchanged assertions.
7. **Handle human change** — the human edits one related value in Studio; the agent receives events, the stale commit is refused, and the agent inspects changes since its revision.
8. **Refresh and commit** — rebind or confirm references, re-preview, commit one normal undoable command, and verify tree/history/renderer revisions.
9. **Inspect assembly** — activate a saved section or exploded view, measure a clearance, run interference/health queries, and render a model-only review artifact.
10. **Persist and resume** — save/reopen or recover, verify canonical and exact hashes, export the selected component/assembly as permitted, disconnect, reconnect read-only, and confirm the final state.

Pass conditions:

- no Computer Use or browser-control tool is invoked;
- no DOM, selector, screenshot-targeting, pointer, or keyboard data crosses the agent interface;
- all persistent edits use preview/commit and normal history;
- the human can inspect and undo the result;
- structured UI state and observer-visible UI agree;
- no unapproved project, file, or export access occurs.

### 23.2 Recording-presentation replay

After the normal-operation gate passes, the agent replays the visible portions of steps 4–9 in recording mode against a disposable copy or reset fixture.

Pass conditions:

- the same semantic UI and document operations are used;
- no recording-only geometry, fixture, command, or shortcut exists;
- Studio, not the agent, provides bounded transitions and holds;
- the agent waits on structured settled events rather than fixed sleeps;
- an uncut observer recording shows the ribbon, panels, tree, selection, camera, fields, preview, progress, and commit changing through direct UI calls;
- visible subtitles truthfully narrate actions, confirmed evidence, conflicts, and attention requests without exposing hidden reasoning;
- the observer records only and performs no CAD/UI action;
- canonical project and exact geometry results match the normal-operation run.

### 23.3 Editable turbofan construction and change gate

The complex-modeling demonstration is a second gate, not a replacement for the
robot-joint normal-operation gate. It starts with a real empty schema-5
document, replays the canonical turbofan construction log through ordinary
public preview/commit transactions, and then performs the agreed engineering
change through normal visible UI control.

1. approve one bounded visible agent session;
2. prove the empty part contains no bodies, assemblies, occurrences, or mates;
3. build layout, nacelle, core, blade families, rotating/hot-section parts,
   reusable patterns, solved assembly, materials, and inspection state through
   nine public transaction groups;
4. prove the operation-kind stream contains no import, project replacement,
   template insertion, or opaque shortcut and that the built document hash is
   byte-identical to the canonical editable turbofan;
5. show a clean full turbofan view, locate the rear compressor stator and
   combustor, and measure their current exact clearance;
6. open the normal distance-mate editor, solve its axial value with
   preview-scoped exact queries, and visibly prove 12 mm clearance plus zero
   selected-pair interference before commit;
7. prove visible-command and direct-transaction preview hashes match, then
   commit that exact preview as one reversible history entry;
8. open the longitudinal section and export only the selected compressor stage
   as an integrity-checked STEP artifact;
9. persist the native project, reload/reconnect, and prove the canonical hash
   survives recovery;
10. produce one uncut 1280 by 800 VP9 recording, matching trusted WebVTT/SRT,
    and a CAD-tool-only transcript with no Computer Use, browser control, DOM,
    selector, pointer, keyboard, screenshot, or private application call.

The automated gate may report `automated-pass-awaiting-human-visual-signoff`.
It does not authorize a V6 completion or release claim by itself.

## 24. Implementation slices after approval

This section is sequencing only. It does not authorize implementation.

### UI Slice I0 — profile and state service

- define UI manifest, snapshot, actions, events, permissions, diagnostics, and limits;
- add `CadStudioSessionService`;
- preserve current Studio behavior;
- add deterministic state/revision tests.

Gate: semantic UI state is complete and no persistent mutation exists in the UI service.

### UI Slice I1 — agent packaging, skills, and pairing

- package/install the host-neutral MCP integration and canonical skill bundle;
- expose the same skill through installable files and MCP resources;
- add fixed local bridge discovery;
- replace URL paste with Studio-first and agent-first approval flows;
- add lifecycle, pause, revoke, expiry, and reconnect tests.

Gate: Codex and a host-neutral MCP conformance client can load the skill, discover tools, and connect with one approval.

### UI Slice I2 — navigation and observation

- selection, tree, workspace, panels, inspector, camera, fit, display, section, explode;
- visible transition and recording-mode state choreography;
- UI revisions and event waiting;
- observer-only browser parity.

Gate: steps 1–4 and UI portions of step 9 pass without browser control.

### UI Slice I3 — visible command drafts and previews

- command manifest and fields;
- command draft actions;
- direct/visible transaction parity;
- visible preview, diagnostics, exact evidence, approval, and cancellation.

Gate: steps 5–8 pass with exact hash parity.

### UI Slice I4 — persistence, artifacts, recovery, and hardening

- render transfer and manifest;
- selected-entity export;
- reconnect/recovery;
- performance, accessibility, security, forbidden-interface audit;
- real Codex production smoke plus host-neutral MCP conformance.

Gate: the ten-step normal-operation gate and recording-presentation replay pass with reviewable protected evidence.

## 25. Product decisions

### 25.1 Closed by the product owner

**Meaning of “use the UI.”**

A compatible agent must issue direct semantic UI calls that visibly operate the real Studio. Workspaces, panels, tree paths, selection, inspector state, fields, previews, camera, progress, and commits must open or change on screen during normal software use. The same path may run at recording pace for an uncut demonstration. There is no manually controlled or simulated mouse.

**Full UI control is literal, not slice-relative.**

The V6 release inventory is every human-operable control in the production
Studio application, not a hand-picked set renamed “released.” One source-owned
command registry must drive both human controls and semantic capabilities.
Protected CI must fail when:

- a visible human command, context action, tree action, panel control, viewport
  control, dialog, field, picker, preview, approval, cancel action, or output
  action has no semantic adapter;
- a semantic adapter has no corresponding normal visible UI;
- an agent cannot read the same enabled, disabled, checked, selected, pending,
  error, and completion state a person sees;
- a normal field cannot be addressed by stable typed ID, populated, read back,
  validated, previewed where applicable, cancelled, and applied through the
  owning Studio controller;
- the UI and semantic paths do not converge on the same transaction and exact
  result; or
- a human-enabled production action is reported as
  `NOT_RELEASED_IN_CURRENT_SLICE`.

Context-disabled controls remain valid when the semantic catalog exposes the
same contextual reason. Permission denial remains valid when the visible
approval did not grant the scope. Neither is an implementation escape hatch.
The parity report must show the full denominator, directly available count,
explicitly contextual count, total accounted count, missing/orphan lists, and
typed-field coverage. V6 requires 100% accounted coverage with zero missing or
orphaned controls; it separately reports direct coverage so contextual
human/browser authority boundaries cannot masquerade as agent-operable actions.

Persistent controls are not implemented as hidden `cad_ui` mutations. Their
registry entries declare the exact `cad_preview` adapter, `cad_commit`
completion tool, required edit permission, and document operation kinds. A
control is counted as covered only when browser evidence proves that the direct
transaction appears in the normal Studio exact-preview surface, leaves the
document unchanged before approval, commits atomically, persists, and can be
recovered through normal history. Destructive operations must additionally
surface their exact confirmation requirement.

**Normal use before demonstration.**

The primary product is real interactive CAD work: inspect, model, assemble, revise, validate, persist, recover, and export. Recording mode is a presentation option over the same production path, not a separate demo system.

**Agent portability and skills.**

The callable interface is host-neutral MCP. Codex is the first acceptance host but has no private path. A versioned `bomwiki-cad` skill and references are mandatory parts of the product and are distributed both as installable skill files and MCP resources.

**Package publication is not the product gate.**

The reviewed engine release includes the bridge, canonical skill, MCP
resources, and deterministic package artifact. External npm publication can
follow independently and does not block production promotion of Studio.

**Visible narration, not private reasoning.**

Studio may show movie-style subtitles that describe the current intent, action, confirmed result, conflict, or required attention. Subtitles are generated from the structured action trace and evidence. Hidden chain-of-thought, raw prompts, secrets, and unconfirmed claims never appear.

### 25.2 Remaining decisions requiring owner approval

1. **What is the default commit policy?**

   Proposed: `preview-required`; optionally approve a bounded scoped auto-commit session for repetitive work.

2. **How should connection start?**

   Proposed: Studio-first **Connect agent** plus an agent-first launch link; both require one visible approval and neither requires copy/paste.

3. **Should an agent be allowed to open Studio automatically?**

   Proposed: yes only when the user explicitly asks to use CAD; opening is separate from project-read or edit permission.

4. **How fast should visible work run?**

   Proposed: normal mode by default, recording mode whenever the user asks to test visibly, demonstrate, or record, and instant mode only for tests or explicitly approved fast batches.

5. **Which integration ships first?**

   Proposed: the local host-neutral MCP integration and canonical skill bundle ship together. Codex is the first acceptance host. Hosted execution and simultaneous multi-agent editing remain out of scope.

6. **What is the first proof project?**

   Proposed: the robot-joint acceptance flow in §23. The turbofan remains the complex modeling benchmark, not the interactive-UI benchmark.

## 26. Definition of done

Agentic CAD UI is done only when:

- BOMwiki CAD tools and skill resources are callable from normal compatible agent sessions;
- Codex and a host-neutral MCP conformance client load the same canonical skill and tool schemas;
- normal agent capability discovery is bounded and targeted while the complete audit manifests remain available;
- the agent connects to production Studio through explicit local approval;
- no pairing URL copy/paste is required;
- the agent can inspect and control the complete human-operable production Studio state;
- direct UI calls visibly open and change normal workspaces, panels, tree state, selection, inspector, command fields, previews, camera, progress, and history;
- recording mode produces a legible uncut demonstration without cursor or keyboard automation;
- optional subtitles narrate observable actions and confirmed evidence without exposing private chain-of-thought;
- every human-operable production command is present in the shared command registry and has a semantic adapter;
- every normal command field has an advertised stable typed ID and supports visible read/write/validation parity;
- the protected full-UI parity report is 100% with zero human-control or semantic-adapter orphans;
- no human-enabled production action is hidden behind `NOT_RELEASED_IN_CURRENT_SLICE`;
- visible-command and direct transactions produce identical CAD results;
- persistent changes remain previewed, exact-validated, revision-controlled, atomic, undoable, recoverable, and normally human-editable;
- humans can see, approve, reject, pause, revoke, edit, and resume;
- human changes are delivered as events and stale agent work fails safely;
- the ten-step normal-operation gate passes using CAD tools only;
- the recording-presentation replay passes over the same production path;
- the agent runtime contains no Computer Use, browser automation, DOM, selector, screenshot-targeting, pointer, keyboard, or private-mutation path;
- protected CI, a real Codex production smoke, and host-neutral MCP conformance all pass;
- limitations are stated accurately.

The allowed product statement is:

> Compatible software agents can load the versioned BOMwiki CAD skill, connect to CAD Studio through a permission-scoped local MCP integration, and visibly operate the real Studio through direct semantic UI calls. They can inspect, model, assemble, validate, open workspaces and panels, select and frame geometry, populate normal command drafts, present previews, save, recover, and export ordinary editable CAD work without screen automation.

It must also say:

> The user controls connection and permissions, persistent edits remain revision-controlled and undoable, and agent operation does not certify that a design is safe, manufacturable, or fit for use.
