import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardNavigationCoordinator } from "../../dist-ts/dashboard/dashboard-navigation.js";

test("dashboard navigation restores only the destination that owns the active origin", () => {
  let restores = 0;
  const navigation = createDashboardNavigationCoordinator(() => { restores += 1; });
  navigation.begin({ kind: "inventory", filter: "out" });
  navigation.complete("sales");
  assert.equal(restores, 0);
  navigation.complete("inventory");
  assert.equal(restores, 1);
  navigation.complete("inventory");
  assert.equal(restores, 1);
});

test("dashboard navigation cancellation prevents a later unrelated close from restoring", () => {
  let restores = 0;
  const navigation = createDashboardNavigationCoordinator(() => { restores += 1; });
  navigation.begin({ kind: "product", productId: "product-1" });
  navigation.cancel();
  navigation.complete("product");
  assert.equal(restores, 0);
});
