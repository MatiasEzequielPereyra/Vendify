import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  createNavigationEventsController
} from "../../dist-ts/core/navigation-events-controller.js";

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
  constructor({
    id = "",
    classes = [],
    dataset = {},
    rect = { left: 100, right: 180, top: 40, bottom: 72 },
    zIndex = "0"
  } = {}) {
    this.id = id;
    this.tagName = "DIV";
    this.classList = new FakeClassList(classes);
    this.dataset = { ...dataset };
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.scrollHeight = 180;
    this.rect = rect;
    this.zIndex = zIndex;
    this.clickCount = 0;
    this.closestButton = false;
    this.closeButton = null;
    this.hidden = false;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  addEventListener(type, listener) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(listener);
    this.listeners.set(type, bucket);
  }

  listenerCount(type) {
    return (this.listeners.get(type) ?? []).length;
  }

  async emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener({
        type,
        target: this,
        stopPropagation() {},
        preventDefault() {},
        ...event
      });
    }
  }

  closest(selector) {
    if (selector === "button" && this.closestButton) return this;
    return null;
  }

  querySelector(selector) {
    if (
      this.closeButton &&
      (selector.includes('id*="close"') ||
        selector.includes('id*="cerrar"') ||
        selector.includes('id*="cancel"') ||
        selector.includes('id*="cancelar"'))
    ) {
      return this.closeButton;
    }
    return null;
  }

  click() {
    this.clickCount += 1;
    void this.emit("click");
  }
}

class FakeDocument {
  constructor(elements, modals, header) {
    this.elements = new Map(
      elements.map((element) => [element.id, element])
    );
    this.modals = modals;
    this.header = header;
    this.listeners = new Map();
    this.activeElement = null;
    this.visibilityState = "visible";
  }

  getElementById(id) {
    return this.elements.get(id) ?? null;
  }

  querySelector(selector) {
    if (selector === ".app") {
      return this.elements.get("app") ?? null;
    }
    if (selector === ".header-actions-vpro") return this.header;
    if (selector === "#modal-config .modal-backdrop") {
      return this.elements.get("config-backdrop") ?? null;
    }
    if (selector === "#modal-confirm .modal-backdrop") {
      return this.elements.get("confirm-backdrop") ?? null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector === ".modal") return this.modals;
    if (selector === ".config-tab-v224") {
      return [...this.elements.values()].filter(
        (element) =>
          element.classList.contains("config-tab-v224")
      );
    }
    if (selector === "[data-config-go]") {
      return [...this.elements.values()].filter(
        (element) => element.dataset.configGo
      );
    }
    return [];
  }

  addEventListener(type, listener) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(listener);
    this.listeners.set(type, bucket);
  }

  listenerCount(type) {
    return (this.listeners.get(type) ?? []).length;
  }

  async emit(type, event = {}) {
    let prevented = false;
    let stoppedImmediately = false;
    const actual = {
      type,
      target: null,
      key: "",
      stopPropagation() {},
      stopImmediatePropagation() {
        stoppedImmediately = true;
      },
      preventDefault() {
        prevented = true;
      },
      ...event
    };

    for (const listener of this.listeners.get(type) ?? []) {
      await listener(actual);
      if (stoppedImmediately) break;
    }

    return prevented;
  }
}

class FakeHistory {
  constructor() {
    this.state = {};
    this.replaceCalls = [];
    this.pushCalls = [];
    this.backCalls = 0;
  }

  replaceState(state, title, url) {
    this.state = state;
    this.replaceCalls.push({ state, title, url });
  }

  pushState(state, title, url) {
    this.state = state;
    this.pushCalls.push({ state, title, url });
  }

  back() {
    this.backCalls += 1;
    this.state = { vendifyBaseV2311: true };
  }
}

class FakeWindow {
  constructor(history) {
    this.history = history;
    this.location = { href: "https://vendify.test/app" };
    this.innerWidth = 390;
    this.innerHeight = 844;
    this.listeners = new Map();
    this.closed = 0;
  }

  addEventListener(type, listener) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type, listener) {
    const bucket = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      bucket.filter((candidate) => candidate !== listener)
    );
  }

  listenerCount(type) {
    return (this.listeners.get(type) ?? []).length;
  }

  async emit(type, event = {}) {
    for (const listener of [
      ...(this.listeners.get(type) ?? [])
    ]) {
      await listener({ type, ...event });
    }
  }

  requestAnimationFrame(callback) {
    callback(0);
    return 1;
  }

  getComputedStyle(element) {
    return { zIndex: element.zIndex };
  }

  close() {
    this.closed += 1;
  }
}

