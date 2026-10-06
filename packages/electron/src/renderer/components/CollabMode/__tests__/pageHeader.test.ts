// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { CollabScope } from '@nimbalyst/collab-client/core';

const openArtifact = vi.fn();
vi.mock('../../../store/atoms/collabDocuments', () => ({
  getElectronCollabHost: () => ({ openArtifact }),
  getPersonalCollabHost: () => ({ openArtifact, scope: { scopeKey: 'personal', indexConfig: {} } }),
}));

import { openPageAncestor } from '../pageHeaderNavigation';
import { isTitleHeading } from '../useTitleHeading';

describe('page header', () => {
  it('opens each crumb as the artifact it names, in its own section', () => {
    const scope = { scopeKey: 'team', orgId: 'org', indexConfig: { teamProjectId: 'proj' } } as unknown as CollabScope;
    openPageAncestor({ id: 'doc-1', kind: 'page', name: 'Product' }, { personal: false, scope });
    openPageAncestor({ id: 'module', kind: 'type', name: 'Modules' }, { personal: false, scope });
    openPageAncestor({ id: 'item-1', kind: 'item', name: 'Sync engine', typeId: 'module' }, { personal: true, workspacePath: '/w' });
    expect(openArtifact.mock.calls.map(([ref]) => ref)).toEqual([
      { kind: 'document', scope, documentId: 'doc-1', teamProjectId: 'proj' },
      { kind: 'type', scope, typeId: 'module' },
      { kind: 'tracker', scope: { scopeKey: 'personal', indexConfig: {} }, trackerId: 'item-1' },
    ]);
  });

  it('treats a body heading as the title only when it repeats it', () => {
    expect(isTitleHeading('How we write  this wiki ', 'how we write this wiki')).toBe(true);
    expect(isTitleHeading('How we write this wiki, v2', 'How we write this wiki')).toBe(false);
    expect(isTitleHeading('', '')).toBe(false);
  });
});
