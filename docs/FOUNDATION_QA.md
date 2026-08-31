# Engineering Foundation QA

## PASS in local audit environment

- production baseline frozen in Git
- `v2.31.1-production-baseline` tag created
- Node syntax check for legacy `app.js`
- duplicate HTML IDs = 0
- duplicate JS function declarations = 0
- local HTML asset references resolve
- production Supabase project ref validated
- public Supabase JWT decoded as `role=anon`
- obsolete Supabase project rejected by QA
- baseline SHA-256 contract
- RPC contract extracted from frontend
- strict TypeScript typecheck
- TypeScript compilation
- 10 offline domain unit tests
- self-contained release build
- self-contained release verification
- private-secret assignment scanner

## NOT TESTED in this environment

- ESLint package execution (npm registry unavailable here)
- Vite package execution (npm registry unavailable here)
- GitHub Actions remote runner
- staging Supabase
- production Supabase mutation tests
- Android/iOS/PWA browser tests

These are NOT marked PASS until executed in their real environment.
