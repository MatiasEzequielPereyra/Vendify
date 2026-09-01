export const OFFLINE_ENGINE_STORAGE_KEY = "vendify_offline_engine_v2312";
export const OFFLINE_ENGINE_QUERY_KEY = "offlineEngine";
export const OFFLINE_ENGINE_V2312 = "v2312";

export type OfflineEngineMode = "legacy" | "v2312";

export function resolveOfflineEngineMode(
  search: string,
  storedValue: string | null
): OfflineEngineMode {
  const params = new URLSearchParams(search);
  const queryValue = params.get(OFFLINE_ENGINE_QUERY_KEY)?.trim().toLowerCase();

  if (queryValue === OFFLINE_ENGINE_V2312) return "v2312";
  if (queryValue === "legacy") return "legacy";

  return storedValue?.trim().toLowerCase() === OFFLINE_ENGINE_V2312
    ? "v2312"
    : "legacy";
}

export function shouldEnableOfflineV2312(
  search: string,
  storedValue: string | null
): boolean {
  return resolveOfflineEngineMode(search, storedValue) === "v2312";
}
