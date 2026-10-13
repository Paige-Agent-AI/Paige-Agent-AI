# Experience 01: delayed enrollment workspace hydration

## Intended usable outcome and boundary

A legitimate Solo customer whose enrollment finishes after the Welcome page first loads can enter their server-selected workspace through the existing shared tenant provider. The browser must not announce entry or follow an old verified destination after sign-out, actor change, workspace change or failed canonical reads.

Classification: **REPAIR** the existing Welcome-to-Solo handoff. **REUSE** `solo-beta-enrollment-status`, `TenantProvider.refresh`, `profiles.active_tenant_id`, `current_user_tenant_id`, tenant RLS, `workspaceRootForTenant`, `SoloEntry` and existing retry/sign-in/support controls. **EXTEND** the existing Welcome regression tests with a mounted-provider integration proof. **NEW** authority/store/provisioning/approval/registry: none.

This bounded repair owns only `src/pages/Welcome.tsx`, its tests and this delivery/evidence packet. Foundation PR #2071 and other Journey Leads retain their own code. No Auth administration, subscription/provider effect, database migration, membership, tenant creation, Setup write or admission activation is performed.

## Pre-edit capability routing

1. Owner outcome: receipt-backed enrollment opens the correct usable Solo workspace after delayed fulfillment, with honest retry when scope cannot be confirmed.
2. Domain: public Solo acquisition/account entry; Experience 01 owns the handoff, while shared Auth/provisioning and Billing remain canonical owners.
3. Harness/Gateway: the existing receipt-backed enrollment read is reused. This browser navigation repair introduces no Harness execution and no Layer A-G bypass; authenticated proof remains Layer G proof owed.
4. Spine: **UNAVAILABLE / not applicable** as a callable capability. No Chat tool, action or registration is added.
5. Providers: existing acquisition owns Stripe/confirmation-email prerequisites. This repair makes no provider calls or connection changes and cannot certify their readiness.
6. Approval/risk: no mutating action-risk key or `MUTATION_VERB`; the browser reads and navigates. Existing enrollment, agreement, subscription and owner authority gates remain server-owned. No approval system is added.
7. Durable work: existing signed webhook/fulfillment remains the durable producer. No job, event producer, scheduler or persistence is added.
8. Readback: fresh authenticated actor, own profile scope, canonical server-selected tenant and an RLS-filtered tenant record must agree with the committed shared provider and existing route derivation before navigation. The existing immutable enrollment receipt is not replaced or fabricated.
9. Binding: `public.solo-beta-acquisition` remains **PARTIAL**. This repair adds development source/integration evidence; it cannot promote the row to LIVE.
10. Required proof: mounted-provider regression, exact-head independent review/CI, release identity and ordinary protected customer sign-in/current-shell entry. jsdom is automated integration evidence, never rendered or authenticated acceptance.

## Baseline and source cause

Grounded on main `c0a20243249739a00b2fa709729b323156cb125b`. `App.tsx` mounts `TenantProvider` above Welcome. The provider may complete its initial profile/tenant read before signed fulfillment. Welcome's later verified status previously SPA-navigated immediately, without rehydrating that already-mounted provider. `SoloEntry` then correctly refused an empty active tenant. The existing chooser test passed; the new integration test failed at the actual downstream shell marker against unchanged Welcome source.

`refresh` is recreated with each provider render and resolves without a success/snapshot result. It also preserves a previously accepted context on transient failed reads. Therefore awaiting it is necessary but insufficient: navigation waits for its React-committed context and fresh canonical scope readback, rather than treating the refresh Promise or destination string as authority.

The repair captures the pre-refresh `tenants` array reference and requires a new committed list. In the incumbent provider, required-read success creates a new mapped list; a failed required read preserves the prior list. This is a narrowly tested completion marker, **never tenant or role authority**. Actor, profile, canonical server-selected scope, RLS-filtered tenant and canonical route derivation still provide that boundary. A future provider change that memoizes successful list identity must preserve this completion contract or adapt this caller in the same change.

## Flow and state contract

