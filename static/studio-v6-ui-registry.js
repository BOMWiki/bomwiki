// Source-owned inventory for literal CAD Studio UI parity.
//
// This registry is deliberately broader than the currently implemented V6
// semantic adapter set. It is the release denominator: a human-operable
// production control cannot disappear merely because an agent adapter has not
// been written yet.

const clone = (value) => structuredClone(value);

const attributeBinding = (attribute, value) => Object.freeze({ kind: 'attribute', attribute, value });
const idBinding = (elementId) => Object.freeze({ kind: 'element-id', elementId });
const dynamicBinding = (family) => Object.freeze({ kind: 'dynamic-family', family });
const controlIdBinding = (controlId) => attributeBinding('data-v6-control-id', controlId);

function control(id, label, group, humanBindings, {
  kind = 'action',
  workspaceId = null,
  semanticAction = 'control.invoke',
  adapter = 'missing',
  permission = 'ui.navigate',
  operationKinds = [],
  fields = [],
  variants = [],
  contextualReasonCode = null,
  adapterTool = null,
  completionTool = null,
  commandId = null,
  commandResolver = null,
  templateId = null,
  sectionId = null,
  fieldId = null,
  semanticActions = null,
  permissions = null,
} = {}) {
  return Object.freeze({
    id,
    label,
    group,
    kind,
    workspaceId,
    humanBindings: Object.freeze(humanBindings),
    semanticAction,
    adapter,
    permission,
    operationKinds: Object.freeze(operationKinds),
    fields: Object.freeze(fields),
    variants: Object.freeze(variants),
    contextualReasonCode,
    adapterTool,
    completionTool,
    commandId,
    commandResolver,
    templateId,
    sectionId,
    fieldId,
    semanticActions,
    permissions,
  });
}

const variant = (id, label, options = {}) => Object.freeze({ id, label, ...options });
const controlBoundVariant = (id, label, options = {}) => variant(id, label, {
  humanBindings: Object.freeze([controlIdBinding(options.controlId || id)]),
  ...options,
});
const familyVariant = (parentControlId, id, label, options = {}) =>
  controlBoundVariant(id, label, { controlId: `${parentControlId}.${id}`, ...options });
const familyDocumentEditVariant = (parentControlId, id, label, operationKind) =>
  familyVariant(parentControlId, id, label, {
    semanticAction: 'document.previewCommit',
    adapter: 'available',
    permission: 'project.edit',
    adapterTool: 'cad_preview',
    completionTool: 'cad_commit',
    operationKinds: Object.freeze([operationKind]),
  });
const familyFeatureEditVariant = (parentControlId, id, label) =>
  familyVariant(parentControlId, id, label, {
    semanticAction: 'command.open',
    adapter: 'available',
    permission: 'ui.command-draft',
    commandResolver: 'selected-feature-kind',
  });
const familyEntityEditVariant = (parentControlId, id, label, commandId, commandResolver = null) =>
  familyVariant(parentControlId, id, label, {
    semanticAction: 'command.open',
    adapter: 'available',
    permission: 'ui.command-draft',
    commandId,
    commandResolver,
  });

const commandBinding = (value) => attributeBinding('data-v5-command', value);
const assemblyBinding = (value) => attributeBinding('data-assembly-command', value);
const mateBinding = (value) => attributeBinding('data-assembly-mate', value);
const inspectionBinding = (value) => attributeBinding('data-inspection-command', value);
const displayBinding = (value) => attributeBinding('data-display-mode', value);
const viewBindings = (value) => Object.freeze([
  attributeBinding('data-view', value),
  ...(['top', 'iso', 'fit'].includes(value) ? [attributeBinding('data-command-view', value)] : []),
  attributeBinding('data-cube-view', value),
]);

const TRANSFORM_FIELDS = Object.freeze([
  { id: 'occurrence', label: 'Component occurrence', kind: 'selection', required: true, minItems: 1, maxItems: 1, selectionKinds: ['occurrence'] },
  { id: 'gizmoMode', label: 'Handle mode', kind: 'enum', values: ['translate', 'rotate'], required: true },
  { id: 'gizmoSnap', label: 'Handle snap', kind: 'number-or-expression', required: true },
  { id: 'transform', label: 'Rigid 4×4 transform', kind: 'matrix4', required: true, finite: true },
]);

const textField = (id, label, options = {}) => Object.freeze({ id, label, kind: 'text', ...options });
const numberField = (id, label, options = {}) => Object.freeze({ id, label, kind: 'number-or-expression', ...options });
const booleanField = (id, label) => Object.freeze({ id, label, kind: 'boolean' });
const enumField = (id, label, values, options = {}) => Object.freeze({ id, label, kind: 'enum', values: Object.freeze(values), ...options });
const selectionField = (id, label, selectionKinds, options = {}) => Object.freeze({
  id,
  label,
  kind: 'selection',
  selectionKinds: Object.freeze(selectionKinds),
  ...options,
});
const vector3Field = (id, label, options = {}) => Object.freeze({ id, label, kind: 'vector3', finite: true, ...options });
const listField = (id, label, itemKind, options = {}) => Object.freeze({ id, label, kind: 'list', itemKind, ...options });
const pointsField = (id, label, dimensions, options = {}) => Object.freeze({ id, label, kind: 'points', dimensions, ...options });

const RESULT_POLICY_FIELDS = Object.freeze([
  enumField('resultPolicy', 'Result policy', ['new-body', 'add', 'subtract', 'intersect'], { required: true }),
  textField('bodyName', 'Result body name'),
  selectionField('targetBody', 'Target body', ['body'], { maxItems: 1 }),
]);

const SKETCH_FEATURE_FIELDS = Object.freeze([
  selectionField('supportFace', 'Sketch support face', ['face'], { maxItems: 1 }),
  listField('sketch', 'Sketch shapes', 'sketch-shape', { required: true, minItems: 1 }),
  numberField('height', 'Distance', { required: true }),
  enumField('patternKind', 'Feature pattern type', ['none', 'linear', 'circular'], { required: true }),
  numberField('patternCount', 'Feature pattern count', { required: true }),
  numberField('patternA', 'Feature pattern first spacing', { required: true }),
  numberField('patternB', 'Feature pattern second spacing', { required: true }),
  ...RESULT_POLICY_FIELDS,
]);

const EDGE_FEATURE_FIELDS = Object.freeze([
  selectionField('edges', 'Edges', ['edge'], { required: true, minItems: 1 }),
  numberField('radius', 'Radius', { required: true }),
]);

const BODY_SELECTION_FIELD = selectionField('body', 'Body', ['body'], {
  required: true,
  minItems: 1,
  maxItems: 1,
});

const MOVE_BODY_FIELDS = Object.freeze([
  BODY_SELECTION_FIELD,
  vector3Field('translation', 'Translation', { required: true }),
  numberField('gizmoSnap', 'Handle snap', { required: true }),
]);

const ROTATE_BODY_FIELDS = Object.freeze([
  BODY_SELECTION_FIELD,
  selectionField('axisDatum', 'Rotation axis', ['datum'], { required: true, minItems: 1, maxItems: 1 }),
  numberField('angle', 'Angle', { required: true }),
  numberField('gizmoSnap', 'Handle snap', { required: true }),
]);

const MIRROR_BODY_FIELDS = Object.freeze([
  BODY_SELECTION_FIELD,
  selectionField('planeDatum', 'Mirror plane', ['datum'], { required: true, minItems: 1, maxItems: 1 }),
  booleanField('moveOriginal', 'Move original instead of creating a linked mirror'),
]);

const SCALE_BODY_FIELDS = Object.freeze([
  BODY_SELECTION_FIELD,
  numberField('factor', 'Uniform factor', { required: true }),
  vector3Field('center', 'Scale center', { required: true }),
]);

const ALIGN_BODY_FIELDS = Object.freeze([
  BODY_SELECTION_FIELD,
  selectionField('fromDatum', 'From reference', ['datum'], { required: true, minItems: 1, maxItems: 1 }),
  selectionField('toDatum', 'To reference', ['datum'], { required: true, minItems: 1, maxItems: 1 }),
  numberField('offset', 'Alignment offset', { required: true }),
  booleanField('flip', 'Flip alignment'),
]);

const MATE_FIELDS = Object.freeze([
  textField('name', 'Mate name', { required: true }),
  selectionField('anchorOccurrence', 'Anchor component', ['occurrence'], { minItems: 1, maxItems: 1 }),
  selectionField('movingOccurrence', 'Moving component', ['occurrence'], { required: true, minItems: 1, maxItems: 1 }),
  selectionField('anchorReference', 'Anchor topology reference', ['occurrence', 'datum', 'face', 'edge'], { maxItems: 1 }),
  selectionField('movingReference', 'Moving topology reference', ['occurrence', 'datum', 'face', 'edge'], { maxItems: 1 }),
  numberField('value', 'Offset, distance, or angle'),
  booleanField('flip', 'Flip alignment direction'),
]);

