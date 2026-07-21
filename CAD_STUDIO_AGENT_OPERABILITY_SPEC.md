# BOMwiki CAD Studio — agent operability specification

Status: normative implementation and release contract

Product baseline: CAD Studio production at `wiki/engine@0d1a5aef9`

Related contracts:

- `CAD_STUDIO_V5_COMPLEX_MODELING_SPEC.md`
- `CAD_STUDIO_V5_STATUS.md`
- `CAD_STUDIO_V4_SPEC.md`

Target protocol: `bomwiki.cad.agent/v1`

Target release gate: `v5-agent`

Primary release proof: an external agent constructs, validates, saves, reopens, renders, and exports the canonical V5 turbofan using only public structured CAD tools; a human then edits the same visible feature tree and the agent resumes from the new revision without Computer Use, DOM inspection, screen coordinates, private project mutation, or hidden geometry generators.

## 1. Product decision

BOMwiki CAD must be operable by software agents as a first-class mechanical-design tool.

“Agent operable” means an agent can:

1. discover the CAD capabilities available in the running version;
2. inspect a project as structured parts, bodies, features, sketches, references, parameters, components, mates, views, and diagnostics;
3. propose a typed, bounded change against an explicit document revision;
4. receive an exact preview and structured change set;
5. validate geometry, references, constraints, assemblies, and project limits;
6. commit the change transactionally through the same command pipeline used by the human UI;
7. inspect the resulting identities, topology, measurements, warnings, and failures;
8. undo, redo, save, reopen, render, and export through explicit tools;
9. recover from human edits and revision conflicts without rebuilding from scratch;
10. leave a normal human-editable CAD project whose construction is visible in the ordinary tree and inspector.

Agent operability is not browser automation. An agent that must locate buttons, click pixels, read canvas screenshots, type into whichever field currently has focus, or manipulate hidden DOM state is using Computer Use and does not satisfy this specification.

The product promise is:

> Every released CAD operation is a typed, inspectable, transactional command that humans, agents, tests, and headless tools can invoke through the same core behavior.

## 2. Why this is foundational

Retrofitting an agent layer after the modeling UI is complete would produce two implementations:

- a human path hidden inside event handlers and transient UI state;
- an agent path that writes project JSON or calls kernel helpers directly.

Those paths would diverge in validation, undo/redo, references, failure behavior, and saved results. V5 must instead extract one command/query core during the multi-body runtime slice and require every later capability to extend it.

This architecture also improves the human product:

- browser tests stop depending on brittle control sequences for semantic assertions;
- every preview has an explicit change set;
- failed commands become structured and repairable;
- history and provenance become understandable;
- headless regression fixtures use the production implementation;
- project migrations and exports can be checked deterministically.

## 3. Release boundary

### 3.1 Required

- a transport-independent typed command/query protocol;
- one shared command service used by the Studio UI, agent adapters, headless tools, and semantic tests;
- schema-versioned capability discovery;
- stable project/entity/subshape references;
- bounded project inspection and dependency queries;
- atomic preview, validate, and commit transactions;
- expected-revision concurrency control;
- deterministic change sets and structured diagnostics;
- exact-geometry evidence returned by the production worker/kernel path;
- command cancellation, progress, timeout, and stale-result handling;
- undo/redo through normal document commands;
- headless `.bomcad` operation;
- an MCP adapter for local coding agents;
- a consented live-Studio session bridge using the same protocol;
- visible agent activity, provenance, preview, pause, revoke, and recovery controls;
- file, resource, export, and session permission boundaries;
- protocol/command parity tests for every released CAD capability;
- an agent-built multi-body fixture before advanced V5 features;
- an agent-built canonical turbofan before `v5-agent` closes.

### 3.2 Explicitly not required for V5

- a hosted autonomous CAD service;
- cloud project storage or remote execution;
- natural-language planning inside CAD Studio;
- an embedded proprietary LLM;
- image-to-CAD, text-to-CAD, generative design, or automatic engineering optimization;
- Computer Use, browser extension clicking, DOM automation, or coordinate macros;
- unrestricted shell or filesystem access;
- autonomous purchasing, publishing, or external sharing;
- engineering certification or automatic design approval;
- a single `generate_turbofan` operation that bypasses generic CAD commands.

### 3.3 Relationship to natural language

Natural language is an agent concern, not a CAD-kernel input. An agent may translate a user request into typed CAD operations, but CAD Studio receives only validated protocol requests.

The protocol never accepts arbitrary prose as an executable geometry definition. Optional labels, notes, and intent summaries are metadata and are not evaluated as code or expressions.

## 4. Core architecture

```text
Human Studio UI ───────┐
Local MCP adapter ─────┤
Headless CLI/library ──┼── CadCommandService ── Project validator
Semantic test client ──┘           │                    │
                                   ├── Preview/revision store
                                   ├── Undo/redo journal
                                   └── Kernel worker / assembly solver
                                                │
                                      Structured results/evidence
```

Required layers:

1. **Protocol types** — serializable request, command, query, result, diagnostic, reference, permission, and evidence definitions.
2. **CadQueryService** — read-only bounded inspection over canonical and derived state.
3. **CadCommandService** — the only persistent mutation boundary.
4. **Preview store** — revision-bound, expiring, non-canonical previews.
5. **Kernel/solver adapters** — exact B-rep, sketch solving, assembly solving, measurement, validity, and export.
6. **UI adapter** — converts human interactions into the same typed commands.
7. **Headless adapter** — operates project files without a browser or DOM.
8. **MCP adapter** — exposes a small stable tool surface to external agents.
9. **Live-session bridge** — connects an approved local agent session to an open Studio project.
10. **Evidence recorder** — produces deterministic command, validation, geometry, render, and export artifacts for release gates.

