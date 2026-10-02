/**
 * A tracker type opened as a page in Pages mode (`type://<typeId>`): the type's
 * name over its table. The table is the shared view embed fed a built-in "All"
 * view, so it reads the same tracker atoms Tracker mode does and writes through
 * the same IPC paths. Named views are created on purpose; none are derived here.
 */

import React, { useEffect, useMemo } from 'react';
import { useStore } from 'jotai';
import { DESKTOP_TRACKER_UI_CAPABILITIES, TrackersUIProvider } from '@nimbalyst/collab-client/trackers-ui';
import { TrackerViewEmbed, createTypePageView } from '@nimbalyst/collab-client/trackers-ui/embed';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { globalRegistry } from '@nimbalyst/tracker-schema';
import { ElectronTrackerDataSource } from '../../services/ElectronTrackerDataSource';
import { createDesktopTrackerDataSource } from '../EmbedFrame/desktopTrackerDataSource';
import { useDesktopTrackerIdentity } from '../EmbedFrame/useDesktopTrackerIdentity';
import { typePageTitle } from './collabPageTabs';

export interface TypePageTabProps {
  typeId: string;
  workspacePath: string;
  /** Opens a row's item as a page tab in this mode. */
  onOpenItem: (itemId: string) => void;
}

export const TypePageTab: React.FC<TypePageTabProps> = ({ typeId, workspacePath, onOpenItem }) => {
  const store = useStore();
  const identity = useDesktopTrackerIdentity(workspacePath);
  const writer = useMemo(() => new ElectronTrackerDataSource({ workspacePath }), [workspacePath]);
  useEffect(() => () => writer.dispose(), [writer]);
  const dataSource = useMemo(
    () => createDesktopTrackerDataSource({ workspacePath, store, writer }),
    [workspacePath, store, writer],
  );
  const view = useMemo(() => createTypePageView(typeId), [typeId]);
  // `TrackerIdentity.email` is nullable; the provider's "me" needs one to stamp `by` on an edit.
  const trackerIdentity = identity?.email ? identity : null;
  const model = globalRegistry.get(typeId);

  return (
    <div className="type-page-tab flex h-full min-h-0 flex-col overflow-hidden bg-nim" data-testid="type-page-tab" data-type-id={typeId}>
      <div className="type-page-tab-header shrink-0 px-6 pt-5 pb-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-nim">
          {model?.icon ? <MaterialSymbol icon={model.icon} size={22} style={{ color: model.color }} /> : null}
          {typePageTitle(typeId)}
        </h1>
        <div className="type-page-tab-views mt-3 flex items-center gap-4 border-b border-nim text-[13px]">
          <span className="-mb-px border-b-2 border-[var(--nim-primary)] pb-1.5 font-medium text-nim">All</span>
        </div>
      </div>
      <div className="type-page-tab-body flex min-h-0 flex-1 flex-col px-6 pb-4">
        <TrackersUIProvider dataSource={dataSource} identity={trackerIdentity} capabilities={DESKTOP_TRACKER_UI_CAPABILITIES}>
          <TrackerViewEmbed view={view} variant="page" onOpenItem={onOpenItem} />
        </TrackersUIProvider>
      </div>
    </div>
  );
};
