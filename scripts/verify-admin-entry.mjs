import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProductionReleaseContract, verifyProductionReleaseArtifact } from "./production-release-baseline.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = message => { throw new Error("Admin entry verification: " + message); };
export function inventory(directory, prefix = "") {
  return Object.fromEntries(readdirSync(directory).sort().flatMap(name => {
    const path = resolve(directory, name);
    const key = prefix + name;
    if (lstatSync(path).isSymbolicLink()) fail("symlink rejected");
    return lstatSync(path).isDirectory() ? Object.entries(inventory(path, key + "/")) : [[key, hash(readFileSync(path))]];
  }));
}

export function verifyAdminEntry({ baseline, target }) {
  const original = inventory(baseline);
  const final = inventory(target);
  for (const [path, digest] of Object.entries(original)) {
    if (final[path] !== digest) fail("baseline file changed or missing: " + path);
  }
  const manifestPath = "admin/artifact-manifest.json";
  if (!final[manifestPath]) fail("manifest missing");
  const manifest = JSON.parse(readFileSync(resolve(target, manifestPath), "utf8"));
  if (manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.baselineDigest) || typeof manifest.files !== "object" || manifest.files === null) fail("manifest shape");
  const extras = Object.keys(final).filter(path => !(path in original) && path !== manifestPath);
  const expected = Object.keys(manifest.files).map(path => "admin/" + path);
  if (JSON.stringify(extras.sort()) !== JSON.stringify(expected.sort())) fail("unexpected or missing admin inventory");
  if (!expected.includes("admin/index.html")) fail("admin HTML missing");
  for (const path of expected) {
    if (!/^admin\/(?:index\.html|public-config\.js|assets\/[A-Za-z0-9_.-]+\.(?:js|css))$/.test(path)) fail("unapproved path: " + path);
    if (final[path] !== manifest.files[path.slice(6)]) fail("admin hash mismatch: " + path);
    const content = readFileSync(resolve(target, path), "utf8");
    if (/serviceWorker\s*\.\s*register|importScripts\s*\(|sb_secret_|service_role["']?\s*[:=]|sourceMappingURL/.test(content)) fail("unsafe runtime or secret: " + path);
    const references = path.endsWith(".html")
      ? [...content.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1])
      : [...content.matchAll(/(?:from\s*|import\s*\(?|url\()["']([^"']+)["']/g)].map(match => match[1]);
    for (const ref of references) {
      if (ref.startsWith("https://")) {
        if (ref !== "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js") fail("external dependency not pinned");
        continue;
      }
      if (ref.startsWith("#")) continue;
      const clean = ref.split(/[?#]/)[0];
      const destination = resolve(ref.startsWith("/") ? target : dirname(resolve(target, path)), clean.replace(/^\//, ""));
      if (relative(target, destination).startsWith("..") || !existsSync(destination)) fail("broken reference: " + path + " -> " + ref);
    }
    if (path.endsWith(".html") && (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(content) || /\son\w+\s*=|\sstyle\s*=/.test(content))) fail("inline executable content");
  }
  const config = readFileSync(resolve(target, "admin/public-config.js"), "utf8");
  const url = config.match(/const SUPABASE_URL = "([^"]+)"/)?.[1];
  const token = config.match(/const SUPABASE_ANON_KEY = "([^"]+)"/)?.[1];
  let payload;
  try { payload = JSON.parse(Buffer.from(token?.split(".")[1] ?? "", "base64url")); } catch { fail("invalid public key"); }
  if (url !== "https://puhkmblnptntorwptvld.supabase.co" || payload.role !== "anon" || payload.ref !== "puhkmblnptntorwptvld") fail("backend binding invalid");
  const originalConfig = readFileSync(resolve(baseline, "supabase-config.js"), "utf8");
  const expectedConfig = ["SUPABASE_URL", "SUPABASE_ANON_KEY"].map(name => originalConfig.match(new RegExp(`const ${name} = "[^"\\r\\n]+";`))?.[0]).join("\n") + "\n";
  if (config !== expectedConfig) fail("public configuration must contain only baseline public constants");
  return { baselineFiles: Object.keys(original).length, adminFiles: expected.length, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const baseline = resolve(root, "dist");
  const provenance = verifyProductionReleaseArtifact({ root, target: baseline, contract: loadProductionReleaseContract(root) });
  const result = verifyAdminEntry({ baseline, target: resolve(root, process.argv[2] ?? "dist-admin-release") });
  if (result.manifest.baselineDigest !== provenance.digest) fail("baseline provenance mismatch");
  console.log(`PASS: ${result.baselineFiles} baseline files unchanged; ${result.adminFiles} administrative files verified`);
}