No adapter may mutate `CadProjectV5` directly. No adapter may call a geometry constructor as a substitute for a `CadOperation` supported by `CadCommandService`.

## 5. Protocol envelope

Every request uses a versioned envelope.

```ts
type CadAgentRequest<T> = {
  protocol: 'bomwiki.cad.agent/v1';
  requestId: string;
  sessionId: string;
  projectId?: string;
  expectedRevision?: number;
  permissionContext: PermissionContext;
  payload: T;
};

type CadAgentResponse<T> = {
  protocol: 'bomwiki.cad.agent/v1';
  requestId: string;
  sessionId: string;
  projectId?: string;
  revision?: number;
  status: 'ok' | 'warning' | 'error' | 'cancelled' | 'conflict';
  result?: T;
  diagnostics: CadDiagnostic[];
  timing?: TimingEvidence;
};
```

Rules:

- `requestId` is unique within a session and supports idempotent retry;
- a duplicate completed request returns the same result rather than executing twice;
- mutation requests require `projectId` and `expectedRevision`;
- read requests return the revision observed;
- responses never depend on display language for machine interpretation;
- display messages supplement, but never replace, stable diagnostic codes;
- unknown protocol major versions are rejected without project mutation;
- unknown optional request fields are ignored only when explicitly allowed by the operation schema;
- unknown command kinds are rejected atomically.

## 6. Capability discovery

The agent starts with `cad_capabilities`.

```ts
type CapabilityManifest = {
  protocolVersion: string;
  studioVersion: string;
  schemaVersions: number[];
  kernelVersion: string;
  documentKinds: Array<'part' | 'assembly'>;
  operations: OperationCapability[];
  queries: QueryCapability[];
  exports: ExportCapability[];
  limits: ProjectLimits;
  permissions: PermissionDescriptor[];
  transports: Array<'headless' | 'mcp-stdio' | 'studio-loopback'>;
};

type OperationCapability = {
  kind: CadOperation['kind'];
  version: number;
  state: 'available' | 'preview' | 'disabled';
  disabledReasonCode?: string;
  inputSchema: JsonSchema;
  resultSchema: JsonSchema;
  supportsPreview: boolean;
  supportsAtomicBatch: boolean;
};
```

Capability discovery is authoritative. Agents must not infer an operation from a toolbar label, documentation claim, schema type, or kernel library capability.

An operation may report `available` only when:

- the production command service implements it;
- headless and live adapters produce equivalent commands;
- exact behavior and failure tests pass;
- its normal result is human-visible and editable;
- its input and output schemas are versioned.

## 7. Sessions and project lifecycle

### 7.1 Headless session

A headless session opens a project into an isolated in-memory workspace. The session receives a project root permission and explicit output permissions.

Supported lifecycle actions:

- create a new project;
- open a permitted `.bomcad` project;
- inspect project status;
- save as a new project;
- save in place when permission permits;
- close and release kernel/resources;
- recover a journal after an interrupted process when explicitly requested.

### 7.2 Live Studio session

An external local agent connects to a running Studio only after the user approves an in-app pairing request.

Required behavior:

- the local adapter uses loopback transport only;
- Studio shows the requesting client name and requested permission scopes;
- approval creates a random session-scoped token kept in memory;
- the connection is locked to the approved origin, project, client, and scopes;
- reload, project replacement, explicit revoke, inactivity timeout, or Studio exit invalidates the token;
- Studio visibly indicates when an agent is connected, previewing, rebuilding, or waiting;
- the user can pause or revoke the agent at any time;
- the agent cannot inspect other browser tabs, DOM state, cookies, storage keys, or unrelated projects.

### 7.3 Session modes

The user chooses one of:

- **Read only** — queries, validation, measurement, and render only;
- **Preview required** — the default; the agent may prepare previews, but the user approves commits in Studio;
- **Scoped auto-commit** — the agent may commit within approved projects, operation kinds, budgets, and time limits;
- **Headless batch** — controlled by local filesystem and command permissions rather than a visible Studio session.

Switching to a more permissive mode requires explicit approval. An agent cannot change its own mode.

## 8. Stable identity and references

Agents address semantic entities, never array positions, CSS selectors, screen coordinates, or display-name strings alone.

```ts
type EntityRef = {
  projectId: string;
  documentId: string;
  kind:
    | 'part'
    | 'assembly'
    | 'body'
    | 'feature'
    | 'sketch'
    | 'sketch-entity'
    | 'constraint'
    | 'datum'
    | 'parameter'
    | 'occurrence'
    | 'mate'
    | 'pattern'
    | 'section-view'
    | 'exploded-view';
  id: string;
};

type SubshapeRef = {
  owner: EntityRef;
  stableId: string;
  topologySignature: TopologySignature;
  expectedGeometry?: 'plane' | 'cylinder' | 'cone' | 'line' | 'circle' | 'spline' | 'other';
};
```

Rules:

