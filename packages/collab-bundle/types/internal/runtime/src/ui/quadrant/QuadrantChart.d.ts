/**
 * The 2x2 drawing, shared by the static fenced block and the query view.
 * Scales with its container (viewBox); colors come from `--nim-*` variables so
 * it follows the theme.
 */
import { type JSX } from 'react';
import { type QuadrantLabels, type QuadrantPoint } from '../../core/quadrantModel';
export interface QuadrantChartProps extends QuadrantLabels {
    points: readonly QuadrantPoint[];
    /** Opens an item's page when a query point is clicked. */
    onOpenPoint?: (id: string) => void;
}
export declare function QuadrantChart({ points, xLabel, yLabel, quadrants, onOpenPoint }: QuadrantChartProps): JSX.Element;
