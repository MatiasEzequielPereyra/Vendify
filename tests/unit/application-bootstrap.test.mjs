import assert from "node:assert/strict";
import test from "node:test";
import {
  createApplicationBootstrap,
  scheduleApplicationStart
} from "../../dist-ts/bootstrap/application-bootstrap.js";

function harness({ valid = true, offline = false } = {}) {
  const calls = [];
  let contextReady = false;
  let resolveContext;
  const contextGate = new Promise((resolve) => {
    resolveContext = resolve;
  });
  let gateContext = false;

  const dependencies = {
    validateEnvironment: () => {
      calls.push("validate");
      return valid;
    },
    setupSteps: [
      { name: "service-worker", run: () => calls.push("service-worker") },
      { name: "theme", run: () => calls.push("theme") },
      { name: "navigation", run: () => calls.push("navigation") },
      { name: "inactivity", run: () => calls.push("inactivity") },
      { name: "realtime-watchdog", run: () => calls.push("realtime-watchdog") },
      { name: "pwa-install", run: () => calls.push("pwa-install") }
    ],
    initializeAuth: async () => {
      calls.push("auth-initialize");
    },
    reportAsyncError: (error) => {
      calls.push(["async-error", error]);
    },
    showApplicationShell: () => calls.push("show-app"),
    loadContext: async () => {
      calls.push("load-context");
      if (gateContext) await contextGate;
      contextReady = true;
    },
    isContextReady: () => contextReady,
    isOfflineAuthenticatedMode: () => offline,
    bootOfflineAuthenticated: async () => {
      calls.push("offline-boot");
    },
    bootOnlineAuthenticated: async () => {
      calls.push("online-boot");
    },
    showContextLoadError: (error) => {
      calls.push(["context-error", error]);
    },
    cleanupContext: () => {
      contextReady = false;
      calls.push("cleanup-context");
    },
    clearProducts: () => calls.push("clear-products"),
    clearCart: () => calls.push("clear-cart"),
    disconnectRealtime: () => calls.push("disconnect-realtime")
  };

  return {
    calls,
    dependencies,
    setContextReady(value) {
      contextReady = value;
    },
    gateContext() {
      gateContext = true;
    },
    releaseContext() {
      resolveContext();
    }
  };
}

test("start preserves ordered setup, routes service worker first, and initializes auth last", async () => {
  const state = harness();
  const bootstrap = createApplicationBootstrap(state.dependencies);

  assert.equal(bootstrap.start(), true);
  await Promise.resolve();

  assert.deepEqual(state.calls, [
    "validate",
    "service-worker",
    "theme",
    "navigation",
    "inactivity",
    "realtime-watchdog",
    "pwa-install",
    "auth-initialize"
  ]);
});

test("start is idempotent and owner setup runs exactly once", async () => {
  const state = harness();
  const bootstrap = createApplicationBootstrap(state.dependencies);

  assert.equal(bootstrap.start(), true);
  assert.equal(bootstrap.start(), true);
  await Promise.resolve();

  assert.equal(state.calls.filter((call) => call === "validate").length, 1);
  assert.equal(state.calls.filter((call) => call === "navigation").length, 1);
  assert.equal(state.calls.filter((call) => call === "inactivity").length, 1);
  assert.equal(state.calls.filter((call) => call === "realtime-watchdog").length, 1);
  assert.equal(state.calls.filter((call) => call === "pwa-install").length, 1);
  assert.equal(state.calls.filter((call) => call === "auth-initialize").length, 1);
});

test("environment validation failure aborts before any owner setup", async () => {
  const state = harness({ valid: false });
  const bootstrap = createApplicationBootstrap(state.dependencies);

  assert.equal(bootstrap.start(), false);
  await Promise.resolve();

  assert.deepEqual(state.calls, ["validate"]);
  assert.equal(bootstrap.state().started, false);
});

test("authenticated online boot is single-flight for the same user", async () => {
  const state = harness();
  state.gateContext();
  const bootstrap = createApplicationBootstrap(state.dependencies);
  const session = { user: { id: "user-1" } };

  const first = bootstrap.bootAuthenticated(session);
  const second = bootstrap.bootAuthenticated(session);
  await Promise.resolve();

  assert.equal(state.calls.filter((call) => call === "load-context").length, 1);
  state.releaseContext();
  await Promise.all([first, second]);

  assert.equal(state.calls.filter((call) => call === "online-boot").length, 1);
  await bootstrap.bootAuthenticated(session);
  assert.equal(state.calls.filter((call) => call === "online-boot").length, 1);
});

test("authenticated offline boot selects the cached path", async () => {
  const state = harness({ offline: true });
  const bootstrap = createApplicationBootstrap(state.dependencies);

  await bootstrap.bootAuthenticated({ user: { id: "user-offline" } });

  assert.ok(state.calls.includes("offline-boot"));
  assert.equal(state.calls.includes("online-boot"), false);
});

test("context load failures stop authenticated boot and surface the error", async () => {
  const state = harness();
  const expected = new Error("context unavailable");
  state.dependencies.loadContext = async () => {
    state.calls.push("load-context");
    throw expected;
  };
  const bootstrap = createApplicationBootstrap(state.dependencies);

  await bootstrap.bootAuthenticated({ user: { id: "user-1" } });

  assert.deepEqual(state.calls.at(-1), ["context-error", expected]);
  assert.equal(state.calls.includes("online-boot"), false);
  assert.equal(state.calls.includes("offline-boot"), false);
});

test("sign-out clears context and disconnects realtime", () => {
  const state = harness();
  const bootstrap = createApplicationBootstrap(state.dependencies);

  bootstrap.handleSignedOut();

  assert.deepEqual(state.calls, [
    "cleanup-context",
    "clear-products",
    "clear-cart",
    "disconnect-realtime"
  ]);
  assert.equal(bootstrap.state().authenticatedUserId, null);
});

test("DOMContentLoaded timing installs one listener while ready documents start immediately", () => {
  const calls = [];
  let listener = null;
  const loadingDocument = {
    readyState: "loading",
    addEventListener(type, callback, options) {
      calls.push([type, options]);
      listener = callback;
    }
  };

  scheduleApplicationStart(loadingDocument, () => calls.push("start"));
  assert.deepEqual(calls, [["DOMContentLoaded", { once: true }]]);
  listener();
  assert.equal(calls.at(-1), "start");

  const readyCalls = [];
  scheduleApplicationStart(
    {
      readyState: "complete",
      addEventListener() {
        throw new Error("listener must not be installed");
      }
    },
    () => readyCalls.push("start")
  );
  assert.deepEqual(readyCalls, ["start"]);
});
