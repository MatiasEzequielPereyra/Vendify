import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mapProductRow } from "../../dist-ts/products/product-model.js";

const app = readFileSync("app.js", "utf8");
const controller = readFileSync("src/products/products-controller.ts", "utf8");
const service = readFileSync("src/products/products-service.ts", "utf8");
const html = readFileSync("html/03-product-stock-modals.html", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260831000100_permisos_stock_empleados.sql",
  "utf8"
);

const row = (foto) => ({
  id: "product-1",
  nombre: "Producto",
  marca: "Marca",
  presentacion: "Unidad",
  codigo_barras: "779000000001",
  categoria: "Otros",
  precio_compra: 10,
  precio_venta: 20,
  stock: 5,
  stock_minimo: 2,
  foto,
  creado: null
});

test("existing product photo remains mapped", () => {
  const photo = "data:image/png;base64,existing-photo";
  assert.equal(mapProductRow(row(photo)).foto, photo);
});

test("missing product photo falls back to null", () => {
  assert.equal(mapProductRow(row(null)).foto, null);
  assert.equal(mapProductRow(row("")).foto, null);
});

test("existing photo renderer and no-photo fallback remain in typed Products owner", () => {
  assert.match(controller, /product\.foto/);
  assert.match(controller, /producto-v223-img/);
  assert.match(controller, /producto-v223-icon/);
});

test("Product Editor no longer depends on photo state", () => {
  assert.doesNotMatch(controller, /setCurrentPhoto/);
  assert.doesNotMatch(controller, /foto-input|foto-camara|modal-crop-foto/);
  assert.match(controller, /function openEditor\(/);
  assert.match(controller, /function closeEditor\(/);
});

test("legacy Product photo crop ownership is absent from app.js", () => {
  for (const marker of [
    "fotoActualBase64",
    "cropImage",
    "cropScale",
    "cropBaseScale",
    "cropOffsetX",
    "cropOffsetY",
    "cropDragging",
    "cropLastX",
    "cropLastY",
    "leerArchivoImagen",
    "abrirEditorRecorte",
    "resetearCrop",
    "cerrarEditorRecorte",
    "renderCropCanvas",
    "aplicarRecorteFoto",
    "puntoCropDesdeEvento",
    "iniciarDragCrop",
    "moverDragCrop",
    "terminarDragCrop",
    "mostrarPreviewFoto",
    "manejarFoto"
  ]) {
    assert.equal(app.includes(marker), false, marker);
  }
});

test("legacy Product photo controls and crop modal are absent from modular HTML", () => {
  for (const id of [
    "foto-input",
    "foto-camara",
    "foto-preview",
    "foto-placeholder",
    "foto-img",
    "btn-quitar-foto",
    "crop-zoom",
    "crop-canvas",
    "btn-crop-reset",
    "btn-aplicar-crop",
    "btn-cancelar-crop",
    "btn-cerrar-crop",
    "modal-crop-foto"
  ]) {
    assert.equal(html.includes(`id="${id}"`), false, id);
  }
});

test("Product save service remains photo-free", () => {
  assert.match(service, /guardar_producto_seguro_v2/);
  assert.doesNotMatch(service, /\bp_foto\b/);
});

test("productive guardar_producto_seguro_v2 signature remains photo-free", () => {
  const start = migration.indexOf(
    "create or replace function public.guardar_producto_seguro_v2("
  );
  assert.notEqual(start, -1);

  const end = migration.indexOf(")", start);
  assert.notEqual(end, -1);

  const signature = migration.slice(start, end + 1);

  for (const parameter of [
    "p_producto_id",
    "p_sucursal_id",
    "p_nombre",
    "p_marca",
    "p_presentacion",
    "p_codigo_barras",
    "p_categoria",
    "p_precio_compra",
    "p_precio_venta",
    "p_stock"
  ]) {
    assert.match(signature, new RegExp(`\\b${parameter}\\b`));
  }

  assert.doesNotMatch(signature, /\bp_foto\b/);
});
