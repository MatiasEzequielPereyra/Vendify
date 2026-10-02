import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  createConnectionStatusController
} from "../../dist-ts/offline/connection-status-controller.js";

function createElement({ classes = [], href = null } = {}) {
  const classSet = new Set(classes);
  const listeners = new Map();
  const attrs = new Map();
  if (href !== null) attrs.set("href", href);

  const icon = {
    setAttribute(name, value) {
      attrs.set(name, value);
    },
    getAttribute(name) {
      return attrs.get(name) ?? null;
    }
  };

  return {
    textContent: "",
    classList: {
      add(...tokens) {
        for (const token of tokens) classSet.add(token);
      },
      remove(...tokens) {
        for (const token of tokens) classSet.delete(token);
      },
      contains(token) {
        return classSet.has(token);
      }
    },
    querySelector(selector) {
      return selector === "use" ? icon : null;
    },
    addEventListener(type, listener) {
      const bucket = listeners.get(type) ?? [];
      bucket.push(listener);
      listeners.set(type, bucket);
    },
    async emit(type) {
      for (const listener of listeners.get(type) ?? []) {
        await listener({ type });
      }
    },
    listenerCount(type) {
      return (listeners.get(type) ?? []).length;
    },
    icon,
    classes: classSet
  };
}

function createHarness({
  online = true,
  pending = 0,
  includeStatus = true,
  includeLabel = true,
  includeSyncNow = true
} = {}) {
  const state = { online, pending };
  const status = includeStatus
    ? createElement({ classes: ["legacy"], href: "#old" })
    : null;
  const label = includeLabel ? createElement() : null;
  const syncNow = includeSyncNow ? createElement() : null;
  const elements = new Map([
    ["#connection-status-v23011", status],
    ["#connection-label-v23011", label],
    ["#btn-sync-now-v23011", syncNow]
  ]);
  const windowListeners = new Map();
  const operations = [];
  const syncAllCalls = [];
  let pendingSyncCalls = 0;

  const controller = createConnectionStatusController({
    isOnline: () => state.online,
    getPendingOfflineSalesCount: () => state.pending,
    async syncPendingOfflineSales() {
      pendingSyncCalls += 1;
      operations.push("pending");
    },
    async syncAll(showToast) {
      syncAllCalls.push(showToast);
      operations.push("global:" + String(showToast));
      operations.push(
        status?.classList.contains("syncing")
          ? "state:syncing"
          : "state:not-syncing"
      );
    },
    getElement(selector) {
      return elements.get(selector) ?? null;
    },
    addWindowListener(type, listener) {
      const bucket = windowListeners.get(type) ?? [];
      bucket.push(listener);
      windowListeners.set(type, bucket);
    }
  });

  return {
    controller,
    state,
    status,
    label,
    syncNow,
    operations,
    syncAllCalls,
    get pendingSyncCalls() {
      return pendingSyncCalls;
    },
    async emitWindow(type) {
      for (const listener of windowListeners.get(type) ?? []) {
        await listener();
      }
    },
    windowListenerCount(type) {
      return (windowListeners.get(type) ?? []).length;
    }
  };
}

