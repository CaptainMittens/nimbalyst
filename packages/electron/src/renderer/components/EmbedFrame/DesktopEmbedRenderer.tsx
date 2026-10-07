/**
 * The renderer the runtime's embed node calls on desktop: a placed view
 * (`parsePlacedViewUrl`) draws live from the items, a Personal page's console
 * link shows that page, anything else is a file or shared document in
 * `EmbedFrame`.
 */

import React from 'react';
import { usePlacedViewAttrs } from '@nimbalyst/runtime/editor/plugins/EmbedPlugin/usePlacedViewAttrs';
import type { EmbedFrameProps } from '@nimbalyst/runtime/editor/plugins/EmbedPlugin/EmbedPluginCallbacks';
import { parsePlacedViewUrl } from '@nimbalyst/runtime/core/placedViewUrl';
import { parseConsoleLink } from '@nimbalyst/collab-protocol';
import { EmbedFrame } from './EmbedFrame';
import { PersonalPageEmbedFrame } from './PersonalPageEmbedFrame';
import { PlacedViewEmbedFrame } from './PlacedViewEmbedFrame';

function personalPageIdOf(src: string): string | null {
  const target = /^https:\/\//i.test(src) ? parseConsoleLink(src) : null;
  return target?.kind === 'page' && target.scope === 'local' ? target.pageId : null;
}

export const DesktopEmbedRenderer: React.FC<EmbedFrameProps> = (props) => {
  const target = parsePlacedViewUrl(props.src);
  const onAttrsChange = usePlacedViewAttrs(props.nodeKey, props.detached);
  if (target) return <PlacedViewEmbedFrame target={target} label={props.label} attrs={props.attrs} onAttrsChange={onAttrsChange} />;
  const personalPageId = personalPageIdOf(props.src);
  return personalPageId ? <PersonalPageEmbedFrame {...props} pageId={personalPageId} /> : <EmbedFrame {...props} />;
};
