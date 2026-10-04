/**
 * A typed page laid out as a document page, not the tracker detail pane. Top
 * to bottom: the crumb (where the page sits in the Pages tree), the title, one
 * row of the type chip and the single-valued fields, the body, and the Links
 * section.
 *
 * Shared by the desktop and the web console. The host owns the data: it
 * passes the item, the crumb and the field values, saves edits through
 * `onRename` and `onUpdateField`, renders the body (`renderBody`), and says
 * where the links come from (`linksSource`).
 */
import React from 'react';
import type { FieldDefinition } from '../../../../tracker-schema/src/browser';
import type { TrackerRecord } from '../../../../runtime/src/core/TrackerRecord';
import { TrackerFieldPills } from '../../../../runtime/src/plugins/TrackerPlugin/components/TrackerFieldPills';
import type { PageLinksSource } from './pageLinks';
import type { TrackerPageCrumb } from './trackerPageCrumb';
import './TrackerPageView.css';
type FieldPillsProps = React.ComponentProps<typeof TrackerFieldPills>;
export interface TrackerPageViewProps {
    /** Null while the item is loading or after it is gone. */
    item: TrackerRecord | null;
    /** Whether the host has loaded its items: a missing item then reads as gone. */
    loaded: boolean;
    /** Where the page sits; `section` ("Personal") leads the crumb when set. */
    crumb: TrackerPageCrumb & {
        section?: string | null;
    };
    editable: boolean;
    /** The title as it is being edited; the host saves it. */
    title: string;
    onRename: (title: string) => void;
    /** The item's stored field values, label fields still wrapped. */
    fieldValues: Record<string, unknown>;
    onUpdateField: (field: FieldDefinition, value: unknown) => void;
    teamMembers?: FieldPillsProps['teamMembers'];
    onCreateCollection?: FieldPillsProps['onCreateCollection'];
    /** The body editor, or what stands in for it while it loads. */
    renderBody: () => React.ReactNode;
    /** Above the body, in the text gutter (a recovered description, a notice). */
    beforeBody?: React.ReactNode;
    linksSource?: PageLinksSource | null;
    /** Bumped by the host after a save that may have re-indexed links. */
    linksRevision?: number;
    /** Open another typed page (a Links entry or a relationship chip). */
    onOpenItem?: (itemId: string) => void;
}
export declare const TrackerPageView: React.FC<TrackerPageViewProps>;
export {};
