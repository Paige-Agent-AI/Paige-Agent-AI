# Ads chat capabilities — §32.c authenticated acceptance package

Date: 2026-10-12 · Linear: ANT-45 (P-ANT-22) · Source: PR #2023 (main `8c2ec37`), backend #1998, screens #2011.
**Status: PREPARED, NOT EXECUTED.** No signed-in run has happened. This file says exactly what to run, what
counts as a pass, and what is already proven without a sign-in.

## Identity — the one canonical account (ANT-21; do not create others)

- Auth user `0640f8f9-30a7-49c7-ac4e-53f68b77381d`, workspace `bcefc207-4ac6-42af-83b8-3abe3e897649`
  ("PC-1 QA Shared Synthetic", standalone, active, single member: owner). Nonsecret identifiers only.
- Its password was generated and consumed inside the provisioning session (ANT-21 comment, 2026-10-12 03:34 UTC).
  No agent holds it; issuing or rotating it is a coordinator/owner action (vault only, never chat/Linear/Drive).
- Read-only state on 2026-10-12: 0 pipelines, 0 stages, 0 deals, 0 forms, 0 submissions, 0 library pictures, no
  autonomy override for `set_ad_creative_featured` (so PAIGE asks first). Registered test scope today:
  "PC-1 public read-only test preparation only".

## Already proven without a sign-in (2026-10-12)

Production database, read-only or rolled back, as the canonical user's claims (`set local role authenticated`,
`request.jwt.claims.sub = 0640f8f9…`); every call ran inside `begin … rollback`, nothing persisted. Evidence class:
**database-level, simulated session** — not authenticated runtime.

| Probe | Result |
|---|---|
| Who the canonical user resolves to | `current_user_tenant_id()` = `bcefc207…`, `is_tenant_admin` = true |
| Funnel, pipeline id that does not exist | `42501 PIPELINE_FORBIDDEN` (no existence oracle) |
| Funnel, null pipeline | `42501 PIPELINE_FORBIDDEN` |
| Feature, picture id that does not exist | `42501 AD_CREATIVE_FORBIDDEN`, nothing written |
| Funnel as `anon` | `42501 permission denied for function get_pipeline_lead_funnel` |
| Feature as `anon` | `42501 permission denied for function set_ad_creative_featured` |
| `POST /functions/v1/paige-ai-chat` with no session | `HTTP 401 UNAUTHORIZED_NO_AUTH_HEADER` |

