import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTransformedRoutes } from "@vercel/routing-utils";
import { inventory, verifyAdminEntry } from "./verify-admin-entry.mjs";

function checkedHost(host) {
  if (typeof host !== "string" || host !== host.toLowerCase() || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) throw new Error("An exact lowercase hostname is required");
  return host;
}

function exactRoutes(paths, condition) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("Verified route inventory required");
  return paths.map(path => {
    if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.includes("..") || path.startsWith("/")) throw new Error("Invalid artifact path");
    return { src: "^/" + path.replaceAll(".", "\\.") + "$", ...condition, dest: "/" + path };
  });
}

export function getAdminRoutes(baselineConfig, adminHost, baselinePaths, adminPaths) {
  const host = checkedHost(adminHost);
  if (Object.keys(baselineConfig).some(key => key !== "headers")) throw new Error("Unexpected baseline routing configuration");
  const converted = getTransformedRoutes(baselineConfig);
  if (converted.error || !Array.isArray(converted.routes)) throw new Error("Cannot preserve baseline headers");
  const csp = baselineConfig.headers?.find(rule => rule.source === "/(.*)")?.headers?.find(header => header.key.toLowerCase() === "content-security-policy")?.value;
  if (typeof csp !== "string" || !/worker-src\s+[^;]+;/.test(csp)) throw new Error("Baseline CSP missing worker directive");
  const has = [{ type: "host", value: host }];
  return [
    ...converted.routes,
    { src: "^/(.*)$", has, headers: { "Cache-Control": "no-store, max-age=0", "Content-Security-Policy": csp.replace(/worker-src\s+[^;]+;/, "worker-src 'none';") }, continue: true },
    { src: "^/$", has, headers: { Location: "/admin/" }, status: 307 },
    { src: "^/admin$", has, headers: { Location: "/admin/" }, status: 307 },
    { src: "^/admin/$", has, dest: "/admin/index.html" },
    ...exactRoutes(adminPaths, { has }),
    { src: "^/$", missing: has, dest: "/index.html" },
    ...exactRoutes(baselinePaths, { missing: has }),
    { src: "^/.*$", status: 404 }
  ];
}

export function resolvePreviewAdminHost(env, branch) {
  if (branch !== "feature/ven-admin-001b1-read-model" || env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== branch) throw new Error("Admin packaging is authorized only for the named Preview branch");
  const host = checkedHost(env.VERCEL_URL);
  if (!host.endsWith(".vercel.app") || host === env.VERCEL_BRANCH_URL || host === env.VERCEL_PROJECT_PRODUCTION_URL) throw new Error("A fresh unique deployment hostname is required");
  return host;
}

export function packageAdminVercel({ root, adminHost }) {
  const baseline = resolve(root, "dist");
  const artifact = resolve(root, "dist-admin-release");
  verifyAdminEntry({ baseline, target: artifact });
  const config = { version: 3, routes: getAdminRoutes(JSON.parse(readFileSync(resolve(baseline, "vercel.json"), "utf8")), adminHost, Object.keys(inventory(baseline)), Object.keys(inventory(resolve(artifact, "admin"))).map(p => "admin/" + p)) };
  const output = resolve(root, ".vercel/output");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  cpSync(artifact, resolve(output, "static"), { recursive: true });
  writeFileSync(resolve(output, "config.json"), JSON.stringify(config, null, 2) + "\n");
  if (JSON.stringify(inventory(artifact)) !== JSON.stringify(inventory(resolve(output, "static")))) throw new Error("Build Output static bytes changed");
  return { adminHost, config, staticFiles: Object.keys(inventory(artifact)).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const [mode, value, extra] = process.argv.slice(2);
  if (extra || !value || !["--preview-branch", "--admin-host"].includes(mode)) throw new Error("Use --preview-branch <authorized branch>, or --admin-host <local verification hostname>");
  if (mode === "--admin-host" && process.env.VERCEL) throw new Error("Explicit host mode is local-only");
  const adminHost = mode === "--preview-branch" ? resolvePreviewAdminHost(process.env, value) : checkedHost(value);
  const result = packageAdminVercel({ root, adminHost });
  console.log(`PASS: Build Output v3, ${result.staticFiles} byte-identical static files; admin isolated to ${result.adminHost}`);
}