- IDs are returned by creation results and project inspection;
- names are for humans and search, not identity;
- every reference records its owner path;
- topology matching follows the V5 persistence contract;
- ambiguous references fail with repair candidates;
- “nearest face,” “first edge,” or “the third item” is not an automatic fallback;
- queries may return ordered results, but later commands use the returned stable references;
- pattern occurrences retain derived identities until dissolved;
- replacing or making a component independent returns an identity remap.

## 9. Query surface

Queries are read-only, bounded, revision-tagged, and available in headless and live sessions.

Required query kinds:

### 9.1 Project summary

Returns:

- name, units, schema, revision, root document;
- part, assembly, body, feature, occurrence, and mate counts;
- active document/body/workspace;
- rebuild/solve state;
- unsaved, recovery, validation, and export status;
- current permission mode.

### 9.2 Tree

Returns a paginated semantic tree with:

- IDs and owner paths;
- names and kinds;
- creation feature;
- visible, hidden, suppressed, failed, active, selected, and patterned states;
- child counts and continuation cursors;
- axial station/group metadata when present.

### 9.3 Entity detail

Returns the canonical editable definition plus bounded derived evidence appropriate to the kind.

Examples:

- body: result policy, owning features, material, bounding box, volume, validity;
- feature: inputs, outputs, values, expressions, dependencies, dependents, diagnostics;
- sketch: support, plane transform, entities, constraints, degrees of freedom, profile validity;
- occurrence: definition, transform, mates, solve state;
- mate: references, type, values, residual, degrees of freedom, conflicts.

### 9.4 Dependency graph

Returns upstream or downstream references to a bounded depth. Cycles are never silently truncated; an invalid cycle returns a diagnostic.

### 9.5 Search

Searches by exact ID, name, kind, owner, state, metadata tag, or bounded semantic filter.

Search never accepts executable code or arbitrary regular expressions. Result order is deterministic and each result includes a stable reference.

### 9.6 Geometry and topology

Returns exact derived facts, not raw unrestricted kernel objects:

- solid/shell/face/edge/vertex counts;
- volume, area, centre of mass, bounding box;
- planar/cylindrical/conical axes and radii;
- validity and manifold state;
- named or stable subshape references;
- clearances/interferences where requested;
- mesh/display statistics only when explicitly requested.

### 9.7 Measure

Supports distance, angle, radius, diameter, area, volume, mass, and clearance measurements between stable references.

### 9.8 Change history

Returns bounded command-journal entries with revision, actor type, client label, operation kinds, change summary, result status, and diagnostics. Prompt text and private agent reasoning are not stored.

## 10. Command model

Every persistent operation is a `CadOperation` executed by `CadCommandService`.

```ts
type CadOperation =
  | ProjectOperation
  | ParameterOperation
  | DatumOperation
  | SketchOperation
  | FeatureOperation
  | BodyOperation
  | PatternOperation
  | BooleanOperation
  | ComponentOperation
  | MateOperation
  | AppearanceOperation
  | InspectionOperation
  | ViewOperation;

type CadTransaction = {
  transactionId: string;
  label: string;
  expectedRevision: number;
  operations: CadOperation[];
  atomic: true;
  metadata?: {
    actor: 'human' | 'agent' | 'test' | 'migration';
    clientLabel?: string;
    intentSummary?: string;
  };
};
```

Rules:

- `atomic` is always `true` in protocol v1;
- operations run in order against one detached draft;
- references created earlier in a transaction may be addressed with transaction-local aliases;
- validation or kernel failure aborts the entire transaction;
- a successful transaction creates one undoable document command unless an explicitly documented operation is session-only;
- agents cannot submit arbitrary JavaScript, kernel expressions, SQL, HTML, or code callbacks;
- numeric expressions use the bounded CAD parameter expression language only;
- commands never depend on current pointer position or whichever field has focus;
- command results return all created, changed, deleted, remapped, invalidated, and failed identities.

## 11. Required operation families

The protocol grows with released CAD capability. Operation schemas are defined alongside their implementation, but these families and naming conventions are reserved.

### 11.1 Project and parameters

- `project.rename`
- `project.setUnits`
- `parameter.create`
- `parameter.update`
- `parameter.delete`

### 11.2 Datums

- `datum.createPlane`
- `datum.createAxis`
- `datum.createPoint`
- `datum.createCoordinateSystem`
- `datum.update`
- `datum.delete`

### 11.3 Sketches and constraints

- `sketch.create`
- `sketch.addEntities`
- `sketch.updateEntities`
- `sketch.deleteEntities`
- `constraint.create`
- `constraint.update`
- `constraint.delete`
- `sketch.projectReferences`
- `sketch.importProfile`

Entities are explicit line, arc, circle, spline, rectangle helper result, polygon helper result, construction geometry, and point definitions. Rectangle/polygon helpers return the created primitive IDs and constraints; they do not create opaque uneditable shapes.

### 11.4 Features and bodies

- `feature.extrude`
- `feature.cut`
- `feature.revolve`
- `feature.loft`
- `feature.sweep`
- `feature.fillet`
- `feature.chamfer`
- `feature.shell`
- `feature.thicken`
- `feature.draft`
- `feature.update`
- `feature.suppress`
- `feature.reorder`
- `feature.delete`
- `body.create`
- `body.activate`
- `body.rename`
- `body.setVisibility`
- `body.suppress`
- `body.delete`
- `body.transform`

Solid-producing features explicitly specify `new-body`, `add`, `subtract`, `intersect`, or `surface` result policy and target bodies where applicable.

