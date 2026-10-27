import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  createPlatformAdminController
} from "../../dist-ts/platform/platform-admin-controller.js";

class FakeClassList {
  constructor(initial = []) {
    this.values = new Set(initial);
  }
  add(...names) {
    names.forEach((name) => this.values.add(name));
  }
  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }
  contains(name) {
    return this.values.has(name);
  }
  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : Boolean(force);
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
}

class FakeElement {
  constructor({ classes = [] } = {}) {
    this.classList = new FakeClassList(classes);
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    this.disabled = false;
    this.isConnected = true;
    this.dataset = {};
    this.listeners = new Map();
    this.closestValues = new Map();
    this.queryValues = new Map();
  }
  addEventListener(type, listener) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(listener);
    this.listeners.set(type, bucket);
  }
  listenerCount(type) {
    return (this.listeners.get(type) ?? []).length;
  }
  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target: this, ...event });
    }
  }
  closest(selector) {
    return this.closestValues.get(selector) ?? null;
  }
  querySelector(selector) {
    return this.queryValues.get(selector) ?? null;
  }
}

class FakeDocument {
  constructor(entries = []) {
    this.elements = new Map(entries);
  }
  querySelector(selector) {
    return this.elements.get(selector) ?? null;
  }
  querySelectorAll(selector) {
    return this.elements.get(`${selector}:all`) ?? [];
  }
}

function makeDom() {
  const entries = new Map();
  for (const selector of [
    "#btn-platform-admin-v231",
    "#modal-platform-admin-v231",
    "#modal-platform-admin-v231 .modal-backdrop",
    "#btn-close-platform-v231",
    "#platform-businesses-v231",
    "#platform-trials-v231",
    "#platform-sales-v231",
    "#platform-errors-v231",
    "#platform-business-list-v231",
    "#platform-error-list-v231"
  ]) {
    entries.set(selector, new FakeElement());
  }
  entries.get("#btn-platform-admin-v231").classList.add("hidden");
  entries.get("#modal-platform-admin-v231").classList.add("hidden");
  return new FakeDocument(entries);
}

function createHarness({ online = true, withDom = true } = {}) {
  const document = withDom ? makeDom() : new FakeDocument();
  const state = {
    online,
    session: "admin-a",
    confirmation: true,
    confirmHook: null,
    responses: {
      es_admin_plataforma_v1: true,
      platform_overview_v1: {
        negocios: 4,
        trials: 2,
        ventas_hoy: 12345,
        errores_24h: 1
      },
      listar_negocios_plataforma_v2: { contract_version: 1, items: [business()], next_cursor: null },
      listar_errores_plataforma_v1: [{
        tipo: "window_error",
        mensaje: "boom",
        negocio_nombre: "Kiosco Centro",
        version: "2.31.1",
        creado: "2026-10-07T12:00:00Z"
      }],
      actualizar_plan_negocio_plataforma_v1: { ok: true }
    },
    errors: new Map(),
    hooks: new Map()
  };
  const calls = {
    rpc: [],
    closeUserMenu: 0,
    toast: [],
    confirmations: []
  };

  const client = {
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      const hook = state.hooks.get(name);
      if (hook) return hook(args);
      const error = state.errors.get(name);
      if (error) return { data: null, error: { message: error } };
      return { data: structuredClone(state.responses[name]), error: null };
    }
  };

  const controller = createPlatformAdminController({
    client,
    isOnline: () => state.online,
    getSessionKey: () => state.session,
    closeUserMenu() {
      calls.closeUserMenu += 1;
    },
    formatPrice: (value) => `ARS ${value}`,
    icon: (name) => `icon:${name}`,
    showToast(message, type) {
      calls.toast.push({ message, type });
    },
    async confirm(title, message) {
      calls.confirmations.push({ title, message });
      return state.confirmHook ? state.confirmHook(title, message) : state.confirmation;
    },
    document
  });

  return { controller, state, calls, document };
}

function el(h, selector) {
  return h.document.querySelector(selector);
}

