import { test, expect } from "@playwright/test";
test("real cookie session, CORS, CSRF, logout and Student activation", async ({
  page,
  context,
  browser,
}) => {
  test.skip(
    !process.env.E2E_ADMIN_EMAIL,
    "Requires isolated PostgreSQL runner",
  );
  const api = process.env.E2E_API_ORIGIN!;
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
  await page
    .getByLabel("Contraseña", { exact: false })
    .first()
    .fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const cookie = (await context.cookies(api)).find((c) => c.httpOnly);
  expect(cookie).toMatchObject({
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Hoy", exact: true }),
  ).toBeVisible();
  const denied = await context.request.post(api + "/api/v1/auth/logout", {
    headers: { Origin: "https://foreign.example" },
    data: {},
  });
  expect(denied.status()).toBe(403);
  const preflight = await context.request.fetch(
    api + "/api/v1/admin/subscriptions/test/payments",
    {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,idempotency-key",
      },
    },
  );
  expect(preflight.headers()["access-control-allow-credentials"]).toBe("true");
  expect(
    preflight.headers()["access-control-allow-headers"]?.toLowerCase(),
  ).toContain("idempotency-key");
  const student = await context.request.post(api + "/api/v1/admin/students", {
    headers: { Origin: "http://localhost:5173" },
    data: { fullName: "Alumna de prueba de navegador" },
  });
  expect(student.status()).toBe(201);
  const access = await context.request.post(
    api + "/api/v1/admin/students/" + (await student.json()).id + "/access",
    { headers: { Origin: "http://localhost:5173" }, data: {} },
  );
  expect(access.status()).toBe(201);
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  try {
    await studentPage.goto((await access.json()).activationUrl);
    await expect(studentPage).toHaveURL(/\/activate$/);
    await studentPage.getByRole("button", { name: "Usar este acceso" }).click();
    await expect(studentPage).toHaveURL(/\/student$/);
    await studentPage.goto("/admin");
    await expect(
      studentPage.getByRole("heading", {
        name: "Este espacio no corresponde a tu acceso",
      }),
    ).toBeVisible();
    expect(
      await studentPage.evaluate(
        () => localStorage.length + sessionStorage.length,
      ),
    ).toBe(0);
  } finally {
    await studentContext.close();
  }
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect((await context.request.get(api + "/api/v1/auth/me")).status()).toBe(
    401,
  );
});