const COMMAND_FIELD_CONTRACTS = Object.freeze({
  'model.extrude': SKETCH_FEATURE_FIELDS,
  'model.cut': Object.freeze([...SKETCH_FEATURE_FIELDS, booleanField('through', 'Through all')]),
  'model.revolve': Object.freeze([
    listField('sketch', 'Sketch shapes', 'sketch-shape', { required: true, minItems: 1 }),
    ...RESULT_POLICY_FIELDS,
  ]),
  'model.fillet': EDGE_FEATURE_FIELDS,
  'model.chamfer': EDGE_FEATURE_FIELDS,
  'model.shell': Object.freeze([
    selectionField('body', 'Body', ['body'], { required: true, minItems: 1, maxItems: 1 }),
    selectionField('faces', 'Faces to remove', ['face'], { required: true, minItems: 1 }),
    numberField('thickness', 'Wall thickness', { required: true }),
  ]),
  'model.split': Object.freeze([
    textField('name', 'Split name', { required: true }),
    selectionField('targetBody', 'Target body', ['body'], { required: true, minItems: 1, maxItems: 1 }),
    selectionField('toolBody', 'Splitting tool body', ['body'], { required: true, minItems: 1, maxItems: 1 }),
    booleanField('keepOriginal', 'Keep original target visible'),
    booleanField('keepTools', 'Keep tool bodies visible'),
  ]),
  'model.plane': Object.freeze([
    textField('name', 'Plane name', { required: true }),
    enumField('mode', 'Plane definition', ['offset', 'angle', 'three-point', 'point-normal', 'midplane', 'curve-normal'], { required: true }),
    selectionField('referenceDatum', 'Reference plane', ['datum'], { maxItems: 1 }),
    selectionField('axisDatum', 'Rotation axis', ['datum'], { maxItems: 1 }),
    selectionField('firstDatum', 'First mid-plane reference', ['datum'], { maxItems: 1 }),
    selectionField('secondDatum', 'Second mid-plane reference', ['datum'], { maxItems: 1 }),
    selectionField('pointDatum', 'Point datum', ['datum'], { maxItems: 1 }),
    numberField('offset', 'Offset'),
    numberField('angle', 'Angle'),
    pointsField('points', 'Plane points', 3, { minItems: 3, maxItems: 3 }),
    vector3Field('normal', 'Normal'),
  ]),
  'model.align': ALIGN_BODY_FIELDS,
  'model.profile': Object.freeze([
    textField('name', 'Profile name', { required: true }),
    enumField('curveKind', 'Curve kind', ['spline', 'polyline'], { required: true }),
    selectionField('planeDatum', 'Profile plane', ['datum'], { required: true, minItems: 1, maxItems: 1 }),
    pointsField('points', 'Profile points', 2, { required: true, minItems: 2 }),
  ]),
  'model.path': Object.freeze([
    textField('name', 'Path name', { required: true }),
    enumField('curveKind', 'Curve kind', ['spline', 'polyline'], { required: true }),
    pointsField('points', 'Path points', 3, { required: true, minItems: 2 }),
  ]),
  'model.loft': Object.freeze([
    textField('name', 'Loft name', { required: true }),
    selectionField('sections', 'Profile sections', ['sketch'], { required: true, minItems: 2 }),
    selectionField('guideSketch', 'Guide rail', ['sketch'], { maxItems: 1 }),
    selectionField('centerlineSketch', 'Centerline', ['sketch'], { maxItems: 1 }),
    enumField('startContinuity', 'Start continuity', ['free', 'tangent', 'curvature'], { required: true }),
    enumField('endContinuity', 'End continuity', ['free', 'tangent', 'curvature'], { required: true }),
    booleanField('ruled', 'Ruled loft'),
  ]),
  'model.sweep': Object.freeze([
    textField('name', 'Sweep name', { required: true }),
    selectionField('profileSketch', 'Profile', ['sketch'], { required: true, minItems: 1, maxItems: 1 }),
    selectionField('pathSketch', 'Path', ['sketch'], { required: true, minItems: 1, maxItems: 1 }),
    selectionField('guideSketch', 'Guide rail', ['sketch'], { maxItems: 1 }),
    enumField('orientation', 'Orientation', ['path-normal', 'minimum-twist', 'fixed', 'reference', 'guide', 'controlled-twist'], { required: true }),
    numberField('twistAngle', 'Twist angle'),
    numberField('scaleEnd', 'End scale'),
    vector3Field('referenceDirection', 'Reference direction'),
  ]),
  'model.revolve-advanced': Object.freeze([
    textField('name', 'Revolve name', { required: true }),
    selectionField('profileSketch', 'Profile', ['sketch'], { required: true, minItems: 1, maxItems: 1 }),
    selectionField('axisDatum', 'Axis', ['datum'], { required: true, minItems: 1, maxItems: 1 }),
    numberField('angle', 'Sweep angle', { required: true }),
    numberField('startAngle', 'Start angle'),
    booleanField('symmetric', 'Symmetric'),
  ]),
  'model.draft': Object.freeze([
    textField('name', 'Draft name', { required: true }),
    selectionField('body', 'Body', ['body'], { required: true, minItems: 1, maxItems: 1 }),
    selectionField('neutralPlane', 'Neutral plane', ['datum'], { required: true, minItems: 1, maxItems: 1 }),
    selectionField('faces', 'Faces', ['face'], { required: true, minItems: 1 }),
    numberField('angle', 'Draft angle', { required: true }),
    booleanField('flip', 'Flip angle'),
    booleanField('tangentPropagation', 'Tangent propagation'),
  ]),
  'model.thicken': Object.freeze([
    textField('name', 'Thicken name', { required: true }),
    selectionField('body', 'Body', ['body'], { required: true, minItems: 1, maxItems: 1 }),
    selectionField('faces', 'Source face', ['face'], { required: true, minItems: 1, maxItems: 1 }),
    textField('bodyName', 'New body name', { required: true }),
    numberField('thickness', 'Thickness', { required: true }),
    booleanField('symmetric', 'Symmetric thickness'),
    booleanField('flip', 'Flip direction'),
  ]),
  'model.variable-fillet': Object.freeze([
    textField('name', 'Variable fillet name', { required: true }),
    selectionField('body', 'Body', ['body'], { required: true, minItems: 1, maxItems: 1 }),
    selectionField('edges', 'Edges', ['edge'], { required: true, minItems: 1 }),
    numberField('startRadius', 'Start radius', { required: true }),
    numberField('endRadius', 'End radius', { required: true }),
    booleanField('tangentPropagation', 'Tangent propagation'),
  ]),
  'model.pattern': Object.freeze([
    textField('name', 'Pattern name', { required: true }),
    selectionField('sourceBody', 'Source body', ['body'], { required: true, minItems: 1, maxItems: 1 }),
    enumField('patternKind', 'Pattern type', ['circular', 'linear', 'curve', 'mirror'], { required: true }),
    enumField('outputMode', 'Output mode', ['linked', 'union'], { required: true }),
    numberField('count', 'Count', { required: true }),
    selectionField('axisDatum', 'Axis', ['datum'], { maxItems: 1 }),
    selectionField('directionDatums', 'Directions', ['datum'], { maxItems: 2 }),
    selectionField('planeDatum', 'Mirror plane', ['datum'], { maxItems: 1 }),
    selectionField('pathSketch', 'Curve path', ['sketch'], { maxItems: 1 }),
    enumField('distribution', 'Distribution', ['full', 'spacing', 'extent', 'equal', 'table'], { required: true }),
    enumField('orientation', 'Orientation', ['rotate', 'preserve', 'alternating', 'tangent', 'fixed'], { required: true }),
    numberField('spacing', 'Linear spacing', { required: true }),
    numberField('extent', 'Linear extent', { required: true }),
    numberField('count2', 'Second direction count', { required: true }),
    numberField('spacing2', 'Second direction spacing', { required: true }),
    numberField('extent2', 'Second direction extent', { required: true }),
    numberField('totalAngle', 'Total angle', { required: true }),
    numberField('spacingAngle', 'Spacing angle', { required: true }),
    numberField('radialOffset', 'Radial offset', { required: true }),
    numberField('axialOffset', 'Axial offset', { required: true }),
    booleanField('symmetric', 'Symmetric distribution'),
    booleanField('symmetric2', 'Symmetric second direction'),
    listField('tableValues', 'Table values', 'number-or-expression'),
    listField('tableValues2', 'Second direction table values', 'number-or-expression'),
    listField('skippedIndices', 'Skipped indices', 'integer'),
  ]),
  'model.move': MOVE_BODY_FIELDS,
  'model.copy': MOVE_BODY_FIELDS,
  'model.rotate': ROTATE_BODY_FIELDS,
  'model.mirror': MIRROR_BODY_FIELDS,
  'model.scale': SCALE_BODY_FIELDS,
  'assembly.create': Object.freeze([
    textField('name', 'Assembly name', { required: true }),
    textField('occurrenceName', 'First occurrence name', { required: true }),
    booleanField('fixed', 'Fix first component'),
  ]),
  'assembly.insert': Object.freeze([
    selectionField('definition', 'Reusable definition', ['part', 'assembly'], { required: true, minItems: 1, maxItems: 1 }),
    textField('name', 'Occurrence name', { required: true }),
    vector3Field('translation', 'Translation'),
    booleanField('fixed', 'Fix component'),
  ]),
  'assembly.linked': Object.freeze([
    selectionField('occurrence', 'Source occurrence', ['occurrence'], { required: true, minItems: 1, maxItems: 1 }),
    textField('name', 'Occurrence name', { required: true }),
    vector3Field('translation', 'Translation'),
  ]),
  'assembly.independent': Object.freeze([
    selectionField('occurrence', 'Source occurrence', ['occurrence'], { required: true, minItems: 1, maxItems: 1 }),
    textField('name', 'Independent part name', { required: true }),
  ]),
  'assembly.replace': Object.freeze([
    selectionField('occurrence', 'Occurrence', ['occurrence'], { required: true, minItems: 1, maxItems: 1 }),
    selectionField('definition', 'Replacement definition', ['part', 'assembly'], { required: true, minItems: 1, maxItems: 1 }),
  ]),
  'assembly.variant': Object.freeze([
    selectionField('occurrence', 'Occurrence', ['occurrence'], { required: true, minItems: 1, maxItems: 1 }),
    listField('parameterOverrides', 'Parameter overrides', 'name-expression'),
  ]),
  'assembly.component-transform': TRANSFORM_FIELDS,
  'assembly.edit-context': Object.freeze([
    selectionField('occurrence', 'Occurrence', ['occurrence'], { required: true, minItems: 1, maxItems: 1 }),
  ]),
  'assembly.exit-context': Object.freeze([]),
  'assembly.pattern': Object.freeze([
    selectionField('occurrence', 'Source occurrence', ['occurrence'], { required: true, minItems: 1, maxItems: 1 }),
    textField('name', 'Pattern name', { required: true }),
    enumField('patternKind', 'Pattern type', ['circular', 'linear'], { required: true }),
    numberField('generatedCount', 'Generated count', { required: true, integer: true, minimum: 1 }),
    numberField('spacing', 'Spacing'),
    numberField('totalAngle', 'Total angle'),
  ]),
  ...Object.fromEntries([
    'fixed', 'coincident', 'concentric', 'distance', 'angle',
    'parallel', 'perpendicular', 'tangent', 'revolute', 'slider',
  ].map((kind) => [`assembly.mate.${kind}`, MATE_FIELDS])),
  'inspection.section': Object.freeze([
    textField('name', 'Section name', { required: true }),
    enumField('sectionKind', 'Section mode', ['plane', 'quarter', 'box'], { required: true }),
    numberField('offset', 'Offset', { required: true }),
    selectionField('scopeOccurrence', 'Scope occurrence', ['occurrence'], { maxItems: 1 }),
    booleanField('cap', 'Section cap'),
    booleanField('reverse', 'Reverse'),
    numberField('hatchSpacing', 'Hatch spacing', { required: true }),
    numberField('hatchAngle', 'Hatch angle', { required: true }),
    textField('capFillColor', 'Cap fill color', { format: 'color' }),
    textField('hatchColor', 'Hatch color', { format: 'color' }),
  ]),
  'inspection.explode': Object.freeze([
    textField('name', 'View name', { required: true }),
    selectionField('occurrence', 'Occurrence', ['occurrence'], { required: true, minItems: 1, maxItems: 1 }),
    vector3Field('translation', 'Translation', { required: true }),
  ]),
  'inspection.stage': Object.freeze([
    textField('name', 'Stage group name', { required: true }),
    listField('occurrenceIds', 'Ordered occurrences', 'occurrence-id', { required: true, minItems: 1 }),
    listField('distanceMateIds', 'Distance mates', 'mate-id', { required: true, minItems: 1 }),
    numberField('start', 'First station', { required: true }),
    numberField('spacing', 'Stage spacing', { required: true }),
    booleanField('visible', 'Group visibility'),
  ]),
  'inspection.material': Object.freeze([
    selectionField('body', 'Body', ['body'], { required: true, minItems: 1, maxItems: 1 }),
    selectionField('material', 'Material', ['material'], { required: true, minItems: 1, maxItems: 1 }),
  ]),
  'inspection.measure': Object.freeze([
    textField('name', 'Measurement name', { required: true }),
    enumField('measurementKind', 'Measurement type', ['bounding-box', 'minimum-clearance'], { required: true }),
    selectionField('bodies', 'Bodies', ['body'], { required: true, minItems: 1, maxItems: 2 }),
  ]),
});

