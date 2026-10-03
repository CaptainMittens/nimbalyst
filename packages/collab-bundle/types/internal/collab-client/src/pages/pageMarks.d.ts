/**
 * Decision and open-question marks across pages, for a view someone places.
 *
 * A mark lives in a page's markdown body (`[sentence]{decided by=...}`); a
 * host answers `listMarks`. Team pages come from the server's marks index
 * (`pageMarksQuery`, mapped by `pageMarkRecordsFromTeamIndex`). The desktop
 * adds what it reads locally -- typed pages, Personal pages and Personal type
 * pages -- and merges the two; the web console uses the index alone.
 *
 * Logic and contracts only -- no React, no DOM.
 */
import { type PageMarkEntry } from '@nimbalyst/collab-protocol';
export type PageMarkKind = 'decided' | 'open';
/** Where the page holding a mark lives. `page` is a plain team page. */
export type PageMarkPageKind = 'page' | 'typed-page' | 'type-page' | 'personal-page';
export interface PageMarkRecord {
    /** Stable id of this mark: the page's uri plus its position in the body. */
    id: string;
    kind: PageMarkKind;
    /** The marked sentence as inline markdown. */
    text: string;
    /** The sentence reduced to plain text. */
    plainText: string;
    by: string | null;
    /** The person's email, the stable identity to search by; null or absent when the owner is not a person. */
    email?: string | null;
    /** `YYYY-MM-DD` as written, or null. */
    on: string | null;
    /** What was not chosen (decided marks), or null. */
    over: string | null;
    /** 1-based line of the mark in the page body. */
    line: number;
    page: {
        kind: PageMarkPageKind;
        scope: 'team' | 'personal';
        /** Tracker item id for a typed page, document id otherwise. */
        id: string;
        title: string;
        /** Tab uri that opens the page: `tracker://<id>`, `personal://<docId>` or a team page's `collab://` uri. */
        uri: string;
        /** Tracker type of a typed page, or of the type a type page belongs to. */
        typeId: string | null;
        issueKey: string | null;
    };
}
export interface PageMarksQuery {
    kind?: PageMarkKind;
    /** Only marks by this person (case-insensitive email match). */
    email?: string;
    /** Only pages of this tracker type. */
    typeId?: string;
    /** Case-insensitive text match on the sentence, who and what was not chosen. */
    search?: string;
    limit?: number;
}
export interface PageMarksSource {
    listMarks(query: PageMarksQuery): Promise<PageMarkRecord[]>;
    /** Called when marks may have changed; returns the unsubscribe. Optional. */
    subscribe?(listener: () => void): () => void;
}
/** A host installs its source once at startup; `null` clears it. */
export declare function setPageMarksSource(source: PageMarksSource | null): void;
export declare function getPageMarksSource(): PageMarksSource | null;
export declare function onPageMarksSourceChange(listener: () => void): () => void;
/** Applies a query to records, newest decision first; open questions keep page order. */
export declare function filterPageMarks(records: readonly PageMarkRecord[], query?: PageMarksQuery): PageMarkRecord[];
export interface TeamIndexMappingOptions {
    orgId: string;
    /**
     * Names a typed page from its tracker item. Marks in a typed page's body
     * (`tracker-content/<itemId>`) are kept only when this resolves the item, so
     * a deleted item or one this client cannot see drops out. Omit it to leave
     * typed pages out entirely (a host that reads them locally).
     */
    resolveTypedPage?: (itemId: string) => {
        title: string;
        issueKey: string | null;
        typeId: string | null;
    } | null;
}
/** Records for the marks the server's index returned. */
export declare function pageMarkRecordsFromTeamIndex(entries: readonly PageMarkEntry[], options: TeamIndexMappingOptions): PageMarkRecord[];
/** Local and server marks together; a mark listed by both appears once (the first list wins). */
export declare function mergePageMarks(first: readonly PageMarkRecord[], second: readonly PageMarkRecord[]): PageMarkRecord[];
