import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { inventory, verifyAdminEntry } from "../../scripts/verify-admin-entry.mjs";

function fixture(t) {
  const directory = mkdtempSync(resolve(tmpdir(), "vendify-admin-artifact-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const baseline = resolve(directory, "baseline");
  const target = resolve(directory, "release");
  mkdirSync(baseline);
  writeFileSync(resolve(baseline, "index.html"), "original POS");
  const payload = Buffer.from(JSON.stringify({ role: "anon", ref: "puhkmblnptntorwptvld" })).toString("base64url");
  const config = `const SUPABASE_URL = "https://puhkmblnptntorwptvld.supabase.co";\nconst SUPABASE_ANON_KEY = "public.${payload}.signature";\n`;
  writeFileSync(resolve(baseline, "supabase-config.js"), config + "const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);\n");
  cpSync(baseline, target, { recursive: true });
  mkdirSync(resolve(target, "admin/assets"), { recursive: true });
  writeFileSync(resolve(target, "admin/public-config.js"), config);
  writeFileSync(resolve(target, "admin/index.html"), '<script src="./public-config.js"></script><script type="module" src="/admin/assets/entry-abc.js"></script>');
  writeFileSync(resolve(target, "admin/assets/entry-abc.js"), 'console.log("isolated entry");');
  const reseal = () => {
    const files = inventory(resolve(target, "admin"));
    delete files["artifact-manifest.json"];
    writeFileSync(resolve(target, "admin/artifact-manifest.json"), JSON.stringify({ version: 1, baselineDigest: "a".repeat(64), files }));
  };
  reseal();
  return { baseline, target, reseal };
}

test("additive artifact preserves original inventory and validates references", t => {
  const artifact = fixture(t);
  assert.equal(verifyAdminEntry(artifact).adminFiles, 3);
});
test("rejects a changed classic byte even with resealed admin hashes", t => {
  const artifact = fixture(t);
  writeFileSync(resolve(artifact.target, "index.html"), "changed POS");
  assert.throws(() => verifyAdminEntry(artifact), /baseline file changed/);
});
test("rejects unlisted files and mismatched admin hashes", t => {
  const artifact = fixture(t);
  writeFileSync(resolve(artifact.target, "extra.js"), "extra");
  assert.throws(() => verifyAdminEntry(artifact), /inventory/);
  rmSync(resolve(artifact.target, "extra.js"));
  writeFileSync(resolve(artifact.target, "admin/assets/entry-abc.js"), "tampered");
  assert.throws(() => verifyAdminEntry(artifact), /hash mismatch/);
});
test("rejects broken dependency after hashes have been recomputed", t => {
  const artifact = fixture(t);
  writeFileSync(resolve(artifact.target, "admin/index.html"), '<script src="./missing.js"></script>');
  artifact.reseal();
  assert.throws(() => verifyAdminEntry(artifact), /broken reference/);
});
test("rejects service workers and configuration side effects", t => {
  const artifact = fixture(t);
  writeFileSync(resolve(artifact.target, "admin/assets/entry-abc.js"), 'navigator.serviceWorker.register("/sw.js")');
  artifact.reseal();
  assert.throws(() => verifyAdminEntry(artifact), /unsafe runtime/);
  writeFileSync(resolve(artifact.target, "admin/assets/entry-abc.js"), "");
  writeFileSync(resolve(artifact.target, "admin/public-config.js"), readFileSync(resolve(artifact.baseline, "supabase-config.js")));
  artifact.reseal();
  assert.throws(() => verifyAdminEntry(artifact), /only baseline public constants/);
});
