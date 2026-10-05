import { useState } from 'react';
import type { CollabHost, CollabScope } from '@nimbalyst/collab-client/core';

const dismissedScopes = new Set<string>();

const EXAMPLE_BODY = `# Start here

Replace this introduction with what this page is about and who it helps.

## What we know

Write a few specific sentences. Link to an existing page instead of copying it. Add a source link for a claim that someone may need to check.

## Open question

[What should this page explain next?]{open}

When someone answers this question, select their answer and choose Mark decided. Record who decided it and why; keep their source with the decision.
`;

/** Built-in Pages guidance. It never changes an existing Home or requires an agent/curator. */
export function PagesHomeHelp({ host, scope, personal = false }: { host: CollabHost; scope: CollabScope; personal?: boolean }) {
  const [expanded, setExpanded] = useState(() => !dismissedScopes.has(scope.scopeKey));
  const [name, setName] = useState('Start here');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const documents = host.documents;
  const descriptor = documents?.documentTypes().find((type) => type.documentType === 'markdown'
    && (personal ? type.capabilities.localCreate : type.capabilities.sharedCreate));
  const toggle = () => {
    if (expanded) dismissedScopes.add(scope.scopeKey);
    else dismissedScopes.delete(scope.scopeKey);
    setExpanded(!expanded);
  };
  const create = async () => {
    if (!documents || !descriptor || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await documents.createDocument({ scope, descriptor, requestedName: name.trim(), parentFolderId: null, sourceContent: EXAMPLE_BODY });
      setCreated(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The page could not be created. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="pages-home-help shrink-0 border-b border-nim bg-nim-secondary px-6 py-3 text-sm" aria-label="Pages basics">
      <div className="flex items-center justify-between gap-3">
        <div><strong>Make a useful first page</strong><span className="ml-2 text-xs text-nim-muted">{personal ? 'Personal · on this device' : 'Team · shared with this project'}</span></div>
        <button type="button" className="text-nim-link hover:underline" aria-expanded={expanded} onClick={toggle}>{expanded ? 'Hide guide' : 'Pages guide'}</button>
      </div>
      {expanded && <div className="mt-3 max-h-[40vh] overflow-y-auto space-y-3 text-nim-muted">
        <p>Start with one page that answers a real question. Add structure when it helps someone find the answer again.</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li><strong className="text-nim">Write a page.</strong> Explain a topic in prose. Pages can contain child pages.</li>
          <li><strong className="text-nim">Add a type when you have several.</strong> Use Types → New type for things such as Customers or Modules. A typed page adds fields to prose; its type page lists them together.</li>
          <li><strong className="text-nim">Connect the context.</strong> Link to another page. For typed pages, choose a named relation when it describes the sentence, such as “built on”. A “Link to type” field is a structured reference, not a new named relation.</li>
          <li><strong className="text-nim">Keep the decision and its evidence.</strong> Select a sentence and choose Mark decided or Mark open. Record the person and source; do not turn an assumption into a decision.</li>
          <li><strong className="text-nim">Find it again.</strong> Search looks in page titles and text. Use a type's table to compare pages. History can recover earlier text; Trash can recover deleted pages.</li>
        </ol>
        <p className="text-xs">Follow your project's “How we write this wiki” page when it has one. These basics work without an agent. Optional knowledge curation is configured separately.</p>
        {created ? <p role="status">Your example page was created. Edit its introduction and replace the sample question.</p> : <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <label className="text-xs">Page name<input className="mt-1 block rounded border border-nim bg-nim px-2 py-1.5 text-sm text-nim" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
          <button type="submit" className="rounded border border-nim px-3 py-1.5 text-nim hover:bg-nim-hover disabled:opacity-50" disabled={!descriptor || !name.trim() || busy}>{busy ? 'Creating…' : 'Create example page'}</button>
          {!descriptor && <span className="text-xs">Page creation is unavailable in this view.</span>}
        </form>}
        {error && <p role="alert" className="text-nim-error">{error}</p>}
      </div>}
    </section>
  );
}
