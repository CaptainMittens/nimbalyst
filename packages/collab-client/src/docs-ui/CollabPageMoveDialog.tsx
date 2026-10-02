/**
 * "Move to..." for the one page tree: pick the page a page or typed page
 * should live under, root, or (typed pages only) back under its type.
 * Lazy-loaded by the sidebar so it stays out of the docs-ui eager bundle.
 */
import React, { useMemo, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { flattenCollabFolderOptions, type SharedFolder } from '@nimbalyst/collab-client/docs';
import { UNDER_TYPE, type CollabPageMoveTarget } from './CollabTypeTreeRows';

export interface CollabPageMoveDialogProps {
  name: string;
  /** Pages, folder-shaped (see `projectPagesAsFolders`). */
  pages: SharedFolder[];
  /** Pages that cannot be the destination (the page and its subtree). */
  excludedIds: ReadonlySet<string>;
  current: CollabPageMoveTarget;
  rootLabel: string;
  /** Typed pages only: label for the "under its type" destination. */
  underTypeLabel?: string;
  onConfirm: (target: CollabPageMoveTarget) => void;
  onCancel: () => void;
}

export default function CollabPageMoveDialog({
  name,
  pages,
  excludedIds,
  current,
  rootLabel,
  underTypeLabel,
  onConfirm,
  onCancel,
}: CollabPageMoveDialogProps) {
  const [selected, setSelected] = useState<CollabPageMoveTarget>(current);
  const options = useMemo(() => [
    ...(underTypeLabel ? [{ folderId: UNDER_TYPE, name: underTypeLabel, depth: 0 }] : []),
    ...flattenCollabFolderOptions(pages).filter((option) => !option.folderId || !excludedIds.has(option.folderId)),
  ], [excludedIds, pages, underTypeLabel]);
  return (
    <div
      className="collab-page-move-overlay fixed inset-0 z-[10000] flex items-center justify-center bg-black/60"
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div
        className="collab-page-move-dialog w-[420px] max-w-[92%] bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-xl shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={`Move ${name}`}
        onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}
      >
        <h2 className="m-0 px-5 pt-4 pb-3 border-b border-[var(--nim-border)] text-[14px] font-semibold text-[var(--nim-text)] truncate">
          Move “{name}”
        </h2>
        <div
          className="nim-scrollbar m-4 max-h-[260px] overflow-y-auto rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] p-1"
          role="listbox"
          aria-label="Destination page"
        >
          {options.map((option) => {
            const isSelected = option.folderId === selected;
            const icon = option.folderId === UNDER_TYPE ? 'table' : option.folderId === null ? 'workspaces' : 'description';
            return (
              <div
                key={option.folderId ?? 'root'}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                className={`collab-page-move-option flex items-center gap-1.5 rounded px-2 py-1.5 text-[13px] cursor-pointer select-none text-[var(--nim-text)] ${
                  isSelected ? 'bg-[var(--nim-primary)]/20' : 'hover:bg-[var(--nim-bg-tertiary)]'
                }`}
                style={{ paddingLeft: 8 + option.depth * 18 }}
                data-page-option={option.folderId ?? 'root'}
                onClick={() => setSelected(option.folderId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelected(option.folderId);
                  }
                }}
              >
                <MaterialSymbol icon={icon} size={18} className={isSelected ? 'text-[var(--nim-primary)]' : 'text-[var(--nim-text-muted)]'} />
                <span className="flex-1 truncate">{option.folderId === null ? rootLabel : option.name}</span>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--nim-border)]">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 bg-transparent rounded-md text-[var(--nim-text-muted)] text-[13px] hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)]"
          >
            Cancel
          </button>
          <button
            type="button"
            className="collab-page-move-confirm px-3.5 py-1.5 rounded-md text-[13px] font-medium bg-[var(--nim-primary)] text-[#0f1115] disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={selected === current}
            onClick={() => onConfirm(selected)}
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}
