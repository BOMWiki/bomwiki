# BOMwiki CAD Studio V4 — precision modeling specification

Status: proposed implementation contract

Product baseline: CAD Studio V3 at `wiki/engine@c28e3b35365839cb8083110c5dc5aeda3d29adf0`

Target route: `/cad/studio`

Target release: V4

Primary comparator: the single-part workflow in FreeCAD Part Design, Onshape Part Studio, and Fusion's basic solid workspace—not their assemblies, drawings, simulation, or collaboration suites.

## 1. Product decision

V3 made CAD Studio look and navigate like a serious modeling application. V4 must make the geometry behave like one.

The product promise is:

> Draw a constrained profile, see exactly what the feature will make, and revise any dimension later without losing the part.

V4 is the release where BOMwiki CAD Studio crosses from a capable parametric part generator into a trustworthy browser CAD tool for simple single parts.

The release is not defined by adding more ribbon buttons. It is defined by one complete modeling loop:

1. choose a visible sketch or feature tool;
2. acquire a visible snap or constraint in the canvas;
3. enter an exact value beside the geometry;
4. see the sketch or solid update before committing;
5. apply one reversible command;
6. select the result in the canvas, tree, or inspector;
7. revise an earlier dimension and rebuild dependents predictably.

If that loop is incomplete, the product must not be labeled V4 even if individual tools exist.

## 2. User and job

The primary user is a maker, repairer, student, or hardware contributor who needs a dimensionally correct printable or machinable single part without installing desktop CAD.

The primary job is:

> Model a plate, bracket, spacer, knob, adapter, or simple enclosure; revise its dimensions; then keep the project or export a valid STEP/STL file.

V4 is successful when a first-time user can build the canonical plate without reading a reference page:

1. create a rectangle;
2. set it to `60 × 40 mm`;
3. extrude it `5 mm`;
4. sketch a circle constrained to the plate centre;
5. set its diameter to `8 mm`;
6. cut through all;
7. fillet four outside edges by `2 mm`;
8. change the plate width to `80 mm` and see the centred hole remain centred;
9. undo and redo the revision;
10. export STEP.

Target completion time after the first-run introduction: under five minutes.

## 3. Release boundary

### 3.1 Required in V4

- a constraint-driven sketch entity model;
- Line, Arc, Circle, Rectangle, and Polygon tools;
- visible snaps, constraint glyphs, dimensions, and degrees-of-freedom status;
- heads-up numeric input while drawing;
- sketch selection, grips, Move, Copy, Delete, Trim, and Offset;
- connected canvas, feature-tree, and inspector selection;
- exact translucent previews for all existing solid features;
- direct distance handles for Extrude and Cut;
- feature rename, edit, suppress/unsuppress, and dependency-aware delete;
- a versioned project schema with migration from every existing saved studio document;
- millimetre/inch document display units with explicit mixed-unit input;
- persistent recovery of the active project and recent committed states;
- OpenCascade rebuild and preview work outside the main UI thread;
- regression, geometry, migration, performance, accessibility, and visual gates.

### 3.2 Explicitly not in V4

- assemblies, mates, or components;
- technical drawings, paper space, title blocks, or annotations for manufacturing drawings;
- STEP feature recognition or editing imported STEP history;
- DWG/DXF import or export;
- cloud projects or real-time collaboration;
- multiple bodies and body-to-body Boolean workflows;
- loft, sweep, thread, rib, draft, mirror, or sheet-metal features;
- feature reordering;
- general-purpose 2D drafting, layers, hatches, or text;
- simulation, mass properties, interference detection, CAM, or rendering;
- publishing to BOMwiki.

Those are later product decisions. V4 must finish the single-part modeling core before expanding breadth.

This boundary is intentional. STEP import without direct modeling or feature recognition would mostly add a viewer. Feature-level patterns, lofts, and sweeps would add breadth while sketches remain imprecise. V4 spends that complexity budget on relationships, preview, recovery, and rebuild trust; those capabilities make every later feature safer to add.

## 4. V3 baseline and V4 correction

V3 already provides:

- a real OpenCascade B-rep kernel through replicad;
- STEP and STL export;
- a full-window CAD workspace;
- Solid, Sketch, Modify, and Inspect workspaces;
- model tree, canvas, inspector, ViewCube, axis triad, and navigation tools;
- rectangles, circles, and closed polygons;
- Extrude, Cut, Revolve, Fillet, Chamfer, Shell, and profile patterns;
- sketch-on-face, edge picking, face picking, parameters, expressions, history rebuild, undo/redo, and local autosave.

The V4 correction is that visible CAD chrome must correspond to real geometric behavior.

| V3 surface | V4 behavior required |
| --- | --- |
| Sketch workspace | Constraint-driven entity creation and editing |
| Status strip | Real snap, constraint, units, coordinates, and solver state |
| Inspector | One live draft shared with heads-up input and direct handles |
| Model tree | Sketch/feature identity, suppression, dependency and failure state |
| Canvas | Hover preselection, selection, grips, dimensions and feature previews |
| ViewCube | Standard views plus a real perspective/orthographic state |
| Undo/redo | Persisted document commands with recovery after reload |
| Project file | Versioned, migratable, forward-safe document |

## 5. Experience principles

### 5.1 Geometry is the interface

The V4 signature is not another toolbar. The memorable interaction is that geometry explains itself:

