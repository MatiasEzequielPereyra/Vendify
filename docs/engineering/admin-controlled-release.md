# Independent administrative release

Project: VendifyV3
Revision: 2
Updated: 2026-10-26
Owner: Orchestrator B / DevOps
Task: VEN_ADMIN_001B1_CONTROLLED_RELEASE_TARGET

## Explicit destination

The versioned `contracts/admin-release-target.json` names the independent project
`prj_GBIFOT8NGgKEchQ0ZzC60EJiwyVy` (vendify-platform-admin-release), team
`team_cJL8jHMV3R0hsr8C0kOkznph`, assigned stable administrative hostname
`vendify-platform-admin-release.vercel.app`, production backend
`puhkmblnptntorwptvld` and immutable POS baseline digest.
This contract is destination identity, not Production deployment permission.

Do not use the old paused project's default hostname: its historical deployment contains
a service worker. Do not assign or promote this artifact to a POS hostname.
The new hostname is assigned and verified by project-creation domain metadata.
An availability lookup404 alone would not prove ownership. Current hosted
verification belongs in the handoff.

## Build selection

`npm run vercel-build` removes stale `.vercel/output` first. The known POS project
uses the original baseline builder and strict verifier in Production. Its exact
PR29 Preview retains the accepted mixed artifact with separate hostname routes.
The independent project accepts only Preview of the exact authorized branch and
uses the administrative-only packager. Unknown hosted projects and independent
Production builds fail closed. Root `vercel.json`, baseline builders/verifiers,
classic files, staging builders and the panel runtime are unchanged.

The independent Preview permits only the unique deployment hostname and the
explicit stable hostname. Both expose exact verified administrative files and
`/admin/`; other hosts/paths return 404, including `/sw.js` and `/index.html`.
No POS files, service worker, wildcard filesystem fallback or staging runtime are
included. Existing security headers remain; administrative workers and caching
are disabled. Authentication remains on the accepted runtime, with its separate
sessionStorage key and server-side global-administrator authorization.

## Reproducible local release preparation

From the exact reviewed checkout with dependencies already installed:

```powershell
npm run ci
$releaseHead = git rev-parse HEAD
npm run package:admin:release -- $releaseHead
```

This last command works locally only. It checks the exact explicit HEAD, strict
baseline and administrative inventory. It prepares
`.vendify-build/admin-release-output/{config.json,static/admin/...}` and
`.vendify-build/admin-release-manifest.json`. The manifest binds the target,
source HEAD and hashes of all output files, including routing configuration.
Only the exact stable hostname is served by this release artifact. It performs
no network publication and carries `deploymentAuthorized:false`.

Run preparation twice and compare `outputFiles` before review. A clean tracked
tree, reviewed commit and matching output hashes are prerequisites for a later
upload; HEAD identity alone does not prove a dirty checkout's source contents.

## Pending Production operation — separate approval required

After A and the owner approve the precise commit, output hashes, project, host
and retained SSO protection, stage the verified output in an isolated deployment
directory as `.vercel/output`, with `.vercel/project.json` containing only the
explicit independent `projectId`, authorized `orgId` and project name. Do not
link or change the normal POS checkout. Recheck the upload inventory against
the reviewed receipt and use Vercel's supported prebuilt deployment flow with
the exact authorized team/project and Production target. This is a new explicit
operation; do not remove the source build's Production guard or silently promote
the Preview. The build output is static, with no functions or private credentials.

After READY, verify final output bytes and destination, then explicitly point
only `vendify-platform-admin-release.vercel.app` to that approved deployment.
Do not alter the existing POS domains, old administrative domains, plans, SSO,
Supabase or branch tracking. Confirm POS Production deployment identity before
and after. Test root redirect, direct `/admin/` and reload, resource references,
SW/POS 404, login/logout and role authorization; no commercial save is permitted
without separate permission. Preserve the already accepted B1/P1 evidence.

If deployment outcome or alias assignment is ambiguous, inspect state before
any retry. If a private artifact, wrong project, wrong host, stale service worker
or unexpected Production deployment appears, stop. Do not restore a vulnerable
database function or execute SQL. Reverting a future administrative alias must
never point it at the old POS/staging deployment; remove its exposure or use a
previous specifically approved administrative-only artifact.

The preceding release-target task authorized code, commits and Preview only.
The current bounded technical Production exception is recorded below. Merge,
commercial publication, paid services and database writes remain prohibited.
Preview testing and a verified local artifact do not grant release acceptance.

## First protected technical bootstrap — 26 October 2026

The owner explicitly authorized one prebuilt technical Production deployment to
this new project, with --prod --skip-domain. The old paused project must stay
untouched. This is not commercial release or permission to activate the stable
hostname. Source Production builds remain blocked; only an isolated prebuilt
upload may perform the authorized operation after all prechecks.

Prepare with node scripts/package-admin-release.mjs --prepare-bootstrap
--source-head <exact reviewed HEAD>. Normal release mode remains exact-host-only.
Bootstrap adds an anchored host match restricted to the generated hostname
namespace of vendify-platform-admin-release, using Build Output API MatchableValue
re. It does not allow POS/old-project hostnames or arbitrary hosts. The returned
URL must match the expected namespace AND be verified through Vercel as belonging
to the exact new project/team; local matching alone is not hosted provenance.

Stage only the verified six output files and an explicit project link outside
Git. Verify CLI identity/project and All Deployments protection, then confirm
zero previous deployments immediately before the single --prebuilt --prod
--skip-domain submission. Never retry an ambiguous submission before inspection.
Check unauthenticated HTTP access is blocked before owner-operated Vendify login.
Do not use an authentication-bypass header/share link, commercial save, automatic
Git connection, domain assignment, Supabase mutation or POS deployment.

Existing prepared receipts reference their own old target and are not reusable
as authorization for this new project. A new exact artifact receipt is required.
