/**
 * Knowledge pages for a browser host: the cross-page marks contract
 * (decisions and open questions) and the mapping from the team's marks index.
 *
 * Its own small entry so the docs route can install a marks source without
 * pulling the tracker grid, while `trackers-ui` (where a marks view renders)
 * shares this one module instance, and with it the installed source.
 */
export * from '@nimbalyst/collab-client/pages';
// The request/response matcher the desktop's TeamSync uses for the same query.
export { TeamPageMarksRequests } from '@nimbalyst/runtime/sync/teamPageMarks';
export type { TeamPageMarksFilters, TeamPageMarksResult } from '@nimbalyst/runtime/sync/teamPageMarks';
