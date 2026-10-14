import { expect, test } from "@playwright/test";

/*
 * Smoke tests that need only the web app. The full upload → processing flow
 * test (tests/e2e/upload-flow.spec.ts, next phase) additionally needs the
 * docker compose stack and a running worker.
 */

/*
 * With LECTURE_ACCESS_KEY set, every page first asks for the site password;
 * set E2E_ACCESS_KEY to the same value so the tests can pass the gate.
 */
test.beforeEach(async ({ page }) => {
  const key = process.env.E2E_ACCESS_KEY;
  if (!key) return;
  await page.goto("/access");
  await page.getByLabel("Access password").fill(key);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/access"));
});

test("landing page explains the product and links to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/sign-in");
  await expect(page.getByRole("heading", { name: "Academic integrity" })).toBeVisible();
});

test("there is no public sign-up: accounts come from the admin page", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByText("Accounts are created by the administrator.")).toBeVisible();
  await expect(page.getByRole("link", { name: /create an account/i })).toHaveCount(0);
  expect((await page.goto("/sign-up"))?.status()).toBe(404);
});

test("protected pages redirect to sign-in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("API rejects unauthenticated requests with JSON 401", async ({ request }) => {
  const res = await request.get("/api/study-sets");
  expect(res.status()).toBe(401);
  expect((await res.json()).error.code).toBe("unauthorized");
});
