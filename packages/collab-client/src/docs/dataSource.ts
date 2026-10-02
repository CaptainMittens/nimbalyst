import type {
  CollabCommand,
  CollabCommandResult,
  CollabDataChange,
  CollabDataSnapshot,
  CollabDataSource,
  Unsubscribe,
} from '@nimbalyst/collab-client/core';
import type { SharedDocument, SharedFolder, SharedTypePlacement } from './types';

// Re-exported here because the docs barrel only re-exports document and folder.
export type { SharedTypePlacement } from './types';

export type CollabDocsCommand =
  | {
      type: 'register-document';
      documentId: string;
      title: string;
      documentType: string;
      parentFolderId: string | null;
      metadata?: { metadataVersion: 2; fileExtension: string; editorId: string };
    }
  | { type: 'update-document-title'; documentId: string; title: string }
  | { type: 'remove-document'; documentId: string }
  | { type: 'trash-document'; documentId: string; trashedAt: number }
  | { type: 'restore-document'; documentId: string }
  | { type: 'move-document'; documentId: string; parentFolderId: string | null }
  | {
      type: 'register-folder';
      folderId: string;
      name: string;
      parentFolderId: string | null;
      sortOrder: number;
    }
  | { type: 'rename-folder'; folderId: string; name: string }
  | { type: 'move-folder'; folderId: string; parentFolderId: string | null }
  | { type: 'remove-folder'; folderId: string }
  | { type: 'refresh-folders' }
  | { type: 'set-type-placement'; typeId: string; parentFolderId: string | null; sortOrder: number }
  | { type: 'remove-type-placement'; typeId: string }
  | { type: 'refresh-type-placements' }
  | { type: 'reconnect' };

export interface CollabDocsCommandResult extends CollabCommandResult {
  folders?: SharedFolder[] | null;
  /** `refresh-type-placements` only: the server list, or null on timeout. */
  typePlacements?: SharedTypePlacement[] | null;
  /**
   * `register-document` only: whether the server confirmed the index row is
   * committed. `false` means unconfirmed (older server, or queued offline) —
   * not failed. Callers about to write into the new document's room use this
   * to decide whether the room is known-reachable yet (NIM-2472).
   */
  registrationAcked?: boolean;
}

/**
 * Document snapshot plus the tracker types placed in the page tree. A host
 * that predates placements omits `typePlacements`; one that sets it is
 * authoritative for this scope's project.
 *
 * Placement changes travel as `snapshot` changes rather than their own kinds:
 * the docs source has to stay assignable to the core `CollabDataSource` seam,
 * and a listener typed for the core change union cannot accept new kinds.
 */
export interface CollabDocsSnapshot extends CollabDataSnapshot<SharedDocument, SharedFolder> {
  typePlacements?: SharedTypePlacement[];
}

export type CollabDocsDataChange =
  | Exclude<CollabDataChange<SharedDocument, SharedFolder>, { type: 'snapshot' }>
  | { type: 'snapshot'; snapshot: CollabDocsSnapshot };

export interface CollabDocsDataSource extends Omit<
  CollabDataSource<SharedDocument, SharedFolder, CollabDocsCommand, CollabDocsCommandResult>,
  'snapshot' | 'subscribe'
> {
  snapshot(): Promise<CollabDocsSnapshot>;
  subscribe(cb: (change: CollabDocsDataChange) => void): Unsubscribe;
}

// Compile-time assertion that the document command union stays compatible
// with the artifact-agnostic command seam.
const _collabDocsCommand: CollabCommand = {} as CollabDocsCommand;
void _collabDocsCommand;