const projectControls = [
  control('history.undo', 'Undo', 'project', [idBinding('bw-undo'), attributeBinding('data-command-target', 'bw-undo')], { semanticAction: 'history.undo', adapter: 'available', permission: 'project.edit' }),
  control('history.redo', 'Redo', 'project', [idBinding('bw-redo'), attributeBinding('data-command-target', 'bw-redo')], { semanticAction: 'history.redo', adapter: 'available', permission: 'project.edit' }),
  control('project.templates', 'Template library', 'project', [idBinding('bw-templates-open'), attributeBinding('data-command-target', 'bw-templates-open')], { adapter: 'available' }),
  control('project.save', 'Save project file', 'project', [idBinding('bw-save-file'), attributeBinding('data-command-target', 'bw-save-file')], { semanticAction: 'artifact.export-project', adapter: 'available', permission: 'artifact.export-project' }),
  control('project.open', 'Open project or STEP', 'project', [idBinding('bw-open-btn'), idBinding('bw-open-file'), attributeBinding('data-command-target', 'bw-open-btn')], {
    semanticAction: 'artifact.import',
    adapter: 'available',
    permission: 'project.replace',
    adapterTool: 'cad_artifact',
  }),
  control('project.recover', 'Recover local project', 'project', [idBinding('bw-recover-open'), attributeBinding('data-command-target', 'bw-recover-open')], { semanticAction: 'recovery.open', adapter: 'available', permission: 'project.recover' }),
  control('project.clear', 'Clear project', 'project', [idBinding('bw-clear'), attributeBinding('data-command-target', 'bw-clear')], { adapter: 'available' }),
  control('export.step', 'Export STEP', 'project', [idBinding('bw-export-step'), attributeBinding('data-command-target', 'bw-export-step')], { semanticAction: 'artifact.export-step', adapter: 'available', permission: 'artifact.export-step' }),
  control('export.stl', 'Export STL', 'project', [idBinding('bw-export-stl'), attributeBinding('data-command-target', 'bw-export-stl')], { semanticAction: 'artifact.export-stl', adapter: 'available', permission: 'artifact.export-stl' }),
  control('app.help', 'Help', 'application', [idBinding('bw-help-open'), idBinding('bw-help-status'), attributeBinding('data-command-target', 'bw-help-open')], { adapter: 'available' }),
  control('app.fullscreen', 'Full screen', 'application', [idBinding('bw-fullscreen'), attributeBinding('data-command-target', 'bw-fullscreen')], {
    semanticAction: 'application.fullscreen',
    adapter: 'contextual',
    contextualReasonCode: 'BROWSER_TRANSIENT_ACTIVATION_REQUIRED',
  }),
  control('app.exit', 'Exit Studio', 'application', [attributeBinding('href', '/cad')], {
    semanticAction: 'application.navigate',
    adapter: 'available',
    permission: 'ui.navigate',
    adapterTool: 'cad_ui',
  }),
  control('app.agent-activity', 'Agent activity', 'application', [dynamicBinding('agent.activity')], {
    semanticAction: 'session.manage',
    adapter: 'contextual',
    permission: 'session.connect',
    contextualReasonCode: 'HUMAN_AUTHORITY_BOUNDARY',
    variants: [
      familyVariant('app.agent-activity', 'open', 'Open agent activity'),
      familyVariant('app.agent-activity', 'close', 'Close agent activity'),
      familyVariant('app.agent-activity', 'pause', 'Pause connected agent'),
      familyVariant('app.agent-activity', 'resume', 'Resume connected agent'),
      familyVariant('app.agent-activity', 'disconnect', 'Disconnect connected agent'),
    ],
  }),
  control('app.agent.connection-deny', 'Deny agent connection', 'application', [controlIdBinding('app.agent.connection-deny')], {
    semanticAction: 'session.connection-deny',
    adapter: 'contextual',
    permission: 'session.connect',
    contextualReasonCode: 'HUMAN_AUTHORITY_BOUNDARY',
  }),
  control('app.agent.connection-approve', 'Approve agent connection', 'application', [controlIdBinding('app.agent.connection-approve')], {
    semanticAction: 'session.connection-approve',
    adapter: 'contextual',
    permission: 'session.connect',
    contextualReasonCode: 'HUMAN_AUTHORITY_BOUNDARY',
  }),
  control('app.agent.preview-reject', 'Reject agent preview', 'application', [controlIdBinding('app.agent.preview-reject')], {
    semanticAction: 'session.preview-reject',
    adapter: 'contextual',
    permission: 'project.edit',
    contextualReasonCode: 'HUMAN_AUTHORITY_BOUNDARY',
  }),
  control('app.agent.preview-approve', 'Approve agent preview', 'application', [controlIdBinding('app.agent.preview-approve')], {
    semanticAction: 'session.preview-approve',
    adapter: 'contextual',
    permission: 'project.edit',
    contextualReasonCode: 'HUMAN_AUTHORITY_BOUNDARY',
  }),
];

