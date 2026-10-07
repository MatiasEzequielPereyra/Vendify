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
    responses: {
      es_admin_plataforma_v1: true,
      platform_overview_v1: {
        negocios: 4,
        trials: 2,
        ventas_hoy: 12345,
        errores_24h: 1
      },
      listar_negocios_plataforma_v1: [{
        id: "biz-1",
        nombre: "Kiosco Centro",
        usuarios: 3,
        productos: 42,
        trial_hasta: "2026-10-20T00:00:00Z",
        plan_codigo: "pro",
        estado: "activo"
      }],
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
    toast: []
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
    closeUserMenu() {
      calls.closeUserMenu += 1;
    },
    formatPrice: (value) => `ARS ${value}`,
    icon: (name) => `icon:${name}`,
    showToast(message, type) {
      calls.toast.push({ message, type });
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
  businessId = "biz-1",
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

test("factory construction performs no eager Platform calls", () => {
  const h = createHarness();
  assert.equal(h.calls.rpc.length, 0);
  assert.equal(h.calls.closeUserMenu, 0);
  assert.deepEqual(h.calls.toast, []);
});

test("setup is idempotent for open close backdrop and delegated save listeners", () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.setup();
  assert.equal(el(h, "#btn-platform-admin-v231").listenerCount("click"), 1);
  assert.equal(el(h, "#btn-close-platform-v231").listenerCount("click"), 1);
  assert.equal(el(h, "#modal-platform-admin-v231 .modal-backdrop").listenerCount("click"), 1);
  assert.equal(el(h, "#platform-business-list-v231").listenerCount("click"), 1);
});

test("missing Platform DOM is tolerated", async () => {
  const h = createHarness({ withDom: false });
  assert.doesNotThrow(() => h.controller.setup());
  await assert.doesNotReject(h.controller.refreshAccess());
  await assert.doesNotReject(h.controller.open());
  assert.doesNotThrow(() => h.controller.close());
});

test("offline access check hides admin button without backend request", async () => {
  const h = createHarness({ online: false });
  el(h, "#btn-platform-admin-v231").classList.remove("hidden");
  await h.controller.refreshAccess();
  assert.equal(el(h, "#btn-platform-admin-v231").classList.contains("hidden"), true);
  assert.equal(rpcCalls(h, "es_admin_plataforma_v1").length, 0);
});

test("isAdmin true shows Platform button", async () => {
  const h = createHarness();
  await h.controller.refreshAccess();
  assert.equal(el(h, "#btn-platform-admin-v231").classList.contains("hidden"), false);
});

test("isAdmin false hides Platform button", async () => {
  const h = createHarness();
  h.state.responses.es_admin_plataforma_v1 = false;
  el(h, "#btn-platform-admin-v231").classList.remove("hidden");
  await h.controller.refreshAccess();
  assert.equal(el(h, "#btn-platform-admin-v231").classList.contains("hidden"), true);
});

test("isAdmin error hides Platform button and never leaks undefined error state", async () => {
  const h = createHarness();
  h.state.errors.set("es_admin_plataforma_v1", "denied");
  el(h, "#btn-platform-admin-v231").classList.remove("hidden");
  await assert.doesNotReject(h.controller.refreshAccess());
  assert.equal(el(h, "#btn-platform-admin-v231").classList.contains("hidden"), true);
});

test("open shows modal, loads all backoffice services and renders KPIs", async () => {
  const h = createHarness();
  await h.controller.open();
  assert.equal(el(h, "#modal-platform-admin-v231").classList.contains("hidden"), false);
  assert.equal(rpcCalls(h, "platform_overview_v1").length, 1);
  assert.deepEqual(rpcCalls(h, "listar_negocios_plataforma_v1")[0].args, { p_limit: 50 });
  assert.deepEqual(rpcCalls(h, "listar_errores_plataforma_v1")[0].args, { p_limit: 30 });
  assert.equal(el(h, "#platform-businesses-v231").textContent, "4");
  assert.equal(el(h, "#platform-trials-v231").textContent, "2");
  assert.equal(el(h, "#platform-sales-v231").textContent, "ARS 12345");
  assert.equal(el(h, "#platform-errors-v231").textContent, "1");
});

test("business and error rows preserve allowed plans statuses and observable data", async () => {
  const h = createHarness();
  await h.controller.open();
  const businesses = el(h, "#platform-business-list-v231").innerHTML;
  const errors = el(h, "#platform-error-list-v231").innerHTML;

  assert.match(businesses, /Kiosco Centro/);
  assert.match(businesses, /3 usuario\(s\)/);
  assert.match(businesses, /42 productos/);
  for (const plan of ["legacy", "trial", "starter", "pro", "business"]) {
    assert.match(businesses, new RegExp(`value="${plan}"`));
  }
  for (const status of ["legacy", "trial", "activo", "vencido", "suspendido"]) {
    assert.match(businesses, new RegExp(`value="${status}"`));
  }
  assert.match(errors, /boom/);
  assert.match(errors, /Kiosco Centro/);
  assert.match(errors, /2\.31\.1/);
});

test("admin button setup closes user menu then opens backoffice", async () => {
  const h = createHarness();
  h.controller.setup();
  el(h, "#btn-platform-admin-v231").emit("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.closeUserMenu, 1);
  assert.equal(el(h, "#modal-platform-admin-v231").classList.contains("hidden"), false);
  assert.equal(rpcCalls(h, "platform_overview_v1").length, 1);
});

test("close button and backdrop both close Platform modal", () => {
  const h = createHarness();
  h.controller.setup();

  el(h, "#modal-platform-admin-v231").classList.remove("hidden");
  el(h, "#btn-close-platform-v231").emit("click");
  assert.equal(el(h, "#modal-platform-admin-v231").classList.contains("hidden"), true);

  el(h, "#modal-platform-admin-v231").classList.remove("hidden");
  el(h, "#modal-platform-admin-v231 .modal-backdrop").emit("click");
  assert.equal(el(h, "#modal-platform-admin-v231").classList.contains("hidden"), true);
});

test("save plan sends exact business plan and status, toasts success and reloads backoffice", async () => {
  const h = createHarness();
  const { button } = makePlanRow({
    businessId: "biz-77",
    plan: "business",
    status: "suspendido"
  });

  await h.controller.savePlan(button);

  assert.deepEqual(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1")[0].args, {
    p_negocio_id: "biz-77",
    p_plan_codigo: "business",
    p_estado: "suspendido"
  });
  assert.deepEqual(h.calls.toast, [{ message: "Plan actualizado", type: "success" }]);
  assert.equal(rpcCalls(h, "platform_overview_v1").length, 1);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Guardar");
});

test("save plan does nothing when row data is incomplete", async () => {
  const h = createHarness();
  const { button } = makePlanRow({ businessId: "", plan: "pro", status: "activo" });
  await h.controller.savePlan(button);
  assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0);
});