- snap targets appear before acquisition;
- constraints appear beside the entities they control;
- driving dimensions are readable and editable in the canvas;
- selected geometry exposes the correct grips;
- solid features appear as translucent previews before Apply;
- the same selection is visible in the canvas, tree, and inspector.

### 5.2 Pointing and typing are one action

Every geometric tool supports free pointing and exact input without forcing the user into a distant form. Values entered beside the cursor, in the inspector, or through a direct handle are views of the same draft state.

### 5.3 Nothing invalid destroys valid work

An invalid constraint, expression, preview, or downstream rebuild never replaces the last valid sketch or solid. It remains editable, explains the failure, and can be cancelled.

### 5.4 State must be visible

At all times the user can tell:

- what tool owns the next click;
- what will happen on Enter;
- what Escape will cancel;
- whether the sketch is under-constrained, fully constrained, or conflicting;
- which feature is rebuilding or failing;
- whether the document has committed changes not yet downloaded as a project file.

## 6. Visual and workspace contract

V4 retains the V3 dark precision workspace. It does not replace it with a new theme.

### 6.1 Color semantics

| Meaning | Color | Requirement |
| --- | --- | --- |
| Normal geometry | `#CFDCEA` | Neutral, readable against the dark canvas |
| Selected geometry | `#4C9AFF` | Paired with weight, grips, or outline—not color alone |
| Hover/preselection | `#8FC5FA` | Lighter than selection and never persistent |
| Fully constrained | `#65C98A` | Paired with a lock/solver label |
| Pending preview | `#F4A340` | Translucent solid plus outline and direction arrow |
| Conflict/failure | `#E36B6B` | Paired with an icon, text, and failing tree row |
| Construction/reference | `#8295A9` | Dashed and visually subordinate |

### 6.2 Typography and density

- normal panel text: at least `12px` desktop and `13px` mobile;
- field values: at least `12px` with tabular numerals;
- utility labels: at least `10px`, uppercase only for true system labels;
- no essential instruction may rely on text below `10px`;
- tool groups may be dense, but unused empty ribbon width must not create a second decorative header.

### 6.3 Stable regions

```text
┌ document bar ──────────────────────────────────────────────────────┐
├ Solid | Sketch | Modify | Inspect ─ contextual tools ─────────────┤
├──────────────┬──────────────────────────────────────┬──────────────┤
│ model tree   │ canvas                               │ inspector    │
│              │ dimensions / snaps / grips / preview │ live draft   │
│              │                                      │ properties   │
├──────────────┴──────────────────────────────────────┴──────────────┤
│ solver / snap / coordinates / units / instruction / apply-cancel │
└───────────────────────────────────────────────────────────────────┘
```

The canvas receives all remaining space. Help remains an in-app drawer. No documentation is appended below the workspace.

## 7. Shared interaction state machine

V4 uses one coordinator for every operation:

```text
Idle
  -> SelectingTarget
  -> EditingSketch | PickingGeometry
  -> PreviewingFeature
  -> Rebuilding
  -> Idle

Any active state
  -> Conflict or KernelError
  -> editable draft remains active
  -> Cancel restores pre-operation state
```

Required state object:

```ts
type StudioMode =
  | { kind: 'idle' }
  | { kind: 'selecting-target'; operation: FeatureType }
  | { kind: 'editing-sketch'; featureId: string; sketchId: string; tool: SketchTool }
  | { kind: 'picking-geometry'; featureId: string; target: 'edge' | 'face' }
  | { kind: 'previewing-feature'; featureId: string; revision: number }
  | { kind: 'rebuilding'; revision: number }
  | { kind: 'constraint-conflict'; sketchId: string; constraintIds: string[] }
  | { kind: 'kernel-error'; featureId: string; message: string };
```

Rules:

- only one mode owns pointer input;
- every editor operates on a draft copy;
- Apply produces exactly one document command;
- Cancel produces no document command and restores byte-identical document JSON;
- every other persistent mutation—including rename, suppress, parameter edit, grip release, constraint deletion, and Clear—also enters through the document-command pipeline exactly once;
- switching tools cancels an empty draft silently;
- switching tools from a dirty draft asks once before discarding it;
- rebuilding cannot accept geometry input;
- stale preview or rebuild replies may never overwrite a newer revision;
- selection, view movement, hover, and tool activation are session state, not document commands.

## 8. Unified selection model

V4 has one application selection, not separate tree, inspector, and canvas selections.

```ts
type SelectionItem =
  | { kind: 'feature'; featureId: string }
  | { kind: 'sketch-entity'; featureId: string; sketchId: string; entityId: string }
  | { kind: 'face'; ownerFeatureId: string; signature: FaceSignature }
  | { kind: 'edge'; ownerFeatureId: string; signature: EdgeSignature }
  | { kind: 'constraint'; sketchId: string; constraintId: string };

type Selection = {
  items: SelectionItem[];
  primaryIndex: number | null;
};
```

The primary item owns the inspector. Operation-specific filters may restrict a multi-selection to compatible item kinds.

### 8.1 Preselection

- hover highlights an eligible entity, edge, face, grip, or tree row before click;
- the highlight uses preselection color and never changes the document;
- operation filters make ineligible geometry visually unavailable;
- touch uses a generous acquisition radius and the existing step-through fallback.

### 8.2 Selection synchronization

