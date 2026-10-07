import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  createCommercialFoundationController
} from "../../dist-ts/commercial/commercial-foundation-controller.js";

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
    this.style = {};
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    this.checked = false;
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
      listener({ target: this, preventDefault() {}, ...event });
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
    this.visibilityState = "visible";
  }
  querySelector(selector) {
    return this.elements.get(selector) ?? null;
  }
}

class FakeStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
    this.writes = [];
    this.removes = [];
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
    this.writes.push([key, String(value)]);
  }
  removeItem(key) {
    this.values.delete(key);
    this.removes.push(key);
  }
}

function makeDom() {
  const entries = new Map();
  for (const selector of [
    "#commercial-onboarding-v231",
    "#commercial-onboarding-steps-v231",
    "#commercial-progress-bar-v231",
    "#commercial-progress-label-v231",
    "#config-plan-name-v231",
    "#config-plan-detail-v231",
    "#config-plan-usage-v231",
    "#config-stock-days-v231",
    "#config-adjust-threshold-v231",
    "#config-cash-diff-v231",
    "#config-daily-summary-v231",
    "#config-auto-print-v231",
    "#config-ticket-width-v231",
    "#btn-save-operacion-v231",
    "#btn-backup-json-v231",
    "#btn-hide-commercial-onboarding-v231",
    "#form-operacion-v231"
  ]) {
    entries.set(selector, new FakeElement());
  }
  entries.get("#commercial-onboarding-v231").classList.add("hidden");
  return new FakeDocument(entries);
}

function createHarness({
  role = "owner",
  online = true,
  ready = true,
  manageProducts = true,
  business = { id: "biz-1", nombre: "Mi Kiosco" },
  withDom = true,
  storageEntries = []
} = {}) {
  const document = withDom ? makeDom() : new FakeDocument();
  const storage = new FakeStorage(storageEntries);
  const state = {
    role,
    online,
    ready,
    manageProducts,
    business,
    responses: {
      estado_onboarding_comercial_v1: {
        completado: false,
        productos: 0,
        caja_utilizada: false,
        ventas: 0,
        miembros: 1
      },
      obtener_plan_actual_v1: {
        nombre: "Pro",
        estado: "activo",
        limites: { sucursales: 2, usuarios: 5, productos: 500 },
        uso: { sucursales: 1, usuarios: 2, productos: 30 }
      },
      obtener_config_operativa_v1: {
        stock_cobertura_alerta: 3,
        ajuste_grande_unidades: 10,
        diferencia_caja_alerta: 10000,
        resumen_diario: true,
        auto_imprimir_ticket: false,
        ancho_ticket_mm: 80
      },
      guardar_config_operativa_v1: { ok: true },
      exportar_respaldo_operativo_v1: { negocio: "biz-1" }
    },
    errors: new Map(),
    rpcHooks: new Map(),
    nextTimerId: 1,
    timers: new Map()
  };
  const calls = {
    rpc: [],
    persistOffline: 0,
    applyOffline: 0,
    product: 0,
    config: [],
    cash: 0,
    sale: 0,
    team: 0,
    badge: 0,
    platform: 0,
    toast: [],
    downloads: [],
    clearIntervals: [],
    logger: []
  };

  const client = {
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      const hook = state.rpcHooks.get(name);
      if (hook) return hook(args);
      const error = state.errors.get(name);
      if (error) return { data: null, error: { message: error } };
      return { data: structuredClone(state.responses[name] ?? {}), error: null };
    }
  };

  const controller = createCommercialFoundationController({
    client,
    getAppReady: () => state.ready,
    getBusiness: () => state.business,
    getRole: () => state.role,
    hasPermission: (permission) =>
      permission === "manageProducts" ? state.manageProducts : false,
    isOnline: () => state.online,
    persistOfflineContext() {
      calls.persistOffline += 1;
    },
    applyOfflineState() {
      calls.applyOffline += 1;
    },
    openProduct() {
      calls.product += 1;
    },
    openConfig(tab) {
      calls.config.push(tab);
    },
    openCash() {
      calls.cash += 1;
    },
    openSale() {
      calls.sale += 1;
    },
    openTeam() {
      calls.team += 1;
    },
    reloadDashboardAlertBadge() {
      calls.badge += 1;
    },
    refreshPlatformAccess() {
      calls.platform += 1;
    },
    showToast(message, type) {
      calls.toast.push({ message, type });
    },
    downloadText(content, mime, filename) {
      calls.downloads.push({ content, mime, filename });
    },
    icon: (name) => `icon:${name}`,
    storage,
    document,
    setIntervalFn(callback, ms) {
      const id = state.nextTimerId++;
      state.timers.set(id, { callback, ms });
      return id;
    },
    clearIntervalFn(id) {
      calls.clearIntervals.push(id);
      state.timers.delete(id);
    },
    now: () => new Date("2026-10-07T12:00:00Z"),
    logger: {
      warn(...args) {
        calls.logger.push(args);
      }
    }
  });

  return { controller, state, calls, document, storage };
}

