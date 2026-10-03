/**
 * Which `nimbalyst://<rest>` hrefs are tracker references.
 *
 * Tracker keys take several real shapes, so an allowlist of key *patterns* is
 * not viable: issue keys (`NIM-123`), type-prefixed record ids
 * (`bug_01JBKZ...`, `github-pr_...`, `decision-exploration_...`), and
 * frontmatter-projected ids (`fm:plan:planning/foo.md`). The tracker picker
 * inserts `record.issueKey ?? record.id`, so any item without an allocated
 * issue key is referenced by its raw id — those exist in real databases.
 *
 * The reliable discriminator is the slash: every other `nimbalyst://`
 * namespace is `host/path` (`action/open-project-manager`, `doc/<id>`,
 * `folder/<id>`, `tracker/<id>`, `install/<extId>`, `auth/callback`), while a
 * tracker key never contains one. Reserved hosts are also rejected bare so a
 * future `nimbalyst://action` with no path cannot be mistaken for a key.
 */

import { CONSOLE_LINK_ORIGIN, parseConsoleLink } from '@nimbalyst/collab-protocol';

/** Hosts owned by the deep-link router; never tracker keys. */
const RESERVED_LINK_HOSTS = new Set([
  'action',
  'auth',
  'console',
  'doc',
  'folder',
  'install',
  'tracker',
]);

/**
 * Any run of characters that is not a slash, closing paren, or whitespace,
 * excluding a bare reserved host. Kept in sync with RESERVED_LINK_HOSTS so the
 * markdown transformer and the runtime check cannot disagree.
 */
export const TRACKER_REFERENCE_KEY_PATTERN = `(?!(?:${[...RESERVED_LINK_HOSTS].join('|')})(?=[)\\s]|$))[^)\\s/]+`;

const TRACKER_REFERENCE_KEY_RE = new RegExp(
  `^${TRACKER_REFERENCE_KEY_PATTERN}$`,
);

export function isTrackerReferenceKey(value: string): boolean {
  if (!TRACKER_REFERENCE_KEY_RE.test(value)) return false;
  return !RESERVED_LINK_HOSTS.has(value.toLowerCase());
}

const URN_SCHEME = 'nimbalyst://';
const URL_SEGMENT = String.raw`[^/\s()"?#]+`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A console link to a typed page, the form new references are written in:
 * `https://console.nimbalyst.com/org/<org>/project/<project>/trackers/item/<KEY>`
 * for a team item, `https://console.nimbalyst.com/app/item/<KEY>` for a local
 * one. A trailing query or hash is allowed; links to pages, types and views
 * are not tracker references. `consoleLinks.ts` in collab-protocol owns the
 * shape; this pattern only finds candidates, which `trackerReferenceKeyFromHref`
 * confirms through `parseConsoleLink`.
 */
export const TRACKER_REFERENCE_CONSOLE_HREF_PATTERN = `${escapeRegExp(CONSOLE_LINK_ORIGIN)}/(?:org/${URL_SEGMENT}/project/${URL_SEGMENT}/trackers/item|app/item)/${URL_SEGMENT}(?:[?#][^\\s()"]*)?`;

/**
 * The reference key a link points at: `nimbalyst://KEY` (the Phase 3 form,
 * still read everywhere) or a console item link. Null for any other href.
 */
export function trackerReferenceKeyFromHref(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed.startsWith(URN_SCHEME)) {
    const key = trimmed.slice(URN_SCHEME.length);
    return isTrackerReferenceKey(key) ? key : null;
  }
  const target = parseConsoleLink(trimmed);
  return target?.kind === 'item' ? target.itemRef : null;
}

/**
 * Builds the link a newly created reference is written with. The host
 * registers it once it knows its team (the console link to the item);
 * without one, a new reference is written as `nimbalyst://KEY`.
 */
let hrefBuilder: ((referenceKey: string) => string | null) | null = null;

export function setTrackerReferenceHrefBuilder(builder: ((referenceKey: string) => string | null) | null): void {
  hrefBuilder = builder;
}

/** The href for a new reference, or null to write the `nimbalyst://KEY` form. */
export function buildTrackerReferenceHref(referenceKey: string): string | null {
  return hrefBuilder?.(referenceKey) ?? null;
}
