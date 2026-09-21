import assert from "node:assert/strict";
import test from "node:test";

import { BACKUP_SECTIONS, encodeNdjson, generateBackup, parseBackupPage } from "../../dist-ts/commercial/backup/index.js";

test("encodeNdjson ordena claves para producir bytes deterministas", () => {
  assert.equal(new TextDecoder().decode(encodeNdjson([{ z: 1, a: { y: 2, b: 3 } }])), '{"a":{"b":3,"y":2},"z":1}\n');
});

test("parseBackupPage rechaza un cursor ausente si quedan páginas", () => {
  assert.throws(() => parseBackupPage({ rows: [], next_cursor: null, has_more: true }), /sin cursor/);
});

test("generateBackup pagina todas las secciones y persiste checkpoints reanudables", async () => {
  const persisted = [];
  const checkpoints = [];
  const calls = new Map();
  const manifest = await generateBackup(
    { backupId: "backup", businessId: "business", cutoffAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-08T00:00:00Z" },
    {
      fetchPage: async (section, cursor) => {
        const count = (calls.get(section) ?? 0) + 1;
        calls.set(section, count);
        return section === "products" && cursor === null
          ? { rows: [{ id: "p1" }], nextCursor: "opaque", hasMore: true }
          : { rows: section === "products" ? [{ id: "p2" }] : [], nextCursor: null, hasMore: false };
      },
      compress: async (bytes) => bytes,
      sha256: async (bytes) => `hash-${bytes.byteLength}`,
      persistPart: async (artifact) => {
        persisted.push(artifact.path);
        return artifact.path;
      },
      persistCheckpoint: async (checkpoint) => checkpoints.push(checkpoint),
      now: () => "2026-01-01T01:00:00Z",
    },
  );
  assert.equal(calls.get("products"), 2);
  assert.equal(calls.size, BACKUP_SECTIONS.length);
  assert.equal(manifest.totals.products, 2);
  assert.equal(manifest.parts.length, BACKUP_SECTIONS.length + 1);
  assert.equal(persisted.length, manifest.parts.length);
  assert.equal(checkpoints.at(-1).nextSectionIndex, BACKUP_SECTIONS.length);
});

test("generateBackup retoma desde el cursor persistido sin repetir partes", async () => {
  const fetched = [];
  const prior = {
    section: "products",
    partNumber: 0,
    rowCount: 1,
    byteCount: 3,
    sha256: "prior",
    storagePath: "prior.gz",
    nextCursor: "cursor-2",
  };
  const manifest = await generateBackup(
    { backupId: "backup", businessId: "business", cutoffAt: "cutoff", expiresAt: "expires" },
    {
      fetchPage: async (section, cursor) => {
        fetched.push([section, cursor]);
        return { rows: [], nextCursor: null, hasMore: false };
      },
      compress: async (bytes) => bytes,
      sha256: async () => "hash",
      persistPart: async (artifact) => artifact.path,
      persistCheckpoint: async () => undefined,
    },
    { resume: { parts: [prior], nextSectionIndex: BACKUP_SECTIONS.indexOf("products"), nextCursor: "cursor-2", nextPartNumber: 1 } },
  );
  assert.deepEqual(fetched[0], ["products", "cursor-2"]);
  assert.equal(manifest.parts.filter((part) => part.storagePath === "prior.gz").length, 1);
});
