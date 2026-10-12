# Ads chat capabilities — §32.c authenticated acceptance package

Date: 2026-10-12 · Linear: ANT-45 (P-ANT-22) · Source: PR #2023 (main `8c2ec37`), backend #1998, screens #2011.
**Status: PREPARED, NOT EXECUTED.** No signed-in run has happened; no fixture exists yet. This file says exactly what to run, what
counts as a pass, and what is already proven without a sign-in.

## Identity — the one canonical account (ANT-21; do not create others)

- The one shared synthetic SOLO QA account registered in ANT-21 (standalone, active, single member: owner). Its
  identifiers live in ANT-21, not in this file; below, `:qa_user` and `:qa_workspace` stand for them (psql variables in the SQL).
- Its password was generated and consumed inside the provisioning session (ANT-21 comment, 2026-10-12 03:34 UTC).
  Issuing or rotating it is a coordinator/owner action (vault only, never chat/Linear/Drive). Once installed in the
  runner's environment the session can read it (`live-drive.mjs` reads `process.env`) and must never print, log or
  screenshot it. The credential-free alternative is a handed-over signed-in session (`opts.storageState`,
  `live-drive.mjs:227-231`): the drive reuses it and never sees a password.
- Read-only state on 2026-10-12: 0 pipelines, 0 stages, 0 deals, 0 forms, 0 submissions, 0 library pictures, no
  autonomy override for `set_ad_creative_featured` (so PAIGE asks first). Scope: the owner approved the restricted
  synthetic preparation for ANT-45 on 2026-10-12, recorded in the ANT-21 register comment of 05:06 UTC (fixtures through the product, one temporary member, temporary
  reuse of the agency-preview business); no ad spend, provider publishing, customer data or INT-346.

## Evidence ledger 1 — database-level, rolled back (2026-10-12)

Kept separate from ledger 2; nothing here is signed-in proof.

Production database, read-only or rolled back, as the canonical user's claims (`set local role authenticated`,
`request.jwt.claims.sub = :qa_user`); every call ran inside `begin … rollback`, nothing persisted. Evidence class:
**database-level, simulated session** — not authenticated runtime.

| Probe | Result |
|---|---|
| Who the canonical user resolves to | `current_user_tenant_id()` = `:qa_workspace`, `is_tenant_admin` = true |
| Funnel, pipeline id that does not exist | `42501 PIPELINE_FORBIDDEN` (no existence oracle) |
| Funnel, null pipeline | `42501 PIPELINE_FORBIDDEN` |
| Feature, picture id that does not exist | `42501 AD_CREATIVE_FORBIDDEN`, nothing written |
| Funnel as `anon` | `42501 permission denied for function get_pipeline_lead_funnel` |
| Feature as `anon` | `42501 permission denied for function set_ad_creative_featured` |
| Feature a picture that belongs to another business (cancelled test business) | `42501 AD_CREATIVE_FORBIDDEN`; the foreign row untouched |
| Read another business's picture, the agency-preview rows, or either foreign tenant row | 0 rows each |

Separately, an HTTP call to the function gateway (evidence class: **unauthenticated gateway call**):
`POST /functions/v1/paige-ai-chat` with no session → `HTTP 401 UNAUTHORIZED_NO_AUTH_HEADER`.

