# INT-298 / INT-342 MBC 7a — public visit evidence

SHELL: SOLO. Coordinator command "PAIGE Marketing — Slice 6 accepted as engineering delivery; continue to integration
proof" (2026-10-12; INT-298, INT-342, Linear ANT-15 / ANT-87 / P-ANT-5), item 1: funnel-session and page-view
evidence with real source attribution, tenant isolation, accurate denominators and honest unavailable states.
Plan: `docs/product/int342-marketing-convergence.md` §L.4 ("Wire `growth_funnel_session_upsert`. A tenant-scoped
public-route view producer").

## Why

Nothing recorded a visit to a business's own public pages, so Marketing could show no visits, no conversion rate and
no funnel step-through, and said so. Grounded 2026-10-12, read-only on production:

- `analytics_events` (the app-wide `page_view` beacon) has no tenant or page column and holds **0** `page_view` rows
  of 62 events, the last on 2026-10-05.
- `growth_funnel_sessions` has a tenant-pinned writer (`growth_funnel_session_upsert`) that nothing called: **0** rows.
- `growth_form_submissions.funnel_session_id` exists and was never written. Production holds 0 submissions,
  1 published page and no funnels, so there is no history to backfill or reconcile.

## What a visit is

**One browser tab looking at one published page, active funnel or active standalone form, until it has been idle
for 30 minutes.**

- The visitor is never identified: no IP, no user agent, no cookie. Only the referring **host** (no path, no query)
  and the link's campaign tags (`utm_*`, `ref`, `gclid`, `fbclid`, through the same `sanitizeUtm` as submissions).
- A funnel is one visit for the whole funnel. It keeps the **furthest step reached**, which never rewinds. The pages
  inside a funnel are not separate page visits.
- A form embedded in a page or funnel uses that page's or funnel's visit. Only the standalone `/form/:id` page records
  a form visit of its own.
- The Studio preview and `/render-frame` record nothing: only the three public routes (`/p/…`, `/f/…`, `/form/:id`)
  call the recorder.

## What is never recorded

The function answers `200 { recorded: false, reason }` and writes nothing for:

- **privacy signals:** a browser sending `DNT: 1` or `Sec-GPC: 1`. The browser module does not even ask in that case.
- **automated agents:** a user agent naming a bot, crawler, link preview, monitor, HTTP library or headless browser,
  or no user agent at all. That covers PAIGE's own page screenshots: `paige-browser` is headless, and its egress fence
  aborts every POST anyway.
- **anything not public now:** a draft or archived page, an inactive funnel or form, or a business that is not live
  (trial, active or past due — the same rule as `growth-public-submit`) or is archived. The function answers
  `404 { recorded: false }`.
- **someone signed in to Paige:** the browser module does not record a visit while a Paige session exists, so a
  business opening its own public link from its dashboard is not its own visitor. (A visitor who also happens to have
  a Paige account of their own and is signed in is not counted either — including a business's own clients signed in
  to its client portal.)

It also refuses a disallowed origin (`403`, the same allowlist as `growth-public-submit`) and rate-limits with `429`
past 60 a minute per visitor IP or 300 a minute per page, funnel or form. The limiter fails closed.

**What this does not stop, said plainly:**
- The origin and user-agent checks are browser conventions. A script outside a browser can forge both.
- Within the rate limits, such a script can still inflate a target's recorded visits, and a script spread across
  many addresses can grow the table.
- The opposite is possible too. A script filling a page's per-target limit (300 a minute, fail-closed) leaves real
  visitors to that page unrecorded for the rest of that minute, so a figure can also be undercounted. Slice 7b must
  say so wherever the limiter refused.
- No figure built on this data may be presented as tamper-proof.
- A per-business retention window is not set here (see "Not in this slice").

**So every count built on this is "recorded visits", and says so.** A conversion rate must divide submissions that
carry a recorded visit by recorded visits. Dividing *all* submissions (including those from browsers that are never
counted) by recorded visits would overstate it.

## The seams

Migration `20271024100000_int298_public_visits.sql`:

- **`growth_public_visits`.** One row per visit: `tenant_id` (from the target row), `target_kind` and exactly one of
  `page_id` / `funnel_id` / `form_id`, `funnel_session_id`, the server-made `visit_token` (`pv_` + 64 hex),
  `furthest_step` (funnel only), `utm_json`, `referrer_host`, `started_at`, `last_seen_at`.
  - Check constraints keep one target, steps for funnels only and a well-formed host, even against a faulty writer.
  - Row security: the business reads its own visits (`tenant_id = current_user_tenant_id()`, or the platform owner).
  - No app role may write. Anonymous callers read nothing.
- **`growth_public_visit_record(kind, target, token, step, utm, referrer_host)`.** The one writer. SECURITY DEFINER,
  executable by the service role only.
  - The business comes from the target row, never the request.
  - A token continues a visit only for the same kind, target and business, seen in the last 30 minutes; any other
    token starts a new visit, so a stale or foreign token never moves someone else's record.
  - A new funnel visit opens its `growth_funnel_sessions` row through that table's own writer, and a further step
    advances it.
- **`growth_funnel_session_upsert` is no longer callable by `anon` or `authenticated`.** It had been granted for a browser
  path that was never built, and nothing else calls it (searched `src`, `supabase/functions`, `supabase/tests`,
  `scripts` and every migration). Left open, it would let anyone create or complete funnel sessions while skipping
  every visit check. The visit writer runs as the function's owner, and the service role keeps its grant.
- **Account retirement:** `growth_public_visits` is registered `delete` in `operator_retirement_disposition`, like the
  campaign tables. Unregistered, a business with a single visit could no longer be retired through the canonical path.
- **`growth_public_visit_for_submission(form, token)`.** Service role only. It returns the visit and its funnel
  session token only when:
  - the visit was seen in the last two hours;
  - it is in the form's own business;
  - it is to this very form, or to a page or funnel.
- **`growth_form_submissions.visit_id`.** Set by `growth-public-submit` from that answer, alongside
  `funnel_session_id`. **A visit is evidence, never a gate**: a missing, stale or foreign token links nothing and the
  submission is saved as before. The `form.submitted` event payload is unchanged (it names fields explicitly), so
  neither token reaches the event bus.
- **`growth-public-visit` edge function** (`verify_jwt = false`). It checks origin, privacy signals, agents and rate,
  then calls the writer. The pure rules (`notRecordedReason`, `referrerHost`, `parseVisitRequest`, `visitTokenOf`)
  live in `_shared/growth-visit.ts`.
- **Browser.** `src/lib/growth-visit.ts` records a visit and keeps the token in this tab's `sessionStorage` for 30
  idle minutes. Requests for one target run one at a time, so a funnel visitor who moves on before the first answer
  arrives continues the same visit instead of starting a second one.
  - Only the renderer still on screen makes a token the active visit (`useGrowthVisit` → `setActiveVisit`), so a late
    answer for a page already left never claims the next page's submission.
  - `submitGrowthForm` hands back the active visit token.

## What changed on screen

Copy only, because the old sentence stopped being true:

- Analytics "Your pages" now says "Visits are recorded, but aren't counted here yet" (flag still "Not available").
- The conversion note says why there is no rate yet.
- The Overview and Analytics "Ask PAIGE" prompts no longer claim visits are unrecorded.

No figure is shown yet.

## Not in this slice (7b)

- **Visit and conversion figures**, through the INT-340 shared metric seam: proposed keys
  `marketing.pages.visits`, `marketing.pages.visit_conversion` (denominator = recorded visits; numerator =
  submissions carrying one) and `marketing.funnels.step_through`.
  - Adding keys touches INT-340's dispatcher allowlist, so it is coordinated with that owner (Linear ANT-23), as
    MBC 2 was.
  - Then the Analytics "Your pages" row shows them.
- **A tenant's own custom domain:** the origin allowlist accepts only `paigeagent.ai` and its subdomains, for visits
  as for submissions.
- **Retention:** visits are kept with the business's data. A retention window is a policy decision this slice does not take.

## Proof

- **Database:** `supabase/tests/public_visits.sql` (rolled back), in `paige-spine-contract.yml` → `database-contract`.
  - Locally on PG16 it applied, replayed idempotently and passed.
  - Thirteen reinstated defects each failed it: no target pin, no idle limit, cross-business link, a form visit
    linking any form, a rewinding step, every business reading every visit, a signed-in writer, a draft page, a closed
    business, an archived business, the funnel-session writer left open to `anon`, visits blocking retirement, and a
    stepped page or malformed host (stopped by the table's checks).
- **Unit:** `src/__tests__/growth-public-visit.test.ts`, 14 tests covering the server rules and the browser module.
  Nine reinstated defects each failed it: DNT/GPC ignored by the server, headless counted, opt-out ignored by the
  browser, submission dropping the visit, no idle expiry, clearing someone else's visit, no in-flight chaining, a
  signed-in owner counted, and recording setting the active visit by itself.
- `GrowthFormRenderer.test.tsx` asserts the standalone form page records exactly one form visit and sends the answers
  once.
- **Production (2026-10-12, after the merge `be8d9278`):** the migration is recorded and its objects, grants and
  retirement disposition read back as designed (matrix §N4 in `docs/product/int342-marketing-convergence.md`).
  Asked anonymously, the deployed function answered Do Not Track and Global Privacy Control with
  `200 {recorded:false, reason:"privacy_signal"}`, a headless user agent with `automated_agent`, and a foreign
  origin with `403`, all before the rate limiter or any write.
- **Not verified here:** a real browser visiting a real published page on production, and a submission linked to
  that visit. Owed to the signed-out half of the ANT-87 acceptance run
  (`docs/delivery/marketing-s3-6-acceptance-package.md`, run D).
