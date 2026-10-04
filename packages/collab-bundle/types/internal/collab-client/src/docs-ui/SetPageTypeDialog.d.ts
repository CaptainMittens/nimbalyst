/**
 * The type picker for "Set type" on a page: the section's own creatable types,
 * singular names, one click to convert. The resolver says which types take
 * new pages, so this bundle never reads the tracker registry.
 */
import React from 'react';
import type { CollabTypeTreeResolver } from '../docs/collabTree';
export interface SetPageTypeDialogProps {
    pageTitle: string;
    resolver: CollabTypeTreeResolver;
    running: boolean;
    onPick: (typeId: string) => void;
    onClose: () => void;
}
export declare function SetPageTypeDialog({ pageTitle, resolver, running, onPick, onClose }: SetPageTypeDialogProps): React.ReactPortal;
