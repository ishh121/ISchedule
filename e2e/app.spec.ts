import { expect, test, type Page } from '@playwright/test';

type Account = { name: string; email: string; password: string };

test.describe.configure({ mode: 'serial' });

let sequence = 0;
let adminAccount: Account | undefined;
let viewerAccount: Account | undefined;

function account(prefix: string): Account {
  sequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${sequence}`;
  return { name: `E2E ${prefix}`, email: `ischedule-${prefix.toLowerCase()}-${suffix}@example.invalid`, password: 'e2e-test-password' };
}

async function openRegistration(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  await page.getByRole('button', { name: /create (an )?account|register/i }).click();
  await expect(page.getByRole('heading', { name: /create your workspace/i })).toBeVisible();
}

async function registerAccount(page: Page, next: Account, role?: 'viewer') {
  await openRegistration(page);
  await page.getByLabel('Full name').fill(next.name);
  await page.getByLabel('Email').fill(next.email);
  await page.getByLabel('Password').fill(next.password);
  if (role) await page.getByLabel('Account role').selectOption(role);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('heading', { name: /^overview$/i })).toBeVisible({ timeout: 15_000 });
}

async function loginAccount(page: Page, next: Account) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  await page.getByLabel('Email').fill(next.email);
  await page.getByLabel('Password').fill(next.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('heading', { name: /^overview$/i })).toBeVisible({ timeout: 15_000 });
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
}

async function ensureViewerAccount(page: Page) {
  if (!adminAccount) {
    adminAccount = account('Bootstrap');
    await registerAccount(page, adminAccount);
  } else {
    await loginAccount(page, adminAccount);
  }
  await signOut(page);
  viewerAccount = account('Viewer');
  await registerAccount(page, viewerAccount, 'viewer');
}

async function continueLocally(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /continue with local/i }).click();
  await expect(page.getByRole('heading', { name: /^overview$/i })).toBeVisible();
}

async function expectEmptyWorkspace(page: Page) {
  await expect.soft(page.getByRole('button', { name: /^generate timetable$/i }).first()).toBeDisabled();
  for (const name of ['Courses', 'Faculty', 'Rooms', 'Student groups']) {
    await page.getByRole('navigation', { name: 'Resource navigation' }).getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /^add /i }).first()).toBeVisible();
    await expect.soft(page.getByRole('table').locator('tbody tr'), `${name} should start empty`).toHaveCount(0);
  }

  await page.getByRole('button', { name: /^timetable$/i }).click();
  await expect(page.getByRole('heading', { name: /your timetable is waiting/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Weekly timetable', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: /^settings$/i }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 2 })).toBeVisible();
  await expect.soft(page.getByRole('heading', { name: /(?:sample|demo) workspace/i })).toHaveCount(0);
  await expect.soft(page.getByRole('button', { name: /(?:reset|restore|load).*(?:sample|demo)|(?:sample|demo).*(?:reset|restore|load)/i })).toHaveCount(0);
}

test('registers the bootstrap admin and can log in again', async ({ page }) => {
  adminAccount = account('Admin');
  await registerAccount(page, adminAccount);
  await expect(page.getByText(adminAccount.name, { exact: true })).toBeVisible();
  await signOut(page);
  await loginAccount(page, adminAccount);
});

test('admin can review and restore draft workspace history', async ({ page }) => {
  if (!adminAccount) throw new Error('Admin account setup did not complete.');
  await loginAccount(page, adminAccount);
  await page.getByRole('button', { name: /settings/i }).last().click();
  await expect(page.locator('h2').filter({ hasText: /^Settings$/i })).toBeVisible();
  const preference = page.getByRole('button', { name: /avoid the first period/i });
  for (let index = 0; index < 2; index += 1) {
    const saved = page.waitForResponse(response => response.url().includes('/api/workspace') && response.request().method() === 'PUT');
    await preference.click();
    expect((await saved).ok()).toBe(true);
  }

  await page.reload();
  await expect(page.getByRole('heading', { name: /^overview$/i })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /settings/i }).last().click();
  await expect(page.getByRole('heading', { name: /workspace history/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore revision 1' })).toBeVisible();

  page.once('dialog', dialog => void dialog.accept());
  const restored = page.waitForResponse(response => response.url().includes('/api/history/restore') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Restore revision 1' }).click();
  expect((await restored).ok()).toBe(true);
  await expect(page.getByText(/History revision 1 restored as new revision 3/i)).toBeVisible();
});

test('viewer sees the no-published state', async ({ page }) => {
  await ensureViewerAccount(page);
  await expect(page.getByText(/no (published )?timetable|timetable .*not.*published|publish.*timetable.*first/i).first()).toBeVisible();
});

test('resource screens expose CSV import and room feature fields', async ({ page }) => {
  await continueLocally(page);
  await page.getByRole('button', { name: /settings/i }).last().click();
  await expect(page.locator('h2').filter({ hasText: /^Settings$/i })).toBeVisible();
  await expect(page.getByText(/bulk.*csv|csv.*bulk/i).first()).toBeVisible();

  await page.getByRole('button', { name: /^rooms$/i }).click();
   await page.getByRole('button', { name: /add room/i }).first().click();
  const roomDialog = page.getByRole('dialog');
  await expect(roomDialog.getByLabel(/feature/i)).toBeVisible();
  await roomDialog.getByRole('button', { name: /close dialog|cancel/i }).first().click();

  await page.getByRole('button', { name: /^courses$/i }).click();
   await page.getByRole('button', { name: /add course/i }).first().click();
  await expect(page.getByRole('dialog').getByLabel(/required.*feature|feature.*required/i)).toBeVisible();
});

test('local mode generates a timetable from resources created through the UI', async ({ page }) => {
  test.setTimeout(60_000);
  await continueLocally(page);

  await page.getByRole('button', { name: /^faculty$/i }).click();
   await page.getByRole('button', { name: /add faculty member/i }).first().click();
  const facultyDialog = page.getByRole('dialog');
  await facultyDialog.getByLabel('Full name', { exact: true }).fill('E2E Faculty');
  await facultyDialog.getByLabel('Email', { exact: true }).fill('faculty@example.invalid');
  await facultyDialog.getByLabel('Department', { exact: true }).fill('E2E Department');
  await facultyDialog.getByLabel('Daily teaching limit', { exact: true }).fill('3');
  await facultyDialog.getByRole('button', { name: 'Save faculty member', exact: true }).click();
  await expect(facultyDialog).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'E2E Faculty' })).toHaveCount(1);

  await page.getByRole('button', { name: /^student groups$/i }).click();
   await page.getByRole('button', { name: /add student group/i }).first().click();
  const groupDialog = page.getByRole('dialog');
  await groupDialog.getByLabel('Name', { exact: true }).fill('E2E Group');
  await groupDialog.getByLabel('Department', { exact: true }).fill('E2E Department');
  await groupDialog.getByLabel('Number of students', { exact: true }).fill('24');
  await groupDialog.getByLabel('Semester', { exact: true }).fill('1');
  await groupDialog.getByRole('button', { name: 'Save student group', exact: true }).click();
  await expect(groupDialog).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'E2E Group' })).toHaveCount(1);

  await page.getByRole('button', { name: /^rooms$/i }).click();
   await page.getByRole('button', { name: /add room/i }).first().click();
  const roomDialog = page.getByRole('dialog');
  await roomDialog.getByLabel('Name', { exact: true }).fill('E2E Room');
  await roomDialog.getByLabel('Building', { exact: true }).fill('E2E Building');
  await roomDialog.getByLabel('Capacity (seats)', { exact: true }).fill('30');
  await roomDialog.getByRole('combobox', { name: 'Room type', exact: true }).selectOption('lecture');
  await roomDialog.getByLabel(/room features/i).fill('projector');
  await roomDialog.getByRole('button', { name: 'Save room', exact: true }).click();
  await expect(roomDialog).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'E2E Room' })).toHaveCount(1);

  await page.getByRole('button', { name: /^courses$/i }).click();
   await page.getByRole('button', { name: /add course/i }).first().click();
  const courseDialog = page.getByRole('dialog');
  await courseDialog.getByLabel('Name', { exact: true }).fill('E2E Scheduling');
  await courseDialog.getByLabel('Course code', { exact: true }).fill('E2E101');
  await courseDialog.getByRole('combobox', { name: 'Student group', exact: true }).selectOption({ label: 'E2E Group' });
  await courseDialog.getByRole('combobox', { name: 'Assigned faculty', exact: true }).selectOption({ label: 'E2E Faculty' });
  await courseDialog.getByLabel('Sessions per week', { exact: true }).fill('2');
  await courseDialog.getByRole('combobox', { name: 'Periods per session', exact: true }).selectOption('1');
  await courseDialog.getByRole('combobox', { name: 'Required room', exact: true }).selectOption('lecture');
  await courseDialog.getByLabel(/required room features/i).fill('projector');
  await courseDialog.getByRole('button', { name: 'Save course', exact: true }).click();
  await expect(courseDialog).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'E2E Scheduling' })).toHaveCount(1);

  await page.getByRole('button', { name: /^generate timetable$/i }).first().click();
  await expect(page.getByRole('heading', { name: /^timetable$/i })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Weekly timetable', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /faculty workload/i })).toBeVisible();
  const sessions = page.getByRole('button', { name: 'Edit E2E101 E2E Scheduling', exact: true });
  await expect(sessions).toHaveCount(2);
  for (const session of await sessions.all()) {
    await expect(session).toContainText('E2E Room');
    await expect(session).toContainText('E2E Group');
  }
  await expect(page.getByRole('region', { name: 'Unscheduled sessions', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Schedule conflicts', exact: true })).toHaveCount(0);
});

test('viewer timetable access stays read-only', async ({ page }) => {
  if (!viewerAccount) {
    await ensureViewerAccount(page);
    await signOut(page);
  }
  const viewer = viewerAccount;
  if (!viewer) throw new Error('Viewer account setup did not complete.');
  await loginAccount(page, viewer);
  await page.getByRole('button', { name: /^timetable$/i }).click();
  await expect(page.getByRole('heading', { name: /your timetable is waiting/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /generate timetable/i }).first()).toBeDisabled();
});

test('fresh local workspaces are empty and have no sample-reset controls', async ({ page }) => {
  test.setTimeout(60_000);
  await continueLocally(page);
  await expectEmptyWorkspace(page);
});

test('fresh server workspaces are empty and have no sample-reset controls', async ({ page }) => {
  test.setTimeout(60_000);
  if (adminAccount) {
    await loginAccount(page, adminAccount);
  } else {
    adminAccount = account('EmptyWorkspace');
    await registerAccount(page, adminAccount);
  }
  await expectEmptyWorkspace(page);
});
