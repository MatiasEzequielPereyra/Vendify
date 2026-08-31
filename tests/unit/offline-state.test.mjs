import test from "node:test";
import assert from "node:assert/strict";

import {
  assertOfflineSaleTransition,
  canTransitionOfflineSale
} from "../../dist-ts/offline/state-machine.js";

const validTransitions = [
  ["pending", "syncing"],
  ["syncing", "synced"],
  ["syncing", "failed_retryable"],
  ["syncing", "review"],
  ["failed_retryable", "syncing"],
  ["review", "syncing"]
];

for (const [from, to] of validTransitions) {
  test(`${from} -> ${to} is valid`, () => {
    assert.equal(canTransitionOfflineSale(from, to), true);
    assert.doesNotThrow(() => assertOfflineSaleTransition(from, to));
  });
}

test("synced cannot return to pending", () => {
  assert.equal(canTransitionOfflineSale("synced", "pending"), false);
  assert.throws(
    () => assertOfflineSaleTransition("synced", "pending"),
    /Invalid offline sale transition/
  );
});