### 11.5 Patterns and Booleans

- `pattern.linear`
- `pattern.circular`
- `pattern.curve`
- `pattern.mirror`
- `pattern.update`
- `pattern.dissolve`
- `boolean.union`
- `boolean.subtract`
- `boolean.intersect`
- `boolean.split`

### 11.6 Components and mates

- `component.createPart`
- `component.insert`
- `component.replace`
- `component.makeIndependent`
- `component.transform`
- `component.setVisibility`
- `component.suppress`
- `mate.create`
- `mate.update`
- `mate.suppress`
- `mate.delete`

### 11.7 Inspection, appearances, and views

- `appearance.assign`
- `material.assign`
- `section.create`
- `section.update`
- `section.delete`
- `explodedView.create`
- `explodedView.update`
- `explodedView.delete`
- `view.save`
- `view.activate`

Measurement, validity, interference, clearance, render, and export are query/artifact operations unless they explicitly persist a saved result.

## 12. Transaction-local aliases

Agents frequently create a datum, sketch, and feature in one atomic request. The protocol supports explicit aliases without guessing generated IDs.

```json
{
  "transactionId": "tx-fan-blade-root",
  "expectedRevision": 42,
  "atomic": true,
  "operations": [
    {
      "kind": "datum.createPlane",
      "alias": "root-plane",
      "input": { "mode": "offset", "source": { "id": "yz-plane" }, "offset": "fanRootRadius" }
    },
    {
      "kind": "sketch.create",
      "alias": "root-profile",
      "input": { "support": { "alias": "root-plane" }, "name": "Fan blade root profile" }
    }
  ]
}
```

Alias scope ends with the transaction. Results return stable persisted IDs for later requests.

## 13. Preview, validate, and commit

Mutation uses a required two-phase contract even when scoped auto-commit performs both phases on behalf of the user.

### 13.1 Preview

`cad_preview`:

1. checks permissions, limits, protocol schema, project revision, and references;
2. applies the transaction to a detached project draft;
3. runs affected sketch, B-rep, pattern, assembly, topology, and document validation;
4. computes exact derived results where the operation requires them;
5. returns an expiring preview token and structured change set;
6. never changes the canonical document or undo/redo stacks.

```ts
type PreviewResult = {
  previewId: string;
  baseRevision: number;
  expiresAt: string;
  changeSet: CadChangeSet;
  validation: ValidationSummary;
  evidence: CadEvidence;
  confirmation: ConfirmationRequirement;
};
```

### 13.2 Commit

`cad_commit` accepts a valid `previewId` and the same `expectedRevision`.

- if the revision changed, commit returns `REVISION_CONFLICT` and does not mutate;
- if the preview expired, commit returns `PREVIEW_EXPIRED`;
- the exact previewed canonical change is committed; it is not reinterpreted from natural language;
- one commit increments the revision once;
- the normal Studio tree, inspector, canvas, status, recovery journal, and undo stack update;
- the response contains the committed change set and any identity remaps;
- preview geometry is discarded after success, cancellation, expiry, or conflict.

### 13.3 Auto-commit

Scoped auto-commit still creates and validates a preview internally. It may commit without a separate user click only when:

- the session scope permits every operation;
- budgets are not exceeded;
- no destructive or confirmation-required operation is present;
- validation has no errors and no confirmation-level warnings;
- the project revision still matches.

## 14. Change-set contract

```ts
type CadChangeSet = {
  created: ChangedEntity[];
  updated: ChangedEntity[];
  deleted: ChangedEntity[];
  remapped: IdentityRemap[];
  invalidated: ChangedEntity[];
  rebuilt: RebuildEvidence[];
  unchangedAssertions: EntityRef[];
  parameterDiffs: ParameterDiff[];
  transformDiffs: TransformDiff[];
  visibilityDiffs: VisibilityDiff[];
  documentHashBefore: string;
  documentHashAfter: string;
};
```

The change set is semantic, not a raw JSON patch. It must answer:

- what was created, changed, deleted, or remapped;
- which bodies/features/components rebuilt;
- which dependents were invalidated;
- which named values changed;
- whether valid solids and solved assemblies remain valid;
- what did not change when the request asserted non-interference.

Raw canonical diffs may be included as bounded debugging evidence but are not the primary API.

## 15. Diagnostics and repair

```ts
type CadDiagnostic = {
  code: string;
  severity: 'info' | 'warning' | 'confirmation' | 'error';
  message: string;
  entity?: EntityRef | SubshapeRef;
  operationIndex?: number;
  cause?: DiagnosticCause;
  repairOptions?: RepairOption[];
};
```

Required stable diagnostic classes include:

- protocol/schema mismatch;
- permission denied;
- project/resource limit exceeded;
- stale revision or preview;
- missing, deleted, suppressed, or ambiguous reference;
- invalid expression or parameter cycle;
- open, overlapping, self-intersecting, or under-constrained profile;
- kernel refusal or invalid/non-manifold result;
- empty/disjoint Boolean result;
- topology reference changed;
- assembly under-constrained, over-constrained, or conflicting;
- export unsupported or structurally lossy;
- command cancelled, timed out, or superseded.

Repair options are typed proposals such as reselect reference, lower radius, reverse direction, suppress feature, roll back, accept partial import, or refresh revision. They are never executable prose.

Agents may request a preview of a repair option but cannot bypass its normal validation or permission requirements.