function el(h, selector) {
  return h.document.querySelector(selector);
}

function rpcCalls(h, name) {
  return h.calls.rpc.filter((call) => call.name === name);
}

function emitOnboardingAction(h, action) {
  const target = new FakeElement();
  target.dataset.onboardingActionV231 = action;
  target.closestValues.set("[data-onboarding-action-v231]", target);
  el(h, "#commercial-onboarding-steps-v231").emit("click", { target });
}

test("factory construction executes no callbacks or RPCs eagerly", () => {
  const h = createHarness();
  assert.equal(h.calls.rpc.length, 0);
  assert.equal(h.calls.persistOffline, 0);
  assert.equal(h.calls.badge, 0);
  assert.equal(h.calls.platform, 0);
});

test("setup is idempotent and owns one listener per Commercial surface", () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.setup();
  assert.equal(el(h, "#btn-hide-commercial-onboarding-v231").listenerCount("click"), 1);
  assert.equal(el(h, "#commercial-onboarding-steps-v231").listenerCount("click"), 1);
  assert.equal(el(h, "#form-operacion-v231").listenerCount("submit"), 1);
  assert.equal(el(h, "#btn-backup-json-v231").listenerCount("click"), 1);
});

test("missing DOM is tolerated across setup and public operations", async () => {
  const h = createHarness({ withDom: false });
  assert.doesNotThrow(() => h.controller.setup());
  await assert.doesNotReject(h.controller.refreshOnboarding());
  await assert.doesNotReject(h.controller.loadPlan());
  await assert.doesNotReject(h.controller.loadOperationalConfig());
});

test("non-owner onboarding stays hidden and performs no onboarding RPC", async () => {
  const h = createHarness({ role: "admin" });
  await h.controller.refreshOnboarding();
  assert.equal(el(h, "#commercial-onboarding-v231").classList.contains("hidden"), true);
  assert.equal(rpcCalls(h, "estado_onboarding_comercial_v1").length, 0);
});

test("completed onboarding hides and clears the persisted hide marker", async () => {
  const key = "vendify_onboarding_hide_v231:biz-1";
  const h = createHarness({ storageEntries: [[key, "1"]] });
  h.state.responses.estado_onboarding_comercial_v1.completado = true;
  await h.controller.refreshOnboarding();
  assert.equal(el(h, "#commercial-onboarding-v231").classList.contains("hidden"), true);
  assert.deepEqual(h.storage.removes, [key]);
});

test("persisted hide marker keeps owner onboarding hidden", async () => {
  const h = createHarness({
    storageEntries: [["vendify_onboarding_hide_v231:biz-1", "1"]]
  });
  await h.controller.refreshOnboarding();
  assert.equal(el(h, "#commercial-onboarding-v231").classList.contains("hidden"), true);
});

test("owner onboarding renders four steps and exact progress semantics", async () => {
  const h = createHarness();
  h.state.responses.estado_onboarding_comercial_v1 = {
    completado: false,
    productos: 2,
    caja_utilizada: true,
    ventas: 0,
    miembros: 1
  };
  await h.controller.refreshOnboarding();
  const html = el(h, "#commercial-onboarding-steps-v231").innerHTML;
  assert.equal((html.match(/commercial-step-v231/g) ?? []).length, 4);
  assert.equal(el(h, "#commercial-progress-bar-v231").style.width, "50%");
  assert.equal(el(h, "#commercial-progress-label-v231").textContent, "50% completo · 2 de 4 pasos");
  assert.equal(el(h, "#commercial-onboarding-v231").classList.contains("hidden"), false);
});

test("product onboarding action delegates to Products when permission exists", () => {
  const h = createHarness({ manageProducts: true });
  h.controller.setup();
  emitOnboardingAction(h, "product");
  assert.equal(h.calls.product, 1);
  assert.deepEqual(h.calls.config, []);
});

test("product onboarding action falls back to Config datos without permission", () => {
  const h = createHarness({ manageProducts: false });
  h.controller.setup();
  emitOnboardingAction(h, "product");
  assert.equal(h.calls.product, 0);
  assert.deepEqual(h.calls.config, ["datos"]);
});

