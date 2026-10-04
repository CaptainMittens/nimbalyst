/**
 * What a host hands the shared page history dialog for one open document.
 *
 * The desktop builds one per collaborative tab; the web console builds one per
 * mounted page. Both list and load revisions over the same REST surface on the
 * document's room (`CollabHistoryClient`, team JWT) and restore through the
 * live editor, so peers see the restore as an ordinary collaborative edit.
 */
import type { CollabHistoryClient } from '@nimbalyst/runtime/sync/collabHistoryClient';
import type { DocumentSyncStatus } from '@nimbalyst/runtime/sync/documentSyncTypes';

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
export function isCollabRestoreSafe(status: DocumentSyncStatus): boolean {
  return status === 'connected';
}

export function canRestoreCollabRevisions(controller: CollabHistoryController | null): boolean {
  return !!controller?.exportSnapshot && !!controller.applySnapshot && !controller.isReadOnly?.();
}

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
export async function restoreCollabRevision(
  controller: CollabHistoryController,
  revisionId: string,
): Promise<boolean> {
  const { exportSnapshot, applySnapshot } = controller;
  if (!exportSnapshot || !applySnapshot) return false;
  if (controller.isReadOnly?.()) throw new Error('You do not have permission to edit this document.');

  if (!isCollabRestoreSafe(controller.getStatus())) {
    if (!controller.waitForPendingWrites) return false;
    const settled = await controller.waitForPendingWrites(5_000);
    if (!settled || !isCollabRestoreSafe(controller.getStatus())) {
      throw new Error('This document still has unsynced local changes. Wait for "Connected" before restoring.');
    }
  }

  const current = await exportSnapshot();
  await controller.client.createRevision({
    revisionKind: 'restore-pre',
    editorType: controller.editorType,
    contentFormat: controller.contentFormat,
    plaintext: current instanceof Uint8Array ? current : new Uint8Array(current),
    basisSequence: controller.getBasisSequence(),
  });

  const loaded = await controller.client.loadRevision(revisionId);
  await applySnapshot(loaded.plaintext);

  await controller.client.createRevision({
    revisionKind: 'restore-head',
    editorType: controller.editorType,
    contentFormat: controller.contentFormat,
    plaintext: loaded.plaintext,
    basisSequence: controller.getBasisSequence(),
    restoredFromRevisionId: revisionId,
  });
  return true;
}
