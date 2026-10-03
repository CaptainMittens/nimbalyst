// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestFromRenderer = vi.fn();
const fakeWindow = { isDestroyed: () => false };

vi.mock('electron', () => ({ BrowserWindow: { fromId: () => fakeWindow } }));
vi.mock('../../mcpWorkspaceResolver', () => ({ findWindowIdForWorkspacePath: async () => 1 }));
vi.mock('../../../window/WindowManager', () => ({ getMostRecentlyFocusedWorkspaceWindow: () => null }));
vi.mock('../../rendererRequest', () => ({ requestFromRenderer: (...args: unknown[]) => requestFromRenderer(...args) }));

import {
  getCollabIndexToolSchemas,
  handleCollabIndexTool,
} from '../collabIndexToolHandlers';

describe('page tree MCP tools', () => {
  beforeEach(() => requestFromRenderer.mockReset());

  it('forwards the section and workspace to the renderer and reports what it answered', async () => {
    requestFromRenderer.mockResolvedValue({
      status: 'responded',
      response: { success: true, section: 'personal', nodes: [{ nodeId: 'document:a', kind: 'page', title: 'Ideas' }] },
    });
    const result = await handleCollabIndexTool('listPages', { section: 'personal' }, '/ws');
    expect(requestFromRenderer).toHaveBeenCalledWith(fakeWindow, 'mcp:listPages', expect.objectContaining({ section: 'personal', workspacePath: '/ws' }), expect.anything());
    expect(result?.isError).toBe(false);
    expect(result?.content[0].text).toContain('"title":"Ideas"');
  });

  it('moves typed pages and types, and turns a renderer refusal into a tool error', async () => {
    requestFromRenderer.mockResolvedValue({ status: 'responded', response: { success: false, error: 'Refused: that would put it inside itself.' } });
    const result = await handleCollabIndexTool('moveSharedItem', { itemId: 'MOD-1', kind: 'item', newParentFolderId: 'p' }, '/ws');
    expect(requestFromRenderer).toHaveBeenCalledWith(fakeWindow, 'mcp:moveSharedItem', expect.objectContaining({ kind: 'item', itemId: 'MOD-1' }), expect.anything());
    expect(result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('inside itself') }] });
    expect(await handleCollabIndexTool('moveSharedItem', { itemId: 'x', kind: 'shelf' }, '/ws')).toMatchObject({ isError: true });
    expect(requestFromRenderer).toHaveBeenCalledTimes(1);
  });

  it('declares every page tool and answers only its own names', async () => {
    const names = getCollabIndexToolSchemas().map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['listPages', 'setPageType', 'createSharedDoc', 'moveSharedItem']));
    expect(handleCollabIndexTool('tracker_get', {}, '/ws')).toBeNull();
  });
});
