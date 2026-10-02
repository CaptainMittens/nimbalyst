/**
 * Central listener for Personal pages changes pushed by main.
 *
 * `personal-pages:changed { workspacePath }` bumps a per-workspace revision
 * counter; each `PersonalPagesDataSource` watches its workspace's counter and
 * re-reads the snapshot. One IPC subscription per window, however many
 * sessions are mounted.
 *
 * Installed once. `App.tsx` may call `initPersonalPagesListeners()` with the
 * other listeners; the data source also calls it, so a Personal section works
 * whichever runs first.
 */

import { atom } from 'jotai';
import { atomFamily } from '../debug/atomFamilyRegistry';
// The store singleton, not the `store/index` barrel, which would drag every
// renderer atom module in behind it.
import { store } from '@nimbalyst/runtime/store';

export const personalPagesRevisionAtomFamily = atomFamily((_workspacePath: string) => atom(0));

let installedCleanup: (() => void) | null = null;

export function initPersonalPagesListeners(): () => void {
  if (installedCleanup) return installedCleanup;
  const unsubscribe = window.electronAPI.on(
    'personal-pages:changed',
    (payload: { workspacePath?: string } | undefined) => {
      const workspacePath = payload?.workspacePath;
      if (!workspacePath) return;
      store.set(personalPagesRevisionAtomFamily(workspacePath), (revision) => revision + 1);
    },
  );
  installedCleanup = () => {
    unsubscribe?.();
    installedCleanup = null;
  };
  return installedCleanup;
}
