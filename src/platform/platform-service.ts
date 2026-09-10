export type PlatformRecord = Record<string, unknown>;

export interface PlatformErrorLike { readonly message?: string; }
export interface PlatformRpcClientPort {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ readonly data: unknown; readonly error: PlatformErrorLike | null; }>;
}
function record(value: unknown): PlatformRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as PlatformRecord : {};
}
function records(value: unknown): PlatformRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : [];
}
function fail(error: PlatformErrorLike | null, fallback: string): void {
  if (error) throw new Error(error.message ?? fallback);
}
export async function isPlatformAdmin(client: PlatformRpcClientPort): Promise<boolean> {
  const { data, error } = await client.rpc("es_admin_plataforma_v1");
  fail(error, "No se pudo verificar el acceso de plataforma");
  return data === true;
}
export async function loadPlatformBackoffice(client: PlatformRpcClientPort): Promise<{ readonly overview: PlatformRecord; readonly businesses: PlatformRecord[]; readonly errors: PlatformRecord[]; }> {
  const [overview, businesses, errors] = await Promise.all([
    client.rpc("platform_overview_v1"),
    client.rpc("listar_negocios_plataforma_v1", { p_limit: 50 }),
    client.rpc("listar_errores_plataforma_v1", { p_limit: 30 })
  ]);
  fail(overview.error, "No se pudo cargar el backoffice");
  fail(businesses.error, "No se pudo cargar los negocios");
  fail(errors.error, "No se pudieron cargar los errores");
  return { overview: record(overview.data), businesses: records(businesses.data), errors: records(errors.data) };
}
export async function updateBusinessPlan(client: PlatformRpcClientPort, businessId: string, planCode: string, status: string): Promise<PlatformRecord> {
  const { data, error } = await client.rpc("actualizar_plan_negocio_plataforma_v1", { p_negocio_id: businessId, p_plan_codigo: planCode, p_estado: status });
  fail(error, "No se pudo actualizar el plan");
  const result = record(data);
  if (result.ok === false) throw new Error(typeof result.message === "string" ? result.message : "No se pudo actualizar el plan");
  return result;
}
