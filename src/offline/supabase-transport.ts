import type { OfflineSale } from "../types/offline.js";
import type { OfflineSaleTransport, OfflineTransportResult } from "./sync-engine.js";

interface SupabaseRpcResponse {
  readonly data: unknown;
  readonly error: unknown;
}

export interface SupabaseRpcClientLike {
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

export function createRegistrarVentaV4Transport(
  client: SupabaseRpcClientLike
): OfflineSaleTransport {
  return {
    async send(sale: OfflineSale): Promise<OfflineTransportResult> {
      const response = await client.rpc(
        "registrar_venta_v4",
        buildRegistrarVentaV4Args(sale)
      );

      if (response.error) {
        return { ok: false, error: response.error };
      }

      return { ok: true };
    }
  };
}

export { buildRegistrarVentaV4Args };
