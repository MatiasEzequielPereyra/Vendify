export interface DashboardErrorLike {
  message?: string;
}

export interface DashboardRpcResult {
  data: unknown;
  error: DashboardErrorLike | null;
}

export interface DashboardRpcClientPort {
  rpc(name: string, args?: Record<string, unknown>): Promise<DashboardRpcResult>;
}

function errorMessage(error: DashboardErrorLike | null, fallback: string): string {
  return error?.message ?? fallback;
}

export async function loadDashboard(
  authenticatedClient: DashboardRpcClientPort,
  branchId: string | null,
  days: number
): Promise<unknown> {
  const { data, error } = await authenticatedClient.rpc("dashboard_propietario_v1", {
    p_sucursal_id: branchId,
    p_dias: days
  });

  if (error) {
    throw new Error(errorMessage(error, "No se pudo cargar el Dashboard"));
  }

  return data;
}

export async function loadOperationalAlerts(
  authenticatedClient: DashboardRpcClientPort,
  branchId: string | null
): Promise<unknown> {
  const { data, error } = await authenticatedClient.rpc("alertas_operativas_v1", {
    p_sucursal_id: branchId
  });

  if (error) {
    throw new Error(errorMessage(error, "No se pudieron cargar las alertas operativas"));
  }

  return data;
}
