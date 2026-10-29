# EXP07 — the exact Cloudflare decision: media + broadcast enablement

> **CORRECTION RECORD (2026-10-28, post-merge — same doc, per Coordinator e7c6e686/fdbbecf4):**
> this packet's merged state approved nothing by itself — prices, provider enablement, and
> customer acceptance were and remain separate owner acts. Three claims below are superseded
> in place: §2's library "LIVE end-to-end" becomes the bounded source+deploy+probe milestone
> it always was (the authenticated drive is still owed); §5's arithmetic is corrected
> (×1.25 = 25% markup = **20% contribution** on pre-fee revenue; the 25%-contribution floor
> is **$9.84**, not $9.23); §7's rollback language no longer equates stopping new usage with
> active-session termination or guaranteed deletion (EXP10's retention/decommission evidence
> is the reference, ANT-161 `4b5c83ff`). **Enablement status since:** the owner separately
> enabled RealtimeKit in the Cloudflare dashboard on 2026-10-28 (app `paige-production`) and
> vaulted the API token — that owner act, not this document, is what gates the broadcast
> build. Tenant pricing remains owner-held.

**Status: DECISION REQUESTED — nothing activated.** This document names the ONE decision the
owner's standing direction asks for (a concrete service-enable decision, not a spend ceiling),
now that the media implementation it prices is real and deployed (ANT-162 milestone
`61577481`: the tenant media library, both governed doors, the migration — all shipped
through the normal pipeline). Every price below is from Cloudflare's current official
documentation (verified 2026-10-27/28; sources named inline). Account plan, discounts and
minimums are owner-held facts this document explicitly does NOT guess.

---

## 1. The account (identity + custody)

