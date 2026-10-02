/**
 * Placed tracker types in the Pages tree: the rows that render a type node and
 * its items, and the "Place type..." popover. Type names and items come from a
 * host-supplied `CollabTypeTreeResolver`; this module must not import the
 * tracker registry or records, which would pull the tracker graph into the
 * web console's docs-ui bundle.
 */
import React, { useMemo } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type {
  CollabTreeItemNode,
  CollabTreeTypeNode,
  CollabTypeTreeResolver,
} from '@nimbalyst/collab-client/docs';
import { FloatingPortal, useFloatingMenu, virtualElement } from './primitives/useFloatingMenu';

export interface PlaceableType {
  typeId: string;
  name: string;
  icon: string;
}

/** Listed types not placed yet (one placement per type). Empty without a resolver. */
export function getPlaceableTypes(
  resolver: CollabTypeTreeResolver | undefined,
  placedTypeIds: ReadonlySet<string>,
): PlaceableType[] {
  return (resolver?.listedTypes?.() ?? [])
    .filter((type) => !placedTypeIds.has(type.typeId))
    .map((type) => ({ typeId: type.typeId, name: type.name, icon: type.icon || 'table' }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export const CollabTypeNodeRow: React.FC<{
  node: CollabTreeTypeNode;
  indent: number;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
}> = ({ node, indent, expanded, onToggle, onOpen, onContextMenu, onDragStart, onDragEnd }) => (
  <button
    type="button"
    className="collab-tree-type-row w-full flex items-center text-left file-tree-directory"
    style={{ paddingLeft: indent }}
    data-testid="collab-tree-type-row"
    data-type-id={node.typeId}
    draggable
    onDragStart={onDragStart}
    onDragEnd={onDragEnd}
    onClick={onOpen}
    onContextMenu={onContextMenu}
    title={node.path}
  >
    <span
      className="file-tree-chevron"
      role="button"
      aria-label={expanded ? 'Collapse' : 'Expand'}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <MaterialSymbol icon={expanded ? 'keyboard_arrow_down' : 'keyboard_arrow_right'} size={16} />
    </span>
    <span className="file-tree-icon text-[var(--nim-purple)]">
      <MaterialSymbol icon="table" size={16} />
    </span>
    <span className="file-tree-name">{node.name}</span>
    {node.count > 0 && (
      <span className="collab-tree-type-count ml-1.5 mr-1 text-[11px] text-[var(--nim-text-faint)]">
        {node.count}
      </span>
    )}
  </button>
);

/** Move destination that sends a typed page back under its type node. */
export const UNDER_TYPE = '__under_type__';
/** A page id, null for root, or `UNDER_TYPE`. */
export type CollabPageMoveTarget = string | null;

/** Page-tree hooks for a typed page's row: its menu and dragging it to a page. */
export interface CollabItemRowActions {
  onContextMenu: (event: React.MouseEvent, node: CollabTreeItemNode) => void;
  onDragStart: (node: CollabTreeItemNode) => void;
  onDragEnd: () => void;
}

/**
 * A type's item. In the page tree (`typeLabel` set) it is a page: page icon,
 * its type shown faintly. In the folder tree it is a numbered entry.
 */
export const CollabTypeItemRow: React.FC<{
  node: CollabTreeItemNode;
  position: number;
  indent: number;
  onOpen: () => void;
  actions?: CollabItemRowActions;
}> = ({ node, position, indent, onOpen, actions }) => (
  <button
    type="button"
    className="collab-tree-item-row w-full flex items-center text-left file-tree-file"
    style={{ paddingLeft: indent }}
    data-testid="collab-tree-item-row"
    data-item-id={node.itemId}
    onClick={onOpen}
    onContextMenu={actions ? (event) => actions.onContextMenu(event, node) : undefined}
    draggable={!!actions}
    onDragStart={actions ? (event) => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', node.itemId);
      actions.onDragStart(node);
    } : undefined}
    onDragEnd={actions?.onDragEnd}
    title={node.path}
  >
    {node.typeLabel ? (
      <>
        <span className="file-tree-spacer" />
        <span className="file-tree-icon"><MaterialSymbol icon="description" size={16} /></span>
        <span className="file-tree-name">{node.name}</span>
        <span className="collab-tree-item-type ml-auto mr-1 pl-1.5 shrink-0 text-[11px] text-[var(--nim-text-faint)]">
          {node.typeLabel}
        </span>
      </>
    ) : (
      <>
        <span className="collab-tree-item-number w-[18px] mr-1.5 shrink-0 text-right text-[11px] text-[var(--nim-text-faint)]">
          {position}
        </span>
        <span className="file-tree-name">{node.name}</span>
      </>
    )}
  </button>
);

/** A type row plus, when expanded, its placed subtypes and numbered items. */
export const CollabTypeTreeBranch: React.FC<{
  node: CollabTreeTypeNode;
  indent: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenType: (typeId: string) => void;
  onOpenItem: (itemId: string) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onDragStart: (typeId: string) => void;
  onDragEnd: () => void;
  renderSubtypes: (nodes: CollabTreeTypeNode[]) => React.ReactNode;
  itemActions?: CollabItemRowActions;
}> = ({ node, indent, expanded, onToggle, onOpenType, onOpenItem, onContextMenu, onDragStart, onDragEnd, renderSubtypes, itemActions }) => {
  const subtypes = node.children.filter((child): child is CollabTreeTypeNode => child.type === 'type');
  const items = node.children.filter((child): child is CollabTreeItemNode => child.type === 'item');
  return (
    <div>
      <CollabTypeNodeRow
        node={node}
        indent={indent}
        expanded={expanded}
        onToggle={onToggle}
        onOpen={() => {
          if (!expanded) onToggle();
          onOpenType(node.typeId);
        }}
        onContextMenu={onContextMenu}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', node.typeId);
          onDragStart(node.typeId);
        }}
        onDragEnd={onDragEnd}
      />
      {expanded ? (
        <>
          {renderSubtypes(subtypes)}
          {items.map((item, index) => (
            <CollabTypeItemRow
              key={item.id}
              node={item}
              position={index + 1}
              indent={indent + 16}
              onOpen={() => onOpenItem(item.itemId)}
              actions={itemActions}
            />
          ))}
        </>
      ) : null}
    </div>
  );
};

