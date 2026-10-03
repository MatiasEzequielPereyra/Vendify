import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createBranchAdministrationController
} from "../../dist-ts/branches/branch-administration-controller.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    for (const name of names) this.values.add(name);
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    if (force === undefined) {
      if (this.values.has(name)) {
        this.values.delete(name);
        return false;
      }
      this.values.add(name);
      return true;
    }

    if (force) this.values.add(name);
    else this.values.delete(name);

    return Boolean(force);
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.classList = new FakeClassList();
    this.dataset = {};
    this.listeners = new Map();
    this.selectorMap = new Map();
    this.textContent = "";
    this._innerHTML = "";
    this.focused = false;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  listenerCount(type) {
    return (this.listeners.get(type) ?? []).length;
  }

  dispatch(type, event = fakeEvent()) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
    return event;
  }

  querySelector(selector) {
    return this.selectorMap.get(selector) ?? null;
  }

  querySelectorAll() {
    return [];
  }

  focus() {
    this.focused = true;
  }
}

class FakeInput extends FakeElement {
  constructor(id = "") {
    super(id);
    this.value = "";
    this.checked = false;
  }
}

class FakeButton extends FakeElement {
  constructor(id = "") {
    super(id);
    this.disabled = false;
  }
}

function decodeAttribute(value) {
  return String(value)
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function datasetKey(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

class FakeContainer extends FakeElement {
  constructor(id = "") {
    super(id);
    this.actionNodes = [];
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.actionNodes = [];

    const buttonPattern = /<button[\s\S]*?data-branch-action="([^"]+)"[\s\S]*?<\/button>/g;

    for (const match of this._innerHTML.matchAll(buttonPattern)) {
      const html = match[0];
      const button = new FakeButton();
      button.dataset.branchAction = match[1];

      const dataPattern = /data-([a-z0-9-]+)="([^"]*)"/g;

      for (const dataMatch of html.matchAll(dataPattern)) {
        button.dataset[datasetKey(dataMatch[1])] =
          decodeAttribute(dataMatch[2]);
      }

      this.actionNodes.push(button);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelectorAll(selector) {
    const match = selector.match(
      /^\[data-branch-action="([^"]+)"\]$/
    );

    if (!match) return [];

    return this.actionNodes.filter(
      (node) => node.dataset.branchAction === match[1]
    );
  }
}

class FakeDocument {
  constructor(elements = []) {
    this.byId = new Map();
    this.selectors = new Map();

    for (const element of elements) {
      if (element.id) this.byId.set(element.id, element);
    }
  }

  getElementById(id) {
    return this.byId.get(id) ?? null;
  }

  querySelector(selector) {
    return this.selectors.get(selector) ?? null;
  }
}

globalThis.HTMLInputElement = FakeInput;
globalThis.HTMLButtonElement = FakeButton;

function fakeEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    }
  };
}

function branchesFixture() {
  return [
    {
      id: "branch-1",
      nombre: "Central",
      direccion: "Av. Principal 123",
      telefono: "111",
      stock_total: 12,
      activa: true,
      cajas: [
        {
          id: "cash-1",
          nombre: "Caja Principal",
          activa: true
        },
        {
          id: "cash-2",
          nombre: "Caja Secundaria",
          activa: false
        }
      ]
    },
    {
      id: "branch-2",
      nombre: "Norte",
      direccion: "Calle Norte 456",
      telefono: "222",
      stock_total: 4,
      activa: false,
      cajas: []
    }
  ];
}

