# Experience 04 — Engagement panel (review prototype)

The screen that answers *"what's the status of this client, what have they paid, what do they still
owe, and is their work on schedule?"* This folder is a **prototype for the owner's UI approval**, not
production code. Nothing in this folder is imported by the app. (The same PR also carries the read, composer and
unmounted data hook it renders from; those live under `supabase/` and `src/solo/engagement/`.)

- `prototype.html`: one self-contained page. `states.json` is inlined verbatim as `STATES`. The only
  network request is Google Fonts. A reviewer toolbar switches the state (populated · early · empty ·
  loading · error · no access), the theme (light · dark) and the view (desktop drawer · mobile sheet).
  URL parameters do the same: `?state=early&theme=dark&view=mobile&bare=1`.
- `render.mjs`: renders the frames with Playwright, each at the drawer's full height.
- `checks.mjs`: measures WCAG contrast and runs a keyboard test. Results go to `contrast-results.json`.

## Frames

| Frame | What it shows |
|---|---|
| `populated-desktop-light.png` / `-dark.png` | The $3,500 consulting engagement: signed agreement, 5 attention items, progress against the agreement, separate paid figures, $300 test-mode payment, the 11-row schedule (the two payments due so far plus the next one; the other 8 fold behind one line), 2 issued invoices plus a draft and a void, delivery 1 of 3 done with 1 overdue. |
| `populated-mobile-light.png` / `-dark.png` | The same engagement as a full-height sheet at 390px. |
| `early-desktop-light.png` | Agreement sent but not signed, the agreement invoiced with the deposit and first instalment past due, nothing paid, no work yet. |
| `empty-desktop-light.png` | A client with no engagement. The empty state explains what this panel will show and offers one way forward: Open in Sales. |
| `error-desktop-light.png` | "This client's status could not be read." plus Try again. In the prototype, retry goes to loading and then to the populated state. |
| `refused-desktop-light.png` | "Only the business owner or an admin can see payments for this client." |
| `loading-desktop-light.png`, `early-mobile-dark.png` | Extra frames for review. Loading uses a skeleton, not a spinner. |

## Token values reused from the real app

