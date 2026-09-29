/**
 * The type map as data: one node per label (sized by the pages under it), a
 * line up to each broader label, and a named, dashed line for each
 * entity-valued property that declares a range. Structure labels (areas, home)
 * sit apart, as navigation.
 */
import type { LabelRole } from '../../../../tracker-schema/src/browser';
import { type LabelIndex } from './ontologyLabels';
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
export declare function buildLabelMap(index: LabelIndex, propertyLabel?: (id: string) => string): LabelMapModel;