function rpcCalls(h, name) {
  return h.calls.rpc.filter((call) => call.name === name);
}

function makePlanRow({
  businessId = "20000000-0000-4000-8000-000000000001",
  plan = "business",
  status = "activo"
} = {}) {
  const row = new FakeElement();
  row.dataset.platformBusiness = businessId;
  const planSelect = new FakeElement();
  planSelect.value = plan;
  const statusSelect = new FakeElement();
  statusSelect.value = status;
  row.queryValues.set(".platform-plan-select-v231", planSelect);
  row.queryValues.set(".platform-state-select-v231", statusSelect);

  const button = new FakeElement();
  button.textContent = "Guardar";
  button.closestValues.set("[data-platform-business]", row);
  button.closestValues.set("[data-platform-save-plan]", button);
  return { row, button, planSelect, statusSelect };
}


function business(overrides = {}) {
  return { id: "20000000-0000-4000-8000-000000000001", nombre: "Kiosco Centro", creado: "2026-10-01T00:00:00.000000Z", activo: true,
    suscripcion: { plan_codigo: "pro", plan_nombre: "Pro", estado: "activo", trial_hasta: null, limites: { usuarios: 10, sucursales: null, productos: 500 } },
    uso: { usuarios: 3, sucursales: 2, productos: 42 }, ...overrides };
}
function cursorFor(row, query = { search: null, plan_codigo: null, estado: null }, anchor = row) {
  return { version: 1, order: "creado_desc_id_desc", query, anchor: { creado: anchor.creado, id: anchor.id }, after: { creado: row.creado, id: row.id } };
}
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
const tick = () => new Promise((r) => setImmediate(r));

test("construction is lazy; setup is idempotent and missing DOM is tolerated", async () => {
  const h = createHarness();
  assert.equal(h.calls.rpc.length, 0);
  h.controller.setup(); h.controller.setup();
  assert.equal(el(h, "#platform-business-list-v231").listenerCount("click"), 1);
  assert.equal(el(h, "#platform-business-list-v231").listenerCount("submit"), 1);
  const absent = createHarness({ withDom: false });
  absent.controller.setup(); await absent.controller.refreshAccess(); await absent.controller.open(); absent.controller.close();
});

test("typed list replaces v1, preserves summary and renders accurate usage/limits", async () => {
  const h = createHarness(); await h.controller.open();
  assert.equal(rpcCalls(h, "listar_negocios_plataforma_v1").length, 0);
  assert.deepEqual(rpcCalls(h, "listar_negocios_plataforma_v2")[0].args, { p_search: null, p_plan_codigo: null, p_estado: null, p_cursor: null, p_limit: 50 });
  assert.equal(el(h, "#platform-businesses-v231").textContent, "4");
  assert.equal(el(h, "#platform-sales-v231").textContent, "ARS 12345");
  const list = el(h, "#platform-business-list-v231").innerHTML;
  assert.match(list, /Usuarios: 3 \/ 10/); assert.match(list, /Sucursales: 2 \/ sin límite/); assert.match(list, /Productos: 42 \/ 500/);
  assert.match(list, /Negocio activo/); assert.match(list, /Pro · activo/);
  assert.match(el(h, "#platform-error-list-v231").innerHTML, /boom/);
});

test("missing subscription is honest, no default selected and hostile names escaped", async () => {
  const h = createHarness(); h.state.responses.listar_negocios_plataforma_v2.items = [business({ nombre: '<img src=x onerror="alert(1)">', activo: false, suscripcion: null })];
  await h.controller.open(); const list = el(h, "#platform-business-list-v231").innerHTML;
  assert.match(list, /Sin suscripción/); assert.match(list, /sin límite informado/); assert.match(list, /Negocio inactivo/);
  assert.doesNotMatch(list, /<img/); assert.match(list, /&lt;img/); assert.doesNotMatch(list, /value="legacy" selected/);
});

