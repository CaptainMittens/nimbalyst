/**
 * SQL for personal pages (schemas 0049 and 0050). Every query here runs on both
 * PGLite and better-sqlite3: whole columns only, `$N` params, Date objects bound
 * for timestamps and read back through `toMillis()`.
 *
 * Since 0050 the tree is one page tree: a document's `parent_folder_id` names
 * its parent page. `personal_page_folders` is only the record of the tree
 * before that migration and is never read or written here.
 */
import type { SharedDocument, SharedItemPlacement, SharedTypePlacement } from '@nimbalyst/collab-client/docs';
import { toMillis } from '../../utils/timestampUtils';

export interface PersonalPagesDb {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  runTransaction(statements: Array<{ sql: string; params?: any[] }>): Promise<void>;
}

interface DocumentRow {
  document_id: string;
  title: string;
  document_type: string;
  editor_id: string | null;
  file_extension: string | null;
  metadata_version: number | string | null;
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

interface ItemPlacementRow {
  item_id: string;
  parent_id: string | null;
  sort_order: number | string;
  created_at: unknown;
  updated_at: unknown;
}

const LOCAL_AUTHOR = 'local';
/** Mirrors `TYPE_PAGE_DOCUMENT_PREFIX` in collab-client (not imported: main must not load that module graph). */
const TYPE_PAGE_PREFIX = 'type-page:';

export async function listDocuments(db: PersonalPagesDb, ws: string): Promise<SharedDocument[]> {
  const { rows } = await db.query<DocumentRow>(
    `SELECT document_id, title, document_type, editor_id, file_extension, metadata_version, parent_folder_id,
            created_at, updated_at, trashed_at
     FROM personal_page_documents WHERE workspace_path = $1 ORDER BY created_at, document_id`,
    [ws],
  );
  return rows.map((row) => ({
    documentId: row.document_id,
    teamProjectId: null,
    title: row.title,
    documentType: row.document_type,
    // A page converted from a folder has no type metadata; it is inferred.
    ...(Number(row.metadata_version) === 2 ? { metadataVersion: 2 as const } : {}),
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

export async function listItemPlacements(db: PersonalPagesDb, ws: string): Promise<SharedItemPlacement[]> {
  const { rows } = await db.query<ItemPlacementRow>(
    `SELECT item_id, parent_id, sort_order, created_at, updated_at
     FROM personal_page_item_placements WHERE workspace_path = $1 ORDER BY sort_order, item_id`,
    [ws],
  );
  return rows.map((row) => ({
    itemId: row.item_id,
    projectId: null,
    parentId: row.parent_id ?? null,
    sortOrder: Number(row.sort_order),
    createdBy: LOCAL_AUTHOR,
    createdAt: toMillis(row.created_at) ?? 0,
    updatedAt: toMillis(row.updated_at) ?? 0,
  }));
}

/** Update named columns of one row. Column names come from callers in this module only. */
async function updateRow(
  db: PersonalPagesDb,
  table: 'personal_page_documents',
  keyColumn: 'document_id',
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
  // version and the trash state are left alone. A page registered without type
  // metadata (one made as a container) records none, like a converted folder.
  const metadataVersion = doc.editorId || doc.fileExtension ? 2 : null;
  await db.query(
    `INSERT INTO personal_page_documents
       (workspace_path, document_id, title, document_type, editor_id, file_extension,
        metadata_version, parent_folder_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $9, $7, $8, $8)
     ON CONFLICT (workspace_path, document_id) DO UPDATE SET
       title = EXCLUDED.title,
       document_type = EXCLUDED.document_type,
       editor_id = EXCLUDED.editor_id,
       file_extension = EXCLUDED.file_extension,
       metadata_version = EXCLUDED.metadata_version,
       parent_folder_id = EXCLUDED.parent_folder_id,
       updated_at = EXCLUDED.updated_at`,
    [ws, doc.documentId, doc.title, doc.documentType, doc.editorId, doc.fileExtension, doc.parentFolderId, now, metadataVersion],
  );
}

export async function upsertTypePlacement(
  db: PersonalPagesDb,
  ws: string,
  placement: { typeId: string; parentFolderId: string | null; sortOrder: number },
): Promise<void> {
  const now = new Date();
  // The type page's prose (`type-page:<typeId>`) belongs to the type and moves
  // with it in the same transaction, so removing the page the type used to sit
  // under cannot take the prose along.
  await db.runTransaction([
    {
      sql: `INSERT INTO personal_page_type_placements
              (workspace_path, type_id, parent_folder_id, sort_order, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $5)
            ON CONFLICT (workspace_path, type_id) DO UPDATE SET
              parent_folder_id = EXCLUDED.parent_folder_id,
              sort_order = EXCLUDED.sort_order,
              updated_at = EXCLUDED.updated_at`,
      params: [ws, placement.typeId, placement.parentFolderId, placement.sortOrder, now],
    },
    {
      sql: `UPDATE personal_page_documents SET parent_folder_id = $3, updated_at = $4
            WHERE workspace_path = $1 AND document_id = $2`,
      params: [ws, `${TYPE_PAGE_PREFIX}${placement.typeId}`, placement.parentFolderId, now],
    },
  ]);
}

export async function upsertItemPlacement(
  db: PersonalPagesDb,
  ws: string,
  placement: { itemId: string; parentId: string | null; sortOrder: number },
): Promise<void> {
  const now = new Date();
  await db.query(
    `INSERT INTO personal_page_item_placements
       (workspace_path, item_id, parent_id, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (workspace_path, item_id) DO UPDATE SET
       parent_id = EXCLUDED.parent_id,
       sort_order = EXCLUDED.sort_order,
       updated_at = EXCLUDED.updated_at`,
    [ws, placement.itemId, placement.parentId, placement.sortOrder, now],
  );
}

export async function deleteItemPlacement(db: PersonalPagesDb, ws: string, itemId: string): Promise<void> {
  await db.query(
    `DELETE FROM personal_page_item_placements WHERE workspace_path = $1 AND item_id = $2`,
    [ws, itemId],
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
 * Remove a page and every page below it, all or nothing, the way a folder
 * delete worked before pages replaced folders. Types and typed pages placed
 * under a removed page lose their placement (they fall back to root and under
 * their type); no tracker item is touched. A type page's prose goes only when
 * its type is placed inside the subtree; otherwise it is first moved to its
 * type's parent page (or root), never deleted. Membership is computed by each
 * statement inside the transaction, never captured beforehand: a page moved
 * out of the subtree before the transaction takes the write lock is no longer
 * a member and survives. `UNION` (not `UNION ALL`) stops the walk on a corrupt
 * parent cycle.
 */
export async function deletePageSubtree(db: PersonalPagesDb, ws: string, rootPageId: string): Promise<void> {
  const subtree = `WITH RECURSIVE subtree(document_id) AS (
      SELECT document_id FROM personal_page_documents WHERE workspace_path = $1 AND document_id = $2
      UNION
      SELECT d.document_id FROM personal_page_documents d
      JOIN subtree s ON d.parent_folder_id = s.document_id
      WHERE d.workspace_path = $1
    )`;
  const params = [ws, rootPageId];
  await db.runTransaction([
    {
      // Must run while the type placements still exist.
      sql: `${subtree} UPDATE personal_page_documents
            SET parent_folder_id = (
              SELECT tp.parent_folder_id FROM personal_page_type_placements tp
              WHERE tp.workspace_path = $1 AND '${TYPE_PAGE_PREFIX}' || tp.type_id = personal_page_documents.document_id
                AND tp.parent_folder_id NOT IN (SELECT document_id FROM subtree)
            )
            WHERE workspace_path = $1
              AND document_id LIKE '${TYPE_PAGE_PREFIX}%'
              AND parent_folder_id IN (SELECT document_id FROM subtree)
              AND NOT EXISTS (
                SELECT 1 FROM personal_page_type_placements tp
                WHERE tp.workspace_path = $1 AND '${TYPE_PAGE_PREFIX}' || tp.type_id = personal_page_documents.document_id
                  AND tp.parent_folder_id IN (SELECT document_id FROM subtree)
              )`,
      params,
    },
    {
      sql: `${subtree} DELETE FROM personal_page_type_placements
            WHERE workspace_path = $1 AND parent_folder_id IN (SELECT document_id FROM subtree)`,
      params,
    },
    {
      sql: `${subtree} DELETE FROM personal_page_item_placements
            WHERE workspace_path = $1 AND parent_id IN (SELECT document_id FROM subtree)`,
      params,
    },
    {
      sql: `${subtree} DELETE FROM personal_page_documents
            WHERE workspace_path = $1 AND document_id IN (SELECT document_id FROM subtree)`,
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