- selecting a history feature highlights the geometry generated or affected by that feature;
- selecting visible geometry selects its owning feature or sketch entity in the tree;
- the inspector always shows the current selection or active draft, never both;
- clicking blank canvas clears idle selection;
- `Shift` adds eligible edges/faces/entities;
- `Cmd/Ctrl` toggles one item in a multi-selection;
- Escape clears selection only after active operations have already been cancelled.

## 9. Sketch entity model

V4 fundamental sketch entities are:

```ts
type SketchPoint = { x: number; y: number };

type SketchEntity =
  | { id: string; kind: 'line'; a: SketchPoint; b: SketchPoint; construction?: boolean }
  | { id: string; kind: 'arc'; center: SketchPoint; start: SketchPoint; end: SketchPoint; construction?: boolean }
  | { id: string; kind: 'circle'; center: SketchPoint; radius: number; construction?: boolean };

type SketchGroup = {
  id: string;
  kind: 'rectangle' | 'polygon' | 'offset-loop';
  entityIds: string[];
  creationMode?: 'corner' | 'center';
};
```

Entity coordinates are persisted nominal geometry for under-constrained degrees of freedom. A committed free placement or grip move updates them. A driving dimensional constraint, not a duplicate expression on the entity, is authoritative for a constrained degree of freedom. The transient solved coordinates remain derived state.

Rectangle and Polygon are creation macros:

- Rectangle creates four lines, four coincident constraints, two horizontal constraints, and two vertical constraints.
- Rectangle offers Corner and Centre creation modes; a centred rectangle records the driving width and height plus the constraints that keep its derived centre on the acquired point.
- Polygon creates line entities and coincident constraints between adjacent endpoints.
- Each macro creates a stable `SketchGroup` so it can be selected as a loop and expose derived centres without becoming a second geometry model.
- Legacy rectangle, circle, and polygon primitives migrate into these fundamental entities.
- Open and construction entities are allowed in sketches but cannot form a solid profile.
- The profile extractor finds closed loops after solving.
- Nested closed loops create voids using even-odd containment.
- Multiple disconnected loops are allowed when the resulting feature operation accepts them.

Every entity and group has a stable ID. Array position is never identity.

### 9.1 Creation behavior

- Line creates a continuous chain until double-click, Enter, or a click on the chain's start point closes and finishes it.
- Arc uses centre, start, then end; the pending arc and included angle remain visible before the third click.
- Circle uses centre, then circumference; typing a diameter creates a driving diameter constraint.
- Corner Rectangle uses two opposite corners. Centre Rectangle uses centre, then corner and creates driving width/height dimensions when exact values are entered.
- Polygon creates a closed line chain; double-click or clicking the start point closes it, while Escape cancels only the uncommitted segment first.
- Exact values entered during creation become driving constraints. Free pointer placement stores nominal coordinates and remains under-constrained.

### 9.2 External sketch references

A sketch on a planar face exposes derived, read-only reference geometry:

- sketch origin and horizontal/vertical axes;
- projected boundary lines/arcs;
- boundary vertices and midpoints;
- planar face area-centre projected into sketch coordinates.

Snapping with automatic constraints enabled creates a persistent constraint to the external reference, not a copied coordinate. Each reference stores the owner feature ID, the source face/edge signature, and the derived reference kind. Its projected coordinates are rebuilt, never persisted as authoritative geometry.

If the source topology changes, the resolver follows the topology reference contract in §17.3. A missing or ambiguous source fails only the dependent sketch feature, keeps its entities and constraints editable, and asks for reselection. It never freezes the last projected coordinate or silently binds to similar geometry.

## 10. Constraint system

### 10.1 Required constraints

V4 must implement:

- coincident;
- horizontal;
- vertical;
- parallel;
- perpendicular;
- tangent;
- equal length/equal radius;
- midpoint;
- point-on-object;
- fixed;
- horizontal distance;
- vertical distance;
- point-to-point distance;
- line length;
- radius;
- diameter;
- angle.

Each constraint has a stable ID and a `driving` flag. Driving dimensions control geometry. Reference dimensions report geometry and cannot over-constrain it.

```ts
type SketchConstraint = {
  id: string;
  kind: ConstraintKind;
  refs: SketchReference[];
  expression?: string;
  driving: boolean;
  auto?: boolean;
};
```

### 10.2 Solver state

The solver reports:

- remaining degrees of freedom;
- `under-constrained`, `fully-constrained`, or `conflicting`;
- an actionable conflicting set containing the newly attempted constraint and every existing constraint needed to reproduce that conflict;
- solved positions for display and profile generation;
- solve duration for diagnostics and performance tests.

The solver output is derived state and must not be persisted into the project document.

### 10.3 Conflict behavior

- a new conflicting constraint is previewed in red before commit;
- the conflicting constraint and the constraints it conflicts with are identified;
- the user may cancel the new constraint or convert a driving dimension to reference;
- an unresolved conflict blocks feature Apply but does not delete entities;
- the last valid solved sketch remains visible underneath the conflict preview;
- deleting a constraint is one undoable command.

## 11. Snapping and guidance

### 11.1 Required snap targets

- grid intersection;
- origin;
- endpoint;
- midpoint;
- line projection;
- circle and arc centre;
- rectangle centre derived from its four-line group;
- quadrant points;
- intersection;
- horizontal alignment;
- vertical alignment;
- active face-outline vertices, midpoints, centres, and projected axes.

### 11.2 Acquisition contract

