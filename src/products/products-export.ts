import type { Product } from "./product-model.js";

function csvCell(value: string | number): string {
  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
}

export function buildProductsCsv(products: readonly Product[]): string {
  const headers = ["Nombre", "Categoría", "Precio compra", "Precio venta", "Stock", "Stock mínimo"];
  const rows = products.map((product) => [
    csvCell(product.nombre),
    csvCell(product.categoria),
    csvCell(product.precioCompra),
    csvCell(product.precioVenta),
    csvCell(product.stock),
    csvCell(product.stockMinimo)
  ].join(","));
  return [headers.join(","), ...rows].join("\n");
}
