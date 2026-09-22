import assert from "node:assert/strict";
import test from "node:test";
import { createScannerEditorReturn } from "../../dist-ts/products/scanner-editor-return.js";

test("canceling a product editor returns to the scanner that opened it once", () => {
  const navigation = createScannerEditorReturn();
  navigation.remember("venta");
  assert.equal(navigation.consume(), "venta");
  assert.equal(navigation.consume(), null);
});

test("saving a product clears the scanner return so a later editor cannot reopen it", () => {
  const navigation = createScannerEditorReturn();
  navigation.remember("producto");
  navigation.clear();
  assert.equal(navigation.consume(), null);
});
