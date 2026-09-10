import assert from "node:assert/strict";
import test from "node:test";
import { isDestructiveConfirmation, showConfirmation } from "../../dist-ts/core/confirm.js";

function fixture() {
  const elements = new Map();
  for (const selector of ["#modal-confirm", "#btn-confirm-ok", "#btn-confirm-cancel", "#btn-cerrar-confirm", "#confirm-titulo", "#confirm-mensaje"]) {
    elements.set(selector, { textContent: null, className: "", onclick: null, classList: { add() {}, remove() {} } });
  }
  const modal = elements.get("#modal-confirm");
  const classes = [];
  modal.classList = { add: (name) => classes.push(`add:${name}`), remove: (name) => classes.push(`remove:${name}`) };
  return { elements, classes, document: { querySelector: (selector) => elements.get(selector) || null } };
}
test("confirmation classifies destructive wording and explicit overrides", () => {
  assert.equal(isDestructiveConfirmation("Eliminar producto", "", null), true);
  assert.equal(isDestructiveConfirmation("Eliminar producto", "", false), false);
  assert.equal(isDestructiveConfirmation("Continuar", "", null), false);
});
test("confirmation resolves accepted and restores hidden modal state", async () => {
  const view = fixture();
  const result = showConfirmation("Eliminar", "¿Confirmás borrar?", {}, view.document);
  assert.equal(view.elements.get("#btn-confirm-ok").className, "btn btn-danger");
  view.elements.get("#btn-confirm-ok").onclick();
  assert.equal(await result, true);
  assert.deepEqual(view.classes, ["remove:hidden", "add:hidden"]);
});
