import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  createDiagnosticsController
} from "../../dist-ts/observability/diagnostics-controller.js";

function createElement({
  hidden = false,
  innerHTML = "",
  textContent = ""
} = {}) {
  const classes = new Set(hidden ? ["hidden"] : []);
  const listeners = new Map();

  return {
    innerHTML,
    textContent,
    className: "",
    disabled: false,

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
        listener({ type: "click", target: this });
      }
    },

    listenerCount(type) {
      return (listeners.get(type) ?? []).length;
    }
  };
}

function createHarness({
  role = "owner",
  online = true,
  branchName = "Sucursal Centro",
  cashName = "Caja 1",
  runDiagnostic = async () => ({ issues: [] })
} = {}) {
  const state = {
    role,
    online,
    branchName,
    cashName
  };

  const elements = {
    open: createElement(),
    close: createElement(),
    backdrop: createElement(),
    modal: createElement({ hidden: true }),
    run: createElement({
      innerHTML:
        '<svg class="vendify-icon"></svg><span>Ejecutar diagnóstico</span>'
    }),
    connection: createElement(),
    branch: createElement(),
    cash: createElement(),
    summary: createElement({
      textContent: "stale summary"
    }),
    issues: createElement({
      innerHTML: "<p>stale issue</p>"
    })
  };

  const bySelector = new Map([
    ["#btn-diagnostico-v23011", elements.open],
    ["#btn-close-diagnostic-v23011", elements.close],
    ["#modal-diagnostico-v23011 .modal-backdrop", elements.backdrop],
    ["#modal-diagnostico-v23011", elements.modal],
    ["#btn-run-diagnostic-v23011", elements.run],
    ["#diag-connection-v23011", elements.connection],
    ["#diag-branch-v23011", elements.branch],
    ["#diag-cash-v23011", elements.cash],
    ["#diagnostic-summary-v23011", elements.summary],
    ["#diagnostic-issues-v23011", elements.issues]
  ]);

  const toasts = [];
  let diagnosticCalls = 0;

  const controller = createDiagnosticsController({
    getRole: () => state.role,
    isOnline: () => state.online,
    getBranchName: () => state.branchName,
    getCashRegisterName: () => state.cashName,

    async runDiagnostic() {
      diagnosticCalls += 1;
      return runDiagnostic();
    },

    showToast(message, type) {
      toasts.push([message, type]);
    },

    getElement(selector) {
      return bySelector.get(selector) ?? null;
    }
  });

  return {
    controller,
    state,
    elements,
    toasts,

    get diagnosticCalls() {
      return diagnosticCalls;
    }
  };
}

test("owner can open diagnostics", () => {
  const harness = createHarness({ role: "owner" });

  harness.controller.open();

  assert.equal(
    harness.elements.modal.classList.contains("hidden"),
    false
  );
});

test("admin can open diagnostics", () => {
  const harness = createHarness({ role: "admin" });

  harness.controller.open();

  assert.equal(
    harness.elements.modal.classList.contains("hidden"),
    false
  );
});

for (const role of ["manager", "cashier", "viewer"]) {
  test(`${role} cannot open diagnostics`, () => {
    const harness = createHarness({ role });

    harness.controller.open();

    assert.equal(
      harness.elements.modal.classList.contains("hidden"),
      true
    );
  });
}

test("permission denial preserves exact toast", () => {
  const harness = createHarness({ role: "cashier" });

  harness.controller.open();

  assert.deepEqual(harness.toasts, [[
    "Solo Propietario o Administrador pueden ejecutar diagnósticos",
    "error"
  ]]);
});

test("online state renders Online", () => {
  const harness = createHarness({ online: true });

  harness.controller.open();

  assert.equal(harness.elements.connection.textContent, "Online");
});

test("offline state renders Sin conexión", () => {
  const harness = createHarness({ online: false });

  harness.controller.open();

  assert.equal(
    harness.elements.connection.textContent,
    "Sin conexión"
  );
});

