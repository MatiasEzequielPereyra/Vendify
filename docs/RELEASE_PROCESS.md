# Release Process

1. Start from green `develop`.
2. Run `npm run ci`.
3. Run DB preflight in staging.
4. Apply migration in staging.
5. Run DB verify.
6. Execute manual regression checklist.
7. Create release PR to `main`.
8. Tag version after merge.
9. Deploy staging artifact to production.
10. Run smoke test.

Every DB release must include:

- `00_preflight.sql`
- `01_migration.sql`
- `02_verify.sql`
- `03_rollback_notes.txt`

Never mix frontend files from different releases.
