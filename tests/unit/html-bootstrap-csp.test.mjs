import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { authorizeBootstrapInVercelConfig, bootstrapScriptHash } from "../../scripts/html-bootstrap-csp.mjs";
import { renderStagingVercelConfig, resolveStagingSupabaseConfig } from "../../scripts/staging-supabase-config.mjs";

test("emitted staging CSP hashes the executable bootstrap and excludes other inline scripts", () => {
  const root = resolve(import.meta.dirname, "../..");
  const index = readFileSync(resolve(root, "index.html"), "utf8");
  const config = resolveStagingSupabaseConfig({});
  const vercel = JSON.parse(authorizeBootstrapInVercelConfig(
    renderStagingVercelConfig(readFileSync(resolve(root, "vercel.json"), "utf8"), config), index
  ));
  const csp = vercel.headers.flatMap((rule) => rule.headers)
    .find((header) => header.key === "Content-Security-Policy").value;
  const bootstrap = [...index.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/giu)]
    .map((match) => match[1]).find((source) => source.includes("VENDIFY_HTML_BOOTSTRAP"));
  const window = {};
  assert.ok(csp.includes(bootstrapScriptHash(index)));
  vm.runInNewContext(bootstrap, { window });
  assert.equal(window.VENDIFY_HTML_BOOTSTRAP.fragments.length, 7);
  const unauthorized = "window.UNAUTHORIZED_INLINE = true;";
  const unauthorizedHash = `'sha256-${createHash("sha256").update(unauthorized).digest("base64")}'`;
  assert.ok(!csp.includes(unauthorizedHash));
  assert.equal(window.UNAUTHORIZED_INLINE, undefined);
  assert.doesNotMatch(csp.match(/script-src[^;]*/u)[0], /unsafe-inline|unsafe-eval|\*/u);
  assert.throws(
    () => bootstrapScriptHash(index.replace("</body>", `<script>${unauthorized}</script></body>`)),
    /exactly one Vendify HTML bootstrap inline script/u
  );
});

test("bootstrap CSP hash is identical for LF and CRLF HTML", () => {
  const script = "\nwindow.VENDIFY_HTML_BOOTSTRAP = Object.freeze({ enabled: true });\n";
  const lf = `<html><script>${script}</script></html>`;
  const crlf = lf.replace(/\n/gu, "\r\n");
  const expected = `'sha256-${createHash("sha256").update(script).digest("base64")}'`;
  assert.equal(bootstrapScriptHash(lf), expected);
  assert.equal(bootstrapScriptHash(crlf), expected);
});