const workspaceControls = ['home', 'sketch', 'solid', 'assembly', 'view', 'manage', 'output'].map((id) =>
  control(`workspace.${id}`, `${id} workspace`, 'workspace', [attributeBinding('data-workspace', id)], {
    kind: 'workspace',
    workspaceId: id,
    semanticAction: 'workspace.activate',
    adapter: id === 'sketch' ? 'contextual' : 'available',
    contextualReasonCode: id === 'sketch' ? 'REQUIRES_ACTIVE_SKETCH' : null,
  }));

const basicFeatureControls = [
  ['extrude', 'Extrude', 'feature.extrude'],
  ['cut', 'Cut', 'feature.cut'],
  ['revolve', 'Revolve', 'feature.revolve'],
  ['fillet', 'Fillet edge', 'feature.fillet'],
  ['chamfer', 'Chamfer edge', 'feature.chamfer'],
  ['shell', 'Shell body', 'feature.shell'],
].map(([id, label, operationKind]) =>
  control(`model.${id}`, label, 'modeling', [
    attributeBinding('data-feat', id),
    attributeBinding('data-command-feat', id),
  ], {
    kind: 'command',
    workspaceId: 'solid',
    semanticAction: 'command.open',
    adapter: 'available',
    permission: 'ui.command-draft',
    operationKinds: [operationKind],
  }));

const advancedFeatureControls = [
  ['split', 'Boolean split', ['boolean.split']],
  ['plane', 'Construction plane', ['datum.create', 'datum.update']],
  ['align', 'Align body', ['body.transform', 'transform.update']],
  ['profile', 'Profile sketch', ['sketch.profile.create', 'sketch.advanced.update']],
  ['path', 'Path sketch', ['sketch.path.create', 'sketch.advanced.update']],
  ['loft', 'Loft', ['feature.loft', 'feature.advanced.update']],
  ['sweep', 'Sweep', ['feature.sweep', 'feature.advanced.update']],
  ['revolve-advanced', 'Partial revolve', ['feature.revolveProfile', 'feature.advanced.update']],
  ['draft', 'Draft', ['feature.draft', 'feature.advanced.update']],
  ['thicken', 'Thicken', ['feature.thicken', 'feature.advanced.update']],
  ['variable-fillet', 'Variable fillet', ['feature.variableFillet', 'feature.advanced.update']],
  ['pattern', 'Body pattern', ['pattern.create', 'pattern.update']],
  ['move', 'Move body', ['body.transform', 'transform.update']],
  ['copy', 'Copy body', ['body.transform', 'transform.update']],
  ['rotate', 'Rotate body', ['body.transform', 'transform.update']],
  ['mirror', 'Mirror body', ['body.transform', 'transform.update']],
  ['scale', 'Scale body', ['body.transform', 'transform.update']],
].map(([id, label, operationKinds]) =>
  control(`model.${id}`, label, 'modeling', [commandBinding(id)], {
    kind: 'command',
    workspaceId: 'solid',
    semanticAction: 'command.open',
    adapter: 'available',
    permission: 'ui.command-draft',
    operationKinds: [...new Set([...operationKinds, 'datum.create'])],
  }));

const sketchControls = ['line', 'rect', 'circle', 'poly', 'select', 'pan'].map((id) =>
  control(`sketch.tool.${id}`, `${id} sketch tool`, 'sketch', [attributeBinding('data-sktool', id)], {
    kind: 'tool',
    workspaceId: 'sketch',
    semanticAction: 'sketch.setTool',
    adapter: 'available',
    permission: 'ui.command-draft',
  }));

const assemblyControls = [
  ['create', 'Create assembly', ['assembly.create']],
  ['insert', 'Insert component', ['component.insert']],
  ['linked', 'Linked duplicate', ['component.duplicate']],
  ['independent', 'Make component independent', ['component.makeIndependent']],
  ['replace', 'Replace component definition', ['component.replace']],
  ['variant', 'Component variant', ['component.update']],
  ['transform', 'Move or rotate component', ['component.update'], 'available', TRANSFORM_FIELDS],
  ['edit-context', 'Edit component in context', ['assembly.context.enter']],
  ['exit-context', 'Return to assembly', ['assembly.context.exit']],
  ['pattern', 'Component pattern', ['component.pattern', 'component.pattern.update']],
].map(([id, label, operationKinds, adapter = 'available', fields = []]) =>
  control(`assembly.${id === 'transform' ? 'component-transform' : id}`, label, 'assembly', [assemblyBinding(id)], {
    kind: 'command',
    workspaceId: 'assembly',
    semanticAction: 'command.open',
    adapter,
    permission: 'ui.command-draft',
    operationKinds,
    fields,
  }));

const mateControls = [
  'fixed', 'coincident', 'concentric', 'distance', 'angle',
  'parallel', 'perpendicular', 'tangent', 'revolute', 'slider',
].map((id) =>
  control(`assembly.mate.${id}`, `${id} mate`, 'assembly', [mateBinding(id)], {
    kind: 'command',
    workspaceId: 'assembly',
    semanticAction: 'command.open',
    adapter: 'available',
    permission: 'ui.command-draft',
    operationKinds: ['mate.create', 'mate.update'],
  }));

const inspectionControls = [
  ['section', 'Section view', ['section.create', 'section.update']],
  ['explode', 'Exploded view', ['exploded.create']],
  ['stage', 'Axial stage group', ['stage.create', 'stage.update']],
  ['material', 'Material assignment', ['material.ensureGeneric', 'material.assignBody', 'appearance.assignOccurrence']],
  ['properties', 'Mass and geometry health', []],
  ['measure', 'Saved measurement', ['measurement.create', 'measurement.update']],
  ['measurements', 'Evaluate measurements', []],
  ['clearance', 'Clearance', []],
  ['interference', 'Interference', []],
].map(([id, label, operationKinds]) =>
  control(`inspection.${id}`, label, 'inspection', [inspectionBinding(id)], {
    kind: operationKinds.length ? 'command' : 'query',
    workspaceId: 'assembly',
    semanticAction: operationKinds.length ? 'command.open' : 'inspection.run',
    permission: operationKinds.length ? 'ui.command-draft' : 'document.read',
    operationKinds,
    adapter: ['section', 'explode', 'stage', 'material', 'measure', 'properties', 'measurements', 'clearance', 'interference'].includes(id) ? 'available' : 'missing',
  }));

const displayControls = ['shaded-edges', 'wireframe', 'hidden-line', 'ghost'].map((id) =>
  control(`display.${id}`, `${id} display`, 'viewport', [displayBinding(id)], {
    kind: 'mode',
    workspaceId: 'assembly',
    semanticAction: 'display.setMode',
    adapter: 'available',
  }));

const viewControls = ['top', 'front', 'right', 'iso', 'fit'].map((id) =>
  control(`view.${id}`, `${id} view`, 'viewport', viewBindings(id), {
    kind: 'view',
    semanticAction: id === 'fit' ? 'camera.fitAll' : 'camera.setStandard',
    adapter: 'available',
  }));

