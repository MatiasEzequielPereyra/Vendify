import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const app = readFileSync(new URL("../../app.js", import.meta.url), "utf8");

function obtenerOpcionesDesdeApp() {
  const constants = app.match(/^const CATEGORIAS_ADICIONALES = \[[^\n]+\];$/m)?.[0];
  const begin = app.indexOf("function obtenerCategoriasParaProducto(");
  const end = app.indexOf("\n}\n", begin);

  assert.ok(constants, "Falta la lista de categorías adicionales");
  assert.ok(begin >= 0 && end > begin, "Falta el helper de opciones");
  return runInNewContext(
    `${constants}\n${app.slice(begin, end + 2)}\nobtenerCategoriasParaProducto`,
    { categorias: [] }
  );
}

test("Lencería y Skin Care están disponibles para negocios existentes sin duplicados", () => {
  const opciones = obtenerOpcionesDesdeApp();
  const resultado = Array.from(opciones(["Bebidas", "Lencería", "Skin Care", "Bebidas"]));

  assert.deepEqual(resultado, ["Bebidas", "Lencería", "Skin Care"]);
  assert.deepEqual(Array.from(opciones(["Otros"])), ["Lencería", "Otros", "Skin Care"]);
});

test("las categorías nuevas aparecen en la inicialización y los selectores", () => {
  assert.match(app, /const CATEGORIAS_DEFAULT = \[[\s\S]*?\.\.\.CATEGORIAS_ADICIONALES,/);
  assert.match(app, /function renderSelectCategorias\([\s\S]*?obtenerCategoriasParaProducto\(\)\.forEach/);
  assert.match(app, /function actualizarFiltroCategorias\([\s\S]*?\.\.\.obtenerCategoriasParaProducto\(\)/);
});
