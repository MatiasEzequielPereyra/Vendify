const ARS_FORMATTER = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

export interface ProductDisplayNameInput {
  readonly nombre?: unknown;
  readonly presentacion?: unknown;
}

function normalizeComparableText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(",", ".")
    .trim();
}

export function formatArs(value: unknown): string {
  const normalized = value ? Number(value) : 0;
  return ARS_FORMATTER.format(normalized);
}

export function productDisplayName(
  product: ProductDisplayNameInput | null | undefined
): string {
  const name = String(product?.nombre ?? "").trim();
  const presentation = String(product?.presentacion ?? "").trim();

  if (!presentation) return name;
  if (normalizeComparableText(name).includes(normalizeComparableText(presentation))) {
    return name;
  }

  return `${name} ${presentation}`.trim();
}
