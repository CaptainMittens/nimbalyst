/**
 * The type map as data: one node per label (sized by the pages under it), a
 * line up to each broader label, and a named, dashed line for each
 * entity-valued property that declares a range. Structure labels (areas, home)
 * sit apart, as navigation.
 */
import type { LabelRegistry, LabelRole } from '@nimbalyst/tracker-schema';
import { labelById, labelName, propertyRange, type LabelIndex } from './ontologyLabels';

export interface LabelMapNode {
  id: string;
  name: string;
  plural: string;
  description: string;
  icon: string;
  color: string;
  role: LabelRole;
  /** Pages under the label, narrower labels' included. */
  count: number;
  /** Pages carrying the label itself. */
  direct: number;
  /** False for a label pages carry that the registry does not declare. */
  declared: boolean;
  /** Longest `broader` chain above the label: 0 for a top label. */
  depth: number;
}

export interface LabelMapEdge {
  id: string;
  kind: 'broader' | 'range';
  /** Narrower label for `broader`; the label listing the property for `range`. */
  from: string;
  to: string;
  /** The property or predicate id, for `range` edges. */
  property?: string;
  label?: string;
}

export interface LabelMapModel {
  nodes: LabelMapNode[];
  edges: LabelMapEdge[];
  unlabeled: number;
  /** Structure labels (areas, home) are navigation and sit apart from the map. */
  structure: LabelMapNode[];
}

function depthOf(registry: LabelRegistry, id: string): number {
  const byId = labelById(registry);
  const memo = new Map<string, number>();
  const visit = (label: string, trail: ReadonlySet<string>): number => {
    if (memo.has(label)) return memo.get(label)!;
    const parents = (byId.get(label)?.broader ?? []).filter((parent) => byId.has(parent) && !trail.has(parent));
    const depth = parents.length ? 1 + Math.max(...parents.map((parent) => visit(parent, new Set(trail).add(parent)))) : 0;
    memo.set(label, depth);
    return depth;
  };
  return visit(id, new Set([id]));
}

export function buildLabelMap(
  index: LabelIndex,
  propertyLabel: (id: string) => string = (id) => id.replace(/-/g, ' '),
): LabelMapModel {
  const { registry } = index;
  const ids = [...registry.labels.map((label) => label.id), ...index.undeclared];
  const nodes: LabelMapNode[] = ids.map((id) => {
    const label = index.labels.get(id);
    return {
      id,
      name: labelName(registry, id),
      plural: labelName(registry, id, true),
      description: label?.description ?? '',
      icon: label?.icon ?? 'label',
      color: label?.color ?? '',
      role: label?.role ?? 'page',
      count: index.members.get(id)?.length ?? 0,
      direct: index.direct.get(id)?.length ?? 0,
      declared: Boolean(label),
      depth: label ? depthOf(registry, id) : 0,
    };
  });
  const present = new Set(ids);
  const edges: LabelMapEdge[] = [];
  for (const label of registry.labels) {
    for (const parent of label.broader ?? []) {
      if (present.has(parent)) edges.push({ id: `broader:${label.id}>${parent}`, kind: 'broader', from: label.id, to: parent });
    }
    for (const property of label.properties ?? []) {
      for (const target of propertyRange(registry, property)) {
        if (!present.has(target)) continue;
        edges.push({ id: `range:${label.id}.${property}>${target}`, kind: 'range', from: label.id, to: target, property, label: propertyLabel(property) });
      }
    }
  }
  return {
    nodes: nodes.filter((node) => node.role !== 'structure'),
    edges: edges.filter((edge) => nodes.find((node) => node.id === edge.from)?.role !== 'structure'),
    unlabeled: index.unlabeled.length,
    structure: nodes.filter((node) => node.role === 'structure'),
  };
}