function makeHarness({
  role = "owner",
  currentBranchId = "branch-1",
  branches = branchesFixture(),
  rpcOverrides = {}
} = {}) {
  const list = new FakeContainer("sucursales-list-v226");

  const branchModal = new FakeElement("modal-sucursal-v226");
  branchModal.classList.add("hidden");

  const branchTitle = new FakeElement("sucursal-modal-title-v226");
  const branchId = new FakeInput("sucursal-id-v226");
  const branchName = new FakeInput("sucursal-nombre-v226");
  const branchAddress = new FakeInput("sucursal-direccion-v226");
  const branchPhone = new FakeInput("sucursal-telefono-v226");
  const branchActive = new FakeInput("sucursal-activa-v226");
  const branchActiveRow = new FakeElement("sucursal-activa-row-v226");
  const branchError = new FakeElement("sucursal-error-v226");

  const saveBranchButton =
    new FakeButton("btn-guardar-sucursal-v226");
  saveBranchButton.textContent = "Guardar";

  const newBranchButton =
    new FakeButton("btn-nueva-sucursal-v226");
  const branchForm = new FakeElement("form-sucursal-v226");
  const closeBranchButton =
    new FakeButton("btn-cerrar-sucursal-v226");
  const cancelBranchButton =
    new FakeButton("btn-cancelar-sucursal-v226");
  const branchBackdrop = new FakeElement();

  const cashModal = new FakeElement("modal-caja-v226");
  cashModal.classList.add("hidden");

  const cashBranchId = new FakeInput("caja-sucursal-id-v226");
  const cashBranchLabel = new FakeElement("caja-sucursal-label-v226");
  const cashName = new FakeInput("caja-nombre-v226");
  const cashError = new FakeElement("caja-error-v226");
  const cashForm = new FakeElement("form-caja-v226");
  const closeCashButton = new FakeButton("btn-cerrar-caja-v226");
  const cancelCashButton = new FakeButton("btn-cancelar-caja-v226");
  const cashBackdrop = new FakeElement();

  const configTab = new FakeElement();
  const configGo = new FakeElement();

  branchModal.selectorMap.set(
    "#modal-sucursal-v226 .modal-backdrop",
    branchBackdrop
  );

  cashModal.selectorMap.set(
    "#modal-caja-v226 .modal-backdrop",
    cashBackdrop
  );

  const elements = [
    list,
    branchModal,
    branchTitle,
    branchId,
    branchName,
    branchAddress,
    branchPhone,
    branchActive,
    branchActiveRow,
    branchError,
    saveBranchButton,
    newBranchButton,
    branchForm,
    closeBranchButton,
    cancelBranchButton,
    cashModal,
    cashBranchId,
    cashBranchLabel,
    cashName,
    cashError,
    cashForm,
    closeCashButton,
    cancelCashButton
  ];

  const document = new FakeDocument(elements);

  document.selectors.set(
    "#modal-sucursal-v226 .modal-backdrop",
    branchBackdrop
  );
  document.selectors.set(
    "#modal-caja-v226 .modal-backdrop",
    cashBackdrop
  );
  document.selectors.set(
    '[data-config-tab="sucursales"]',
    configTab
  );
  document.selectors.set(
    '[data-config-go="sucursales"]',
    configGo
  );

  const calls = [];
  const toasts = [];
  const reloads = [];
  const scheduleCalls = [];
  const sequence = [];

  let refreshCount = 0;

  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      sequence.push(`rpc:${name}`);

      const override = rpcOverrides[name];
      if (override) return override(args);

      if (name === "listar_sucursales_admin_v1") {
        return Promise.resolve({
          data: branches,
          error: null
        });
      }

      if (name === "crear_sucursal_v1") {
        return Promise.resolve({
          data: { id: "branch-new" },
          error: null
        });
      }

      if (name === "actualizar_sucursal_v1") {
        return Promise.resolve({
          data: { id: args?.p_sucursal_id },
          error: null
        });
      }

      if (name === "crear_caja_v1") {
        return Promise.resolve({
          data: { id: "cash-new" },
          error: null
        });
      }

      if (name === "cambiar_estado_caja_v1") {
        return Promise.resolve({
          data: {
            id: args?.p_caja_id,
            activa: args?.p_activa
          },
          error: null
        });
      }

      throw new Error(`Unexpected RPC: ${name}`);
    }
  };

  const controller = createBranchAdministrationController({
    client,
    getRole: () => role,
    getCurrentBranchId: () => currentBranchId,
    refreshBranches: async () => {
      refreshCount += 1;
      sequence.push("refresh");
    },
    reloadCashRegisters: async (options) => {
      reloads.push(options);
      sequence.push("reload");
    },
    showToast: (message, type) => {
      toasts.push({ message, type });
      sequence.push(`toast:${message}`);
    },
    document,
    schedule: (callback, delay) => {
      scheduleCalls.push(delay);
      callback();
    }
  });

  return {
    controller,
    client,
    document,
    calls,
    toasts,
    reloads,
    sequence,
    scheduleCalls,

    get refreshCount() {
      return refreshCount;
    },

    elements: {
      list,
      branchModal,
      branchTitle,
      branchId,
      branchName,
      branchAddress,
      branchPhone,
      branchActive,
      branchActiveRow,
      branchError,
      saveBranchButton,
      newBranchButton,
      branchForm,
      closeBranchButton,
      cancelBranchButton,
      branchBackdrop,
      cashModal,
      cashBranchId,
      cashBranchLabel,
      cashName,
      cashError,
      cashForm,
      closeCashButton,
      cancelCashButton,
      cashBackdrop,
      configTab,
      configGo
    }
  };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

