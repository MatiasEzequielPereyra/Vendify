import assert from "node:assert/strict";
import test from "node:test";
import {
  createInactivityGuard,
  SECURITY_ACTIVITY_KEY_V2301,
  SECURITY_ACTIVITY_WRITE_THROTTLE_MS_V2301,
  SECURITY_IDLE_CHECK_INTERVAL_MS_V2301,
  SECURITY_IDLE_LOGOUT_MESSAGE_V2301,
  SECURITY_IDLE_TIMEOUT_MS_V2301
} from "../../dist-ts/auth/inactivity-guard.js";

function createHarness({
  initialNow = SECURITY_IDLE_TIMEOUT_MS_V2301 + 100000,
  initialSession = { user: { id: "owner-1" } },
  signOut
} = {}) {
  let currentNow = initialNow;
  let session = initialSession;
  let visibilityState = "hidden";
  let signOutCalls = 0;
  const values = new Map();
  const writes = [];
  const toasts = [];
  const windowListeners = [];
  const documentListeners = [];
  const intervals = [];

  const guard = createInactivityGuard({
    getSession: () => session,
    async signOut() {
      signOutCalls += 1;
      if (signOut) await signOut();
    },
    showToast(message, type) {
      toasts.push([message, type]);
    },
    now: () => currentNow,
    storage: {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, value);
        writes.push([key, value]);
      }
    },
    addWindowListener(type, listener, options) {
      windowListeners.push({ type, listener, options });
    },
    addDocumentListener(type, listener, options) {
      documentListeners.push({ type, listener, options });
    },
    getVisibilityState: () => visibilityState,
    setInterval(handler, timeoutMs) {
      intervals.push({ handler, timeoutMs });
      return intervals.length;
    }
  });

  return {
    guard,
    values,
    writes,
    toasts,
    windowListeners,
    documentListeners,
    intervals,
    setNow(value) {
      currentNow = value;
    },
    setSession(value) {
      session = value;
    },
    setVisibilityState(value) {
      visibilityState = value;
    },
    get signOutCalls() {
      return signOutCalls;
    }
  };
}

test("inactivity timing preserves below, exact, and beyond 8-hour boundary", async () => {
  const harness = createHarness();
  const now = SECURITY_IDLE_TIMEOUT_MS_V2301 + 100000;

  harness.setNow(now);
  harness.values.set(
    SECURITY_ACTIVITY_KEY_V2301,
    String(now - SECURITY_IDLE_TIMEOUT_MS_V2301 + 1)
  );
  await harness.guard.check();
  assert.equal(harness.signOutCalls, 0);

  harness.values.set(
    SECURITY_ACTIVITY_KEY_V2301,
    String(now - SECURITY_IDLE_TIMEOUT_MS_V2301)
  );
  await harness.guard.check();
  assert.equal(harness.signOutCalls, 1);

  harness.values.set(
    SECURITY_ACTIVITY_KEY_V2301,
    String(now - SECURITY_IDLE_TIMEOUT_MS_V2301 - 1)
  );
  await harness.guard.check();
  assert.equal(harness.signOutCalls, 2);
});

test("activity persistence keeps the 30-second write throttle", () => {
  const harness = createHarness({ initialNow: 100000 });

  harness.guard.recordActivity();
  assert.deepEqual(harness.writes, [[SECURITY_ACTIVITY_KEY_V2301, "100000"]]);

  harness.setNow(100000 + SECURITY_ACTIVITY_WRITE_THROTTLE_MS_V2301 - 1);
  harness.guard.recordActivity();
  assert.equal(harness.writes.length, 1);

  harness.setNow(100000 + SECURITY_ACTIVITY_WRITE_THROTTLE_MS_V2301);
  harness.guard.recordActivity();
  assert.deepEqual(harness.writes[1], [
    SECURITY_ACTIVITY_KEY_V2301,
    String(100000 + SECURITY_ACTIVITY_WRITE_THROTTLE_MS_V2301)
  ]);
});

