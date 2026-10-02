/**
 * Context menu entries for the one page tree (documents nest in documents):
 * the page head block (New page inside, Set type, Rename, Move to..., Copy
 * link), the page delete entry with its child count, and the typed-page
 * entries. The sidebar keeps its per-document extras (favorite, history, local
 * source) between the head and the delete entry. Lazy-loaded (and preloaded
 * once a tree is a page tree) to keep it out of the docs-ui eager bundle.
 */
import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';

export const CollabMenuButton: React.FC<{
  icon: string;
  label: string;
  trailing?: string;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
  title?: string;
  onClick: () => void;
}> = ({ icon, label, trailing, disabled, danger, className, title, onClick }) => (
  <button
    type="button"
    className={`${className ?? ''} w-full flex items-center gap-2.5 px-3 py-1.5 rounded border-none bg-transparent cursor-pointer transition-colors text-left hover:bg-nim-hover disabled:opacity-50 disabled:cursor-not-allowed ${danger ? 'text-[var(--nim-error)]' : 'text-nim'}`}
    disabled={disabled}
    title={title}
    onClick={onClick}
  >
    <MaterialSymbol icon={icon} size={18} />
    <span className="flex-1">{label}</span>
    {trailing && <span className="ml-3 text-[11px] text-[var(--nim-text-faint)]">{trailing}</span>}
  </button>
);

const Separator = () => <div className="my-1 border-t border-[var(--nim-border)]" />;

export const CollabPageMenuHead: React.FC<{
  onNewPageInside: () => void;
  /** Absent until the host can turn a page into a typed page in place. */
  onSetType?: () => void;
  /** Absent without tracker data (no types to place). */
  onPlaceType?: () => void;
  onRename: () => void;
  onMoveTo: () => void;
  onCopyLink: () => void;
  copyLinkDisabled?: boolean;
}> = ({ onNewPageInside, onSetType, onPlaceType, onRename, onMoveTo, onCopyLink, copyLinkDisabled }) => (
  <>
    <CollabMenuButton className="collab-page-new-inside" icon="note_add" label="New page" trailing="inside" onClick={onNewPageInside} />
    {onPlaceType && (
      <CollabMenuButton className="collab-place-type-action" icon="table" label="Place type..." trailing="inside" onClick={onPlaceType} />
    )}
    <CollabMenuButton
      className="collab-page-set-type"
      icon="category"
      label="Set type"
      disabled={!onSetType}
      onClick={() => onSetType?.()}
    />
    <CollabMenuButton icon="edit" label="Rename" onClick={onRename} />
    <CollabMenuButton className="collab-page-move-to" icon="drive_file_move" label="Move to..." onClick={onMoveTo} />
    <Separator />
    <CollabMenuButton icon="link" label="Copy link" disabled={copyLinkDisabled} onClick={onCopyLink} />
  </>
);

/** A page with children is deleted with its subtree; a leaf goes to Trash. */
export const CollabPageDeleteEntry: React.FC<{ childCount: number; onDelete: () => void }> = ({ childCount, onDelete }) => (
  <>
    <Separator />
    <CollabMenuButton
      className="collab-page-delete"
      icon="delete"
      danger
      label={childCount > 0 ? 'Delete' : 'Move to Trash'}
      trailing={childCount > 0 ? `${childCount} child page${childCount === 1 ? '' : 's'}` : undefined}
      onClick={onDelete}
    />
  </>
);

/** A typed page's row: move it anywhere, or back under its type. */
export const CollabItemMenu: React.FC<{
  placed: boolean;
  onMoveTo: () => void;
  onBackUnderType: () => void;
}> = ({ placed, onMoveTo, onBackUnderType }) => (
  <>
    <CollabMenuButton className="collab-item-move-to" icon="drive_file_move" label="Move to..." onClick={onMoveTo} />
    {placed && (
      <CollabMenuButton className="collab-item-back-under-type" icon="table" label="Back under its type" onClick={onBackUnderType} />
    )}
  </>
);
