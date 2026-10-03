/**
 * The desktop's cross-page marks list: what main reads from local bodies
 * (typed pages, Personal pages, Personal type pages) plus plain team pages and
 * team type pages from the server's marks index. Typed pages always come from
 * the local copy; the index's copy of their bodies is left out.
 */

import type { PageMarkEntry, PageMarkEntryKind } from '@nimbalyst/collab-protocol';
import {
  filterPageMarks,
  mergePageMarks,
  pageMarkRecordsFromTeamIndex,
  type PageMarkRecord,
  type PageMarksQuery,
  type PageMarksSource,
} from '@nimbalyst/collab-client/pages';

export interface DesktopTeamMarksIndex {
  orgId: string;
  /** Null when offline or the server did not answer. */
  query(filters: { kind?: PageMarkEntryKind; email?: string }): Promise<{ marks: PageMarkEntry[] } | null>;
}

export interface DesktopPageMarksDeps {
  listLocal(query: PageMarksQuery): Promise<PageMarkRecord[]>;
  /** The active team's index, or null when the project has no team. */
  teamIndex(): DesktopTeamMarksIndex | null;
}

async function teamMarks(index: DesktopTeamMarksIndex | null, query: PageMarksQuery): Promise<PageMarkRecord[]> {
  if (!index) return [];
  try {
    const result = await index.query({
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.email ? { email: query.email } : {}),
    });
    return result ? pageMarkRecordsFromTeamIndex(result.marks, { orgId: index.orgId }) : [];
  } catch (error) {
    // The local marks still answer; a server hiccup only narrows the list.
    console.warn('[pageMarks] team marks index unavailable:', error);
    return [];
  }
}

export function createDesktopPageMarksSource(deps: DesktopPageMarksDeps): PageMarksSource {
  return {
    async listMarks(query) {
      const [local, team] = await Promise.all([deps.listLocal(query), teamMarks(deps.teamIndex(), query)]);
      return filterPageMarks(mergePageMarks(local, team), query);
    },
  };
}
