/**
 * The static 2x2 block in the editor: the chart drawn from the fence body,
 * and an Edit toggle that shows the body as text (saved on blur).
 */

import React, { useEffect, useMemo, useState, type JSX } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalEditable } from '@lexical/react/useLexicalEditable';
import { $getNodeByKey, type NodeKey } from 'lexical';

import { QuadrantChart } from './QuadrantChart';
import { parseQuadrantFence } from './quadrantFence';
import { $isQuadrantNode } from './QuadrantNodeCore';

export function QuadrantBlock({ source, nodeKey }: { source: string; nodeKey: NodeKey }): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const editable = useLexicalEditable();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(source);
  useEffect(() => {
    if (!editing) setDraft(source);
  }, [source, editing]);
  const parsed = useMemo(() => parseQuadrantFence(editing ? draft : source), [draft, editing, source]);

  const save = () => {
    setEditing(false);
    if (draft === source) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isQuadrantNode(node)) node.setSource(draft);
    });
  };

  return (
    <div className="quadrant-block my-3 rounded-lg border border-nim bg-nim-secondary p-2" contentEditable={false} data-testid="quadrant-block">
      <QuadrantChart points={parsed.points} {...parsed.labels} />
      <div className="quadrant-block-foot flex items-center gap-3 px-1 pt-1 text-[11px] text-nim-faint">
        {parsed.skipped > 0 ? <span>{parsed.skipped} line{parsed.skipped === 1 ? '' : 's'} without two numbers</span> : null}
        {editable ? (
          <button
            type="button"
            className="ml-auto cursor-pointer border-none bg-transparent p-0 text-[11px] text-nim-link hover:underline"
            data-testid="quadrant-block-edit"
            onClick={() => (editing ? save() : setEditing(true))}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        ) : null}
      </div>
      {editing ? (
        <textarea
          className="quadrant-block-source mt-1 min-h-[120px] w-full resize-y rounded border border-nim bg-nim-tertiary p-2 font-mono text-xs text-nim focus:border-[var(--nim-border-focus)] focus:outline-none"
          value={draft}
          autoFocus
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => event.stopPropagation()}
          data-testid="quadrant-block-source"
        />
      ) : null}
    </div>
  );
}
