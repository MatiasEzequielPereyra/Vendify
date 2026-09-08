/* Vendify v2.31.1 — atomic app-shell offline cache */
const CACHE = "vendify-shell-v235-pinned-runtime";
const PINNED_RUNTIME_ASSETS = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js",
  "https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js",
];
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./supabase-config.js",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./html-loader.js",
  "./html/01-auth-shell.html",
  "./html/02-app-shell.html",
  "./html/03-product-stock-modals.html",
  "./html/04-inventory-purchases-modals.html",
  "./html/05-team-access-modals.html",
  "./html/06-dashboard-admin-modals.html",
  "./html/07-cash-sales-modals.html",
  "./app.js",
  "./styles.css",
  "./styles/01-foundation.css",
  "./styles/02-auth-team.css",
  "./styles/03-products-scanner.css",
  "./styles/04-navigation-settings.css",
  "./styles/05-sales-cash.css",
  "./styles/06-brand-realtime.css",
  "./styles/07-pos-inventory.css",
  "./styles/08-purchases-stock.css",
  "./styles/09-stability-forms.css",
  "./styles/10-commercial-offline.css",
  ...PINNED_RUNTIME_ASSETS,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) =>
              key.startsWith("vendify-shell-") &&
              key !== CACHE
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  const isPinnedRuntimeAsset = PINNED_RUNTIME_ASSETS.includes(url.href);
  // Solo se cachean los dos runtimes con versión fija. APIs, fuentes y otros
  // recursos externos permanecen fuera del cache transaccional de Vendify.
  if (url.origin !== self.location.origin && !isPinnedRuntimeAsset) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response?.ok) {
            const copy = response.clone();
            caches.open(CACHE)
              .then((cache) =>
                cache.put("./index.html", copy)
              );
          }

          return response;
        })
        .catch(() =>
          caches.match("./index.html", {
            ignoreSearch: true,
          }).then((cached) =>
            cached ||
            caches.match("./", {
              ignoreSearch: true,
            })
          )
        )
    );

    return;
  }

  event.respondWith(
    caches.match(event.request, {
      ignoreSearch: true,
    }).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response?.ok) {
            const copy = response.clone();

            caches.open(CACHE)
              .then((cache) =>
                cache.put(
                  event.request,
                  copy
                )
              );
          }

          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
