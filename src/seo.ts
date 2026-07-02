// Ported from src/lib/seo.ts so engine pages present identically in search —
// with one wiki-era addition: indexability is earned. A page reaches search
// engines only when its tier allows AND a human has verified it, so the
// machine-generated backlog never rides the domain's reputation.
import { lineCount, totalParts, verificationOfNode, type NodeData } from './nodes.ts';

export const INDEX_TIER = 1;
export const SITE = 'https://bomwiki.com';

export function isIndexableNode(node: NodeData): boolean {
  if (verificationOfNode(node.id) !== 'human-verified') return false;
  if (node.kind === 'product') return INDEX_TIER >= 1;
  if (node.kind === 'assembly') return INDEX_TIER >= 2;
  return INDEX_TIER >= 3;
}

function aOrAn(word: string): string {
  return /^[aeiou]/i.test(word.trim()) ? 'an' : 'a';
}

export function seoTitle(node: NodeData): string {
  if (node.kind === 'part') return `${node.name}: uses, specs & where it fits | BOMwiki`;
  if (node.kind === 'product') return `${node.name} parts diagram & bill of materials | BOMwiki`;
  return `${node.name}: parts list & bill of materials | BOMwiki`;
}

export function seoDescription(node: NodeData): string {
  const tp = totalParts(node.id);
  const lines = lineCount(node.id);
  if (node.kind === 'part') {
    return node.summary ?? `${node.name}: specifications and every assembly it is used in, on BOMwiki.`;
  }
  if (node.kind === 'product') {
    const n = node.name.toLowerCase();
    return `What are the parts of ${aOrAn(n)} ${n}? Explore the ${n} parts diagram: ${tp.toLocaleString()} parts across ${lines} assemblies, with full bill of materials, specs, and likely vendors.`;
  }
  return `Inside the ${node.name.toLowerCase()}: ${tp.toLocaleString()} parts across ${lines} top-level assemblies, with explorable bill of materials, engineering specs, and likely vendors.`;
}
