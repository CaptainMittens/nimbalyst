/**
 * Whether an agent's edit to a document lands as final text or as a pending
 * red/green diff for review.
 *
 * Shared collaborative documents (`collab://`) take the edit directly. Several
 * people and agents edit them at once, and a diff only the requester can
 * resolve leaves everyone else looking at both versions of the text. The
 * document's version history is the undo: the agent edit path records a
 * revision of the pre-edit content first.
 *
 * Files on disk keep the pending diff, because the person who asked for the
 * edit is the one reviewing it.
 */
import { isCollabUri } from '@nimbalyst/collab-protocol';

export function agentEditsApplyDirectly(documentPath: string | null | undefined): boolean {
  return typeof documentPath === 'string' && isCollabUri(documentPath);
}
