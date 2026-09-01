import type {
  OfflinePaymentMethod,
  OfflineSale,
  OfflineSaleItem
} from "../types/offline.js";
import type {
  BranchId,
  BusinessId,
  CashRegisterId,
  ProductId,
  RequestId,
  UserId
} from "../types/ids.js";
import { validateOfflineSale } from "./queue-policy.js";

export interface LegacyPosSaleItemInput {
  readonly id: string;
  readonly nombre: string;
  readonly cantidad: number;
  readonly precioVenta: number;
}

export interface LegacyPosPaymentInput {
  readonly medio_pago: string;
  readonly monto: number;
}

export interface LegacyPosOfflineSaleInput {
  readonly requestId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly cashRegisterId: string;
  readonly userId: string;
  readonly createdAt?: string;
  readonly items: readonly LegacyPosSaleItemInput[];
  readonly payments: readonly LegacyPosPaymentInput[];
  readonly subtotal: number;
  readonly total: number;
  readonly observation?: string | null;
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function paymentMethod(value: string): OfflinePaymentMethod {
  if (value === "Efectivo" || value === "Transferencia") return value;
  throw new Error(`Unsupported offline payment method: ${value}`);
}

function normalizeObservation(value: string | null | undefined): string | undefined {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : undefined;
}

function mapItem(item: LegacyPosSaleItemInput): OfflineSaleItem {
  return {
    productId: requiredId(item.id, "productId") as ProductId,
    productName: item.nombre.trim(),
    quantity: item.cantidad,
    unitPrice: item.precioVenta
  };
}

export function legacyPosSaleToOfflineSale(
  input: LegacyPosOfflineSaleInput
): OfflineSale {
  const observation = normalizeObservation(input.observation);
  const sale: OfflineSale = {
    requestId: requiredId(input.requestId, "requestId") as RequestId,
    businessId: requiredId(input.businessId, "businessId") as BusinessId,
    branchId: requiredId(input.branchId, "branchId") as BranchId,
    cashRegisterId: requiredId(input.cashRegisterId, "cashRegisterId") as CashRegisterId,
    userId: requiredId(input.userId, "userId") as UserId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    items: input.items.map(mapItem),
    payments: input.payments.map((payment) => ({
      method: paymentMethod(payment.medio_pago),
      amount: payment.monto
    })),
    subtotal: input.subtotal,
    total: input.total,
    ...(observation === undefined ? {} : { observation }),
    status: "pending",
    attempts: 0
  };

  validateOfflineSale(sale);
  return sale;
}

export interface LegacyTicketSaleShape {
  readonly request_id: string;
  readonly created_at: string;
  readonly items: readonly {
    readonly producto_id: string;
    readonly producto_nombre: string;
    readonly cantidad: number;
    readonly precio_unitario: number;
  }[];
  readonly pagos: readonly {
    readonly medio_pago: OfflinePaymentMethod;
    readonly monto: number;
  }[];
  readonly totales: {
    readonly subtotal: number;
    readonly total: number;
  };
  readonly observacion: string | null;
}

export function offlineSaleToLegacyTicketShape(sale: OfflineSale): LegacyTicketSaleShape {
  return {
    request_id: sale.requestId,
    created_at: sale.createdAt,
    items: sale.items.map((item) => ({
      producto_id: item.productId,
      producto_nombre: item.productName,
      cantidad: item.quantity,
      precio_unitario: item.unitPrice
    })),
    pagos: sale.payments.map((payment) => ({
      medio_pago: payment.method,
      monto: payment.amount
    })),
    totales: {
      subtotal: sale.subtotal,
      total: sale.total
    },
    observacion: sale.observation ?? null
  };
}
