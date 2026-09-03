export type SalesRecord = Record<string, unknown>;
export type DiscountType = "porcentaje" | "monto" | null;
export type PaymentMode = "single" | "mixed";

export interface DiscountRequest {
  readonly subtotal: number;
  readonly tipo: DiscountType;
  readonly valor: number;
}

export interface DiscountAuthorization extends DiscountRequest {
  readonly ok: true;
  readonly autorizador: string;
  readonly expiraMs: number;
}

export interface SaleTotals extends DiscountRequest {
  readonly descuento: number;
  readonly total: number;
}

export interface SalePayment {
  readonly medio_pago: string;
  readonly monto: number;
  readonly operacion?: string;
}

export interface DateRange {
  readonly desde: Date | null;
  readonly hasta: Date | null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function scalarText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

export function normalizeDiscountRequest(
  subtotalValue: number,
  typeValue: string,
  amountValue: number
): DiscountRequest {
  const subtotal = roundMoney(Math.max(0, subtotalValue || 0));
  const tipo: DiscountType = typeValue === "porcentaje" || typeValue === "monto"
    ? typeValue
    : null;
  let valor = amountValue || 0;
  if (tipo === "porcentaje") valor = Math.max(0, Math.min(100, valor));
  else if (tipo === "monto") valor = Math.max(0, Math.min(subtotal, valor));
  else valor = 0;
  return { subtotal, tipo, valor: roundMoney(valor) };
}

export function discountAuthorizationMatches(
  authorization: DiscountAuthorization | null,
  request: DiscountRequest,
  now = Date.now()
): boolean {
  return Boolean(
    authorization?.ok &&
    request.tipo === authorization.tipo &&
    Math.abs(request.valor - authorization.valor) <= 0.001 &&
    Math.abs(request.subtotal - authorization.subtotal) <= 0.01 &&
    now < authorization.expiraMs
  );
}

export function calculateSaleTotals(
  request: DiscountRequest,
  authorized: boolean
): SaleTotals {
  let tipo: DiscountType = null;
  let valor = 0;
  let descuento = 0;
  if (authorized && request.tipo === "porcentaje") {
    tipo = request.tipo;
    valor = request.valor;
    descuento = request.subtotal * valor / 100;
  } else if (authorized && request.tipo === "monto") {
    tipo = request.tipo;
    valor = request.valor;
    descuento = Math.min(request.subtotal, valor);
  }
  descuento = roundMoney(descuento);
  return {
    subtotal: request.subtotal,
    tipo,
    valor,
    descuento,
    total: Math.max(0, roundMoney(request.subtotal - descuento))
  };
}

export function normalizeSalePayments(
  mode: PaymentMode,
  total: number,
  singleMethod: string,
  mixedPayments: readonly SalePayment[],
  formatCurrency: (value: number) => string
): SalePayment[] {
  if (total <= 0.001) return [];
  if (mode === "single") {
    return [{ medio_pago: singleMethod || "Efectivo", monto: roundMoney(total) }];
  }
  const payments = mixedPayments
    .filter((payment) => payment.monto > 0)
    .map((payment) => ({ medio_pago: payment.medio_pago, monto: roundMoney(payment.monto) }));
  const sum = payments.reduce((accumulator, payment) => accumulator + payment.monto, 0);
  if (!payments.length) throw new Error("Ingresá al menos un medio de pago");
  if (Math.abs(sum - total) > 0.01) {
    throw new Error(
      sum < total
        ? `Faltan ${formatCurrency(total - sum)} para completar el pago`
        : `Los pagos exceden el total por ${formatCurrency(sum - total)}`
    );
  }
  return payments;
}

export function saleStatusLabel(status: unknown): string {
  const labels: Record<string, string> = {
    completada: "Completada",
    parcialmente_devuelta: "Dev. parcial",
    devuelta: "Devuelta",
    anulada: "Anulada",
    pendiente_sincronizacion: "Pendiente de sincronizar"
  };
  return labels[scalarText(status)] ?? "Completada";
}

export function netSaleTotal(sale: SalesRecord): number {
  return Math.max(0, Number(sale.total ?? 0) - Number(sale.total_devuelto ?? 0));
}

export function salePaymentsText(
  payments: readonly SalesRecord[],
  operation: string,
  formatCurrency: (value: number) => string
): string {
  return payments
    .filter((payment) => payment.operacion === operation)
    .map((payment) => `${scalarText(payment.medio_pago)}: ${formatCurrency(Number(payment.monto ?? 0))}`)
    .join(" · ");
}

export function ticketNumber(id: unknown): string {
  return scalarText(id).replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function salesDateRange(key: string, now = new Date()): DateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (key === "hoy") return { desde: today, hasta: null };
  if (key === "ayer") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { desde: yesterday, hasta: new Date(today) };
  }
  if (key === "7dias") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { desde: start, hasta: null };
  }
  if (key === "mes") return { desde: new Date(now.getFullYear(), now.getMonth(), 1), hasta: null };
  return { desde: null, hasta: null };
}