test("cash, sale and team onboarding actions stay delegated to their owners", () => {
  const h = createHarness();
  h.controller.setup();
  emitOnboardingAction(h, "cash");
  emitOnboardingAction(h, "sale");
  emitOnboardingAction(h, "team");
  assert.equal(h.calls.cash, 1);
  assert.equal(h.calls.sale, 1);
  assert.equal(h.calls.team, 1);
});

test("hide onboarding action persists the business-scoped marker", () => {
  const h = createHarness();
  h.controller.setup();
  el(h, "#btn-hide-commercial-onboarding-v231").emit("click");
  assert.deepEqual(h.storage.writes, [["vendify_onboarding_hide_v231:biz-1", "1"]]);
  assert.equal(el(h, "#commercial-onboarding-v231").classList.contains("hidden"), true);
});

test("plan load renders normal name, status and usage rows", async () => {
  const h = createHarness();
  await h.controller.loadPlan();
  assert.equal(el(h, "#config-plan-name-v231").textContent, "Pro");
  assert.equal(el(h, "#config-plan-detail-v231").textContent, "Estado: activo");
  const usage = el(h, "#config-plan-usage-v231").innerHTML;
  assert.match(usage, /Sucursales/);
  assert.match(usage, /Usuarios/);
  assert.match(usage, /Productos/);
});

test("plan trial and legacy copy remain observable", async () => {
  const trial = createHarness();
  trial.state.responses.obtener_plan_actual_v1.trial_dias_restantes = 7;
  await trial.controller.loadPlan();
  assert.equal(el(trial, "#config-plan-detail-v231").textContent, "Prueba · 7 día(s) restantes");

  const legacy = createHarness();
  legacy.state.responses.obtener_plan_actual_v1.estado = "legacy";
  await legacy.controller.loadPlan();
  assert.equal(
    el(legacy, "#config-plan-detail-v231").textContent,
    "Cuenta existente sin límites comerciales aplicados."
  );
});

test("plan failure preserves exact legacy fallback copy", async () => {
  const h = createHarness();
  h.state.errors.set("obtener_plan_actual_v1", "falló");
  await h.controller.loadPlan();
  assert.equal(el(h, "#config-plan-name-v231").textContent, "No disponible");
  assert.equal(el(h, "#config-plan-detail-v231").textContent, "Ejecutá la migración comercial v2.31.");
});

test("operational config loads for owner admin and manager but not cashier", async () => {
  for (const role of ["owner", "admin", "manager"]) {
    const h = createHarness({ role });
    h.state.responses.obtener_config_operativa_v1 = {
      stock_cobertura_alerta: 5,
      ajuste_grande_unidades: 12,
      diferencia_caja_alerta: 2500,
      resumen_diario: false,
      auto_imprimir_ticket: true,
      ancho_ticket_mm: 58
    };
    await h.controller.loadOperationalConfig();
    assert.equal(rpcCalls(h, "obtener_config_operativa_v1").length, 1, role);
    assert.equal(el(h, "#config-stock-days-v231").value, "5");
    assert.equal(el(h, "#config-ticket-width-v231").value, "58");
    assert.equal(h.controller.getAutoPrint(), true);
    assert.equal(h.controller.getTicketWidth(), 58);
  }

  const cashier = createHarness({ role: "cashier" });
  await cashier.controller.loadOperationalConfig();
  assert.equal(rpcCalls(cashier, "obtener_config_operativa_v1").length, 0);
});

test("owner and admin save exact typed payload and refresh config plus dashboard", async () => {
  for (const role of ["owner", "admin"]) {
    const h = createHarness({ role });
    el(h, "#config-stock-days-v231").value = "4";
    el(h, "#config-adjust-threshold-v231").value = "11";
    el(h, "#config-cash-diff-v231").value = "9000";
    el(h, "#config-daily-summary-v231").checked = false;
    el(h, "#config-auto-print-v231").checked = true;
    el(h, "#config-ticket-width-v231").value = "58";

    await h.controller.saveOperationalConfig({ preventDefault() {} });

    assert.deepEqual(rpcCalls(h, "guardar_config_operativa_v1")[0].args, {
      p_stock_cobertura_alerta: 4,
      p_ajuste_grande_unidades: 11,
      p_diferencia_caja_alerta: 9000,
      p_resumen_diario: false,
      p_auto_imprimir_ticket: true,
      p_ancho_ticket_mm: 58
    });
    assert.equal(rpcCalls(h, "obtener_config_operativa_v1").length, 1);
    assert.equal(h.calls.badge, 1);
    assert.deepEqual(h.calls.toast.at(-1), {
      message: "Configuración operativa guardada",
      type: "success"
    });
  }
});

