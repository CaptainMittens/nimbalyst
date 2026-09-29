/**
 * The type map: every label a project uses, sized by how many pages carry it
 * (narrower labels' pages included), with solid lines up to broader labels and
 * dashed, named lines for entity-valued properties that declare a range. A
 * searchable list beside it reaches every label from the keyboard, with the
 * structure labels (areas, home) and the unlabeled pages at the end.
 *
 * Presentational: the host builds the model (`buildLabelMap`) and navigates.
 */
import { useMemo, useState } from 'react';
import type { LabelMapModel, LabelMapNode } from './ontologyLabelMap';
import './ontologyTypes.css';

const MAP_W = 960;
const ROW_H = 118;
const PER_ROW = 6;
const TOP = 56;

export interface OntologyTypeMapProps {
  model: LabelMapModel;
  onOpenLabel: (id: string) => void;
  /** Opens the pages that carry no label; omitted hides the bucket. */
  onOpenUnlabeled?: () => void;
}

function radius(count: number): number {
  return Math.min(40, 14 + 6 * Math.log2(count + 1));
}

function layout(nodes: readonly LabelMapNode[]): { positions: Map<string, [number, number]>; height: number } {
  const byDepth = new Map<number, LabelMapNode[]>();
  for (const node of nodes) byDepth.set(node.depth, [...(byDepth.get(node.depth) ?? []), node]);
  const positions = new Map<string, [number, number]>();
  let line = 0;
  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    const band = [...byDepth.get(depth)!].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    for (let start = 0; start < band.length; start += PER_ROW) {
      const row = band.slice(start, start + PER_ROW);
      row.forEach((node, i) => positions.set(node.id, [((i + 0.5) * MAP_W) / row.length, TOP + line * ROW_H]));
      line += 1;
    }
  }
  return { positions, height: TOP + Math.max(line, 1) * ROW_H - 20 };
}

