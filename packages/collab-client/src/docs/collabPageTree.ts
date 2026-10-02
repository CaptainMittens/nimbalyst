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
  type CollabTreeItemNode,
  type CollabTreeNode,
  type CollabTreeTypeNode,
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
        sortOrder: placement.sortOrder,
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

export type PageTreeDragged =
  | { kind: 'page'; documentId: string }
  | { kind: 'type'; typeId: string }
  | { kind: 'item'; itemId: string; typeId: string };

/** Where on a row a drag is: its upper or lower edge, or its middle. */
export type PageTreeDropZone = 'before' | 'inside' | 'after';

/**
 * What a drop writes. Pages have no server sort order (`docMove` carries only
 * the parent), so a page drop only reparents; placements carry a sortOrder.
 */
export type PageTreeDropPlan =
  | { kind: 'page'; documentId: string; parentId: string | null }
  | {
    kind: 'type'; typeId: string; parentFolderId: string | null; sortOrder: number;
    /** Siblings re-spaced because the gap at the drop point was gone. */
    renumber?: Array<{ typeId: string; parentFolderId: string | null; sortOrder: number }>;
  }
  | {
    kind: 'item'; itemId: string; parentId: string | null; sortOrder: number;
    renumber?: Array<{ itemId: string; parentId: string | null; sortOrder: number }>;
  }
  | { kind: 'unplace-item'; itemId: string };

/** The upper and lower quarters of a row insert beside it; the middle drops inside. */
export function pageTreeDropZone(offsetY: number, height: number): PageTreeDropZone {
  if (offsetY < height / 4) return 'before';
  if (offsetY > height * 0.75) return 'after';
  return 'inside';
}

const nodeIdOf = (dragged: PageTreeDragged): string =>
  dragged.kind === 'page' ? `document:${dragged.documentId}` : dragged.kind === 'type' ? `type:${dragged.typeId}` : `item:${dragged.itemId}`;

/** Spacing for a re-spaced sibling group. */
const RENUMBER_STEP = 1024;

/**
 * A sort order that lands at `index` among `orders` (ascending), or null when
 * there is no room: tied neighbours, or a gap too small for a distinct float.
 */
function orderAt(orders: number[], index: number): number | null {
  const prev = orders[index - 1];
  const next = orders[index];
  const order = prev !== undefined && next !== undefined ? (prev + next) / 2
    : next !== undefined ? next - 1
      : prev !== undefined ? prev + 1
        : Date.now();
  if (prev !== undefined && !(order > prev)) return null;
  if (next !== undefined && !(order < next)) return null;
  return order;
}

/**
 * Plan dropping `dragged` on the row `targetId`. An edge drop lands in the
 * row's parent next to it; a middle drop lands inside the row. Null means the
 * drop is refused or changes nothing. A subtype always renders inside its
 * placed base (see `attachTypeNodes`), so it moves only within that base.
 */
