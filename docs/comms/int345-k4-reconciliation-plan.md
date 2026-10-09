# INT-345 K-4 — Existing-workspace calling reconciliation: DRY-RUN & RECOVERY PLAN (NOT EXECUTED)

Status: PLAN ONLY. No live Twilio creation, no production backfill, no number purchases have been or will be performed without explicit owner authorization. Everything below is preparable and provable without touching provider state.

## 1. The affected population (read-only census, 2026-10-07)

13 standalone Solo workspaces in production. 3 already have active subaccounts (S01 READY; S02/S03 awaiting a number the owner can buy). **S04–S13 (10 workspaces, all created ≥ 2026-07-18) have no `tenant_twilio_subaccounts` row** — the population for reconciliation. De-identified aliases only (S01…S13); the identifying list stays out of repo artifacts (the coordinator can re-derive it from the census queries in the INT-345 session log).

## 2. Detection & adoption (before creating anything)

For each target workspace, the plan runs DETECTION FIRST — an existing provider resource must be ADOPTED, never duplicated:
1. `tenant_twilio_subaccounts` row exists? → skip (idempotent no-op).
2. Twilio console already holds a subaccount whose friendly name matches the provisioner's convention (`Paige — ${tenant name}` / `Paige tenant ${tenantId}` — supabase/functions/provision-tenant-twilio/index.ts)? → adopt via the EXISTING `adopt` map in `provision-tenant-twilio` (confirm the exact live friendly names against the three existing rows before relying on the pattern).
3. Neither → create (the only genuinely new provider state).

Detection is read-only against Twilio (list-subaccounts) — read authorization is covered by normal engineering authority; it has NOT been run.

## 3. Execution shape (when authorized)

Reuse `provision-tenant-twilio` AS-IS: super-admin JWT, `dry_run` first, per-tenant `tenant_ids` allowlist, one batch per run. It already: creates subaccount → mints subaccount API key → vaults the secret (`write_channel_secret`) → inserts the 1-per-tenant row (unique-violation ⇒ `skipped_existing`) → ensures the TwiML app (non-fatal). Numbers are NEVER backfilled (paid, opt-in — the owner instruction).

- **Batch 1 = dry_run over all 10** → expect: 10 targets, 0 existing rows, 0 adoptions.
- **Batch 2 = dry_run after a manual console audit** → confirm adoption candidates = 0.
- **Batch 3+ = live, in slices of ≤3 tenants** with a readback between slices.

## 4. Idempotency & recovery

| Interruption point | State on disk/provider | Re-run behavior |
|---|---|---|
| after subaccount create, before API key | orphan subaccount at Twilio, no row | detection adopts it (friendly-name match); key minted fresh |
| after key mint, before Vault write | orphan key on the subaccount | key re-minted; orphan key harmless (unused; rotate if flagged) |
| after Vault write, before row insert | secret vaulted, no row | re-run writes the row; unique key = the same SID |
| after row insert, before TwiML ensure | row active, no twiml_app_sid | existing lazy `ensureTwimlApp` at first token mint completes it |
| TwiML ensure failed (non-fatal) | row active, app missing | repair-voice-twiml-app internal scope, or lazy ensure |

Every step is resumable; no slice can leave a state a re-run cannot classify. The unique constraint on `(tenant_id)` plus the global unique `twilio_subaccount_sid` make double-provisioning structurally impossible.

## 5. Authorization & readback protocol

1. Owner authorization names: the exact tenant set (or "all 10 census tenants"), the provider actions (subaccount + API key + TwiML app — all free-tier), and a spend ceiling (expected $0; subaccounts and TwiML apps carry no recurring fee).
2. Slice execution log retained per tenant: created/adopted/skipped verdicts + row readback.
3. **Authoritative readback after each slice:** DB row exists, `status='active'`, `active=true`, `api_key_sid` present, Vault secret readable-by-name (never by value), `twiml_app_sid` present-or-pending; plus the caller-visible outcome — `voice-access-token` for that tenant flips from `calling_not_configured` to `calling_number_needs_verification` (the honest "no number yet" state with the Send-from-this copy). That flip is the end-to-end proof reconciliation worked; READY remains the owner's paid choice.
4. Rollback: none needed beyond not-running the next slice — a created subaccount with no number accrues nothing; a wrongly-adopted row can be de-activated by platform owner action (recorded, not silent).

## 6. What is deliberately out of scope

Number purchases (opt-in paid), primary selection (user's "Send from this"), inbound VoiceUrl stamping (Voice-lane owner-gated item 8), A2P/TrustHub (its own lane), and any change to the READY contract itself.

---

## PROCEDURE ADDENDUM (post-authorization, 2026-10-08)

Authorized: the exact ten-workspace standalone census ONLY (revalidated 2026-10-08 read-only: 10 subaccount-less standalones, unchanged; the unprovisioned agency/sub_account rows are OUTSIDE scope and untouched).

Tooling shipped with K-3: `twilio-inspect-subaccounts` (super-admin gated, READ-ONLY) — provider-side inventory cross-checked against DB rows; unmatched = orphan candidates for ADOPTION before any creation. This is the "independently inspect Twilio's actual existing subaccounts" step as a first-class operation.

Execution mechanics (for the procedure review): the privileged operator runs `provision-tenant-twilio` (super-admin JWT) with `dry_run:true` + the explicit `tenant_ids` allowlist, then live batches of ≤3 with the readback below after each batch. Expected spend $0; any charge or identity uncertainty stops that operation specifically. Readback per tenant: row exists (status/active/api_key_sid/vault-ref-by-name/twiml_app_sid or pending), `twilio-inspect-subaccounts` shows the binding matched, and the caller-visible flip: `tenant_comms_readiness().calling` from `calling_not_configured` → `calling_number_needs_verification` with reason `no_active_primary_number` (the honest "buy + Send from this next" state). Numbers are NEVER purchased or selected by the reconciliation.
