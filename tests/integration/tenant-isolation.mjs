import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const PRODUCTION_HOST = "puhkmblnptntorwptvld.supabase.co";

export const READ_ONLY_TABLES = new Set([
  "negocios",
  "negocio_miembros",
  "sucursales",
  "productos",
  "ventas",
  "producto_stock_sucursal"
]);

export const READ_ONLY_RPCS = new Set([
  "obtener_contexto_app",
  "obtener_contexto_sucursal",
  "validar_limite_plan_v1"
]);

const REQUIRED_ENV = [
  "VENDIFY_TEST_SUPABASE_URL",
  "VENDIFY_TEST_SUPABASE_ANON_KEY",
  "VENDIFY_TEST_TENANT_A_EMAIL",
  "VENDIFY_TEST_TENANT_A_PASSWORD",
  "VENDIFY_TEST_TENANT_B_EMAIL",
  "VENDIFY_TEST_TENANT_B_PASSWORD"
];

function required(env, name) {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new Error(`Falta ${name} en .env.tenant-tests`);
  return value;
}

export function loadTenantIsolationConfig(env = process.env) {
  const missing = REQUIRED_ENV.filter((name) => !String(env[name] ?? "").trim());
  if (missing.length) {
    throw new Error(`Faltan variables de staging: ${missing.join(", ")}`);
  }

  const baseUrl = new URL(required(env, "VENDIFY_TEST_SUPABASE_URL"));
  if (baseUrl.hostname.toLowerCase() === PRODUCTION_HOST) {
    throw new Error("La suite de aislamiento no puede ejecutarse contra producción");
  }

  if (
    baseUrl.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(baseUrl.hostname)
  ) {
    throw new Error("Supabase staging debe usar HTTPS o una URL local");
  }

  const tenantAEmail = required(env, "VENDIFY_TEST_TENANT_A_EMAIL");
  const tenantBEmail = required(env, "VENDIFY_TEST_TENANT_B_EMAIL");
  if (tenantAEmail.toLowerCase() === tenantBEmail.toLowerCase()) {
    throw new Error("Tenant A y tenant B deben usar cuentas diferentes");
  }

  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    anonKey: required(env, "VENDIFY_TEST_SUPABASE_ANON_KEY"),
    tenantA: {
      email: tenantAEmail,
      password: required(env, "VENDIFY_TEST_TENANT_A_PASSWORD")
    },
    tenantB: {
      email: tenantBEmail,
      password: required(env, "VENDIFY_TEST_TENANT_B_PASSWORD")
    }
  };
}

async function parseResponse(response) {
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: response.ok, status: response.status, data };
}

function failureMessage(result) {
  if (typeof result.data === "string") return result.data;
  return result.data?.message ?? result.data?.error_description ?? `HTTP ${result.status}`;
}

function networkFailureMessage(url, error) {
  const endpoint = new URL(url);
  const cause = error instanceof Error && error.cause instanceof Error
    ? error.cause.message
    : error instanceof Error
      ? error.message
      : String(error);
  return [
    `No se pudo conectar con ${endpoint.host}${endpoint.pathname}`,
    "Revisá que VENDIFY_TEST_SUPABASE_URL sea la URL HTTPS del proyecto de staging",
    `Causa de red: ${cause}`
  ].join(". ");
}

export function createTenantTestClient(config, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("Fetch no está disponible");

  async function request(path, { token = null, method = "GET", body } = {}) {
    const headers = {
      apikey: config.anonKey,
      Authorization: `Bearer ${token ?? config.anonKey}`
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const url = `${config.baseUrl}${path}`;
    try {
      return await parseResponse(await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      }));
    } catch (error) {
      throw new Error(networkFailureMessage(url, error), { cause: error });
    }
  }

  return {
    async signIn(credentials) {
      const result = await request("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email: credentials.email, password: credentials.password }
      });
      if (!result.ok || !result.data?.access_token) {
        throw new Error(`No se pudo autenticar una cuenta de staging: ${failureMessage(result)}`);
      }
      return result.data.access_token;
    },

    async select(token, table, column, value) {
      if (!READ_ONLY_TABLES.has(table)) {
        throw new Error(`Tabla no autorizada por la suite read-only: ${table}`);
      }
      const query = new URLSearchParams({ select: "*", [column]: `eq.${value}` });
      return request(`/rest/v1/${table}?${query.toString()}`, { token });
    },

    async rpc(token, name, args = {}) {
      if (!READ_ONLY_RPCS.has(name)) {
        throw new Error(`RPC no autorizada por la suite read-only: ${name}`);
      }
      return request(`/rest/v1/rpc/${name}`, { token, method: "POST", body: args });
    }
  };
}

function contextIdentity(context, label) {
  const identity = {
    businessId: context?.business?.id,
    businessName: context?.business?.nombre,
    branchId: context?.branch?.id,
    membershipId: context?.membership?.id
  };
  for (const [field, value] of Object.entries(identity)) {
    if (field === "businessName") continue;
    assert.ok(value, `${label} no devolvió ${field}`);
  }
  return identity;
}

function expectSuccess(result, label) {
  assert.equal(result.ok, true, `${label}: ${failureMessage(result)}`);
  return result.data;
}

