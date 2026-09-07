import assert from "node:assert/strict";
import test from "node:test";
import {
  READ_ONLY_RPCS,
  READ_ONLY_TABLES,
  assertDeniedWithoutPlanDisclosure,
  createTenantTestClient,
  loadTenantIsolationConfig,
  runTenantIsolation
} from "../integration/tenant-isolation.mjs";

const validEnv = {
  VENDIFY_TEST_SUPABASE_URL: "https://vendify-staging.supabase.co",
  VENDIFY_TEST_SUPABASE_ANON_KEY: "staging-anon-key",
  VENDIFY_TEST_TENANT_A_EMAIL: "a@example.test",
  VENDIFY_TEST_TENANT_A_PASSWORD: "password-a",
  VENDIFY_TEST_TENANT_B_EMAIL: "b@example.test",
  VENDIFY_TEST_TENANT_B_PASSWORD: "password-b"
};

test("tenant harness refuses the Vendify production project", () => {
  assert.throws(
    () => loadTenantIsolationConfig({
      ...validEnv,
      VENDIFY_TEST_SUPABASE_URL: "https://puhkmblnptntorwptvld.supabase.co"
    }),
    /no puede ejecutarse contra producción/
  );
});

test("tenant harness requires two distinct accounts", () => {
  assert.throws(
    () => loadTenantIsolationConfig({
      ...validEnv,
      VENDIFY_TEST_TENANT_B_EMAIL: "A@example.test"
    }),
    /cuentas diferentes/
  );
});

test("tenant harness reports every missing staging variable", () => {
  assert.throws(
    () => loadTenantIsolationConfig({}),
    /VENDIFY_TEST_SUPABASE_URL.*VENDIFY_TEST_TENANT_B_PASSWORD/
  );
});

test("tenant client only permits audited read operations", async () => {
  const requests = [];
  const client = createTenantTestClient(
    loadTenantIsolationConfig(validEnv),
    async (url, options) => {
      requests.push({ url, options });
      return new Response("[]", { status: 200 });
    }
  );

  await client.select("access-token", "negocios", "id", "business-id");
  assert.equal(requests[0].options.method, "GET");
  assert.match(requests[0].url, /\/rest\/v1\/negocios\?/);
  await assert.rejects(
    () => client.select("access-token", "audit_log", "id", "row-id"),
    /Tabla no autorizada/
  );
  await assert.rejects(
    () => client.rpc("access-token", "eliminar_producto_seguro_v1"),
    /RPC no autorizada/
  );
  assert.deepEqual([...READ_ONLY_TABLES].sort(), [
    "negocio_miembros",
    "negocios",
    "producto_stock_sucursal",
    "productos",
    "sucursales",
    "ventas"
  ]);
  assert.deepEqual([...READ_ONLY_RPCS].sort(), [
    "obtener_contexto_app",
    "obtener_contexto_sucursal",
    "validar_limite_plan_v1"
  ]);
});

test("tenant client exposes the staging host and network cause without credentials", async () => {
  const client = createTenantTestClient(
    loadTenantIsolationConfig(validEnv),
    async () => {
      throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND") });
    }
  );

  await assert.rejects(
    () => client.select("access-token", "negocios", "id", "business-id"),
    /vendify-staging\.supabase\.co\/rest\/v1\/negocios.*ENOTFOUND/
  );
});

test("denied plan checks must not disclose commercial limits", () => {
  assert.doesNotThrow(() => assertDeniedWithoutPlanDisclosure(
    { ok: false, status: 403, data: { message: "permission denied" } },
    "RPC interna"
  ));
  assert.throws(() => assertDeniedWithoutPlanDisclosure(
    { ok: false, status: 400, data: { message: "Límite del plan alcanzado" } },
    "RPC interna"
  ));
});

test("tenant isolation flow validates positive, cross-tenant and anonymous controls", async () => {
  const identities = {
    "access-a": { businessId: "business-a", branchId: "branch-a", membershipId: "member-a" },
    "access-b": { businessId: "business-b", branchId: "branch-b", membershipId: "member-b" }
  };
  const response = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
  const fetchMock = async (rawUrl, options) => {
    const url = new URL(rawUrl);
    const token = options.headers.Authorization.replace("Bearer ", "");

    if (url.pathname === "/auth/v1/token") {
      const { email } = JSON.parse(options.body);
      return response({ access_token: email === validEnv.VENDIFY_TEST_TENANT_A_EMAIL ? "access-a" : "access-b" });
    }

    if (url.pathname === "/rest/v1/rpc/obtener_contexto_app") {
      const identity = identities[token];
      if (!identity) return response({ message: "Sesión requerida" }, 401);
      return response({
        business: { id: identity.businessId, nombre: identity.businessId },
        branch: { id: identity.branchId },
        membership: { id: identity.membershipId }
      });
    }

    if (url.pathname === "/rest/v1/rpc/obtener_contexto_sucursal") {
      return response({ message: "Sucursal inexistente o no autorizada" }, 400);
    }
    if (url.pathname === "/rest/v1/rpc/validar_limite_plan_v1") {
      return response({ message: "permission denied for function" }, 403);
    }

    const table = url.pathname.replace("/rest/v1/", "");
    const identity = identities[token];
    if (!identity) return response([]);
    const filter = [...url.searchParams.entries()].find(([name]) => name !== "select");
    const requestedId = filter?.[1]?.replace(/^eq\./, "");
    const ownIds = new Set(Object.values(identity));

    if (["negocios", "sucursales", "negocio_miembros"].includes(table)) {
      return response(ownIds.has(requestedId) ? [{ id: requestedId }] : []);
    }
    return response([]);
  };
  const logs = [];

  await runTenantIsolation(
    loadTenantIsolationConfig(validEnv),
    fetchMock,
    (message) => logs.push(message)
  );

  assert.deepEqual(logs, [
    "PASS: tenant A/B isolation verified through real Auth, grants and RLS"
  ]);
});
