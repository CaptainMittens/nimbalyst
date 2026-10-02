/**
 * SQL for personal pages (schema 0049). Every query here runs on both PGLite
 * and better-sqlite3: whole columns only, `$N` params, Date objects bound for
 * timestamps and read back through `toMillis()`.
 */
import type { SharedDocument, SharedFolder, SharedTypePlacement } from '@nimbalyst/collab-client/docs';
import { toMillis } from '../../utils/timestampUtils';

export interface PersonalPagesDb {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  runTransaction(statements: Array<{ sql: string; params?: any[] }>): Promise<void>;
}

interface FolderRow {
  folder_id: string;
  parent_folder_id: string | null;
  name: string;
  sort_order: number | string;
  created_at: unknown;
  updated_at: unknown;
}

interface DocumentRow {
  document_id: string;
  title: string;
  document_type: string;
  editor_id: string | null;
  file_extension: string | null;
  parent_folder_id: string | null;
  created_at: unknown;
  updated_at: unknown;
  trashed_at: unknown;
}

interface PlacementRow {
  type_id: string;
  parent_folder_id: string | null;
  sort_order: number | string;
  created_at: unknown;
  updated_at: unknown;
}

const LOCAL_AUTHOR = 'local';

export async function listFolders(db: PersonalPagesDb, ws: string): Promise<SharedFolder[]> {
  const { rows } = await db.query<FolderRow>(
    `SELECT folder_id, parent_folder_id, name, sort_order, created_at, updated_at
     FROM personal_page_folders WHERE workspace_path = $1 ORDER BY sort_order, folder_id`,
    [ws],
  );
  return rows.map((row) => ({
    folderId: row.folder_id,
    parentFolderId: row.parent_folder_id ?? null,
    name: row.name,
    sortOrder: Number(row.sort_order),
    createdBy: LOCAL_AUTHOR,
    createdAt: toMillis(row.created_at) ?? 0,
    updatedAt: toMillis(row.updated_at) ?? 0,
  }));
}

export async function listDocuments(db: PersonalPagesDb, ws: string): Promise<SharedDocument[]> {
  const { rows } = await db.query<DocumentRow>(
    `SELECT document_id, title, document_type, editor_id, file_extension, parent_folder_id,
            created_at, updated_at, trashed_at
     FROM personal_page_documents WHERE workspace_path = $1 ORDER BY created_at, document_id`,
    [ws],
  );
  return rows.map((row) => ({
    documentId: row.document_id,
    teamProjectId: null,
    title: row.title,
    documentType: row.document_type,
    metadataVersion: 2 as const,
    ...(row.file_extension ? { fileExtension: row.file_extension } : {}),
    ...(row.editor_id ? { editorId: row.editor_id } : {}),
    createdBy: LOCAL_AUTHOR,
    createdAt: toMillis(row.created_at) ?? 0,
    updatedAt: toMillis(row.updated_at) ?? 0,
    parentFolderId: row.parent_folder_id ?? null,
    trashedAt: toMillis(row.trashed_at),
  }));
}

export async function listTypePlacements(db: PersonalPagesDb, ws: string): Promise<SharedTypePlacement[]> {
  const { rows } = await db.query<PlacementRow>(
    `SELECT type_id, parent_folder_id, sort_order, created_at, updated_at
     FROM personal_page_type_placements WHERE workspace_path = $1 ORDER BY sort_order, type_id`,
    [ws],
  );
  return rows.map((row) => ({
    typeId: row.type_id,
    projectId: null,
    parentFolderId: row.parent_folder_id ?? null,
    sortOrder: Number(row.sort_order),
    createdBy: LOCAL_AUTHOR,
    createdAt: toMillis(row.created_at) ?? 0,
    updatedAt: toMillis(row.updated_at) ?? 0,
  }));
}

export async function upsertFolder(
  db: PersonalPagesDb,
  ws: string,
  folder: { folderId: string; name: string; parentFolderId: string | null; sortOrder: number },
): Promise<void> {
  const now = new Date();
  await db.query(
    `INSERT INTO personal_page_folders
       (workspace_path, folder_id, parent_folder_id, name, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (workspace_path, folder_id) DO UPDATE SET
       parent_folder_id = EXCLUDED.parent_folder_id,
       name = EXCLUDED.name,
       sort_order = EXCLUDED.sort_order,
       updated_at = EXCLUDED.updated_at`,
    [ws, folder.folderId, folder.parentFolderId, folder.name, folder.sortOrder, now],
  );
}

/** Update named columns of one row. Column names come from callers in this module only. */
async function updateRow(
  db: PersonalPagesDb,
  table: 'personal_page_folders' | 'personal_page_documents' | 'personal_page_type_placements',
  keyColumn: 'folder_id' | 'document_id' | 'type_id',
  ws: string,
  id: string,
  values: Record<string, unknown>,
): Promise<boolean> {
  const columns = Object.keys(values);
  const assignments = columns.map((column, index) => `${column} = $${index + 3}`);
  const { rows } = await db.query(
    `UPDATE ${table} SET ${assignments.join(', ')}, updated_at = $${columns.length + 3}
     WHERE workspace_path = $1 AND ${keyColumn} = $2 RETURNING ${keyColumn}`,
    [ws, id, ...columns.map((column) => values[column]), new Date()],
  );
  return rows.length > 0;
}

export const updateFolder = (db: PersonalPagesDb, ws: string, folderId: string, values: Record<string, unknown>) =>
  updateRow(db, 'personal_page_folders', 'folder_id', ws, folderId, values);

