import assert from "node:assert/strict";
import test from "node:test";
import { initializeAuthLifecycle } from "../../dist-ts/auth/session-lifecycle.js";

function createHarness(initialSession = null) {
  let listener = null;
  let recoveryActive = false;
  const calls = [];

  const auth = {
    async getSession() {
      calls.push(["getSession"]);
      return { data: { session: initialSession } };
    },
    onAuthStateChange(callback) {
      calls.push(["onAuthStateChange"]);
      listener = callback;
      return { data: { subscription: {} } };
    }
  };

  const callbacks = {
    setSession(session) {
      calls.push(["setSession", session]);
    },
    isRecoveryActive() {
      return recoveryActive;
    },
    setRecoveryActive(active) {
      recoveryActive = active;
      calls.push(["setRecoveryActive", active]);
    },
    showLogin() {
      calls.push(["showLogin"]);
    },
    showNewPasswordPanel() {
      calls.push(["showNewPasswordPanel"]);
    },
    async showApp(session) {
      calls.push(["showApp", session]);
    },
    async handleSignedOut() {
      calls.push(["handleSignedOut"]);
    }
  };

  return {
    auth,
    callbacks,
    calls,
    async emit(event, session) {
      assert.ok(listener, "auth state listener should be registered");
      await listener(event, session);
    }
  };
}

test("existing initial session boots the app exactly once", async () => {
  const session = { user: { id: "owner-1", email: "owner@example.com" } };
  const harness = createHarness(session);

  await initializeAuthLifecycle(harness.auth, harness.callbacks);

  assert.equal(harness.calls.filter(([name]) => name === "showApp").length, 1);
  assert.equal(harness.calls.filter(([name]) => name === "showLogin").length, 0);
});

test("missing initial session shows login", async () => {
  const harness = createHarness(null);
  await initializeAuthLifecycle(harness.auth, harness.callbacks);

  assert.equal(harness.calls.filter(([name]) => name === "showLogin").length, 1);
  assert.equal(harness.calls.filter(([name]) => name === "showApp").length, 0);
});

test("INITIAL_SESSION does not trigger a duplicate app boot", async () => {
  const session = { user: { id: "owner-1" } };
  const harness = createHarness(session);
  await initializeAuthLifecycle(harness.auth, harness.callbacks);

  await harness.emit("INITIAL_SESSION", session);

  assert.equal(harness.calls.filter(([name]) => name === "showApp").length, 1);
});

test("PASSWORD_RECOVERY activates recovery UI without booting app", async () => {
  const harness = createHarness(null);
  await initializeAuthLifecycle(harness.auth, harness.callbacks);
  const session = { user: { id: "owner-1" } };

  await harness.emit("PASSWORD_RECOVERY", session);

  assert.deepEqual(
    harness.calls.filter(([name]) => ["setRecoveryActive", "showNewPasswordPanel"].includes(name)),
    [["setRecoveryActive", true], ["showNewPasswordPanel"]]
  );
  assert.equal(harness.calls.filter(([name]) => name === "showApp").length, 0);
});

test("signed-out auth event delegates legacy cleanup callback", async () => {
  const session = { user: { id: "owner-1" } };
  const harness = createHarness(session);
  await initializeAuthLifecycle(harness.auth, harness.callbacks);

  await harness.emit("SIGNED_OUT", null);

  assert.equal(harness.calls.filter(([name]) => name === "handleSignedOut").length, 1);
});

test("authenticated state change boots app when recovery is inactive", async () => {
  const harness = createHarness(null);
  await initializeAuthLifecycle(harness.auth, harness.callbacks);
  const session = { user: { id: "employee-1" } };

  await harness.emit("SIGNED_IN", session);

  assert.equal(harness.calls.filter(([name]) => name === "showApp").length, 1);
});
