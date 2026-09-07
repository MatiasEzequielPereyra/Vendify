# Supabase tests

This directory is reserved for automated SQL/RLS tests executed against staging/local Supabase.

The first live Auth/RLS suite is implemented at
`tests/integration/tenant-isolation.mjs`. It uses two real staging sessions
instead of simulating `auth.uid()` from the SQL editor. See
`tests/integration/README.md` for setup and execution.

First suites to add:

1. cashier permissions;
2. `registrar_venta_v4` idempotency;
3. stock concurrency;
4. cash session concurrency;
5. purchase reception idempotency.
