/**
 * How a browser host opens a console link met in a document (a chip for a
 * Personal page, say): the console routes it in its own tab. Without a host
 * opener the chip is an ordinary link.
 */

/** Returns true when the host opened the link itself. */
export type ConsoleLinkOpener = (href: string) => boolean;

let opener: ConsoleLinkOpener | undefined;

/** Installs the host's opener; the returned function removes it. */
export function setConsoleLinkOpener(next: ConsoleLinkOpener): () => void {
  opener = next;
  return () => {
    if (opener === next) opener = undefined;
  };
}

export function openConsoleLink(href: string): boolean {
  return opener?.(href) ?? false;
}
