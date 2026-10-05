/**
 * The renderer the runtime's embed node calls on desktop: a placed view
 * (`parsePlacedViewUrl`) draws live from the items, anything else is a file
 * or shared document in `EmbedFrame`.
 */

import React from 'react';
import { usePlacedViewAttrs } from '@nimbalyst/runtime/editor/plugins/EmbedPlugin/usePlacedViewAttrs';
import type { EmbedFrameProps } from '@nimbalyst/runtime/editor/plugins/EmbedPlugin/EmbedPluginCallbacks';
import { parsePlacedViewUrl } from '@nimbalyst/runtime/core/placedViewUrl';
import { EmbedFrame } from './EmbedFrame';
import { PlacedViewEmbedFrame } from './PlacedViewEmbedFrame';

export const DesktopEmbedRenderer: React.FC<EmbedFrameProps> = (props) => {
  const target = parsePlacedViewUrl(props.src);
  const onAttrsChange = usePlacedViewAttrs(props.nodeKey, props.detached);
  return target
    ? <PlacedViewEmbedFrame target={target} label={props.label} attrs={props.attrs} onAttrsChange={onAttrsChange} />
    : <EmbedFrame {...props} />;
};
