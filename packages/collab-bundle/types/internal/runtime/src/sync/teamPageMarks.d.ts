/**
 * Queries against the TeamRoom's marks index (`pageMarksQuery` ->
 * `pageMarksResponse`), matched by request id so several can be in flight.
 * A query is a read: it is never queued offline, and it answers null when the
 * socket is down or the server does not reply in time.
 */
import type { PageMarkEntry, TeamPageMarksQueryMessage, TeamPageMarksResponseMessage } from '@nimbalyst/collab-protocol';
export type TeamPageMarksFilters = Pick<TeamPageMarksQueryMessage, 'kind' | 'email' | 'documentIds'>;
export interface TeamPageMarksResult {
    marks: PageMarkEntry[];
    status: TeamPageMarksResponseMessage['status'];
}
export declare class TeamPageMarksRequests {
    private readonly pending;
    /** `send` returns false when the message could not go out. */
    request(send: (message: TeamPageMarksQueryMessage) => boolean, filters: TeamPageMarksFilters, timeoutMs: number): Promise<TeamPageMarksResult | null>;
    receive(message: TeamPageMarksResponseMessage): void;
    /** Every open query answers null (disconnect, destroy). */
    cancelAll(): void;
    private settle;
}
