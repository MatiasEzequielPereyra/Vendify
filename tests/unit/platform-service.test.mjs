import assert from "node:assert/strict";
import test from "node:test";
import { isPlatformAdmin, loadPlatformBackoffice, updateBusinessPlan } from "../../dist-ts/platform/platform-service.js";

test("platform service preserves administration contracts", async () => {
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === "es_admin_plataforma_v1") return { data: true, error: null };
    if (name === "platform_overview_v1") return { data: { negocios: 1 }, error: null };
    if (name === "listar_negocios_plataforma_v1") return { data: [{ id: "b1" }], error: null };
    if (name === "listar_errores_plataforma_v1") return { data: [{ id: "e1" }], error: null };
    return { data: { ok: true }, error: null };
  }};
  assert.equal(await isPlatformAdmin(client), true);
  const backoffice = await loadPlatformBackoffice(client);
  assert.equal(backoffice.businesses[0].id, "b1");
  await updateBusinessPlan(client, "b1", "pro", "activo");
  assert.equal(calls.length, 5);
});
test("platform service keeps backend business errors", async () => {
  await assert.rejects(() => updateBusinessPlan({ rpc: async () => ({ data: { ok: false, message: "Plan inválido" }, error: null }) }, "b", "x", "activo"), /Plan inválido/);
});
