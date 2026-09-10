import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustInitialStock,
  confirmScannedStock,
  deleteAllProducts,
  deleteCategory,
  deleteProduct,
  importCatalog,
  importBulkCatalog,
  initializeCategories,
  listCategories,
  listProducts,
  listSmartStock,
  normalizeCsvHeader,
  parseCsvLine,
  saveCategory,
  saveProduct
} from "../../dist-ts/products/products-service.js";

function makeClient(responses) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      return responses[name] ?? { data: null, error: null };
    }
  };
}

test("product and category reads preserve current RPC contracts", async () => {
  const client = makeClient({
    listar_productos_sucursal_seguro_v1: { data: [{ id: "product-1" }], error: null },
    listar_categorias_seguras_v1: { data: [{ nombre: "Bebidas" }], error: null },
    obtener_stock_inteligente_sucursal: { data: [{ producto_id: "product-1" }], error: null }
  });
  assert.equal((await listProducts(client, "branch-1"))[0].id, "product-1");
  assert.equal((await listCategories(client))[0].nombre, "Bebidas");
  assert.equal((await listSmartStock(client, "branch-1"))[0].producto_id, "product-1");
  assert.deepEqual(client.calls, [
    { name: "listar_productos_sucursal_seguro_v1", args: { p_sucursal_id: "branch-1" } },
    { name: "listar_categorias_seguras_v1", args: undefined },
    { name: "obtener_stock_inteligente_sucursal", args: { p_sucursal_id: "branch-1" } }
  ]);
});

test("save product preserves every backend parameter", async () => {
  const client = makeClient({
    guardar_producto_seguro_v2: { data: { ok: true, producto: { id: "product-1" } }, error: null }
  });
  await saveProduct(client, {
    productId: null,
    branchId: "branch-1",
    name: "Coca Cola",
    brand: "Coca Cola",
    presentation: "500 ml",
    barcode: "779000000001",
    category: "Bebidas",
    purchasePrice: 800,
    salePrice: 1200,
    stock: 5
  });
  assert.deepEqual(client.calls[0], {
    name: "guardar_producto_seguro_v2",
    args: {
      p_producto_id: null,
      p_sucursal_id: "branch-1",
      p_nombre: "Coca Cola",
      p_marca: "Coca Cola",
      p_presentacion: "500 ml",
      p_codigo_barras: "779000000001",
      p_categoria: "Bebidas",
      p_precio_compra: 800,
      p_precio_venta: 1200,
      p_stock: 5
    }
  });
});

test("category mutations and initialization preserve contracts", async () => {
  const client = makeClient({
    inicializar_categorias_seguras_v1: { data: [{ nombre: "Bebidas" }], error: null },
    guardar_categoria_segura_v1: { data: { ok: true }, error: null },
    eliminar_categoria_segura_v1: { data: { ok: true }, error: null }
  });
  await initializeCategories(client, ["Bebidas"]);
  await saveCategory(client, "Snacks");
  await deleteCategory(client, "Snacks");
  assert.deepEqual(client.calls, [
    { name: "inicializar_categorias_seguras_v1", args: { p_nombres: ["Bebidas"] } },
    { name: "guardar_categoria_segura_v1", args: { p_nombre: "Snacks" } },
    { name: "eliminar_categoria_segura_v1", args: { p_nombre: "Snacks" } }
  ]);
});

test("delete and quick-stock mutations preserve contracts", async () => {
  const client = makeClient({
    eliminar_producto_seguro_v1: { data: { ok: true }, error: null },
    eliminar_todos_productos_seguro_v1: { data: { ok: true }, error: null },
    ajustar_stock_inicial_rapido_v2: { data: { stock: 4 }, error: null },
    confirmar_stock_por_scanner_v2: { data: { stock: 5 }, error: null }
  });
  await deleteProduct(client, "product-1");
  await deleteAllProducts(client);
  await adjustInitialStock(client, "product-1", "branch-1", -4);
  await confirmScannedStock(client, "product-1", "branch-1", 5);
  assert.deepEqual(client.calls, [
    { name: "eliminar_producto_seguro_v1", args: { p_producto_id: "product-1" } },
    { name: "eliminar_todos_productos_seguro_v1", args: undefined },
    {
      name: "ajustar_stock_inicial_rapido_v2",
      args: { p_producto_id: "product-1", p_sucursal_id: "branch-1", p_delta: -1 }
    },
    {
      name: "confirmar_stock_por_scanner_v2",
      args: { p_producto_id: "product-1", p_sucursal_id: "branch-1", p_stock_minimo_necesario: 5 }
    }
  ]);
});

test("catalog import maps only the supported payload", async () => {
  const client = makeClient({ importar_productos_seguro_v1: { data: { ok: true, importados: 1 }, error: null } });
  await importCatalog(client, "branch-1", [{
    nombre: "Producto",
    marca: "Marca",
    presentacion: "Unidad",
    categoria: "Otros"
  }]);
  assert.deepEqual(client.calls[0], {
    name: "importar_productos_seguro_v1",
    args: {
      p_sucursal_id: "branch-1",
      p_items: [{ nombre: "Producto", marca: "Marca", presentacion: "Unidad", categoria: "Otros" }]
    }
  });
});

test("product services preserve backend business messages", async () => {
  const client = makeClient({
    guardar_producto_seguro_v2: { data: null, error: { message: "Código duplicado" } }
  });
  await assert.rejects(
    () => saveProduct(client, {
      productId: null,
      branchId: "branch-1",
      name: "Producto",
      brand: null,
      presentation: null,
      barcode: null,
      category: null,
      purchasePrice: 0,
      salePrice: 0,
      stock: 0
    }),
    /Código duplicado/
  );
});


test("bulk CSV import preserves prices, stock and backend contract", async () => {
  const client = makeClient({ importar_productos_masivo_v1: { data: { ok: true, importados: 1 }, error: null } });
  await importBulkCatalog(client, "branch-1", [{
    nombre: "Producto", marca: "Marca", presentacion: "Unidad", categoria: "Otros",
    codigo_barras: "7790000000000", precio_compra: 10, precio_venta: 20, stock: 3
  }]);
  assert.deepEqual(client.calls[0], {
    name: "importar_productos_masivo_v1",
    args: { p_sucursal_id: "branch-1", p_items: [{
      nombre: "Producto", marca: "Marca", presentacion: "Unidad", categoria: "Otros",
      codigo_barras: "7790000000000", precio_compra: 10, precio_venta: 20, stock: 3
    }] }
  });
});

test("CSV helpers preserve quoted cells and normalized headers", () => {
  assert.deepEqual(parseCsvLine('"Coca, Cola","500 ml","""promo"""'), ["Coca, Cola", "500 ml", '"promo"']);
  assert.equal(normalizeCsvHeader(" Precio de Venta "), "precio_de_venta");
});
