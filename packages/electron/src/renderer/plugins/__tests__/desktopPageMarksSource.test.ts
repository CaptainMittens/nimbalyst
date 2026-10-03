// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PageMarkEntry } from '@nimbalyst/collab-protocol';
import type { PageMarkRecord } from '@nimbalyst/collab-client/pages';
import { createDesktopPageMarksSource } from '../desktopPageMarksSource';

const localTyped: PageMarkRecord = {
  id: 'tracker://item-1#0', kind: 'decided', text: 'Local', plainText: 'Local', by: 'Ann', email: 'ann@x.io',
  on: '2026-09-01', over: null, line: 1,
  page: { kind: 'typed-page', scope: 'team', id: 'item-1', title: 'Sync engine', uri: 'tracker://item-1', typeId: 'module', issueKey: null },
};
const serverEntry = (documentId: string, on: string): PageMarkEntry => ({
  documentId, projectId: 'p1', title: 'Specs', kind: 'decided', text: 'Server', plainText: 'Server',
  by: 'Ann', email: 'ann@x.io', on, over: null, line: 1, offset: 0,
});

describe('desktop marks source', () => {
  it('adds plain team pages from the server index to the local marks, once each, filtered together', async () => {
    const query = vi.fn(async () => ({
      status: 'ready' as const,
      // The typed page's body is also in the server index; the local copy is the one listed.
      marks: [serverEntry('page-1', '2026-10-01'), serverEntry('tracker-content/item-1', '2026-09-01')],
    }));
    const source = createDesktopPageMarksSource({
      listLocal: async () => [localTyped],
      teamIndex: () => ({ orgId: 'org-1', query }),
    });

    const marks = await source.listMarks({ kind: 'decided', email: 'ann@x.io', limit: 5 });
    expect(marks.map((mark) => mark.page.uri)).toEqual(['collab://org:org-1:doc:page-1', 'tracker://item-1']);
    expect(query).toHaveBeenCalledWith({ kind: 'decided', email: 'ann@x.io' });
  });

  it('lists local marks when there is no team or the server does not answer', async () => {
    const listLocal = async () => [localTyped];
    expect(await createDesktopPageMarksSource({ listLocal, teamIndex: () => null }).listMarks({})).toEqual([localTyped]);
    const offline = createDesktopPageMarksSource({ listLocal, teamIndex: () => ({ orgId: 'org-1', query: async () => null }) });
    expect(await offline.listMarks({})).toEqual([localTyped]);
  });
});
