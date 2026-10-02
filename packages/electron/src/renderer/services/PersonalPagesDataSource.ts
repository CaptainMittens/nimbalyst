/**
 * Personal pages data source: the Pages tree's Personal section, stored in the
 * local database by main and reached over generic IPC. It works with no
 * account, no team and no network, so its status is always `connected`.
 *
 * - `personal-pages:snapshot(workspacePath)` returns `{ items, containers, typePlacements }`.
 * - `personal-pages:command(workspacePath, cmd)` takes a `CollabDocsCommand` verbatim.
 * - `personal-pages:changed { workspacePath }` arrives through the central
 *   listener and is answered with a fresh `snapshot` change.
 */

import type { Unsubscribe } from '@nimbalyst/collab-client/core';
import type {
  CollabDocsCommand,
  CollabDocsCommandResult,
  CollabDocsDataChange,
  CollabDocsDataSource,
  CollabDocsSnapshot,
} from '@nimbalyst/collab-client/docs';
import { store } from '@nimbalyst/runtime/store';
import {
  initPersonalPagesListeners,
  personalPagesRevisionAtomFamily,
} from '../store/listeners/personalPagesListeners';

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const ipc = window.electronAPI?.invoke;
  if (!ipc) return Promise.reject(new Error('Personal pages are unavailable in this window'));
  return ipc(channel, ...args) as Promise<T>;
}

export class PersonalPagesDataSource implements CollabDocsDataSource {
  private readonly listeners = new Set<(change: CollabDocsDataChange) => void>();
  private revisionUnsubscribe: Unsubscribe | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private refreshQueued = false;
  private disposed = false;
  /** Ids in the last snapshot read, to name what a later one dropped. */
  private lastItemIds = new Set<string>();
  private lastContainerIds = new Set<string>();

  constructor(private readonly workspacePath: string) {}

  async snapshot(): Promise<CollabDocsSnapshot> {
    const snapshot = await invoke<Partial<CollabDocsSnapshot> | null>(
      'personal-pages:snapshot',
      this.workspacePath,
    );
    const result = {
      items: snapshot?.items ?? [],
      containers: snapshot?.containers ?? [],
      typePlacements: snapshot?.typePlacements ?? [],
    };
    this.lastItemIds = new Set(result.items.map((item) => item.documentId));
    this.lastContainerIds = new Set(result.containers.map((container) => container.folderId));
    return result;
  }

  subscribe(cb: (change: CollabDocsDataChange) => void): Unsubscribe {
    this.listeners.add(cb);
    // The session's status starts `disconnected` and only a status change moves
    // it; the sidebar refuses renames and moves until it reads `connected`.
    cb({ type: 'status', status: 'connected' });
    if (!this.revisionUnsubscribe && !this.disposed) {
      initPersonalPagesListeners();
      this.revisionUnsubscribe = store.sub(
        personalPagesRevisionAtomFamily(this.workspacePath),
        () => { void this.refresh(); },
      );
    }
    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0) this.stopWatching();
    };
  }

  async command(cmd: CollabDocsCommand): Promise<CollabDocsCommandResult> {
    const result = await invoke<Partial<CollabDocsCommandResult> | null>(
      'personal-pages:command',
      this.workspacePath,
      cmd,
    );
    // Main throws on a refused write, which rejects this call. Anything but an
    // explicit `ok` is a refusal too: never report a write that did not land.
    if (result?.ok !== true) {
      const reason = (result as { error?: unknown } | null)?.error;
      throw new Error(typeof reason === 'string' && reason
        ? reason
        : `Personal pages refused ${cmd.type}`);
    }
    // There is no server to wait on: a local write is committed when main
    // answers, so an accepted registration is confirmed.
    return {
      ...result,
      ok: true,
      ...(cmd.type === 'register-document' ? { registrationAcked: true } : {}),
    };
  }

  status(): 'connected' {
    return 'connected';
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.stopWatching();
  }

  /** One snapshot read at a time; a change during a read schedules one more. */
  private refresh(): Promise<void> {
    if (this.refreshInFlight) {
      this.refreshQueued = true;
      return this.refreshInFlight;
    }
    this.refreshInFlight = (async () => {
      try {
        do {
          this.refreshQueued = false;
          const previousItemIds = this.lastItemIds;
          const previousContainerIds = this.lastContainerIds;
          const snapshot = await this.snapshot();
          if (this.disposed) return;
          // The session merges a snapshot into what it holds and keeps rows the
          // snapshot lacks, so a page or folder deleted in another window has to
          // be named as removed or it stays in the tree. Placements need nothing
          // extra: the snapshot's list replaces the session's.
          const itemIds = [...previousItemIds].filter((id) => !this.lastItemIds.has(id));
          const containerIds = [...previousContainerIds].filter((id) => !this.lastContainerIds.has(id));
          const changes: CollabDocsDataChange[] = [{ type: 'snapshot', snapshot }];
          if (itemIds.length > 0) changes.push({ type: 'items-removed', itemIds });
          if (containerIds.length > 0) changes.push({ type: 'containers-removed', containerIds, itemIds: [] });
          for (const change of changes) {
            for (const listener of this.listeners) listener(change);
          }
        } while (this.refreshQueued && !this.disposed);
      } catch (error) {
        console.error('[PersonalPagesDataSource] Failed to refresh personal pages:', error);
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  private stopWatching(): void {
    this.revisionUnsubscribe?.();
    this.revisionUnsubscribe = null;
  }
}
