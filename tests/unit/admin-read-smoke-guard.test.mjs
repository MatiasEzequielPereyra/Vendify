import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_READ_RPCS, ADMIN_SMOKE_SCRIPT_URL, ADMIN_SUPABASE_ORIGIN, createAdminReadSmokeGuard, installAdminReadSmokeGuard
} from "../../scripts/admin-read-smoke-guard.mjs";
import { runAdminReadSmoke } from "../browser/admin-read-smoke.mjs";

const appOrigin = "http://127.0.0.1:4397";
const rpc = name => `${ADMIN_SUPABASE_ORIGIN}/rest/v1/rpc/${name}`;
const guard = options => createAdminReadSmokeGuard({ appOrigin, ...options });

function route(url, method = "POST", headers = {}, status = 200) {
  const calls = { fetch: 0, fulfill: 0, abort: 0, continue: 0 };
  return {
    calls,
    request: () => ({ url: () => url, method: () => method, headers: () => headers }),
    async fetch(options) { calls.fetch++; assert.deepEqual(options, { maxRedirects: 0 }); return { status: () => status }; },
    async fulfill() { calls.fulfill++; },
    async abort(reason) { calls.abort++; assert.equal(reason, "blockedbyclient"); },
    async continue() { calls.continue++; }
  };
}

test("all exact admin read RPCs allow Supabase POST, GET and OPTIONS, independent of method case", async () => {
  const g = guard();
  for (const name of ADMIN_READ_RPCS) {
    for (const method of ["POST", "post", "gEt", "HEAD", "OPTIONS"]) {
      const r = route(rpc(name), method, { "Content-Profile": "public" });
      await g.routeHandler(r);
      assert.deepEqual(r.calls, { fetch: 1, fulfill: 1, abort: 0, continue: 0 });
    }
  }
  assert.deepEqual(g.violations, []);
  g.assertNoWrites();
});

test("commercial writes and every unknown RPC abort before upstream, including GET", async () => {
  const g = guard();
  for (const name of ["actualizar_plan_negocio_plataforma_v1", "desconocido", "listar_negocios_plataforma_v1"]) {
    for (const method of ["POST", "GET", "DELETE"]) {
      const r = route(rpc(name), method);
      await g.routeHandler(r);
      assert.deepEqual(r.calls, { fetch: 0, fulfill: 0, abort: 1, continue: 0 });
    }
  }
  assert.equal(g.violations.length, 9);
  assert.throws(() => g.assertNoWrites(), /smoke failed/u);
});

test("encoded, trailing, schema-qualified, malformed and alternate-project URLs cannot bypass the allowlist", async () => {
  const g = guard();
  const attempts = [
    rpc("actualizar_plan_negocio_plataforma_v1/"),
    rpc("%61ctualizar_plan_negocio_plataforma_v1"),
    rpc("public%2Eactualizar_plan_negocio_plataforma_v1"),
    rpc("public.actualizar_plan_negocio_plataforma_v1"),
    rpc("%2factualizar_plan_negocio_plataforma_v1"),
    rpc("%2561ctualizar_plan_negocio_plataforma_v1"),
    rpc("listar_negocios_plataforma_v2/"),
    rpc("%6cistar_negocios_plataforma_v2"),
    rpc("../rpc/listar_negocios_plataforma_v2"),
    rpc("%2e%2e/rpc/listar_negocios_plataforma_v2"),
    `${ADMIN_SUPABASE_ORIGIN}/rest/v1/rpc/listar_negocios_plataforma_v2\\..\\actualizar_plan_negocio_plataforma_v1`,
    "https://another-project.supabase.co/rest/v1/rpc/listar_negocios_plataforma_v2",
    "https://puhkmblnptntorwptvld.supabase.co.evil.test/rest/v1/rpc/listar_negocios_plataforma_v2",
    "https://user:secret@puhkmblnptntorwptvld.supabase.co/rest/v1/rpc/listar_negocios_plataforma_v2",
    "not a URL", "https://[", "/rest/v1/rpc/listar_negocios_plataforma_v2",
    `${rpc("listar_negocios_plataforma_v2")}#token=secret`
  ];
  for (const url of attempts) {
    const r = route(url);
    await g.routeHandler(r);
    assert.deepEqual(r.calls, { fetch: 0, fulfill: 0, abort: 1, continue: 0 }, url);
  }
});

