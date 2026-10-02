/**
 * Placed tracker types in the Pages tree: the rows that render a type node and
 * its items, and the "Place type..." popover. Type names and items come from a
 * host-supplied `CollabTypeTreeResolver`; this module must not import the
 * tracker registry or records, which would pull the tracker graph into the
 * web console's docs-ui bundle.
 */
import React from 'react';
import type { CollabTreeItemNode, CollabTreeTypeNode, CollabTypeTreeResolver } from '../docs/index';
export interface PlaceableType {
    typeId: string;
    name: string;
    icon: string;
}
/** Listed types not placed yet (one placement per type). Empty without a resolver. */
export declare function getPlaceableTypes(resolver: CollabTypeTreeResolver | undefined, placedTypeIds: ReadonlySet<string>): PlaceableType[];
export declare const CollabTypeNodeRow: React.FC<{
    node: CollabTreeTypeNode;
    indent: number;
    expanded: boolean;
    onToggle: () => void;
    onOpen: () => void;
    onContextMenu: (event: React.MouseEvent) => void;
    onDragStart: (event: React.DragEvent) => void;
    onDragEnd: () => void;
}>;
/** Move destination that sends a typed page back under its type node. */
export declare const UNDER_TYPE = "__under_type__";
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
export declare const CollabTypeItemRow: React.FC<{
    node: CollabTreeItemNode;
    position: number;
    indent: number;
    onOpen: () => void;
    actions?: CollabItemRowActions;
}>;
/** A type row plus, when expanded, its placed subtypes and numbered items. */
export declare const CollabTypeTreeBranch: React.FC<{
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
}>;
/** Popover listing the types that can still be placed at a folder or root. */
export declare const CollabPlaceTypeMenu: React.FC<{
    x: number;
    y: number;
    types: PlaceableType[];
    onPlace: (typeId: string) => void;
    onClose: () => void;
}>;
