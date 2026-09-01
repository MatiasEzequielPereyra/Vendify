import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveOfflineEngineMode,
  shouldEnableOfflineV2312
} from "../../dist-ts/offline/feature-flag.js";

test("offline v2312 stays disabled by default", () => {
  assert.equal(resolveOfflineEngineMode("", null), "legacy");
  assert.equal(shouldEnableOfflineV2312("", null), false);
});

test("stored browser flag enables v2312", () => {
  assert.equal(resolveOfflineEngineMode("", "v2312"), "v2312");
  assert.equal(shouldEnableOfflineV2312("", "v2312"), true);
});

test("query flag enables v2312 for staging", () => {
  assert.equal(resolveOfflineEngineMode("?offlineEngine=v2312", null), "v2312");
});

test("query legacy override wins over stored v2312", () => {
  assert.equal(resolveOfflineEngineMode("?offlineEngine=legacy", "v2312"), "legacy");
});

test("unknown query values do not enable v2312", () => {
  assert.equal(resolveOfflineEngineMode("?offlineEngine=experimental", null), "legacy");
});
