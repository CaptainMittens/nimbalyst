/**
 * An agent edit to a page shows as one "Updated <page>" line in the
 * transcript that opens the page, with no Undo (Decision 19), and an agent
 * edit to an open Personal page lands as final text (Decision 20).
 *
 * The edit goes through the open page's editor the way the agent edit path
 * reaches a mounted Personal page (`aiToolSimulator.simulateApplyDiff` on its
 * `personal-doc://` editor). The transcript rows are the ones the Claude Code
 * SDK writes for an `applyCollabDocEdit` call and its result.
 *
 * Run with:
 *   npx playwright test e2e/ai/page-edit-line.spec.ts --max-failures=1
 */

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'node:fs/promises';

import { createTempWorkspace, launchElectronApp, TEST_TIMEOUTS, waitForAppReady } from '../helpers';
import { simulateApplyDiff } from '../utils/aiToolSimulator';
import { cleanupTestSessions, createTestSession, insertMessage } from '../utils/interactivePromptTestHelpers';
import { dismissAPIKeyDialog, switchToAgentMode } from '../utils/testHelpers';

const DOCUMENT_ID = 'agent-edit-page';
const PAGE_TITLE = 'Table decisions';
const BEFORE = 'Tables: undecided.';
const AFTER = 'Tables: one shared DataTable, built once.';

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspacePath: string;

function personalSidebar(): ReturnType<Page['locator']> {
  return page.locator('[data-testid="collab-sidebar-personal"]:visible');
}

function personalPageTab(): ReturnType<Page['locator']> {
  return page.locator(`[data-testid="personal-page-tab"][data-document-id="${DOCUMENT_ID}"]:visible`);
}

async function openPagesMode(): Promise<void> {
  const modeButton = page.getByTestId('collab-mode-button');
  await expect(modeButton).toBeVisible({ timeout: 15_000 });
  if ((await modeButton.getAttribute('aria-pressed')) !== 'true') await modeButton.click();
  await expect(personalSidebar()).toBeVisible({ timeout: 15_000 });
}

async function storedBody(): Promise<string> {
  const body = await page.evaluate(
    ([ws, id]) => window.electronAPI.invoke('personal-pages:get-body', ws, id),
    [workspacePath, DOCUMENT_ID] as const,
  );
  return (body as { content?: string } | null)?.content ?? '';
}

test.beforeAll(async () => {
  workspacePath = await createTempWorkspace();
  electronApp = await launchElectronApp({
    workspace: workspacePath,
    permissionMode: 'allow-all',
    env: { PLAYWRIGHT_TEST: 'true' },
  });
  page = await electronApp.firstWindow();
  await waitForAppReady(page);
  await dismissAPIKeyDialog(page);
});

test.afterAll(async () => {
  if (page) await cleanupTestSessions(page, workspacePath).catch(() => undefined);
  await electronApp?.close();
  await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
});

test('an agent edit to a Personal page lands directly and its transcript line opens the page', async () => {
  test.setTimeout(120_000);

  await test.step('a Personal page with a body', async () => {
    await page.evaluate(async ([ws, id, title, body]) => {
      await window.electronAPI.invoke('personal-pages:command', ws, {
        type: 'register-document',
        documentId: id,
        title,
        documentType: 'markdown',
        parentFolderId: null,
        metadata: { metadataVersion: 2, fileExtension: '.md', editorId: 'markdown' },
      });
      await window.electronAPI.invoke('personal-pages:update-body', ws, id, `# ${title}\n\n${body}\n`, 0);
    }, [workspacePath, DOCUMENT_ID, PAGE_TITLE, BEFORE] as const);
  });

  await test.step('the agent edit to the open page is final text, saved with no review', async () => {
    await openPagesMode();
    await personalSidebar().locator('.file-tree-name', { hasText: PAGE_TITLE }).first().click();
    await expect(personalPageTab()).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });

    const result = await simulateApplyDiff(page, `personal-doc://${DOCUMENT_ID}`, [{ oldText: BEFORE, newText: AFTER }]);
    expect(result.success).toBe(true);
    await expect(personalPageTab()).toContainText(AFTER);
    await expect(personalPageTab()).not.toContainText(BEFORE);
    await expect.poll(storedBody, { timeout: 10_000 }).toContain(AFTER);
  });

  await test.step('the transcript shows one "Updated <page>" line that opens the page', async () => {
    await switchToAgentMode(page);
    const sessionId = await createTestSession(page, workspacePath, { title: 'Page edit line' });
    const uri = `personal://${DOCUMENT_ID}`;
    await insertMessage(page, sessionId, 'output', JSON.stringify({
      type: 'assistant',
      message: { content: [{
        type: 'tool_use',
        id: 'toolu_page_edit_1',
        name: 'mcp__nimbalyst-situational__applyCollabDocEdit',
        input: { filePath: uri, replacements: [{ oldText: BEFORE, newText: AFTER }] },
      }] },
    }), { source: 'claude-code' });
    await insertMessage(page, sessionId, 'output', JSON.stringify({
      type: 'user',
      message: { content: [{
        type: 'tool_result',
        tool_use_id: 'toolu_page_edit_1',
        content: [{ type: 'text', text: `Updated "${PAGE_TITLE}" (${uri})` }],
      }] },
    }), { source: 'claude-code' });

    const sessionItem = page.locator(`#session-list-item-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });
    await sessionItem.click();

    const line = page.locator('.page-update-line:visible');
    await expect(line).toHaveCount(1, { timeout: TEST_TIMEOUTS.MEDIUM });
    await expect(line).toContainText('Updated');
    await expect(line).toContainText(PAGE_TITLE);
    await expect(line.getByText(/undo/i)).toHaveCount(0);

    await line.getByRole('button', { name: PAGE_TITLE }).click();
    await expect(personalPageTab()).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });
    await expect(personalPageTab()).toContainText(AFTER);
  });
});
