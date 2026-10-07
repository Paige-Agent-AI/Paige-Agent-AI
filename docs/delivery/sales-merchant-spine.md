# Solo merchant connections — bounded repair

Owner outcome: a human can find customer-payment connections in Settings → Integrations, and PAIGE can invoke the same tenant-scoped governed setup/readback capabilities. This is one Solo implementation for existing and future tenants.

## Pre-edit routing and affected flow

1. **Domain:** Sales/Payments merchant binding, surfaced by Integrations. Platform billing is separate. No account-specific product logic.
2. **Harness/Gateway:** existing authenticated domain door, CapabilityKit admission, canonical Trust and C4b approval continuation. No new runtime or continuation store.
3. **Spine:** existing `integrations.list` / `integrations.health` are channel reads, not merchant setup. Merchant setup is currently UNAVAILABLE as a declared PAIGE capability. This slice adds exact declarations only alongside their real adapters/callers.
4. **Provider:** existing `tenant-stripe-connect` and `tenant_stripe_accounts`; Stripe direct-charge payment substrate remains unchanged. PayPal currently has readback groundwork, but no seller connection contract. Integration Registry must retain that distinction.
5. **Authority:** hosted setup/login is a high external effect, admitted by shared CapabilityKit, current tool autonomy and single-use `paige_pending_confirmations`. Scoped status is a read; explicit refresh is GET-only reconciliation. No reusable package approval.
6. **Durability:** reuse merchant onboarding reservation/claim and canonical operation identity. No scheduler or second provider gateway. Unknown pending setup never authorizes a new provider POST.
7. **Proof:** provider GET plus tenant/account/environment/version validation; CAS and existing Rail receipt persistence. A hosted URL or redirect is not readiness, settlement or allocation.
8. **Surface:** `settings.integrations`, currently PARTIAL, retains the existing drawer and design tokens. Add exact approval review inside the drawer; PAIGE consumes the same domain door. No replacement Sales workspace.
9. **Acceptance:** manual and PAIGE admission parity; actor/tenant/environment/version drift; stale/replayed approval; duplicate dispatch; close/switch recovery; closed payloads; keyboard and four viewport geometry. Authenticated merchant setup and real TEST payment remain UNVERIFIED until exercised.
10. **Boundaries:** INT-335 package composition and shared C4 ownership remain unchanged. No PAN/CVV, secrets, hosted credential URLs or full provider errors enter model/Rail. Root testing performs no LIVE provider POST.

Flow: human/PAIGE intent → server tenant/member resolution → canonical merchant/configuration read → exact setup proposal → shared Trust/single-use approval → existing provider adapter → safe hosted human handoff → provider GET → binding/readiness CAS + Rail → UI/PAIGE read the same state. An uncertain dispatch branches to GET-only reconciliation; no blind account recreation.

The owner-reproduced LIVE pending reservation has no trustworthy historical provider-error classification. Preserve it. New safe diagnostic categories may explain configuration failure without retroactively proving provider absence.

## Design and regression contract

Flow-by-Flow applied. Impeccable Operate/craft-floor applied ([skill](https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md)). Retain incumbent Finance tiles and contextual drawer; use an inline exact review rather than a second popup. TEST/LIVE remains prominent. Buttons name the consequence and no setup state implies money received. PayPal visibility must not fabricate connection availability.

Protected: invoice publication/PDF/email; canonical balances and manual/provider evidence classes; direct charges/zero application fee; Settings Billing; shared Chat routing/C4; other Integrations providers. Reuse existing actor/workspace response fences and decline all stale approval inputs.

Owner authorization covers implementation/review/merge/deploy of this bounded flow. External platform registration, partner approval or unavailable secure configuration remains an explicit external dependency; no agent fabricates or performs that legal/account step.

## Evidence

Implementation, automated, rendered, exact-head review, merged, deployed and authenticated acceptance are recorded separately in the UI evidence and PR. No completion or provider-readiness claim is made by this work packet.

Catalogue repair: migration 20270601000007 extends the existing list_tool_autonomy function with the two merchant actions, preserving prior admission and settings. No new table or authority store. Receipt-coverage declarations bind both actions to existing canonical recordCapabilityRun. Required CI and independent exact-head review remain release gates.
