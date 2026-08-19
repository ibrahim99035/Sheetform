import { expect, test, type Page } from "@playwright/test";

/**
 * Authenticated local-first shell smoke. Gated behind `E2E_EMAIL` +
 * `E2E_PASSWORD` (a local Supabase test user). When unset the whole file is
 * skipped so CI/other environments still pass.
 *
 *   E2E_EMAIL=owner@example.com E2E_PASSWORD=... npx playwright test
 */

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

const hasCreds = Boolean(EMAIL && PASSWORD);

test.skip(!hasCreds, "E2E_EMAIL/E2E_PASSWORD not set — skipping authenticated smoke");

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL!);
  await page.getByLabel("Password").fill(PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("owner signs in and lands on the datasets list", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/datasets/);
  await expect(page.getByText(/SiroQ/i).first()).toBeVisible();
});

test("authenticated user can open the datasets list", async ({ page }) => {
  await signIn(page);
  await page.goto("/datasets");
  await expect(page).toHaveURL(/\/datasets/);
  // The page shell renders either the empty state or a dataset row.
  await expect(
    page.locator("main, h1, [role=main]").first(),
  ).toBeVisible();
});

test("cross-origin isolation still holds after auth navigation", async ({ page }) => {
  await signIn(page);
  await page.goto("/datasets");
  const isolated = await page.evaluate(
    () => (window as { crossOriginIsolated?: boolean }).crossOriginIsolated,
  );
  expect(isolated).toBe(true);
});