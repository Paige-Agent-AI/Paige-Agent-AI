# The canonical Solo shell contract

**Owner-ruled 2026-09-02.** One canonical Solo shell serves every current and future Solo
tenant. This file is the single door to that contract. It does **not** restate the rules that
already have executable homes — it names them, so a future agent finds enforcement rather than
prose, and so nothing here can drift out of step with the code it describes.

**INT-340 owner ruling, 2026-10-07:** retire the visible top-level Solo Analytics
destination. Settings order is Setup, Team, Connections, Integrations, Analytics,
Security & data, Vault, Billing. Analytics uses the canonical Settings host and its
authorized visible-scroll contract. Operator and other-tier Analytics remain separate.

## The rule

> A Solo tenant may differ in business identity and data, members, roles, permissions,
> entitlements, proven provider connections, and everything they own. Those differences arrive
> through tenant-safe, server-resolved data and authorization contracts. **They never produce a
> different application shell, layout, navigation system, responsive behaviour, page host, or
> PAIGE workspace.**

Classify before changing anything:

| Class | What it covers | Where the change goes |
|---|---|---|
| **1 — Shared Solo shell** | Routing, navigation, page host, shell geometry, responsive layout, Settings container, PAIGE rail/workspace, shared UI behaviour | The canonical owner, so every Solo tenant receives it |
| **2 — Tenant context** | Identity, plan, member permissions, capability truth, business data | Server-proven data and permission gates. Never a shell fork |
| **3 — Tenant-owned domain behaviour** | Setup, Team, Connections, Integrations, Clients, Campaigns, Pipeline, Billing, PAIGE behaviour | Inside its owning domain contract, canonical shell preserved |

**Never** branch on a tenant/account number, tenant name, fixture, demo state, or URL value to
alter shell or layout behaviour. **Never** patch only the account where a bug was observed when
the defect belongs to the shared shell.

## Every current and future SOLO account — delivery standard

**Owner clarification, 2026-10-15:** the shared SOLO product is the delivery audience. Reference accounts are test cases. A repair must reach all equivalently eligible accounts through the shared source and supported account-creation contract; no customer must receive a private copy of the shell, Chat tools or permission logic.

1. **Ground eligibility on the server.** Establish business classification, active workspace/membership, role, entitlement, rollout class and actual connection readiness. A display name, email, title, navigation link or URL is not authority. Different business records remain isolated.
2. **Change the shared implementation.** Use the existing route host, tier-feature helper, Spine registration, Harness/Trust approval and authoritative domain writer. Chat and Live consume the same governed action. A capability listed in a registry is not proof that a customer can execute it.
3. **Provision from one contract.** Existing producers call `assert_canonical_solo_tenant`: standalone/no parent, valid account address, active owner membership and a feature-support row. Source wiring lives in `src/__tests__/canonical-provisioning-contract.test.ts`; replayed-schema behavior lives in `supabase/tests/canonical_solo_provisioning.sql`. Preserve the producers' real authorization and legal/paid-enrollment requirements. Do not create production QA accounts to prove this standard.
4. **Migrate existing accounts compatibly.** Read back the same structural facts across the existing eligible class. Establish migration order, rollout/backfill scope and compatibility with old/new callers and standard future provisioning. Use the existing protected replay and domain suites to test existing records as well as new-account behavior. Investigate legacy or incomplete records separately. Correct proven shared data drift through a reviewed, authorized class-wide domain change; no ad hoc per-customer SQL or manufactured ownership, entitlements, provider connections or customer data. A correct new-account path does not establish that older records satisfy it.
5. **Retain legitimate differences.** Verified subscription/entitlement, role, approved rollout, tenant preference, provider connection and explicitly authorized master-tenant privilege differences use the canonical server contracts with exact availability/denial reasons. Equal inputs produce equivalent outcomes. No parity repair mass-enables restricted features, paid providers or unsafe legacy execution.
6. **Prove generality before release.** Run the existing parity guard and its identity-drift mutants, canonical provisioning tests, affected domain tests and required exact-head CI. Use neutral synthetic identities for source tests and at least two distinct legitimate SOLO cohorts using existing ordinary authorized accounts for customer QA. Two account passes are bounded evidence, not the definition of release scope or proof of every customer. Test fail-closed tenant/role/RLS negatives, stored approvals, durable records, truthful receipts and recovery where relevant.
7. **Close the whole affected class.** Extend every entry in the existing 50-row parity and 18-capability restoration evidence with product-wide applicability, legitimate configuration differences, tenant isolation and new-account behavior. Record shared source, Independent Review, CI, merge/deployment, migration/configuration dependencies and authenticated acceptance separately in the existing issue/register and Master shipped log. Keep unresolved eligibility classes and missing evidence explicit; owner final acceptance remains required. This implements the October 15 permanent coverage directive recorded in ANT-21 and ANT-147 without changing security or release gates.

This extends the existing contract; it creates no second provisioning, capability, permission, account or release registry. Static guards cover named source boundaries and accidental drift, not every possible backend defect. Runtime/domain checks and ordinary authenticated evidence remain required.

## Where the shell actually is

