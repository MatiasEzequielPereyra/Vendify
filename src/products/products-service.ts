export type ProductRecord = Record<string, unknown>;

export interface ProductsErrorLike {
  readonly message?: string;
}

export interface ProductsRpcResult {
  readonly data: unknown;
  readonly error: ProductsErrorLike | null;
}

export interface ProductsRpcClientPort {
  rpc(name: string, args?: Record<string, unknown>): Promise<ProductsRpcResult>;
}

export interface ProductInput {
  readonly productId: string | null;
  readonly branchId: string;
  readonly name: string;
  readonly brand: string | null;
  readonly presentation: string | null;
  readonly barcode: string | null;
  readonly category: string | null;
  readonly purchasePrice: number;
  readonly salePrice: number;
  readonly stock: number;
}

export interface CatalogImportItem {
  readonly nombre: string;
  readonly marca: string;
  readonly presentacion: string;
  readonly categoria: string;
}

export interface BulkCatalogImportItem extends CatalogImportItem {
  readonly codigo_barras: string;
  readonly precio_compra: number;
  readonly precio_venta: number;
  readonly stock: number;
}

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }

  cells.push(value.trim());
  return cells;
}

export function normalizeCsvHeader(value: unknown): string {
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function record(value: unknown): ProductRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as ProductRecord
    : {};
}

function records(value: unknown): ProductRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = record(item);
    return Object.keys(parsed).length ? [parsed] : [];
  });
}

function fail(error: ProductsErrorLike | null, fallback: string): void {
  if (error) throw new Error(error.message ?? fallback);
}

function requireOk(data: unknown, fallback: string): ProductRecord {
  const parsed = record(data);
  if (parsed.ok !== true) {
    const message = typeof parsed.message === "string" ? parsed.message : fallback;
    throw new Error(message);
  }
  return parsed;
}

export async function listProducts(
  client: ProductsRpcClientPort,
  branchId: string
): Promise<ProductRecord[]> {
  const { data, error } = await client.rpc("listar_productos_sucursal_seguro_v1", {
    p_sucursal_id: branchId
  });
  fail(error, "No se pudieron cargar los productos de la sucursal");
  return records(data);
}

export async function listCategories(client: ProductsRpcClientPort): Promise<ProductRecord[]> {
  const { data, error } = await client.rpc("listar_categorias_seguras_v1");
  fail(error, "No se pudieron cargar las categorías");
  return records(data);
}

export async function initializeCategories(
  client: ProductsRpcClientPort,
  names: readonly string[]
): Promise<ProductRecord[]> {
  const { data, error } = await client.rpc("inicializar_categorias_seguras_v1", {
    p_nombres: [...names]
  });
  fail(error, "No se pudieron inicializar las categorías");
  return records(data);
}

export async function saveCategory(
  client: ProductsRpcClientPort,
  name: string
): Promise<ProductRecord> {
  const { data, error } = await client.rpc("guardar_categoria_segura_v1", { p_nombre: name });
  fail(error, "No se pudo guardar la categoría");
  return requireOk(data, "No se pudo guardar la categoría");
}

export async function deleteCategory(
  client: ProductsRpcClientPort,
  name: string
): Promise<ProductRecord> {
  const { data, error } = await client.rpc("eliminar_categoria_segura_v1", { p_nombre: name });
  fail(error, "No se pudo eliminar la categoría");
  return requireOk(data, "No se pudo eliminar la categoría");
}

export async function saveProduct(
  client: ProductsRpcClientPort,
  input: ProductInput
): Promise<ProductRecord> {
  const { data, error } = await client.rpc("guardar_producto_seguro_v2", {
    p_producto_id: input.productId,
    p_sucursal_id: input.branchId,
    p_nombre: input.name,
    p_marca: input.brand,
    p_presentacion: input.presentation,
    p_codigo_barras: input.barcode,
    p_categoria: input.category,
    p_precio_compra: input.purchasePrice,
    p_precio_venta: input.salePrice,
    p_stock: input.stock
  });
  fail(error, "No se pudo guardar el producto");
  const parsed = requireOk(data, "No se pudo guardar el producto");
  const product = record(parsed.producto);
  if (!Object.keys(product).length) throw new Error("No se pudo guardar el producto");
  return product;
}

export async function deleteProduct(
  client: ProductsRpcClientPort,
  productId: string
): Promise<ProductRecord> {
  const { data, error } = await client.rpc("eliminar_producto_seguro_v1", {
    p_producto_id: productId
  });
  fail(error, "No se pudo eliminar el producto");
  return requireOk(data, "No se pudo eliminar el producto");
}

export async function deleteAllProducts(client: ProductsRpcClientPort): Promise<ProductRecord> {
  const { data, error } = await client.rpc("eliminar_todos_productos_seguro_v1");
  fail(error, "No se pudieron eliminar los productos");
  return requireOk(data, "No se pudieron eliminar los productos");
}

export async function adjustInitialStock(
  client: ProductsRpcClientPort,
  productId: string,
  branchId: string,
  delta: number
): Promise<ProductRecord> {
  const { data, error } = await client.rpc("ajustar_stock_inicial_rapido_v2", {
    p_producto_id: productId,
    p_sucursal_id: branchId,
    p_delta: delta > 0 ? 1 : -1
  });
  fail(error, "No se pudo modificar el stock");
  return record(data);
}

export async function listSmartStock(
  client: ProductsRpcClientPort,
  branchId: string
): Promise<ProductRecord[]> {
  const { data, error } = await client.rpc("obtener_stock_inteligente_sucursal", {
    p_sucursal_id: branchId
  });
  fail(error, "Stock inteligente no disponible");
  return records(data);
}

export async function confirmScannedStock(
  client: ProductsRpcClientPort,
  productId: string,
  branchId: string,
  requiredStock: number
): Promise<ProductRecord> {
  const { data, error } = await client.rpc("confirmar_stock_por_scanner_v2", {
    p_producto_id: productId,
    p_sucursal_id: branchId,
    p_stock_minimo_necesario: requiredStock
  });
  fail(error, "No se pudo confirmar la unidad escaneada");
  return record(data);
}

export async function importCatalog(
  client: ProductsRpcClientPort,
  branchId: string,
  items: readonly CatalogImportItem[]
): Promise<ProductRecord> {
  const { data, error } = await client.rpc("importar_productos_seguro_v1", {
    p_sucursal_id: branchId,
    p_items: items.map((item) => ({
      nombre: item.nombre,
      marca: item.marca,
      presentacion: item.presentacion,
      categoria: item.categoria
    }))
  });
  fail(error, "No se pudo importar el catálogo");
  return requireOk(data, "No se pudo importar el catálogo");
}


export async function importBulkCatalog(
  client: ProductsRpcClientPort,
  branchId: string,
  items: readonly BulkCatalogImportItem[]
): Promise<ProductRecord> {
  const { data, error } = await client.rpc("importar_productos_masivo_v1", {
    p_sucursal_id: branchId,
    p_items: items.map((item) => ({ ...item }))
  });
  fail(error, "No se pudo importar el catálogo");
  return requireOk(data, "No se pudo importar el catálogo");
}
