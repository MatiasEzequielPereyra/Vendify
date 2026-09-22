import assert from "node:assert/strict";
import test from "node:test";
import { closeTopOpenModal } from "../../dist-ts/core/modal-return.js";

test("Escape closes a child before its still-open parent", () => {
  const open = { child: true, parent: true };
  const targets = [
    { isOpen: () => open.child, close: () => { open.child = false; } },
    { isOpen: () => open.parent, close: () => { open.parent = false; } }
  ];
  assert.equal(closeTopOpenModal(targets), true);
  assert.deepEqual(open, { child: false, parent: true });
  assert.equal(closeTopOpenModal(targets), true);
  assert.deepEqual(open, { child: false, parent: false });
  assert.equal(closeTopOpenModal(targets), false);
});
