// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PAGE_TOOL_CONTRACT, PAGE_TOOL_NAMES, remoteArgumentRefusal, remoteToolDefinitions } from '../pageToolContract.js';

describe('page tool contract', () => {
  it('lists every tool once, each taking repo and project remotely', () => {
    expect(PAGE_TOOL_CONTRACT.map((tool) => tool.name)).toEqual([...PAGE_TOOL_NAMES]);
    for (const tool of remoteToolDefinitions()) {
      expect(tool.inputSchema.properties).toHaveProperty('repo');
      expect(tool.inputSchema.properties).toHaveProperty('project');
    }
    expect(remoteToolDefinitions().find((tool) => tool.name === 'pages_bind_repo')?.inputSchema.required).toContain('repo');
  });

  it('refuses Personal pages, desktop-only arguments and non-comment citations remotely', () => {
    expect(remoteArgumentRefusal('listPages', { section: 'team' })).toBeNull();
    expect(remoteArgumentRefusal('createSharedDoc', { title: 'A', section: 'personal' })).toMatch(/desktop app/);
    expect(remoteArgumentRefusal('createSharedDoc', { title: 'A', documentType: 'excalidraw' })).toMatch(/markdown/);
    expect(remoteArgumentRefusal('readCollabDoc', { filePath: 'collab://x', includeDecisionState: true })).toMatch(/includeDecisionState/);
    expect(remoteArgumentRefusal('tracker_update', { id: 'NIM-1', expectedRevision: 3 })).toBeNull();
    expect(remoteArgumentRefusal('tracker_update', { id: 'NIM-1', linkSession: true })).toMatch(/linkSession/);
    expect(remoteArgumentRefusal('list_citable_inputs', { kinds: ['comment'] })).toBeNull();
    expect(remoteArgumentRefusal('list_citable_inputs', { kinds: ['comment', 'prompt'] })).toMatch(/only comments/);
  });
});
