import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateBackup } from "../../dist-ts/commercial/backup/index.js";
import { verifyArtifact } from "../../scripts/restore-operational-backup-v2.mjs";

test("el restaurador verifica hashes y bloquea un fragmento corrupto", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vendify-backup-"));
  const job = { backupId: "backup", businessId: "business", cutoffAt: "cutoff", expiresAt: "expires" };
  const manifest = await generateBackup(job, {
    fetchPage: async (section) => ({ rows: section === "business" ? [{ id: "business", nombre: "QA" }] : [], nextCursor: null, hasMore: false }),
    compress: async (bytes) => bytes,
    persistPart: async (artifact) => {
      const relative = artifact.path.split("backup/")[1];
      const destination = path.join(root, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, artifact.bytes);
      return artifact.path;
    },
    persistCheckpoint: async () => undefined,
  });
  const manifestFile = path.join(root, "manifest.json");
  await writeFile(manifestFile, JSON.stringify(manifest));
  const verified = await verifyArtifact(manifestFile);
  assert.equal(verified.rows.business.length, 1);
  const target = path.join(root, manifest.parts[0].storagePath.split("backup/")[1]);
  const bytes = await readFile(target);
  bytes[0] ^= 1;
  await writeFile(target, bytes);
  await assert.rejects(verifyArtifact(manifestFile), /Checksum inválido/);
});
