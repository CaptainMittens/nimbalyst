/**
 * Agent reads and edits of Personal pages (Decision 20). Like shared pages,
 * an agent edit lands as final text with no review step; the page's local
 * history is how a person reverts it.
 *
 *   personal://<documentId>              Personal page body (`personal-pages:*` IPC)
 *   personal://tracker-content/<itemId>  Personal typed-page body (the tracker item's content)
 *
 * A Personal page open in a tab is edited through its mounted editor, which
 * saves through its own versioned path; editing the stored body under it would
 * leave the tab showing old text until the next keystroke hit a conflict.
 * Otherwise the stored body is edited directly: read with its version, apply
 * the replacements, write back only if the version still matches (one retry
 * on a race), with the pre-edit text kept in history first.
 */
import type { TextReplacement } from '@nimbalyst/runtime';
// Deep paths, not the barrels: see HeadlessCollabDocEdit.
import { applyTextReplacementsToString } from '@nimbalyst/runtime/editor/plugins/DiffPlugin/core/diffUtils';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';
import { parsePersonalPageUri } from '../../shared/personalPageUri';

const PERSONAL_DOC_EDITOR_PREFIX = 'personal-doc://';

type BodyWrite = { version: number } | { conflict: true; version: number; content: string };

export interface PersonalPageIo {
  getBody(workspacePath: string, documentId: string): Promise<{ content: string; version: number } | null>;
  updateBody(workspacePath: string, documentId: string, content: string, expectedVersion?: number): Promise<BodyWrite>;
  /** Keep text in a page's local history under its history key. */
  keepInHistory(historyKey: string, content: string, description: string): Promise<void>;
  getTypedPageBody(itemId: string): Promise<unknown>;
  setTypedPageBody(itemId: string, content: string): Promise<void>;
  /** The editor mounted for this path, if any, applies the replacements itself. */
  mountedEditor: {
    has(path: string): boolean;
    applyReplacements(path: string, replacements: TextReplacement[], requestId?: string): Promise<{ success: boolean; error?: string } | undefined>;
    getContent(path: string): string;
  };
}

const rendererIo: PersonalPageIo = {
  getBody: (workspacePath, documentId) =>
    window.electronAPI.invoke('personal-pages:get-body', workspacePath, documentId),
  updateBody: (workspacePath, documentId, content, expectedVersion) =>
    window.electronAPI.invoke('personal-pages:update-body', workspacePath, documentId, content, expectedVersion),
  keepInHistory: async (historyKey, content, description) => {
    await window.electronAPI.invoke('history:create-snapshot', historyKey, content, 'pre-apply', description);
  },
  getTypedPageBody: async (itemId) => {
    const result = await window.electronAPI.documentService.getTrackerItemContent({ itemId });
    if (!result.success) throw new Error(result.error || `Could not read the typed page ${itemId}`);
    return result.content;
  },
  setTypedPageBody: async (itemId, content) => {
    const result = await window.electronAPI.documentService.updateTrackerItemContent({ itemId, content });
    if (!result.success) throw new Error(result.error || `Could not save the typed page ${itemId}`);
  },
  mountedEditor: editorRegistry,
};

export interface PersonalEditResult {
  success: boolean;
  error?: string;
  code?: string;
}

function personalDocEditorPath(documentId: string): string {
  return `${PERSONAL_DOC_EDITOR_PREFIX}${documentId}`;
}

function failure(error: unknown, code?: string): PersonalEditResult {
  return {
    success: false,
    ...(code ? { code } : {}),
    error: error instanceof Error ? error.message : String(error),
  };
}

function markdownOf(value: unknown, what: string): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error(`${what} is not stored as markdown and cannot be edited as text.`);
  return value;
}

/** Current text of a Personal page or typed-page body. Throws when it cannot be read. */
export async function readPersonalPageForAgent(
  uri: string,
  workspacePath: string | null | undefined,
  io: PersonalPageIo = rendererIo,
): Promise<string> {
  const target = parsePersonalPageUri(uri);
  if (!target) throw new Error(`Not a Personal page URI: ${uri}`);
  if (target.kind === 'typed-page') {
    return markdownOf(await io.getTypedPageBody(target.itemId), `The typed page ${target.itemId}`);
  }
  const editorPath = personalDocEditorPath(target.documentId);
  if (io.mountedEditor.has(editorPath)) return io.mountedEditor.getContent(editorPath);
  if (!workspacePath) throw new Error(`No workspace is open to read ${uri}.`);
  const body = await io.getBody(workspacePath, target.documentId);
  if (!body) throw new Error(`Unknown Personal page '${target.documentId}'.`);
  return body.content;
}

async function editStoredPersonalPage(
  workspacePath: string,
  documentId: string,
  replacements: TextReplacement[],
  io: PersonalPageIo,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = await io.getBody(workspacePath, documentId);
    if (!body) throw new Error(`Unknown Personal page '${documentId}'.`);
    const next = applyTextReplacementsToString(body.content, replacements);
    if (next === body.content) return;
    if (attempt === 0) {
      await io.keepInHistory(personalDocEditorPath(documentId), body.content, 'Before agent edit');
    }
    const written = await io.updateBody(workspacePath, documentId, next, body.version);
    if (!('conflict' in written)) return;
  }
  throw new Error(`The Personal page '${documentId}' kept changing while the edit was applied. Read it again and retry.`);
}

export async function applyPersonalPageAgentEdit(
  uri: string,
  replacements: TextReplacement[],
  options: { workspacePath?: string | null; requestId?: string },
  io: PersonalPageIo = rendererIo,
): Promise<PersonalEditResult> {
  const target = parsePersonalPageUri(uri);
  if (!target) return failure(`Not a Personal page URI: ${uri}`, 'INVALID_URI');
  if (!Array.isArray(replacements) || replacements.length === 0) {
    return failure('An edit needs at least one replacement.', 'INVALID_INPUT');
  }
  try {
    if (target.kind === 'typed-page') {
      const current = markdownOf(await io.getTypedPageBody(target.itemId), `The typed page ${target.itemId}`);
      const next = applyTextReplacementsToString(current, replacements);
      if (next !== current) await io.setTypedPageBody(target.itemId, next);
      return { success: true };
    }

    const editorPath = personalDocEditorPath(target.documentId);
    if (io.mountedEditor.has(editorPath)) {
      const result = await io.mountedEditor.applyReplacements(editorPath, replacements, options.requestId);
      return result ?? { success: false, error: 'No result returned from the open Personal page.' };
    }
    if (!options.workspacePath) {
      return failure(`No workspace is open to edit ${uri}.`, 'DOCUMENT_NOT_AVAILABLE');
    }
    await editStoredPersonalPage(options.workspacePath, target.documentId, replacements, io);
    return { success: true };
  } catch (error) {
    return failure(error);
  }
}
