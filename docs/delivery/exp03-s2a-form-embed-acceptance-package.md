# Experience 03 S2a — a Studio form on the business's own website: §32.c authenticated acceptance package

Date: 2026-10-13 · Journey record: `docs/delivery/exp03-grow-my-business-journey.md` §11 and §11a · PR #2088 ·
UI evidence: `docs/evidence/ui-delivery/exp03-s2a-form-embed.md` · Install guide:
`docs/guides/put-a-paige-form-on-a-cloudflare-or-genspark-site.md`. For the dedicated Codex QA coordinator.

**Status: PREPARED, NOT EXECUTED.**
- No signed-in production run has happened yet.
- This file says what to run, what counts as a pass, and what is already proven without a sign-in.
- **Anything unavailable is recorded as unavailable, never passed.**

## Identity — the designated account (ANT-52; do not create others)

- **The account:** Antonio Cook's existing SOLO customer account, designated by the owner as the official test account
  (owner directive of 2026-10-12, recorded in ANT-21). ANT-21 holds the account register; ANT-52 holds this package's
  execution results. PC-1 is retired and is not used.
  - The run uses **only the standalone business the account owns**. The same sign-in is also an admin of a different,
    real business; that business is never selected. The runner confirms the owned business is the active workspace
    before step 1 and records its id against the ANT-21 register entry. Below, `:acct_user` and `:acct_workspace`
    stand for them.
  - No other account, member or workspace is created for this package.
- **Credentials:** the account signs in with Google only (it has no password), so the runner gets an owner-performed
  ordinary Google sign-in or a signed-in session handed over privately (`storageState`). Never printed, logged or
  screenshotted. *(Corrected 2026-10-13: an earlier version named `LIVE_DRIVE_EMAIL` / `LIVE_DRIVE_PASSWORD`, which
  this account cannot use.)*
- **This is the owner's real business account.** The run adds only labelled synthetic records (one form, one campaign
  brief if none suitable exists, one test submission and its contact and deal). It changes none of the owner's
  existing forms, pipelines, processes, memberships, subscriptions or provider connections. If a step would need such
  a change, stop and report it.

## Before anything is submitted — the no-send precondition (blocking)

A submission files a contact and a deal. Anything set to act on that (a form's notify setting, a stage automation, a
live process) could send a real email or text. The run must not cause a real customer communication.

| # | Check (read-only) | Pass when |
|---|---|---|
| P1 | The synthetic form's **Settings › notify** | **Off.** The owned business has a live sending connection, so any notify address would send a real email. *(Corrected 2026-10-13 from "Off, or only the owner's own address".)* |
| P2 | Stage automations on the pipeline the form or campaign files into | None that sends to the lead. If one exists, **do not change it**: use a pipeline without one, or stop and report D as UNAVAILABLE |
| P3 | Processes scoped to the form or `form.submitted` | None live. Never switch one on |
| P4 | The test lead's address | `qa-s2a-1@tests.invalid` and no phone number. This is a backstop, not the no-send control: P1–P3 are the control |

## Already proven without a sign-in (do not re-run as acceptance; cite)

| Proof | Evidence class | Result |
|---|---|---|
| Studio panel: code only for a live form, the exact tag, copy, clipboard refused, the no-script view | rendered harness (`drive-embed-code.mjs`) | 112/112 |
| The real app framed by a site on another origin (Supabase stubbed) | rendered, cross-origin (`form-embed-drive.mjs`) | 71/71 |
| A Genspark-style site on Cloudflare's own Pages runtime: head placement, Rocket Loader, CSP, sandbox, report-only CSP, the fallback and booking buttons on light and dark pages | rendered, `wrangler pages dev` (`cloudflare-embed-drive.mjs`) | 80/80 |
| The sent answer through the real intake rules and the real DB path: own business, `form_and_tag`, campaign pipeline, owner's lead read, nothing for another business | database-level, isolated clone, rolled back (`form-embed-intake-replay.mjs`) | 9/9 |
| Production after the merge: published `embed.js`, framable `/form`, intake origin allow-list | production readback (recorded in the master reference §4.0) | see that row |

None of these is authenticated runtime. That is what this package is for.

## Runner runbook — fixtures (owner signed in, Solo)

0. **Pipeline:** the owned business has no pipeline. If the form or campaign needs one, create one labelled
   `QA S2a synthetic pipeline` with no stage automations, and record its id.
