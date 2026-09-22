import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const host = "127.0.0.1";
const appPort = 4274;
const debugPort = 9234;
const appUrl = `http://${host}:${appPort}/?offlineEngine=v2312`;
const chrome = process.env.VENDIFY_CHROME_PATH
  ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = await mkdtemp(path.join(tmpdir(), "vendify-pwa-profile-"));
const site = await mkdtemp(path.join(tmpdir(), "vendify-pwa-site-"));
const outputDir = path.resolve("qa-output", "pwa-matrix");
await mkdir(outputDir, { recursive: true });
await cp(path.resolve("dist-refactor-modular"), site, { recursive: true });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await delay(100);
  }
  throw new Error(`No respondió ${url}`);
}

function startServer() {
  const contentTypes = new Map([[".html", "text/html"], [".js", "text/javascript"], [".css", "text/css"], [".json", "application/json"], [".png", "image/png"]]);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", appUrl);
      const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
      const file = path.resolve(site, relative);
      if (!file.startsWith(`${site}${path.sep}`)) return response.writeHead(403).end();
      const body = await readFile(file);
      response.writeHead(200, { "content-type": contentTypes.get(path.extname(file)) ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  server.listen(appPort, host);
  return server;
}

function startChrome() {
  return spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
}

async function connectTarget(url) {
  await waitForHttp(`http://${host}:${debugPort}/json/version`);
  const created = await fetch(`http://${host}:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!created.ok) throw new Error(`Chrome no creó el target (${created.status})`);
  const target = await created.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    const queue = listeners.get(message.method);
    if (queue?.length) queue.shift()(message.params);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const event = (method, timeoutMs = 20_000) => new Promise((resolve, reject) => {
    const queue = listeners.get(method) ?? [];
    queue.push(resolve);
    listeners.set(method, queue);
    setTimeout(() => reject(new Error(`Timeout esperando ${method}`)), timeoutMs).unref();
  });
  return { socket, send, event };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Falló Runtime.evaluate");
  return result.result.value;
}

async function navigate(cdp, url) {
  const loaded = cdp.event("Page.loadEventFired", 30_000);
  const result = await cdp.send("Page.navigate", { url });
  if (result.errorText) throw new Error(result.errorText);
  await loaded;
}

async function openBrowser(url) {
  const chromeProcess = startChrome();
  const cdp = await connectTarget(url);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await navigate(cdp, url);
  return { chromeProcess, cdp };
}

async function closeBrowser(instance) {
  await instance.cdp.send("Browser.close").catch(() => undefined);
  instance.cdp.socket.close();
  await Promise.race([
    new Promise((resolve) => instance.chromeProcess.once("exit", resolve)),
    delay(5_000).then(() => instance.chromeProcess.kill()),
  ]);
}

const server = startServer();
let firstBrowser;
let secondBrowser;
try {
  await waitForHttp(appUrl);
  firstBrowser = await openBrowser(appUrl);
  const installed = await evaluate(firstBrowser.cdp, `(async () => {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('service worker timeout')), 20000))
    ]);
    localStorage.setItem('vendify-pwa-browser-acceptance', 'persisted');
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('vendify-pwa-acceptance', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('proof');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction('proof', 'readwrite');
        transaction.objectStore('proof').put('persisted', 'state');
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      };
    });
    return {
      active: registration.active?.state,
      scope: registration.scope,
      caches: await caches.keys(),
      manifest: document.querySelector('link[rel="manifest"]')?.href,
      title: document.title
    };
  })()`);
  if (installed.active !== "activated" || installed.caches.length === 0) throw new Error("El Service Worker no quedó instalado con cache");
  const serviceWorkerPath = path.join(site, "sw.js");
  const serviceWorkerSource = await readFile(serviceWorkerPath, "utf8");
  const updatedServiceWorker = serviceWorkerSource.replace("vendify-shell-v235-pinned-runtime", "vendify-shell-v236-acceptance-update");
  if (updatedServiceWorker === serviceWorkerSource) throw new Error("No se encontró la versión del cache para ensayar la actualización");
  await writeFile(serviceWorkerPath, updatedServiceWorker);
  const updated = await evaluate(firstBrowser.cdp, `(async () => {
    const registration = await navigator.serviceWorker.ready;
    const changed = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('controllerchange timeout')), 20000);
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
    await registration.update();
    await changed;
    const deadline = Date.now() + 10000;
    let cacheNames = await caches.keys();
    while (cacheNames.includes('vendify-shell-v235-pinned-runtime') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      cacheNames = await caches.keys();
    }
    const idbValue = await new Promise((resolve, reject) => {
      const request = indexedDB.open('vendify-pwa-acceptance', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const read = request.result.transaction('proof', 'readonly').objectStore('proof').get('state');
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      };
    });
    return {
      caches: cacheNames,
      persistedLocalStorage: localStorage.getItem('vendify-pwa-browser-acceptance'),
      persistedIndexedDb: idbValue,
      controller: Boolean(navigator.serviceWorker.controller)
    };
  })()`);
  if (!updated.caches.includes("vendify-shell-v236-acceptance-update") || updated.caches.includes("vendify-shell-v235-pinned-runtime") || updated.persistedIndexedDb !== "persisted") {
    throw new Error(`La actualización atómica no reemplazó el cache preservando el estado local: ${JSON.stringify(updated)}`);
  }
  await closeBrowser(firstBrowser);
  firstBrowser = undefined;
  await new Promise((resolve) => server.close(resolve));

  secondBrowser = await openBrowser(appUrl);
  await secondBrowser.cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const coldBoot = await evaluate(secondBrowser.cdp, `(async () => {
    const idbValue = await new Promise((resolve, reject) => {
      const request = indexedDB.open('vendify-pwa-acceptance', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction('proof', 'readonly');
        const read = transaction.objectStore('proof').get('state');
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      };
    });
    return {
      title: document.title,
      bodyPresent: document.body.children.length > 0,
      persistedLocalStorage: localStorage.getItem('vendify-pwa-browser-acceptance'),
      persistedIndexedDb: idbValue,
      controller: Boolean(navigator.serviceWorker.controller),
      caches: await caches.keys(),
      viewport: [innerWidth, innerHeight]
    };
  })()`);
  if (!coldBoot.bodyPresent || coldBoot.persistedLocalStorage !== "persisted" || coldBoot.persistedIndexedDb !== "persisted" || !coldBoot.controller) {
    throw new Error("El cold boot offline no conservó shell y estado local");
  }
  const screenshot = await secondBrowser.cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(outputDir, "cold-boot-offline-390x844.png"), Buffer.from(screenshot.data, "base64"));
  const report = {
    format: "vendify-pwa-browser-acceptance-v1",
    generatedAt: new Date().toISOString(),
    browser: "Google Chrome headless",
    profile: "fresh-and-reopened",
    serverStoppedBeforeReopen: true,
    installed,
    updated,
    coldBoot,
    status: "pass",
  };
  await writeFile(path.join(outputDir, "browser-acceptance.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (firstBrowser) await closeBrowser(firstBrowser).catch(() => firstBrowser.chromeProcess.kill());
  if (secondBrowser) await closeBrowser(secondBrowser).catch(() => secondBrowser.chromeProcess.kill());
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  await rm(site, { recursive: true, force: true }).catch(() => undefined);
}