const dialogControls = [
  ['dialog.command.apply', 'Apply command', 'bw-v5-command-apply', 'command.commit', 'available'],
  ['dialog.command.cancel', 'Cancel command', 'bw-v5-command-cancel', 'command.cancel', 'available'],
  ['dialog.clear.confirm', 'Confirm clear', 'bw-clear-confirm', 'document.previewCommit', 'available'],
  ['dialog.clear.cancel', 'Cancel clear', 'bw-clear-cancel', 'control.invoke', 'available'],
  ['dialog.draft.keep', 'Keep editing draft', 'bw-draft-keep', 'control.invoke', 'available'],
  ['dialog.draft.discard', 'Discard draft', 'bw-draft-discard', 'control.invoke', 'available'],
  ['dialog.draft.apply', 'Apply draft and continue', 'bw-draft-apply', 'command.commit', 'available'],
  ['dialog.template.close', 'Close templates', 'bw-templates-close', 'control.invoke', 'available'],
  ['dialog.template.use', 'Use template', 'bw-template-use', 'template.use', 'available'],
  ['dialog.help.close', 'Close help', 'bw-help-close', 'control.invoke', 'available'],
  ['dialog.recovery.close', 'Close recovery', 'bw-recover-close', 'control.invoke', 'available'],
  ['dialog.tour.back', 'Previous tour step', 'bw-tour-back', 'control.invoke', 'available'],
  ['dialog.tour.next', 'Next tour step', 'bw-tour-next', 'control.invoke', 'available'],
  ['dialog.tour.skip', 'Skip tour', 'bw-tour-skip', 'control.invoke', 'available'],
  ['dialog.transition.undo', 'Undo transition', 'bw-transition-undo', 'transition.undo', 'available'],
  ['dialog.transition.close', 'Dismiss transition', 'bw-transition-close', 'transition.dismiss', 'available'],
  ['dialog.commandbar.apply', 'Apply command-bar draft', 'bw-cmd-apply', 'command.commit', 'available'],
  ['dialog.commandbar.cancel', 'Cancel command-bar draft', 'bw-cmd-cancel', 'command.cancel', 'available'],
].map(([id, label, elementId, semanticAction, adapter = 'missing']) =>
  control(id, label, 'dialog', [idBinding(elementId)], {
    kind: 'dialog-action',
    semanticAction,
    adapter,
    ...(id === 'dialog.clear.confirm'
      ? {
          permission: 'project.edit',
          adapterTool: 'cad_preview',
          completionTool: 'cad_commit',
          operationKinds: ['project.clear'],
        }
      : id === 'dialog.template.use' || id === 'dialog.transition.undo'
        ? { permission: 'project.edit', adapterTool: 'cad_ui' }
      : {}),
  }));

const modelingLifecycleControls = [
  ['model.face.next', 'Next planar face', 'bw-face-next', 'available'],
  ['model.face.use', 'Use selected face', 'bw-face-use', 'available'],
  ['model.face.base', 'Use base plane', 'bw-face-base', 'available'],
  ['model.face.cancel', 'Cancel face selection', 'bw-face-cancel', 'available', 'command.cancel'],
  ['model.shell.next', 'Next shell face', 'bw-shell-next', 'available'],
  ['model.shell.toggle', 'Toggle shell face', 'bw-shell-toggle', 'available'],
  ['model.shell.apply', 'Apply shell', 'bw-shell-apply', 'available'],
  ['model.shell.cancel', 'Cancel shell', 'bw-shell-cancel', 'available'],
  ['model.edge.apply', 'Apply edge operation', 'bw-pick-apply', 'available'],
  ['model.edge.cancel', 'Cancel edge operation', 'bw-pick-cancel', 'available'],
  ['sketch.apply', 'Apply sketch feature', 'bw-sk-apply', 'available'],
  ['sketch.cancel', 'Cancel sketch feature', 'bw-sk-cancel', 'available'],
  ['sketch.presspull.start', 'Start press pull', 'bw-sk-presspull', 'available'],
  ['sketch.presspull.apply', 'Finish press pull', 'bw-presspull-apply', 'available', 'command.commit'],
  ['sketch.presspull.back', 'Back to sketch', 'bw-presspull-back', 'available'],
].map(([id, label, elementId, adapter = 'missing', semanticAction = null]) =>
  control(id, label, 'modeling-lifecycle', [idBinding(elementId)], {
    kind: 'dialog-action',
    semanticAction: semanticAction || (id.endsWith('.cancel') ? 'command.cancel' : 'command.advance'),
    adapter,
    permission: 'project.edit',
  }));

