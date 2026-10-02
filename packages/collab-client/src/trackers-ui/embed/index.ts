/**
 * Desktop-only view embedding (type pages). A separate entry so the web
 * bundle's eager `trackers-ui` graph does not carry it.
 */
export { LazyTrackerViewEmbed as TrackerViewEmbed } from './LazyTrackerViewEmbed';
export type { TrackerViewEmbedProps } from './TrackerViewEmbed';
export { createTypePageView } from './typePageView';
export { createItemWhereResolver, type ItemWhereInput } from './typePageWhere';
export type { TrackerGridDerivedColumn } from '../grid/TrackerGridSurface';
export { pageTreeAncestors, type PageTreeAncestorsInput, type PageTreeNodeRef } from './pageTreeAncestors';
// The type page lists what the tree row counts: a type and its subtypes.
export { typeWithSubtypes } from '../../docs/collabPageTree';
