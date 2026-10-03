import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createOverlayStabilityController,
  isModalVisible
} from "../../dist-ts/core/overlay-stability.js";

class FakeClassList {
  constructor(tokens = []) {
    this.tokens = new Set(tokens);
  }

  contains(token) {
    return this.tokens.has(token);
  }

  add(...tokens) {
    for (const token of tokens) this.tokens.add(token);
  }

  remove(...tokens) {
    for (const token of tokens) this.tokens.delete(token);
  }

  toggle(token, force) {
    if (force === undefined) {
      if (this.tokens.has(token)) {
        this.tokens.delete(token);
        return false;
      }
      this.tokens.add(token);
      return true;
    }

    if (force) this.tokens.add(token);
    else this.tokens.delete(token);
    return force;
  }
}

class FakeElement {
  constructor({ id = "", classes = [], hidden = false } = {}) {
    this.id = id;
    this.classList = new FakeClassList(classes);
    this.hidden = hidden;
    this.attributes = new Map();
    this.clickCount = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  click() {
    this.clickCount += 1;
  }
}

class FakeDocument {
  constructor({ modals = [], elements = [] } = {}) {
    this.body = new FakeElement();
    this.modals = modals;
    this.elements = new Map(elements.map((element) => [element.id, element]));
    this.listeners = new Map();
  }

  querySelectorAll(selector) {
    return selector === ".modal" ? this.modals : [];
  }

