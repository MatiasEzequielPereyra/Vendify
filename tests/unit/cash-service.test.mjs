import assert from "node:assert/strict";
import test from "node:test";
import {
  closeCashRegister,
  createCashRegister,
  getCashState,
  listCashHistory,
  listCashRegisters,
  listOpenCashMovements,
  openCashRegister,
  registerCashMovement,
  setCashRegisterActive
} from "../../dist-ts/cash/cash-service.js";

function makeClient(responses) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      return responses[name] ?? { data: null, error: null };
    }
  };
}

test("cash register reads preserve branch, register and limit contracts", async () => {
  const client = makeClient({
    listar_cajas_sucursal_v1: { data: [{ id: "cash-1" }], error: null },
    obtener_estado_caja_v1: { data: { es_mia: true }, error: null },
    listar_movimientos_caja_abierta_v1: { data: [{ id: "movement-1" }], error: null },
    listar_historial_cajas_v1: { data: [{ id: "session-1" }], error: null }
  });
  assert.equal((await listCashRegisters(client, "branch-1"))[0].id, "cash-1");
  assert.equal((await getCashState(client, "cash-1")).es_mia, true);
  assert.equal((await listOpenCashMovements(client, "cash-1"))[0].id, "movement-1");
  assert.equal((await listCashHistory(client, "branch-1", 12))[0].id, "session-1");
  assert.deepEqual(client.calls, [
    { name: "listar_cajas_sucursal_v1", args: { p_sucursal_id: "branch-1" } },
    { name: "obtener_estado_caja_v1", args: { p_caja_id: "cash-1" } },
    { name: "listar_movimientos_caja_abierta_v1", args: { p_caja_id: "cash-1" } },
    { name: "listar_historial_cajas_v1", args: { p_sucursal_id: "branch-1", p_limit: 12 } }
  ]);
});

test("cash opening, movement and closing preserve atomic RPC payloads", async () => {
  const client = makeClient({
    abrir_caja_v1: { data: { sesion: { id: "session-1" } }, error: null },
    registrar_movimiento_caja_v1: { data: { sesion: { ingresos_total: 250 } }, error: null },
    cerrar_caja_v1: { data: { sesion: { diferencia: 0 } }, error: null }
  });
  await openCashRegister(client, "cash-1", 1000, "Inicio QA");
  await registerCashMovement(client, "cash-1", "ingreso", 250, "Cambio");
  await closeCashRegister(client, "cash-1", 1250, null);
  assert.deepEqual(client.calls, [
    {
      name: "abrir_caja_v1",
      args: { p_caja_id: "cash-1", p_fondo_inicial: 1000, p_nota: "Inicio QA" }
    },
    {
      name: "registrar_movimiento_caja_v1",
      args: { p_caja_id: "cash-1", p_tipo: "ingreso", p_monto: 250, p_motivo: "Cambio" }
    },
    {
      name: "cerrar_caja_v1",
      args: { p_caja_id: "cash-1", p_efectivo_declarado: 1250, p_nota: null }
    }
  ]);
});

test("cash administration preserves create and active-state contracts", async () => {
  const client = makeClient({
    crear_caja_v1: { data: { id: "cash-2" }, error: null },
    cambiar_estado_caja_v1: { data: { id: "cash-2", activa: false }, error: null }
  });
  await createCashRegister(client, "branch-1", "Caja 2");
  await setCashRegisterActive(client, "cash-2", false);
  assert.deepEqual(client.calls, [
    { name: "crear_caja_v1", args: { p_sucursal_id: "branch-1", p_nombre: "Caja 2" } },
    { name: "cambiar_estado_caja_v1", args: { p_caja_id: "cash-2", p_activa: false } }
  ]);
});

test("cash services keep backend error messages", async () => {
  const client = makeClient({
    abrir_caja_v1: { data: null, error: { message: "La caja ya está abierta" } }
  });
  await assert.rejects(
    () => openCashRegister(client, "cash-1", 0, null),
    /La caja ya está abierta/
  );
});
