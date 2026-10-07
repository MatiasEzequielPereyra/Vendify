import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  createActiveBranchController
} from "../../dist-ts/branches/active-branch-controller.js";

class FakeStorage {
  constructor(entries = []) {
    this.map = new Map(entries);
    this.writes = [];
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
    this.writes.push([key, String(value)]);
  }
}

class FakeOption {
  constructor() {
    this.value = "";
    this.textContent = "";
  }
}

class FakeSelect {
  constructor() {
    this.value = "";
    this.children = [];
    this.listeners = new Map();
  }

  replaceChildren(...children) {
    this.children = children;
  }

  addEventListener(type, listener) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(listener);
    this.listeners.set(type, bucket);
  }

  listenerCount(type) {
    return (this.listeners.get(type) ?? []).length;
  }

  async emit(type, value) {
    this.value = value;
    for (const listener of this.listeners.get(type) ?? []) {
      await listener({ target: this });
    }
  }
}

class FakeDocument {
  constructor({ withSelector = true } = {}) {
    this.selector = withSelector ? new FakeSelect() : null;
  }

  getElementById(id) {
    return id === "branch-selector-v226" ? this.selector : null;
  }

  createElement(tag) {
    assert.equal(tag, "option");
    return new FakeOption();
  }
}

function branch(id, nombre) {
  return { id, nombre };
}

function cash(id, nombre) {
  return { id, nombre };
}

function createHarness({
  branches = [branch("a", "Centro"), branch("b", "Norte")],
  currentBranch = branch("a", "Centro"),
  currentCash = cash("cash-a", "Caja A"),
  businessId = "biz-1",
  persisted = null,
  cartSize = 0,
  confirmResult = true,
  saleVisible = false,
  withSelector = true,
  listError = null,
  getErrorFor = null,
  listValue = undefined
} = {}) {
  const document = new FakeDocument({ withSelector });
  const storage = new FakeStorage(
    persisted == null || businessId == null
      ? []
      : [[`vendify_branch_${businessId}`, persisted]]
  );
  const state = {
    businessId,
    context: {
      branch: currentBranch ? { ...currentBranch } : null,
      cashRegister: currentCash ? { ...currentCash } : null
    },
    branches: branches.map((item) => ({ ...item })),
    branchContexts: new Map([
      ["a", { branch: branch("a", "Centro"), cashRegister: cash("cash-a", "Caja A") }],
      ["b", { branch: branch("b", "Norte"), cashRegister: cash("cash-b", "Caja B") }],
      ["c", { branch: branch("c", "Sur"), cashRegister: cash("cash-c", "Caja C") }]
    ]),
    listValue,
    cartSize,
    confirmResult,
    saleVisible,
    listError,
    getErrorFor
  };
  const calls = {
    rpc: [],
    setContext: [],
    updateContextUi: 0,
    confirm: [],
    toast: [],
    clearCart: 0,
    loadCash: [],
    branchOptions: 0,
    cashOptions: 0,
    labels: 0,
    offline: 0,
    loadProducts: 0,
    updateFilter: 0,
    renderProducts: 0,
    renderSale: 0,
    realtime: 0,
    logger: []
  };

  const client = {
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if (name === "listar_sucursales_app") {
        if (state.listError) {
          return { data: null, error: { message: state.listError } };
        }
        return {
          data: state.listValue === undefined ? state.branches : state.listValue,
          error: null
        };
      }
      if (name === "obtener_contexto_sucursal") {
        const id = args?.p_sucursal_id;
        if (state.getErrorFor === id) {
          return { data: null, error: { message: `falló ${id}` } };
        }
        return {
          data: state.branchContexts.get(id) ?? {
            branch: branch(id, id),
            cashRegister: cash(`cash-${id}`, `Caja ${id}`)
          },
          error: null
        };
      }
      throw new Error(`RPC inesperado: ${name}`);
    }
  };

  const controller = createActiveBranchController({
    client,
    getBusinessId: () => state.businessId,
    getCurrentBranchId: () => state.context.branch?.id ?? null,
    getCartSize: () => state.cartSize,
    setContext(context) {
      calls.setContext.push(context);
      state.context = {
        branch: context.branch ? { ...context.branch } : null,
        cashRegister: context.cashRegister ? { ...context.cashRegister } : null
      };
    },
    updateContextUi() {
      calls.updateContextUi += 1;
    },
    async confirm(title, message) {
      calls.confirm.push({ title, message });
      return state.confirmResult;
    },
    showToast(message, type) {
      calls.toast.push({ message, type });
    },
    clearCart() {
      calls.clearCart += 1;
      state.cartSize = 0;
    },
    async loadCashRegisters(options) {
      calls.loadCash.push(options);
    },
    renderContextBranchOptions() {
      calls.branchOptions += 1;
    },
    renderContextCashOptions() {
      calls.cashOptions += 1;
    },
    updateContextLabels() {
      calls.labels += 1;
    },
    persistOfflineContext() {
      calls.offline += 1;
    },
    async loadProducts() {
      calls.loadProducts += 1;
    },
    updateCategoryFilter() {
      calls.updateFilter += 1;
    },
    renderProducts() {
      calls.renderProducts += 1;
    },
    renderSaleProducts() {
      calls.renderSale += 1;
    },
    isSaleModalVisible() {
      return state.saleVisible;
    },
    subscribeRealtime() {
      calls.realtime += 1;
    },
    storage,
    document,
    logger: {
      error(...args) {
        calls.logger.push(args);
      }
    }
  });

  return { controller, state, calls, document, storage };
}

