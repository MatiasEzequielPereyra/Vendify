# Architecture

## Principle

Vendify is migrating with the **Strangler Fig** pattern: new typed modules are introduced around a stable legacy core and replace responsibilities only after parity tests pass.

## Current production boundary

The current browser runtime remains:

- `index.html`
- `app.js`
- `styles.css`
- `sw.js`

These files are protected by the v2.31.1 SHA contract during Phase 0.

## New TypeScript boundary

`src/` contains future production modules. New critical logic must prefer TypeScript.

Migration order:

1. domain types
2. offline storage/sync
3. POS sale contracts
4. cash
5. inventory
6. API/RPC wrappers
7. products/purchases/team/dashboard

## Backend authority

UI locks are UX only. PostgreSQL remains authoritative for:

- tenant isolation
- permissions
- stock
- sales
- idempotency
- cash sessions
- purchase reception

## Offline direction

The final offline implementation will use IndexedDB transactions and derive available stock from server snapshots minus unsynced local reservations.
