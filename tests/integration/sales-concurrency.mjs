import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const PRODUCTION_HOST = "puhkmblnptntorwptvld.supabase.co";
const REQUIRED_ENV = [
  "VENDIFY_TEST_SALES_SUPABASE_URL",
  "VENDIFY_TEST_SALES_ANON_KEY",
  "VENDIFY_TEST_SALES_USER_A_EMAIL",
  "VENDIFY_TEST_SALES_USER_A_PASSWORD",
  "VENDIFY_TEST_SALES_USER_B_EMAIL",
  "VENDIFY_TEST_SALES_USER_B_PASSWORD",
  "VENDIFY_TEST_SALES_BRANCH_ID",
  "VENDIFY_TEST_SALES_CASH_A_ID",
  "VENDIFY_TEST_SALES_CASH_B_ID",
  "VENDIFY_TEST_SALES_PRODUCT_A_ID",
  "VENDIFY_TEST_SALES_PRODUCT_B_ID",
  "VENDIFY_TEST_SALES_PAYMENT_AMOUNT",
  "VENDIFY_TEST_CONFIRM_STAGING_SALES"
];

function required(env, name) {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new Error(`Falta ${name} en .env.tenant-tests`);
  return value;
}

function responseMessage(result) {
  if (typeof result.data === "string") return result.data;
  if (result.data && typeof result.data === "object") {
    return result.data.error ?? result.data.message ?? `HTTP ${result.status}`;
  }
  return `HTTP ${result.status}`;
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

function requestId(label) {
  return `qa-sales-${label}-${crypto.randomUUID()}`;
}

export function loadSalesConcurrencyConfig(env = process.env) {
  const missing = REQUIRED_ENV.filter((name) => !String(env[name] ?? "").trim());
  if (missing.length) throw new Error(`Faltan variables de staging: ${missing.join(", ")}`);

  const baseUrl = new URL(required(env, "VENDIFY_TEST_SALES_SUPABASE_URL"));
  if (baseUrl.hostname.toLowerCase() === PRODUCTION_HOST) {
    throw new Error("La suite de ventas concurrentes no puede ejecutarse contra producción");
  }
  if (baseUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(baseUrl.hostname)) {
    throw new Error("Supabase staging debe usar HTTPS o una URL local");
  }
  if (required(env, "VENDIFY_TEST_CONFIRM_STAGING_SALES") !== "RUN_SALES_CONCURRENCY") {
    throw new Error("Confirmá la escritura en staging con VENDIFY_TEST_CONFIRM_STAGING_SALES=RUN_SALES_CONCURRENCY");
  }

  const userA = {
    email: required(env, "VENDIFY_TEST_SALES_USER_A_EMAIL"),
    password: required(env, "VENDIFY_TEST_SALES_USER_A_PASSWORD"),
    cashId: required(env, "VENDIFY_TEST_SALES_CASH_A_ID")
  };
  const userB = {
    email: required(env, "VENDIFY_TEST_SALES_USER_B_EMAIL"),
    password: required(env, "VENDIFY_TEST_SALES_USER_B_PASSWORD"),
    cashId: required(env, "VENDIFY_TEST_SALES_CASH_B_ID")
  };
  if (userA.email.toLowerCase() === userB.email.toLowerCase()) {
    throw new Error("Las ventas concurrentes requieren dos usuarios de staging distintos");
  }
  if (userA.cashId === userB.cashId) {
    throw new Error("Las ventas concurrentes requieren dos cajas de staging distintas");
  }

  const productA = required(env, "VENDIFY_TEST_SALES_PRODUCT_A_ID");
  const productB = required(env, "VENDIFY_TEST_SALES_PRODUCT_B_ID");
  if (productA === productB) throw new Error("Usá dos productos de prueba distintos para invertir el orden de locks");

  const paymentAmount = Number(required(env, "VENDIFY_TEST_SALES_PAYMENT_AMOUNT"));
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new Error("VENDIFY_TEST_SALES_PAYMENT_AMOUNT debe ser un importe positivo");
  }

  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    anonKey: required(env, "VENDIFY_TEST_SALES_ANON_KEY"),
    branchId: required(env, "VENDIFY_TEST_SALES_BRANCH_ID"),
    productA,
    productB,
    paymentAmount,
    userA,
    userB
  };
}