test("schema and method override headers cannot change an allowed RPC into another operation", async () => {
  for (const headers of [
    { "content-profile": "private" }, { "ACCEPT-PROFILE": "public%2Cprivate" },
    { "Content-Profile": "public,private" }, { "x-http-method-override": "DELETE" },
    { "X-Method-Override": "PATCH" }, { "x-http-method": "PUT" }
  ]) {
    const g = guard(); const r = route(rpc(ADMIN_READ_RPCS[0]), "POST", headers);
    await g.routeHandler(r);
    assert.equal(r.calls.fetch, 0); assert.equal(r.calls.abort, 1);
  }
});

test("guarded fetch never calls injected upstream for table writes, unknown RPCs or external writes", async () => {
  const g = guard(); const received = [];
  const guardedFetch = g.fetch(async (...args) => { received.push(args); return "fixture-response"; });
  for (const [url, method] of [
    [rpc("actualizar_plan_negocio_plataforma_v1"), "pOsT"],
    [`${ADMIN_SUPABASE_ORIGIN}/rest/v1/negocios`, "PATCH"],
    [`${appOrigin}/api/save`, "POST"], [`${appOrigin}/`, "DELETE"],
    ["https://external.test/save", "POST"], [`${ADMIN_SUPABASE_ORIGIN}/functions/v1/write`, "POST"]
  ]) await assert.rejects(guardedFetch(url, { method, body: "never send this" }), /guard blocked/u);
  assert.equal(received.length, 0);
  assert.equal(g.violations.length, 6);
  assert.throws(() => g.assertNoWrites(), /smoke failed/u);
});

test("guarded fetch accepts Request inputs and POST reads, forcing redirects off", async () => {
  const g = guard(); const received = [];
  const transport = g.fetch(async (...args) => { received.push(args); return "read"; });
  const request = new Request(rpc("listar_negocios_plataforma_v2"), { method: "POST", headers: { "content-profile": "public" }, body: "{}" });
  assert.equal(await transport(request, { redirect: "follow" }), "read");
  assert.equal(received[0][0], request);
  assert.deepEqual(received[0][1], { redirect: "error" });
  await assert.rejects(transport(request, { method: "DELETE" }), /guard blocked/u);
  await assert.rejects(transport(request, { headers: { "content-profile": "private" } }), /guard blocked/u);
  assert.equal(received.length, 1);
});

test("Auth allowlist covers password login, refresh, user verification and local logout only on the approved project", () => {
  const g = guard();
  for (const [endpoint, method] of [
    ["token?grant_type=password", "POST"], ["token?grant_type=refresh_token", "POST"], ["user", "GET"], ["logout?scope=local", "POST"]
  ]) assert.equal(g.check(`${ADMIN_SUPABASE_ORIGIN}/auth/v1/${endpoint}`, { method }).allowed, true);
  for (const [endpoint, method] of [
    ["user", "PATCH"], ["signup", "POST"], ["admin/users", "POST"],
    ["token?grant_type=client_credentials", "POST"], ["token?grant_type=password&grant_type=password", "POST"],
    ["logout", "POST"], ["logout?scope=global", "POST"], ["logout?scope=local&extra=true", "POST"]
  ]) assert.equal(g.check(`${ADMIN_SUPABASE_ORIGIN}/auth/v1/${endpoint}`, { method }).allowed, false);
  assert.equal(g.check("https://other.supabase.co/auth/v1/token?grant_type=password", { method: "POST" }).allowed, false);
});

