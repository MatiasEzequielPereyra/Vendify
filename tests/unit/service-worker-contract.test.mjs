import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const serviceWorker = fs.readFileSync(path.resolve(currentDirectory, "../../sw.js"), "utf8");
const app = fs.readFileSync(path.resolve(currentDirectory, "../../app.js"), "utf8");

test("service worker only activates a new shell after the complete cache is installed", () => {
  assert.match(serviceWorker, /const CACHE = "vendify-shell-v234-local-assets"/);
  assert.match(serviceWorker, /caches\.open\(CACHE\)[\s\S]*cache\.addAll\(SHELL\)[\s\S]*self\.skipWaiting\(\)/);
  assert.doesNotMatch(serviceWorker, /cache\.addAll\(SHELL\)[\s\S]*\.catch\(\(\) => null\)/);
});

test("service worker caches every local bootstrap asset required by index.html", () => {
  for (const asset of [
    "./manifest.json",
    "./supabase-config.js",
    "./icons/apple-touch-icon.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
  ]) {
    assert.ok(serviceWorker.includes(asset), `missing shell asset ${asset}`);
  }
});

test("PWA registration failures remain observable in the browser console", () => {
  assert.match(app, /\[PWA\] No se pudo registrar el service worker:/);
});