1. **Campaign:** Marketing › Campaigns. Reuse a campaign brief labelled synthetic if one exists; otherwise **Create
   campaign brief** named `QA S2a synthetic`. Record its reference (`short_ref`) as `:qa_ref`.
2. **Form:** Marketing → Vibe Studio → "A short lead form named QA S2a synthetic lead form asking for name and email"
   → **Build it** → **Publish** → **Publish now**. Record the form id as `:form_id`.
3. **Uses:** in the campaign's dossier, **What this campaign uses** → add the form.
4. Run P1–P4 above. Any failure stops D.

## Acceptance run

Record for each step: date and time, actor, what was done, a screenshot, and the readback.

### A. Owner, Vibe Studio — getting the code

| # | Do | Pass when |
|---|---|---|
| A1 | Open the published form's **Publish** panel | **Put it on your website** shows the code, Copy code, where to paste it, and what unpublishing does |
| A2 | Read the code | `<script src="https://paigeagent.ai/embed.js" data-form=":form_id" data-title="QA S2a synthetic lead form" data-cfasync="false" async></script>`. **The origin is `https://paigeagent.ai`, never `localhost`, `127.0.0.1` or a `vercel.app` preview** |
| A3 | **Copy code**, paste into a text editor | Identical to A2 |
| A4 | **Get a version without a script** | An `<iframe src="https://paigeagent.ai/form/:form_id?embed=1" …>` with the caveat that it doesn't resize or carry campaign tags; **Use the first code** returns to A2 |
| A5 | Keyboard only | Tab reaches Copy code with a visible ring; Enter copies |

### B. A visitor on the business's own site

The host page is any page outside Paige carrying the A3 code, for example a local file served with
`npx serve` (the host's address does not matter: answers are sent from inside the frame, from `paigeagent.ai`).
`growth-public-submit` does not refuse automation, so Playwright may drive B; signed out, in a fresh context.

| # | Do | Pass when |
|---|---|---|
| B1 | Open the host page with `?utm_source=qa&utm_campaign=:qa_ref&ref=host` | The form shows in place, no inner scrollbar; the frame's address carries `utm_source` and `utm_campaign` and **not** `ref` |
| B2 | At 390px | No sideways scroll on the host page |
| B3 | Send with the email empty | Refused in the form; nothing sent |
| B4 | Send `QA S2a Lead One` / `qa-s2a-1@tests.invalid` | The thank-you shows inside the frame |
| B5 | Readback (service role or the owner's own reads) | One `growth_form_submissions` row: `tenant_id = :acct_workspace`, `form_id = :form_id`, `campaign_attribution = 'form_and_tag'`, the campaign's id |
| B6 | After the processor runs | One deal in the campaign's pipeline, first open stage; `get_campaign_brief_leads` as the owner lists it with the form's name, pipeline and stage. Campaign page › leads shows it |
| B7 | P1–P3 after the fact | No email or text was sent to the lead (provider logs or the comms ledger for that contact: none) |

### C. Fallbacks on a host page that refuses the frame

| # | Do | Pass when |
|---|---|---|
| C1 | Host page with `Content-Security-Policy: frame-src 'none'` (meta tag or header) and the code | An **Open the form** button in place of the frame; it opens `/form/:form_id` with the tags; the console names `frame-src` |
| C2 | The same with `Content-Security-Policy-Report-Only` | The form stays and works |
| C3 | The code inside `<iframe sandbox="allow-scripts allow-popups" srcdoc="…">` | **Open the form** button; nothing sent from inside the sandbox |
| C4 | `data-theme="dark"` on a dark page | The dark-look card; the fallback button is white with indigo text |

### D. Unpublish

| # | Do | Pass when |
|---|---|---|
| D1 | Unpublish the synthetic form in Studio | The host page shows "This form isn't available right now" |

### E. A real Genspark-built or Cloudflare-hosted site — owner's choice only

Only if the owner chooses to paste the code on one of his own sites (Paige connects to no Cloudflare account). Run B1,
B4 and B5 there and record the site's address and hosting. If he does not, E stays **UNVERIFIED**, and so do Cloudflare's
live edge and `Cross-Origin-Embedder-Policy: require-corp`.

## Evidence ledger — signed-in runner results

(empty; one row per executed step: date/time, actor, action, screenshot, readback)

## Clean-up

Unpublish the synthetic form (D1). The form, the submission, its contact and deal, and the campaign brief stay in the
account labelled synthetic unless the owner rules otherwise; their ids are recorded in ANT-52 against the ANT-21 register entry.
