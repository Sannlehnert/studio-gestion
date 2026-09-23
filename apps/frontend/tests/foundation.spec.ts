import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function identity(page: Page, role: "ADMIN" | "STUDENT" | null) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().url().endsWith("/admin/login"))
      return route.fulfill({
        status: 401,
        json: { code: "INVALID_CREDENTIALS" },
      });
    if (route.request().url().endsWith("/logout")) {
      role = null;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      status: role ? 200 : 401,
      json: role ? { user: { id: "fixture", role } } : { code: "UNAUTHORIZED" },
    });
  });
}
test("public login handles backend error and browser labels", async ({
  page,
}) => {
  await identity(page, null);
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill("profesora@example.test");
  await page
    .getByLabel("Contraseña", { exact: false })
    .first()
    .fill("invalid-password");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("input[type=password]")).toHaveValue("");
  await page.screenshot({
    path: "test-results/login-error.png",
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
for (const width of [320, 390, 768, 1440]) {
  test(`Admin layout, dialog and keyboard at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await identity(page, "ADMIN");
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Hoy", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Alumnas", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/students$/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/admin-${width}.png`,
      fullPage: true,
    });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    const logout = page.getByRole("button", {
      name: "Cerrar sesión",
      exact: true,
    });
    await logout.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await expect(
      page.getByRole("button", { name: "Cancelar", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", { name: "Cerrar sesión", exact: true }).last(),
    ).toBeFocused();
    await page.screenshot({
      path: `test-results/dialog-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(logout).toBeFocused();
    await logout.click();
    await page.evaluate(() => {
      const body = document.querySelector(".dialog-content");
      if (body)
        body.textContent =
          "Información extensa para revisar antes de confirmar. ".repeat(40);
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancelar", exact: true })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/dialog-long-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await logout.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cerrar sesión", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
  test(`Student navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await identity(page, "STUDENT");
    await page.goto("/student");
    await page.getByRole("link", { name: "Historial", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Historial", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/student-${width}.png`,
      fullPage: true,
    });
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", {
        name: "Este espacio no corresponde a tu acceso",
      }),
    ).toBeVisible();
  });
}
test("loading, connection error, long content, reduced motion and text zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.route("**/api/v1/auth/me", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.abort();
  });
  await page.goto("/admin");
  await expect(page.getByRole("status")).toContainText("Verificando");
  await page.screenshot({
    path: "test-results/loading-320.png",
    fullPage: true,
  });
  await expect(page.getByRole("alert")).toContainText("No pudimos verificar");
  await page.screenshot({
    path: "test-results/offline-320.png",
    fullPage: true,
  });
  await page.unrouteAll();
  await identity(page, "STUDENT");
  await page.goto("/student");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Inicio", exact: true }),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
    const heading = document.querySelector("h1");
    if (heading)
      heading.textContent =
        "Un título de sección largo para verificar lectura y reflujo accesible";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/zoom-long-320.png",
    fullPage: true,
  });
});
test("activation fragment is removed before Router sees navigation", async ({
  page,
}) => {
  await identity(page, null);
  await page.goto("/activate#token=fixture-only");
  await expect(page).toHaveURL(/\/activate$/);
  await expect(
    page.getByRole("button", { name: "Usar este acceso" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
});