- a snap marker and text label appear before the click is accepted;
- snap radius is measured in CSS pixels and remains usable at every zoom;
- only one winning snap is committed per click;
- priority is: explicit entity snap, intersection, alignment, origin, grid;
- `Alt/Option` temporarily suppresses snapping;
- Snap and Ortho are real status-strip toggles with pressed state and keyboard focus;
- automatic coincident/horizontal/vertical constraints are shown before creation;
- holding `Shift` temporarily suppresses automatic constraints without disabling positional snapping.

No invisible snap may silently change a point.

## 12. Heads-up input

A compact value chip follows the active cursor with enough offset to leave the target visible.

| Tool | Values |
| --- | --- |
| Line | length, angle |
| Rectangle | width, height |
| Circle | diameter |
| Arc | radius, included angle |
| Polygon | current segment length, angle |
| Move/Copy | ΔX, ΔY, distance, angle |
| Offset | distance and side |

Behavior:

- `Tab` cycles values;
- typing immediately replaces the active value;
- fields accept numbers, parameter names, and arithmetic expressions;
- length fields accept explicit `mm`, `cm`, `m`, `in`, and `ft` suffixes; angle fields accept degrees;
- `Enter` accepts the active value or completes the tool when all required values are valid;
- `Escape` leaves the field first, then cancels the current placement on the next press;
- inspector fields and heads-up fields bind to the same draft object;
- invalid input remains visible and reports the exact field error;
- the chip never covers the acquired snap marker.

### 12.1 Units

- the document display unit is `mm` or `in` and is always visible in the status strip;
- internal kernel length is millimetres and internal angle is degrees;
- a unitless length is interpreted in the current document display unit;
- explicit mixed-unit input such as `25.4 mm`, `1 in`, or `width + 1/8 in` converts deterministically;
- changing the display unit reformats values and dimensions but never scales geometry;
- source expressions retain their explicit unit suffixes;
- generated STEP/STL geometry uses the same committed physical size regardless of display unit.

## 13. Sketch selection, grips, and modification

### 13.1 Grips

Selected entities expose:

- line: both endpoints and midpoint;
- circle: centre and radius grip;
- arc: centre, start, end, and radius grip;
- multi-selection: one translation grip at the selection centroid.

Grip dragging:

- updates the sketch and solver preview at interactive frame rate;
- preserves all satisfiable constraints;
- reports a conflict before commit;
- creates one document command on pointer release;
- restores the pre-drag sketch on Escape;
- offers exact ΔX/ΔY or distance/angle through heads-up input.

### 13.2 Required modify tools

- Move;
- Copy;
- Delete;
- Trim line/arc to nearest eligible intersection;
- Offset one closed loop by an exact distance.

Trim and Offset show the affected result before click. If multiple trim results are possible, hover preselection shows the segment that will remain.

## 14. Feature previews

Every existing solid feature uses the same draft-preview-commit contract:

```text
Select profile/geometry
  -> create feature draft
  -> request exact preview
  -> display translucent result and affected geometry
  -> edit value/handle/selection
  -> Apply one command or Cancel with no command
```

### 14.1 Preview rendering

- the committed solid remains visible in neutral material;
- added material is translucent amber;
- removed material is translucent red-orange with a clear cut boundary;
- selected faces/edges use selection color and weight;
- preview errors keep the last valid preview or committed solid visible;
- the inspector and command strip show the same error message;
- preview meshes are disposable derived state and never enter the document.

### 14.2 Extrude

Required controls:

- distance expression;
- reverse direction;
- symmetric about sketch plane;
- live direction arrow and distance handle;
- direct handle drag synchronized with the numeric field.

### 14.3 Cut

Required controls:

- distance expression;
- through all;
- reverse direction;
- symmetric cut;
- live direction/extent handle when not through-all.

### 14.4 Revolve

Required controls:

- profile;
- axis selected from a sketch line, construction line, or base axis;
- angle from `0 < angle ≤ 360°`;
- reverse direction;
- exact preview before Apply.

Legacy revolve features migrate to the base vertical axis and `360°`.

### 14.5 Fillet, Chamfer, and Shell

- direct canvas picking is primary;
- step-through selection remains available;
- the preview updates after each selection and value change;
- Fillet exposes radius;
- Chamfer exposes distance;
- Shell exposes wall thickness and opening faces;
- kernel refusal identifies the active feature and suggests a smaller value or simpler selection without discarding picks.

### 14.6 Patterns

V4 names the existing behavior **Profile pattern**, not Feature pattern.

- Linear profile pattern: count, ΔX, ΔY;
- Circular profile pattern: count and centre;
- exact preview is required;
- feature-level patterning is deferred.

## 15. Model tree and dependency behavior

Each row shows:

- feature icon and editable name;
- feature type and principal dimension;
- suppressed, rebuilding, failed, or healthy state;
- nested sketch disclosure for sketch-based features;
- dependency warning when an upstream feature is being deleted or suppressed.

Required actions:

- Select;
- Rename;
- Edit;
- Suppress/Unsuppress;
- Delete.

Rules:

- suppression preserves the feature definition and skips it during rebuild;
- suppressing or deleting an upstream feature previews the affected downstream feature IDs before confirmation;
- downstream failures preserve their definitions and remain editable;
- deleting a feature is one undoable command;
- reorder controls are not rendered in V4;
- tree selection and canvas selection use the shared selection model.

## 16. Inspector contract

The inspector has exactly one owner:

1. active operation draft;
2. current selection;
3. empty selection guidance.

It never shows permanent parameters beside an unrelated active draft on desktop. Parameters become their own inspector tab when nothing parameter-specific is selected.

