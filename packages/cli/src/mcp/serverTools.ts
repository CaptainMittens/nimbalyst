/**
 * Everything `nim mcp` serves. The list is the same whether or not a local wiki
 * exists; without one, each tool answers that `nim wiki init` creates it.
 */
import type { LocalWiki } from '@nimbalyst/local-wiki';
import { openLocalWiki } from '../localWiki/open.js';
import type { LocalWikiContext } from './localTools.js';
import { pageTools } from './pageTools.js';
import { trackerTools } from './trackerTools.js';
import { ToolMap } from './toolMap.js';

export function localWikiContext(startDir: string, location?: string): LocalWikiContext {
  // One LocalWiki per folder for the life of the server, re-scanned per call.
  const cache = new Map<string, LocalWiki>();
  return { open: () => openLocalWiki(startDir, location, cache) };
}

export function createLocalToolMap(context: LocalWikiContext): ToolMap {
  const tools = new ToolMap();
  for (const tool of [...pageTools(context), ...trackerTools(context)]) tools.register(tool);
  return tools;
}