test("cursor next/previous works and search/filter changes restart from first page", async () => {
  const h = createHarness(); const first = business(); const next = cursorFor(first);
  h.state.responses.listar_negocios_plataforma_v2.next_cursor = next;
  await h.controller.open();
  h.state.responses.listar_negocios_plataforma_v2 = { contract_version: 1, items: [business({ creado: "2026-09-01T00:00:00.000000Z" })], next_cursor: null };
  await h.controller.nextPage();
  assert.deepEqual(rpcCalls(h, "listar_negocios_plataforma_v2").at(-1).args.p_cursor, next);
  h.state.responses.listar_negocios_plataforma_v2 = { contract_version: 1, items: [first], next_cursor: next };
  await h.controller.previousPage(); assert.equal(rpcCalls(h, "listar_negocios_plataforma_v2").at(-1).args.p_cursor, null);
  h.state.responses.listar_negocios_plataforma_v2 = { contract_version: 1, items: [business({ creado: "2026-09-01T00:00:00.000000Z" })], next_cursor: null };
  await h.controller.nextPage();
  await h.controller.setQuery({ search: " Kiosco ", planCode: " PRO ", state: "activo" });
  assert.deepEqual(rpcCalls(h, "listar_negocios_plataforma_v2").at(-1).args, { p_search: "Kiosco", p_plan_codigo: "pro", p_estado: "activo", p_cursor: null, p_limit: 50 });
  assert.match(el(h, "#platform-business-list-v231").innerHTML, /Página 1/);
});

test("invalid query never reaches RPC; empty result is visible", async () => {
  const h = createHarness(); await h.controller.setQuery({ search: "x".repeat(121) }); assert.equal(h.calls.rpc.length, 0);
  h.state.responses.listar_negocios_plataforma_v2.items = []; await h.controller.open();
  assert.match(el(h, "#platform-business-list-v231").innerHTML, /No hay negocios/);
});

test("save validates current row and refreshes typed data after success", async () => {
  const h = createHarness(); await h.controller.open();
  h.state.hooks.set("actualizar_plan_negocio_plataforma_v1", () => {
    h.state.responses.listar_negocios_plataforma_v2.items[0].suscripcion.limites.usuarios = 80;
    return { data: { ok: true }, error: null };
  });
  const { button } = makePlanRow(); await h.controller.savePlan(button);
  assert.deepEqual(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1")[0].args, { p_negocio_id: business().id, p_plan_codigo: "business", p_estado: "activo" });
  assert.equal(rpcCalls(h, "listar_negocios_plataforma_v2").length, 2);
  assert.match(el(h, "#platform-business-list-v231").innerHTML, /Usuarios: 3 \/ 80/);
  assert.deepEqual(h.calls.toast, [{ message: "Plan actualizado", type: "success" }]);
  assert.equal(button.disabled, false);
});

test("status save preserves an existing custom plan outside classic catalogue", async () => {
  const h = createHarness(); h.state.responses.listar_negocios_plataforma_v2.items[0].suscripcion.plan_codigo = "custom_2026";
  await h.controller.open(); assert.match(el(h, "#platform-business-list-v231").innerHTML, /value="custom_2026" selected/);
  const { button } = makePlanRow({ plan: "custom_2026", status: "suspendido" }); await h.controller.savePlan(button);
  assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1")[0].args.p_plan_codigo, "custom_2026");
});

test("invalid or absent row, missing selections and offline prevent writes", async () => {
  const h = createHarness(); await h.controller.open();
  for (const args of [{ businessId: "invalid" }, { businessId: "20000000-0000-4000-8000-000000000099" }, { plan: "unread_custom" }, { status: "bad" }, { plan: "" }]) {
    await h.controller.savePlan(makePlanRow(args).button);
  }
  assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0);
  h.state.online = false; await h.controller.savePlan(makePlanRow().button);
  assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0);
  assert.doesNotMatch(el(h, "#platform-business-list-v231").innerHTML, /Kiosco Centro/);
});

