/**
 * Wire document-index entries to the client's `DocIndexEntry`, for TeamSync.
 *
 * The server decrypts titles it owns and sends them with the empty-iv sentinel.
 * A non-empty iv is a pre-cutover row from the retired client-managed lane: no
 * supported client holds that key, so the entry is surfaced as locked rather
 * than rendering base64 as a title. Parent kind and sort order are absent from
 * older servers and read as a page parent with no order.
 */

import type { DocIndexEntry, EncryptedDocIndexEntry } from './teamSyncTypes';

/** The readable entry, or throws when the title is pre-cutover ciphertext. */
export function decodeDocEntry(encrypted: EncryptedDocIndexEntry): DocIndexEntry {
  if (encrypted.titleIv) {
    throw new Error('doc-index title is pre-cutover client-encrypted content and can no longer be read');
  }
  return { ...entryFields(encrypted), title: encrypted.encryptedTitle };
}

/**
 * The entry for a title that could not be read. When the client already knows
 * this document by a readable title, a broadcast that only moved metadata keeps
 * it instead of turning a visible page into a locked one.
 */
export function lockedDocEntry(encrypted: EncryptedDocIndexEntry, known?: DocIndexEntry): DocIndexEntry {
  if (known && !known.decryptFailed && known.title) return { ...entryFields(encrypted), title: known.title };
  return { ...entryFields(encrypted), title: '', decryptFailed: true };
}

function entryFields(e: EncryptedDocIndexEntry): Omit<DocIndexEntry, 'title'> {
  return {
    documentId: e.documentId,
    projectId: e.projectId ?? null,
    documentType: e.documentType,
    metadataVersion: e.metadataVersion,
    fileExtension: e.fileExtension,
    editorId: e.editorId,
    createdBy: e.createdBy,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    lastWriterUserId: e.lastWriterUserId ?? null,
    parentFolderId: e.parentFolderId ?? null,
    parentKind: e.parentKind ?? 'page',
    sortOrder: e.sortOrder ?? null,
    trashedAt: e.trashedAt ?? null,
  };
}
