import {
  CAD_UI_COMMAND_REGISTRY,
  cadUiCommandDefinition,
  cadUiControlRegistry,
  cadUiFullParityReport,
} from './studio-v6-ui-registry.js';

export const CAD_UI_PROFILE = 'bomwiki.cad.agentic-ui/v1';
export const CAD_UI_RUNTIME_VERSION = '6.0.0-i4';

const MAX_ACTIONS = 50;
const MAX_EVENTS = 1000;
const MAX_WAIT_MS = 30_000;
const MAX_VISIBLE_MS = 5_000;
const MAX_SETTLEMENT_MS = 10_000;
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const MAX_EVENT_PAYLOAD_BYTES = 512 * 1024;
const PRESENTATION_MODES = ['instant', 'normal', 'recording'];
const NARRATION_MODES = ['off', 'concise', 'detailed', 'recording'];
const PRESENTATION_STATES = ['idle', 'transitioning', 'holding', 'waiting'];
const TREE_SECTION_IDS = ['origin', 'datums', 'sketches', 'patterns', 'components', 'mates', 'inspection'];

export const CAD_UI_AGENT_NARRATION_TEMPLATES = Object.freeze([
  ['demo.turbofan.intro', 'Introduce direct agent control.'],
  ['demo.turbofan.empty', 'State that construction begins from an empty document.'],
  ['demo.turbofan.layout', 'Describe engine parameters and axial datums.'],
  ['demo.turbofan.nacelle-sections', 'Describe editable nacelle sections.'],
  ['demo.turbofan.nacelle-passage', 'Describe the lofted and hollowed nacelle.'],
  ['demo.turbofan.fan-sections', 'Describe the twisted fan-blade sections.'],
  ['demo.turbofan.fan-blade', 'Describe the committed editable fan blade.'],
  ['demo.turbofan.fan-rotor', 'Describe spinner, disk, and nested fan rotor construction.'],
  ['demo.turbofan.fan-pattern', 'Describe the editable fan-blade pattern.', {
    type: 'object',
    required: ['bladeCount'],
    additionalProperties: false,
    properties: { bladeCount: { type: 'integer', minimum: 1, maximum: 1_000 } },
  }],
  ['demo.turbofan.core', 'Describe the bypass splitter and compressor stages.'],
  ['demo.turbofan.hot-section', 'Describe shafts, combustor, turbines, bearings, and nozzle.'],
  ['demo.turbofan.assemble', 'Describe datum-driven axial assembly positioning.'],
  ['demo.turbofan.assembly-ready', 'Describe the completed editable assembly.'],
  ['demo.turbofan.locate-clearance', 'Describe locating the compressor and combustor.'],
  ['demo.turbofan.targets-found', 'Confirm that both editable targets are selected.'],
  ['demo.turbofan.prepare-move', 'Describe a constrained axial-station edit.'],
  ['demo.turbofan.preview', 'Describe the detached exact preview.'],
  ['demo.turbofan.section', 'Describe longitudinal section inspection.'],
  ['demo.turbofan.export-stage', 'Describe selected-stage export.'],
  ['demo.turbofan.done', 'Summarize the persisted and exported result.'],
  ['demo.turbofan.final', 'Close the direct-control demonstration.'],
].map(([id, description, valueSchema]) => Object.freeze({
  id,
  description,
  valueSchema: valueSchema || {
    type: 'object',
    required: [],
    additionalProperties: false,
    properties: {},
  },
})));

export const CAD_UI_ACTION_KINDS = Object.freeze([
  'document.activate',
  'workspace.activate',
  'selection.set',
  'selection.add',
  'selection.remove',
  'selection.clear',
  'tree.reveal',
  'tree.expand',
  'tree.collapse',
  'tree.setSectionExpanded',
  'viewport.fitAll',
  'viewport.fitSelection',
  'viewport.standardView',
  'viewport.setCamera',
  'viewport.setDisplayMode',
  'viewport.activateSection',
  'viewport.activateExplodedView',
  'viewport.clearInspectionView',
  'panel.open',
  'panel.close',
  'inspector.showEntity',
  'history.showRevision',
  'history.undo',
  'history.redo',
  'diagnostics.show',
  'control.invoke',
  'control.setValue',
  'template.select',
  'template.filter',
  'template.use',
  'project.newBlank',
  'recovery.open',
  'recovery.restore',
  'transition.undo',
  'transition.dismiss',
  'application.fullscreen',
  'application.navigate',
  'inspection.run',
  'sketch.setTool',
  'sketch.shape.select',
  'sketch.shape.update',
  'sketch.shape.delete',
  'viewport.setNavigationMode',
  'command.advance',
  'command.commit',
  'tree.invoke',
  'parameter.invoke',
  'inspector.invoke',
  'command.open',
  'command.bindSelection',
  'command.setInput',
  'command.clearInput',
  'command.preview',
  'command.cancel',
  'preview.present',
  'preview.dismiss',
  'presentation.setMode',
  'presentation.focusAction',
  'presentation.waitForSettled',
  'narration.setMode',
]);

export const CAD_UI_EVENT_KINDS = Object.freeze([
  'session.connected',
  'session.paused',
  'session.resumed',
  'session.revoked',
  'document.changed',
  'document.recovered',
  'ui.changed',
  'selection.changed',
  'command.draftChanged',
  'preview.started',
  'preview.ready',
  'preview.rejected',
  'commit.applied',
  'history.changed',
  'kernel.progress',
  'kernel.completed',
  'kernel.failed',
  'assembly.solveChanged',
  'render.completed',
  'artifact.completed',
  'human.attentionRequired',
  'presentation.stepStarted',
  'presentation.stepSettled',
  'narration.cueStarted',
  'narration.cueCompleted',
]);

const EMITTED_EVENT_KINDS = new Set([
  'session.connected',
  'session.paused',
  'session.resumed',
  'session.revoked',
  'document.changed',
  'document.recovered',
  'ui.changed',
  'selection.changed',
  'command.draftChanged',
  'preview.started',
  'preview.ready',
  'preview.rejected',
  'commit.applied',
  'history.changed',
  'kernel.completed',
  'render.completed',
  'artifact.completed',
  'human.attentionRequired',
  'presentation.stepStarted',
  'presentation.stepSettled',
  'narration.cueStarted',
  'narration.cueCompleted',
]);

const ENTITY_REF_SCHEMA = {
  type: 'object',
  required: ['kind', 'id'],
  additionalProperties: false,
  properties: {
    kind: {
      enum: [
        'project', 'part', 'assembly', 'body', 'occurrence', 'feature', 'datum', 'sketch',
        'body-pattern', 'occurrence-pattern', 'mate', 'material', 'appearance',
        'section', 'exploded-view', 'measurement', 'stage-group',
      ],
    },
    id: { type: 'string', minLength: 1, maxLength: 200 },
  },
};
const SIGNATURE_VECTOR3_SCHEMA = {
  type: 'array',
  minItems: 3,
  maxItems: 3,
  items: { type: 'number' },
};
const TOPOLOGY_SIGNATURE_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      required: ['kind', 'p', 'n'],
      additionalProperties: false,
      properties: {
        kind: { const: 'face' },
        p: SIGNATURE_VECTOR3_SCHEMA,
        n: SIGNATURE_VECTOR3_SCHEMA,
      },
    },
    {
      type: 'object',
      required: ['kind', 'p', 'l', 'curveType'],
      additionalProperties: false,
      properties: {
        kind: { const: 'edge' },
        p: SIGNATURE_VECTOR3_SCHEMA,
        l: { type: 'number', minimum: 0 },
        curveType: { type: 'string', minLength: 1, maxLength: 100 },
        r: { type: 'number', minimum: 0 },
        c: SIGNATURE_VECTOR3_SCHEMA,
      },
    },
    {
      type: 'object',
      required: ['kind', 'p'],
      additionalProperties: false,
      properties: {
        kind: { const: 'vertex' },
        p: SIGNATURE_VECTOR3_SCHEMA,
      },
    },
  ],
};
const SUBSHAPE_REF_SCHEMA = {
  type: 'object',
  required: ['owner', 'stableId', 'topologySignature'],
  additionalProperties: false,
  properties: {
    owner: ENTITY_REF_SCHEMA,
    stableId: { type: 'string', minLength: 1, maxLength: 200 },
    topologySignature: TOPOLOGY_SIGNATURE_SCHEMA,
    expectedGeometry: { enum: ['plane', 'cylinder', 'cone', 'line', 'circle', 'spline', 'other'] },
  },
};
const SELECTION_REF_SCHEMA = { oneOf: [ENTITY_REF_SCHEMA, SUBSHAPE_REF_SCHEMA] };
const BOUNDED_ID_SCHEMA = { type: 'string', minLength: 1, maxLength: 200 };
const VECTOR3_SCHEMA = {
  type: 'array',
  minItems: 3,
  maxItems: 3,
  items: { type: 'number' },
};
const CAMERA_SCHEMA = {
  type: 'object',
  required: ['position', 'target', 'up', 'projection'],
  additionalProperties: false,
  properties: {
    position: VECTOR3_SCHEMA,
    target: VECTOR3_SCHEMA,
    up: VECTOR3_SCHEMA,
    projection: { enum: ['perspective', 'orthographic'] },
  },
};
const MATRIX4_SCHEMA = {
  type: 'array',
  minItems: 16,
  maxItems: 16,
  items: { type: 'number' },
};
const OCCURRENCE_REF_SCHEMA = {
  type: 'object',
  required: ['kind', 'id'],
  additionalProperties: false,
  properties: {
    kind: { const: 'occurrence' },
    id: { type: 'string', minLength: 1, maxLength: 200 },
  },
};
const COMMAND_SCALAR_SCHEMA = {
  oneOf: [
    { type: 'boolean' },
    { type: 'number' },
    { type: 'string', maxLength: 20_000 },
  ],
};
const COMMAND_FIELD_VALUE_SCHEMA = {
  oneOf: [
    ...COMMAND_SCALAR_SCHEMA.oneOf,
    VECTOR3_SCHEMA,
    MATRIX4_SCHEMA,
    { type: 'array', maxItems: 1_000, items: COMMAND_SCALAR_SCHEMA },
    { type: 'array', maxItems: 100, items: SELECTION_REF_SCHEMA },
    {
      type: 'array',
      maxItems: 10_000,
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: { oneOf: [{ type: 'number' }, { type: 'string', maxLength: 1_000 }] },
      },
    },
    {
      type: 'array',
      maxItems: 10_000,
      items: {
        oneOf: [
          {
            type: 'object',
            required: ['kind', 'x1', 'y1', 'x2', 'y2'],
            additionalProperties: false,
            properties: {
              kind: { const: 'line' },
              x1: { oneOf: [{ type: 'number' }, { type: 'string', maxLength: 1_000 }] },
              y1: { oneOf: [{ type: 'number' }, { type: 'string', maxLength: 1_000 }] },
              x2: { oneOf: [{ type: 'number' }, { type: 'string', maxLength: 1_000 }] },
              y2: { oneOf: [{ type: 'number' }, { type: 'string', maxLength: 1_000 }] },
            },
          },
          {
            type: 'object',
            required: ['kind', 'x', 'y', 'w', 'h'],
            additionalProperties: false,
            properties: {
              kind: { const: 'rect' },
              x: { oneOf: [{ type: 'number' }, { type: 'string', maxLength: 1_000 }] },
              y: { oneOf: [{ type: 'number' }, { type: 'string', maxLength: 1_000 }] },
              w: { oneOf: [{ type: 'number' }, { type: 'string', maxLength: 1_000 }] },
              h: { oneOf: [{ type: 'number' }, { type: 'string', maxLength: 1_000 }] },
            },
          },
          {
            type: 'object',
            required: ['kind', 'x', 'y', 'r'],
            additionalProperties: false,
            properties: {
              kind: { const: 'circle' },
              x: { oneOf: [{ type: 'number' }, { type: 'string', maxLength: 1_000 }] },
              y: { oneOf: [{ type: 'number' }, { type: 'string', maxLength: 1_000 }] },
              r: { oneOf: [{ type: 'number' }, { type: 'string', maxLength: 1_000 }] },
            },
          },
          {
            type: 'object',
            required: ['kind', 'pts'],
            additionalProperties: false,
            properties: {
              kind: { const: 'poly' },
              pts: {
                type: 'array',
                minItems: 3,
                maxItems: 10_000,
                items: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 2,
                  items: { oneOf: [{ type: 'number' }, { type: 'string', maxLength: 1_000 }] },
                },
              },
            },
          },
        ],
      },
    },
  ],
};
const CONTROL_VALUE_SCHEMA = {
  oneOf: [
    { type: 'boolean' },
    { type: 'number' },
    { type: 'string', maxLength: 20_000 },
  ],
};

export const CAD_UI_COMMAND_CAPABILITIES = Object.freeze(
  CAD_UI_COMMAND_REGISTRY
    .filter((entry) => entry.adapter === 'available')
    .map((entry) => Object.freeze({
      id: entry.id,
      label: entry.label,
      workspaceId: entry.workspaceId,
      operationKinds: [...entry.operationKinds],
      fields: clone(entry.fields),
    })),
);

const kindOnlySchema = (kind) => ({
  type: 'object',
  required: ['kind'],
  additionalProperties: false,
  properties: { kind: { const: kind } },
});

