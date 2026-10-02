/**
 * Load and save a personal page's markdown body through the local
 * `personal-pages:*` IPC. The body lives in the local database, never in a
 * file, and needs no account or server.
 *
 * The body is read once. Edits are debounced into a single save that carries
 * the version it was based on; saves never overlap, so each one is made against
 * the version the previous one returned. When the stored body moved on
 * elsewhere (another window, an agent), the save is refused with the stored
 * copy: the editor remounts on it and a one-line notice says so.
 *
 * The user's text is never dropped. A refused draft (and anything typed after
 * it) is written to the page's local history before the stored copy replaces
 * it, whether or not the tab is still open. A failing save retries with
 * backoff while the tab is open; after the tab closes, or once the retries run
 * out, the unsaved text goes to local history instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_SAVE_DELAY_MS = 800;
/** Delays before each retry of a failed save; one initial attempt plus these. */
export const PERSONAL_PAGE_SAVE_RETRY_DELAYS_MS = [1000, 2000, 4000];

interface PersonalPageBody {
  content: string;
  version: number;
}

type UpdateBodyResult = { version: number } | { conflict: true; version: number; content: string };

const PERSONAL_PAGE_HISTORY_PREFIX = 'personal-doc://';

/** The local-history key main records personal page snapshots under. */
export function personalPageHistoryKey(documentId: string): string {
  return `${PERSONAL_PAGE_HISTORY_PREFIX}${documentId}`;
}

/**
 * Restore a local-history snapshot into a personal page body. Returns false
 * for any other history key so the caller can take its own path. Saves at the
 * body's current version and rejects, without overwriting, if the body moved on
 * between the read and the write.
 */
export async function restoreHistoryToPersonalPage(
  historyKey: string,
  content: string,
  workspacePath: string | undefined,
): Promise<boolean> {
  if (!historyKey.startsWith(PERSONAL_PAGE_HISTORY_PREFIX)) return false;
  const documentId = historyKey.slice(PERSONAL_PAGE_HISTORY_PREFIX.length);
  if (!workspacePath) throw new Error('No workspace is open to restore this page into.');
  const current = (await window.electronAPI.invoke(
    'personal-pages:get-body',
    workspacePath,
    documentId,
  )) as PersonalPageBody | null;
  const result = (await window.electronAPI.invoke(
    'personal-pages:update-body',
    workspacePath,
    documentId,
    content,
    current?.version,
  )) as UpdateBodyResult;
  if ('conflict' in result && result.conflict) {
    throw new Error('This page changed while restoring. Try again.');
  }
  return true;
}

export interface UsePersonalPageBodyOptions {
  workspacePath: string;
  documentId: string;
  saveDelayMs?: number;
}

export interface PersonalPageBodyState {
  status: 'loading' | 'ready' | 'error';
  /** The body the editor mounts with; replaced when a conflict reloads it. */
  initialContent: string;
  /** Bumped when the body is reloaded under the editor; key the editor on it. */
  editorEpoch: number;
  /** One-line notice (conflict reload, failed save), or null. */
  notice: string | null;
  dismissNotice: () => void;
  /** Report the editor's current markdown after a change. */
  onEdit: (markdown: string) => void;
}

export function usePersonalPageBody({
  workspacePath,
  documentId,
  saveDelayMs = DEFAULT_SAVE_DELAY_MS,
}: UsePersonalPageBodyOptions): PersonalPageBodyState {
  const [status, setStatus] = useState<PersonalPageBodyState['status']>('loading');
  const [initialContent, setInitialContent] = useState('');
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  // A page with no stored body yet saves without an expected version.
  const versionRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef(false);
  const mountedRef = useRef(true);
  const failedAttemptsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    setStatus('loading');
    (async () => {
      try {
        const body = (await window.electronAPI.invoke(
          'personal-pages:get-body',
          workspacePath,
          documentId,
        )) as PersonalPageBody | null;
        if (cancelled) return;
        versionRef.current = body?.version;
        setInitialContent(body?.content ?? '');
        loadedRef.current = true;
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        console.error('[usePersonalPageBody] Failed to load page body:', error);
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspacePath, documentId]);

  /** Keep text that cannot become the body in the page's local history. */
  const keepInHistory = useCallback((markdown: string, description: string) => {
    void (window.electronAPI.invoke(
      'history:create-snapshot',
      personalPageHistoryKey(documentId),
      markdown,
      'manual',
      description,
    ) as Promise<unknown>).catch((error) => {
      console.error('[usePersonalPageBody] Failed to keep unsaved text in history:', error);
    });
  }, [documentId]);

  const flush = useCallback(() => {
    if (inFlightRef.current || pendingRef.current === null) return;
    const markdown = pendingRef.current;
    pendingRef.current = null;
    inFlightRef.current = true;
    (window.electronAPI.invoke(
      'personal-pages:update-body',
      workspacePath,
      documentId,
      markdown,
      versionRef.current,
    ) as Promise<UpdateBodyResult>)
      .then((result) => {
        inFlightRef.current = false;
        failedAttemptsRef.current = 0;
        versionRef.current = result.version;
        if ('conflict' in result && result.conflict) {
          // The stored copy wins the body. The refused draft, or anything typed
          // over it since, goes to history so it can be restored.
          const draft = pendingRef.current ?? markdown;
          pendingRef.current = null;
          keepInHistory(draft, 'Unsaved edits kept after a conflict');
          if (!mountedRef.current) return;
          setInitialContent(result.content);
          setEditorEpoch((epoch) => epoch + 1);
          setNotice('This page changed elsewhere; your edits were kept in local history.');
          return;
        }
        if (pendingRef.current !== null && timerRef.current === null) flush();
      })
      .catch((error) => {
        inFlightRef.current = false;
        console.error('[usePersonalPageBody] Failed to save page body:', error);
        // A newer edit supersedes this text; otherwise it is still the latest.
        if (pendingRef.current === null) pendingRef.current = markdown;
        if (!mountedRef.current) {
          keepInHistory(pendingRef.current, 'Unsaved edits kept after a failed save');
          pendingRef.current = null;
          return;
        }
        const attempt = failedAttemptsRef.current;
        if (attempt >= PERSONAL_PAGE_SAVE_RETRY_DELAYS_MS.length) {
          // Out of retries: the text stays pending for the next edit to retry.
          failedAttemptsRef.current = 0;
          setNotice('This page could not be saved. Your next edit will retry.');
          return;
        }
        failedAttemptsRef.current = attempt + 1;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          flush();
        }, PERSONAL_PAGE_SAVE_RETRY_DELAYS_MS[attempt]);
      });
  }, [workspacePath, documentId, keepInHistory]);

  const onEdit = useCallback((markdown: string) => {
    if (!loadedRef.current) return;
    pendingRef.current = markdown;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flush();
    }, saveDelayMs);
  }, [flush, saveDelayMs]);

  // Closing the tab must not drop the last edit. A save still in flight takes
  // any pending text with it when it settles (see flush).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flush();
    };
  }, [flush]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { status, initialContent, editorEpoch, notice, dismissNotice, onEdit };
}
