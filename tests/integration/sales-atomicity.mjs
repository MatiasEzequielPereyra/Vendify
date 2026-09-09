import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import {
  createSalesConcurrencyClient,
  loadSalesConcurrencyConfig
} from "./sales-concurrency.mjs";

const CONFIRMATION = "RUN_SALES_ATOMICITY";

function responseMessage(result) {
  if (typeof result.data === "string") return result.data;
  if (result.data && typeof result.data === "object") {
    return result.data.error ?? result.data.message ?? `HTTP ${result.status}`;
  }
  return `HTTP ${result.status}`;
}

function stockValue(result, productId, label) {
  assert.equal(result.ok, true, `${label}: ${responseMessage(result)}`);
  assert.ok(Array.isArray(result.data), `${label} devolvió un formato inválido`);
  assert.equal(result.data.length, 1, `${label} debe devolver un único stock para ${productId}`);
  const stock = Number(result.data[0]?.stock);
  assert.ok(Number.isFinite(stock), `${label} devolvió un stock no numérico`);
  return stock;
}

function cashSnapshot(result, label) {
  assert.equal(result.ok, true, `${label}: ${responseMessage(result)}`);
  const session = result.data?.sesion;
  assert.ok(session?.id, `${label} requiere una sesión de caja abierta`);

  return {
    sessionId: session.id,
    salesTotal: Number(session.ventas_total),
    cashSales: Number(session.ventas_efectivo),
    tickets: Number(session.tickets),
    expectedCash: Number(session.efectivo_esperado)
  };
}

function requestId() {
  return `qa-sales-atomicity-${crypto.randomUUID()}`;
}

export function loadSalesAtomicityConfig(env = process.env) {
  return loadSalesConcurrencyConfig(env, CONFIRMATION);
}

export async function runSalesAtomicity(config, fetchImpl = globalThis.fetch, log = console.log) {
  const client = createSalesConcurrencyClient(config, fetchImpl);
  const token = await client.signIn(config.userA);

  const [stockABeforeResult, stockBBeforeResult, cashBeforeResult] = await Promise.all([
    client.stock(token, config.branchId, config.productA),
    client.stock(token, config.branchId, config.productB),
    client.rpc(token, "obtener_estado_caja_v1", { p_caja_id: config.userA.cashId })
  ]);
  const stockABefore = stockValue(stockABeforeResult, config.productA, "Stock inicial A");
  const stockBBefore = stockValue(stockBBeforeResult, config.productB, "Stock inicial B");
  const cashBefore = cashSnapshot(cashBeforeResult, "Caja inicial");

  const rejectedSale = await client.rpc(token, "registrar_venta_v4", {
    p_items: [
      { producto_id: config.productA, cantidad: 1 },
      { producto_id: config.productB, cantidad: stockBBefore + 1 }
    ],
    p_pagos: [{ medio_pago: "Efectivo", monto: config.paymentAmount }],
    p_descuento_tipo: null,
    p_descuento_valor: 0,
    p_observacion: "QA automática: rechazo por stock insuficiente",
    p_sucursal_id: config.branchId,
    p_caja_id: config.userA.cashId,
    p_request_id: requestId()
  });

  assert.equal(rejectedSale.ok, false, "La venta de prueba debía ser rechazada por stock insuficiente");
  assert.match(
    responseMessage(rejectedSale),
    /stock insuficiente|no tiene stock/i,
    `La venta fue rechazada por un motivo inesperado: ${responseMessage(rejectedSale)}`
  );

  const [stockAAfterResult, stockBAfterResult, cashAfterResult] = await Promise.all([
    client.stock(token, config.branchId, config.productA),
    client.stock(token, config.branchId, config.productB),
    client.rpc(token, "obtener_estado_caja_v1", { p_caja_id: config.userA.cashId })
  ]);
  assert.equal(stockValue(stockAAfterResult, config.productA, "Stock final A"), stockABefore);
  assert.equal(stockValue(stockBAfterResult, config.productB, "Stock final B"), stockBBefore);
  assert.deepEqual(cashSnapshot(cashAfterResult, "Caja final"), cashBefore);

  log("PASS: rejected sale left stock and cash state unchanged through registrar_venta_v4");
}

async function main() {
  await runSalesAtomicity(loadSalesAtomicityConfig());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
