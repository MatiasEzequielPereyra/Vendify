import { createHash } from "node:crypto";

export function bootstrapScriptHash(index) {
  const inlineScripts = [...index.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/giu)]
    .map((match) => match[1])
    .filter((source) => source.trim());
  if (inlineScripts.length !== 1 || !inlineScripts[0].includes("window.VENDIFY_HTML_BOOTSTRAP = Object.freeze(")) {
    throw new Error("Expected exactly one Vendify HTML bootstrap inline script");
  }
  return `'sha256-${createHash("sha256").update(inlineScripts[0].replace(/\r\n?/gu, "\n"), "utf8").digest("base64")}'`;
}

export function authorizeBootstrapInVercelConfig(vercelSource, index) {
  const config = JSON.parse(vercelSource);
  const cspHeaders = config.headers.flatMap((rule) => rule.headers)
    .filter((header) => header.key.toLowerCase() === "content-security-policy");
  if (cspHeaders.length !== 1 || !/script-src 'self' https:\/\/cdn\.jsdelivr\.net(?: 'sha256-[A-Za-z0-9+/=]+')?;/u.test(cspHeaders[0].value)) {
    throw new Error("Expected one strict staging script-src policy");
  }
  cspHeaders[0].value = cspHeaders[0].value.replace(
    /script-src 'self' https:\/\/cdn\.jsdelivr\.net(?: 'sha256-[A-Za-z0-9+/=]+')?;/u,
    `script-src 'self' https://cdn.jsdelivr.net ${bootstrapScriptHash(index)};`
  );
  return `${JSON.stringify(config, null, 2)}\n`;
}