function action(harness, name, index = 0) {
  const items = harness.elements.list.querySelectorAll(
    `[data-branch-action="${name}"]`
  );

  assert.ok(
    items[index],
    `Expected action ${name} at index ${index}`
  );

  return items[index];
}

function rpcCalls(harness, name) {
  return harness.calls.filter((call) => call.name === name);
}

test("01 render shows loading before list resolves", async () => {
  let resolveList;

  const pending = new Promise((resolve) => {
    resolveList = resolve;
  });

  const h = makeHarness({
    rpcOverrides: {
      listar_sucursales_admin_v1: () => pending
    }
  });

  const renderPromise = h.controller.render();

  assert.match(
    h.elements.list.innerHTML,
    /Cargando sucursales/
  );

  resolveList({
    data: branchesFixture(),
    error: null
  });

  await renderPromise;
});

test("02 list error clears container and shows toast", async () => {
  const h = makeHarness({
    rpcOverrides: {
      listar_sucursales_admin_v1: () =>
        Promise.resolve({
          data: null,
          error: { message: "Sin permiso" }
        })
    }
  });

  await h.controller.render();

  assert.equal(h.elements.list.innerHTML, "");
  assert.deepEqual(h.toasts, [
    { message: "Sin permiso", type: "error" }
  ]);
});

test("03 branch card renders name address and stock", async () => {
  const h = makeHarness();

  await h.controller.render();

  const html = h.elements.list.innerHTML;

  assert.match(html, /Central/);
  assert.match(html, /Av\. Principal 123/);
  assert.match(html, /Stock/);
  assert.match(html, />12</);
});

test("04 current branch renders Actual badge", async () => {
  const h = makeHarness({
    currentBranchId: "branch-1"
  });

  await h.controller.render();

  assert.match(
    h.elements.list.innerHTML,
    /branch-status-v226 current/
  );
  assert.match(h.elements.list.innerHTML, /Actual/);
});

test("05 branch active and inactive state is preserved", async () => {
  const h = makeHarness();

  await h.controller.render();

  const html = h.elements.list.innerHTML;

  assert.match(html, /branch-status-v226 active/);
  assert.match(html, />\s*Activa\s*</);
  assert.match(html, /branch-card-v226 inactive/);
  assert.match(html, /branch-status-v226 inactive/);
  assert.match(html, />\s*Inactiva\s*</);
});

test("06 cash registers render active and inactive chips", async () => {
  const h = makeHarness();

  await h.controller.render();

  const html = h.elements.list.innerHTML;

  assert.match(html, /Caja Principal/);
  assert.match(html, /Caja Secundaria/);
  assert.match(html, /caja-chip-v226 inactive/);
});

test("07 branch without cash registers renders Sin cajas", async () => {
  const h = makeHarness();

  await h.controller.render();

  assert.match(
    h.elements.list.innerHTML,
    /<span class="hint">Sin cajas<\/span>/
  );
});

test("08 owner sees administration actions", async () => {
  const h = makeHarness({ role: "owner" });

  await h.controller.render();

  const html = h.elements.list.innerHTML;

  assert.match(html, /data-branch-action="edit"/);
  assert.match(html, /data-branch-action="add-box"/);
  assert.match(html, /data-branch-action="toggle-box"/);
});

test("09 admin sees administration actions", async () => {
  const h = makeHarness({ role: "admin" });

  await h.controller.render();

  const html = h.elements.list.innerHTML;

  assert.match(html, /data-branch-action="edit"/);
  assert.match(html, /data-branch-action="add-box"/);
  assert.match(html, /data-branch-action="toggle-box"/);
});

test("10 non-admin role does not see administration actions", async () => {
  const h = makeHarness({ role: "manager" });

  await h.controller.render();

  const html = h.elements.list.innerHTML;

  assert.doesNotMatch(html, /data-branch-action="edit"/);
  assert.doesNotMatch(html, /data-branch-action="add-box"/);
  assert.doesNotMatch(html, /data-branch-action="toggle-box"/);
});

