# INT-345 — Solo Shell Capability Parity / Workspace Bootstrap: First Return (Voice)

Program: INT-345 · GitHub #1815 · Lane: Solo Shell Capability Parity
Grounded main at assignment: `135e598381a5` · Re-grounded at implementation: `d1762a654cf9` (one commit ahead; ancestry verified)
Production evidence: read-only DB census 2026-10-07 (no writes, no provider reads beyond the platform's own database)
De-identification: workspaces appear only as structural aliases S01…S13. No tenant ids, account numbers, names, or phone numbers appear here or in the shipped fixtures.

---

## A — Current main

`d1762a654cf9` (= `135e598381a5` + INT-338 chat-attachments merge #1813). The canonical Solo shell mounts `VoiceDeviceProvider` (src/solo/SoloApp.tsx:387) with `DialPadSurface`/`IncomingCallOverlay`/`LiveTranscriptPanel`; `TenantCommandCenterShell` mounts the shared `DialPadTrigger` unconditionally (src/components/tenant-shell/TenantCommandCenterShell.tsx:597). The three observed screenshots are one shared UI behind three different server-side data states — confirmed.

## B — Current Solo shell ownership map (voice)

| Seam | Location | Owner |
|---|---|---|
| Dialer trigger | TenantCommandCenterShell.tsx:597 | Shell (presentation) |
| Dialer surface + states | src/components/admin/voice/DialPad.tsx:99-111 | Shell (presentation) |
| Device lifecycle | src/lib/voice/VoiceDeviceProvider.tsx | Shell runtime (this lane's fix) |
| Token mint + readiness | supabase/functions/voice-access-token (authorization.ts + index.ts) | Voice/Comms (capability owner) |
| Twilio seam | supabase/functions/_shared/twilio.ts (mint, ensureTwimlApp) | Voice/Comms |
| Subaccount producer | supabase/functions/provision-tenant-twilio (super-admin, zero code callers) | Voice/Comms + operator action |
| Number producers | comms-purchase-number (UI-reachable), import_tenant_phone_number (zero callers) | Voice/Comms |
| Solo tenant creation | provision_tenant / provision_tenant_as / operator_provision_tenant (zero comms references) | Tenant provisioning |

## C — Voice readiness state machine (as built)

Server-derived per caller: `current_user_tenant_id()` (JWT → profiles.active_tenant_id backed by active membership / agency-management / platform-admin act-as, else first active membership). Body values cannot name a tenant or identity (§9).

```
tenant_twilio_subaccounts (unique per tenant)
  ├─ absent / active=false / status≠active        → calling_not_configured
  └─ active+active
      └─ active primary tenant_phone_numbers (is_primary, status=active)
          ├─ 0 rows      → calling_number_needs_verification (no_active_primary_number)
          ├─ ≥2 rows     → calling_number_needs_verification (multiple_active_primary_numbers)
          └─ 1 row
              ├─ subaccount_id ≠ subaccount.id   → …(primary_number_under_different_subaccount)
              ├─ no twilio_sid                   → …(primary_number_missing_provider_binding)
              ├─ capabilities.voice ≠ true       → …(primary_number_voice_capability_unconfirmed)
              └─ all invariants                  → READY → mintVoiceAccessToken (lazy ensureTwimlApp)
```
The five parenthesized reason codes are NEW in this return's code slice (previously all five collapsed into one string). The platform-owner authority alternative (hasTenantVoiceAuthority) passes the 403 gate only; it never feeds readiness.

## D — Provisioning/bootstrap lifecycle (as built — the gap)

Intended chain: Solo creation → comms entitlement → subaccount → TwiML app → number acquisition → primary assignment → SID binding → voice capability → token → device → dialer.

Actual producers:

| Transition | Producer | Reachable by a customer? |
|---|---|---|
| Tenant creation → subaccount row | provision-tenant-twilio (super-admin JWT; operator curl; idempotent; adopt mode) | **NO — zero code callers** |
| Subaccount → TwiML app | ensureTwimlApp — from provisioning, internal repair, or lazily at token mint | n/a (automatic once subaccount+secret exist) |
| → number | comms-purchase-number (marketplace, priced, confirmed) — Settings → Communications; import_tenant_phone_number (zero callers) | Purchase: YES (once subaccount exists). Import: NO |
| Number → primary/SID/voice-capability | purchase writes sid+capabilities; set-primary via OwnedNumbers ("Send from this") | YES |
| → token → device → dialer | voice-access-token → VoiceDeviceProvider | YES |

Solo tenant-creation RPCs reference nothing comms/Twilio (verified across provision_tenant, provision_tenant_as, operator_provision_tenant, signup slices, solo-beta fulfillment). The lifecycle's first transition has no automatic producer by design ("NOT auto-provision-on-login", C-2 plan) — but also has no user-reachable producer.

## E — Exact root cause of the three observed states (production census, read-only)

13 standalone Solo workspaces:

| Alias | Created | Subaccount | Primary number invariant | Dialer state |
|---|---|---|---|---|
| S01 | 2026-07-09 | active, TwiML, API key | 1 primary, voice-capable, bound, matched | **READY** |
| S02 | 2026-07-09 | active, TwiML, API key | 0 primaries (never bought) | **NUMBER NEEDS VERIFICATION** |
| S03 | 2026-07-14 | active, TwiML, API key | 0 primaries (never bought) | **NUMBER NEEDS VERIFICATION** |
| S04–S13 | 2026-07-18 → 2026-10-06 | **no row at all** | — | **NOT CONFIGURED** (10 workspaces) |

- The owner's control workspace = an S01-class workspace: backfilled in the C-2 era, then bought 2 marketplace numbers (Jul 29/30) through the working purchase flow.
- The owner's comparison A = an S02/S03-class workspace: backfilled, never acquired a number. Its "needs verification" is truthfully "no calling number yet" — a reachable remedy exists (Settings → Communications) but the old copy never said so.
- The owner's comparison B = an S04+-class workspace: never backfilled. The remedy is an operator curl command — not reachable by any customer. Dead end.

**Root cause:** subaccount existence correlates with **account age** (pre-2026-07-18) because the one-shot manual backfill ran only on the C-2-era tenants. Under the owner's canonical Solo rule this is MISSING_BOOTSTRAP / forgotten manual setup — not an intentional boundary. The S02/S03 vs S01 difference is a legitimate opt-in paid purchase state wrapped in an unactionable message (a truthfulness defect, fixed in this return's slice).

## F — Legitimate variance vs defect

| Difference | Classification |
|---|---|
| S01 vs S02/S03 (number bought or not) | **LEGITIMATE_CONFIG_STATE** — deliberate tenant-initiated paid purchase; doctrine forbids auto-purchase (connections-rail-contract §5; §38 Paige-held rail) |
| S02/S03 message ("needs verification" for "no number yet") | **MISSING_USER_FLOW / truthfulness defect** — FIXED in this slice (five reason codes + recovery copy) |
| S01/S02/S03 vs S04–S13 (subaccount) | **MISSING_BOOTSTRAP** — no automatic producer AND no user-reachable producer; manual operator backfill covered only pre-2026-07-18 tenants |
| Bought numbers lacking inbound VoiceUrl | **PROVIDER_DEPENDENCY / BACKFILL_REQUIRED** — documented platform gap (comms-capability-map item 8, owner-authorization gated); outbound calling unaffected |
| Live Conversation availability | LEGITIMATE_ROLLOUT_STATE — platform-uniform (surface on, transport off, availability PROOF OWED) |
| Everything else in the shell census | UNIFORM — see J |

## G — Fresh-tenant path (today)

Create Solo → shell renders dialer → open → "Calling is not configured for this workspace." → Settings → Communications → "This business can't buy a number yet. … Once provisioning is complete…" → **dead end** (provisioning is operator-only). This is the P1 product gap. Proposed repair (owner-adjudicated slice K-1): a governed, idempotent "Set up calling" action in Settings → Communications that runs the existing provisioning core (reuse provision-tenant-twilio's logic as a governed seam — no second engine), after which today's purchase flow completes readiness. No shell-mount/signup auto-provisioning (doctrine-compliant: no silent provider action; the user acts first).

## H — Existing-tenant reconciliation/backfill path (proposed, bounded)

After the governed setup action ships: for the 10 subaccount-less workspaces, EITHER the owner flips each workspace's setup action himself (they are his accounts) OR a bounded idempotent backfill reuses provision-tenant-twilio as-is (it already skips existing rows and carries adopt mode). Numbers are NOT backfilled (paid, opt-in by doctrine). Provider mutations (10 subaccount creations — free but provider-side) require explicit authorization per the lane's cost/authority rules; the code is built and reviewed first, mutation second.

## I — Workspace-switch security proof (this return's code slice)

- Solo switch path already hard-reloads via /choose-account (safe by reload).
- The in-shell sub-account switch (AgencyApp.syncIntoChild, AgencyApp.tsx:441-452) previously kept the previous tenant's registered Device, caller identity and call state alive across an SPA-internal tenant switch. FIXED: VoiceDeviceProvider now tears down the Device, live/ringing call, grace-held transcript topic and cached state on active-tenant change, resets to idle, and destroys a Device whose boot completed after the switch (mid-boot race). Proven by 4 harness tests against the real provider (switch teardown + fresh re-mint; mid-boot race — mutation-proven load-bearing; mid-call switch; no-switch control).
- Platform-owner widening: authority (403 gate) and readiness are independent; readiness queries are tenant-scoped by the JWT-derived tenantId; the classifier never receives caller standing. Pinned by behavioral + source-composition tests. An operator acting in an unconfigured workspace still gets calling_not_configured.

## J — Bounded shared-shell capability parity matrix

| Capability | Canonical owner | Frontend seam | Backend/readiness seam | Expected default (eligible Solo) | Legitimate variance | Fresh-workspace producer | Existing/backfill producer | Current state |
|---|---|---|---|---|---|---|---|---|
| PAIGE Chat mount | Chat/Spine | SoloApp.tsx:372 → shell rail | paige-ai-chat | mounted, ungated | beta-entitlement marking only | signup/provisioning | n/a | LIVE (uniform) |
| Live Conversation entry | Voice (conversation lane) | PaigeAIChat.tsx:2714 | paige_live_pilot_authorized_internal + tier feature | tier allows; platform-uniform switch-off row | deliberate operator switch-off | tier map | n/a | PARTIAL (platform-uniform: surface on / transport off) |
| Browser calling/dialer | Voice/Comms | DialPadTrigger shell:597 | voice-access-token + provider rows | UI mounted everywhere; readiness = config | number purchase (opt-in, paid); provider state | **GAP (G)** | **GAP (H)** | PARTIAL + BOOTSTRAP_GAP (subaccount) — reason fidelity now exact |
| Header commands | Shell | shell:588-599 | structural route registry | uniform | none (structural) | route registry | n/a | LIVE (uniform) |
| Workspace switch | Shell | WorkspaceExitControl | profiles.active_tenant_id + memberships | uniform per user | user's own memberships | n/a | n/a | LIVE (voice tenant-scope NOW sealed) |
| Knowledge reachability | Knowledge | SoloPaigeWorkspace tab | useSoloKnowledge (tenant-scoped) | uniform surface | content (tenant data) | provisioning | n/a | LIVE (surface uniform) |
| Settings/Connections | Shell/Settings | SoloSettings tabs | settings registry + access RPCs | uniform | Vault access RPC (deliberate); role for setup editing | provisioning | n/a | LIVE (mostly uniform; Vault deliberate) |
| Notification/attention surface | Shell | none (retired #883/#896) | approvals queue (data) | absent by design | none | n/a | n/a | UNAVAILABLE (uniform, deliberate) |
| PAIGE rail/panel | Shell | shell:604-619 | none | uniform | none | provisioning | n/a | LIVE (uniform) |
| Landing | Shell | CommandHub → Business Game Plan | defaultBranchSlug | uniform | none | provisioning | n/a | LIVE (uniform) |
| Capability/readiness indicators | Systems Check lane | CommandCenter tab | paige_systems_check_registry | uniform surface; readings = tenant data | readings (the point of the surface) | provisioning | n/a | PARTIAL (surface uniform) |
| Tier features | Platform | tierFeatures.ts | account_type/parent only | identical for all standalone | none possible from baseline | provisioning | n/a | LIVE (cannot differ) |

Records correction found: solo-completion-matrix.json `paige.live-conversation` says UNAVAILABLE but the pilot ceremony was removed 2026-09-24 (migration 20270425000000) — stale row, flagged to its owning lane, not silently absorbed.

## K — Proposed implementation slices

1. **SHIPPED IN THIS RETURN** — Readiness reason fidelity (edge + tests): five distinct reason codes with recovery copy; `calling_not_configured` message byte-identical (no fabricated path while none is reachable).
2. **SHIPPED IN THIS RETURN** — Workspace-scope Device teardown + mid-boot guard + mid-call switch teardown (harness-proven, mutation-proven).
3. **PROPOSED, owner-adjudicated** — Governed "Set up calling" action (Settings → Communications) running the existing idempotent provisioning core as a governed seam; kills the dead end for every current and future Solo without shell-mount/signup auto-provisioning. Requires: product-intent confirmation (opt-in-on-user-action recommended), then bounded provider-mutation authorization for live execution.
4. **PROPOSED, owner-adjudicated** — One-time reconciliation backfill of the 10 subaccount-less workspaces (idempotent, adopt-capable, no numbers) — provider mutation, separately authorized.
5. **PROPOSED** — Settings dead-end copy ("Once provisioning is complete…") reworded to the governed action's copy once K-3 exists; VoiceUrl stamping for inbound calling (comms-capability-map item 8) stays with the Voice lane's owner-gated list.
6. **PROPOSED (records)** — live-conversation matrix row refresh by its owning lane.

## L — Provider/production mutations requiring separate authority

- K-3 live execution: creates Twilio subaccounts (free, but provider-side) per workspace at user action — code first, then authorization.
- K-4 backfill: same, for 10 existing workspaces.
- Number purchases: never backfilled (paid, opt-in by doctrine).
- No production mutation was performed in this return. All database access was read-only; no Twilio API was called.

---

## Code slice shipped with this return

Branch `int345-solo-capability-parity` off `d1762a654cf9`. Files: supabase/functions/voice-access-token/{authorization.ts,index.ts}; src/lib/voice/VoiceDeviceProvider.tsx; src/lib/voice/voiceAccessAuthorization.test.ts; src/lib/voice/voiceDeviceTenantScope.test.tsx (new). Evidence record: docs/evidence/ui-delivery/solo-voice-readiness-parity.md (validator PASS). Gates: voice family 32/32 (failing-first + boot-guard mutation proven), tenant-shell 132/132, tsc ratchet 0, Deno check clean, eslint clean, ui-delivery-evidence PASS.
