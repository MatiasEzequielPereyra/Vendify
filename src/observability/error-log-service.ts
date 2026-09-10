export interface ErrorLogRpcClient {
  rpc(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface ClientErrorLogInput {
  readonly type: string;
  readonly message: unknown;
  readonly version: string;
  readonly context: Record<string, unknown>;
}

export function sanitizeClientErrorMessage(message: unknown): string {
  const raw = typeof message === "string"
    ? message
    : message instanceof Error
      ? message.message
      : "Error";

  return raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 1000);
}

export async function logClientError(
  client: ErrorLogRpcClient,
  input: ClientErrorLogInput
): Promise<void> {
  await client.rpc("registrar_error_cliente_v1", {
    p_tipo: (input.type.length ? input.type : "client").slice(0, 50),
    p_mensaje: sanitizeClientErrorMessage(input.message),
    p_version: input.version,
    p_contexto: input.context
  });
}