test("save cannot double submit and shows pending state", async () => {
  const h = createHarness(); await h.controller.open(); const pending = deferred();
  h.state.hooks.set("actualizar_plan_negocio_plataforma_v1", () => pending.promise);
  const { button } = makePlanRow(); const promise = h.controller.savePlan(button);
  assert.equal(button.disabled, true); assert.equal(button.textContent, "Esperando confirmación...");
  await tick(); assert.equal(button.textContent, "Guardando...");
  await h.controller.savePlan(button); assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 1);
  pending.resolve({ data: { ok: true }, error: null }); await promise; assert.equal(button.disabled, false);
});

test("save denial clears privileged data and does not reload as success", async () => {
  const h = createHarness(); await h.controller.open(); h.state.errors.set("actualizar_plan_negocio_plataforma_v1", "denied");
  await h.controller.savePlan(makePlanRow().button);
  assert.equal(rpcCalls(h, "listar_negocios_plataforma_v2").length, 1);
  assert.doesNotMatch(el(h, "#platform-business-list-v231").innerHTML, /Kiosco Centro/);
  assert.equal(el(h, "#platform-error-list-v231").innerHTML, "");
  assert.equal(h.calls.toast.at(-1).type, "error");
});

test("denied or malformed v2 fails closed without legacy fallback or stale data", async () => {
  for (const malformed of [false, true]) {
    const h = createHarness(); await h.controller.open();
    if (malformed) h.state.responses.listar_negocios_plataforma_v2 = { items: [] };
    else h.state.errors.set("listar_negocios_plataforma_v2", "missing RPC or denied");
    await h.controller.open(); assert.doesNotMatch(el(h, "#platform-business-list-v231").innerHTML, /Kiosco Centro/);
    assert.equal(el(h, "#platform-error-list-v231").innerHTML, ""); assert.equal(el(h, "#platform-businesses-v231").textContent, "—");
    assert.equal(rpcCalls(h, "listar_negocios_plataforma_v1").length, 0);
  }
});

test("offline open/access never requests backend and reconnect can reload", async () => {
  const h = createHarness({ online: false }); await h.controller.open(); await h.controller.refreshAccess();
  assert.equal(h.calls.rpc.length, 0); assert.match(el(h, "#platform-business-list-v231").innerHTML, /Sin conexión/);
  h.state.online = true; await h.controller.open(); assert.match(el(h, "#platform-business-list-v231").innerHTML, /Kiosco Centro/);
});

test("access revocation invalidates an in-flight privileged response", async () => {
  const h = createHarness(); const pending = deferred(); h.state.hooks.set("listar_negocios_plataforma_v2", () => pending.promise);
  const loading = h.controller.open(); await tick();
  h.state.responses.es_admin_plataforma_v1 = false; await h.controller.refreshAccess();
  pending.resolve({ data: { contract_version: 1, items: [business()], next_cursor: null }, error: null }); await loading;
  assert.doesNotMatch(el(h, "#platform-business-list-v231").innerHTML, /Kiosco Centro/);
  assert.equal(el(h, "#btn-platform-admin-v231").classList.contains("hidden"), true);
});

test("session change and close discard late reads and saves", async () => {
  const h = createHarness(); const pending = deferred(); h.state.hooks.set("listar_negocios_plataforma_v2", () => pending.promise);
  const loading = h.controller.open(); await tick(); h.state.session = "admin-b";
  pending.resolve({ data: { contract_version: 1, items: [business()], next_cursor: null }, error: null }); await loading;
  assert.doesNotMatch(el(h, "#platform-business-list-v231").innerHTML, /Kiosco Centro/);
  h.state.hooks.delete("listar_negocios_plataforma_v2"); await h.controller.open();
  const save = deferred(); h.state.hooks.set("actualizar_plan_negocio_plataforma_v1", () => save.promise);
  const saving = h.controller.savePlan(makePlanRow().button); h.controller.close(); save.resolve({ data: { ok: true }, error: null }); await saving;
  assert.equal(el(h, "#platform-business-list-v231").innerHTML, ""); assert.deepEqual(h.calls.toast, []);
});

