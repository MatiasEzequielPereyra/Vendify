import { escapeHtml } from "../core/dom.js";
import type { ProductsStore } from "./products-store.js";

interface SaleCartItem {
  readonly id: string;
  readonly cantidad?: number;
}

export interface SaleProductsViewInput {
  readonly store: ProductsStore;
  readonly query: string;
  readonly cart: readonly SaleCartItem[];
  readonly formatCurrency: (value: number) => string;
}

export function renderSaleProductsHtml(input: SaleProductsViewInput): string {
  const products = input.store.search(input.query)
    .sort((left, right) => left.nombre.localeCompare(right.nombre, "es"));
  if (products.length === 0) return '<p class="carrito-vacio">Sin resultados</p>';

  return products.map((product) => {
    const cartItem = input.cart.find((candidate) => candidate.id === product.id);
    const available = product.stock - (cartItem?.cantidad ?? 0);
    const barcode = product.codigoBarras ? `EAN ${escapeHtml(product.codigoBarras)} · ` : "";
    const initial = (product.marca || product.nombre).slice(0, 1).toUpperCase();
    return `<div class="venta-producto-item ${available <= 0 ? "sin-stock" : ""}" data-id="${escapeHtml(product.id)}">
      <div class="venta-producto-thumb">${escapeHtml(initial)}</div>
      <div class="venta-producto-info">
        <div class="venta-producto-nombre">${escapeHtml(product.nombre)}</div>
        <div class="venta-producto-meta">${barcode}${input.formatCurrency(product.precioVenta)} · quedan ${String(available)}</div>
      </div>
    </div>`;
  }).join("");
}
