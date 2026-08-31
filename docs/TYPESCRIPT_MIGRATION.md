# TypeScript Migration Plan

## What we are NOT doing

We are not converting 12k+ lines of `app.js` in one operation.

## Phase 0

- strict TypeScript project;
- domain IDs as branded types;
- offline sale state machine;
- offline stock reservation rules;
- CI/typecheck/tests;
- legacy production remains byte-for-byte protected by SHA contract.

## Phase 1

Move offline persistence/sync to TypeScript + IndexedDB.

## Phase 2

Create typed RPC facade. Generate Supabase database types from staging/production schema.

## Phase 3+

Move stable modules progressively.

A legacy function is removed only after:

- typed replacement exists;
- behavior parity tests pass;
- manual regression passes;
- no active callers remain.
