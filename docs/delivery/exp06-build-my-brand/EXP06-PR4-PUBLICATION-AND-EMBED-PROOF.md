# EXP06 PR4 — Publication-version binding proof + S2a embed re-proof (record)

**Status:** delivery evidence for PR4. Two things ship here: (1) a NEW isolated-database proof that
the publish door's stored call and the anonymous public read are ONE contract, added to the
`database-contract` CI job; (2) a dated re-proof of the E03 S2a embed acceptance legs A–D against
current main, at every level achievable without an authenticated account session. Leg E and the
live B/C browser drives stay owner/account-session-owed (named below).

## 1. The binding proof — `supabase/tests/growth_public_publication.sql`

Runs in the existing `PAIGE Spine contract` / `database-contract` job on the rebuilt full-schema
database (the same harness that runs `public_visits.sql`), added as a step in
`.github/workflows/paige-spine-contract.yml`. Synthetic fixtures only; `BEGIN`…`ROLLBACK`.

| Leg | Proves |
|---|---|
| Authority | A foreign workspace owner cannot drive another workspace's stored publish call (`GROWTH_FORBIDDEN`) |
| Failed publication | A page with an unresolved placeholder refuses to publish (`GROWTH_UNRESOLVED_PLACEHOLDER`) and NOTHING becomes public — the refusal leaks nothing |
| Approved = visitor | The stored publish (`growth_page_publish`, the exact RPC the door's executor runs) returns `/p/<slug>/<page>`; the ANON read through the real RLS policy `growth_pages_public_read_published` serves the approved draft byte-for-byte (blocks AND seo description); the page's embedded form goes live with it (owner ruling 2026-09-30) |
| Draft invisibility | A draft page never appears to the anonymous reader |
| Unpublish | The anon read finds nothing after unpublish; the row survives as a draft (work kept) |
| Restore + republish | After saving v2 and publishing (visitor sees v2), `restore_artifact_version` writes the v1 snapshot back to the draft columns and a republish serves v1 to the visitor byte-equal — the timeline's restore is the visitor's next version |
| Tenant wall | One workspace's page never answers another workspace's slug |

This is the automated closure of acceptance-matrix rows 5–7's public-read legs and resumption
verification items 3 and 5 (failed-publication and authority truthfulness at the stored call).

## 2. S2a embed re-proof on current main (A–D), dated 2026-10-25

| Leg | Re-proof level | Evidence |
|---|---|---|
| A1–A3 exact code, origin `https://paigeagent.ai` | source + harness | `studio.render.test.tsx:319` asserts the byte-exact script tag (incl. `data-form`, `data-title`, `data-cfasync`); green in the 103/103 wall on current main |
| A4 iframe variant, A5 Copy code/keyboard | source + harness | `EmbedCode` component + `EmbedCode.test.tsx`; Publish-panel keyboard path in the v2b wall (re-run green) |
| B1–B7 form on external host → canonical submission/deal/attribution, no accidental sends | contract level | `public-form-intake-contract.test.ts` + `GrowthFormRenderer` renderer tests (jsdom, intake contract) + the CI SQL proofs `campaign_lead_attribution.sql` and `campaign_pipeline_routing.sql` in the same database-contract job; DNT/GPC + origin/bot-trap/rate semantics per the corrected submit-vs-visit record |
| C1–C4 CSP/sandbox fallbacks, dark | source level | `public/embed.js`: frame-refused-by-origin handling with the console naming the fix, address-less-origin (sandbox) fallback link, theme handling — the exact shipped loader |
| D1 unpublish on the host page | DB + source | This PR's SQL unpublish leg (anon sees nothing) + `GrowthFormRenderer` "This form isn't available right now" for unpublished forms |
| Live loader readback | live | `https://paigeagent.ai/embed.js` HTTP 200, 17,134 bytes, the real loader (this session) |
| E + live B/C browser drives | **OWNER/ACCOUNT-OWED** | Needs an authenticated session to publish a synthetic form (B/C) and the owner's own site (E) — the named dependency since session 1; nothing here is claimed live |

No S2a evidence was altered or deleted; this record refreshes current-main proof only.
