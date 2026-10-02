// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { atom, createStore, Provider } from 'jotai';
import type { CollabHost } from '@nimbalyst/collab-client/core';
import {
  projectPagesAsFolders,
  type CollabDocsSession,
  type SharedDocument,
  type SharedFolder,
  type SharedItemPlacement,
  type SharedTypePlacement,
} from '@nimbalyst/collab-client/docs';
import { CollabDocsUIProvider } from '../CollabDocsUIProvider';
import { CollabSidebar } from '../CollabSidebar';
import { SharedDocsListView } from '../SharedDocsListView';

vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

const folders: SharedFolder[] = [
  { folderId: 'folder-engineering', name: 'Engineering', parentFolderId: null, createdAt: 1, updatedAt: 1 },
  { folderId: 'folder-marketing', name: 'Marketing', parentFolderId: null, createdAt: 1, updatedAt: 1 },
] as unknown as SharedFolder[];

const documents: SharedDocument[] = [
  {
    documentId: 'doc-in-engineering',
    teamProjectId: 'project-primary',
    title: 'Engineering/Sync protocol notes.md',
    documentType: 'markdown',
    createdBy: 'member-self',
    createdAt: 1,
    updatedAt: 10,
    lastWriterUserId: 'member-self',
    parentFolderId: 'folder-engineering',
  },
  {
    documentId: 'doc-in-marketing',
    teamProjectId: 'project-primary',
    title: 'Marketing/Launch plan.md',
    documentType: 'markdown',
    createdBy: 'member-self',
    createdAt: 2,
    updatedAt: 20,
    lastWriterUserId: 'member-self',
    parentFolderId: 'folder-marketing',
  },
] as unknown as SharedDocument[];

// Stable identities: `useSyncExternalStore` and the unread atom family both
// re-render forever if the getter mints a new value each call.
const documentTypes = [] as const;
const notUnread = atom(false);

function renderDocsUI(children: React.ReactNode) {
  return renderDocsUIWithHost(children);
}

function renderDocsUIWithHost(
  children: React.ReactNode,
  typePlacements: SharedTypePlacement[] = [],
  pageTree?: { documents: SharedDocument[]; itemPlacements: SharedItemPlacement[] },
) {
  const docs = pageTree?.documents ?? documents;
  const host = {
    surface: 'web_console',
    documents: {
      documentTypes: () => documentTypes,
      onDocumentTypesChanged: () => () => undefined,
    },
    getMembers: async () => [{ memberId: 'member-self', email: 'self@example.test', name: 'Self' }],
    openArtifact: vi.fn(),
  } as unknown as CollabHost;
  const session = {
    scope: {
      scopeKey: 'web-console:org-folder-test:project-primary',
      orgId: 'org-folder-test',
      indexConfig: { serverUrl: 'ws://sync.test', teamProjectId: 'project-primary', teamMemberId: 'member-self' },
    },
    host,
    uiCapabilities: { personalState: false, readReceipts: false },
    atoms: {
      sharedDocuments: atom(docs),
      allSharedDocuments: atom(docs),
      trashedSharedDocuments: atom([]),
      sharedFolders: atom(pageTree ? projectPagesAsFolders(docs) : folders),
      typePlacements: atom(typePlacements),
      itemPlacements: atom(pageTree?.itemPlacements ?? []),
      pageTree: atom(!!pageTree),
      syncStatus: atom('connected'),
      hasTeam: atom(true),
      activeTeamUserId: atom('member-self'),
      favorites: atom([]),
      changedDocumentIds: atom(new Set<string>()),
      openedAt: atom({}),
      receipts: atom(new Map()),
      treeFilter: atom<'all' | 'favorites' | 'updated'>('all'),
      showUnreadBubbles: atom(true),
      pendingFolder: atom(null),
      unreadDocument: () => notUnread,
    },
    toggleFavorite: vi.fn(),
    markAllDocumentsViewed: vi.fn(),
    markDocumentViewed: vi.fn(),
  } as unknown as CollabDocsSession;

  const result = render(
    <Provider store={createStore()}>
      <CollabDocsUIProvider session={session}>{children}</CollabDocsUIProvider>
    </Provider>,
  );
  return { ...result, host };
}

