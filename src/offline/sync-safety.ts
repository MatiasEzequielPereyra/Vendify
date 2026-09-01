export const VENDIFY_PRODUCTION_SUPABASE_REF = "puhkmblnptntorwptvld";
export const ALLOW_PRODUCTION_OFFLINE_SYNC_QUERY = "allowProdOfflineSync";

export interface OfflineSyncSafetyDecision {
  readonly productionBackend: boolean;
  readonly explicitProductionOverride: boolean;
  readonly allowed: boolean;
}

export function resolveOfflineSyncSafety(
  supabaseUrl: string,
  queryString: string
): OfflineSyncSafetyDecision {
  const productionBackend = supabaseUrl.includes(VENDIFY_PRODUCTION_SUPABASE_REF);
  const params = new URLSearchParams(queryString);
  const explicitProductionOverride =
    params.get(ALLOW_PRODUCTION_OFFLINE_SYNC_QUERY) === "1";

  return {
    productionBackend,
    explicitProductionOverride,
    allowed: !productionBackend || explicitProductionOverride
  };
}
