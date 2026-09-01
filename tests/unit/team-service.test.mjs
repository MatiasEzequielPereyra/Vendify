import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdminBusiness,
  listTeam,
  setMemberActive,
  updateMemberRole,
  updateStockPermission
} from "../../dist-ts/team/team-service.js";

function makeClient(responses) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      const response = responses[name];
      if (!response) return { data: null, error: null };
      return typeof response === "function" ? response(args) : response;
    }
  };
}

test("listTeam merges explicit stock permissions with role defaults", async () => {
  const client = makeClient({
    listar_equipo_v3: {
      data: [
        { membership_id: "owner-1", rol: "owner", username: "dueno" },
        { membership_id: "manager-1", rol: "manager", username: "encargado" },
        { membership_id: "cashier-1", rol: "cashier", username: "caja" }
      ],
      error: null
    },
    listar_permisos_stock_equipo_v1: {
      data: [
        { membership_id: "manager-1", puede_gestionar_stock: false },
        { membership_id: "cashier-1", puede_gestionar_stock: true }
      ],
      error: null
    }
  });

  const result = await listTeam(client);

  assert.equal(result.stockPermissionWarning, null);
  assert.equal(result.members[0].puede_gestionar_stock, true);
  assert.equal(result.members[1].puede_gestionar_stock, false);
  assert.equal(result.members[2].puede_gestionar_stock, true);
});

test("listTeam keeps loading when stock permission RPC warns", async () => {
  const warning = { message: "permission source unavailable" };
  const client = makeClient({
    listar_equipo_v3: {
      data: [{ membership_id: "cashier-1", rol: "cashier" }],
      error: null
    },
    listar_permisos_stock_equipo_v1: {
      data: null,
      error: warning
    }
  });

  const result = await listTeam(client);
  assert.equal(result.members[0].puede_gestionar_stock, false);
  assert.equal(result.stockPermissionWarning, warning);
});

test("listTeam fails when authoritative team RPC fails", async () => {
  const client = makeClient({
    listar_equipo_v3: { data: null, error: { message: "team unavailable" } },
    listar_permisos_stock_equipo_v1: { data: [], error: null }
  });

  await assert.rejects(() => listTeam(client), /team unavailable/);
});

test("getAdminBusiness preserves current admin RPC contract", async () => {
  const business = { codigo_acceso: "ABC123" };
  const client = makeClient({
    obtener_negocio_admin_actual: { data: business, error: null }
  });

  assert.equal(await getAdminBusiness(client), business);
  assert.deepEqual(client.calls[0], {
    name: "obtener_negocio_admin_actual",
    args: undefined
  });
});

test("updateStockPermission maps membership and boolean exactly", async () => {
  const client = makeClient({
    actualizar_permiso_stock_miembro_v1: { data: { ok: true }, error: null }
  });

  const result = await updateStockPermission(client, "member-1", true);
  assert.equal(result.ok, true);
  assert.deepEqual(client.calls[0], {
    name: "actualizar_permiso_stock_miembro_v1",
    args: { p_membership_id: "member-1", p_permitir: true }
  });
});

test("updateStockPermission preserves backend failure message", async () => {
  const client = makeClient({
    actualizar_permiso_stock_miembro_v1: {
      data: { ok: false, message: "Solo owner" },
      error: null
    }
  });

  const result = await updateStockPermission(client, "member-1", false);
  assert.deepEqual(result, { ok: false, errorMessage: "Solo owner" });
});

test("role and active mutations preserve current RPC contracts", async () => {
  const client = makeClient({
    actualizar_rol_miembro_v2: { data: { ok: true }, error: null },
    cambiar_estado_miembro_v3: { data: { ok: true }, error: null }
  });

  assert.equal((await updateMemberRole(client, "member-2", "manager")).ok, true);
  assert.equal((await setMemberActive(client, "member-2", false)).ok, true);

  assert.deepEqual(client.calls, [
    {
      name: "actualizar_rol_miembro_v2",
      args: { p_membership_id: "member-2", p_rol: "manager" }
    },
    {
      name: "cambiar_estado_miembro_v3",
      args: { p_membership_id: "member-2", p_activo: false }
    }
  ]);
});
