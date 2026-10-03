import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getEmbedPluginCallbacks } from '@nimbalyst/runtime/editor/plugins/EmbedPlugin/EmbedPluginCallbacks';
import { registerBrowserDocumentEmbeds } from '../documentEmbeds';

describe('browser document embeds', () => {
  it('says where a placed view can be seen instead of a broken document preview', () => {
    registerBrowserDocumentEmbeds();
    const Renderer = getEmbedPluginCallbacks().renderEmbed!;
    render(<Renderer src="nimbalyst://view/type/competitor" label="Competitors" attrs={{ mode: '2x2' }} nodeKey="1" />);
    expect(screen.getByTestId('placed-view-unavailable').textContent).toBe('Competitors: this live view shows in the Nimbalyst desktop app.');
  });

  it('offers a console view link as a link to its console page', () => {
    registerBrowserDocumentEmbeds();
    const Renderer = getEmbedPluginCallbacks().renderEmbed!;
    const href = 'https://console.nimbalyst.com/org/o1/project/p1/view/type/competitor';
    render(<Renderer src={href} label="Competitors" attrs={{}} nodeKey="2" />);
    expect(screen.getByRole('link', { name: 'Open Competitors' }).getAttribute('href')).toBe(href);
  });
});
