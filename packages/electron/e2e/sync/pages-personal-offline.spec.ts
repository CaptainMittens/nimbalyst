/**
 * Phase 2 acceptance for the Pages Personal section: a fresh install with no
 * account and no collaboration server.
 *
 * On a fresh user-data dir (signed out, no wrangler), Pages mode must show the
 * Personal section with no error toast and no scope-resolution console error.
 * The user creates a personal folder, places the seeded personal tracker type
 * under it (the "Place type..." menu must not offer the seeded team type),
 * creates an item of that type and sees it under the type, then creates a
 * personal page and types into its `personal://` tab. After a relaunch on the
 * same user-data dir and workspace, the folder, the placed type, the item, the
 * page and its text are all still there and the page tab is restored.
 *
 * Run with:
 *   npx playwright test e2e/sync/pages-personal-offline.spec.ts --max-failures=1
 */

import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { launchElectronApp } from '../helpers';
import { PLAYWRIGHT_TEST_SELECTORS as selectors, dismissAPIKeyDialog } from '../utils/testHelpers';

const PERSONAL_TYPE_ID = 'offline-note';
const PERSONAL_TYPE_NAME = 'Offline Note';
const PERSONAL_TYPE_PLURAL = 'Offline Notes';
const TEAM_TYPE_PLURAL = 'Team Only Specs';
const FOLDER_NAME = 'Offline Folder';
const ITEM_TITLE = 'Offline item survives restart';
const PAGE_NAME = 'Offline Page';
const PAGE_SENTENCE = 'Personal pages work with no account.';

function typeYaml(type: string, name: string, plural: string, sharing: 'personal' | 'team', prefix: string): string {
  return `type: ${type}
displayName: ${name}
displayNamePlural: ${plural}
icon: description
color: '#0f766e'
modes:
  inline: true
  fullDocument: true
idPrefix: ${prefix}
idFormat: ulid
fields:
  - name: title
    type: string
    required: true
    displayInline: true
  - name: status
    type: select
    required: false
    default: open
    displayInline: true
    options:
      - value: open
        label: Open
      - value: done
        label: Done
roles:
  title: title
  workflowStatus: status
sharing: ${sharing}
draftByDefault: false
`;
}

function log(message: string): void {
  console.log(`[P2-E] ${message}`);
}

const SCOPE_ERROR = 'Failed to resolve collaboration scope';

function captureConsole(page: Page, label: string, sink: string[]): void {
  page.on('console', (message) => {
    const text = message.text();
    if (
      message.type() === 'error' ||
      message.type() === 'warning' ||
      /CollabMode|personal|Personal|placement|typePlacement/.test(text)
    ) {
      sink.push(`[${label}] ${message.type()}: ${text.slice(0, 400)}`);
    }
  });
}

function personalSidebar(page: Page): Locator {
  return page.locator('[data-testid="collab-sidebar-personal"]:visible');
}

function folderRow(page: Page): Locator {
  return personalSidebar(page).locator('button.file-tree-directory:not([data-testid="collab-tree-type-row"])', {
    hasText: FOLDER_NAME,
  });
}

function typeRow(page: Page): Locator {
  return personalSidebar(page).locator(`[data-testid="collab-tree-type-row"][data-type-id="${PERSONAL_TYPE_ID}"]`);
}

function itemRow(page: Page): Locator {
  return personalSidebar(page).locator('[data-testid="collab-tree-item-row"]', { hasText: ITEM_TITLE });
}

function pageRow(page: Page): Locator {
  return personalSidebar(page).locator('.file-tree-file', { hasText: PAGE_NAME });
}

function personalPageTab(page: Page): Locator {
  return page.locator('[data-testid="personal-page-tab"]:visible');
}

async function openPagesMode(page: Page): Promise<void> {
  const modeButton = page.getByTestId('collab-mode-button');
  await expect(modeButton).toBeVisible({ timeout: 15_000 });
  if ((await modeButton.getAttribute('aria-pressed')) !== 'true') {
    await modeButton.click();
  }
  await expect(personalSidebar(page)).toBeVisible({ timeout: 15_000 });
}

/** Expands a collapsed tree row via its chevron, which never opens a tab. */
async function ensureExpanded(row: Locator): Promise<void> {
  const expand = row.locator('[aria-label="Expand"]');
  if (await expand.count()) {
    await expand.click();
    return;
  }
  // Plain folder rows have no aria-label on the chevron; their icon says it.
  const closedIcon = row.locator('.file-tree-chevron', { hasText: 'keyboard_arrow_right' });
  if (await closedIcon.count()) await row.click();
}

