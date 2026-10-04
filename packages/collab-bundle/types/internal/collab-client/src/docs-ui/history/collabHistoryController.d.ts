/**
 * What a host hands the shared page history dialog for one open document.
 *
 * The desktop builds one per collaborative tab; the web console builds one per
 * mounted page. Both list and load revisions over the same REST surface on the
 * document's room (`CollabHistoryClient`, team JWT) and restore through the
 * live editor, so peers see the restore as an ordinary collaborative edit.
 */
import type { CollabHistoryClient } from '../../../../runtime/src/sync/collabHistoryClient';
import type { DocumentSyncStatus } from '../../../../runtime/src/sync/documentSyncTypes';
export interface CollabHistoryController {
    /** Stable per-document REST client. */
    client: Pick<CollabHistoryClient, 'listRevisions' | 'loadRevision' | 'createRevision'>;
    /** Logical editor type, e.g. `markdown`, `excalidraw`. */
    editorType: string;
    /** Snapshot content format string returned by `exportSnapshot`. */
    contentFormat: string;
    /** How much the dialog can do for this editor right now. */
    previewKind?: 'text' | 'metadata-only';
    /** Capture the current document content for a new revision. */
    exportSnapshot?: () => Promise<Uint8Array> | Uint8Array;
    /** Apply a restored snapshot into the live document. */
    applySnapshot?: (plaintext: Uint8Array) => Promise<void> | void;
    /** Largest server sequence known to this client. */
    getBasisSequence: () => number;
    /** Current sync status -- restore is blocked while this is unsafe. */
    getStatus: () => DocumentSyncStatus;
    /** Wait for local collab writes to settle before restore-sensitive actions. */
    waitForPendingWrites?: (timeoutMs?: number) => Promise<boolean>;
    /** True when the reader may not write this document; restore is withheld. */
    isReadOnly?: () => boolean;
}
/**
 * Only restore from a fully synced state. `replaying` and `offline-unsynced`
 * mean the local document has writes the server has not yet acknowledged;
 * replacing content now would lose them.
 */
export declare function isCollabRestoreSafe(status: DocumentSyncStatus): boolean;
export declare function canRestoreCollabRevisions(controller: CollabHistoryController | null): boolean;
/**
 * Restore `revisionId` as the current version.
 *
 * 1. Record a `restore-pre` checkpoint of the current head, so the restore can
 *    itself be undone from history.
 * 2. Load the selected revision and apply it through the live editor.
 * 3. Record a `restore-head` revision pointing back at the source.
 *
 * Returns false without writing anything when the document is not synced and
 * the controller cannot wait for it (an older controller); throws when it
 * waited and the document still has unsynced writes.
 */
export declare function restoreCollabRevision(controller: CollabHistoryController, revisionId: string): Promise<boolean>;