const panelControls = [
  control('panel.model', 'Model panel', 'panel', [idBinding('bw-mtab-history')], { semanticAction: 'panel.open', adapter: 'available' }),
  control('panel.parameters', 'Parameters panel', 'panel', [idBinding('bw-mtab-params')], { semanticAction: 'panel.open', adapter: 'available' }),
  control('panel.project', 'Project panel', 'panel', [idBinding('bw-mtab-project')], { semanticAction: 'panel.open', adapter: 'available' }),
  control('parameter.add', 'Add parameter', 'parameter', [idBinding('bw-param-add')], {
    semanticAction: 'document.previewCommit',
    adapter: 'available',
    permission: 'project.edit',
    adapterTool: 'cad_preview',
    completionTool: 'cad_commit',
    operationKinds: ['parameter.create'],
  }),
  control('body.create', 'Create body', 'model-tree', [idBinding('bw-body-new')], {
    semanticAction: 'control.invoke',
    adapter: 'available',
    permission: 'ui.command-draft',
    operationKinds: ['feature.extrude'],
    commandId: 'model.extrude',
  }),
  control('tree.base-plane', 'Base plane', 'model-tree', [idBinding('bw-tree-base')], { semanticAction: 'selection.set', adapter: 'available' }),
  control('tree.entity', 'Model tree entity actions', 'model-tree', [dynamicBinding('model-tree.entity')], {
    semanticAction: 'tree.invoke',
    permission: 'ui.select',
    variants: [
      controlBoundVariant('datum.select', 'Select datum', {
        controlId: 'tree.entity.datum.select',
        adapter: 'available',
        permission: 'ui.select',
      }),
      controlBoundVariant('datum.edit', 'Edit datum', {
        controlId: 'tree.entity.datum.edit',
        semanticAction: 'command.open',
        adapter: 'available',
        permission: 'ui.command-draft',
        commandId: 'model.plane',
      }),
      controlBoundVariant('sketch.select', 'Select profile or path sketch', {
        controlId: 'tree.entity.sketch.select',
        adapter: 'available',
        permission: 'ui.select',
      }),
      controlBoundVariant('sketch.edit', 'Edit profile or path sketch', {
        controlId: 'tree.entity.sketch.edit',
        semanticAction: 'command.open',
        adapter: 'available',
        permission: 'ui.command-draft',
        commandResolver: 'selected-sketch-role',
      }),
      familyVariant('tree.entity', 'pattern-instance.select', 'Select pattern occurrence', { adapter: 'available', permission: 'ui.select' }),
      familyDocumentEditVariant('tree.entity', 'pattern-instance.skip', 'Skip pattern occurrence', 'pattern.update'),
      familyVariant('tree.entity', 'pattern-instance.independent', 'Make pattern occurrence independent', {
        semanticAction: 'tree.invoke',
        adapter: 'available',
        permission: 'project.edit',
        adapterTool: 'cad_ui',
        completionTool: 'cad_commit',
        operationKinds: ['pattern.materialize'],
      }),
      familyVariant('tree.entity', 'pattern-instance.export', 'Select pattern occurrence for export', { adapter: 'available', permission: 'ui.select' }),
      familyEntityEditVariant('tree.entity', 'pattern.edit', 'Edit body pattern', 'model.pattern'),
      familyDocumentEditVariant('tree.entity', 'pattern.visibility', 'Toggle body-pattern visibility', 'pattern.update'),
      familyVariant('tree.entity', 'pattern.dissolve', 'Dissolve body pattern', {
        semanticAction: 'tree.invoke',
        adapter: 'available',
        permission: 'project.edit',
        adapterTool: 'cad_ui',
        completionTool: 'cad_commit',
        operationKinds: ['pattern.materialize'],
      }),
      familyDocumentEditVariant('tree.entity', 'pattern.delete', 'Delete body pattern', 'pattern.delete'),
    ],
  }),
  control('tree.feature', 'Feature history actions', 'model-tree', [dynamicBinding('history.feature')], {
    semanticAction: 'tree.invoke',
    permission: 'document.edit',
    variants: [
      familyVariant('tree.feature', 'select', 'Select feature', { adapter: 'available', permission: 'ui.select' }),
      familyDocumentEditVariant('tree.feature', 'move-earlier', 'Move feature earlier', 'feature.reorder'),
      familyDocumentEditVariant('tree.feature', 'move-later', 'Move feature later', 'feature.reorder'),
      familyDocumentEditVariant('tree.feature', 'rollback-toggle', 'Toggle rollback marker', 'feature.rollback'),
      familyFeatureEditVariant('tree.feature', 'edit', 'Edit feature'),
      familyDocumentEditVariant('tree.feature', 'delete', 'Delete feature', 'feature.delete'),
      familyDocumentEditVariant('tree.feature', 'drag-reorder', 'Drag feature to reorder', 'feature.reorder'),
    ],
  }),
  control('tree.body', 'Body actions', 'model-tree', [dynamicBinding('body.entity')], {
    semanticAction: 'tree.invoke',
    permission: 'document.edit',
    variants: [
      familyVariant('tree.body', 'select', 'Select body', { adapter: 'available', permission: 'ui.select' }),
      familyDocumentEditVariant('tree.body', 'activate', 'Activate body', 'body.activate'),
      familyDocumentEditVariant('tree.body', 'visibility', 'Toggle body visibility', 'body.setVisibility'),
      familyVariant('tree.body', 'isolate', 'Isolate or restore body', { adapter: 'available', permission: 'ui.select' }),
      familyDocumentEditVariant('tree.body', 'rename', 'Rename body', 'body.rename'),
      familyDocumentEditVariant('tree.body', 'suppress', 'Suppress or restore body', 'body.suppress'),
      familyVariant('tree.body', 'export', 'Select body for export', { adapter: 'available', permission: 'ui.select' }),
      familyDocumentEditVariant('tree.body', 'delete', 'Delete body', 'body.delete'),
    ],
  }),
  control('tree.assembly', 'Assembly occurrence and mate actions', 'model-tree', [dynamicBinding('assembly.entity')], {
    semanticAction: 'tree.invoke',
    permission: 'document.edit',
    variants: [
      familyVariant('tree.assembly', 'occurrence.expand', 'Expand or collapse component occurrence', { adapter: 'available', permission: 'ui.navigate' }),
      familyVariant('tree.assembly', 'occurrence.select', 'Select component occurrence', { adapter: 'available', permission: 'ui.select' }),
      familyDocumentEditVariant('tree.assembly', 'occurrence.visibility', 'Toggle component visibility', 'component.update'),
      familyDocumentEditVariant('tree.assembly', 'occurrence.suppress', 'Suppress or restore component', 'component.update'),
      familyVariant('tree.assembly', 'occurrence.export', 'Select component for export', { adapter: 'available', permission: 'ui.select' }),
      familyVariant('tree.assembly', 'runtime-occurrence.select', 'Select generated component occurrence', { adapter: 'available', permission: 'ui.select' }),
      familyVariant('tree.assembly', 'mate.select', 'Select mate', { adapter: 'available', permission: 'ui.select' }),
      familyDocumentEditVariant('tree.assembly', 'mate.suppress', 'Suppress or restore mate', 'mate.update'),
      familyDocumentEditVariant('tree.assembly', 'mate.delete', 'Delete mate', 'mate.delete'),
    ],
  }),
  control('tree.inspection', 'Saved inspection actions', 'model-tree', [dynamicBinding('inspection.entity')], {
    semanticAction: 'tree.invoke',
    permission: 'document.edit',
    variants: [
      familyDocumentEditVariant('tree.inspection', 'section.toggle', 'Activate or deactivate saved section', 'section.activate'),
      familyDocumentEditVariant('tree.inspection', 'section.delete', 'Delete saved section', 'section.delete'),
      familyDocumentEditVariant('tree.inspection', 'explode.toggle', 'Activate or deactivate exploded view', 'exploded.activate'),
      familyDocumentEditVariant('tree.inspection', 'explode.delete', 'Delete exploded view', 'exploded.delete'),
      familyDocumentEditVariant('tree.inspection', 'stage.visibility', 'Toggle stage-group visibility', 'stage.update'),
      familyDocumentEditVariant('tree.inspection', 'stage.spacing-less', 'Decrease stage spacing', 'stage.update'),
      familyDocumentEditVariant('tree.inspection', 'stage.spacing-more', 'Increase stage spacing', 'stage.update'),
      familyVariant('tree.inspection', 'measurement.evaluate', 'Evaluate saved measurement', { adapter: 'available', permission: 'project.read' }),
      familyDocumentEditVariant('tree.inspection', 'measurement.delete', 'Delete saved measurement', 'measurement.delete'),
    ],
  }),
  control('parameter.row', 'Parameter row actions', 'parameter', [dynamicBinding('parameter.entity')], {
    semanticAction: 'parameter.invoke',
    permission: 'document.edit',
    variants: [
      familyDocumentEditVariant('parameter.row', 'rename', 'Rename parameter', 'parameter.update'),
      familyDocumentEditVariant('parameter.row', 'set-value', 'Set parameter value', 'parameter.update'),
      familyDocumentEditVariant('parameter.row', 'delete', 'Delete parameter', 'parameter.delete'),
    ],
  }),
  control('template.card', 'Template selection', 'template', [dynamicBinding('template.card')], {
    semanticAction: 'template.select',
    adapter: 'available',
    variants: [familyVariant('template.card', 'select', 'Select template')],
  }),
  control('recovery.entry', 'Recovery entry actions', 'recovery', [dynamicBinding('recovery.entry')], {
    semanticAction: 'recovery.restore',
    permission: 'project.recover',
    variants: [familyVariant('recovery.entry', 'restore', 'Restore recovery entry', {
      adapter: 'available',
      semanticAction: 'recovery.restore',
      permission: 'project.recover',
      adapterTool: 'cad_ui',
    })],
  }),
  control('inspector.context', 'Inspector context actions', 'inspector', [dynamicBinding('inspector.context')], {
    semanticAction: 'inspector.invoke',
    variants: [
      familyVariant('inspector.context', 'inspection.clear', 'Close inspection results', { adapter: 'available', permission: 'ui.select' }),
      familyVariant('inspector.context', 'mate.edit', 'Edit selected mate', {
        semanticAction: 'command.open',
        adapter: 'available',
        permission: 'ui.command-draft',
        commandResolver: 'selected-mate-kind',
      }),
      familyDocumentEditVariant('inspector.context', 'mate.suppress', 'Suppress or restore selected mate', 'mate.update'),
      familyDocumentEditVariant('inspector.context', 'mate.delete', 'Delete selected mate', 'mate.delete'),
      familyDocumentEditVariant('inspector.context', 'occurrence.visibility', 'Toggle selected component visibility', 'component.update'),
      familyDocumentEditVariant('inspector.context', 'occurrence.suppress', 'Suppress or restore selected component', 'component.update'),
      familyVariant('inspector.context', 'occurrence.isolate', 'Isolate or restore selected component', { adapter: 'available', permission: 'ui.select' }),
      familyVariant('inspector.context', 'occurrence.edit-context', 'Edit selected component in context', {
        semanticAction: 'command.open', adapter: 'available', permission: 'ui.command-draft', commandId: 'assembly.edit-context',
      }),
      familyVariant('inspector.context', 'occurrence.variant', 'Edit selected component variant', {
        semanticAction: 'command.open', adapter: 'available', permission: 'ui.command-draft', commandId: 'assembly.variant',
      }),
      familyVariant('inspector.context', 'occurrence.independent', 'Make selected component independent', {
        semanticAction: 'command.open', adapter: 'available', permission: 'ui.command-draft', commandId: 'assembly.independent',
      }),
      familyVariant('inspector.context', 'occurrence.transform', 'Transform selected component', {
        semanticAction: 'command.open', adapter: 'available', permission: 'ui.command-draft', commandId: 'assembly.component-transform',
      }),
      familyVariant('inspector.context', 'occurrence.linked', 'Create linked component duplicate', {
        semanticAction: 'command.open', adapter: 'available', permission: 'ui.command-draft', commandId: 'assembly.linked',
      }),
      familyDocumentEditVariant('inspector.context', 'occurrence.delete', 'Delete selected component', 'component.delete'),
      familyVariant('inspector.context', 'occurrence.export', 'Select component bodies for export', { adapter: 'available', permission: 'ui.select' }),
      familyEntityEditVariant('inspector.context', 'pattern.edit', 'Edit selected pattern', 'model.pattern'),
      familyDocumentEditVariant('inspector.context', 'pattern.skip', 'Skip selected pattern occurrence', 'pattern.update'),
      familyDocumentEditVariant('inspector.context', 'body.rename', 'Rename selected body', 'body.rename'),
      familyDocumentEditVariant('inspector.context', 'body.activate', 'Activate selected body', 'body.activate'),
      familyDocumentEditVariant('inspector.context', 'body.visibility', 'Toggle selected body visibility', 'body.setVisibility'),
      familyVariant('inspector.context', 'body.isolate', 'Isolate or restore selected body', { adapter: 'available', permission: 'ui.select' }),
      familyDocumentEditVariant('inspector.context', 'body.suppress', 'Suppress or restore selected body', 'body.suppress'),
      familyDocumentEditVariant('inspector.context', 'body.subtract', 'Subtract selected body from active body', 'boolean.subtract'),
      familyDocumentEditVariant('inspector.context', 'body.intersect', 'Intersect selected body with active body', 'boolean.intersect'),
      familyDocumentEditVariant('inspector.context', 'body.union', 'Union selected body with active body', 'boolean.union'),
      familyDocumentEditVariant('inspector.context', 'body.delete', 'Delete selected body', 'body.delete'),
      familyFeatureEditVariant('inspector.context', 'feature.dimension', 'Edit selected feature dimension'),
      familyFeatureEditVariant('inspector.context', 'feature.through', 'Toggle selected cut through-all'),
      familyDocumentEditVariant('inspector.context', 'feature.pattern-count', 'Edit selected feature pattern count', 'feature.update'),
      familyDocumentEditVariant('inspector.context', 'feature.pattern-a', 'Edit selected feature pattern first spacing', 'feature.update'),
      familyDocumentEditVariant('inspector.context', 'feature.pattern-b', 'Edit selected feature pattern second spacing', 'feature.update'),
      familyFeatureEditVariant('inspector.context', 'feature.edit', 'Edit selected feature'),
      familyDocumentEditVariant('inspector.context', 'feature.delete', 'Delete selected feature', 'feature.delete'),
    ],
  }),
];

