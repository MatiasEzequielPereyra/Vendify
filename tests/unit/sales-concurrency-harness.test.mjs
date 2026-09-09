import assert from "node:assert/strict";
import test from "node:test";

import {
  createSalesConcurrencyClient,
  loadSalesConcurrencyConfig,
  runSalesConcurrency
} from "../../tests/integration/sales-concurrency.mjs";

const validEnv = {
  VENDIFY_TEST_SALES_SUPABASE_URL: "https://vendify-staging.supabase.co",
  VENDIFY_TEST_SALES_ANON_KEY: "staging-anon-key",
  VENDIFY_TEST_SALES_USER_A_EMAIL: "cash-a@example.test",
  VENDIFY_TEST_SALES_USER_A_PASSWORD: "password-a",
  VENDIFY_TEST_SALES_USER_B_EMAIL: "cash-b@example.test",
  VENDIFY_TEST_SALES_USER_B_PASSWORD: "password-b",
  VENDIFY_TEST_SALES_BRANCH_ID: "branch-1",
  VENDIFY_TEST_SALES_CASH_A_ID: "cash-a",
  VENDIFY_TEST_SALES_CASH_B_ID: "cash-b",
  VENDIFY_TEST_SALES_PRODUCT_A_ID: "product-a",
  VENDIFY_TEST_SALES_PRODUCT_B_ID: "product-b",
  VENDIFY_TEST_SALES_PAYMENT_AMOUNT: "20",
  VENDIFY_TEST_CONFIRM_STAGING_SALES: "RUN_SALES_CONCURRENCY"
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

test("sales concurrency harness refuses production and unconfirmed writes", () => {
  assert.throws(
    () => loadSalesConcurrencyConfig({ ...validEnv, VENDIFY_TEST_SALES_SUPABASE_URL: "https://puhkmblnptntorwptvld.supabase.co" }),
    /no puede ejecutarse contra producción/
  );
  assert.throws(
    () => loadSalesConcurrencyConfig({ ...validEnv, VENDIFY_TEST_CONFIRM_STAGING_SALES: "" }),
    /Faltan variables de staging/
  );
  assert.throws(
    () => loadSalesConcurrencyConfig({ ...validEnv, VENDIFY_TEST_CONFIRM_STAGING_SALES: "no" }),
    /Confirmá la escritura/
  );
});

test("sales concurrency harness sends reversed carts to v4 with separate users and cash registers", async () => {
  const config = loadSalesConcurrencyConfig(validEnv);
  const calls = [];
  const saleResults = new Map();
  const stockByProduct = new Map([["product-a", 10], ["product-b", 10]]);
  const fetchImpl = async (url, request) => {
    const body = request.body ? JSON.parse(request.body) : undefined;
    calls.push({ url, request, body });
    if (url.includes("/auth/v1/token")) {
      return response({ access_token: body.email === validEnv.VENDIFY_TEST_SALES_USER_A_EMAIL ? "token-a" : "token-b" });
    }
    if (url.endsWith("/obtener_contexto_app")) {
      return response({ business: { id: "business-1" }, branch: { id: "branch-1" } });
    }
    if (url.includes("/producto_stock_sucursal?")) {
      const productId = new URL(url).searchParams.get("producto_id")?.replace("eq.", "");
      return response([{ producto_id: productId, stock: stockByProduct.get(productId) }]);
    }
    if (url.endsWith("/registrar_venta_v4")) {
      if (!saleResults.has(body.p_request_id)) {
        saleResults.set(body.p_request_id, { venta: { id: crypto.randomUUID() } });
        for (const item of body.p_items) {
          stockByProduct.set(item.producto_id, stockByProduct.get(item.producto_id) - item.cantidad);
        }
      }
      return response(saleResults.get(body.p_request_id));
    }
    return response({ error: "unexpected" }, 500);
  };

  await runSalesConcurrency(config, fetchImpl, () => {});

  const sales = calls.filter((call) => call.url.endsWith("/registrar_venta_v4"));
  assert.equal(sales.length, 3);
  assert.deepEqual(sales.slice(0, 2).map((call) => call.body.p_items), [
    [{ producto_id: "product-a", cantidad: 1 }, { producto_id: "product-b", cantidad: 1 }],
    [{ producto_id: "product-b", cantidad: 1 }, { producto_id: "product-a", cantidad: 1 }]
  ]);
  assert.notEqual(sales[0].body.p_request_id, sales[1].body.p_request_id);
  assert.equal(sales[2].body.p_request_id, sales[0].body.p_request_id);
  assert.deepEqual(sales.slice(0, 2).map((call) => call.body.p_caja_id), ["cash-a", "cash-b"]);
  assert.deepEqual([...stockByProduct.entries()], [["product-a", 8], ["product-b", 8]]);
  assert.equal(calls.filter((call) => call.url.includes("/producto_stock_sucursal?")).length, 4);
});

test("sales concurrency client includes an authenticated bearer token", async () => {
  const config = loadSalesConcurrencyConfig(validEnv);
  let request;
  const client = createSalesConcurrencyClient(config, async (_url, input) => {
    request = input;
    return response({ ok: true });
  });
  await client.rpc("token-a", "registrar_venta_v4", { p_request_id: "request-a" });
  assert.equal(request.headers.Authorization, "Bearer token-a");
});
