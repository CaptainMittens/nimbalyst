/**
 * How a browser host opens a console link met in a document (a link to
 * another page, a chip for a Personal page): the console routes it in its own
 * tab, as a page link opens in place on the desktop. A Cmd/Ctrl or middle click
 * on a plain link still opens a new browser tab. Without a host opener the
 * link is an ordinary link.
 */

import { setHostLinkOpener } from '@nimbalyst/runtime/editor/utils/workspaceLinkNavigation';

/** Returns true when the host opened the link itself. */
export type ConsoleLinkOpener = (href: string) => boolean;

let opener: ConsoleLinkOpener | undefined;

/** Installs the host's opener; the returned function removes it. */
export function setConsoleLinkOpener(next: ConsoleLinkOpener): () => void {
  opener = next;
  const removeLinkOpener = setHostLinkOpener((url, { newTab }) => !newTab && next(url));
  return () => {
    removeLinkOpener();
    if (opener === next) opener = undefined;
  };
}

export function openConsoleLink(href: string): boolean {
  return opener?.(href) ?? false;
}
