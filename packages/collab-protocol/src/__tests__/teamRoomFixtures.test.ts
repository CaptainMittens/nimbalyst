// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

import type {
  ItemPlacementNode,
  TeamClientMessage,
  TeamServerMessage,
  TeamState,
} from '../teamRoom.js';

/**
 * Golden TeamRoom fixtures for the one page tree (`fixtures/team/`). Team
 * messages never reach iOS or Android, so they stay out of the mobile manifest
 * in `fixtures/index.json`; the server and the runtime client both compile
 * against these same types. Each witness must spell out every optional field,
 * so a field added to the wire type without its fixture fails tsc.
 */

type Exhaustive<T> = { [K in keyof T]-?: Exclude<T[K], undefined> };
type Client<T extends TeamClientMessage['type']> = Exhaustive<Extract<TeamClientMessage, { type: T }>>;
type Server<T extends TeamServerMessage['type']> = Exhaustive<Extract<TeamServerMessage, { type: T }>>;

const node = {
  itemId: 'NIM-42', projectId: 'project-1', parentId: 'page-1', sortOrder: 2,
  createdBy: 'member-1', createdAt: 1790000000000, updatedAt: 1790000001000,
} satisfies Exhaustive<ItemPlacementNode>;
const rootNode = { ...node, itemId: 'NIM-43', parentId: null, sortOrder: 0 } satisfies ItemPlacementNode;

const pageTreeTeam = {
  metadata: {
    orgId: 'org-1', name: 'Team', gitRemoteHash: null, teamProjectId: 'project-1',
    createdBy: 'member-1', createdAt: 1790000000000,
  },
  members: [],
  documents: [{
    documentId: 'page-1', encryptedTitle: 'Specs', titleIv: '', documentType: 'markdown',
    createdBy: 'member-1', createdAt: 1790000000000, updatedAt: 1790000000000,
    projectId: 'project-1', lastWriterUserId: null, parentFolderId: null, trashedAt: null,
  }],
  // The older-client projection: the page has a child placement.
  folders: [{
    folderId: 'page-1', parentFolderId: null, encryptedName: 'Specs', nameIv: '', sortOrder: 0,
    projectId: 'project-1', createdBy: 'member-1', createdAt: 1790000000000, updatedAt: 1790000000000,
  }],
  pageTree: true,
  typePlacements: [],
  itemPlacements: [node],
} satisfies Omit<TeamState, 'settings'> & Exhaustive<Pick<TeamState, 'folders' | 'pageTree' | 'typePlacements' | 'itemPlacements'>>;

const fixtures: Record<string, unknown> = {
  'itemPlacementIndexSync.json': { type: 'itemPlacementIndexSync' } satisfies Client<'itemPlacementIndexSync'>,
  'itemPlacementSet.json': {
    type: 'itemPlacementSet', itemId: 'NIM-42', projectId: 'project-1', parentId: 'page-1', sortOrder: 2,
  } satisfies Client<'itemPlacementSet'>,
  'itemPlacementRemove.json': {
    type: 'itemPlacementRemove', itemId: 'NIM-42', projectId: 'project-1',
  } satisfies Client<'itemPlacementRemove'>,
  'itemPlacementIndexSyncResponse.json': {
    type: 'itemPlacementIndexSyncResponse', placements: [node, rootNode],
  } satisfies Server<'itemPlacementIndexSyncResponse'>,
  'itemPlacementBroadcast.json': { type: 'itemPlacementBroadcast', placement: node } satisfies Server<'itemPlacementBroadcast'>,
  'itemPlacementRemoveBroadcast.json': {
    type: 'itemPlacementRemoveBroadcast', projectId: 'project-1', itemIds: ['NIM-42', 'NIM-43'],
  } satisfies Server<'itemPlacementRemoveBroadcast'>,
  'teamSyncResponse.pageTree.json': { type: 'teamSyncResponse', team: pageTreeTeam } satisfies Extract<TeamServerMessage, { type: 'teamSyncResponse' }>,
};

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/team');

it('binds every team fixture file to its typed witness', () => {
  expect(readdirSync(fixtureDir).filter(file => file.endsWith('.json')).sort()).toEqual(Object.keys(fixtures).sort());
  for (const [file, witness] of Object.entries(fixtures)) {
    expect(JSON.parse(readFileSync(resolve(fixtureDir, file), 'utf8')), file).toEqual(witness);
  }
});