test("manager and cashier config writes are blocked with exact denial copy", async () => {
  for (const role of ["manager", "cashier"]) {
    const h = createHarness({ role });
    await h.controller.saveOperationalConfig({ preventDefault() {} });
    assert.equal(rpcCalls(h, "guardar_config_operativa_v1").length, 0);
    assert.deepEqual(h.calls.toast, [{
      message: "Solo Propietario o Administrador pueden cambiar esta configuración",
      type: "error"
    }]);
  }
});

test("save button is disabled while saving and restored in finally", async () => {
  const h = createHarness();
  let resolveSave;
  h.state.rpcHooks.set("guardar_config_operativa_v1", () =>
    new Promise((resolve) => {
      resolveSave = resolve;
    })
  );

  const promise = h.controller.saveOperationalConfig({ preventDefault() {} });
  await Promise.resolve();
  const button = el(h, "#btn-save-operacion-v231");
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Guardando...");

  resolveSave({ data: { ok: true }, error: null });
  await promise;
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Guardar configuración");
});

test("owner backup exports v1 JSON with sanitized dated filename and restores button", async () => {
  const h = createHarness({ business: { id: "biz-1", nombre: "Mi Kiosco #1" } });
  await h.controller.downloadBackup();
  assert.equal(rpcCalls(h, "exportar_respaldo_operativo_v1").length, 1);
  assert.equal(h.calls.downloads.length, 1);
  assert.equal(h.calls.downloads[0].filename, "vendify-backup-mi-kiosco-1-2026-10-07.json");
  assert.equal(h.calls.downloads[0].mime, "application/json;charset=utf-8");
  assert.deepEqual(h.calls.toast.at(-1), { message: "Respaldo descargado", type: "success" });
  assert.equal(el(h, "#btn-backup-json-v231").disabled, false);
});

test("backup remains owner-only", async () => {
  for (const role of ["admin", "manager", "cashier"]) {
    const h = createHarness({ role });
    await h.controller.downloadBackup();
    assert.equal(rpcCalls(h, "exportar_respaldo_operativo_v1").length, 0);
    assert.deepEqual(h.calls.toast, [{
      message: "Solo el propietario puede descargar un respaldo completo",
      type: "error"
    }]);
  }
});

test("load is a no-op when app context is not ready", async () => {
  const h = createHarness({ ready: false });
  await h.controller.load();
  assert.equal(h.calls.rpc.length, 0);
  assert.equal(h.calls.persistOffline, 0);
  assert.equal(h.state.timers.size, 0);
});

test("offline load persists context, applies offline state and skips online services", async () => {
  const h = createHarness({ online: false });
  await h.controller.load();
  assert.equal(h.calls.persistOffline, 1);
  assert.equal(h.calls.applyOffline, 1);
  assert.equal(h.calls.rpc.length, 0);
  assert.equal(h.calls.badge, 0);
  assert.equal(h.calls.platform, 0);
});

test("online load executes Commercial services, dashboard and Platform access", async () => {
  const h = createHarness();
  await h.controller.load();
  assert.equal(h.calls.persistOffline, 1);
  assert.equal(rpcCalls(h, "obtener_config_operativa_v1").length, 1);
  assert.equal(rpcCalls(h, "obtener_plan_actual_v1").length, 1);
  assert.equal(rpcCalls(h, "estado_onboarding_comercial_v1").length, 1);
  assert.equal(h.calls.badge, 1);
  assert.equal(h.calls.platform, 1);
  assert.equal([...h.state.timers.values()][0].ms, 60000);
});

test("repeated load owns only one refresh interval", async () => {
  const h = createHarness();
  await h.controller.load();
  const first = [...h.state.timers.keys()][0];
  await h.controller.load();
  assert.deepEqual(h.calls.clearIntervals, [first]);
  assert.equal(h.state.timers.size, 1);
});

test("refresh timer fires dashboard badge only when visible and online", async () => {
  const h = createHarness();
  await h.controller.load();
  h.calls.badge = 0;
  const timer = [...h.state.timers.values()][0];

  timer.callback();
  assert.equal(h.calls.badge, 1);

  h.document.visibilityState = "hidden";
  timer.callback();
  assert.equal(h.calls.badge, 1);

  h.document.visibilityState = "visible";
  h.state.online = false;
  timer.callback();
  assert.equal(h.calls.badge, 1);
});

test("typed Commercial source has service ownership and no legacy runtime leaks", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../../src/commercial/commercial-foundation-controller.ts"),
    "utf8"
  );

  for (const required of [
    'from "./commercial-service.js"',
    "getCommercialOnboarding",
    "getCurrentPlan",
    "getOperationalConfig",
    "saveOperationalConfig",
    "exportOperationalBackup"
  ]) {
    assert.equal(source.includes(required), true, required);
  }

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
