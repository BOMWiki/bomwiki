import { prepareStudioV5Project } from './studio-project-v5.js';
import { canonicalStudioV5Project, decorateStudioV5Project, studioV5RootAssembly } from './studio-v5-runtime-document.js';
import { studioV5IdentityMatrix, studioV5MultiplyMatrices, studioV5RotationMatrix, studioV5TranslationMatrix } from './studio-v5-assembly.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const finite = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(label + ' must be a finite number.');
  return number;
};
const vector = (value, label, fallback = [0, 0, 0]) => {
  const result = value == null ? [...fallback] : [...value].map((entry) => Number(entry));
  if (result.length !== 3 || !result.every(Number.isFinite)) throw new Error(label + ' must contain three finite numbers.');
  return result;
};
const normalize = (value, label) => {
  const result = vector(value, label);
  const magnitude = Math.hypot(...result);
  if (!(magnitude > 1e-12)) throw new Error(label + ' cannot have zero length.');
  return result.map((entry) => entry / magnitude);
};
const requireName = (value, label) => {
  const name = String(value || '').trim();
  if (!name) throw new Error(label + ' is required.');
  return name;
};

export const STUDIO_V5_GENERIC_MATERIALS = Object.freeze([
  ['steel', 'Generic steel', 7850, '#687785', 0.78, 0.34],
  ['stainless', 'Generic stainless steel', 8000, '#a9b3ba', 0.88, 0.24],
  ['aluminum', 'Generic aluminum', 2700, '#9aa9b5', 0.72, 0.38],
  ['titanium', 'Generic titanium', 4500, '#7d8791', 0.72, 0.42],
  ['polymer', 'Generic polymer', 1150, '#406d91', 0.05, 0.58],
  ['rubber', 'Generic rubber', 1100, '#252b30', 0.0, 0.9],
  ['glass', 'Generic glass', 2500, '#8fbfc9', 0.0, 0.08],
  ['ceramic', 'Generic ceramic', 3200, '#d6d0c2', 0.0, 0.66],
  ['carbon', 'Generic carbon composite', 1600, '#30383e', 0.18, 0.54],
].map(([slug, name, densityKgM3, baseColor, metallic, roughness]) => Object.freeze({
  id: 'material-generic-' + slug,
  name,
  densityKgM3,
  description: 'Generic editable engineering placeholder; verify the grade before relying on mass.',
  source: 'BOMwiki generic placeholder',
  appearanceId: 'appearance-generic-' + slug,
  extensions: { studioAppearance: { baseColor, metallic, roughness, opacity: slug === 'glass' ? 0.34 : 1, edgeColor: '#263746' } },
})));

function prepared(candidate) {
  return decorateStudioV5Project(prepareStudioV5Project(candidate));
}

export function ensureStudioV5GenericMaterials(project) {
  const candidate = canonicalStudioV5Project(project);
  const existing = new Set(candidate.materials.map((material) => material.id));
  for (const material of STUDIO_V5_GENERIC_MATERIALS) if (!existing.has(material.id)) candidate.materials.push(clone(material));
  return prepared(candidate);
}

export function studioV5AppearanceMap(project) {
  return new Map((project.materials || [])
    .filter((material) => material.appearanceId && material.extensions?.studioAppearance)
    .map((material) => [material.appearanceId, { id: material.appearanceId, name: material.name, ...clone(material.extensions.studioAppearance) }]));
}

export function assignStudioV5BodyMaterial(project, partId, bodyId, materialId) {
  const candidate = canonicalStudioV5Project(project);
  const part = candidate.partDefinitions.find((entry) => entry.id === partId);
  const body = part?.bodies.find((entry) => entry.id === bodyId);
  const material = candidate.materials.find((entry) => entry.id === materialId);
  if (!part || !body) throw new Error('The selected source body no longer exists.');
  if (!material) throw new Error('Choose an existing project material.');
  body.materialId = material.id;
  if (material.appearanceId) body.appearanceId = material.appearanceId;
  return prepared(candidate);
}

export function assignStudioV5OccurrenceAppearance(project, occurrenceId, appearanceId) {
  const candidate = canonicalStudioV5Project(project);
  const occurrence = candidate.assemblyDefinitions.flatMap((assembly) => assembly.occurrences).find((entry) => entry.id === occurrenceId);
  if (!occurrence) throw new Error('The selected component occurrence no longer exists.');
  if (!studioV5AppearanceMap(candidate).has(appearanceId)) throw new Error('Choose an existing project appearance.');
  occurrence.appearanceOverrideId = appearanceId;
  return prepared(candidate);
}

const containsOccurrence = (project, occurrenceId) => project.assemblyDefinitions.some((assembly) => assembly.occurrences.some((entry) => entry.id === occurrenceId));

