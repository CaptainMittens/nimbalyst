/**
 * Acceptance for the Pages Personal section on a fresh install with no account
 * and no collaboration server, on the one page tree (Phase 3b).
 *
 * On a fresh user-data dir (signed out, no wrangler), Pages mode must show the
 * Personal section with no error toast and no scope-resolution console error.
 * The user creates a root page and a page inside it, places the seeded
 * personal tracker type (the "Place type..." menu must not offer the seeded
 * team type) and drags it under the root page, creates an item of that type
 * and moves it under the child page, writes a sentence into a plain page, and
 * gives a second page with a body a type in place. After a relaunch on the same
 * user-data dir and workspace, the nesting, the placed type, the moved item,
 * the plain page with its text and restored tab, and the typed page with its
 * body are all still there.
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
const ROOT_PAGE = 'Offline Root';
const CHILD_PAGE = 'Offline Child';
const ITEM_TITLE = 'Offline item survives restart';
const PAGE_NAME = 'Offline Page';
const PAGE_SENTENCE = 'Personal pages work with no account.';
const TYPED_PAGE = 'Offline Typed';
const TYPED_SENTENCE = 'This personal page keeps its words when it gets a type.';

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

/** A page row (not an item row); new pages may carry a `.md` suffix. */
function namedPageRow(page: Page, name: string): Locator {
  return personalSidebar(page).locator('.file-tree-file:not([data-testid="collab-tree-item-row"])', {
    has: page.locator('.file-tree-name', { hasText: new RegExp(`^${name}(\\.md)?$`) }),
  });
}

function typeRow(page: Page): Locator {
  return personalSidebar(page).locator(`[data-testid="collab-tree-type-row"][data-type-id="${PERSONAL_TYPE_ID}"]`);
}

function itemRow(page: Page): Locator {
  return personalSidebar(page).locator('[data-testid="collab-tree-item-row"]', { hasText: ITEM_TITLE });
}

function pageRow(page: Page): Locator {
  return namedPageRow(page, PAGE_NAME);
}

