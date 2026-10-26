import { signInOwner, type AuthClientPort, type AuthErrorLike } from "../auth/auth-service.js";
import { createPlatformAdminController } from "./platform-admin-controller.js";
import type { PlatformRpcClientPort } from "./platform-service.js";

declare const SUPABASE_URL: string;
declare const SUPABASE_ANON_KEY: string;
interface AdminAuth extends AuthClientPort {
  signOut(options?: { scope: "local" }): ReturnType<AuthClientPort["signOut"]>;
  getUser(): Promise<{ data: { user: { id: string } | null }; error: AuthErrorLike | null }>;
  onAuthStateChange(callback: () => void): unknown;
}
interface AdminClient extends PlatformRpcClientPort { auth: AdminAuth; }
declare const supabase: { createClient(url: string, key: string, options: object): AdminClient };

export function startAdminEntry(client: AdminClient): void {
  const form = document.querySelector<HTMLFormElement>("#admin-login");
  const email = document.querySelector<HTMLInputElement>("#admin-email");
  const password = document.querySelector<HTMLInputElement>("#admin-password");
  const submit = document.querySelector<HTMLButtonElement>("#admin-submit");
  const logout = document.querySelector<HTMLButtonElement>("#admin-logout");
  const status = document.querySelector<HTMLElement>("#admin-status");
  if (!form || !email || !password || !submit || !logout || !status) throw new Error("Entrada administrativa incompleta");
  let identity: string | null = null;
  let generation = 0;
  let signingOut = false;
  const notify = (message: string): void => { status.textContent = message; };
  const panel = createPlatformAdminController({
    client, isOnline: () => navigator.onLine && identity !== null,
    getSessionKey: () => identity, closeUserMenu: () => undefined,
    formatPrice: value => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(value),
    icon: () => "", showToast: notify
  });
  panel.setup();
  const clear = (): void => {
    identity = null;
    panel.close();
    logout.hidden = true;
    form.hidden = false;
    password.value = "";
    document.querySelector("#btn-platform-admin-v231")?.classList.add("hidden");
  }
  const refresh = async (): Promise<void> => {
    const request = ++generation;
    clear();
    if (signingOut) return;
    if (!navigator.onLine) { notify("Sin conexión. Los datos de administración se ocultaron."); return; }
    try {
      const { data, error } = await client.auth.getUser();
      if (request !== generation) return;
      if (error || !data.user) { notify("Ingresá con tu cuenta de Vendify."); return; }
      identity = data.user.id;
      form.hidden = true;
      logout.hidden = false;
      notify("Sesión verificada. Comprobando acceso de plataforma…");
      await panel.open();
      if (request === generation) notify("Sesión verificada. El acceso a negocios depende de los permisos del servidor.");
    } catch { if (request === generation) { clear(); notify("No se pudo verificar la sesión. Volvé a iniciar sesión."); } }
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (submit.disabled || signingOut) return;
    submit.disabled = true;
    notify("Iniciando sesión…");
    void (async () => {
      try {
        const result = await signInOwner(client.auth, email.value, password.value);
        password.value = "";
        if (!result.ok) { clear(); notify(result.errorMessage ?? "No se pudo iniciar sesión."); return; }
        await refresh();
      } catch { clear(); notify("No se pudo iniciar sesión. Verificá la conexión e intentá nuevamente."); }
      finally { password.value = ""; submit.disabled = false; }
    })();
  });
  logout.addEventListener("click", () => {
    ++generation;
    signingOut = true;
    submit.disabled = true;
    clear();
    notify("Cerrando sesión…");
    void client.auth.signOut({ scope: "local" }).then(result => {
      notify(result.error ? "Datos ocultos. No se pudo confirmar el cierre; volvé a intentarlo." : "Sesión cerrada.");
      if (result.error) logout.hidden = false;
    }).catch(() => { notify("Datos ocultos. Volvé a intentar cerrar sesión al recuperar la conexión."); logout.hidden = false; })
      .finally(() => { signingOut = false; submit.disabled = false; });
  });
  client.auth.onAuthStateChange(() => {
    ++generation;
    clear();
    // The Auth callback must release its lock before any further SDK call.
    if (!signingOut) setTimeout(() => { void refresh(); }, 0);
  });
  window.addEventListener("offline", () => { ++generation; panel.close(); notify("Sin conexión. Los datos de administración se ocultaron."); });
  window.addEventListener("online", () => { void refresh(); });
  window.addEventListener("pagehide", () => { ++generation; panel.close(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { ++generation; panel.close(); } else void refresh(); });
  window.addEventListener("pageshow", () => { void refresh(); });
  void refresh();
}

if (typeof document !== "undefined") {
  try {
    if (navigator.serviceWorker.controller) throw new Error("Origen compartido con POS");
    if (SUPABASE_URL !== "https://puhkmblnptntorwptvld.supabase.co") throw new Error("Destino no autorizado");
    const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storageKey: "vendify-platform-admin-v1", storage: sessionStorage, persistSession: true, detectSessionInUrl: false, autoRefreshToken: true }
    });
    startAdminEntry(client);
  } catch { const status = document.querySelector("#admin-status"); if (status) status.textContent = "Administración no disponible: verificá la configuración y recargá."; }
}
