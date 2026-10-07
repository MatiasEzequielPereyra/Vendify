import assert from "node:assert/strict";
import test from "node:test";
import { listBranchRealtimeStock } from "../../dist-ts/products/realtime-stock-service.js";

test("realtime stock service preserves the audited branch-scoped query", async () => {
  const calls = [];
  const client = {
    from(table) {
      calls.push(["from", table]);
      return {
        select(columns) {
          calls.push(["select", columns]);
          return {
            async eq(column, value) {
              calls.push(["eq", column, value]);
              return {
                data: [
                  { producto_id: "product-1", stock: 7, stock_minimo: 2 },
                  { producto_id: "product-2", stock: "3", stock_minimo: null }
                ],
                error: null
              };
            }
          };
        }
      };
    }
  };

  const rows = await listBranchRealtimeStock(client, "branch-1");

  assert.deepEqual(calls, [
    ["from", "producto_stock_sucursal"],
    ["select", "producto_id,stock,stock_minimo"],
    ["eq", "sucursal_id", "branch-1"]
  ]);
  assert.deepEqual(rows, [
    { productId: "product-1", stock: 7, minimumStock: 2 },
    { productId: "product-2", stock: 3, minimumStock: 0 }
  ]);
});

test("realtime stock service propagates backend errors without changing authority", async () => {
  const client = {
    from() {
      return {
        select() {
          return {
            async eq() {
              return { data: null, error: { message: "stock unavailable" } };
            }
          };
        }
      };
    }
  };

  await assert.rejects(
    () => listBranchRealtimeStock(client, "branch-1"),
    /stock unavailable/
  );
});