function createHarness({
  permission = true,
  ready = true,
  cartSize = 0,
  confirmImpl = async () => false,
  modals = []
} = {}) {
  const ids = [
    "app",
    "btn-theme",
    "btn-export",
    "btn-user-menu",
    "user-menu",
    "btn-user-settings",
    "btn-gestion-v230",
    "gestion-menu-v230",
    "btn-config-catalogo",
    "btn-config-equipo",
    "btn-cerrar-config",
    "btn-cerrar-config-ok",
    "config-backdrop",
    "confirm-backdrop",
    "btn-confirm-cancel",
    "branch-menu-v23013",
    "cash-menu-v23013",
    "modal-confirm",
    "modal-ticket-v228",
    "modal-return-v228",
    "modal-caja-movimiento-v227",
    "modal-cash-close-v227",
    "modal-editar-empleado",
    "modal-reset-empleado",
    "modal-proveedor-editor",
    "modal-compra-editor",
    "modal-scanner-v29",
    "modal",
    "modal-catalogo-v29",
    "modal-historial",
    "modal-compras",
    "modal-inventario",
    "modal-caja-operativa-v227",
    "modal-dashboard-v231",
    "modal-equipo",
    "modal-venta",
    "modal-config"
  ];

  const elements = new Map();

  for (const id of ids) {
    const classes =
      id === "app"
        ? []
        : id.includes("modal") ||
            id.includes("menu")
          ? ["hidden"]
          : [];
    elements.set(id, new FakeElement({ id, classes }));
  }

  for (const modal of modals) {
    elements.set(modal.id, modal);
  }

  const configTab = new FakeElement({
    id: "config-tab-general",
    classes: ["config-tab-v224"],
    dataset: { configTab: "general" }
  });
  const configGo = new FakeElement({
    id: "config-go-operation",
    dataset: { configGo: "operacion" }
  });
  elements.set(configTab.id, configTab);
  elements.set(configGo.id, configGo);

  const header = new FakeElement({ id: "header-actions" });
  const allModals = [...elements.values()].filter(
    (element) => element.id.startsWith("modal")
  );
  const document = new FakeDocument(
    [...elements.values()],
    allModals,
    header
  );
  const history = new FakeHistory();
  const window = new FakeWindow(history);
  const scheduled = [];
  const calls = {
    theme: 0,
    export: 0,
    settingsOpen: [],
    settingsTab: [],
    settingsClose: 0,
    catalog: 0,
    teamOpen: 0,
    dismiss: 0,
    saleOpen: 0,
    searchFocus: 0,
    productOpen: 0,
    productClose: 0,
    saleClose: 0,
    historyClose: 0,
    teamClose: 0,
    teamEditorClose: 0,
    teamResetClose: 0,
    scannerClose: 0,
    contextClose: 0,
    confirms: [],
    toasts: []
  };

  const controller = createNavigationEventsController({
    document,
    window,
    requestAnimationFrame(callback) {
      callback(0);
      return 1;
    },
    schedule(callback, delay) {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    toggleTheme() {
      calls.theme += 1;
    },
    exportProducts() {
      calls.export += 1;
    },
    openSettings(tab) {
      calls.settingsOpen.push(tab);
    },
    activateSettingsTab(tab) {
      calls.settingsTab.push(tab);
    },
    closeSettings() {
      calls.settingsClose += 1;
      elements.get("modal-config").classList.add("hidden");
    },
    openCatalog() {
      calls.catalog += 1;
    },
    openTeam() {
      calls.teamOpen += 1;
    },
    dismissConfirmation() {
      calls.dismiss += 1;
      elements.get("modal-confirm").classList.add("hidden");
    },
    closeTopOpenModal(targets) {
      const target = targets.find(
        (candidate) => candidate.isOpen()
      );
      if (!target) return false;
      target.close();
      return true;
    },
    openSale() {
      calls.saleOpen += 1;
    },
    focusProductSearch() {
      calls.searchFocus += 1;
    },
    openProductEditor() {
      calls.productOpen += 1;
    },
    hasPermission(name) {
      return name === "manageProducts" && permission;
    },
    closeProductEditor() {
      calls.productClose += 1;
      elements.get("modal").classList.add("hidden");
    },
    closeSale() {
      calls.saleClose += 1;
      elements.get("modal-venta").classList.add("hidden");
    },
    closeSalesHistory() {
      calls.historyClose += 1;
    },
    closeTeam() {
      calls.teamClose += 1;
    },
    closeTeamEditor() {
      calls.teamEditorClose += 1;
    },
    closeTeamPasswordReset() {
      calls.teamResetClose += 1;
    },
    closeScanner() {
      calls.scannerClose += 1;
    },
    closeContextPickers() {
      calls.contextClose += 1;
      elements
        .get("branch-menu-v23013")
        .classList.add("hidden");
      elements
        .get("cash-menu-v23013")
        .classList.add("hidden");
    },
    getCartSize() {
      return cartSize;
    },
    async confirm(title, message, options) {
      calls.confirms.push({ title, message, options });
      return confirmImpl(title, message, options);
    },
    showToast(message, type) {
      calls.toasts.push({ message, type });
    },
    isModalVisible(modal) {
      return (
        !modal.classList.contains("hidden") &&
        !modal.hidden
      );
    },
    getAppReady() {
      return ready;
    }
  });

  return {
    controller,
    calls,
    document,
    window,
    history,
    scheduled,
    header,
    element(id) {
      return elements.get(id);
    }
  };
}

test("User Menu opens/closes, excludes Gestión, preserves aria and clears positioning", () => {
  const h = createHarness();

  h.controller.toggleManagementMenu(true);
  h.controller.toggleUserMenu(true);

  assert.equal(
    h.element("user-menu").classList.contains("hidden"),
    false
  );
  assert.equal(
    h.element("gestion-menu-v230").classList.contains("hidden"),
    true
  );
  assert.equal(
    h.element("btn-user-menu").getAttribute("aria-expanded"),
    "true"
  );
  assert.equal(
    h.element("user-menu").style.position,
    "fixed"
  );
  assert.ok(
    ["top", "bottom"].includes(
      h.element("user-menu").dataset.placement
    )
  );

  h.controller.closeUserMenu();

  assert.equal(
    h.element("btn-user-menu").getAttribute("aria-expanded"),
    "false"
  );
  assert.equal(
    h.element("user-menu").style.position,
    ""
  );
  assert.equal(
    h.element("user-menu").dataset.placement,
    undefined
  );
});

test("Gestión Menu excludes User Menu and internal button click closes it", async () => {
  const h = createHarness();
  h.controller.setup();

  h.controller.toggleUserMenu(true);
  h.controller.toggleManagementMenu(true);

  assert.equal(
    h.element("user-menu").classList.contains("hidden"),
    true
  );
  assert.equal(
    h.element("gestion-menu-v230").classList.contains("hidden"),
    false
  );
  assert.equal(
    h.element("btn-gestion-v230").getAttribute("aria-expanded"),
    "true"
  );

  const button = new FakeElement({ id: "internal-button" });
  button.closestButton = true;
  await h.element("gestion-menu-v230").emit(
    "click",
    { target: button }
  );

  assert.equal(
    h.element("gestion-menu-v230").classList.contains("hidden"),
    true
  );
  assert.equal(
    h.element("btn-gestion-v230").getAttribute("aria-expanded"),
    "false"
  );
});

test("outside click and scroll close menus while resize repositions open menus", async () => {
  const h = createHarness();
  h.controller.setup();

  h.controller.toggleUserMenu(true);
  h.element("user-menu").style.left = "stale";
  await h.window.emit("resize");
  assert.notEqual(
    h.element("user-menu").style.left,
    "stale"
  );

  await h.document.emit("click");
  assert.equal(
    h.element("user-menu").classList.contains("hidden"),
    true
  );

  h.controller.toggleManagementMenu(true);
  h.element("gestion-menu-v230").style.left = "stale";
  await h.window.emit("resize");
  assert.notEqual(
    h.element("gestion-menu-v230").style.left,
    "stale"
  );

  await h.header.emit("scroll");
  assert.equal(
    h.element("gestion-menu-v230").classList.contains("hidden"),
    true
  );
});

test("setup is idempotent and does not duplicate global listeners", () => {
  const h = createHarness();

  h.controller.setup();
  h.controller.setup();

  assert.equal(h.document.listenerCount("keydown"), 1);
  assert.equal(h.document.listenerCount("click"), 1);
  assert.equal(h.window.listenerCount("resize"), 1);
  assert.equal(h.window.listenerCount("scroll"), 1);
  assert.equal(h.window.listenerCount("popstate"), 1);
  assert.equal(
    h.element("btn-user-menu").listenerCount("click"),
    1
  );
  assert.equal(
    h.element("btn-gestion-v230").listenerCount("click"),
    1
  );
});

test("keyboard router preserves typing guard and V/T/slash/N permission behavior", async () => {
  const h = createHarness();
  h.controller.setup();

  h.document.activeElement = { tagName: "INPUT" };
  await h.document.emit("keydown", { key: "V" });
  await h.document.emit("keydown", { key: "T" });
  await h.document.emit("keydown", { key: "/" });
  await h.document.emit("keydown", { key: "N" });

  assert.equal(h.calls.saleOpen, 0);
  assert.equal(h.calls.theme, 0);
  assert.equal(h.calls.searchFocus, 0);
  assert.equal(h.calls.productOpen, 0);

  h.document.activeElement = { tagName: "BODY" };
  assert.equal(
    await h.document.emit("keydown", { key: "V" }),
    true
  );
  assert.equal(
    await h.document.emit("keydown", { key: "T" }),
    true
  );
  assert.equal(
    await h.document.emit("keydown", { key: "/" }),
    true
  );
  assert.equal(
    await h.document.emit("keydown", { key: "N" }),
    true
  );

  assert.equal(h.calls.saleOpen, 1);
  assert.equal(h.calls.theme, 1);
  assert.equal(h.calls.searchFocus, 1);
  assert.equal(h.calls.productOpen, 1);

  const denied = createHarness({ permission: false });
  denied.controller.setup();
  denied.document.activeElement = { tagName: "BODY" };

  assert.equal(
    await denied.document.emit(
      "keydown",
      { key: "N" }
    ),
    false
  );
  assert.equal(denied.calls.productOpen, 0);
});

test("Escape remains a separate global router and closes its first visible target", async () => {
  const h = createHarness();
  h.controller.setup();
  h.element("modal-confirm").classList.remove("hidden");
  h.document.activeElement = { tagName: "INPUT" };

  assert.equal(
    await h.document.emit(
      "keydown",
      { key: "Escape" }
    ),
    true
  );
  assert.equal(h.calls.dismiss, 1);
  assert.equal(
    h.element("modal-confirm").classList.contains("hidden"),
    true
  );
});

test("Back Guard setup creates base and guard history entries", () => {
  const h = createHarness();

  h.controller.setup();

  assert.equal(h.history.replaceCalls.length, 1);
  assert.equal(
    h.history.replaceCalls[0].state.vendifyBaseV2311,
    true
  );
  assert.equal(h.history.pushCalls.length, 1);
  assert.equal(
    h.history.pushCalls[0].state.vendifyGuardV2311,
    true
  );
});

test("Back closes floating popovers before any modal and delegates Context Picker close", async () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.toggleUserMenu(true);
  h.element("branch-menu-v23013").classList.remove("hidden");
  h.history.state = { vendifyBaseV2311: true };

  await h.window.emit("popstate");

  assert.equal(
    h.element("user-menu").classList.contains("hidden"),
    true
  );
  assert.equal(
    h.element("branch-menu-v23013").classList.contains("hidden"),
    true
  );
  assert.equal(h.calls.contextClose, 1);
  assert.equal(h.calls.confirms.length, 0);
  assert.equal(
    h.history.state.vendifyGuardV2311,
    true
  );
});

