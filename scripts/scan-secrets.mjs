import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, relative } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ignored = new Set([".git", "node_modules", "dist", "dist-ts", "dist-vite", "supabase/legacy"]);
const allowedExt = new Set([".js", ".ts", ".mjs", ".html", ".json", ".yml", ".yaml", ".md"]);
const findings = [];

function shouldIgnore(path) {
  const rel = relative(root, path).replaceAll("\\", "/");
  return [...ignored].some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (shouldIgnore(path)) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else if (allowedExt.has(extname(name))) scan(path);
  }
}

function scan(path) {
  const content = readFileSync(path, "utf8");
  const rel = relative(root, path);
  const patterns = [
    [/SUPABASE_SERVICE_ROLE_KEY\s*=/i, "Supabase service role assignment"],
    [/serviceRoleKey\s*=/i, "service role assignment"],
    [/MERCADO_?PAGO.*ACCESS_?TOKEN\s*=/i, "Mercado Pago access token assignment"],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"]
  ];
  for (const [regex, label] of patterns) {
    if (regex.test(content)) findings.push(`${rel}: ${label}`);
  }
}

walk(root);

if (findings.length) {
  console.error("Potential secrets detected:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log("PASS: no private-secret assignment patterns detected");
