import assert from "node:assert/strict";
import test from "node:test";
import {
  REGISTERED_EMAIL_MESSAGE,
  registerOwner,
  requestPasswordReset,
  signInEmployee,
  signInOwner,
  signOut,
  updatePassword
} from "../../dist-ts/auth/auth-service.js";

function authMock(overrides = {}) {
  return {
    async signInWithPassword() { return { data: null, error: null }; },
    async signUp() { return { data: { session: {} }, error: null }; },
    async resetPasswordForEmail() { return { data: null, error: null }; },
    async updateUser() { return { data: null, error: null }; },
    async signOut() { return { data: null, error: null }; },
    ...overrides
  };
}

test("owner sign in maps invalid credentials to current Spanish message", async () => {
  const auth = authMock({
    async signInWithPassword(credentials) {
      assert.deepEqual(credentials, { email: "owner@test.com", password: "secret" });
      return { data: null, error: { message: "Invalid login credentials" } };
    }
  });

  assert.deepEqual(
    await signInOwner(auth, " owner@test.com ", "secret"),
    { ok: false, errorMessage: "Email o contraseña incorrectos." }
  );
});

test("employee sign in uses internal identity and generic credential error", async () => {
  const auth = authMock({
    async signInWithPassword(credentials) {
      assert.deepEqual(credentials, {
        email: "negocio.caja01@employees.vendify.internal",
        password: "clave"
      });
      return { data: null, error: { message: "anything" } };
    }
  });

  assert.deepEqual(
    await signInEmployee(auth, " Negocio ", " Caja 01 ", "clave"),
    { ok: false, errorMessage: "Código, usuario o contraseña incorrectos." }
  );
});

test("registration validates before calling Supabase", async () => {
  let calls = 0;
  const auth = authMock({
    async signUp() {
      calls += 1;
      return { data: { session: {} }, error: null };
    }
  });

  const result = await registerOwner(auth, {
    businessName: "",
    email: "owner@test.com",
    password: "12345678",
    redirectTo: "https://vendify.test/"
  });

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    ok: false,
    errorMessage: "Ingresá el nombre del negocio.",
    requiresConfirmation: false
  });
});

test("registration preserves redirect metadata and confirmation state", async () => {
  const auth = authMock({
    async signUp(credentials) {
      assert.deepEqual(credentials, {
        email: "owner@test.com",
        password: "12345678",
        options: {
          emailRedirectTo: "https://vendify.test/app",
          data: { business_name: "Mi Kiosco" }
        }
      });
      return { data: { session: null }, error: null };
    }
  });

  assert.deepEqual(
    await registerOwner(auth, {
      businessName: " Mi Kiosco ",
      email: " owner@test.com ",
      password: "12345678",
      redirectTo: "https://vendify.test/app"
    }),
    { ok: true, errorMessage: null, requiresConfirmation: true }
  );
});

test("registration detects Supabase obfuscated response for an existing email", async () => {
  const auth = authMock({
    async signUp() {
      return {
        data: { session: null, user: { identities: [] } },
        error: null
      };
    }
  });

  assert.deepEqual(
    await registerOwner(auth, {
      businessName: "Mi Kiosco",
      email: "owner@test.com",
      password: "12345678",
      redirectTo: "https://vendify.test/app"
    }),
    {
      ok: false,
      errorMessage: REGISTERED_EMAIL_MESSAGE,
      requiresConfirmation: false
    }
  );
});

test("registration maps explicit existing-user errors to the business message", async () => {
  const auth = authMock({
    async signUp() {
      return {
        data: { session: null },
        error: { code: "user_already_exists", message: "User already registered" }
      };
    }
  });

  const result = await registerOwner(auth, {
    businessName: "Mi Kiosco",
    email: "owner@test.com",
    password: "12345678",
    redirectTo: "https://vendify.test/app"
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorMessage, REGISTERED_EMAIL_MESSAGE);
  assert.equal(result.requiresConfirmation, false);
});

test("password reset preserves redirect URL", async () => {
  const auth = authMock({
    async resetPasswordForEmail(email, options) {
      assert.equal(email, "owner@test.com");
      assert.deepEqual(options, { redirectTo: "https://vendify.test/" });
      return { data: null, error: null };
    }
  });

  assert.deepEqual(
    await requestPasswordReset(auth, " owner@test.com ", "https://vendify.test/"),
    { ok: true, errorMessage: null }
  );
});

test("password update validates before calling Supabase", async () => {
  let calls = 0;
  const auth = authMock({
    async updateUser() {
      calls += 1;
      return { data: null, error: null };
    }
  });

  assert.deepEqual(
    await updatePassword(auth, "123", "123"),
    { ok: false, errorMessage: "La contraseña debe tener al menos 8 caracteres." }
  );
  assert.equal(calls, 0);
});

test("sign out delegates to auth client", async () => {
  let calls = 0;
  const auth = authMock({
    async signOut() {
      calls += 1;
      return { data: null, error: null };
    }
  });

  assert.deepEqual(await signOut(auth), { ok: true, errorMessage: null });
  assert.equal(calls, 1);
});
