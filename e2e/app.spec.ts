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

test('registers the bootstrap admin and can log in again', async ({ page }) => {
  adminAccount = account('Admin');
  await registerAccount(page, adminAccount);
  await expect(page.getByText(adminAccount.name, { exact: true })).toBeVisible();
  await signOut(page);
  await loginAccount(page, adminAccount);
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
  await page.getByRole('button', { name: /add room/i }).click();
  const roomDialog = page.getByRole('dialog');
  await expect(roomDialog.getByLabel(/feature/i)).toBeVisible();
  await roomDialog.getByRole('button', { name: /close dialog|cancel/i }).first().click();

  await page.getByRole('button', { name: /^courses$/i }).click();
  await page.getByRole('button', { name: /add course/i }).click();
  await expect(page.getByRole('dialog').getByLabel(/required.*feature|feature.*required/i)).toBeVisible();
});

test('local mode generates a timetable', async ({ page }) => {
  test.setTimeout(60_000);
  await continueLocally(page);
  await page.getByRole('button', { name: /^generate timetable$/i }).first().click();
  await expect(page.getByRole('heading', { name: /^timetable$/i })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Weekly timetable', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /faculty workload/i })).toBeVisible();
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
