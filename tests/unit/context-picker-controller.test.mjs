import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  createContextPickerController
} from "../../dist-ts/context/context-picker-controller.js";

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
}

class FakeElement {
  constructor({ id = "", classes = [], dataset = {} } = {}) {
    this.id = id;
    this.classList = new FakeClassList(classes);
    this.dataset = { ...dataset };
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = "";
    this.title = "";
    this.innerHTML = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
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
      await listener({ type, target: this, ...event });
    }
  }

  closest(selector) {
    if (
      selector === ".context-picker-v23013" &&
      this.classList.contains("context-picker-v23013")
    ) {
      return this;
    }
    if (
      selector === "[data-context-branch]" &&
      this.dataset.contextBranch
    ) {
      return this;
    }
    if (
      selector === "[data-context-cash]" &&
      this.dataset.contextCash
    ) {
      return this;
    }
    return null;
  }
}

class FakeDocument {
  constructor(elements = [], header = null) {
    this.elements = new Map(elements.map((element) => [element.id, element]));
    this.header = header;
    this.listeners = new Map();
  }

  getElementById(id) {
    return this.elements.get(id) ?? null;
  }

  querySelector(selector) {
    if (selector === ".header-actions-vpro") return this.header;
    return null;
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
      await listener({ type, target: null, ...event });
    }
  }
}

class FakeWindow {
  constructor() {
    this.listeners = new Map();
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
      await listener({ type, ...event });
    }
  }
}

function createHarness({
  branch = { id: "branch-1", name: "Centro" },
  cashRegister = { id: "cash-1", name: "Caja 1" },
  branches = [
    { id: "branch-1", name: "Centro" },
    { id: "branch-2", name: "Norte" }
  ],
  missingIds = []
} = {}) {
  const state = {
    context: {
      branch: { ...branch },
      cashRegister: { ...cashRegister }
    },
    branches: branches.map((item) => ({ ...item }))
  };

  const ids = [
    "branch-menu-v23013",
    "branch-trigger-v23013",
    "cash-menu-v23013",
    "cash-trigger-v23013",
    "branch-current-label-v23013",
    "cash-current-label-v23013",
    "branch-options-v23013",
    "cash-options-v23013"
  ];

  const elements = new Map();
  for (const id of ids) {
    if (missingIds.includes(id)) continue;
    const classes = id.includes("-menu-") ? ["hidden"] : [];
    elements.set(id, new FakeElement({ id, classes }));
  }

  const header = missingIds.includes("header-actions")
    ? null
    : new FakeElement({ id: "header-actions" });
  const document = new FakeDocument([...elements.values()], header);
  const window = new FakeWindow();
  const positions = [];
  const calls = {
    branchSelect: [],
    cashSelect: [],
    renderCash: 0,
    userClose: 0,
    managementClose: 0,
    frames: 0,
    branchReads: 0
  };

  const controller = createContextPickerController({
    document,
    window,
    requestAnimationFrame(callback) {
      calls.frames += 1;
      callback(0);
      return calls.frames;
    },
    getContext() {
      return state.context;
    },
    getBranches() {
      calls.branchReads += 1;
      return state.branches;
    },
    async selectBranch(id) {
      calls.branchSelect.push(id);
      const selected = state.branches.find((item) => item.id === id);
      state.context.branch = {
        id,
        name: selected?.name ?? id
      };
    },
    async selectCash(id) {
      calls.cashSelect.push(id);
      state.context.cashRegister = {
        id,
        name: id === "cash-2" ? "Caja 2" : id
      };
    },
    renderCashOptions() {
      calls.renderCash += 1;
    },
    closeUserMenu() {
      calls.userClose += 1;
    },
    closeManagementMenu() {
      calls.managementClose += 1;
    },
    positionPopover(menu, trigger, options) {
      positions.push({ menu, trigger, options });
    },
    icon(name) {
      return `<svg data-icon="${name}"></svg>`;
    }
  });

  return {
    controller,
    state,
    document,
    window,
    header,
    elements,
    positions,
    calls,
    element(id) {
      return elements.get(id) ?? null;
    }
  };
}

