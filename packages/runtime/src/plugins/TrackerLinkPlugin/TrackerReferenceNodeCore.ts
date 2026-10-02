/**
 * TrackerReferenceNode — an inline reference (pointer) to a tracker item.
 *
 * Unlike `TrackerItemNode` (which embeds a frozen snapshot of an item inline),
 * this node stores ONLY the reference key (e.g. `NIM-123`). The decorated chip
 * resolves the item's title/status *live* at render time via the injected
 * {@link TrackerReferenceResolver}, so editing or closing the item elsewhere
 * updates every chip pointing at it with no document edit.
 *
 * Serializes to a portable markdown link `[NIM-123](nimbalyst://NIM-123)` via
 * {@link TrackerReferenceTransformer}, so the document stays valid markdown and
 * degrades to a plain link in any other viewer.
 *
 * React-free: `./TrackerReferenceNode.tsx` registers the React decorator and
 * re-exports this module; headless graphs (collab worker, CLI) import this one
 * directly. See `nodeDecoratorSlot.ts`.
 */

import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical';
import type { JSX } from 'react';

import { $applyNodeReplacement, DecoratorNode } from 'lexical';

import { createNodeDecoratorSlot } from '../../editor/nodes/nodeDecoratorSlot';

export const TRACKER_REFERENCE_URN_SCHEME = 'nimbalyst://';

export type TrackerReferenceView = 'chip' | 'card' | 'statements';

export function normalizeTrackerReferenceView(view: unknown): TrackerReferenceView {
  return view === 'card' || view === 'statements' ? view : 'chip';
}

/** A relation is a predicate id; anything else (empty, non-string) is a plain link. */
export function normalizeTrackerReferenceRelation(relation: unknown): string | null {
  return typeof relation === 'string' && relation.trim() ? relation.trim() : null;
}

export type SerializedTrackerReferenceNode = Spread<
  {
    /** Reference key: an issue key (NIM-123) or local short id (tk_abc123). */
    referenceKey: string;
    view?: TrackerReferenceView;
    /** Predicate id of the named relation this link states; absent = plain link. */
    relation?: string | null;
  },
  SerializedLexicalNode
>;

function convertTrackerReferenceElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  const referenceKey = domNode.getAttribute('data-issue-key');
  if (referenceKey) {
    return {
      node: $createTrackerReferenceNode(
        referenceKey,
        normalizeTrackerReferenceView(domNode.getAttribute('data-view')),
        normalizeTrackerReferenceRelation(domNode.getAttribute('data-relation')),
      ),
    };
  }
  return null;
}

export const TrackerReferenceNodeDecorator = createNodeDecoratorSlot<TrackerReferenceNode>();

export class TrackerReferenceNode extends DecoratorNode<JSX.Element | null> {
  __referenceKey: string;
  __view: TrackerReferenceView;
  __relation: string | null;

  static getType(): string {
    return 'tracker-reference';
  }

  static clone(node: TrackerReferenceNode): TrackerReferenceNode {
    return new TrackerReferenceNode(node.__referenceKey, node.__key, node.__view, node.__relation);
  }

  static importJSON(
    serializedNode: SerializedTrackerReferenceNode,
  ): TrackerReferenceNode {
    return $createTrackerReferenceNode(
      serializedNode.referenceKey,
      normalizeTrackerReferenceView(serializedNode.view),
      normalizeTrackerReferenceRelation(serializedNode.relation),
    );
  }

  constructor(
    referenceKey: string,
    key?: NodeKey,
    view: TrackerReferenceView = 'chip',
    relation: string | null = null,
  ) {
    super(key);
    this.__referenceKey = referenceKey;
    this.__view = view;
    this.__relation = normalizeTrackerReferenceRelation(relation);
  }

  exportJSON(): SerializedTrackerReferenceNode {
    return {
      ...super.exportJSON(),
      type: 'tracker-reference',
      version: 1,
      referenceKey: this.__referenceKey,
      ...(this.getView() === 'chip' ? {} : { view: this.getView() }),
      ...(this.getRelation() ? { relation: this.getRelation() } : {}),
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.className = 'tracker-reference';
    const theme = config.theme as { trackerReference?: string };
    if (theme.trackerReference) {
      span.className = `tracker-reference ${theme.trackerReference}`;
    }
    if (this.getView() !== 'chip') {
      span.classList.add(`tracker-reference--${this.getView()}`);
    }
    span.setAttribute('data-issue-key', this.__referenceKey);
    return span;
  }

  updateDOM(prev: TrackerReferenceNode): boolean {
    return prev.__view !== this.__view;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('span');
    element.className = 'tracker-reference';
    element.setAttribute('data-lexical-tracker-reference', 'true');
    element.setAttribute('data-issue-key', this.__referenceKey);
    if (this.getView() !== 'chip') {
      element.setAttribute('data-view', this.getView());
    }
    const relation = this.getRelation();
    if (relation) {
      element.setAttribute('data-relation', relation);
    }
    element.textContent = this.__referenceKey;
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-tracker-reference')) {
          return null;
        }
        return { conversion: convertTrackerReferenceElement, priority: 1 };
      },
    };
  }

  decorate(editor: LexicalEditor, config: EditorConfig): JSX.Element | null {
    return TrackerReferenceNodeDecorator.decorate(this, editor, config);
  }

  isInline(): true {
    return true;
  }

  /** Plain-text fallback (copy, non-rich serialization) is the bare key. */
  getTextContent(): string {
    return this.__referenceKey;
  }

  getReferenceKey(): string {
    return this.__referenceKey;
  }

  getView(): TrackerReferenceView {
    return normalizeTrackerReferenceView(this.getLatest().__view);
  }

  setView(view: TrackerReferenceView): this {
    const writable = this.getWritable();
    writable.__view = view;
    return writable;
  }

  getRelation(): string | null {
    return this.getLatest().__relation;
  }

  setRelation(relation: string | null): this {
    const writable = this.getWritable();
    writable.__relation = normalizeTrackerReferenceRelation(relation);
    return writable;
  }
}

export function $createTrackerReferenceNode(
  referenceKey: string,
  view: TrackerReferenceView = 'chip',
  relation: string | null = null,
): TrackerReferenceNode {
  return $applyNodeReplacement(new TrackerReferenceNode(referenceKey, undefined, view, relation));
}

export function $isTrackerReferenceNode(
  node: LexicalNode | null | undefined,
): node is TrackerReferenceNode {
  return node instanceof TrackerReferenceNode;
}