test("default online label is exact", () => {
  const h = createHarness();
  h.controller.setState("online");
  assert.equal(h.label.textContent, "Online");
});
test("offline label is exact", () => {
  const h = createHarness();
  h.controller.setState("offline");
  assert.equal(h.label.textContent, "Sin conexión");
});
test("syncing label is exact", () => {
  const h = createHarness();
  h.controller.setState("syncing");
  assert.equal(h.label.textContent, "Sincronizando");
});
test("error label is exact", () => {
  const h = createHarness();
  h.controller.setState("error");
  assert.equal(h.label.textContent, "Error de sync");
});
test("unknown state falls back to state as label", () => {
  const h = createHarness();
  h.controller.setState("degraded");
  assert.equal(h.label.textContent, "degraded");
});
test("truthy custom label overrides default", () => {
  const h = createHarness();
  h.controller.setState("online", "Conectado");
  assert.equal(h.label.textContent, "Conectado");
});
test("empty custom label uses fallback", () => {
  const h = createHarness();
  h.controller.setState("online", "");
  assert.equal(h.label.textContent, "Online");
});
test("setState removes all previous known state classes", () => {
  const h = createHarness();
  for (const token of ["online", "offline", "syncing", "error", "keep-me"]) {
    h.status.classList.add(token);
  }
  h.controller.setState("degraded");
  for (const token of ["online", "offline", "syncing", "error"]) {
    assert.equal(h.status.classList.contains(token), false);
  }
  assert.equal(h.status.classList.contains("keep-me"), true);
});
test("setState adds the requested state class", () => {
  const h = createHarness();
  h.controller.setState("syncing");
  assert.equal(h.status.classList.contains("syncing"), true);
});
test("offline uses wifi-off icon", () => {
  const h = createHarness();
  h.controller.setState("offline");
  assert.equal(h.status.icon.getAttribute("href"), "#vi-wifi-off");
});
test("error uses wifi-off icon", () => {
  const h = createHarness();
  h.controller.setState("error");
  assert.equal(h.status.icon.getAttribute("href"), "#vi-wifi-off");
});
test("online uses wifi icon", () => {
  const h = createHarness();
  h.controller.setState("online");
  assert.equal(h.status.icon.getAttribute("href"), "#vi-wifi");
});
test("syncing uses wifi icon", () => {
  const h = createHarness();
  h.controller.setState("syncing");
  assert.equal(h.status.icon.getAttribute("href"), "#vi-wifi");
});
test("missing status element returns without crash", () => {
  const h = createHarness({ includeStatus: false });
  assert.doesNotThrow(() => h.controller.setState("online"));
});
test("missing label returns without crash", () => {
  const h = createHarness({ includeLabel: false });
  assert.doesNotThrow(() => h.controller.setState("offline"));
  assert.equal(h.status.classList.contains("offline"), false);
});
test("refresh renders online from injected network state", () => {
  const h = createHarness({ online: true });
  h.controller.refresh();
  assert.equal(h.status.classList.contains("online"), true);
  assert.equal(h.label.textContent, "Online");
});
test("refresh renders offline from injected network state", () => {
  const h = createHarness({ online: false });
  h.controller.refresh();
  assert.equal(h.status.classList.contains("offline"), true);
  assert.equal(h.label.textContent, "Sin conexión");
});
test("setup initializes network state immediately", () => {
  const h = createHarness({ online: false });
  h.controller.setup();
  assert.equal(h.status.classList.contains("offline"), true);
  assert.equal(h.label.textContent, "Sin conexión");
});
test("setup is idempotent and binds each listener once", () => {
  const h = createHarness();
  h.controller.setup();
  h.controller.setup();
  assert.equal(h.windowListenerCount("online"), 1);
  assert.equal(h.windowListenerCount("offline"), 1);
  assert.equal(h.status.listenerCount("click"), 1);
  assert.equal(h.syncNow.listenerCount("click"), 1);
});
test("online event renders syncing before one silent global sync", async () => {
  const h = createHarness();
  h.controller.setup();
  h.operations.length = 0;
  h.syncAllCalls.length = 0;
  await h.emitWindow("online");
  assert.equal(h.status.classList.contains("syncing"), true);
  assert.deepEqual(h.syncAllCalls, [false]);
  assert.deepEqual(h.operations, ["global:false", "state:syncing"]);
});
test("offline event refreshes offline without starting sync", async () => {
  const h = createHarness({ online: true, pending: 2 });
  h.controller.setup();
  h.state.online = false;
  h.operations.length = 0;
  h.syncAllCalls.length = 0;
  await h.emitWindow("offline");
  assert.equal(h.status.classList.contains("offline"), true);
  assert.equal(h.pendingSyncCalls, 0);
  assert.deepEqual(h.syncAllCalls, []);
});
test("connection click online with pending syncs pending before global manual sync", async () => {
  const h = createHarness({ online: true, pending: 2 });
  h.controller.setup();
  h.operations.length = 0;
  await h.status.emit("click");
  assert.equal(h.pendingSyncCalls, 1);
  assert.deepEqual(h.syncAllCalls, [true]);
  assert.deepEqual(
    h.operations.filter((value) => value === "pending" || value.startsWith("global:")),
    ["pending", "global:true"]
  );
});
test("connection click online without pending skips pending sync", async () => {
  const h = createHarness({ online: true, pending: 0 });
  h.controller.setup();
  await h.status.emit("click");
  assert.equal(h.pendingSyncCalls, 0);
  assert.deepEqual(h.syncAllCalls, [true]);
});
test("connection click offline skips pending but delegates global manual sync", async () => {
  const h = createHarness({ online: false, pending: 3 });
  h.controller.setup();
  await h.status.emit("click");
  assert.equal(h.pendingSyncCalls, 0);
  assert.deepEqual(h.syncAllCalls, [true]);
});
test("Sync Now delegates exactly one global manual sync", async () => {
  const h = createHarness();
  h.controller.setup();
  await h.syncNow.emit("click");
  assert.deepEqual(h.syncAllCalls, [true]);
});
test("missing click targets do not crash setup", () => {
  const h = createHarness({ includeStatus: false, includeSyncNow: false });
  assert.doesNotThrow(() => h.controller.setup());
});
test("connection status owner contains no backend or legacy sync ownership", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../../src/offline/connection-status-controller.ts"),
    "utf8"
  );
  for (const forbidden of [
    "supabaseClient",
    "registrar_venta_v4",
    "cargarProductos",
    "cargarEstadoCajaV227",
    "inventoryControllerV232",
    "purchasesControllerV232",
    "sincronizarVentasOfflineV2311",
    "leerVentasOfflineV2311"
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden, "u"));
  }
});