test("updateLabels renders current branch and cash names", () => {
  const h = createHarness();
  h.controller.updateLabels();
  assert.equal(h.element("branch-current-label-v23013").textContent, "Centro");
  assert.equal(h.element("branch-current-label-v23013").title, "Centro");
  assert.equal(h.element("cash-current-label-v23013").textContent, "Caja 1");
  assert.equal(h.element("cash-current-label-v23013").title, "Caja 1");
});

test("updateLabels preserves Sin sucursal fallback", () => {
  const h = createHarness({ branch: { id: null, name: "" } });
  h.controller.updateLabels();
  assert.equal(h.element("branch-current-label-v23013").textContent, "Sin sucursal");
  assert.equal(h.element("branch-current-label-v23013").title, "");
});

test("updateLabels preserves Sin caja fallback", () => {
  const h = createHarness({ cashRegister: { id: null, name: "" } });
  h.controller.updateLabels();
  assert.equal(h.element("cash-current-label-v23013").textContent, "Sin caja");
  assert.equal(h.element("cash-current-label-v23013").title, "");
});

test("open Branch closes Cash, User, Management and sets aria-expanded", () => {
  const h = createHarness();
  const cashMenu = h.element("cash-menu-v23013");
  cashMenu.classList.remove("hidden");
  h.element("cash-trigger-v23013").setAttribute("aria-expanded", "true");

  h.controller.toggle("branch", true);

  assert.equal(h.element("branch-menu-v23013").classList.contains("hidden"), false);
  assert.equal(h.element("branch-trigger-v23013").getAttribute("aria-expanded"), "true");
  assert.equal(cashMenu.classList.contains("hidden"), true);
  assert.equal(h.element("cash-trigger-v23013").getAttribute("aria-expanded"), "false");
  assert.equal(h.calls.userClose, 1);
  assert.equal(h.calls.managementClose, 1);
  assert.deepEqual(h.positions[0].options, {
    minWidth: 248,
    maxWidth: 300,
    gap: 8,
    margin: 10
  });
});

test("close Branch hides menu and clears aria-expanded", () => {
  const h = createHarness();
  h.controller.toggle("branch", true);
  h.controller.toggle("branch", false);
  assert.equal(h.element("branch-menu-v23013").classList.contains("hidden"), true);
  assert.equal(h.element("branch-trigger-v23013").getAttribute("aria-expanded"), "false");
});

test("open Cash mirrors Branch behavior", () => {
  const h = createHarness();
  h.controller.toggle("cash", true);
  assert.equal(h.element("cash-menu-v23013").classList.contains("hidden"), false);
  assert.equal(h.element("cash-trigger-v23013").getAttribute("aria-expanded"), "true");
  assert.equal(h.element("branch-menu-v23013").classList.contains("hidden"), true);
  assert.equal(h.calls.userClose, 1);
  assert.equal(h.calls.managementClose, 1);
});

test("close closes both pickers", () => {
  const h = createHarness();
  h.element("branch-menu-v23013").classList.remove("hidden");
  h.element("cash-menu-v23013").classList.remove("hidden");
  h.element("branch-trigger-v23013").setAttribute("aria-expanded", "true");
  h.element("cash-trigger-v23013").setAttribute("aria-expanded", "true");

  h.controller.close();

  assert.equal(h.element("branch-menu-v23013").classList.contains("hidden"), true);
  assert.equal(h.element("cash-menu-v23013").classList.contains("hidden"), true);
  assert.equal(h.element("branch-trigger-v23013").getAttribute("aria-expanded"), "false");
  assert.equal(h.element("cash-trigger-v23013").getAttribute("aria-expanded"), "false");
});

test("close(except) preserves the except menu", () => {
  const h = createHarness();
  h.element("branch-menu-v23013").classList.remove("hidden");
  h.element("cash-menu-v23013").classList.remove("hidden");
  h.element("branch-trigger-v23013").setAttribute("aria-expanded", "true");
  h.element("cash-trigger-v23013").setAttribute("aria-expanded", "true");

  h.controller.close("branch-menu-v23013");

  assert.equal(h.element("branch-menu-v23013").classList.contains("hidden"), false);
  assert.equal(h.element("branch-trigger-v23013").getAttribute("aria-expanded"), "true");
  assert.equal(h.element("cash-menu-v23013").classList.contains("hidden"), true);
  assert.equal(h.element("cash-trigger-v23013").getAttribute("aria-expanded"), "false");
});

