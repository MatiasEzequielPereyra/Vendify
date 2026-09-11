export type ContextRecord = Record<string, unknown>;
export interface ContextRpcClientPort { rpc(name: string, args?: Record<string, unknown>): Promise<{ readonly data: unknown; readonly error: { readonly message?: string } | null }>; }
function record(value: unknown): ContextRecord { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as ContextRecord : {}; }
function records(value: unknown): ContextRecord[] { return Array.isArray(value) ? value.map(record) : []; }
async function call(client: ContextRpcClientPort, name: string, args?: Record<string, unknown>): Promise<unknown> { const { data, error } = await client.rpc(name, args); if (error) throw new Error(error.message ?? "No se pudo cargar el contexto"); return data; }
export async function getAppContext(client: ContextRpcClientPort): Promise<ContextRecord> { return record(await call(client, "obtener_contexto_app")); }
export async function getCustomPermissions(client: ContextRpcClientPort): Promise<ContextRecord> { return record(await call(client, "obtener_permisos_personalizados_v1")); }
export async function getCurrentEmployeeProfile(client: ContextRpcClientPort): Promise<ContextRecord> { return record(await call(client, "obtener_perfil_empleado_actual")); }
export async function listAppBranches(client: ContextRpcClientPort): Promise<ContextRecord[]> { return records(await call(client, "listar_sucursales_app")); }
export async function getBranchContext(client: ContextRpcClientPort, branchId: string): Promise<ContextRecord> { return record(await call(client, "obtener_contexto_sucursal", { p_sucursal_id: branchId })); }
export async function runIntegrityDiagnostic(client: ContextRpcClientPort): Promise<ContextRecord> { return record(await call(client, "diagnostico_integridad_v1")); }
