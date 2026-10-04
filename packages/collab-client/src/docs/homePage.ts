/**
 * Home: one page pinned first in each Pages section. The TeamRoom seeds a
 * team's Home once per team project (`home:{teamProjectId}`), and the desktop
 * seeds the Personal Home once per workspace (`home:personal`). Each is an
 * ordinary page that can be edited, renamed, moved or deleted, and is never
 * seeded again. Only the id prefix marks it, so the tree can pin it with no
 * extra wire field.
 */
export const HOME_PAGE_ID_PREFIX = 'home:';

export function isHomePageId(documentId: string): boolean {
  return documentId.startsWith(HOME_PAGE_ID_PREFIX);
}

/**
 * Whether a Home belongs to a team project other than `currentProjectId`.
 * Every member receives the org-wide index, so every project's Home arrives;
 * the tree shows another project's only while something sits under it. False
 * for the Personal Home and when the current project is unknown.
 */
export function isForeignHomePageId(documentId: string, currentProjectId: string | null | undefined): boolean {
  return !!currentProjectId
    && isHomePageId(documentId)
    && documentId !== `${HOME_PAGE_ID_PREFIX}personal`
    && documentId !== `${HOME_PAGE_ID_PREFIX}${currentProjectId}`;
}