const ACTION_INPUT_SCHEMAS = Object.fromEntries(CAD_UI_ACTION_KINDS.map((kind) => [kind, kindOnlySchema(kind)]));
Object.assign(ACTION_INPUT_SCHEMAS, {
  'document.activate': {
    type: 'object', required: ['kind', 'documentId'], additionalProperties: false,
    properties: { kind: { const: 'document.activate' }, documentId: BOUNDED_ID_SCHEMA },
  },
  'workspace.activate': {
    type: 'object', required: ['kind', 'workspaceId'], additionalProperties: false,
    properties: { kind: { const: 'workspace.activate' }, workspaceId: { type: 'string', minLength: 1, maxLength: 100 } },
  },
  'selection.set': {
    type: 'object', required: ['kind', 'entity'], additionalProperties: false,
    properties: { kind: { const: 'selection.set' }, entity: SELECTION_REF_SCHEMA },
  },
  'selection.add': {
    type: 'object', required: ['kind', 'entity'], additionalProperties: false,
    properties: { kind: { const: 'selection.add' }, entity: SELECTION_REF_SCHEMA },
  },
  'selection.remove': {
    type: 'object', required: ['kind', 'entity'], additionalProperties: false,
    properties: { kind: { const: 'selection.remove' }, entity: SELECTION_REF_SCHEMA },
  },
  'tree.reveal': {
    type: 'object', required: ['kind', 'entity'], additionalProperties: false,
    properties: { kind: { const: 'tree.reveal' }, entity: ENTITY_REF_SCHEMA },
  },
  'tree.expand': {
    type: 'object', required: ['kind', 'entity'], additionalProperties: false,
    properties: { kind: { const: 'tree.expand' }, entity: ENTITY_REF_SCHEMA },
  },
  'tree.collapse': {
    type: 'object', required: ['kind', 'entity'], additionalProperties: false,
    properties: { kind: { const: 'tree.collapse' }, entity: ENTITY_REF_SCHEMA },
  },
  'tree.setSectionExpanded': {
    type: 'object', required: ['kind', 'sectionId', 'expanded'], additionalProperties: false,
    properties: {
      kind: { const: 'tree.setSectionExpanded' },
      sectionId: { enum: TREE_SECTION_IDS },
      expanded: { type: 'boolean' },
    },
  },
  'inspector.showEntity': {
    type: 'object', required: ['kind', 'entity'], additionalProperties: false,
    properties: { kind: { const: 'inspector.showEntity' }, entity: ENTITY_REF_SCHEMA },
  },
  'viewport.standardView': {
    type: 'object', required: ['kind', 'viewId'], additionalProperties: false,
    properties: { kind: { const: 'viewport.standardView' }, viewId: { type: 'string', minLength: 1, maxLength: 100 } },
  },
  'viewport.setCamera': {
    type: 'object', required: ['kind', 'camera'], additionalProperties: false,
    properties: { kind: { const: 'viewport.setCamera' }, camera: CAMERA_SCHEMA },
  },
  'viewport.setDisplayMode': {
    type: 'object', required: ['kind', 'displayModeId'], additionalProperties: false,
    properties: { kind: { const: 'viewport.setDisplayMode' }, displayModeId: BOUNDED_ID_SCHEMA },
  },
  'viewport.activateSection': {
    type: 'object', required: ['kind', 'sectionId'], additionalProperties: false,
    properties: { kind: { const: 'viewport.activateSection' }, sectionId: BOUNDED_ID_SCHEMA },
  },
  'viewport.activateExplodedView': {
    type: 'object', required: ['kind', 'explodedViewId'], additionalProperties: false,
    properties: { kind: { const: 'viewport.activateExplodedView' }, explodedViewId: BOUNDED_ID_SCHEMA },
  },
  'panel.open': {
    type: 'object', required: ['kind', 'panelId'], additionalProperties: false,
    properties: { kind: { const: 'panel.open' }, panelId: BOUNDED_ID_SCHEMA },
  },
  'panel.close': {
    type: 'object', required: ['kind', 'panelId'], additionalProperties: false,
    properties: { kind: { const: 'panel.close' }, panelId: BOUNDED_ID_SCHEMA },
  },
  'history.showRevision': {
    type: 'object', required: ['kind', 'revision'], additionalProperties: false,
    properties: { kind: { const: 'history.showRevision' }, revision: { type: 'integer', minimum: 0 } },
  },
  'control.invoke': {
    type: 'object', required: ['kind', 'controlId'], additionalProperties: false,
    properties: { kind: { const: 'control.invoke' }, controlId: BOUNDED_ID_SCHEMA },
  },
  'control.setValue': {
    type: 'object', required: ['kind', 'controlId', 'value'], additionalProperties: false,
    properties: { kind: { const: 'control.setValue' }, controlId: BOUNDED_ID_SCHEMA, value: CONTROL_VALUE_SCHEMA },
  },
  'template.select': {
    type: 'object', required: ['kind', 'templateId'], additionalProperties: false,
    properties: { kind: { const: 'template.select' }, templateId: BOUNDED_ID_SCHEMA },
  },
  'template.filter': {
    type: 'object', required: ['kind', 'category'], additionalProperties: false,
    properties: { kind: { const: 'template.filter' }, category: { type: 'string', minLength: 1, maxLength: 200 } },
  },
  'template.use': {
    type: 'object', required: ['kind', 'templateId'], additionalProperties: false,
    properties: { kind: { const: 'template.use' }, templateId: BOUNDED_ID_SCHEMA },
  },
  'project.newBlank': kindOnlySchema('project.newBlank'),
  'recovery.restore': {
    type: 'object', required: ['kind', 'snapshotId'], additionalProperties: false,
    properties: { kind: { const: 'recovery.restore' }, snapshotId: BOUNDED_ID_SCHEMA },
  },
  'transition.undo': kindOnlySchema('transition.undo'),
  'transition.dismiss': kindOnlySchema('transition.dismiss'),
  'application.navigate': {
    type: 'object', required: ['kind', 'target'], additionalProperties: false,
    properties: { kind: { const: 'application.navigate' }, target: { enum: ['cad-home'] } },
  },
  'inspection.run': {
    type: 'object', required: ['kind', 'inspectionId'], additionalProperties: false,
    properties: { kind: { const: 'inspection.run' }, inspectionId: { enum: ['properties', 'measurements', 'clearance', 'interference'] } },
  },
  'sketch.setTool': {
    type: 'object', required: ['kind', 'toolId'], additionalProperties: false,
    properties: { kind: { const: 'sketch.setTool' }, toolId: { enum: ['line', 'rect', 'circle', 'poly', 'select', 'pan'] } },
  },
  'sketch.shape.select': {
    type: 'object', required: ['kind', 'shapeIndex'], additionalProperties: false,
    properties: {
      kind: { const: 'sketch.shape.select' },
      shapeIndex: { type: 'integer', minimum: 0, maximum: 10_000 },
    },
  },
  'sketch.shape.update': {
    type: 'object', required: ['kind', 'shapeIndex', 'property', 'value'], additionalProperties: false,
    properties: {
      kind: { const: 'sketch.shape.update' },
      shapeIndex: { type: 'integer', minimum: 0, maximum: 10_000 },
      property: { enum: ['w', 'h', 'x', 'y', 'd'] },
      value: { anyOf: [{ type: 'number' }, { type: 'string', minLength: 1, maxLength: 20_000 }] },
    },
  },
  'sketch.shape.delete': {
    type: 'object', required: ['kind', 'shapeIndex'], additionalProperties: false,
    properties: {
      kind: { const: 'sketch.shape.delete' },
      shapeIndex: { type: 'integer', minimum: 0, maximum: 10_000 },
    },
  },
  'viewport.setNavigationMode': {
    type: 'object', required: ['kind', 'navigationMode'], additionalProperties: false,
    properties: { kind: { const: 'viewport.setNavigationMode' }, navigationMode: { enum: ['orbit', 'pan'] } },
  },
  'command.advance': {
    type: 'object', required: ['kind', 'controlId'], additionalProperties: false,
    properties: { kind: { const: 'command.advance' }, controlId: BOUNDED_ID_SCHEMA },
  },
  'tree.invoke': {
    type: 'object', required: ['kind', 'entity', 'operation'], additionalProperties: false,
    properties: { kind: { const: 'tree.invoke' }, entity: ENTITY_REF_SCHEMA, operation: BOUNDED_ID_SCHEMA },
  },
  'parameter.invoke': {
    type: 'object', required: ['kind', 'parameterId', 'operation'], additionalProperties: false,
    properties: { kind: { const: 'parameter.invoke' }, parameterId: BOUNDED_ID_SCHEMA, operation: BOUNDED_ID_SCHEMA },
  },
  'inspector.invoke': {
    type: 'object', required: ['kind', 'operation'], additionalProperties: false,
    properties: { kind: { const: 'inspector.invoke' }, operation: BOUNDED_ID_SCHEMA },
  },
  'diagnostics.show': {
    type: 'object', required: ['kind'], additionalProperties: false,
    properties: { kind: { const: 'diagnostics.show' }, diagnosticId: BOUNDED_ID_SCHEMA },
  },
  'command.open': {
    type: 'object', required: ['kind', 'commandId'], additionalProperties: false,
    properties: { kind: { const: 'command.open' }, commandId: BOUNDED_ID_SCHEMA },
  },
  'command.bindSelection': {
    type: 'object', required: ['kind', 'fieldId', 'entities'], additionalProperties: false,
    properties: {
      kind: { const: 'command.bindSelection' },
      fieldId: BOUNDED_ID_SCHEMA,
      entities: { type: 'array', minItems: 0, maxItems: 100, items: SELECTION_REF_SCHEMA },
    },
  },
  'command.setInput': {
    type: 'object', required: ['kind', 'fieldId', 'value'], additionalProperties: false,
    properties: { kind: { const: 'command.setInput' }, fieldId: BOUNDED_ID_SCHEMA, value: COMMAND_FIELD_VALUE_SCHEMA },
  },
  'command.clearInput': {
    type: 'object', required: ['kind', 'fieldId'], additionalProperties: false,
    properties: { kind: { const: 'command.clearInput' }, fieldId: BOUNDED_ID_SCHEMA },
  },
  'preview.present': {
    type: 'object', required: ['kind', 'previewId'], additionalProperties: false,
    properties: { kind: { const: 'preview.present' }, previewId: BOUNDED_ID_SCHEMA },
  },
  'presentation.focusAction': {
    type: 'object', required: ['kind', 'actionId'], additionalProperties: false,
    properties: { kind: { const: 'presentation.focusAction' }, actionId: BOUNDED_ID_SCHEMA },
  },
  'presentation.waitForSettled': {
    type: 'object', required: ['kind'], additionalProperties: false,
    properties: { kind: { const: 'presentation.waitForSettled' }, correlationId: BOUNDED_ID_SCHEMA },
  },
  'presentation.setMode': {
    type: 'object', required: ['kind', 'mode'], additionalProperties: false,
    properties: { kind: { const: 'presentation.setMode' }, mode: { enum: PRESENTATION_MODES } },
  },
  'narration.setMode': {
    type: 'object', required: ['kind', 'mode'], additionalProperties: false,
    properties: { kind: { const: 'narration.setMode' }, mode: { enum: NARRATION_MODES } },
  },
});

function selectionRefLabel(ref) {
  return ref?.owner
    ? `${ref.topologySignature?.kind || 'subshape'} ${ref.stableId} on ${ref.owner.kind} ${ref.owner.id}`
    : `${ref?.kind || 'entity'} ${ref?.id || ''}`.trim();
}

const releasedActionCapabilities = [
  {
    id: 'document.activate',
    permission: 'ui.navigate',
    description: 'Activate an advertised Studio document tab by stable document ID.',
    narration: ({ documentId }) => `Activating document ${documentId}`,
  },
  {
    id: 'workspace.activate',
    permission: 'ui.navigate',
    description: 'Activate an advertised Studio workspace through the same controller used by the workspace tabs.',
    narration: ({ workspaceId }) => `Opening the ${workspaceId} workspace`,
  },
  {
    id: 'selection.set',
    permission: 'ui.select',
    description: 'Replace the semantic selection with one stable entity or exact subshape reference.',
    narration: ({ entity }) => `Selecting ${selectionRefLabel(entity)}`,
  },
  {
    id: 'selection.add',
    permission: 'ui.select',
    description: 'Add one stable entity or exact subshape reference to the visible selection.',
    narration: ({ entity }) => `Adding ${selectionRefLabel(entity)} to the selection`,
  },
  {
    id: 'selection.remove',
    permission: 'ui.select',
    description: 'Remove one stable entity or exact subshape reference from the visible selection.',
    narration: ({ entity }) => `Removing ${selectionRefLabel(entity)} from the selection`,
  },
  {
    id: 'selection.clear',
    permission: 'ui.select',
    description: 'Clear the semantic Studio selection.',
    narration: () => 'Clearing the selection',
  },
  {
    id: 'tree.reveal',
    permission: 'ui.navigate',
    description: 'Reveal a stable entity in the normal model tree without pointer or selector input.',
    narration: ({ entity }) => `Revealing ${entity.kind} ${entity.id} in the model tree`,
  },
  {
    id: 'tree.expand',
    permission: 'ui.navigate',
    description: 'Expand an entity through the normal model-tree controller.',
    narration: ({ entity }) => `Expanding ${entity.kind} ${entity.id} in the model tree`,
  },
  {
    id: 'tree.collapse',
    permission: 'ui.navigate',
    description: 'Collapse an entity through the normal model-tree controller.',
    narration: ({ entity }) => `Collapsing ${entity.kind} ${entity.id} in the model tree`,
  },
  {
    id: 'tree.setSectionExpanded',
    permission: 'ui.navigate',
    description: 'Expand or collapse one advertised normal model-tree section.',
    narration: ({ sectionId, expanded }) => `${expanded ? 'Expanding' : 'Collapsing'} the ${sectionId} model-tree section`,
  },
  {
    id: 'inspector.showEntity',
    permission: 'ui.select',
    description: 'Show the normal properties inspector for a stable selected entity.',
    narration: ({ entity }) => `Opening properties for ${entity.kind} ${entity.id}`,
  },
  {
    id: 'viewport.standardView',
    permission: 'ui.navigate',
    description: 'Activate an advertised semantic camera preset.',
    narration: ({ viewId }) => `Changing the camera to ${viewId}`,
  },
  {
    id: 'viewport.fitAll',
    permission: 'ui.navigate',
    description: 'Fit the visible model using the normal Studio camera controller.',
    narration: () => 'Fitting the visible model in the viewport',
  },
  {
    id: 'viewport.fitSelection',
    permission: 'ui.navigate',
    description: 'Fit the exact rendered bounds of the current semantic selection.',
    narration: () => 'Fitting the current selection in the viewport',
  },
  {
    id: 'viewport.setCamera',
    permission: 'ui.navigate',
    description: 'Set the visible camera through bounded position, target, up, and projection state.',
    narration: () => 'Setting the viewport camera',
  },
  {
    id: 'viewport.setDisplayMode',
    permission: 'ui.navigate',
    description: 'Set the session-scoped display mode through the normal renderer controller.',
    narration: ({ displayModeId }) => `Using ${displayModeId} display`,
  },
  {
    id: 'viewport.activateSection',
    permission: 'ui.navigate',
    description: 'Activate a saved section view without persisting a document edit.',
    narration: ({ sectionId }) => `Activating section ${sectionId}`,
  },
  {
    id: 'viewport.activateExplodedView',
    permission: 'ui.navigate',
    description: 'Activate a saved exploded view without persisting a document edit.',
    narration: ({ explodedViewId }) => `Activating exploded view ${explodedViewId}`,
  },
  {
    id: 'viewport.clearInspectionView',
    permission: 'ui.navigate',
    description: 'Clear session-scoped section and exploded-view presentation.',
    narration: () => 'Clearing section and exploded views',
  },
  {
    id: 'panel.open',
    permission: 'ui.navigate',
    description: 'Open an advertised normal Studio panel.',
    narration: ({ panelId }) => `Opening the ${panelId} panel`,
  },
  {
    id: 'panel.close',
    permission: 'ui.navigate',
    description: 'Close an advertised normal Studio panel.',
    narration: ({ panelId }) => `Closing the ${panelId} panel`,
  },
  {
    id: 'history.showRevision',
    permission: 'ui.navigate',
    description: 'Reveal a bounded revision in the normal project-history surface.',
    narration: ({ revision }) => `Showing project revision ${revision}`,
  },
  {
    id: 'control.invoke',
    permission: 'ui.navigate',
    description: 'Invoke an advertised non-document Studio control through its owning semantic controller.',
    narration: ({ controlId }) => `Invoking ${controlId}`,
  },
  {
    id: 'control.setValue',
    permission: 'ui.navigate',
    description: 'Set an advertised non-document Studio field through its owning semantic controller.',
    narration: ({ controlId }) => `Setting ${controlId}`,
  },
  {
    id: 'template.select',
    permission: 'ui.navigate',
    description: 'Select an advertised editable template in the normal template library.',
    narration: ({ templateId }) => `Selecting template ${templateId}`,
  },
  {
    id: 'template.filter',
    permission: 'ui.navigate',
    description: 'Filter the normal template library by an advertised semantic category.',
    narration: ({ category }) => `Filtering templates to ${category}`,
  },
  {
    id: 'template.use',
    permission: 'project.edit',
    description: 'Replace the active project with an advertised editable template through the normal visible transition.',
    narration: ({ templateId }) => `Opening template ${templateId}`,
  },
  {
    id: 'project.newBlank',
    permission: 'project.edit',
    description: 'Start a canonical blank part and open the normal first Extrude editor.',
    narration: () => 'Starting a blank part',
  },
  {
    id: 'recovery.open',
    permission: 'project.recover',
    description: 'Open and populate the normal local project recovery surface.',
    narration: () => 'Opening local project recovery',
  },
  {
    id: 'recovery.restore',
    permission: 'project.recover',
    description: 'Restore an advertised recovery entry through the normal project transition controller.',
    narration: ({ snapshotId }) => `Restoring recovery entry ${snapshotId}`,
  },
  {
    id: 'transition.undo',
    permission: 'project.edit',
    description: 'Undo the current normal project transition while its bounded recovery action is available.',
    narration: () => 'Restoring the previous project',
  },
  {
    id: 'transition.dismiss',
    permission: 'ui.navigate',
    description: 'Dismiss the current normal project transition notification.',
    narration: () => 'Dismissing the project transition notification',
  },
  {
    id: 'application.navigate',
    permission: 'ui.navigate',
    description: 'Leave Studio through the normal CAD start-page navigation after the structured response settles.',
    narration: () => 'Leaving CAD Studio',
  },
  {
    id: 'sketch.setTool',
    permission: 'ui.command-draft',
    description: 'Choose the active normal sketch tool by stable semantic ID.',
    narration: ({ toolId }) => `Using the ${toolId} sketch tool`,
  },
  {
    id: 'sketch.shape.select',
    permission: 'ui.command-draft',
    description: 'Select one bounded shape in the active normal sketch editor.',
    narration: ({ shapeIndex }) => `Selecting sketch shape ${shapeIndex + 1}`,
  },
  {
    id: 'sketch.shape.update',
    permission: 'ui.command-draft',
    description: 'Update one advertised dimension on a bounded shape in the active normal sketch editor.',
    narration: ({ shapeIndex, property }) => `Editing ${property} on sketch shape ${shapeIndex + 1}`,
  },
  {
    id: 'sketch.shape.delete',
    permission: 'ui.command-draft',
    description: 'Delete one bounded shape from the active normal sketch draft.',
    narration: ({ shapeIndex }) => `Deleting sketch shape ${shapeIndex + 1}`,
  },
  {
    id: 'viewport.setNavigationMode',
    permission: 'ui.navigate',
    description: 'Choose the normal 3D viewport orbit or pan navigation controller.',
    narration: ({ navigationMode }) => `Using ${navigationMode} viewport navigation`,
  },
  {
    id: 'inspection.run',
    permission: 'project.read',
    description: 'Run an advertised exact inspection and present its result in the normal Studio inspector.',
    narration: ({ inspectionId }) => `Running ${inspectionId} inspection`,
  },
  {
    id: 'command.advance',
    permission: 'ui.command-draft',
    description: 'Advance the active normal command through an advertised face, shell, or press-pull lifecycle control.',
    narration: ({ controlId }) => `Advancing ${controlId}`,
  },
  {
    id: 'tree.invoke',
    permission: 'ui.select',
    description: 'Invoke an advertised non-destructive dynamic model-tree action on a stable entity reference.',
    narration: ({ entity, operation }) => `${operation} on ${selectionRefLabel(entity)}`,
  },
  {
    id: 'inspector.invoke',
    permission: 'ui.select',
    description: 'Invoke an advertised non-destructive action in the normal inspector for the current semantic selection or result.',
    narration: ({ operation }) => `Invoking inspector action ${operation}`,
  },
  {
    id: 'diagnostics.show',
    permission: 'ui.navigate',
    description: 'Open the normal diagnostics surface at an optional diagnostic ID.',
    narration: ({ diagnosticId }) => diagnosticId ? `Showing diagnostic ${diagnosticId}` : 'Showing current diagnostics',
  },
  {
    id: 'command.open',
    permission: 'ui.command-draft',
    description: 'Open an advertised normal Studio command panel by stable command ID.',
    narration: ({ commandId }) => `Opening ${commandId}`,
  },
  {
    id: 'command.bindSelection',
    permission: 'ui.command-draft',
    description: 'Bind exact stable references to an advertised command selection field.',
    narration: ({ fieldId }) => `Binding the ${fieldId} command field`,
  },
  {
    id: 'command.setInput',
    permission: 'ui.command-draft',
    description: 'Populate an advertised typed command field without keyboard synthesis.',
    narration: ({ fieldId }) => `Setting the ${fieldId} command field`,
  },
  {
    id: 'command.clearInput',
    permission: 'ui.command-draft',
    description: 'Clear an advertised command field and invalidate any existing preview.',
    narration: ({ fieldId }) => `Clearing the ${fieldId} command field`,
  },
  {
    id: 'command.preview',
    permission: 'ui.present-preview',
    description: 'Build and exact-validate the visible draft through the normal cad_preview transaction path.',
    narration: () => 'Previewing the exact command result',
  },
  {
    id: 'command.commit',
    permission: 'project.edit',
    description: 'Commit the currently attached exact visible preview after the active session approval policy is satisfied.',
    narration: () => 'Committing the approved exact command preview',
  },
  {
    id: 'command.cancel',
    permission: 'ui.command-draft',
    description: 'Cancel the visible command draft and any detached preview without changing the document.',
    narration: () => 'Cancelling the command draft',
  },
  {
    id: 'preview.present',
    permission: 'ui.present-preview',
    description: 'Present the matching exact preview in the normal command and viewport surfaces.',
    narration: () => 'Presenting the exact command preview',
  },
  {
    id: 'preview.dismiss',
    permission: 'ui.present-preview',
    description: 'Dismiss detached preview presentation without cancelling or committing it.',
    narration: () => 'Dismissing the command preview',
  },
  {
    id: 'presentation.setMode',
    permission: 'ui.present-demo',
    description: 'Choose instant, normal, or recording presentation pacing without changing CAD semantics.',
    narration: ({ mode }) => `Using ${mode} presentation`,
  },
  {
    id: 'presentation.focusAction',
    permission: 'ui.present-demo',
    description: 'Focus the visible surface associated with a semantic action ID.',
    narration: ({ actionId }) => `Focusing ${actionId}`,
  },
  {
    id: 'presentation.waitForSettled',
    permission: 'ui.present-demo',
    description: 'Wait for the current structured presentation and renderer state to settle.',
    narration: () => 'Waiting for the visible Studio state to settle',
  },
  {
    id: 'narration.setMode',
    permission: 'ui.present-narration',
    description: 'Choose whether Studio shows structured observable-action subtitles.',
    narration: ({ mode }) => mode === 'off' ? '' : `Showing ${mode} action narration`,
  },
];

