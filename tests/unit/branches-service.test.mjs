import assert from "node:assert/strict";
import test from "node:test";
import {
  createBranch,
  listAdminBranches,
  updateBranch
} from "../../dist-ts/branches/branches-service.js";

function client(result) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return result;
    }
  };
}

test("branch administration services preserve RPC contracts", async () => {
  const api = client({ data: [{ id: "branch-1", nombre: "Central" }], error: null });
  assert.deepEqual(await listAdminBranches(api), [{ id: "branch-1", nombre: "Central" }]);
  await createBranch(api, { name: "Norte", address: null, phone: "123" });
  await updateBranch(api, "branch-1", {
    name: "Central 2",
    address: "Calle 1",
    phone: null,
    active: false
  });

  assert.deepEqual(api.calls, [
    { name: "listar_sucursales_admin_v1", args: undefined },
    {
      name: "crear_sucursal_v1",
      args: { p_nombre: "Norte", p_direccion: null, p_telefono: "123" }
    },
    {
      name: "actualizar_sucursal_v1",
      args: {
        p_sucursal_id: "branch-1",
        p_nombre: "Central 2",
        p_direccion: "Calle 1",
        p_telefono: null,
        p_activa: false
      }
    }
  ]);
});

test("branch administration services preserve backend errors", async () => {
  const api = client({ data: null, error: { message: "Sin permiso" } });
  await assert.rejects(() => listAdminBranches(api), /Sin permiso/);
});
