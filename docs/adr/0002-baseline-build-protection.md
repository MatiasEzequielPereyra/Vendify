# ADR 0002 — Protect Production Baseline During Engineering Foundation

## Status
Accepted.

## Decision
During Phase 0, `npm run build` packages the verified v2.31.1 production baseline. TypeScript compiles separately.

## Why
Toolchain migration must not change runtime behavior before typed replacements are proven.

## Exit criterion
The Vite/TypeScript build becomes production only after migrated modules have parity, regression and staging QA.