## 16. Exact evidence

Every exact-geometry mutation preview and commit returns bounded evidence:

```ts
type CadEvidence = {
  exactGeometry: boolean;
  bodyResults: Array<{
    body: EntityRef;
    valid: boolean;
    solids: number;
    shells: number;
    faces: number;
    edges: number;
    volume?: number;
    boundingBox?: BoundingBox;
    geometryHash: string;
  }>;
  assemblyResult?: {
    solved: boolean;
    degreesOfFreedom: number;
    occurrenceTransformsHash: string;
    conflicts: EntityRef[];
  };
  warnings: string[];
};
```

Evidence rules:

- exact B-rep results drive pass/fail when exact geometry is required;
- preview mesh triangle count is never proof of a valid solid;
- a headless command and equivalent visible-Studio command must produce the same canonical document and exact geometry hashes;
- hashes are versioned by kernel/tolerance configuration and are not promised stable across an explicitly versioned kernel upgrade;
- comparisons across upgrades use fixture-specific geometric invariants and tolerances.

## 17. Concurrency and human-agent handoff

Every committed human, agent, migration, or recovery action increments one project revision.

Mutation requests require `expectedRevision`.

On `REVISION_CONFLICT`, the response returns:

- expected and actual revision;
- bounded command summaries since the expected revision;
- entities changed that intersect the proposed transaction;
- whether the preview can be safely regenerated;
- a requirement to inspect before retry.

The service never silently rebases geometry commands.

Canonical handoff scenario:

1. agent inspects revision `80`;
2. agent previews a blade-count edit;
3. human changes nacelle wall thickness, creating revision `81`;
4. agent commit against `80` is rejected;
5. agent queries changes since `80`;
6. agent confirms its blade references remain valid;
7. agent previews again against `81`;
8. agent commits revision `82`;
9. human sees both normal history entries and can undo either in order.

## 18. Progress, cancellation, and long operations

Long operations return a job ID and structured progress events.

```ts
type CadJobProgress = {
  jobId: string;
  phase: 'validating' | 'solving-sketch' | 'building-geometry' | 'solving-assembly' | 'meshing' | 'checking' | 'exporting';
  completed: number;
  total?: number;
  activeEntity?: EntityRef;
  cancellable: boolean;
};
```

Rules:

- progress never mutates canonical project state;
- cancellation preserves the last valid project and visible result;
- late worker replies are ignored by revision/request ID;
- agents can poll or subscribe through the adapter;
- timeouts return a structured diagnostic and cancel work where safe;
- no adapter may block the UI main thread waiting for exact geometry;
- the user can cancel agent work from Studio.

## 19. Human-visible agent experience

Agent operations must remain legible to a human.

Studio adds an **Agent activity** surface showing:

- connected client and permission mode;
- current request and project revision;
- previewed entities highlighted on canvas and in the tree;
- a plain change summary generated from the structured change set;
- validation, geometry, and assembly status;
- Approve, Reject, Pause, Revoke, Undo, and Inspect commands as permitted;
- bounded recent command history;
- whether the result is saved/exported or only in memory.

The ordinary model tree remains canonical. Agent-created datums, sketches, features, bodies, patterns, components, mates, sections, and parameters appear exactly as human-created items.

The agent does not receive invisible feature kinds, relaxed validity, hidden coordinates, or a private history tree.

Accessibility requirements:

- connection, preview, confirmation, progress, errors, pause, and revoke are keyboard reachable;
- focus returns predictably after approval/rejection;
- change identity and status use text/shape as well as color;
- live announcements summarize new previews, conflicts, failures, and completed commits;
- reduced motion disables automatic camera moves during agent previews;
- a user can inspect the full change without relying on animation.

## 20. Provenance and audit journal

Every committed command records:

- revision before/after;
- timestamp;
- actor type;
- user-approved client label;
- protocol and operation schema versions;
- operation kinds;
- semantic change summary;
- validation result;
- command/result hash;
- confirmation mode;
- undo relationship.

The journal does not store:

- hidden model reasoning;
- full prompts by default;
- credentials, pairing tokens, environment variables, or arbitrary filesystem paths;
- unrelated browser/app activity.

Projects may persist a bounded journal or an external sidecar according to user preference. Removing optional provenance never changes geometry, references, or document validity.

## 21. MCP adapter

The local MCP server exposes a small stable tool surface rather than one MCP tool per CAD feature.

Required tools:

### `cad_capabilities`

Discover protocol, operations, schemas, limits, transports, and permissions.

### `cad_session`

Create/open/connect/status/save/close a headless or approved live session.

### `cad_inspect`

Read project summary, tree, entity details, dependencies, history, and diagnostics with pagination.

### `cad_query`

Run bounded geometry, topology, measurement, search, validity, interference, clearance, and solve-state queries.

### `cad_preview`

Validate and exactly preview one atomic typed transaction.

### `cad_commit`

Commit an approved revision-bound preview.

### `cad_history`

Undo, redo, inspect changes since a revision, or obtain a bounded audit trail.

### `cad_artifact`

Render approved views and export permitted project/STEP/STL artifacts.

Tool descriptions must tell agents:

- which calls are read-only;
- which calls can mutate project state;
- which calls can write files;
- when confirmation may be required;
- how revision conflicts are handled;
- where to obtain operation schemas.

Large schemas and project data use resource links or pagination instead of oversized tool descriptions/results.