/** Popover listing the types that can still be placed at a folder or root. */
export const CollabPlaceTypeMenu: React.FC<{
  x: number;
  y: number;
  types: PlaceableType[];
  onPlace: (typeId: string) => void;
  onClose: () => void;
}> = ({ x, y, types, onPlace, onClose }) => {
  const reference = useMemo(() => virtualElement(x, y), [x, y]);
  const floating = useFloatingMenu({
    placement: 'right-start',
    reference,
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
  });
  return (
    <FloatingPortal>
      <div
        ref={floating.refs.setFloating}
        style={floating.floatingStyles}
        {...floating.getFloatingProps()}
        className="collab-place-type-menu min-w-[180px] max-h-[360px] overflow-y-auto rounded-md z-[10000] text-[13px] p-1 bg-nim-secondary border border-nim text-nim backdrop-blur-[10px] shadow-lg"
      >
        <div className="px-3 pt-1 pb-0.5 text-[11px] text-[var(--nim-text-faint)]">Place type...</div>
        {types.length === 0 ? (
          <div className="px-3 py-1.5 text-[var(--nim-text-faint)]">Every type is placed</div>
        ) : types.map((type) => (
          <button
            key={type.typeId}
            type="button"
            className="collab-place-type-option w-full flex items-center gap-2.5 px-3 py-1.5 rounded border-none bg-transparent cursor-pointer transition-colors text-left text-nim hover:bg-nim-hover"
            onClick={() => onPlace(type.typeId)}
          >
            <MaterialSymbol icon={type.icon} size={18} />
            <span>{type.name}</span>
          </button>
        ))}
      </div>
    </FloatingPortal>
  );
};
