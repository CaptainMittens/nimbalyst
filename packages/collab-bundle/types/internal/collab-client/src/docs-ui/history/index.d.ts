/**
 * Shared-document page history: the dialog, the controller a host hands it,
 * and the restore write path. Editor-free; the rich markdown diff is the
 * runtime DiffPlugin's `DiffPreviewEditor`, which the host supplies.
 */
export { CollabHistoryDialog } from './CollabHistoryDialog';
export type { CollabHistoryDialogProps, CollabHistoryDiffNavigationState, CollabHistoryDiffProps, } from './CollabHistoryDialog';
export { canRestoreCollabRevisions, isCollabRestoreSafe, restoreCollabRevision, type CollabHistoryController, } from './collabHistoryController';
export { loadCollabHistoryCompare, planCollabHistoryCompare, type CollabHistoryCompareContent, type CollabHistoryCompareLoaders, type CollabHistoryCompareMode, type CollabHistoryComparePlan, type CollabHistorySide, } from './collabHistoryCompare';
export { CollabHistoryClient, CollabHistoryError } from '../../../../runtime/src/sync/collabHistoryClient';