test("Back picks the highest z-index modal and confirmation modal cancels", async () => {
  const low = new FakeElement({
    id: "modal-inventario",
    zIndex: "10"
  });
  const high = new FakeElement({
    id: "modal-confirm",
    zIndex: "90"
  });
  const h = createHarness({ modals: [low, high] });
  h.controller.setup();
  h.history.state = { vendifyBaseV2311: true };

  await h.window.emit("popstate");

  assert.equal(
    h.element("btn-confirm-cancel").clickCount,
    1
  );
  assert.equal(
    low.classList.contains("hidden"),
    false
  );
  assert.equal(h.calls.confirms.length, 0);
});

test("Back uses a modal close button before the hide fallback", async () => {
  const modal = new FakeElement({
    id: "modal-custom-close",
    zIndex: "40"
  });
  const closeButton = new FakeElement({
    id: "btn-close-custom"
  });
  modal.closeButton = closeButton;

  const h = createHarness({ modals: [modal] });
  h.controller.setup();
  h.history.state = { vendifyBaseV2311: true };

  await h.window.emit("popstate");

  assert.equal(closeButton.clickCount, 1);
  assert.equal(
    modal.classList.contains("hidden"),
    false
  );
});

test("Back safely hides a modal when no close or cancel button exists", async () => {
  const modal = new FakeElement({
    id: "modal-custom-fallback",
    zIndex: "40"
  });
  const h = createHarness({ modals: [modal] });
  h.controller.setup();
  h.history.state = { vendifyBaseV2311: true };

  await h.window.emit("popstate");

  assert.equal(
    modal.classList.contains("hidden"),
    true
  );
});