Prod catalogue readback (#2026): migration `20271021210000` applied; `list_tool_autonomy` carries
`set_ad_creative_featured` with default `confirm`.

## Readiness — 2026-10-12, last checked 14:38 UTC (owner approved the restricted preparation package)

| Item | State | Evidence class |
|---|---|---|
| Canonical account confirmed | **Done (readback)** — SOLO `standalone`, `active`; only member is its owner (`owner`, `is_owner`, `active`); never signed in. Recorded in ANT-21; Auth-administrator sign-off **pending** | database read |
| Second business | **Verified distinct** — `test-agency-preview`: `agency`, `active`, no parent, no children, its own single owner, no shared member, no data. Owner-ruled throwaway pending deletion (`route-and-url-taxonomy.md` §7.2). The agency shell has no Sales, Marketing or Studio screens, so no test record can be placed in it through the product; it serves as the database-level isolation baseline only (ledger 1). Nothing is created in it and no sign-in to it is needed | database read |
| Runner credentials | **Outstanding** — Auth administrators install them privately as environment variables of the trusted runner (in this cloud environment: environment settings → environment variables; a new session picks them up): `LIVE_DRIVE_EMAIL` / `LIVE_DRIVE_PASSWORD` for the QA owner. The temporary member's C1 run uses the **same two default names in its own separate session** (or a handed-over signed-in session), because the helper's error redaction only scrubs those two names. Never in code, GitHub, Linear, logs or chat. Checked 2026-10-12 14:38 UTC: not set; the live app answers HTTP 200 from the runner sandbox and Chromium is present | runner check |
| Synthetic fixtures | **Not created** — every step needs the canonical owner signed in (runner) | — |
| Temporary member | **Not created** — needs the runner and an inbox the Auth administrators control | — |
| Signed-in acceptance | **Not started** | — |

### Product facts that shape the fixtures (from source, 2026-10-12)

- A business's **first** pipeline becomes its default automatically; there is no "make default" control in Solo.
  Drafts count as a default for lead filing.
- Forms are created through PAIGE in Vibe Studio and published from its Publish panel. Visitors submit at
  `/form/<form id>`; the page stores `utm_campaign` / `utm_content` from the link.
- Pictures are added with **Add a picture or video** on Ads › Creative; each has a **Feature in showroom** toggle.
- Ad copy is saved only through PAIGE chat (channel `ad_copy`); there is no direct save button.
- **No product control archives or deletes a picture, ad-copy item or form**, and none sets a form to archived
  (forms can only be unpublished). This affects C4 and clean-up — see the decisions below.
- An agency business carries the `pipeline` feature but not Marketing or Studio (§61), and the agency shell mounts
  no Sales or pipeline screen, so nothing can be created in `test-agency-preview` through the product.
- PAIGE has no tool that lists pictures or pipelines, so any id used in A4, C5 or C6 is pasted into the chat.

### Runner runbook — fixtures (canonical owner, signed in, Solo)

1. **Before anything:** run A1 (no pipeline yet).
2. **Pipeline** — Sales › Opportunities › Board → **Create pipeline**: name `QA Ads Intake`, one stage
   `New lead` (Active work), one `Won` (Won outcome), one `Lost` (Lost / closed outcome) → create → **Manage
   pipeline** → **Activate**. Readback: one pipeline, `is_default = true`.
3. **Pictures** — Ads › Creative → **Add a picture or video** eight times with synthetic image files named
   `QA picture 1.png`…`QA picture 8.png` (the title comes from the file name). Readback: 8 `image` rows, none featured.
4. **Ad copy** — ask PAIGE in chat: "Write one short ad headline for a spring offer and save it as ad copy
   titled QA synthetic ad copy." Readback: one `text` row, channel `ad_copy`, title starting `QA`.
5. **Form** — Marketing → **Vibe Studio** → "A short lead form named QA synthetic lead form asking for name and email" → **Build it**
   → **Publish** → **Publish now**. Do not add an automation or pipeline route. Readback: one form, `active`.
6. **Submissions** — as a signed-out visitor, submit the form twice as `QA Lead One` /
   `qa-lead-1@tests.invalid` and `QA Lead Two` / `qa-lead-2@tests.invalid` at
   `/form/<form id>?utm_campaign=QA-SPRING&utm_content=<QA picture 1 id>` and
   `/form/<form id>?utm_campaign=QA-SPRING`. Readback: two submissions with `deal_id` set in the QA pipeline.
7. Nothing is featured before the acceptance run (B2 needs room under the limit of 6). The C5 set-up is part of
   the run, below.

### Runner runbook — temporary member (C1)

- Canonical owner: Settings › Team → **Invite someone** → an email address the Auth administrators control →
  Permission **Member** (the default; never Admin) → **Review invitation** → **Confirm and send invitation**.
- Auth administrator: accept at `/join/<token>` as that email (this creates the one temporary sign-in), then install
  its credential in the runner only, under the default `LIVE_DRIVE_EMAIL` / `LIVE_DRIVE_PASSWORD` names in a separate session
  (never alongside the owner's), or hand over a signed-in session instead.
- Run C1 as that member. Record the member's user id and the invite id in ANT-21 with timestamps.

### Owner decisions (resolved 2026-10-12)

1. **C4 archived picture — `UNAVAILABLE`.** No product control archives a picture, and production records are not
   modified through service-role access to manufacture the case. `QA picture 8` is a spare.
2. **C2 foreign picture — database-level only.** The rolled-back refusal in ledger 1 stands; no further use is
   made of another business's records, and C2 is not reported as signed-in acceptance.
3. **Fixtures — retained.** The pipeline, pictures, ad copy, form, tagged submissions and the contacts and deals
   they create stay in the canonical QA business, labelled synthetic, for future authorized regression runs. Their
   ids and custodian are registered in ANT-21 after creation. The temporary member's access is revoked after the
   run and the revocation is verified.

## Acceptance run (signed in as the canonical owner, in Solo)

Record for each step: the PAIGE reply text, a screenshot, and the readback query result.

### A. Lead funnel question

| # | Ask PAIGE | Pass when |
|---|---|---|
| A1 | before any pipeline exists: "Where do my leads stand by campaign?" | Says there is no Sales pipeline yet; no numbers invented |
| A2 | after the fixtures: same question | Names the default pipeline; deals per stage; leads/open/won/lost under campaign `QA-SPRING`; one row for the tagged picture; leads that reached no pipeline named |
| A3 | "Same for the last 7 days" | Uses the 7-day window |
| A4 | "Show it for pipeline <an id that is not in this business>" (any UUID outside the business; by design a foreign pipeline and a missing one get the same answer; ledger 1 covers a missing id and 0-row reads of other businesses' rows, but no real foreign pipeline exists in a test business to probe) | Refused: "That pipeline is not in this business…"; no figures shown |
| A5 | "How much did I spend? What's my ROAS? Clicks?" | States those are not available — no ad account is connected; no figure, no zero |

Readback: `select public.get_pipeline_lead_funnel(<pipeline id>, <since>)` as the same session must match the reply.
Take `<since>` from the tool result's `window.since`; the 7-day window starts at 00:00 UTC six days before today
(`windowStart`, `ads-funnel-chat.ts:62-66`), so a hand-picked date will not match.

**Order of checks for B and C.** `set_ad_creative_featured` asks first (`confirm`). Before the card, only the role
gate runs. The "already featured" check and the not-found / archived / not-a-picture / limit checks run after
approval, inside the tool. So for B3, C5 and C6 the tester sees an approval card first, approves it, and the
reply then explains why nothing changed.

### B. Featured-picture flow

| # | Action | Pass when |
|---|---|---|
| B1 | "Feature that picture in my Ads showroom", right after A2, about the tagged picture A2 returned (or a picture generated in this conversation). PAIGE has no tool to find a picture by title, so a picture named only by title is expected to get "point me to one" instead of a card | An approval card naming the picture; nothing changed yet |
| B2 | Approve the card | PAIGE reports it featured only after readback; Ads › Overview shows it in the first placement as "Featured" |
| B3 | Ask again for the same picture → approve the card | Reply says it is already featured and nothing was changed (tool note, `ads-funnel-chat.ts:202`; the action chip reads "already had it that way", `paige-ai-chat/index.ts:443`); no write, no receipt |
| B4 | "Take it out of the showroom" → approve | Unfeatured; Overview falls back to performance/newest |
| B5 | Decline (or ignore) the card | No change; readback unchanged |

Readback after B2/B4:
```sql
select id, title, kind, status, meta->>'ads_featured' featured, meta->>'ads_featured_at' featured_at
from marketing_content where tenant_id = :'qa_workspace' and kind in ('image','video');
-- receipts: one per approved write, and one refused receipt per refusal the tool itself returns (C5, C6).
-- C1's role-gate refusal happens before the tool runs and records no receipt.
-- This table is not readable by a signed-in session: run as service role / in the SQL editor.
select occurred_at, capability_key, outcome from paige_workspace_events
where tenant_id = :'qa_workspace' and capability_key = 'set_ad_creative_featured'
order by occurred_at desc limit 10;
```

### C. Refusals

C5 set-up, after B4 has unfeatured `QA picture 1`: on Ads › Creative feature `QA picture 2`…`QA picture 7` by hand
(six featured), then ask for `QA picture 1`. C5 and C6 need the item's id pasted into the chat.

| # | Case | Pass when |
|---|---|---|
| C1 | Unauthorized actor (temporary member) asks either question | Refused by the workspace role gate before any card (`paige-ai-chat/index.ts:10899-10906`): funnel — "Looking this up needs this workspace's owner or an admin…"; feature — "This needs this workspace's owner or an admin. Nothing was changed…" (`workspace-authority.ts:224-229`); no Rail receipt, because the gate returns before the tool runs |
| C2 | Wrong workspace | **Not run signed in (owner decision 2).** Evidence is the rolled-back refusal in ledger 1 |
| C3 | Missing approval: B5 | No write, no succeeded receipt |
| C4 | Invalid creative: archived picture | **`UNAVAILABLE` (owner decision 1)** — no product control archives a picture |
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

## Evidence ledger 2 — signed-in runner results

Empty. The runner fills one row per executed step (A1–A5, B1–B5, C1, C3, C5, C6): date/time, actor, PAIGE reply
text, screenshot path, readback result, pass/fail. C2 is recorded as "not run — decision 2 (ledger 1)" and C4 as
"UNAVAILABLE — decision 1", with no pass/fail and no screenshot. Never copy ledger 1 rows here.

## Clean-up and its proof

1. Unfeature everything featured (Ads › Creative toggle, or B4).
2. Settings › Team: **Remove from workspace** → **Confirm removal** for the temporary member; **Revoke** any pending
   invite.
3. Auth administrator retires the temporary sign-in (delete or ban) and removes its runner credential.
4. Studio Publish panel → **Unpublish** the QA form.
5. Pictures, ad copy, the QA pipeline, contacts, deals and submissions: retained as labelled synthetic fixtures
   (decision 3); record their ids, creation times and custodian in ANT-21.

Proof (service role; paste results into ANT-21):
```sql
select user_id, role, is_owner, status from tenant_members where tenant_id = :'qa_workspace';  -- owner only
select count(*) from marketing_content where tenant_id = :'qa_workspace' and meta->>'ads_featured' = 'true';  -- 0
select id, revoked_at, archived_at, uses from tenant_invite_tokens where tenant_id = :'qa_workspace';  -- none pending: used, revoked or archived
select id, deleted_at, banned_until from auth.users where id = :'temp_member';  -- no row, or deleted_at / banned_until set
select count(*) from pipelines where tenant_id = :'agency_preview';  -- 0, unchanged
select id, status from growth_forms where tenant_id = :'qa_workspace';  -- draft (unpublished)
-- retained synthetic fixtures, for the ANT-21 register:
select id, kind, channel, title, status, created_at from marketing_content where tenant_id = :'qa_workspace' order by created_at;
select id, name, is_default, lifecycle_status, created_at from pipelines where tenant_id = :'qa_workspace';
select id, form_id, contact_id, deal_id, utm_json, created_at from growth_form_submissions where tenant_id = :'qa_workspace';
```
