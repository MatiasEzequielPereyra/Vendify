# Supabase

## `migrations/`

Only reviewed migration/preflight/verify files intended for the current repository history belong here.

## `legacy/`

Historical SQL preserved only for:

- contract discovery;
- audit;
- reconstruction;
- comparison.

**Do not execute the `legacy/` directory as a migration chain.**

Several files are all-in-one or superseded historical patches.

## `tests/`

RLS, RPC, concurrency and tenant-isolation tests will live here and run against staging/local Supabase.

## `diagnostics/`

Read-only SQL used to capture the effective definition and permissions of
production RPCs that predate the incremental repository history. Run a
diagnostic only when its corresponding audit phase requests it; do not treat
its result as a migration.

