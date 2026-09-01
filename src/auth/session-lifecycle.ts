export interface AuthSessionLike {
  user?: {
    id?: string;
    email?: string;
  } | null;
}

export interface AuthLifecycleClientPort {
  getSession(): Promise<{ data: { session: AuthSessionLike | null } }>;
  onAuthStateChange(
    callback: (event: string, session: AuthSessionLike | null) => void | Promise<void>
  ): unknown;
}

export interface AuthLifecycleCallbacks {
  setSession(session: AuthSessionLike | null): void;
  isRecoveryActive(): boolean;
  setRecoveryActive(active: boolean): void;
  showLogin(): void;
  showNewPasswordPanel(): void;
  showApp(session: AuthSessionLike): void | Promise<void>;
  handleSignedOut(): void | Promise<void>;
}

async function handleAuthStateChange(
  event: string,
  session: AuthSessionLike | null,
  callbacks: AuthLifecycleCallbacks
): Promise<void> {
  callbacks.setSession(session);

  if (event === "PASSWORD_RECOVERY") {
    callbacks.setRecoveryActive(true);
    callbacks.showLogin();
    callbacks.showNewPasswordPanel();
    return;
  }

  // getSession() resolves the initial session. Supabase may emit
  // INITIAL_SESSION immediately afterwards, so avoid booting twice.
  if (event === "INITIAL_SESSION") return;

  if (session && !callbacks.isRecoveryActive()) {
    await callbacks.showApp(session);
    return;
  }

  if (!session) await callbacks.handleSignedOut();
}

export async function initializeAuthLifecycle(
  auth: AuthLifecycleClientPort,
  callbacks: AuthLifecycleCallbacks
): Promise<void> {
  const { data } = await auth.getSession();
  const initialSession = data.session;
  callbacks.setSession(initialSession);

  auth.onAuthStateChange(async (event, session) => {
    await handleAuthStateChange(event, session, callbacks);
  });

  if (initialSession && !callbacks.isRecoveryActive()) {
    await callbacks.showApp(initialSession);
  } else {
    callbacks.showLogin();
  }
}
