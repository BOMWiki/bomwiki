# BOMwiki CAD Studio V5 — complex mechanical modeling specification

Status: normative implementation and release contract

Product baseline: CAD Studio production at `wiki/engine@0d1a5aef9`

Prerequisite contract: `CAD_STUDIO_V4_SPEC.md`

Target route: `/cad/studio`

Target release: V5

Primary release proof: a credible, editable, sectionable shrouded turbofan built from normal CAD features inside the public Studio

Primary comparators: the multi-body part and basic assembly workflows in Onshape, Fusion, FreeCAD, and SolidWorks—not their simulation, CAM, drawings, cloud collaboration, or aerospace analysis suites.

## 1. Product decision

V4 makes simple single-part modeling precise and trustworthy. V5 must make complex mechanical form possible without scripts, prebuilt meshes, or hidden template-only geometry.

The product promise is:

> Build several real solids, shape them with reusable reference geometry, assemble them precisely, inspect their relationships, and export the same mechanical structure you see on the canvas.

The release is defined by one complete complex-modeling loop:

1. create or activate a part;
2. create named bodies and reusable datum geometry;
3. sketch on controlled planes and projected references;
4. create lofted, swept, revolved, extruded, and patterned geometry;
5. position, copy, mirror, and combine bodies without losing identity;
6. turn parts into reusable assembly components;
7. align components with explicit mates;
8. inspect the result with section, isolate, measure, and interference tools;
9. revise an early dimension and rebuild every dependent body and component predictably;
10. save and export a structurally equivalent STEP assembly.

If the turbofan can only be produced by loading opaque JSON, importing a finished mesh, generating geometry outside the application, or fusing everything into one uninspectable solid, V5 has not shipped.

## 2. User and job

The primary user is a maker, mechanical designer, robotics builder, student, repairer, or BOMwiki contributor who has outgrown a single printable bracket but does not need an enterprise engineering suite.

The primary job is:

> Model a small mechanical product with shaped parts and repeated components, verify that the parts fit, then preserve or exchange the design without losing its structure.

Representative V5 jobs include:

- a ducted fan or turbofan demonstrator;
- a gearbox with shafts, gears, bearings, and enclosure;
- a small pump with impeller, casing, shaft, and cover;
- a wheel hub and brake assembly;
- a robot joint with bracket, bearing, shaft, and motor;
- a propeller or turbine rotor with shaped blades;
- a simple aircraft or drone assembled from reusable components.

V5 is not an aerospace certification tool. The turbofan is a demanding modeling and assembly benchmark, not a claim that BOMwiki performs production turbine design, CFD, FEA, thermal analysis, or safety certification.

## 3. Release boundary

### 3.1 Required in V5

- multiple named solid bodies inside a part;
- body-aware feature history and body-level Boolean operations;
- datum planes, axes, points, and coordinate systems;
- numeric Move, Rotate, Align, Copy, Mirror, and Scale operations;
- general Loft and Sweep features with guide/reference controls;
- improved Revolve with selectable axes and partial angles;
- body- and feature-level linear, circular, and mirror patterns;
- draft, variable fillet, and robust shell/thicken workflows;
- a reusable component and assembly document model;
- rigid component transforms plus concentric, coincident, distance, angle, and fixed mates;
- component and subassembly hierarchy;
- hide, show, isolate, suppress, rename, reorder, and group controls;
- section/cutaway, exploded, measure, mass-property, and interference tools;
- per-body or per-component materials and appearances;
- structured multi-body and assembly STEP import/export boundaries;
- a worker-based rebuild pipeline that remains responsive on the V5 performance fixtures;
- a generic-feature turbofan acceptance project built in the application and stored as an editable golden fixture;
- migration of every valid V4 project without geometry or history loss.

### 3.2 Explicitly not in V5

- CFD, FEA, thermal, fatigue, vibration, combustion, or acoustic simulation;
- production turbomachinery performance prediction;
- CAM, toolpaths, G-code, nesting, or additive slicing;
- manufacturing drawings, GD&T, title blocks, or tolerance-stack analysis;
- sheet metal, weldments, harness routing, piping systems, or mold tooling;
- kinematic or dynamic motion simulation beyond mate manipulation and collision checks;
- cloud project sharing, branches, multiplayer editing, comments, or approval workflows;
- PLM, change orders, supplier management, or production BOM management;
- native DWG editing;
- feature recognition that reconstructs parametric history from arbitrary STEP solids;
- generative design or text-to-CAD as a release gate;
- a turbofan-specific geometry engine that bypasses generic Loft, Sweep, Pattern, Transform, Boolean, and Assembly behavior.

### 3.3 Mobile boundary

V4's simple-part mobile editing contract remains supported. V5 complex assembly authoring is desktop-first.

At mobile widths V5 must support:

- opening and safely recovering V5 projects;
- orbit, pan, zoom, standard views, Fit, section view, explode, hide, isolate, and selection;
- tree inspection, parameters, component properties, measurements, and comments embedded in project metadata;
- changing existing numeric feature and mate values when the edit does not require precision canvas selection;
- project save and STEP/STL export.

Mobile V5 is not required to create loft guide curves, manipulate assembly triads, or author new mates. Those controls must be hidden or clearly disabled, never rendered as unusable miniature desktop controls.

## 4. Existing baseline and required correction

The production Studio already provides:

- an OpenCascade B-rep kernel through replicad;
- STEP and STL export;
- a full-window dark CAD workspace;
- model tree, ribbon, inspector, ViewCube, axis triad, and navigation;
- Extrude, Cut, Revolve, Fillet, Chamfer, Shell, and profile patterns;
- basic sketch-on-face and edge/face picking;
- named parameters, expressions, feature history, undo/redo, recovery, and local persistence;
- editable starter templates;
- a direct sketch-to-solid Press/Pull flow.

The current complex-modeling failure is visible in the attempted turbofan:

| Current behavior | V5 correction |
| --- | --- |
| One accumulated solid is the practical document model | Parts contain stable named bodies and features declare body inputs/outputs |
| A blade is a flat polygon extruded once | A blade is lofted from root, mid, and tip profiles with twist, taper, sweep, and root blending |
| Circular pattern operates as a profile shortcut | Features, bodies, and components can be patterned around a selected axis with correct occurrence rotation |
| Revolve uses an implicit fixed axis | Revolve references any datum/sketch axis and supports partial or symmetric angles |
| Geometry is positioned by sketch coordinates | Bodies and components have explicit numeric transforms and manipulators |
| Separate engine stages cannot be represented | Parts, components, subassemblies, suppression, and visibility preserve structure |
| The casing hides the internal model | Persistent section and cutaway views expose internals non-destructively |
| All geometry shares one appearance | Materials and appearances are assigned per body/component |
| A visually plausible result is treated as success | Solid validity, body count, clearance, interference, mass, and export structure are checked |

## 5. Experience principles

### 5.1 Structure is visible

The canvas, tree, and inspector must expose the same part/body/component structure. A user must never need to infer whether two shapes are one body, separate bodies, or separate component instances.

### 5.2 Generic features earn complex results

The turbofan fixture must be built from normal datum, sketch, loft, sweep, revolve, transform, pattern, Boolean, component, mate, and appearance operations. A starter template may automate those commands, but every result remains ordinary editable document data.

### 5.3 Placement is explicit

Every nontrivial placement has a visible transform, mate, dimension, or reference. Hidden coordinate offsets are not an acceptable assembly system.

### 5.4 Invalid work cannot replace valid work

A failed Boolean, loft, sweep, mate solve, interference check, import, or export preserves the last valid committed document and visible geometry. The failing draft remains editable and Cancel remains lossless.

### 5.5 Repetition remains lightweight

Patterns and assembly instances reference one source definition. Twelve fan blades must not become twelve unrelated copies unless the user explicitly dissolves the pattern.

### 5.6 Inspection is part of modeling

Section, isolate, measure, mass, clearance, and interference are primary modeling tools, not afterthoughts. The user must be able to prove why a complex model is credible.

## 6. Workspace and navigation contract

V5 keeps the full-window dark precision workspace and V4 interaction semantics.

### 6.1 Workspaces

The ribbon exposes these workspaces:

- **Part** — sketches, datums, solid and surface features, bodies, transforms, patterns, and Booleans;
- **Assembly** — components, subassemblies, mates, patterns, explode, and interference;
- **Inspect** — section, measure, mass properties, geometry validity, clearance, and display modes;
- **Output** — project save/open/recovery plus STEP/STL import/export.

The active document type determines which workspaces are enabled. Tools that do not apply remain hidden or explicitly disabled with a reason.

### 6.2 Stable regions

```text
┌ document tabs / project state / undo / project / output ──────────────────┐
├ Part | Assembly | Inspect | Output ─ contextual ribbon groups ───────────┤
├────────────────┬──────────────────────────────────────┬───────────────────┤
│ structure tree │ canvas                               │ inspector         │
│ parts          │ selection / previews / manipulators │ feature or mate   │
│ bodies         │ sections / measurements / triads    │ expressions       │
│ features       │                                      │ validation        │
├────────────────┴──────────────────────────────────────┴───────────────────┤
│ mode / selection filter / coordinates / units / rebuild / apply-cancel  │
└──────────────────────────────────────────────────────────────────────────┘
```

The canvas receives all remaining space. Help remains a drawer. No long documentation page is appended below the application.

### 6.3 Tree hierarchy

Part document:

```text
Part: Fan blade
  Origin
    XY / XZ / YZ planes
    X / Y / Z axes
  Datums
    Root plane
    Mid plane
    Tip plane
    Rotation axis
  Bodies
    Blade
      Root sketch
      Mid sketch
      Tip sketch
      Loft
      Root fillet
```

Assembly document:

```text
Assembly: Turbofan
  Origin
  Components
    Nacelle:1
    Fan rotor:1
      Spinner:1
      Fan disk:1
      Fan blade:1 ×12 pattern
    Compressor module:1
    Turbine module:1
  Mates
  Sections
  Exploded views
```

Tree rows expose kind, visibility, suppression, failure, active/edit state, and occurrence count without relying on color alone.

## 7. Document architecture and schema

V5 introduces project schema version 5. V4 schema-4 projects migrate into one local part definition with one initial body whose geometry and feature order remain unchanged.

