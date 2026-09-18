import assert from "node:assert/strict";
import test from "node:test";
import { createRealtimeController } from "../../dist-ts/context/realtime-controller.js";

function harness() {
  let now = 100_000;
  let nextHandle = 1;
  const timeouts = new Map();
  const intervals = new Map();
  const listeners = new Map();
  const subscriptions = [];
  const removed = [];
  let removeError = null;
  const statuses = [];
  const calls = [];
  const reports = [];
  const scope = { ready: true, businessId: "business-1", branchId: "branch-1" };
  const channel = {
    on(type, filter, callback) {
      subscriptions.push({ type, filter, callback });
      return this;
    },
    subscribe(callback) {
      this.statusCallback = callback;
      return this;
    }
  };
  const scheduler = {
    now: () => now,
    setTimeout(callback, delay) {
      const handle = nextHandle++;
      timeouts.set(handle, { callback, delay });
      return handle;
    },
    clearTimeout(handle) { timeouts.delete(handle); },
    setInterval(callback, delay) {
      const handle = nextHandle++;
      intervals.set(handle, { callback, delay });
      return handle;
    },
    clearInterval(handle) { intervals.delete(handle); }
  };
  const dependencies = {
    client: {
      channel(name) {
        calls.push(["channel", name]);
        return channel;
      },
      removeChannel(value) {
        if (removeError) throw removeError;
        removed.push(value);
      }
    },
    getScope: () => scope,
    getVisibility: () => "visible",
    setStatus: (status) => statuses.push(status),
    refreshCatalog: async () => { calls.push(["catalog"]); },
    refreshProducts: async () => { calls.push(["products"]); },
    syncStock: async (render) => { calls.push(["stock", render]); return true; },
    refreshSmartStock: async () => { calls.push(["smart-stock"]); },
    refreshDependentViews: async (reason) => { calls.push(["dependent", reason]); },
    addWindowListener: (event, listener) => listeners.set(event, listener),
    addVisibilityListener: (listener) => listeners.set("visibilitychange", listener),
    report: (level, context, error) => reports.push({ level, context, error }),
    notifyCatalogFailure: () => calls.push(["notify"]),
    scheduler
  };
  const controller = createRealtimeController(dependencies);
  const runTimeout = async (delay) => {
    const entry = [...timeouts.entries()].find(([, value]) => value.delay === delay);
    assert.ok(entry, `missing timeout ${delay}`);
    timeouts.delete(entry[0]);
    await entry[1].callback();
  };
  return {
    controller, channel, subscriptions, removed, statuses, calls, reports,
    scope, timeouts, intervals, listeners, runTimeout,
    advance(milliseconds) { now += milliseconds; },
    setRemoveError(error) { removeError = error; }
  };
}

test("realtime controller subscribes every table inside the active tenant scope", async () => {
  const state = harness();
  state.controller.subscribe();

  assert.deepEqual(state.calls[0], ["channel", "vendify-business-1-branch-1"]);
  assert.equal(state.subscriptions.length, 6);
  assert.deepEqual(state.subscriptions.map(({ filter }) => [filter.table, filter.filter]), [
    ["productos", "negocio_id=eq.business-1"],
    ["producto_stock_sucursal", "sucursal_id=eq.branch-1"],
    ["ventas", "sucursal_id=eq.branch-1"],
    ["movimientos", "sucursal_id=eq.branch-1"],
    ["compras", "sucursal_id=eq.branch-1"],
    ["proveedores", "negocio_id=eq.business-1"]
  ]);
  assert.deepEqual(state.statuses, ["CONNECTING"]);

  await state.channel.statusCallback("SUBSCRIBED");
  assert.ok(state.calls.some(([name]) => name === "catalog"));
  assert.ok([...state.timeouts.values()].some(({ delay }) => delay === 900));
  assert.ok([...state.timeouts.values()].some(({ delay }) => delay === 260));
});

test("stock events ignore another branch and reconcile the active branch", async () => {
  const state = harness();
  state.controller.subscribe();
  const stockSubscription = state.subscriptions.find(({ filter }) => filter.table === "producto_stock_sucursal");

  stockSubscription.callback({ new: { sucursal_id: "branch-2" } });
  assert.equal(state.calls.some(([name]) => name === "stock"), false);

  stockSubscription.callback({ payload: { branch_id: "branch-1" } });
  await Promise.resolve();
  assert.ok(state.calls.some(([name, render]) => name === "stock" && render === true));
  await state.runTimeout(260);
  assert.ok(state.calls.some(([name, reason]) => name === "dependent" && reason === "stock"));
});

test("channel errors reconnect with the same scoped subscription and disconnect removes it", async () => {
  const state = harness();
  state.controller.subscribe();
  await state.channel.statusCallback("CHANNEL_ERROR");
  await state.runTimeout(1600);

  assert.equal(state.calls.filter(([name]) => name === "channel").length, 2);
  assert.equal(state.removed.length, 1);
  state.controller.disconnect();
  assert.equal(state.removed.length, 2);
  assert.equal(state.statuses.at(-1), "IDLE");
});

test("disconnect preserves legacy tolerance when channel removal throws", () => {
  const state = harness();
  state.controller.subscribe();
  state.setRemoveError(new Error("remove failed"));
  assert.doesNotThrow(() => state.controller.disconnect());
  assert.equal(state.statuses.at(-1), "IDLE");
  assert.ok(state.reports.some(({ context }) => context === "remove-channel"));
});

test("watchdog binds lifecycle once and performs a full foreground reconciliation", async () => {
  const state = harness();
  state.controller.startWatchdog();
  state.controller.startWatchdog();
  assert.equal(state.intervals.size, 1);
  assert.deepEqual([...state.listeners.keys()].sort(), ["focus", "online", "visibilitychange"]);

  await state.listeners.get("focus")();
  await Promise.resolve();
  assert.ok(state.calls.some(([name]) => name === "catalog"));
  assert.ok(state.calls.some(([name]) => name === "channel"));

  state.controller.stopWatchdog();
  assert.equal(state.intervals.size, 0);
});
