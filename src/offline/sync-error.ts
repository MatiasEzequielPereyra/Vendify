export type OfflineSyncErrorKind = "retryable" | "review";

export interface OfflineSyncErrorClassification {
  readonly kind: OfflineSyncErrorKind;
  readonly message: string;
  readonly code?: string;
  readonly status?: number;
}

interface ErrorLike {
  readonly message?: unknown;
  readonly code?: unknown;
  readonly status?: unknown;
  readonly statusCode?: unknown;
  readonly name?: unknown;
}

const RETRYABLE_SQL_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "PGRST000",
  "PGRST001",
  "PGRST002"
]);

const NETWORK_PHRASES = [
  "failed to fetch",
  "network",
  "load failed",
  "internet",
  "connection reset",
  "connection refused",
  "connection closed",
  "timeout",
  "timed out",
  "fetch failed",
  "socket"
] as const;

function asErrorLike(error: unknown): ErrorLike {
  if (typeof error === "object" && error !== null) {
    return error as ErrorLike;
  }
  return {};
}

function readMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  const record = asErrorLike(error);
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "La venta offline necesita revisión.";
}

function readCode(error: unknown): string | undefined {
  const code = asErrorLike(error).code;
  if (typeof code === "string" && code.trim()) return code.trim();
  if (typeof code === "number" && Number.isFinite(code)) return String(code);
  return undefined;
}

function readStatus(error: unknown): number | undefined {
  const record = asErrorLike(error);
  const candidate = record.status ?? record.statusCode;

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }

  if (typeof candidate === "string" && candidate.trim()) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
}

function isRetryableHttpStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isNetworkLike(error: unknown, message: string): boolean {
  const record = asErrorLike(error);
  const name = typeof record.name === "string" ? record.name.toLowerCase() : "";
  if (name === "aborterror" || name === "timeouterror") return true;

  const normalized = message.toLowerCase();
  return NETWORK_PHRASES.some((phrase) => normalized.includes(phrase));
}

export function classifyOfflineSyncError(
  error: unknown
): OfflineSyncErrorClassification {
  const message = readMessage(error);
  const code = readCode(error);
  const status = readStatus(error);

  const retryable =
    isNetworkLike(error, message) ||
    isRetryableHttpStatus(status) ||
    (code !== undefined && RETRYABLE_SQL_CODES.has(code.toUpperCase()));

  return {
    kind: retryable ? "retryable" : "review",
    message,
    ...(code === undefined ? {} : { code }),
    ...(status === undefined ? {} : { status })
  };
}
