/**
 * The faint "+" at the end of a typed page's properties row. A page shows only
 * the fields that hold a value; this menu lists the empty single-valued ones,
 * and picking one hands it back to the row to open in its ordinary editor.
 */
import React from 'react';
import type { FieldDefinition } from '../../../../tracker-schema/src/browser';
export interface TrackerPageAddFieldProps {
    /** Empty fields the page can still show, in schema order. */
    fields: readonly FieldDefinition[];
    onAdd: (fieldName: string) => void;
}
export declare const TrackerPageAddField: React.FC<TrackerPageAddFieldProps>;
