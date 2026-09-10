import assert from "node:assert/strict";
import test from "node:test";
import {
  exportOperationalBackup,
  getCommercialOnboarding,
  getCurrentPlan,
  getOperationalConfig,
  saveOperationalConfig
} from "../../dist-ts/commercial/commercial-service.js";

test("commercial services preserve read, save and backup RPC contracts", async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { ok: true }, error: null };
    }
  };

  await getCommercialOnboarding(client);
  await getCurrentPlan(client);
  await getOperationalConfig(client);
  await saveOperationalConfig(client, {
    stockCoverageAlert: 3,
    largeAdjustmentUnits: 10,
    cashDifferenceAlert: 100,
    dailySummary: true,
    autoPrintTicket: false,
    ticketWidthMm: 80
  });
  await exportOperationalBackup(client);

  assert.deepEqual(calls.map(({ name, args }) => ({ name, args })), [
    { name: "estado_onboarding_comercial_v1", args: undefined },
    { name: "obtener_plan_actual_v1", args: undefined },
    { name: "obtener_config_operativa_v1", args: undefined },
    {
      name: "guardar_config_operativa_v1",
      args: {
        p_stock_cobertura_alerta: 3,
        p_ajuste_grande_unidades: 10,
        p_diferencia_caja_alerta: 100,
        p_resumen_diario: true,
        p_auto_imprimir_ticket: false,
        p_ancho_ticket_mm: 80
      }
    },
    { name: "exportar_respaldo_operativo_v1", args: undefined }
  ]);
});

test("commercial save keeps a backend business error", async () => {
  await assert.rejects(
    () => saveOperationalConfig({ rpc: async () => ({ data: { ok: false, message: "Valor inválido" }, error: null }) }, {
      stockCoverageAlert: 3,
      largeAdjustmentUnits: 10,
      cashDifferenceAlert: 100,
      dailySummary: true,
      autoPrintTicket: false,
      ticketWidthMm: 80
    }),
    /Valor inválido/
  );
});