const releasedActionById = new Map(releasedActionCapabilities.map((entry) => [entry.id, entry]));
const actionScopes = new Map([
  ['document.activate', ['document']],
  ['workspace.activate', ['workspace']],
  ['selection.set', ['selection']],
  ['selection.add', ['selection']],
  ['selection.remove', ['selection']],
  ['selection.clear', ['selection']],
  ['tree.reveal', ['tree']],
  ['tree.expand', ['tree']],
  ['tree.collapse', ['tree']],
  ['tree.setSectionExpanded', ['tree']],
  ['viewport.fitAll', ['viewport']],
  ['viewport.fitSelection', ['viewport']],
  ['viewport.standardView', ['viewport']],
  ['viewport.setCamera', ['viewport']],
  ['viewport.setDisplayMode', ['viewport']],
  ['viewport.activateSection', ['viewport']],
  ['viewport.activateExplodedView', ['viewport']],
  ['viewport.clearInspectionView', ['viewport']],
  ['panel.open', ['panels']],
  ['panel.close', ['panels']],
  ['inspector.showEntity', ['selection', 'panels']],
  ['history.showRevision', ['panels']],
  ['history.undo', ['document', 'selection', 'tree', 'panels', 'viewport', 'command', 'preview']],
  ['history.redo', ['document', 'selection', 'tree', 'panels', 'viewport', 'command', 'preview']],
  ['control.invoke', ['surfaces', 'workspace', 'command', 'preview']],
  ['control.setValue', ['surfaces']],
  ['template.select', ['surfaces']],
  ['template.filter', ['surfaces']],
  ['template.use', ['document', 'selection', 'tree', 'panels', 'viewport', 'command', 'preview', 'surfaces']],
  ['project.newBlank', ['document', 'selection', 'tree', 'panels', 'viewport', 'command', 'preview', 'surfaces']],
  ['recovery.open', ['surfaces']],
  ['recovery.restore', ['document', 'selection', 'tree', 'panels', 'viewport', 'command', 'preview', 'surfaces']],
  ['transition.undo', ['document', 'selection', 'tree', 'panels', 'viewport', 'command', 'preview', 'surfaces']],
  ['transition.dismiss', ['surfaces']],
  ['application.fullscreen', ['surfaces']],
  ['application.navigate', ['surfaces']],
  ['inspection.run', ['selection', 'panels', 'viewport']],
  ['sketch.setTool', ['command']],
  ['sketch.shape.select', ['command']],
  ['sketch.shape.update', ['command', 'preview']],
  ['sketch.shape.delete', ['command', 'preview']],
  ['viewport.setNavigationMode', ['viewport']],
  ['command.advance', ['command', 'preview']],
  ['command.commit', ['document', 'selection', 'tree', 'panels', 'viewport', 'command', 'preview']],
  ['tree.invoke', ['document', 'selection', 'tree', 'panels', 'viewport', 'command', 'preview']],
  ['parameter.invoke', ['document', 'panels', 'viewport', 'command', 'preview']],
  ['inspector.invoke', ['document', 'selection', 'panels', 'viewport', 'command', 'preview']],
  ['diagnostics.show', ['panels']],
  ['command.open', ['command', 'panels']],
  ['command.bindSelection', ['command', 'preview']],
  ['command.setInput', ['command', 'preview']],
  ['command.clearInput', ['command', 'preview']],
  ['command.preview', ['command', 'preview']],
  ['command.cancel', ['command', 'preview']],
  ['preview.present', ['preview']],
  ['preview.dismiss', ['preview']],
  ['presentation.setMode', ['presentation']],
  ['presentation.focusAction', ['presentation']],
  ['presentation.waitForSettled', ['presentation']],
  ['narration.setMode', ['narration']],
]);

const TERMINAL_PROJECT_ACTIONS = new Set([
  'template.use',
  'project.newBlank',
  'recovery.restore',
  'transition.undo',
  'application.navigate',
]);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function fnv1a32(value) {
  const text = JSON.stringify(canonical(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

const ORIGIN_DATUM_OPERATIONS = Object.freeze([
  { kind: 'datum.create', input: { id: 'datum-origin-point', name: 'Origin', datumKind: 'point', definition: { mode: 'coordinates', coordinates: [0, 0, 0] } } },
  { kind: 'datum.create', input: { id: 'datum-origin-xy', name: 'XY plane', datumKind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [0, 0, 1], xDirection: [1, 0, 0] } } },
  { kind: 'datum.create', input: { id: 'datum-origin-yz', name: 'YZ plane', datumKind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [1, 0, 0], xDirection: [0, 1, 0] } } },
  { kind: 'datum.create', input: { id: 'datum-origin-zx', name: 'ZX plane', datumKind: 'plane', definition: { mode: 'principal', origin: [0, 0, 0], normal: [0, 1, 0], xDirection: [0, 0, 1] } } },
  { kind: 'datum.create', input: { id: 'datum-origin-x', name: 'X axis', datumKind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [1, 0, 0] } } },
  { kind: 'datum.create', input: { id: 'datum-origin-y', name: 'Y axis', datumKind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [0, 1, 0] } } },
  { kind: 'datum.create', input: { id: 'datum-origin-z', name: 'Z axis', datumKind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [0, 0, 1] } } },
  { kind: 'datum.create', input: { id: 'datum-origin-cs', name: 'World coordinates', datumKind: 'coordinate-system', definition: { mode: 'principal', origin: [0, 0, 0], xDirection: [1, 0, 0], zDirection: [0, 0, 1] } } },
]);
const ORIGIN_DATUM_OPERATION_BY_ID = new Map(
  ORIGIN_DATUM_OPERATIONS.map((operation) => [operation.input.id, operation]),
);

function commandBootstrapOperations(draft) {
  const operations = draft?.bootstrapOperations;
  if (operations == null) return [];
  if (
    draft?.commandId === 'inspection.material' &&
    Array.isArray(operations) &&
    operations.length === 1 &&
    fnv1a32(operations[0]) === fnv1a32({ kind: 'material.ensureGeneric', input: {} })
  ) {
    return clone(operations);
  }
  if (!draft?.commandId?.startsWith('model.') || !Array.isArray(operations) || operations.length > ORIGIN_DATUM_OPERATIONS.length) {
    throw new CadUiError('COMMAND_FIELD_INVALID', 'Visible command bootstrap operations are invalid.');
  }
  const seen = new Set();
  return operations.map((operation) => {
    const expected = ORIGIN_DATUM_OPERATION_BY_ID.get(operation?.input?.id);
    if (!expected || seen.has(operation.input.id) || fnv1a32(operation) !== fnv1a32(expected)) {
      throw new CadUiError('COMMAND_FIELD_INVALID', 'Visible command bootstrap operations may only restore canonical origin datums.');
    }
    seen.add(operation.input.id);
    return clone(operation);
  });
}

function requireRigidMatrix4(value) {
  requireFiniteMatrix4(value, 'Component transform');
  if (
    Math.abs(value[3]) > 1e-9 ||
    Math.abs(value[7]) > 1e-9 ||
    Math.abs(value[11]) > 1e-9 ||
    Math.abs(value[15] - 1) > 1e-9
  ) {
    throw new CadUiError('COMMAND_FIELD_INVALID', 'Component transform must use a rigid affine 4×4 matrix.');
  }
  const columns = [
    [value[0], value[1], value[2]],
    [value[4], value[5], value[6]],
    [value[8], value[9], value[10]],
  ];
  const dot = (left, right) => left.reduce((sum, entry, index) => sum + entry * right[index], 0);
  for (let index = 0; index < 3; index++) {
    if (Math.abs(dot(columns[index], columns[index]) - 1) > 1e-6) {
      throw new CadUiError('COMMAND_FIELD_INVALID', 'Component transform axes must have unit length.');
    }
    for (let other = index + 1; other < 3; other++) {
      if (Math.abs(dot(columns[index], columns[other])) > 1e-6) {
        throw new CadUiError('COMMAND_FIELD_INVALID', 'Component transform axes must be orthogonal.');
      }
    }
  }
  const determinant =
    value[0] * (value[5] * value[10] - value[6] * value[9]) -
    value[4] * (value[1] * value[10] - value[2] * value[9]) +
    value[8] * (value[1] * value[6] - value[2] * value[5]);
  if (Math.abs(determinant - 1) > 1e-6) {
    throw new CadUiError('COMMAND_FIELD_INVALID', 'Component transform must preserve handedness and scale.');
  }
}

function commandSelection(draft, fieldId, {
  kinds = [],
  minItems = 1,
  maxItems = 1,
} = {}) {
  const values = draft?.boundSelections?.[fieldId];
  if (!Array.isArray(values) || values.length < minItems || values.length > maxItems) {
    throw new CadUiError('COMMAND_FIELD_REQUIRED', `Command field "${fieldId}" requires between ${minItems} and ${maxItems} semantic selections.`);
  }
  for (const value of values) {
    requireSelectionRef(value);
    const kind = value.owner ? value.topologySignature.kind : value.kind;
    if (kinds.length && !kinds.includes(kind)) {
      throw new CadUiError('COMMAND_FIELD_INVALID', `Command field "${fieldId}" does not accept ${kind} selections.`);
    }
  }
  return clone(values);
}

function optionalCommandSelection(draft, fieldId, options) {
  const values = draft?.boundSelections?.[fieldId];
  return Array.isArray(values) && values.length ? commandSelection(draft, fieldId, options) : [];
}

function commandText(draft, fieldId, { required = true } = {}) {
  const value = draft?.inputValues?.[fieldId];
  if (value == null && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > 20_000) {
    throw new CadUiError(required ? 'COMMAND_FIELD_REQUIRED' : 'COMMAND_FIELD_INVALID', `Command field "${fieldId}" requires bounded text.`);
  }
  return value.trim();
}

function commandBoolean(draft, fieldId, fallback = false) {
  const value = draft?.inputValues?.[fieldId];
  if (value == null) return fallback;
  if (typeof value !== 'boolean') throw new CadUiError('COMMAND_FIELD_INVALID', `Command field "${fieldId}" requires a boolean.`);
  return value;
}

function commandNumber(draft, fieldId, { required = true, integer = false, minimum = -1e12 } = {}) {
  const value = draft?.inputValues?.[fieldId];
  if (value == null && !required) return undefined;
  if (!Number.isFinite(value) || Math.abs(value) > 1e12 || (integer && !Number.isInteger(value)) || value < minimum) {
    throw new CadUiError(required ? 'COMMAND_FIELD_REQUIRED' : 'COMMAND_FIELD_INVALID', `Command field "${fieldId}" requires a bounded${integer ? ' integer' : ''} number.`);
  }
  return value;
}

function commandDimension(draft, fieldId, { required = true } = {}) {
  const value = draft?.inputValues?.[fieldId];
  if (value == null && !required) return undefined;
  if (
    (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12) ||
    (typeof value === 'string' && value.trim() && value.length <= 500)
  ) {
    return typeof value === 'string' ? value.trim() : value;
  }
  throw new CadUiError(
    required ? 'COMMAND_FIELD_REQUIRED' : 'COMMAND_FIELD_INVALID',
    `Command field "${fieldId}" requires a bounded number or expression.`,
  );
}

function commandVector3(draft, fieldId, fallback = [0, 0, 0]) {
  const value = draft?.inputValues?.[fieldId] ?? fallback;
  requireFiniteVector3(value, `Command field "${fieldId}"`);
  return clone(value);
}

function commandGeneratedId(draft, fieldId) {
  const value = draft?.generatedIds?.[fieldId];
  requireBoundedId(value, `Generated ${fieldId}`);
  return value;
}

function commandDefinitionReference(draft, fieldId = 'definition') {
  const [definition] = commandSelection(draft, fieldId, { kinds: ['part', 'assembly'] });
  return definition.kind === 'part'
    ? { kind: 'part', partId: definition.id }
    : { kind: 'assembly', assemblyId: definition.id };
}

function translationMatrix(translation) {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    translation[0], translation[1], translation[2], 1,
  ];
}

function commandParameterOverrides(draft) {
  const value = draft?.inputValues?.parameterOverrides;
  if (value == null) return {};
  if (!Array.isArray(value) || value.length > 1_000) {
    throw new CadUiError('COMMAND_FIELD_INVALID', 'Parameter overrides require a bounded list of "name = expression" rows.');
  }
  const result = {};
  for (const [index, row] of value.entries()) {
    if (typeof row !== 'string' || row.length > 2_000) {
      throw new CadUiError('COMMAND_FIELD_INVALID', `Parameter override row ${index + 1} is not bounded text.`);
    }
    const separator = row.indexOf('=');
    const name = row.slice(0, separator).trim();
    const expression = row.slice(separator + 1).trim();
    if (separator <= 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !expression) {
      throw new CadUiError('COMMAND_FIELD_INVALID', `Parameter override row ${index + 1} must use "name = expression".`);
    }
    result[name] = expression;
  }
  return result;
}

function commandStringList(draft, fieldId, { minItems = 0, maxItems = 1_000 } = {}) {
  const value = draft?.inputValues?.[fieldId];
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    throw new CadUiError(
      minItems ? 'COMMAND_FIELD_REQUIRED' : 'COMMAND_FIELD_INVALID',
      `Command field "${fieldId}" requires between ${minItems} and ${maxItems} bounded text values.`,
    );
  }
  const result = value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim() || entry.length > 200) {
      throw new CadUiError('COMMAND_FIELD_INVALID', `Command field "${fieldId}" item ${index + 1} is not a bounded stable ID.`);
    }
    return entry.trim();
  });
  if (new Set(result).size !== result.length) {
    throw new CadUiError('COMMAND_FIELD_INVALID', `Command field "${fieldId}" contains duplicate stable IDs.`);
  }
  return result;
}

function commandValueList(draft, fieldId, {
  minItems = 0,
  maxItems = 5_000,
  integers = false,
} = {}) {
  const value = draft?.inputValues?.[fieldId];
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    throw new CadUiError(
      minItems ? 'COMMAND_FIELD_REQUIRED' : 'COMMAND_FIELD_INVALID',
      `Command field "${fieldId}" requires between ${minItems} and ${maxItems} values.`,
    );
  }
  return value.map((entry, index) => {
    if (typeof entry === 'string' && entry.trim() && entry.length <= 500 && !integers) return entry.trim();
    if (!Number.isFinite(entry) || Math.abs(entry) > 1e12 || (integers && !Number.isInteger(entry))) {
      throw new CadUiError('COMMAND_FIELD_INVALID', `Command field "${fieldId}" item ${index + 1} is invalid.`);
    }
    return entry;
  });
}

function commandPoints(draft, fieldId, dimensions, { minItems = 2, maxItems = 10_000 } = {}) {
  const value = draft?.inputValues?.[fieldId];
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    throw new CadUiError('COMMAND_FIELD_REQUIRED', `Command field "${fieldId}" requires between ${minItems} and ${maxItems} points.`);
  }
  return value.map((point, pointIndex) => {
    if (!Array.isArray(point) || point.length !== dimensions) {
      throw new CadUiError('COMMAND_FIELD_INVALID', `Command field "${fieldId}" point ${pointIndex + 1} requires ${dimensions} coordinates.`);
    }
    return point.map((coordinate, coordinateIndex) => {
      if (typeof coordinate === 'string' && coordinate.trim() && coordinate.length <= 500) return coordinate.trim();
      if (!Number.isFinite(coordinate) || Math.abs(coordinate) > 1e12) {
        throw new CadUiError('COMMAND_FIELD_INVALID', `Command field "${fieldId}" point ${pointIndex + 1}, coordinate ${coordinateIndex + 1} is invalid.`);
      }
      return coordinate;
    });
  });
}

function boundedDimensionValue(value, label) {
  if (
    (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12) ||
    (typeof value === 'string' && value.trim() && value.length <= 500)
  ) {
    return typeof value === 'string' ? value.trim() : value;
  }
  throw new CadUiError('COMMAND_FIELD_INVALID', `${label} requires a bounded number or expression.`);
}