export const updateDocument = (db: PersonalPagesDb, ws: string, documentId: string, values: Record<string, unknown>) =>
  updateRow(db, 'personal_page_documents', 'document_id', ws, documentId, values);

export async function upsertDocument(
  db: PersonalPagesDb,
  ws: string,
  doc: {
    documentId: string;
    title: string;
    documentType: string;
    parentFolderId: string | null;
    editorId: string | null;
    fileExtension: string | null;
  },
): Promise<void> {
  const now = new Date();
  // Re-registering an existing id refreshes its metadata; the body, its
  // version and the trash state are left alone.
  await db.query(
    `INSERT INTO personal_page_documents
       (workspace_path, document_id, title, document_type, editor_id, file_extension,
        metadata_version, parent_folder_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 2, $7, $8, $8)
     ON CONFLICT (workspace_path, document_id) DO UPDATE SET
       title = EXCLUDED.title,
       document_type = EXCLUDED.document_type,
       editor_id = EXCLUDED.editor_id,
       file_extension = EXCLUDED.file_extension,
       parent_folder_id = EXCLUDED.parent_folder_id,
       updated_at = EXCLUDED.updated_at`,
    [ws, doc.documentId, doc.title, doc.documentType, doc.editorId, doc.fileExtension, doc.parentFolderId, now],
  );
}

export async function upsertTypePlacement(
  db: PersonalPagesDb,
  ws: string,
  placement: { typeId: string; parentFolderId: string | null; sortOrder: number },
): Promise<void> {
  const now = new Date();
  await db.query(
    `INSERT INTO personal_page_type_placements
       (workspace_path, type_id, parent_folder_id, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (workspace_path, type_id) DO UPDATE SET
       parent_folder_id = EXCLUDED.parent_folder_id,
       sort_order = EXCLUDED.sort_order,
       updated_at = EXCLUDED.updated_at`,
    [ws, placement.typeId, placement.parentFolderId, placement.sortOrder, now],
  );
}

export async function deleteDocument(db: PersonalPagesDb, ws: string, documentId: string): Promise<void> {
  await db.query(
    `DELETE FROM personal_page_documents WHERE workspace_path = $1 AND document_id = $2`,
    [ws, documentId],
  );
}

export async function deleteTypePlacement(db: PersonalPagesDb, ws: string, typeId: string): Promise<void> {
  await db.query(
    `DELETE FROM personal_page_type_placements WHERE workspace_path = $1 AND type_id = $2`,
    [ws, typeId],
  );
}

/**
 * Remove a folder, its descendants and everything placed in them, all or
 * nothing. Membership is computed by each statement inside the transaction,
 * never captured beforehand: a folder moved out of the subtree before the
 * transaction takes the write lock is no longer a member and survives.
 * `UNION` (not `UNION ALL`) stops the walk on a corrupt parent cycle.
 */
export async function deleteFolderSubtree(db: PersonalPagesDb, ws: string, rootFolderId: string): Promise<void> {
  const subtree = `WITH RECURSIVE subtree(folder_id) AS (
      SELECT folder_id FROM personal_page_folders WHERE workspace_path = $1 AND folder_id = $2
      UNION
      SELECT f.folder_id FROM personal_page_folders f
      JOIN subtree s ON f.parent_folder_id = s.folder_id
      WHERE f.workspace_path = $1
    )`;
  const params = [ws, rootFolderId];
  await db.runTransaction([
    {
      sql: `${subtree} DELETE FROM personal_page_documents
            WHERE workspace_path = $1 AND parent_folder_id IN (SELECT folder_id FROM subtree)`,
      params,
    },
    {
      sql: `${subtree} DELETE FROM personal_page_type_placements
            WHERE workspace_path = $1 AND parent_folder_id IN (SELECT folder_id FROM subtree)`,
      params,
    },
    {
      sql: `${subtree} DELETE FROM personal_page_folders
            WHERE workspace_path = $1 AND folder_id IN (SELECT folder_id FROM subtree)`,
      params,
    },
  ]);
}

export async function readBody(
  db: PersonalPagesDb,
  ws: string,
  documentId: string,
): Promise<{ content: string; version: number } | null> {
  const { rows } = await db.query<{ body: string | null; body_version: number | string }>(
    `SELECT body, body_version FROM personal_page_documents WHERE workspace_path = $1 AND document_id = $2`,
    [ws, documentId],
  );
  const row = rows[0];
  return row ? { content: row.body ?? '', version: Number(row.body_version) } : null;
}

/**
 * Write a body, conditionally on `expectedVersion` when one is given. The
 * check and the write are one statement, so a concurrent writer cannot slip
 * between them. Returns the new version, or null when the condition failed.
 */
export async function writeBody(
  db: PersonalPagesDb,
  ws: string,
  documentId: string,
  content: string,
  expectedVersion: number | undefined,
): Promise<number | null> {
  const conditional = expectedVersion !== undefined;
  const { rows } = await db.query<{ body_version: number | string }>(
    `UPDATE personal_page_documents
     SET body = $3, body_version = body_version + 1, updated_at = $4
     WHERE workspace_path = $1 AND document_id = $2${conditional ? ' AND body_version = $5' : ''}
     RETURNING body_version`,
    conditional ? [ws, documentId, content, new Date(), expectedVersion] : [ws, documentId, content, new Date()],
  );
  return rows[0] ? Number(rows[0].body_version) : null;
}
