import assert from "node:assert/strict";
import test from "node:test";
import { createPwaController } from "../../dist-ts/platform/pwa-controller.js";

function fixture({ dismissed = false, standalone = false } = {}) {
  const handlers = {};
  const calls = [];
  const storage = new Map(dismissed ? [["kiosco_install_dismiss", "1"]] : []);
  const controller = createPwaController({
    registerServiceWorker: () => { calls.push("register"); return Promise.resolve(); },
    onBeforeInstallPrompt: (handler) => { handlers.beforePrompt = handler; },
    onInstallClick: (handler) => { handlers.install = handler; },
    onDismissClick: (handler) => { handlers.dismiss = handler; },
    getStoredValue: (key) => storage.get(key) ?? null,
    setStoredValue: (key, value) => { storage.set(key, value); },
    isStandalone: () => standalone,
    showBanner: () => { calls.push("show"); },
    hideBanner: () => { calls.push("hide"); },
    showInstalledToast: () => { calls.push("installed"); },
    warnRegistrationFailure: () => { calls.push("warn"); }
  });
  return { controller, handlers, calls, storage };
}

function installEvent(outcome = "accepted") {
  const calls = [];
  const event = {
    preventDefault: () => { calls.push("prevent"); },
    prompt: () => { calls.push("prompt"); },
    userChoice: Promise.resolve({ outcome })
  };
  return { event, calls };
}

test("PWA install prompt retains accepted, dismissed and standalone behavior", async () => {
  const normal = fixture();
  normal.controller.setupInstallPrompt();
  normal.controller.setupInstallPrompt();
  const accepted = installEvent();
  normal.handlers.beforePrompt(accepted.event);
  assert.deepEqual(accepted.calls, ["prevent"]);
  assert.deepEqual(normal.calls, ["show"]);
  normal.handlers.install();
  await accepted.event.userChoice;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(accepted.calls, ["prevent", "prompt"]);
  assert.deepEqual(normal.calls, ["show", "hide", "installed"]);
  normal.handlers.install();
  assert.deepEqual(accepted.calls, ["prevent", "prompt"]);

  const dismissed = fixture({ dismissed: true });
  dismissed.controller.setupInstallPrompt();
  dismissed.handlers.beforePrompt(installEvent().event);
  assert.deepEqual(dismissed.calls, []);

  const standalone = fixture({ standalone: true });
  standalone.controller.setupInstallPrompt();
  standalone.handlers.beforePrompt(installEvent().event);
  assert.deepEqual(standalone.calls, []);
});

test("PWA banner dismissal persists and rejected installation does not show success", async () => {
  const state = fixture();
  state.controller.setupInstallPrompt();
  const rejected = installEvent("dismissed");
  state.handlers.beforePrompt(rejected.event);
  state.handlers.install();
  await rejected.event.userChoice;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(state.calls, ["show", "hide"]);
  state.handlers.dismiss();
  assert.equal(state.storage.get("kiosco_install_dismiss"), "1");
});

test("PWA registration reports failure and ignores malformed prompt events", async () => {
  const state = fixture();
  state.controller.setupInstallPrompt();
  state.handlers.beforePrompt({ prompt: () => undefined });
  assert.deepEqual(state.calls, []);
  state.controller.registerServiceWorker();
  assert.deepEqual(state.calls, ["register"]);

  const calls = [];
  createPwaController({
    registerServiceWorker: () => Promise.reject(new Error("registration failed")),
    onBeforeInstallPrompt: () => undefined,
    onInstallClick: () => undefined,
    onDismissClick: () => undefined,
    getStoredValue: () => null,
    setStoredValue: () => undefined,
    isStandalone: () => false,
    showBanner: () => undefined,
    hideBanner: () => undefined,
    showInstalledToast: () => undefined,
    warnRegistrationFailure: () => { calls.push("warn"); }
  }).registerServiceWorker();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["warn"]);
});