export function planPageTreeDrop(
  tree: CollabTreeNode[],
  dragged: PageTreeDragged,
  targetId: string,
  zone: PageTreeDropZone,
): PageTreeDropPlan | null {
  const parents = new Map<string, CollabTreeNode | null>();
  const nodes = new Map<string, CollabTreeNode>();
  const index = (list: CollabTreeNode[], parent: CollabTreeNode | null) => {
    for (const node of list) {
      nodes.set(node.id, node);
      parents.set(node.id, parent);
      if ('children' in node && node.children) index(node.children, node);
    }
  };
  index(tree, null);
  const target = nodes.get(targetId);
  const draggedId = nodeIdOf(dragged);
  if (!target || targetId === draggedId) return null;
  const container = zone === 'inside' ? target : parents.get(targetId) ?? null;
  const anchor = zone === 'inside' ? null : target;
  const children = container ? ('children' in container ? container.children ?? [] : []) : tree;
  const currentParent = parents.get(draggedId) ?? null;
  if (container && container.type !== 'document' && container.type !== 'type') return null;

  // Where among `siblings` (already in display order) the drop lands; at the
  // end when the anchor is not one of them. With no room there, the group is
  // re-spaced and `renumber` lists the siblings whose key changes.
  const orderAmong = <T extends CollabTreeNode>(siblings: T[], order: (node: T) => number) => {
    const others = siblings.filter((node) => node.id !== draggedId);
    const found = anchor ? others.findIndex((node) => node.id === anchor.id) : -1;
    const at = found < 0 ? others.length : found + (zone === 'after' ? 1 : 0);
    const sortOrder = orderAt(others.map(order), at);
    if (sortOrder !== null) return { sortOrder, renumber: [] as Array<{ node: T; sortOrder: number }> };
    const spaced = (position: number) => (position + 1) * RENUMBER_STEP;
    return {
      sortOrder: spaced(at),
      renumber: others
        .map((node, position) => ({ node, sortOrder: spaced(position < at ? position : position + 1) }))
        .filter(({ node, sortOrder: next }) => order(node) !== next),
    };
  };

  if (container?.type === 'type') {
    if (dragged.kind === 'item') {
      // Back under its own type; the order there is the type's, not the tree's.
      const node = nodes.get(draggedId);
      return node?.type === 'item' && node.placed && container.typeId === dragged.typeId
        ? { kind: 'unplace-item', itemId: dragged.itemId }
        : null;
    }
    if (dragged.kind !== 'type' || currentParent?.id !== container.id) return null;
    const subtypes = children.filter((node): node is CollabTreeTypeNode => node.type === 'type');
    const self = subtypes.find((node) => node.id === draggedId);
    if (!anchor) {
      return { kind: 'type', typeId: dragged.typeId, parentFolderId: container.placement.parentFolderId ?? null, sortOrder: self?.placement.sortOrder ?? 0 };
    }
    const { sortOrder, renumber } = orderAmong(subtypes, (node) => node.placement.sortOrder);
    return {
      kind: 'type',
      typeId: dragged.typeId,
      parentFolderId: container.placement.parentFolderId ?? null,
      sortOrder,
      ...(renumber.length ? {
        renumber: renumber.map(({ node, sortOrder: next }) => ({ typeId: node.typeId, parentFolderId: node.placement.parentFolderId ?? null, sortOrder: next })),
      } : {}),
    };
  }

  const parentId = container ? (container as CollabTreeDocumentNode).document.documentId : null;
  const sameParent = (currentParent?.type === 'document' ? currentParent.document.documentId : null) === parentId
    && currentParent?.type !== 'type';
  if (dragged.kind === 'page') {
    // Not into itself or its own subtree.
    for (let node: CollabTreeNode | null = container; node; node = parents.get(node.id) ?? null) {
      if (node.id === draggedId) return null;
    }
    return sameParent ? null : { kind: 'page', documentId: dragged.documentId, parentId };
  }
  if (dragged.kind === 'type') {
    if (currentParent?.type === 'type') return null;
    if (sameParent && !anchor) return null;
    const types = children.filter((node): node is CollabTreeTypeNode => node.type === 'type');
    const { sortOrder, renumber } = orderAmong(types, (node) => node.placement.sortOrder);
    return {
      kind: 'type',
      typeId: dragged.typeId,
      parentFolderId: parentId,
      sortOrder,
      ...(renumber.length ? {
        renumber: renumber.map(({ node, sortOrder: next }) => ({ typeId: node.typeId, parentFolderId: parentId, sortOrder: next })),
      } : {}),
    };
  }
  if (sameParent && !anchor) return null;
  const placed = children.filter((node): node is CollabTreeItemNode => node.type === 'item' && node.placed === true);
  const { sortOrder, renumber } = orderAmong(placed, (node) => node.sortOrder ?? 0);
  return {
    kind: 'item',
    itemId: dragged.itemId,
    parentId,
    sortOrder,
    ...(renumber.length ? {
      renumber: renumber.map(({ node, sortOrder: next }) => ({ itemId: node.itemId, parentId, sortOrder: next })),
    } : {}),
  };
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