afterEach(() => {
  cleanup();
});

/**
 * NIM-2436. A folder is an addressable surface in the browser console
 * (`/docs/folder/:folderId`), so clicking one in the tree has to report the
 * folder the host should route to, and a folder-scoped list has to show that
 * folder rather than the whole project.
 */
describe('routed folder scope', () => {
  it('reports the clicked folder to a host that routes folders', () => {
    const onSelectFolder = vi.fn();
    const { container } = renderDocsUI(<CollabSidebar onSelectFolder={onSelectFolder} />);

    const engineering = [...container.querySelectorAll('.file-tree-directory')]
      .find((row) => row.textContent?.includes('Engineering'))!;
    fireEvent.click(engineering);

    expect(onSelectFolder).toHaveBeenCalledWith('folder-engineering');
  });

  it('narrows the list to one folder when the route names it', () => {
    const scoped = renderDocsUI(<SharedDocsListView folderId="folder-engineering" />);
    expect(scoped.container.textContent).toContain('Sync protocol notes');
    expect(scoped.container.textContent).not.toContain('Launch plan');

    cleanup();

    const unscoped = renderDocsUI(<SharedDocsListView />);
    expect(unscoped.container.textContent).toContain('Sync protocol notes');
    expect(unscoped.container.textContent).toContain('Launch plan');
  });

  /**
   * A host with no tree beside the list (the browser console) browses folders
   * in it: the level's folders are rows, only the level's documents show, and
   * a search leaves the level for the whole project.
   */
  it('browses folders as rows for a host with no tree', () => {
    const onSelectFolder = vi.fn();
    const root = renderDocsUI(<SharedDocsListView onSelectFolder={onSelectFolder} />);
    expect(root.container.querySelectorAll('.shared-docs-folder-row')).toHaveLength(2);
    expect(root.container.textContent).not.toContain('Sync protocol notes');
    const engineering = [...root.container.querySelectorAll('.shared-docs-folder-row')]
      .find((row) => row.textContent?.includes('Engineering'))!;
    fireEvent.click(engineering);
    expect(onSelectFolder).toHaveBeenCalledWith('folder-engineering');

    cleanup();

    const scoped = renderDocsUI(<SharedDocsListView folderId="folder-engineering" onSelectFolder={onSelectFolder} />);
    expect(scoped.container.querySelectorAll('.shared-docs-folder-row')).toHaveLength(0);
    expect(scoped.container.textContent).toContain('Sync protocol notes');
    expect(scoped.container.textContent).not.toContain('Launch plan');
    fireEvent.change(scoped.getByLabelText('Search shared documents'), { target: { value: 'launch' } });
    expect(scoped.container.textContent).toContain('Launch plan');
  });

  /**
   * The route wins over the folder facet, so on a folder page the checkbox menu
   * was live but ignored: picking another folder, unchecking this one, and
   * Clear all mutated state the list no longer reads. The page reports its
   * scope instead, and the facet stays a real filter everywhere it is one.
   */
  it('reports the routed folder as scope instead of an inert filter menu', () => {
    const scoped = renderDocsUI(<SharedDocsListView folderId="folder-engineering" />);
    const routedFacet = scoped.container.querySelector('[data-facet="folder"]')!;
    expect(routedFacet.textContent).toContain('Engineering');
    fireEvent.click(routedFacet);
    expect(document.querySelector('.shared-docs-facet-menu')).toBeNull();

    cleanup();

    const unscoped = renderDocsUI(<SharedDocsListView />);
    fireEvent.click(unscoped.container.querySelector('[data-facet="folder"]')!);
    const marketing = [...document.querySelectorAll('.shared-docs-facet-option')]
      .find((option) => option.textContent?.includes('Marketing'))!;
    fireEvent.click(marketing);

    expect(unscoped.container.textContent).toContain('Launch plan');
    expect(unscoped.container.textContent).not.toContain('Sync protocol notes');
  });
});

