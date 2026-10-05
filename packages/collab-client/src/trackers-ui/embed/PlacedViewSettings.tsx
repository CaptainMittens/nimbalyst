import { useState } from 'react';
import { FloatingFocusManager, FloatingPortal, flip, offset, shift, useClick, useDismiss, useFloating, useInteractions, useRole } from '@floating-ui/react';
import type { TrackerFilterField } from '../trackerFilterFields';

export interface PlacedViewSettingsProps {
  attrs: Readonly<Record<string, string>>;
  fields: readonly TrackerFilterField[];
  temporary: boolean;
  defaultColumns?: readonly string[];
  onChange(patch: Readonly<Record<string, string | null>>): void;
}

/** Settings edit only the keys touched by the current gesture. */
export function PlacedViewSettings({ attrs, fields, temporary, onChange, defaultColumns }: PlacedViewSettingsProps) {
  const [filterField, setFilterField] = useState(fields[0]?.id ?? 'title');
  const [filterOp, setFilterOp] = useState('=');
  const [filterValue, setFilterValue] = useState('');
  const selected = attrs.cols ? attrs.cols.split(',') : [...(defaultColumns ?? ['title'])];
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({ open, onOpenChange: setOpen, placement: 'bottom-start', middleware: [offset(6), flip(), shift({ padding: 12 })] });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context), useRole(context)]);
  const sorts = (attrs.sort || '').split(',').filter(Boolean);
  const setSort = (index: number, value: string | null) => onChange({ sort: sorts.map((sort, i) => i === index ? value : sort).filter(Boolean).join(',') || null });
  const moveField = (id: string, target: number) => {
    const next = selected.filter(field => field !== id);
    next.splice(target, 0, id);
    onChange({ cols: next.join(',') });
  };
  const selectClass = 'rounded border border-nim bg-nim px-2 py-1 text-xs text-nim';
  return <div className="placed-view-settings text-xs" contentEditable={false}>
    <button ref={refs.setReference} type="button" className="rounded border border-nim bg-nim-secondary px-3 py-2 font-medium text-nim hover:bg-nim-hover" {...getReferenceProps()}>View settings{temporary ? ' · Not saved: view only' : ''}</button>
    {open && <FloatingPortal><FloatingFocusManager context={context} modal={false}>
    <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 1000, maxHeight: '70vh', maxWidth: 'min(680px, calc(100vw - 24px))' }} className="placed-view-settings-popover overflow-auto rounded-lg border border-nim bg-nim p-4 text-xs text-nim shadow-xl" aria-label="View settings" {...getFloatingProps()}>
    <button type="button" className="float-right text-nim-link" aria-label="Close view settings" onClick={() => setOpen(false)}>Close</button>
    <div className="mt-3 flex flex-wrap items-start gap-4">
      <label className="flex flex-col gap-1">Layout
        <select aria-label="Layout" className={selectClass} value={attrs.mode || 'table'} onChange={e => onChange({ mode: e.target.value })}>
          <option value="table">Table</option><option value="board">Board</option><option value="list">List</option><option value="timeline">Timeline</option>
          <option value="2x2">2×2</option>
        </select>
      </label>
      <fieldset className="flex flex-col gap-2"><legend>Sort</legend>
        {sorts.map((sort, index) => {
          const [field, direction = 'desc'] = sort.split(':');
          return <div key={index} className="flex flex-wrap gap-1">
            <select aria-label={`Sort field ${index + 1}`} className={selectClass} value={field} onChange={event => setSort(index, `${event.target.value}:${direction}`)}>{fields.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select>
            <select aria-label={`Sort direction ${index + 1}`} className={selectClass} value={direction} onChange={event => setSort(index, `${field}:${event.target.value}`)}><option value="asc">Ascending</option><option value="desc">Descending</option></select>
            <button type="button" aria-label={`Remove sort ${index + 1}`} onClick={() => setSort(index, null)}>Remove</button>
          </div>;
        })}
        <button type="button" className="text-nim-link" onClick={() => onChange({ sort: [...sorts, `${fields.find(field => !sorts.some(sort => sort.split(':')[0] === field.id))?.id || 'title'}:asc`].join(',') })}>Add sort</button>
      </fieldset>
      <label className="flex flex-col gap-1">Group by
        <select aria-label="Group by" className={selectClass} value={attrs.group || (attrs.mode === 'board' ? 'status' : 'none')} onChange={e => onChange({ group: e.target.value })}>
          {[...new Set(['none', 'status', 'priority', 'assignee', 'type', 'tag', 'milestone', 'goal', ...fields.filter(field => !field.multiValue && ['select', 'boolean', 'user', 'relationship'].includes(field.type ?? '')).map(field => field.id)])].map(group => <option key={group} value={group}>{group === 'none' ? 'No grouping' : group}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">Items
        <select aria-label="Items" className={selectClass} value={attrs.scope || 'all'} onChange={e => onChange({ scope: e.target.value })}>
          <option value="all">All states</option><option value="open">Open only</option>
        </select>
      </label>
      <fieldset className="flex max-h-40 flex-col gap-1 overflow-y-auto"><legend className="mb-1">Fields</legend>
        {[...selected.map(id => fields.find(field => field.id === id) ?? { id, label: `${id} (unavailable)` }), ...fields.filter(field => !selected.includes(field.id))].map(field => <div key={field.id} className="flex items-center gap-2" draggable={selected.includes(field.id)} onDragStart={event => event.dataTransfer.setData('text/plain', field.id)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('text/plain'); if (selected.includes(id)) moveField(id, Math.max(0, selected.indexOf(field.id))); }}>
          <label className="flex flex-1 items-center gap-2"><input type="checkbox" checked={selected.includes(field.id)} onChange={e => {
            const next = e.target.checked ? [...selected, field.id] : selected.filter(id => id !== field.id);
            onChange({ cols: next.length ? next.join(',') : 'title' });
          }} />{field.label}</label>
          {selected.includes(field.id) ? <><button type="button" aria-label={`Move ${field.label} up`} disabled={selected.indexOf(field.id) === 0} onClick={() => moveField(field.id, selected.indexOf(field.id) - 1)}>↑</button><button type="button" aria-label={`Move ${field.label} down`} disabled={selected.indexOf(field.id) === selected.length - 1} onClick={() => moveField(field.id, selected.indexOf(field.id) + 1)}>↓</button></> : null}
        </div>)}
      </fieldset>
      {attrs.mode === 'timeline' ? <fieldset className="flex gap-2"><legend>Timeline dates</legend>
        {['start', 'end'].map(key => <label key={key} className="flex flex-col gap-1">{key === 'start' ? 'Start' : 'End'}
          <select aria-label={`Timeline ${key}`} className={selectClass} value={attrs[key] || ''} onChange={event => onChange({ [key]: event.target.value || null })}>
            <option value="">{attrs.start || attrs.end ? 'Not selected' : 'Automatic'}</option>
            {fields.filter(field => !field.multiValue && ['date', 'datetime'].includes(field.type ?? '')).map(field => <option key={field.id} value={field.id}>{field.label}</option>)}
          </select>
        </label>)}
      </fieldset> : null}
      {attrs.mode === '2x2' ? ['x', 'y'].map(axis => <label key={axis} className="flex flex-col gap-1">{axis.toUpperCase()} axis
        <select aria-label={`${axis.toUpperCase()} axis`} className={selectClass} value={attrs[axis] || ''} onChange={e => onChange({ [axis]: e.target.value })}>
          <option value="">Choose field</option>{fields.filter(field => field.type === 'number').map(field => <option key={field.id} value={field.id}>{field.label}</option>)}
        </select>
      </label>) : null}
    </div>
    <fieldset className="mt-3 border-t border-nim pt-2"><legend>Filters · all conditions must match</legend>
      {(attrs.filter || '').split(',').filter(Boolean).map((clause, index, clauses) => <div key={`${index}:${clause}`} className="my-1 flex gap-2">
        <span className="break-all">{clause}</span><button type="button" className="text-nim-link" aria-label={`Remove filter ${clause}`} onClick={() => onChange({ filter: clauses.filter((_, i) => i !== index).join(',') || null })}>Remove</button>
      </div>)}
      <div className="mt-2 flex flex-wrap gap-2">
        <select aria-label="Filter field" className={selectClass} value={filterField} onChange={e => setFilterField(e.target.value)}>{fields.map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</select>
        <select aria-label="Filter operator" className={selectClass} value={filterOp} onChange={e => setFilterOp(e.target.value)}>
          <option value="=">is</option><option value="!">is not</option><option value=">">greater than / after</option><option value="<">less than / before</option><option value="empty">is empty</option><option value="!empty">is not empty</option>
        </select>
        {!filterOp.endsWith('empty') ? <input aria-label="Filter value" className={selectClass} value={filterValue} placeholder="Value, today or +7d" onChange={e => setFilterValue(e.target.value)} /> : null}
        <button type="button" className="text-nim-link" disabled={!filterOp.endsWith('empty') && !filterValue.trim()} onClick={() => {
          const clause = `${filterField}:${filterOp}${filterOp.endsWith('empty') ? '' : encodeURIComponent(filterValue)}`;
          onChange({ filter: [attrs.filter, clause].filter(Boolean).join(',') });
        }}>Add filter</button>
      </div>
    </fieldset>
    </div></FloatingFocusManager></FloatingPortal>}
  </div>;
}
