import { installAdminReadSmokeGuard } from "../../scripts/admin-read-smoke-guard.mjs";

// Reusable with an existing Playwright installation; adds no browser dependency.
// The recipe creates its own fresh context and blocks service workers so every
// request is intercepted; an existing worker must not bypass the route guard.
// Credentials are supplied by the caller in memory and are never logged.
// Every action resolves a unique current accessible label/name. Do not replace
// these locators with snapshot indexes, nth(), coordinates or numeric AX IDs.
// Protected Vercel navigation/SSO redirects abort and fail this recipe. It does
// not bypass protection or claim hosted Auth/role proof from a local fixture.
export async function runAdminReadSmoke({ browser, appUrl, credentials, search = "", plan = "", state = "", supabaseOrigin }) {
  const origin = new URL(appUrl).origin;
  const context = await browser.newContext({ serviceWorkers: "block" });
  let guard;
  let page;
  try {
    guard = await installAdminReadSmokeGuard(context, { appOrigin: origin, ...(supabaseOrigin ? { supabaseOrigin } : {}) });
    page = await context.newPage();
    return await readScenario();
  } catch {
    // Browser action failures can include filled values in their call log.
    throw new Error("Admin read smoke failed; private browser diagnostics omitted");
  } finally {
    try { await context.close(); }
    finally {
      // Network failures are often swallowed by UI controllers. A blocked attempt
      // must still fail the smoke, even when all visible assertions appeared fine.
      guard?.assertNoWrites();
    }
  }
  async function readScenario() {
    const locator = (role, name) => page.getByRole(role, { name, exact: true });
    const unique = async element => {
      if (await element.count() !== 1) throw new Error("Read smoke requires exactly one current semantic target");
      return element;
    };
    const click = async name => (await unique(locator("button", name))).click();
    const fill = async (name, value) => (await unique(page.getByLabel(name, { exact: true }))).fill(value);
    const idle = async () => (await unique(locator("button", "Buscar"))).click({ trial: true });
    const read = async name => {
      const [response] = await Promise.all([
        page.waitForResponse(response => {
          const url = new URL(response.url());
          return url.pathname === "/rest/v1/rpc/listar_negocios_plataforma_v2" && response.request().method() === "POST";
        }),
        click(name)
      ]);
      if (!response.ok()) throw new Error("Admin read did not succeed");
      await idle();
    };
    await page.goto(appUrl);
    if (credentials) {
      await fill("Email", credentials.email);
      await fill("Contraseña", credentials.password);
      await click("Iniciar sesión");
    }
    await page.getByLabel("Buscar negocio", { exact: true }).waitFor({ state: "visible" });
    await idle();
    if (await page.getByRole("group", { name: /^Negocio /u }).count() === 0) {
      throw new Error("Admin read smoke requires a nonempty initial business list");
    }
    await fill("Buscar negocio", search);
    await fill("Plan", plan);
    await (await unique(page.getByLabel("Estado", { exact: true }))).selectOption(state);
    await read("Buscar");
    await read("Actualizar");
    for (const name of ["Siguiente", "Anterior"]) {
      const button = await unique(locator("button", name));
      if (await button.isEnabled()) await read(name);
    }
    await click("Cerrar sesión");
    await page.getByText("Sesión cerrada.", { exact: true }).waitFor({ state: "visible" });
    await page.getByLabel("Email", { exact: true }).waitFor({ state: "visible" });
    if (await page.getByRole("group", { name: /^Negocio /u }).count() !== 0) {
      throw new Error("Business content remained after logout");
    }
    guard.assertNoWrites();
    return { status: "PASS", scope: "guarded admin read smoke", violations: guard.violations };
  }
}
