/**
 * Markdown transformer for tracker references.
 *
 * Exports `TrackerReferenceNode` as a portable markdown link
 * `[NIM-123](nimbalyst://NIM-123)` and imports any `nimbalyst://<key>` link
 * back into a `TrackerReferenceNode`. The label is display-only; the canonical
 * reference key is the URN path after `nimbalyst://`.
 * The title attribute holds space-separated `k=v` tokens: `view=` (omitted for
 * the default chip) then `rel=<predicateId>` (omitted for a plain link), e.g.
 * `[NIM-1](nimbalyst://NIM-1 "view=card rel=built-on")`. Import accepts either
 * order and drops unknown tokens; unsupported views normalize to the chip.
 *
 * Scheme-gated so it never collides with `DocumentReferenceTransformer`, whose
 * regex explicitly excludes links containing `://`.
 */

import type { TextMatchTransformer } from '@lexical/markdown';

import {
  $createTrackerReferenceNode,
  $isTrackerReferenceNode,
  TrackerReferenceNode,
  TRACKER_REFERENCE_URN_SCHEME,
  normalizeTrackerReferenceRelation,
  normalizeTrackerReferenceView,
} from './TrackerReferenceNodeCore';
import { TRACKER_REFERENCE_KEY_PATTERN } from './trackerReferenceHref';

const TRACKER_REFERENCE_IMPORT_REGEXP = new RegExp(
  String.raw`(?<!!)\[([^\]]+)\]\(nimbalyst:\/\/(${TRACKER_REFERENCE_KEY_PATTERN})(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^()]*)\)))?\s*\)`,
);
function titleToken(title: string | undefined, name: string): string | undefined {
  return title?.match(new RegExp(String.raw`(?:^|\s)${name}=([^\s]+)(?:\s|$)`))?.[1];
}

const TRACKER_REFERENCE_REGEXP = new RegExp(
  `${TRACKER_REFERENCE_IMPORT_REGEXP.source}$`,
);

export const TrackerReferenceTransformer: TextMatchTransformer = {
  dependencies: [TrackerReferenceNode],
  export: (node) => {
    if (!$isTrackerReferenceNode(node)) {
      return null;
    }
    const key = node.getReferenceKey();
    const view = node.getView();
    const relation = node.getRelation();
    const tokens = [
      ...(view === 'chip' ? [] : [`view=${view}`]),
      ...(relation ? [`rel=${relation}`] : []),
    ];
    const title = tokens.length ? ` "${tokens.join(' ')}"` : '';
    return `[${key}](${TRACKER_REFERENCE_URN_SCHEME}${key}${title})`;
  },
  // Match only tracker issue keys and local tracker URNs. Other nimbalyst://
  // namespaces (including action links) must remain ordinary links.
  importRegExp: TRACKER_REFERENCE_IMPORT_REGEXP,
  regExp: TRACKER_REFERENCE_REGEXP,
  replace: (textNode, match) => {
    const [, , referenceKey, doubleQuotedTitle, singleQuotedTitle, parenthesizedTitle] = match;
    const title = doubleQuotedTitle ?? singleQuotedTitle ?? parenthesizedTitle;
    const view = normalizeTrackerReferenceView(titleToken(title, 'view'));
    const relation = normalizeTrackerReferenceRelation(titleToken(title, 'rel'));
    textNode.replace($createTrackerReferenceNode(referenceKey, view, relation));
  },
  trigger: ')',
  type: 'text-match',
};
