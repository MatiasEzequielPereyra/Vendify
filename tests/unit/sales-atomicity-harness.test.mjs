import assert from "node:assert/strict";
import test from "node:test";

import { loadSalesConcurrencyConfig } from "../../tests/integration/sales-concurrency.mjs";
import {
  loadSalesAtomicityConfig,
  runSalesAtomicity
} from "../../tests/integration/sales-atomicity.mjs";

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
  VENDIFY_TEST_CONFIRM_STAGING_SALES: "RUN_SALES_ATOMICITY"
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

test("sales atomicity harness requires an explicit separate staging confirmation", () => {
  assert.throws(
    () => loadSalesAtomicityConfig({ ...validEnv, VENDIFY_TEST_CONFIRM_STAGING_SALES: "RUN_SALES_CONCURRENCY" }),
    /RUN_SALES_ATOMICITY/
  );
  assert.throws(
    () => loadSalesConcurrencyConfig(validEnv),
    /RUN_SALES_CONCURRENCY/
  );
});

test("sales atomicity harness rejects insufficient stock without changing stock or cash", async () => {
  const config = loadSalesAtomicityConfig(validEnv);
  const stockByProduct = new Map([["product-a", 10], ["product-b", 4]]);
  const cashState = {
    caja: { id: "cash-a" },
    sesion: {
      id: "session-a",
      ventas_total: 50,
      ventas_efectivo: 50,
      tickets: 2,
      efectivo_esperado: 150
    }
  };
  const calls = [];
  const fetchImpl = async (url, request) => {
    const body = request.body ? JSON.parse(request.body) : undefined;
    calls.push({ url, request, body });
    if (url.includes("/auth/v1/token")) return response({ access_token: "token-a" });
    if (url.includes("/producto_stock_sucursal?")) {
      const productId = new URL(url).searchParams.get("producto_id")?.replace("eq.", "");
      return response([{ producto_id: productId, stock: stockByProduct.get(productId) }]);
    }
    if (url.endsWith("/obtener_estado_caja_v1")) return response(cashState);
    if (url.endsWith("/registrar_venta_v4")) {
      return response({ message: 'Stock insuficiente de "Producto B"' }, 400);
    }
    return response({ error: "unexpected" }, 500);
  };

  await runSalesAtomicity(config, fetchImpl, () => {});

  const rejectedSale = calls.find((call) => call.url.endsWith("/registrar_venta_v4"));
  assert.equal(rejectedSale.body.p_items[1].cantidad, 5);
  assert.deepEqual([...stockByProduct.entries()], [["product-a", 10], ["product-b", 4]]);
  assert.equal(calls.filter((call) => call.url.endsWith("/obtener_estado_caja_v1")).length, 2);
});
