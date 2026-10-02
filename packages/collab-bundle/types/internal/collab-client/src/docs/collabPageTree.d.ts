/**
 * The one page tree (documents nest in documents, typed pages can be placed
 * under any page). Not exported from the docs barrel: the sidebar loads it
 * lazily, only for a page-tree scope, so it stays out of the docs-ui eager
 * bundle.
 */
import { type CollabTreeNode, type CollabTypeTreeResolver } from './collabTree';
import type { SharedDocument, SharedFolder, SharedItemPlacement, SharedTypePlacement } from './types';
export interface CollabPageTreeInput {
    resolver?: CollabTypeTreeResolver;
    typePlacements?: SharedTypePlacement[];
    itemPlacements?: SharedItemPlacement[];
}
/**
 * The one page tree: every page can hold child pages, placed types and placed
 * typed pages. A document's `parentFolderId` names its parent page; a missing
 * parent puts it at root, and a corrupt parent cycle is broken by rooting the
 * first member reached, so no page ever disappears. An item placed under a
 * page that is not here stays under its type.
 */
export declare function buildCollabPageTree(documents: SharedDocument[], input?: CollabPageTreeInput): CollabTreeNode[];
export type PageTreeDragged = {
    kind: 'page';
    documentId: string;
} | {
    kind: 'type';
    typeId: string;
} | {
    kind: 'item';
    itemId: string;
    typeId: string;
};
/** Where on a row a drag is: its upper or lower edge, or its middle. */
export type PageTreeDropZone = 'before' | 'inside' | 'after';
/**
 * What a drop writes. Pages have no server sort order (`docMove` carries only
 * the parent), so a page drop only reparents; placements carry a sortOrder.
 */
export type PageTreeDropPlan = {
    kind: 'page';
    documentId: string;
    parentId: string | null;
} | {
    kind: 'type';
    typeId: string;
    parentFolderId: string | null;
    sortOrder: number;
    /** Siblings re-spaced because the gap at the drop point was gone. */
    renumber?: Array<{
        typeId: string;
        parentFolderId: string | null;
        sortOrder: number;
    }>;
} | {
    kind: 'item';
    itemId: string;
    parentId: string | null;
    sortOrder: number;
    renumber?: Array<{
        itemId: string;
        parentId: string | null;
        sortOrder: number;
    }>;
} | {
    kind: 'unplace-item';
    itemId: string;
};
/** The upper and lower quarters of a row insert beside it; the middle drops inside. */
export declare function pageTreeDropZone(offsetY: number, height: number): PageTreeDropZone;
/**
 * Plan dropping `dragged` on the row `targetId`. An edge drop lands in the
 * row's parent next to it; a middle drop lands inside the row. Null means the
 * drop is refused or changes nothing. A subtype always renders inside its
 * placed base (see `attachTypeNodes`), so it moves only within that base.
 */
export declare function planPageTreeDrop(tree: CollabTreeNode[], dragged: PageTreeDragged, targetId: string, zone: PageTreeDropZone): PageTreeDropPlan | null;
/** The tree for a scope: the one page tree when the store says so, else folders. */
export declare function buildCollabTreeForScope(input: CollabPageTreeInput & {
    pageTree: boolean;
    documents: SharedDocument[];
    folders: SharedFolder[];
}): CollabTreeNode[];