test("missing branch renders Sin sucursal", () => {
  const harness = createHarness({ branchName: null });

  harness.controller.open();

  assert.equal(
    harness.elements.branch.textContent,
    "Sin sucursal"
  );
});

test("missing cash register renders Sin caja", () => {
  const harness = createHarness({ cashName: null });

  harness.controller.open();

  assert.equal(
    harness.elements.cash.textContent,
    "Sin caja"
  );
});

test("open resets summary and issues", () => {
  const harness = createHarness();

  harness.controller.open();

  assert.equal(
    harness.elements.summary.textContent,
    "Ejecutá el diagnóstico para revisar la integridad."
  );
  assert.equal(harness.elements.issues.innerHTML, "");
});

test("close hides modal", () => {
  const harness = createHarness();

  harness.controller.open();
  harness.controller.close();

  assert.equal(
    harness.elements.modal.classList.contains("hidden"),
    true
  );
});

test("backdrop closes modal through real bound listener", () => {
  const harness = createHarness();

  harness.controller.setup();
  harness.controller.open();
  harness.elements.backdrop.click();

  assert.equal(
    harness.elements.modal.classList.contains("hidden"),
    true
  );
});

test("setup is idempotent", () => {
  const harness = createHarness();

  harness.controller.setup();
  harness.controller.setup();

  assert.equal(harness.elements.open.listenerCount("click"), 1);
  assert.equal(harness.elements.close.listenerCount("click"), 1);
  assert.equal(harness.elements.backdrop.listenerCount("click"), 1);
  assert.equal(harness.elements.run.listenerCount("click"), 1);
});

test("critical has priority over warning", async () => {
  const harness = createHarness({
    runDiagnostic: async () => ({
      issues: [
        {
          severity: "warning",
          title: "Warning",
          detail: "warning",
          count: 1
        },
        {
          severity: "critical",
          title: "Critical",
          detail: "critical",
          count: 1
        }
      ]
    })
  });

  await harness.controller.run();

  assert.equal(
    harness.elements.summary.className,
    "diagnostic-summary-v23011 critical"
  );
  assert.match(
    harness.elements.summary.innerHTML,
    /1 problema\(s\) crítico\(s\)/
  );
});

test("warning renders when there are no critical issues", async () => {
  const harness = createHarness({
    runDiagnostic: async () => ({
      issues: [{
        severity: "warning",
        title: "Warning",
        detail: "warning",
        count: 2
      }]
    })
  });

  await harness.controller.run();

  assert.equal(
    harness.elements.summary.className,
    "diagnostic-summary-v23011 warning"
  );
  assert.match(
    harness.elements.summary.innerHTML,
    /1 advertencia\(s\)/
  );
});

test("empty issues produce OK summary and empty state", async () => {
  const harness = createHarness();

  await harness.controller.run();

  assert.equal(
    harness.elements.summary.className,
    "diagnostic-summary-v23011 ok"
  );
  assert.match(
    harness.elements.summary.innerHTML,
    /Integridad OK/
  );
  assert.match(
    harness.elements.issues.innerHTML,
    /Sin problemas detectados\./
  );
});

test("dynamic title and detail are escaped", async () => {
  const harness = createHarness({
    runDiagnostic: async () => ({
      issues: [{
        severity: "warning",
        title: "<script>alert(1)</script>",
        detail: "<img src=x>"
      }]
    })
  });

  await harness.controller.run();

  assert.doesNotMatch(
    harness.elements.issues.innerHTML,
    /<script>/
  );
  assert.doesNotMatch(
    harness.elements.issues.innerHTML,
    /<img src=x>/
  );
  assert.match(
    harness.elements.issues.innerHTML,
    /&lt;script&gt;alert\(1\)&lt;\/script&gt;/
  );
  assert.match(
    harness.elements.issues.innerHTML,
    /&lt;img src=x&gt;/
  );
});