function normalizedSection(project, input, existingId = null) {
  const kind = input.kind || 'plane';
  const planeCount = kind === 'plane' ? 1 : kind === 'quarter' ? 2 : kind === 'box' ? 3 : 0;
  if (!planeCount) throw new Error('Section kind must be plane, quarter, or box.');
  const sourcePlanes = input.definition?.planes || input.planes || [];
  if (sourcePlanes.length !== planeCount) throw new Error(kind + ' section requires exactly ' + planeCount + ' clipping plane' + (planeCount === 1 ? '' : 's') + '.');
  const occurrenceIds = [...new Set(input.definition?.scopeOccurrenceIds || input.scopeOccurrenceIds || [])];
  if (occurrenceIds.some((id) => !containsOccurrence(project, id))) throw new Error('Section scope contains a missing component occurrence.');
  return {
    id: existingId || input.id,
    name: requireName(input.name, 'Section name'),
    kind,
    definition: {
      planes: sourcePlanes.map((plane, index) => ({ normal: normalize(plane.normal, 'Section plane ' + (index + 1) + ' normal'), offset: finite(plane.offset ?? 0, 'Section plane offset') })),
      cap: (input.definition?.cap ?? input.cap) !== false,
      reverse: (input.definition?.reverse ?? input.reverse) === true,
      scopeOccurrenceIds: occurrenceIds,
    },
    extensions: { ...(input.extensions || {}), studioDisplayOnly: true },
  };
}

export function createStudioV5SectionView(project, input) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  if (assembly.sectionViews.some((entry) => entry.id === input.id)) throw new Error('Section view ID is already in use.');
  assembly.sectionViews.push(normalizedSection(candidate, input));
  assembly.metadata ||= {};
  assembly.metadata.activeSectionViewId = input.id;
  return prepared(candidate);
}

export function updateStudioV5SectionView(project, sectionId, patch) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  const index = assembly.sectionViews.findIndex((entry) => entry.id === sectionId);
  if (index < 0) throw new Error('That saved section no longer exists.');
  assembly.sectionViews[index] = normalizedSection(candidate, { ...assembly.sectionViews[index], ...patch, definition: { ...assembly.sectionViews[index].definition, ...(patch.definition || {}) } }, sectionId);
  return prepared(candidate);
}

export function activateStudioV5SectionView(project, sectionId = null) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  if (sectionId != null && !assembly.sectionViews.some((entry) => entry.id === sectionId)) throw new Error('That saved section no longer exists.');
  assembly.metadata ||= {};
  if (sectionId == null) delete assembly.metadata.activeSectionViewId;
  else assembly.metadata.activeSectionViewId = sectionId;
  return prepared(candidate);
}

export function deleteStudioV5SectionView(project, sectionId) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  if (!assembly.sectionViews.some((entry) => entry.id === sectionId)) throw new Error('That saved section no longer exists.');
  assembly.sectionViews = assembly.sectionViews.filter((entry) => entry.id !== sectionId);
  if (assembly.metadata?.activeSectionViewId === sectionId) delete assembly.metadata.activeSectionViewId;
  return prepared(candidate);
}

function stepMatrix(step) {
  if (step.deltaTransform) {
    if (step.deltaTransform.length !== 16 || !step.deltaTransform.every(Number.isFinite)) throw new Error('Exploded step transform must contain 16 finite values.');
    return [...step.deltaTransform];
  }
  const translation = studioV5TranslationMatrix(vector(step.translation, 'Exploded translation'));
  const angle = finite(step.rotationAngle ?? 0, 'Exploded rotation angle');
  const rotation = Math.abs(angle) > 1e-12 ? studioV5RotationMatrix(normalize(step.rotationAxis || [0, 0, 1], 'Exploded rotation axis'), angle) : studioV5IdentityMatrix();
  return studioV5MultiplyMatrices(translation, rotation);
}

function normalizedExploded(project, input, existingId = null) {
  const steps = (input.steps || []).map((step, index) => {
    const occurrenceIds = [...new Set(step.occurrenceIds || [])];
    if (!occurrenceIds.length || occurrenceIds.some((id) => !containsOccurrence(project, id))) throw new Error('Exploded step ' + (index + 1) + ' must target existing component occurrences.');
    return { occurrenceIds, deltaTransform: stepMatrix(step) };
  });
  if (!steps.length) throw new Error('Exploded view requires at least one step.');
  return { id: existingId || input.id, name: requireName(input.name, 'Exploded view name'), steps, extensions: { ...(input.extensions || {}), studioDisplayOnly: true } };
}

export function createStudioV5ExplodedView(project, input) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  if (assembly.explodedViews.some((entry) => entry.id === input.id)) throw new Error('Exploded view ID is already in use.');
  assembly.explodedViews.push(normalizedExploded(candidate, input));
  assembly.metadata ||= {};
  assembly.metadata.activeExplodedViewId = input.id;
  return prepared(candidate);
}

