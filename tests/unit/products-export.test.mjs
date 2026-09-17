import assert from "node:assert/strict";
import test from "node:test";
import { buildProductsCsv } from "../../dist-ts/products/products-export.js";

test("product CSV escapes text and preserves stock values", () => {
  const csv = buildProductsCsv([{
    id: "p1", nombre: 'Galletitas "Promo"', marca: "", presentacion: "",
    codigoBarras: "", categoria: "Almacén, varios", precioCompra: 10,
    precioVenta: 20, stock: 3, stockMinimo: 1, foto: null, creado: null
  }]);
  assert.match(csv, /"Galletitas ""Promo"""/);
  assert.match(csv, /"Almacén, varios"/);
  assert.match(csv, /,"3","1"$/);
});
