import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmployee,
  deleteEmployee,
  resetEmployeePassword,
  updateEmployee
} from "../../dist-ts/team/team-edge-service.js";

function functionsClient(resultFactory) {
  const calls = [];
  return {
    calls,
    async invoke(name, options) {
      calls.push({ name, options });
      return resultFactory(name, options);
    }
  };
}

test("createEmployee preserves crear-empleado function contract", async () => {
  const client = functionsClient(() => ({ data: { ok: true }, error: null }));

  const result = await createEmployee(client, {
    nombre: "Ana",
    username: "ana",
    rol: "cashier",
    password: "Clave123!"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(client.calls, [
    {
      name: "crear-empleado",
      options: {
        body: {
          nombre: "Ana",
          username: "ana",
          rol: "cashier",
          password: "Clave123!"
        }
      }
    }
  ]);
});

test("createEmployee prioritizes backend data.error message", async () => {
  const client = functionsClient(() => ({
    data: { error: "Usuario existente" },
    error: { message: "FunctionsHttpError" }
  }));

  const result = await createEmployee(client, {
    nombre: "Ana",
    username: "ana",
    rol: "cashier",
    password: "Clave123!"
  });

  assert.deepEqual(result, {
    ok: false,
    errorMessage: "Usuario existente",
    data: { error: "Usuario existente" }
  });
});

test("updateEmployee preserves gestionar-empleado update contract", async () => {
  const client = functionsClient(() => ({ data: { ok: true }, error: null }));

  const result = await updateEmployee(client, {
    membershipId: "membership-1",
    nombre: "Ana Pérez",
    username: "ana.perez",
    rol: "manager"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(client.calls[0], {
    name: "gestionar-empleado",
    options: {
      body: {
        action: "update",
        membership_id: "membership-1",
        nombre: "Ana Pérez",
        username: "ana.perez",
        rol: "manager"
      }
    }
  });
});

test("deleteEmployee preserves gestionar-empleado delete contract", async () => {
  const client = functionsClient(() => ({ data: null, error: null }));
  const result = await deleteEmployee(client, "membership-2");

  assert.equal(result.ok, true);
  assert.deepEqual(client.calls[0], {
    name: "gestionar-empleado",
    options: {
      body: {
        action: "delete",
        membership_id: "membership-2"
      }
    }
  });
});

test("resetEmployeePassword preserves reset_password contract and transport errors", async () => {
  const client = functionsClient(() => ({
    data: null,
    error: { message: "Edge function unavailable" }
  }));

  const result = await resetEmployeePassword(client, "membership-3", "Nueva123!");

  assert.equal(result.ok, false);
  assert.equal(result.errorMessage, "Edge function unavailable");
  assert.deepEqual(client.calls[0], {
    name: "gestionar-empleado",
    options: {
      body: {
        action: "reset_password",
        membership_id: "membership-3",
        password: "Nueva123!"
      }
    }
  });
});