export function activateStudioV5ExplodedView(project, explodedViewId = null) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  if (explodedViewId != null && !assembly.explodedViews.some((entry) => entry.id === explodedViewId)) throw new Error('That exploded view no longer exists.');
  assembly.metadata ||= {};
  if (explodedViewId == null) delete assembly.metadata.activeExplodedViewId;
  else assembly.metadata.activeExplodedViewId = explodedViewId;
  return prepared(candidate);
}

export function deleteStudioV5ExplodedView(project, explodedViewId) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  if (!assembly.explodedViews.some((entry) => entry.id === explodedViewId)) throw new Error('That exploded view no longer exists.');
  assembly.explodedViews = assembly.explodedViews.filter((entry) => entry.id !== explodedViewId);
  if (assembly.metadata?.activeExplodedViewId === explodedViewId) delete assembly.metadata.activeExplodedViewId;
  return prepared(candidate);
}

export function studioV5ActiveExplodedTransforms(project) {
  if (project.rootDocument?.kind !== 'assembly') return new Map();
  const assembly = studioV5RootAssembly(project);
  const active = assembly.explodedViews.find((entry) => entry.id === assembly.metadata?.activeExplodedViewId);
  const transforms = new Map();
  if (!active) return transforms;
  for (const step of active.steps) for (const occurrenceId of step.occurrenceIds) {
    transforms.set(occurrenceId, studioV5MultiplyMatrices(step.deltaTransform, transforms.get(occurrenceId) || studioV5IdentityMatrix()));
  }
  return transforms;
}

function stageGroups(assembly) {
  assembly.metadata ||= {};
  assembly.metadata.axialStageGroups ||= [];
  return assembly.metadata.axialStageGroups;
}

function validateStageGroup(assembly, input, id) {
  const occurrenceIds = [...new Set(input.occurrenceIds || [])];
  const distanceMateIds = [...(input.distanceMateIds || [])];
  if (!occurrenceIds.length || occurrenceIds.length !== distanceMateIds.length) throw new Error('Axial stage group needs one Distance mate for every ordered occurrence.');
  for (let index = 0; index < occurrenceIds.length; index++) {
    if (!assembly.occurrences.some((entry) => entry.id === occurrenceIds[index])) throw new Error('Axial stage occurrence no longer exists.');
    const mate = assembly.mates.find((entry) => entry.id === distanceMateIds[index]);
    if (!mate || mate.kind !== 'distance' || !mate.occurrenceIds.includes(occurrenceIds[index])) throw new Error('Axial stage spacing must drive a Distance mate on each occurrence.');
  }
  return {
    id, name: requireName(input.name, 'Axial stage group name'), axis: normalize(input.axis || [0, 0, 1], 'Axial stage axis'),
    occurrenceIds, distanceMateIds, start: finite(input.start ?? 0, 'Stage start'), spacing: finite(input.spacing ?? 10, 'Stage spacing'), visible: input.visible !== false,
  };
}

function applyStageGroup(assembly, group) {
  group.distanceMateIds.forEach((mateId, index) => {
    const mate = assembly.mates.find((entry) => entry.id === mateId);
    mate.value = group.start + group.spacing * index;
  });
  for (const occurrenceId of group.occurrenceIds) assembly.occurrences.find((entry) => entry.id === occurrenceId).visible = group.visible;
}

export function createStudioV5AxialStageGroup(project, input) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  const groups = stageGroups(assembly);
  if (groups.some((entry) => entry.id === input.id)) throw new Error('Axial stage group ID is already in use.');
  const group = validateStageGroup(assembly, input, input.id);
  groups.push(group); applyStageGroup(assembly, group);
  return prepared(candidate);
}

export function updateStudioV5AxialStageGroup(project, groupId, patch) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  const groups = stageGroups(assembly);
  const index = groups.findIndex((entry) => entry.id === groupId);
  if (index < 0) throw new Error('That axial stage group no longer exists.');
  groups[index] = validateStageGroup(assembly, { ...groups[index], ...patch }, groupId);
  applyStageGroup(assembly, groups[index]);
  return prepared(candidate);
}

export function deleteStudioV5AxialStageGroup(project, groupId) {
  const candidate = canonicalStudioV5Project(project);
  const assembly = studioV5RootAssembly(candidate);
  const groups = stageGroups(assembly);
  if (!groups.some((entry) => entry.id === groupId)) throw new Error('That axial stage group no longer exists.');
  assembly.metadata.axialStageGroups = groups.filter((entry) => entry.id !== groupId);
  return prepared(candidate);
}

export function studioV5AxialStageGroups(project) {
  if (project.rootDocument?.kind !== 'assembly') return [];
  return clone(studioV5RootAssembly(project).metadata?.axialStageGroups || []);
}
