/**
 * The static 2x2 block's markdown: a fenced block anyone can write by hand.
 *
 *   ```2x2
 *   x: Marketer-first, closed -> Developer-first, open
 *   y: Batch -> Realtime decisioning
 *   quadrants: Enterprise suites | Opportunity | Guidance | Dev-first
 *   - Salesforce: 0.15, 0.85
 *   - UserCurrent: 0.85, 0.9 !
 *   ```
 *
 * Quadrants are top-left, top-right, bottom-left, bottom-right. A trailing `!`
 * draws the point highlighted. The node keeps the body text verbatim, so the
 * markdown round-trips exactly and a line this parser skips is not lost.
 */

import { quadrantNumber, type QuadrantLabels, type QuadrantPoint } from './quadrantModel';

// The fence language and the inserted default live with the node, which is on
// the editor's eager path; this parser loads with the block.
export { DEFAULT_QUADRANT_SOURCE, QUADRANT_FENCE_LANGUAGE } from './QuadrantNodeCore';

export interface ParsedQuadrantFence {
  labels: QuadrantLabels;
  points: QuadrantPoint[];
  /** Point lines without two numbers. */
  skipped: number;
}

const POINT_RE = /^-\s+(.+):\s*([^,]+),\s*(\S+?)\s*(!)?\s*$/;

export function parseQuadrantFence(body: string): ParsedQuadrantFence {
  const labels: QuadrantLabels = {};
  const points: QuadrantPoint[] = [];
  let skipped = 0;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('-')) {
      const match = POINT_RE.exec(line);
      const x = match ? quadrantNumber(match[2]) : null;
      const y = match ? quadrantNumber(match[3]) : null;
      if (!match || x === null || y === null) {
        skipped += 1;
        continue;
      }
      points.push({ id: `p${points.length}`, label: match[1].trim(), x, y, pinned: match[4] === '!' });
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'x') labels.xLabel = value;
    else if (key === 'y') labels.yLabel = value;
    else if (key === 'quadrants') labels.quadrants = value.split('|').map((part) => part.trim());
  }
  return { labels, points, skipped };
}