test("Branch render preserves empty state", () => {
  const h = createHarness({ branches: [] });
  h.controller.renderBranchOptions();
  assert.match(
    h.element("branch-options-v23013").innerHTML,
    /No hay sucursales disponibles\./
  );
});

test("Branch render creates context picker options", () => {
  const h = createHarness();
  h.controller.renderBranchOptions();
  const html = h.element("branch-options-v23013").innerHTML;
  assert.match(html, /data-context-branch="branch-1"/);
  assert.match(html, /data-context-branch="branch-2"/);
  assert.match(html, /context-picker-option-v23013/);
  assert.match(html, /role="option"/);
});

test("active Branch option keeps aria-selected=true and active class", () => {
  const h = createHarness();
  h.controller.renderBranchOptions();
  const html = h.element("branch-options-v23013").innerHTML;
  assert.match(
    html,
    /class="context-picker-option-v23013 active"[\s\S]*?aria-selected="true"[\s\S]*?data-context-branch="branch-1"/
  );
  assert.match(html, /Sucursal actual/);
});

test("Branch names are escaped before rendering", () => {
  const h = createHarness({
    branches: [{ id: "branch-1", name: '<script>& "Sucursal"</script>' }]
  });
  h.controller.renderBranchOptions();
  const html = h.element("branch-options-v23013").innerHTML;
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;&amp; &quot;Sucursal&quot;&lt;\/script&gt;/);
});

test("current Branch selection closes without delegating", async () => {
  const h = createHarness();
  h.controller.toggle("branch", true);
  await h.controller.selectBranch("branch-1");
  assert.deepEqual(h.calls.branchSelect, []);
  assert.equal(h.element("branch-menu-v23013").classList.contains("hidden"), true);
});

test("new Branch selection delegates exactly once", async () => {
  const h = createHarness();
  await h.controller.selectBranch("branch-2");
  assert.deepEqual(h.calls.branchSelect, ["branch-2"]);
});

test("new Branch selection rerenders Branch, Cash and labels", async () => {
  const h = createHarness();
  const readsBefore = h.calls.branchReads;
  const cashBefore = h.calls.renderCash;
  await h.controller.selectBranch("branch-2");
  assert.ok(h.calls.branchReads > readsBefore);
  assert.equal(h.calls.renderCash, cashBefore + 1);
  assert.equal(h.element("branch-current-label-v23013").textContent, "Norte");
});

test("current Cash selection closes without delegating", async () => {
  const h = createHarness();
  h.controller.toggle("cash", true);
  await h.controller.selectCash("cash-1");
  assert.deepEqual(h.calls.cashSelect, []);
  assert.equal(h.element("cash-menu-v23013").classList.contains("hidden"), true);
});

test("new Cash selection delegates exactly once and refreshes label", async () => {
  const h = createHarness();
  const cashBefore = h.calls.renderCash;
  await h.controller.selectCash("cash-2");
  assert.deepEqual(h.calls.cashSelect, ["cash-2"]);
  assert.equal(h.calls.renderCash, cashBefore + 1);
  assert.equal(h.element("cash-current-label-v23013").textContent, "Caja 2");
});

test("Cash renderer is delegated and not duplicated", () => {
  const h = createHarness();
  const cashOptions = h.element("cash-options-v23013");
  cashOptions.innerHTML = "cash-owned-markup";
  h.controller.renderCashOptions();
  assert.equal(h.calls.renderCash, 1);
  assert.equal(cashOptions.innerHTML, "cash-owned-markup");
});

test("click outside closes Context Pickers", async () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.toggle("branch", true);
  const outside = new FakeElement({ id: "outside" });
  await h.document.emit("pointerdown", { target: outside });
  assert.equal(h.element("branch-menu-v23013").classList.contains("hidden"), true);
});

test("click inside Context Picker does not close", async () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.toggle("branch", true);
  const inside = new FakeElement({
    id: "inside",
    classes: ["context-picker-v23013"]
  });
  await h.document.emit("pointerdown", { target: inside });
  assert.equal(h.element("branch-menu-v23013").classList.contains("hidden"), false);
});

