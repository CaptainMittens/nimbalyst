/**
 * Context menu entries for the one page tree (documents nest in documents):
 * the page head block (New page inside, Set type, Rename, Move to..., Copy
 * link), the page delete entry with its child count, and the typed-page
 * entries. The sidebar keeps its per-document extras (favorite, history, local
 * source) between the head and the delete entry. Lazy-loaded (and preloaded
 * once a tree is a page tree) to keep it out of the docs-ui eager bundle.
 */
import React from 'react';
export declare const CollabMenuButton: React.FC<{
    icon: string;
    label: string;
    trailing?: string;
    disabled?: boolean;
    danger?: boolean;
    className?: string;
    title?: string;
    onClick: () => void;
}>;
export declare const CollabPageMenuHead: React.FC<{
    onNewPageInside: () => void;
    /** Absent until the host can turn a page into a typed page in place. */
    onSetType?: () => void;
    onRename: () => void;
    onMoveTo: () => void;
    onCopyLink: () => void;
    copyLinkDisabled?: boolean;
}>;
/** A page with children is deleted with its subtree; a leaf goes to Trash. */
export declare const CollabPageDeleteEntry: React.FC<{
    childCount: number;
    onDelete: () => void;
}>;
/** A typed page's row: move it anywhere, or back under its type. */
export declare const CollabItemMenu: React.FC<{
    placed: boolean;
    onMoveTo: () => void;
    onBackUnderType: () => void;
}>;
