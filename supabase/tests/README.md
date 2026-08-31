# Supabase tests

This directory is reserved for automated SQL/RLS tests executed against staging/local Supabase.

First suites to add:

1. tenant A vs tenant B isolation;
2. cashier permissions;
3. `registrar_venta_v4` idempotency;
4. stock concurrency;
5. cash session concurrency;
6. purchase reception idempotency.