test("Back closes Sale immediately with empty cart", async () => {
  const sale = new FakeElement({
    id: "modal-venta",
    zIndex: "40"
  });
  const h = createHarness({
    cartSize: 0,
    modals: [sale]
  });
  h.controller.setup();
  h.history.state = { vendifyBaseV2311: true };

  await h.window.emit("popstate");

  assert.equal(h.calls.saleClose, 1);
  assert.equal(h.calls.confirms.length, 0);
});

test("Back asks before discarding a non-empty Sale and rejection preserves it", async () => {
  const sale = new FakeElement({
    id: "modal-venta",
    zIndex: "40"
  });
  const h = createHarness({
    cartSize: 2,
    modals: [sale],
    confirmImpl: async () => false
  });
  h.controller.setup();
  h.history.state = { vendifyBaseV2311: true };

  await h.window.emit("popstate");

  assert.equal(
    h.calls.confirms[0].title,
    "¿Cerrar esta venta?"
  );
  assert.equal(h.calls.saleClose, 0);
  assert.equal(
    sale.classList.contains("hidden"),
    false
  );
  assert.equal(
    h.history.state.vendifyGuardV2311,
    true
  );
});

test("accepted Sale close delegates to POS owner after confirmation", async () => {
  const sale = new FakeElement({
    id: "modal-venta",
    zIndex: "40"
  });
  const h = createHarness({
    cartSize: 2,
    modals: [sale],
    confirmImpl: async (title) =>
      title === "¿Cerrar esta venta?"
  });
  h.controller.setup();
  h.history.state = { vendifyBaseV2311: true };

  await h.window.emit("popstate");

  assert.equal(h.calls.saleClose, 1);
});

