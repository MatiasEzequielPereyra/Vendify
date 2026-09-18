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

The offline implementation uses IndexedDB transactions and derives local availability from the
server snapshot minus unsynchronized local reservations. That calculation is additionally capped
by a backend-issued authorization with explicit tenant, branch, cash-register and expiration scope.
The snapshot and local reservation are operational inputs, not authority: synchronization always
uses an idempotent backend RPC that validates the authorization and performs the final stock, sale
and cash mutations atomically.

POS and Cash consume the IndexedDB engine through the typed Offline integration owned by
`src/offline/`; no standalone browser bridge may duplicate its context, validation or synchronization
rules. The compatibility runtime delegates through that interface while production activation stays
behind the Offline feature flag.

## Realtime coordination

`src/context/realtime-controller.ts` owns the scoped Realtime channel lifecycle for the active
business and branch: subscriptions, reconnection, debounce, foreground recovery and the watchdog.
Domain refresh operations remain explicit injected adapters while the compatibility runtime is
retired. PostgreSQL events are hints; reconciliation reads authoritative data again and no public
broadcast is treated as authority.
