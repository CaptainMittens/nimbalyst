/**
 * Personal pages: folders, documents and tracker-type placements that live in
 * the app database for one workspace, with no account. The command surface is
 * the shared-docs `CollabDocsCommand` union, so the page tree can drive this
 * store and a team room the same way. Documents keep the shared-docs model and
 * stable ids so a later promotion to the team can follow
 * `publishTrackerCreation.ts`; `publication_status` stays 'local' until then.
 *
 * Rows are only deleted by `remove-document` and `remove-folder`; trash is the
 * default path for a document.
 */
import { BrowserWindow } from 'electron';
import type {
  CollabDocsCommand,
  CollabDocsCommandResult,
  SharedDocument,
  SharedFolder,
  SharedTypePlacement,
} from '@nimbalyst/collab-client/docs';
import { getDatabase } from '../database/initialize';
import { historyManager, type HistoryManager } from '../HistoryManager';
import { safeHandle } from '../utils/ipcRegistry';
import { logger } from '../utils/logger';
import * as store from './personalPages/personalPagesStore';

export interface PersonalPagesSnapshot {
  items: SharedDocument[];
  containers: SharedFolder[];
  typePlacements: SharedTypePlacement[];
}

export type PersonalBodyWriteResult =
  | { version: number }
  | { conflict: true; version: number; content: string };

export interface PersonalPagesDeps {
  db?: () => store.PersonalPagesDb | null;
  history?: Pick<HistoryManager, 'createSnapshot'>;
  notify?: (workspacePath: string) => void;
}

export function personalDocHistoryKey(documentId: string): string {
  return `personal-doc://${documentId}`;
}

function broadcastChanged(workspacePath: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('personal-pages:changed', { workspacePath });
  }
}

function requireWorkspace(workspacePath: string): string {
  if (!workspacePath || typeof workspacePath !== 'string') throw new Error('workspacePath is required');
  return workspacePath;
}

function requireId(value: unknown, name: string): string {
  if (!value || typeof value !== 'string') throw new Error(`${name} is required`);
  return value;
}

const OK: CollabDocsCommandResult = { ok: true };

export class PersonalPagesService {
  private readonly getDb: () => store.PersonalPagesDb | null;
  private readonly history: Pick<HistoryManager, 'createSnapshot'>;
  private readonly notify: (workspacePath: string) => void;
  private disposed = false;

  constructor(deps: PersonalPagesDeps = {}) {
    this.getDb = deps.db ?? (() => getDatabase() as store.PersonalPagesDb | null);
    this.history = deps.history ?? historyManager;
    this.notify = deps.notify ?? broadcastChanged;
  }

  dispose(): void {
    this.disposed = true;
  }

  private db(): store.PersonalPagesDb {
    if (this.disposed) throw new Error('PersonalPagesService is disposed');
    const db = this.getDb();
    if (!db) throw new Error('Database not initialized');
    return db;
  }

  async snapshot(workspacePath: string): Promise<PersonalPagesSnapshot> {
    const ws = requireWorkspace(workspacePath);
    const db = this.db();
    const [items, containers, typePlacements] = await Promise.all([
      store.listDocuments(db, ws),
      store.listFolders(db, ws),
      store.listTypePlacements(db, ws),
    ]);
    return { items, containers, typePlacements };
  }

  async command(workspacePath: string, command: CollabDocsCommand): Promise<CollabDocsCommandResult> {
    const ws = requireWorkspace(workspacePath);
    if (!command || typeof command !== 'object') throw new Error('command is required');
    const db = this.db();
    switch (command.type) {
      case 'refresh-folders':
      case 'refresh-type-placements':
      case 'reconnect':
        return OK;
      case 'register-document':
        await this.assertFolder(db, ws, command.parentFolderId ?? null);
        await store.upsertDocument(db, ws, {
          documentId: requireId(command.documentId, 'documentId'),
          title: command.title ?? '',
          documentType: requireId(command.documentType, 'documentType'),
          parentFolderId: command.parentFolderId ?? null,
          editorId: command.metadata?.editorId ?? null,
          fileExtension: command.metadata?.fileExtension ?? null,
        });
        break;
      case 'update-document-title':
        await this.mustUpdateDocument(db, ws, command.documentId, { title: command.title ?? '' });
        break;
      case 'trash-document':
        await this.mustUpdateDocument(db, ws, command.documentId, {
          trashed_at: new Date(Number.isFinite(command.trashedAt) ? command.trashedAt : Date.now()),
        });
        break;
      case 'restore-document':
        await this.mustUpdateDocument(db, ws, command.documentId, { trashed_at: null });
        break;
      case 'move-document':
        await this.assertFolder(db, ws, command.parentFolderId ?? null);
        await this.mustUpdateDocument(db, ws, command.documentId, { parent_folder_id: command.parentFolderId ?? null });
        break;
      case 'remove-document':
        await store.deleteDocument(db, ws, requireId(command.documentId, 'documentId'));
        break;
      case 'register-folder': {
        const folderId = requireId(command.folderId, 'folderId');
        await this.assertFolderParent(db, ws, folderId, command.parentFolderId ?? null);
        await store.upsertFolder(db, ws, {
          folderId,
          name: (command.name ?? '').trim().slice(0, 120),
          parentFolderId: command.parentFolderId ?? null,
          sortOrder: Number.isFinite(command.sortOrder) ? command.sortOrder : 0,
        });
        break;
      }
      case 'rename-folder':
        await this.mustUpdateFolder(db, ws, command.folderId, { name: (command.name ?? '').trim().slice(0, 120) });
        break;
      case 'move-folder':
        await this.assertFolderParent(db, ws, requireId(command.folderId, 'folderId'), command.parentFolderId ?? null);
        await this.mustUpdateFolder(db, ws, command.folderId, { parent_folder_id: command.parentFolderId ?? null });
        break;
      case 'remove-folder':
        await store.deleteFolderSubtree(db, ws, requireId(command.folderId, 'folderId'));
        break;
      case 'set-type-placement':
        await this.assertFolder(db, ws, command.parentFolderId ?? null);
        await store.upsertTypePlacement(db, ws, {
          typeId: requireId(command.typeId, 'typeId'),
          parentFolderId: command.parentFolderId ?? null,
          sortOrder: Number.isFinite(command.sortOrder) ? command.sortOrder : 0,
        });
        break;
      case 'remove-type-placement':
        await store.deleteTypePlacement(db, ws, requireId(command.typeId, 'typeId'));
        break;
      default:
        throw new Error(`Unsupported personal pages command: ${(command as { type?: string }).type}`);
    }
    this.notify(ws);
    return OK;
  }

