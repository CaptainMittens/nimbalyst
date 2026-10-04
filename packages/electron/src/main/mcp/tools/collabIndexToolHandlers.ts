import { BrowserWindow } from "electron";
import { findWindowIdForWorkspacePath } from "../mcpWorkspaceResolver";
import { getMostRecentlyFocusedWorkspaceWindow } from "../../window/WindowManager";
import { requestFromRenderer } from "../rendererRequest";

type McpToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError: boolean;
};

/**
 * Page tree MCP tools for Pages mode, Team and Personal sections: list the
 * tree, create pages, move and reorder pages, typed pages and placed types,
 * rename, delete, and Set type. Folders are pages in the page tree; the
 * `folder` names on the wire (`parentFolderId`, `folderPath`, kind 'folder')
 * stay for callers that already use them and address pages.
 *
 * The docs sessions that own the tree live in the renderer, so each tool
 * round-trips to a window over a unique resultChannel and the renderer
 * (`renderer/services/pageTreeTools/pageTreeToolHandlers.ts`) replies once.
 */

// Registration hits the TeamSyncProvider (a WebSocket send); Set type also
// publishes an item and reads its body back with retries.
const ROUND_TRIP_TIMEOUT_MS = 15000;
const SLOW_ROUND_TRIP_TIMEOUT_MS = 60000;

const SECTION = {
  type: "string",
  enum: ["team", "personal"],
  description: "Pages section. Default 'team'. 'personal' is local and works with no account.",
};
const PARENT_KIND = {
  type: "string",
  enum: ["page", "item"],
  description: "What the parent id names: a page, or a typed page ('item'). Inferred from the id when omitted.",
};
const BESIDE = "Tree node id from listPages (e.g. 'document:<id>', 'item:<id>', 'type:<id>'), or a bare page id, issue key or type id.";

export function getCollabIndexToolSchemas() {
  const tools: Array<{ name: string; description: string; inputSchema: any }> = [
    {
      name: "listPages",
      description:
        "List a Pages section as a tree: pages, placed types and typed pages, each with nodeId, kind, id, title, parentNodeId, depth, sortOrder and the https link to write in page content (types also a viewLink); pages carry the uri to read and edit their body, typed pages their issueKey and whether they are placed outside their type.",
      inputSchema: { type: "object", properties: { section: SECTION } },
    },
    {
      name: "createSharedDoc",
      description:
        "Create a page in Pages, under a page, under a typed page, or at the top of the section. Returns the documentId, the uri of its body and the https link to it.",
      inputSchema: {
        type: "object",
        properties: {
          section: SECTION,
          title: { type: "string", description: "The page title, a bare name (no parent path, no '.md')." },
          documentType: { type: "string", description: "Logical document type for editor routing. Defaults to 'markdown'." },
          parentFolderId: { type: "string", description: "Parent page id, or typed page id / issue key. Omit for the top of the section." },
          parentKind: PARENT_KIND,
          folderPath: { type: "string", description: "Parent by titles ('Architecture/Overview'); missing pages are created empty. Takes precedence over parentFolderId." },
          initialContent: { type: "string", description: "Markdown body the page is created with." },
          before: { type: "string", description: `Place the new page just before this sibling. ${BESIDE}` },
          after: { type: "string", description: `Place the new page just after this sibling. ${BESIDE}` },
        },
        required: ["title"],
      },
    },
    {
      name: "createSharedFolder",
      description: "Create an empty page that will hold child pages (same as createSharedDoc with no body). Returns its page id as folderId.",
      inputSchema: {
        type: "object",
        properties: {
          section: SECTION,
          name: { type: "string", description: "The page title, a bare name." },
          parentFolderId: { type: "string", description: "Parent page id, or typed page id / issue key. Omit for the top of the section." },
          parentKind: PARENT_KIND,
          folderPath: { type: "string", description: "The PARENT by titles ('A/B'); missing pages are created. Takes precedence over parentFolderId." },
        },
        required: ["name"],
      },
    },
    {
      name: "moveSharedItem",
      description:
        "Move or reorder a node in the Pages tree: a page (kind 'doc', 'folder' or 'page'), a typed page ('item': places it under a page or typed page, or back under its type with underType), or a type ('type': Place type, or move its placement). Give a new parent, or before/after a sibling to reorder. Refuses a move that would put a node inside itself.",
      inputSchema: {
        type: "object",
        properties: {
          section: SECTION,
          itemId: { type: "string", description: "Page id, typed page id or issue key, or type id." },
          kind: { type: "string", enum: ["doc", "folder", "page", "item", "type"], description: "What itemId names. 'doc', 'folder' and 'page' all mean a page." },
          newParentFolderId: { type: "string", description: "New parent page id, or typed page id / issue key. Omit (or null) for the top of the section." },
          parentKind: PARENT_KIND,
          folderPath: { type: "string", description: "New parent by titles ('A/B'); missing pages are created. Takes precedence over newParentFolderId." },
          before: { type: "string", description: `Move just before this sibling (its parent becomes the parent). ${BESIDE}` },
          after: { type: "string", description: `Move just after this sibling. ${BESIDE}` },
          underType: { type: "boolean", description: "Typed page only: send it back under its type." },
        },
        required: ["itemId", "kind"],
      },
    },
    {
      name: "renameSharedItem",
      description: "Rename a page. Stores the bare name. A typed page is renamed with tracker_update (title).",
      inputSchema: {
        type: "object",
        properties: {
          section: SECTION,
          itemId: { type: "string", description: "The page id." },
          kind: { type: "string", enum: ["doc", "folder", "page"], description: "Always a page; kept for older callers." },
          newName: { type: "string", description: "The new title, a bare name (no parent path)." },
        },
        required: ["itemId", "newName"],
      },
    },
    {
      name: "deleteSharedItem",
      description:
        "Delete a page by moving it to Trash, where a person can restore it. kind 'folder' moves the page with every page under it to Trash; kind 'doc' moves only a page that has no children to Trash. Ask a person before deleting a page someone else wrote.",
      inputSchema: {
        type: "object",
        properties: {
          section: SECTION,
          itemId: { type: "string", description: "The page id." },
          kind: { type: "string", enum: ["doc", "folder"], description: "'folder' for the page with its whole subtree, 'doc' for a page with no children." },
        },
        required: ["itemId", "kind"],
      },
    },
    {
      name: "setPageType",
      description:
        "Give a plain page a type in place (the page menu's Set type): it becomes a typed page of that type with the same title, body, position and children, and the plain page goes to Trash once the copy is verified. Returns the new item id.",
      inputSchema: {
        type: "object",
        properties: {
          section: SECTION,
          pageId: { type: "string", description: "The plain page's id." },
          typeId: { type: "string", description: "A tracker type of the same section (team types for Team, personal types for Personal)." },
        },
        required: ["pageId", "typeId"],
      },
    },
  ];

  return tools;
}