```ts
type CadProjectV5 = {
  schemaVersion: 5;
  projectId: string;
  name: string;
  units: DocumentUnits;
  parameters: ParameterDefinition[];
  materials: MaterialDefinition[];
  partDefinitions: PartDefinition[];
  assemblyDefinitions: AssemblyDefinition[];
  rootDocument: DocumentRef;
  resources: ProjectResource[];
  metadata: ProjectMetadata;
  extensions?: Record<string, unknown>;
};

type DocumentRef =
  | { kind: 'part'; partId: string }
  | { kind: 'assembly'; assemblyId: string };

type PartDefinition = {
  id: string;
  name: string;
  parameters: ParameterDefinition[];
  referenceGeometry: ReferenceGeometry[];
  sketches: SketchDefinition[];
  bodies: BodyDefinition[];
  features: PartFeature[];
  featureOrder: string[];
  defaultAppearanceId?: string;
  metadata?: Record<string, unknown>;
};

type BodyDefinition = {
  id: string;
  name: string;
  kind: 'solid' | 'surface';
  createdByFeatureId: string;
  featureIds: string[];
  visible: boolean;
  suppressed: boolean;
  appearanceId?: string;
  materialId?: string;
};

type AssemblyDefinition = {
  id: string;
  name: string;
  parameters: ParameterDefinition[];
  occurrences: ComponentOccurrence[];
  mates: AssemblyMate[];
  occurrencePatterns: OccurrencePattern[];
  explodedViews: ExplodedView[];
  sectionViews: SectionView[];
};
```

### 7.1 Identity rules

- project, part, assembly, body, feature, sketch, entity, datum, occurrence, mate, material, appearance, section, and pattern IDs are stable opaque strings;
- array index is never identity;
- names are user-facing and may change without breaking references;
- generated pattern occurrences have stable derived occurrence IDs based on pattern ID plus occurrence ordinal;
- dissolving a pattern assigns new stable explicit IDs in one undoable command;
- copies preserve a `sourceId` lineage field but receive new identities;
- references use owner ID, semantic path, and topology signature, never display name alone.

### 7.2 Derived state

The project document does not persist:

- B-rep shapes or kernel wrapper objects;
- display meshes, edge buffers, bounding boxes, or tessellation caches;
- solved assembly transforms;
- mate residuals;
- mass properties, interference results, or measurement values;
- hover, selection, camera, active tool, or transient preview state;
- worker revision and request bookkeeping.

These are revision-keyed derived state and may be cached outside the canonical document.

### 7.3 Validation and limits

The document boundary validates before mutation:

- maximum 250 part definitions;
- maximum 2,000 explicit component occurrences;
- maximum 5,000 generated pattern occurrences;
- maximum 2,000 features per part;
- maximum 25,000 sketch entities per project;
- maximum 20 MiB decoded canonical JSON before resources;
- maximum 100 MiB total embedded resources;
- finite numeric values only;
- unique IDs within their namespace;
- acyclic part-feature dependencies;
- acyclic assembly-definition nesting;
- no occurrence may recursively contain its owning assembly;
- references must resolve to an allowed owner kind;
- expression dependency cycles are rejected with the full cycle path.

Newer schemas are refused without changing the live document. Unknown extension fields are preserved through load/save when within resource limits.

## 8. Command, draft, and rebuild model

Every persistent action enters one document-command pipeline exactly once.

```ts
type DocumentCommand = {
  id: string;
  label: string;
  projectRevisionBefore: number;
  projectRevisionAfter: number;
  apply(project: CadProjectV5): CadProjectV5;
  invert(project: CadProjectV5): DocumentCommand;
};
```

Required command classes include:

- create/delete/rename/reorder/suppress feature;
- create/delete/rename/hide/suppress body;
- edit parameter or expression;
- create/edit/delete datum;
- create/edit/delete transform, pattern, or Boolean;
- create/delete/replace component occurrence;
- edit occurrence transform;
- create/edit/delete mate;
- change material/appearance;
- create/edit/delete section or exploded view;
- import part/component;
- restore recovery state.

Rules:

- every editor mutates a detached draft;
- Apply creates one command regardless of how many preview updates occurred;
- Cancel produces no command and restores byte-identical project JSON;
- a throwing command or validation error changes neither document nor undo/redo stacks;
- selection, visibility preview, camera, section manipulation before Save, and exploded-view playback are session state until explicitly saved;
- one committed command increments the project revision once;
- a part revision invalidates only dependent part, occurrence, assembly, mesh, mass, and interference caches;
- stale worker replies never overwrite a newer project revision;
- the last valid body/assembly result remains displayed under an invalid draft.

## 9. Part, body, and feature semantics

### 9.1 Active part and active body

- one part definition is active for feature authoring;
- one solid or surface body is the default target inside that part;
- the active body is visible in the tree, document breadcrumb, and canvas badge;
- new additive features target the active body by default when they intersect it;
- disconnected additive results never silently fuse into the active body;
- when an additive result is disconnected, the preview asks to create a new body or select a Boolean target;
- subtractive features require one or more explicit solid targets;
- a feature may create, modify, split, or consume bodies only according to its declared result policy.

### 9.2 Feature input/output contract

```ts
type FeatureResultPolicy =
  | { kind: 'new-body'; bodyName?: string }
  | { kind: 'add'; targetBodyIds: string[] }
  | { kind: 'subtract'; targetBodyIds: string[]; keepTools?: boolean }
  | { kind: 'intersect'; targetBodyIds: string[]; keepTools?: boolean }
  | { kind: 'surface'; bodyName?: string };

type FeatureBase = {
  id: string;
  name: string;
  suppressed: boolean;
  inputRefs: GeometryReference[];
  resultPolicy: FeatureResultPolicy;
};
```

Every feature preview shows:

- source sketches, bodies, faces, edges, datums, or paths;
- target bodies;
- operation type;
- number and kind of result bodies;
- merge, split, and consume behavior;
- exact validation error before Apply.

### 9.3 Feature reordering

- features can be dragged or moved before/after another feature within a part;
- the preview shows dependency violations before commit;
- a feature cannot be placed before one of its required inputs;
- moving a feature is one undoable command;
- downstream topology is rebuilt and references resolve under the topology contract;
- failed downstream features remain in order and retain definitions;
- a rollback marker may temporarily evaluate a prefix of history without changing order.

### 9.4 Suppression and deletion

- suppression skips evaluation but preserves definition and identity;
- dependent features become suppressed-by-dependency or failed-missing-input according to their reference type;
- deletion lists direct and transitive dependents before commit;
- delete options are Cancel, Delete dependents, or Keep dependents failed for repair;
- body deletion follows the same dependency contract;
- no feature, body, mate, or occurrence may be resurrected by an editor draft that was opened before deletion.

## 10. Reference geometry

### 10.1 Required datum types

- plane;
- axis;
- point;
- coordinate system.

### 10.2 Plane creation modes

- offset from plane or planar face;
- through three points;
- through point and normal axis;
- angle about an edge or axis from a reference plane;
- tangent to cylindrical/conical surface through point or parallel to plane;
- midplane between parallel planes/faces;
- normal to curve/path at a parameter or selected point.

### 10.3 Axis creation modes

- through two points;
- normal to plane through point;
- cylindrical/conical face axis;
- line or straight edge;
- intersection of two planes.

### 10.4 Point creation modes

- explicit coordinates in a selected coordinate system;
- vertex or sketch point;
- midpoint;
- intersection of entities/curves/planes;
- point on path by distance or normalized parameter.

### 10.5 Coordinate systems

- origin plus X/Y axis references;
- transform from another coordinate system;
- selectable for transform input, import placement, export placement, and assembly mating;
- displayed with a compact triad and name;
- hidden by default outside editing/selection.

### 10.6 Reference behavior

- datums are named, stable, reorderable features;
- datums may reference parameters and expressions;
- dependent sketches and features rebuild when a datum moves;
- cyclic datum/feature dependencies are rejected before commit;
- missing references fail only dependents and preserve the last valid result;
- selecting a failed datum reopens surviving references for repair.

## 11. Transform and direct manipulation

### 11.1 Transform feature

Transform operates on selected bodies or surface bodies inside a part.

Required modes:

- translate by ΔX/ΔY/ΔZ in a selected coordinate system;
- rotate by angle around selected axis;
- point-to-point translate;
- align coordinate system to coordinate system;
- align planar face to planar face with offset and optional flip;
- align cylindrical axes with axial offset and rotation;
- uniform scale;
- nonuniform scale only for imported/reference geometry and never as a default precision workflow.

Transform values accept expressions and explicit units.

### 11.2 Manipulator

The 3D triad provides:

- axis arrows for translation;
- plane handles for planar translation;
- rotation rings;
- heads-up numeric values;
- local/global/reference-coordinate-system orientation;
- snapping to vertices, points, axes, faces, and increments;
- an exact preview before Apply.

Dragging is one command on pointer release. Escape during drag restores the pre-drag draft.

### 11.3 Copy and mirror

- Copy can create a new explicit body or a linked instance inside the same part;
- Mirror supports selected features or bodies across a plane;
- linked instances share source geometry and carry only transforms/overrides;
- dissolving a linked instance creates an independent body in one command;
- mirrors preserve source mapping for topology references when possible.

## 12. Loft

### 12.1 Inputs

Loft accepts:

- two or more ordered closed profiles for a solid result;
- two or more ordered open profiles for a surface result;
- sketch loops, planar face boundaries, or derived section curves;
- optional guide curves intersecting every section;
- optional centreline path;
- optional start/end tangent or curvature conditions.

### 12.2 Section mapping

- every section has a visible start point and direction;
- the user may reverse direction or drag/reassign the start point;
- automatic mapping must be deterministic;
- mismatched polygon vertex counts use explicit correspondence markers;
- a twisted preview may never silently change section mapping after Apply;
- section order is visible and reorderable in the inspector.

### 12.3 Continuity

Required boundary conditions:

- free;
- normal to profile plane;
- tangent to adjacent face;
- curvature continuous to adjacent face when supported by the kernel.

If curvature continuity cannot be satisfied, the preview reports the exact boundary and offers tangent/free alternatives. It does not silently downgrade.

### 12.4 Loft validity

The preview rejects or identifies:

- self-intersection;
- guide curve missing a section;
- incompatible open/closed profiles;
- zero-area sections;
- ambiguous section order;
- inverted or collapsing regions;
- a result that is not a valid shell/solid for the selected policy.

### 12.5 Blade use case

A credible blade is modeled with at least root, mid, and tip profiles on separate datum planes. Each profile may use a spline or imported coordinate loop. The sections may differ in chord, thickness, offset, and rotation. The loft result is a normal body feature, not a blade-only object.

## 13. Sweep

### 13.1 Inputs

Sweep accepts:

- one closed profile for a solid or thin-wall solid;
- one open profile for a surface;
- one continuous path composed of sketch entities, edges, or projected curves;
- optional guide rail;
- optional reference surface;
- start/end offsets along the path.

### 13.2 Orientation modes

- perpendicular to path;
- fixed profile orientation;
- follow path with minimum twist;
- align to guide rail;
- align to reference surface normal;
- explicit twist angle or twist expression over path length.