Inspector fields:

- show source expression and evaluated value;
- commit on Enter or explicit Apply according to the active operation;
- preserve invalid text until corrected or cancelled;
- show dependent parameter names;
- expose units in the label;
- never commit on blur alone during an active feature preview;
- remain keyboard navigable in a predictable top-to-bottom order.

## 17. Document format

V4 project files use schema version `4`.

```json
{
  "schemaVersion": 4,
  "units": "mm",
  "title": "Untitled part",
  "sourceItemId": null,
  "params": [
    { "id": "param-width", "name": "width", "expression": "60" }
  ],
  "features": [
    {
      "id": "feature-base",
      "type": "extrude",
      "name": "Base plate",
      "suppressed": false,
      "plane": { "kind": "base", "plane": "XY" },
      "sketch": {
        "id": "sketch-base",
        "entities": [],
        "constraints": []
      },
      "extent": {
        "kind": "distance",
        "expression": "5",
        "reversed": false,
        "symmetric": false
      }
    }
  ],
  "metadata": {
    "createdAt": "2026-07-20T00:00:00.000Z",
    "updatedAt": "2026-07-20T00:00:00.000Z",
    "generator": "BOMwiki CAD Studio V4"
  }
}
```

### 17.1 Format rules

- every parameter, feature, sketch, entity, entity group, external reference, and constraint has a stable ID;
- array index is never used as a durable reference;
- user-entered expressions are preserved verbatim;
- `units` is exactly `mm` or `in`; changing it changes display interpretation, never stored physical geometry;
- evaluated numbers, meshes, solver output, build errors, selection, hover, view, and mode are derived state;
- face and edge references include owning feature ID plus geometric signature;
- unknown fields in a valid schema-4 document are preserved losslessly at their original object path through open and save;
- a newer unsupported schema is refused as editable, leaves the active document unchanged, and is never autosaved or downloaded over;
- exports contain the exact currently committed rebuild, never an uncommitted preview.

### 17.2 Migration

The migration pipeline accepts:

- unversioned current documents;
- prototype v1 storage without deleting it;
- any fixture produced by shipped V2/V3 studio code;
- schema version 4.

Migration converts:

- rectangles into constrained line groups;
- polygons into constrained line chains;
- circles into circle entities;
- embedded numeric values into expression strings;
- legacy revolve into `360°` around the base vertical axis;
- legacy face/edge signatures into owner-aware references when ownership can be inferred.

Migration is deterministic, idempotent, and covered by byte-stable fixtures. The original stored document remains available until the migrated document rebuilds successfully. If a legacy face or edge owner cannot be inferred uniquely, the dependent feature migrates in a failed-but-editable state and asks the user to reselect; migration never guesses.

### 17.3 Topology reference contract

Face and edge references use feature lineage plus an owner-scoped geometric signature, never mesh indices.

```ts
type FaceSignature = {
  ownerFeatureId: string;
  semanticPath?: string;
  surface: 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'other';
  area: number;
  centroid: [number, number, number];
  normalOrAxis?: [number, number, number];
  adjacentSurfaceKinds: string[];
};

type EdgeSignature = {
  ownerFeatureId: string;
  semanticPath?: string;
  curve: 'line' | 'circle' | 'ellipse' | 'spline' | 'other';
  length: number;
  endpoints?: [[number, number, number], [number, number, number]];
  centreOrAxis?: [number, number, number];
  adjacentFaces: Array<{ semanticPath?: string; surface: FaceSignature['surface'] }>;
};
```

`semanticPath` is a deterministic role emitted by a feature builder—for example an Extrude start/end cap or a lateral face/edge derived from a stable sketch entity ID. Measurements describe the geometry but do not become identity by themselves.

Resolution rules:

1. search only topology descended from `ownerFeatureId`;
2. resolve an exact surviving `semanticPath` from feature/kernel lineage when available;
3. otherwise filter by surface or curve type and adjacency, then score scale-aware geometric similarity;
4. accept only one best match separated from the runner-up by the documented confidence margin;
5. otherwise return a missing or ambiguous reference failure and require reselection.

The resolver, scoring weights, tolerances, and confidence margin are deterministic and shared by preview, rebuild, reload, and export. Tests must include dimension changes where area, length, and centroid move while the semantic face or edge survives.

### 17.4 Validation and resource limits

- project JSON is parsed as data and never passed to `eval`, `Function`, or executable module loading;
- expressions use the studio's allowlisted arithmetic parser and reject property access, assignment, calls outside the supported math functions, `NaN`, and infinity;
- validation rejects duplicate IDs, dangling internal references, invalid enum values, and cyclic parameter dependencies before document replacement;
- a project file over `10 MB`, 500 features, 5,000 sketch entities, or 10,000 constraints is refused with a limit-specific message;
- validation and migration operate on a detached candidate document; any failure leaves the active document, recovery journal, and command stacks unchanged.

## 18. Persistence and recovery