test("new query wins over slow older response", async () => {
  const h = createHarness(); const pending = deferred(); let first = true;
  h.state.hooks.set("listar_negocios_plataforma_v2", () => {
    if (first) { first = false; return pending.promise; }
    return { data: { contract_version: 1, items: [business({ nombre: "Resultado nuevo" })], next_cursor: null }, error: null };
  });
  const old = h.controller.open(); await tick(); await h.controller.setQuery({ search: "nuevo" });
  pending.resolve({ data: { contract_version: 1, items: [business()], next_cursor: null }, error: null }); await old;
  const list = el(h, "#platform-business-list-v231").innerHTML;
  assert.match(list, /Resultado nuevo/); assert.doesNotMatch(list, /Kiosco Centro/);
});

test("event delegation opens, closes and submits typed search without duplicate controls", async () => {
  const h = createHarness(); h.controller.setup(); el(h, "#btn-platform-admin-v231").emit("click"); await tick();
  assert.equal(h.calls.closeUserMenu, 1);
  const form = new FakeElement(); form.closestValues.set("[data-platform-search-form]", form);
  const search = new FakeElement(); search.value = "Centro"; form.queryValues.set("[data-platform-search]", search);
  let prevented = false;
  el(h, "#platform-business-list-v231").emit("submit", { target: form, preventDefault: () => { prevented = true; } }); await tick();
  assert.equal(prevented, true); assert.equal(rpcCalls(h, "listar_negocios_plataforma_v2").at(-1).args.p_search, "Centro");
  await h.controller.open(); assert.equal((el(h, "#platform-business-list-v231").innerHTML.match(/data-platform-search-form/g) ?? []).length, 1);
  el(h, "#btn-close-platform-v231").emit("click"); assert.equal(el(h, "#platform-business-list-v231").innerHTML, "");
});

test("controller keeps RPC and legacy ownership behind services", () => {
  const source = readFileSync(resolve(import.meta.dirname, "../../src/platform/platform-admin-controller.ts"), "utf8");
  for (const required of ["isPlatformAdmin", "loadPlatformSummary", "listPlatformBusinesses", "updateBusinessPlan"]) assert.equal(source.includes(required), true);
  for (const forbidden of [".rpc(", "window.Vendify", "supabaseClient", "loadPlatformBackoffice"]) assert.equal(source.includes(forbidden), false);
});


test("quoted names and search cannot create HTML attributes", async () => {
  const h = createHarness(); h.state.responses.listar_negocios_plataforma_v2.items[0].nombre = 'x" onfocus="alert(1)';
  await h.controller.setQuery({ search: 'x" onfocus="alert(1)' });
  const list = el(h, "#platform-business-list-v231").innerHTML;
  assert.match(list, /value="x&quot; onfocus=&quot;alert\(1\)"/);
  assert.doesNotMatch(list, /aria-label="[^"<>]*" onfocus=/);
});

test("visible access refresh reloads and save denial leaves retry controls enabled", async () => {
  const h = createHarness(); await h.controller.open(); await h.controller.refreshAccess();
  assert.match(el(h, "#platform-business-list-v231").innerHTML, /Kiosco Centro/);
  h.state.errors.set("actualizar_plan_negocio_plataforma_v1", "denied");
  await h.controller.savePlan(makePlanRow().button);
  const list = el(h, "#platform-business-list-v231").innerHTML;
  assert.doesNotMatch(list, /data-platform-refresh disabled/);
  assert.doesNotMatch(list, /type="submit"[^>]*disabled/);
});

test("offline event immediately clears privileged visible data and reconnect permits reload", async () => {
  const previous = globalThis.addEventListener;
  let offline;
  globalThis.addEventListener = (event, callback) => { if (event === "offline") offline = callback; };
  try {
    const h = createHarness(); h.controller.setup(); await h.controller.open(); h.state.online = false; offline();
    assert.doesNotMatch(el(h, "#platform-business-list-v231").innerHTML, /Kiosco Centro/);
    assert.equal(el(h, "#platform-error-list-v231").innerHTML, "");
    h.state.online = true; await h.controller.open(); assert.match(el(h, "#platform-business-list-v231").innerHTML, /Kiosco Centro/);
  } finally { if (previous) globalThis.addEventListener = previous; else delete globalThis.addEventListener; }
});

