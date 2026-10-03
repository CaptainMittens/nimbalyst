/**
 * The desktop renderer for a view placed in a page
 * (a placed-view link alone on its line, see `placedViewUrl.ts`).
 *
 * It brings its own `TrackersUIProvider` because a document tab has none; the
 * data source reads the tracker atoms the listeners already keep current (no
 * second item load), and a cell edit writes through the same IPC paths as
 * Tracker mode, so editing a cell edits the item it points at. A marks list
 * reads the page-marks source the host installs at startup.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { useAtomValue, useStore } from 'jotai';
import type { PlacedViewTarget } from '@nimbalyst/runtime/core/placedViewUrl';
import { DESKTOP_TRACKER_UI_CAPABILITIES, TrackersUIProvider } from '@nimbalyst/collab-client/trackers-ui';
import { PlacedViewEmbed, PlacedViewNote } from '@nimbalyst/collab-client/trackers-ui/embed';
import { ElectronTrackerDataSource } from '../../services/ElectronTrackerDataSource';
import { activeWorkspacePathAtom } from '../../store/atoms/openProjects';
import { navigateToTrackerItem } from '../PullRequestMode/trackerNavigation';
import { openAgentEditedPage } from '../../utils/agentEditedPage';
import { createDesktopTrackerDataSource } from './desktopTrackerDataSource';
import { useDesktopTrackerIdentity } from './useDesktopTrackerIdentity';

export interface PlacedViewEmbedFrameProps {
  target: PlacedViewTarget;
  label: string;
  attrs: Record<string, string>;
}

export const PlacedViewEmbedFrame: React.FC<PlacedViewEmbedFrameProps> = (props) => {
  const workspacePath = useAtomValue(activeWorkspacePathAtom);
  if (!workspacePath) {
    return <PlacedViewNote>{props.label || 'View'}: open a project to see this view.</PlacedViewNote>;
  }
  return <WorkspacePlacedView workspacePath={workspacePath} {...props} />;
};

const WorkspacePlacedView: React.FC<PlacedViewEmbedFrameProps & { workspacePath: string }> = ({
  workspacePath,
  target,
  label,
  attrs,
}) => {
  const store = useStore();
  const identity = useDesktopTrackerIdentity(workspacePath);
  const writer = useMemo(() => new ElectronTrackerDataSource({ workspacePath }), [workspacePath]);
  useEffect(() => () => writer.dispose(), [writer]);
  const dataSource = useMemo(
    () => createDesktopTrackerDataSource({ workspacePath, store, writer }),
    [workspacePath, store, writer],
  );
  // `TrackerIdentity.email` is nullable; the provider's "me" needs one to stamp `by` on an edit.
  const trackerIdentity = identity?.email ? identity : null;
  // A listed mark opens the page it is on, in Pages mode.
  const openPage = useCallback((uri: string) => {
    void openAgentEditedPage(uri, workspacePath).catch((error) => console.warn('[PlacedViewEmbedFrame] could not open page', uri, error));
  }, [workspacePath]);
  return (
    <TrackersUIProvider dataSource={dataSource} identity={trackerIdentity} capabilities={DESKTOP_TRACKER_UI_CAPABILITIES}>
      <PlacedViewEmbed target={target} label={label} attrs={attrs} onOpenItem={navigateToTrackerItem} onOpenPage={openPage} />
    </TrackersUIProvider>
  );
};
