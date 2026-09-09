import type { DiscountRequest, SalePayment, SaleTotals, SalesRecord } from "./sales-model.js";

export interface SalesErrorLike { message?: string; }
export interface SalesResult { data: unknown; error: SalesErrorLike | null; }
export interface SalesRpcClientPort {
  rpc(name: string, args?: Record<string, unknown>): Promise<SalesResult>;
}

export interface SalesHistoryQueryPort extends PromiseLike<SalesResult> {
  select(columns: string): SalesHistoryQueryPort;
  order(column: string, options: { ascending: boolean }): SalesHistoryQueryPort;
  eq(column: string, value: unknown): SalesHistoryQueryPort;
  gte(column: string, value: string): SalesHistoryQueryPort;
  lt(column: string, value: string): SalesHistoryQueryPort;
}

export interface SalesHistoryClientPort extends SalesRpcClientPort {
  from(table: string): SalesHistoryQueryPort;
}

export interface RegisterSaleInput {
  readonly items: readonly SaleItemInput[];
  readonly payments: readonly SalePayment[];
  readonly totals: SaleTotals;
  readonly observation: string | null;
  readonly branchId: string;
  readonly cashRegisterId: string;
  readonly requestId: string;
}

export interface SaleItemInput {
  readonly id?: unknown;
  readonly producto_id?: unknown;
  readonly cantidad: number;
}

function record(value: unknown): SalesRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as SalesRecord
    : {};
}

function records(value: unknown): SalesRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is SalesRecord => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];
}

function fail(error: SalesErrorLike | null, fallback: string): void {
  if (error) throw new Error(error.message ?? fallback);
}

export async function registerSale(
  client: SalesRpcClientPort,
  input: RegisterSaleInput
): Promise<SalesRecord> {
  const { data, error } = await client.rpc("registrar_venta_v4", {
    p_items: input.items.map((item) => ({
      producto_id: item.id ?? item.producto_id,
      cantidad: item.cantidad
    })),
    p_pagos: input.payments,
    p_descuento_tipo: input.totals.tipo,
    p_descuento_valor: input.totals.valor,
    p_observacion: input.observation,
    p_sucursal_id: input.branchId,
    p_caja_id: input.cashRegisterId,
    p_request_id: input.requestId
  });
  fail(error, "No se pudo registrar la venta");
  return record(data);
}

export async function authorizeDiscount(
  client: SalesRpcClientPort,
  pin: string,
  branchId: string,
  request: DiscountRequest
): Promise<SalesRecord> {
  const { data, error } = await client.rpc("autorizar_descuento_v1", {
    p_pin: pin,
    p_sucursal_id: branchId,
    p_subtotal: request.subtotal,
    p_descuento_tipo: request.tipo,
    p_descuento_valor: request.valor
  });
  fail(error, "No se pudo autorizar el descuento");
  return record(data);
}

export async function getDiscountPinState(client: SalesRpcClientPort): Promise<SalesRecord> {
  const { data, error } = await client.rpc("estado_pin_descuento_v1");
  fail(error, "No se pudo consultar el estado del PIN");
  return record(data);
}

export async function configureDiscountPin(
  client: SalesRpcClientPort,
  pin: string
): Promise<SalesRecord> {
  const { data, error } = await client.rpc("configurar_pin_descuento_v1", { p_pin: pin });
  fail(error, "No se pudo configurar el PIN");
  return record(data);
}

export async function voidSale(
  client: SalesRpcClientPort,
  saleId: string,
  cashRegisterId: string,
  refundMethod: string,
  reason: string
): Promise<SalesRecord> {
  const { data, error } = await client.rpc("anular_venta_v1", {
    p_venta_id: saleId,
    p_caja_id: cashRegisterId,
    p_medio_reintegro: refundMethod,
    p_motivo: reason
  });
  fail(error, "No se pudo anular la venta");
  return record(data);
}

export async function returnSaleItems(
  client: SalesRpcClientPort,
  saleId: string,
  items: readonly { item_id: string; cantidad: number }[],
  cashRegisterId: string,
  refundMethod: string,
  reason: string
): Promise<SalesRecord> {
  const { data, error } = await client.rpc("devolver_venta_v1", {
    p_venta_id: saleId,
    p_items: items,
    p_caja_id: cashRegisterId,
    p_medio_reintegro: refundMethod,
    p_motivo: reason
  });
  fail(error, "No se pudo registrar la devolución");
  return record(data);
}

export async function listSales(
  client: SalesHistoryClientPort,
  branchId: string | null,
  from: Date | null,
  to: Date | null
): Promise<SalesRecord[]> {
  let query = client.from("ventas")
    .select("*, venta_items(*), venta_pagos(*), venta_devoluciones(*)")
    .order("creado", { ascending: false });
  if (branchId) query = query.eq("sucursal_id", branchId);
  if (from) query = query.gte("creado", from.toISOString());
  if (to) query = query.lt("creado", to.toISOString());
  const { data, error } = await query;
  fail(error, "No se pudo cargar el historial");
  return records(data);
}
