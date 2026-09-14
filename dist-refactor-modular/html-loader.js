/* Vendify v2.32 — ordered HTML fragment and runtime bootstrap */
(() => {
  "use strict";

  const config = window.VENDIFY_HTML_BOOTSTRAP;
  const mount = document.getElementById("vendify-html-root");

  function showFatalError(error) {
    console.error("Vendify bootstrap failed", error);
    const errorHost = mount?.isConnected ? mount : document.createElement("div");
    if (!errorHost.isConnected) document.body.prepend(errorHost);

    errorHost.innerHTML = `
      <div class="auth-screen">
        <div class="auth-card auth-card-v23">
          <div class="onboarding-logo">V</div>
          <h1>No pudimos iniciar Vendify</h1>
          <p class="onboarding-lead">Revisá tu conexión y volvé a intentar.</p>
          <button type="button" class="btn btn-primary btn-lg" data-vendify-reload>Reintentar</button>
        </div>
      </div>`;
    errorHost.querySelector("[data-vendify-reload]")?.addEventListener("click", () => location.reload());
  }

  async function readFragment(path) {
    const response = await fetch(path, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTML fragment ${path} returned ${response.status}`);
    return response.text();
  }

  function mountFragments(parts) {
    const template = document.createElement("template");
    template.innerHTML = parts.join("\n");
    mount.replaceWith(template.content);
  }

  function loadScript(entry) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = entry.src;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => {
        const error = new Error(`Runtime script ${entry.src} could not be loaded`);
        if (entry.optional) {
          console.warn(error.message);
          resolve();
          return;
        }
        reject(error);
      };
      document.body.append(script);
    });
  }

  async function bootstrap() {
    if (!config || !mount) throw new Error("HTML bootstrap configuration is missing");
    const parts = await Promise.all(config.fragments.map(readFragment));
    mountFragments(parts);
    for (const script of config.scripts) await loadScript(script);
    window.dispatchEvent(new CustomEvent("vendify:html-ready"));
  }

  void bootstrap().catch(showFatalError);
})();
