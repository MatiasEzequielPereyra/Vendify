import assert from "node:assert/strict";
import test from "node:test";
import { createProductCatalogLifecycle } from "../../dist-ts/products/product-catalog-lifecycle.js";
import { createProductsStore } from "../../dist-ts/products/products-store.js";

const scope = { businessId: "business-1", branchId: "branch-1" };
const productRow = {
  id: "product-1",
  nombre: "Producto",
  marca: "Marca",
  presentacion: "Unidad",
  codigo_barras: "779",
  categoria: "Otros",
  precio_compra: 10,
  precio_venta: 20,
  stock: 5,
  stock_minimo: 2
};

function lifecycle(options = {}) {
  const store = createProductsStore();
  const calls = [];
  const effects = [];
  const responses = options.responses ?? {
    listar_productos_sucursal_seguro_v1: { data: [productRow], error: null },
    obtener_stock_inteligente_sucursal: {
      data: [{ producto_id: "product-1", estado: "normal", vendidos_7d: 2 }],
      error: null
    },
    listar_categorias_seguras_v1: { data: [{ nombre: "Otros" }], error: null }
  };
  const module = createProductCatalogLifecycle({
    client: {
      async rpc(name, args) {
        calls.push({ name, args });
        return responses[name] ?? { data: null, error: { message: `Unexpected ${name}` } };
      }
    },
    store,
    isOnline: () => options.online ?? true,
    restoreOfflineCatalog: () => {
      effects.push("restore");
      if (!options.restoreOffline) return false;
      store.restoreProducts(scope, [{
        id: "cached", nombre: "Cached", marca: "", presentacion: "", codigoBarras: "",
        categoria: "Otros", precioCompra: 1, precioVenta: 2, stock: 1, stockMinimo: 1,
        foto: null, creado: null
      }]);
      return true;
    },
    saveOfflineCatalog: () => { effects.push("save"); },
    captureOfflineStockSnapshot: async (products) => {
      effects.push(`snapshot:${products.length}`);
    },
    refreshOnboarding: () => { effects.push("onboarding"); }
  });
  return { module, store, calls, effects };
}

test("catalog lifecycle loads, publishes, persists and enriches one branch coherently", async () => {
  const fixture = lifecycle();
  const result = await fixture.module.loadBranch(scope);

  assert.deepEqual(result, { kind: "ready", productCount: 1, smartStockWarning: null });
  assert.equal(fixture.store.getSnapshot().status, "ready");
  assert.equal(fixture.store.getById("product-1")?.codigoBarras, "779");
  assert.equal(fixture.store.getSmartStock("product-1")?.vendidos7d, 2);
  assert.deepEqual(fixture.effects, ["snapshot:1", "save", "onboarding"]);
  assert.deepEqual(fixture.calls.map((call) => call.name), [
    "listar_productos_sucursal_seguro_v1",
    "obtener_stock_inteligente_sucursal"
  ]);
});

test("catalog lifecycle restores a scoped offline snapshot after a network failure", async () => {
  const fixture = lifecycle({
    online: false,
    restoreOffline: true,
    responses: {
      listar_productos_sucursal_seguro_v1: { data: null, error: { message: "network" } }
    }
  });
  const result = await fixture.module.loadBranch(scope);

  assert.deepEqual(result, { kind: "offline" });
  assert.equal(fixture.store.getSnapshot().status, "offline");
  assert.equal(fixture.store.getById("cached")?.nombre, "Cached");
  assert.deepEqual(fixture.effects, ["restore"]);
});

test("catalog lifecycle initializes defaults and persists the resulting categories", async () => {
  const fixture = lifecycle({
    responses: {
      listar_categorias_seguras_v1: { data: [], error: null },
      inicializar_categorias_seguras_v1: { data: [{ nombre: "Bebidas" }, { nombre: "Otros" }], error: null }
    }
  });
  const result = await fixture.module.loadCategories();

  assert.deepEqual(result, { kind: "ready" });
  assert.deepEqual(fixture.store.listCategories(), ["Bebidas", "Otros"]);
  assert.deepEqual(fixture.effects, ["save"]);
});

test("smart-stock failure remains a warning without discarding the loaded catalog", async () => {
  const fixture = lifecycle({
    responses: {
      listar_productos_sucursal_seguro_v1: { data: [productRow], error: null },
      obtener_stock_inteligente_sucursal: { data: null, error: { message: "unavailable" } }
    }
  });
  const result = await fixture.module.loadBranch(scope);

  assert.equal(result.kind, "ready");
  assert.equal(result.smartStockWarning?.message, "unavailable");
  assert.equal(fixture.store.getById("product-1")?.nombre, "Producto");
});