### 13.3 Sweep validity

- discontinuous paths are rejected with the gap location;
- sharp path corners expose miter, round, or fail behavior;
- self-intersection is previewed and blocks Apply;
- profile/path intersection and initial orientation are visible;
- the result declares new/add/subtract/intersect policy like other features.

## 14. Revolve, extrude, shell, draft, and edge treatments

### 14.1 Revolve

- select any datum axis, sketch construction line, straight edge, or cylindrical axis;
- full, one-sided partial, two-sided, symmetric, and to-reference angle modes;
- solid, surface, and thin revolve;
- visible direction and angle handles;
- profiles crossing the axis are rejected unless the selected operation produces a valid result;
- spinner, hub, casing, and nozzle profiles must be modelable without using an implicit canvas edge.

### 14.2 Extrude and Cut

V4 behavior remains, extended with:

- explicit target bodies;
- new-body result;
- up-to-face, up-to-body, through-all-bodies, between, and symmetric extents;
- start offset from sketch plane;
- draft angle;
- selected direction axis instead of sketch normal when requested.

### 14.3 Shell and Thicken

- Shell supports multiple removed faces, inside/outside/midplane thickness, and per-face thickness overrides;
- Thicken converts selected surfaces to solids with one-sided or symmetric thickness;
- previews identify faces where offset fails;
- successful faces are never committed as a partial shell unless the user explicitly chooses partial result as separate surfaces.

### 14.4 Draft

- neutral plane plus pull direction;
- selected faces with one angle or per-face overrides;
- inward/outward flip;
- tangent-face propagation;
- angle preview and failure-face highlighting.

### 14.5 Fillet and Chamfer

- constant, variable, and full-round fillet modes;
- setback/rolling-ball corner behavior where supported;
- tangent-chain propagation with previewed edge set;
- symmetric, two-distance, and distance-angle chamfer;
- failed edges are individually identified;
- edge treatments retain stable selections after upstream dimensional edits under the topology contract.

## 15. Boolean operations

Required operations:

- Union;
- Subtract;
- Intersect;
- Split body with plane, surface, or body;
- Keep tools;
- Keep both sides for split;
- optional heal/merge-coplanar-faces cleanup.

Rules:

- target and tool bodies are explicit and visible in the inspector;
- the preview colors target, tools, removed material, and retained result differently;
- body identity after Union defaults to the first target body;
- consumed tool bodies remain addressable in history but are hidden/consumed after the feature;
- Keep tools preserves independent tool body identities;
- Subtract may target several bodies in one feature;
- a Boolean that produces zero solids, non-manifold output, or unexpected disconnected solids blocks Apply unless the chosen result policy permits them;
- the result reports solid count, surface count, volume delta, and validity;
- failure never deletes or mutates source bodies.

## 16. Patterns

### 16.1 Patternable sources

- sketch entities/groups;
- part features;
- solid or surface bodies;
- assembly component occurrences.

### 16.2 Linear pattern

- one or two directions;
- count plus spacing;
- count plus total length;
- symmetric distribution;
- selected direction axis/edge/vector;
- skipped occurrences;
- optional alternating orientation.

### 16.3 Circular pattern

- selected axis;
- count plus total angle;
- count plus spacing angle;
- full-circle convenience mode;
- rotate occurrences with axis by default;
- preserve source orientation as an explicit alternative;
- symmetric angular distribution;
- skipped occurrences;
- radial and axial offsets through expressions.

### 16.4 Curve pattern

- selected path;
- count/spacing/total-length modes;
- tangent or fixed orientation;
- optional guide surface;
- skipped occurrences.

### 16.5 Pattern evaluation

- part body/feature patterns use one source definition and generated occurrence transforms;
- assembly patterns create lightweight occurrence instances;
- generated instances remain individually selectable for skip/suppress/inspect but not independently editable until dissolved;
- edits to the source update every unsuppressed occurrence;
- performance and memory scale with source complexity plus transforms, not full document duplication;
- failed occurrences identify ordinal and transform while preserving the last valid pattern result.

## 17. Sketch extensions required by complex modeling

V5 inherits the complete V4 sketch and constraint contract.

Required additions:

- control-point and fit-point splines;
- conic or ellipse where supported;
- curvature and tangent handles;
- construction centreline and point tools;
- sketch blocks/groups reusable across section planes;
- Project/Include of body edges, silhouette edges, intersections, datums, and assembly-context references;
- Intersection Curve between a plane and selected faces/bodies;
- coordinate-table import for ordered profile points;
- DXF import for 2D profiles;
- profile orientation, start point, and loop direction indicators for loft/revolve;
- on-canvas area shading for every valid closed region;
- gap, overlap, duplicate, self-intersection, and minimum-radius diagnostics.

### 17.1 Airfoil/profile import

Coordinate profile import accepts:

- CSV or whitespace-separated `x,y` points;
- optional header and comment lines;
- normalized or dimensional coordinates;
- unit and chord scaling;
- close-loop tolerance;
- point order reversal;
- origin, chord axis, and insertion plane controls.

Imported points become ordinary editable sketch geometry or a fitted spline. The original resource may be embedded for traceability, but it is not authoritative after the sketch is edited.

## 18. Topology and reference persistence

V5 extends V4's owner-aware topology contract across bodies, transforms, patterns, and assemblies.

```ts
type GeometryReference = {
  ownerKind: 'part' | 'body' | 'feature' | 'occurrence';
  ownerId: string;
  semanticPath?: SemanticPath;
  signature: GeometrySignature;
  occurrencePath?: string[];
};
```

Resolution order:

1. exact owner and semantic lineage;
2. exact source-to-result lineage emitted by the evaluating feature;
3. unique geometric/topological signature match inside the same owner;
4. unresolved or ambiguous failure requiring reselection.

Rules:

- references never silently cross to another body or component occurrence;
- a pattern source reference maps to the corresponding generated occurrence only when the occurrence path is explicit;
- a Boolean maps retained target faces before tool faces;
- a transform preserves topology lineage while changing placement;
- feature reorder invalidates and re-resolves downstream references deterministically;
- ambiguous fallback is a failure, not a nearest-geometry guess;
- failed references preserve labels, prior signature, and surviving owner for repair UI;
- the topology resolver is covered by deterministic mutation fixtures.

## 19. Components and assemblies

### 19.1 Component occurrence

```ts
type ComponentOccurrence = {
  id: string;
  name: string;
  definition: DocumentRef;
  parentOccurrenceId?: string;
  baseTransform: Matrix4;
  fixed: boolean;
  suppressed: boolean;
  visible: boolean;
  appearanceOverrideId?: string;
  parameterOverrides?: Record<string, string>;
};
```

An occurrence references a reusable part or subassembly definition. Editing the definition updates every occurrence unless an occurrence is explicitly replaced or made independent.

### 19.2 Component insertion

- insert an existing project part definition;
- create a new empty part in assembly context;
- duplicate as linked occurrence;
- make independent;
- replace component while preserving compatible mates;
- ground/fix at current transform;
- place with manipulator and numeric transform before mating;
- insert a saved `.bomcad` part or supported STEP body as a new definition.

### 19.3 Assembly context editing

- activate one component for in-context editing;
- all other components become reference-only and visually subordinate;
- project/include may create explicit external assembly references;
- external references identify assembly, occurrence path, source owner, and topology signature;
- circular cross-part dependencies are rejected;
- the user can break or lock an external reference into local geometry with an explicit command;
- exiting edit-in-context rebuilds the containing assembly and reports mate/interference changes.

### 19.4 Subassemblies

- an assembly definition may contain part or assembly occurrences;
- nested transforms compose deterministically;
- visibility and suppression propagate down the occurrence path;
- subassembly internal mates solve before parent mates;
- cyclic containment is prohibited;
- tree breadcrumbs and selection always show the complete occurrence path.

## 20. Mates and assembly solving

### 20.1 Required mate types

- Fixed;
- Coincident planar;
- Concentric;
- Distance;
- Angle;
- Parallel;
- Perpendicular;
- Tangent;
- Revolute;
- Slider.

Revolute and Slider are constrained placement relationships in V5. Continuous motion simulation is not required, but the manipulator may drag the remaining degree of freedom within optional limits.

### 20.2 Mate references

Mates select:

- planar faces or datum planes;
- cylindrical/conical faces or datum axes;
- points, vertices, circular centres, or datum points;
- coordinate systems.

Each mate stores explicit occurrence paths and topology references.

### 20.3 Mate behavior

- the first component is fixed by default only when the user accepts the assembly-start prompt;
- preview shows the solved transform before Apply;
- flip, offset, angle, and alignment orientation are explicit controls;
- mate values accept parameters and expressions;
- Apply creates one mate and one command;
- failed mate solve leaves the prior solved assembly visible;
- editing one mate shows which degrees of freedom it removes;
- suppressing a mate restores the degrees of freedom it controlled;
- deleting an occurrence lists affected mates and patterns.

### 20.4 Solver states

The assembly solver reports:

- fully constrained occurrence;
- under-constrained occurrence with remaining translational/rotational degrees of freedom;
- conflicting mate set;
- redundant mate set;
- unsolved or disconnected subassembly;
- solve duration and residual diagnostics.

Conflict behavior follows the V4 sketch-solver rule: the last valid assembly remains visible, the attempted mate and minimal conflict set are identified, and Cancel is lossless.

## 21. Selection, visibility, and isolation

V5 selection adds:

```ts
type ComplexSelectionItem =
  | { kind: 'part-definition'; partId: string }
  | { kind: 'body'; partId: string; bodyId: string }
  | { kind: 'occurrence'; assemblyId: string; occurrencePath: string[] }
  | { kind: 'mate'; assemblyId: string; mateId: string }
  | { kind: 'datum'; partId: string; datumId: string }
  | V4SelectionItem;
```

Rules:

- canvas, tree, and inspector share one primary selection;
- selection breadcrumb shows assembly occurrence path, part, body, feature, and subshape as applicable;
- selection filters include component, body, face, edge, vertex, datum, sketch, and mate;
- `Tab` cycles eligible overlapping geometry under the pointer;
- isolate hides everything outside the selected part/body/component set and is reversible session state;
- hide/show changes display state without suppressing geometry;
- suppress changes evaluated document structure and is undoable;
- ghost mode displays non-active components translucently without changing appearance assignments;
- selection remains identifiable through outline, tree state, and text, not color alone.

## 22. Section, cutaway, and exploded views

### 22.1 Section views

Required section modes:

- single plane;
- two-plane quarter section;
- three-plane box section;
- selected-component-only section;
- cap on/off;
- reverse direction;
- numeric offset and rotation;
- section by datum plane or interactive manipulator.

Section views are non-destructive display objects. They never alter B-rep bodies or enter feature history.