function trim(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function OntologyTypeMap({ model, onOpenLabel, onOpenUnlabeled }: OntologyTypeMapProps) {
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const { positions, height } = useMemo(() => layout(model.nodes), [model.nodes]);
  const lit = new Set<string>();
  if (hover) {
    lit.add(hover);
    for (const edge of model.edges) {
      if (edge.from === hover || edge.to === hover) {
        lit.add(edge.id);
        lit.add(edge.from);
        lit.add(edge.to);
      }
    }
  }
  const needle = query.trim().toLowerCase();
  const listed = [...model.nodes]
    .filter((node) => !needle || node.name.toLowerCase().includes(needle) || node.id.includes(needle) || node.description.toLowerCase().includes(needle))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const structure = model.structure.filter((node) => !needle || node.name.toLowerCase().includes(needle));

  return (
    <div className="ontology-type-map" data-testid="ontology-type-map">
      <div className="ontology-type-map-canvas">
        <svg viewBox={`0 0 ${MAP_W} ${height}`} role="img" aria-label="Labels and how they relate" data-focus={hover ? 'true' : 'false'}>
          <defs>
            <marker id="ontology-type-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path className="ontology-type-arrow" d="M0,0 L10,5 L0,10 z" />
            </marker>
          </defs>
          {model.edges.map((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;
            const fromNode = model.nodes.find((node) => node.id === edge.from)!;
            const toNode = model.nodes.find((node) => node.id === edge.to)!;
            const [x1, y1] = from;
            const [x2, y2] = to;
            if (edge.from === edge.to) {
              const r = radius(fromNode.count);
              return (
                <g key={edge.id} className="ontology-type-edge" data-kind={edge.kind} data-lit={lit.has(edge.id) ? 'true' : 'false'}>
                  <path d={`M${x1 - r * 0.6},${y1 - r * 0.8} C${x1 - r * 1.6},${y1 - r * 2.6} ${x1 + r * 1.6},${y1 - r * 2.6} ${x1 + r * 0.6},${y1 - r * 0.8}`} markerEnd="url(#ontology-type-arrow)" />
                  <text x={x1} y={y1 - r * 2.2} textAnchor="middle">{edge.label}</text>
                </g>
              );
            }
            const length = Math.hypot(x2 - x1, y2 - y1) || 1;
            const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length];
            const [sx, sy] = [x1 + ux * radius(fromNode.count), y1 + uy * radius(fromNode.count)];
            const [ex, ey] = [x2 - ux * (radius(toNode.count) + 3), y2 - uy * (radius(toNode.count) + 3)];
            // Range lines bow sideways so they do not sit on a broader line between the same pair.
            const bend = edge.kind === 'range' ? 38 : 0;
            const [cx, cy] = [(sx + ex) / 2 - uy * bend, (sy + ey) / 2 + ux * bend];
            return (
              <g key={edge.id} className="ontology-type-edge" data-kind={edge.kind} data-lit={lit.has(edge.id) ? 'true' : 'false'}>
                <path d={`M${sx},${sy} Q${cx},${cy} ${ex},${ey}`} markerEnd="url(#ontology-type-arrow)" />
                {edge.label && <text x={(sx + 2 * cx + ex) / 4} y={(sy + 2 * cy + ey) / 4 - 4} textAnchor="middle">{edge.label}</text>}
              </g>
            );
          })}
          {model.nodes.map((node) => {
            const [x, y] = positions.get(node.id)!;
            const r = radius(node.count);
            return (
              <g
                key={node.id}
                className="ontology-type-node"
                data-label-id={node.id}
                data-declared={node.declared ? 'true' : 'false'}
                data-role={node.role}
                data-lit={lit.has(node.id) ? 'true' : 'false'}
                onMouseEnter={() => setHover(node.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onOpenLabel(node.id)}
              >
                <title>{`${node.name}: ${node.count} ${node.count === 1 ? 'page' : 'pages'}${node.declared ? '' : ' (not in the registry)'}`}</title>
                <circle cx={x} cy={y} r={r} />
                <text className="ontology-type-node-count" x={x} y={y + 4} textAnchor="middle">{node.count}</text>
                <text className="ontology-type-node-name" x={x} y={y + r + 15} textAnchor="middle">{trim(node.plural, 22)}</text>
              </g>
            );
          })}
        </svg>
        <div className="ontology-type-map-key">
          <span><span className="ontology-type-key-line" data-kind="broader" />narrower than</span>
          <span><span className="ontology-type-key-line" data-kind="range" />points at</span>
          <span>Circle size: pages under the label</span>
        </div>
      </div>
      <aside className="ontology-type-list" aria-label="Labels">
        <input
          className="ontology-type-list-search"
          type="search"
          placeholder="Find a label"
          aria-label="Find a label"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul>
          {listed.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                className="ontology-type-list-row"
                data-label-id={node.id}
                data-declared={node.declared ? 'true' : 'false'}
                onMouseEnter={() => setHover(node.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(node.id)}
                onBlur={() => setHover(null)}
                onClick={() => onOpenLabel(node.id)}
                title={node.description || undefined}
              >
                <span className="ontology-type-list-name">{node.plural}</span>
                {!node.declared && <span className="ontology-type-list-flag">not declared</span>}
                <span className="ontology-type-list-count">{node.count}</span>
              </button>
            </li>
          ))}
          {listed.length === 0 && <li className="ontology-type-list-empty">No label matches.</li>}
        </ul>
        {(structure.length > 0 || (onOpenUnlabeled && model.unlabeled > 0)) && (
          <>
            <div className="ontology-type-list-heading">Page structure and triage</div>
            <ul>
              {structure.map((node) => (
                <li key={node.id}>
                  <button type="button" className="ontology-type-list-row" data-label-id={node.id} onClick={() => onOpenLabel(node.id)}>
                    <span className="ontology-type-list-name">{node.plural}</span>
                    <span className="ontology-type-list-count">{node.count}</span>
                  </button>
                </li>
              ))}
              {onOpenUnlabeled && model.unlabeled > 0 && (
                <li>
                  <button type="button" className="ontology-type-list-row ontology-type-unlabeled" onClick={onOpenUnlabeled}>
                    <span className="ontology-type-list-name">Unlabeled</span>
                    <span className="ontology-type-list-count">{model.unlabeled}</span>
                  </button>
                </li>
              )}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}
