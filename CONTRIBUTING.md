# Contributing to Vendify

## Before coding

1. Create a branch from `develop`.
2. Describe the risk and desired invariant.
3. Add/update tests before replacing critical behavior.

## Required before PR

```bash
npm run ci
```

For SQL changes also provide preflight, verify and rollback notes.

## Rules

- no service_role in browser code;
- no direct security decisions in UI only;
- no silent loss of offline sales;
- no legacy deletion without caller search and regression;
- no production RPC change without contract review.
