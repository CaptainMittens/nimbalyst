/**
 * "Move to..." for the one page tree: pick the page a page or typed page
 * should live under, root, or (typed pages only) back under its type.
 * Lazy-loaded by the sidebar so it stays out of the docs-ui eager bundle.
 */
import React from 'react';
import { type SharedFolder } from '../docs/index';
import { type CollabPageMoveTarget } from './CollabTypeTreeRows';
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
export default function CollabPageMoveDialog({ name, pages, excludedIds, current, rootLabel, underTypeLabel, onConfirm, onCancel, }: CollabPageMoveDialogProps): React.JSX.Element;
