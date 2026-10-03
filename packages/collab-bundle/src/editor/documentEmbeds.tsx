import React from 'react';
import { buildCollabUri, isCollabUri, parseCollabUri } from '@nimbalyst/collab-protocol';
import { setEmbedPluginCallbacks, type EmbedFrameProps } from '@nimbalyst/runtime/editor/plugins/EmbedPlugin/EmbedPluginCallbacks';
import { parsePlacedViewUrl } from '@nimbalyst/runtime/core/placedViewUrl';
import type { CollabEditorMountOptions } from './types';

/** The renderer is global, but document authority and preview ownership are not. */
export const BrowserDocumentEmbedContext = React.createContext<CollabEditorMountOptions['renderDecisionArtifact']>(undefined);

function sharedArtifact(src: string): string | null {
  try {
    if (isCollabUri(src)) {
      parseCollabUri(src);
      return src;
    }
    const url = new URL(src);
    if (url.protocol !== 'nimbalyst:' || url.hostname !== 'doc') return null;
    const path = url.pathname.replace(/^\/+/, '');
    const queryOrgId = url.searchParams.get('orgId');
    if (queryOrgId && path) return buildCollabUri(queryOrgId, decodeURIComponent(path));
    const [orgId, ...documentId] = path.split('/');
    return orgId && documentId.length ? buildCollabUri(decodeURIComponent(orgId), decodeURIComponent(documentId.join('/'))) : null;
  } catch { return null; }
}

/**
 * A placed view (`parsePlacedViewUrl`) reads the project's tracker items,
 * which this editor's React root has no data source for yet. Until the web
 * console's Pages reach parity it says where the view can be seen, and a
 * console view link (Decision 23) links to its own console page.
 */
function BrowserPlacedViewNote({ src, label }: { src: string; label: string }): React.JSX.Element {
  const name = label || 'View';
  const consoleHref = /^https:/i.test(src) ? src : null;
  return <div className="collab-bundle-document-embed" contentEditable={false}>
    <div className="collab-bundle-document-embed-unavailable" data-testid="placed-view-unavailable">
      {name}: this live view shows in the Nimbalyst desktop app.
      {consoleHref ? <> <a href={consoleHref}>Open {name}</a></> : null}
    </div>
  </div>;
}

function BrowserDocumentEmbed({ src, label, nodeKey }: EmbedFrameProps): React.JSX.Element {
  const render = React.useContext(BrowserDocumentEmbedContext);
  if (parsePlacedViewUrl(src)) return <BrowserPlacedViewNote src={src} label={label} />;
  const artifact = sharedArtifact(src);
  const preview = artifact ? render?.(nodeKey, artifact) : null;
  return <div className="collab-bundle-document-embed" contentEditable={false}>
    {preview ?? <div className="collab-bundle-document-embed-unavailable">{label || 'Shared document'}: preview unavailable in this view.</div>}
  </div>;
}

/** Explicit call keeps registration in the production bundle. */
export function registerBrowserDocumentEmbeds(): void {
  setEmbedPluginCallbacks({ renderEmbed: BrowserDocumentEmbed });
}