| Thing | File | Note |
|---|---|---|
| The Solo shell | `src/solo/SoloApp.tsx` | The one route host and screen composition |
| The shared chrome | `src/components/tenant-shell/TenantCommandCenterShell.tsx` | PAIGE rail, brand home, contextual navigation |
| The one screen host | `<main data-solo-screen-host>` in `SoloApp.tsx` | Exactly one, and only `SoloApp` renders it |
| Route → label | `src/lib/routing/tierBranches.ts` | Solo `growth` is labelled **Campaigns** |

### Address is not authority

`account_number` is an **address**: the URL segment and the brand-home link. Authority is
`activeTenant` from `useTenantContext()`, and every read is gated server-side (§9). `SoloApp`
redirects a URL naming an account that is not the caller's own back to theirs — the URL is
never trusted, it is corrected. An `account_number` in a `navigate()` and one in a style
ternary read almost identically in a diff, and only the second forks the product.

## Interaction policy — enforced by CSS, not by the route list

The form-fitting rule is **not** the `full` const in `SoloApp.tsx`. Enforcement is the blanket
clip `.paige-solo main{overflow:hidden!important}` in `src/solo/solo-tokens.css`, plus exactly
one scoped exception that must carry **both** `[data-solo-screen-host]` and
`.tcs-main--settings-scrollbar-hidden`. Anything that re-opens the host without both qualifiers
un-clips Clients, Campaigns and Compass too — which is precisely how it broke once before.

| Surface | Policy |
|---|---|
| Settings → **Setup**, Connections (incl. Calendars), Integrations, Analytics | Visible scrolling, with the bar drawn |
| Settings → Team, Security & data, Vault, Billing | Form-fitting — they genuinely fit their host |
| Command Center, Clients, Campaigns/Growth, Compass, Mind | Form-fitting, design-locked. Owner authorization required to change |

This row used to read *"Settings, Connections, Integrations — visible scrolling where
needed"*, which was true of no Settings destination but two: the class that DRAWS the bar was
applied only to `connections` and `integrations`, so **Setup rendered 3,973–4,174px into a
702–934px host with no scrollbar in either lane** — 78–82% below the fold, at every supported
viewport. Owner ruling 2026-09-02 authorized Setup, and the enumeration above is now exact
rather than approximate. **Which destinations qualify is a product decision requiring an owner
ruling, not a repair**; the list lives in `SETTINGS_VISIBLE_SCROLL_DESTINATIONS`
(`src/components/tenant-shell/settings-scroll-contract.ts`) and fails closed for anything
unrecognised.

## What already enforces this — do not build a second home

| Rule | Enforced by |
|---|---|
| Locked surfaces stay form-fitting; the Settings exception cannot widen silently | `src/solo/settings.scroll-policy.test.tsx` |
| Which Settings destinations draw the bar, and that the drive agrees with the product | `SETTINGS_VISIBLE_SCROLL_DESTINATIONS` + `src/solo/settings.scroll-policy.test.tsx` |
| One shell, one screen host, no tenant identity in layout | `src/solo/soloShell.contract.test.tsx` |
| Shell owns one PAIGE surface, brand home, Settings focus restore | `src/components/tenant-shell/TenantCommandCenterShell.ownership.test.tsx` |
| Rendered geometry on locked surfaces, four viewports | `scripts/live-drive/solo-locked-surfaces-drive.mjs` |
| Settings reachability and scroll behaviour | `scripts/live-drive/settings-scroll-drive.mjs` |
| Settings release discipline and proof ladder | `docs/brain/solo-settings-scroll-and-release-playbook.md` |
| Route naming and per-tier URL shape | `docs/doctrine/route-and-url-taxonomy.md` |
| Identity drift in SOLO routes, shared chrome and tier/entry seams; nav/tier snapshot | `scripts/ci/solo-parity-guard.mjs` and its mutated fixture controls; bounded static coverage |
| Canonical structure on every supported new SOLO producer | `assert_canonical_solo_tenant`, source wiring test and replayed-schema pgTAP suite named above |

## Proof required for any Solo UI repair or feature

Test the affected Solo tenant **and at least one known-good, different Solo tenant**, at
1536×770, 1366×768, 1024×768 and 900×1000, with PAIGE both closed and open. Verify real
rendered width, overflow, reachability, keyboard/wheel behaviour where scrolling is allowed,
and that no tenant-specific shell path remains.

Separate the evidence classes every time — automated test · static/build · structural or
harness render · authenticated runtime on the real platform · `UNVERIFIED` with its reason. A
harness drive against a reproduced shell is the third class and is never the fourth.

## Known coverage gaps (§13 — stated, not papered over)

- `solo-locked-surfaces-drive.mjs` drives `clients`, `growth` and `compass`. **Command Center
  (`home`) and Mind are named by the policy but are not in that drive's surface
  list.** Their form-fitting behaviour rests on the CSS clip and its source-contract test, not
  on a rendered-geometry drive.
- The actual `SoloApp` wrapper, Shift+Space and independent per-surface Home-key pathways
  remain unproven — see the Settings playbook's proof-ladder section.
- No authenticated production drive of any Solo surface has been run from this environment.

## How a future agent encounters this

`docs/brain/README.md` indexes it, so the mandatory second-brain read reaches it. The Settings
playbook links here for shell-wide questions. `soloShell.contract.test.tsx` names this file in
its header, so anyone who breaks the guard is pointed at the contract they broke.
