import { describe, expect, it } from 'vitest';
import { renderMermaid } from '../mermaidRender';

describe('renderMermaid', () => {
  // A leaked temp container stays in document.body below the app root, makes the
  // document taller than the viewport, and lets scrollIntoView push the window
  // title bar off-screen.
  it('leaves nothing in document.body when the diagram fails to parse', async () => {
    const elementId = 'mermaid_leak_test';
    const bodyChildrenBefore = document.body.children.length;

    await expect(
      renderMermaid(elementId, 'flowchart TD\n  A --> B\n  B -->> ((', false),
    ).rejects.toBeTruthy();

    expect(document.getElementById(`d${elementId}`)).toBeNull();
    expect(document.getElementById(elementId)).toBeNull();
    expect(document.body.children.length).toBe(bodyChildrenBefore);
  });
});