function branchRpcCalls(h) {
  return h.calls.rpc.filter((call) => call.name === "obtener_contexto_sucursal");
}

test("list branches normalizes backend data and getBranches returns an isolated snapshot", async () => {
  const h = createHarness();
  await h.controller.initialize();

  const first = h.controller.getBranches();
  assert.deepEqual(first, [
    { id: "a", name: "Centro" },
    { id: "b", name: "Norte" }
  ]);
  first[0].name = "mutado";
  assert.equal(h.controller.getBranches()[0].name, "Centro");
});

test("non-array branch payload degrades to an empty list without crashing", async () => {
  const h = createHarness({ listValue: { id: "bad" } });
  await assert.doesNotReject(h.controller.initialize());
  assert.deepEqual(h.controller.getBranches(), []);
  assert.deepEqual(h.document.selector.children, []);
  assert.equal(branchRpcCalls(h).length, 0);
});

test("initialize list error is logged and does not become fatal or show a toast", async () => {
  const h = createHarness({ listError: "sin ramas" });
  await assert.doesNotReject(h.controller.initialize());
  assert.equal(h.calls.logger.length, 1);
  assert.equal(h.calls.logger[0][0], "[V2.26] listarSucursales:");
  assert.deepEqual(h.calls.toast, []);
});

test("initialize empty list renders selector and does not change context", async () => {
  const h = createHarness({ branches: [] });
  await h.controller.initialize();
  assert.deepEqual(h.controller.getBranches(), []);
  assert.equal(branchRpcCalls(h).length, 0);
  assert.equal(h.calls.setContext.length, 0);
});

test("persisted valid branch wins and initial switch uses reload=false", async () => {
  const h = createHarness({ persisted: "b" });
  await h.controller.initialize();

  assert.deepEqual(branchRpcCalls(h).map((call) => call.args.p_sucursal_id), ["b"]);
  assert.equal(h.state.context.branch.id, "b");
  assert.equal(h.state.context.cashRegister.id, "cash-b");
  assert.deepEqual(h.calls.loadCash, [{ keep: true }]);
  assert.equal(h.calls.updateContextUi, 1);
  assert.equal(h.calls.cashOptions, 1);
  assert.equal(h.calls.offline, 1);
  assert.equal(h.calls.realtime, 1);
  assert.equal(h.calls.clearCart, 0);
  assert.equal(h.calls.loadProducts, 0);
  assert.equal(h.calls.updateFilter, 0);
  assert.equal(h.calls.renderProducts, 0);
  assert.equal(h.calls.renderSale, 0);
  assert.equal(h.document.selector.value, "b");
  assert.deepEqual(h.storage.writes.at(-1), ["vendify_branch_biz-1", "b"]);
});

test("current valid branch is the fallback and avoids getBranchContext", async () => {
  const h = createHarness({ persisted: null, currentBranch: branch("b", "Norte") });
  await h.controller.initialize();
  assert.equal(branchRpcCalls(h).length, 0);
  assert.equal(h.state.context.branch.id, "b");
  assert.equal(h.document.selector.value, "b");
});

