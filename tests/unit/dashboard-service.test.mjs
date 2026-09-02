import assert from "node:assert/strict";
import test from "node:test";
import {
  loadDashboard,
  loadOperationalAlerts
} from "../../dist-ts/dashboard/dashboard-service.js";
import {
  dashboardEmpty,
  renderDashboardRows
} from "../../dist-ts/dashboard/dashboard-ui.js";

function makeClient(response) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      return response;
    }
  };
}

test("loadDashboard preserves the branch and period RPC contract", async () => {
  const payload = { ventas_netas: 25000, tickets: 4 };
  const client = makeClient({ data: payload, error: null });

  assert.equal(await loadDashboard(client, "branch-1", 30), payload);
  assert.deepEqual(client.calls, [
    {
      name: "dashboard_propietario_v1",
      args: { p_sucursal_id: "branch-1", p_dias: 30 }
    }
  ]);
});

test("loadDashboard keeps the backend error message", async () => {
  const client = makeClient({ data: null, error: { message: "Solo supervisores" } });

  await assert.rejects(() => loadDashboard(client, null, 7), /Solo supervisores/);
});

test("loadOperationalAlerts preserves its RPC contract", async () => {
  const alerts = [{ severity: "critical", count: 2 }];
  const client = makeClient({ data: alerts, error: null });

  assert.equal(await loadOperationalAlerts(client, "branch-2"), alerts);
  assert.deepEqual(client.calls, [
    {
      name: "alertas_operativas_v1",
      args: { p_sucursal_id: "branch-2" }
    }
  ]);
});

test("loadOperationalAlerts keeps the backend error message", async () => {
  const client = makeClient({ data: null, error: { message: "Alertas no disponibles" } });

  await assert.rejects(
    () => loadOperationalAlerts(client, null),
    /Alertas no disponibles/
  );
});

test("dashboard empty state escapes untrusted text", () => {
  assert.equal(
    dashboardEmpty('<script>alert("x")</script>'),
    '<div class="dashboard-empty-v231">&lt;script&gt;alert("x")&lt;/script&gt;</div>'
  );
});

test("dashboard row renderer preserves rows and empty states", () => {
  const container = { innerHTML: "" };
  renderDashboardRows(container, [{ nombre: "A" }], (row, index) => {
    return `${index}:${row.nombre}`;
  }, "Vacío");
  assert.equal(container.innerHTML, "0:A");

  renderDashboardRows(container, [], () => "unused", "Sin datos");
  assert.equal(container.innerHTML, '<div class="dashboard-empty-v231">Sin datos</div>');
});