test("non-Element pointer target is tolerated", async () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.toggle("branch", true);
  await assert.doesNotReject(
    h.document.emit("pointerdown", { target: { nodeType: 3 } })
  );
  assert.equal(h.element("branch-menu-v23013").classList.contains("hidden"), true);
});

test("Escape closes Context Pickers", async () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.toggle("cash", true);
  await h.document.emit("keydown", { key: "Escape" });
  assert.equal(h.element("cash-menu-v23013").classList.contains("hidden"), true);
});

test("non-Escape key leaves Context Picker open", async () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.toggle("cash", true);
  await h.document.emit("keydown", { key: "Enter" });
  assert.equal(h.element("cash-menu-v23013").classList.contains("hidden"), false);
});

test("window scroll closes Context Pickers", async () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.toggle("branch", true);
  await h.window.emit("scroll");
  assert.equal(h.element("branch-menu-v23013").classList.contains("hidden"), true);
});

test("header scroll closes Context Pickers", async () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.toggle("cash", true);
  await h.header.emit("scroll");
  assert.equal(h.element("cash-menu-v23013").classList.contains("hidden"), true);
});

test("resize repositions an open Branch picker", async () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.toggle("branch", true);
  h.positions.length = 0;
  await h.window.emit("resize");
  assert.equal(h.positions.length, 1);
  assert.equal(h.positions[0].menu.id, "branch-menu-v23013");
  assert.deepEqual(h.positions[0].options, {
    minWidth: 248,
    maxWidth: 300
  });
});

test("resize repositions an open Cash picker", async () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.toggle("cash", true);
  h.positions.length = 0;
  await h.window.emit("resize");
  assert.equal(h.positions.length, 1);
  assert.equal(h.positions[0].menu.id, "cash-menu-v23013");
});

test("resize does not reposition closed pickers", async () => {
  const h = createHarness();
  h.controller.setup();
  h.positions.length = 0;
  await h.window.emit("resize");
  assert.equal(h.positions.length, 0);
});

test("setup is idempotent across all owned listeners", () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.setup();

  assert.equal(h.element("branch-trigger-v23013").listenerCount("click"), 1);
  assert.equal(h.element("cash-trigger-v23013").listenerCount("click"), 1);
  assert.equal(h.element("branch-options-v23013").listenerCount("click"), 1);
  assert.equal(h.element("cash-options-v23013").listenerCount("click"), 1);
  assert.equal(h.document.listenerCount("pointerdown"), 1);
  assert.equal(h.document.listenerCount("keydown"), 1);
  assert.equal(h.window.listenerCount("scroll"), 1);
  assert.equal(h.window.listenerCount("resize"), 1);
  assert.equal(h.header.listenerCount("scroll"), 1);
});

test("missing Context Picker DOM degrades to no-op without crashing", () => {
  const h = createHarness({
    missingIds: [
      "branch-menu-v23013",
      "branch-trigger-v23013",
      "cash-menu-v23013",
      "cash-trigger-v23013",
      "branch-current-label-v23013",
      "cash-current-label-v23013",
      "branch-options-v23013",
      "cash-options-v23013",
      "header-actions"
    ]
  });

  assert.doesNotThrow(() => h.controller.close());
  assert.doesNotThrow(() => h.controller.toggle("branch", true));
  assert.doesNotThrow(() => h.controller.toggle("cash", true));
  assert.doesNotThrow(() => h.controller.updateLabels());
  assert.doesNotThrow(() => h.controller.renderBranchOptions());
  assert.doesNotThrow(() => h.controller.renderCashOptions());
  assert.doesNotThrow(() => h.controller.setup());
});

test("typed Context Picker owner contains no backend or leaked legacy owners", () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "../../src/context/context-picker-controller.ts"
    ),
    "utf8"
  );

  for (const forbidden of [
    "supabase",
    "cambiarSucursalV2",
    "cambiarCajaDesdeSelectorV227",
    "cashControllerV232",
    "posControllerV232",
    "listarSucursalesAdminV226",
    "abrirModalSucursalV226",
    "crearCajaV226"
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden, "iu"));
  }
});