test("first branch is fallback when neither persisted nor current branch is valid", async () => {
  const h = createHarness({
    persisted: null,
    currentBranch: branch("z", "Vieja")
  });
  await h.controller.initialize();
  assert.deepEqual(branchRpcCalls(h).map((call) => call.args.p_sucursal_id), ["a"]);
  assert.equal(h.state.context.branch.id, "a");
  assert.equal(h.calls.clearCart, 0);
  assert.equal(h.calls.loadProducts, 0);
});

test("invalid persisted branch is ignored without backend lookup", async () => {
  const h = createHarness({
    persisted: "missing",
    currentBranch: branch("b", "Norte")
  });
  await h.controller.initialize();
  assert.equal(branchRpcCalls(h).length, 0);
  assert.equal(h.state.context.branch.id, "b");
});

test("invalid persisted branch falls back to first available branch, never invalid id", async () => {
  const h = createHarness({
    persisted: "missing",
    currentBranch: branch("z", "Vieja")
  });
  await h.controller.initialize();
  assert.deepEqual(branchRpcCalls(h).map((call) => call.args.p_sucursal_id), ["a"]);
});

test("successful switch without business id does not write branch persistence", async () => {
  const h = createHarness({ businessId: null });
  await h.controller.select("b");
  assert.equal(h.storage.writes.length, 0);
  assert.equal(h.state.context.branch.id, "b");
});

test("reload=true runs cart/product path and visible Sale modal refresh exactly once", async () => {
  const h = createHarness({ saleVisible: true });
  await h.controller.select("b");

  assert.equal(h.calls.confirm.length, 0);
  assert.equal(h.calls.clearCart, 1);
  assert.equal(h.calls.loadProducts, 1);
  assert.equal(h.calls.updateFilter, 1);
  assert.equal(h.calls.renderProducts, 1);
  assert.equal(h.calls.renderSale, 1);
  assert.equal(h.calls.realtime, 1);
  assert.deepEqual(h.calls.toast, [
    { message: "Sucursal activa: Norte", type: "success" }
  ]);
});

test("hidden or missing-equivalent Sale modal path does not render Sale products", async () => {
  const h = createHarness({ saleVisible: false });
  await h.controller.select("b");
  assert.equal(h.calls.renderSale, 0);
});

test("empty and current selection are no-ops", async () => {
  const h = createHarness();
  await h.controller.select("");
  await h.controller.select("a");
  assert.equal(h.calls.rpc.length, 0);
  assert.equal(h.calls.confirm.length, 0);
  assert.equal(h.calls.clearCart, 0);
  assert.deepEqual(h.calls.toast, []);
});

test("cart selection confirms with exact copy and success clears/reloads once", async () => {
  const h = createHarness({ cartSize: 3, confirmResult: true });
  await h.controller.select("b");

  assert.deepEqual(h.calls.confirm, [{
    title: "Cambiar de sucursal",
    message: "El carrito actual se vaciará al cambiar de sucursal."
  }]);
  assert.equal(branchRpcCalls(h).length, 1);
  assert.equal(h.calls.clearCart, 1);
  assert.equal(h.calls.loadProducts, 1);
  assert.equal(h.calls.branchOptions >= 1, true);
  assert.equal(h.calls.cashOptions, 1);
  assert.equal(h.calls.offline, 1);
  assert.equal(h.calls.realtime, 1);
  assert.equal(h.calls.toast.at(-1).type, "success");
});

test("cart cancel restores selector and performs no backend or reload work", async () => {
  const h = createHarness({ cartSize: 2, confirmResult: false });
  h.document.selector.value = "b";
  await h.controller.select("b");

  assert.equal(h.document.selector.value, "a");
  assert.equal(branchRpcCalls(h).length, 0);
  assert.equal(h.calls.clearCart, 0);
  assert.equal(h.calls.loadProducts, 0);
  assert.equal(h.calls.realtime, 0);
  assert.equal(h.state.context.branch.id, "a");
  assert.deepEqual(h.calls.toast, []);
});