Saved sections store references and transforms, not clipped meshes. A missing datum deactivates the section and asks for repair.

### 22.2 Cutaway presentation

- a saved cutaway may combine section, visibility, ghosting, camera, and exploded state;
- cutaway playback does not modify feature or mate history;
- internal bodies retain individual appearances and selection;
- cap faces use a distinct configurable section color/hatch-like screen treatment;
- STEP/STL export ignores active section unless an explicit “export sectioned copy” command creates real derived geometry.

### 22.3 Exploded views

- exploded steps translate or rotate selected occurrences;
- each step stores delta transforms from solved assembly placement;
- playback interpolates display transforms only;
- exploded offsets do not affect mates, interference, mass properties, or export unless explicitly exported as transformed copies;
- one command saves or edits an exploded step sequence.

## 23. Materials, appearances, and display

### 23.1 Material definition

```ts
type MaterialDefinition = {
  id: string;
  name: string;
  densityKgM3?: number;
  description?: string;
  source?: string;
  appearanceId?: string;
};
```

The initial library includes generic steel, stainless steel, aluminum, titanium, polymer, rubber, glass, ceramic, and carbon-composite placeholders. Values are clearly labeled generic and editable.

### 23.2 Appearance definition

Appearance supports:

- base color;
- metallic factor;
- roughness;
- opacity;
- edge color/display preference;
- double-sided display for surfaces.

Appearance assignment precedence is face override, body, occurrence override, part default, project default.

### 23.3 Display modes

- shaded;
- shaded with edges;
- wireframe;
- hidden-line;
- transparent/ghost;
- section cap;
- curvature/zebra analysis for selected surfaces when feasible.

The engineering default remains neutral shaded-with-edges. Presentation lighting adds ambient occlusion, soft shadows, and a neutral environment without changing geometry or requiring a rendering engine.

## 24. Inspect and engineering confidence

### 24.1 Measure

Required measurements:

- point-to-point distance;
- minimum distance between bodies/components;
- edge length;
- face area;
- diameter/radius;
- angle;
- wall thickness at a picked point;
- bounding box in selected coordinate system;
- axial/radial clearance.

Measurements update with the current solved revision and identify all referenced owners.

### 24.2 Mass properties

For selected bodies, parts, components, or assembly:

- volume;
- surface area;
- mass when density is defined;
- center of mass;
- principal moments and axes of inertia;
- aggregate values with missing-material warnings.

### 24.3 Geometry health

The inspector reports:

- solid/shell/face/edge/vertex count;
- connected solid count;
- open shell or free-edge count;
- non-manifold condition;
- zero/near-zero thickness warnings where detectable;
- self-intersection or invalid B-rep status;
- minimum feature size estimate where feasible;
- exact feature/body that first introduced invalidity.

### 24.4 Interference and clearance

- check selected components or full assembly;
- broad-phase bounding-box pruning before exact B-rep intersection;
- report every interfering occurrence pair;
- report intersection volume and selectable highlighted region when available;
- optional contact tolerance;
- minimum-clearance query for selected pair;
- suppress expected-contact pairs in a named check set;
- results are derived and revision-keyed;
- stale results are visibly invalidated after geometry or mate changes.

Interference detection must use solved assembly placement, never exploded display placement.

## 25. Import and export

### 25.1 Project files

- `.bomcad` remains the authoritative editable format;
- V5 files preserve parts, assemblies, bodies, features, datums, mates, patterns, materials, views, and resources;
- Save is atomic and downloads a complete project snapshot;
- Open validates and migrates before replacing the active project;
- recovery journals remain per-project and schema-aware;
- malformed, oversized, cyclic, or newer project files change neither document nor command stacks.

### 25.2 STEP import

Required V5 STEP import boundary:

- import one or more B-rep solids/shells;
- preserve STEP product names and assembly hierarchy when available;
- create imported part definitions, bodies, and occurrences;
- preserve colors when available;
- allow placement, measurement, section, Boolean, and assembly mating;
- imported bodies have one `Imported STEP` base feature and no invented parametric history;
- reimport/replace preserves compatible occurrence transforms and mates when topology references resolve uniquely;
- invalid or unsupported entities are reported without discarding successfully parsed independent products.

### 25.3 STEP export

STEP export preserves:

- part and assembly names;
- occurrence hierarchy;
- body separation;
- solved transforms;
- per-body/component colors when supported;
- physical millimetre scale independent of display units;
- only unsuppressed geometry;
- active normal assembly placement, not section or exploded display state.

The exporter validates every included body before writing. A failed body blocks export and links to the owning feature.

### 25.4 STL export

- export selected bodies/components or complete visible solid set;
- binary STL by default;
- explicit linear/angular tessellation controls with safe presets;
- separate-files option for multiple parts/components;
- warning that STL loses assembly, units, materials, and feature history;
- section and explode state are ignored unless derived copies were explicitly created.

### 25.5 DXF and profile resources

V5 requires DXF import for sketch/profile geometry. Full 2D drafting and DWG are still outside scope. DXF export is optional and does not gate V5.

## 26. Kernel and worker architecture

All B-rep evaluation, exact Booleans, topology lineage extraction, meshing, mass properties, interference checks, STEP import, and STEP/STL export run outside the main UI thread.

```ts
type KernelRequest = {
  requestId: string;
  projectId: string;
  projectRevision: number;
  scope: KernelScope;
  operation: KernelOperation;
};

type KernelResponse = {
  requestId: string;
  projectId: string;
  projectRevision: number;
  scopeRevision: number;
  status: 'ok' | 'invalid' | 'cancelled' | 'worker-error';
  payload?: DerivedKernelPayload;
  diagnostics: KernelDiagnostic[];
};
```

### 26.1 Incremental evaluation

- each part has a dependency graph and body result cache keyed by feature ID plus input revision hash;
- changing one feature invalidates that feature and transitive dependents only;
- unchanged part definitions reuse B-rep and mesh results across assembly occurrences;
- occurrences reuse one source mesh with transform instancing;
- patterns reuse source geometry plus transforms where the operation remains an instance;
- exact body patterns that are Boolean-fused may share source evaluation but compute one fused result;
- assembly mate solving is independent of B-rep rebuild when part geometry is unchanged;
- mass/interference caches invalidate only when source geometry, material, suppression, or solved transform changes.

### 26.2 Cancellation and stale results

- every long request is cancelable at operation boundaries;
- a newer revision cancels or supersedes previews for the same scope;
- stale replies are discarded before touching visible meshes or diagnostics;
- worker restart replays the last committed project and selected active scope once;
- repeated worker failure leaves the last valid result visible and provides a recover/reload action;
- temporary kernel objects are disposed deterministically.

### 26.3 Mesh and rendering boundary

- the worker transfers indexed position, normal, edge, selection-ID, and occurrence-transform buffers;
- B-rep objects never cross to the UI thread;
- part meshes are instanced for occurrences and non-fused patterns;
- selection IDs map back to occurrence path, body, feature lineage, and subshape signature;
- coarse preview meshes may appear first, followed by exact meshes for the same revision;
- exact geometry—not preview tessellation—drives validity, measurement, mass, interference, and export.

## 27. Performance and resource budgets

Performance fixtures run after the kernel is loaded on CI reference hardware and in a production-candidate desktop browser.

### 27.1 Interaction budgets

- pointer-to-orbit response: p95 under `50 ms`;
- 95% of sampled orbit frames under `32 ms` with the turbofan fixture visible;
- tree selection to highlight: p95 under `100 ms`;
- numeric field edit acknowledgement: under `100 ms`;
- transform/manipulator coarse preview: under `100 ms`;
- exact feature preview visual response: median under `500 ms`, p95 under `2 s` for versioned feature fixtures;
- mate preview: median under `100 ms`, p95 under `300 ms` for the turbofan assembly;
- section-plane drag: 95% of frames under `32 ms` using GPU clipping.

### 27.2 Rebuild budgets

- 12-blade rotor source edit to complete visible rebuild: median under `2 s`, p95 under `5 s`;
- full canonical turbofan cold rebuild after kernel load: under `20 s`;
- full canonical turbofan warm rebuild with no changes: under `2 s`;
- one early nacelle parameter edit with all dependents: median under `5 s`, p95 under `10 s`;
- full assembly interference check: under `10 s`;
- mass properties for full fixture: under `5 s`;
- STEP export: under `30 s` and without freezing the UI.

### 27.3 Canonical performance fixture

The V5 turbofan fixture is capped for browser realism:

- no more than 40 unique part definitions;
- no more than 250 explicit or generated component occurrences;
- no more than 400 evaluated part features;
- at least 12 fan-blade occurrences;
- at least two compressor rotor rows and two stator rows;
- at least two turbine rows;
- at least 100,000 displayed triangles in normal quality;
- at least 20 named mates;
- at least one active section view and one saved exploded view.

Across 50 alternating parameter/mate edits, retained worker heap plus live geometry/mesh buffers in the final ten iterations may not exceed the preceding ten-iteration window by more than `10%` after warm-up.

## 28. Failure and recovery behavior

### 28.1 Feature failures

- identify the first failing feature and affected body;
- keep the last valid body result visible;
- keep every downstream definition in the tree;
- distinguish missing reference, invalid profile, kernel refusal, self-intersection, and result-policy mismatch;
- show target/tool/section/path references that remain valid;
- provide Edit, Reselect, Suppress, and Roll back actions;
- block affected export while allowing unaffected selected bodies to export when structurally safe.

### 28.2 Assembly failures

- identify unresolved occurrence, missing component, conflicting mate set, or cyclic subassembly;
- keep the last valid solved placement visible;
- never move components to arbitrary defaults after a mate failure;
- allow suppression or repair of the failing mate;
- invalidate interference and mass aggregates until solved.

### 28.3 Import/export failures

- validate in a detached project scope;
- report failed product/body/entity with source label;
- preserve active document and undo/redo stacks;
- partial STEP import requires explicit user acceptance and lists omitted products;
- export failure leaves no misleading success download;
- project resources and filenames are sanitized.

### 28.4 Storage and recovery

- V4 local recovery and journaling extend to schema 5;
- recovery captures canonical document commands, not B-rep caches;
- opening a complex template preserves the current project as a recoverable state after in-app confirmation;
- native browser `alert`, `confirm`, and `prompt` are prohibited in modeling, template, import, recovery, and export flows;
- all confirmations use accessible in-app dialogs that do not unexpectedly steal focus.

## 29. Keyboard, accessibility, and input

V4 keyboard and accessibility contracts remain. V5 adds:

