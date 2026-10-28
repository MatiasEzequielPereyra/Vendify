// Test transport only. Pass fetch explicitly or install the route before navigation;
// never replace the application's global fetch or treat this as backend authority.
export const ADMIN_SUPABASE_ORIGIN = "https://puhkmblnptntorwptvld.supabase.co";
export const ADMIN_SMOKE_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js";
export const ADMIN_READ_RPCS = Object.freeze([
  "es_admin_plataforma_v1",
  "platform_overview_v1",
  "listar_negocios_plataforma_v2",
  "obtener_negocio_plataforma_v1",
  "listar_errores_plataforma_v1"
]);

function origin(value, fixtureOnly = false) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error("Invalid smoke origin"); }
  const loopback = parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash
      || (!loopback && parsed.protocol !== "https:")
      || (fixtureOnly && !loopback && parsed.origin !== ADMIN_SUPABASE_ORIGIN)) {
    throw new Error("Smoke origin must be the approved project or an isolated loopback fixture");
  }
  return parsed.origin;
}

function safeMethod(method) {
  return ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(method) ? method : "OTHER";
}

/** Deny by default; a POST to one of these exact read RPCs is a read. */
export function createAdminReadSmokeGuard({ appOrigin, supabaseOrigin = ADMIN_SUPABASE_ORIGIN } = {}) {
  const application = origin(appOrigin);
  const database = origin(supabaseOrigin, true);
  const denied = [];
  const allowedReads = new Set(ADMIN_READ_RPCS.map(name => `/rest/v1/rpc/${name}`));

  function deny(method, reason) {
    // Never retain input URL, query, headers, body, user ID, or credentials.
    const record = Object.freeze({ method: safeMethod(method), reason });
    denied.push(record);
    return Object.freeze({ allowed: false, ...record });
  }

  function check(input, { method = "GET", headers } = {}) {
    let verb = "OTHER";
    let url;
    let requestHeaders;
    try {
      if (typeof method !== "string") return deny(verb, "invalid-method");
      verb = method.toUpperCase();
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : "";
      // Reject ambiguous spelling rather than guessing what a proxy will decode.
      const pathPart = raw.split(/[?#]/u)[0];
      if (!raw || /[\u0000-\u0020\u007f\\]/u.test(raw) || pathPart.includes("%")
          || /(?:^|\/)\.{1,2}(?:\/|$)/u.test(pathPart)) return deny(verb, "invalid-url");
      url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
        return deny(verb, "invalid-url");
      }
      requestHeaders = new Headers(headers);
      for (const name of ["x-http-method-override", "x-method-override", "x-http-method"]) {
        if (requestHeaders.has(name)) return deny(verb, "method-override");
      }
      for (const name of ["content-profile", "accept-profile"]) {
        if (requestHeaders.has(name) && requestHeaders.get(name) !== "public") return deny(verb, "unapproved-schema");
      }
    } catch { return deny(verb, "invalid-request"); }

    // This exact, pinned dependency is used by admin/index.html.
    if (url.href === ADMIN_SMOKE_SCRIPT_URL && ["GET", "HEAD"].includes(verb)) {
      return Object.freeze({ allowed: true, kind: "pinned-admin-script" });
    }
    if (url.origin === database) {
      if (allowedReads.has(url.pathname)) {
        if (["GET", "HEAD", "POST", "OPTIONS"].includes(verb)) return Object.freeze({ allowed: true, kind: "admin-read-rpc" });
        return deny(verb, "unapproved-rpc-method");
      }
      const params = url.searchParams;
      const oneParam = name => [...params.keys()].length === 1 && params.getAll(name).length === 1;
      if (url.pathname === "/auth/v1/user" && !url.search && ["GET", "OPTIONS"].includes(verb)) {
        return Object.freeze({ allowed: true, kind: "auth-user" });
      }
      if (url.pathname === "/auth/v1/token" && oneParam("grant_type")
          && ["password", "refresh_token"].includes(params.get("grant_type")) && ["POST", "OPTIONS"].includes(verb)) {
        return Object.freeze({ allowed: true, kind: "auth-session" });
      }
      if (url.pathname === "/auth/v1/logout" && oneParam("scope") && params.get("scope") === "local"
          && ["POST", "OPTIONS"].includes(verb)) return Object.freeze({ allowed: true, kind: "auth-logout" });
      // A loopback fixture may share the app origin, but API paths never fall
      // through to the static-resource exception below.
      if (url.origin !== application || /^\/(?:rest|auth|functions|storage|realtime|graphql)(?:\/|$)/u.test(url.pathname)) {
        return deny(verb, "unapproved-api");
      }
    }
    if (url.origin === application && ["GET", "HEAD"].includes(verb)
        && !/^\/(?:api|rest|auth|functions|storage|realtime|graphql)(?:\/|$)/u.test(url.pathname)) {
      return Object.freeze({ allowed: true, kind: "app-resource" });
    }
    return deny(verb, "unapproved-request");
  }

  function guardedFetch(upstreamFetch) {
    if (typeof upstreamFetch !== "function") throw new Error("An explicit test fetch transport is required");
    return async (input, init) => {
      let url;
      let method;
      let headers;
      let options;
      try {
        options = { ...init, redirect: "error" };
        url = typeof input === "string" || input instanceof URL ? input : input.url;
        method = options.method ?? (typeof input === "object" ? input.method : undefined) ?? "GET";
        headers = options.headers ?? (typeof input === "object" ? input.headers : undefined);
      } catch { deny("OTHER", "invalid-request"); throw new Error("Read-only smoke guard blocked a request"); }
      if (!check(url, { method, headers }).allowed) throw new Error("Read-only smoke guard blocked a request");
      // A 307/308 must not turn an allowed POST read into a redirected write.
      return upstreamFetch(input, options);
    };
  }

  async function routeHandler(route) {
    let request;
    let decision;
    try {
      request = route.request();
      // Record forbidden URL/method attempts before the first asynchronous step.
      decision = check(request.url(), { method: request.method() });
      if (!decision.allowed) { await route.abort("blockedbyclient"); return; }
      const headers = request.headers();
      decision = check(request.url(), { method: request.method(), headers });
    } catch { decision = deny("OTHER", "invalid-request"); }
    if (!decision.allowed) { await route.abort("blockedbyclient"); return; }
    // route.continue can follow a redirect without calling the handler again.
    // Fetch exactly one response and fulfill it only when it is not a redirect.
    const response = await route.fetch({ maxRedirects: 0 });
    if (response.status() >= 300 && response.status() < 400) {
      deny(request.method().toUpperCase(), "redirect");
      await route.abort("blockedbyclient");
      return;
    }
    await route.fulfill({ response });
  }

  return Object.freeze({
    check,
    fetch: guardedFetch,
    routeHandler,
    get violations() { return Object.freeze([...denied]); },
    assertNoWrites() {
      if (denied.length) throw new Error(`Read-only smoke guard blocked ${denied.length} request(s); smoke failed`);
    }
  });
}

/** Use a fresh context created with { serviceWorkers: "block" }, before navigation. */
export async function installAdminReadSmokeGuard(pageOrContext, options) {
  const guard = createAdminReadSmokeGuard(options);
  await pageOrContext.route("**/*", guard.routeHandler);
  return guard;
}
