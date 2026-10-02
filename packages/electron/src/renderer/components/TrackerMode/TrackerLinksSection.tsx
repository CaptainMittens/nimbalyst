/**
 * "Links" — the relations and mentions of a page, at the bottom of the detail
 * pane. One collapsed line per relation (incoming relations read under their
 * inverse name, symmetric ones merge both directions); expanding a line shows
 * the sentence that made each link. Hidden when the page has no links.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { globalRegistry, relationInverseLabel } from '@nimbalyst/tracker-schema';
import { resolveRelationshipType, type TrackerPageLink } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerRelationships';

export type { TrackerPageLink };

interface LinkedPage {
  itemId: string;
  title: string;
  typeId: string;
  sentences: string[];
}

export interface TrackerLinkGroup {
  label: string;
  pages: LinkedPage[];
}

const MENTIONS = 'Mentions';
const MENTIONED_IN = 'Mentioned in';

function linkLabel(link: TrackerPageLink, itemType: string | undefined): string {
  if (link.predicateId) {
    const predicate = globalRegistry.getPredicate(link.predicateId);
    if (!predicate) return link.predicateId;
    return link.direction === 'out' ? predicate.label : relationInverseLabel(predicate);
  }
  if (link.sourceFieldId.startsWith('body:')) return link.direction === 'out' ? MENTIONS : MENTIONED_IN;
  // A relationship field without a declared predicate: the indexed type key
  // carries a per-value override (a `depends-on` field holding a `blocks`
  // value), so it wins. The field's default type is only a fallback; the field
  // lives on the source item's type.
  let typeKey = link.relationshipTypeKey ?? null;
  if (!typeKey) {
    const sourceType = link.direction === 'out' ? itemType : link.otherTypeId;
    typeKey = globalRegistry.get(sourceType ?? '')?.fields.find((f) => f.name === link.sourceFieldId)?.relationshipTypeKey ?? null;
  }
  const rel = resolveRelationshipType(typeKey ?? undefined);
  if (rel) return link.direction === 'out' ? rel.displayName : (rel.inverseDisplayName ?? rel.displayName);
  // A workspace key with no registered type (`part-of`, `concerns`) has no
  // inverse name. Going out, the key reads as is. Coming in, the other item's
  // field name says what this page is to it: "parent" on a child means this
  // page is its parent.
  if (link.direction === 'out') return humanizeKey(typeKey ?? link.sourceFieldId);
  return `${humanizeKey(link.sourceFieldId)} of`;
}

/** `part-of` or `dependsOn` as a label: "Part of", "Depends on". */
function humanizeKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Group links by the label they read under from this page; mentions sort last. */
export function groupTrackerPageLinks(links: TrackerPageLink[], itemType: string | undefined): TrackerLinkGroup[] {
  const groups = new Map<string, Map<string, LinkedPage>>();
  for (const link of links) {
    const label = linkLabel(link, itemType);
    let pages = groups.get(label);
    if (!pages) groups.set(label, (pages = new Map()));
    let page = pages.get(link.otherItemId);
    if (!page) {
      page = { itemId: link.otherItemId, title: link.otherTitle || link.otherIssueKey || link.otherItemId, typeId: link.otherTypeId, sentences: [] };
      pages.set(link.otherItemId, page);
    }
    if (link.sentence && !page.sentences.includes(link.sentence)) page.sentences.push(link.sentence);
  }
  const rank = (label: string) => (label === MENTIONS ? 1 : label === MENTIONED_IN ? 2 : 0);
  return Array.from(groups, ([label, pages]) => ({ label, pages: Array.from(pages.values()) }))
    .sort((a, b) => rank(a.label) - rank(b.label));
}

interface TrackerLinksSectionProps {
  workspacePath?: string;
  itemId: string;
  itemType?: string;
  /** Bumped by the host after a save that may have re-indexed links. */
  revision?: number;
  onOpenItem?: (itemId: string) => void;
}

export const TrackerLinksSection: React.FC<TrackerLinksSectionProps> = ({ workspacePath, itemId, itemType, revision = 0, onOpenItem }) => {
  const [links, setLinks] = useState<TrackerPageLink[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const fetchedItemRef = useRef<string | null>(null);

  useEffect(() => {
    // A new page fetches at once and drops the previous page's links; a save on
    // the same page coalesces into one fetch.
    const samePage = fetchedItemRef.current === itemId;
    if (!samePage) {
      fetchedItemRef.current = itemId;
      setLinks([]);
      setExpanded(new Set());
    }
    if (!workspacePath) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      window.electronAPI
        .invoke('document-service:tracker-item-links', { workspacePath, itemId })
        .then((res: any) => {
          if (cancelled) return;
          if (res?.success && Array.isArray(res.links)) setLinks(res.links);
          else if (!samePage) setLinks([]);
        })
        .catch((err: unknown) => console.error('[TrackerLinksSection] Failed to load links:', err));
    }, samePage ? 400 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [workspacePath, itemId, revision]);

  const groups = useMemo(() => groupTrackerPageLinks(links, itemType), [links, itemType]);
  if (groups.length === 0) return null;

  const toggle = (label: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (!next.delete(label)) next.add(label);
    return next;
  });

  const pageButton = (page: LinkedPage, className = '') => (
    <button
      key={page.itemId}
      type="button"
      className={`tracker-links-page inline-flex items-baseline gap-1 min-w-0 text-nim hover:underline disabled:cursor-default disabled:no-underline ${className}`}
      disabled={!onOpenItem}
      onClick={(e) => { e.stopPropagation(); onOpenItem?.(page.itemId); }}
    >
      <span className="text-[11px] text-nim-faint">{globalRegistry.get(page.typeId)?.displayName ?? page.typeId}</span>
      <span className="truncate">{page.title}</span>
    </button>
  );

  return (
    <div className="tracker-links-section @container space-y-1 select-text">
      <h4 className="text-xs font-medium text-nim-muted uppercase tracking-wide">Links</h4>
      {groups.map((group) => {
        const open = expanded.has(group.label);
        return (
          <div key={group.label}>
            <div
              className="tracker-links-line flex items-baseline gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-nim-hover cursor-pointer"
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onClick={() => toggle(group.label)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(group.label); } }}
            >
              <span className={`text-[9px] text-nim-faint transition-transform ${open ? 'rotate-90' : ''}`}>&#9654;</span>
              <span className="text-nim-muted shrink-0 w-28 @md:w-36 truncate">{group.label}</span>
              <span className="text-[12px] text-nim-faint shrink-0 w-4">{group.pages.length}</span>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                {group.pages.map((page) => pageButton(page))}
              </span>
            </div>
            {open && group.pages.map((page) => (
              <div key={page.itemId} className="ml-8 mb-1.5 border-l-2 border-nim pl-2.5 py-1 text-xs text-nim-muted leading-normal">
                {pageButton(page, 'font-medium mr-1')}
                {page.sentences.map((sentence) => <p key={sentence} className="m-0">{sentence}</p>)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};
