export interface AuthenticatedSessionLike {
  readonly user?: {
    readonly id?: string | null;
  } | null;
}

export interface ApplicationSetupStep {
  readonly name: string;
  readonly run: () => void;
}

export interface ApplicationBootstrapDependencies {
  readonly validateEnvironment: () => boolean;
  readonly setupSteps: readonly ApplicationSetupStep[];
  readonly initializeAuth: () => void | Promise<void>;
  readonly reportAsyncError: (error: unknown) => void;
  readonly showApplicationShell: () => void;
  readonly loadContext: () => Promise<void>;
  readonly isContextReady: () => boolean;
  readonly isOfflineAuthenticatedMode: () => boolean;
  readonly bootOfflineAuthenticated: () => void | Promise<void>;
  readonly bootOnlineAuthenticated: () => void | Promise<void>;
  readonly showContextLoadError: (error: unknown) => void;
  readonly cleanupContext: () => void;
  readonly clearProducts: () => void;
  readonly clearCart: () => void;
  readonly disconnectRealtime: () => void;
}

export interface ApplicationBootstrap {
  readonly start: () => boolean;
  readonly bootAuthenticated: (session: AuthenticatedSessionLike | null) => Promise<void>;
  readonly handleSignedOut: () => void;
  readonly state: () => Readonly<{
    started: boolean;
    authenticatedUserId: string | null;
    bootInFlight: boolean;
  }>;
}

export interface ApplicationStartDocument {
  readonly readyState: DocumentReadyState;
  addEventListener(
    type: "DOMContentLoaded",
    listener: () => void,
    options: AddEventListenerOptions
  ): void;
}

export function createApplicationBootstrap(
  dependencies: ApplicationBootstrapDependencies
): ApplicationBootstrap {
  let started = false;
  let authenticatedUserId: string | null = null;
  let authenticatedBootPromise: Promise<void> | null = null;

  const start = (): boolean => {
    if (started) return true;
    if (!dependencies.validateEnvironment()) return false;

    started = true;
    for (const step of dependencies.setupSteps) step.run();

    void Promise.resolve(dependencies.initializeAuth()).catch(
      dependencies.reportAsyncError
    );
    return true;
  };

  const runAuthenticatedBoot = async (): Promise<void> => {
    dependencies.showApplicationShell();

    try {
      await dependencies.loadContext();
    } catch (error) {
      dependencies.showContextLoadError(error);
      return;
    }

    if (dependencies.isOfflineAuthenticatedMode()) {
      await dependencies.bootOfflineAuthenticated();
      return;
    }

    await dependencies.bootOnlineAuthenticated();
  };

  const bootAuthenticated = async (
    session: AuthenticatedSessionLike | null
  ): Promise<void> => {
    const userId = session?.user?.id ?? null;
    if (!userId) return;

    if (authenticatedBootPromise) {
      await authenticatedBootPromise;
      return;
    }

    if (
      authenticatedUserId === userId &&
      dependencies.isContextReady()
    ) {
      return;
    }

    authenticatedUserId = userId;
    authenticatedBootPromise = runAuthenticatedBoot()
      .catch((error: unknown) => {
        authenticatedUserId = null;
        throw error;
      })
      .finally(() => {
        authenticatedBootPromise = null;
      });

    await authenticatedBootPromise;
  };

  const handleSignedOut = (): void => {
    authenticatedUserId = null;
    authenticatedBootPromise = null;
    dependencies.cleanupContext();
    dependencies.clearProducts();
    dependencies.clearCart();
    dependencies.disconnectRealtime();
  };

  const state = (): Readonly<{
    started: boolean;
    authenticatedUserId: string | null;
    bootInFlight: boolean;
  }> => ({
    started,
    authenticatedUserId,
    bootInFlight: authenticatedBootPromise !== null
  });

  return Object.freeze({
    start,
    bootAuthenticated,
    handleSignedOut,
    state
  });
}

export function scheduleApplicationStart(
  documentRef: ApplicationStartDocument,
  start: () => void
): void {
  if (documentRef.readyState === "loading") {
    documentRef.addEventListener("DOMContentLoaded", start, { once: true });
    return;
  }

  start();
}
