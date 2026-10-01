import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  createOnboardingController,
  ONBOARDING_STORAGE_KEY
} from "../../dist-ts/core/onboarding.js";

function createElement({ hidden = true } = {}) {
  const classes = new Set(hidden ? ["hidden"] : []);
  const listeners = new Map();

  return {
    classList: {
      add(...tokens) {
        for (const token of tokens) classes.add(token);
      },
      remove(...tokens) {
        for (const token of tokens) classes.delete(token);
      },
      contains(token) {
        return classes.has(token);
      }
    },
    addEventListener(type, listener) {
      const bucket = listeners.get(type) ?? [];
      bucket.push(listener);
      listeners.set(type, bucket);
    },
    click() {
      for (const listener of listeners.get("click") ?? []) {
        listener({ type: "click" });
      }
    },
    listenerCount(type) {
      return (listeners.get(type) ?? []).length;
    }
  };
}

function createHarness({
  marker,
  includeOnboarding = true,
  includeStart = true,
  includeExamples = true,
  onExamples
} = {}) {
  const values = new Map();
  if (marker !== undefined) values.set(ONBOARDING_STORAGE_KEY, marker);

  const writes = [];
  const onboarding = includeOnboarding ? createElement() : null;
  const start = includeStart ? createElement({ hidden: false }) : null;
  const examples = includeExamples ? createElement({ hidden: false }) : null;
  const elements = new Map([
    ["#onboarding", onboarding],
    ["#btn-empezar", start],
    ["#btn-empezar-ejemplos", examples]
  ]);

  let examplesCalls = 0;
  const controller = createOnboardingController({
    storage: {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        writes.push([key, value]);
        values.set(key, value);
      }
    },
    getElement(selector) {
      return elements.get(selector) ?? null;
    },
    onExamples() {
      examplesCalls += 1;
      onExamples?.({ values, writes, onboarding });
    }
  });

  return {
    controller,
    values,
    writes,
    onboarding,
    start,
    examples,
    get examplesCalls() {
      return examplesCalls;
    }
  };
}

test("missing marker shows onboarding", () => {
  const harness = createHarness();

  harness.controller.setup();

  assert.equal(harness.onboarding.classList.contains("hidden"), false);
});

test("empty marker preserves legacy truthiness and shows onboarding", () => {
  const harness = createHarness({ marker: "" });

  harness.controller.setup();

  assert.equal(harness.onboarding.classList.contains("hidden"), false);
});

test("marker 1 prevents onboarding from showing", () => {
  const harness = createHarness({ marker: "1" });

  harness.controller.setup();

  assert.equal(harness.onboarding.classList.contains("hidden"), true);
});

test("any truthy marker prevents onboarding from showing", () => {
  const harness = createHarness({ marker: "already-completed" });

  harness.controller.setup();

  assert.equal(harness.onboarding.classList.contains("hidden"), true);
});

test("missing onboarding element returns without error", () => {
  const harness = createHarness({ includeOnboarding: false });

  assert.doesNotThrow(() => harness.controller.setup());
});

test("Start persists exact marker and hides onboarding", () => {
  const harness = createHarness();
  harness.controller.setup();

  harness.start.click();

  assert.deepEqual(harness.writes, [[ONBOARDING_STORAGE_KEY, "1"]]);
  assert.equal(harness.onboarding.classList.contains("hidden"), true);
});

test("Examples closes and persists before delegating exactly once", () => {
  let observed;
  const harness = createHarness({
    onExamples({ values, writes, onboarding }) {
      observed = {
        marker: values.get(ONBOARDING_STORAGE_KEY),
        writes: [...writes],
        hidden: onboarding.classList.contains("hidden")
      };
    }
  });
  harness.controller.setup();

  harness.examples.click();

  assert.equal(harness.examplesCalls, 1);
  assert.deepEqual(observed, {
    marker: "1",
    writes: [[ONBOARDING_STORAGE_KEY, "1"]],
    hidden: true
  });
});

test("missing Start button does not crash", () => {
  const harness = createHarness({ includeStart: false });

  assert.doesNotThrow(() => harness.controller.setup());
  assert.equal(harness.onboarding.classList.contains("hidden"), false);
});

test("missing Examples button does not crash", () => {
  const harness = createHarness({ includeExamples: false });

  assert.doesNotThrow(() => harness.controller.setup());
  assert.equal(harness.onboarding.classList.contains("hidden"), false);
});

test("double setup does not bind duplicate listeners", () => {
  const harness = createHarness();

  harness.controller.setup();
  harness.controller.setup();

  assert.equal(harness.start.listenerCount("click"), 1);
  assert.equal(harness.examples.listenerCount("click"), 1);

  harness.examples.click();
  assert.equal(harness.examplesCalls, 1);
});

test("storage key remains exactly compatible with legacy onboarding", () => {
  assert.equal(ONBOARDING_STORAGE_KEY, "kiosco_onboarding_done");
});

test("generic onboarding owner contains no Products implementation", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../../src/core/onboarding.ts"),
    "utf8"
  );

  assert.doesNotMatch(source, /\bopenCatalog\b/u);
  assert.doesNotMatch(source, /VendifyProductsV232/u);
  assert.doesNotMatch(source, /productsControllerV232/u);
});