test("issue rows preserve severity, icon and count", async () => {
  const harness = createHarness({
    runDiagnostic: async () => ({
      issues: [{
        severity: "critical",
        title: "Integrity",
        detail: "Mismatch",
        count: 7
      }]
    })
  });

  await harness.controller.run();

  assert.match(
    harness.elements.issues.innerHTML,
    /diagnostic-issue-v23011 critical/
  );
  assert.match(
    harness.elements.issues.innerHTML,
    /#vi-alert/
  );
  assert.match(
    harness.elements.issues.innerHTML,
    /<span>7<\/span>/
  );
});

test("run disables button while dependency is pending", async () => {
  let resolveDiagnostic;

  const pending = new Promise((resolve) => {
    resolveDiagnostic = resolve;
  });

  const harness = createHarness({
    runDiagnostic: () => pending
  });

  const runPromise = harness.controller.run();

  assert.equal(harness.elements.run.disabled, true);
  assert.equal(harness.elements.run.innerHTML, "Ejecutando...");

  resolveDiagnostic({ issues: [] });
  await runPromise;
});

test("successful run renders returned diagnostic", async () => {
  const harness = createHarness({
    runDiagnostic: async () => ({
      issues: [{
        severity: "warning",
        title: "Stock",
        detail: "Revisar",
        count: 3
      }]
    })
  });

  await harness.controller.run();

  assert.match(
    harness.elements.issues.innerHTML,
    /Stock/
  );
  assert.match(
    harness.elements.issues.innerHTML,
    /Revisar/
  );
});

test("failed run renders critical error summary", async () => {
  const harness = createHarness({
    runDiagnostic: async () => {
      throw new Error("RPC failed");
    }
  });

  await harness.controller.run();

  assert.equal(
    harness.elements.summary.className,
    "diagnostic-summary-v23011 critical"
  );
  assert.match(
    harness.elements.summary.innerHTML,
    /No se pudo ejecutar el diagnóstico/
  );
  assert.match(
    harness.elements.summary.innerHTML,
    /RPC failed/
  );
});

test("failed run escapes error message", async () => {
  const harness = createHarness({
    runDiagnostic: async () => {
      throw new Error("<script>bad()</script>");
    }
  });

  await harness.controller.run();

  assert.doesNotMatch(
    harness.elements.summary.innerHTML,
    /<script>bad/
  );
  assert.match(
    harness.elements.summary.innerHTML,
    /&lt;script&gt;bad\(\)&lt;\/script&gt;/
  );
});

test("unknown error uses exact fallback", async () => {
  const harness = createHarness({
    runDiagnostic: async () => {
      throw "failure";
    }
  });

  await harness.controller.run();

  assert.match(
    harness.elements.summary.innerHTML,
    /Error desconocido/
  );
});

test("finally restores button after success", async () => {
  const harness = createHarness();
  const original = harness.elements.run.innerHTML;

  await harness.controller.run();

  assert.equal(harness.elements.run.disabled, false);
  assert.equal(harness.elements.run.innerHTML, original);
});

test("finally restores button after failure", async () => {
  const harness = createHarness({
    runDiagnostic: async () => {
      throw new Error("failure");
    }
  });

  const original = harness.elements.run.innerHTML;

  await harness.controller.run();

  assert.equal(harness.elements.run.disabled, false);
  assert.equal(harness.elements.run.innerHTML, original);
});

test("runDiagnostic is invoked exactly once per run-button click", () => {
  const harness = createHarness();

  harness.controller.setup();
  harness.elements.run.click();

  assert.equal(harness.diagnosticCalls, 1);
});

test("UI owner does not duplicate Context RPC or Supabase ownership", () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "../../src/observability/diagnostics-controller.ts"
    ),
    "utf8"
  );

  assert.doesNotMatch(source, /diagnostico_integridad_v1/u);
  assert.doesNotMatch(source, /supabaseClient/u);
  assert.doesNotMatch(source, /VendifyContextV232/u);
});
