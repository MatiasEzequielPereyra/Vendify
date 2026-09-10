import assert from "node:assert/strict";
import test from "node:test";
import {
  logClientError,
  sanitizeClientErrorMessage
} from "../../dist-ts/observability/error-log-service.js";

test("client error logging redacts bearer tokens and preserves the RPC contract", async () => {
  const calls = [];
  await logClientError({
    rpc: async (name, args) => calls.push({ name, args })
  }, {
    type: "window_error",
    message: "request failed Bearer abc.def_123",
    version: "2.31.1",
    context: { path: "/ventas" }
  });

  assert.deepEqual(calls, [{
    name: "registrar_error_cliente_v1",
    args: {
      p_tipo: "window_error",
      p_mensaje: "request failed Bearer [redacted]",
      p_version: "2.31.1",
      p_contexto: { path: "/ventas" }
    }
  }]);
});

test("client error logging limits stored messages", () => {
  assert.equal(sanitizeClientErrorMessage("x".repeat(1001)).length, 1000);
});