function commandSketchShapes(draft) {
  const shapes = draft?.inputValues?.sketch;
  if (!Array.isArray(shapes) || !shapes.length || shapes.length > 10_000) {
    throw new CadUiError('COMMAND_FIELD_REQUIRED', 'Sketch geometry requires between 1 and 10,000 closed shapes.');
  }
  return shapes.map((shape, index) => {
    if (!shape || typeof shape !== 'object' || Array.isArray(shape)) {
      throw new CadUiError('COMMAND_FIELD_INVALID', `Sketch shape ${index + 1} is invalid.`);
    }
    if (shape.kind === 'rect') {
      return {
        kind: 'rect',
        x: boundedDimensionValue(shape.x, `Sketch rectangle ${index + 1} X`),
        y: boundedDimensionValue(shape.y, `Sketch rectangle ${index + 1} Y`),
        w: boundedDimensionValue(shape.w, `Sketch rectangle ${index + 1} width`),
        h: boundedDimensionValue(shape.h, `Sketch rectangle ${index + 1} height`),
      };
    }
    if (shape.kind === 'circle') {
      return {
        kind: 'circle',
        x: boundedDimensionValue(shape.x, `Sketch circle ${index + 1} X`),
        y: boundedDimensionValue(shape.y, `Sketch circle ${index + 1} Y`),
        r: boundedDimensionValue(shape.r, `Sketch circle ${index + 1} radius`),
      };
    }
    if (shape.kind === 'poly' && Array.isArray(shape.pts) && shape.pts.length >= 3 && shape.pts.length <= 10_000) {
      return {
        kind: 'poly',
        pts: shape.pts.map((point, pointIndex) => {
          if (!Array.isArray(point) || point.length !== 2) {
            throw new CadUiError('COMMAND_FIELD_INVALID', `Sketch polygon ${index + 1} point ${pointIndex + 1} is invalid.`);
          }
          return point.map((coordinate, coordinateIndex) =>
            boundedDimensionValue(coordinate, `Sketch polygon ${index + 1} point ${pointIndex + 1} coordinate ${coordinateIndex + 1}`));
        }),
      };
    }
    throw new CadUiError('COMMAND_FIELD_INVALID', `Sketch shape ${index + 1} must be a rectangle, circle, or closed polygon.`);
  });
}

function commandResultPolicy(draft) {
  const kind = commandText(draft, 'resultPolicy');
  if (kind === 'new-body') {
    return { kind, bodyName: commandText(draft, 'bodyName') };
  }
  if (!['add', 'subtract', 'intersect'].includes(kind)) {
    throw new CadUiError('COMMAND_FIELD_INVALID', 'Result policy must be new-body, add, subtract, or intersect.');
  }
  return {
    kind,
    targetBodyIds: [commandEntityId(draft, 'targetBody', ['body'])],
    ...(kind === 'subtract' || kind === 'intersect' ? { keepTools: false } : {}),
  };
}

function commandEntityId(draft, fieldId, kinds, { required = true } = {}) {
  const entries = required
    ? commandSelection(draft, fieldId, { kinds, minItems: 1, maxItems: 1 })
    : optionalCommandSelection(draft, fieldId, { kinds, minItems: 0, maxItems: 1 });
  return entries[0]?.id;
}

function commandTopologySignatures(draft, fieldId, kind, bodyId, {
  minItems = 1,
  maxItems = 1_000,
} = {}) {
  const entries = commandSelection(draft, fieldId, { kinds: [kind], minItems, maxItems });
  return entries.map((entry) => {
    if (entry.owner?.kind !== 'body' || entry.owner.id !== bodyId) {
      throw new CadUiError('COMMAND_FIELD_INVALID', `Command field "${fieldId}" must reference ${kind} topology on body "${bodyId}".`);
    }
    const signature = clone(entry.topologySignature);
    delete signature.kind;
    return signature;
  });
}

function commandGeometryReference(reference, role, occurrenceId) {
  if (reference.owner) {
    return {
      ownerKind: reference.owner.kind,
      ownerId: reference.owner.id,
      occurrencePath: occurrenceId ? [occurrenceId] : [],
      semanticPath: { topologyKind: reference.topologySignature.kind, role },
      signature: clone(reference.topologySignature),
    };
  }
  if (reference.kind === 'datum') {
    return {
      ownerKind: 'datum',
      ownerId: reference.id,
      occurrencePath: occurrenceId ? [occurrenceId] : [],
      semanticPath: { role },
      signature: { role },
    };
  }
  if (reference.kind === 'occurrence') {
    return {
      ownerKind: 'occurrence',
      ownerId: reference.id,
      occurrencePath: [reference.id],
      semanticPath: { role },
      signature: { role },
    };
  }
  throw new CadUiError('COMMAND_FIELD_INVALID', `The ${role} mate reference is not a supported occurrence, datum, face, edge, or vertex.`);
}

function buildAssemblyCommandOperation(draft) {
  const commandId = draft.commandId;
  if (commandId === 'assembly.create') {
    return {
      label: 'Create assembly',
      operation: {
        kind: 'assembly.create',
        input: {
          id: commandGeneratedId(draft, 'assemblyId'),
          occurrenceId: commandGeneratedId(draft, 'occurrenceId'),
          name: commandText(draft, 'name'),
          occurrenceName: commandText(draft, 'occurrenceName'),
          fixed: commandBoolean(draft, 'fixed', true),
        },
      },
    };
  }
  if (commandId === 'assembly.exit-context') {
    return { label: 'Return to assembly', operation: { kind: 'assembly.context.exit', input: {} } };
  }
  if (commandId === 'assembly.insert') {
    return {
      label: 'Insert component',
      operation: {
        kind: 'component.insert',
        input: {
          id: commandGeneratedId(draft, 'occurrenceId'),
          name: commandText(draft, 'name'),
          definition: commandDefinitionReference(draft),
          baseTransform: translationMatrix(commandVector3(draft, 'translation')),
          fixed: commandBoolean(draft, 'fixed'),
          visible: true,
        },
      },
    };
  }
  if (commandId === 'assembly.linked') {
    const [occurrence] = commandSelection(draft, 'occurrence', { kinds: ['occurrence'] });
    return {
      label: `Create linked duplicate of ${occurrence.id}`,
      operation: {
        kind: 'component.duplicate',
        input: {
          occurrenceId: occurrence.id,
          id: commandGeneratedId(draft, 'occurrenceId'),
          name: commandText(draft, 'name'),
          baseTransform: translationMatrix(commandVector3(draft, 'translation')),
        },
      },
    };
  }
  if (commandId === 'assembly.independent') {
    const [occurrence] = commandSelection(draft, 'occurrence', { kinds: ['occurrence'] });
    return {
      label: `Make ${occurrence.id} independent`,
      operation: {
        kind: 'component.makeIndependent',
        input: {
          occurrenceId: occurrence.id,
          partId: commandGeneratedId(draft, 'partId'),
          name: commandText(draft, 'name'),
        },
      },
    };
  }
  if (commandId === 'assembly.replace') {
    const [occurrence] = commandSelection(draft, 'occurrence', { kinds: ['occurrence'] });
    return {
      label: `Replace component ${occurrence.id}`,
      operation: {
        kind: 'component.replace',
        input: { occurrenceId: occurrence.id, definition: commandDefinitionReference(draft) },
      },
    };
  }
  if (commandId === 'assembly.variant') {
    const [occurrence] = commandSelection(draft, 'occurrence', { kinds: ['occurrence'] });
    return {
      label: `Configure component variant ${occurrence.id}`,
      operation: {
        kind: 'component.update',
        input: { occurrenceId: occurrence.id, patch: { parameterOverrides: commandParameterOverrides(draft) } },
      },
    };
  }
  if (commandId === 'assembly.component-transform') {
    const [occurrence] = commandSelection(draft, 'occurrence', { kinds: ['occurrence'] });
    const transform = draft.inputValues?.transform;
    requireRigidMatrix4(transform);
    return {
      label: `Transform component ${occurrence.id}`,
      operation: {
        kind: 'component.update',
        input: { occurrenceId: occurrence.id, patch: { baseTransform: clone(transform) } },
      },
    };
  }
  if (commandId === 'assembly.edit-context') {
    const [occurrence] = commandSelection(draft, 'occurrence', { kinds: ['occurrence'] });
    return {
      label: `Edit component ${occurrence.id} in assembly context`,
      operation: { kind: 'assembly.context.enter', input: { occurrenceId: occurrence.id } },
    };
  }
  if (commandId === 'assembly.pattern') {
    const [occurrence] = commandSelection(draft, 'occurrence', { kinds: ['occurrence'] });
    const patternKind = commandText(draft, 'patternKind');
    if (!['circular', 'linear'].includes(patternKind)) throw new CadUiError('COMMAND_FIELD_INVALID', 'Component pattern type must be circular or linear.');
    const generatedCount = commandNumber(draft, 'generatedCount', { integer: true, minimum: 1 });
    return {
      label: `Create ${patternKind} component pattern`,
      operation: {
        kind: 'component.pattern',
        input: {
          id: commandGeneratedId(draft, 'patternId'),
          name: commandText(draft, 'name'),
          kind: patternKind,
          sourceOccurrenceIds: [occurrence.id],
          generatedCount,
          definition: patternKind === 'circular'
            ? { axis: [0, 0, 1], center: [0, 0, 0], totalAngle: commandNumber(draft, 'totalAngle') }
            : { direction: [0, 0, 1], spacing: commandNumber(draft, 'spacing') },
        },
      },
    };
  }
  if (commandId.startsWith('assembly.mate.')) {
    const mateKind = commandId.slice('assembly.mate.'.length);
    const [moving] = commandSelection(draft, 'movingOccurrence', { kinds: ['occurrence'] });
    const anchors = optionalCommandSelection(draft, 'anchorOccurrence', { kinds: ['occurrence'] });
    const fixed = mateKind === 'fixed';
    if (!fixed && anchors.length !== 1) throw new CadUiError('COMMAND_FIELD_REQUIRED', 'Non-fixed mates require one anchor occurrence.');
    const occurrenceIds = fixed ? [moving.id] : [anchors[0].id, moving.id];
    const anchorReferences = fixed ? [] : optionalCommandSelection(draft, 'anchorReference', { kinds: ['occurrence', 'datum', 'face', 'edge', 'vertex'] });
    const movingReferences = fixed ? [] : optionalCommandSelection(draft, 'movingReference', { kinds: ['occurrence', 'datum', 'face', 'edge', 'vertex'] });
    if (!fixed && (anchorReferences.length !== 1 || movingReferences.length !== 1)) {
      throw new CadUiError('COMMAND_FIELD_REQUIRED', 'Non-fixed mates require one anchor and one moving geometry reference.');
    }
    const valueKinds = new Set(['distance', 'angle', 'coincident', 'concentric', 'tangent']);
    const value = valueKinds.has(mateKind) ? commandNumber(draft, 'value') : undefined;
    const editMateId = draft.editEntity?.kind === 'mate'
      ? draft.editEntity.id
      : null;
    if (editMateId) {
      return {
        label: `Edit ${mateKind} mate`,
        operation: {
          kind: 'mate.update',
          input: {
            mateId: editMateId,
            patch: {
              name: commandText(draft, 'name'),
              kind: mateKind,
              occurrenceIds,
              references: fixed ? [] : [
                commandGeometryReference(anchorReferences[0], 'anchor', anchors[0].id),
                commandGeometryReference(movingReferences[0], 'moving', moving.id),
              ],
              ...(value === undefined ? {} : { value }),
              extensions: { flip: commandBoolean(draft, 'flip') },
            },
          },
        },
      };
    }
    return {
      label: `Create ${mateKind} mate`,
      operation: {
        kind: 'mate.create',
        input: {
          id: commandGeneratedId(draft, 'mateId'),
          name: commandText(draft, 'name'),
          mateKind,
          occurrenceIds,
          references: fixed ? [] : [
            commandGeometryReference(anchorReferences[0], 'anchor', anchors[0].id),
            commandGeometryReference(movingReferences[0], 'moving', moving.id),
          ],
          ...(value === undefined ? {} : { value }),
          extensions: { flip: commandBoolean(draft, 'flip') },
        },
      },
    };
  }
  throw new CadUiError('COMMAND_NOT_AVAILABLE', 'The active command draft has no assembly transaction adapter.');
}

