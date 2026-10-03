// @vitest-environment node
/**
 * Round-trip tests for tracker reference markdown handling.
 *
 * A tracker reference is stored as `[NIM-123](nimbalyst://NIM-123)` and must:
 *  - import into a TrackerReferenceNode carrying ONLY the reference key,
 *  - export back to the same markdown,
 *  - not be captured by the document-link transformer (which excludes `://`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEditor, $getRoot, $createParagraphNode } from 'lexical';
import { ListNode, ListItemNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { $convertToMarkdownString, type Transformer } from '@lexical/markdown';
import { $convertFromEnhancedMarkdownString } from '../../../editor/markdown/EnhancedMarkdownImport';
import { CORE_TRANSFORMERS } from '../../../editor/markdown/core-transformers';
import {
  TrackerReferenceNode,
  $createTrackerReferenceNode,
  $isTrackerReferenceNode,
} from '../TrackerReferenceNode';
import { TrackerReferenceTransformer } from '../TrackerReferenceTransformer';
import { setTrackerReferenceHrefBuilder } from '../trackerReferenceHref';

function getTestTransformers(): Transformer[] {
  return [TrackerReferenceTransformer, ...CORE_TRANSFORMERS];
}

function makeEditor(): ReturnType<typeof createEditor> {
  return createEditor({
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      CodeNode,
      LinkNode,
      TrackerReferenceNode,
    ],
    onError: (e) => {
      throw e;
    },
  });
}

describe('TrackerReferenceTransformer', () => {
  let editor: ReturnType<typeof createEditor>;

  beforeEach(() => {
    editor = makeEditor();
  });

  it.each(['chip', 'card', 'statements'] as const)('round-trips %s JSON without changing legacy chip JSON', (view) => {
    editor.update(() => {
      const node = $createTrackerReferenceNode('NIM-123', view);
      const json = node.exportJSON();
      expect(json).toEqual({ type: 'tracker-reference', version: 1, referenceKey: 'NIM-123', ...(view === 'chip' ? {} : { view }) });
      expect(TrackerReferenceNode.importJSON(json).getView()).toBe(view);
      expect(TrackerReferenceNode.clone(node).getView()).toBe(view);
      const changed = node.setView(view === 'chip' ? 'card' : 'chip');
      expect(changed.getView()).toBe(view === 'chip' ? 'card' : 'chip');
    }, { discrete: true });
  });

  it('defaults missing and unknown serialized views to chip', () => {
    editor.update(() => {
      for (const view of [undefined, 'future-view']) {
        const node = TrackerReferenceNode.importJSON({ type: 'tracker-reference', version: 1, referenceKey: 'NIM-123', view } as Parameters<typeof TrackerReferenceNode.importJSON>[0]);
        expect(node.getView()).toBe('chip');
        expect(node.exportJSON()).not.toHaveProperty('view');
      }
    }, { discrete: true });
  });

  it.each(['action', 'auth', 'doc', 'folder', 'install', 'tracker'])('does not claim reserved host %s with a view title', (host) => {
    expect(TrackerReferenceTransformer.importRegExp!.exec(`[link](nimbalyst://${host} "view=card")`)).toBeNull();
    expect(TrackerReferenceTransformer.regExp.exec(`[link](nimbalyst://${host} "view=card")`)).toBeNull();
  });

  it.each([
    ['"view=card" ', 'card'],
    ["'view=card'", 'card'],
    ['(view=statements)', 'statements'],
    ['"view=card height=3"', 'card'],
    ['"height=3 view=card"', 'card'],
    ['"Hover title"', 'chip'],
    ['"view=Card"', 'chip'],
    ['"view= card"', 'chip'],
  ])('normalizes title %s to %s', (title, view) => {
    editor.update(() => {
      $convertFromEnhancedMarkdownString(`[label](nimbalyst://NIM-123 ${title})`, getTestTransformers());
      const node = $getRoot().getFirstDescendant();
      expect($isTrackerReferenceNode(node)).toBe(true);
      expect((node as TrackerReferenceNode).getView()).toBe(view);
      const expectedTitle = view === 'chip' ? '' : ` "view=${view}"`;
      expect($convertToMarkdownString(getTestTransformers())).toBe(`[NIM-123](nimbalyst://NIM-123${expectedTitle})`);
    }, { discrete: true });
  });

  it.each([
    ['"rel=built-on"', 'chip', 'built-on', '"rel=built-on"'],
    ['"view=card rel=built-on"', 'card', 'built-on', '"view=card rel=built-on"'],
    ['"rel=built-on view=card"', 'card', 'built-on', '"view=card rel=built-on"'],
    ['"height=3 rel=owned-by future=x"', 'chip', 'owned-by', '"rel=owned-by"'],
    ['"view=card rel="', 'card', null, '"view=card"'],
  ])('imports relation title %s and re-exports it canonically', (title, view, relation, expectedTitle) => {
    editor.update(() => {
      $convertFromEnhancedMarkdownString(`[label](nimbalyst://NIM-123 ${title})`, getTestTransformers());
      const node = $getRoot().getFirstDescendant() as TrackerReferenceNode;
      expect(node.getView()).toBe(view);
      expect(node.getRelation()).toBe(relation);
      expect($convertToMarkdownString(getTestTransformers())).toBe(`[NIM-123](nimbalyst://NIM-123 ${expectedTitle})`);
    }, { discrete: true });
  });

  it('carries the relation through JSON, clone and setRelation, omitting it for a plain link', () => {
    editor.update(() => {
      const node = $createTrackerReferenceNode('NIM-123', 'chip', 'built-on');
      const json = node.exportJSON();
      expect(json).toEqual({ type: 'tracker-reference', version: 1, referenceKey: 'NIM-123', relation: 'built-on' });
      expect(TrackerReferenceNode.importJSON(json).getRelation()).toBe('built-on');
      expect(TrackerReferenceNode.clone(node).getRelation()).toBe('built-on');
      expect(TrackerReferenceNode.importJSON({ ...json, relation: null }).getRelation()).toBeNull();
      expect(node.setRelation(null).exportJSON()).not.toHaveProperty('relation');
    }, { discrete: true });
  });

  it('does not claim images with tracker view titles', () => {
    const markdown = '![image](nimbalyst://NIM-123 "view=card")';
    expect(TrackerReferenceTransformer.importRegExp!.exec(markdown)).toBeNull();
    expect(TrackerReferenceTransformer.regExp.exec(markdown)).toBeNull();
  });

  it('imports a nimbalyst:// link into a TrackerReferenceNode with only the key', () => {
    editor.update(
      () => {
        $convertFromEnhancedMarkdownString(
          'See [NIM-123](nimbalyst://NIM-123) for details.',
          getTestTransformers(),
        );
      },
      { discrete: true },
    );

    let found: TrackerReferenceNode | null = null;
    editor.read(() => {
      const walk = (node: ReturnType<typeof $getRoot>) => {
        for (const child of node.getChildren?.() ?? []) {
          if ($isTrackerReferenceNode(child)) {
            found = child;
          } else if ('getChildren' in child) {
            // @ts-expect-error recursive element walk
            walk(child);
          }
        }
      };
      walk($getRoot());
    });

    expect(found).not.toBeNull();
    expect(found!.getReferenceKey()).toBe('NIM-123');
  });

  it('round-trips [NIM-123](nimbalyst://NIM-123) back to identical markdown', () => {
    editor.update(
      () => {
        $convertFromEnhancedMarkdownString(
          'See [NIM-123](nimbalyst://NIM-123) for details.',
          getTestTransformers(),
        );
      },
      { discrete: true },
    );

    let exported = '';
    editor.update(
      () => {
        exported = $convertToMarkdownString(getTestTransformers());
      },
      { discrete: true },
    );

    expect(exported).toContain('[NIM-123](nimbalyst://NIM-123)');
  });

  it('supports local short-id reference keys (tk_...)', () => {
    editor.update(
      () => {
        $convertFromEnhancedMarkdownString(
          '[tk_a1b2c3](nimbalyst://tk_a1b2c3)',
          getTestTransformers(),
        );
      },
      { discrete: true },
    );

    let exported = '';
    editor.update(
      () => {
        exported = $convertToMarkdownString(getTestTransformers());
      },
      { discrete: true },
    );

    expect(exported).toContain('[tk_a1b2c3](nimbalyst://tk_a1b2c3)');
  });

  describe('console links', () => {
    const TEAM = 'https://console.nimbalyst.com/org/org-1/project/tp-1/trackers/item/NIM-123';

    function roundTrip(markdown: string): { exported: string; node: TrackerReferenceNode | null } {
      let exported = '';
      let node: TrackerReferenceNode | null = null;
      editor.update(() => {
        $convertFromEnhancedMarkdownString(markdown, getTestTransformers());
        const first = $getRoot().getFirstDescendant();
        node = $isTrackerReferenceNode(first) ? first : null;
        exported = $convertToMarkdownString(getTestTransformers());
      }, { discrete: true });
      return { exported, node };
    }

    afterEach(() => setTrackerReferenceHrefBuilder(null));

    it.each([
      `[NIM-123](${TEAM} "view=card rel=built-on")`,
      `[NIM-123](${TEAM})`,
      '[tk_a1](https://console.nimbalyst.com/app/item/tk_a1 "rel=owned-by")',
      '[NIM-123](nimbalyst://NIM-123 "rel=built-on")',
    ])('round-trips %s byte for byte', (markdown) => {
      const { exported, node } = roundTrip(markdown);
      expect(node).not.toBeNull();
      expect(exported).toBe(markdown);
    });

    it('reads the key, view and relation from a console item link', () => {
      const { node } = roundTrip(`[label](https://console.nimbalyst.com/org/o/project/p/trackers/item/NIM%2D9 "view=card rel=built-on")`);
      editor.read(() => {
        expect(node!.getReferenceKey()).toBe('NIM-9');
        expect(node!.getView()).toBe('card');
        expect(node!.getRelation()).toBe('built-on');
      });
    });

    it('keeps an old nimbalyst:// link as written even when new links are https', () => {
      setTrackerReferenceHrefBuilder((key) => `https://console.nimbalyst.com/org/o/project/p/trackers/item/${key}`);
      expect(roundTrip('[NIM-1](nimbalyst://NIM-1 "rel=built-on")').exported).toBe('[NIM-1](nimbalyst://NIM-1 "rel=built-on")');
    });

    it('writes a new reference as the host link when one is registered, else as nimbalyst://', () => {
      let exported = '';
      editor.update(() => {
        $getRoot().append($createParagraphNode().append($createTrackerReferenceNode('NIM-5', 'chip', 'built-on')));
        exported = $convertToMarkdownString(getTestTransformers());
      }, { discrete: true });
      expect(exported).toBe('[NIM-5](nimbalyst://NIM-5 "rel=built-on")');

      setTrackerReferenceHrefBuilder((key) => `https://console.nimbalyst.com/org/o/project/p/trackers/item/${key}`);
      editor.update(() => {
        $getRoot().clear().append($createParagraphNode().append($createTrackerReferenceNode('NIM-5', 'chip', 'built-on')));
        exported = $convertToMarkdownString(getTestTransformers());
      }, { discrete: true });
      expect(exported).toBe('[NIM-5](https://console.nimbalyst.com/org/o/project/p/trackers/item/NIM-5 "rel=built-on")');
    });

    it('carries the href through JSON and clone without asking the host again', () => {
      editor.update(() => {
        const node = $createTrackerReferenceNode('NIM-5', 'chip', null, TEAM);
        const json = node.exportJSON();
        expect(json).toEqual({ type: 'tracker-reference', version: 1, referenceKey: 'NIM-5', href: TEAM });
        setTrackerReferenceHrefBuilder(() => 'https://elsewhere.example/x');
        expect(TrackerReferenceNode.importJSON(json).getHref()).toBe(TEAM);
        expect(TrackerReferenceNode.importJSON({ type: 'tracker-reference', version: 1, referenceKey: 'NIM-5' }).getHref()).toBeNull();
        expect(TrackerReferenceNode.clone(node).getHref()).toBe(TEAM);
      }, { discrete: true });
    });

    it('does not claim console links to pages, types or other sites', () => {
      for (const markdown of [
        '[Spec](https://console.nimbalyst.com/org/o/project/p/document/doc-1)',
        '[Bugs](https://console.nimbalyst.com/org/o/project/p/trackers/type/bug)',
        '[x](https://example.com/org/o/project/p/trackers/item/NIM-1)',
      ]) {
        expect(TrackerReferenceTransformer.importRegExp!.exec(markdown)).toBeNull();
      }
    });
  });

  it('does not claim app-action links', () => {
    expect(
      TrackerReferenceTransformer.importRegExp!.exec(
        '[Open projects](nimbalyst://action/open-project-manager)',
      ),
    ).toBeNull();
    expect(
      TrackerReferenceTransformer.regExp.exec(
        '[Open projects](nimbalyst://action/open-project-manager)',
      ),
    ).toBeNull();
  });
});
