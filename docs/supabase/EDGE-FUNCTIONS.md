# Versioned Team Edge Functions

VEN-004 captures the currently deployed Team Edge Functions into Git without changing production.

## Capture evidence

- Production project ref: `puhkmblnptntorwptvld`
- Capture date: 2026-10-01
- Repository base SHA: `e30fcfd92776e40f78b50a67fa0f4244885264ec`
- Capture mechanism: Supabase Management API read-only Edge Function retrieval
- Production mutations performed: none
- Production deployments performed: none

| Function | Deployed version | `verify_jwt` | Captured source SHA-256 | Supabase `ezbr_sha256` |
| --- | ---: | --- | --- | --- |
| `crear-empleado` | 2 | `true` | `df540898703d458e4533730db0a6727bef74cb1ce3c6dc5c8a6b2afbb79f1890` | `e1c44b3e2b98b13a72be72790d77e14d6480e516b74543876ee07533046c3676` |
| `gestionar-empleado` | 2 | `true` | `6b9902122e94b097cf973812ec9700996cd5fa6c5d82ae19076798ac1f1d8255` | `db6127e0f367ca74b371a731a7017b0f04dae17efc4d588099eeeb44f054ccb1` |

The Git `index.ts` files are byte-identical to the `files[].content` returned by the Management API at capture time. The Supabase `ezbr_sha256` values are recorded separately and are not claimed to be raw-source hashes.

Machine-readable evidence lives in `docs/supabase/edge-functions-provenance.json`. Run `npm run qa:edge-functions` to recalculate the Git source checksums and verify the declared JWT configuration.

## Environment contract

The captured functions read these hosted/local environment names:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

No secret values are versioned. The service-role key remains server-side only.

## Client contract review

Result: **MATCH**.

`src/team/team-edge-service.ts` currently invokes:

- `crear-empleado` with `nombre`, `username`, `rol`, `password`.
- `gestionar-empleado` update with `action="update"`, `membership_id`, `nombre`, `username`, `rol`.
- `gestionar-empleado` delete with `action="delete"`, `membership_id`.
- `gestionar-empleado` password reset with `action="reset_password"`, `membership_id`, `password`.

The captured backend parses those names. Both functions return JSON success with HTTP 200 and caught errors as `{ "error": "<message>" }` with HTTP 400. The typed client already prioritizes a backend `error` or `message` field and therefore does not depend on extra success fields.

## Security review

### Authentication

Both deployed functions have `verify_jwt=true`, require an `Authorization` header, construct a user-scoped Supabase client, and resolve the caller through `auth.getUser()`.

### Tenant isolation and role enforcement

Both functions select an active caller membership whose role is `owner` or `admin`. `gestionar-empleado` additionally restricts the target membership and employee lookup to `callerMembership.negocio_id`.

Delete requires the caller to be `owner`. The target owner cannot be changed and the caller cannot modify their own account through this function.

### Service role

The service-role credential is read from `Deno.env` and used only in the Edge Function. No secret value is present in Git or returned in the response.

### Error leakage

Responses serialize error messages, including some messages originating from Supabase Auth/admin calls. The captured source does not serialize stack traces, tokens, or service-role values. Relaying provider error text remains a hardening follow-up rather than a VEN-004 behavior change.

## FOLLOW-UP — MULTI-BUSINESS CONTEXT

Status: **RISK**.

The accepted domain model allows one Usuario to hold independent Membresías in multiple Negocios. Both captured functions resolve authorization using the first active `owner`/`admin` membership returned by a query ending in `.limit(1).maybeSingle()`, while the request has no explicit Negocio context.

For a caller who administers more than one Negocio, the selected Negocio can therefore be ambiguous. VEN-004 records this behavior and preserves production parity; it does not redesign the contract.

## Atomicity review

The functions combine Supabase Auth operations with several PostgreSQL mutations, so the complete workflows are not one distributed transaction.

- `crear-empleado`: creates the Auth user, inserts membership and employee rows, then writes audit. A catch block attempts compensation by deleting the new Auth user after a database failure. The audit insert result is not checked.
- `gestionar-empleado update`: an Auth email update can occur before employee and role updates; those later database writes are separate and audit is separate.
- `gestionar-empleado reset_password`: Auth password changes before the employee flag update; audit is separate.
- `gestionar-empleado delete`: audit is attempted before Auth deletion. The audit result is not checked.

These are documented risks, not redesigned in VEN-004.

## Dependency pinning

The deployed source imports:

`https://esm.sh/@supabase/supabase-js@2`

That pins only the major line. The exact minor/patch actually resolved by the deployed runtime was not exposed by the captured source, so VEN-004 intentionally does not invent or change a package version. Exact dependency pinning is a follow-up.

## CORS

Both functions currently return:

- `Access-Control-Allow-Origin: *`
- allowed headers: `authorization, x-client-info, apikey, content-type`
- allowed methods: `POST, OPTIONS`

The wildcard origin is not treated as an authentication bypass because the deployed gateway contract has `verify_jwt=true` and the function also validates the caller. Any CORS tightening belongs in a separate hardening change.

## Future deployment procedure

Do not run these commands as part of VEN-004. They are the reproducible operator path for a future explicitly authorized deployment.

```powershell
npx supabase --version
$ProjectRef = "<AUTHORIZED_PROJECT_REF>"

npx supabase functions deploy crear-empleado --project-ref $ProjectRef
npx supabase functions deploy gestionar-empleado --project-ref $ProjectRef
```

Before any future deployment:

1. confirm the intended Supabase project and environment;
2. run `npm run qa:edge-functions`, `npm test`, `npm run qa:secrets`, and the repository CI gate;
3. confirm the operator has the correct Supabase authentication without placing access tokens or service-role values in Git;
4. review the diff against the provenance file;
5. deploy only under an explicit release authorization.

Current Supabase configuration is declared in `supabase/config.toml` with `verify_jwt=true` for both functions.

## Local validation

The VEN-004 automated tests are contractual and do not call production. They verify the captured source rules, client payload agreement, JWT configuration, source checksums, and absence of obvious embedded secret values. A full local invocation can additionally use `supabase functions serve` with disposable local credentials, but it must not require the production service-role key.
