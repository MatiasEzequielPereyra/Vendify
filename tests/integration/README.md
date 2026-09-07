# Integration tests

Requires staging Supabase credentials. No production mutation tests are allowed here.

## Tenant A/B isolation

`tenant-isolation.mjs` exercises the real Supabase Auth and PostgREST path so
`auth.uid()`, grants and RLS are evaluated as they are in the application. The
suite is read-only and refuses Vendify's known production Supabase host.

Prerequisites:

- two active staging users;
- each user belongs to a different business;
- each business has an active branch and cash register;
- the staging anon key.

Copy `tests/integration/tenant-tests.env.example` to `.env.tenant-tests`, fill
the staging-only values and run:

```bash
npm run test:integration:tenant
```

The local `.env.tenant-tests` file is covered by `.gitignore`. Never place a
service-role key in this file; the suite needs only the public staging anon key.

The test verifies:

- both accounts resolve distinct business contexts;
- each account can read its own business, branch and membership;
- tenant A cannot read tenant B and tenant B cannot read tenant A;
- product, sales and branch-stock queries stay inside the current tenant;
- cross-tenant branch-context RPC calls fail;
- the internal plan-limit primitive cannot be called from the client;
- anonymous context and business access fail or return no rows.