test("11 backend HTML and attribute data is escaped", async () => {
  const h = makeHarness({
    branches: [
      {
        id: 'branch-"<danger>',
        nombre: `<script>"N"&'orte</script>`,
        direccion: `<img src=x onerror=alert(1)>`,
        stock_total: 1,
        activa: true,
        cajas: [
          {
            id: 'cash-"<bad>',
            nombre: `<b>"Caja"&'</b>`,
            activa: false
          }
        ]
      }
    ],
    currentBranchId: null
  });

  await h.controller.render();

  const html = h.elements.list.innerHTML;

  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<b>/);

  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;b&gt;/);

  assert.match(html, /&quot;/);
  assert.match(html, /&#39;/);
  assert.match(html, /&amp;/);
});

test("12 edit action opens the cached correct branch", async () => {
  const h = makeHarness();

  await h.controller.render();

  const before = h.calls.length;

  action(h, "edit", 1).dispatch("click");

  assert.equal(h.elements.branchId.value, "branch-2");
  assert.equal(h.elements.branchName.value, "Norte");
  assert.equal(
    h.elements.branchAddress.value,
    "Calle Norte 456"
  );
  assert.equal(h.calls.length, before);
});

test("13 add-box opens Cash modal for correct branch", async () => {
  const h = makeHarness();

  await h.controller.render();

  action(h, "add-box", 1).dispatch("click");

  assert.equal(h.elements.cashBranchId.value, "branch-2");
  assert.equal(h.elements.cashBranchLabel.textContent, "Norte");
  assert.equal(
    h.elements.cashModal.classList.contains("hidden"),
    false
  );
});

test("14 toggle-box sends target boolean to typed service", async () => {
  const activeHarness = makeHarness({
    branches: [
      {
        id: "branch-a",
        nombre: "A",
        activa: true,
        cajas: [
          { id: "cash-active", nombre: "A", activa: true }
        ]
      }
    ]
  });

  await activeHarness.controller.render();
  activeHarness.calls.length = 0;

  action(activeHarness, "toggle-box").dispatch("click");
  await flush();

  assert.equal(
    rpcCalls(activeHarness, "cambiar_estado_caja_v1")[0]
      .args.p_activa,
    false
  );

  const inactiveHarness = makeHarness({
    branches: [
      {
        id: "branch-b",
        nombre: "B",
        activa: true,
        cajas: [
          { id: "cash-inactive", nombre: "B", activa: false }
        ]
      }
    ]
  });

  await inactiveHarness.controller.render();
  inactiveHarness.calls.length = 0;

  action(inactiveHarness, "toggle-box").dispatch("click");
  await flush();

  assert.equal(
    rpcCalls(inactiveHarness, "cambiar_estado_caja_v1")[0]
      .args.p_activa,
    true
  );
});

test("15 toggle success rerenders refreshes branches and reloads cash", async () => {
  const h = makeHarness();

  await h.controller.render();

  h.calls.length = 0;
  h.sequence.length = 0;

  action(h, "toggle-box").dispatch("click");
  await flush();

  assert.deepEqual(
    h.calls.map((call) => call.name),
    [
      "cambiar_estado_caja_v1",
      "listar_sucursales_admin_v1"
    ]
  );

  assert.equal(h.refreshCount, 1);
  assert.deepEqual(h.reloads, [{ keep: true }]);

  assert.deepEqual(
    h.sequence.slice(0, 4),
    [
      "rpc:cambiar_estado_caja_v1",
      "rpc:listar_sucursales_admin_v1",
      "refresh",
      "reload"
    ]
  );
});

test("16 toggle error shows toast and stops refresh chain", async () => {
  const h = makeHarness({
    rpcOverrides: {
      cambiar_estado_caja_v1: () =>
        Promise.resolve({
          data: null,
          error: { message: "Toggle denegado" }
        })
    }
  });

  await h.controller.render();

  h.calls.length = 0;
  h.toasts.length = 0;

  action(h, "toggle-box").dispatch("click");
  await flush();

  assert.deepEqual(
    h.calls.map((call) => call.name),
    ["cambiar_estado_caja_v1"]
  );

  assert.equal(h.refreshCount, 0);
  assert.equal(h.reloads.length, 0);

  assert.deepEqual(h.toasts, [
    { message: "Toggle denegado", type: "error" }
  ]);
});