## 22. Headless CLI and library

The same adapter is available without MCP for CI and deterministic automation.

Required command families:

```text
bomcad capabilities
bomcad inspect <project>
bomcad validate <project>
bomcad preview <project> --transaction <file>
bomcad apply <project> --transaction <file> --out <project>
bomcad render <project> --view <id> --out <png>
bomcad export <project> --format step --out <step>
bomcad replay <project> --journal <file>
```

CLI output supports human text and versioned JSON. CI and agents use JSON.

The library exposes the protocol types and services directly for in-repo tests without launching MCP or a browser.

CLI/library behavior must match the visible Studio for canonical document hashes, exact geometry evidence, validation, and exports.

## 23. File and resource safety

- headless sessions receive explicit readable project roots and writable output roots;
- path traversal, symlinks escaping an approved root, device files, and unsupported schemes are rejected;
- live Studio sessions cannot request arbitrary host paths;
- project open, replace, save-in-place, and export permissions are distinct;
- opening/replacing a live project requires confirmation unless the session was approved specifically for that file and action;
- resources retain the V5 20 MiB canonical document, 100 MiB decoded-resource, and 160 MiB encoded-file boundaries;
- command payloads and query results have independent size, count, depth, and time limits;
- imported filenames, MIME types, identifiers, and metadata are sanitized;
- no project content is executed as HTML, JavaScript, WASM, shell, or template code;
- expressions use the existing safe parameter evaluator only;
- downloads/exports never report success without a completed artifact and checksum.

## 24. Permission model

```ts
type CadPermission =
  | 'project.read'
  | 'project.create'
  | 'project.edit'
  | 'project.replace'
  | 'project.save-new'
  | 'project.save-in-place'
  | 'project.recover'
  | 'artifact.render'
  | 'artifact.export-project'
  | 'artifact.export-step'
  | 'artifact.export-stl';

type PermissionContext = {
  granted: CadPermission[];
  projectIds?: string[];
  operationKinds?: string[];
  expiresAt?: string;
  maxCommits?: number;
  maxCreatedEntities?: number;
  maxRuntimeMs?: number;
};
```

Rules:

- deny by default;
- read permission does not imply edit;
- edit does not imply file overwrite or export;
- permissions are intersected with product/project limits;
- adapters cannot enlarge permissions supplied by the host;
- a transaction exceeding scope is rejected before preview work begins;
- revocation cancels pending previews/jobs and prevents further commits;
- already committed commands remain normal undoable project history.

## 25. Agent-operability performance budgets

After kernel load on reference hardware:

- capability manifest: p95 under `100 ms`;
- project summary/tree first page: p95 under `150 ms`;
- entity detail/dependency query: p95 under `200 ms` excluding requested exact checks;
- protocol validation before kernel work: p95 under `50 ms`;
- no-op/stale-revision rejection: p95 under `50 ms`;
- simple parameter preview acknowledgement: under `100 ms` with exact result following normal rebuild budget;
- MCP adapter overhead excluding CAD work: p95 under `25 ms` local;
- Studio activity update after commit: p95 under `100 ms`;
- cancellation acknowledgement: p95 under `100 ms`;
- paginated result page: maximum `500` entities and `1 MiB` decoded JSON by default;
- one atomic transaction: maximum `250` operations unless a lower project/session budget applies.

Exact rebuild, assembly, interference, render, and export budgets continue to follow V5 §27.

## 26. Testing architecture

Agent operability is tested without an LLM. A deterministic protocol client produces known commands and verifies exact results.

### 26.1 Protocol tests

- version negotiation and unsupported versions;
- request idempotency;
- unknown/invalid fields and command kinds;
- numeric, string, count, size, depth, and time limits;
- pagination and continuation tokens;
- stable diagnostic codes;
- serialization/round-trip of every operation/query/result union member.

### 26.2 Query tests

- project/tree/entity/dependency/history/search results;
- stable IDs and owner paths;
- bounded exact topology and measurement evidence;
- no mutation from any query;
- hidden/suppressed/failed/patterned/assembly states;
- ambiguous subshape and search-result behavior.

### 26.3 Transaction tests

- preview is byte-identical to canonical document/undo stacks;
- atomic multi-operation success;
- one invalid middle operation rolls back the whole batch;
- preview expiry and cancellation;
- expected-revision conflict;
- duplicate request retry;
- one commit creates one history command and one revision;
- undo/redo returns exact document and geometry hashes;
- created aliases return stable IDs.

### 26.4 Adapter parity tests

For every released operation:

1. invoke through the human UI adapter;
2. invoke the equivalent transaction through the direct library;
3. invoke through MCP/headless adapter;
4. compare canonical document, identities, exact geometry/solve evidence, diagnostics, and export hashes within versioned tolerances.

DOM equivalence is not sufficient. Geometry and canonical structure must match.

### 26.5 Security tests

- missing/expired/revoked tokens;
- permission-scope escalation attempts;
- cross-project access;
- loopback origin/client mismatch;
- path traversal and symlink escape;
- oversized/cyclic/malformed projects and commands;
- arbitrary-code/expression injection attempts;
- export without permission;
- project replacement without confirmation;
- resource and result exfiltration outside approved scopes.

### 26.6 Human-agent interleaving tests

