export const BACKUP_SECTIONS = [
  "business",
  "config",
  "branches",
  "cash_registers",
  "categories",
  "products",
  "branch_stock",
  "suppliers",
  "members",
  "purchases",
  "purchase_items",
  "cash_sessions",
  "sales",
  "sale_items",
  "sale_payments",
  "sale_returns",
  "cash_movements",
  "inventory_movements",
] as const;

export type BackupSection = (typeof BACKUP_SECTIONS)[number];
export type BackupRow = Readonly<Record<string, unknown>>;

export interface BackupJob {
  readonly backupId: string;
  readonly businessId: string;
  readonly cutoffAt: string;
  readonly expiresAt: string;
}

export interface BackupPage {
  readonly rows: readonly BackupRow[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface BackupPart {
  readonly section: BackupSection;
  readonly partNumber: number;
  readonly rowCount: number;
  readonly byteCount: number;
  readonly sha256: string;
  readonly storagePath: string;
  readonly nextCursor: string | null;
}

export interface BackupManifest {
  readonly format: "vendify-operational-backup-v2";
  readonly schemaVersion: 2;
  readonly backupId: string;
  readonly businessId: string;
  readonly cutoffAt: string;
  readonly createdAt: string;
  readonly parts: readonly BackupPart[];
  readonly totals: Readonly<Record<BackupSection, number>>;
  readonly rootSha256: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} inválido`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} inválido`);
  return value;
}

export function parseBackupJob(value: unknown): BackupJob {
  const row = record(value, "job de respaldo");
  return {
    backupId: string(row.backup_id, "backup_id"),
    businessId: string(row.business_id, "business_id"),
    cutoffAt: string(row.cutoff_at, "cutoff_at"),
    expiresAt: string(row.expires_at, "expires_at"),
  };
}

export function parseBackupPage(value: unknown): BackupPage {
  const page = record(value, "página de respaldo");
  if (!Array.isArray(page.rows)) throw new Error("rows inválido");
  const rows = page.rows.map((item) => record(item, "fila de respaldo"));
  const next = page.next_cursor;
  if (next !== null && typeof next !== "string") throw new Error("next_cursor inválido");
  if (typeof page.has_more !== "boolean") throw new Error("has_more inválido");
  if (page.has_more && !next) throw new Error("página incompleta sin cursor");
  return { rows, nextCursor: next, hasMore: page.has_more };
}