| Action | Shortcut |
| --- | --- |
| Isolate selection | `I` |
| Hide selection | `H` |
| Show all | `Shift+H` |
| Activate transform | `M` |
| Toggle section view | `Shift+S` |
| Measure | `Shift+M` |
| Cycle selection filter | `F6` |
| Edit selected feature/mate | `E` |
| Suppress selected item | `Shift+E` |

Requirements:

- every tree control is keyboard reachable;
- tree hierarchy exposes expanded/collapsed, level, selected, hidden, suppressed, failed, and occurrence-count states;
- manipulator values are editable through labeled numeric fields without pointer dragging;
- every mate can be authored from tree/inspector selections when precision pointer selection is inaccessible;
- section and explode controls have text labels and numeric alternatives;
- conflict/failure, body/component identity, active part, and selection filters use text/shape in addition to color;
- canvas selection changes are announced with occurrence path and selected geometry kind;
- reduced motion disables exploded-view and camera interpolation while preserving endpoints;
- appearance contrast meets WCAG AA for essential text and controls;
- no core command is represented only by an unlabeled icon.

## 30. First run, templates, and Help

### 30.1 Complex-modeling templates

V5 adds editable templates that exercise generic features:

- twisted fan blade;
- ducted fan rotor;
- impeller;
- propeller;
- lofted intake duct;
- pump casing;
- shaft and bearing stack;
- simple gearbox assembly;
- robot-joint assembly;
- shrouded turbofan release fixture.

Each template exposes:

- part/component hierarchy;
- feature recipe;
- named parameters;
- nominal envelope;
- material assignments;
- expected body/component count;
- expected validity/interference state;
- techniques used;
- a normal editable project, never an opaque mesh.

### 30.2 Guided complex workflow

The first complex-modeling walkthrough uses the ducted fan, not the full turbofan:

1. activate the blade part;
2. inspect root/mid/tip datum planes and profiles;
3. edit blade twist and see the Loft preview;
4. return to assembly and inspect the circular occurrence pattern;
5. adjust blade count;
6. enable a section view;
7. run interference check;
8. save project and export STEP.

The walkthrough highlights real controls, is dismissible, and can be replayed from Help.

### 30.3 Help truth contract

Help must explain:

- part vs body vs component vs occurrence;
- add/subtract/intersect/new-body result policies;
- datum/reference repair;
- loft section mapping and sweep orientation;
- transform vs mate;
- hide vs suppress vs isolate;
- section/explode as display-only state;
- imported STEP bodies as non-parametric base features;
- the limits of the turbofan demonstrator.

Help must not claim simulation, manufacturing readiness, native imported history, or aerospace validation.

### 30.4 Optional turbomachinery accelerators

After the generic V5 gates pass, the Studio may add accelerators for repeated expert workflows:

- NACA four-digit and other openly licensed airfoil/profile libraries;
- a root/mid/tip blade-section table for chord, thickness, offset, twist, sweep, and lean;
- a blade-row generator that emits normal datums, sketches, Loft, root treatment, and Pattern features;
- hub/shroud meridional-curve controls;
- rotor/stator stage templates;
- annular casing and duct templates;
- a saved engine-cutaway presentation preset.

These tools must produce the same editable generic document objects a user can create manually. They do not replace or weaken the Loft, Sweep, Pattern, datum, assembly, topology, validity, or acceptance contracts and are not required to ship V5.

## 31. Security and project safety

- project, DXF, CSV, and STEP files are treated as untrusted input;
- parsing occurs off the UI thread with time, memory, entity-count, recursion, and decoded-size limits;
- filenames and labels are rendered as text, never HTML;
- embedded resources use allowlisted MIME types and bounded sizes;
- external resource URLs are not fetched automatically;
- expressions use the existing safe parser and never `eval` or `Function`;
- cyclic references and decompression bombs fail closed;
- export filenames are sanitized and do not include filesystem paths;
- recovery data is origin-local and never uploaded without an explicit future feature;
- crash diagnostics omit project geometry and user filenames by default.

## 32. Test architecture

### 32.1 Unit tests

- schema-4-to-5 migration and unknown-field preservation;
- ID uniqueness and occurrence-path derivation;
- part/assembly containment-cycle rejection;
- feature dependency and reorder validation;
- result-policy validation;
- datum construction and transform math;
- matrix composition for nested occurrences;
- pattern transform generation and skipped occurrences;
- mate degrees-of-freedom and conflict-set analysis;
- material aggregation and missing-density reporting;
- selection filters and occurrence breadcrumbs;
- stale worker revision rejection;
- import resource limits and safe label handling.

### 32.2 Kernel geometry tests

Versioned golden fixtures:

- three-section twisted blade Loft;
- guided intake Loft;
- minimum-twist pipe Sweep;
- explicit-twist Sweep;
- selectable-axis partial Revolve;
- variable fillet blade root;
- drafted and shelled nacelle;
- feature/body circular patterns;
- Union/Subtract/Intersect/Split with Keep tools;
- transform and mirror topology lineage;
- multi-body STEP import/export;
- full turbofan parts and assembly.

For each fixture verify as applicable:

- B-rep validity;
- expected solid/shell count;
- bounding box within tolerance;
- volume and surface area within tolerance;
- expected topology lineage after controlled edits;
- no self-intersection/non-manifold/free-edge error for required solids;
- STEP round-trip body/component count and physical scale;
- deterministic mesh and diagnostic metadata;
- no leaked kernel objects across repeated evaluation.

### 32.3 Assembly tests

- nested occurrence transform composition;
- fixed, coincident, concentric, distance, angle, parallel, perpendicular, tangent, revolute, and slider mates;
- under-constrained degree-of-freedom reporting;
- minimal conflicting-mate set;
- source part edit updates every linked occurrence;
- Make independent stops linked updates;
- component replacement preserves only uniquely resolvable mates;
- component patterns stay lightweight and selectable;
- suppression and visibility propagation;
- section/explode state does not affect solved transforms;
- interference uses solved transforms and reports expected pairs/volumes;
- mass aggregation matches component/material inputs.

### 32.4 Browser interaction tests

Required flows:

- create/rename/hide/suppress/delete bodies;
- create every datum mode and repair a missing reference;
- manipulate and numerically edit a transform;
- create/edit/reorder Loft sections and guides;
- create/edit Sweep orientation and twist;
- pattern a body around a selected axis and skip one occurrence;
- preview every Boolean result policy and Cancel transactionally;
- create an assembly, insert components, and author every required mate;
- edit a part in context and return to the solved assembly;
- section, isolate, measure, mass, and interference workflows;
- import multi-product STEP and export a structured assembly STEP;
- reload recovery with feature reorder and assembly undo/redo position;
- malformed/newer/oversized/cyclic file safety;
- no native browser alert/confirm/prompt in any V5 flow;
- keyboard-only tree, inspector, transform, mate, section, and export flows.

### 32.5 Visual regression states

Capture at `1600 × 1000`, `1280 × 720`, and `390 × 844` where applicable:

- multi-body part with one active body;
- datum creation preview;
- Loft section mapping and exact preview;
- Sweep path and orientation preview;
- transform manipulator with heads-up values;
- circular body pattern preview;
- Boolean target/tool/result preview;
- assembly tree with nested subassembly and pattern;
- mate preview and conflict;
- half-section turbofan;
- exploded turbofan;
- interference result;
- material/appearance assignments;
- failed body and failed mate repair states;
- mobile assembly inspection and numeric edit.

DOM checks alone cannot approve the release. A human reviews the exact desktop turbofan, section, exploded, conflict, and mobile inspection captures.

### 32.6 CI and evidence contract

V5 implementation adds these stable package commands:

```text
npm run studio:v5:migration
npm run studio:v5:geometry
npm run studio:v5:assembly
npm run studio:v5:browser
npm run studio:v5:visual
npm run studio:v5:performance
npm run studio:v5:release-check
```

`studio:v5:release-check` runs or validates every non-human gate and produces one machine-readable manifest containing:

- source commit;
- project schema version;
- browser and kernel versions;
- fixture IDs and hashes;
- pass/fail/skip status with reasons;
- geometry/body/component/validity assertions;
- migration results;
- performance percentiles and memory windows;
- STEP round-trip results;
- accessibility results;
- paths and hashes for exact visual captures;
- human-review status fields for required visual evidence.

The protected `wiki/engine` PR workflow must run typecheck plus migration, geometry, assembly, browser, and release-manifest validation for changes under `engine/**`. Visual and performance jobs upload their exact artifacts even on failure. No release check may turn a missing browser, kernel, fixture, screenshot, or performance sample into a pass.

The final live verification records:

- deployed commit;
- public route and GET status;
- loaded schema/kernel version;
- turbofan fixture open/rebuild result;
- orbit, section, source-parameter edit, undo/redo, save, and STEP-export smoke results;
- exact desktop isometric and half-section screenshots.

## 33. Canonical turbofan release fixture

### 33.1 Purpose

The fixture proves generic complex-modeling capability. It is an educational, dimensionally coherent engine demonstrator—not a certified or performance-accurate aerospace design.

### 33.2 Required structure

The root assembly contains at least:

- `Nacelle` part;
- `Inlet lip` part or distinct body;
- `Fan rotor` subassembly;
- `Spinner` part;
- `Fan disk` part;
- one reusable `Fan blade` part with 12 patterned occurrences;
- `Low-pressure shaft` part;
- two compressor rotor subassemblies;
- two stator-vane subassemblies;
- one annular combustor casing part;
- one inner combustor liner part;
- two turbine rotor subassemblies;
- one exhaust cone/nozzle part;
- rear support/stator part;
- at least two bearing-placeholder parts.

Every major item is separately selectable, hideable, sectionable, measurable, and named.

### 33.3 Required geometry techniques

- nacelle: at least three-section solid or surface Loft plus Shell/Thicken;
- inlet lip: Revolve or Sweep with a smooth rounded profile;
- fan blade: root/mid/tip spline profiles on offset/rotated datum planes, Loft, and root fillet;
- fan disk and spinner: selectable-axis Revolve;
- fan blades: assembly occurrence circular pattern around a datum axis;
- compressor/turbine blades or vanes: at least one generic lofted blade definition reused in patterns;
- shaft: Revolve with at least two diameter steps;
- combustor casing/liner: Revolve plus Shell/Thicken and patterned openings or simplified features;
- nozzle/exhaust cone: Loft or Revolve with explicit axes;
- final structure: mates, not baked placement coordinates alone;
- internal presentation: saved half-section and exploded views;
- appearances: at least four distinguishable material/appearance assignments.

### 33.4 Required edit demonstrations

The golden project and browser test must perform these edits:

1. change fan diameter by `+10%`;
2. change fan blade count from `12` to `14`;
3. change blade tip twist by `+5°`;
4. change nacelle wall thickness;
5. move one compressor stage axially with a mate distance;
6. suppress one stator row;
7. restore the stator row;
8. activate half-section view;
9. run interference check;
10. undo and redo the last geometry edit;
11. export structured STEP;
12. reopen the saved `.bomcad` project and reproduce the same solved result.

