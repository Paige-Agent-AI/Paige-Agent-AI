# QuickBooks legacy lifecycle containment — current-main candidate

Finance owns the bounded company-finance authorization correction. Settings → Integrations retains provider setup and connection lifecycle. This candidate reconciles the existing private containment work with current main; it does not activate the new consent controller.

Affected flows: legacy OAuth initiation/callback, token refresh and disconnect. Those handlers lack the released company-version authorization chain. An authenticated user must not gain a provider effect through legacy user-only connection selection. The candidate refuses those unsafe paths before reading connection rows, decrypting tokens or calling Intuit. CORS preflight remains available; unsupported methods and missing/invalid actor credentials fail closed. Existing accounting-write containment keeps its default response contract.

Authority remains canonical caller JWT and server actor resolution. No replacement Spine, Harness, Trust, gateway, receipt stream, scheduler, registry, ledger or assistant is introduced. These refused routes grant no execution authority; successful provider preparation remains unavailable until the corrected controller, native company match and encrypted lifecycle contracts are adopted through centralized Integrations. Shared Chat/Live executor files remain untouched.

The same handlers apply to eligible existing and future Solo workspaces; no tenant-specific shell branch is added. Company ownership, active membership and cross-account authority must be rechecked by the eventual working lifecycle before effects. This containment cannot establish any of those missing contracts.

Development candidate only. Two focused suites passed 57 controlled tests on current-main reconciliation, covering actor/method refusal and handler isolation; these tests make no live provider requests. Independent non-author review, exact-head hosted CI, merge, edge deployment and production readback remain NOT_DONE. Authenticated runtime and actual provider behavior remain UNVERIFIED under the owner login/provider hold. No customer release or LIVE provider claim is made.
