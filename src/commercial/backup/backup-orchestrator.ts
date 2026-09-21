import {
  BACKUP_SECTIONS,
  type BackupJob,
  type BackupManifest,
  type BackupPage,
  type BackupPart,
  type BackupRow,
  type BackupSection,
} from "./backup-contract.js";

export interface BackupCheckpoint {
  readonly parts: readonly BackupPart[];
  readonly nextSectionIndex: number;
  readonly nextCursor: string | null;
  readonly nextPartNumber: number;
}

export interface BackupArtifact {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly contentEncoding: "gzip" | "identity";
}

export interface BackupOrchestratorDependencies {
  readonly fetchPage: (section: BackupSection, cursor: string | null, limit: number) => Promise<BackupPage>;
  readonly persistPart: (artifact: BackupArtifact, part: Omit<BackupPart, "storagePath">) => Promise<string>;
  readonly persistCheckpoint: (checkpoint: BackupCheckpoint) => Promise<void>;
  readonly compress?: (bytes: Uint8Array) => Promise<Uint8Array>;
  readonly sha256?: (bytes: Uint8Array) => Promise<string>;
  readonly now?: () => string;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, stable(source[key])]));
  }
  return value;
}

export function encodeNdjson(rows: readonly BackupRow[]): Uint8Array {
  const body = rows.map((row) => JSON.stringify(stable(row))).join("\n");
  return new TextEncoder().encode(body.length > 0 ? `${body}\n` : "");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function generateBackup(
  job: BackupJob,
  dependencies: BackupOrchestratorDependencies,
  options: { readonly pageSize?: number; readonly resume?: BackupCheckpoint } = {},
): Promise<BackupManifest> {
  const pageSize = options.pageSize ?? 1_000;
  if (!Number.isInteger(pageSize) || pageSize < 100 || pageSize > 2_000) throw new Error("pageSize fuera de rango");
  const hash = dependencies.sha256 ?? sha256Hex;
  const compress = dependencies.compress ?? gzip;
  const parts: BackupPart[] = [...(options.resume?.parts ?? [])];
  let sectionIndex = options.resume?.nextSectionIndex ?? 0;
  let cursor = options.resume?.nextCursor ?? null;
  let partNumber = options.resume?.nextPartNumber ?? 0;

  for (; sectionIndex < BACKUP_SECTIONS.length; sectionIndex += 1) {
    const section = BACKUP_SECTIONS[sectionIndex];
    if (!section) throw new Error("sección de respaldo inválida");
    do {
      const page = await dependencies.fetchPage(section, cursor, pageSize);
      const raw = encodeNdjson(page.rows);
      const compressed = await compress(raw);
      const contentEncoding = compressed === raw ? "identity" : "gzip";
      const digest = await hash(compressed);
      const partial = {
        section,
        partNumber,
        rowCount: page.rows.length,
        byteCount: compressed.byteLength,
        sha256: digest,
        nextCursor: page.nextCursor,
      } satisfies Omit<BackupPart, "storagePath">;
      const path = `${job.businessId}/${job.backupId}/${section}/${String(partNumber).padStart(6, "0")}.ndjson${contentEncoding === "gzip" ? ".gz" : ""}`;
      const storagePath = await dependencies.persistPart({ path, bytes: compressed, contentEncoding }, partial);
      parts.push({ ...partial, storagePath });
      cursor = page.nextCursor;
      partNumber += 1;
      const sectionDone = !page.hasMore;
      await dependencies.persistCheckpoint({
        parts: [...parts],
        nextSectionIndex: sectionDone ? sectionIndex + 1 : sectionIndex,
        nextCursor: sectionDone ? null : cursor,
        nextPartNumber: sectionDone ? 0 : partNumber,
      });
    } while (cursor !== null);
    cursor = null;
    partNumber = 0;
  }

  const totals = Object.fromEntries(BACKUP_SECTIONS.map((section) => [
    section,
    parts.filter((part) => part.section === section).reduce((sum, part) => sum + part.rowCount, 0),
  ])) as Record<BackupSection, number>;
  const rootInput = new TextEncoder().encode(JSON.stringify(parts.map(({ section, partNumber: number, sha256, rowCount }) => ({ section, partNumber: number, sha256, rowCount }))));
  return {
    format: "vendify-operational-backup-v2",
    schemaVersion: 2,
    backupId: job.backupId,
    businessId: job.businessId,
    cutoffAt: job.cutoffAt,
    createdAt: dependencies.now?.() ?? new Date().toISOString(),
    parts,
    totals,
    rootSha256: await hash(rootInput),
  };
}