function buildModelCommandOperation(draft) {
  const commandId = draft.commandId;
  const modelCommand = commandId.slice('model.'.length);
  if (['model.extrude', 'model.cut', 'model.revolve'].includes(commandId)) {
    const resultPolicy = commandResultPolicy(draft);
    const patternKind = modelCommand === 'revolve'
      ? 'none'
      : draft.inputValues.patternKind == null
        ? 'none'
        : commandText(draft, 'patternKind');
    if (!['none', 'linear', 'circular'].includes(patternKind)) {
      throw new CadUiError('COMMAND_FIELD_INVALID', 'Feature pattern type must be none, linear, or circular.');
    }
    const pattern = patternKind === 'none'
      ? null
      : {
          kind: patternKind,
          n: commandNumber(draft, 'patternCount', { integer: true, minimum: 2 }),
          ...(patternKind === 'circular'
            ? {
                cx: commandDimension(draft, 'patternA'),
                cy: commandDimension(draft, 'patternB'),
              }
            : {
                dx: commandDimension(draft, 'patternA'),
                dy: commandDimension(draft, 'patternB'),
              }),
        };
    const supportFace = optionalCommandSelection(draft, 'supportFace', {
      kinds: ['face'],
      minItems: 0,
      maxItems: 1,
    })[0];
    const input = {
      id: commandGeneratedId(draft, 'featureId'),
      name: modelCommand[0].toUpperCase() + modelCommand.slice(1),
      sketch: {
        shapes: commandSketchShapes(draft),
        z: commandDimension(draft, 'sketchZ', { required: false }) ?? 0,
      },
      resultPolicy,
      ...(pattern ? { pattern } : {}),
      ...(supportFace ? {
        onFace: (() => {
          const signature = clone(supportFace.topologySignature);
          delete signature.kind;
          return signature;
        })(),
        inputRefs: [{
          ownerKind: 'body',
          ownerId: supportFace.owner.id,
          semanticPath: { role: 'support-face' },
          signature: clone(supportFace.topologySignature),
        }],
      } : {}),
      ...(modelCommand === 'extrude' || modelCommand === 'cut'
        ? {
            height: commandDimension(draft, 'height'),
            ...(modelCommand === 'cut' ? { through: commandBoolean(draft, 'through') } : {}),
          }
        : {}),
    };
    const editFeatureId = draft.editEntity?.kind === 'feature'
      ? draft.editEntity.id
      : null;
    if (editFeatureId) {
      const patch = {
        sketch: input.sketch,
        resultPolicy,
        inputRefs: input.inputRefs || [],
        onFace: input.onFace || null,
        ...(modelCommand === 'extrude' || modelCommand === 'cut'
          ? {
              h: input.height,
              ...(modelCommand === 'cut' ? { through: input.through } : {}),
              pattern,
            }
          : {}),
      };
      return {
        label: `Edit ${modelCommand}`,
        operation: {
          kind: 'feature.update',
          input: { featureId: editFeatureId, patch },
        },
      };
    }
    return {
      label: `Create ${modelCommand}`,
      operation: { kind: `feature.${modelCommand}`, input },
    };
  }
  if (commandId === 'model.fillet' || commandId === 'model.chamfer') {
    const edges = commandSelection(draft, 'edges', { kinds: ['edge'], minItems: 1, maxItems: 1_000 });
    const ownerBodyIds = [...new Set(edges.map((entry) => entry.owner?.kind === 'body' ? entry.owner.id : null))];
    if (ownerBodyIds.length !== 1 || !ownerBodyIds[0]) {
      throw new CadUiError('COMMAND_FIELD_INVALID', 'Edge modification requires topology from one body.');
    }
    return {
      label: `Create ${modelCommand}`,
      operation: {
        kind: `feature.${modelCommand}`,
        input: {
          id: commandGeneratedId(draft, 'featureId'),
          name: modelCommand[0].toUpperCase() + modelCommand.slice(1),
          radius: commandDimension(draft, 'radius'),
          edges: edges.map((entry) => {
            const signature = clone(entry.topologySignature);
            delete signature.kind;
            return signature;
          }),
          resultPolicy: { kind: 'add', targetBodyIds: [ownerBodyIds[0]] },
        },
      },
    };
  }
  if (commandId === 'model.shell') {
    const bodyId = commandEntityId(draft, 'body', ['body']);
    return {
      label: 'Create shell',
      operation: {
        kind: 'feature.shell',
        input: {
          id: commandGeneratedId(draft, 'featureId'),
          name: 'Shell',
          thickness: commandDimension(draft, 'thickness'),
          faces: commandTopologySignatures(draft, 'faces', 'face', bodyId),
          resultPolicy: { kind: 'add', targetBodyIds: [bodyId] },
        },
      },
    };
  }
  if (commandId === 'model.split') {
    const targetBodyId = commandEntityId(draft, 'targetBody', ['body']);
    const toolBodyId = commandEntityId(draft, 'toolBody', ['body']);
    if (targetBodyId === toolBodyId) throw new CadUiError('COMMAND_FIELD_INVALID', 'Boolean Split requires different target and tool bodies.');
    return {
      label: 'Create Boolean Split',
      operation: {
        kind: 'boolean.split',
        input: {
          id: commandGeneratedId(draft, 'splitId'),
          name: commandText(draft, 'name'),
          targetBodyId,
          toolBodyIds: [toolBodyId],
          keepOriginal: commandBoolean(draft, 'keepOriginal'),
          keepTools: commandBoolean(draft, 'keepTools', true),
        },
      },
    };
  }
  if (commandId === 'model.plane') {
    const mode = commandText(draft, 'mode');
    const datum = (fieldId, required = true) => commandEntityId(draft, fieldId, ['datum'], { required });
    let definition;
    if (mode === 'offset') {
      definition = { mode, referenceDatumId: datum('referenceDatum'), offset: commandDimension(draft, 'offset') };
    } else if (mode === 'angle') {
      definition = {
        mode,
        referenceDatumId: datum('referenceDatum'),
        axisDatumId: datum('axisDatum'),
        angle: commandDimension(draft, 'angle'),
      };
    } else if (mode === 'midplane') {
      definition = { mode, firstDatumId: datum('firstDatum'), secondDatumId: datum('secondDatum') };
    } else if (mode === 'three-point') {
      definition = { mode, points: commandPoints(draft, 'points', 3, { minItems: 3, maxItems: 3 }) };
    } else if (mode === 'point-normal' || mode === 'curve-normal') {
      const vector = commandVector3(draft, 'normal');
      definition = {
        mode,
        pointDatumId: datum('pointDatum'),
        [mode === 'curve-normal' ? 'tangent' : 'normal']: vector,
      };
    } else {
      throw new CadUiError('COMMAND_FIELD_INVALID', 'Construction plane mode is unsupported.');
    }
    const editDatumId = draft.editEntity?.kind === 'datum'
      ? draft.editEntity.id
      : null;
    return editDatumId
      ? {
          label: 'Edit construction plane',
          operation: {
            kind: 'datum.update',
            input: {
              datumId: editDatumId,
              patch: {
                name: commandText(draft, 'name'),
                definition,
              },
            },
          },
        }
      : {
          label: 'Create construction plane',
          operation: {
            kind: 'datum.create',
            input: {
              id: commandGeneratedId(draft, 'datumId'),
              name: commandText(draft, 'name'),
              datumKind: 'plane',
              definition,
            },
          },
        };
  }
  if (commandId === 'model.profile' || commandId === 'model.path') {
    const profile = commandId === 'model.profile';
    const curveKind = commandText(draft, 'curveKind');
    if (!['spline', 'polyline'].includes(curveKind)) throw new CadUiError('COMMAND_FIELD_INVALID', 'Sketch curve kind must be spline or polyline.');
    const name = commandText(draft, 'name');
    const points = commandPoints(draft, 'points', profile ? 2 : 3);
    const planeDatumId = profile ? commandEntityId(draft, 'planeDatum', ['datum']) : null;
    const editSketchId = draft.editEntity?.kind === 'sketch'
      ? draft.editEntity.id
      : null;
    return editSketchId
      ? {
          label: profile ? 'Edit profile sketch' : 'Edit path sketch',
          operation: {
            kind: 'sketch.advanced.update',
            input: {
              sketchId: editSketchId,
              patch: {
                name,
                kind: curveKind,
                ...(profile ? { planeDatumId } : {}),
                points,
              },
            },
          },
        }
      : {
          label: profile ? 'Create profile sketch' : 'Create path sketch',
          operation: {
            kind: profile ? 'sketch.profile.create' : 'sketch.path.create',
            input: {
              id: commandGeneratedId(draft, 'sketchId'),
              name,
              ...(profile ? { planeDatumId } : {}),
              points,
              curveKind,
            },
          },
        };
  }
  if (commandId === 'model.loft') {
    const sections = commandSelection(draft, 'sections', { kinds: ['sketch'], minItems: 2, maxItems: 1_000 });
    const guides = optionalCommandSelection(draft, 'guideSketch', { kinds: ['sketch'], minItems: 0, maxItems: 1 });
    const centerline = optionalCommandSelection(draft, 'centerlineSketch', { kinds: ['sketch'], minItems: 0, maxItems: 1 });
    const continuity = {
      start: commandText(draft, 'startContinuity'),
      end: commandText(draft, 'endContinuity'),
    };
    if (![continuity.start, continuity.end].every((value) => ['free', 'tangent', 'curvature'].includes(value))) {
      throw new CadUiError('COMMAND_FIELD_INVALID', 'Loft continuity must be free, tangent, or curvature.');
    }
    const name = commandText(draft, 'name');
    return {
      label: 'Create Loft',
      operation: {
        kind: 'feature.loft',
        input: {
          id: commandGeneratedId(draft, 'featureId'),
          name,
          sections: sections.map((entry) => entry.id),
          guideSketchIds: guides.map((entry) => entry.id),
          ...(centerline.length ? { centerlineSketchId: centerline[0].id } : {}),
          continuity,
          ruled: commandBoolean(draft, 'ruled'),
          bodyName: name,
        },
      },
    };
  }
  if (commandId === 'model.sweep') {
    const orientation = commandText(draft, 'orientation');
    if (!['path-normal', 'minimum-twist', 'fixed', 'reference', 'guide', 'controlled-twist'].includes(orientation)) {
      throw new CadUiError('COMMAND_FIELD_INVALID', 'Sweep orientation mode is unsupported.');
    }
    const guide = optionalCommandSelection(draft, 'guideSketch', { kinds: ['sketch'], minItems: 0, maxItems: 1 });
    const name = commandText(draft, 'name');
    return {
      label: 'Create Sweep',
      operation: {
        kind: 'feature.sweep',
        input: {
          id: commandGeneratedId(draft, 'featureId'),
          name,
          profileSketchId: commandEntityId(draft, 'profileSketch', ['sketch']),
          pathSketchId: commandEntityId(draft, 'pathSketch', ['sketch']),
          ...(guide.length ? { guideSketchId: guide[0].id } : {}),
          orientation,
          twistAngle: commandDimension(draft, 'twistAngle'),
          scaleEnd: commandDimension(draft, 'scaleEnd'),
          referenceDirection: commandVector3(draft, 'referenceDirection'),
          transition: 'round',
          bodyName: name,
        },
      },
    };
  }
  if (commandId === 'model.revolve-advanced') {
    const name = commandText(draft, 'name');
    return {
      label: 'Create partial Revolve',
      operation: {
        kind: 'feature.revolveProfile',
        input: {
          id: commandGeneratedId(draft, 'featureId'),
          name,
          profileSketchId: commandEntityId(draft, 'profileSketch', ['sketch']),
          axisDatumId: commandEntityId(draft, 'axisDatum', ['datum']),
          angle: commandDimension(draft, 'angle'),
          startAngle: commandDimension(draft, 'startAngle'),
          symmetric: commandBoolean(draft, 'symmetric'),
          bodyName: name,
        },
      },
    };
  }
  if (commandId === 'model.draft' || commandId === 'model.thicken' || commandId === 'model.variable-fillet') {
    const bodyId = commandEntityId(draft, 'body', ['body']);
    const name = commandText(draft, 'name');
    if (commandId === 'model.draft') {
      return {
        label: 'Create Draft',
        operation: {
          kind: 'feature.draft',
          input: {
            id: commandGeneratedId(draft, 'featureId'),
            name,
            bodyId,
            neutralPlaneDatumId: commandEntityId(draft, 'neutralPlane', ['datum']),
            faceRefs: commandTopologySignatures(draft, 'faces', 'face', bodyId),
            angle: commandDimension(draft, 'angle'),
            flip: commandBoolean(draft, 'flip'),
            tangentPropagation: commandBoolean(draft, 'tangentPropagation', true),
          },
        },
      };
    }
    if (commandId === 'model.thicken') {
      const symmetric = commandBoolean(draft, 'symmetric');
      return {
        label: 'Create Thicken',
        operation: {
          kind: 'feature.thicken',
          input: {
            id: commandGeneratedId(draft, 'featureId'),
            name,
            bodyId,
            faceRefs: commandTopologySignatures(draft, 'faces', 'face', bodyId, { minItems: 1, maxItems: 1 }),
            thickness: commandDimension(draft, 'thickness'),
            direction: symmetric ? 'symmetric' : commandBoolean(draft, 'flip') ? 'inside' : 'outside',
            bodyName: commandText(draft, 'bodyName'),
          },
        },
      };
    }
    const edgeRefs = commandTopologySignatures(draft, 'edges', 'edge', bodyId);
    return {
      label: 'Create variable Fillet',
      operation: {
        kind: 'feature.variableFillet',
        input: {
          id: commandGeneratedId(draft, 'featureId'),
          name,
          bodyId,
          edgeRefs,
          variableRadii: edgeRefs.map(() => ({
            startRadius: commandDimension(draft, 'startRadius'),
            endRadius: commandDimension(draft, 'endRadius'),
          })),
          tangentPropagation: commandBoolean(draft, 'tangentPropagation'),
        },
      },
    };
  }
  if (commandId === 'model.pattern') {
    const patternKind = commandText(draft, 'patternKind');
    if (!['circular', 'linear', 'curve', 'mirror'].includes(patternKind)) {
      throw new CadUiError('COMMAND_FIELD_INVALID', 'Body pattern type is unsupported.');
    }
    const directionDatums = optionalCommandSelection(draft, 'directionDatums', { kinds: ['datum'], minItems: 0, maxItems: 2 });
    const definition = {
      outputMode: commandText(draft, 'outputMode'),
      count: commandDimension(draft, 'count'),
      distribution: commandText(draft, 'distribution'),
      symmetric: commandBoolean(draft, 'symmetric'),
      orientation: commandText(draft, 'orientation'),
      skippedIndices: commandValueList(draft, 'skippedIndices', { integers: true }),
      count2: commandDimension(draft, 'count2'),
      distribution2: commandText(draft, 'distribution'),
      symmetric2: commandBoolean(draft, 'symmetric2'),
      spacing2: commandDimension(draft, 'spacing2'),
      extent2: commandDimension(draft, 'extent2'),
      positions2: commandValueList(draft, 'tableValues2'),
      spacing: commandDimension(draft, 'spacing'),
      extent: commandDimension(draft, 'extent'),
      totalAngle: commandDimension(draft, 'totalAngle'),
      spacingAngle: commandDimension(draft, 'spacingAngle'),
      radialOffset: commandDimension(draft, 'radialOffset'),
      axialOffset: commandDimension(draft, 'axialOffset'),
      ...(patternKind === 'linear'
        ? { positions: commandValueList(draft, 'tableValues') }
        : patternKind === 'circular'
          ? { angles: commandValueList(draft, 'tableValues') }
          : { parameters: commandValueList(draft, 'tableValues') }),
    };
    const patternInput = {
      name: commandText(draft, 'name'),
      kind: patternKind,
      sourceBodyId: commandEntityId(draft, 'sourceBody', ['body']),
      ...(directionDatums.length ? { directionDatumIds: directionDatums.map((entry) => entry.id) } : {}),
      ...(optionalCommandSelection(draft, 'axisDatum', { kinds: ['datum'], minItems: 0, maxItems: 1 })[0]
        ? { axisDatumId: commandEntityId(draft, 'axisDatum', ['datum']) }
        : {}),
      ...(optionalCommandSelection(draft, 'planeDatum', { kinds: ['datum'], minItems: 0, maxItems: 1 })[0]
        ? { planeDatumId: commandEntityId(draft, 'planeDatum', ['datum']) }
        : {}),
      ...(optionalCommandSelection(draft, 'pathSketch', { kinds: ['sketch'], minItems: 0, maxItems: 1 })[0]
        ? { pathSketchId: commandEntityId(draft, 'pathSketch', ['sketch']) }
        : {}),
    };
    const editPatternId = draft.editEntity?.kind === 'body-pattern'
      ? draft.editEntity.id
      : null;
    return editPatternId
      ? {
          label: `Edit ${patternKind} body pattern`,
          operation: {
            kind: 'pattern.update',
            input: {
              patternId: editPatternId,
              patch: {
                ...patternInput,
                ...definition,
              },
            },
          },
        }
      : {
          label: `Create ${patternKind} body pattern`,
          operation: {
            kind: 'pattern.create',
            input: {
              id: commandGeneratedId(draft, 'patternId'),
              ...patternInput,
              definition,
            },
          },
        };
  }
  if (['move', 'copy', 'rotate', 'mirror', 'scale', 'align'].includes(modelCommand)) {
    const bodyId = commandEntityId(draft, 'body', ['body']);
    let transform;
    if (modelCommand === 'move' || modelCommand === 'copy') {
      transform = { mode: modelCommand, translation: commandVector3(draft, 'translation') };
    } else if (modelCommand === 'rotate') {
      transform = {
        mode: modelCommand,
        axisDatumId: commandEntityId(draft, 'axisDatum', ['datum']),
        angle: commandDimension(draft, 'angle'),
      };
    } else if (modelCommand === 'mirror') {
      transform = { mode: modelCommand, planeDatumId: commandEntityId(draft, 'planeDatum', ['datum']) };
    } else if (modelCommand === 'scale') {
      transform = {
        mode: modelCommand,
        factor: commandDimension(draft, 'factor'),
        center: commandVector3(draft, 'center'),
      };
    } else {
      transform = {
        mode: 'align',
        fromDatumId: commandEntityId(draft, 'fromDatum', ['datum']),
        toDatumId: commandEntityId(draft, 'toDatum', ['datum']),
        offset: commandDimension(draft, 'offset'),
        flip: commandBoolean(draft, 'flip'),
      };
    }
    return {
      label: `${modelCommand[0].toUpperCase()}${modelCommand.slice(1)} body`,
      operation: {
        kind: 'body.transform',
        input: {
          id: commandGeneratedId(draft, 'featureId'),
          bodyId,
          transform,
          copy: modelCommand === 'copy',
          moveOriginal: modelCommand === 'mirror' && commandBoolean(draft, 'moveOriginal'),
        },
      },
    };
  }
  throw new CadUiError('COMMAND_NOT_AVAILABLE', 'The active command draft has no modeling transaction adapter.');
}

function buildInspectionCommandOperation(draft) {
  const commandId = draft.commandId;
  if (commandId === 'inspection.section') {
    const sectionKind = commandText(draft, 'sectionKind');
    if (!['plane', 'quarter', 'box'].includes(sectionKind)) {
      throw new CadUiError('COMMAND_FIELD_INVALID', 'Section mode must be plane, quarter, or box.');
    }
    const planeNormals = sectionKind === 'plane'
      ? [[1, 0, 0]]
      : sectionKind === 'quarter'
        ? [[1, 0, 0], [0, 1, 0]]
        : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const scope = optionalCommandSelection(draft, 'scopeOccurrence', { kinds: ['occurrence'], maxItems: 1 });
    return {
      label: 'Create saved section view',
      operation: {
        kind: 'section.create',
        input: {
          id: commandGeneratedId(draft, 'sectionId'),
          name: commandText(draft, 'name'),
          kind: sectionKind,
          planes: planeNormals.map((normal) => ({ normal, offset: commandNumber(draft, 'offset') })),
          scopeOccurrenceIds: scope.map((entry) => entry.id),
          cap: commandBoolean(draft, 'cap', true),
          reverse: commandBoolean(draft, 'reverse'),
          hatch: {
            enabled: true,
            spacing: commandNumber(draft, 'hatchSpacing'),
            angle: commandNumber(draft, 'hatchAngle'),
            fillColor: commandText(draft, 'capFillColor', { required: false }) || '#d7e0e5',
            color: commandText(draft, 'hatchColor', { required: false }) || '#243746',
          },
        },
      },
    };
  }
  if (commandId === 'inspection.explode') {
    const [occurrence] = commandSelection(draft, 'occurrence', { kinds: ['occurrence'] });
    return {
      label: 'Create saved exploded view',
      operation: {
        kind: 'exploded.create',
        input: {
          id: commandGeneratedId(draft, 'explodedViewId'),
          name: commandText(draft, 'name'),
          steps: [{ occurrenceIds: [occurrence.id], translation: commandVector3(draft, 'translation') }],
        },
      },
    };
  }
  if (commandId === 'inspection.stage') {
    return {
      label: 'Create axial stage group',
      operation: {
        kind: 'stage.create',
        input: {
          id: commandGeneratedId(draft, 'stageGroupId'),
          name: commandText(draft, 'name'),
          occurrenceIds: commandStringList(draft, 'occurrenceIds', { minItems: 1 }),
          distanceMateIds: commandStringList(draft, 'distanceMateIds', { minItems: 1 }),
          axis: [0, 0, 1],
          start: commandNumber(draft, 'start'),
          spacing: commandNumber(draft, 'spacing'),
          visible: commandBoolean(draft, 'visible', true),
        },
      },
    };
  }
  if (commandId === 'inspection.measure') {
    const measurementKind = commandText(draft, 'measurementKind');
    if (!['bounding-box', 'minimum-clearance'].includes(measurementKind)) {
      throw new CadUiError('COMMAND_FIELD_INVALID', 'Saved measurement type must be bounding-box or minimum-clearance.');
    }
    const bodies = commandSelection(draft, 'bodies', {
      kinds: ['body'],
      minItems: measurementKind === 'minimum-clearance' ? 2 : 1,
      maxItems: measurementKind === 'minimum-clearance' ? 2 : 1,
    });
    return {
      label: 'Create saved exact measurement',
      operation: {
        kind: 'measurement.create',
        input: {
          id: commandGeneratedId(draft, 'measurementId'),
          name: commandText(draft, 'name'),
          measurementKind,
          definition: { bodyIds: bodies.map((entry) => entry.id) },
        },
      },
    };
  }
  if (commandId === 'inspection.material') {
    const bodyId = commandEntityId(draft, 'body', ['body']);
    const materialId = commandEntityId(draft, 'material', ['material']);
    const context = draft?.materialContext;
    requireBoundedId(context?.partId, 'Material source part');
    if (context.bodyId !== bodyId) {
      throw new CadUiError('COMMAND_FIELD_INVALID', 'Material assignment body does not match the visible component-body context.');
    }
    const operations = [{
      kind: 'material.assignBody',
      input: { partId: context.partId, bodyId, materialId },
    }];
    if (context.occurrenceId && context.appearanceId) {
      requireBoundedId(context.occurrenceId, 'Material occurrence');
      requireBoundedId(context.appearanceId, 'Material appearance');
      operations.push({
        kind: 'appearance.assignOccurrence',
        input: { occurrenceId: context.occurrenceId, appearanceId: context.appearanceId },
      });
    }
    return { label: 'Assign material and appearance', operations };
  }
  throw new CadUiError('COMMAND_NOT_AVAILABLE', 'The active command draft has no inspection transaction adapter.');
}