test("backend failure is atomic: previous branch/cash, selector and storage remain unchanged", async () => {
  const h = createHarness({ getErrorFor: "b" });
  h.document.selector.value = "b";
  const beforeContext = structuredClone(h.state.context);
  const writesBefore = h.storage.writes.length;

  await h.controller.select("b");

  assert.deepEqual(h.state.context, beforeContext);
  assert.equal(h.document.selector.value, "a");
  assert.equal(h.storage.writes.length, writesBefore);
  assert.equal(h.calls.setContext.length, 0);
  assert.equal(h.calls.clearCart, 0);
  assert.equal(h.calls.loadProducts, 0);
  assert.equal(h.calls.realtime, 0);
  assert.deepEqual(h.calls.toast, [
    { message: "falló b", type: "error" }
  ]);
});

test("refresh updates branch list without changing a still-valid current context", async () => {
  const h = createHarness();
  await h.controller.initialize();
  h.state.branches = [branch("a", "Centro actualizado"), branch("c", "Sur")];
  h.calls.rpc.length = 0;
  h.calls.setContext.length = 0;

  await h.controller.refresh();

  assert.deepEqual(h.controller.getBranches(), [
    { id: "a", name: "Centro actualizado" },
    { id: "c", name: "Sur" }
  ]);
  assert.equal(branchRpcCalls(h).length, 0);
  assert.equal(h.calls.setContext.length, 0);
});

test("refresh removed active branch falls back to first with reload=true", async () => {
  const h = createHarness({ currentBranch: branch("b", "Norte") });
  await h.controller.initialize();
  h.state.branches = [branch("a", "Centro"), branch("c", "Sur")];
  h.calls.rpc.length = 0;
  h.calls.clearCart = 0;
  h.calls.loadProducts = 0;
  h.calls.realtime = 0;

  await h.controller.refresh();

  assert.deepEqual(branchRpcCalls(h).map((call) => call.args.p_sucursal_id), ["a"]);
  assert.equal(h.state.context.branch.id, "a");
  assert.equal(h.calls.clearCart, 1);
  assert.equal(h.calls.loadProducts, 1);
  assert.deepEqual(h.calls.loadCash.at(-1), { keep: true });
  assert.equal(h.calls.realtime, 1);
});

test("refresh errors are logged and do not propagate or add toast", async () => {
  const h = createHarness();
  await h.controller.initialize();
  h.state.listError = "refresh fail";
  h.calls.logger.length = 0;
  h.calls.toast.length = 0;

  await assert.doesNotReject(h.controller.refresh());

  assert.equal(h.calls.logger.length, 1);
  assert.equal(h.calls.logger[0][0], "[V2.26] refrescar sucursales:");
  assert.deepEqual(h.calls.toast, []);
});

test("setup owns one selector change listener and delegates typed selection", async () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.setup();
  assert.equal(h.document.selector.listenerCount("change"), 1);

  await h.document.selector.emit("change", "b");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.state.context.branch.id, "b");
  assert.equal(branchRpcCalls(h).length, 1);
});

test("missing selector DOM is tolerated by setup, initialize, refresh and select", async () => {
  const h = createHarness({ withSelector: false });
  assert.doesNotThrow(() => h.controller.setup());
  await assert.doesNotReject(h.controller.initialize());
  await assert.doesNotReject(h.controller.refresh());
  await assert.doesNotReject(h.controller.select("b"));
});

test("factory construction does not eagerly execute Context Picker or lifecycle callbacks", () => {
  const h = createHarness();
  assert.equal(h.calls.branchOptions, 0);
  assert.equal(h.calls.cashOptions, 0);
  assert.equal(h.calls.labels, 0);
  assert.equal(h.calls.updateContextUi, 0);
  assert.equal(h.calls.loadCash.length, 0);
  assert.equal(h.calls.realtime, 0);
});

test("typed Active Branch source imports Context services and leaks no RPC/global/controller ownership", () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "../../src/branches/active-branch-controller.ts"
    ),
    "utf8"
  );

  assert.match(source, /listAppBranches/);
  assert.match(source, /getBranchContext/);

  for (const forbidden of [
    ".rpc(",
    "window.Vendify",
    "posControllerV232",
    "cashControllerV232",
    "contextPickerControllerV232",
    "realtimeControllerV232",
    "cargarProductos",
    "renderGrid",
    "appContext"
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