- the active document autosaves only after committed document commands;
- the browser stores the active document, up to the last 100 document commands with their cursor, and the last 20 committed recovery snapshots in IndexedDB;
- decoded undo/redo payloads are capped at `16 MiB`; when the cap is reached the oldest reachable command is pruned first, so a valid `10 MB` project can never expand into a gigabyte-scale journal record;
- undo and redo stacks survive same-origin page reload, tab close/reopen, and browser restart for the active project;
- an interrupted preview never becomes the current document;
- startup detects an interrupted worker/rebuild and opens the last committed snapshot;
- Download project writes `.bomcad.json` with schema version 4;
- Open project validates and migrates before replacing the current project;
- a valid Open atomically switches to a new project ID and its command journal; it is a project-boundary action, not an undo command, and the previous project remains available through Recover;
- a malformed or unsupported file leaves the document and undo/redo stacks untouched;
- storage failure never blocks modeling or STEP/STL export;
- Clear remains undoable and never resurrects the starter part after reload.

Project > Recover groups the last 20 committed snapshots by project ID and title, then lists local time and feature count. Opening a snapshot switches to that project journal; restoring an older snapshot inside the active project is itself undoable. These local snapshots are crash recovery, not cloud version history, and the UI labels them accordingly.

The document bar shows:

- editable project title;
- `Saved locally`, `Saving…`, or `Storage unavailable`;
- `Project file current` or `Project file changed` relative to the last downloaded/opened project snapshot.

## 19. Worker architecture and performance

OpenCascade loading, exact feature previews, rebuilds, meshing, STEP export, and STL export run in a dedicated Web Worker.

The main thread owns:

- UI state;
- pointer handling;
- sketch solver and 2D preview;
- committed document and draft documents;
- selection and camera.

The worker owns:

- OpenCascade runtime;
- B-rep shapes;
- exact solid rebuild;
- topology signature extraction;
- preview/final display meshes;
- STEP/STL blobs.

Every request carries:

```ts
type KernelRequest = {
  projectId: string;
  revision: number;
  kind: 'preview' | 'rebuild' | 'export-step' | 'export-stl';
  document: CadDocumentV4;
  activeFeatureId?: string;
};
```

Rules:

- only the newest revision may update the visible preview or solid;
- stale replies are discarded;
- pending preview requests may be coalesced;
- committed rebuilds are never discarded in favor of an older preview;
- transferable typed arrays are used for display meshes;
- worker restart reloads the last committed document automatically;
- no worker error may corrupt autosave.

### 19.1 Performance gates

Automated measurements use the Puppeteer-pinned Chrome build on the standard Linux CI runner after one warm-up run. The release packet also records the same measurements on the reference floor: Apple M1, 8 GB RAM. A faster machine may be reported separately but cannot replace the reference-floor result. Each packet records browser version, logical CPU count, memory, fixture hash, and five-run median/p95 values.

Required gates:

- application controls accept focus and clicks within `500 ms` of `DOMContentLoaded` without waiting for kernel initialization;
- sketch pointer preview: median under `16 ms`, p95 under `32 ms`;
- the versioned `solver-100` fixture: solve median under `16 ms`, p95 under `32 ms`, and conflict-set analysis under `50 ms`;
- inspector field feedback: under `100 ms`;
- preview request visually acknowledged within `100 ms` even while the exact kernel result is pending;
- the versioned `performance-20-feature` rebuild: under `1 s` median, under `2 s` p95 after kernel load;
- while a rebuild is pending, 95% of sampled orbit frames complete within `32 ms` and pointer-to-camera response stays below `100 ms`;
- across 100 rebuilds, after 20 warm-up rebuilds, the median retained worker heap plus live mesh-buffer bytes in the final 20 runs may not exceed the preceding 20-run window by more than `10%`.

## 20. Navigation and view

V4 retains Top, Front, Right, Isometric, and Fit.

Required additions:

- perspective/orthographic toggle;
- Fit selection when geometry is selected, otherwise Fit part;
- entering sketch mode aligns normal to the sketch plane;
- Apply and Cancel restore the prior 3D camera;
- sketch grid follows the selected plane;
- double-click face alignment remains disabled while a pick or sketch tool owns input;
- navigation changes never enter undo history.

The ViewCube may remain visually compact, but its top/front/right faces, isometric control, and view state must remain synchronized with ribbon view controls.

## 21. Keyboard, touch, and accessibility

| Action | Shortcut |
| --- | --- |
| Cancel one level | `Escape` |
| Apply/finish valid operation | `Enter` |
| Next heads-up field | `Tab` |
| Previous heads-up field | `Shift+Tab` |
| Undo | `Cmd/Ctrl+Z` |
| Redo | `Cmd/Ctrl+Shift+Z`, `Ctrl+Y` |
| Delete selection | `Delete`, `Backspace` |
| Fit selection/part | `F` |
| Temporary pan | hold `Space` |
| Suppress snaps | hold `Alt/Option` |
| Suppress automatic constraints | hold `Shift` |

Requirements:

- every core tool has a visible text name and pressed/selected state;
- every mode change is announced through a polite live region;
- snap type, constraint state, selection, and failure use shape/text as well as color;
- all numeric fields have explicit labels and inline errors;
- focus returns to the originating tool or selected tree row after Apply/Cancel;
- mobile touch targets are at least `44 × 44 CSS px`;
- touch acquisition radius is at least `14 CSS px` and independent of zoom;
- step-through face and edge selection remains available;
- reduced-motion preference disables animated preview transitions without disabling state feedback;
- canvas-only operations have keyboard-accessible equivalents through the tree/inspector where precision pointer interaction is not possible.

## 22. Mobile contract

V4 mobile remains a full modeling surface for the canonical part, not a read-only viewer.