test("17 open new branch clears fields and focuses name", () => {
  const h = makeHarness();

  h.elements.branchId.value = "old-id";
  h.elements.branchName.value = "old-name";
  h.elements.branchAddress.value = "old-address";
  h.elements.branchPhone.value = "old-phone";
  h.elements.branchActive.checked = false;
  h.elements.branchError.textContent = "old-error";

  h.controller.openBranch();

  assert.equal(h.elements.branchTitle.textContent, "Nueva sucursal");
  assert.equal(h.elements.branchId.value, "");
  assert.equal(h.elements.branchName.value, "");
  assert.equal(h.elements.branchAddress.value, "");
  assert.equal(h.elements.branchPhone.value, "");
  assert.equal(h.elements.branchActive.checked, true);
  assert.equal(h.elements.branchError.textContent, "");
  assert.equal(
    h.elements.branchModal.classList.contains("hidden"),
    false
  );
  assert.equal(h.elements.branchName.focused, true);
  assert.deepEqual(h.scheduleCalls, [50]);
});

test("18 open edit branch fills fields", () => {
  const h = makeHarness();

  h.controller.openBranch({
    id: "branch-edit",
    nombre: "Editada",
    direccion: "Dirección",
    telefono: "555",
    activa: false
  });

  assert.equal(h.elements.branchTitle.textContent, "Editar sucursal");
  assert.equal(h.elements.branchId.value, "branch-edit");
  assert.equal(h.elements.branchName.value, "Editada");
  assert.equal(h.elements.branchAddress.value, "Dirección");
  assert.equal(h.elements.branchPhone.value, "555");
  assert.equal(h.elements.branchActive.checked, false);
});

test("19 active row is hidden when creating branch", () => {
  const h = makeHarness();

  h.controller.openBranch();

  assert.equal(
    h.elements.branchActiveRow.classList.contains("hidden"),
    true
  );
});

test("20 active row is visible when editing branch", () => {
  const h = makeHarness();

  h.controller.openBranch({
    id: "branch-1",
    nombre: "Central",
    activa: true
  });

  assert.equal(
    h.elements.branchActiveRow.classList.contains("hidden"),
    false
  );
});

test("21 close branch hides modal", () => {
  const h = makeHarness();

  h.controller.openBranch();
  h.controller.closeBranch();

  assert.equal(
    h.elements.branchModal.classList.contains("hidden"),
    true
  );
});

test("22 create branch uses typed RPC payload without active", async () => {
  const h = makeHarness();

  h.controller.setup();

  h.elements.branchId.value = "";
  h.elements.branchName.value = "  Nueva  ";
  h.elements.branchAddress.value = "  Calle 10  ";
  h.elements.branchPhone.value = "  1234  ";
  h.elements.branchActive.checked = false;

  h.elements.branchForm.dispatch("submit");
  await flush();

  const call = rpcCalls(h, "crear_sucursal_v1")[0];

  assert.deepEqual(call.args, {
    p_nombre: "Nueva",
    p_direccion: "Calle 10",
    p_telefono: "1234"
  });

  assert.equal(
    Object.prototype.hasOwnProperty.call(call.args, "p_activa"),
    false
  );
});

test("23 update branch sends current active checkbox", async () => {
  const h = makeHarness();

  h.controller.setup();

  h.elements.branchId.value = "branch-9";
  h.elements.branchName.value = " Editada ";
  h.elements.branchAddress.value = " ";
  h.elements.branchPhone.value = " 555 ";
  h.elements.branchActive.checked = false;

  h.elements.branchForm.dispatch("submit");
  await flush();

  assert.deepEqual(
    rpcCalls(h, "actualizar_sucursal_v1")[0].args,
    {
      p_sucursal_id: "branch-9",
      p_nombre: "Editada",
      p_direccion: null,
      p_telefono: "555",
      p_activa: false
    }
  );
});

