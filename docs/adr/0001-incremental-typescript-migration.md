# ADR 0001 — Incremental TypeScript Migration

## Status
Accepted.

## Decision
New critical modules are written in strict TypeScript while the stable legacy POS remains operational.

## Why
A full rewrite would combine product risk with architecture risk. Vendify already contains working business rules that must not be silently lost.

## Consequence
Temporary coexistence of legacy `app.js` and typed modules is accepted. Dead legacy code is removed only after parity tests.