| State/trigger | Existing seams and required behavior | Exit/recovery |
| --- | --- | --- |
| Checkout return, no session | Ordinary Auth session read; no enrollment/payment claim | Existing Sign in and resume |
| Pending enrollment | Existing bounded server polling; live status region remains pending | Existing timeout and Retry verification |
| Server verified enrollment | Refresh the existing provider, freshly verify actor/profile/server-selected scope and canonical tenant address; wait for provider commit | Canonical SoloEntry only after agreement |
| Delayed fulfillment | A pre-fulfillment empty provider is re-read after fulfillment | Enter without requiring manual reload |
| Failed/missing/mismatched readback | Retain verified enrollment reference; explain workspace opening could not be confirmed | Existing retry/support, no success claim |
| Stale destination or different selected workspace | Destination never selects tenant authority | Stay on recovery; do not overwrite profile scope |
| Sign-out/actor change/unmount/retry | Cancel the old handoff and ignore its late result; clean timers/subscription | Ordinary sign-in continuation or current page |
| Existing `choose_account` response | Preserve exact allowlisted chooser destination and deliberate selection; suppress old actor results | Existing chooser |

Visual direction is inherited from Welcome and the approved Solo acquisition contract (`docs/evidence/ui-delivery/solo-beta-acquisition.md`). No layout, typography, palette, motion or navigation redesign. The existing status region and recovery controls remain the interaction containers. Error copy distinguishes verified enrollment from unverified workspace opening.

## Proof and release truth

- Existing Welcome account-choice baseline: **PASS, 1/1**.
- Failing-first mounted `TenantProvider` + real `SoloEntry` delayed-fulfillment proof: **FAIL, 1/1**, expected shell marker absent against unchanged Welcome source. Only the shell content beyond SoloEntry is substituted in that proof; Supabase is a deterministic no-network adapter.
- Repaired source suite: **PASS, 98/98** across five files: Welcome account-choice unit, 19 mounted-provider integration cases, SoloEntry, `useTenantContextActAs`, and `workspaceEntry`. Deterministic adapters simulate pending→fulfilled rows through the real provider and entry gate; the content beyond SoloEntry is substituted. No real database, Auth login or provider is exercised.
- Committed source payload `941d930681f1b2e007a30a140e06cc575f0502c3`: **PASS, 63/63** for the 19 mounted-provider cases plus 44 existing acquisition/security boundary cases in `soloBetaSecurityBoundary.test.ts` and `soloBetaDynamicPaymentsWelcome.test.ts`.
- Changed-file ESLint: **PASS**, exit 0, no errors/warnings across Welcome and its two test files. Design detector: **PASS**, installed Impeccable v4.3.1 `detect src/pages/Welcome.tsx`, zero findings. `git diff --check` and the existing UI evidence validator passed. TypeScript ratchet: **PASS**, baseline 10/current 10, no new errors on the committed source payload. The first pre-fix compiler run found two generated-select type errors; explicit typing of the RLS tenant address projection fixed them before the source commit, and the final ratchet passed without baseline changes.
- Native actual-Welcome synthetic packet: **PASS, bounded**: 16 unchanged native JPEGs with matching DOM/dimensions, including the 8-frame light/dark four-viewport matrix, pending, mobile sign-out, 320 CSS-pixel reflow and native keyboard Retry to a labelled synthetic destination. No actual SoloEntry/customer/Auth/database/provider is mounted or exercised by this browser harness. Source SHA256 `0059f9fd7eec039a1f9681bee7022dd9f8e6676faa838c58fff66579df4a537c`. Native zoom/screen reader/temporal motion/full rendered state matrix and authenticated deployment acceptance remain **UNVERIFIED**.
- PR, independent review, hosted CI, production release: **UNVERIFIED / not performed by this worker**.
- Internal channel: **development**. No customer release identity or LIVE claim.

Original source payload identity: `941d930681f1b2e007a30a140e06cc575f0502c3`. The final documentation head is recorded by Git/root review; no deployment is attributed to either development commit.

