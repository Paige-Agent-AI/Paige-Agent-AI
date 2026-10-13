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
- Native rendered responsiveness, keyboard/zoom/reduced-motion and authenticated deployment acceptance: **UNVERIFIED**. No detached DOM result is described as browser acceptance.
- PR, independent review, hosted CI, production release: **UNVERIFIED / not performed by this worker**.
- Internal channel: **development**. No customer release identity or LIVE claim.

Source payload identity: `941d930681f1b2e007a30a140e06cc575f0502c3`. The final documentation head is recorded by Git/root review; no deployment is attributed to either development commit.

Relevant source assertions have a separate limit: `provision_tenant_as` inserting global `user` does not prove the final role set. The current active-membership sync maps tenant owner/admin to global `admin`; the canonical provisioning assertion checks tenant shape/owner membership/support state, not the exact final global-role set. This repair does not inspect or change Auth/role grants. Protected new-customer acceptance must validate the real final actor/membership configuration, rather than infer it from the first insert.

## Remaining native UI evidence handoff

The flow delta is bounded to pending verification while the existing provider/canonical readback is confirmed, then canonical entry or actionable recovery. The error retains the enrollment reference and existing Retry/sign-in/support controls. Native checks must cover delayed fulfillment, successful handoff, failed readback/retry and sign-out during readback, plus the incumbent first-use, timeout and account-choice states. This is a public Welcome screen; PAIGE-open layout checks are not applicable.

The existing separate render harness is `scripts/live-drive/harness/mount`, excluded from the product build. The root's interview entry/config already aliases the Supabase client to a no-network adapter, but its existing interview fixture lacks the Auth/session, enrollment, profile/tenant and complete tenant-context APIs Welcome needs. Its plain Vite config's `http://harness.invalid` URL alone is not a no-network guarantee. A safe native follow-up must extend the existing harness adapter/entry to mount the actual Welcome screen and cover those states without importing the real Supabase client or exercising Auth/provider effects. No harness, render adapter or additional fixture account was created by this worker; preparation and native proof remain root-owned.

## Collision-safe Second Brain closeout handoff

Owner: Experience 01 root Journey Lead. Reason: shared Second Brain/Master files are reserved to root while foundation and admission work proceed separately; this worker must not edit those sections.

- Master §5, Experience 01 / ANT-50: add “The admission handoff repair refreshes the existing mounted TenantProvider after receipt-backed enrollment and requires committed provider/canonical scope agreement before SoloEntry. Local mounted-provider proof is separate from release and protected ordinary-customer acceptance.” Keep §4.0 Shipped Delivery Log **N/A** until merged; exact merge/release identity belongs to root closeout.
- `docs/brain/lessons-learned.md`: record that backend fulfillment can become true after initial browser context hydration without any Auth event; testing only mocked navigation missed the empty shared provider. Prove the actual provider-to-entry boundary and React commit ordering.
- Existing Brain README/domain record: link this bounded repair without creating another onboarding inventory or source-of-truth registry.

Root owns final fresh head/review/CI, rendered finish review and all release/QA coordination. The original interview → reviewed fact → canonical Setup save/readback → correction/resume foundation is unchanged.

Claim sweep: `Welcome`, `welcome`, `delayed fulfillment`, `delayed-fulfillment`, `pre-fulfillment`, and `workspace hydration` across `docs/brain` and Master. The decision-log search initially encountered a NUL byte, so it was repeated with `rg -a` and the remaining matches were assessed. Existing acquisition/current-shell claims remain PARTIAL/PROOF OWED; established login choice, transactional welcomes and Marketing series are separate preserved flows. The delayed shared-provider hydration mechanic was not recorded there, so the explicit root handoff above adds it without rewriting dated history. No secret value was written. No additional out-of-scope finding was discovered by this bounded repair.
