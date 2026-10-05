/**
 * A tracker view drawn live from the items, in its own mode with its own
 * filters -- e.g. a type page's built-in "All" table. The host mounts it inside
 * a `TrackersUIProvider` and passes how to open the view and an item.
 *
 * Loaded lazily (`LazyTrackerViewEmbed`): it pulls in the list, grid and board
 * surfaces, and a surface that shows no view must not pay for them.
 */
import { type JSX } from 'react';
import { type SavedView } from '../../trackers/index';
import { type TrackerGridDerivedColumn } from '../grid/TrackerGridSurface';
export interface TrackerViewEmbedProps {
    /** A view the host already holds, saved or synthetic (e.g. a type page's built-in "All"). */
    view: SavedView;
    onOpenAsTable?: (view: SavedView) => void;
    onOpenItem?: (itemId: string) => void;
    /**
     * `card` is the bordered block a document embeds at a fixed height; `page`
     * drops the card chrome and fills its container, for a tab that is the view.
     */
    variant?: 'card' | 'page';
    /** Body height in pixels for the `card` variant. */
    height?: number;
    /** Read-only columns after the fields, in table mode (a type page's Where). */
    derivedColumns?: readonly TrackerGridDerivedColumn[];
    /**
     * Items of any of these types, instead of the view's one type: a type page
     * lists its subtypes' items too. The view's type still picks the columns.
     */
    typeIds?: readonly string[];
    /** Table cells edit their items unless this is set (or the host has no data source). */
    readOnly?: boolean;
}
/** Draws a view the caller supplies, without looking it up among the saved views. */
export declare function TrackerViewEmbed({ view, onOpenAsTable, onOpenItem, variant, height, derivedColumns, typeIds, readOnly, }: TrackerViewEmbedProps): JSX.Element;