- workspace tabs remain horizontally available;
- Model, Parameters, Properties, and Project use mutually exclusive bottom sheets;
- heads-up values may dock above the command strip when they would cover the touch target;
- the active geometry area never falls below `44%` of viewport height while a sheet is open;
- selecting a feature opens Properties, not a mystery panel;
- Project shows named Save, Open, Clear, STEP, and STL actions;
- no horizontal page overflow at `320`, `375`, `390`, or `430 CSS px` widths;
- the canonical plate scenario must be completable at `390 × 844` without a hardware keyboard.

## 23. Error and failure behavior

### 23.1 Sketch errors

- open profile: identify the unclosed endpoints;
- self-intersection: highlight the intersecting segments;
- zero-length entity: prevent creation and explain the minimum gesture/value;
- over-constraint: identify conflicting constraints before commit;
- invalid expression: preserve text and last valid solution;
- failed Offset/Trim: preserve original entities.

### 23.2 Kernel errors

- identify the first failing feature;
- preserve and display the last valid accumulated solid;
- keep all later feature definitions in the tree;
- distinguish missing reference from kernel refusal;
- provide an actionable suggestion tied to the operation;
- block export while committed features are failed;
- never add a failed preview to undo history.

### 23.3 Reference failures

- face/edge references include owner feature ID plus signature;
- a missing reference marks only the dependent feature failed;
- editing the failing feature reopens selection with surviving references highlighted;
- deletion/suppression confirmation lists direct dependents;
- recovery never silently selects a different geometrically similar face or edge.

## 24. First-run and Help

### 24.1 Template-first entry

The first-run choice is:

- Browse editable templates;
- Start blank sketch;
- Open project.

Templates are normal parametric documents, never preview-only meshes. The first release includes at least 24 useful single-part starters across Basics, Mounting, Mechanical, Enclosures, and Workshop. Every template has:

- a stable ID, name, category, search tags, practical description, nominal envelope, and difficulty;
- named parameters and a valid editable feature history;
- a compact orthographic silhouette rather than a decorative product render;
- a visible feature recipe before the document is opened;
- document-boundary validation in the browser regression suite.

The library behaves like a parts cabinet inside the application: searchable, category-filterable, keyboard reachable, and usable at desktop and mobile sizes. Choosing a template starts a new project and preserves an existing project in Recover after explicit confirmation. A persistent Templates command remains available after first run, and Help links to the same cabinet.

The first-run launchpad shows four practical quick starters plus Browse all templates, Blank sketch, and Open project. It says plainly that starters are editable CAD, not locked geometry.

### 24.2 Anchored walkthrough

Opening the first template starts a four-step, dismissible walkthrough over real controls:

1. identify the ordered feature recipe in the model tree;
2. select a feature and edit a driving value in the Inspector;
3. orbit the part and use Fit to restore the complete view;
4. save the editable project or export STEP/STL.

Starting blank instead points to the live sketch Shape, canvas, Height, and Apply controls. Finishing or skipping persists the choice; Help can replay the walkthrough at any time. Every step highlights exactly one rendered target and remains usable on a 375 px viewport.

When the Slice 4B solver ships, the canonical plate walkthrough expands over those same live surfaces to cover:

1. draw and dimension a rectangle;
2. read the solver status;
3. preview and apply Extrude;
4. acquire the plate-centre snap;
5. create a diameter constraint;
6. preview and apply through-all Cut;
7. revise a driving dimension and undo it.

Help documents only behavior that exists in the released build. It must not claim publishing, version history, STEP import, assemblies, drawings, or constraint types that are not implemented.

## 25. Test architecture

### 25.1 Unit tests

- expression parsing and parameter dependency detection;
- mixed-unit expression conversion and display-unit changes without geometry scaling;
- sketch solver constraints and conflict sets;
- snap ranking and acquisition radius;
- profile loop extraction and nested-loop classification;
- document validation and every migration fixture;
- schema-4 unknown-field preservation and resource-limit rejection;
- dependency graph and suppression propagation;
- semantic-path resolution, unique geometric fallback, and ambiguous-reference refusal;
- stale worker revision rejection.

### 25.2 Kernel geometry tests

Golden project fixtures:

- centred-hole plate;
- L bracket with line/arc sketch;
- shelled enclosure;
- revolved knob;
- patterned hole plate;
- failed upstream reference with recoverable downstream definitions.

For each fixture verify:

- successful rebuild or expected isolated failure;
- bounding box;
- volume within tolerance;
- face/edge reference recovery after specified upstream edits;
- STEP and STL blob generation;
- no leaked kernel objects across repeated rebuilds.

### 25.3 Browser interaction tests

Required flows:

- every tool enters and exits the correct coordinator state;
- heads-up input and inspector remain synchronized;
- snap marker appears before acquisition;
- snapping to projected face geometry creates a persistent external constraint;
- constraint commit is exactly one undo entry;
- grip drag is exactly one undo entry;
- conflict and kernel errors never modify the committed document;
- feature preview Apply/Cancel ordering;
- canvas/tree/inspector selection synchronization;
- suppression and dependency warnings;
- reload recovery of document and command history;
- recovery snapshot listing and undoable restore;
- malformed/newer project file safety;
- valid project Open switches journals atomically without merging undo history;
- mobile canonical plate flow using visible controls and real pointer events;
- keyboard focus and screen-reader state.

### 25.4 Visual regression states

Capture at `1600 × 1000`, `1280 × 720`, and `390 × 844`:

