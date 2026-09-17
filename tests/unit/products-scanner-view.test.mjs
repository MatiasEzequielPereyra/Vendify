import assert from "node:assert/strict";
import test from "node:test";
import { createProductsStore } from "../../dist-ts/products/products-store.js";
import { resolveScannedProduct } from "../../dist-ts/products/scanner-controller.js";
import { renderSaleProductsHtml } from "../../dist-ts/products/sale-products-view.js";

const product = (id, barcode, overrides = {}) => ({
  id, nombre: `Producto ${id}`, marca: "Marca", presentacion: "Unidad",
  codigoBarras: barcode, categoria: "Otros", precioCompra: 10, precioVenta: 20,
  stock: 5, stockMinimo: 2, foto: null, creado: null, ...overrides
});

function catalog() {
  const store = createProductsStore();
  store.restoreProducts(
    { businessId: "business-1", branchId: "branch-1" },
    [product("a", "779123"), product("b", "779999", { nombre: "<Bebida>", stock: 1 })]
  );
  return store;
}

test("scanner resolves missing, current and existing products from the typed store", () => {
  const store = catalog();
  assert.equal(resolveScannedProduct(store, "000", null).kind, "missing");
  assert.equal(resolveScannedProduct(store, "779123", "a").kind, "current");
  assert.equal(resolveScannedProduct(store, "EAN 779123", null).product?.id, "a");
});

test("sale product view filters, subtracts cart reservations and escapes catalog data", () => {
  const html = renderSaleProductsHtml({
    store: catalog(),
    query: "bebida",
    cart: [{ id: "b", cantidad: 1 }],
    formatCurrency: (value) => `$${value}`
  });
  assert.match(html, /sin-stock/);
  assert.match(html, /&lt;Bebida&gt;/);
  assert.match(html, /quedan 0/);
  assert.doesNotMatch(html, /Producto a/);
});

test("sale product view renders an explicit empty result", () => {
  assert.equal(renderSaleProductsHtml({
    store: catalog(), query: "inexistente", cart: [], formatCurrency: String
  }), '<p class="carrito-vacio">Sin resultados</p>');
});