  async getBody(workspacePath: string, documentId: string): Promise<{ content: string; version: number } | null> {
    return store.readBody(this.db(), requireWorkspace(workspacePath), requireId(documentId, 'documentId'));
  }

  async updateBody(
    workspacePath: string,
    documentId: string,
    content: string,
    expectedVersion?: number,
  ): Promise<PersonalBodyWriteResult> {
    const ws = requireWorkspace(workspacePath);
    requireId(documentId, 'documentId');
    if (typeof content !== 'string') throw new Error('content must be a string');
    if (expectedVersion !== undefined && !Number.isInteger(expectedVersion)) {
      throw new Error('expectedVersion must be an integer');
    }
    const db = this.db();
    const version = await store.writeBody(db, ws, documentId, content, expectedVersion);
    if (version === null) {
      const current = await store.readBody(db, ws, documentId);
      if (!current) throw new Error(`Unknown personal document '${documentId}'`);
      return { conflict: true, version: current.version, content: current.content };
    }
    await this.recordSnapshot(ws, documentId, content);
    this.notify(ws);
    return { version };
  }

  /** Never throws: the body is already saved and a history failure must not fail the save. */
  private async recordSnapshot(ws: string, documentId: string, content: string): Promise<void> {
    try {
      await this.history.createSnapshot(personalDocHistoryKey(documentId), content, 'auto-save', 'Auto-save');
    } catch (error) {
      logger.main.error('[PersonalPagesService] Failed to snapshot personal document body:', { documentId, error });
    }
  }

  private async assertFolder(db: store.PersonalPagesDb, ws: string, folderId: string | null): Promise<SharedFolder[]> {
    const folders = await store.listFolders(db, ws);
    if (folderId !== null && !folders.some((folder) => folder.folderId === folderId)) {
      throw new Error(`Unknown personal folder '${folderId}'`);
    }
    return folders;
  }

  /** A folder's new parent must exist and must not be the folder or one of its descendants. */
  private async assertFolderParent(
    db: store.PersonalPagesDb,
    ws: string,
    folderId: string,
    parentFolderId: string | null,
  ): Promise<void> {
    const folders = await this.assertFolder(db, ws, parentFolderId);
    if (parentFolderId !== null && subtreeFolderIds(folders, folderId).includes(parentFolderId)) {
      throw new Error(`Refusing to move folder '${folderId}' into its own descendant (cycle)`);
    }
  }

  private async mustUpdateDocument(db: store.PersonalPagesDb, ws: string, documentId: string, values: Record<string, unknown>) {
    if (!(await store.updateDocument(db, ws, requireId(documentId, 'documentId'), values))) {
      throw new Error(`Unknown personal document '${documentId}'`);
    }
  }

  private async mustUpdateFolder(db: store.PersonalPagesDb, ws: string, folderId: string, values: Record<string, unknown>) {
    if (!(await store.updateFolder(db, ws, requireId(folderId, 'folderId'), values))) {
      throw new Error(`Unknown personal folder '${folderId}'`);
    }
  }
}

/** The folder and all its descendants, root first. */
export function subtreeFolderIds(folders: SharedFolder[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    const parent = folder.parentFolderId ?? null;
    if (parent === null) continue;
    children.set(parent, [...(children.get(parent) ?? []), folder.folderId]);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return out;
}

let service: PersonalPagesService | null = null;

export function initPersonalPagesService(): void {
  if (service) return;
  const instance = new PersonalPagesService();
  service = instance;
  safeHandle('personal-pages:snapshot', async (_event, workspacePath: string) => {
    return instance.snapshot(workspacePath);
  });
  safeHandle('personal-pages:command', async (_event, workspacePath: string, command: CollabDocsCommand) => {
    return instance.command(workspacePath, command);
  });
  safeHandle('personal-pages:get-body', async (_event, workspacePath: string, documentId: string) => {
    return instance.getBody(workspacePath, documentId);
  });
  safeHandle(
    'personal-pages:update-body',
    async (_event, workspacePath: string, documentId: string, content: string, expectedVersion?: number) => {
      return instance.updateBody(workspacePath, documentId, content, expectedVersion ?? undefined);
    },
  );
}