- idle starter part;
- first-run walkthrough;
- under-constrained sketch;
- fully constrained sketch;
- snap acquisition;
- selected entity with grips;
- Extrude preview;
- Cut preview;
- selected history feature and inspector;
- constraint conflict;
- failed kernel feature;
- mobile Project and Properties sheets.

No release is accepted from DOM checks alone.

## 26. Acceptance scenarios

### 26.1 Canonical plate

1. Start blank.
2. Create a centred rectangle with width `60` and height `40`.
3. Verify the sketch reports fully constrained.
4. Preview and apply a `5 mm` Extrude.
5. Select the top face and enter sketch mode.
6. Acquire the face-centre snap before clicking.
7. Create a circle with diameter `8 mm`.
8. Preview and apply a through-all Cut.
9. Fillet four outer vertical edges by `2 mm`.
10. Change width to `80 mm`.

Expected: the circle has a persistent external face-centre relationship; the hole remains centred, the solid rebuilds, no references silently change, and every commit can be undone/redone.

### 26.2 Constrained bracket

1. Draw an open line chain with horizontal and vertical auto-constraints.
2. Add an arc tangent to two lines.
3. Close the profile using endpoint snapping.
4. Apply dimensions and reach fully constrained.
5. Extrude with reverse direction, then change to symmetric.

Expected: constraints remain visible and editable; the solid preview updates before Apply.

### 26.3 Constraint conflict

1. Fix a horizontal line at `40 mm`.
2. Attempt to add a conflicting `50 mm` driving dimension.

Expected: the new dimension and conflict set are highlighted; the `40 mm` valid solution remains; Cancel restores the byte-identical document.

### 26.4 Upstream reference failure

1. Create a base Extrude.
2. Add a face Cut and edge Fillet.
3. Edit the base so the selected face or edge disappears.

Expected: only dependent features fail, their definitions remain, no alternate edge/face is silently substituted, and Edit reopens selection for repair.

### 26.5 Recovery

1. Make five committed changes and two undos.
2. Reload the browser.
3. Redo one command.
4. Open a malformed project file.

Expected: document and command position recover; redo works; the malformed file changes neither document nor stacks.

### 26.6 Mobile

Complete the canonical plate at `390 × 844` using touch-sized controls only.

Expected: no horizontal overflow, no hidden Apply/Cancel controls, named Project actions, and enough visible canvas to acquire snaps.

### 26.7 Performance

Rebuild the versioned `performance-20-feature.bomcad.json` fixture 100 times while scripted pointer input orbits the camera and alternates one early parameter.

Expected: orbit frame and input-latency budgets pass, stale revisions never flash, rebuild timing passes, and retained memory stays within the final-window growth budget.

### 26.8 Units

1. Model a `25.4 mm` cube in an inch-display document.
2. Change display units to millimetres and back to inches.
3. Export STEP and STL after each change.

Expected: the displayed dimension changes between `1 in` and `25.4 mm`; bounding box, volume, and exported physical size remain identical within the geometry-test tolerance.

## 27. Delivery slices

V4 ships only when all slices are complete. Slices are implementation boundaries, not separate product releases.

### Slice 4A — trusted document and kernel boundary

- schema version 4;
- migrations and recovery journal;
- stable IDs and owner-aware topology references;
- worker protocol and stale-revision handling;
- shared selection and dependency model.

Gate: every document shape emitted by shipped legacy code has a fixture that migrates, rebuilds, saves, reopens, and survives malformed/newer file attempts without data loss.

### Slice 4B — precision sketch core

- entity and constraint model;
- solver state and conflict handling;
- Line, Arc, Rectangle, Circle, Polygon;
- snaps, auto-constraints, heads-up input;
- dimensions, selection, grips, Move, Copy, Delete.

Gate: canonical plate sketch and constrained bracket sketch complete without using distant parameter forms.

### Slice 4C — modification and solid previews

- Trim and Offset;
- exact previews for every existing solid feature;
- Extrude/Cut direct handles and direction modes;
- connected canvas/tree/inspector selection;
- rename, suppress, dependency-aware delete;
- orthographic view and sketch-camera restoration.

Gate: canonical plate completes through fillet, survives an upstream edit, and remains fully reversible.

### Slice 4D — hardening and release proof

- anchored first-run walkthrough;
- mobile canonical flow;
- visual/accessibility audit;
- golden geometry suite;
- 20-feature performance fixture and 100-rebuild memory run;
- Help and FAQ truth audit.

Gate: all acceptance scenarios pass locally, in CI, and in a production-candidate browser build.

## 28. Definition of done

V4 is complete only when:

- the canonical plate and constrained bracket scenarios pass with real pointer and keyboard input;
- sketches expose visible solver status, snaps, constraints, dimensions, and grips;
- every existing solid feature previews before committing;
- Apply and Cancel are transactional across every operation;
- document schema 4 and every migration fixture pass;
- browser reload recovers the document and command position;
- OpenCascade work no longer blocks main-thread interaction;
- the 20-feature and memory gates pass;
- desktop and mobile visual regressions are reviewed by a human;
- Help contains no future-tense capability claims presented as current behavior;
- the release is deployed through the protected `wiki/engine` CI workflow and verified on the public `/cad/studio` route.

The V4 release statement may then say:

> BOMwiki CAD Studio is a browser-based parametric modeler for dimensionally correct single parts, with constrained sketches, editable feature history, exact solid previews, and STEP/STL export.

It must still state plainly that assemblies, drawings, imported STEP editing, and cloud collaboration are not included.
