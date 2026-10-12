# PC Flagship Prototype — Business Annual Report on the Official Government Portal

Date: 2026-10-11 · Status: PROTOTYPE CONTRACT ONLY — no live filing, payment, login, or unrestricted browsing is authorized. Extends the state vocabulary reserved by `docs/prototypes/paige-secure-browser-mvp-flow.md` (`proposed → awaiting_confirmation → executing → verifying → succeeded/failed/outcome_unknown/refused`).

## Flow (the owner's target customer experience, verbatim)

1. **INSTRUCT** — owner asks Paige to prepare the annual report. Paige resolves the entity (tenant records), the filing year, and the CORRECT official portal (jurisdiction-pinned destination; never a search-result guess).
2. **OPEN** — a governed secure-browser session opens the portal (PC-2 session envelope: reserve → guard → settle; per-request isolated context; connect-time egress control; redacted rail).
3. **AUTHENTICATE** — the OWNER logs in (owner-direct custody; MFA handoff where the portal requires it). Paige never sees, stores, or proxies the password; the session reference is opaque (Vault `*_ct` pattern).
4. **PREPARE** — Paige reads the form, maps fields to reconciled entity facts, flags every mismatch. Nothing is typed into a submit path yet.
5. **PREVIEW + APPROVE** — Paige presents the EXACT filing preview: destination origin, form identity, every field value, computed fee. The owner approves the exact action or stops. No approval → no submission, ever.
6. **SUBMIT (PC-4)** — the approved action executes inside the supervised session.
7. **PAY** — applicable fees pay through the portal's own checkout in the SAME supervised session (the tenant's own rails; §38: Paige is never merchant of record; card data never transits Paige).
8. **VERIFY + PERSIST** — Paige reads back the portal's confirmation number/status screen, cross-checks it against the submitted preview, and only then files the authoritative receipt (Rail summary + detailed durable action receipt: exact action, target, amount, grant id, provider result, verified readback, idempotency key). Downloads (confirmation PDF) land in Vault quarantine.
9. **REPORT** — the owner gets "filed, confirmed by the portal, receipt #X" or the honest failure state — `outcome_unknown` is reported as unknown, never smoothed into success.

## Invariants (binding on every implementation slice)

- Confirmation and payment are INDEPENDENTLY VERIFIED before completion is claimed (live readback + amount/recipient match; a confirmation screen the session itself rendered is not verification of a settled payment).
- One destination per approval; redirect off the approved origin aborts the run.
- Every state transition writes the rail; secrets never enter any model-visible surface (PC-1 scrubber is the floor, not the ceiling).
- Cancellation/timeout closes the session and settles usage honestly (consumed seconds + microusd).
- Rollback: a failed submission must leave a truthful `failed`/`outcome_unknown` receipt and a re-runnable proposal — never a silently half-filed report.
