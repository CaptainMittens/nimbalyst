import type { LabelMapModel } from './ontologyLabelMap';
import './ontologyTypes.css';
export interface OntologyTypeMapProps {
    model: LabelMapModel;
    onOpenLabel: (id: string) => void;
    /** Opens the pages that carry no label; omitted hides the bucket. */
    onOpenUnlabeled?: () => void;
}
export declare function OntologyTypeMap({ model, onOpenLabel, onOpenUnlabeled }: OntologyTypeMapProps): import("react").JSX.Element;
