# Branching

## Permanent branches

### main
Only production-ready code. Tag every deployed version.

### develop
Integration branch after feature QA.

## Short-lived branches

- `feature/offline-indexeddb`
- `feature/typescript-core`
- `fix/<problem>`
- `security/<hardening>`

## Pull request rule

No direct feature commits to `main` after repository bootstrap.

Each PR must include:

- what changed;
- regression risk;
- tests executed;
- migrations if any;
- rollback notes.
