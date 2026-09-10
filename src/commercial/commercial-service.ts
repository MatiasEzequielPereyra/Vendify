import type { CashErrorLike, CashRpcClientPort } from "../cash/cash-service.js";

export type CommercialRecord = Record<string, unknown>;

export interface OperationalConfigInput {
  readonly stockCoverageAlert: number;
  readonly largeAdjustmentUnits: number;
  readonly cashDifferenceAlert: number;
  readonly dailySummary: boolean;
  readonly autoPrintTicket: boolean;
  readonly ticketWidthMm: number;
}

function record(value: unknown): CommercialRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as CommercialRecord
    : {};
}

function fail(error: CashErrorLike | null, fallback: string): void {
  if (error) throw new Error(error.message ?? fallback);
}

async function callRecord(
  client: CashRpcClientPort,
  name: string,
  args: Record<string, unknown> | undefined,
  fallback: string
): Promise<CommercialRecord> {
  const { data, error } = await client.rpc(name, args);
  fail(error, fallback);
  return record(data);
}

export function getCommercialOnboarding(client: CashRpcClientPort): Promise<CommercialRecord> {
  return callRecord(client, "estado_onboarding_comercial_v1", undefined, "No se pudo cargar el onboarding");
}

export function getCurrentPlan(client: CashRpcClientPort): Promise<CommercialRecord> {
  return callRecord(client, "obtener_plan_actual_v1", undefined, "No se pudo cargar el plan");
}

export function getOperationalConfig(client: CashRpcClientPort): Promise<CommercialRecord> {
  return callRecord(client, "obtener_config_operativa_v1", undefined, "No se pudo cargar la configuración");
}

export async function saveOperationalConfig(
  client: CashRpcClientPort,
  input: OperationalConfigInput
): Promise<CommercialRecord> {
  const result = await callRecord(client, "guardar_config_operativa_v1", {
    p_stock_cobertura_alerta: input.stockCoverageAlert,
    p_ajuste_grande_unidades: input.largeAdjustmentUnits,
    p_diferencia_caja_alerta: input.cashDifferenceAlert,
    p_resumen_diario: input.dailySummary,
    p_auto_imprimir_ticket: input.autoPrintTicket,
    p_ancho_ticket_mm: input.ticketWidthMm
  }, "No se pudo guardar la configuración");
  if (result.ok === false) {
    const message = typeof result.message === "string" ? result.message : "No se pudo guardar";
    throw new Error(message);
  }
  return result;
}

export function exportOperationalBackup(client: CashRpcClientPort): Promise<CommercialRecord> {
  return callRecord(client, "exportar_respaldo_operativo_v1", undefined, "No se pudo generar el respaldo");
}