- agent preview followed by human edit produces a conflict;
- agent refreshes and safely re-previews;
- human rejects preview with no mutation;
- user pause/revoke cancels work;
- agent commit appears in normal tree/history and is undoable by the human;
- human edit is inspectable by the agent through revision/change queries;
- recovery preserves committed actions but not expired preview state.

### 26.7 Failure tests

- missing/ambiguous topology references;
- invalid sketches and expressions;
- failed Loft/Sweep/Boolean/Shell/Fillet;
- failed mate solve;
- cancelled long rebuild/export;
- stale worker response;
- headless crash and journal recovery;
- last valid geometry remains available where the V5 feature contract requires it.

## 27. Required package commands

Implementation adds stable commands:

```text
npm run studio:agent:protocol
npm run studio:agent:queries
npm run studio:agent:transactions
npm run studio:agent:parity
npm run studio:agent:mcp
npm run studio:agent:security
npm run studio:agent:handoff
npm run studio:agent:multibody
npm run studio:agent:turbofan
npm run studio:agent:release-check
```

`studio:agent:release-check` produces one machine-readable manifest containing:

- source commit and protocol/schema/kernel versions;
- operation/query capability manifest hash;
- adapter parity results;
- transaction, conflict, idempotency, permission, and security results;
- canonical project and geometry evidence hashes;
- headless/live render and export comparisons;
- multi-body fixture result;
- turbofan construction journal and result;
- human-agent handoff result;
- artifact paths/checksums;
- pass/fail/skip with explicit reasons.

Missing MCP transport, browser, kernel, fixture, visual artifact, or export evidence cannot become a pass.

## 28. Canonical agent scenarios

### 28.1 Agent multi-body foundation

Using protocol calls only, the deterministic agent client:

1. creates a project;
2. creates `Housing`, `Shaft`, and `Tool` bodies;
3. subtracts `Tool` from `Housing` while preserving `Shaft`;
4. renames, hides, isolates, suppresses, and restores bodies;
5. edits an early parameter;
6. validates exact solids and unaffected identities;
7. saves, reopens, undoes, redoes, renders, and exports selected bodies;
8. opens the result in Studio where every operation is visible and human-editable.

No DOM, Computer Use, project-JSON mutation, or kernel-direct shortcut is permitted.

### 28.2 Human-agent handoff

1. agent builds the multi-body fixture;
2. human changes one visible parameter in Studio;
3. agent observes the new revision and semantic change;
4. agent adds a valid feature referencing the human result;
5. human undoes and redoes both actions;
6. save/reopen preserves identities, provenance, and geometry.

### 28.3 Agent turbofan

The deterministic agent client constructs the complete V5 §40 turbofan from an empty project using public capability-discovered operations.

Required proof:

- no use of a turbofan-specific command;
- no imported finished mesh or B-rep;
- no direct canonical JSON mutation;
- no DOM, screenshot, pointer, keyboard, or Computer Use calls;
- ordinary datum, sketch, constraint, feature, body, transform, pattern, Boolean, component, mate, appearance, and section operations only;
- every §40 structural assertion passes;
- every §40 parametric edit passes;
- a human can inspect and edit every major stage in Studio;
- the agent resumes after one human edit through revision handling;
- native project and structured STEP round trips pass;
- exact required views are rendered through `cad_artifact` and match the visible Studio within rendering tolerances.

The checked-in construction journal is replayable and produces the same canonical result on the versioned kernel fixture.

## 29. Implementation slices

Agent operability develops alongside V5 rather than after it.

### Agent Slice A0 — extract the shared command service

- define protocol and operation/query unions;
- move persistent V4/V5 mutations behind `CadCommandService`;
- convert UI handlers to commands without behavior changes;
- return semantic change sets and stable diagnostics;
- preserve transaction, undo/redo, recovery, focus, and keyboard behavior.

Gate: existing human UI tests remain green, direct-library commands produce equivalent documents, and no persistent UI handler mutates the document outside the service.

### Agent Slice A1 — queries, preview, and revision control

- project/tree/entity/dependency/history/search queries;
- exact bounded geometry queries;
- preview store;
- expected revisions, idempotency, conflict responses, expiry, cancellation;
- structured evidence and change sets.

Gate: deterministic client completes preview/commit/conflict/undo/redo tests on existing simple-part features.

### Agent Slice A2 — headless adapter and CLI

- isolated sessions and project roots;
- JSON CLI/library;
- save/reopen/render/export;
- adapter parity and recovery tests.

Gate: simple-part fixtures produce matching visible/headless canonical and exact geometry results.

### Agent Slice A3 — MCP and live Studio bridge

- small MCP surface from §21;
- stdio server;
- loopback live-session pairing;
- permissions, modes, pause/revoke;
- Agent activity UI and accessible confirmations.

Gate: an external deterministic MCP client edits a visible project with preview approval, and user rejection/revoke remain lossless.

### Agent Slice A4 — multi-body parity

Lands with V5 Slice 5A-runtime:

- schema-5 load/save command/query support;
- body-aware result policies;
- multi-body queries/evidence;
- tree/renderer/export parity;
- §28.1 and §28.2 scenarios.

Gate: `studio:agent:multibody` plus V5 `v5-multibody` both pass.

### Agent Slice A5 — advanced V5 operation parity

Each V5 slice adds its operation/query schemas and parity tests in the same PR sequence:

- 5B: datums and transforms;
- 5C: splines, Loft, Sweep, advanced Revolve and edge/skin features;
- 5D: explicit Booleans and linked patterns;
- 5E: components, assemblies, mates, and solver queries;
- 5F: section/explode, inspection, appearances, and structured interchange.