test("unchanged plan/state and an accidental delegated save click never confirm or write", async () => {
  const h = createHarness(); h.controller.setup(); await h.controller.open();
  const { button, row } = makePlanRow({ plan: "pro", status: "activo" });
  row.dataset.originalPlan = "business";
  await h.controller.savePlan(button);
  el(h, "#platform-business-list-v231").emit("click", { target: button }); await tick();
  assert.equal(button.disabled, true);
  assert.equal(h.calls.confirmations.length, 0);
  assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0);
  assert.match(el(h, "#platform-business-list-v231").innerHTML, /data-platform-save-plan="[^"]+"[^>]*disabled/);
});

test("changing a selection and restoring the loaded value disables Save again", async () => {
  const h = createHarness(); h.controller.setup(); await h.controller.open();
  const { button, planSelect } = makePlanRow({ plan: "pro", status: "activo" });
  h.document.elements.set("[data-platform-save-plan]:all", [button]);
  const list = el(h, "#platform-business-list-v231");
  list.emit("change"); assert.equal(button.disabled, true);
  planSelect.value = "business"; list.emit("change"); assert.equal(button.disabled, false);
  planSelect.value = "pro"; list.emit("change"); assert.equal(button.disabled, true);
  await h.controller.savePlan(button);
  assert.equal(h.calls.confirmations.length, 0);
  assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0);
});

test("real change confirmation names the business and exact loaded old/new values", async () => {
  const h = createHarness(); await h.controller.open();
  const { button, row } = makePlanRow({ plan: "business", status: "suspendido" });
  row.dataset.originalPlan = "business"; row.dataset.originalState = "suspendido";
  await h.controller.savePlan(button);
  assert.equal(h.calls.confirmations.length, 1);
  assert.equal(h.calls.confirmations[0].title, "Confirmar cambio de suscripción");
  assert.equal(h.calls.confirmations[0].message, [
    `Negocio: Kiosco Centro (${business().id})`, "Plan anterior: pro", "Plan nuevo: business", "Estado anterior: activo", "Estado nuevo: suspendido"
  ].join("\n"));
  assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 1);
});

test("missing subscription is not replaced by invented legacy defaults in confirmation", async () => {
  const h = createHarness(); h.state.responses.listar_negocios_plataforma_v2.items = [business({ suscripcion: null })];
  await h.controller.open(); await h.controller.savePlan(makePlanRow({ plan: "", status: "" }).button);
  assert.equal(h.calls.confirmations.length, 0);
  assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0);
  h.state.confirmation = false;
  await h.controller.savePlan(makePlanRow({ plan: "legacy", status: "legacy" }).button);
  assert.match(h.calls.confirmations[0].message, /Plan anterior: Sin suscripción/);
  assert.match(h.calls.confirmations[0].message, /Estado anterior: Sin suscripción/);
  assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0);
});

test("canceling confirmation never calls the write RPC or reports success", async () => {
  const h = createHarness(); await h.controller.open(); h.state.confirmation = false;
  await h.controller.savePlan(makePlanRow().button);
  assert.equal(h.calls.confirmations.length, 1);
  assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0);
  assert.deepEqual(h.calls.toast, []);
  assert.equal(rpcCalls(h, "listar_negocios_plataforma_v2").length, 1);
});

test("only an explicit boolean true confirmation can authorize the mock write", async () => {
  for (const value of [undefined, null, "yes", 1, {}, []]) {
    const h = createHarness(); await h.controller.open(); h.state.confirmation = value;
    await h.controller.savePlan(makePlanRow().button);
    assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0);
    assert.deepEqual(h.calls.toast, []);
  }
});

