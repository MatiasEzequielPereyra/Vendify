import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const target = process.argv[2] ? path.resolve(process.argv[2]) : root;
const checks = [];

function check(id, condition, detail) {
  checks.push({ id, status: condition ? "pass" : "fail", detail });
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

const [html, sw, manifestSource] = await Promise.all([
  readFile(path.join(target, "index.html"), "utf8"),
  readFile(path.join(target, "sw.js"), "utf8"),
  readFile(path.join(target, "manifest.json"), "utf8")
]);
const manifest = JSON.parse(manifestSource);
check(
  "manifest-display",
  manifest.display === "standalone",
  `display=${manifest.display}`
);
check(
  "manifest-start-url",
  typeof manifest.start_url === "string" && manifest.start_url.length > 0,
  `start_url=${manifest.start_url}`
);
check(
  "manifest-theme",
  Boolean(manifest.theme_color && manifest.background_color),
  "theme_color y background_color presentes"
);
check(
  "manifest-icons",
  Array.isArray(manifest.icons)
    && manifest.icons.some((icon) => icon.sizes?.includes("192x192"))
    && manifest.icons.some((icon) => icon.sizes?.includes("512x512")),
  "íconos 192 y 512 declarados"
);

for (const icon of manifest.icons ?? []) {
  const iconPath = path.join(
    target,
    String(icon.src).replace(/^\.\//u, "")
  );
  const info = await stat(iconPath).catch(() => null);
  check(
    `icon-${icon.sizes}`,
    Boolean(info?.isFile() && info.size > 0),
    `${icon.src}: ${info?.size ?? 0} bytes`
  );
}

const targetFiles = await readdir(target);
const registrationSources = [html];

if (target === root) {
  registrationSources.push(
    await readFile(path.join(root, "app.js"), "utf8")
  );
} else {
  const typedApps = targetFiles.filter(
    (file) => /^vendify-app-v232-[0-9a-f]{12}\.js$/u.test(file)
  );
  check(
    "typed-application-entry",
    typedApps.length === 1,
    `typed application bundles=${typedApps.length}`
  );
  if (typedApps.length === 1) {
    registrationSources.push(
      await readFile(path.join(target, typedApps[0]), "utf8")
    );
  }
  check(
    "no-modular-app-js",
    !targetFiles.includes("app.js") && !html.includes("app.js"),
    "dist-refactor-modular no contiene ni referencia app.js"
  );
  check(
    "no-compatibility-app-bundle",
    !targetFiles.some((file) => /^app-refactor-v232-/u.test(file)),
    "sin app-refactor-v232-*"
  );
}

for (const file of targetFiles) {
  if (/^vendify-core-v232-[0-9a-f]{12}\.js$/u.test(file)) {
    registrationSources.push(
      await readFile(path.join(target, file), "utf8")
    );
  }
}
if (target === root) {
  registrationSources.push(
    await readFile(
      path.join(root, "src/legacy/pwa-bridge.ts"),
      "utf8"
    )
  );
}

check(
  "service-worker-registration",
  registrationSources.some((source) =>
    /serviceWorker[\s\S]*register\(["']\.\/sw\.js["']\)/u.test(source)
  ),
  "registro explícito de sw.js"
);
check(
  "atomic-install",
  /cache\.addAll\(SHELL\)[\s\S]*self\.skipWaiting\(\)/u.test(sw),
  "la activación ocurre después de cache.addAll"
);
check(
  "navigation-fallback",
  /request\.mode\s*===\s*["']navigate["']/u.test(sw)
    && sw.includes('caches.match("./index.html"'),
  "fallback del app shell para navegación"
);
check(
  "cache-cleanup",
  /caches\.keys\(\)[\s\S]*caches\.delete/u.test(sw),
  "el activate elimina caches anteriores"
);
check(
  "pinned-supabase",
  /@supabase\/supabase-js@\d+\.\d+\.\d+/u.test(sw),
  "runtime Supabase fijado a una versión"
);
check(
  "pinned-scanner",
  /@zxing\/browser@\d+\.\d+\.\d+/u.test(sw),
  "runtime del scanner fijado a una versión"
);
check(
  "no-public-service-role",
  !/(service_role|SUPABASE_SERVICE_ROLE_KEY)\s*[:=]\s*["'][^"']+/u.test(
    `${html}\n${sw}\n${manifestSource}`
  ),
  "sin credenciales administrativas en el shell"
);

const shellMatch = sw.match(
  /const\s+SHELL\s*=\s*\[([\s\S]*?)\];/u
);
const localShell = shellMatch
  ? [...shellMatch[1].matchAll(/["'](\.\/[^"']+)["']/gu)]
      .map((match) => match[1])
  : [];

check(
  "service-worker-shell-discovered",
  localShell.length > 0,
  `local shell assets=${localShell.length}`
);

const missingShell = [];
for (const entry of localShell) {
  const file = path.join(
    target,
    entry.replace(/^\.\//u, "")
  );
  if (!(await exists(file))) missingShell.push(entry);
}
check(
  "service-worker-shell-assets-exist",
  missingShell.length === 0,
  missingShell.length === 0
    ? "todos los assets locales del shell existen"
    : `faltan: ${missingShell.join(", ")}`
);

if (target !== root) {
  const typedApp = targetFiles.find(
    (file) => /^vendify-app-v232-[0-9a-f]{12}\.js$/u.test(file)
  );
  check(
    "typed-app-offline-shell",
    Boolean(typedApp && localShell.includes(`./${typedApp}`)),
    typedApp
      ? `typed app shell=${typedApp}`
      : "typed app ausente"
  );
  check(
    "modular-shell-no-app-js",
    !localShell.includes("./app.js"),
    "shell modular no depende de app.js"
  );
}

const failed = checks.filter((item) => item.status === "fail");
const report = {
  format: "vendify-pwa-automated-matrix-v1",
  target,
  generatedAt: new Date().toISOString(),
  artifactSha256: createHash("sha256")
    .update(html)
    .update(sw)
    .update(manifestSource)
    .digest("hex"),
  status: failed.length === 0 ? "pass" : "fail",
  checks,
  physicalDeviceCases: [
    "android-install-back-reopen",
    "android-camera-scanner",
    "ios-add-to-home-reopen",
    "ios-camera-scanner",
    "thermal-print-58mm",
    "thermal-print-80mm"
  ]
};
const outputDir = path.join(root, "qa-output", "pwa-matrix");
await mkdir(outputDir, { recursive: true });
await writeFile(
  path.join(outputDir, "automated.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
for (const item of checks) {
  process.stdout.write(
    `${item.status === "pass" ? "PASS" : "FAIL"}: ${item.id} — ${item.detail}\n`
  );
}
if (failed.length > 0) {
  throw new Error(`Fallaron ${failed.length} controles PWA`);
}
