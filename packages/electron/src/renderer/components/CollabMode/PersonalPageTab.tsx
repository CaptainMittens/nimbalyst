/**
 * A personal page opened in Pages mode (`personal://<documentId>`): its title
 * over the markdown body (`PersonalPageBodyEditor`), which is stored in the
 * local database; nothing is written to disk as a file and no account or
 * server is involved.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { PageHeaderBar } from '@nimbalyst/collab-client/trackers-ui/page';
import { getPersonalCollabHost, personalPagesDocumentsAtomFamily } from '../../store/atoms/collabDocuments';
import { historyDialogFileAtom } from '../../store/atoms/historyDialog';
import { getSharedDocumentDisplayName } from './collabTree';
import { PersonalPageBodyEditor, personalPageDocumentPath } from './PersonalPageBodyEditor';
import { CollabPlainPageHeader } from './CollabPlainPageHeader';
import { openPageAncestor } from './pageHeaderNavigation';
import { useSharedPagePath } from './useSharedPagePath';
import { pageMoveRequestAtom } from './pageTypeRequest';
import { resolveDesktopCollabScope } from '../../store/atoms/collabDocuments';
import type { CollabScope } from '@nimbalyst/collab-client/core';
import { HeaderTableOfContents } from '../TabEditor/HeaderTableOfContents';
import type { LexicalEditor } from 'lexical';

/**
 * The page's live title from the personal pages list (refreshed on every
 * change push). While that list is still empty, a one-time snapshot read, then
 * the tab title, stand in.
 */
function usePersonalPageTitle(workspacePath: string, documentId: string, fallback: string): string {
  const documents = useAtomValue(personalPagesDocumentsAtomFamily(workspacePath));
  const doc = documents.find((d) => d.documentId === documentId);
  const [title, setTitle] = useState<string | null>(null);
  const listLoaded = documents.length > 0;
  useEffect(() => {
    if (listLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const snapshot = (await window.electronAPI.invoke('personal-pages:snapshot', workspacePath)) as
          | { items?: Array<{ documentId: string; title: string }> }
          | null;
        const item = snapshot?.items?.find((doc) => doc.documentId === documentId);
        if (!cancelled && item?.title) setTitle(item.title);
      } catch (error) {
        console.warn('[PersonalPageTab] Failed to load page title:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspacePath, documentId, listLoaded]);
  if (doc) return getSharedDocumentDisplayName(doc.title, documentId);
  return title ?? fallback;
}

export interface PersonalPageTabProps {
  documentId: string;
  workspacePath: string;
  /** Last-known title (the tab's), shown until the snapshot resolves. */
  fallbackTitle: string;
}

export const PersonalPageTab: React.FC<PersonalPageTabProps> = ({ documentId, workspacePath, fallbackTitle }) => {
  const title = usePersonalPageTitle(workspacePath, documentId, fallbackTitle);
  const scope = useMemo(() => getPersonalCollabHost(workspacePath).scope, [workspacePath]);
  const page = useSharedPagePath(scope, documentId);
  const openHistory = useSetAtom(historyDialogFileAtom);
  const [editor, setEditor] = useState<LexicalEditor | null>(null);
  const requestMove = useSetAtom(pageMoveRequestAtom);
  // "Move to Team" shows once this project has a team to move to.
  const [teamScope, setTeamScope] = useState<CollabScope | null>(null);
  useEffect(() => {
    let cancelled = false;
    void resolveDesktopCollabScope(workspacePath).then(({ scope }) => {
      if (!cancelled) setTeamScope(scope);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);
  const menuItems = useMemo(() => (teamScope ? [{
    id: 'move-to-team',
    label: 'Move to Team...',
    icon: 'group',
    onSelect: () => requestMove({ from: 'personal', pageId: documentId }),
  }] : []), [teamScope, documentId, requestMove]);
  // The same header strip and title block a team page has.
  const documentHeader = useMemo(
    () => <CollabPlainPageHeader scope={scope} documentId={documentId} lane="personal" />,
    [scope, documentId],
  );
  return (
    <div
      className="personal-page-tab flex h-full min-h-0 flex-col overflow-hidden bg-nim"
      data-testid="personal-page-tab"
      data-document-id={documentId}
    >
      <PageHeaderBar
        section="Personal"
        path={page.path}
        title={page.title ?? title}
        onOpenAncestor={(ancestor) => openPageAncestor(ancestor, { personal: true, workspacePath })}
        actions={editor ? <HeaderTableOfContents editor={editor} /> : undefined}
        menuItems={menuItems}
        onShowHistory={() => openHistory(personalPageDocumentPath(documentId))}
      />
      <PersonalPageBodyEditor
        documentId={documentId}
        workspacePath={workspacePath}
        className="flex min-h-0 flex-1 flex-col"
        documentHeader={documentHeader}
        onEditorReady={setEditor}
      />
    </div>
  );
};
