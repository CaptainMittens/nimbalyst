import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CollabHost, CollabScope } from '@nimbalyst/collab-client/core';
import { PagesHomeHelp } from '../PagesHomeHelp';

function setup(personal = false, createDocument = vi.fn(async () => undefined)) {
  const scope = { scopeKey: crypto.randomUUID() } as CollabScope;
  const host = { documents: { createDocument, documentTypes: () => [{ documentType: 'markdown', capabilities: { localCreate: true, sharedCreate: true } }] } } as unknown as CollabHost;
  const view = render(<PagesHomeHelp host={host} scope={scope} personal={personal} />);
  return { ...view, createDocument, host, scope };
}

describe('PagesHomeHelp', () => {
  it('creates an editable example in the displayed lane only on request', async () => {
    const { createDocument, scope } = setup(true);
    expect(screen.getByText('Personal · on this device')).toBeDefined();
    expect(createDocument).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Page name'), { target: { value: 'My notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create example page' }));
    await screen.findByRole('status');
    expect(createDocument).toHaveBeenCalledWith(expect.objectContaining({ scope, requestedName: 'My notes', parentFolderId: null, sourceContent: expect.stringContaining('{open}') }));
  });

  it('keeps the requested name on a creation refusal and allows retry', async () => {
    const createDocument = vi.fn().mockRejectedValueOnce(new Error('No write access')).mockResolvedValueOnce(undefined);
    setup(false, createDocument);
    fireEvent.change(screen.getByLabelText('Page name'), { target: { value: 'Team introduction' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create example page' }));
    expect((await screen.findByRole('alert')).textContent).toBe('No write access');
    expect((screen.getByLabelText('Page name') as HTMLInputElement).value).toBe('Team introduction');
    fireEvent.click(screen.getByRole('button', { name: 'Create example page' }));
    await waitFor(() => expect(createDocument).toHaveBeenCalledTimes(2));
    await screen.findByRole('status');
  });

  it('can hide and reopen guidance without creating or editing content', () => {
    const { createDocument } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Hide guide' }));
    expect(screen.queryByLabelText('Page name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pages guide' }));
    expect(screen.getByLabelText('Page name')).toBeDefined();
    expect(createDocument).not.toHaveBeenCalled();
  });
});