/**
 * Resolve the renderer window that owns the Pages sessions for this call.
 * Prefers the session's workspace window; falls back to the most recently
 * focused workspace window, mirroring what the person sees.
 */
async function resolveTargetWindow(
  workspacePath: string | undefined
): Promise<BrowserWindow | null> {
  if (workspacePath) {
    const windowId = await findWindowIdForWorkspacePath(workspacePath);
    if (windowId) {
      const win = BrowserWindow.fromId(windowId);
      if (win && !win.isDestroyed()) {
        return win;
      }
    }
  }
  const focused = getMostRecentlyFocusedWorkspaceWindow();
  return focused && !focused.isDestroyed() ? focused : null;
}

type RendererResult = { success: boolean; error?: string; [key: string]: unknown };

/** Send `payload` to `channel` on the target window and wait for the one-shot reply. */
async function roundTripToRenderer(
  window: BrowserWindow,
  channel: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<RendererResult> {
  const outcome = await requestFromRenderer<RendererResult | undefined>(window, channel, payload, { timeoutMs });
  if (outcome.status === "timedOut") {
    return { success: false, error: "Timed out while waiting for the renderer to update the page tree." };
  }
  return outcome.response ?? { success: false, error: "No result returned from renderer." };
}

function errorResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function textResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }], isError: false };
}

const PAGE_KINDS = new Set(["doc", "folder", "page"]);

/** Argument checks done before reaching the renderer; null when the call is well formed. */
function invalidArguments(tool: string, args: any): string | null {
  const nonEmpty = (value: unknown) => typeof value === "string" && value.trim().length > 0;
  switch (tool) {
    case "createSharedDoc":
      return nonEmpty(args?.title) ? null : "createSharedDoc requires a non-empty title.";
    case "createSharedFolder":
      return nonEmpty(args?.name) ? null : "createSharedFolder requires a non-empty name.";
    case "moveSharedItem":
      if (!nonEmpty(args?.itemId)) return "moveSharedItem requires an itemId.";
      return PAGE_KINDS.has(args?.kind) || args?.kind === "item" || args?.kind === "type"
        ? null
        : "moveSharedItem requires kind 'doc', 'folder', 'page', 'item' or 'type'.";
    case "renameSharedItem":
      if (!nonEmpty(args?.itemId)) return "renameSharedItem requires an itemId.";
      return nonEmpty(args?.newName) ? null : "renameSharedItem requires a non-empty newName.";
    case "deleteSharedItem":
      if (!nonEmpty(args?.itemId)) return "deleteSharedItem requires an itemId.";
      return args?.kind === "doc" || args?.kind === "folder" ? null : "deleteSharedItem requires kind 'doc' or 'folder'.";
    case "setPageType":
      return nonEmpty(args?.pageId) && nonEmpty(args?.typeId) ? null : "setPageType requires pageId and typeId.";
    default:
      return null;
  }
}