test("missing authenticated user never signs out", async () => {
  const harness = createHarness({ initialSession: null });
  harness.values.set(SECURITY_ACTIVITY_KEY_V2301, "1");

  await harness.guard.check();

  assert.equal(harness.signOutCalls, 0);
  assert.equal(harness.toasts.length, 0);
});

test("expired authenticated user receives the existing info toast and signs out", async () => {
  const harness = createHarness();
  harness.values.set(SECURITY_ACTIVITY_KEY_V2301, "1");

  await harness.guard.check();

  assert.equal(harness.signOutCalls, 1);
  assert.deepEqual(harness.toasts, [[SECURITY_IDLE_LOGOUT_MESSAGE_V2301, "info"]]);
});

test("concurrent expired checks keep sign-out single-flight", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const harness = createHarness({
    signOut: async () => {
      await pending;
    }
  });
  harness.values.set(SECURITY_ACTIVITY_KEY_V2301, "1");

  const first = harness.guard.check();
  const second = harness.guard.check();

  assert.equal(harness.signOutCalls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(harness.signOutCalls, 1);
});

test("sign-out failure releases the lock for a later retry", async () => {
  let shouldFail = true;
  const harness = createHarness({
    signOut: async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("signout failed");
      }
    }
  });
  harness.values.set(SECURITY_ACTIVITY_KEY_V2301, "1");

  await assert.rejects(harness.guard.check(), /signout failed/);
  await harness.guard.check();

  assert.equal(harness.signOutCalls, 2);
});

test("checks read the current shared storage value instead of a cached snapshot", async () => {
  const harness = createHarness();
  const now = SECURITY_IDLE_TIMEOUT_MS_V2301 + 100000;
  harness.setNow(now);

  harness.values.set(SECURITY_ACTIVITY_KEY_V2301, String(now));
  await harness.guard.check();
  assert.equal(harness.signOutCalls, 0);

  harness.values.set(
    SECURITY_ACTIVITY_KEY_V2301,
    String(now - SECURITY_IDLE_TIMEOUT_MS_V2301)
  );
  await harness.guard.check();
  assert.equal(harness.signOutCalls, 1);
});

test("invalid stored timestamps preserve legacy fail-closed behavior", async () => {
  const harness = createHarness();
  harness.values.set(SECURITY_ACTIVITY_KEY_V2301, "not-a-timestamp");

  await harness.guard.check();

  assert.equal(harness.signOutCalls, 1);
});

test("empty stored activity preserves legacy fallback-to-now behavior", async () => {
  const harness = createHarness();
  harness.values.set(SECURITY_ACTIVITY_KEY_V2301, "");

  await harness.guard.check();

  assert.equal(harness.signOutCalls, 0);
});

test("start registers legacy activity, focus, visibility and periodic checks once", async () => {
  const harness = createHarness({
    initialNow: SECURITY_IDLE_TIMEOUT_MS_V2301 + 100000
  });

  harness.guard.start();
  harness.guard.start();

  assert.deepEqual(
    harness.windowListeners.map(({ type }) => type),
    ["pointerdown", "keydown", "touchstart", "focus"]
  );
  assert.deepEqual(
    harness.windowListeners.slice(0, 3).map(({ options }) => options),
    [
      { passive: true, capture: true },
      { passive: true, capture: true },
      { passive: true, capture: true }
    ]
  );
  assert.deepEqual(
    harness.documentListeners.map(({ type }) => type),
    ["visibilitychange"]
  );
  assert.equal(harness.intervals.length, 1);
  assert.equal(
    harness.intervals[0].timeoutMs,
    SECURITY_IDLE_CHECK_INTERVAL_MS_V2301
  );
  assert.equal(harness.writes.length, 1);

  harness.values.set(SECURITY_ACTIVITY_KEY_V2301, "1");
  const focus = harness.windowListeners.find(({ type }) => type === "focus");
  assert.ok(focus);
  focus.listener({});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.signOutCalls, 1);

  harness.setVisibilityState("hidden");
  const visibility = harness.documentListeners[0];
  visibility.listener({});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.signOutCalls, 1);

  harness.setVisibilityState("visible");
  visibility.listener({});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.signOutCalls, 2);

  harness.intervals[0].handler();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.signOutCalls, 3);
});