export function buildCadUiCommandTransaction({
  draft,
  expectedRevision,
  transactionId,
  actor = 'agent',
} = {}) {
  const command = cadUiCommandDefinition(draft?.commandId);
  if (!command || (
    !draft.commandId.startsWith('model.') &&
    !draft.commandId.startsWith('assembly.') &&
    !draft.commandId.startsWith('inspection.')
  )) {
    throw new CadUiError('COMMAND_NOT_AVAILABLE', 'The active command draft is not an advertised visible command.');
  }
  requireBoundedId(draft.draftId, 'Visible command draft');
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || draft.baseRevision !== expectedRevision) {
    throw new CadUiError('REVISION_CONFLICT', 'The visible command draft does not target the current document revision.', {
      draftRevision: draft?.baseRevision,
      expectedRevision,
    });
  }
  requireBoundedId(transactionId, 'Visible command transaction');
  const built = draft.commandId.startsWith('model.')
    ? buildModelCommandOperation(draft)
    : draft.commandId.startsWith('assembly.')
      ? buildAssemblyCommandOperation(draft)
      : buildInspectionCommandOperation(draft);
  const transaction = {
    transactionId,
    label: built.label,
    expectedRevision,
    operations: [...commandBootstrapOperations(draft), ...(built.operations || [built.operation])],
    atomic: true,
    metadata: {
      actor,
      visibleCommandId: draft.commandId,
      draftId: draft.draftId,
    },
  };
  return { transaction, transactionHash: fnv1a32(transaction) };
}

function integer(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

function encodedBytes(value, code) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch (error) {
    throw new CadUiError(code, 'Structured UI state must be JSON-serializable.', {
      cause: String(error?.message || error),
    });
  }
}

function requireEntityRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CadUiError('SELECTION_KIND_UNSUPPORTED', 'A semantic entity reference is required.');
  }
  const entityKinds = new Set([
    'project', 'part', 'assembly', 'body', 'occurrence', 'feature', 'datum', 'sketch',
    'body-pattern', 'occurrence-pattern', 'mate', 'material', 'appearance',
    'section', 'exploded-view', 'measurement', 'stage-group',
  ]);
  if (!entityKinds.has(value.kind) || typeof value.id !== 'string' || !value.id) {
    throw new CadUiError('SELECTION_KIND_UNSUPPORTED', 'The semantic entity reference kind is not advertised by V6.');
  }
  if (value.id.length > 200 || Object.keys(value).some((key) => key !== 'kind' && key !== 'id')) {
    throw new CadUiError('SELECTION_KIND_UNSUPPORTED', 'Entity references contain only a bounded kind and stable ID.');
  }
}

function requireSelectionRef(value) {
  if (value?.owner) {
    requireEntityRef(value.owner);
    if (
      typeof value.stableId !== 'string' ||
      !value.stableId ||
      value.stableId.length > 200 ||
      !value.topologySignature ||
      typeof value.topologySignature !== 'object' ||
      !['face', 'edge', 'vertex'].includes(value.topologySignature.kind)
    ) {
      throw new CadUiError('SELECTION_KIND_UNSUPPORTED', 'A subshape selection requires a bounded stable ID, owner, and face, edge, or vertex topology signature.');
    }
    const signature = value.topologySignature;
    const signatureFields = {
      face: new Set(['kind', 'p', 'n']),
      edge: new Set(['kind', 'p', 'l', 'curveType', 'r', 'c']),
      vertex: new Set(['kind', 'p']),
    }[signature.kind];
    if (Object.keys(signature).some((key) => !signatureFields.has(key))) {
      throw new CadUiError('SELECTION_KIND_UNSUPPORTED', 'Topology signatures are closed typed values.');
    }
    requireFiniteVector3(signature.p, 'Topology signature point');
    if (signature.kind === 'face') {
      requireFiniteVector3(signature.n, 'Topology signature normal');
    } else if (signature.kind === 'edge') {
      if (!Number.isFinite(signature.l) || signature.l < 0 || typeof signature.curveType !== 'string' || !signature.curveType || signature.curveType.length > 100) {
        throw new CadUiError('SELECTION_KIND_UNSUPPORTED', 'Edge topology signatures require a bounded curve type and non-negative finite length.');
      }
      if (signature.r !== undefined && (!Number.isFinite(signature.r) || signature.r < 0)) {
        throw new CadUiError('SELECTION_KIND_UNSUPPORTED', 'Edge topology radius must be non-negative and finite.');
      }
      if (signature.c !== undefined) requireFiniteVector3(signature.c, 'Topology signature center');
    }
    if (value.expectedGeometry !== undefined && !['plane', 'cylinder', 'cone', 'line', 'circle', 'spline', 'other'].includes(value.expectedGeometry)) {
      throw new CadUiError('SELECTION_KIND_UNSUPPORTED', 'Subshape expected geometry is not advertised.');
    }
    const allowed = new Set(['owner', 'stableId', 'topologySignature', 'expectedGeometry']);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
      throw new CadUiError('SELECTION_KIND_UNSUPPORTED', 'Subshape references contain only owner, stable ID, topology signature, and optional expected geometry.');
    }
    return;
  }
  requireEntityRef(value);
}

function requireBoundedId(value, label) {
  if (typeof value !== 'string' || !value || value.length > 200) {
    throw new CadUiError('UI_CAPABILITY_DISABLED', `${label} requires a bounded stable ID.`);
  }
}

function requireFiniteVector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new CadUiError('VIEW_NOT_AVAILABLE', `${label} requires three finite numbers.`);
  }
  if (value.some((entry) => Math.abs(entry) > 1e9)) {
    throw new CadUiError('VIEW_NOT_AVAILABLE', `${label} exceeds the bounded camera range.`);
  }
}

function requireFiniteMatrix4(value, label) {
  if (!Array.isArray(value) || value.length !== 16 || !value.every(Number.isFinite)) {
    throw new CadUiError('COMMAND_FIELD_INVALID', `${label} requires 16 finite numbers.`);
  }
  if (value.some((entry) => Math.abs(entry) > 1e9)) {
    throw new CadUiError('COMMAND_FIELD_INVALID', `${label} exceeds the bounded transform range.`);
  }
}

function requireBoundedCommandValue(value, depth = 0) {
  if (depth > 6) throw new CadUiError('COMMAND_FIELD_INVALID', 'Command field values may not exceed six nested levels.');
  if (value === null || value === undefined) {
    throw new CadUiError('COMMAND_FIELD_INVALID', 'Use command.clearInput instead of a null or undefined command field value.');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw new CadUiError('COMMAND_FIELD_INVALID', 'Command numeric values must be finite and bounded.');
    return;
  }
  if (typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (value.length > 20_000) throw new CadUiError('COMMAND_FIELD_INVALID', 'Command text values are limited to 20,000 characters.');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new CadUiError('COMMAND_FIELD_INVALID', 'Command list values are limited to 10,000 entries.');
    for (const entry of value) requireBoundedCommandValue(entry, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length > 20) throw new CadUiError('COMMAND_FIELD_INVALID', 'Command structured values are limited to 20 fields.');
    for (const [key, entry] of Object.entries(value)) {
      requireBoundedId(key, 'Command structured field');
      requireBoundedCommandValue(entry, depth + 1);
    }
    return;
  }
  throw new CadUiError('COMMAND_FIELD_INVALID', 'Command fields accept only bounded structured JSON values.');
}

function validateActionShape(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action) || typeof action.kind !== 'string') {
    throw new CadUiError('UI_CAPABILITY_DISABLED', 'Each UI action must be a typed object with a stable kind.');
  }
  const schema = ACTION_INPUT_SCHEMAS[action.kind];
  if (!schema) throw new CadUiError('UI_CAPABILITY_DISABLED', `UI action "${action.kind}" is not advertised.`);
  const allowedKeys = new Set(Object.keys(schema.properties));
  const unexpected = Object.keys(action).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) {
    throw new CadUiError('UI_CAPABILITY_DISABLED', `UI action "${action.kind}" contains unsupported fields.`, { unexpected });
  }
  switch (action.kind) {
    case 'document.activate':
      requireBoundedId(action.documentId, 'document.activate');
      break;
    case 'workspace.activate':
      if (typeof action.workspaceId !== 'string' || !action.workspaceId || action.workspaceId.length > 100) {
        throw new CadUiError('UI_CAPABILITY_DISABLED', 'workspace.activate requires a bounded workspaceId.');
      }
      break;
    case 'selection.set':
    case 'selection.add':
    case 'selection.remove':
      requireSelectionRef(action.entity);
      break;
    case 'tree.reveal':
    case 'tree.expand':
    case 'tree.collapse':
    case 'inspector.showEntity':
      requireEntityRef(action.entity);
      break;
    case 'tree.setSectionExpanded':
      if (!TREE_SECTION_IDS.includes(action.sectionId) || typeof action.expanded !== 'boolean') {
        throw new CadUiError('UI_CAPABILITY_DISABLED', 'tree.setSectionExpanded requires an advertised sectionId and boolean expanded state.');
      }
      break;
    case 'selection.clear':
    case 'viewport.fitAll':
    case 'viewport.fitSelection':
    case 'viewport.clearInspectionView':
      break;
    case 'viewport.standardView':
      if (typeof action.viewId !== 'string' || !action.viewId || action.viewId.length > 100) {
        throw new CadUiError('VIEW_NOT_AVAILABLE', 'viewport.standardView requires a bounded viewId.');
      }
      break;
    case 'viewport.setCamera':
      if (!action.camera || typeof action.camera !== 'object') throw new CadUiError('VIEW_NOT_AVAILABLE', 'viewport.setCamera requires a camera state.');
      requireFiniteVector3(action.camera.position, 'Camera position');
      requireFiniteVector3(action.camera.target, 'Camera target');
      requireFiniteVector3(action.camera.up, 'Camera up');
      if (!['perspective', 'orthographic'].includes(action.camera.projection)) throw new CadUiError('VIEW_NOT_AVAILABLE', 'Camera projection is not advertised.');
      break;
    case 'viewport.setDisplayMode':
      requireBoundedId(action.displayModeId, 'viewport.setDisplayMode');
      break;
    case 'viewport.activateSection':
      requireBoundedId(action.sectionId, 'viewport.activateSection');
      break;
    case 'viewport.activateExplodedView':
      requireBoundedId(action.explodedViewId, 'viewport.activateExplodedView');
      break;
    case 'panel.open':
    case 'panel.close':
      requireBoundedId(action.panelId, action.kind);
      break;
    case 'history.showRevision':
      if (!Number.isInteger(action.revision) || action.revision < 0) throw new CadUiError('VIEW_NOT_AVAILABLE', 'history.showRevision requires a non-negative integer revision.');
      break;
    case 'history.undo':
    case 'history.redo':
    case 'recovery.open':
    case 'application.fullscreen':
    case 'command.commit':
      break;
    case 'control.invoke':
      requireBoundedId(action.controlId, 'control.invoke');
      break;
    case 'control.setValue':
      requireBoundedId(action.controlId, 'control.setValue');
      if (!['boolean', 'number', 'string'].includes(typeof action.value)) {
        throw new CadUiError('UI_CAPABILITY_DISABLED', 'control.setValue requires a bounded scalar value.');
      }
      if (typeof action.value === 'string' && action.value.length > 20_000) {
        throw new CadUiError('UI_CAPABILITY_DISABLED', 'control.setValue text is limited to 20,000 characters.');
      }
      break;
    case 'template.select':
      requireBoundedId(action.templateId, 'template.select');
      break;
    case 'template.filter':
      requireBoundedId(action.category, 'template.filter');
      break;
    case 'template.use':
      requireBoundedId(action.templateId, 'template.use');
      break;
    case 'recovery.restore':
      requireBoundedId(action.snapshotId, 'recovery.restore');
      break;
    case 'project.newBlank':
    case 'transition.undo':
    case 'transition.dismiss':
      break;
    case 'application.navigate':
      if (action.target !== 'cad-home') throw new CadUiError('UI_CAPABILITY_DISABLED', 'application.navigate target is not advertised.');
      break;
    case 'inspection.run':
      if (!['properties', 'measurements', 'clearance', 'interference'].includes(action.inspectionId)) {
        throw new CadUiError('UI_CAPABILITY_DISABLED', 'inspection.run target is not advertised.');
      }
      break;
    case 'sketch.setTool':
      if (!['line', 'rect', 'circle', 'poly', 'select', 'pan'].includes(action.toolId)) {
        throw new CadUiError('UI_CAPABILITY_DISABLED', 'sketch.setTool target is not advertised.');
      }
      break;
    case 'sketch.shape.select':
    case 'sketch.shape.delete':
      if (!Number.isInteger(action.shapeIndex) || action.shapeIndex < 0 || action.shapeIndex > 10_000) {
        throw new CadUiError('COMMAND_FIELD_INVALID', `${action.kind} requires a bounded shapeIndex.`);
      }
      break;
    case 'sketch.shape.update':
      if (!Number.isInteger(action.shapeIndex) || action.shapeIndex < 0 || action.shapeIndex > 10_000) {
        throw new CadUiError('COMMAND_FIELD_INVALID', 'sketch.shape.update requires a bounded shapeIndex.');
      }
      if (!['w', 'h', 'x', 'y', 'd'].includes(action.property)) {
        throw new CadUiError('COMMAND_FIELD_INVALID', 'sketch.shape.update requires an advertised dimension property.');
      }
      if (!(
        (typeof action.value === 'number' && Number.isFinite(action.value)) ||
        (typeof action.value === 'string' && action.value.trim() && action.value.length <= 20_000)
      )) {
        throw new CadUiError('COMMAND_FIELD_INVALID', 'sketch.shape.update requires a finite number or bounded expression.');
      }
      break;
    case 'viewport.setNavigationMode':
      if (!['orbit', 'pan'].includes(action.navigationMode)) {
        throw new CadUiError('UI_CAPABILITY_DISABLED', 'viewport.setNavigationMode target is not advertised.');
      }
      break;
    case 'command.advance':
      requireBoundedId(action.controlId, 'command.advance');
      break;
    case 'tree.invoke':
      requireEntityRef(action.entity);
      requireBoundedId(action.operation, 'tree.invoke');
      break;
    case 'parameter.invoke':
      requireBoundedId(action.parameterId, 'parameter.invoke');
      requireBoundedId(action.operation, 'parameter.invoke');
      break;
    case 'inspector.invoke':
      requireBoundedId(action.operation, 'inspector.invoke');
      break;
    case 'diagnostics.show':
      if (action.diagnosticId !== undefined) requireBoundedId(action.diagnosticId, 'diagnostics.show');
      break;
    case 'command.open':
      requireBoundedId(action.commandId, 'command.open');
      if (cadUiCommandDefinition(action.commandId)?.adapter !== 'available') {
        throw new CadUiError('COMMAND_NOT_AVAILABLE', `Command "${action.commandId}" is not advertised.`);
      }
      break;
    case 'command.bindSelection':
      requireBoundedId(action.fieldId, 'command.bindSelection');
      if (!Array.isArray(action.entities) || action.entities.length > 100) {
        throw new CadUiError('COMMAND_FIELD_INVALID', 'Selection-backed fields require a bounded list of at most 100 stable semantic references.');
      }
      for (const entity of action.entities) requireSelectionRef(entity);
      break;
    case 'command.setInput':
      requireBoundedId(action.fieldId, 'command.setInput');
      requireBoundedCommandValue(action.value);
      break;
    case 'command.clearInput':
      requireBoundedId(action.fieldId, 'command.clearInput');
      break;
    case 'command.preview':
    case 'command.cancel':
    case 'preview.dismiss':
      break;
    case 'preview.present':
      requireBoundedId(action.previewId, 'preview.present');
      break;
    case 'presentation.focusAction':
      requireBoundedId(action.actionId, 'presentation.focusAction');
      break;
    case 'presentation.waitForSettled':
      if (action.correlationId !== undefined) requireBoundedId(action.correlationId, 'presentation.waitForSettled');
      break;
    case 'presentation.setMode':
      if (!PRESENTATION_MODES.includes(action.mode)) throw new CadUiError('UI_CAPABILITY_DISABLED', 'Unknown presentation mode.');
      break;
    case 'narration.setMode':
      if (!NARRATION_MODES.includes(action.mode)) throw new CadUiError('UI_CAPABILITY_DISABLED', 'Unknown narration mode.');
      break;
    default:
      break;
  }
}

function requirePermission(permissions, permission) {
  if (!permissions?.includes(permission)) {
    throw new CadUiError('PERMISSION_DENIED', `Permission "${permission}" is required.`);
  }
}

function scopesFromHostChange(kind, payload) {
  const scopes = new Set(Array.isArray(payload?.scopes) ? payload.scopes.filter((entry) => typeof entry === 'string') : []);
  const scopeKeys = {
    activeDocument: 'document',
    workspaceId: 'workspace',
    workspace: 'workspace',
    selection: 'selection',
    tree: 'tree',
    panels: 'panels',
    inspector: 'panels',
    viewport: 'viewport',
    activeCommand: 'command',
    command: 'command',
    preview: 'preview',
    presentation: 'presentation',
    narration: 'narration',
  };
  for (const key of Object.keys(payload || {})) if (scopeKeys[key]) scopes.add(scopeKeys[key]);
  if (kind === 'selection.changed') scopes.add('selection');
  if (kind === 'command.draftChanged') scopes.add('command');
  return scopes;
}