function expectRows(result, label) {
  const data = expectSuccess(result, label);
  assert.ok(Array.isArray(data), `${label}: la respuesta no es una lista`);
  return data;
}

export function assertDeniedWithoutPlanDisclosure(result, label) {
  assert.equal(result.ok, false, `${label}: el acceso debía ser rechazado`);
  const body = JSON.stringify(result.data ?? "");
  assert.doesNotMatch(body, /límite del plan|prueba de vendify venció|plan alcanzado/i);
}

async function expectOwnRow(client, token, table, column, id, label) {
  const rows = expectRows(await client.select(token, table, column, id), label);
  assert.equal(rows.length, 1, `${label}: el control positivo no encontró una fila propia`);
}

async function expectCrossTenantEmpty(client, token, table, column, id, label) {
  const rows = expectRows(await client.select(token, table, column, id), label);
  assert.deepEqual(rows, [], `${label}: RLS expuso una fila del otro tenant`);
}

export async function runTenantIsolation(config, fetchImpl = globalThis.fetch, log = console.log) {
  const client = createTenantTestClient(config, fetchImpl);
  const [tokenA, tokenB] = await Promise.all([
    client.signIn(config.tenantA),
    client.signIn(config.tenantB)
  ]);

  const [contextAResult, contextBResult] = await Promise.all([
    client.rpc(tokenA, "obtener_contexto_app"),
    client.rpc(tokenB, "obtener_contexto_app")
  ]);
  const contextA = expectSuccess(contextAResult, "Contexto tenant A");
  const contextB = expectSuccess(contextBResult, "Contexto tenant B");
  const a = contextIdentity(contextA, "Tenant A");
  const b = contextIdentity(contextB, "Tenant B");
  assert.notEqual(a.businessId, b.businessId, "Las cuentas deben pertenecer a negocios distintos");

  const positiveControls = [
    ["negocios", "id", "businessId"],
    ["sucursales", "id", "branchId"],
    ["negocio_miembros", "id", "membershipId"]
  ];
  for (const [table, column, identityField] of positiveControls) {
    await expectOwnRow(client, tokenA, table, column, a[identityField], `A lee ${table} propio`);
    await expectOwnRow(client, tokenB, table, column, b[identityField], `B lee ${table} propio`);
    await expectCrossTenantEmpty(client, tokenA, table, column, b[identityField], `A no lee ${table} de B`);
    await expectCrossTenantEmpty(client, tokenB, table, column, a[identityField], `B no lee ${table} de A`);
  }

  for (const table of ["productos", "ventas"]) {
    expectRows(await client.select(tokenA, table, "negocio_id", a.businessId), `A consulta ${table} propio`);
    expectRows(await client.select(tokenB, table, "negocio_id", b.businessId), `B consulta ${table} propio`);
    await expectCrossTenantEmpty(client, tokenA, table, "negocio_id", b.businessId, `A no lee ${table} de B`);
    await expectCrossTenantEmpty(client, tokenB, table, "negocio_id", a.businessId, `B no lee ${table} de A`);
  }

  expectRows(
    await client.select(tokenA, "producto_stock_sucursal", "sucursal_id", a.branchId),
    "A consulta stock propio"
  );
  expectRows(
    await client.select(tokenB, "producto_stock_sucursal", "sucursal_id", b.branchId),
    "B consulta stock propio"
  );
  await expectCrossTenantEmpty(
    client, tokenA, "producto_stock_sucursal", "sucursal_id", b.branchId,
    "A no lee stock de B"
  );
  await expectCrossTenantEmpty(
    client, tokenB, "producto_stock_sucursal", "sucursal_id", a.branchId,
    "B no lee stock de A"
  );

  assertDeniedWithoutPlanDisclosure(
    await client.rpc(tokenA, "obtener_contexto_sucursal", { p_sucursal_id: b.branchId }),
    "A no obtiene contexto de sucursal B"
  );
  assertDeniedWithoutPlanDisclosure(
    await client.rpc(tokenB, "obtener_contexto_sucursal", { p_sucursal_id: a.branchId }),
    "B no obtiene contexto de sucursal A"
  );
  assertDeniedWithoutPlanDisclosure(
    await client.rpc(tokenA, "validar_limite_plan_v1", {
      p_negocio_id: a.businessId,
      p_recurso: "productos",
      p_incremento: 1
    }),
    "La primitiva de límites no es RPC de cliente"
  );
  assertDeniedWithoutPlanDisclosure(
    await client.rpc(tokenA, "validar_limite_plan_v1", {
      p_negocio_id: b.businessId,
      p_recurso: "productos",
      p_incremento: 1
    }),
    "La primitiva de límites no filtra datos de otro tenant"
  );

  assertDeniedWithoutPlanDisclosure(
    await client.rpc(null, "obtener_contexto_app"),
    "Un usuario anónimo no obtiene contexto"
  );
  const anonymousBusinessRead = await client.select(null, "negocios", "id", a.businessId);
  if (anonymousBusinessRead.ok) {
    assert.deepEqual(anonymousBusinessRead.data, [], "Anon no debe leer negocios");
  }

  log("PASS: tenant A/B isolation verified through real Auth, grants and RLS");
}

async function main() {
  await runTenantIsolation(loadTenantIsolationConfig());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