An operation is not release-complete until UI, direct library, headless, and MCP adapters pass parity.

### Agent Slice A6 — turbofan and release hardening

- complete agent turbofan journal;
- human-agent handoff during turbofan editing;
- performance, cancellation, recovery, security, visual, and export evidence;
- Help and capability-manifest truth audit;
- production-candidate live bridge verification.

Gate: §28.3 and every release requirement below pass.

## 30. Release gate

`v5-agent` requires:

| Evidence | Requirement |
| --- | --- |
| Shared command service | UI and every adapter use the same persistent mutation boundary |
| Capability truth | Manifest reports only implemented, parity-tested operations |
| Query coverage | Project/tree/entity/dependency/geometry/history inspection passes |
| Transactions | Preview, atomic commit, cancellation, conflict, idempotency, undo/redo pass |
| Stable references | Entity/subshape ownership and ambiguity behavior pass |
| Headless parity | Canonical and exact results match visible Studio |
| MCP parity | Deterministic MCP client passes released operations |
| Permissions/security | Session, filesystem, resource, injection, and export tests pass |
| Human visibility | Preview/activity/history/pause/revoke/accessibility pass |
| Multi-body agent fixture | §28.1 passes without DOM/Computer Use/direct JSON |
| Human-agent handoff | §28.2 passes across a revision conflict |
| Agent turbofan | §28.3 builds and verifies the canonical fixture |
| Artifacts | Journal, project, manifests, renders, STEP, hashes, and checksums uploaded |
| Live proof | Protected CI deployment and approved live-session smoke pass |

No LLM screenshot or narrated demo substitutes for these deterministic gates.

## 31. Definition of done

CAD Studio is agent operable only when:

- external agents can discover and invoke every released CAD capability through structured tools;
- no agent workflow requires DOM, Computer Use, pointer coordinates, keyboard focus, or image interpretation;
- UI, direct library, headless, MCP, and live-session adapters share one command/query implementation;
- every mutation is revisioned, previewable, validated, atomic, undoable, recoverable, and idempotent;
- agents inspect stable semantic identities and exact bounded geometry evidence;
- ambiguous references fail safely with typed repair choices;
- human edits produce revision conflicts rather than silent agent overwrite;
- agent work appears as ordinary human-editable project structure and history;
- users control connection, permissions, preview approval, pause, revoke, save, and export;
- the multi-body and turbofan agent scenarios pass without privileged shortcuts;
- the final project, render, and STEP artifacts match the visible Studio result;
- the capability manifest, Help, README, and release statement accurately describe limitations.

The allowed release statement is:

> BOMwiki CAD Studio exposes its parametric modeling operations through a versioned command/query protocol and local MCP adapter, allowing agents to inspect, preview, validate, and build normal human-editable CAD projects without screen automation.

It must also say:

> Agent access is local, permission-scoped, revision-controlled, and subject to the same modeling validity and project limits as human edits. Agent operation does not certify that a design is safe or manufacturable.

## 32. Requirement traceability

| Requirement | Contract sections | Gate proof |
| --- | --- | --- |
| Not Computer Use | §§1, 3, 28, 31 | protocol-only test client and forbidden-call audit |
| Same behavior as human UI | §§4, 10, 26.4 | adapter parity hashes/evidence |
| Capability discovery | §6 | manifest truth and disabled-operation tests |
| Structured inspection | §§8–9 | stable query fixtures |
| Transactional edits | §§10, 13–14 | preview/commit/rollback/undo tests |
| Exact geometry confidence | §16 | body/assembly evidence assertions |
| Revision-safe collaboration | §17 | human-agent handoff scenario |
| Long-work control | §18 | progress/cancel/stale-result tests |
| Human observability | §§19–20 | activity/provenance/accessibility evidence |
| Local agent integration | §§21–22 | MCP/CLI protocol tests |
| Security and permissions | §§23–24 | adversarial scope/filesystem/resource suite |
| Performance | §25 | protocol and adapter percentile artifacts |
| Multi-body agent capability | §28.1 | `studio:agent:multibody` |
| Agent resumability | §28.2 | revision conflict and resume proof |
| Complex model capability | §28.3 | `studio:agent:turbofan` |

## 33. Closed implementation decisions

1. Agent operability means structured command/query access, not Computer Use.
2. The human UI, agent adapters, headless runner, and semantic tests share one command service.
3. Agents do not mutate canonical project JSON directly.
4. Agents receive no private geometry operations or relaxed validity rules.
5. Natural language is translated outside the CAD core into typed operations.
6. Preview and exact validation precede every commit, including scoped auto-commit.
7. Mutations use expected revisions and never silently rebase.
8. Ambiguous topology references fail for repair.
9. Local MCP plus headless operation ship before any hosted agent service.
10. Live Studio connection is explicit, local, scoped, visible, pausable, and revocable.
11. File overwrite and export permissions remain separate from edit permission.
12. Prompt text and hidden reasoning are not persisted by default.
13. The canonical agent tests use deterministic clients, not nondeterministic LLM judgments.
14. The turbofan must be built from generic released operations and remain normally human-editable.
15. `v5-agent` cannot close until the multi-body, advanced-shape, pattern, assembly, inspection, interchange, turbofan, and live gates it depends on are also closed.