Protected customer acceptance must validate the actual actor/membership configuration. This repair changes no Auth configuration or role grants; separately discovered admission/security findings remain in the owner-selected private coordination records.

## Independent review repair

Historical pre-release review snapshot: [PR #2096](https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/2096) was a draft development candidate at the following review. Current release identity is recorded below. Non-author source review of head15a64f11fb13d491440a935133a4e5abbf84e921 completed with one P2: a settled workspace error survived sign-out/actor change and overrode the sign-in message. Root cleared that error on subject invalidation and restricted its presentation to the workspace-failure state. Two actual mounted-provider cases failed before the repair (19 other cases skipped), then the five-file suite passed **100/100**, including **21** provider integration cases. Repair source commit46d6d3b80b45d1c31adacc9956cdf318cab0d093. Final exact-head recheck/CI remain separate.

All previous native frames were recollected on the repaired source, with three additional synthetic before/after subject-change frames proving removal of prior verified-enrollment/reference/retry copy. Original 13-frame/sourcef0 packet and review remain historical in Git head15a64f11fb13d491440a935133a4e5abbf84e921. Current source/frame binding uses the repaired hash; no historical evidence is relabelled.

## Native evidence and remaining proof

Root extended the existing separate render harness in `scripts/live-drive/harness/mount/welcome.*`, excluded from the product build. Exact client/context aliases prevent the real Supabase SDK from mounting. The fixture implements only deterministic reads/refresh and the enrollment-status port; other function invocations refuse. The route target explicitly labels itself synthetic. No account, Auth principal, tenant creation, provider action, HTTP SDK request, new QA engine or persisted business store was introduced.

The 16-frame packet and source binding live in `docs/evidence/experience-01-admission-hydration/render/matrix.json`. Each native JPEG has paired DOM state, actual theme, control bounds and measured geometry. Rapid/stale viewport captures were rejected rather than accepted. Native Tab visibly focused Retry, and Return reached the labelled synthetic destination. The real mounted TenantProvider/SoloEntry boundary remains separate automated integration proof.

Complete native first-use/account-choice/timeout/actor-change behavior, 200 percent native zoom, screen reader and temporal reduced-motion proof remain owed. Production entry, logout/login and private interview resume require genuine authorized ordinary-customer authentication through the current private ANT-21/ANT-52 route. The owner superseded the former QA-account designation; this repair does not mutate or retrofit any account, role, connection or subscription.

## Collision-safe Second Brain closeout handoff

Owner: Experience 01 root Journey Lead. Reason: shared Second Brain/Master files are reserved to root while foundation and admission work proceed separately; this worker must not edit those sections.

- Master §5, Experience 01 / ANT-50: add “The admission handoff repair refreshes the existing mounted TenantProvider after receipt-backed enrollment and requires committed provider/canonical scope agreement before SoloEntry. Local mounted-provider proof is separate from release and protected ordinary-customer acceptance.” Keep §4.0 Shipped Delivery Log **N/A** until merged; exact merge/release identity belongs to root closeout.
- `docs/brain/lessons-learned.md`: record that backend fulfillment can become true after initial browser context hydration without any Auth event; testing only mocked navigation missed the empty shared provider. Prove the actual provider-to-entry boundary and React commit ordering.
- Existing Brain README/domain record: link this bounded repair without creating another onboarding inventory or source-of-truth registry.

Root owns final fresh head/review/CI, rendered finish review and all release/QA coordination. The original interview → reviewed fact → canonical Setup save/readback → correction/resume foundation is unchanged.

Claim sweep: `Welcome`, `welcome`, `delayed fulfillment`, `delayed-fulfillment`, `pre-fulfillment`, and `workspace hydration` across `docs/brain` and Master. The decision-log search initially encountered a NUL byte, so it was repeated with `rg -a` and the remaining matches were assessed. Existing acquisition/current-shell claims remain PARTIAL/PROOF OWED; established login choice, transactional welcomes and Marketing series are separate preserved flows. The delayed shared-provider hydration mechanic was not recorded there, so the explicit root handoff above adds it without rewriting dated history. No secret value was written. No additional out-of-scope finding was discovered by this bounded repair.

## Actual release closeout — 2026-10-13

PR #2096 squash merged at 03:17:56 UTC as `f5494e863a9ccf6380154cb4b2fc85ef4ffdb2f0`. Independent non-author review completed **PASS** on exact head `81b7c0333586783a7e6ada3a9f0516882bca9531`, base `aec64c4caafd935b64714f963ba166907b946677`, full binary diff SHA256 `729da1a50e0f8fde9b54dd2402503da13844e59b1689fbbfb128cdf80c603db1`. The sole earlier P2 is fixed by `46d6d3b80b45d1c31adacc9956cdf318cab0d093`; no open findings at that pre-merge review. The later reported P2 is recorded below. Current-main reconciliation preserved upstream context/entry, Spine and infrastructure source unchanged. Git comparison of released versus reviewed Welcome source/tests returned no delta.

All ten observed applicable checks succeeded at that immutable head: verify, communications boundary, PostgreSQL authority, database contract, web-fetch hardening, Spine contract, UI-delivery evidence, audit, lint and Vercel Preview Comments. Supabase Preview was SKIPPED because no associated preview branch/database delta applied. Vercel and affected-project statuses succeeded. This records observed GitHub evidence; it does not waive any required gate.

Production deployment `dpl_FVEmN3vu4UyjsLqiG8W4QAst3eve` is READY at exact merge `f5494e863a9ccf6380154cb4b2fc85ef4ffdb2f0`. Migration and Edge delivery are **NOT_APPLICABLE**: this repair changes neither. At 03:38:37 UTC the canonical public site served the next documentation-only build `fed6e6a64c75f8ddad1b4725dc67ac91852a9f9a-mv647lzz`, deployment `dpl_ArPvH2DVCJCUeJBSPA5JkqNWQQHq`. GitHub ancestry is ahead one/behind zero, merge base the actual #2096 squash, with no runtime delta. Public version/module reads returned 200; Welcome compiled hash is `f91d55609e34abd51737c090b11f5fc3da2a1475766900405f643d3bf01e89b7`, unchanged source hash `0059f9fd7eec039a1f9681bee7022dd9f8e6676faa838c58fff66579df4a537c`. [Public production artifact evidence](../evidence/experience-01-admission-hydration/production-readback.json) is read-only HTTP evidence, neither browser rendering nor customer authentication. The original immutable deployment URL required Vercel deployment protection; it was not treated as a failed customer login and no bypass was used.

The source behavior is verified by 100 focused automated tests, including 21 actual mounted-provider/entry cases, plus sixteen native actual-Welcome synthetic frames and bounded independent finish SHIP. **PROOF OWED**, typed scope `public.solo-beta-acquisition / legitimate current-SOLO entry`: protected ordinary-customer actor, active owner membership, canonical selected workspace, enrollment-to-entry, logout and subsequent login. Substantive blocker: those authenticated cases have not been executed and attested by the designated QA runner. An existing-account login cannot prove fresh registration/email verification/provisioning. Native zoom, screen reader, full native state/motion drive and final owner acceptance remain UNVERIFIED. The private interview/save/readback/correction/resume foundation is a separate unreleased PR #2071. No customer version, announcement or LIVE journey claim.

Recovery position: retain ordinary fail-closed scope/readback/retry; any demonstrated regression goes through the normal reviewed forward-fix or Git revert release path. No rollback, role change, account operation, provider effect or admission change was performed. Master §4.0 and §5, the Brain index and UI-delivery record are reconciled in this mechanical post-release closeout. The existing hydration/subject-invalidation lesson remains current; no duplicate source-of-truth record was added.

Post-merge limitation and disposition: A post-merge GitHub review at03:20:57 reported P2 discussion_r4254356943: verification near the enrollment polling deadline inherits too little remaining time for context/readback and can unnecessarily show recoverable workspace failure. Source confirms that polling elapsed time is subtracted at Welcome.tsx:121. Disposition: accepted; normal bounded forward fix and failing-first late-verification regression are required. This does not authorize role/provisioning/admission changes or establish customer acceptance.
