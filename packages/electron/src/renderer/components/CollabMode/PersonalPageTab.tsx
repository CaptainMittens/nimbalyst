/**
 * A personal page opened in Pages mode (`personal://<documentId>`): its title
 * over the markdown editor. The body is stored in the local database through
 * `usePersonalPageBody`; nothing is written to disk as a file and no account
 * or server is involved.
 *
 * Editor host wiring mirrors a local tracker body (`trackerBodyHost.ts`):
 * images go to the workspace's content-addressed store under
 * `<workspace>/.nimbalyst/assets`, and local history is keyed by
 * `personal-doc://<documentId>`, the key main records snapshots under.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { NimbalystEditor, type EditorConfig } from '@nimbalyst/runtime/editor';
import type { UploadedEditorAsset } from '@nimbalyst/runtime/editor/EditorConfig';
import { DocumentPathProvider } from '@nimbalyst/runtime/DocumentPathContext';
import { store } from '@nimbalyst/runtime/store';
import { historyDialogFileAtom } from '../../store/atoms/historyDialog';
import { nimAssetUrl } from '../../utils/assetUrl';
import { personalPagesDocumentsAtomFamily } from '../../store/atoms/collabDocuments';
import { getSharedDocumentDisplayName } from './collabTree';
import { usePersonalPageBody } from './usePersonalPageBody';

const PERSONAL_DOCUMENT_PREFIX = 'personal-doc://';
const WORKSPACE_ASSET_PREFIX = '.nimbalyst/assets/';

/** The history key and editor identity of a personal page body. */
export function personalPageDocumentPath(documentId: string): string {
  return `${PERSONAL_DOCUMENT_PREFIX}${documentId}`;
}

type PersonalPageHostConfig = Pick<
  EditorConfig,
  'filePath' | 'workspaceId' | 'onUploadAsset' | 'resolveImageSrc' | 'onImageDoubleClick' | 'onImageDragStart' | 'onViewHistory'
>;

function createPersonalPageHostConfig(documentId: string, workspacePath: string): PersonalPageHostConfig {
  const documentPath = personalPageDocumentPath(documentId);
  const workspaceRoot = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
  return {
    filePath: documentPath,
    workspaceId: workspacePath,
    onUploadAsset: async (file: File): Promise<UploadedEditorAsset> => {
      const { relativePath } = await window.electronAPI.documentService.stageTrackerImage({
        workspacePath,
        bytes: await file.arrayBuffer(),
        mimeType: file.type,
      });
      return { kind: 'image', src: relativePath, name: file.name, altText: file.name };
    },
    resolveImageSrc: async (src) =>
      src.startsWith(WORKSPACE_ASSET_PREFIX) ? nimAssetUrl(`${workspaceRoot}/${src}`) : null,
    onImageDoubleClick: (src) => {
      void window.electronAPI.openImageInDefaultApp(src).catch((error) => {
        console.error('[PersonalPageTab] Failed to open image:', error);
      });
    },
    onImageDragStart: (src) => {
      void window.electronAPI.startImageDrag(src).catch((error) => {
        console.error('[PersonalPageTab] Failed to start image drag:', error);
      });
    },
    onViewHistory: () => store.set(historyDialogFileAtom, documentPath),
  };
}

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
  const body = usePersonalPageBody({ workspacePath, documentId });
  const getContentRef = useRef<(() => string) | null>(null);
  const onEditRef = useRef(body.onEdit);
  onEditRef.current = body.onEdit;

  const hostConfig = useMemo(
    () => createPersonalPageHostConfig(documentId, workspacePath),
    [documentId, workspacePath],
  );

  const editorConfig = useMemo((): EditorConfig | null => {
    if (body.status !== 'ready') return null;
    return {
      ...hostConfig,
      isRichText: true,
      editable: true,
      showToolbar: false,
      isCodeHighlighted: true,
      hasLinkAttributes: true,
      markdownOnly: true,
      initialContent: body.initialContent,
      onGetContent: (getContentFn: () => string) => {
        getContentRef.current = getContentFn;
      },
      onDirtyChange: (isDirty: boolean) => {
        if (isDirty && getContentRef.current) onEditRef.current(getContentRef.current());
      },
    };
  }, [body.status, body.initialContent, hostConfig]);

  const documentPath = personalPageDocumentPath(documentId);

  return (
    <div
      className="personal-page-tab flex h-full min-h-0 flex-col overflow-hidden bg-nim"
      data-testid="personal-page-tab"
      data-document-id={documentId}
    >
      <div className="personal-page-tab-header shrink-0 px-6 pt-5 pb-2">
        <h1 className="text-xl font-semibold text-nim select-text">{title}</h1>
      </div>
      {body.notice && (
        <div className="personal-page-tab-notice flex shrink-0 items-center gap-2 px-6 py-1.5 text-sm text-nim-muted" role="status">
          <span className="flex-1">{body.notice}</span>
          <button type="button" className="text-xs text-nim-muted hover:text-nim" onClick={body.dismissNotice}>
            Dismiss
          </button>
        </div>
      )}
      <div className="personal-page-tab-body relative flex min-h-0 flex-1 flex-col" data-file-path={documentPath}>
        {editorConfig ? (
          <DocumentPathProvider documentPath={documentPath}>
            <NimbalystEditor key={`${documentId}-${body.editorEpoch}`} config={editorConfig} />
          </DocumentPathProvider>
        ) : (
          <div className="py-4 text-center text-sm text-nim-faint">
            {body.status === 'error' ? 'This page could not be loaded.' : 'Loading...'}
          </div>
        )}
      </div>
    </div>
  );
};
