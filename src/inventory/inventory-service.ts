export interface InventoryErrorLike {
  message?: string;
}

export interface InventoryRpcResult {
  data: unknown;
  error: InventoryErrorLike | null;
}

export interface InventoryRpcClientPort {
  rpc(name: string, args?: Record<string, unknown>): Promise<InventoryRpcResult>;
}

export type InventoryRecord = Record<string, unknown>;

export interface StockAdjustmentInput {
  productId: string;
  branchId: string;
  mode: string;
  quantity: number;
  reason: string;
  note: string | null;
}

export interface PhysicalCountItemInput {
  productId: string;
  countedStock: number;
}

export interface StockTransferInput {
  productId: string;
  originId: string;
  destinationId: string;
  quantity: number;
  reason: string;
}

function record(value: unknown): InventoryRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as InventoryRecord
    : {};
}

function records(value: unknown): InventoryRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = record(item);
    return Object.keys(parsed).length ? [parsed] : [];
  });
}

function fail(error: InventoryErrorLike | null, fallback: string): void {
  if (error) throw new Error(error.message ?? fallback);
}

export async function listInventoryMovements(
  client: InventoryRpcClientPort,
  branchId: string,
  limit: number
): Promise<InventoryRecord[]> {
  const { data, error } = await client.rpc("listar_movimientos_inventario_v1", {
    p_sucursal_id: branchId,
    p_limit: limit
  });
  fail(error, "No se pudo cargar el historial de inventario");
  return records(data);
}

export async function adjustInventoryStock(
  client: InventoryRpcClientPort,
  input: StockAdjustmentInput
): Promise<InventoryRecord> {
  const { data, error } = await client.rpc("ajustar_stock_inventario_v2", {
    p_producto_id: input.productId,
    p_sucursal_id: input.branchId,
    p_modo: input.mode,
    p_cantidad: input.quantity,
    p_motivo: input.reason,
    p_nota: input.note
  });
  fail(error, "No se pudo ajustar el stock");
  return record(data);
}

export async function applyPhysicalCount(
  client: InventoryRpcClientPort,
  branchId: string,
  items: PhysicalCountItemInput[],
  note: string | null
): Promise<InventoryRecord> {
  const { data, error } = await client.rpc("aplicar_conteo_fisico_v2", {
    p_sucursal_id: branchId,
    p_items: items.map((item) => ({
      producto_id: item.productId,
      stock_contado: item.countedStock
    })),
    p_nota: note
  });
  fail(error, "No se pudo aplicar el conteo físico");
  return record(data);
}

export async function listTransferProducts(
  client: InventoryRpcClientPort,
  originId: string
): Promise<InventoryRecord[]> {
  const { data, error } = await client.rpc("listar_productos_sucursal_seguro_v1", {
    p_sucursal_id: originId
  });
  fail(error, "No se pudieron cargar los productos de la sucursal");
  return records(data);
}

export async function transferInventoryStock(
  client: InventoryRpcClientPort,
  input: StockTransferInput
): Promise<InventoryRecord> {
  const { data, error } = await client.rpc("transferir_stock_v2", {
    p_producto_id: input.productId,
    p_origen_id: input.originId,
    p_destino_id: input.destinationId,
    p_cantidad: input.quantity,
    p_motivo: input.reason
  });
  fail(error, "No se pudo transferir el stock");
  return record(data);
}
