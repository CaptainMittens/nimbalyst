/**
 * The one page tree (documents nest in documents, typed pages can be placed
 * under any page). Not exported from the docs barrel: the sidebar loads it
 * lazily, only for a page-tree scope, so it stays out of the docs-ui eager
 * bundle.
 */
import {
  attachTypeNodes,
  buildCollabTreeAdaptive,
  getCollabNodeName,
  isTypePageDocumentId,
  joinCollabPath,
  sortTreeNodes,
  type CollabTreeContainer,
  type CollabTreeDocumentNode,
  type CollabTreeNode,
  type CollabTypeTreeResolver,
} from './collabTree';
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
export function buildCollabPageTree(
  documents: SharedDocument[],
  input: CollabPageTreeInput = {},
): CollabTreeNode[] {
  const pages = documents.filter((document) => !isTypePageDocumentId(document.documentId));
  const pageIds = new Set(pages.map((page) => page.documentId));
  const childPages = new Map<string | null, SharedDocument[]>();
  for (const page of pages) {
    const parentId = page.parentFolderId && page.parentFolderId !== page.documentId && pageIds.has(page.parentFolderId)
      ? page.parentFolderId
      : null;
    const siblings = childPages.get(parentId) ?? [];
    siblings.push(page);
    childPages.set(parentId, siblings);
  }

  const roots: CollabTreeNode[] = [];
  const nodesById = new Map<string, CollabTreeDocumentNode>();
  const attach = (page: SharedDocument, parent: CollabTreeDocumentNode | null) => {
    if (nodesById.has(page.documentId)) return;
    const name = getCollabNodeName(page.title) || page.title || page.documentId;
    const node: CollabTreeDocumentNode = {
      id: `document:${page.documentId}`,
      type: 'document',
      path: joinCollabPath(parent?.path ?? '', name),
      name,
      document: page,
      children: [],
    };
    nodesById.set(page.documentId, node);
    (parent ? parent.children! : roots).push(node);
    for (const child of childPages.get(page.documentId) ?? []) attach(child, node);
  };
  for (const page of childPages.get(null) ?? []) attach(page, null);
  for (const page of pages) attach(page, null);

  const { resolver } = input;
  const placedItemIds = new Set<string>();
  if (resolver?.item) {
    for (const placement of input.itemPlacements ?? []) {
      const parentId = placement.parentId ?? null;
      const parent = parentId ? nodesById.get(parentId) : null;
      if (parentId && !parent) continue;
      const item = resolver.item(placement.itemId);
      if (!item || placedItemIds.has(item.itemId)) continue;
      placedItemIds.add(item.itemId);
      const name = item.title || item.itemId;
      const typeLabel = resolver.typeLabel?.(item.typeId) ?? resolver.typeName(item.typeId) ?? undefined;
      (parent ? parent.children! : roots).push({
        id: `item:${item.itemId}`,
        type: 'item',
        itemId: item.itemId,
        typeId: item.typeId,
        path: joinCollabPath(parent?.path ?? '', name),
        name,
        placed: true,
        ...(typeLabel ? { typeLabel } : {}),
      });
    }
  }

  if (resolver) {
    attachTypeNodes(
      roots,
      (pageId) => nodesById.get(pageId) as CollabTreeContainer | undefined,
      { placements: input.typePlacements ?? [], resolver },
      placedItemIds,
    );
  }
  return sortTreeNodes(roots);
}

/** The tree for a scope: the one page tree when the store says so, else folders. */
export function buildCollabTreeForScope(input: CollabPageTreeInput & {
  pageTree: boolean;
  documents: SharedDocument[];
  folders: SharedFolder[];
}): CollabTreeNode[] {
  if (input.pageTree) return buildCollabPageTree(input.documents, input);
  return buildCollabTreeAdaptive(
    input.documents,
    input.folders,
    input.resolver ? { placements: input.typePlacements ?? [], resolver: input.resolver } : undefined,
  );
}
