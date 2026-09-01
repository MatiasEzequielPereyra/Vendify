export interface TeamErrorLike {
  message?: string;
}

export interface TeamRpcResult {
  data: unknown;
  error: TeamErrorLike | null;
}

export interface TeamRpcClientPort {
  rpc(name: string, args?: Record<string, unknown>): Promise<TeamRpcResult>;
}

export interface TeamMemberRecord {
  membership_id: string;
  rol: string;
  [key: string]: unknown;
}

export interface TeamListResult {
  members: TeamMemberRecord[];
  stockPermissionWarning: TeamErrorLike | null;
}

export interface TeamActionResult {
  ok: boolean;
  errorMessage: string | null;
  data?: unknown;
}

const STOCK_MANAGEMENT_DEFAULT_ROLES = new Set(["owner", "admin", "manager"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTeamMembers(value: unknown): TeamMemberRecord[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is TeamMemberRecord => {
    if (!isRecord(item)) return false;
    return typeof item.membership_id === "string" && typeof item.rol === "string";
  });
}

function stockPermissionMap(value: unknown): Map<string, boolean> {
  const map = new Map<string, boolean>();
  if (!Array.isArray(value)) return map;

  for (const item of value) {
    if (!isRecord(item) || typeof item.membership_id !== "string") continue;
    map.set(item.membership_id, item.puede_gestionar_stock === true);
  }

  return map;
}

function errorMessage(error: TeamErrorLike | null | undefined, fallback: string): string {
  if (error?.message) return error.message;
  return fallback;
}

export async function getAdminBusiness(authenticatedClient: TeamRpcClientPort): Promise<unknown> {
  const { data, error } = await authenticatedClient.rpc("obtener_negocio_admin_actual");
  if (error) throw new Error(errorMessage(error, "No se pudo cargar el negocio"));
  return data;
}

export async function listTeam(authenticatedClient: TeamRpcClientPort): Promise<TeamListResult> {
  const [teamResult, permissionResult] = await Promise.all([
    authenticatedClient.rpc("listar_equipo_v3"),
    authenticatedClient.rpc("listar_permisos_stock_equipo_v1")
  ]);

  if (teamResult.error) {
    throw new Error(errorMessage(teamResult.error, "No se pudo cargar el equipo"));
  }

  const permissions = stockPermissionMap(permissionResult.data);
  const members = toTeamMembers(teamResult.data).map((member) => ({
    ...member,
    puede_gestionar_stock: permissions.has(member.membership_id)
      ? permissions.get(member.membership_id)
      : STOCK_MANAGEMENT_DEFAULT_ROLES.has(member.rol)
  }));

  return {
    members,
    stockPermissionWarning: permissionResult.error
  };
}

export async function updateStockPermission(
  authenticatedClient: TeamRpcClientPort,
  membershipId: string,
  allow: boolean
): Promise<TeamActionResult> {
  const { data, error } = await authenticatedClient.rpc(
    "actualizar_permiso_stock_miembro_v1",
    {
      p_membership_id: membershipId,
      p_permitir: allow === true
    }
  );

  const response = isRecord(data) ? data : null;
  if (error || response?.ok === false) {
    const responseMessage = typeof response?.message === "string" ? response.message : null;
    return {
      ok: false,
      errorMessage:
        error?.message ?? responseMessage ?? "No se pudo actualizar el permiso de stock"
    };
  }

  return { ok: true, errorMessage: null, data };
}

export async function updateMemberRole(
  authenticatedClient: TeamRpcClientPort,
  membershipId: string,
  role: string
): Promise<TeamActionResult> {
  const { data, error } = await authenticatedClient.rpc("actualizar_rol_miembro_v2", {
    p_membership_id: membershipId,
    p_rol: role
  });

  return error
    ? { ok: false, errorMessage: errorMessage(error, "No se pudo actualizar el rol") }
    : { ok: true, errorMessage: null, data };
}

export async function setMemberActive(
  authenticatedClient: TeamRpcClientPort,
  membershipId: string,
  active: boolean
): Promise<TeamActionResult> {
  const { data, error } = await authenticatedClient.rpc("cambiar_estado_miembro_v3", {
    p_membership_id: membershipId,
    p_activo: active === true
  });

  return error
    ? { ok: false, errorMessage: errorMessage(error, "No se pudo actualizar el usuario") }
    : { ok: true, errorMessage: null, data };
}
