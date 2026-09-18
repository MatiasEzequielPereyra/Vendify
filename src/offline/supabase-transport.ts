import type { OfflineSale } from "../types/offline.js";
import type { OfflineLease } from "../types/offline.js";
import type { OfflineSaleTransport, OfflineTransportResult } from "./sync-engine.js";
import { parseOfflineLease } from "./offline-lease.js";

interface SupabaseRpcResponse {
  readonly data: unknown;
  readonly error: unknown;
}

export interface SupabaseRpcClientLike {
  readonly supabaseUrl?: string;
  rpc(name: string, args: Record<string, unknown>): Promise<SupabaseRpcResponse>;
}

function buildRegistrarVentaV4Args(sale: OfflineSale): Record<string, unknown> {
  return {
    p_items: sale.items.map((item) => ({
      producto_id: item.productId,
      cantidad: item.quantity
    })),
    p_pagos: sale.payments.map((payment) => ({
      medio_pago: payment.method,
      monto: payment.amount
    })),
    p_descuento_tipo: null,
    p_descuento_valor: 0,
    p_observacion: sale.observation ?? null,
    p_sucursal_id: sale.branchId,
    p_caja_id: sale.cashRegisterId,
    p_request_id: sale.requestId
  };
}

export function buildRegistrarVentaOfflineArgs(sale: OfflineSale): Record<string, unknown> {
  if (!sale.lease) throw new Error("La venta histórica no tiene autorización offline y requiere revisión.");
  return {
    ...buildRegistrarVentaV4Args(sale),
    p_lease_id: sale.lease.leaseId,
    p_lease_token: sale.lease.token,
    p_offline_created_at: sale.createdAt,
    p_created_by_user_id: sale.userId
  };
}

export async function requestOfflineLease(
  client: SupabaseRpcClientLike,
  branchId: string,
  cashRegisterId: string
): Promise<OfflineLease> {
  const response = await client.rpc("emitir_lease_venta_offline_v1", {
    p_sucursal_id: branchId,
    p_caja_id: cashRegisterId
  });
  if (response.error) {
    const message = typeof response.error === "object"
      && "message" in response.error && typeof response.error.message === "string"
      ? response.error.message
      : "No se pudo habilitar la operación offline.";
    throw new Error(message);
  }
  return parseOfflineLease(response.data);
}

export async function revokeOfflineLease(
  client: SupabaseRpcClientLike,
  leaseId: string
): Promise<void> {
  const response = await client.rpc("revocar_lease_venta_offline_v1", {
    p_lease_id: leaseId
  });
  if (response.error) {
    const message = typeof response.error === "object"
      && "message" in response.error && typeof response.error.message === "string"
      ? response.error.message
      : "No se pudo revocar la autorización offline.";
    throw new Error(message);
  }
}

export function createRegistrarVentaV4Transport(
  client: SupabaseRpcClientLike
): OfflineSaleTransport {
  return {
    async send(sale: OfflineSale): Promise<OfflineTransportResult> {
      if (!sale.lease) {
        return {
          ok: false,
          error: { code: "OFFLINE_LEASE_MISSING", message: "La venta histórica no tiene autorización offline." }
        };
      }
      const response = await client.rpc(
        "registrar_venta_offline_v1",
        buildRegistrarVentaOfflineArgs(sale)
      );

      if (response.error) {
        return { ok: false, error: response.error };
      }

      return { ok: true };
    }
  };
}

export { buildRegistrarVentaV4Args };
