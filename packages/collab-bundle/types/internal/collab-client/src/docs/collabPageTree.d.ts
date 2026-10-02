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
/** The tree for a scope: the one page tree when the store says so, else folders. */
export declare function buildCollabTreeForScope(input: CollabPageTreeInput & {
    pageTree: boolean;
    documents: SharedDocument[];
    folders: SharedFolder[];
}): CollabTreeNode[];
