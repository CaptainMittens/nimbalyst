/**
 * Requests raised from a page's own header, which renders in a tab root with
 * no tabs context. Pages' sidebar owns the Set type dialog and the tab strip,
 * and answers them.
 */
import { atom } from 'jotai';
import type { SharedDocument } from '@nimbalyst/collab-client/docs';
import type { PageTypeLane } from '@nimbalyst/collab-client/docs/pageTypes';

export const pageTypeRequestAtom = atom<{ lane: PageTypeLane; page: SharedDocument } | null>(null);

/** Move a page (with its plain sub-pages) to the other Pages section. */
export const pageMoveRequestAtom = atom<{ from: PageTypeLane; pageId: string } | null>(null);