Prod catalogue readback (#2026): migration `20271021210000` applied; `list_tool_autonomy` carries
`set_ad_creative_featured` with default `confirm`.

## Owner-controlled preflight (all currently absent)

1. **Credential for a trusted runner.** Owner/coordinator makes the canonical account's credential available to
   the runner that will drive it (`LIVE_DRIVE_EMAIL` / `LIVE_DRIVE_PASSWORD` for `scripts/live-drive/live-drive.mjs`,
   or the owner drives it in a browser). Without this no step below can run.
2. **Scope extension for the canonical account.** The positive flows need data the account does not have. Authorize
   adding, through the normal product as the account's owner (no SQL seeding):
   - one Sales pipeline with an open first stage, marked default;
   - one Marketing form with no route of its own, submitted twice with tagged links
     (`?utm_campaign=QA-SPRING&utm_content=<picture id>` and `?utm_campaign=QA-SPRING`), which files two deals into
     the default pipeline;
   - two library pictures uploaded in Ads › Creative (one is archived later for a negative control).
   All of it is synthetic and stays in the canonical workspace; nothing is published, spent, or sent to a provider.
3. **Second identities for refusal cases (ANT-21 exception record needed first).**
   - *Unauthorized actor:* a **member** (non-admin) seat in the canonical workspace — a role addition, which the
     standing rules forbid without owner authorization and an ANT-21 exception entry.
   - *Wrong workspace:* a separately authorized second tenant. `test-agency-preview` (`2de8ca80…`, agency, active)
     exists but is **not** registered in ANT-21 for isolation tests; it may be used only if the owner registers it.

## Acceptance run (signed in as the canonical owner, in Solo)

Record for each step: the PAIGE reply text, a screenshot, and the readback query result.

### A. Lead funnel question

| # | Ask PAIGE | Pass when |
|---|---|---|
| A1 | before any pipeline exists: "Where do my leads stand by campaign?" | Says there is no Sales pipeline yet; no numbers invented |
| A2 | after preflight 2: same question | Names the default pipeline; deals per stage; leads/open/won/lost under campaign `QA-SPRING`; one row for the tagged picture; leads that reached no pipeline named |
| A3 | "Same for the last 7 days" | Uses the 7-day window |
| A4 | "Show it for pipeline <other pipeline name>" (if a second exists) | Uses that pipeline; a pipeline from another business is refused ("That pipeline is not in this business…") |
| A5 | "How much did I spend? What's my ROAS? Clicks?" | States those are not available — no ad account is connected; no figure, no zero |

Readback: `select public.get_pipeline_lead_funnel(<pipeline id>, <since>)` as the same session must match the reply.

### B. Featured-picture flow

| # | Action | Pass when |
|---|---|---|
| B1 | "Feature <picture title> in my Ads showroom" | An approval card naming the picture; nothing changed yet |
| B2 | Approve the card | PAIGE reports it featured only after readback; Ads › Overview shows it in the first placement as "Featured" |
| B3 | Ask again for the same picture | "already had it that way"; no write, no new receipt |
| B4 | "Take it out of the showroom" → approve | Unfeatured; Overview falls back to performance/newest |
| B5 | Decline (or ignore) the card | No change; readback unchanged |

Readback after B2/B4:
```sql
select id, title, kind, status, meta->>'ads_featured' featured, meta->>'ads_featured_at' featured_at
from marketing_content where tenant_id = 'bcefc207-4ac6-42af-83b8-3abe3e897649' and kind in ('image','video');
-- receipts: one capability run per approved write on the workspace Rail
select * from paige_workspace_events where tenant_id = 'bcefc207-4ac6-42af-83b8-3abe3e897649'
order by created_at desc limit 10;
```

### C. Refusals

| # | Case | Pass when |
|---|---|---|
| C1 | Unauthorized actor (member seat, preflight 3) asks either question | Refused before any card: "Campaign results are for owners and admins…" / "Featuring pictures … is for owners and admins…" |
| C2 | Wrong workspace: owner asks to feature a picture id from the second tenant | "That picture is not in this business's library."; nothing written in either tenant |
| C3 | Missing approval: B5 | No write, no succeeded receipt |
| C4 | Invalid creative: archived picture | "That picture is archived, so it cannot be featured…" |
| C5 | Invalid creative: a seventh picture while six are featured | "You can feature up to 6; unfeature one first." plus the six currently featured |
| C6 | Invalid creative: an id that is not a picture or video | "Only a picture or a video can be featured…" |

## What stays unavailable (must read as unavailable, never as zero)

Impressions, clicks, spend, CPL, CAC and ROAS: no ad-provider account is connected or read. The funnel's counts
are leads and deals from tagged links in this business's own forms.

## Picture search — reuse finding (separate product gap; not started)

Question: can an existing Knowledge/media capability let PAIGE find a picture by description before featuring it?
Answer from source (2026-10-12): **no chat capability lists or searches a business's pictures today.** The feature
tool says so itself (`_shared/ads-funnel-chat.ts:16`, pinned by `src/__tests__/ads-funnel-chat.test.ts:123`).

| Candidate | Why it does not serve as-is |
|---|---|
| `get_campaign_brief_assets` (int298, `20271020000010…:158-222`) | Business-scoped, returns id + title, but no `kind` (cannot tell pictures from text) and no search; frontend-only, no chat tool |
| `list_library` (`20260718031529…:173-221`) | Covers only items explicitly saved to the Studio library; membership-only check, no admin gate, not pinned to the active business |
| Knowledge (`match_tenant_knowledge`, `studio-learn-from-artifact`) | Opt-in per item, skips short text, and returns knowledge chunks — never a `marketing_content` id the feature tool can use |
| Ids already in the conversation (canvas, last image, `generate_image`) | At most one item, only from this conversation |

If the owner authorizes it, the smallest correct read mirrors the showroom's own query (`src/solo/marketing-ads.tsx:96-102`):
caller session, active business checked before and after, `kind in (image, video)`, not archived, returning id,
title, kind and featured state. Natural home: a read beside the feature tool in `ads-funnel-chat.ts` (Spine owner
`ads`), unless `vibe-studio` (owner of the `marketing_content` domain) prefers a general list read — that choice is a
coordination point with the Platform Reach owner. Nothing is built until the owner authorizes this scope.

## Clean-up

Unfeature anything featured during the run (B4). Leave the synthetic pipeline, form and pictures in the canonical
workspace for the next run unless the owner asks for removal; record what was added in ANT-21.
