import { expect, test } from "@playwright/test";

/**
 * Public shell smoke (no auth required): landing page, login page, and
 * viewport overflow regression for the mobile matrix from docs/SPECS.md.
 */

test("landing page renders core content", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("link", { name: "SiroQ" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Upload & preview")).toBeVisible();
});

test("login page renders email + password form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /sign in/i }),
  ).toBeVisible();
});

for (const viewport of [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
]) {
  test(`no horizontal overflow at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, "body should not overflow horizontally").toBe(false);
  });
}