# PC-1 §32.c Authenticated Acceptance Package — one isolated synthetic SOLO tenant

Date: 2026-10-12 · Status: PREPARED, NOT EXECUTED. Every action in "Preflight" is owner-controlled; nothing below has been performed. The drive is the §32.c proof owed since 2026-08-16 (DONE.md row 11).

## Scope and safety envelope

- **Test identity (canonical, per the owner's ANT-21 universal-reuse rule — do NOT create others):** the ONE shared synthetic SOLO account provisioned 2026-10-12 through the canonical `provision_tenant_as` seam (subscriber agreement `saas-standalone` v1): **auth user `0640f8f9-30a7-49c7-ac4e-53f68b77381d` · tenant/workspace `bcefc207-4ac6-42af-83b8-3abe3e897649`** (slug `pc-1-qa-shared-synthetic`, standalone, active, owner role, account 5959067, `features = {}` — browse correctly inert). Nonsecret identifiers only; its credential is vault-discipline (never in chat/Linear/Drive). Isolation negative-controls that would need a SECOND tenant must first check ANT-21 for a separately authorized existing workspace — none may be created ad hoc.
- No credentialed browsing, no filing, no payment, no site login — the drive exercises the READ-ONLY public browse path only.
- Safe test destination: a **purpose-owned, low-risk public origin** — recommended `https://example.com` (static, no auth, no PII) or a Paige-owned public page. The Fly guard additionally allows `*.paigeagent.ai` targets regardless of the wildcard flag (§58), so a self-target drive is available WITHOUT the wildcard flip; an external-target drive requires it (choose per the goal of the drive).
- Blast radius: per-request isolated context (cookies/localStorage die with the context — proven); worst-case budget exposure per call = 61s reserved from the tenant's day window, settled to actual on completion.

## Owner-controlled preflight (in order; all currently OFF/absent)

1. **Fly flag**: set `PAIGE_BROWSER_WILDCARD_ENABLED=true` on the `paige-browser` Fly app (owner action in Fly; triggers a redeploy of the live host — `/pdf`,`/render` consumers unaffected by the flag; verify `healthz` 200 after).
2. **Tenant flag**: set `features.secure_browser=true` on tenant `bcefc207-4ac6-42af-83b8-3abe3e897649` (owner/platform-operator console or SQL).
3. **Limits row**: call `configure_secure_browser_limits(expected_tenant, enabled:=true, 1, 900, 1800, 0)` from the tenant's workspace-admin context (note: 60s minimum validation on session seconds; the browse gate itself reserves 61s per call — `max_session_seconds` ≥ 61 required, 900 default satisfies).
4. **Run the drive** (owner-initiated, authenticated as the synthetic tenant's owner user): `run_skill browse_public_url` with `inputs.url = https://example.com`.
5. **Negative controls** (same session): (a) second drive to the same URL — assert no first-drive cookies/storage visible (isolation); (b) a drive while the limits row is `enabled=false` — assert refusal `control_plane:disabled`; (c) an unauthenticated direct POST to `skill-runner` — assert 401.

## Expected receipts — exact verification queries (read-only psql; substitute the tenant uuid)

```sql
-- 1) the audit rail row: ONE row per call, URL redacted (scheme+host+path only), honest reason
SELECT called_at, url_requested, blocked_reason, http_status, content_bytes, response_time_ms
FROM paige_browser_usage WHERE tenant_id = '<TENANT>' ORDER BY called_at DESC LIMIT 5;
-- expect: url_requested like 'https://example.com/%' with NO query/fragment; blocked_reason NULL on success.

-- 2) the capability receipt: record_capability_run files onto the workspace Rail
--    (paige_workspace_events — resolver-guarded for browsers; owner-side psql/service reads it).
--    Inspect the exact rail columns first (\d paige_workspace_events), then e.g.:
SELECT * FROM paige_workspace_events WHERE tenant_id = '<TENANT>' ORDER BY created_at DESC LIMIT 5;
-- expect: one capability-run event per drive — outcome 'capability_succeeded' on a good drive,
-- 'capability_refused' on the disabled/flag-off negative controls.
-- 3) the usage window: reserved released, consumed = actual seconds
SELECT window_kind, window_start, reserved_seconds, consumed_seconds
FROM secure_browser_usage_windows WHERE tenant_id='<TENANT>';
-- expect: reserved_seconds = 0 after settle; consumed_seconds > 0 and << 61 per call.
```

(If the receipt table name differs in prod, the authoritative check is `record_capability_run`'s Rail output via the workspace Rail view — the drive report on #2003 should paste whichever query was actually run.)

## Expected negative outcomes (fail-closed proofs)

| Control | Expected result |
|---|---|
| Tenant WITHOUT flag, drive attempted | no dispatch; rail row `blocked_reason='control_plane:feature_disabled'`; receipt `capability_refused` |
| Limits row missing | `control_plane:not_configured` (fail closed) |
| Limits disabled mid-test | `control_plane:disabled` |
| URL with query string (`example.com/?token=x`) | rail stores `?_redacted=1`; the model fold shows the same redacted shape |
| URL with a token-shaped path segment | rail stores `[token]` for that segment |
| Unauthenticated edge POST / bad secret to Fly | 401s on both (unchanged pre-existing gates) |

## Restoration / disable procedure (owner, any time)

1. `configure_secure_browser_limits(..., enabled:=false)` (instant block for the tenant — the gate fails closed).
2. Remove `features.secure_browser` from the tenant (or set false).
3. Set `PAIGE_BROWSER_WILDCARD_ENABLED=false` (or remove) on Fly + verify `healthz` — external browsing dead; `/pdf`,`/render` unaffected.
4. (Optional evidence hygiene) leave `paige_browser_usage` rows in place — the rail is append-only by design; redaction guarantees they carry no secrets.

## Completion criteria for §32.c

All positive receipts verified by the owner (rail row + capability receipt + settled window), both negative isolation controls behaved as expected, `/pdf` + `/render` probes still 401/200 respectively, and the owner records acceptance on #2003. Until then the capability remains honestly inert: zero tenants flagged, wildcard off, and every gate fail-closed.