Expected:

- source blade edits update every patterned occurrence;
- no occurrence loses its identity;
- no unrelated body changes owner or silently fuses;
- every required solid remains valid;
- the last valid assembly remains interactive during rebuild;
- mate and reference failures, if deliberately induced, isolate to dependents and are repairable;
- section/explode state never changes export placement;
- STEP round-trip preserves the expected part/occurrence hierarchy within exporter capability;
- the project passes body/component count, validity, mass, and interference assertions.

### 33.5 Visual acceptance

The fixture is rejected if a human reviewer reasonably describes it as a household ventilation fan, a thick ring with spokes, or a single fused decorative mesh.

The approved isometric and half-section captures must visibly show:

- a smooth nacelle/inlet profile;
- tapered and twisted fan blades;
- a proportionate spinner and hub;
- multiple axial compressor/stator/turbine stages;
- a shaft and internal annular structure;
- distinguishable components/materials;
- credible clearances with no unintended protrusions;
- clean blade-root and casing transitions;
- internal structure made legible through sectioning.

## 34. Secondary generality fixtures

V5 must not pass through turbofan-specific shortcuts. Two additional projects prove generality.

### 34.1 Gearbox

- enclosure with multi-body casing and cover;
- at least three shafts/gears as components;
- concentric and distance mates;
- repeated fastener occurrences;
- section view;
- interference check;
- one parameter edit that changes shaft spacing and rebuilds the enclosure references.

### 34.2 Pump or robot joint

- shaped impeller/arm created with Loft or Sweep;
- shaft, bearings, enclosure, and cover as separate components;
- at least one mirrored or patterned feature/body;
- material assignments and mass properties;
- structured STEP export.

Both fixtures must be authored from the same generic tools and pass solid-validity, recovery, and export gates.

## 35. Delivery slices and PR-sized implementation order

V5 ships only when every slice is complete. Slices are implementation boundaries, not independent product releases.

### Slice 5A — schema-5 multi-body foundation

- schema-5 project/part/body/assembly types;
- deterministic schema-4 migration;
- body-aware feature input/output policies;
- body tree, active body, visibility, suppression, rename, delete;
- multi-body worker result and instanced renderer boundary;
- structured recovery and project validation.

Gate: create three bodies, modify one, subtract another from selected targets, save/reload, undo/redo, and export the intended selected bodies without identity loss.

Suggested PRs:

1. schema and migrations;
2. worker/body result protocol;
3. tree/inspector/selection UI;
4. body-aware existing features and document commands;
5. multi-body geometry/export regression suite.

### Slice 5B — datums, transforms, and history control

- datum planes/axes/points/coordinate systems;
- transform manipulator and numeric fields;
- Copy, Mirror, Align, Move, Rotate, Scale;
- feature reorder and rollback marker;
- owner-aware topology lineage across transforms/reorder;
- datum/reference repair UI.

Gate: reposition and mirror several bodies, reorder a safe feature, deliberately break and repair a datum reference, and retain stable downstream selections.

Suggested PRs:

1. datum data model and kernel math;
2. datum creation UI;
3. transform feature and manipulator;
4. mirror/copy/align;
5. reorder/rollback and reference fixtures.

### Slice 5C — advanced shape creation

- splines and profile import;
- Loft with mapping, guides, and continuity;
- Sweep with orientation/twist;
- selectable-axis/partial Revolve;
- extended Extrude/Cut extents;
- Draft, Thicken, variable Fillet, and advanced Shell;
- exact previews and diagnostics.

Gate: the fan blade, inlet duct, spinner, nacelle shell, and nozzle parts rebuild from generic features and pass validity tests.

Suggested PRs:

1. spline/profile and DXF/coordinate import;
2. Loft kernel/data model;
3. Loft UI/mapping/diagnostics;
4. Sweep kernel/data model;
5. Sweep UI/orientation/diagnostics;
6. Revolve/Extrude/Cut extensions;
7. Draft/Thicken/Fillet/Shell extensions.

### Slice 5D — Boolean and pattern reliability

- explicit Union/Subtract/Intersect/Split/Keep tools;
- feature/body linear, circular, curve, and mirror patterns;
- skipped occurrences and source-linked evaluation;
- pattern/topology lineage;
- performance/memory instancing.

Gate: build a valid fan rotor and compressor stage from one source blade, change count and twist, and observe lightweight correct occurrences without document duplication.

Suggested PRs:

1. Boolean result policies and diagnostics;
2. feature/body linear and circular patterns;
3. mirror and curve patterns;
4. skipped/dissolved occurrences;
5. performance and topology fixtures.

### Slice 5E — assemblies and mates

- part/component/subassembly definitions;
- occurrence hierarchy and transforms;
- insertion, linked duplicates, Make independent, Replace;
- Fixed/Coincident/Concentric/Distance/Angle/Parallel/Perpendicular mates;
- Tangent/Revolute/Slider mates;
- solver state/conflict UI;
- assembly-context editing and external references;
- assembly component patterns.

Gate: assemble fan rotor, shaft, nacelle, compressor, and turbine modules with explicit mates; edit one source part and retain solved placements.

Suggested PRs:

1. assembly schema and occurrence renderer;
2. component insertion/tree/selection;
3. basic rigid mate solver;
4. mate authoring/conflict UI;
5. revolute/slider/tangent and limits;
6. edit-in-context and external references;
7. assembly patterns and replacement.

### Slice 5F — inspection, appearance, and interchange

- section/cutaway and exploded views;
- materials, appearances, and display modes;
- measure, geometry health, and mass properties;
- exact interference/clearance checks;
- structured STEP import/export;
- multi-part STL export;
- mobile inspection boundary.

Gate: the assembly is visually legible, measurable, sectionable, interference-checked, and round-trips through project save plus structured STEP export.

Suggested PRs:

1. section/clip/cap rendering;
2. exploded views;
3. materials/appearances/display;
4. measure/mass/health;
5. interference/clearance;
6. STEP assembly import/export;
7. mobile inspection and accessibility.

### Slice 5G — release fixtures and hardening

- canonical turbofan project built through released UI;
- gearbox and pump/robot-joint generality fixtures;
- anchored advanced walkthrough;
- full geometry, browser, migration, performance, memory, accessibility, and visual gates;
- Help truth audit;
- production-candidate live verification.

Gate: all §33 and §34 scenarios pass locally, in CI, and in the production-candidate browser; a human approves the exact turbofan isometric, half-section, exploded, and mobile inspection captures.

## 36. Release capability gates

| Gate | Required evidence |
| --- | --- |
| `v5-schema` | All V4 fixtures migrate, rebuild, save, reopen, and preserve unknown safe extensions |
| `v5-multibody` | Multi-body creation/edit/Boolean/export browser and kernel suite |
| `v5-datums-transforms` | Datum, transform, reorder, and topology-repair fixtures |
| `v5-advanced-shapes` | Loft/Sweep/Revolve/Draft/Shell/Fillet golden geometry suite |
| `v5-patterns` | Feature/body/component pattern correctness and memory proof |
| `v5-assemblies` | Occurrence, subassembly, mate, conflict, edit-in-context, and recovery suite |
| `v5-inspection` | Section, explode, measure, mass, health, interference, and clearance suite |
| `v5-interchange` | Project and structured STEP round-trip evidence |
| `v5-performance` | Turbofan interaction, rebuild, export, and retained-memory budgets |
| `v5-accessibility` | Keyboard, semantics, focus, contrast, reduced-motion, and mobile inspection evidence |
| `v5-visual` | Human-approved exact isometric/section/exploded/conflict/mobile captures |
| `v5-turbofan` | Full §33 project and edit demonstration built through public UI |
| `v5-generality` | Gearbox plus pump/robot-joint fixtures pass without special-case geometry |
| `v5-live` | Protected CI deploy and public `/cad/studio` smoke verification |

No percentage estimate substitutes for these gates. A gate is complete only when its durable artifact, command, fixture, or reviewed capture exists.

## 37. Definition of done

V5 is complete only when:

- V4's precision sketch, transactional document, topology, recovery, worker, mobile simple-part, and accessibility contracts remain green;
- schema 5 and every schema-4 migration fixture pass;
- users can create and manage multiple named bodies without unintended fusion;
- datums, transforms, Loft, Sweep, selectable-axis Revolve, advanced patterns, and explicit Booleans work through visible UI;
- feature reorder, suppression, deletion, and repair preserve document integrity;
- parts can be inserted as reusable components and nested subassemblies;
- required mates report degrees of freedom and conflicts predictably;
- section, explode, isolate, measure, mass, health, interference, and appearance tools work on the solved assembly;
- structured STEP import/export preserves the tested hierarchy, bodies, placement, names, and scale;
- the canonical turbofan is built from generic features inside the Studio and passes every edit, validity, recovery, performance, visual, and export assertion;
- the gearbox and pump/robot-joint fixtures prove the system is not turbofan-specific;
- no core V5 flow uses a native browser alert, confirm, or prompt;
- desktop visual regressions are reviewed by a human and the mobile inspection boundary is truthful;
- Help contains no simulation, certification, manufacturing-readiness, or imported-history claims;
- the release is deployed through protected `wiki/engine` CI and verified on the public route.

The V5 release statement may then say:

> BOMwiki CAD Studio is a browser-based parametric modeler for multi-body mechanical parts and structured assemblies, with lofts, sweeps, reusable components, mates, section views, interference inspection, and structured STEP interchange.

It must also state plainly:

> CAD Studio does not provide engineering simulation, manufacturing certification, production turbomachinery analysis, CAM, or drawings. The included turbofan is an editable modeling demonstrator, not a flight-certified engine design.

## 38. Requirement traceability matrix

This matrix is the implementation index. A capability is not complete merely because a control exists; its specified behavior, tests, slice gate, and release evidence must all exist.

