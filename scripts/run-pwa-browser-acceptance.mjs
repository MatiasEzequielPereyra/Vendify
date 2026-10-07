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
  const ciArgs = process.env.CI === "true"
    ? ["--no-sandbox", "--disable-dev-shm-usage"]
    : [];

  return spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1",
    ...ciArgs,
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: process.env.CI === "true" ? ["ignore", "ignore", "inherit"] : "ignore", windowsHide: true });
}

async function connectTarget(url) {
  await waitForHttp(`http://${host}:${debugPort}/json/version`, 200);
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

async function waitForBrowserCondition(
  cdp,
  expression,
  label,
  attempts = 80
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const ready = await evaluate(cdp, expression);
    if (ready === true) return;
    await delay(50);
  }
  throw new Error(`Timeout esperando ${label}`);
}

async function navigate(cdp, url) {
  const loaded = cdp.event("Page.loadEventFired", 30_000);
  const result = await cdp.send("Page.navigate", { url });
  if (result.errorText) throw new Error(result.errorText);
  await loaded;
}

async function reload(cdp) {
  const loaded = cdp.event("Page.loadEventFired", 30_000);
  await cdp.send("Page.reload", { ignoreCache: true });
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

  await waitForBrowserCondition(
    firstBrowser.cdp,
    `(() => {
      const status =
        document.querySelector('#connection-status-v23011');
      const label =
        document.querySelector('#connection-label-v23011');
      const icon = status?.querySelector('use');
      return Boolean(
        status
        && label
        && icon
        && navigator.onLine
        && status.classList.contains('online')
        && label.textContent === 'Online'
        && icon.getAttribute('href') === '#vi-wifi'
      );
    })()`,
    "Connection Status online initialization"
  );

  const connectionStatusInitialOnline = await evaluate(
    firstBrowser.cdp,
    `(() => {
      const status = document.querySelector('#connection-status-v23011');
      const label = document.querySelector('#connection-label-v23011');
      const icon = status?.querySelector('use');
      if (!status || !label || !icon) throw new Error('Connection Status UI unavailable');
      return {
        navigatorOnline: navigator.onLine,
        onlineClass: status.classList.contains('online'),
        label: label.textContent,
        icon: icon.getAttribute('href')
      };
    })()`
  );
  if (
    !connectionStatusInitialOnline.navigatorOnline
    || !connectionStatusInitialOnline.onlineClass
    || connectionStatusInitialOnline.label !== "Online"
    || connectionStatusInitialOnline.icon !== "#vi-wifi"
  ) {
    throw new Error(
      `El Connection Status inicial real no conserva estado Online: ${JSON.stringify(connectionStatusInitialOnline)}`
    );
  }

  const connectionStatusOffline = await evaluate(
    firstBrowser.cdp,
    `(async () => {
      const status = document.querySelector('#connection-status-v23011');
      const label = document.querySelector('#connection-label-v23011');
      const icon = status?.querySelector('use');
      if (!status || !label || !icon) throw new Error('Connection Status UI unavailable');
      const hadOwnOnLine = Object.prototype.hasOwnProperty.call(navigator, "onLine");
      const ownOnLineDescriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => false
      });
      try {
        window.dispatchEvent(new Event("offline"));
        for (let attempt = 0; attempt < 80; attempt += 1) {
          if (
            status.classList.contains('offline')
            && label.textContent === "Sin conexión"
            && icon.getAttribute('href') === "#vi-wifi-off"
          ) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return {
          navigatorOnline: navigator.onLine,
          offlineClass: status.classList.contains('offline'),
          label: label.textContent,
          icon: icon.getAttribute('href')
        };
      } finally {
        if (hadOwnOnLine && ownOnLineDescriptor) {
          Object.defineProperty(navigator, "onLine", ownOnLineDescriptor);
        } else {
          delete navigator.onLine;
        }
      }
    })()`
  );
  if (
    connectionStatusOffline.navigatorOnline !== false
    || !connectionStatusOffline.offlineClass
    || connectionStatusOffline.label !== "Sin conexión"
    || connectionStatusOffline.icon !== "#vi-wifi-off"
  ) {
    throw new Error(
      `El evento offline real no conserva Connection Status: ${JSON.stringify(connectionStatusOffline)}`
    );
  }

  await reload(firstBrowser.cdp);

  const onboardingFirstVisit = await evaluate(firstBrowser.cdp, `(() => {
    const onboarding = document.querySelector('#onboarding');
    const startButton = document.querySelector('#btn-empezar');
    const examplesButton = document.querySelector('#btn-empezar-ejemplos');
    if (!onboarding || !startButton || !examplesButton) {
      throw new Error('Onboarding UI unavailable');
    }
    return {
      marker: localStorage.getItem('kiosco_onboarding_done'),
      visible: !onboarding.classList.contains('hidden')
    };
  })()`);
  if (onboardingFirstVisit.marker !== null || !onboardingFirstVisit.visible) {
    throw new Error(`El onboarding real no aparece en primera visita: ${JSON.stringify(onboardingFirstVisit)}`);
  }

  const onboardingStart = await evaluate(firstBrowser.cdp, `(() => {
    const onboarding = document.querySelector('#onboarding');
    const startButton = document.querySelector('#btn-empezar');
    if (!onboarding || !startButton) throw new Error('Onboarding Start UI unavailable');
    startButton.click();
    return {
      marker: localStorage.getItem('kiosco_onboarding_done'),
      hiddenAfterStart: onboarding.classList.contains('hidden')
    };
  })()`);
  if (onboardingStart.marker !== "1" || !onboardingStart.hiddenAfterStart) {
    throw new Error(`El Start real no conserva persistencia/cierre: ${JSON.stringify(onboardingStart)}`);
  }

  await reload(firstBrowser.cdp);
  const onboardingPersistence = await evaluate(firstBrowser.cdp, `(() => {
    const onboarding = document.querySelector('#onboarding');
    if (!onboarding) throw new Error('Onboarding UI unavailable after reload');
    return {
      marker: localStorage.getItem('kiosco_onboarding_done'),
      hiddenAfterReload: onboarding.classList.contains('hidden')
    };
  })()`);
  if (onboardingPersistence.marker !== "1" || !onboardingPersistence.hiddenAfterReload) {
    throw new Error(`El onboarding real no conserva persistencia tras reload: ${JSON.stringify(onboardingPersistence)}`);
  }

  await evaluate(firstBrowser.cdp, `localStorage.removeItem('kiosco_onboarding_done')`);
  await reload(firstBrowser.cdp);
  const onboardingExamples = await evaluate(firstBrowser.cdp, `(() => {
    const key = 'kiosco_onboarding_done';
    const onboarding = document.querySelector('#onboarding');
    const examplesButton = document.querySelector('#btn-empezar-ejemplos');
    if (!onboarding || !examplesButton) {
      throw new Error('Onboarding Examples UI unavailable');
    }

    const toastSelector = '#toast-container .toast';
    const beforeToasts = Array.from(document.querySelectorAll(toastSelector)).map(
      (toast) => toast.textContent
    );
    const visibleBeforeClick = !onboarding.classList.contains('hidden');

    examplesButton.click();

    const afterToasts = Array.from(document.querySelectorAll(toastSelector)).map(
      (toast) => toast.textContent
    );
    const newToasts = afterToasts.slice(beforeToasts.length);

    return {
      visibleBeforeClick,
      marker: localStorage.getItem(key),
      hiddenAfterExamples: onboarding.classList.contains('hidden'),
      productsPermissionToast: newToasts.includes('No tenés permiso para cargar catálogos'),
      newToasts
    };
  })()`);
  if (
    !onboardingExamples.visibleBeforeClick
    || onboardingExamples.marker !== "1"
    || !onboardingExamples.hiddenAfterExamples
    || !onboardingExamples.productsPermissionToast
  ) {
    throw new Error(`El Examples real no alcanza al owner Products: ${JSON.stringify(onboardingExamples)}`);
  }

  const navigationEventsFlow = await evaluate(
    firstBrowser.cdp,
    `(async () => {
      const sleep = (ms) =>
        new Promise((resolve) => setTimeout(resolve, ms));
      const frame = () =>
        new Promise((resolve) => requestAnimationFrame(resolve));
      const waitFor = async (predicate, label) => {
        for (let attempt = 0; attempt < 80; attempt += 1) {
          if (predicate()) return;
          await sleep(25);
        }
        throw new Error("Timeout waiting for " + label);
      };

      const app = document.querySelector(".app");
      const userButton = document.querySelector("#btn-user-menu");
      const userMenu = document.querySelector("#user-menu");
      const settingsButton =
        document.querySelector("#btn-user-settings");
      const managementButton =
        document.querySelector("#btn-gestion-v230");
      const managementMenu =
        document.querySelector("#gestion-menu-v230");
      const settingsModal =
        document.querySelector("#modal-config");
      const settingsClose =
        document.querySelector("#btn-cerrar-config");
      const saleModal =
        document.querySelector("#modal-venta");
      const search =
        document.querySelector("#buscador");

      if (
        !app ||
        !userButton ||
        !userMenu ||
        !settingsButton ||
        !managementButton ||
        !managementMenu ||
        !settingsModal ||
        !settingsClose ||
        !saleModal ||
        !search ||
        !window.appContext
      ) {
        throw new Error(
          "Navigation Events browser UI unavailable"
        );
      }

      const previousReady = window.appContext.ready;
      const previousCashRegister =
        window.appContext.cashRegister;
      const previousCashState =
        typeof cashControllerV232 !== "undefined"
          ? cashControllerV232.getState()
          : null;
      const appWasHidden = app.classList.contains("hidden");
      const originalBodyTabIndex =
        document.body.getAttribute("tabindex");
      const cleanup = () => {
        userMenu.classList.add("hidden");
        managementMenu.classList.add("hidden");
        settingsModal.classList.add("hidden");
        saleModal.classList.add("hidden");
        document.querySelector("#modal-confirm")
          ?.classList.add("hidden");
        document.querySelector(
          "#ven007l-browser-management-action"
        )?.remove();
        window.appContext.ready = previousReady;
        window.appContext.cashRegister =
          previousCashRegister;
        if (typeof cashControllerV232 !== "undefined") {
          cashControllerV232.setState(previousCashState);
        }
        app.classList.toggle("hidden", appWasHidden);
        if (originalBodyTabIndex === null) {
          document.body.removeAttribute("tabindex");
        } else {
          document.body.setAttribute(
            "tabindex",
            originalBodyTabIndex
          );
        }
      };

      try {
        app.classList.remove("hidden");

        userButton.click();
        await frame();
        await frame();

        const userOpen = {
          visible: !userMenu.classList.contains("hidden"),
          aria:
            userButton.getAttribute("aria-expanded"),
          position: userMenu.style.position,
          placement: userMenu.dataset.placement || null,
          left: Number.parseFloat(userMenu.style.left || "NaN"),
          width: Number.parseFloat(userMenu.style.width || "NaN")
        };

        document.body.dispatchEvent(
          new MouseEvent("click", { bubbles: true })
        );
        const userOutsideClosed =
          userMenu.classList.contains("hidden");

        userButton.click();
        await frame();
        userMenu.style.left = "-9999px";
        window.dispatchEvent(new Event("resize"));
        await frame();
        const userResizeRepositioned =
          userMenu.style.left !== "-9999px";

        window.dispatchEvent(new Event("scroll"));
        const userScrollClosed =
          userMenu.classList.contains("hidden");

        userButton.click();
        await frame();
        settingsButton.click();
        await frame();
        const settingsOpened =
          settingsModal.classList.contains("hidden") === false &&
          userMenu.classList.contains("hidden");
        settingsClose.click();

        userButton.click();
        await frame();
        managementButton.click();
        await frame();
        const mutualExclusion =
          userMenu.classList.contains("hidden") &&
          !managementMenu.classList.contains("hidden") &&
          managementButton.getAttribute("aria-expanded") ===
            "true";

        const internal = document.createElement("button");
        internal.type = "button";
        internal.id =
          "ven007l-browser-management-action";
        managementMenu.appendChild(internal);
        internal.click();
        const managementInternalClosed =
          managementMenu.classList.contains("hidden");
        internal.remove();

        managementButton.click();
        await frame();
        managementMenu.style.left = "-9999px";
        window.dispatchEvent(new Event("resize"));
        await frame();
        const managementResizeRepositioned =
          managementMenu.style.left !== "-9999px";

        document.body.dispatchEvent(
          new MouseEvent("click", { bubbles: true })
        );
        const managementOutsideClosed =
          managementMenu.classList.contains("hidden");

        managementButton.click();
        await frame();
        window.dispatchEvent(new Event("scroll"));
        const managementScrollClosed =
          managementMenu.classList.contains("hidden");

        userButton.click();
        await frame();
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true
          })
        );
        await sleep(0);
        const overlayMenuEscapeClosed =
          userMenu.classList.contains("hidden");

        settingsModal.classList.remove("hidden");
        const confirmPromise =
          window.VendifyCoreV232.showConfirmation(
            "VEN-007L Escape",
            "Confirmar precedencia de Escape",
            {
              okText: "Aceptar",
              cancelText: "Cancelar",
              danger: false
            }
          );
        await frame();

        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true
          })
        );

        const confirmationAccepted =
          await confirmPromise;
        await sleep(0);
        const escapeCoexistence = {
          confirmationAccepted,
          confirmHidden:
            document
              .querySelector("#modal-confirm")
              ?.classList.contains("hidden") === true,
          settingsStillOpen:
            !settingsModal.classList.contains("hidden")
        };
        settingsClose.click();

        document.body.tabIndex = -1;
        document.body.focus();
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "/",
            bubbles: true,
            cancelable: true
          })
        );
        const slashFocusedSearch =
          document.activeElement === search;

        search.blur();
        document.body.focus();
        window.appContext.ready = true;
        window.appContext.cashRegister = {
          id: "ven007l-browser-cash",
          nombre: "Caja Browser"
        };
        cashControllerV232.setState({
          sesion: { id: "ven007l-browser-session" },
          es_mia: true
        });
        saleModal.classList.add("hidden");
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "V",
            bubbles: true,
            cancelable: true
          })
        );
        const vOpenedSale =
          !saleModal.classList.contains("hidden");
        saleModal.classList.add("hidden");

        search.focus();
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "V",
            bubbles: true,
            cancelable: true
          })
        );
        const typingGuardKeptSaleClosed =
          saleModal.classList.contains("hidden");
        search.blur();

        window.appContext.ready = true;
        document
          .querySelectorAll(".modal")
          .forEach((modal) => modal.classList.add("hidden"));
        userMenu.classList.add("hidden");
        managementMenu.classList.add("hidden");
        document
          .querySelector("#branch-menu-v23013")
          ?.classList.add("hidden");
        document
          .querySelector("#cash-menu-v23013")
          ?.classList.add("hidden");

        if (!history.state?.vendifyGuardV2311) {
          throw new Error(
            "Back Guard was not armed by real app init"
          );
        }

        userButton.click();
        await frame();
        history.back();
        await waitFor(
          () =>
            userMenu.classList.contains("hidden") &&
            history.state?.vendifyGuardV2311 === true,
          "Back Guard popover rearm"
        );
        const backPopover = {
          closed: userMenu.classList.contains("hidden"),
          rearmed:
            history.state?.vendifyGuardV2311 === true
        };

        settingsModal.classList.remove("hidden");
        await frame();
        history.back();
        await waitFor(
          () =>
            settingsModal.classList.contains("hidden") &&
            history.state?.vendifyGuardV2311 === true,
          "Back Guard modal rearm"
        );
        const backModal = {
          closed:
            settingsModal.classList.contains("hidden"),
          rearmed:
            history.state?.vendifyGuardV2311 === true
        };

        document
          .querySelectorAll(".modal")
          .forEach((modal) => modal.classList.add("hidden"));
        history.back();
        await waitFor(
          () =>
            document
              .querySelector("#modal-confirm")
              ?.classList.contains("hidden") === false,
          "Back Guard exit confirmation"
        );

        const exitConfirmationShown =
          document
            .querySelector("#modal-confirm")
            ?.classList.contains("hidden") === false;

        document
          .querySelector("#btn-confirm-cancel")
          ?.click();

        await waitFor(
          () =>
            document
              .querySelector("#modal-confirm")
              ?.classList.contains("hidden") === true &&
            history.state?.vendifyGuardV2311 === true,
          "Back Guard exit cancel rearm"
        );

        const backExitCancel = {
          confirmationShown: exitConfirmationShown,
          confirmationClosed:
            document
              .querySelector("#modal-confirm")
              ?.classList.contains("hidden") === true,
          rearmed:
            history.state?.vendifyGuardV2311 === true,
          appStillVisible:
            !app.classList.contains("hidden") &&
            window.appContext.ready === true
        };

        search.blur();
        document.body.focus();
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "/",
            bubbles: true,
            cancelable: true
          })
        );
        const operativeAfterCancel =
          document.activeElement === search;

        return {
          userOpen,
          userOutsideClosed,
          userResizeRepositioned,
          userScrollClosed,
          settingsOpened,
          mutualExclusion,
          managementInternalClosed,
          managementResizeRepositioned,
          managementOutsideClosed,
          managementScrollClosed,
          overlayMenuEscapeClosed,
          escapeCoexistence,
          shortcuts: {
            slashFocusedSearch,
            vOpenedSale,
            typingGuardKeptSaleClosed
          },
          backPopover,
          backModal,
          backExitCancel,
          operativeAfterCancel
        };
      } finally {
        cleanup();
      }
    })()`
  );

  if (
    !navigationEventsFlow.userOpen.visible
    || navigationEventsFlow.userOpen.aria !== "true"
    || navigationEventsFlow.userOpen.position !== "fixed"
    || !["top", "bottom"].includes(
      navigationEventsFlow.userOpen.placement
    )
    || !Number.isFinite(navigationEventsFlow.userOpen.left)
    || !Number.isFinite(navigationEventsFlow.userOpen.width)
    || !navigationEventsFlow.userOutsideClosed
    || !navigationEventsFlow.userResizeRepositioned
    || !navigationEventsFlow.userScrollClosed
    || !navigationEventsFlow.settingsOpened
    || !navigationEventsFlow.mutualExclusion
    || !navigationEventsFlow.managementInternalClosed
    || !navigationEventsFlow.managementResizeRepositioned
    || !navigationEventsFlow.managementOutsideClosed
    || !navigationEventsFlow.managementScrollClosed
    || !navigationEventsFlow.overlayMenuEscapeClosed
    || navigationEventsFlow.escapeCoexistence
      .confirmationAccepted !== false
    || !navigationEventsFlow.escapeCoexistence.confirmHidden
    || !navigationEventsFlow.escapeCoexistence
      .settingsStillOpen
    || !navigationEventsFlow.shortcuts.slashFocusedSearch
    || !navigationEventsFlow.shortcuts.vOpenedSale
    || !navigationEventsFlow.shortcuts
      .typingGuardKeptSaleClosed
    || !navigationEventsFlow.backPopover.closed
    || !navigationEventsFlow.backPopover.rearmed
    || !navigationEventsFlow.backModal.closed
    || !navigationEventsFlow.backModal.rearmed
    || !navigationEventsFlow.backExitCancel
      .confirmationShown
    || !navigationEventsFlow.backExitCancel
      .confirmationClosed
    || !navigationEventsFlow.backExitCancel.rearmed
    || !navigationEventsFlow.backExitCancel
      .appStillVisible
    || !navigationEventsFlow.operativeAfterCancel
  ) {
    throw new Error(
      "Navigation/Events real browser flow failed: "
      + JSON.stringify(navigationEventsFlow)
    );
  }

  const activeBranchFlow = await evaluate(firstBrowser.cdp, `(async () => {
    if (
      typeof activeBranchControllerV232 === "undefined"
      || typeof supabaseClient === "undefined"
      || !window.appContext
    ) {
      throw new Error("Active Branch composed runtime unavailable");
    }

    const originalRpc = supabaseClient.rpc;
    const previousContext = window.appContext;
    const storageKey = "vendify_branch_browser-biz";
    const rpcCalls = [];

    supabaseClient.rpc = async (name, args = {}) => {
      rpcCalls.push({ name, args });
      if (name === "listar_sucursales_app") {
        return {
          data: [
            { id: "branch-a", nombre: "Sucursal A" },
            { id: "branch-b", nombre: "Sucursal B" }
          ],
          error: null
        };
      }
      if (name === "obtener_contexto_sucursal") {
        return {
          data: {
            branch: { id: args.p_sucursal_id, nombre: "Sucursal B" },
            cashRegister: { id: "cash-b", nombre: "Caja B" }
          },
          error: null
        };
      }
      if (name === "listar_cajas_sucursal_v1") {
        return {
          data: [{ id: "cash-b", nombre: "Caja B", activa: true }],
          error: null
        };
      }
      if (name === "obtener_estado_caja_v1") {
        return {
          data: { id: "cash-b", es_mia: false, abierta: false },
          error: null
        };
      }
      if (
        name === "listar_productos_sucursal_seguro_v1"
        || name === "listar_stock_inteligente_sucursal_v1"
      ) {
        return { data: [], error: null };
      }
      return { data: [], error: null };
    };

    try {
      localStorage.removeItem(storageKey);
      window.appContext = {
        ...previousContext,
        business: { id: "browser-biz", nombre: "Browser Biz" },
        membership: { role: "owner" },
        branch: { id: "branch-a", nombre: "Sucursal A" },
        cashRegister: { id: "cash-a", nombre: "Caja A" },
        permissions: previousContext?.permissions ?? {},
        ready: false,
        offlineMode: false
      };

      await activeBranchControllerV232.initialize();

      const selector = document.querySelector("#branch-selector-v226");
      const branchLabel = document.querySelector("#branch-current-label-v23013");
      const branchOptions = document.querySelector("#branch-options-v23013");

      const before = {
        contextBranch: window.appContext.branch?.id ?? null,
        selector: selector?.value ?? null,
        selectorOptions: Array.from(selector?.options ?? []).map(
          (option) => ({ value: option.value, text: option.textContent })
        ),
        label: branchLabel?.textContent ?? null,
        branchBOptionPresent: Boolean(
          branchOptions?.querySelector('[data-context-branch="branch-b"]')
        )
      };

      await activeBranchControllerV232.select("branch-b");

      const cashSelector = document.querySelector("#cash-selector-v227");
      const cashLabel = document.querySelector("#cash-current-label-v23013");
      const activeBranchOption = branchOptions?.querySelector(
        '[data-context-branch="branch-b"]'
      );
      const activeCashOption = document.querySelector(
        '[data-context-cash="cash-b"]'
      );

      return {
        before,
        after: {
          contextBranch: window.appContext.branch?.id ?? null,
          contextBranchName: window.appContext.branch?.nombre ?? null,
          contextCash: window.appContext.cashRegister?.id ?? null,
          contextCashName: window.appContext.cashRegister?.nombre ?? null,
          selector: selector?.value ?? null,
          branchLabel: branchLabel?.textContent ?? null,
          cashLabel: cashLabel?.textContent ?? null,
          cashSelector: cashSelector?.value ?? null,
          persistedBranch: localStorage.getItem(storageKey),
          branchOptionActive:
            activeBranchOption?.getAttribute("aria-selected") === "true",
          cashOptionActive:
            activeCashOption?.getAttribute("aria-selected") === "true"
        },
        rpcNames: rpcCalls.map((call) => call.name)
      };
    } finally {
      supabaseClient.rpc = originalRpc;
      localStorage.removeItem(storageKey);
      window.appContext = previousContext;
    }
  })()`);

  if (
    activeBranchFlow.before.contextBranch !== "branch-a"
    || activeBranchFlow.before.selector !== "branch-a"
    || activeBranchFlow.before.selectorOptions.length !== 2
    || !activeBranchFlow.before.branchBOptionPresent
    || activeBranchFlow.after.contextBranch !== "branch-b"
    || activeBranchFlow.after.contextBranchName !== "Sucursal B"
    || activeBranchFlow.after.contextCash !== "cash-b"
    || activeBranchFlow.after.contextCashName !== "Caja B"
    || activeBranchFlow.after.selector !== "branch-b"
    || activeBranchFlow.after.branchLabel !== "Sucursal B"
    || activeBranchFlow.after.cashLabel !== "Caja B"
    || activeBranchFlow.after.cashSelector !== "cash-b"
    || activeBranchFlow.after.persistedBranch !== "branch-b"
    || !activeBranchFlow.after.branchOptionActive
    || !activeBranchFlow.after.cashOptionActive
    || !activeBranchFlow.rpcNames.includes("obtener_contexto_sucursal")
    || !activeBranchFlow.rpcNames.includes("listar_cajas_sucursal_v1")
    || !activeBranchFlow.rpcNames.includes("listar_productos_sucursal_seguro_v1")
  ) {
    throw new Error(
      "El Active Branch flow real no conserva composición/paridad: "
      + JSON.stringify(activeBranchFlow)
    );
  }

  const commercialPlatformFlow = await evaluate(firstBrowser.cdp, `(async () => {
    if (
      typeof commercialFoundationControllerV232 === "undefined"
      || typeof platformAdminControllerV232 === "undefined"
      || typeof supabaseClient === "undefined"
      || !window.appContext
    ) {
      throw new Error("Commercial/Platform composed runtime unavailable");
    }

    const originalRpc = supabaseClient.rpc;
    const previousContext = window.appContext;
    const hideKey = "vendify_onboarding_hide_v231:browser-commercial";
    const rpcCalls = [];

    supabaseClient.rpc = async (name, args = {}) => {
      rpcCalls.push({ name, args });

      if (name === "estado_onboarding_comercial_v1") {
        return {
          data: {
            completado: false,
            productos: 0,
            caja_utilizada: false,
            ventas: 0,
            miembros: 1
          },
          error: null
        };
      }

      if (name === "obtener_plan_actual_v1") {
        return {
          data: {
            nombre: "Pro Browser",
            estado: "activo",
            limites: { sucursales: 2, usuarios: 5, productos: 500 },
            uso: { sucursales: 1, usuarios: 2, productos: 30 }
          },
          error: null
        };
      }

      if (name === "obtener_config_operativa_v1") {
        return {
          data: {
            stock_cobertura_alerta: 5,
            ajuste_grande_unidades: 12,
            diferencia_caja_alerta: 2500,
            resumen_diario: true,
            auto_imprimir_ticket: false,
            ancho_ticket_mm: 80
          },
          error: null
        };
      }

      if (name === "guardar_config_operativa_v1") {
        return { data: { ok: true }, error: null };
      }

      if (name === "alertas_operativas_v1") {
        return { data: [], error: null };
      }

      if (name === "es_admin_plataforma_v1") {
        return { data: true, error: null };
      }

      if (name === "platform_overview_v1") {
        return {
          data: { negocios: 3, trials: 1, ventas_hoy: 12345, errores_24h: 1 },
          error: null
        };
      }

      if (name === "listar_negocios_plataforma_v1") {
        return {
          data: [{
            id: "browser-business",
            nombre: "Browser Business",
            usuarios: 2,
            productos: 9,
            trial_hasta: "2026-10-20T00:00:00Z",
            plan_codigo: "pro",
            estado: "activo"
          }],
          error: null
        };
      }

      if (name === "listar_errores_plataforma_v1") {
        return {
          data: [{
            tipo: "client",
            mensaje: "browser acceptance",
            negocio_nombre: "Browser Business",
            version: "2.31.1",
            creado: "2026-10-07T12:00:00Z"
          }],
          error: null
        };
      }

      if (name === "actualizar_plan_negocio_plataforma_v1") {
        return { data: { ok: true }, error: null };
      }

      return { data: [], error: null };
    };

    try {
      localStorage.removeItem(hideKey);
      window.appContext = {
        ...previousContext,
        business: { id: "browser-commercial", nombre: "Browser Commercial" },
        membership: { role: "owner" },
        branch: { id: "browser-branch", nombre: "Browser Branch" },
        cashRegister: { id: "browser-cash", nombre: "Browser Cash" },
        permissions: {
          ...(previousContext?.permissions ?? {}),
          manageProducts: true
        },
        ready: true,
        offlineMode: false
      };

      const onboarding = document.querySelector("#commercial-onboarding-v231");
      const onboardingSteps = document.querySelector("#commercial-onboarding-steps-v231");
      const planName = document.querySelector("#config-plan-name-v231");
      const stockDays = document.querySelector("#config-stock-days-v231");
      const adjustThreshold = document.querySelector("#config-adjust-threshold-v231");
      const cashDifference = document.querySelector("#config-cash-diff-v231");
      const dailySummary = document.querySelector("#config-daily-summary-v231");
      const autoPrint = document.querySelector("#config-auto-print-v231");
      const ticketWidth = document.querySelector("#config-ticket-width-v231");
      const operationForm = document.querySelector("#form-operacion-v231");
      const platformButton = document.querySelector("#btn-platform-admin-v231");
      const platformModal = document.querySelector("#modal-platform-admin-v231");

      if (
        !onboarding
        || !onboardingSteps
        || !planName
        || !stockDays
        || !adjustThreshold
        || !cashDifference
        || !dailySummary
        || !autoPrint
        || !ticketWidth
        || !operationForm
        || !platformButton
        || !platformModal
      ) {
        throw new Error("Commercial/Platform browser DOM unavailable");
      }

      onboarding.classList.add("hidden");
      platformButton.classList.add("hidden");
      platformModal.classList.add("hidden");

      await commercialFoundationControllerV232.refreshOnboarding();
      await commercialFoundationControllerV232.loadPlan();
      await commercialFoundationControllerV232.loadOperationalConfig();

      const onboardingBeforeHide = {
        visible: !onboarding.classList.contains("hidden"),
        steps: onboardingSteps.querySelectorAll(".commercial-step-v231").length,
        actions: onboardingSteps.querySelectorAll("[data-onboarding-action-v231]").length,
        planName: planName.textContent,
        stockDays: stockDays.value,
        ticketWidth: ticketWidth.value
      };

      const productAction = onboardingSteps.querySelector(
        '[data-onboarding-action-v231="product"]'
      );
      const productModal = document.querySelector("#modal");
      if (!productAction || !productModal) {
        throw new Error("Commercial product action unavailable");
      }

      productModal.classList.add("hidden");
      productAction.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const productOwnerReached = !productModal.classList.contains("hidden");
      productModal.classList.add("hidden");

      document.querySelector("#btn-hide-commercial-onboarding-v231")?.click();
      const hideMarker = localStorage.getItem(hideKey);
      const hiddenAfterHide = onboarding.classList.contains("hidden");

      stockDays.value = "7";
      adjustThreshold.value = "15";
      cashDifference.value = "9000";
      dailySummary.checked = false;
      autoPrint.checked = true;
      ticketWidth.value = "58";
      operationForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));

      const saveCall = rpcCalls.find(
        (call) => call.name === "guardar_config_operativa_v1"
      );

      await platformAdminControllerV232.refreshAccess();
      const platformVisible = !platformButton.classList.contains("hidden");

      platformButton.click();
      await new Promise((resolve) => setTimeout(resolve, 20));

      const businessRow = document.querySelector(
        '[data-platform-business="browser-business"]'
      );
      const kpis = {
        businesses: document.querySelector("#platform-businesses-v231")?.textContent,
        trials: document.querySelector("#platform-trials-v231")?.textContent,
        errors: document.querySelector("#platform-errors-v231")?.textContent
      };

      if (!businessRow) {
        throw new Error("Platform business row did not render");
      }

      const plan = businessRow.querySelector(".platform-plan-select-v231");
      const status = businessRow.querySelector(".platform-state-select-v231");
      const save = businessRow.querySelector("[data-platform-save-plan]");
      if (!plan || !status || !save) {
        throw new Error("Platform plan controls unavailable");
      }

      plan.value = "business";
      status.value = "suspendido";
      save.click();
      await new Promise((resolve) => setTimeout(resolve, 20));

      const updateCall = rpcCalls.find(
        (call) => call.name === "actualizar_plan_negocio_plataforma_v1"
      );

      return {
        onboardingBeforeHide,
        productOwnerReached,
        hideMarker,
        hiddenAfterHide,
        saveArgs: saveCall?.args ?? null,
        platformVisible,
        platformModalVisible: !platformModal.classList.contains("hidden"),
        kpis,
        businessRowPresent: Boolean(businessRow),
        updateArgs: updateCall?.args ?? null,
        rpcNames: rpcCalls.map((call) => call.name)
      };
    } finally {
      supabaseClient.rpc = originalRpc;
      localStorage.removeItem(hideKey);
      document.querySelector("#commercial-onboarding-v231")?.classList.add("hidden");
      document.querySelector("#modal")?.classList.add("hidden");
      document.querySelector("#modal-platform-admin-v231")?.classList.add("hidden");
      window.appContext = previousContext;
    }
  })()`);

  if (
    !commercialPlatformFlow.onboardingBeforeHide.visible
    || commercialPlatformFlow.onboardingBeforeHide.steps !== 4
    || commercialPlatformFlow.onboardingBeforeHide.actions !== 4
    || commercialPlatformFlow.onboardingBeforeHide.planName !== "Pro Browser"
    || commercialPlatformFlow.onboardingBeforeHide.stockDays !== "5"
    || commercialPlatformFlow.onboardingBeforeHide.ticketWidth !== "80"
    || !commercialPlatformFlow.productOwnerReached
    || commercialPlatformFlow.hideMarker !== "1"
    || !commercialPlatformFlow.hiddenAfterHide
    || commercialPlatformFlow.saveArgs?.p_stock_cobertura_alerta !== 7
    || commercialPlatformFlow.saveArgs?.p_ajuste_grande_unidades !== 15
    || commercialPlatformFlow.saveArgs?.p_diferencia_caja_alerta !== 9000
    || commercialPlatformFlow.saveArgs?.p_resumen_diario !== false
    || commercialPlatformFlow.saveArgs?.p_auto_imprimir_ticket !== true
    || commercialPlatformFlow.saveArgs?.p_ancho_ticket_mm !== 58
    || !commercialPlatformFlow.platformVisible
    || !commercialPlatformFlow.platformModalVisible
    || commercialPlatformFlow.kpis.businesses !== "3"
    || commercialPlatformFlow.kpis.trials !== "1"
    || commercialPlatformFlow.kpis.errors !== "1"
    || !commercialPlatformFlow.businessRowPresent
    || commercialPlatformFlow.updateArgs?.p_negocio_id !== "browser-business"
    || commercialPlatformFlow.updateArgs?.p_plan_codigo !== "business"
    || commercialPlatformFlow.updateArgs?.p_estado !== "suspendido"
  ) {
    throw new Error(
      "El Commercial/Platform flow real no conserva composición/paridad: "
      + JSON.stringify(commercialPlatformFlow)
    );
  }

  const diagnosticsDenied = await evaluate(firstBrowser.cdp, `(async () => {
    const diagnosticsButton =
      document.querySelector('#btn-diagnostico-v23011');
    const modal =
      document.querySelector('#modal-diagnostico-v23011');

    if (
      !diagnosticsButton
      || !modal
      || !window.appContext
    ) {
      throw new Error('Diagnostics permission UI unavailable');
    }

    modal.classList.add('hidden');
    window.appContext.membership = { role: "cashier" };

    const toastSelector = '#toast-container .toast';

    const beforeToasts = Array.from(
      document.querySelectorAll(toastSelector)
    ).map((toast) => toast.textContent);

    diagnosticsButton.click();

    await new Promise((resolve) => setTimeout(resolve, 0));

    const afterToasts = Array.from(
      document.querySelectorAll(toastSelector)
    ).map((toast) => toast.textContent);

    const newToasts = afterToasts.slice(beforeToasts.length);

    const permissionMessage =
      'Solo Propietario o Administrador pueden ejecutar diagnósticos';

    return {
      modalHidden: modal.classList.contains('hidden'),
      permissionToast: newToasts.includes(permissionMessage),
      newToasts
    };
  })()`);

  if (
    !diagnosticsDenied.modalHidden
    || !diagnosticsDenied.permissionToast
  ) {
    throw new Error(
      `El permiso real de Diagnostics no conserva la paridad: ${JSON.stringify(diagnosticsDenied)}`
    );
  }

  const diagnosticsOwnerOpenClose = await evaluate(
    firstBrowser.cdp,
    `(async () => {
      const diagnosticsButton =
        document.querySelector('#btn-diagnostico-v23011');

      const diagnosticsCloseButton =
        document.querySelector('#btn-close-diagnostic-v23011');

      const modal =
        document.querySelector('#modal-diagnostico-v23011');

      const connection =
        document.querySelector('#diag-connection-v23011');

      const branch =
        document.querySelector('#diag-branch-v23011');

      const cash =
        document.querySelector('#diag-cash-v23011');

      const summary =
        document.querySelector('#diagnostic-summary-v23011');

      const issues =
        document.querySelector('#diagnostic-issues-v23011');

      if (
        !diagnosticsButton
        || !diagnosticsCloseButton
        || !modal
        || !connection
        || !branch
        || !cash
        || !summary
        || !issues
        || !window.appContext
      ) {
        throw new Error('Diagnostics owner UI unavailable');
      }

      window.appContext.membership = { role: "owner" };
      window.appContext.branch = { nombre: "Sucursal Browser" };
      window.appContext.cashRegister = { nombre: "Caja Browser" };

      summary.textContent = 'stale summary';
      issues.innerHTML = '<p>stale issue</p>';
      modal.classList.add('hidden');

      diagnosticsButton.click();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = {
        opened: !modal.classList.contains('hidden'),
        connection: connection.textContent,
        expectedConnection:
          navigator.onLine ? 'Online' : 'Sin conexión',
        branch: branch.textContent,
        cash: cash.textContent,
        summary: summary.textContent,
        issuesHtml: issues.innerHTML
      };

      diagnosticsCloseButton.click();

      return {
        ...result,
        hiddenAfterClose: modal.classList.contains('hidden')
      };
    })()`
  );

  if (
    !diagnosticsOwnerOpenClose.opened
    || diagnosticsOwnerOpenClose.connection
      !== diagnosticsOwnerOpenClose.expectedConnection
    || diagnosticsOwnerOpenClose.branch !== "Sucursal Browser"
    || diagnosticsOwnerOpenClose.cash !== "Caja Browser"
    || diagnosticsOwnerOpenClose.summary
      !== "Ejecutá el diagnóstico para revisar la integridad."
    || diagnosticsOwnerOpenClose.issuesHtml !== ""
    || !diagnosticsOwnerOpenClose.hiddenAfterClose
  ) {
    throw new Error(
      `El open/close real de Diagnostics no conserva la paridad: ${JSON.stringify(diagnosticsOwnerOpenClose)}`
    );
  }
  const productMedia = await evaluate(firstBrowser.cdp, `(() => {
    if (!window.appContext) {
      throw new Error('Product runtime appContext unavailable');
    }

    const originalProductContext = {
      membership: window.appContext.membership,
      permissions: window.appContext.permissions,
      ready: window.appContext.ready
    };

    window.appContext.membership = { role: "owner" };
    window.appContext.permissions = {
      ...(window.appContext.permissions ?? {}),
      manageProducts: true
    };
    window.appContext.ready = true;

    aplicarPermisosV2();

    const modal = document.querySelector('#modal');
    const openButton = document.querySelector('#btn-nuevo');
    const closeButton = document.querySelector('#btn-cerrar-modal');

    const normalFields = [
      '#nombre',
      '#marca',
      '#precio-venta'
    ];

    if (!modal || !openButton || !closeButton) {
      throw new Error('Product Editor UI unavailable');
    }

    if (normalFields.some((selector) => !document.querySelector(selector))) {
      throw new Error('Product Editor normal fields unavailable');
    }

    modal.classList.add('hidden');

    const permissionState = {
      role: window.appContext.membership?.role ?? null,
      manageProducts:
        window.appContext.permissions?.manageProducts === true,
      ready: window.appContext.ready === true,
      buttonHiddenAfterPermissionRefresh:
        openButton.hidden || openButton.classList.contains('permiso-hidden')
    };

    openButton.click();

    const editor = {
      opened: !modal.classList.contains('hidden'),
      normalFieldsPresent: normalFields.every(
        (selector) => Boolean(document.querySelector(selector))
      ),
      fotoInputAbsent: !document.querySelector('#foto-input'),
      fotoCameraAbsent: !document.querySelector('#foto-camara'),
      cropModalAbsent: !document.querySelector('#modal-crop-foto')
    };

    closeButton.click();
    editor.closed = modal.classList.contains('hidden');

    if (
      typeof productsStoreV232 === 'undefined'
      || typeof productsControllerV232 === 'undefined'
    ) {
      throw new Error('Typed Products runtime unavailable');
    }

    const photoId = 'ven-007e-existing-photo-fixture';
    const fallbackId = 'ven-007e-no-photo-fixture';

    const photoValue =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

    productsStoreV232.upsert({
      id: photoId,
      nombre: 'Producto con foto',
      marca: '',
      presentacion: '',
      codigoBarras: '',
      categoria: 'Otros',
      precioCompra: 10,
      precioVenta: 20,
      stock: 5,
      stockMinimo: 2,
      foto: photoValue,
      creado: null
    });

    productsStoreV232.upsert({
      id: fallbackId,
      nombre: 'Producto sin foto',
      marca: '',
      presentacion: '',
      codigoBarras: '',
      categoria: 'Otros',
      precioCompra: 10,
      precioVenta: 20,
      stock: 5,
      stockMinimo: 2,
      foto: null,
      creado: null
    });

    const search = document.querySelector('#buscador');
    if (search) search.value = '';

    const category = document.querySelector('#filtro-categoria');
    if (category) category.value = '';

    productsControllerV232.render();

    const photoCard = document.querySelector(
      '.producto-card[data-id="ven-007e-existing-photo-fixture"]'
    );

    const fallbackCard = document.querySelector(
      '.producto-card[data-id="ven-007e-no-photo-fixture"]'
    );

    const image = photoCard?.querySelector('img.producto-v223-img');
    const fallback = fallbackCard?.querySelector('.producto-v223-icon');

    const existingPhotoRender = {
      photoCardPresent: Boolean(photoCard),
      imagePresent: Boolean(image),
      imageSrc: image?.getAttribute('src') ?? null,
      fallbackCardPresent: Boolean(fallbackCard),
      fallbackPresent: Boolean(fallback)
    };

    productsStoreV232.remove(photoId);
    productsStoreV232.remove(fallbackId);
    productsControllerV232.render();

    window.appContext.membership = originalProductContext.membership;
    window.appContext.permissions = originalProductContext.permissions;
    window.appContext.ready = originalProductContext.ready;

    return {
      permissionState,
      editor,
      existingPhotoRender,
      photoValue
    };
  })()`);

  if (
    productMedia.permissionState.role !== "owner"
    || !productMedia.permissionState.manageProducts
    || !productMedia.permissionState.ready
    || productMedia.permissionState.buttonHiddenAfterPermissionRefresh
  ) {
    throw new Error(
      `El contexto real de permisos Products no qued? habilitado: ${JSON.stringify(productMedia.permissionState)}`
    );
  }

  if (
    !productMedia.editor.opened
    || !productMedia.editor.closed
    || !productMedia.editor.normalFieldsPresent
    || !productMedia.editor.fotoInputAbsent
    || !productMedia.editor.fotoCameraAbsent
    || !productMedia.editor.cropModalAbsent
  ) {
    throw new Error(
      `El Product Editor real no conserva VEN-007E: ${JSON.stringify(productMedia.editor)}`
    );
  }

  if (
    !productMedia.existingPhotoRender.photoCardPresent
    || !productMedia.existingPhotoRender.imagePresent
    || productMedia.existingPhotoRender.imageSrc !== productMedia.photoValue
    || !productMedia.existingPhotoRender.fallbackCardPresent
    || !productMedia.existingPhotoRender.fallbackPresent
  ) {
    throw new Error(
      `El render real de foto existente/fallback fall?: ${JSON.stringify(productMedia.existingPhotoRender)}`
    );
  }

  const installPrompt = await evaluate(firstBrowser.cdp, `(async () => {
    if (!window.VendifyPwaV232) throw new Error('PWA controller unavailable');
    window.VendifyPwaV232.setupInstallPrompt();
    localStorage.removeItem('kiosco_install_dismiss');
    const banner = document.querySelector('#install-banner');
    const installButton = document.querySelector('#btn-install');
    const dismissButton = document.querySelector('#btn-install-dismiss');
    if (!banner || !installButton || !dismissButton) throw new Error('PWA install UI unavailable');
    let prompted = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(event, {
      prompt: { value: () => { prompted += 1; } },
      userChoice: { value: Promise.resolve({ outcome: 'dismissed' }) }
    });
    window.dispatchEvent(event);
    const shown = !banner.classList.contains('hidden') && event.defaultPrevented;
    installButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const hiddenAfterChoice = banner.classList.contains('hidden');
    window.dispatchEvent(event);
    dismissButton.click();
    return {
      shown,
      prompted,
      hiddenAfterChoice,
      dismissed: banner.classList.contains('hidden') && localStorage.getItem('kiosco_install_dismiss') === '1'
    };
  })()`);
  if (!installPrompt.shown || installPrompt.prompted !== 1 || !installPrompt.hiddenAfterChoice || !installPrompt.dismissed) {
    throw new Error(`El aviso de instalación no conserva su flujo: ${JSON.stringify(installPrompt)}`);
  }
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
    installPrompt,
    onboarding: {
      runtimeComposition: "real-app-init-and-listeners",
      firstVisit: onboardingFirstVisit,
      start: onboardingStart,
      persistence: onboardingPersistence,
      examples: onboardingExamples
    },
    diagnostics: {
      runtimeComposition: "real-app-init-and-listeners",
      denied: diagnosticsDenied,
      ownerOpenClose: diagnosticsOwnerOpenClose
    },
    connectionStatus: {
      runtimeComposition: "real-app-init-and-listeners",
      initialOnline: connectionStatusInitialOnline,
      offline: connectionStatusOffline
    },
    productMedia: {
      runtimeComposition: "real-app-init-and-listeners",
      ...productMedia
    },
    navigationEvents: {
      runtimeComposition: "real-app-init-and-listeners",
      flow: navigationEventsFlow
    },
    activeBranch: {
      runtimeComposition: "real-app-composed-controller",
      flow: activeBranchFlow
    },
    commercialPlatform: {
      runtimeComposition: "real-app-composed-controllers",
      flow: commercialPlatformFlow
    },
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
