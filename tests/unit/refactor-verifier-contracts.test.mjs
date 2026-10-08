import test from "node:test";
import assert from "node:assert/strict";
import {
  assertExactlyOneSourceMatch,
  assertNoModularLegacyRuntime,
  assertSourceMatch
} from "../../scripts/refactor-verifier-contracts.mjs";

test("Phase 13 delegation contract rejects a missing callback", () => {
  assert.throws(
    () => assertSourceMatch(
      "registerOfflineSale: undefined",
      /offlineController\.registerSale\(/u,
      "offline callback missing"
    ),
    /offline callback missing/u
  );
});

test("Phase 13 owner contract rejects duplicate composition", () => {
  assert.throws(
    () => assertExactlyOneSourceMatch(
      "createDiagnosticsController({}); createDiagnosticsController({});",
      /createDiagnosticsController\(\{\}/u,
      "diagnostics owner must be unique"
    ),
    /found 2/u
  );
});

test("modular runtime contract rejects app.js returning to output", () => {
  assert.throws(
    () => assertNoModularLegacyRuntime(
      '<script src="app.js"></script>',
      ["app.js"],
      ""
    ),
    /references or contains app\.js/u
  );
});
