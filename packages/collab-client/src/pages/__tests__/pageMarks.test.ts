// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { PageMarkEntry } from '@nimbalyst/collab-protocol';
import { filterPageMarks, mergePageMarks, pageMarkRecordsFromTeamIndex, type PageMarkRecord } from '../pageMarks';

function mark(id: string, kind: PageMarkRecord['kind'], on: string | null, extra: Partial<PageMarkRecord> = {}): PageMarkRecord {
  return {
    id,
    kind,
    text: id,
    plainText: id,
    by: null,
    email: null,
    on,
    over: null,
    line: 1,
    page: { kind: 'typed-page', scope: 'team', id: 'p', title: 'Flags', uri: 'tracker://p', typeId: 'module', issueKey: null },
    ...extra,
  };
}

describe('filterPageMarks', () => {
  it('filters by kind, type, person and text, newest first with ties in page order', () => {
    const records = [
      mark('a', 'decided', '2026-09-01'),
      mark('b', 'decided', '2026-09-30', { over: 'our own engine', by: 'Greg Hinkle', email: 'Greg@Example.com' }),
      mark('c', 'open', null),
      mark('d', 'decided', '2026-09-01', { page: { ...mark('x', 'open', null).page, typeId: 'tech' } }),
    ];
    expect(filterPageMarks(records, { kind: 'decided' }).map((r) => r.id)).toEqual(['b', 'a', 'd']);
    expect(filterPageMarks(records, { typeId: 'tech' }).map((r) => r.id)).toEqual(['d']);
    expect(filterPageMarks(records, { search: 'OWN ENGINE' }).map((r) => r.id)).toEqual(['b']);
    expect(filterPageMarks(records, { limit: 1 }).map((r) => r.id)).toEqual(['b']);
    expect(filterPageMarks(records, { email: 'greg@example.com' }).map((r) => r.id)).toEqual(['b']);
  });
});

describe('pageMarkRecordsFromTeamIndex', () => {
  const entry = (documentId: string, extra: Partial<PageMarkEntry> = {}): PageMarkEntry => ({
    documentId, projectId: 'p1', title: 'Specs', kind: 'decided', text: 'T', plainText: 'T',
    by: 'Ann', email: 'ann@x.io', on: '2026-10-01', over: null, line: 2, offset: 7, ...extra,
  });

  it('names plain and type pages by their collab uri, and typed-page bodies only through the resolver', () => {
    const entries = [
      entry('page-1'),
      entry('type-page:module', { title: 'Modules' }),
      entry('tracker-content/item-1', { projectId: null, title: null }),
      entry('tracker-content/gone', { projectId: null, title: null }),
    ];
    const resolveTypedPage = (itemId: string) => itemId === 'item-1' ? { title: 'Sync engine', issueKey: 'NIM-7', typeId: 'module' } : null;

    const records = pageMarkRecordsFromTeamIndex(entries, { orgId: 'org-1', resolveTypedPage });
    expect(records.map((r) => [r.id, r.page.kind, r.page.uri, r.page.title, r.page.typeId])).toEqual([
      ['collab://org:org-1:doc:page-1#7', 'page', 'collab://org:org-1:doc:page-1', 'Specs', null],
      ['collab://org:org-1:doc:type-page:module#7', 'type-page', 'collab://org:org-1:doc:type-page:module', 'Modules', 'module'],
      ['tracker://item-1#7', 'typed-page', 'tracker://item-1', 'Sync engine', 'module'],
    ]);
    expect(records[0]).toMatchObject({ by: 'Ann', email: 'ann@x.io', on: '2026-10-01', line: 2, page: { scope: 'team', id: 'page-1' } });
    // Without a resolver (the desktop reads typed pages locally) bodies are left out.
    expect(pageMarkRecordsFromTeamIndex(entries, { orgId: 'org-1' }).map((r) => r.page.kind)).toEqual(['page', 'type-page']);
  });

  it('merges local and server marks without listing a page twice', () => {
    const local = [mark('tracker://p#1', 'open', null)];
    const server = pageMarkRecordsFromTeamIndex([entry('page-1')], { orgId: 'org-1' });
    const merged = mergePageMarks(local, [...server, { ...local[0] }]);
    expect(merged.map((r) => r.id)).toEqual(['tracker://p#1', 'collab://org:org-1:doc:page-1#7']);
  });
});
