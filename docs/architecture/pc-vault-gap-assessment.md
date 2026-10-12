# PAIGE Computer — Vault / Connections Gap Assessment (PC-0 audit, PC-2 planning)

Date: 2026-10-11 · Basis: origin/main `a094a618b` + production read-only readback · Status: AUDIT ONLY — nothing here is implemented, wired, or activated.

## What exists today (reusable primitives — do NOT rebuild)

| Primitive | Evidence | PC-2 reuse verdict |
|---|---|---|
| Encrypted token columns (`*_ct bytea` via `platform_encrypt`/`platform_decrypt`, SECURITY DEFINER, service-role-only, key `platform_column_key` in `_internal_secrets`) | migrations `20260702022450`, adopters: quickbooks_connections, staff_calendar_settings (Google/Apple), connected_bank_account_secrets (Plaid), tenant_n8n_connections, tenant_mcp_connections (with `auth_token_last4` display hint), tenant_zapier_api_connections; column-level `REVOKE SELECT` hardening in `20260703033054`/`20260703153924` | The canonical storage pattern for ANY PC-2 browser-session/credential reference. Hash-not-store precedent: `paige_mcp_oauth_tokens` keeps `access_token_hash` only |
| Business Vault (document quarantine) | edge `business-vault-upload/download/reconcile`: 15MB cap, magic-byte MIME allowlist, origin allowlist, secret-pattern redaction on ingest, reservation rows + stale-upload reclaim; bucket `business-vault-files` | The quarantine home for browser DOWNLOADS (handoff step A7). No code exists there for downloads — the intake seam `secure_browser_refuse_download_intake` / `secure_browser_download_guard` RPCs already refuse by design |
| Session control plane | prod tables `secure_browser_sessions` (lifecycle state machine, authority_state, idempotency_key, reserved/consumed seconds + microusd, expires/paused/closed/revoked) + `secure_browser_tenant_limits` (enabled, max_active_sessions=1, 900s/1800s daily, monthly cost microusd, revision) + 8 guard/settle RPCs — ALL verified applied on production 2026-10-11 | Exactly the PC-2 session envelope (reserve → guard → settle; pause/close/revoke). Zero rows, zero tenants flagged — dormant by design |
| Safe-text discipline | `_secure_browser_safe_text` rejects credential/bearer/JWT-shaped text; PC-1 adds `redactUrlForAudit` + `scrubSecretLikeText` at the browse rail/model fold | The invariant set every PC-2 surface must preserve: no passwords, raw card data, CVVs, session cookies, or privileged tokens in prompts, transcripts, screenshots, artifacts, logs, or evidence |
| Custody model ruling (owner, 2026-09-07 audit §1A) | Owner-direct login + provider-held persistent session; Paige never sees the password; §34: tenant session tokens flow only through the SELF-OWNED Fly host, never a third party | Binding architectural decision for PC-2 supervised login |

## Gaps that PC-2 must build (none exist today)

1. **Browser session/credential reference store** — no table holds a browser-session handle or delegated-credential reference; the `*_ct` pattern + last4 hints is the template, custody stays provider/owner-side.
2. **Login/MFA handoff surface** — no owner-visible live browser window, no MFA relay, no "take control" pause/resume UI (prototype states exist in `docs/prototypes/paige-secure-browser-mvp-flow.md` only).
3. **Session expiry/refresh + global emergency stop** — audit §2.1: revocation is PARTIAL; no single control spans connections AND in-flight actions.
4. **Scoped-access grants per destination origin** — the `secure_browser_sessions.allowed_scope` column exists but nothing populates per-site scopes from a real connection record.
5. **Checkout/payment handoff** — nothing exists; §38 ruling: money moves on the TENANT'S own connected rails, Paige is never merchant of record.
6. **Authoritative completion receipts for filings** — Rail summary exists (`record_capability_run`); the detailed durable action receipt (exact action/target/amount, grant id, provider result, verified readback, idempotency key) is designed (handoff §B2) but unbuilt.

## Standing prohibitions carried into PC-2

Browserbase gates (7, all open) unchanged; no credentialed browser operation may ship without its own staged engineering + security + design + effectful-acceptance gates; secrets never enter model-visible surfaces (enforced from PC-1 by the scrubber + rail redaction + `_secure_browser_safe_text`).
