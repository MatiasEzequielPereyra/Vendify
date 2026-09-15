# Supabase

## `migrations/`

Only reviewed migration/preflight/verify files intended for the current repository history belong here.

The current chain is incremental and requires the pre-v2.31 schema. Its recovery status is tracked in `contracts/database-baseline.json`. Do not apply this directory to an empty database until that contract reaches `ready_for_disposable_test` and the resulting baseline passes a disposable Supabase rebuild.

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

`diagnostics/pre_v231_baseline_capture.sql` reads structural metadata for the six
core tables missing from repository history. It returns no business rows and
performs no writes. Export its single JSON result only from an authorized project;
review that result before creating any executable baseline.

## `sources/`

Recovered deployed definitions needed for contract auditability but not safe to add
to the migration chain. They are source references only: do not execute this
directory as migrations.