- **Both themes:** copied from `src/index.css` L244–318 (`[data-pg="dark"]` Obsidian, `[data-pg="light"]` Mineral). This covers the env/workspace/surface/raised ladder, ink/muted/faint, positive/warning/negative/violet, lines, the `--pg-lift-*` elevation, and radii 13/9/999.
- **Type:** the four-step scale 11/13/16/21 (`--pg-t-*`, `src/index.css` L183–186), body text 14/1.55, Schibsted Grotesk for the interface and JetBrains Mono only for invoice numbers (L159–163).
- **Focus ring:** indigo `--ring` = `--pg-violet` (#655a96 light / #9b8de0 dark), per the 2026-10-05 ruling at `src/index.css` L384/413. It is never gold.
- **`--pg-r-panel`:** `src/solo/settings.css:15`. The prototype adds two values of its own: `--scrim`, and `--well` for a recessed panel (= `--pg-surface` in light, #17141b in dark).
- **Drawer behaviour:** mirrors `src/solo/detail-drawer.tsx`. It opens with a scrim, focus moves to Close, Tab stays inside the drawer, Esc closes it, focus goes back to the row that opened it, and the background is inert.

## Contrast (measured, `checks.mjs`)

50 pairs checked across both themes, with **0 failures**.
- **Lowest text pair in light:** 4.54:1 (warning on the recessed panel).
- **Lowest text pair in dark:** 5.01:1 (violet chip text on its tint).
- **Ink on raised:** 16.25 (light) and 14.81 (dark).
- **Focus ring on raised:** 5.98 (light) and 5.73 (dark).

The first measurement failed two pairs, and both were fixed:
- Warning chip text on its 10% tint was 4.40:1. The tint is now 6%, giving 4.63:1.
- The "invoiced, not paid" bar segment was 2.44:1 against its track. It now uses the full violet token, giving 5.44:1.

Two non-text results are accepted and noted:
- **Bar segments next to each other:** violet against green is only 1.09:1 by luminance in light. The segments are told apart by hue, a 1px gap, and the hatch on "recorded by you". Every segment also has its value written in the legend.
- **Button borders:** `--pg-line-strong` against raised is 1.76:1 in light, which is the real app's value. Every button also carries a text label or a full-contrast icon.

The keyboard test passed every check: Esc closes, focus returns to the row, Enter reopens, Tab stays inside the drawer, the stage links focus the section heading, and retry goes to loading and then resolves.

## Impeccable rules applied (OPERATE mode)

- **No banner.** The header is compact: the 21px client name, the offer, a one-line summary, and the five stages. The work starts above the fold.
- **Gold is spent on nothing.** This slice is read-only, so it has no act or approval moment. "Open in Sales" is navigation, so it uses the neutral button.
- **Craft-floor refusals applied:**
  - no labels above headings and no section numbers;
  - no cards inside cards (sections are divided by hairlines, with recessed panels only for the money breakdown);
  - no coloured side stripes;
  - no big-number dashboard template (money is shown as label-and-amount rows);
  - drawn SVG icons in one stroke width, never emoji.
- **Browser defaults are themed:** text selection, scrollbars, focus ring and the caret.
- **Tabular figures only in money columns that line up.** Applied everywhere, Schibsted's tabular comma renders as "Aug 28 , 2026" and "$2 ,400" (the defect `src/index.css` L192–209 records). The first render showed exactly that, and it is fixed.
- **Light and dark are written separately,** and in each the depth comes from elevation and hairlines.
- **Motion:** the drawer slides in over 240ms with an ease-out curve. Turning on reduced motion removes it, and also removes the skeleton shimmer and smooth scrolling.

## The honesty rules, and how the design keeps them

- **Verified, recorded and test money are never added together.** Provider-confirmed money and money you recorded are separate rows, with no total, and the stage line names both ("Against $3,500 agreed: $100 confirmed by your provider and $500 recorded by you"). Test money sits in a dashed "Test payment — not real money" note with its amount struck through, and it is left out of every figure.
- **The agreed schedule is not the invoices.** The Sales writer only lets an invoice name the terms if it carries the whole agreed amount, so a $3,500 invoice is not $3,500 due today. The bar measures progress against the schedule (paid, due by today and unpaid, not due yet), the contract invoice says "Paid over your agreed schedule" instead of a single due date, and its past-due figure comes from the schedule.
- **Payments that are in progress or have an unknown result are never shown as received.** They are labelled "Payment in progress — not received yet" and "Needs checking".
- **Disputes, refunds, the date the agreement takes effect, and which instalment a payment covers are said to be "not tracked yet".** They are never shown as zero.
- **Internal codes never reach the screen.** Codes such as `outcome_unknown` and `payment_request_failed` are turned into plain sentences.

## Deliberately not designed

- **No Send reminder, Charge or Mark paid button.** This slice reads data and changes nothing, and reminders will ask before anything is sent but aren't built. Follow-ups says so plainly.
- **No onboarding checklist.** Nothing tracks onboarding yet, so it shows a dashed "Not tracked yet — coming in a later release" note. I chose "Not tracked yet" over the brief's "Not started", because "Not started" claims something about the client that the data doesn't know.
- **No payment state on schedule rows.** Which invoice pays which instalment is not recorded, so a schedule row cannot honestly say "paid". Rows sit under "Due so far" or "Still to come", and payment states live on the invoices.

## Data fields that were unclear

1. **`failed_request_count` (1):** the composed status gives a count but no invoice. The attention line says "1 payment request failed. Nothing was collected from it." and names no invoice.
2. **`awaiting_confirmation`:** the brief describes it as "awaiting the client", but `status.ts` describes it as a live payment request still in progress. The copy says "Payment in progress — not received until your provider confirms" rather than assuming the client still has to act.
3. **`reversal_count` (1):** this is not one of the attention items, and the data doesn't say which payment was reversed. It appears as a footnote: "1 payment record was reversed and is already left out of the figures above". This relies on `recorded_by_owner_minor` being net of reversals, which `status.ts` documents.
4. **Money received against the agreement** now comes from the composer (`received_against_terms`). The page still cross-checks it against `due_to_date − behind_schedule` (both $600 here) and logs any mismatch.
5. **E4-0001 carries a $300 test-mode payment.** It is shown on that invoice and left out of every figure; what is owed on it ignores it.
6. **`states.json` is generated, not hand-written.** `compose-states.mts` builds it from the real read fixture through the shared composer.