test("cancelled Exit rearms guard and concurrent popstate does not duplicate confirmation", async () => {
  let resolveConfirm;
  const pending = new Promise((resolve) => {
    resolveConfirm = resolve;
  });
  const h = createHarness({
    confirmImpl: () => pending
  });
  h.controller.setup();
  h.history.state = { vendifyBaseV2311: true };

  const first = h.window.emit("popstate");
  await Promise.resolve();
  const second = h.window.emit("popstate");
  await Promise.resolve();

  assert.equal(h.calls.confirms.length, 1);

  resolveConfirm(false);
  await first;
  await second;

  assert.equal(
    h.history.state.vendifyGuardV2311,
    true
  );
});

test("Back does not intercept while app is not ready or is hidden", async () => {
  const notReady = createHarness({ ready: false });
  notReady.controller.setup();
  notReady.history.state = { vendifyBaseV2311: true };

  await notReady.window.emit("popstate");
  assert.equal(notReady.calls.confirms.length, 0);

  const hidden = createHarness();
  hidden.element("app").classList.add("hidden");
  hidden.controller.setup();
  hidden.history.state = { vendifyBaseV2311: true };

  await hidden.window.emit("popstate");
  assert.equal(hidden.calls.confirms.length, 0);
});

test("accepted Exit invokes native history, close attempt, and delayed fallback toast", async () => {
  const h = createHarness({
    confirmImpl: async () => true
  });
  h.controller.setup();
  h.history.state = { vendifyBaseV2311: true };

  await h.window.emit("popstate");

  assert.equal(h.history.backCalls, 1);
  assert.equal(h.window.listenerCount("popstate"), 0);
  assert.deepEqual(
    h.scheduled.map((entry) => entry.delay),
    [180, 550]
  );

  h.scheduled[0].callback();
  h.scheduled[1].callback();

  assert.equal(h.window.closed, 1);
  assert.equal(h.calls.toasts.length, 1);
  assert.equal(h.calls.toasts[0].type, "info");
  assert.match(
    h.calls.toasts[0].message,
    /próximo gesto Atrás/
  );
});

test("typed owner contains no backend or direct domain-controller globals", () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "../../src/core/navigation-events-controller.ts"
    ),
    "utf8"
  );

  for (const forbidden of [
    ".rpc(",
    "supabaseClient",
    "window.Vendify",
    "posControllerV232",
    "teamControllerV232",
    "productsControllerV232",
    "contextPickerControllerV232"
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(
        forbidden.replace(".", "\\."),
        "u"
      )
    );
  }
});
