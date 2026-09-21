import assert from "node:assert/strict";
import { createSalesConcurrencyClient } from "./sales-concurrency.mjs";

function message(result) {
  return result.data?.message ?? result.data?.error ?? String(result.data ?? result.status);
}

function tokenSubject(token) {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("JWT local sin payload");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(normalized, "base64").toString("utf8")).sub;
}

export async function runOfflineSignedLease(config, fetchImpl = globalThis.fetch, log = console.log) {
  const client = createSalesConcurrencyClient(config, fetchImpl);
  const tokenA = await client.signIn(config.userA);
  const tokenB = await client.signIn(config.userB);
  const outsiderToken = config.outsiderUser
    ? await client.signIn(config.outsiderUser)
    : null;

  const anonymousIssue = await client.rpc(null, "emitir_lease_venta_offline_v1", {
    p_sucursal_id: config.branchId,
    p_caja_id: config.userA.cashId
  });
  assert.equal(anonymousIssue.ok, false, "Anon no debe poder emitir leases offline");

  if (outsiderToken) {
    const crossTenantIssue = await client.rpc(
      outsiderToken,
      "emitir_lease_venta_offline_v1",
      { p_sucursal_id: config.branchId, p_caja_id: config.userA.cashId }
    );
    assert.equal(crossTenantIssue.ok, false, "Otro Negocio no debe emitir leases sobre esta Caja");
  }

  const [issued, issuedForSecondCash] = await Promise.all([
    client.rpc(tokenA, "emitir_lease_venta_offline_v1", {
      p_sucursal_id: config.branchId,
      p_caja_id: config.userA.cashId
    }),
    client.rpc(tokenB, "emitir_lease_venta_offline_v1", {
      p_sucursal_id: config.branchId,
      p_caja_id: config.userB.cashId
    })
  ]);
  assert.equal(issued.ok, true, `No se pudo emitir el lease: ${message(issued)}`);
  assert.equal(issuedForSecondCash.ok, true, `No se pudo emitir el lease concurrente: ${message(issuedForSecondCash)}`);
  assert.equal(issued.data?.version, 1);
  assert.match(issued.data?.token ?? "", /^[0-9a-f]{64}$/);
  assert.equal(issued.data?.branch_id, config.branchId);
  assert.equal(issued.data?.cash_register_id, config.userA.cashId);
  assert.ok(Array.isArray(issued.data?.product_quotas));
  assert.ok(issued.data.product_quotas.some((quota) => quota.product_id === config.productA));
  const anonymousStatus = await client.rpc(null, "obtener_estado_lease_venta_offline_v1", {
    p_lease_id: issued.data.lease_id,
    p_lease_token: issued.data.token
  });
  assert.equal(anonymousStatus.ok, false, "Anon no debe consultar leases offline");
  const quotaFor = (lease, productId) => lease.product_quotas.find((quota) => quota.product_id === productId);
  assert.ok(
    (quotaFor(issued.data, config.productA)?.max_quantity ?? 0)
      + (quotaFor(issuedForSecondCash.data, config.productA)?.max_quantity ?? 0) <= 20,
    "Dos cajas no deben reservar más cupo que el stock disponible"
  );

  const activeState = await client.rpc(tokenA, "obtener_estado_lease_venta_offline_v1", {
    p_lease_id: issued.data.lease_id,
    p_lease_token: issued.data.token
  });
  assert.equal(activeState.ok, true, `No se pudo reconciliar el lease: ${message(activeState)}`);
  assert.equal(activeState.data?.status, "active");
  assert.equal(activeState.data?.token, undefined, "El RPC de estado nunca debe devolver el token");
  const prematureRenewal = await client.rpc(tokenA, "renovar_lease_venta_offline_v1", {
    p_lease_id: issued.data.lease_id,
    p_lease_token: issued.data.token
  });
  assert.equal(prematureRenewal.ok, false, "Un lease con capacidad no debe reemplazarse");
  assert.match(message(prematureRenewal), /todavía tiene capacidad/i);

  const requestId = `qa-offline-lease-${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const args = {
    p_lease_id: issued.data.lease_id,
    p_lease_token: issued.data.token,
    p_offline_created_at: createdAt,
    p_created_by_user_id: tokenSubject(tokenA),
    p_items: [{ producto_id: config.productA, cantidad: 1 }],
    p_pagos: [{ medio_pago: "Efectivo", monto: config.paymentAmount / 2 }],
    p_descuento_tipo: null,
    p_descuento_valor: 0,
    p_observacion: "QA lease offline",
    p_sucursal_id: config.branchId,
    p_caja_id: config.userA.cashId,
    p_request_id: requestId
  };

  const invalidToken = await client.rpc(tokenA, "registrar_venta_offline_v1", {
    ...args,
    p_lease_token: "0".repeat(64)
  });
  assert.equal(invalidToken.ok, false, "Un token modificado debe ser rechazado");
  assert.match(message(invalidToken), /token.*inválido/i);

  const wrongScope = await client.rpc(tokenA, "registrar_venta_offline_v1", {
    ...args,
    p_caja_id: config.userB.cashId
  });
  assert.equal(wrongScope.ok, false, "El lease no debe aceptar otra Caja");
  assert.match(message(wrongScope), /fuera de alcance/i);

  const beforeValidity = await client.rpc(tokenA, "registrar_venta_offline_v1", {
    ...args,
    p_offline_created_at: new Date(Date.parse(issued.data.issued_at) - 1000).toISOString()
  });
  assert.equal(beforeValidity.ok, false, "Una venta anterior al lease debe ser rechazada");
  assert.match(message(beforeValidity), /fuera de la vigencia/i);

  if (outsiderToken) {
    const crossTenantUse = await client.rpc(outsiderToken, "registrar_venta_offline_v1", args);
    assert.equal(crossTenantUse.ok, false, "Otro Negocio no debe consumir el lease");
    assert.match(message(crossTenantUse), /fuera de alcance|usuario creador/i);
  }

  const first = await client.rpc(tokenA, "registrar_venta_offline_v1", args);
  assert.equal(first.ok, true, `No se pudo sincronizar la venta autorizada: ${message(first)}`);
  const retry = await client.rpc(tokenA, "registrar_venta_offline_v1", args);
  assert.equal(retry.ok, true, `El reintento idempotente falló: ${message(retry)}`);
  assert.deepEqual(retry.data, first.data, "El reintento debe devolver la misma venta");

  const retryByAnotherAuthorizedUser = await client.rpc(tokenB, "registrar_venta_offline_v1", args);
  assert.equal(retryByAnotherAuthorizedUser.ok, true, `El reintento multiusuario falló: ${message(retryByAnotherAuthorizedUser)}`);
  assert.deepEqual(retryByAnotherAuthorizedUser.data, first.data, "El requestId debe ser idempotente para toda la Caja");

  const createdByUserB = await client.rpc(tokenB, "registrar_venta_offline_v1", {
    ...args,
    p_request_id: `qa-offline-user-b-${crypto.randomUUID()}`,
    p_created_by_user_id: tokenSubject(tokenB)
  });
  assert.equal(createdByUserB.ok, true, `Otro usuario autorizado no pudo sincronizar en la Caja: ${message(createdByUserB)}`);
  assert.equal(createdByUserB.data?.venta?.user_id, tokenSubject(tokenB), "La venta debe conservar su usuario creador");

  const changedPayload = await client.rpc(tokenA, "registrar_venta_offline_v1", {
    ...args,
    p_observacion: "Payload alterado"
  });
  assert.equal(changedPayload.ok, false, "El mismo requestId no debe aceptar otro payload");
  assert.match(message(changedPayload), /venta distinta|identificador/i);

  const remainingItems = issued.data.product_quotas
    .map((quota) => ({
      producto_id: quota.product_id,
      cantidad: quota.max_quantity - (quota.product_id === config.productA ? 2 : 0)
    }))
    .filter((item) => item.cantidad > 0);
  const remainingAmount = remainingItems.reduce((total, item) => total + item.cantidad * 100, 0);
  const exhaust = await client.rpc(tokenA, "registrar_venta_offline_v1", {
    ...args,
    p_request_id: `qa-offline-exhaust-${crypto.randomUUID()}`,
    p_items: remainingItems,
    p_pagos: [{ medio_pago: "Efectivo", monto: remainingAmount }]
  });
  assert.equal(exhaust.ok, true, `No se pudo agotar el cupo del lease: ${message(exhaust)}`);

  const exhaustedState = await client.rpc(tokenA, "obtener_estado_lease_venta_offline_v1", {
    p_lease_id: issued.data.lease_id,
    p_lease_token: issued.data.token
  });
  assert.equal(exhaustedState.ok, true, `No se pudo consultar el lease agotado: ${message(exhaustedState)}`);
  assert.equal(exhaustedState.data?.status, "exhausted");

  const renewed = await client.rpc(tokenA, "renovar_lease_venta_offline_v1", {
    p_lease_id: issued.data.lease_id,
    p_lease_token: issued.data.token
  });
  assert.equal(renewed.ok, true, `No se pudo renovar el lease agotado: ${message(renewed)}`);
  assert.notEqual(renewed.data?.lease_id, issued.data.lease_id);
  assert.notEqual(renewed.data?.token, issued.data.token);

  const replacedState = await client.rpc(tokenA, "obtener_estado_lease_venta_offline_v1", {
    p_lease_id: issued.data.lease_id,
    p_lease_token: issued.data.token
  });
  assert.equal(replacedState.data?.status, "revoked");

  const unauthorizedRevoke = await client.rpc(tokenB, "revocar_lease_venta_offline_v1", {
    p_lease_id: renewed.data.lease_id
  });
  assert.equal(unauthorizedRevoke.ok, false, "Un Cajero no debe revocar leases");
  assert.match(message(unauthorizedRevoke), /permiso.*revocar/i);

  const revoked = await client.rpc(tokenA, "revocar_lease_venta_offline_v1", {
    p_lease_id: renewed.data.lease_id
  });
  assert.equal(revoked.ok, true, `No se pudo revocar el lease: ${message(revoked)}`);

  const afterRevocation = await client.rpc(tokenA, "registrar_venta_offline_v1", {
    ...args,
    p_lease_id: renewed.data.lease_id,
    p_lease_token: renewed.data.token,
    p_request_id: `qa-offline-revoked-${crypto.randomUUID()}`,
    p_offline_created_at: new Date(Date.parse(revoked.data.revoked_at) + 1000).toISOString()
  });
  assert.equal(afterRevocation.ok, false, "Una venta creada después de revocar debe rechazarse");
  assert.match(message(afterRevocation), /fuera de la vigencia/i);

  log("PASS: offline lease auth, scope, reconciliation, renewal, revocation and idempotency");
}