export class CadUiError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'CadUiError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function trustedNarrationTemplate(templateId, values = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new CadUiError('UI_CAPABILITY_DISABLED', 'Trusted narration template values must be a closed object.');
  }
  const keys = Object.keys(values);
  const fixed = (text, kind = 'evidence') => {
    if (keys.length) throw new CadUiError('UI_CAPABILITY_DISABLED', `Narration template "${templateId}" accepts no values.`);
    return {
      source: kind === 'attention' ? 'attention-template' : 'evidence-template',
      kind,
      text,
    };
  };
  const presentation = (text) => {
    if (keys.length) throw new CadUiError('UI_CAPABILITY_DISABLED', `Narration template "${templateId}" accepts no values.`);
    return { source: 'presentation-template', kind: 'action', text };
  };
  const boundedInteger = (key) => {
    if (keys.length !== 1 || keys[0] !== key || !Number.isInteger(values[key]) || values[key] < 0 || values[key] > 1_000_000) {
      throw new CadUiError('UI_CAPABILITY_DISABLED', `Narration template "${templateId}" requires one bounded ${key} integer.`);
    }
    return values[key];
  };
  switch (templateId) {
    case 'demo.turbofan.intro':
      return presentation('CAD Studio V6 — direct agent control, without mouse automation.');
    case 'demo.turbofan.empty':
      return presentation('Starting with an empty CAD Studio document.');
    case 'demo.turbofan.layout':
      return presentation('Defining the engine axis, dimensions, blade count, twist, and axial stations.');
    case 'demo.turbofan.nacelle-sections':
      return presentation('Creating three editable nacelle sections.');
    case 'demo.turbofan.nacelle-passage':
      return presentation('Lofting the nacelle and cutting the internal bypass passage.');
    case 'demo.turbofan.fan-sections':
      return presentation('Defining a twisted fan blade across root, middle, and tip sections.');
    case 'demo.turbofan.fan-blade':
      return presentation('Creating one editable fan blade.');
    case 'demo.turbofan.fan-rotor':
      return presentation('Building the spinner, fan disk, and nested fan-rotor assembly.');
    case 'demo.turbofan.fan-pattern': {
      const bladeCount = boundedInteger('bladeCount');
      if (bladeCount < 1) {
        throw new CadUiError('UI_CAPABILITY_DISABLED', 'Narration template "demo.turbofan.fan-pattern" requires a positive bladeCount integer.');
      }
      return {
        source: 'presentation-template',
        kind: 'action',
        text: `Patterning the blade into a reusable ${bladeCount}-blade fan row.`,
      };
    }
    case 'demo.turbofan.core':
      return presentation('Constructing the bypass splitter and compressor stages.');
    case 'demo.turbofan.hot-section':
      return presentation('Adding concentric shafts, combustor, turbine stages, bearings, and nozzle.');
    case 'demo.turbofan.assemble':
      return presentation('Positioning the engine modules using datums and assembly constraints.');
    case 'demo.turbofan.assembly-ready':
      return presentation('The turbofan is now one editable assembly built through CAD operations.');
    case 'demo.turbofan.locate-clearance':
      return presentation('Locating the rear compressor stage and combustor before changing anything.');
    case 'demo.turbofan.targets-found':
      return presentation('Found both editable components in the assembly.');
    case 'demo.turbofan.prepare-move':
      return presentation('Preparing a constrained axial move. Concentric and angular alignment will remain unchanged.');
    case 'demo.turbofan.preview':
      return presentation('Previewing the exact constrained edit before committing it.');
    case 'demo.turbofan.section':
      return presentation('Inspecting the revised internal spacing in longitudinal section view.');
    case 'demo.turbofan.export-stage':
      return presentation('Exporting only the selected compressor stage.');
    case 'demo.turbofan.done':
      return presentation('Done. Geometry changed, validated, persisted, and exported.');
    case 'demo.turbofan.final':
      return presentation('Built and operated by the agent. No cursor replay.');
    case 'exact-geometry-confirmed':
      return fixed('Exact geometry evidence confirmed.');
    case 'revision-conflict':
      return fixed('The project changed. Refresh the command preview before applying it.', 'attention');
    case 'assembly-clearance': {
      if (
        keys.length !== 1 ||
        keys[0] !== 'minimumClearanceMm' ||
        typeof values.minimumClearanceMm !== 'number' ||
        !Number.isFinite(values.minimumClearanceMm) ||
        values.minimumClearanceMm < 0 ||
        values.minimumClearanceMm > 1_000_000
      ) {
        throw new CadUiError('UI_CAPABILITY_DISABLED', 'Narration template "assembly-clearance" requires one bounded minimumClearanceMm number.');
      }
      const clearance = Math.round(values.minimumClearanceMm * 1_000) / 1_000;
      return {
        source: 'evidence-template',
        kind: 'evidence',
        text: `Exact clearance measured: ${clearance} mm between the two selected bodies.`,
      };
    }
    case 'assembly-interference-clear':
      return fixed('No interference was detected between the two selected bodies.');
    case 'artifact-project':
      return fixed('Exported the canonical project artifact.');
    case 'artifact-step':
      return fixed('Exported the selected STEP artifact.');
    case 'artifact-stl':
      return fixed('Exported the selected STL artifact.');
    case 'artifact-png':
      return fixed('Rendered the model-only review image.');
    case 'geometry-health': {
      const bodyCount = boundedInteger('bodyCount');
      return { source: 'evidence-template', kind: 'evidence', text: `Geometry health confirmed for ${bodyCount} bodies.` };
    }
    case 'assembly-interference': {
      const bodyCount = boundedInteger('bodyCount');
      return { source: 'evidence-template', kind: 'evidence', text: `Interference inspection completed for ${bodyCount} bodies.` };
    }
    case 'commit-applied': {
      const revision = boundedInteger('revision');
      return { source: 'evidence-template', kind: 'evidence', text: `Applied the exact preview at revision ${revision}.` };
    }
    default:
      throw new CadUiError('UI_CAPABILITY_DISABLED', 'Only closed Studio-owned narration templates may be presented.');
  }
}

export function cadUiCapabilityManifest({ studioVersion = CAD_UI_RUNTIME_VERSION } = {}) {
  const available = new Map(releasedActionCapabilities.map((entry) => [entry.id, entry]));
  const disabledPermission = (id) => id.startsWith('selection.') || id === 'inspector.showEntity'
    ? 'ui.select'
    : id.startsWith('command.')
      ? 'ui.command-draft'
      : id.startsWith('preview.')
        ? 'ui.present-preview'
        : id.startsWith('presentation.')
          ? 'ui.present-demo'
          : 'ui.navigate';
  const manifest = {
    profile: CAD_UI_PROFILE,
    studioVersion,
    documentProtocol: 'bomwiki.cad.agent/v1',
    workspaces: ['home', 'sketch', 'solid', 'assembly', 'view', 'manage', 'output'].map((id) => ({
      id,
      state: id === 'sketch' ? 'contextual' : 'available',
      ...(id === 'sketch' ? { contextualReasonCode: 'AVAILABLE_WHILE_EDITING_SKETCH' } : {}),
    })),
    controls: cadUiControlRegistry().map((entry) => ({
      ...entry,
      state: entry.adapter === 'available' ? 'available' : entry.adapter === 'contextual' ? 'contextual' : 'disabled',
      ...(entry.adapter === 'missing' ? { disabledReasonCode: 'MISSING_SEMANTIC_ADAPTER' } : {}),
      ...(entry.adapter === 'contextual' ? { contextualReasonCode: entry.contextualReasonCode } : {}),
    })),
    commands: CAD_UI_COMMAND_REGISTRY.map((entry) => ({
      id: entry.id,
      label: entry.label,
      workspaceId: entry.workspaceId,
      operationKinds: [...entry.operationKinds],
      fields: clone(entry.fields),
      state: entry.adapter === 'available' ? 'available' : 'disabled',
      ...(entry.adapter === 'missing' ? { disabledReasonCode: 'MISSING_SEMANTIC_ADAPTER' } : {}),
    })),
    fullUiParity: cadUiFullParityReport(),
    panels: [
      { id: 'model-tree', state: 'available' },
      { id: 'inspector', state: 'available' },
      { id: 'project', state: 'available' },
      { id: 'history', state: 'available' },
      { id: 'diagnostics', state: 'available' },
    ],
    selectionKinds: ['body', 'occurrence', 'feature'],
    subshapeSelection: ['face', 'edge', 'vertex'],
    views: ['top', 'front', 'right', 'iso'].map((id) => ({ id, state: 'available' })),
    displayModes: ['shaded', 'shaded-edges', 'wireframe', 'hidden-line', 'ghost'].map((id) => ({ id, state: 'available' })),
    actions: CAD_UI_ACTION_KINDS.map((id) => {
      const capability = available.get(id);
      if (capability) {
        const { narration: _narration, ...entry } = capability;
        return { ...entry, state: 'available', inputSchema: clone(ACTION_INPUT_SCHEMAS[id]) };
      }
      return {
        id,
        permission: disabledPermission(id),
        description: 'Reserved by the V6 semantic UI profile; not released in the current runtime.',
        state: 'disabled',
        disabledReasonCode: 'NOT_RELEASED_IN_CURRENT_SLICE',
        inputSchema: clone(ACTION_INPUT_SCHEMAS[id]),
      };
    }),
    events: [...CAD_UI_EVENT_KINDS],
    eventCapabilities: CAD_UI_EVENT_KINDS.map((id) => EMITTED_EVENT_KINDS.has(id)
      ? { id, state: 'available' }
      : { id, state: 'disabled', disabledReasonCode: 'NOT_EMITTED_IN_CURRENT_SLICE' }),
    presentationModes: [...PRESENTATION_MODES],
    narrationModes: [...NARRATION_MODES],
    trustedNarrationTemplates: CAD_UI_AGENT_NARRATION_TEMPLATES.map((entry) => clone(entry)),
    presentationStates: [...PRESENTATION_STATES],
    transitionCapabilities: [
      { id: 'cut', state: 'available' },
      { id: 'animate', state: 'available' },
    ],
    limits: {
      maxActionsPerBatch: MAX_ACTIONS,
      maxBufferedEvents: MAX_EVENTS,
      maxEventWaitMs: MAX_WAIT_MS,
      maxMinimumVisibleMs: MAX_VISIBLE_MS,
      maxSettlementMs: MAX_SETTLEMENT_MS,
      maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
      maxEventPayloadBytes: MAX_EVENT_PAYLOAD_BYTES,
    },
  };
  return { ...manifest, manifestHash: fnv1a32(manifest) };
}

function invalidUiCapabilityQuery(message) {
  throw new CadUiError('INVALID_CAPABILITY_QUERY', message);
}

function boundedUiCapabilityIds(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some((entry) => typeof entry !== 'string' || !entry || entry.length > 200)) {
    invalidUiCapabilityQuery(`${name} must be a bounded list of at most 20 stable capability IDs.`);
  }
  return [...new Set(value)];
}

function compactUiControl(entry) {
  return {
    id: entry.id,
    label: entry.label,
    group: entry.group,
    kind: entry.kind,
    state: entry.state,
    ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {}),
    ...(entry.semanticAction ? { semanticAction: entry.semanticAction } : {}),
    ...(entry.permission ? { permission: entry.permission } : {}),
    ...(entry.commandId ? { commandId: entry.commandId } : {}),
    ...(entry.fieldId ? { fieldId: entry.fieldId } : {}),
    ...(entry.operationKinds?.length ? { operationKinds: [...entry.operationKinds] } : {}),
    ...(entry.contextualReasonCode ? { contextualReasonCode: entry.contextualReasonCode } : {}),
    ...(entry.disabledReasonCode ? { disabledReasonCode: entry.disabledReasonCode } : {}),
  };
}

function compactUiCommand(entry) {
  return {
    id: entry.id,
    label: entry.label,
    workspaceId: entry.workspaceId,
    operationKinds: [...entry.operationKinds],
    fieldIds: entry.fields.map((field) => field.id),
    state: entry.state,
    ...(entry.disabledReasonCode ? { disabledReasonCode: entry.disabledReasonCode } : {}),
  };
}

function compactUiAction(entry) {
  const { inputSchema: _inputSchema, ...summary } = entry;
  return summary;
}

export function selectCadUiCapabilities(manifest, query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    invalidUiCapabilityQuery('UI capability discovery requires an object.');
  }
  const allowed = new Set(['detail', 'controlIds', 'commandIds', 'actionIds']);
  const unknown = Object.keys(query).filter((key) => !allowed.has(key));
  if (unknown.length) invalidUiCapabilityQuery(`Unknown UI capability discovery fields: ${unknown.join(', ')}.`);
  const detail = query.detail || 'summary';
  if (!['summary', 'catalog', 'schemas', 'full'].includes(detail)) {
    invalidUiCapabilityQuery('UI capability detail must be summary, catalog, schemas, or full.');
  }
  const controlIds = boundedUiCapabilityIds(query.controlIds, 'controlIds');
  const commandIds = boundedUiCapabilityIds(query.commandIds, 'commandIds');
  const actionIds = boundedUiCapabilityIds(query.actionIds, 'actionIds');
  const controlById = new Map(manifest.controls.map((entry) => [entry.id, entry]));
  const commandById = new Map(manifest.commands.map((entry) => [entry.id, entry]));
  const actionById = new Map(manifest.actions.map((entry) => [entry.id, entry]));
  const missing = [
    ...controlIds.filter((id) => !controlById.has(id)),
    ...commandIds.filter((id) => !commandById.has(id)),
    ...actionIds.filter((id) => !actionById.has(id)),
  ];
  if (missing.length) invalidUiCapabilityQuery(`Unknown UI capability IDs: ${missing.join(', ')}.`);
  if (detail === 'schemas' && !controlIds.length && !commandIds.length && !actionIds.length) {
    invalidUiCapabilityQuery('UI schema discovery requires at least one controlIds, commandIds, or actionIds entry.');
  }
  const groupCounts = Object.entries(manifest.controls.reduce((counts, entry) => {
    counts[entry.group] = (counts[entry.group] || 0) + 1;
    return counts;
  }, {})).map(([id, count]) => ({ id, count }));
  const common = {
    ...manifest,
    uiCapabilityDiscovery: {
      detail,
      controlCount: manifest.controls.length,
      commandCount: manifest.commands.length,
      commandFieldCount: manifest.commands.reduce((count, command) => count + command.fields.length, 0),
      actionCount: manifest.actions.length,
      schemaBatchLimit: 20,
      supportedDetails: ['summary', 'catalog', 'schemas', 'full'],
      controlGroups: groupCounts,
      instructions: detail === 'summary'
        ? 'Use catalog only when discovering an unknown control. Request schemas for only the controls, commands, or actions needed for the current task.'
        : 'The full manifestHash remains authoritative across discovery detail levels.',
    },
  };
  if (detail === 'full') return clone(common);
  if (detail === 'schemas') {
    return clone({
      ...common,
      controls: controlIds.map((id) => controlById.get(id)),
      commands: commandIds.map((id) => commandById.get(id)),
      actions: actionIds.map((id) => actionById.get(id)),
    });
  }
  return clone({
    ...common,
    controls: detail === 'catalog' ? manifest.controls.map(compactUiControl) : [],
    commands: manifest.commands.map(compactUiCommand),
    actions: manifest.actions.map(compactUiAction),
  });
}

export class CadStudioInteractionRuntime {
  constructor({
    projectId,
    documentRevision = () => 0,
    studioVersion = CAD_UI_RUNTIME_VERSION,
    adapter,
    now = () => Date.now(),
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }) {
    if (typeof projectId !== 'function' || typeof documentRevision !== 'function') {
      throw new TypeError('projectId and documentRevision must be live state readers.');
    }
    if (
      !adapter ||
      typeof adapter.snapshot !== 'function' ||
      typeof adapter.applyAction !== 'function' ||
      typeof adapter.restoreSnapshot !== 'function' ||
      typeof adapter.waitForSettled !== 'function'
    ) {
      throw new TypeError('A Studio interaction adapter with snapshot, apply, rollback, and renderer settlement is required.');
    }
    this.projectId = projectId;
    this.documentRevision = documentRevision;
    this.adapter = adapter;
    this.now = now;
    this.delay = delay;
    this.manifest = cadUiCapabilityManifest({ studioVersion });
    this.uiRevision = 0;
    this.cursor = 0;
    this.eventsBuffer = [];
    this.waiters = new Set();
    this.presentationMode = 'normal';
    this.presentationState = 'idle';
    this.activeAction = null;
    this.narrationMode = 'concise';
    this.applyReserved = false;
    this.narrationReserved = false;
    this.applyInProgress = false;
    this.hostIntervened = false;
    this.hostTouchedScopes = new Set();
    this.interruptVersion = 0;
    this.interruptReason = null;
    this.interruptWaiters = new Set();
  }

  capabilities(query = {}) {
    return selectCadUiCapabilities(this.manifest, query);
  }

  interrupt(code = 'SESSION_PAUSED', message = 'The semantic UI action was interrupted.') {
    this.interruptVersion++;
    this.interruptReason = { code, message };
    this.adapter.interrupt?.({ code, message, interruptVersion: this.interruptVersion });
    for (const reject of this.interruptWaiters) reject();
    this.interruptWaiters.clear();
  }

  throwIfInterrupted(version) {
    if (version === this.interruptVersion) return;
    const reason = this.interruptReason || {};
    throw new CadUiError(reason.code || 'SESSION_PAUSED', reason.message || 'The semantic UI action was interrupted.', {
      repairOptions: [{ kind: 'refresh-ui-state' }],
    });
  }