test("24 save button is busy during save and restored afterward", async () => {
  let resolveCreate;

  const pendingCreate = new Promise((resolve) => {
    resolveCreate = resolve;
  });

  const h = makeHarness({
    rpcOverrides: {
      crear_sucursal_v1: () => pendingCreate
    }
  });

  h.controller.setup();

  h.elements.branchName.value = "Nueva";

  h.elements.branchForm.dispatch("submit");

  assert.equal(h.elements.saveBranchButton.disabled, true);
  assert.equal(
    h.elements.saveBranchButton.textContent,
    "Guardando..."
  );

  resolveCreate({
    data: { id: "new" },
    error: null
  });

  await flush();

  assert.equal(h.elements.saveBranchButton.disabled, false);
  assert.equal(h.elements.saveBranchButton.textContent, "Guardar");
});

test("25 branch save error stays visible and modal remains open", async () => {
  const h = makeHarness({
    rpcOverrides: {
      crear_sucursal_v1: () =>
        Promise.resolve({
          data: null,
          error: { message: "No autorizado" }
        })
    }
  });

  h.controller.setup();
  h.controller.openBranch();

  h.elements.branchName.value = "Nueva";

  h.elements.branchForm.dispatch("submit");
  await flush();

  assert.equal(h.elements.branchError.textContent, "No autorizado");
  assert.equal(
    h.elements.branchModal.classList.contains("hidden"),
    false
  );
  assert.equal(h.refreshCount, 0);
  assert.equal(h.toasts.length, 0);
  assert.equal(h.elements.saveBranchButton.disabled, false);
  assert.equal(h.elements.saveBranchButton.textContent, "Guardar");
});

test("26 branch create success closes refreshes rerenders and toasts", async () => {
  const h = makeHarness();

  h.controller.setup();
  h.controller.openBranch();

  h.elements.branchName.value = "Nueva";
  h.sequence.length = 0;

  h.elements.branchForm.dispatch("submit");
  await flush();

  assert.equal(
    h.elements.branchModal.classList.contains("hidden"),
    true
  );

  assert.equal(h.refreshCount, 1);

  assert.deepEqual(h.toasts.at(-1), {
    message: "Sucursal creada con Caja 1",
    type: "success"
  });

  assert.deepEqual(
    h.sequence.slice(0, 4),
    [
      "rpc:crear_sucursal_v1",
      "refresh",
      "rpc:listar_sucursales_admin_v1",
      "toast:Sucursal creada con Caja 1"
    ]
  );
});

test("27 branch update success preserves success flow", async () => {
  const h = makeHarness();

  h.controller.setup();

  h.controller.openBranch({
    id: "branch-1",
    nombre: "Central",
    direccion: "A",
    telefono: "1",
    activa: true
  });

  h.elements.branchName.value = "Central Editada";
  h.sequence.length = 0;

  h.elements.branchForm.dispatch("submit");
  await flush();

  assert.equal(
    h.elements.branchModal.classList.contains("hidden"),
    true
  );

  assert.equal(h.refreshCount, 1);

  assert.deepEqual(h.toasts.at(-1), {
    message: "Sucursal actualizada",
    type: "success"
  });

  assert.deepEqual(
    h.sequence.slice(0, 4),
    [
      "rpc:actualizar_sucursal_v1",
      "refresh",
      "rpc:listar_sucursales_admin_v1",
      "toast:Sucursal actualizada"
    ]
  );
});

test("28 open Cash modal fills branch id label and focuses name", () => {
  const h = makeHarness();

  h.elements.cashName.value = "old";
  h.elements.cashError.textContent = "old error";

  h.controller.openCash("branch-7", "Sucursal Siete");

  assert.equal(h.elements.cashBranchId.value, "branch-7");
  assert.equal(
    h.elements.cashBranchLabel.textContent,
    "Sucursal Siete"
  );
  assert.equal(h.elements.cashName.value, "");
  assert.equal(h.elements.cashError.textContent, "");
  assert.equal(
    h.elements.cashModal.classList.contains("hidden"),
    false
  );
  assert.equal(h.elements.cashName.focused, true);
  assert.deepEqual(h.scheduleCalls, [50]);
});

test("29 close Cash hides modal", () => {
  const h = makeHarness();

  h.controller.openCash("branch-1", "Central");
  h.controller.closeCash();

  assert.equal(
    h.elements.cashModal.classList.contains("hidden"),
    true
  );
});