| Observed or required capability | Contract sections | Delivery slice | Release gate and proof |
| --- | --- | --- | --- |
| Preserve separate solids instead of one accidental lump | §§7, 9, 15 | 5A | `v5-multibody`: body identity, Boolean, save/reload, export fixtures |
| Place geometry precisely in 3D | §§10–11 | 5B | `v5-datums-transforms`: datum and numeric transform browser/kernel suite |
| Sketch on controlled axial stations | §§10, 17 | 5B/5C | datum migration/reference tests plus root/mid/tip blade fixture |
| Create tapered, twisted fan blades | §§12, 17, 33 | 5C | `v5-advanced-shapes`: three-section blade Loft validity and edit proof |
| Create curved ducts and paths | §13 | 5C | guided intake and twisted Sweep golden fixtures |
| Build spinner, shafts, hubs, and casings around chosen axes | §14.1 | 5C | selectable-axis partial/full Revolve fixtures |
| Create thin casings and smooth transitions | §§14.3–14.5 | 5C | Shell/Thicken/Draft/variable-Fillet geometry tests |
| Combine and cut selected bodies safely | §15 | 5D | Union/Subtract/Intersect/Split/Keep-tools result and failure tests |
| Repeat blades as linked geometry | §16 | 5D | `v5-patterns`: source-edit, skip, dissolve, topology, and memory proof |
| Reuse parts rather than copy solids | §19 | 5E | `v5-assemblies`: linked occurrences and Make-independent tests |
| Position engine stages structurally | §20 | 5E | mate degree-of-freedom, conflict, replacement, and recovery tests |
| Preserve nested modules | §19.4 | 5E | subassembly transform, cycle refusal, and breadcrumb tests |
| See internal engine structure | §22 | 5F | `v5-inspection`: reviewed half-section and cap rendering captures |
| Present how the engine comes apart | §22.3 | 5F | saved exploded-view behavior and non-mutation tests |
| Distinguish materials/components visually | §23 | 5F | appearance precedence and reviewed turbofan captures |
| Verify dimensions, mass, and solid health | §24 | 5F | measurement/mass/validity fixture assertions |
| Detect protrusions and collisions | §24.4 | 5F | exact expected-pair interference and clearance results |
| Preserve mechanical structure in interchange | §25 | 5F | `v5-interchange`: project and STEP hierarchy/body/scale round trips |
| Keep the interface responsive | §§26–27 | 5A–5G | `v5-performance`: interaction, rebuild, export, and memory artifacts |
| Recover from invalid geometry and references | §§18, 28 | all | failure isolation, repair, transaction, and stale-result tests |
| Make the workflow teachable | §30 | 5G | anchored ducted-fan walkthrough and Help truth audit |
| Prove a credible engine, not a decorative fan | §33 | 5G | `v5-turbofan`: exact structure, edit, visual, validity, and export proof |
| Prove tools are general, not engine-specific | §34 | 5G | `v5-generality`: gearbox and pump/robot-joint fixtures |
| Protect untrusted local files | §31 | all | parser limits, sanitization, cyclic/oversized/malformed safety tests |

## 39. Implementation decisions that are already closed

The following decisions are part of this contract and should not be reopened inside individual PRs without a spec amendment:

1. V5 builds on V4; it does not replace the V4 sketch, command, recovery, topology, worker, or accessibility foundations.
2. Multi-body part modeling ships before assemblies.
3. Assemblies reference reusable part/subassembly definitions through lightweight occurrences.
4. Patterns reference one source definition until explicitly dissolved.
5. Section and exploded views are non-destructive display state.
6. Imported STEP geometry is an imported base feature; V5 does not invent editable feature history.
7. Generic CAD features must be capable of building the release fixture; domain accelerators are optional producers of the same document objects.
8. Complex assembly authoring is desktop-first, while mobile retains V4 part editing and gains truthful V5 inspection/numeric-edit support.
9. Exact B-rep geometry—not displayed triangles—drives validity, inspection, interference, mass, and export.
10. Ambiguous topology references fail for repair; they never bind to the nearest similar face or edge.
11. No release claim is earned by a toolbar icon, DOM-only test, opaque template, imported finished mesh, or one fused decorative body.
12. V5 is a modeling and assembly release, not a simulation, certification, CAM, drawing, PLM, or cloud-collaboration release.

## 40. Turbofan conformance benchmark

This section converts the failed browser build into an executable release contract. It is normative where it is more specific than §§33–39.

### 40.1 Failure being corrected

The rejected model is a short annular casing containing radial flat plates and a central cone. It reads as a ducted household fan because:

- every visible feature is concentrated near one axial plane;
- the blades are constant-thickness plates rather than tapered and twisted aerodynamic forms;
- the casing, hub, blades, spinner, and decorative rings do not expose a credible component structure;
- no bypass passage, core passage, compressor, combustor, turbine, shaft, or nozzle can be inspected;
- repetition is visual duplication rather than an editable source-linked design relationship;
- the canvas cannot prove how the solids are positioned, related, sectioned, or exported.

Adding more spokes, rings, fillets, colors, or revolved profiles does not correct this failure. The release proof must show longitudinal mechanical structure and editable dependencies.

### 40.2 Coordinate and station convention

The canonical fixture uses millimetres and a right-handed coordinate system:

- engine axis: `+X`, inlet to exhaust;
- vertical: `+Z`;
- lateral: `+Y`;
- radial distance: `sqrt(Y² + Z²)`;
- all rotor and stator axes reference one named `Engine axis` datum unless an intentionally offset accessory is being tested;
- every major axial row references a named datum plane or assembly mate distance, never an unexplained sketch-coordinate offset.

The reference envelope is intentionally desktop-browser scale rather than flight-engine scale:

| Station | X range or plane | Required content |
| --- | ---: | --- |
| `S00 Inlet` | `0–45` | rounded inlet lip and nacelle lead-in |
| `S10 Fan` | `55` | spinner, fan disk, and large front-fan row |
| `S20 Fan exit` | `82` | outlet guide-vane row and bypass/core splitter |
| `S30 LPC-1` | `120` | low-pressure compressor rotor row |
| `S31 LPC stator-1` | `137` | stator row |
| `S40 HPC-1` | `165` | high-pressure compressor rotor row |
| `S41 HPC stator-1` | `181` | stator row |
| `S50 Combustor` | `210–278` | outer casing, inner liner, and annular flow passage |
| `S60 HPT` | `300` | high-pressure turbine rotor row |
| `S61 HPT stator` | `316` | turbine stator row |
| `S70 LPT` | `342` | low-pressure turbine rotor row |
| `S80 Nozzle` | `370–430` | core cone, bypass exit, and tapered exhaust nozzle |

Required envelope parameters:

```text
engineLength = 430
nacelleOuterDiameter = 190
fanTipDiameter = 160
fanHubDiameter = 52
coreOuterDiameter = 88
coreShaftDiameter = 18
nacelleWall = 3
fanBladeCount = 12
```

These values are golden-fixture defaults, not hard-coded kernel assumptions. The model must remain valid through the edits in §40.12.

### 40.3 Required structural result

The finished project must contain, at minimum:

- one root assembly;
- 15 named reusable part definitions;
- 24 named solid bodies;
- 100 solved component occurrences, including linked pattern occurrences;
- one fan row, two compressor rotor rows, two compressor stator rows, two turbine rotor rows, and one turbine stator row;
- distinct nacelle, inlet lip, bypass splitter, outer core casing, combustor casing, combustor liner, core shaft, low-pressure shaft, spinner, rotor disks, stator supports, and exhaust cone/nozzle solids;
- at least 20 explicit mates, including concentric and axial distance relationships;
- one saved half-section view and one saved exploded view;
- at least four appearance assignments used to distinguish stationary structure, rotating structure, hot-section structure, and cut faces.

The tree must make these items discoverable without selecting through the canvas. Every major part and stage can be selected, hidden, isolated, suppressed, renamed, measured, and located from the tree.

### 40.4 Capability contracts for the ten observed gaps

#### 40.4.1 Offset and angled construction planes

The Part workspace provides `Plane` with these modes:

- offset from plane or planar face;
- angle about a selected axis or straight edge;
- through three points;
- normal to a curve at a selected point;
- mid-plane between two parallel references.

The plane editor exposes name, source references, signed offset, angle, flip-normal, and live exact preview. Apply creates one history feature. Cancel is byte-identical. Editing a source or value rebuilds every dependent sketch and reports missing or ambiguous references without silently remapping them.

Benchmark proof: create root, mid, and tip blade planes at three radial stations; rotate the mid and tip planes by independent twist angles; change tip angle by `+5°`; all dependent lofts rebuild.

#### 40.4.2 Independent bodies positioned along an axis

A Part contains multiple named bodies with one explicit active body. Solid-producing features require a result policy: `new body`, `add`, `subtract`, `intersect`, or `surface`. `New body` is the default when the input does not intersect the active body; the application never silently fuses unrelated solids.

Body placement is represented by a parametric Transform feature or by assembly occurrence placement. Raw B-rep coordinates are derived state, not hidden document placement.

Benchmark proof: fan disk, spinner, shaft, casing, liner, and nozzle remain separately selectable after rebuild, save/reopen, undo/redo, and STEP export.

#### 40.4.3 Move, rotate, align, and transform

`Transform` supports:

- translation in world, datum, body-local, or component-local coordinates;
- rotation about a selected datum axis, cylindrical face axis, straight edge, or local triad axis;
- point-to-point, axis-to-axis, plane-to-plane, and coordinate-system alignment;
- copy, linked copy, and move-original modes;
- numeric fields plus a three-axis manipulator;
- exact preview, Apply, Cancel, and one-step undo/redo.

The inspector always shows the numeric transform and reference frame. Manipulator dragging never bakes an unexplained matrix.

Benchmark proof: move `S40 HPC-1` by editing its axial distance from `165` to `173`; the stage, its patterned blades, and its mates move together while unrelated stages remain fixed.

#### 40.4.4 Loft and Sweep

`Loft` accepts two or more ordered closed or open profiles, optional guide curves, vertex/parameter mapping, solid/surface result, start/end continuity, and closed/periodic options. The preview shows section order, seam, mapping, and self-intersection diagnostics.

`Sweep` accepts a profile, one connected path, optional guide/rail, orientation mode, scale law, and twist law. Required orientation modes are path-normal, fixed direction, selected reference, and controlled twist.

Both features preserve their source references and expose them in the tree and inspector. A failed exact build keeps the last valid result visible and the draft editable.

Benchmark proof: the nacelle is a multi-section Loft or revolved/swept equivalent with a smooth inlet and tapered exit; the bypass splitter or duct uses Sweep/Loft; the resulting solids pass exact validity checks.

#### 40.4.5 Twisted blade profiles

The fan blade source is not a rectangle or a single extruded polygon. It must use:

- at least three closed spline profiles: root, mid, and tip;
- distinct radial stations;
- root-to-tip chord reduction of at least `20%`;
- profile thickness between `6%` and `18%` of local chord;
- root-to-tip stagger/twist change of at least `15°`;
- a valid solid Loft with no self-intersection;
- an editable root treatment connecting the blade to its disk or root platform.

The profile data can be sketched, pasted as coordinates, or imported as a bounded profile resource, but it becomes normal editable sketch/profile data. A finished imported blade solid does not satisfy this gate.

Compressor and turbine rows may use simplified airfoil profiles, but at least one compressor blade definition and one turbine blade definition must also use three-section tapered/twisted Lofts.

