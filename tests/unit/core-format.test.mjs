import assert from "node:assert/strict";
import test from "node:test";
import { formatArs, productDisplayName } from "../../dist-ts/core/format.js";
import { escapeHtml } from "../../dist-ts/core/dom.js";

test("formatArs preserves legacy ARS formatting", () => {
  assert.equal(formatArs(0), "$ 0");
  assert.equal(formatArs(1500), "$ 1.500");
  assert.equal(formatArs(1500.5), "$ 1.500,5");
  assert.equal(formatArs(null), "$ 0");
});

test("productDisplayName appends presentation once", () => {
  assert.equal(
    productDisplayName({ nombre: "Coca Cola", presentacion: "500 ml" }),
    "Coca Cola 500 ml"
  );
  assert.equal(
    productDisplayName({ nombre: "Coca Cola 500 ml", presentacion: "500 ml" }),
    "Coca Cola 500 ml"
  );
  assert.equal(
    productDisplayName({ nombre: "Leche 1,5 L", presentacion: "1.5 l" }),
    "Leche 1,5 L"
  );
});

test("escapeHtml matches text-node escaping needed by legacy templates", () => {
  assert.equal(escapeHtml('<b>A & B</b> "ok"'), '&lt;b&gt;A &amp; B&lt;/b&gt; "ok"');
  assert.equal(escapeHtml(null), "");
});