test("30 create Cash receives branch and trimmed name", async () => {
  const h = makeHarness();

  h.controller.setup();
  h.controller.openCash("branch-8", "Sucursal Ocho");

  h.elements.cashName.value = "  Caja Nueva  ";

  h.elements.cashForm.dispatch("submit");
  await flush();

  assert.deepEqual(
    rpcCalls(h, "crear_caja_v1")[0].args,
    {
      p_sucursal_id: "branch-8",
      p_nombre: "Caja Nueva"
    }
  );
});

test("31 Cash create error remains visible and modal open", async () => {
  const h = makeHarness({
    rpcOverrides: {
      crear_caja_v1: () =>
        Promise.resolve({
          data: null,
          error: { message: "Caja denegada" }
        })
    }
  });

  h.controller.setup();
  h.controller.openCash("branch-1", "Central");

  h.elements.cashName.value = "Caja";

  h.elements.cashForm.dispatch("submit");
  await flush();

  assert.equal(h.elements.cashError.textContent, "Caja denegada");
  assert.equal(
    h.elements.cashModal.classList.contains("hidden"),
    false
  );
  assert.equal(h.refreshCount, 0);
  assert.equal(h.reloads.length, 0);
  assert.equal(h.toasts.length, 0);
});

test("32 Cash success executes render refresh reload and toast chain", async () => {
  const h = makeHarness();

  h.controller.setup();
  h.controller.openCash("branch-1", "Central");

  h.elements.cashName.value = "Caja Nueva";
  h.sequence.length = 0;

  h.elements.cashForm.dispatch("submit");
  await flush();

  assert.equal(
    h.elements.cashModal.classList.contains("hidden"),
    true
  );

  assert.equal(h.refreshCount, 1);
  assert.deepEqual(h.reloads, [{ keep: true }]);

  assert.deepEqual(h.toasts.at(-1), {
    message: "Caja creada",
    type: "success"
  });

  assert.deepEqual(
    h.sequence.slice(0, 5),
    [
      "rpc:crear_caja_v1",
      "rpc:listar_sucursales_admin_v1",
      "refresh",
      "reload",
      "toast:Caja creada"
    ]
  );
});

test("33 setup binds all Branch Administration listeners", () => {
  const h = makeHarness();

  h.controller.setup();

  const checks = [
    [h.elements.newBranchButton, "click"],
    [h.elements.branchForm, "submit"],
    [h.elements.closeBranchButton, "click"],
    [h.elements.cancelBranchButton, "click"],
    [h.elements.branchBackdrop, "click"],
    [h.elements.cashForm, "submit"],
    [h.elements.closeCashButton, "click"],
    [h.elements.cancelCashButton, "click"],
    [h.elements.cashBackdrop, "click"],
    [h.elements.configTab, "click"],
    [h.elements.configGo, "click"]
  ];

  for (const [element, event] of checks) {
    assert.equal(element.listenerCount(event), 1);
  }
});

test("34 setup is idempotent", () => {
  const h = makeHarness();

  h.controller.setup();
  h.controller.setup();
  h.controller.setup();

  const checks = [
    [h.elements.newBranchButton, "click"],
    [h.elements.branchForm, "submit"],
    [h.elements.closeBranchButton, "click"],
    [h.elements.cancelBranchButton, "click"],
    [h.elements.branchBackdrop, "click"],
    [h.elements.cashForm, "submit"],
    [h.elements.closeCashButton, "click"],
    [h.elements.cancelCashButton, "click"],
    [h.elements.cashBackdrop, "click"],
    [h.elements.configTab, "click"],
    [h.elements.configGo, "click"]
  ];

  for (const [element, event] of checks) {
    assert.equal(element.listenerCount(event), 1);
  }
});

test("35 missing DOM is safe and does not crash", async () => {
  const emptyDocument = new FakeDocument();

  const controller = createBranchAdministrationController({
    client: {
      rpc() {
        throw new Error("RPC must not run without list container");
      }
    },
    getRole: () => "owner",
    getCurrentBranchId: () => null,
    refreshBranches: async () => {},
    reloadCashRegisters: async () => {},
    showToast: () => {},
    document: emptyDocument,
    schedule: (callback) => callback()
  });

  assert.doesNotThrow(() => controller.setup());
  assert.doesNotThrow(() => controller.openBranch());
  assert.doesNotThrow(() => controller.closeBranch());
  assert.doesNotThrow(() => controller.openCash("x", "X"));
  assert.doesNotThrow(() => controller.closeCash());

  await assert.doesNotReject(() => controller.render());
});
