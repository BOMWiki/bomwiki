import type {
  StudioV5DocumentRef,
  StudioV5Matrix4,
  StudioV5Project,
  StudioV5Units,
} from '../src/studio-v5-types.js';

export const STUDIO_V5_SCHEMA_VERSION: 5;
export const STUDIO_V5_PROJECT_LIMITS: Readonly<{
  bytes: number;
  fileBytes: number;
  resourcesBytes: number;
  partDefinitions: number;
  assemblyDefinitions: number;
  occurrences: number;
  generatedOccurrences: number;
  featuresPerPart: number;
  sketchEntities: number;
  parameters: number;
  materials: number;
  resources: number;
  treeDepth: number;
}>;
export const STUDIO_V5_IDENTITY_MATRIX: Readonly<StudioV5Matrix4>;

export class StudioV5ProjectError extends Error {
  code: string;
  constructor(code: string, message: string);
}

export function prepareStudioV5Project(candidate: unknown): StudioV5Project;
export function parseStudioV5Project(text: string): StudioV5Project;
export function migrateStudioPartToV5(candidate: unknown, options?: { projectId?: string }): StudioV5Project;
export function parseOrMigrateStudioV5Project(text: string, options?: { projectId?: string }): StudioV5Project;
export function createEmptyStudioV5PartProject(options?: {
  projectId?: string;
  name?: string;
  units?: StudioV5Units;
}): StudioV5Project;
export function studioV5DocumentRefKey(ref: StudioV5DocumentRef): string;