test("only the exact pinned admin dependency is allowed as an external resource", () => {
  const g = guard();
  assert.equal(g.check(ADMIN_SMOKE_SCRIPT_URL).allowed, true);
  for (const [url, method] of [
    [ADMIN_SMOKE_SCRIPT_URL, "POST"], [`${ADMIN_SMOKE_SCRIPT_URL}?other=script`, "GET"],
    [ADMIN_SMOKE_SCRIPT_URL.replace("2.116.0", "latest"), "GET"], ["https://cdn.jsdelivr.net/other.js", "GET"]
  ]) assert.equal(g.check(url, { method }).allowed, false);
});

test("loopback fixtures retain exactly the same deny policy and cannot reconfigure a remote project", async () => {
  const g = guard({ supabaseOrigin: appOrigin });
  assert.equal(g.check(`${appOrigin}/rest/v1/rpc/listar_negocios_plataforma_v2`, { method: "POST" }).allowed, true);
  assert.equal(g.check(`${appOrigin}/assets/app.js`).allowed, true);
  for (const url of [`${appOrigin}/rest/v1/rpc/actualizar_plan_negocio_plataforma_v1`, `${appOrigin}/rest/v1/negocios`, `${appOrigin}/auth/v1/signup`]) {
    const r = route(url); await g.routeHandler(r); assert.equal(r.calls.fetch, 0);
  }
  assert.throws(() => guard({ supabaseOrigin: "https://other.supabase.co" }), /isolated loopback/u);
  assert.throws(() => guard({ supabaseOrigin: "http://127.0.0.1.evil.test" }), /isolated loopback/u);
});

test("violations and thrown errors exclude URL query, headers, body and malformed input even when callers swallow rejection", async () => {
  const g = guard(); const transport = g.fetch(async () => assert.fail("must not send"));
  const secret = "DO_NOT_RETAIN_PRIVATE_TOKEN";
  await transport(`${rpc(secret)}?access_token=${secret}`, {
    method: "POST", headers: { authorization: `Bearer ${secret}` }, body: secret
  }).catch(() => {});
  await transport(`https://[${secret}`, { method: secret }).catch(() => {});
  const snapshot = g.violations;
  assert.equal(snapshot.length, 2);
  assert.doesNotMatch(JSON.stringify(snapshot), /DO_NOT_RETAIN|access_token|authorization|Bearer/u);
  assert.throws(() => snapshot.push({}), TypeError);
  assert.throws(() => g.assertNoWrites(), /blocked 2 request\(s\); smoke failed/u);
});

test("browser route rejects redirects before the browser can follow them and installer covers every request", async () => {
  let installed;
  const g = await installAdminReadSmokeGuard({ async route(pattern, handler) { assert.equal(pattern, "**/*"); installed = handler; } }, { appOrigin });
  const r = route(rpc(ADMIN_READ_RPCS[0]), "POST", {}, 307);
  await installed(r);
  assert.deepEqual(r.calls, { fetch: 1, fulfill: 0, abort: 1, continue: 0 });
  assert.equal(g.violations[0].reason, "redirect");
  assert.throws(() => g.assertNoWrites(), /smoke failed/u);
});

