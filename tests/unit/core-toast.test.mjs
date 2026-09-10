import assert from "node:assert/strict";
import test from "node:test";
import { normalizeToastType, showToast } from "../../dist-ts/core/toast.js";

test("normalizeToastType only allows supported visual variants", () => {
  assert.equal(normalizeToastType("success"), "success");
  assert.equal(normalizeToastType("warning"), "warning");
  assert.equal(normalizeToastType("toast injected-class"), "info");
  assert.equal(normalizeToastType(null), "info");
});

test("showToast renders text safely and schedules its removal", () => {
  const scheduled = [];
  const classes = [];
  let removed = false;
  let appended = null;
  const toast = {
    className: "",
    textContent: null,
    classList: { add: (name) => classes.push(name) },
    remove: () => { removed = true; }
  };
  const environment = {
    document: {
      querySelector: (selector) => (selector === "#toast-container" ? { appendChild: (node) => { appended = node; } } : null),
      createElement: () => toast
    },
    schedule: (callback, delayMs) => { scheduled.push({ callback, delayMs }); }
  };

  assert.equal(showToast('<img src=x onerror=alert(1)>', "error", environment), true);
  assert.equal(toast.className, "toast error");
  assert.equal(toast.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(appended, toast);
  assert.deepEqual(scheduled.map(({ delayMs }) => delayMs), [2600]);

  scheduled[0].callback();
  assert.deepEqual(classes, ["leaving"]);
  assert.deepEqual(scheduled.map(({ delayMs }) => delayMs), [2600, 250]);
  scheduled[1].callback();
  assert.equal(removed, true);
});

test("showToast is harmless when the legacy page has no toast container", () => {
  assert.equal(
    showToast("sin contenedor", "success", {
      document: {
        querySelector: () => null,
        createElement: () => { throw new Error("no debe crear el toast"); }
      },
      schedule: () => { throw new Error("no debe programar el toast"); }
    }),
    false
  );
});
