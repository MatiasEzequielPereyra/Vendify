import type { LegacyPosPaymentInput, LegacyPosSaleItemInput } from "./legacy-adapter.js";

export type LegacyOfflineSaleStatus = "pending" | "revision";

export interface LegacyOfflineSale {
  readonly request_id: string;
  status: LegacyOfflineSaleStatus;
  attempts: number;
  last_error: string | null;
  readonly created_at: string;
  readonly user_id: string | null;
  readonly negocio_id: string;
  readonly sucursal_id: string;
  readonly caja_id: string;
  readonly items: readonly {
    readonly producto_id: string;
    readonly producto_nombre: string;
    readonly cantidad: number;
    readonly precio_unitario: number;
  }[];
  readonly pagos: readonly {
    readonly medio_pago: string;
    readonly monto: number;
  }[];
  readonly totales: {
    readonly subtotal: number;
    readonly total: number;
  };
  readonly observacion: string | null;
}

export interface LegacyOfflineTotals {
  readonly subtotal: number;
  readonly total: number;
  readonly tipo?: string | null;
  readonly descuento?: number;
}

export interface LegacyOfflineQueueSummary {
  readonly total: number;
  readonly pending: number;
  readonly revision: number;
  readonly queue: readonly LegacyOfflineSale[];
}

export interface CreateLegacyOfflineSaleInput {
  readonly requestId: string;
  readonly userId: string | null;
  readonly businessId: string;
  readonly branchId: string;
  readonly cashRegisterId: string;
  readonly items: readonly LegacyPosSaleItemInput[];
  readonly payments: readonly LegacyPosPaymentInput[];
  readonly totals: LegacyOfflineTotals;
  readonly observation: string;
  readonly createdAt?: string;
}

export function parseLegacyOfflineQueue(raw: string | null): LegacyOfflineSale[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as LegacyOfflineSale[] : [];
  } catch {
    return [];
  }
}

export function summarizeLegacyOfflineQueue(
  queue: readonly LegacyOfflineSale[]
): LegacyOfflineQueueSummary {
  return {
    total: queue.length,
    pending: queue.filter((sale) => sale.status !== "revision").length,
    revision: queue.filter((sale) => sale.status === "revision").length,
    queue
  };
}

export function validateLegacyOfflinePayments(
  payments: readonly LegacyPosPaymentInput[]
): void {
  const allowed = new Set(["Efectivo", "Transferencia"]);
  if (payments.some((payment) => !allowed.has(payment.medio_pago))) {
    throw new Error(
      "Sin internet solo se permiten cobros en Efectivo o Transferencia."
    );
  }
}

export function createLegacyOfflineSale(
  input: CreateLegacyOfflineSaleInput
): LegacyOfflineSale {
  return {
    request_id: input.requestId,
    status: "pending",
    attempts: 0,
    last_error: null,
    created_at: input.createdAt ?? new Date().toISOString(),
    user_id: input.userId,
    negocio_id: input.businessId,
    sucursal_id: input.branchId,
    caja_id: input.cashRegisterId,
    items: input.items.map((item) => ({
      producto_id: item.id,
      producto_nombre: item.nombre,
      cantidad: item.cantidad,
      precio_unitario: item.precioVenta
    })),
    pagos: input.payments.map((payment) => ({
      medio_pago: payment.medio_pago,
      monto: payment.monto
    })),
    totales: {
      subtotal: input.totals.subtotal,
      total: input.totals.total
    },
    observacion: input.observation.trim() || null
  };
}

export function buildLegacyOfflineTicket(sale: LegacyOfflineSale): Record<string, unknown> {
  return {
    venta: {
      id: sale.request_id,
      creado: sale.created_at,
      subtotal: sale.totales.subtotal,
      descuento_total: 0,
      total: sale.totales.total,
      estado: "pendiente_sincronizacion",
      observacion: sale.observacion
    },
    items: sale.items.map((item) => ({
      producto_nombre: item.producto_nombre,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      subtotal: item.precio_unitario * item.cantidad
    })),
    pagos: sale.pagos.map((payment) => ({
      ...payment,
      operacion: "cobro"
    }))
  };
}

export function isLegacyOfflineNetworkError(error: unknown, online: boolean): boolean {
  const value = typeof error === "object" && error !== null && "message" in error
    ? (error as { readonly message?: unknown }).message
    : error;
  const text = typeof value === "string"
    ? value.toLowerCase()
    : typeof value === "number" || typeof value === "boolean"
      ? String(value).toLowerCase()
      : "";
  return !online || ["failed to fetch", "network", "load failed", "internet"]
    .some((marker) => text.includes(marker));
}
