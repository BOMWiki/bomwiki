export const STUDIO_V5_SCHEMA_VERSION = 5 as const;

export type StudioV5Id = string;
export type StudioV5Expression = number | string;
export type StudioV5Units = 'mm' | 'in';

export type StudioV5DocumentRef =
  | { kind: 'part'; partId: StudioV5Id }
  | { kind: 'assembly'; assemblyId: StudioV5Id };

export type StudioV5FeatureResultPolicy =
  | { kind: 'new-body'; bodyName?: string }
  | { kind: 'add'; targetBodyIds: StudioV5Id[] }
  | { kind: 'subtract'; targetBodyIds: StudioV5Id[]; keepTools?: boolean }
  | { kind: 'intersect'; targetBodyIds: StudioV5Id[]; keepTools?: boolean }
  | { kind: 'surface'; bodyName?: string };

export interface StudioV5GeometryReference {
  ownerKind: 'part' | 'body' | 'feature' | 'occurrence';
  ownerId: StudioV5Id;
  semanticPath?: Record<string, unknown>;
  signature: Record<string, unknown>;
  occurrencePath?: StudioV5Id[];
}

export interface StudioV5ParameterDefinition {
  id: StudioV5Id;
  name: string;
  value: StudioV5Expression;
  description?: string;
  extensions?: Record<string, unknown>;
}

export interface StudioV5MaterialDefinition {
  id: StudioV5Id;
  name: string;
  densityKgM3?: number;
  description?: string;
  source?: string;
  appearanceId?: StudioV5Id;
  extensions?: Record<string, unknown>;
}

export interface StudioV5ReferenceGeometry {
  id: StudioV5Id;
  name: string;
  kind: 'plane' | 'axis' | 'point' | 'coordinate-system';
  suppressed: boolean;
  definition: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export interface StudioV5SketchDefinition {
  id: StudioV5Id;
  name: string;
  support?: StudioV5GeometryReference;
  entities: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
  constraints: Array<Record<string, unknown>>;
  extensions?: Record<string, unknown>;
}

export interface StudioV5PartFeature {
  id: StudioV5Id;
  name: string;
  type: string;
  suppressed: boolean;
  inputRefs: StudioV5GeometryReference[];
  resultPolicy: StudioV5FeatureResultPolicy;
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface StudioV5BodyDefinition {
  id: StudioV5Id;
  name: string;
  kind: 'solid' | 'surface';
  createdByFeatureId: StudioV5Id;
  featureIds: StudioV5Id[];
  visible: boolean;
  suppressed: boolean;
  appearanceId?: StudioV5Id;
  materialId?: StudioV5Id;
  extensions?: Record<string, unknown>;
}

export interface StudioV5PartDefinition {
  id: StudioV5Id;
  name: string;
  parameters: StudioV5ParameterDefinition[];
  referenceGeometry: StudioV5ReferenceGeometry[];
  sketches: StudioV5SketchDefinition[];
  bodies: StudioV5BodyDefinition[];
  features: StudioV5PartFeature[];
  featureOrder: StudioV5Id[];
  defaultAppearanceId?: StudioV5Id;
  metadata?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export type StudioV5Matrix4 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface StudioV5ComponentOccurrence {
  id: StudioV5Id;
  name: string;
  definition: StudioV5DocumentRef;
  parentOccurrenceId?: StudioV5Id;
  baseTransform: StudioV5Matrix4;
  fixed: boolean;
  suppressed: boolean;
  visible: boolean;
  appearanceOverrideId?: StudioV5Id;
  parameterOverrides?: Record<string, StudioV5Expression>;
  extensions?: Record<string, unknown>;
}

export interface StudioV5AssemblyMate {
  id: StudioV5Id;
  name: string;
  kind: 'fixed' | 'coincident' | 'concentric' | 'distance' | 'angle' | 'parallel' | 'perpendicular' | 'tangent' | 'revolute' | 'slider';
  occurrenceIds: StudioV5Id[];
  references: StudioV5GeometryReference[];
  value?: StudioV5Expression;
  suppressed: boolean;
  extensions?: Record<string, unknown>;
}

export interface StudioV5OccurrencePattern {
  id: StudioV5Id;
  name: string;
  kind: 'linear' | 'circular' | 'curve';
  sourceOccurrenceIds: StudioV5Id[];
  generatedCount: number;
  definition: Record<string, unknown>;
  suppressed: boolean;
  extensions?: Record<string, unknown>;
}

export interface StudioV5ExplodedView {
  id: StudioV5Id;
  name: string;
  steps: Array<Record<string, unknown>>;
  extensions?: Record<string, unknown>;
}

export interface StudioV5SectionView {
  id: StudioV5Id;
  name: string;
  kind: 'plane' | 'quarter' | 'box';
  definition: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export interface StudioV5AssemblyDefinition {
  id: StudioV5Id;
  name: string;
  parameters: StudioV5ParameterDefinition[];
  occurrences: StudioV5ComponentOccurrence[];
  mates: StudioV5AssemblyMate[];
  occurrencePatterns: StudioV5OccurrencePattern[];
  explodedViews: StudioV5ExplodedView[];
  sectionViews: StudioV5SectionView[];
  metadata?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export interface StudioV5ProjectResource {
  id: StudioV5Id;
  name: string;
  mimeType: string;
  byteLength: number;
  encoding?: 'base64';
  data?: string;
  extensions?: Record<string, unknown>;
}

export interface StudioV5ProjectMetadata {
  createdAt?: string;
  updatedAt?: string;
  migratedFromSchema?: number;
  description?: string;
  [key: string]: unknown;
}

export interface StudioV5Project {
  schemaVersion: typeof STUDIO_V5_SCHEMA_VERSION;
  projectId: StudioV5Id;
  name: string;
  units: StudioV5Units;
  parameters: StudioV5ParameterDefinition[];
  materials: StudioV5MaterialDefinition[];
  partDefinitions: StudioV5PartDefinition[];
  assemblyDefinitions: StudioV5AssemblyDefinition[];
  rootDocument: StudioV5DocumentRef;
  resources: StudioV5ProjectResource[];
  metadata: StudioV5ProjectMetadata;
  extensions?: Record<string, unknown>;
}

export const STUDIO_V5_IDENTITY_MATRIX: StudioV5Matrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];
