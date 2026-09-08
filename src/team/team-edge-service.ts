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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataErrorMessage(data: unknown): string | null {
  if (!isRecord(data)) return null;

  for (const key of ["error", "message"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }

  return null;
}

interface ResponseContextLike {
  clone(): { json(): Promise<unknown> };
}

function isResponseContext(value: unknown): value is ResponseContextLike {
  return isRecord(value) && typeof value.clone === "function";
}

async function errorContextMessage(error: TeamErrorLike | null): Promise<string | null> {
  if (!isResponseContext(error?.context)) return null;

  try {
    return dataErrorMessage(await error.context.clone().json());
  } catch {
    return null;
  }
}

async function invokeTeamFunction(
  functions: TeamFunctionsClientPort,
  name: string,
  body: Record<string, unknown>,
  fallback: string
): Promise<TeamActionResult> {
  const { data, error } = await functions.invoke(name, { body });
  const backendMessage = dataErrorMessage(data);
  const contextMessage = await errorContextMessage(error);

  if (error || backendMessage) {
    return {
      ok: false,
      errorMessage: backendMessage ?? contextMessage ?? error?.message ?? fallback,
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