const auxiliaryControls = [
  control('viewport.navigation.orbit', 'Orbit navigation mode', 'viewport', [attributeBinding('data-nav-mode', 'orbit')], { kind: 'mode', semanticAction: 'viewport.setNavigationMode', adapter: 'available' }),
  control('viewport.navigation.pan', 'Pan navigation mode', 'viewport', [attributeBinding('data-nav-mode', 'pan')], { kind: 'mode', semanticAction: 'viewport.setNavigationMode', adapter: 'available' }),
  control('viewport.canvas', '3D viewport interaction', 'viewport', [idBinding('bw-studio')], {
    kind: 'surface',
    semanticAction: 'viewport.interact',
    semanticActions: ['selection.set', 'selection.add', 'selection.remove', 'selection.clear', 'viewport.setCamera', 'viewport.fitAll', 'viewport.fitSelection', 'viewport.setNavigationMode'],
    adapter: 'available',
    permissions: ['ui.select', 'ui.navigate'],
    adapterTool: 'cad_ui',
  }),
  control('sketch.canvas', '2D sketch interaction', 'sketch', [idBinding('bw-sketch-canvas')], {
    kind: 'surface',
    semanticAction: 'sketch.shape.edit',
    semanticActions: [
      'sketch.setTool',
      'sketch.shape.select',
      'sketch.shape.update',
      'sketch.shape.delete',
      'command.setInput',
      'command.clearInput',
    ],
    adapter: 'available',
    permissions: ['ui.command-draft'],
    adapterTool: 'cad_ui',
  }),
  control('welcome.template.starter-plate', 'Starter plate template', 'welcome', [attributeBinding('data-welcome-template', 'starter-plate')], { semanticAction: 'template.use', adapter: 'available', permission: 'project.edit', adapterTool: 'cad_ui', templateId: 'starter-plate' }),
  control('welcome.template.electronics-tray', 'Electronics tray template', 'welcome', [attributeBinding('data-welcome-template', 'electronics-tray')], { semanticAction: 'template.use', adapter: 'available', permission: 'project.edit', adapterTool: 'cad_ui', templateId: 'electronics-tray' }),
  control('welcome.template.four-hole-plate', 'Four-hole plate template', 'welcome', [attributeBinding('data-welcome-template', 'four-hole-plate')], { semanticAction: 'template.use', adapter: 'available', permission: 'project.edit', adapterTool: 'cad_ui', templateId: 'four-hole-plate' }),
  control('welcome.template.turned-knob', 'Turned knob template', 'welcome', [attributeBinding('data-welcome-template', 'turned-knob')], { semanticAction: 'template.use', adapter: 'available', permission: 'project.edit', adapterTool: 'cad_ui', templateId: 'turned-knob' }),
  control('welcome.templates', 'Browse templates from welcome', 'welcome', [idBinding('bw-welcome-templates')], { semanticAction: 'control.invoke', adapter: 'available' }),
  control('welcome.blank-sketch', 'Start blank sketch', 'welcome', [idBinding('bw-welcome-start')], { semanticAction: 'project.newBlank', adapter: 'available', permission: 'project.edit', adapterTool: 'cad_ui', operationKinds: ['feature.extrude'] }),
  control('welcome.open', 'Open project from welcome', 'welcome', [idBinding('bw-welcome-open')], {
    semanticAction: 'artifact.import',
    adapter: 'available',
    permission: 'project.replace',
    adapterTool: 'cad_artifact',
  }),
  control('welcome.help', 'Open help from welcome', 'welcome', [idBinding('bw-welcome-help')], { semanticAction: 'control.invoke', adapter: 'available' }),
  control('help.tour', 'Start guided tour', 'help', [idBinding('bw-help-tour')], { semanticAction: 'control.invoke', adapter: 'available' }),
  control('help.templates', 'Browse templates from help', 'help', [idBinding('bw-help-templates')], { semanticAction: 'control.invoke', adapter: 'available' }),
  control('help.agent', 'Connect local agent from help', 'help', [idBinding('bw-help-agent')], {
    semanticAction: 'session.connect',
    adapter: 'contextual',
    permission: 'session.connect',
    contextualReasonCode: 'HUMAN_AUTHORITY_BOUNDARY',
  }),
  control('template.search', 'Search templates', 'template', [idBinding('bw-template-search')], { kind: 'field', semanticAction: 'control.setValue', adapter: 'available' }),
  control('model.shell.thickness', 'Shell wall thickness', 'modeling-field', [idBinding('bw-shell-t')], { kind: 'field', semanticAction: 'command.setInput', adapter: 'available', permission: 'ui.command-draft' }),
  control('model.edge.radius', 'Edge radius', 'modeling-field', [idBinding('bw-pick-r')], { kind: 'field', semanticAction: 'command.setInput', adapter: 'available', permission: 'ui.command-draft' }),
  control('sketch.operation.height', 'Sketch operation height', 'sketch-field', [idBinding('bw-sk-op-h')], { kind: 'field', semanticAction: 'command.setInput', adapter: 'available', permission: 'ui.command-draft' }),
  control('sketch.operation.through', 'Sketch through-all option', 'sketch-field', [idBinding('bw-sk-through')], { kind: 'field', semanticAction: 'command.setInput', adapter: 'available', permission: 'ui.command-draft' }),
  control('sketch.operation.pattern', 'Sketch pattern type', 'sketch-field', [idBinding('bw-sk-pat')], { kind: 'field', semanticAction: 'command.setInput', adapter: 'available', permission: 'ui.command-draft' }),
  control('sketch.operation.pattern-count', 'Sketch pattern count', 'sketch-field', [idBinding('bw-sk-pat-n')], { kind: 'field', semanticAction: 'command.setInput', adapter: 'available', permission: 'ui.command-draft' }),
  control('sketch.operation.pattern-a', 'Sketch pattern first spacing', 'sketch-field', [idBinding('bw-sk-pat-a')], { kind: 'field', semanticAction: 'command.setInput', adapter: 'available', permission: 'ui.command-draft' }),
  control('sketch.operation.pattern-b', 'Sketch pattern second spacing', 'sketch-field', [idBinding('bw-sk-pat-b')], { kind: 'field', semanticAction: 'command.setInput', adapter: 'available', permission: 'ui.command-draft' }),
  control('sketch.operation.result', 'Sketch result policy', 'sketch-field', [idBinding('bw-sk-result')], { kind: 'field', semanticAction: 'command.setInput', adapter: 'available', permission: 'ui.command-draft' }),
  control('sketch.operation.body-name', 'Sketch result body name', 'sketch-field', [idBinding('bw-sk-body-name')], { kind: 'field', semanticAction: 'command.setInput', adapter: 'available', permission: 'ui.command-draft' }),
  control('sketch.operation.target', 'Sketch target body', 'sketch-field', [idBinding('bw-sk-target')], { kind: 'field', semanticAction: 'command.bindSelection', adapter: 'available', permission: 'ui.command-draft' }),
  control('sketch.presspull.distance', 'Press-pull distance', 'sketch-field', [idBinding('bw-presspull-h')], { kind: 'field', semanticAction: 'command.setInput', adapter: 'available', permission: 'ui.command-draft' }),
  control('sketch.shape.dimension', 'Selected sketch-shape dimensions', 'sketch-field', [dynamicBinding('sketch.shape.dimension')], {
    kind: 'field',
    semanticAction: 'sketch.shape.update',
    adapter: 'available',
    permission: 'ui.command-draft',
    adapterTool: 'cad_ui',
    fieldId: 'sketch',
    variants: [
      controlBoundVariant('w', 'Selected rectangle width', { controlId: 'sketch.shape.dimension.w', operation: 'w' }),
      controlBoundVariant('h', 'Selected rectangle height', { controlId: 'sketch.shape.dimension.h', operation: 'h' }),
      controlBoundVariant('x', 'Selected shape X position', { controlId: 'sketch.shape.dimension.x', operation: 'x' }),
      controlBoundVariant('y', 'Selected shape Y position', { controlId: 'sketch.shape.dimension.y', operation: 'y' }),
      controlBoundVariant('d', 'Selected circle diameter', { controlId: 'sketch.shape.dimension.d', operation: 'd' }),
    ],
  }),
  control('sketch.shape.delete', 'Delete selected sketch shape', 'sketch-field', [idBinding('bw-sk-delshape')], {
    semanticAction: 'sketch.shape.delete',
    adapter: 'available',
    permission: 'ui.command-draft',
    adapterTool: 'cad_ui',
    fieldId: 'sketch',
  }),
  control('sketch.constraint.dimension', 'Constrained-sketch driving dimensions', 'sketch-field', [controlIdBinding('sketch.constraint.dimension')], {
    kind: 'field',
    semanticAction: 'command.setInput',
    adapter: 'available',
    permission: 'ui.command-draft',
    fieldId: 'sketch',
  }),
  control('dialog.command.field', 'Normal command dialog fields', 'dialog-field', [controlIdBinding('dialog.command.field')], { kind: 'field', semanticAction: 'command.setInput', adapter: 'available', permission: 'ui.command-draft' }),
  control('dialog.template.category', 'Template category', 'template', [controlIdBinding('dialog.template.category')], { semanticAction: 'template.filter', adapter: 'available' }),
  ...[
    ['origin', 'Origin'],
    ['datums', 'Datums'],
    ['sketches', 'Profiles and paths'],
    ['patterns', 'Body patterns'],
    ['components', 'Components'],
    ['mates', 'Mates'],
    ['inspection', 'Views and stages'],
  ].map(([sectionId, label]) =>
    control(`tree.section.${sectionId}`, `${label} model-tree section`, 'model-tree', [
      controlIdBinding(`tree.section.${sectionId}`),
    ], {
      semanticAction: 'tree.setSectionExpanded',
      adapter: 'available',
      permission: 'ui.navigate',
      sectionId,
    })),
  control('notice.legacy-dismiss', 'Dismiss legacy-project notice', 'notification', [idBinding('bw-v1-notice-dismiss')], {
    semanticAction: 'control.invoke',
    adapter: 'available',
    permission: 'ui.navigate',
    adapterTool: 'cad_ui',
  }),
];

