import React, { useMemo } from 'react';
import { atom, useAtom, useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import {
  sessionRegistryAtom,
  sessionProcessingAtom,
  sessionUnreadAtom,
  sessionHasPendingInteractivePromptAtom,
  type SessionMeta,
} from '../../store/atoms/sessions';
import { workspaceSessionTurnActivityAtom } from '../../store/atoms/sessionActivity';
import { workstreamStateAtom } from '../../store/atoms/workstreamState';
import { SessionListItem } from './SessionListItem';
import { buildSessionTree, mergedTreeHeader, treeIndent, type SessionTreeNode } from './sessionTree';

export interface SessionTreeProps {
  sessions: SessionMeta[];
  root?: SessionMeta;
  activeSessionId: string | null;
  projectPath?: string;
  onSessionSelect: (id: string, e: Pick<React.MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>) => void;
  onSessionDelete?: (id: string) => void;
  onSessionArchive?: (id: string) => void;
  onSessionUnarchive?: (id: string) => void;
  onSessionPinToggle?: (id: string, pinned: boolean) => void;
  onSessionRename?: (id: string, title: string) => void;
  onSessionBranch?: (id: string) => void;
}

export function SessionTree(props: SessionTreeProps) {
  const registry = useAtomValue(sessionRegistryAtom);
  const activity = useAtomValue(
    workspaceSessionTurnActivityAtom(
      props.projectPath || props.root?.workspaceId || props.sessions[0]?.workspaceId || ''
    )
  );
  const roots = useMemo(() => {
    const rows = props.root ? [props.root, ...props.sessions] : props.sessions;
    return buildSessionTree(
      rows.map((row) => {
        const current = registry.get(row.id) ?? row;
        return { ...current, updatedAt: Math.max(current.updatedAt, activity.get(row.id) ?? 0) };
      })
    );
  }, [props.root, props.sessions, registry, activity]);
  return (
    <div className="session-tree" role="tree" aria-label="Session tree">
      {roots.map((root) => (
        <SessionTreeRow
          key={root.session.id}
          {...props}
          pinSession={root.session}
          node={mergedTreeHeader(root)}
          baseDepth={mergedTreeHeader(root).depth}
        />
      ))}
    </div>
  );
}

function SessionTreeRow(props: SessionTreeProps & { node: SessionTreeNode<SessionMeta>; baseDepth: number; pinSession?: SessionMeta }) {
  const { node, baseDepth, activeSessionId } = props;
  const row = node.session;
  // A merged wrapper retains the same pin identity used by sidebar placement.
  const pinSession = props.pinSession ?? row;
  const [state, setState] = useAtom(workstreamStateAtom(row.id));
  const status = useAtomValue(
    useMemo(
      () =>
        atom((get) => {
          let running = 0;
          let unread = 0;
          let review = 0;
          for (const id of node.ids) {
            if (get(sessionProcessingAtom(id))) running++;
            if (get(sessionUnreadAtom(id))) unread++;
            if (get(sessionHasPendingInteractivePromptAtom(id))) review++;
          }
          return { running, unread, review };
        }),
      [node.ids.join('\0')]
    )
  );
  const expanded =
    state.treeExpanded ??
    (status.running > 0 ||
      status.unread > 0 ||
      status.review > 0 ||
      node.ids.includes(activeSessionId ?? ''));
  const indent = treeIndent(node.depth - baseDepth);
  const details = (
    <>
      {node.children.length > 0 && (
        <div className="session-tree-rollup flex flex-wrap gap-2 text-[10px] text-[var(--nim-text-muted)]">
          {status.running > 0 && <span className="text-[var(--nim-primary)]">{status.running} running</span>}
          {status.unread > 0 && <span>{status.unread} unread</span>}
          {status.review > 0 && <span>{status.review} need review</span>}
          {node.uncommittedCount > 0 && (
            <span className="text-[var(--nim-warning)]">{node.uncommittedCount} uncommitted</span>
          )}
          {!expanded && <span>{node.ids.length - 1} sessions</span>}
        </div>
      )}
    </>
  );
  return (
    <>
      <div
        className="session-tree-row"
        role="treeitem"
        aria-level={node.depth - baseDepth + 1}
        aria-expanded={node.children.length ? expanded : undefined}
        style={{
          marginLeft: indent.level * 16,
          borderLeft: indent.rail ? '1px solid var(--nim-border)' : undefined,
        }}
      >
        <SessionListItem
          {...row}
          isPinned={pinSession.isPinned}
          title={row.title || 'Untitled Session'}
          isActive={row.id === activeSessionId}
          treeContext
          projectPath={props.projectPath || row.workspaceId}
          isWorkstream={node.children.length > 0}
          treeLeading={
            node.children.length > 0 ? (
              <button
                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.title}`}
                aria-expanded={expanded}
                className="session-tree-chevron shrink-0 mt-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setState({ treeExpanded: !expanded });
                }}
              >
                <MaterialSymbol icon={expanded ? 'expand_more' : 'chevron_right'} size={14} />
              </button>
            ) : (
              <span className="w-3.5 shrink-0" />
            )
          }
          treeDetails={details}
          uncommittedCount={node.children.length ? undefined : row.uncommittedCount}
          onClick={(e) => props.onSessionSelect(row.id, e)}
          onDelete={props.onSessionDelete && (() => props.onSessionDelete!(row.id))}
          onArchive={props.onSessionArchive && (() => props.onSessionArchive!(row.id))}
          onUnarchive={props.onSessionUnarchive && (() => props.onSessionUnarchive!(row.id))}
          onPinToggle={props.onSessionPinToggle && ((pinned) => props.onSessionPinToggle!(pinSession.id, pinned))}
          onRename={props.onSessionRename && ((title) => props.onSessionRename!(row.id, title))}
          onBranch={props.onSessionBranch && (() => props.onSessionBranch!(row.id))}
        />
      </div>
      {expanded &&
        node.children.map((child) => <SessionTreeRow key={child.session.id} {...props} pinSession={undefined} node={child} />)}
    </>
  );
}