export function createSalesConcurrencyClient(config, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("Fetch no está disponible");

  async function request(path, { token = null, body } = {}) {
    const url = `${config.baseUrl}${path}`;
    try {
      return await parseResponse(await fetchImpl(url, {
        method: "POST",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${token ?? config.anonKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body ?? {})
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`No se pudo conectar con ${new URL(url).host}: ${message}`, { cause: error });
    }
  }

  return {
    async signIn(credentials) {
      const result = await request("/auth/v1/token?grant_type=password", { body: credentials });
      if (!result.ok || !result.data?.access_token) {
        throw new Error(`No se pudo autenticar una cuenta de staging: ${responseMessage(result)}`);
      }
      return result.data.access_token;
    },
    rpc(token, name, args = {}) {
      return request(`/rest/v1/rpc/${name}`, { token, body: args });
    }
  };
}

function contextIdentity(context, label) {
  const businessId = context?.business?.id;
  const branchId = context?.branch?.id;
  assert.ok(businessId, `${label} no devolvió business.id`);
  assert.ok(branchId, `${label} no devolvió branch.id`);
  return { businessId, branchId };
}

function salePayload(config, items, cashId, id) {
  return {
    p_items: items.map((producto_id) => ({ producto_id, cantidad: 1 })),
    p_pagos: [{ medio_pago: "Efectivo", monto: config.paymentAmount }],
    p_descuento_tipo: null,
    p_descuento_valor: 0,
    p_observacion: "QA automática: locks concurrentes",
    p_sucursal_id: config.branchId,
    p_caja_id: cashId,
    p_request_id: id
  };
}

export async function runSalesConcurrency(config, fetchImpl = globalThis.fetch, log = console.log) {
  const client = createSalesConcurrencyClient(config, fetchImpl);
  const [tokenA, tokenB] = await Promise.all([
    client.signIn(config.userA),
    client.signIn(config.userB)
  ]);
  const [contextAResult, contextBResult] = await Promise.all([
    client.rpc(tokenA, "obtener_contexto_app"),
    client.rpc(tokenB, "obtener_contexto_app")
  ]);
  assert.equal(contextAResult.ok, true, `Contexto A: ${responseMessage(contextAResult)}`);
  assert.equal(contextBResult.ok, true, `Contexto B: ${responseMessage(contextBResult)}`);
  const a = contextIdentity(contextAResult.data, "Usuario A");
  const b = contextIdentity(contextBResult.data, "Usuario B");
  assert.equal(a.businessId, b.businessId, "Los dos usuarios deben pertenecer al mismo negocio de staging");
  assert.equal(a.branchId, config.branchId, "La sucursal configurada no coincide con el contexto de A");
  assert.equal(b.branchId, config.branchId, "La sucursal configurada no coincide con el contexto de B");

  const [saleA, saleB] = await Promise.all([
    client.rpc(tokenA, "registrar_venta_v4", salePayload(
      config, [config.productA, config.productB], config.userA.cashId, requestId("a")
    )),
    client.rpc(tokenB, "registrar_venta_v4", salePayload(
      config, [config.productB, config.productA], config.userB.cashId, requestId("b")
    ))
  ]);

  assert.equal(saleA.ok, true, `Venta concurrente A: ${responseMessage(saleA)}`);
  assert.equal(saleB.ok, true, `Venta concurrente B: ${responseMessage(saleB)}`);
  log("PASS: two concurrent reversed carts completed through registrar_venta_v4");
}

async function main() {
  await runSalesConcurrency(loadSalesConcurrencyConfig());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
