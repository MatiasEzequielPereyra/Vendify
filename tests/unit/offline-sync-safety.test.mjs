import test from "node:test";
import assert from "node:assert/strict";

import {
  VENDIFY_PRODUCTION_SUPABASE_REF,
  resolveOfflineSyncSafety
} from "../../dist-ts/offline/sync-safety.js";

const productionUrl = `https://${VENDIFY_PRODUCTION_SUPABASE_REF}.supabase.co`;

test("blocks offline sync to production by default", () => {
  assert.deepEqual(resolveOfflineSyncSafety(productionUrl, "?offlineEngine=v2312"), {
    productionBackend: true,
    explicitProductionOverride: false,
    allowed: false
  });
});

test("allows non-production staging backend", () => {
  assert.deepEqual(
    resolveOfflineSyncSafety("https://staging-example.supabase.co", "?offlineEngine=v2312"),
    {
      productionBackend: false,
      explicitProductionOverride: false,
      allowed: true
    }
  );
});

test("production override must be explicit", () => {
  assert.deepEqual(
    resolveOfflineSyncSafety(
      productionUrl,
      "?offlineEngine=v2312&allowProdOfflineSync=1"
    ),
    {
      productionBackend: true,
      explicitProductionOverride: true,
      allowed: true
    }
  );
});