export const CAD_UI_CONTROL_REGISTRY = Object.freeze([
  ...projectControls,
  ...workspaceControls,
  ...basicFeatureControls,
  ...advancedFeatureControls,
  ...sketchControls,
  ...assemblyControls,
  ...mateControls,
  ...inspectionControls,
  ...displayControls,
  ...viewControls,
  ...dialogControls,
  ...modelingLifecycleControls,
  ...panelControls,
  ...auxiliaryControls,
].map((entry) => {
  if (entry.kind !== 'command') return entry;
  if (!Object.hasOwn(COMMAND_FIELD_CONTRACTS, entry.id)) {
    throw new Error(`CAD UI command "${entry.id}" has no declared field contract.`);
  }
  const fields = COMMAND_FIELD_CONTRACTS[entry.id];
  return Object.freeze({
    ...entry,
    fields,
    fieldContract: fields.length ? 'typed' : 'none',
  });
}));

export const CAD_UI_COMMAND_REGISTRY = Object.freeze(
  CAD_UI_CONTROL_REGISTRY.filter((entry) => entry.kind === 'command'),
);

export const CAD_UI_EXPANDED_CONTROL_REGISTRY = Object.freeze(
  CAD_UI_CONTROL_REGISTRY.flatMap((entry) => {
    if (!entry.variants.length) return [entry];
    return entry.variants.map((entryVariant) => Object.freeze({
      ...entry,
      id: `${entry.id}.${entryVariant.id}`,
      label: entryVariant.label,
      parentControlId: entry.id,
      semanticAction: entryVariant.semanticAction || entry.semanticAction,
      adapter: entryVariant.adapter || entry.adapter,
      permission: entryVariant.permission || entry.permission,
      contextualReasonCode: entryVariant.contextualReasonCode || entry.contextualReasonCode,
      adapterTool: entryVariant.adapterTool || entry.adapterTool,
      completionTool: entryVariant.completionTool || entry.completionTool,
      operationKinds: Object.freeze(entryVariant.operationKinds || entry.operationKinds),
      commandId: entryVariant.commandId || entry.commandId,
      commandResolver: entryVariant.commandResolver || entry.commandResolver,
      humanBindings: Object.freeze(entryVariant.humanBindings || entry.humanBindings),
      fieldId: entryVariant.fieldId || entry.fieldId,
      operation: entryVariant.operation || entryVariant.id,
      variants: Object.freeze([]),
    }));
  }),
);

export function cadUiControlRegistry() {
  return clone(CAD_UI_EXPANDED_CONTROL_REGISTRY);
}

export function cadUiCommandDefinition(commandId) {
  const command = CAD_UI_COMMAND_REGISTRY.find((entry) => entry.id === commandId);
  return command ? clone(command) : null;
}

export function cadUiFullParityReport({ observedControlIds = [] } = {}) {
  const observed = new Set(observedControlIds);
  const covered = CAD_UI_EXPANDED_CONTROL_REGISTRY.filter((entry) => entry.adapter === 'available');
  const contextual = CAD_UI_EXPANDED_CONTROL_REGISTRY.filter((entry) => entry.adapter === 'contextual');
  const missing = CAD_UI_EXPANDED_CONTROL_REGISTRY.filter((entry) => entry.adapter === 'missing');
  const missingFieldCoverage = CAD_UI_COMMAND_REGISTRY.filter((entry) => !['typed', 'none'].includes(entry.fieldContract));
  const registryIds = new Set([
    ...CAD_UI_CONTROL_REGISTRY.map((entry) => entry.id),
    ...CAD_UI_EXPANDED_CONTROL_REGISTRY.map((entry) => entry.id),
  ]);
  const observedOrphans = [...observed].filter((id) => !registryIds.has(id)).sort();
  const commandFieldDenominator = CAD_UI_COMMAND_REGISTRY
    .reduce((count, entry) => count + entry.fields.length, 0);
  const accounted = covered.length + contextual.length;
  return {
    denominator: CAD_UI_EXPANDED_CONTROL_REGISTRY.length,
    covered: covered.length,
    contextual: contextual.length,
    accounted,
    missing: missing.length,
    coveragePercent: Number(((accounted / CAD_UI_EXPANDED_CONTROL_REGISTRY.length) * 100).toFixed(2)),
    directCoveragePercent: Number(((covered.length / CAD_UI_EXPANDED_CONTROL_REGISTRY.length) * 100).toFixed(2)),
    commandDenominator: CAD_UI_COMMAND_REGISTRY.length,
    commandFieldDenominator,
    commandFieldCovered: CAD_UI_COMMAND_REGISTRY.length - missingFieldCoverage.length,
    missingAdapterIds: missing.map((entry) => entry.id),
    missingFieldCoverageIds: missingFieldCoverage.map((entry) => entry.id),
    observedOrphanIds: observedOrphans,
    complete: missing.length === 0 && missingFieldCoverage.length === 0 && observedOrphans.length === 0,
  };
}
