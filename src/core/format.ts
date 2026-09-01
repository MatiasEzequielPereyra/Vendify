const ARS_FORMATTER = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

export type LegacyScalar = string | number | boolean | null | undefined;

export interface ProductDisplayNameInput {
  readonly nombre?: LegacyScalar;
  readonly presentacion?: LegacyScalar;
}

function normalizeComparableText(value: LegacyScalar): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(",", ".")
    .trim();
}

export function formatArs(value: LegacyScalar): string {
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