test('signed-out personal pages: folder, placed type, item and page survive a relaunch', async ({}, testInfo) => {
  test.setTimeout(180_000);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-personal-offline-'));
  const workspace = path.join(root, 'workspace');
  const userDataDir = path.join(root, 'user-data');
  const databaseDir = path.join(root, 'database');
  await fs.mkdir(path.join(workspace, '.nimbalyst', 'trackers'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'README.md'), '# Offline pages\n');
  await fs.writeFile(
    path.join(workspace, '.nimbalyst', 'trackers', `${PERSONAL_TYPE_ID}.yaml`),
    typeYaml(PERSONAL_TYPE_ID, PERSONAL_TYPE_NAME, PERSONAL_TYPE_PLURAL, 'personal', 'offn'),
  );
  await fs.writeFile(
    path.join(workspace, '.nimbalyst', 'trackers', 'team-only-spec.yaml'),
    typeYaml('team-only-spec', 'Team Only Spec', TEAM_TYPE_PLURAL, 'team', 'tos'),
  );

  const consoleLines: string[] = [];
  let app: ElectronApplication | undefined;
  const launch = async (label: string): Promise<Page> => {
    app = await launchElectronApp({
      workspace,
      preserveTestDatabase: true,
      recordVideo: { dir: path.join(testInfo.outputDir, 'video') },
      env: {
        NIMBALYST_USER_DATA_PATH: databaseDir,
        NIMBALYST_USER_DATA_DIR: userDataDir,
        NIMBALYST_CDP_PORT: '0',
      },
    });
    const page = await app.firstWindow();
    captureConsole(page, label, consoleLines);
    await page.waitForLoadState('domcontentloaded');
    // A relaunch restores Pages mode, where the Files sidebar exists but is hidden.
    await page
      .locator('.workspace-sidebar:visible, [data-testid="collab-sidebar-personal"]:visible')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });
    await dismissAPIKeyDialog(page);
    return page;
  };

  let documentId = '';
  try {
    let page = await launch('run1');

    await test.step('Pages mode shows the Personal section, signed out, with no error', async () => {
      await expect(page.getByTestId('collab-mode-button')).toBeVisible({ timeout: 15_000 });
      await openPagesMode(page);
      await expect(page.getByTestId('collab-sidebar-section-personal')).toBeVisible();
      await expect(page.getByTestId('collab-sidebar-section-personal')).toContainText('Personal');
      await expect(page.getByTestId('pages-sidebar-team-note')).toBeVisible();
      await expect(page.getByTestId('collab-sidebar-section-team')).toHaveCount(0);
      // Give a failed scope resolution time to surface before asserting its absence.
      await page.waitForTimeout(1_500);
      await expect(page.locator('.error-toast--error')).toHaveCount(0);
      expect(consoleLines.filter((line) => line.includes(SCOPE_ERROR))).toEqual([]);
      log('step 1 ok: Pages button visible, Personal section shown, team note shown, no error toast, no scope error');
    });

    await test.step('create a personal folder from the title-bar menu', async () => {
      await page.getByTestId('window-top-bar-create-left-menu-button').click();
      const menu = page.getByTestId('window-top-bar-create-left-menu');
      await expect(menu).toBeVisible();
      await expect(menu).toContainText('Personal');
      await menu.getByRole('menuitem', { name: 'New folder' }).click();
      const dialog = page.getByTestId('collab-create-dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByTestId('collab-create-name-input').fill(FOLDER_NAME);
      await dialog.locator('.collab-create-confirm').click();
      await expect(dialog).toHaveCount(0);
      await expect(folderRow(page)).toBeVisible({ timeout: 10_000 });
      log('step 2 ok: personal folder row visible');
    });

    await test.step('place the personal type under the folder; the team type is not offered', async () => {
      await folderRow(page).click({ button: 'right' });
      const placeAction = page.locator('.collab-place-type-action');
      await expect(placeAction).toBeEnabled({ timeout: 5_000 });
      await placeAction.click();
      const menu = page.locator('.collab-place-type-menu');
      await expect(menu).toBeVisible();
      const options = await menu.locator('.collab-place-type-option').allInnerTexts();
      log(`step 3 place-type options: ${JSON.stringify(options.map((text) => text.replace(/^\S+\s*/, '').trim()))}`);
      await expect(menu.locator('.collab-place-type-option', { hasText: PERSONAL_TYPE_PLURAL })).toHaveCount(1);
      await expect(menu.locator('.collab-place-type-option', { hasText: TEAM_TYPE_PLURAL })).toHaveCount(0);
      await menu.locator('.collab-place-type-option', { hasText: PERSONAL_TYPE_PLURAL }).click();
      await ensureExpanded(folderRow(page));
      await expect(typeRow(page)).toBeVisible({ timeout: 10_000 });
      log('step 3 ok: personal type row visible under the folder; team type absent from the menu');
    });

    await test.step('create an item of the personal type and see it under the type', async () => {
      await page.keyboard.press('ControlOrMeta+Shift+I');
      const search = page.locator(selectors.trackerQuickCreateTypeSearch);
      await expect(search).toBeVisible();
      await search.fill(PERSONAL_TYPE_NAME);
      await search.press('Enter');
      const title = page.locator(selectors.trackerQuickCreateTitle);
      await title.fill(ITEM_TITLE);
      await title.press('ControlOrMeta+Enter');
      await expect(title).not.toBeVisible({ timeout: 10_000 });
      await openPagesMode(page);
      await ensureExpanded(typeRow(page));
      await expect(itemRow(page)).toBeVisible({ timeout: 10_000 });
      log('step 4 ok: item row visible under the personal type');
    });

    await test.step('create a personal page and type a sentence into its tab', async () => {
      await page.getByTestId('window-top-bar-create-left').click();
      const dialog = page.getByTestId('collab-create-dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByTestId('collab-create-name-input').fill(PAGE_NAME);
      await dialog.locator('.collab-create-confirm').click();
      await expect(dialog).toHaveCount(0);
      await expect(pageRow(page)).toBeVisible({ timeout: 10_000 });
      if (!(await personalPageTab(page).isVisible())) {
        log('step 5 note: creating the page did not open it; opening it from the tree');
        await pageRow(page).click();
      }
      const tab = personalPageTab(page);
      await expect(tab).toBeVisible({ timeout: 10_000 });
      documentId = (await tab.getAttribute('data-document-id')) ?? '';
      expect(documentId).not.toBe('');
      const editor = tab.locator(selectors.contentEditable).first();
      await expect(editor).toBeVisible({ timeout: 10_000 });
      await editor.click();
      await page.keyboard.type(PAGE_SENTENCE);
      await expect(editor).toContainText(PAGE_SENTENCE);
      await expect
        .poll(
          async () =>
            ((await page.evaluate(
              ([ws, id]) => window.electronAPI.invoke('personal-pages:get-body', ws, id),
              [workspace, documentId] as const,
            )) as { content?: string } | null)?.content ?? '',
          { timeout: 10_000 },
        )
        .toContain(PAGE_SENTENCE);
      log(`step 5 ok: personal page ${documentId} saved with the sentence (personal-pages:get-body)`);
    });

    // Let tab persistence settle, then relaunch on the same user data and workspace.
    await page.waitForTimeout(1_000);
    await app?.close();
    app = undefined;
    log('closed run 1');

    page = await launch('run2');

    await test.step('after relaunch the folder, type, item, page, text and tab are back', async () => {
      await openPagesMode(page);
      await expect(page.locator('.error-toast--error')).toHaveCount(0);
      await expect(folderRow(page)).toBeVisible({ timeout: 15_000 });
      log('step 6 folder present');
      await ensureExpanded(folderRow(page));
      await expect(typeRow(page)).toBeVisible({ timeout: 10_000 });
      log('step 6 placed type present');
      await ensureExpanded(typeRow(page));
      await expect(itemRow(page)).toBeVisible({ timeout: 10_000 });
      log('step 6 item present');
      await expect(pageRow(page)).toBeVisible({ timeout: 10_000 });
      log('step 6 page row present');
      const restoredTab = page.locator(`.tab[data-filename]:visible`, { hasText: PAGE_NAME });
      await expect(restoredTab).toHaveCount(1, { timeout: 15_000 });
      log('step 6 page tab restored');
      const tab = page.locator(`[data-testid="personal-page-tab"][data-document-id="${documentId}"]:visible`);
      if (!(await tab.isVisible())) await restoredTab.click();
      await expect(tab).toBeVisible({ timeout: 10_000 });
      await expect(tab.locator(selectors.contentEditable).first()).toContainText(PAGE_SENTENCE, { timeout: 10_000 });
      expect(consoleLines.filter((line) => line.includes(SCOPE_ERROR))).toEqual([]);
      log('step 6 ok: restored page tab shows the sentence; no scope error in either run');
    });
  } catch (error) {
    console.log(`[P2-E] renderer console (last 80 relevant lines):\n${consoleLines.slice(-80).join('\n')}`);
    throw error;
  } finally {
    await app?.close().catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
});