| Item | Value |
|---|---|
| Account | The ONE existing PAIGE Cloudflare account (the same account the Stream canary and the media library already use — account id `ba54ec3b…` verified by EXP10's canary readback) |
| New accounts | NONE — no second account, no per-tenant accounts, no per-tenant tokens (owner directive 2026-10-24/25) |
| Credential custody | UNCHANGED: `CLOUDFLARE_STREAM_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` exist only in the Supabase edge environment, custody per EXP10's contracts; adding RealtimeKit requires only that the existing account's plan/features be enabled — any new token would be provisioned through the SAME EXP10 custody path, never pasted, never per-tenant |
| Who provisions on the go | The owner (or the operator the owner names) flips the account-level enable in the Cloudflare dashboard; EXP10 mints/rotates any token; EXP07 wires no new secret until that exists |

## 2. The products and the exact features used

| Product | Feature | Status in PAIGE today |
|---|---|---|
| Cloudflare Stream | On-demand storage + delivery (HLS/DASH playback) | **SHIPPED (source + deploy + probe)** — merged `662be5534`, migration applied, doors deployed and unauth-probed 2026-10-28; the authenticated upload→ready→play→remove drive is still OWED, so "end-to-end LIVE" is not claimed |
| Cloudflare Stream | Direct upload (one-time upload URLs) | **SHIPPED (source + deploy + probe)** — the governed `stream-media-command` door; the API token never leaves the server; no live provider call made yet (none authorized at ship time) |
| Cloudflare Stream | Recordings storage/replay (for broadcast sessions) | NOT WIRED — the recording lands as a library row at session end (the store supports it; the session wiring is the broadcast slice) |
| Cloudflare Realtime — RealtimeKit | Two-way A/V rooms (host + guests, camera/mic, screenshare, simulcast f/h/q) | NOT ENABLED — the two-way layer; this decision's core ask |
| Cloudflare Realtime — RealtimeKit | Recording export (RTMP/HLS export into Stream storage) | NOT ENABLED — priced below; export writes the session recording into the tenant's library |
| Cloudflare Realtime — RealtimeKit | Server-side admission (per-participant authTokens from an Add-participant API) | NOT ENABLED — viewer/guest admission, moderation (mute/kick), reconnect — the Core SDK contract carries them |
| Cloudflare Realtime — RealtimeKit | Real-time transcription | NOT REQUESTED — bills at Workers AI standard pricing; out of this decision unless the owner wants it |
| Cloudflare Realtime SFU/TURN | Underlying transport | Included in RealtimeKit routes; **whether SFU egress is separately billed for a RealtimeKit route is UNPROVEN** and this proposal deliberately does NOT stack it (per the 2026-10-27 coordination warning). Verified at first invoice/readback |

Mobile support: web (React/vanilla/Angular), Android, iOS, React Native SDKs exist (no Flutter).
PAIGE's web-first surfaces use the web SDK; native SDKs are noted for the roadmap.

## 3. The topology (the corrected two-layer picture)

```
   HOST + 3 GUESTS (interactive, two-way)          100 PASSIVE VIEWERS
   ┌───────────────────────────┐                   ┌──────────────────┐
   │  Cloudflare RealtimeKit   │                   │  Cloudflare Stream│
   │  A/V room · admission ·   │──recording──────▶ │  delivery (HLS)   │
   │  moderation · simulcast   │   export (once)   │  playback/embed   │
   └───────────────────────────┘                   └──────────────────┘
        4 × $0.002/min                                100 × $1/1,000 min
```

One vendor, one custody path, one account. The interactive surface (RealtimeKit) and the
delivery surface (Stream) are DIFFERENT products with different participant counts — passive
viewers are NEVER RealtimeKit participants and never bill at RealtimeKit rates.

## 4. Verified costs (published list rates — official docs, 2026-10-27/28)

| Line | Rate | Source |
|---|---|---|
| RealtimeKit A/V participant | **$0.002 / participant-minute** | developers.cloudflare.com/realtime/realtimekit/platform/pricing |
| RealtimeKit audio-only participant | $0.0005 / participant-minute | same |
| RealtimeKit export (recording / RTMP / HLS) | **$0.010 / minute** (audio-only $0.003; raw-RTP-into-R2 $0.0005) | same |
| RealtimeKit transcription | Workers AI standard pricing (not requested) | same |
| Realtime SFU/TURN egress | $0.05 / GB; **first 1,000 GB/month free** | developers.cloudflare.com/realtime/pricing |
| Stream storage | $5 / 1,000 minutes stored | cloudflare.com Stream pricing |
| Stream delivery | $1 / 1,000 minutes delivered | same |
| Stream direct upload | included (a `maxDurationSeconds` reservation is held against storage until the upload completes/expires) | Stream direct-upload docs |

**Worked scenario (the corrected estimate, 60-minute session, host + 3 guests, 100 passive
viewers, recording retained):**

| Line | Math | Cost |
|---|---|---|
| RealtimeKit participants | 4 × 60 × $0.002 | $0.48 |
| Recording export | 60 × $0.010 | $0.60 |
| Stream delivery to viewers | 100 × 60 min × $1/1,000 | $6.00 |
| Stream storage (replay) | 60 min × $5/1,000 | $0.30 |
| **All-in per session (list)** | | **≈ $7.38** |

Marginal costs: one more passive viewer ≈ $0.06/hour (delivery only); one more on-camera
guest ≈ $0.12/hour + their share of export. SFU egress NOT added (unproven for this route;
first-invoice readback will confirm or refute).

**Account plan/discount/minimum: UNVERIFIED owner-held fact.** The numbers above are list;
the actual account's plan, any committed-use discount and any minimum change them. The owner
(or delegated operator) reads them from the Cloudflare dashboard at enable time; this
document does not guess.

## 5. Tenant charges (the 25% contribution target)

Owner-accepted target: tenant-attributed usage bills the consuming tenant at published
rates with a **25% contribution after attributable variable/payment costs** — final rates
await actual-invoice and market verification (owner direction 2026-10-27/28).

**Corrected arithmetic (supersedes the original ×1.25-equals-25%-contribution claim; all
figures illustrative at LIST rates, before payment fees):**

| Line (list) | Cost/session | ×1.25 (= 25% markup) | Contribution at ×1.25 | 25%-contribution floor |
|---|---|---|---|---|
| Interactive 4 + export + 100 viewers + replay | $7.38 | $9.23 | **20%** ($1.85 / $9.23) | **$9.84** ($7.38 / 0.75) |

A ×1.25 multiplier is a 25% markup **on cost** but only a **20% contribution on revenue**
before payment fees. Meeting the accepted 25% contribution target requires at least
**$9.84** on the $7.38 list-cost session — and the FINAL rate must additionally cover the
actual variable/payment costs and fixed payment charges once those are known from the real
account plan and first invoice. No final price is proposed or implied here.

Per-tenant enforcement (the billing supersession's shape): **no per-tenant spend ceiling** —
usage meters per tenant into `platform_usage_events` (the SAME canonical meter the media
library already writes; the broadcast slice adds its session/participant/export rows through
the same writer — no second ledger), and collection thresholds trigger charging, never
cessation. What remains the owner's is the FINAL RATE (any multiplier is an opening
illustration, subject to actual-cost verification) and any account-level commitment.

## 6. Permissions, security and data boundaries

- The API token(s) never leave the edge environment; participants receive only per-session
  authTokens minted by the Add-participant API (admission is PAIGE-server-controlled).
- Tenant isolation: the existing pattern extends — a session row binds tenant ownership in
  PAIGE's tables (the `tenant_media_assets` shape), Cloudflare metadata is traceability not
  the boundary; one tenant's sessions/recordings are never readable by another (the reader
  door already proves this shape for videos).
