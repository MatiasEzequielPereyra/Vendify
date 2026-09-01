import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};
const pass = (message) => console.log(`PASS: ${message}`);

const required = [
  "index.html",
  "app.js",
  "styles.css",
  "sw.js",
  "supabase-config.js",
  "manifest.json",
  "vercel.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

for (const file of required) {
  if (!existsSync(resolve(root, file))) fail(`missing required file ${file}`);
}
if (!process.exitCode) pass("required production files exist");

try {
  execFileSync(process.execPath, ["--check", resolve(root, "app.js")], {
    stdio: "pipe"
  });
  pass("app.js syntax");
} catch {
  fail("app.js syntax");
}

const html = readFileSync(resolve(root, "index.html"), "utf8");
const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) fail(`duplicate HTML ids: ${[...new Set(duplicates)].join(", ")}`);
else pass("HTML ids unique");

const app = readFileSync(resolve(root, "app.js"), "utf8");
const fnNames = [
  ...app.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)
].map((match) => match[1]);
const duplicateFns = fnNames.filter((name, index) => fnNames.indexOf(name) !== index);
if (duplicateFns.length) fail(`duplicate JS function declarations: ${[...new Set(duplicateFns)].join(", ")}`);
else pass("JS function declarations unique");

const localRefs = [];
for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const ref = match[1];
  if (/^(?:https?:|data:|blob:|#)/.test(ref)) continue;
  const cleaned = ref.split(/[?#]/, 1)[0].replace(/^\.\//, "");
  if (!cleaned || cleaned === "/") continue;
  localRefs.push(cleaned);
}
for (const ref of localRefs) {
  if (!existsSync(resolve(root, ref))) fail(`HTML local reference missing: ${ref}`);
}
if (!process.exitCode) pass("HTML local references resolve");

const securityFiles = ["index.html", "app.js", "supabase-config.js", "vercel.json"];
const oldRef = "vebqlbcfjxnpryjdgfvq";
for (const file of securityFiles) {
  const content = readFileSync(resolve(root, file), "utf8");
  if (content.includes(oldRef)) fail(`${file} contains obsolete Supabase project ref`);
  if (/SUPABASE_SERVICE_ROLE_KEY\s*=|serviceRoleKey\s*=/.test(content)) {
    fail(`${file} appears to define a service role key`);
  }
}
if (!process.exitCode) pass("no obsolete Supabase ref / service-role assignment in runtime files");

const config = readFileSync(resolve(root, "supabase-config.js"), "utf8");
if (!config.includes("puhkmblnptntorwptvld.supabase.co")) {
  fail("supabase-config.js does not target production project");
} else {
  pass("Supabase production project ref");
}

const anonMatch = config.match(/SUPABASE_ANON_KEY\s*=\s*["']([^"']+)["']/);
if (!anonMatch) {
  fail("SUPABASE_ANON_KEY is missing");
} else {
  try {
    const payload = JSON.parse(Buffer.from(anonMatch[1].split(".")[1], "base64url").toString("utf8"));
    if (payload.role !== "anon") fail(`Supabase browser key role is ${payload.role}, expected anon`);
    if (payload.ref !== "puhkmblnptntorwptvld") fail(`Supabase browser key ref is ${payload.ref}`);
    if (payload.role === "anon" && payload.ref === "puhkmblnptntorwptvld") {
      pass("Supabase browser JWT is anon and matches production project");
    }
  } catch {
    fail("SUPABASE_ANON_KEY is not a decodable JWT");
  }
}

const baselineTag = "v2.31.1-production-baseline";
const manifest = JSON.parse(readFileSync(resolve(root, "contracts/baseline-sha256.json"), "utf8"));
try {
  execFileSync("git", ["rev-parse", "--verify", `${baselineTag}^{commit}`], {
    cwd: root,
    stdio: "pipe"
  });

  for (const [file, expected] of Object.entries(manifest.files)) {
    const taggedContent = execFileSync("git", ["show", `${baselineTag}:${file}`], {
      cwd: root,
      stdio: "pipe"
    });
    const actual = createHash("sha256").update(taggedContent).digest("hex");
    if (actual !== expected) fail(`frozen baseline tag hash mismatch: ${file}`);
  }

  if (!process.exitCode) pass(`baseline SHA-256 contract matches tag ${baselineTag}`);
} catch (error) {
  fail(
    `cannot verify ${baselineTag}; fetch tags/full history before QA (${error instanceof Error ? error.message : String(error)})`
  );
}

if (process.exitCode) process.exit(process.exitCode);
