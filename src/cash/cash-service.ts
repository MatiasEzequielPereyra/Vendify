export interface CashErrorLike {
  message?: string;
}

export interface CashRpcResult {
  data: unknown;
  error: CashErrorLike | null;
}

export interface CashRpcClientPort {
  rpc(name: string, args?: Record<string, unknown>): Promise<CashRpcResult>;
}

export type CashRecord = Record<string, unknown>;

function record(value: unknown): CashRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as CashRecord
    : {};
}

function records(value: unknown): CashRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = record(item);
    return Object.keys(parsed).length ? [parsed] : [];
  });
}

function fail(error: CashErrorLike | null, fallback: string): void {
  if (error) throw new Error(error.message ?? fallback);
}

export async function listCashRegisters(
  client: CashRpcClientPort,
  branchId: string
): Promise<CashRecord[]> {
  const { data, error } = await client.rpc("listar_cajas_sucursal_v1", {
    p_sucursal_id: branchId
  });
  fail(error, "No se pudieron cargar las cajas");
  return records(data);
}

export async function getCashState(
  client: CashRpcClientPort,
  cashRegisterId: string
): Promise<CashRecord> {
  const { data, error } = await client.rpc("obtener_estado_caja_v1", {
    p_caja_id: cashRegisterId
  });
  fail(error, "No se pudo cargar el estado de caja");
  return record(data);
}

export async function openCashRegister(
  client: CashRpcClientPort,
  cashRegisterId: string,
  openingFund: number,
  note: string | null
): Promise<CashRecord> {
  const { data, error } = await client.rpc("abrir_caja_v1", {
    p_caja_id: cashRegisterId,
    p_fondo_inicial: openingFund,
    p_nota: note
  });
  fail(error, "No se pudo abrir la caja");
  return record(data);
}

export async function registerCashMovement(
  client: CashRpcClientPort,
  cashRegisterId: string,
  type: string,
  amount: number,
  reason: string
): Promise<CashRecord> {
  const { data, error } = await client.rpc("registrar_movimiento_caja_v1", {
    p_caja_id: cashRegisterId,
    p_tipo: type,
    p_monto: amount,
    p_motivo: reason
  });
  fail(error, "No se pudo registrar el movimiento");
  return record(data);
}

export async function listOpenCashMovements(
  client: CashRpcClientPort,
  cashRegisterId: string
): Promise<CashRecord[]> {
  const { data, error } = await client.rpc("listar_movimientos_caja_abierta_v1", {
    p_caja_id: cashRegisterId
  });
  fail(error, "No se pudieron cargar los movimientos");
  return records(data);
}

export async function closeCashRegister(
  client: CashRpcClientPort,
  cashRegisterId: string,
  declaredCash: number,
  note: string | null
): Promise<CashRecord> {
  const { data, error } = await client.rpc("cerrar_caja_v1", {
    p_caja_id: cashRegisterId,
    p_efectivo_declarado: declaredCash,
    p_nota: note
  });
  fail(error, "No se pudo cerrar la caja");
  return record(data);
}

export async function listCashHistory(
  client: CashRpcClientPort,
  branchId: string,
  limit = 12
): Promise<CashRecord[]> {
  const { data, error } = await client.rpc("listar_historial_cajas_v1", {
    p_sucursal_id: branchId,
    p_limit: limit
  });
  fail(error, "No se pudo cargar el historial");
  return records(data);
}

export async function createCashRegister(
  client: CashRpcClientPort,
  branchId: string,
  name: string
): Promise<CashRecord> {
  const { data, error } = await client.rpc("crear_caja_v1", {
    p_sucursal_id: branchId,
    p_nombre: name
  });
  fail(error, "No se pudo crear la caja");
  return record(data);
}

export async function setCashRegisterActive(
  client: CashRpcClientPort,
  cashRegisterId: string,
  active: boolean
): Promise<CashRecord> {
  const { data, error } = await client.rpc("cambiar_estado_caja_v1", {
    p_caja_id: cashRegisterId,
    p_activa: active
  });
  fail(error, "No se pudo cambiar el estado de la caja");
  return record(data);
}
