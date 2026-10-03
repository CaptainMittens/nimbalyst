// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bodyLinkKeys, deriveBodyLinkEdges, parseBodyLinks } from '../trackerBodyLinks';

const TEAM_ITEM = 'https://console.nimbalyst.com/org/o/project/p/trackers/item';

describe('trackerBodyLinks', () => {
  it('reads console item links and nimbalyst:// links alike', () => {
    const markdown = [
      `Sync is [NIM-1](${TEAM_ITEM}/NIM-1 "view=card rel=built-on") underneath. Old: [NIM-2](nimbalyst://NIM-2 "rel=owned-by").`,
      'Mine: [tk_9](https://console.nimbalyst.com/app/item/tk_9).',
    ].join('\n');
    expect(parseBodyLinks(markdown)).toEqual([
      { key: 'NIM-1', rel: 'built-on', sentence: 'Sync is NIM-1 underneath.' },
      { key: 'NIM-2', rel: 'owned-by', sentence: 'Old: NIM-2.' },
      { key: 'tk_9', rel: null, sentence: 'Mine: tk_9.' },
    ]);
  });

  it('decodes the key and ignores the list-context query the console adds', () => {
    expect(bodyLinkKeys(`[x](${TEAM_ITEM}/NIM%2D3?type=bug "rel=built-on")`)).toEqual(['NIM-3']);
  });

  it('does not read console links to pages, types or views, other sites, or code', () => {
    const markdown = [
      '[Spec](https://console.nimbalyst.com/org/o/project/p/document/doc-1) and',
      '[Bugs](https://console.nimbalyst.com/org/o/project/p/trackers/type/bug) and',
      '[x](https://example.com/org/o/project/p/trackers/item/NIM-1) and',
      `\`[NIM-4](${TEAM_ITEM}/NIM-4)\``,
    ].join('\n');
    expect(parseBodyLinks(markdown)).toEqual([]);
  });

  it('makes one edge per target and relation across both link forms', () => {
    const markdown = `[a](${TEAM_ITEM}/NIM-1 "rel=built-on") then [b](nimbalyst://NIM-1 "rel=built-on").`;
    const edges = deriveBodyLinkEdges('src', markdown, (key) => (key === 'NIM-1' ? { itemId: 'item-1', type: 'module' } : null));
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ sourceFieldId: 'body:built-on', targetItemId: 'item-1', metadata: { count: 2 } });
  });
});