function typedItemRow(page: Page): Locator {
  return personalSidebar(page).locator('[data-testid="collab-tree-item-row"]', { hasText: TYPED_PAGE });
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

/**
 * Close the app, killing it if quit has not finished in 20s: a quit that
 * stalls after the database worker closes would otherwise hold the run until
 * the test timeout and hide the result.
 */
async function closeApp(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  const closed = app.close().then(() => true, () => true);
  const timedOut = new Promise<false>((resolve) => setTimeout(() => resolve(false), 20_000));
  if (!(await Promise.race([closed, timedOut]))) {
    log('app.close() did not finish in 20s; killing the app process');
    app.process().kill('SIGKILL');
  }
}

/** How far `child`'s name sits right of `parent`'s: positive when nested under it. */
async function indentPast(parent: Locator, child: Locator): Promise<number> {
  const [parentBox, childBox] = await Promise.all([
    parent.locator('.file-tree-name').boundingBox(),
    child.locator('.file-tree-name').boundingBox(),
  ]);
  return (childBox?.x ?? 0) - (parentBox?.x ?? 0);
}

/** Expands a collapsed tree row via its chevron, which never opens a tab. */
async function ensureExpanded(row: Locator): Promise<void> {
  await expect(row).toBeVisible({ timeout: 10_000 });
  const expand = row.locator('[aria-label="Expand"]');
  if (await expand.count()) {
    await expand.click();
    return;
  }
  // Plain folder rows have no aria-label on the chevron; their icon says it.
  const closedIcon = row.locator('.file-tree-chevron', { hasText: 'keyboard_arrow_right' });
  if (await closedIcon.count()) await row.click();
}

test('signed-out personal page tree: nesting, placed type, moved item, page text and set type survive a relaunch', async ({}, testInfo) => {
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
      // The seeded Personal Home page.
      await expect(namedPageRow(page, 'Home')).toBeVisible({ timeout: 10_000 });
      // Give a failed scope resolution time to surface before asserting its absence.
      await page.waitForTimeout(1_500);
      await expect(page.locator('.error-toast--error')).toHaveCount(0);
      expect(consoleLines.filter((line) => line.includes(SCOPE_ERROR))).toEqual([]);
      log('step 1 ok: Pages button visible, Personal section shown, team note shown, no error toast, no scope error');
    });

    /** Title-bar "+" creates a root page; "New page inside" creates a child. */
    const createPage = async (name: string, parent?: string) => {
      if (parent) {
        await namedPageRow(page, parent).click({ button: 'right' });
        await page.locator('.collab-page-new-inside').click();
      } else {
        await page.getByTestId('window-top-bar-create-left').click();
      }
      const dialog = page.getByTestId('collab-create-dialog');
      await expect(dialog).toBeVisible();
      if (!parent) {
        const root = dialog.getByTestId('collab-create-location-option-root');
        if (await root.count()) await root.click();
      }
      await dialog.getByTestId('collab-create-name-input').fill(name);
      await dialog.locator('.collab-create-confirm').click();
      await expect(dialog).toHaveCount(0);
      if (parent) await ensureExpanded(namedPageRow(page, parent));
      await expect(namedPageRow(page, name)).toBeVisible({ timeout: 10_000 });
    };

    /** Type into the open personal page tab and wait until the body is stored. */
    const writePageBody = async (sentence: string): Promise<string> => {
      const tab = personalPageTab(page);
      await expect(tab).toBeVisible({ timeout: 10_000 });
      const id = (await tab.getAttribute('data-document-id')) ?? '';
      expect(id).not.toBe('');
      const editor = tab.locator(selectors.contentEditable).first();
      await expect(editor).toBeVisible({ timeout: 10_000 });
      await editor.click();
      await page.keyboard.type(sentence);
      await expect(editor).toContainText(sentence);
      await expect
        .poll(
          async () =>
            ((await page.evaluate(
              ([ws, docId]) => window.electronAPI.invoke('personal-pages:get-body', ws, docId),
              [workspace, id] as const,
            )) as { content?: string } | null)?.content ?? '',
          { timeout: 10_000 },
        )
        .toContain(sentence);
      return id;
    };

    await test.step('create a root page and a page inside it', async () => {
      await createPage(ROOT_PAGE);
      await createPage(CHILD_PAGE, ROOT_PAGE);
      log('step 2 ok: root page and nested child page visible');
    });

    await test.step('place the personal type and drag it under the root page; the team type is not offered', async () => {
      const tree = personalSidebar(page).locator('.session-history-search + div');
      await expect(tree).toBeVisible();
      const box = await tree.boundingBox();
      if (!box) throw new Error('Personal tree has no box');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height - 12, { button: 'right' });
      // Empty tree space opens New page / Place type...
      await page.locator('.collab-section-place-type').click();
      const menu = page.locator('.collab-place-type-menu');
      await expect(menu).toBeVisible();
      const options = await menu.locator('.collab-place-type-option').allInnerTexts();
      log(`step 3 place-type options: ${JSON.stringify(options.map((text) => text.replace(/^\S+\s*/, '').trim()))}`);
      await expect(menu.locator('.collab-place-type-option', { hasText: PERSONAL_TYPE_PLURAL })).toHaveCount(1);
      await expect(menu.locator('.collab-place-type-option', { hasText: TEAM_TYPE_PLURAL })).toHaveCount(0);
      await menu.locator('.collab-place-type-option', { hasText: PERSONAL_TYPE_PLURAL }).click();
      await expect(typeRow(page)).toBeVisible({ timeout: 10_000 });
      await typeRow(page).dragTo(namedPageRow(page, ROOT_PAGE));
      await ensureExpanded(namedPageRow(page, ROOT_PAGE));
      // Under the root page, the type row is indented past the root row.
      await expect.poll(() => indentPast(namedPageRow(page, ROOT_PAGE), typeRow(page)), { timeout: 10_000 }).toBeGreaterThan(4);
      log('step 3 ok: personal type placed and moved under the root page; team type absent from the menu');
    });

    await test.step('create an item of the personal type and move it under the child page', async () => {
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
      log('step 4 item row visible under the personal type');

      await itemRow(page).click({ button: 'right' });
      await page.locator('.collab-item-move-to').click();
      const moveDialog = page.locator('.collab-page-move-dialog');
      await expect(moveDialog).toBeVisible();
      await moveDialog.locator('.collab-page-move-option', { hasText: CHILD_PAGE }).click();
      await moveDialog.locator('.collab-page-move-confirm').click();
      await expect(moveDialog).toHaveCount(0);
      await ensureExpanded(namedPageRow(page, CHILD_PAGE));
      await expect(itemRow(page)).toHaveCount(1);
      await expect(itemRow(page)).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => indentPast(namedPageRow(page, CHILD_PAGE), itemRow(page)), { timeout: 10_000 }).toBeGreaterThan(4);
      log('step 4 ok: item moved under the child page');
    });

    await test.step('create a personal page and type a sentence into its tab', async () => {
      await createPage(PAGE_NAME);
      if (!(await personalPageTab(page).isVisible())) {
        log('step 5 note: creating the page did not open it; opening it from the tree');
        await pageRow(page).click();
      }
      documentId = await writePageBody(PAGE_SENTENCE);
      log(`step 5 ok: personal page ${documentId} saved with the sentence (personal-pages:get-body)`);
    });

    await test.step('set type on a personal page with a body', async () => {
      await createPage(TYPED_PAGE);
      if (!(await personalPageTab(page).getAttribute('data-document-id').catch(() => null))) {
        await namedPageRow(page, TYPED_PAGE).click();
      }
      await writePageBody(TYPED_SENTENCE);
      await namedPageRow(page, TYPED_PAGE).click({ button: 'right' });
      await page.locator('.collab-page-set-type').click();
      const dialog = page.getByTestId('set-page-type-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId('set-page-type-option-team-only-spec')).toHaveCount(0);
      await dialog.getByTestId(`set-page-type-option-${PERSONAL_TYPE_ID}`).click();
      await expect(dialog).toHaveCount(0, { timeout: 20_000 });
      await expect(typedItemRow(page)).toBeVisible({ timeout: 10_000 });
      await expect(namedPageRow(page, TYPED_PAGE)).toHaveCount(0);
      const view = page.locator('[data-testid="tracker-page-view"]:visible');
      await expect(view).toBeVisible({ timeout: 10_000 });
      await expect(view).toContainText(TYPED_SENTENCE, { timeout: 10_000 });
      log('step 6 ok: typed page replaced the page in place with the same body');
    });

    // Let tab persistence settle, then relaunch on the same user data and workspace.
    await page.waitForTimeout(1_000);
    await closeApp(app);
    app = undefined;
    log('closed run 1');

    page = await launch('run2');

    await test.step('after relaunch the tree, item, page text, tab and typed page are back', async () => {
      await openPagesMode(page);
      await expect(page.locator('.error-toast--error')).toHaveCount(0);
      await ensureExpanded(namedPageRow(page, ROOT_PAGE));
      await expect(namedPageRow(page, CHILD_PAGE)).toBeVisible({ timeout: 10_000 });
      log('step 7 root and child pages present');
      await expect(typeRow(page)).toBeVisible({ timeout: 10_000 });
      log('step 7 placed type present under the root page');
      await ensureExpanded(namedPageRow(page, CHILD_PAGE));
      await expect(itemRow(page)).toBeVisible({ timeout: 10_000 });
      expect(await indentPast(namedPageRow(page, ROOT_PAGE), typeRow(page))).toBeGreaterThan(4);
      expect(await indentPast(namedPageRow(page, CHILD_PAGE), itemRow(page))).toBeGreaterThan(4);
      log('step 7 moved item present under the child page');
      await expect(typedItemRow(page)).toBeVisible({ timeout: 10_000 });
      await expect(namedPageRow(page, TYPED_PAGE)).toHaveCount(0);
      log('step 7 typed page present as an item row');
      await expect(pageRow(page)).toBeVisible({ timeout: 10_000 });
      const restoredTab = page.locator(`.tab[data-filename]:visible`, { hasText: PAGE_NAME });
      await expect(restoredTab).toHaveCount(1, { timeout: 15_000 });
      log('step 7 page tab restored');
      const tab = page.locator(`[data-testid="personal-page-tab"][data-document-id="${documentId}"]:visible`);
      if (!(await tab.isVisible())) await restoredTab.click();
      await expect(tab).toBeVisible({ timeout: 10_000 });
      await expect(tab.locator(selectors.contentEditable).first()).toContainText(PAGE_SENTENCE, { timeout: 10_000 });
      await typedItemRow(page).click();
      await expect(page.locator('[data-testid="tracker-page-view"]:visible')).toContainText(TYPED_SENTENCE, { timeout: 10_000 });
      expect(consoleLines.filter((line) => line.includes(SCOPE_ERROR))).toEqual([]);
      log('step 7 ok: page text and typed page body restored; no scope error in either run');
    });
  } catch (error) {
    console.log(`[P2-E] renderer console (last 80 relevant lines):\n${consoleLines.slice(-80).join('\n')}`);
    throw error;
  } finally {
    await closeApp(app);
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
});