describe('placed tracker types', () => {
  // Placements are read from the sidebar's own session, never the window's
  // active scope: the Personal section is a session that is never active.
  it('opens the type from its row and an item from the expanded type', () => {
    const typeResolver = {
      typeName: (typeId: string) => (typeId === 'module' ? 'Modules' : null),
      itemsOfType: () => [{ itemId: 'mod-1', title: 'Tracking' }, { itemId: 'mod-2', title: 'Identity' }],
    };
    const { container, host } = renderDocsUIWithHost(<CollabSidebar typeResolver={typeResolver} />, [{
      typeId: 'module', projectId: null, parentFolderId: null, sortOrder: 0,
      createdBy: 'member-self', createdAt: 1, updatedAt: 1,
    }]);

    const typeRow = container.querySelector<HTMLElement>('.collab-tree-type-row')!;
    expect(typeRow.textContent).toContain('Modules');
    expect(typeRow.textContent).toContain('2');
    fireEvent.click(typeRow);
    expect(host.openArtifact).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'type', typeId: 'module' }),
      'sidebar',
    );

    const items = container.querySelectorAll<HTMLElement>('.collab-tree-item-row');
    expect([...items].map((row) => row.textContent)).toEqual(['1Tracking', '2Identity']);
    fireEvent.click(items[1]);
    expect(host.openArtifact).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'tracker', trackerId: 'mod-2' }),
      'sidebar',
    );
  });
});

describe('one page tree', () => {
  const page = (documentId: string, title: string, parentFolderId: string | null) => ({
    ...documents[0], documentId, title, parentFolderId,
  });

  it('nests pages and placed typed pages, with the page menu from the mockup', async () => {
    const typeResolver = {
      typeName: (typeId: string) => (typeId === 'module' ? 'Modules' : null),
      typeLabel: (typeId: string) => (typeId === 'module' ? 'Module' : null),
      itemsOfType: () => [{ itemId: 'mod-1', title: 'Sync engine' }, { itemId: 'mod-2', title: 'Tracker engine' }],
      item: (itemId: string) => (itemId === 'mod-1' ? { itemId, title: 'Sync engine', typeId: 'module' } : null),
    };
    const { container } = renderDocsUIWithHost(
      <CollabSidebar typeResolver={typeResolver} />,
      [{ typeId: 'module', projectId: null, parentFolderId: 'arch', sortOrder: 0, createdBy: 'm', createdAt: 1, updatedAt: 1 }],
      {
        documents: [page('arch', 'Architecture', null), page('overview', 'Overview', 'arch')],
        itemPlacements: [{ itemId: 'mod-1', projectId: null, parentId: 'overview', sortOrder: 0, createdBy: 'm', createdAt: 1, updatedAt: 1 }],
      },
    );

    // No folder rows: Architecture is a page, expanded because it has a child page.
    expect(container.querySelectorAll('.file-tree-directory:not(.collab-tree-type-row)')).toHaveLength(0);
    const rowText = () => [...container.querySelectorAll('.file-tree-file, .collab-tree-type-row')].map((row) => row.textContent);
    // The page tree builder loads lazily.
    await waitFor(() => expect(rowText()).toEqual(['Architecture', 'Modules2', 'Overview']));

    const overview = [...container.querySelectorAll<HTMLElement>('.file-tree-file')].find((row) => row.textContent === 'Overview')!;
    fireEvent.click(overview.querySelector('.file-tree-chevron')!);
    // The placed Module sits under Overview with its type shown faintly; it is
    // no longer listed under its type (the count still includes it).
    expect(rowText()).toEqual(['Architecture', 'Modules2', 'Overview', 'Sync engineModule']);

    const architecture = [...container.querySelectorAll<HTMLElement>('.file-tree-file')].find((row) => row.textContent === 'Architecture')!;
    fireEvent.contextMenu(architecture);
    await waitFor(() => expect(document.querySelector('.collab-page-set-type')).not.toBeNull());
    const entries = [...document.querySelectorAll('button')].map((button) => button.textContent);
    expect(entries).toEqual(expect.arrayContaining(['New pageinside', 'Set type', 'Rename', 'Move to...', 'Copy link', 'Delete1 child page']));
    expect(document.querySelector<HTMLButtonElement>('.collab-page-set-type')!.disabled).toBe(true);
  });
});
