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

## Sales concurrency (writes staging data)

`sales-concurrency.mjs` is intentionally separate from the read-only suite. It
creates two permanent sales in staging with the same two products in reversed
cart order. The two authenticated users must belong to the same business and
use separate open cash registers in the same branch.

Set the `VENDIFY_TEST_SALES_*` variables from `tenant-tests.env.example` with
dedicated QA users, registers and products. Each product needs at least two
units of stock; `VENDIFY_TEST_SALES_PAYMENT_AMOUNT` is the exact sum of both
product prices. The runner refuses the known production host and only writes
when `VENDIFY_TEST_CONFIRM_STAGING_SALES=RUN_SALES_CONCURRENCY`.

```bash
npm run test:integration:sales-concurrency
```
