/**
 * The names above a position in the page tree, root first: pages, typed pages
 * (tracker items) and, for a typed page with no placement of its own, its
 * type. Crumbs on pages, typed pages and type pages all read it.
 */
import { getSharedDocumentDisplayName, pageDisplayName } from '@nimbalyst/collab-client/docs';
import type { SharedParentKind } from '@nimbalyst/collab-client/docs';

export interface PageTreeAncestorsInput {
  documents: ReadonlyArray<{ documentId: string; title: string; documentType?: string; parentFolderId?: string | null; parentKind?: SharedParentKind }>;
  /** Legacy folders, for a tree that was never converted to pages. */
  folders?: ReadonlyArray<{ folderId: string; name: string; parentFolderId?: string | null; parentKind?: SharedParentKind }>;
  itemPlacements: ReadonlyArray<{ itemId: string; parentId?: string | null; parentKind?: SharedParentKind }>;
  typePlacements: ReadonlyArray<{ typeId: string; parentFolderId?: string | null; parentKind?: SharedParentKind }>;
  /** A typed page's title and type; null when unknown here. */
  item(itemId: string): { title: string; typeId: string } | null;
  typeName(typeId: string): string | null;
}

export type PageTreeNodeRef = { id: string; kind: SharedParentKind | 'type' };

const refOf = (id: string | null | undefined, kind: SharedParentKind | undefined): PageTreeNodeRef | null =>
  id ? { id, kind: kind ?? 'page' } : null;

/** The ref's own name and everything above it. A missing node or a cycle stops the walk. */
export function pageTreeAncestors(start: PageTreeNodeRef | null, tree: PageTreeAncestorsInput): string[] {
  const documents = new Map(tree.documents.map((document) => [document.documentId, document]));
  const folders = new Map((tree.folders ?? []).map((folder) => [folder.folderId, folder]));
  const itemPlacements = new Map(tree.itemPlacements.map((placement) => [placement.itemId, placement]));
  const typePlacements = new Map(tree.typePlacements.map((placement) => [placement.typeId, placement]));
  const names: string[] = [];
  const seen = new Set<string>();
  let ref = start;
  while (ref && !seen.has(`${ref.kind}:${ref.id}`)) {
    seen.add(`${ref.kind}:${ref.id}`);
    if (ref.kind === 'item') {
      const item = tree.item(ref.id);
      if (!item) break;
      names.unshift(item.title || ref.id);
      const placement = itemPlacements.get(ref.id);
      ref = placement ? refOf(placement.parentId, placement.parentKind) : { id: item.typeId, kind: 'type' };
    } else if (ref.kind === 'type') {
      const name = tree.typeName(ref.id);
      if (!name) break;
      names.unshift(name);
      const placement = typePlacements.get(ref.id);
      ref = placement ? refOf(placement.parentFolderId, placement.parentKind) : null;
    } else {
      const document = documents.get(ref.id);
      const folder = document ? null : folders.get(ref.id);
      if (!document && !folder) break;
      names.unshift(document
        ? pageDisplayName(getSharedDocumentDisplayName(document.title, document.documentId), document.documentType)
        : folder!.name);
      const parent = document ?? folder!;
      ref = refOf(parent.parentFolderId, parent.parentKind);
    }
  }
  return names;
}
