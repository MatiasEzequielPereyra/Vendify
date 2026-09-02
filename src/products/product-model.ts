import type { ProductRecord } from "./products-service.js";

export interface Product extends ProductRecord {
  id: string;
  nombre: string;
  marca: string;
  presentacion: string;
  codigoBarras: string;
  categoria: string;
  precioCompra: number;
  precioVenta: number;
  stock: number;
  stockMinimo: number;
  foto: string | null;
  creado: unknown;
}

export interface SmartStockInfo extends ProductRecord {
  vendidos7d: number;
  vendidos30d: number;
  promedioDiario: number;
  stockBajo: number;
  diasCobertura: number | null;
  reposicion7d: number;
  estado: string;
  tieneHistorial: boolean;
  esBajo: boolean;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function mapProductRow(row: ProductRecord): Product {
  return {
    ...row,
    id: text(row.id),
    nombre: text(row.nombre),
    marca: text(row.marca),
    presentacion: text(row.presentacion),
    codigoBarras: text(row.codigo_barras),
    categoria: text(row.categoria),
    precioCompra: number(row.precio_compra),
    precioVenta: number(row.precio_venta),
    stock: number(row.stock),
    stockMinimo: row.stock_minimo == null ? 5 : number(row.stock_minimo, 5),
    foto: text(row.foto) || null,
    creado: row.creado
  };
}

export function productLabel(product: ProductRecord): string {
  const name = text(product.nombre);
  if (name) return name;
  const fallback = [text(product.marca), text(product.presentacion)].filter(Boolean).join(" ");
  return fallback || "Producto";
}

export function mapSmartStockRow(row: ProductRecord): SmartStockInfo {
  return {
    ...row,
    vendidos7d: number(row.vendidos_7d),
    vendidos30d: number(row.vendidos_30d),
    promedioDiario: number(row.promedio_diario),
    stockBajo: number(row.stock_bajo_calculado),
    diasCobertura: row.dias_cobertura == null ? null : number(row.dias_cobertura),
    reposicion7d: number(row.reposicion_sugerida_7d),
    estado: text(row.estado) || "sin_datos",
    tieneHistorial: Boolean(row.tiene_historial),
    esBajo: row.estado === "bajo"
  };
}

export function isOutOfStock(product: ProductRecord): boolean {
  return number(product.stock) <= 0;
}

export function isLowStock(
  product: ProductRecord,
  info: SmartStockInfo | null
): boolean {
  const stock = number(product.stock);
  if (stock <= 0) return false;
  if (!info) return stock <= number(product.stockMinimo);
  return info.esBajo;
}

export function smartStockText(
  product: ProductRecord,
  info: SmartStockInfo | null
): string {
  const stock = number(product.stock);
  if (!info) return `Stock actual: ${String(stock)}`;
  if (stock <= 0) return "Sin stock";
  if (!info.tieneHistorial) return "Sin historial suficiente de ventas";
  const days = info.diasCobertura == null ? "—" : `${info.diasCobertura.toFixed(1)} días`;
  return [
    `Stock bajo calculado: ≤ ${String(info.stockBajo)}`,
    `Venta estimada: ${info.promedioDiario.toFixed(2)}/día`,
    `Cobertura actual: ${days}`
  ].join(" · ");
}
