// @vitest-environment jsdom
/**
 * The typed page layout runs without the desktop: the host hands it the item,
 * crumb and field values, a body to render and a links source.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { globalRegistry, type TrackerDataModel } from '@nimbalyst/tracker-schema';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { TrackerPageView } from '../TrackerPageView';

const MODULE = {
  type: 'tpv-module', displayName: 'Module', displayNamePlural: 'Modules', icon: 'widgets', color: '#888',
  modes: { inline: false, fullDocument: true }, idPrefix: 'mod', idFormat: 'ulid',
  fields: [{ name: 'title', type: 'string' }],
} as unknown as TrackerDataModel;

const item = {
  id: 'mod_1', primaryType: 'tpv-module', typeTags: [], issueKey: 'MOD-1', archived: false, source: 'native',
  fields: { title: 'Sync engine' }, fieldUpdatedAt: {}, system: {},
} as unknown as TrackerRecord;

beforeAll(() => globalRegistry.register(MODULE));
afterAll(() => globalRegistry.unregister('tpv-module'));

describe('TrackerPageView', () => {
  it('lays out crumb, title, body and links from host-supplied pieces', async () => {
    expect((window as { electronAPI?: unknown }).electronAPI).toBeUndefined();
    const onRename = vi.fn();
    const linksFor = vi.fn().mockResolvedValue([{
      direction: 'out', otherItemId: 'mod_2', otherTitle: 'Storage', otherIssueKey: 'MOD-2', otherTypeId: 'tpv-module',
      predicateId: null, relationshipTypeKey: null, sentence: 'Writes go to Storage.', sourceFieldId: 'body:link',
    }]);

    render(
      <TrackerPageView
        item={item}
        loaded
        crumb={{ section: 'Personal', ancestors: ['Architecture'], underType: true }}
        editable
        title="Sync engine"
        onRename={onRename}
        fieldValues={item.fields}
        onUpdateField={vi.fn()}
        renderBody={() => <p>Body from the host</p>}
        linksSource={{ linksFor }}
      />,
    );

    expect(screen.getByTestId('tracker-page-crumb').textContent).toBe('Personal / Architecture / Module / Sync engine');
    screen.getByText('Body from the host');
    await screen.findByText('Mentions');
    expect(linksFor).toHaveBeenCalledWith('mod_1');

    fireEvent.change(screen.getByTestId('tracker-page-title'), { target: { value: 'Sync\nengine v2' } });
    expect(onRename).toHaveBeenCalledWith('Sync engine v2');
  });
});