test("save plan disables button while backend is pending and restores it in finally", async () => {
  const h = createHarness();
  let resolveUpdate;
  h.state.hooks.set("actualizar_plan_negocio_plataforma_v1", () =>
    new Promise((resolve) => {
      resolveUpdate = resolve;
    })
  );
  const { button } = makePlanRow();

  const promise = h.controller.savePlan(button);
  await Promise.resolve();
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Guardando...");

  resolveUpdate({ data: { ok: true }, error: null });
  await promise;
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Guardar");
});

test("update failure preserves backend message and restores button without backoffice reload", async () => {
  const h = createHarness();
  h.state.errors.set("actualizar_plan_negocio_plataforma_v1", "plan denied");
  const { button } = makePlanRow();

  await h.controller.savePlan(button);

  assert.deepEqual(h.calls.toast, [{ message: "plan denied", type: "error" }]);
  assert.equal(rpcCalls(h, "platform_overview_v1").length, 0);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Guardar");
});

test("delegated business-list click ignores non-save targets", async () => {
  const h = createHarness();
  h.controller.setup();
  const target = new FakeElement();
  el(h, "#platform-business-list-v231").emit("click", { target });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1").length, 0);
});

test("delegated business-list click acts only on data-platform-save-plan", async () => {
  const h = createHarness();
  h.controller.setup();
  const { button } = makePlanRow({ businessId: "biz-2", plan: "starter", status: "trial" });
  el(h, "#platform-business-list-v231").emit("click", { target: button });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rpcCalls(h, "actualizar_plan_negocio_plataforma_v1")[0].args, {
    p_negocio_id: "biz-2",
    p_plan_codigo: "starter",
    p_estado: "trial"
  });
});

test("typed Platform source fixes undefined error bug and leaks no legacy ownership", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../../src/platform/platform-admin-controller.ts"),
    "utf8"
  );

  for (const required of [
    'from "./platform-service.js"',
    "isPlatformAdmin",
    "loadPlatformBackoffice",
    "updateBusinessPlan",
    'classList.toggle("hidden", !admin)'
  ]) {
    assert.equal(source.includes(required), true, required);
  }

  assert.equal(source.includes("error || data !== true"), false);

  for (const forbidden of [
    ".rpc(",
    "window.Vendify",
    "dashboardControllerV232",
    "teamControllerV232",
    "cashControllerV232",
    "posControllerV232",
    "appContext",
    "supabaseClient"
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