  async delayUntilVisible(ms, interruptVersion) {
    if (!ms) return;
    await new Promise((resolve, reject) => {
      const stop = () => {
        this.interruptWaiters.delete(stop);
        reject(new CadUiError(
          this.interruptReason?.code || 'SESSION_PAUSED',
          this.interruptReason?.message || 'The visible presentation hold was interrupted.',
          { repairOptions: [{ kind: 'refresh-ui-state' }] },
        ));
      };
      this.interruptWaiters.add(stop);
      this.delay(ms).then(() => {
        this.interruptWaiters.delete(stop);
        resolve();
      }, (error) => {
        this.interruptWaiters.delete(stop);
        reject(error);
      });
    });
    this.throwIfInterrupted(interruptVersion);
  }

  snapshot() {
    const snapshot = {
      ...clone(this.adapter.snapshot()),
      profile: CAD_UI_PROFILE,
      projectId: this.projectId(),
      documentRevision: this.documentRevision(),
      uiRevision: this.uiRevision,
      presentation: {
        mode: this.presentationMode,
        state: this.presentationState,
        ...(this.activeAction ? {
          activeActionId: this.activeAction.id,
          activeActionLabel: this.activeAction.label,
        } : {}),
      },
      narration: { mode: this.narrationMode },
    };
    const bytes = encodedBytes(snapshot, 'UI_SNAPSHOT_INVALID');
    if (bytes > MAX_SNAPSHOT_BYTES) {
      throw new CadUiError('UI_SNAPSHOT_TOO_LARGE', 'The semantic UI snapshot exceeds the advertised 512 KiB limit.', {
        bytes,
        maxBytes: MAX_SNAPSHOT_BYTES,
      });
    }
    return snapshot;
  }

  emit(kind, payload = {}, { correlationId = null, actor = 'agent', uiRevision = this.uiRevision } = {}) {
    if (!CAD_UI_EVENT_KINDS.includes(kind)) {
      throw new CadUiError('UI_CAPABILITY_DISABLED', `UI event "${kind}" is outside the negotiated event union.`);
    }
    const boundedPayload = clone(payload);
    const bytes = encodedBytes(boundedPayload, 'EVENT_PAYLOAD_INVALID');
    if (bytes > MAX_EVENT_PAYLOAD_BYTES) {
      throw new CadUiError('EVENT_PAYLOAD_TOO_LARGE', 'The semantic UI event payload exceeds the advertised limit.', {
        kind,
        bytes,
        maxBytes: MAX_EVENT_PAYLOAD_BYTES,
      });
    }
    const event = {
      cursor: ++this.cursor,
      kind,
      projectId: this.projectId(),
      documentRevision: this.documentRevision(),
      uiRevision,
      actor,
      correlationId,
      timestamp: new Date(this.now()).toISOString(),
      payload: boundedPayload,
    };
    this.eventsBuffer.push(event);
    if (this.eventsBuffer.length > MAX_EVENTS) this.eventsBuffer.splice(0, this.eventsBuffer.length - MAX_EVENTS);
    for (const wake of this.waiters) wake();
    this.waiters.clear();
    return event;
  }

  async events({ afterCursor = 0, kinds, limit = 100, waitMs = 0 } = {}) {
    if (!Number.isInteger(afterCursor) || afterCursor < 0) {
      throw new CadUiError('EVENT_CURSOR_EXPIRED', 'afterCursor must be a non-negative integer.');
    }
    if (Array.isArray(kinds)) {
      const unknownKinds = kinds.filter((kind) => !CAD_UI_EVENT_KINDS.includes(kind));
      if (unknownKinds.length) {
        throw new CadUiError('UI_CAPABILITY_DISABLED', 'The event filter contains unadvertised kinds.', { unknownKinds });
      }
    }
    const earliest = this.eventsBuffer[0]?.cursor ?? this.cursor + 1;
    if (afterCursor && afterCursor < earliest - 1) {
      throw new CadUiError('EVENT_CURSOR_EXPIRED', 'The requested event cursor is no longer buffered.', { earliestCursor: earliest });
    }
    const allowedKinds = Array.isArray(kinds) && kinds.length ? new Set(kinds) : null;
    const boundedLimit = Math.max(1, Math.min(500, integer(limit, 100)));
    const select = () => this.eventsBuffer
      .filter((event) => event.cursor > afterCursor && (!allowedKinds || allowedKinds.has(event.kind)))
      .slice(0, boundedLimit);
    let selected = select();
    const boundedWait = Math.max(0, Math.min(MAX_WAIT_MS, integer(waitMs, 0)));
    const deadline = Date.now() + boundedWait;
    while (!selected.length && boundedWait && Date.now() < deadline) {
      await new Promise((resolve) => {
        let complete = false;
        const done = () => {
          if (complete) return;
          complete = true;
          clearTimeout(timer);
          this.waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, Math.max(0, deadline - Date.now()));
        this.waiters.add(done);
      });
      selected = select();
    }
    return {
      afterCursor,
      cursor: selected.at(-1)?.cursor ?? afterCursor,
      latestCursor: this.cursor,
      events: clone(selected),
    };
  }

  hostChanged(kind, payload = {}, { actor = 'human', correlationId = null } = {}) {
    this.uiRevision++;
    if (this.applyInProgress) {
      this.hostIntervened = true;
      for (const scope of scopesFromHostChange(kind, payload)) this.hostTouchedScopes.add(scope);
    }
    const snapshot = this.snapshot();
    if (kind && kind !== 'ui.changed') {
      this.emit(kind, { ...clone(payload), snapshot }, { actor, correlationId, uiRevision: this.uiRevision });
    }
    if (this.applyInProgress && actor === 'human') {
      this.emit('human.attentionRequired', {
        reason: 'human-intervention',
        scopes: [...this.hostTouchedScopes].sort(),
      }, { actor, correlationId, uiRevision: this.uiRevision });
    }
    this.emit('ui.changed', { source: 'host', ...clone(payload), snapshot }, {
      actor,
      correlationId,
      uiRevision: this.uiRevision,
    });
    return snapshot;
  }

  async presentTrustedNarration({
    templateId,
    values,
    correlationId = null,
    actor = 'agent',
  } = {}) {
    const { source, kind, text } = trustedNarrationTemplate(templateId, values);
    if (this.narrationMode === 'off') return { presented: false, reason: 'narration-off' };
    if (this.applyReserved || this.narrationReserved) {
      throw new CadUiError('UI_REVISION_CONFLICT', 'Trusted evidence narration cannot overlap a semantic UI action batch.', {
        actualUiRevision: this.uiRevision,
        repairOptions: [{ kind: 'wait-for-settlement' }],
      });
    }
    const interruptVersion = this.interruptVersion;
    const cue = {
      cueId: `cue-${this.cursor + 1}`,
      correlationId: typeof correlationId === 'string' && correlationId ? correlationId : `evidence-${this.cursor + 1}`,
      kind,
      text: text.trim(),
      source,
      documentRevision: this.documentRevision(),
      uiRevision: this.uiRevision,
      state: 'visible',
    };
    this.narrationReserved = true;
    try {
      this.presentationState = this.presentationMode === 'recording' ? 'holding' : 'waiting';
      this.adapter.showNarration?.(clone(cue));
      this.emit('narration.cueStarted', { cue: clone(cue) }, {
        correlationId: cue.correlationId,
        actor,
        uiRevision: this.uiRevision,
      });
      await this.delayUntilVisible(this.presentationMode === 'recording' ? 800 : 0, interruptVersion);
      const completedCue = { ...cue, state: 'completed' };
      this.emit('narration.cueCompleted', { cue: clone(completedCue) }, {
        correlationId: cue.correlationId,
        actor,
        uiRevision: this.uiRevision,
      });
      this.adapter.completeNarration?.(clone(completedCue), { persist: this.presentationMode !== 'instant' });
      return { presented: true, cue: completedCue };
    } catch (error) {
      this.adapter.completeNarration?.({ ...cue, state: 'cancelled' }, { persist: false });
      throw error;
    } finally {
      this.presentationState = 'idle';
      this.narrationReserved = false;
    }
  }

  interventionError() {
    return new CadUiError('UI_REVISION_CONFLICT', 'A human changed Studio while the UI action batch was being presented.', {
      actualUiRevision: this.uiRevision,
      humanScopes: [...this.hostTouchedScopes].sort(),
      repairOptions: [{ kind: 'refresh-ui-state' }],
    });
  }

  async apply(request = {}, context = {}) {
    if (this.applyReserved || this.narrationReserved) {
      throw new CadUiError('UI_REVISION_CONFLICT', 'Another semantic UI action batch is already in progress.', {
        actualUiRevision: this.uiRevision,
        repairOptions: [{ kind: 'wait-for-settlement' }, { kind: 'refresh-ui-state' }],
      });
    }
    this.applyReserved = true;
    try {
      return await this.applyReservedBatch(request, context);
    } finally {
      this.applyReserved = false;
    }
  }

  async applyReservedBatch({ expectedUiRevision, actions, correlationId, presentation } = {}, { permissions = [] } = {}) {
    const batchInterruptVersion = this.interruptVersion;
    if (!Number.isInteger(expectedUiRevision) || expectedUiRevision !== this.uiRevision) {
      throw new CadUiError('UI_REVISION_CONFLICT', 'The Studio interaction state changed before this UI action batch.', {
        expectedUiRevision,
        actualUiRevision: this.uiRevision,
        repairOptions: [{ kind: 'refresh-ui-state' }],
      });
    }
    if (!Array.isArray(actions) || actions.length < 1 || actions.length > MAX_ACTIONS) {
      throw new CadUiError('UI_CAPABILITY_DISABLED', `UI action batches require between 1 and ${MAX_ACTIONS} actions.`);
    }
    if (actions.some((action) => TERMINAL_PROJECT_ACTIONS.has(action?.kind)) && actions.length !== 1) {
      throw new CadUiError(
        'UI_CAPABILITY_DISABLED',
        'A project-boundary transition must be the only action in its semantic batch.',
        { repairOptions: [{ kind: 'run-project-transition-separately' }] },
      );
    }
    if (presentation?.transition && !['cut', 'animate'].includes(presentation.transition)) {
      throw new CadUiError('UI_CAPABILITY_DISABLED', 'The requested semantic transition is not advertised.', {
        transition: presentation.transition,
      });
    }

    const prepared = [];
    for (const rawAction of actions) {
      const action = clone(rawAction);
      validateActionShape(action);
      const capability = releasedActionById.get(action.kind);
      if (!capability) {
        throw new CadUiError('UI_CAPABILITY_DISABLED', `UI action "${action.kind}" is defined by the profile but disabled in this runtime slice.`, {
          actionKind: action.kind,
          disabledReasonCode: 'NOT_RELEASED_IN_CURRENT_SLICE',
        });
      }
      requirePermission(permissions, capability.permission);
      await this.adapter.validateAction?.(action);
      this.throwIfInterrupted(batchInterruptVersion);
      prepared.push({ action, capability });
    }
    if (expectedUiRevision !== this.uiRevision) {
      throw new CadUiError('UI_REVISION_CONFLICT', 'Studio changed while the semantic UI action batch was being validated.', {
        expectedUiRevision,
        actualUiRevision: this.uiRevision,
        repairOptions: [{ kind: 'refresh-ui-state' }],
      });
    }

    const batchCorrelationId = typeof correlationId === 'string' && correlationId
      ? correlationId
      : `ui-${this.uiRevision + 1}-${this.cursor + 1}`;
    const batchMode = PRESENTATION_MODES.includes(presentation?.mode) ? presentation.mode : this.presentationMode;
    const minimumVisibleMs = Math.max(
      0,
      Math.min(MAX_VISIBLE_MS, integer(presentation?.minimumVisibleMs, batchMode === 'recording' ? 800 : 0)),
    );
    const nextUiRevision = this.uiRevision + 1;
    const results = [];
    const baseAdapterSnapshot = clone(this.adapter.snapshot());
    const basePresentationMode = this.presentationMode;
    const baseNarrationMode = this.narrationMode;
    const appliedScopes = new Set();
    let activeCue = null;
    this.applyInProgress = true;
    this.hostIntervened = false;
    this.hostTouchedScopes.clear();
    try {
      for (const { action, capability } of prepared) {
        this.presentationState = 'transitioning';
        this.activeAction = { id: action.kind, label: capability.narration(action) || action.kind };
        this.emit('presentation.stepStarted', { action: clone(action), mode: batchMode }, {
          correlationId: batchCorrelationId,
          uiRevision: this.uiRevision,
        });
        const narrationText = capability.narration(action);
        const shouldNarrate = this.narrationMode !== 'off' && narrationText;
        activeCue = shouldNarrate
          ? {
              cueId: `cue-${this.cursor + 1}`,
              correlationId: batchCorrelationId,
              kind: 'action',
              text: narrationText,
              source: 'capability-template',
              documentRevision: this.documentRevision(),
              uiRevision: nextUiRevision,
              state: 'visible',
            }
          : null;
        if (activeCue) {
          this.adapter.showNarration?.(clone(activeCue));
          this.emit('narration.cueStarted', { cue: clone(activeCue) }, {
            correlationId: batchCorrelationId,
            uiRevision: nextUiRevision,
          });
        }

        for (const scope of actionScopes.get(action.kind) || []) appliedScopes.add(scope);
        const result = await this.adapter.applyAction(action, {
          mode: batchMode,
          transition: presentation?.transition || 'cut',
          correlationId: batchCorrelationId,
          targetUiRevision: nextUiRevision,
        });
        this.throwIfInterrupted(batchInterruptVersion);
        results.push({ kind: action.kind, result: clone(result) });
        if (action.kind === 'presentation.setMode') this.presentationMode = action.mode;
        if (action.kind === 'narration.setMode') this.narrationMode = action.mode;
        if (this.hostIntervened) throw this.interventionError();

        this.presentationState = 'waiting';
        const settlement = await this.adapter.waitForSettled(action, {
          mode: batchMode,
          correlationId: batchCorrelationId,
          targetUiRevision: nextUiRevision,
          timeoutMs: MAX_SETTLEMENT_MS,
        });
        this.throwIfInterrupted(batchInterruptVersion);
        if (this.hostIntervened) throw this.interventionError();
        this.emit('render.completed', { actionKind: action.kind, settlement: clone(settlement) }, {
          correlationId: batchCorrelationId,
          uiRevision: nextUiRevision,
        });

        if (minimumVisibleMs) {
          this.presentationState = 'holding';
          await this.delayUntilVisible(minimumVisibleMs, batchInterruptVersion);
        }
        if (this.hostIntervened) throw this.interventionError();

        this.emit('presentation.stepSettled', {
          action: clone(action),
          mode: batchMode,
          result: clone(result),
          settlement: clone(settlement),
        }, {
          correlationId: batchCorrelationId,
          uiRevision: nextUiRevision,
        });
        if (activeCue) {
          const completedCue = { ...activeCue, state: 'completed' };
          this.emit('narration.cueCompleted', { cue: completedCue }, {
            correlationId: batchCorrelationId,
            uiRevision: nextUiRevision,
          });
          this.adapter.completeNarration?.(clone(completedCue), { persist: batchMode !== 'instant' });
          activeCue = null;
        }
      }

      this.uiRevision = nextUiRevision;
      this.presentationState = 'idle';
      this.activeAction = null;
      const snapshot = this.snapshot();
      this.emit('ui.changed', { actions: prepared.map(({ action }) => clone(action)), snapshot }, {
        correlationId: batchCorrelationId,
        uiRevision: this.uiRevision,
      });
      if (prepared.some(({ action }) => action.kind.startsWith('selection.'))) {
        this.emit('selection.changed', { selection: snapshot.selection }, {
          correlationId: batchCorrelationId,
          uiRevision: this.uiRevision,
        });
      }
      return { correlationId: batchCorrelationId, uiRevision: this.uiRevision, results, snapshot };
    } catch (error) {
      const rollbackScopes = [...appliedScopes].filter((scope) => !this.hostTouchedScopes.has(scope));
      if (rollbackScopes.includes('presentation')) this.presentationMode = basePresentationMode;
      if (rollbackScopes.includes('narration')) this.narrationMode = baseNarrationMode;
      let rollbackError = null;
      try {
        await this.adapter.restoreSnapshot(baseAdapterSnapshot, {
          scopes: rollbackScopes,
          preserveScopes: [...this.hostTouchedScopes],
          reason: this.hostIntervened ? 'human-intervention' : 'action-failure',
        });
        if (rollbackScopes.length) {
          await this.adapter.waitForSettled({ kind: 'rollback' }, {
            mode: 'instant',
            correlationId: batchCorrelationId,
            targetUiRevision: this.uiRevision,
            timeoutMs: MAX_SETTLEMENT_MS,
          });
        }
      } catch (reason) {
        rollbackError = String(reason?.message || reason);
      }
      if (activeCue) {
        const cancelledCue = { ...activeCue, state: 'cancelled' };
        this.adapter.completeNarration?.(clone(cancelledCue), { persist: false });
        activeCue = null;
      }
      this.presentationState = 'idle';
      this.activeAction = null;
      if (error instanceof CadUiError) {
        error.details = {
          ...(error.details || {}),
          rollback: {
            restoredScopes: rollbackScopes,
            preservedHumanScopes: [...this.hostTouchedScopes].sort(),
            ...(rollbackError ? { error: rollbackError } : {}),
          },
        };
        throw error;
      }
      throw new CadUiError('UI_ACTION_FAILED', 'Studio restored the semantic UI batch after an action failed.', {
        cause: String(error?.message || error),
        rollback: {
          restoredScopes: rollbackScopes,
          preservedHumanScopes: [...this.hostTouchedScopes].sort(),
          ...(rollbackError ? { error: rollbackError } : {}),
        },
      });
    } finally {
      this.applyInProgress = false;
      this.hostIntervened = false;
      this.hostTouchedScopes.clear();
      this.presentationState = 'idle';
      this.activeAction = null;
    }
  }
}
