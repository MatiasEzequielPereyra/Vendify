export interface PurchasesErrorLike {
  message?: string;
}

export interface PurchasesRpcResult {
  data: unknown;
  error: PurchasesErrorLike | null;
}

export interface PurchasesRpcClientPort {
  rpc(name: string, args?: Record<string, unknown>): Promise<PurchasesRpcResult>;
}

export interface SupplierInput {
  id: string | null;
  name: string;
  taxId: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

export interface PurchaseDraftItemInput {
  productId: string;
  quantity: number;
  unitCost: number;
}

export interface PurchaseDraftInput {
  purchaseId: string | null;
  branchId: string;
  supplierId: string;
  receiptNumber: string | null;
  notes: string | null;
  items: PurchaseDraftItemInput[];
}

export type PurchasesRecord = Record<string, unknown>;

function record(value: unknown): PurchasesRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as PurchasesRecord
    : null;
}

function records(value: unknown): PurchasesRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = record(item);
    return parsed ? [parsed] : [];
  });
}

function message(error: PurchasesErrorLike | null, data: unknown, fallback: string): string {
  const response = record(data);
  return error?.message ?? (typeof response?.message === "string" ? response.message : fallback);
}

function requireSuccess(
  error: PurchasesErrorLike | null,
  data: unknown,
  fallback: string
): PurchasesRecord {
  const response = record(data);
  if (error || response?.ok !== true) throw new Error(message(error, data, fallback));
  return response;
}

export async function listSuppliers(client: PurchasesRpcClientPort): Promise<PurchasesRecord[]> {
  const { data, error } = await client.rpc("listar_proveedores_v1");
  if (error) throw new Error(message(error, data, "No se pudieron cargar los proveedores"));
  return records(data);
}

export async function saveSupplier(
  client: PurchasesRpcClientPort,
  input: SupplierInput
): Promise<PurchasesRecord> {
  const { data, error } = await client.rpc("guardar_proveedor_v1", {
    p_id: input.id,
    p_nombre: input.name,
    p_cuit: input.taxId,
    p_contacto: input.contact,
    p_telefono: input.phone,
    p_email: input.email,
    p_direccion: input.address,
    p_notas: input.notes
  });
  return requireSuccess(error, data, "No se pudo guardar el proveedor.");
}

export async function listPurchases(
  client: PurchasesRpcClientPort,
  branchId: string,
  limit = 150
): Promise<PurchasesRecord[]> {
  const { data, error } = await client.rpc("listar_compras_v1", {
    p_sucursal_id: branchId,
    p_limit: limit
  });
  if (error) throw new Error(message(error, data, "No se pudieron cargar las compras"));
  return records(data);
}

export async function getPurchase(
  client: PurchasesRpcClientPort,
  purchaseId: string
): Promise<PurchasesRecord> {
  const { data, error } = await client.rpc("obtener_compra_v1", {
    p_compra_id: purchaseId
  });
  const response = record(data);
  if (error || !response || !record(response.compra)) {
    throw new Error(message(error, data, "No se pudo abrir la compra"));
  }
  return response;
}

export async function savePurchaseDraft(
  client: PurchasesRpcClientPort,
  input: PurchaseDraftInput
): Promise<PurchasesRecord> {
  const { data, error } = await client.rpc("guardar_compra_borrador_v1", {
    p_compra_id: input.purchaseId,
    p_sucursal_id: input.branchId,
    p_proveedor_id: input.supplierId,
    p_numero_comprobante: input.receiptNumber,
    p_nota: input.notes,
    p_items: input.items.map((item) => ({
      producto_id: item.productId,
      cantidad: item.quantity,
      costo_unitario: item.unitCost
    }))
  });
  return requireSuccess(error, data, "No se pudo guardar la compra.");
}

export async function receivePurchase(
  client: PurchasesRpcClientPort,
  purchaseId: string
): Promise<PurchasesRecord> {
  const { data, error } = await client.rpc("recibir_compra_v1", {
    p_compra_id: purchaseId
  });
  return requireSuccess(
    error,
    data,
    "La compra quedó guardada como borrador, pero no se pudo recibir."
  );
}

export async function cancelPurchaseDraft(
  client: PurchasesRpcClientPort,
  purchaseId: string
): Promise<PurchasesRecord> {
  const { data, error } = await client.rpc("anular_compra_borrador_v1", {
    p_compra_id: purchaseId
  });
  return requireSuccess(error, data, "No se pudo anular");
}
