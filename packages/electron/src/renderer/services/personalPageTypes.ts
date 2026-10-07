/**
 * Which page types a Personal page can hold. Its body is text in the local
 * database: markdown opens in the markdown editor and every extension type
 * (drawing, mind map, data model...) in its extension's editor. A code page
 * would need the code editor, which Personal pages do not mount.
 */
export function personalPageSupportsType(documentType: string): boolean {
  return documentType !== 'code';
}
