/**
 * A view embed draws from the items: it renders the view in its own mode and
 * follows item changes as they stream in.
 */

import { createElement } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { PlacedViewEmbed } from '../PlacedViewEmbed';
import { MarksListEmbed } from '../MarksListEmbed';
import { setPageMarksSource } from '../../../pages';

// The real grid surface runs; only the web component is a bare element, so a
// test can fire the `afteredit` RevoGrid would fire after a cell edit.
vi.mock('@revolist/react-datagrid', () => ({
  RevoGrid: (props: { readonly?: boolean }) => createElement('revo-grid', { 'data-readonly': String(Boolean(props.readonly)) }),
}));

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

const braze = (title: string) => record('braze', 'ev-target', { title, realtime: 0.5 });
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
    { name: 'realtime', type: 'number' },
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

  it('leaves an archived typed page out of the view, as the tree and Tracker mode do', async () => {
    const source = fakeSource();
    render(
      <TrackersUIProvider dataSource={source} identity={null}>
        <TrackerViewEmbed view={createTypePageView('ev-target')} variant="page" typeIds={['ev-target', 'ev-cap']} />
      </TrackersUIProvider>,
    );
    await screen.findByText('2 items');
    act(() => source.emit({ type: 'items-upserted', items: [trackerRecordToItem({ ...braze('Braze'), archived: true })] }));
    await screen.findByText('1 item');
  });
});

describe('TrackerViewEmbed editing', () => {
  const scoreView = {
    ...createTypePageView('ev-target'),
    definition: {
      ...createTypePageView('ev-target').definition,
      columnConfig: { visibleColumns: ['title', 'realtime'], columnWidths: {} },
    },
  };
  const editCell = (val: unknown) => {
    const grid = document.querySelector('revo-grid')!;
    grid.dispatchEvent(new CustomEvent('afteredit', { detail: { rowIndex: 0, prop: 'realtime', val } }));
  };

  it('writes a cell edit to the item as update-items with the coerced value', async () => {
    const source = fakeSource();
    render(
      <TrackersUIProvider dataSource={source} identity={null}>
        <TrackerViewEmbed view={scoreView} />
      </TrackersUIProvider>,
    );
    await screen.findByText('1 item');
    expect(document.querySelector('revo-grid')!.getAttribute('data-readonly')).toBe('false');

    editCell('0.7');
    await waitFor(() => expect(source.command).toHaveBeenCalledWith({
      type: 'update-items',
      input: { entries: [{ itemId: 'braze', storeUpdates: { realtime: 0.7 } }] },
    }));
  });

  it('is read-only when the host says so', async () => {
    const source = fakeSource();
    render(
      <TrackersUIProvider dataSource={source} identity={null}>
        <TrackerViewEmbed view={scoreView} readOnly />
      </TrackersUIProvider>,
    );
    await screen.findByText('1 item');
    expect(document.querySelector('revo-grid')!.getAttribute('data-readonly')).toBe('true');
    editCell('0.7');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(source.command).not.toHaveBeenCalled();
  });

  it('shows the host refusal instead of pretending the edit saved', async () => {
    const source = fakeSource();
    vi.mocked(source.command).mockRejectedValueOnce(new Error('This type is archived'));
    render(
      <TrackersUIProvider dataSource={source} identity={null}>
        <TrackerViewEmbed view={scoreView} />
      </TrackersUIProvider>,
    );
    await screen.findByText('1 item');
    editCell('0.7');
    expect((await screen.findByRole('alert')).textContent).toContain('This type is archived');
  });
});

describe('PlacedViewEmbed', () => {
  it('draws a 2x2 of the type by two fields, with pinned points highlighted', async () => {
    render(
      <TrackersUIProvider dataSource={fakeSource()} identity={null}>
        <PlacedViewEmbed
          target={{ kind: 'type', typeId: 'ev-target' }}
          label="Landscape"
          attrs={{ mode: '2x2', x: 'realtime', y: 'realtime', pin: 'Us@0.9,0.9' }}
        />
      </TrackersUIProvider>,
    );
    await screen.findByText('1 placed');
    expect(screen.getByText('Braze')).toBeDefined();
    expect(screen.getByText('Us').closest('g')!.getAttribute('data-pinned')).toBe('true');
  });

  const projectA = { orgId: 'org-1', projectId: 'proj-a' };
  const projectB = { orgId: 'org-1', projectId: 'proj-b' };

  it.each([
    ['another team project', projectA, { team: projectB, local: true }],
    ['a local view on a team page', 'local' as const, { team: projectB, local: false }],
    ['a team view in a window with no team', projectB, { team: null, local: true }],
  ])('never draws or edits the items of %s; it offers the link instead', async (_name, scope, reach) => {
    const source = fakeSource();
    const onOpenLink = vi.fn();
    render(
      <TrackersUIProvider dataSource={source} identity={null}>
        <PlacedViewEmbed
          target={{ kind: 'type', typeId: 'ev-target', scope }}
          label="Targets"
          attrs={{}}
          reach={reach}
          onOpenLink={onOpenLink}
        />
      </TrackersUIProvider>,
    );
    const note = await screen.findByTestId('placed-view-out-of-scope');
    expect(note.textContent).toContain('another project');
    expect(screen.queryByText('Braze')).toBeNull();
    expect(document.querySelector('revo-grid')).toBeNull();
    fireEvent.click(screen.getByTestId('placed-view-open-link'));
    expect(onOpenLink).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/console\.nimbalyst\.com\/.*\/view\/type\/ev-target$/));
    expect(source.command).not.toHaveBeenCalled();
  });

  it('draws a view whose scope this window reaches', async () => {
    render(
      <TrackersUIProvider dataSource={fakeSource()} identity={null}>
        <PlacedViewEmbed target={{ kind: 'type', typeId: 'ev-target', scope: projectB }} label="Targets" attrs={{}} reach={{ team: projectB, local: false }} />
      </TrackersUIProvider>,
    );
    await screen.findByText('1 item');
    expect(screen.queryByTestId('placed-view-out-of-scope')).toBeNull();
  });
});

describe('MarksListEmbed', () => {
  const decided = {
    id: 'tracker://cmp_1#4', kind: 'decided' as const, text: 'Use **Yjs**', plainText: 'Use Yjs',
    by: 'Greg', on: '2026-10-02', over: 'Automerge', line: 4,
    page: { kind: 'typed-page' as const, scope: 'team' as const, id: 'cmp_1', title: 'Sync engine', uri: 'tracker://cmp_1', typeId: 'module', issueKey: null },
  };
  afterEach(() => setPageMarksSource(null));

  it('lists marks of one kind from the host source, and opens the page a mark is on', async () => {
    const listMarks = vi.fn(async () => [decided]);
    setPageMarksSource({ listMarks });
    const onOpenPage = vi.fn();
    render(<MarksListEmbed kind="decided" label="Decisions" attrs={{ type: 'module' }} onOpenPage={onOpenPage} />);

    await screen.findByText('Use Yjs');
    expect(listMarks).toHaveBeenCalledWith({ kind: 'decided', typeId: 'module' });
    expect(screen.getByTestId('marks-list-meta').textContent).toBe('Greg, 2026-10-02, over Automerge');
    fireEvent.click(screen.getByText('Sync engine'));
    expect(onOpenPage).toHaveBeenCalledWith('tracker://cmp_1');
  });

  it('says so when the host cannot read marks', () => {
    render(<MarksListEmbed kind="open" label="Open questions" attrs={{}} />);
    expect(screen.getByTestId('placed-view-note').textContent).toContain('Open questions');
  });
});
