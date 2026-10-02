/**
 * The "Where" column of a type page: the page an item lives under in the page
 * tree. An item with no placement sits under its type, so it names the type;
 * so does a placement whose page is gone, which is where the tree shows it.
 */

export interface WherePage {
  folderId: string;
  parentFolderId?: string | null;
  name: string;
}

export interface WherePlacement {
  itemId: string;
  /** Null means the root of the section. */
  parentId?: string | null;
}

export interface ItemWhereInput {
  placements: readonly WherePlacement[];
  /** Every page that can be a parent, as the docs session lists them. */
  pages: readonly WherePage[];
  /** Shown for an item with no placement: the type's own name. */
  typeLabel: string;
  /** Shown for an item placed at the root of its section. */
  rootLabel: string;
}

export function createItemWhereResolver({ placements, pages, typeLabel, rootLabel }: ItemWhereInput): (itemId: string) => string {
  const parentByItem = new Map(placements.map((placement) => [placement.itemId, placement.parentId ?? null]));
  const pagesById = new Map(pages.map((page) => [page.folderId, page]));
  return (itemId) => {
    if (!parentByItem.has(itemId)) return typeLabel;
    let pageId = parentByItem.get(itemId) ?? null;
    if (pageId === null) return rootLabel;
    const names: string[] = [];
    const seen = new Set<string>();
    while (pageId !== null && !seen.has(pageId)) {
      seen.add(pageId);
      const page = pagesById.get(pageId);
      if (!page) break;
      names.unshift(page.name);
      pageId = page.parentFolderId ?? null;
    }
    return names.length > 0 ? names.join(' / ') : typeLabel;
  };
}