  getElementById(id) {
    return this.elements.get(id) ?? null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchKey(key) {
    let prevented = false;
    const event = {
      key,
      preventDefault() {
        prevented = true;
      }
    };

    for (const listener of this.listeners.get("keydown") ?? []) {
      listener(event);
    }

    return prevented;
  }
}

function createHarness({ modals = [], extraElements = [] } = {}) {
  const managementMenu = new FakeElement({
    id: "gestion-menu-v230",
    classes: ["hidden"]
  });
  const userMenu = new FakeElement({
    id: "user-menu",
    classes: ["hidden"]
  });
  const document = new FakeDocument({
    modals,
    elements: [managementMenu, userMenu, ...modals, ...extraElements]
  });
  const calls = {
    user: 0,
    management: 0,
    context: 0
  };
  const observerCalls = [];
  let observerCallback = null;
  let observerFactoryCalls = 0;

  const controller = createOverlayStabilityController({
    document,
    closeUserMenu() {
      calls.user += 1;
      userMenu.classList.add("hidden");
    },
    closeManagementMenu() {
      calls.management += 1;
      managementMenu.classList.add("hidden");
    },
    closeContextPickers() {
      calls.context += 1;
    },
    createObserver(callback) {
      observerFactoryCalls += 1;
      observerCallback = callback;
      return {
        observe(target, options) {
          observerCalls.push({ target, options });
        }
      };
    }
  });

  return {
    controller,
    document,
    managementMenu,
    userMenu,
    calls,
    observerCalls,
    get observerCallback() {
      return observerCallback;
    },
    get observerFactoryCalls() {
      return observerFactoryCalls;
    }
  };
}

test("modal visibility preserves hidden class and hidden-property semantics", () => {
  assert.equal(isModalVisible(null), false);
  assert.equal(
    isModalVisible(new FakeElement({ classes: ["hidden"], hidden: false })),
    false
  );
  assert.equal(
    isModalVisible(new FakeElement({ hidden: true })),
    false
  );
  assert.equal(
    isModalVisible(new FakeElement({ hidden: false })),
    true
  );
});

test("sync updates body state, aria-hidden, and floating-menu callbacks", () => {
  const visible = new FakeElement({ id: "visible-modal" });
  const hiddenByClass = new FakeElement({
    id: "hidden-class-modal",
    classes: ["hidden"]
  });
  const hiddenByProperty = new FakeElement({
    id: "hidden-property-modal",
    hidden: true
  });
  const harness = createHarness({
    modals: [visible, hiddenByClass, hiddenByProperty]
  });

  harness.controller.sync();

  assert.equal(
    harness.document.body.classList.contains("vendify-modal-open-v23011"),
    true
  );
  assert.equal(visible.getAttribute("aria-hidden"), "false");
  assert.equal(hiddenByClass.getAttribute("aria-hidden"), "true");
  assert.equal(hiddenByProperty.getAttribute("aria-hidden"), "true");
  assert.deepEqual(harness.calls, {
    user: 1,
    management: 1,
    context: 1
  });

  visible.classList.add("hidden");
  harness.controller.sync();

  assert.equal(
    harness.document.body.classList.contains("vendify-modal-open-v23011"),
    false
  );
  assert.equal(visible.getAttribute("aria-hidden"), "true");
  assert.deepEqual(harness.calls, {
    user: 1,
    management: 1,
    context: 1
  });
});

test("setup observes class/hidden attributes and reacts only to attribute mutations", () => {
  const modal = new FakeElement({
    id: "modal-inventario",
    classes: ["hidden"]
  });
  const harness = createHarness({ modals: [modal] });

  harness.controller.setup();

  assert.equal(harness.observerFactoryCalls, 1);
  assert.equal(harness.observerCalls.length, 1);
  assert.equal(harness.observerCalls[0].target, modal);
  assert.deepEqual(harness.observerCalls[0].options, {
    attributes: true,
    attributeFilter: ["class", "hidden"]
  });

  modal.classList.remove("hidden");
  harness.observerCallback([{ type: "childList" }]);
  assert.equal(
    harness.document.body.classList.contains("vendify-modal-open-v23011"),
    false
  );

  harness.observerCallback([{ type: "attributes" }]);
  assert.equal(
    harness.document.body.classList.contains("vendify-modal-open-v23011"),
    true
  );
  assert.deepEqual(harness.calls, {
    user: 1,
    management: 1,
    context: 1
  });
});

test("Escape keeps legacy menu precedence before modal close routing", () => {
  const confirmModal = new FakeElement({ id: "modal-confirm" });
  const confirmClose = new FakeElement({ id: "btn-confirm-cancel" });
  const inventoryModal = new FakeElement({ id: "modal-inventario" });
  const inventoryClose = new FakeElement({ id: "btn-close-inventory" });
  const harness = createHarness({
    modals: [confirmModal, inventoryModal],
    extraElements: [confirmClose, inventoryClose]
  });

  harness.controller.setup();

  harness.managementMenu.classList.remove("hidden");
  assert.equal(harness.document.dispatchKey("Escape"), false);
  assert.equal(harness.calls.management, 2);
  assert.equal(confirmClose.clickCount, 0);

  harness.userMenu.classList.remove("hidden");
  assert.equal(harness.document.dispatchKey("Escape"), false);
  assert.equal(harness.calls.user, 2);
  assert.equal(confirmClose.clickCount, 0);

  assert.equal(harness.document.dispatchKey("Escape"), true);
  assert.equal(confirmClose.clickCount, 1);
  assert.equal(inventoryClose.clickCount, 0);
});

test("Escape visibility uses both hidden mechanisms and preserves close order", () => {
  const confirmModal = new FakeElement({
    id: "modal-confirm",
    hidden: true
  });
  const confirmClose = new FakeElement({ id: "btn-confirm-cancel" });
  const inventoryModal = new FakeElement({ id: "modal-inventario" });
  const inventoryClose = new FakeElement({ id: "btn-close-inventory" });
  const harness = createHarness({
    modals: [confirmModal, inventoryModal],
    extraElements: [confirmClose, inventoryClose]
  });

  harness.controller.setup();

  assert.equal(harness.document.dispatchKey("Escape"), true);
  assert.equal(confirmClose.clickCount, 0);
  assert.equal(inventoryClose.clickCount, 1);
});

test("setup is idempotent", () => {
  const modal = new FakeElement({
    id: "modal-inventario",
    classes: ["hidden"]
  });
  const harness = createHarness({ modals: [modal] });

  harness.controller.setup();
  harness.controller.setup();

  assert.equal(harness.observerFactoryCalls, 1);
  assert.equal(harness.observerCalls.length, 1);
  assert.equal(harness.document.listeners.get("keydown").length, 1);
});

test("legacy app composes the typed owner without retiring the other global Escape router", () => {
  const app = readFileSync("app.js", "utf8");
  const bridge = readFileSync("src/legacy/core-bridge.ts", "utf8");

  for (const retiredMarker of [
    "function modalVisibleV23011",
    "function cerrarMenusFlotantesV23011",
    "function sincronizarEstadoOverlaysV23011",
    "function setupOverlayStabilityV23011"
  ]) {
    assert.equal(app.includes(retiredMarker), false, retiredMarker);
  }

  assert.match(
    app,
    /window\.VendifyCoreV232\.createOverlayStabilityController\(\{/
  );
  assert.match(app, /overlayStabilityControllerV232\.setup\(\)/);
  assert.match(
    app,
    /overlayStabilityControllerV232\.isModalVisible\(modal\)/
  );
  assert.match(app, /const escapeTargets = \[/);

  assert.match(
    bridge,
    /createOverlayStabilityController/
  );
});
