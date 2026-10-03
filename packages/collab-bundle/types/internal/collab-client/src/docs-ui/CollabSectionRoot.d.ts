/**
 * A Pages section's root: the menu that empty tree space and the section
 * header open (New page, then Place type...), and the messages an empty or
 * filtered-out tree shows instead of rows. A page started from any of these
 * lands at the section root.
 */
import React from 'react';
export declare const CollabSectionMenu: React.FC<{
    x: number;
    y: number;
    onNewPage: () => void;
    /** Absent without tracker data (no types to place). */
    onPlaceType?: () => void;
    onClose: () => void;
}>;
export type CollabTreeEmptyReason = 'empty' | 'search' | 'favorites' | 'updated';
export declare const CollabTreeEmptyState: React.FC<{
    reason: CollabTreeEmptyReason;
    personal: boolean;
    scopeAvailable: boolean;
    searchQuery: string;
    /** Absent when no page type can be created here. */
    onNewPage?: () => void;
}>;
