import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { generateBackup, parseBackupJob, parseBackupPage } from "../dist-ts/commercial/backup/index.js";

const apiUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const userJwt = process.env.VENDIFY_BACKUP_USER_JWT;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const outputDir = process.env.VENDIFY_BACKUP_OUTPUT_DIR;
const existingBackupId = process.env.VENDIFY_BACKUP_ID;
const bucket = "vendify-operational-backups";
const startedAt = performance.now();

if (!apiUrl || !anonKey || !userJwt) throw new Error("Faltan SUPABASE_URL, SUPABASE_ANON_KEY o VENDIFY_BACKUP_USER_JWT");
if (!outputDir && !serviceKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY para Storage o VENDIFY_BACKUP_OUTPUT_DIR para un artefacto local");

async function jsonRequest(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body?.message ?? body?.error_description ?? "respuesta inválida"}`);
  return body;
}

async function userRpc(name, body) {
  return jsonRequest(`${apiUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: anonKey, authorization: `Bearer ${userJwt}`, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

async function adminRequest(resource, init = {}) {
  if (!serviceKey) throw new Error("La operación requiere SUPABASE_SERVICE_ROLE_KEY en el worker");
  return fetch(`${apiUrl}${resource}`, {
    ...init,
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, ...(init.headers ?? {}) },
  });
}

async function patchJob(backupId, values) {
  if (!serviceKey) return;
  const response = await adminRequest(`/rest/v1/operational_backups?id=eq.${encodeURIComponent(backupId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify(values),
  });
  if (!response.ok) throw new Error(`No se pudo persistir el checkpoint (${response.status})`);
}

const started = existingBackupId
  ? await userRpc("estado_respaldo_operativo_v2", { p_backup_id: existingBackupId })
  : await userRpc("iniciar_respaldo_operativo_v2");
const job = parseBackupJob(started);
const priorCheckpoint = started?.manifest?.checkpoint;

try {
  const manifest = await generateBackup(job, {
    fetchPage: async (section, cursor, limit) => parseBackupPage(await userRpc("exportar_pagina_respaldo_operativo_v2", {
      p_backup_id: job.backupId,
      p_section: section,
      p_cursor: cursor,
      p_limit: limit,
    })),
    persistPart: async (artifact, part) => {
      if (outputDir) {
        const destination = path.join(outputDir, artifact.path);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, artifact.bytes);
      } else {
        const response = await adminRequest(`/storage/v1/object/${bucket}/${artifact.path}`, {
          method: "POST",
          headers: { "content-type": artifact.contentEncoding === "gzip" ? "application/gzip" : "application/x-ndjson", "x-upsert": "true" },
          body: artifact.bytes,
        });
        if (!response.ok) throw new Error(`No se pudo subir ${artifact.path} (${response.status})`);
        const inserted = await adminRequest("/rest/v1/operational_backup_parts?on_conflict=backup_id,section,part_number", {
          method: "POST",
          headers: { "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({
            backup_id: job.backupId,
            negocio_id: job.businessId,
            storage_path: artifact.path,
            section: part.section,
            part_number: part.partNumber,
            row_count: part.rowCount,
            byte_count: part.byteCount,
            sha256: part.sha256,
          }),
        });
        if (!inserted.ok) throw new Error(`No se pudo registrar ${artifact.path} (${inserted.status})`);
      }
      return artifact.path;
    },
    persistCheckpoint: async (checkpoint) => patchJob(job.backupId, { manifest: { ...started.manifest, checkpoint } }),
  }, priorCheckpoint ? { resume: priorCheckpoint } : {});

  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestPath = `${job.businessId}/${job.backupId}/manifest.json`;
  if (outputDir) {
    const destination = path.join(outputDir, manifestPath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, manifestBytes);
  } else {
    const uploaded = await adminRequest(`/storage/v1/object/${bucket}/${manifestPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-upsert": "true" },
      body: manifestBytes,
    });
    if (!uploaded.ok) throw new Error(`No se pudo subir el manifiesto (${uploaded.status})`);
    await patchJob(job.backupId, {
      status: "ready",
      storage_path: manifestPath,
      root_sha256: manifest.rootSha256,
      row_count: Object.values(manifest.totals).reduce((sum, value) => sum + value, 0),
      byte_count: manifest.parts.reduce((sum, part) => sum + part.byteCount, 0),
      manifest,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    backupId: job.backupId,
    businessId: job.businessId,
    manifestPath,
    rootSha256: manifest.rootSha256,
    rows: Object.values(manifest.totals).reduce((sum, value) => sum + value, 0),
    totals: manifest.totals,
    bytes: manifest.parts.reduce((sum, part) => sum + part.byteCount, 0),
    elapsedMs: Math.round(performance.now() - startedAt),
    rssBytes: process.memoryUsage().rss,
  })}\n`);
} catch (error) {
  await patchJob(job.backupId, { status: "failed", error_code: "WORKER_FAILED", updated_at: new Date().toISOString() }).catch(() => undefined);
  throw error;
}
