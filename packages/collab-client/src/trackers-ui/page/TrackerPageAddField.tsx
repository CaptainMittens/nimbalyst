/**
 * The faint "+" at the end of a typed page's properties row. A page shows only
 * the fields that hold a value; this menu lists the empty single-valued ones,
 * and picking one hands it back to the row to open in its ordinary editor.
 */

import React, { useState } from 'react';
import {
  FloatingPortal,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  autoUpdate,
} from '@floating-ui/react';
import type { FieldDefinition } from '@nimbalyst/tracker-schema';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { windowControlsClearance } from '@nimbalyst/runtime/ui/floating/windowControlsClearance';
import { trackerFieldDisplayLabel } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerFieldLayout';

export interface TrackerPageAddFieldProps {
  /** Empty fields the page can still show, in schema order. */
  fields: readonly FieldDefinition[];
  onAdd: (fieldName: string) => void;
}

export const TrackerPageAddField: React.FC<TrackerPageAddFieldProps> = ({ fields, onAdd }) => {
  const [open, setOpen] = useState(false);
  const floating = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(5), flip({ padding: 8 }), shift({ padding: 8 }), windowControlsClearance()],
  });
  const dismiss = useDismiss(floating.context);
  const role = useRole(floating.context, { role: 'menu' });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, role]);

  if (fields.length === 0) return null;

  return (
    <>
      <button
        ref={floating.refs.setReference}
        {...getReferenceProps()}
        type="button"
        className="tracker-field-pill tracker-field-pill-empty tracker-page-view-add-field"
        onClick={() => setOpen((value) => !value)}
        aria-label="Add field"
        title="Add field"
        data-testid="tracker-page-add-field"
      >
        <MaterialSymbol icon="add" size={14} className="tracker-field-pill-icon" />
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={floating.refs.setFloating}
            style={floating.floatingStyles}
            {...getFloatingProps()}
            className="tracker-field-popover tracker-page-view-add-field-menu"
            data-testid="tracker-page-add-field-menu"
          >
            <span className="tracker-field-popover-header">Add field</span>
            <div className="tracker-field-choice-list">
              {fields.map((field) => (
                <button
                  key={field.name}
                  type="button"
                  role="menuitem"
                  className="tracker-field-choice"
                  data-field={field.name}
                  onClick={() => {
                    setOpen(false);
                    onAdd(field.name);
                  }}
                >
                  <span className="tracker-field-choice-label">{trackerFieldDisplayLabel(field)}</span>
                </button>
              ))}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
};
