import type { ElementNode, LexicalNode, SerializedLexicalNode } from 'lexical';
import { $isQuadrantNode } from '../../QuadrantPlugin/QuadrantNodeCore';
import type {
  DiffHandlerContext,
  DiffHandlerResult,
  DiffNodeHandler,
} from './DiffNodeHandler';
import { createNodeFromSerialized } from '../core/createNodeFromSerialized';
import { $clearDiffState, $getDiffState, $setDiffState } from '../core/DiffState';

/**
 * A 2x2 block is atomic: a changed body shows the old chart as removed and
 * the new one as added. Without this the default handler only marks the old
 * node modified, so the edit never draws and approving keeps the old body.
 */
export class QuadrantDiffHandler implements DiffNodeHandler {
  readonly nodeType = 'quadrant';

  canHandle({ liveNode }: DiffHandlerContext): boolean {
    return $isQuadrantNode(liveNode);
  }

  handleUpdate({ liveNode, targetNode }: DiffHandlerContext): DiffHandlerResult {
    if (!$isQuadrantNode(liveNode)) return { handled: false };
    const targetSource = (targetNode as { source?: unknown }).source;
    if (typeof targetSource !== 'string') return { handled: false };
    if (liveNode.getSource() !== targetSource) {
      const next = createNodeFromSerialized(targetNode);
      $setDiffState(liveNode, 'removed');
      $setDiffState(next, 'added');
      liveNode.insertAfter(next);
    } else {
      $clearDiffState(liveNode);
    }
    return { handled: true, skipChildren: true };
  }

  handleAdd(
    targetNode: SerializedLexicalNode,
    parentNode: ElementNode,
    position: number
  ): DiffHandlerResult {
    const node = createNodeFromSerialized(targetNode);
    if (!$isQuadrantNode(node)) return { handled: false };
    $setDiffState(node, 'added');
    const next = parentNode.getChildAtIndex(position);
    if (next) next.insertBefore(node);
    else parentNode.append(node);
    return { handled: true, skipChildren: true };
  }

  handleRemove(node: LexicalNode): DiffHandlerResult {
    if (!$isQuadrantNode(node)) return { handled: false };
    $setDiffState(node, 'removed');
    return { handled: true, skipChildren: true };
  }

  handleApprove(node: LexicalNode): DiffHandlerResult {
    if (!$isQuadrantNode(node)) return { handled: false };
    if ($getDiffState(node) === 'removed') node.remove();
    else $clearDiffState(node);
    return { handled: true, skipChildren: true };
  }

  handleReject(node: LexicalNode): DiffHandlerResult {
    if (!$isQuadrantNode(node)) return { handled: false };
    if ($getDiffState(node) === 'added') node.remove();
    else $clearDiffState(node);
    return { handled: true, skipChildren: true };
  }
}
