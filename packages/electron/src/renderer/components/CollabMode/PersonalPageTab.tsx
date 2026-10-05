/**
 * A personal page opened in Pages mode (`personal://<documentId>`): its title
 * over the markdown body (`PersonalPageBodyEditor`), which is stored in the
 * local database; nothing is written to disk as a file and no account or
 * server is involved.
 */

import React, { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { personalPagesDocumentsAtomFamily, getPersonalCollabDocsSession, getPersonalCollabHost } from '../../store/atoms/collabDocuments';
import { PagesHomeHelp } from '@nimbalyst/collab-client/docs-ui';
import { getSharedDocumentDisplayName } from './collabTree';
import { PersonalPageBodyEditor } from './PersonalPageBodyEditor';

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
  return (
    <div
      className="personal-page-tab flex h-full min-h-0 flex-col overflow-hidden bg-nim"
      data-testid="personal-page-tab"
      data-document-id={documentId}
    >
      <div className="personal-page-tab-header shrink-0 px-6 pt-5 pb-2">
        <h1 className="text-xl font-semibold text-nim select-text">{title}</h1>
      </div>
      {documentId === 'home:personal' && <PagesHomeHelp key={workspacePath} personal host={getPersonalCollabHost(workspacePath)} scope={getPersonalCollabDocsSession(workspacePath).scope} />}
      <PersonalPageBodyEditor documentId={documentId} workspacePath={workspacePath} className="flex min-h-0 flex-1 flex-col" />
    </div>
  );
};
