export interface RealtimeStockRow {
  readonly productId: string;
  readonly stock: number;
  readonly minimumStock: number;
}

export interface RealtimeStockQueryError {
  readonly message?: string;
}

export interface RealtimeStockFilterQuery {
  eq(
    column: "sucursal_id",
    value: string
  ): Promise<{
    readonly data: unknown;
    readonly error: RealtimeStockQueryError | null;
  }>;
}

export interface RealtimeStockTableQuery {
  select(columns: "producto_id,stock,stock_minimo"): RealtimeStockFilterQuery;
}

export interface RealtimeStockClientPort {
  from(table: "producto_stock_sucursal"): RealtimeStockTableQuery;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function listBranchRealtimeStock(
  client: RealtimeStockClientPort,
  branchId: string
): Promise<readonly RealtimeStockRow[]> {
  const { data, error } = await client
    .from("producto_stock_sucursal")
    .select("producto_id,stock,stock_minimo")
    .eq("sucursal_id", branchId);

  if (error) {
    throw new Error(error.message ?? "No se pudo sincronizar el stock de la sucursal");
  }

  if (!Array.isArray(data)) return [];

  return data.flatMap((value) => {
    const row = record(value);
    const productId = typeof row.producto_id === "string" ? row.producto_id : "";
    if (!productId) return [];

    return [{
      productId,
      stock: number(row.stock),
      minimumStock: number(row.stock_minimo)
    }];
  });
}