test("all Save controls remain disabled during confirmation and write; duplicate clicks send once", async () => {
  const h = createHarness(); const secondId = "20000000-0000-4000-8000-000000000002";
  h.state.responses.listar_negocios_plataforma_v2.items.push(business({ id: secondId, creado: "2026-09-01T00:00:00.000000Z" }));
  h.controller.setup(); await h.controller.open();
  const first = makePlanRow(); const second = makePlanRow({ businessId: secondId });
  h.document.elements.set("[data-platform-save-plan]:all", [first.button, second.button]);
  const confirmation = deferred(), write = deferred();
  h.state.confirmHook = () => confirmation.promise;
  h.state.hooks.set("actualizar_plan_negocio_plataforma_v1", () => write.promise);
  const pending = h.controller.savePlan(first.button);
  assert.equal(first.button.disabled, true); assert.equal(second.button.disabled, true);
  await h.controller.savePlan(first.button); await h.controller.savePlan(second.button);
  assert.equal(h.calls.confirmations.length, 1);
  assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0);
  confirmation.resolve(true); await tick();
  assert.equal(first.button.disabled, true); assert.equal(second.button.disabled, true);
  await h.controller.savePlan(second.button);
  assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 1);
  write.resolve({ data: { ok: true }, error: null }); await pending;
});

test("fresh permission check remains locked and denies expired/revoked authorization", async () => {
  for (const mode of ["revoked", "expired", "changed-session"]) {
    const h = createHarness(); await h.controller.open();
    const role = deferred(); h.state.hooks.set("es_admin_plataforma_v1", () => role.promise);
    const { button } = makePlanRow(); const pending = h.controller.savePlan(button); await tick();
    await h.controller.savePlan(button); assert.equal(h.calls.confirmations.length, 1);
    if (mode === "changed-session") h.state.session = "admin-b";
    role.resolve(mode === "expired" ? { data: null, error: { message: "JWT expired" } } : { data: mode !== "revoked", error: null });
    await pending;
    assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0, mode);
    assert.doesNotMatch(el(h, "#platform-business-list-v231").innerHTML, /Kiosco Centro/, mode);
  }
});

test("confirmation cannot authorize changed session, offline, detached row or altered selections", async () => {
  for (const mode of ["session", "offline", "detached", "selection", "closed", "reload"]) {
    const h = createHarness(); await h.controller.open(); const confirmation = deferred(); h.state.confirmHook = () => confirmation.promise;
    const { button, row, planSelect } = makePlanRow(); const pending = h.controller.savePlan(button);
    if (mode === "session") h.state.session = null;
    if (mode === "offline") h.state.online = false;
    if (mode === "detached") row.isConnected = false;
    if (mode === "selection") planSelect.value = "starter";
    if (mode === "closed") h.controller.close();
    if (mode === "reload") await h.controller.open();
    confirmation.resolve(true); await pending;
    assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0, mode);
    assert.ok(h.calls.toast.every(toast => toast.type !== "success"), mode);
  }
});

test("confirmation errors fail closed and never perform writes", async () => {
  const h = createHarness(); await h.controller.open(); h.state.confirmHook = () => { throw new Error("dialog unavailable"); };
  await h.controller.savePlan(makePlanRow().button);
  assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0);
  assert.doesNotMatch(el(h, "#platform-business-list-v231").innerHTML, /Kiosco Centro/);
  assert.equal(h.calls.toast.at(-1).type, "error");
});

test("missing or blank identity cannot enable Save, confirm or write even when the admin read says true", async () => {
  for (const identity of [null, "", "   "]) {
    const h = createHarness(); h.state.session = identity; h.controller.setup(); await h.controller.open();
    const { button } = makePlanRow(); h.document.elements.set("[data-platform-save-plan]:all", [button]);
    el(h, "#platform-business-list-v231").emit("change");
    assert.equal(button.disabled, true);
    await h.controller.savePlan(button);
    assert.equal(h.calls.confirmations.length, 0);
    assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0);
    assert.doesNotMatch(el(h, "#platform-business-list-v231").innerHTML, /Kiosco Centro/);
  }
});
