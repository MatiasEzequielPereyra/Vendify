import assert from "node:assert/strict";
import test from "node:test";
import {
  migrateLegacyProductCache,
  parseProductCatalogCache,
  serializeProductCatalogCache
} from "../../dist-ts/products/products-offline-cache.js";

const scope = { businessId: "business-1", branchId: "branch-1" };
const product = {
  id: "product-1", nombre: "Producto", marca: "", presentacion: "", codigoBarras: "779",
  categoria: "Otros", precioCompra: 10, precioVenta: 20, stock: 3, stockMinimo: 1,
  foto: null, creado: null
};

test("catalog cache round-trips only inside its tenant and branch scope", () => {
  const raw = serializeProductCatalogCache(scope, [product], ["Otros"], "2026-09-16T12:00:00Z");
  assert.equal(parseProductCatalogCache(raw, scope)?.products[0]?.id, "product-1");
  assert.equal(parseProductCatalogCache(raw, { ...scope, branchId: "branch-2" }), null);
});

test("catalog cache rejects corrupt or invalid products", () => {
  assert.equal(parseProductCatalogCache("not-json", scope), null);
  assert.equal(parseProductCatalogCache(JSON.stringify({
    version: 1, savedAt: "2026-09-16T12:00:00Z", scope, products: [{ id: "" }]
  }), scope), null);
});

test("legacy split cache migrates into one validated snapshot", () => {
  const migrated = migrateLegacyProductCache(
    JSON.stringify({ savedAt: "2026-09-16T12:00:00Z", productos: [product] }),
    JSON.stringify({ categorias: ["Otros", "Otros"] }),
    scope
  );
  assert.equal(migrated?.products[0]?.id, "product-1");
  assert.deepEqual(migrated?.categories, ["Otros"]);
});
