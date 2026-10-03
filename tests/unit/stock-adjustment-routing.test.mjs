import assert from "node:assert/strict";
import test from "node:test";

class FakeClassList {
  constructor(tokens = []) {
    this.tokens = new Set(tokens);
  }

  add(...tokens) {
    for (const token of tokens) this.tokens.add(token);
  }

  remove(...tokens) {
    for (const token of tokens) this.tokens.delete(token);
  }

  contains(token) {
    return this.tokens.has(token);
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
    attrs = {},
    dataset = {},
    classes = [],
    hidden = false,
    value = "",
    textContent = "",
    innerHTML = ""
  } = {}) {
    this.attributes = new Map(Object.entries(attrs));
    this.dataset = { ...dataset };
    this.classList = new FakeClassList(classes);
    this.hidden = hidden;
    this.value = value;
    this.textContent = textContent;
    this.innerHTML = innerHTML;
    this.disabled = false;
    this.scrollTop = 0;
    this.listeners = new Map();
    this.card = null;
  }

  addEventListener(type, listener) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(listener);
    this.listeners.set(type, bucket);
  }

  dispatch(type, target = this) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({
        type,
        target,
        preventDefault() {}
      });
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  closest(selector) {
    if (selector === "[data-action]" && this.attributes.has("data-action")) return this;
    if (selector === ".producto-card") return this.card;
    return null;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

class FakeHTMLElement extends FakeElement {}
class FakeInputElement extends FakeHTMLElement {}
class FakeSelectElement extends FakeHTMLElement {}
class FakeTextAreaElement extends FakeHTMLElement {}
class FakeButtonElement extends FakeHTMLElement {}
class FakeFormElement extends FakeHTMLElement {}

Object.assign(globalThis, {
  Element: FakeElement,
  HTMLElement: FakeHTMLElement,
  HTMLInputElement: FakeInputElement,
  HTMLSelectElement: FakeSelectElement,
  HTMLTextAreaElement: FakeTextAreaElement,
  HTMLButtonElement: FakeButtonElement,
  HTMLFormElement: FakeFormElement
});

const { createProductsController } = await import(
  "../../dist-ts/products/products-controller.js"
);
const { createInventoryController } = await import(
  "../../dist-ts/inventory/inventory-controller.js"
);

function installDocument(elements = new Map(), lists = new Map()) {
  globalThis.document = {
    querySelector(selector) {
      return elements.get(selector) ?? null;
    },

    querySelectorAll(selector) {
      return lists.get(selector) ?? [];
    }
  };
}

function productRecord(stock = 5) {
  return {
    id: "product-1",
    nombre: "Producto",
    marca: "Marca",
    presentacion: "Unidad",
    codigoBarras: "",
    categoria: "Otros",
    precioCompra: 10,
    precioVenta: 20,
    stock,
    stockMinimo: 2,
    foto: null,
    creado: null
  };
}

function createProductsHarness({ rpcData, stock = 5 } = {}) {
  const product = productRecord(stock);
  const inventoryCalls = [];
  const patches = [];
  const rpcCalls = [];
  const grid = new FakeHTMLElement();

  installDocument(new Map([
    ["#productos-grid", grid]
  ]));

  const store = {
    list: () => [product],
    listCategories: () => [],
    getSmartStock: () => null,
    patchStock(productId, nextStock) {
      patches.push([productId, nextStock]);
      if (product.id === productId) product.stock = nextStock;
    }
  };

  const controller = createProductsController({
    client: {
      async rpc(name, args) {
        rpcCalls.push({ name, args });
        return {
          data: rpcData ?? { stock: product.stock + Number(args?.p_delta ?? 0) },
          error: null
        };
      }
    },
    store,
    getBusinessId: () => "business-1",
    getBranch: () => ({ id: "branch-1", name: "Sucursal Centro" }),
    getRole: () => "owner",
    hasPermission: () => true,
    requirePermission: () => true,
    showToast: () => {},
    confirm: async () => true,
    formatPrice: (value) => String(value),
    applyPermissions: () => {},
    loadProductsOffline: () => false,
    saveProductsOffline: () => {},
    captureOfflineStockSnapshot: async () => {},
    refreshOnboarding: () => {},
    emitStockChange: () => {},
    scheduleSmartRefresh: () => {},
    renderSaleProducts: () => {},
    renderCart: () => {},
    isSaleOpen: () => false,
    addToCart: () => {},
    openInventoryAdjustment(...args) {
      inventoryCalls.push(args);
    },
    setEditingProductId: () => {},
    getEditingProductId: () => null,
    restoreSaleBehindProduct: () => {},
    shouldReturnCreatedProductToSale: () => false,
    clearPendingScannerProduct: () => {},
    returnToScannerFromEditor: () => false
  });

  controller.setup();

  function click(action) {
    const card = new FakeHTMLElement({ dataset: { id: product.id } });
    const button = new FakeHTMLElement({
      attrs: { "data-action": action }
    });
    button.card = card;
    grid.dispatch("click", button);
  }

  return {
    click,
    inventoryCalls,
    patches,
    rpcCalls,
    product
  };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
}

function createInventoryHarness({ stock = 8 } = {}) {
  const product = productRecord(stock);
  const modal = new FakeHTMLElement({ classes: ["hidden"] });
  const branchBadge = new FakeHTMLElement();
  const summaryTitle = new FakeHTMLElement();
  const adjustmentProduct = new FakeSelectElement();
  const adjustmentMode = new FakeSelectElement({ value: "sumar" });
  const adjustmentAmount = new FakeInputElement({ value: "1" });
  const adjustmentCurrent = new FakeHTMLElement();
  const adjustmentPreview = new FakeHTMLElement();
  const summaryTab = new FakeHTMLElement({
    attrs: { "data-inventory-tab": "resumen" },
    classes: ["active"]
  });
  const adjustmentTab = new FakeHTMLElement({
    attrs: { "data-inventory-tab": "ajuste" }
  });
  const summaryPanel = new FakeHTMLElement({
    attrs: { "data-inventory-panel": "resumen" },
    hidden: false,
    classes: ["active"]
  });
  const adjustmentPanel = new FakeHTMLElement({
    attrs: { "data-inventory-panel": "ajuste" },
    hidden: true
  });
  const content = new FakeHTMLElement();

  const elements = new Map([
    ["#modal-inventario", modal],
    ["#inventory-branch-badge", branchBadge],
    ["#inventory-summary-title", summaryTitle],
    ['[data-inventory-tab="ajuste"]', adjustmentTab],
    ["#inventory-adjust-product", adjustmentProduct],
    ["#inventory-adjust-mode", adjustmentMode],
    ["#inventory-adjust-amount", adjustmentAmount],
    ["#inventory-adjust-current", adjustmentCurrent],
    ["#inventory-adjust-preview", adjustmentPreview],
    [".inventory-content", content]
  ]);
  const lists = new Map([
    [".inventory-tab", [summaryTab, adjustmentTab]],
    [".inventory-panel", [summaryPanel, adjustmentPanel]]
  ]);
  installDocument(elements, lists);

  let reloadProductsCalls = 0;
  const controller = createInventoryController({
    client: {
      async rpc() {
        throw new Error("Inventory adjustment opening must not invoke an RPC");
      }
    },
    canManage: () => true,
    isSupervisor: () => false,
    hasManualStockPermission: () => true,
    requireManualStockPermission: () => true,
    getBranch: () => ({ id: "branch-1", name: "Sucursal Centro" }),
    listBranches: async () => [],
    getProducts: () => [product],
    mapProduct: (record) => record,
    productLabel: (item) => item.nombre ?? "Producto",
    formatDate: () => "",
    isLowStock: () => false,
    isOutOfStock: () => false,
    getSmartStock: () => null,
    showToast: () => {},
    confirm: async () => true,
    emitStockChange: () => {},
    async reloadProducts() {
      reloadProductsCalls += 1;
    },
    renderProducts: () => {}
  });

  return {
    controller,
    modal,
    adjustmentProduct,
    adjustmentMode,
    adjustmentAmount,
    adjustmentTab,
    adjustmentPanel,
    get reloadProductsCalls() {
      return reloadProductsCalls;
    }
  };
}

test("stock-number ajustar delegates to Inventory without delta", () => {
  const harness = createProductsHarness();

  harness.click("ajustar");

  assert.deepEqual(harness.inventoryCalls, [["product-1"]]);
  assert.equal(harness.rpcCalls.length, 0);
});

test("quick positive stock requiring reason delegates +1 to Inventory", async () => {
  const harness = createProductsHarness({
    rpcData: { requiere_motivo: true, stock: 6 }
  });

  harness.click("sumar");
  await flushAsyncWork();

  assert.deepEqual(harness.inventoryCalls, [["product-1", 1]]);
});

test("quick negative stock requiring reason delegates -1 to Inventory", async () => {
  const harness = createProductsHarness({
    rpcData: { requiere_motivo: true, stock: 4 }
  });

  harness.click("restar");
  await flushAsyncWork();

  assert.deepEqual(harness.inventoryCalls, [["product-1", -1]]);
});

test("normal quick stock does not open Inventory adjustment", async () => {
  const harness = createProductsHarness({
    rpcData: { requiere_motivo: false, stock: 6 }
  });

  harness.click("sumar");
  await flushAsyncWork();

  assert.deepEqual(harness.inventoryCalls, []);
  assert.deepEqual(harness.patches, [["product-1", 6]]);
});

test("Inventory adjustment without delta opens ajuste in establecer mode at current stock", async () => {
  const harness = createInventoryHarness({ stock: 8 });

  await harness.controller.openAdjustmentFromProduct("product-1");

  assert.equal(harness.modal.classList.contains("hidden"), false);
  assert.equal(harness.adjustmentTab.classList.contains("active"), true);
  assert.equal(harness.adjustmentTab.getAttribute("aria-selected"), "true");
  assert.equal(harness.adjustmentPanel.hidden, false);
  assert.equal(harness.adjustmentProduct.value, "product-1");
  assert.equal(harness.adjustmentMode.value, "establecer");
  assert.equal(harness.adjustmentAmount.value, "8");
  assert.equal(harness.reloadProductsCalls, 1);
});

test("Inventory positive delta opens sumar mode with absolute amount", async () => {
  const harness = createInventoryHarness({ stock: 8 });

  await harness.controller.openAdjustmentFromProduct("product-1", 3);

  assert.equal(harness.adjustmentProduct.value, "product-1");
  assert.equal(harness.adjustmentMode.value, "sumar");
  assert.equal(harness.adjustmentAmount.value, "3");
});

test("Inventory negative delta opens restar mode with absolute amount", async () => {
  const harness = createInventoryHarness({ stock: 8 });

  await harness.controller.openAdjustmentFromProduct("product-1", -4);

  assert.equal(harness.adjustmentProduct.value, "product-1");
  assert.equal(harness.adjustmentMode.value, "restar");
  assert.equal(harness.adjustmentAmount.value, "4");
});
