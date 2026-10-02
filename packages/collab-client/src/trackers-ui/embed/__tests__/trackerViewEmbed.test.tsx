/**
 * A view embed draws from the items: it renders the view in its own mode and
 * follows item changes as they stream in.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { trackerRecordToItem, type TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { globalRegistry, type TrackerDataModel } from '@nimbalyst/tracker-schema';
import {
  createDefaultViewDefinition,
  serializeSharedSavedView,
  type TrackerDataChange,
  type TrackerDataSource,
} from '@nimbalyst/collab-client/trackers';
import { TrackersUIProvider } from '../../TrackersUIProvider';
import { TrackerViewEmbed } from '../TrackerViewEmbed';
import { createTypePageView } from '../typePageView';

function model(type: string, fields: TrackerDataModel['fields']): TrackerDataModel {
  return {
    type, displayName: type, displayNamePlural: `${type}s`, icon: 'circle', color: '#888888',
    modes: { inline: false, fullDocument: false }, idPrefix: type.slice(0, 3), idFormat: 'ulid', fields,
  } as TrackerDataModel;
}

function record(id: string, type: string, fields: Record<string, unknown>): TrackerRecord {
  return {
    id, primaryType: type, typeTags: [type], source: 'native', archived: false, syncStatus: 'local',
    system: { workspace: '/w', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    fields,
  } as unknown as TrackerRecord;
}

const braze = (title: string) => record('braze', 'ev-target', { title });
const cap = record('cap-rt', 'ev-cap', { title: 'Realtime targeting' });
const comparison = {
  id: 'v-cmp',
  name: 'Comparison',
  definition: { ...createDefaultViewDefinition(), selectedType: 'ev-target', viewMode: 'list' as const, statusScope: 'all' as const },
};

function fakeSource(): TrackerDataSource & { emit(change: TrackerDataChange): void } {
  const listeners = new Set<(change: TrackerDataChange) => void>();
  return {
    snapshot: async () => ({
      items: [braze('Braze'), cap].map(trackerRecordToItem),
      savedViews: [{ viewId: comparison.id, payload: serializeSharedSavedView(comparison) }],
      presence: [],
      sync: { workspacePath: '/w', status: 'connected', projectId: null },
    }),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    status: () => ({ workspacePath: '/w', status: 'connected', projectId: null }),
    command: vi.fn(async () => ({ ok: true as const })),
    getItemRevision: vi.fn(),
    dispose: () => {},
    emit: (change) => { for (const listener of listeners) listener(change); },
  } as TrackerDataSource & { emit(change: TrackerDataChange): void };
}

beforeAll(() => {
  globalRegistry.register(model('ev-cap', [{ name: 'title', type: 'string' }]));
  globalRegistry.register(model('ev-target', [
    { name: 'title', type: 'string' },
    { name: 'supports', type: 'relationship', multiValue: true, targetTrackerTypes: ['ev-cap'], predicate: 'supports' },
  ]));
});

afterAll(() => {
  globalRegistry.unregister('ev-cap');
  globalRegistry.unregister('ev-target');
});

describe('TrackerViewEmbed', () => {
  it('draws the view in its own mode and follows item changes', async () => {
    const source = fakeSource();
    const onOpenAsTable = vi.fn();
    render(
      <TrackersUIProvider dataSource={source} identity={null}>
        <TrackerViewEmbed view={comparison} onOpenAsTable={onOpenAsTable} />
      </TrackersUIProvider>,
    );

    const embed = await screen.findByTestId('tracker-saved-view-embed');
    expect(embed.dataset.viewMode).toBe('list');
    await screen.findByText('Braze');

    act(() => source.emit({ type: 'items-upserted', items: [trackerRecordToItem(braze('Braze Engage'))] }));
    await screen.findByText('Braze Engage');
    expect(screen.queryByText('Braze')).toBeNull();

    fireEvent.click(screen.getByTestId('tracker-saved-view-embed-open'));
    expect(onOpenAsTable).toHaveBeenCalledWith(expect.objectContaining({ id: 'v-cmp', name: 'Comparison' }));
  });

  it('draws a type page from a synthetic view: that type only, as a table', async () => {
    render(
      <TrackersUIProvider dataSource={fakeSource()} identity={null}>
        <TrackerViewEmbed view={createTypePageView('ev-target')} variant="page" />
      </TrackersUIProvider>,
    );
    const embed = await screen.findByTestId('tracker-saved-view-embed');
    expect(embed.dataset.viewMode).toBe('table');
    await screen.findByText('1 item');
  });

  it('lists the items of every type a type page names (its subtypes)', async () => {
    render(
      <TrackersUIProvider dataSource={fakeSource()} identity={null}>
        <TrackerViewEmbed view={createTypePageView('ev-target')} variant="page" typeIds={['ev-target', 'ev-cap']} />
      </TrackersUIProvider>,
    );
    await screen.findByText('2 items');
  });
});
