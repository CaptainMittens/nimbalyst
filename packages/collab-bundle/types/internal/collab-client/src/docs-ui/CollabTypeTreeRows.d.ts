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
export declare const CollabTypeItemRow: React.FC<{
    node: CollabTreeItemNode;
    position: number;
    indent: number;
    onOpen: () => void;
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
}>;
/** Popover listing the types that can still be placed at a folder or root. */
export declare const CollabPlaceTypeMenu: React.FC<{
    x: number;
    y: number;
    types: PlaceableType[];
    onPlace: (typeId: string) => void;
    onClose: () => void;
}>;
