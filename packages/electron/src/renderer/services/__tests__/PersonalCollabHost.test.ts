// @vitest-environment node
/**
 * `CollabSidebar` reads `host.documents.documentTypes()` through
 * `useSyncExternalStore`, which compares snapshot identity: a list rebuilt on
 * every call re-renders forever ("Maximum update depth exceeded", seen live on
 * 2026-10-02 when the Personal section first mounted).
 */
import { describe, expect, it, vi } from 'vitest';
import type { CollabDocumentTypeDescriptor } from '@nimbalyst/collab-client/core';

const dataSources = vi.hoisted(() => [] as Array<{ disposed: boolean; watching: boolean }>);
vi.mock('../PersonalPagesDataSource', () => ({
  PersonalPagesDataSource: class {
    disposed = false;
    watching = false;
    constructor() { dataSources.push(this); }
    // The real source never resumes watching once disposed.
    subscribe() { if (!this.disposed) this.watching = true; return () => undefined; }
    dispose() { this.disposed = true; this.watching = false; }
  },
}));
vi.mock('../../contexts/TabsContext', () => ({ PERSONAL_PAGE_TAB_PREFIX: 'personal://' }));

import { registerElectronCollabDocumentTypes, electronCollabDocumentAdapters } from '../ElectronCollabHost';
import { PersonalCollabHost } from '../PersonalCollabHost';

const descriptor = (documentType: string) => ({ documentType } as unknown as CollabDocumentTypeDescriptor);

describe('PersonalCollabHost data source', () => {
  // The host is a window singleton; a docs session disposing the source on
  // unmount left a remounted Personal section with a tree that never refreshed.
  it('gives a session created after dispose a source that watches again', () => {
    dataSources.length = 0;
    const host = new PersonalCollabHost('/workspace/remount');
    const source = host.documents.dataSource;

    source.subscribe(() => undefined);
    source.dispose();
    source.subscribe(() => undefined);

    expect(dataSources.map((s) => [s.disposed, s.watching])).toEqual([[true, false], [false, true]]);
  });
});

describe('PersonalCollabHost document types', () => {
  it('returns the same list until the catalog changes, and only markdown', () => {
    const host = new PersonalCollabHost('/workspace');
    expect(electronCollabDocumentAdapters.documentTypes()).toBe(electronCollabDocumentAdapters.documentTypes());

    const catalog = [descriptor('markdown'), descriptor('excalidraw')];
    const unregister = registerElectronCollabDocumentTypes(() => catalog);
    try {
      const first = host.documents.documentTypes();
      expect(first.map((d) => d.documentType)).toEqual(['markdown']);
      expect(host.documents.documentTypes()).toBe(first);

      const next = [descriptor('markdown')];
      unregister();
      const unregisterNext = registerElectronCollabDocumentTypes(() => next);
      try {
        expect(host.documents.documentTypes()).not.toBe(first);
        expect(host.documents.documentTypes()).toBe(host.documents.documentTypes());
      } finally {
        unregisterNext();
      }
    } finally {
      unregister();
    }
  });
});