#### 40.4.6 True editable patterns

Feature, body, and component patterns store:

- source reference;
- axis/path/direction reference;
- count and angular/linear extent;
- equal or table-driven spacing;
- orientation policy;
- skipped occurrence set;
- stable derived occurrence identities.

Generated instances remain linked to one source definition. They are not serialized as unrelated geometry copies. Editing the source blade, blade count, or pattern axis updates the row in one rebuild and preserves unaffected selection/visibility state.

Benchmark proof: fan count changes `12 → 14`; every blade gains the edited tip twist; the project does not acquire 14 independent blade feature histories.

#### 40.4.7 Selected-body Boolean operations

The Part workspace provides Union, Subtract, Intersect, Split, and Keep Tools. Every Boolean editor identifies target bodies, tool bodies, result policy, and whether tools are retained. Preview distinguishes target, tool, added material, and removed material.

Disjoint, empty, invalid, or non-manifold results are reported before commit. Failure changes neither the canonical document nor undo/redo stacks and leaves the last valid result visible.

Benchmark proof: cut annular passages from the nacelle/core casing, retain the construction tools where requested, and unite blade-root geometry only with its intended rotor body. No Boolean may fuse stationary casing to rotating hardware.

#### 40.4.8 Assemblies, components, and concentric mates

A reusable part definition can appear through multiple lightweight occurrences. Assemblies can contain part occurrences and nested subassemblies. Editing a part updates all linked occurrences; `Make independent` is explicit and undoable.

Required mate types for this benchmark are Fixed, Concentric, Coincident, Distance, and Angle. Each mate identifies both occurrence paths and both geometric/datum references. The solver reports remaining degrees of freedom, conflicts, missing references, and the minimal conflict set.

Benchmark proof: rotor modules are concentric with `Engine axis`; axial station is controlled by Distance mates; nacelle/core structures are fixed or coincident; one source stage can be replaced without moving unrelated components.

#### 40.4.9 Section and cutaway views

Section and cutaway are non-destructive display operations. They never add Cut features or alter export geometry.

The user can create a section from a datum plane or interactive plane, flip it, show one side/both sides, include/exclude selected components, assign cap color/hatching, and save the view. Section caps are derived from exact solids where available. The tree remains fully selectable while sectioned.

Benchmark proof: a longitudinal half-section along the `XZ` plane simultaneously reveals bypass duct, core passage, compressor rows, combustor, turbine rows, both shafts, and nozzle. Turning the section off restores the unchanged assembly, and STEP export remains uncut.

#### 40.4.10 Axial model tree, spacing, and visibility

The root assembly tree supports stage groups with a stored station parameter:

```ts
type AxialStageGroup = {
  id: string;
  name: string;
  stationExpression: string;
  occurrenceIds: string[];
  visible: boolean;
  suppressed: boolean;
};
```

Stage groups are organizational/parametric references, not a turbofan-only geometry feature. The same grouping supports gearbox shafts, pump stages, and robot-joint modules.

The tree provides Hide, Show, Isolate, Suppress, Unsuppress, Rename, Expand all, Collapse all, and Filter. The inspector exposes the solved axial coordinate and controlling mate/transform. Hidden and suppressed are distinct states and survive save/reopen.

Benchmark proof: isolate the combustor, suppress and restore `S31 LPC stator-1`, change one stage-spacing parameter, and recover the complete assembly without visibility or selection drift.

### 40.5 Public-UI construction sequence

The golden fixture must be reproducible through these public commands; a test helper may accelerate clicks but may not inject undocumented project objects.

1. Create a V5 project and a root assembly.
2. Create a `Master layout` part containing `Engine axis` and all named station planes.
3. Build `Nacelle` from longitudinal profiles with Loft/Revolve plus Shell/Thicken.
4. Build `Bypass splitter` and `Core casing` as separate bodies or parts.
5. Build `Fan blade` from root/mid/tip profiles on controlled datum planes and Loft them into a valid tapered, twisted solid.
6. Build `Fan disk` and `Spinner` with selectable-axis Revolve.
7. Create a `Fan rotor` subassembly; mate disk and spinner; circular-pattern the linked blade occurrence.
8. Build reusable compressor rotor and stator blade definitions with at least one three-section Loft each.
9. Insert and pattern compressor rows at `S30`, `S31`, `S40`, and `S41` using concentric and distance mates.
10. Build outer combustor casing and inner liner as distinct thin solids and position them at `S50`.
11. Build reusable turbine rotor/stator blade definitions and insert patterned rows at `S60`, `S61`, and `S70`.
12. Build low- and high-pressure shafts as distinct revolved parts and mate them concentrically.
13. Build exhaust cone and tapered core/bypass nozzle at `S80`.
14. Assign appearances by functional group.
15. Run solid-health and interference checks; fix all unintended collisions.
16. Save front isometric, longitudinal half-section, rear isometric, and exploded views.
17. Save/reopen the native project and export structured STEP.

At every step, the tree and inspector must expose the active part, body, feature, references, values, and failure state.

### 40.6 Required row geometry

The canonical fixture uses these minimum row counts:

| Row | Instances | Shape requirement |
| --- | ---: | --- |
| fan | 12 | three-section Loft, tapered, root-to-tip twist at least `15°` |
| fan exit guide vanes | 14 | curved or lofted vane, not radial rectangular spokes |
| LPC rotor | 16 | linked blade occurrences |
| LPC stator | 18 | linked vane occurrences |
| HPC rotor | 18 | linked blade occurrences |
| HPC stator | 20 | linked vane occurrences |
| HPT rotor | 14 | linked three-section hot-section blade occurrences |
| HPT stator | 16 | linked vane occurrences |
| LPT rotor | 18 | linked blade occurrences |

The exact counts remain parameters. Fixture performance limits in §27 still apply.

### 40.7 Passage and sectional-legibility rules

In the saved longitudinal half-section, a reviewer must be able to trace two uninterrupted simplified flow paths:

- **bypass path:** inlet → fan annulus → bypass duct around the core → bypass exit;
- **core path:** fan/core inlet → compressor rows → annular combustor passage → turbine rows → core nozzle.

The fixture fails if the section shows only repeated solid disks, if casing material blocks either path, if rotating and stationary rows occupy the same station, or if the shaft/nozzle terminates arbitrarily inside a closed solid.

### 40.8 No-cheat rules

The conformance project fails if any of these are true:

- a finished turbofan mesh or opaque finished B-rep is imported;
- a hidden fixture-only command creates geometry users cannot create with public features;
- all visible engine geometry evaluates into one fused body;
- blades are flat rectangles, single-section extrusions, or baked unrelated copies;
- pattern instances lose their source relationship;
- axial placement exists only as hard-coded vertex coordinates;
- section screenshots are produced with destructive Cut features or a separate pre-cut model;
- major internal stages cannot be selected independently;
- a visual screenshot passes while solid validity, body ownership, mate solve, save/reopen, or export assertions fail;
- the model only looks correct from one saved camera.

### 40.9 Automated structural assertions

The checked-in `turbofan-v5.bomcad` fixture and construction scenario must assert:

```text
schemaVersion == 5
partDefinitions >= 15
namedSolidBodies >= 24
solvedOccurrences >= 100
linkedPatternDefinitions >= 8
fanBladeSections >= 3
fanBladeRootTipTwistDelta >= 15deg
fanBladeChordReduction >= 20percent
axialRotorRows >= 5
axialStatorRows >= 3
concentricMates >= 8
distanceMates >= 8
invalidSolids == 0
unintendedInterferences == 0
savedHalfSections >= 1
savedExplodedViews >= 1
```

Assertions inspect canonical document structure and exact kernel results. Counting scene meshes or DOM nodes is not acceptable evidence.

### 40.10 Browser interaction scenario

The release browser suite must use visible public controls to:

1. open the canonical fixture;
2. Fit, orbit, zoom in, orbit, zoom out, and select the fan blade source;
3. isolate the fan rotor and restore all components;
4. open the blade source and edit tip twist;
5. change fan occurrence count;
6. change one compressor-stage distance mate;
7. suppress and restore one stator group;
8. activate longitudinal half-section and select internal stages;
9. run interference and solid-health checks;
10. undo and redo the stage edit;
11. save, reopen, and compare canonical structural hashes;
12. export STEP and validate product hierarchy, solid count, names, transforms, and units.

The test records exact command/rebuild states. It fails on a native browser alert, an unexplained disabled control, lost focus, stale canvas geometry, or a silent partial rebuild.

### 40.11 Visual acceptance set

Human review requires four exact desktop captures at `1600 × 1000`:

1. front three-quarter isometric showing a smooth inlet, shaped fan blades, hub, and spinner;
2. longitudinal half-section showing bypass/core paths and every required axial stage;
3. rear three-quarter isometric showing nozzle, rear structure, and depth;
4. axial exploded view showing distinct modules and shafts.

The reviewer answers yes to all of these:

- Does it read immediately as a small turbofan demonstrator rather than a household fan?
- Do the blades visibly taper and twist?
- Does the engine have credible axial length and multiple internal stages?
- Can stationary, rotating, casing, shaft, combustor, and nozzle structures be distinguished?
- Does sectioning explain how the assembly is organized?
- Does the exploded view correspond to the same solved model?

One negative answer keeps `v5-visual` and `v5-turbofan` open.

### 40.12 Parametric edit acceptance

The same saved project must survive, one at a time and in sequence:

- `fanTipDiameter: 160 → 176`;
- `fanBladeCount: 12 → 14`;
- `fanTipTwist: current + 5°`;
- `nacelleWall: 3 → 4`;
- `S40 HPC-1: 165 → 173`;
- suppress/restore `S31 LPC stator-1`;
- replace one reusable bearing placeholder with another compatible component.

For every edit:

- the visible Rebuilding state appears;
- unrelated bodies retain identity and placement;
- dependent patterns and mates update;
- no intended solid becomes invalid;
- the last valid model remains interactive until the new result is ready;
- Undo restores the exact preceding document and solved result;
- Redo reproduces the edit;
- save/reopen reproduces the final state.

### 40.13 Release decision

The schema-5 foundation alone does not satisfy this benchmark. Toolbar controls, static templates, screenshots, or individual kernel demos do not satisfy it either.

V5 may close `v5-turbofan` only when one production-candidate build passes §§40.3–40.12 from the public Studio UI and uploads:

- the editable native project;
- its construction-command log;
- structural and exact-geometry assertion manifest;
- browser interaction trace;
- STEP round-trip report;
- performance results from §27;
- the four human-approved visual captures.

Until that evidence exists, the truthful status is:

> V5 has a complex-modeling schema foundation, but CAD Studio cannot yet author and verify a credible editable turbofan assembly.
