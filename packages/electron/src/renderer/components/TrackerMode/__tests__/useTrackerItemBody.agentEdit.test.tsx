/**
 * An agent edit to an open Personal typed page goes through the page's mounted
 * body editor. Written to the stored body instead, it lost to the page's own
 * pending autosave: the hook ignores an outside change while a save is pending,
 * then saves the editor's text, which never had the agent's edit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createHeadlessEditor } from '@lexical/headless';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListItemNode, ListNode } from '@lexical/list';
import { CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from 'lexical';
import { $convertFromEnhancedMarkdownString, $convertToEnhancedMarkdownString, getEditorTransformers } from '@nimbalyst/runtime/editor';
import { DiffExtension } from '@nimbalyst/runtime/editor/extensions/builtin/DiffExtension';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';

vi.mock('../../../hooks/useTrackerContentCollab', () => ({
  useTrackerContentCollab: () => ({
    collaboration: null, loading: false, status: 'disconnected', syncProvider: null,
    commentsConfig: null, providerEpoch: 0, bodyCacheMarkdown: null,
  }),
}));
vi.mock('../../../hooks/useColdPaintFallback', () => ({ useColdPaintFallback: () => undefined }));
vi.mock('../../../hooks/useCollabSyncCurtain', () => ({ useCollabSyncCurtain: () => true }));
vi.mock('@nimbalyst/runtime/plugins/TrackerPlugin/models', () => ({
  globalRegistry: { get: () => ({ sharing: 'personal' }) },
}));

import { useTrackerItemBody } from '../useTrackerItemBody';
import { applyPersonalPageAgentEdit } from '../../../services/personalAgentEdit';

const STORED = '# Idea\n\nTables: undecided.\n';

const item = {
  id: 'idea_1', primaryType: 'idea', typeTags: ['idea'], source: 'native', archived: false,
  system: {}, fields: { title: 'Idea' }, fieldUpdatedAt: {}, content: STORED,
} as unknown as TrackerRecord;

function markdownOf(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $convertToEnhancedMarkdownString(getEditorTransformers()));
}

describe('agent edit to an open Personal typed page', () => {
  let saved: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    saved = [];
    (window as any).electronAPI = {
      documentService: {
        getTrackerItemContent: vi.fn(async () => ({ success: true, content: saved.at(-1) ?? STORED })),
        updateTrackerItemContent: vi.fn(async ({ content }: { content: string }) => {
          saved.push(content);
          return { success: true };
        }),
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).electronAPI;
  });

  it('keeps the agent edit and the text typed before it', async () => {
    const { result, unmount } = renderHook(() => useTrackerItemBody({
      itemId: item.id, item, workspacePath: '/ws', teamOrgId: null, forceFloatingToolbar: false,
    }));
    await act(async () => { await vi.runAllTimersAsync(); });
    const config = result.current.localEditorConfig!;
    expect(config).toBeTruthy();

    // The mounted body editor, wired the way NimbalystEditor wires it.
    const editor = createHeadlessEditor({
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode],
      onError: (error) => { throw error; },
    });
    const unregisterDiff = (DiffExtension.register as unknown as (e: LexicalEditor) => () => void)(editor);
    editor.update(() => {
      $getRoot().clear();
      $convertFromEnhancedMarkdownString(config.initialContent ?? '', getEditorTransformers());
    }, { discrete: true });
    config.onGetContent?.(() => markdownOf(editor));
    config.onEditorReady?.(editor);
    editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size || dirtyLeaves.size) config.onDirtyChange?.(true);
    });

    // A person types; the autosave is pending.
    editor.update(() => {
      $getRoot().append($createParagraphNode().append($createTextNode('Typed just now.')));
    }, { discrete: true });

    const edit = await applyPersonalPageAgentEdit(
      'personal://tracker-content/idea_1',
      [{ oldText: 'Tables: undecided.', newText: 'Tables: one shared DataTable.' }],
      { workspacePath: '/ws' },
    );
    expect(edit, JSON.stringify(edit)).toMatchObject({ success: true });

    await act(async () => { await vi.runAllTimersAsync(); });
    const last = saved.at(-1) ?? '';
    expect(last).toContain('Tables: one shared DataTable.');
    expect(last).toContain('Typed just now.');

    unregisterDiff();
    unmount();
  });
});