function smokeBrowser({ attemptWrite = false, duplicateSearch = false, keepPrivateRows = false } = {}) {
  const calls = [];
  let handler;
  let pending;
  let busy = false;
  let loggedOut = false;
  let status = "";
  let generation = 0;
  let closed = false;
  const response = { url: () => rpc("listar_negocios_plataforma_v2"), request: () => ({ method: () => "POST" }), ok: () => true };
  const element = (kind, name) => ({
    async count() {
      if (kind === "group") return loggedOut && !keepPrivateRows ? 0 : 1;
      return duplicateSearch && name === "Buscar" ? 2 : 1;
    },
    async fill() { calls.push(["fill", name, generation]); },
    async selectOption() { calls.push(["select", name, generation]); },
    async isEnabled() {
      assert.equal(busy, false, "pagination must wait for the completed render");
      return true;
    },
    async waitFor() {
      if (kind === "text") {
        while (status !== "Sesión cerrada.") await new Promise(resolve => setImmediate(resolve));
      }
    },
    async click(options) {
      if (options?.trial) {
        while (busy) await new Promise(resolve => setImmediate(resolve));
        calls.push(["ready", name, generation]);
        return;
      }
      calls.push(["click", name, generation]);
      if (name === "Cerrar sesión") {
        loggedOut = true; status = "Cerrando sesión…";
        setImmediate(() => { status = "Sesión cerrada."; });
        return;
      }
      if (name === "Iniciar sesión") return;
      busy = true;
      const readRoute = route(response.url());
      await handler(readRoute);
      assert.equal(readRoute.calls.fulfill, 1);
      if (attemptWrite && name === "Buscar") {
        const write = route(rpc("actualizar_plan_negocio_plataforma_v1"));
        await handler(write); // UI intentionally swallows the blocked request.
        assert.equal(write.calls.fetch, 0); assert.equal(write.calls.abort, 1);
      }
      pending(response);
      setImmediate(() => { busy = false; generation++; });
    }
  });
  const page = {
    async goto() { calls.push(["goto"]); assert.equal(typeof handler, "function", "guard must be installed before navigation"); },
    getByRole(role, options) { assert.equal(typeof options.name === "string" ? options.exact : true, true); return element(role, options.name); },
    getByLabel(name, options) { assert.equal(options.exact, true); return element("label", name); },
    getByText(name, options) { assert.equal(options.exact, true); return element("text", name); },
    waitForResponse(predicate) { assert.equal(predicate(response), true); return new Promise(resolve => { pending = resolve; }); }
  };
  return {
    calls,
    get closed() { return closed; },
    browser: { async newContext(options) {
      assert.deepEqual(options, { serviceWorkers: "block" });
      return { async route(pattern, callback) { assert.equal(pattern, "**/*"); handler = callback; }, async newPage() { return page; }, async close() { closed = true; } };
    } }
  };
}

test("ready-to-use browser recipe guards before navigation, uses semantic names after rerenders, waits for reads and verifies logout", async () => {
  const h = smokeBrowser();
  const result = await runAdminReadSmoke({ browser: h.browser, appUrl: `${appOrigin}/admin/`, credentials: { email: "fixture@example.invalid", password: "fixture-only" } });
  assert.deepEqual(result, { status: "PASS", scope: "guarded admin read smoke", violations: [] });
  assert.equal(h.closed, true);
  assert.deepEqual(h.calls.filter(call => call[0] === "click").map(call => call[1]), ["Iniciar sesión", "Buscar", "Actualizar", "Siguiente", "Anterior", "Cerrar sesión"]);
  assert.deepEqual(h.calls.filter(call => call[0] === "ready").map(call => call[2]), [0, 1, 2, 3, 4]);
});

test("browser recipe fails even when a blocked commercial request is swallowed by UI", async () => {
  const h = smokeBrowser({ attemptWrite: true });
  await assert.rejects(runAdminReadSmoke({ browser: h.browser, appUrl: `${appOrigin}/admin/` }), /guard blocked 1 request\(s\); smoke failed/u);
  assert.equal(h.closed, true);
});

test("browser recipe refuses ambiguous current targets and private rows retained after logout", async () => {
  for (const options of [{ duplicateSearch: true }, { keepPrivateRows: true }]) {
    const h = smokeBrowser(options);
    await assert.rejects(runAdminReadSmoke({ browser: h.browser, appUrl: `${appOrigin}/admin/` }), /Admin read smoke failed/u);
    assert.equal(h.closed, true);
  }
});
