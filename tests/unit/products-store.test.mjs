import assert from "node:assert/strict";
import test from "node:test";
import { createProductsStore } from "../../dist-ts/products/products-store.js";

const product = (id, barcode = id) => ({
  id, nombre: `Producto ${id}`, marca: "Marca", presentacion: "Unidad",
  codigoBarras: barcode, categoria: "Otros", precioCompra: 10, precioVenta: 20,
  stock: 5, stockMinimo: 2, foto: null, creado: null
});

test("products store indexes immutable catalog reads", () => {
  const store = createProductsStore();
  const token = store.beginLoad({ businessId: "business-1", branchId: "branch-1" });
  assert.equal(store.replaceProducts([product("a", " 779 "), product("b")], token), true);
  store.markReady();
  assert.equal(store.getById("a")?.nombre, "Producto a");
  assert.equal(store.findByBarcode("779")?.id, "a");
  const read = store.getById("a");
  read.stock = 0;
  assert.equal(store.getById("a")?.stock, 5);
});

test("products store rejects stale branch loads", () => {
  const store = createProductsStore();
  const stale = store.beginLoad({ businessId: "business-1", branchId: "branch-1" });
  const current = store.beginLoad({ businessId: "business-1", branchId: "branch-2" });
  assert.equal(store.replaceProducts([product("stale")], stale), false);
  assert.equal(store.replaceProducts([product("current")], current), true);
  assert.deepEqual(store.list().map((item) => item.id), ["current"]);
});

test("products store owns stock, category and realtime mutations", () => {
  const store = createProductsStore();
  store.restoreProducts({ businessId: "business-1", branchId: "branch-1" }, [product("a")]);
  store.patchStock("a", 3, 1);
  store.updateCategory("Otros", "General");
  store.upsert({ ...product("a"), nombre: "Actualizado", stock: 3, categoria: "General" });
  assert.deepEqual(store.getById("a"), { ...product("a"), nombre: "Actualizado", stock: 3, categoria: "General" });
  store.remove("a");
  assert.equal(store.list().length, 0);
});

test("products store notifies coherently and clears tenant scope", () => {
  const store = createProductsStore();
  const revisions = [];
  const unsubscribe = store.subscribe((snapshot) => revisions.push(snapshot.revision));
  store.restoreProducts({ businessId: "business-1", branchId: "branch-1" }, [product("a")]);
  store.replaceCategories(["Otros", "Otros", " Bebidas "]);
  unsubscribe();
  store.clear();
  assert.equal(revisions.length, 2);
  assert.deepEqual(store.listCategories(), []);
  assert.equal(store.getSnapshot().scope, null);
});

test("products store rejects duplicate non-empty barcodes", () => {
  const store = createProductsStore();
  const token = store.beginLoad({ businessId: "business-1", branchId: "branch-1" });
  assert.throws(() => store.replaceProducts([product("a", "779"), product("b", "779")], token), /Duplicate/);
});