function describeSuccess(tool: string, args: any, result: RendererResult): string {
  const { success: _success, warning, ...rest } = result;
  const note = typeof warning === "string" ? ` ${warning}` : "";
  switch (tool) {
    case "listPages":
      return JSON.stringify(rest);
    case "createSharedDoc":
      return `Created page "${args.title}" (documentId: ${result.documentId}${result.uri ? `, uri: ${result.uri}` : ""}${result.link ? `, link: ${result.link}` : ""}).${note}`;
    case "createSharedFolder":
      return `Created page "${args.name}" (folderId: ${result.documentId}${result.uri ? `, uri: ${result.uri}` : ""}${result.link ? `, link: ${result.link}` : ""}).${note}`;
    case "moveSharedItem":
      return result.outcome === "unchanged" ? `${args.itemId} is already there.` : `Moved ${args.itemId}.`;
    case "renameSharedItem":
      return `Renamed page ${args.itemId} to "${args.newName}".`;
    case "deleteSharedItem":
      return typeof result.removedCount === "number"
        ? `Deleted page ${args.itemId} and the pages under it (${result.removedCount} page(s)).`
        : `Deleted page ${args.itemId}.`;
    case "setPageType":
      return `Page ${args.pageId} is now a ${args.typeId}${result.itemId ? ` (item id: ${result.itemId})` : ""}.`;
    default:
      return JSON.stringify(rest);
  }
}

const TOOL_NAMES = new Set([
  "listPages",
  "createSharedDoc",
  "createSharedFolder",
  "moveSharedItem",
  "renameSharedItem",
  "deleteSharedItem",
  "setPageType",
]);

async function runPageTreeTool(tool: string, args: any, workspacePath: string | undefined): Promise<McpToolResult> {
  const invalid = invalidArguments(tool, args);
  if (invalid) return errorResult(`Error: ${invalid}`);

  const window = await resolveTargetWindow(workspacePath);
  if (!window) return errorResult("Error: No open workspace window available for Pages.");

  const payload = { ...(args ?? {}), ...(workspacePath ? { workspacePath } : {}) };
  delete (payload as { resultChannel?: unknown }).resultChannel;
  const timeout = tool === "setPageType" || tool === "createSharedDoc" ? SLOW_ROUND_TRIP_TIMEOUT_MS : ROUND_TRIP_TIMEOUT_MS;
  const result = await roundTripToRenderer(window, `mcp:${tool}`, payload, timeout);
  if (!result.success) return errorResult(`${tool} failed: ${result.error || "Unknown error"}`);
  return textResult(describeSuccess(tool, args, result));
}

/** Dispatch for every page tree tool; null for a name this module does not own. */
export function handleCollabIndexTool(
  tool: string,
  args: any,
  workspacePath: string | undefined,
): Promise<McpToolResult> | null {
  return TOOL_NAMES.has(tool) ? runPageTreeTool(tool, args, workspacePath) : null;
}

export const handleListPages = (args: any, workspacePath: string | undefined) => runPageTreeTool("listPages", args, workspacePath);
export const handleCreateSharedDoc = (args: any, workspacePath: string | undefined) => runPageTreeTool("createSharedDoc", args, workspacePath);
export const handleCreateSharedFolder = (args: any, workspacePath: string | undefined) => runPageTreeTool("createSharedFolder", args, workspacePath);
export const handleMoveSharedItem = (args: any, workspacePath: string | undefined) => runPageTreeTool("moveSharedItem", args, workspacePath);
export const handleRenameSharedItem = (args: any, workspacePath: string | undefined) => runPageTreeTool("renameSharedItem", args, workspacePath);
export const handleDeleteSharedItem = (args: any, workspacePath: string | undefined) => runPageTreeTool("deleteSharedItem", args, workspacePath);
export const handleSetPageType = (args: any, workspacePath: string | undefined) => runPageTreeTool("setPageType", args, workspacePath);
