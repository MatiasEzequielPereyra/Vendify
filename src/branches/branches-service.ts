import type { CashErrorLike, CashRpcClientPort } from "../cash/cash-service.js";

export type BranchRecord = Record<string, unknown>;

export interface SaveBranchInput {
  readonly name: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly active: boolean;
}

function asRecord(value: unknown): BranchRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as BranchRecord
    : {};
}

function asRecords(value: unknown): BranchRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const branch = asRecord(item);
    return Object.keys(branch).length ? [branch] : [];
  });
}

function fail(error: CashErrorLike | null, fallback: string): void {
  if (error) throw new Error(error.message ?? fallback);
}

export async function listAdminBranches(client: CashRpcClientPort): Promise<BranchRecord[]> {
  const { data, error } = await client.rpc("listar_sucursales_admin_v1");
  fail(error, "No se pudieron cargar las sucursales");
  return asRecords(data);
}

export async function createBranch(
  client: CashRpcClientPort,
  input: Omit<SaveBranchInput, "active">
): Promise<BranchRecord> {
  const { data, error } = await client.rpc("crear_sucursal_v1", {
    p_nombre: input.name,
    p_direccion: input.address,
    p_telefono: input.phone
  });
  fail(error, "No se pudo crear la sucursal");
  return asRecord(data);
}

export async function updateBranch(
  client: CashRpcClientPort,
  branchId: string,
  input: SaveBranchInput
): Promise<BranchRecord> {
  const { data, error } = await client.rpc("actualizar_sucursal_v1", {
    p_sucursal_id: branchId,
    p_nombre: input.name,
    p_direccion: input.address,
    p_telefono: input.phone,
    p_activa: input.active
  });
  fail(error, "No se pudo actualizar la sucursal");
  return asRecord(data);
}
