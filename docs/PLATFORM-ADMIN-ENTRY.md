# Dedicated platform administration entry

The accepted platform controller/services are composed independently of the POS bootstrap. `/admin/` imports only platform, shared DOM/dashboard formatting and existing password-login service. No staging bundle or POS bootstrap is promoted.

## Build contract

`npm run build` and `npm run verify:release` retain their strict, original baseline behavior. `npm run build:admin` independently re-verifies `dist` before composition, copies it to `dist-admin-release`, then adds the administrative HTML, hashed bundle/CSS and public configuration. `npm run verify:admin` checks both inventories, byte hashes, dependencies, backend binding and forbidden execution patterns. `vercel-build` runs this sequence; A separate Build Output API wrapper publishes the composed bytes with host isolation; the original root vercel.json remains unchanged. No baseline verifier exceptions.

The administrative configuration contains only the baseline public URL/anon constants, with no POS client initialization. Auth uses pinned SDK 2.116.0, a dedicated storage key and sessionStorage. It validates the user via Auth before the existing RPC guards; no new privilege scheme. Logout uses scope local to avoid revoking separate POS sessions. Logout and session/offline transitions clear privileged DOM immediately; a pending logout disables login. No administrative service worker is registered, no private RPC results cached. The root CSP and other baseline headers remain intact.

## Preview hosting isolation

The immutable POS worker has root scope and caches any navigation response as its own index. Therefore same-host `/admin/` is unsafe even with different SDK storage or Cache-Control. Detecting a controller in the entry is defense in depth only: it cannot undo the initial interception by an already-active worker.

A new exclusive administrative hostname must not serve/register the POS worker. Administrative paths must return a non-success response on POS hosts; redirecting an intercepted navigation to administrative HTML could still poison POS cache. Hosting routing uses VERCEL_URL, the fresh unique deployment hostname already created by the authorized Preview. It redirects that host root to /admin/ and rejects every non-admin path there; on all other hosts, /admin/ returns 404. The branch alias remains the POS origin. It creates no alias, domain, project or paid service.

Do not relax baseline/staging controls to solve this boundary. The wrapper accepts only the explicitly authorized Preview branch and refuses Production builds. It does not change existing remote configuration. The host boundary is verified before and after publication. Existing PWA commercial gates remain separate.

## Validation scope

New unit checks cover packaging tampering/references, server-role gating, logout clearing/concurrent-login prevention and session/offline clearing. Tests use fixtures, not production writes. Subsequent real Preview tests must verify direct/reload routing, both owner-operated logins, actual list/filter/pagination when fixture permits, logout, denied role, and clean worker/cache isolation. Existing B1 20/20 evidence is retained, not substituted for these checks. Do not save commercial changes during smoke tests.