- Recording retention: the session recording lands in the tenant's library and follows the
  library's lifecycle — revoke is the retention terminal. Provider-side deletion on revoke is
  a separately governed step (already named as owed in the library's record).
- Moderation/anti-abuse: server-side kick, mute, admission refusal, session caps — technical
  limits, retained by the supersession. The reported disconnected-participant billing issue
  is mitigated by hard session termination on drop (build-time requirement, named).

## 7. Rollback

| Layer | Rollback |
|---|---|
| Product enable | Flip the account-level feature off in the Cloudflare dashboard. This stops NEW usage — it does NOT terminate in-flight sessions (they run until ended or dropped) and does NOT delete persisted data; decommission scope, purge behavior and scale/account-plan facts follow EXP10's retention/decommission evidence (ANT-161 `4b5c83ff`), not this table |
| Code | The broadcast slice ships dormant-fail-closed behind the missing feature (the same shape as the media library pre-enable): every path returns the honest "not switched on yet" until the feature exists; reverting the PR removes the surface |
| Data | Sessions/recordings are rows in the tenant's library — revoking/deleting them is the library's own lifecycle; no schema unwind beyond that |
| Cost | Usage-billed with no reserved capacity: disabling stops accrual of NEW usage; in-flight sessions may accrue until terminated (hard session termination on drop is the build-time mitigation); retention of already-stored recordings bills at Stream storage rates until the library lifecycle removes them |

## 8. Remaining proof (what this decision unlocks, in order)

1. A two-way room created through PAIGE's own door with 2+ real participants (host + guest),
   camera/mic both ways, admission and kick exercised.
2. A recording exported into a tenant library and replayed through the existing player.
3. The first invoice readback: confirm participant/export metering matches the session rows,
   and settle the SFU-egress-stacking question with evidence.
4. Tenant isolation negatives on the session surface (A cannot read/join B's session).
5. The authenticated owner drives already owed (media library upload→ready→play→remove; the
   row-10 publish journey).

---

## THE DECISION REQUESTED (one, exact)

**Enable Cloudflare Realtime/RealtimeKit (A/V rooms + recording export) on the EXISTING
PAIGE Cloudflare account** — the account Stream already uses; no new account, no new
per-tenant tokens, custody unchanged through EXP10; usage-billed at the published rates
above with NO per-tenant spend ceiling (the supersession's shape); tenant rate = list ×1.25
as the opening ILLUSTRATION (25% markup = 20% contribution pre-fees; the 25%-contribution
floor is $9.84 — §5), FINAL RATES to be set after the owner reads the
actual account plan/discount and the first invoice's real costs.

Everything else in this document is already authorized and shipped or already owned by
named lanes. A NO leaves the broadcast slice dormant-fail-closed (built the same way) and
changes nothing about the media library already live.
