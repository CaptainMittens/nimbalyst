/**
 * The 2x2 drawing, shared by the static fenced block and the query view.
 * Scales with its container (viewBox); colors come from `--nim-*` variables so
 * it follows the theme.
 */

import React, { useMemo, type JSX } from 'react';

import {
  quadrantFraction,
  quadrantRange,
  type QuadrantLabels,
  type QuadrantPoint,
} from '../../core/quadrantModel';

const WIDTH = 430;
const HEIGHT = 250;
const PAD = { left: 26, right: 10, top: 10, bottom: 26 };
/** Top-left, top-right, bottom-left, bottom-right, as in the mockup. */
const QUADRANT_COLORS = ['var(--nim-purple)', 'var(--nim-success)', 'var(--nim-warning)', 'var(--nim-primary)'];

export interface QuadrantChartProps extends QuadrantLabels {
  points: readonly QuadrantPoint[];
  /** Opens an item's page when a query point is clicked. */
  onOpenPoint?: (id: string) => void;
}

export function QuadrantChart({ points, xLabel, yLabel, quadrants, onOpenPoint }: QuadrantChartProps): JSX.Element {
  const plot = { x: PAD.left, y: PAD.top, w: WIDTH - PAD.left - PAD.right, h: HEIGHT - PAD.top - PAD.bottom };
  const placed = useMemo(() => {
    const xRange = quadrantRange(points.map((point) => point.x));
    const yRange = quadrantRange(points.map((point) => point.y));
    return points.map((point) => {
      const fx = quadrantFraction(point.x, xRange);
      return {
        point,
        cx: plot.x + fx * plot.w,
        cy: plot.y + (1 - quadrantFraction(point.y, yRange)) * plot.h,
        // Labels flip to the left of points in the right fifth so they stay inside.
        anchorEnd: fx > 0.8,
      };
    });
    // plot is derived from constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);
  const corners = [
    { x: plot.x + 4, y: plot.y + 12, anchor: 'start' },
    { x: plot.x + plot.w - 4, y: plot.y + 12, anchor: 'end' },
    { x: plot.x + 4, y: plot.y + plot.h - 5, anchor: 'start' },
    { x: plot.x + plot.w - 4, y: plot.y + plot.h - 5, anchor: 'end' },
  ] as const;

  return (
    <svg
      className="quadrant-chart block h-auto w-full select-none"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={[yLabel, xLabel].filter(Boolean).join(' by ') || '2x2 chart'}
      data-testid="quadrant-chart"
    >
      <line x1={plot.x + plot.w / 2} y1={plot.y} x2={plot.x + plot.w / 2} y2={plot.y + plot.h} style={{ stroke: 'var(--nim-border)' }} />
      <line x1={plot.x} y1={plot.y + plot.h / 2} x2={plot.x + plot.w} y2={plot.y + plot.h / 2} style={{ stroke: 'var(--nim-border)' }} />
      <rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} fill="none" style={{ stroke: 'var(--nim-border)' }} />
      {(quadrants ?? []).slice(0, 4).map((text, index) => text ? (
        <text key={index} x={corners[index].x} y={corners[index].y} fontSize={10} textAnchor={corners[index].anchor} style={{ fill: QUADRANT_COLORS[index] }}>
          {text}
        </text>
      ) : null)}
      {placed.map(({ point, cx, cy, anchorEnd }) => {
        const open = !point.pinned && onOpenPoint ? () => onOpenPoint(point.id) : undefined;
        const color = point.pinned ? 'var(--nim-primary)' : 'var(--nim-text-muted)';
        return (
          <g
            key={point.id}
            className={open ? 'quadrant-chart-point cursor-pointer' : 'quadrant-chart-point'}
            data-pinned={point.pinned ? 'true' : undefined}
            onClick={open}
          >
            <title>{`${point.label} (${point.x}, ${point.y})`}</title>
            <circle cx={cx} cy={cy} r={point.pinned ? 5 : 3.5} style={{ fill: color }} />
            <text
              x={anchorEnd ? cx - 7 : cx + 7}
              y={cy + 4}
              fontSize={point.pinned ? 11 : 10}
              fontWeight={point.pinned ? 600 : undefined}
              textAnchor={anchorEnd ? 'end' : 'start'}
              style={{ fill: color }}
            >
              {point.label}
            </text>
          </g>
        );
      })}
      {xLabel ? (
        <text x={plot.x + plot.w / 2} y={HEIGHT - 8} fontSize={10} textAnchor="middle" style={{ fill: 'var(--nim-text-faint)' }}>
          {xLabel}
        </text>
      ) : null}
      {yLabel ? (
        <text
          x={10}
          y={plot.y + plot.h / 2}
          fontSize={10}
          textAnchor="middle"
          transform={`rotate(-90 10 ${plot.y + plot.h / 2})`}
          style={{ fill: 'var(--nim-text-faint)' }}
        >
          {yLabel}
        </text>
      ) : null}
    </svg>
  );
}
