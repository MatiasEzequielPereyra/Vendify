import type { TeamActionResult, TeamErrorLike } from "./team-service.js";

export interface TeamFunctionResult {
  data: unknown;
  error: TeamErrorLike | null;
}

export interface TeamFunctionsClientPort {
  invoke(
    name: string,
    options: { body: Record<string, unknown> }
  ): Promise<TeamFunctionResult>;
}

export interface CreateEmployeeInput {
  nombre: string;
  username: string;
  rol: string;
  password: string;
}

export interface UpdateEmployeeInput {
  membershipId: string;
  nombre: string;
  username: string;
  rol: string;
}

function dataErrorMessage(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const value = (data as Record<string, unknown>).error;
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function invokeTeamFunction(
  functions: TeamFunctionsClientPort,
  name: string,
  body: Record<string, unknown>,
  fallback: string
): Promise<TeamActionResult> {
  const { data, error } = await functions.invoke(name, { body });
  const backendMessage = dataErrorMessage(data);

  if (error || backendMessage) {
    return {
      ok: false,
      errorMessage: backendMessage ?? error?.message ?? fallback,
      data
    };
  }

  return { ok: true, errorMessage: null, data };
}

export async function createEmployee(
  functions: TeamFunctionsClientPort,
  input: CreateEmployeeInput
): Promise<TeamActionResult> {
  return invokeTeamFunction(
    functions,
    "crear-empleado",
    {
      nombre: input.nombre,
      username: input.username,
      rol: input.rol,
      password: input.password
    },
    "No se pudo crear el empleado"
  );
}

export async function updateEmployee(
  functions: TeamFunctionsClientPort,
  input: UpdateEmployeeInput
): Promise<TeamActionResult> {
  return invokeTeamFunction(
    functions,
    "gestionar-empleado",
    {
      action: "update",
      membership_id: input.membershipId,
      nombre: input.nombre,
      username: input.username,
      rol: input.rol
    },
    "No se pudo actualizar"
  );
}

export async function deleteEmployee(
  functions: TeamFunctionsClientPort,
  membershipId: string
): Promise<TeamActionResult> {
  return invokeTeamFunction(
    functions,
    "gestionar-empleado",
    {
      action: "delete",
      membership_id: membershipId
    },
    "No se pudo eliminar el usuario"
  );
}

export async function resetEmployeePassword(
  functions: TeamFunctionsClientPort,
  membershipId: string,
  password: string
): Promise<TeamActionResult> {
  return invokeTeamFunction(
    functions,
    "gestionar-empleado",
    {
      action: "reset_password",
      membership_id: membershipId,
      password
    },
    "No se pudo reiniciar la contraseña"
  );
}
