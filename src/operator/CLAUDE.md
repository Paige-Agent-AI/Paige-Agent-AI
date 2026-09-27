# The operator console — working notes for any session under `src/operator/`.

This file auto-loads for any session working under `src/operator/`. That is deliberate: a rule that
lives in a doc someone has to remember to open is a rule that gets skipped. Nothing here needs
looking up — it is already in your context.

**§58 record — what was struck from this file on 2026-09-27, and why.** Until then this file opened
with "THE LOCK": the Claude Design pack *was* the design, verbatim and frozen, deviations needed an
owner instruction, and open design questions were to be taken to Claude Design. Root `CLAUDE.md`
§00 (owner ruling, 2026-09-22) removed Claude Design from the loop and voids any rule that hands
interface authority to a party other than CC + the owner, **deleted on sight rather than
reconciled**. Those lines are gone. What survives is below: where the pack lives (as reference),
the evidence discipline, and the engineering lessons this console paid for.

---

## Where the v3 pack lives — REFERENCE, not authority

```
docs/design-references/cd-packs/super-admin-shell-v3/     <-- the current reference pack
    PAIGE Super Admin Shell v3.dc.html    11,358 lines — the shell
    PAIGE Platform Operator - standalone.html            — the standalone render
    design-system-port.md                 the --pg-* system, the faces, the Command Mark
    paige-brand-identity.md · absence-copy.md · campaigns-catalog-sales-spec.md
    paige-ia.js · mind-brain.js · support.js · github.md · corrections-2026-08-23.md
```

**`super-admin-shell/` (the ~8,300-line pack) and `agency-mode-shell/` are SUPERSEDED.** They are
kept only so a past decision can be traced. Do not build from them or diff against them.

**Search before claiming absence (§00 evidence discipline).** Before calling anything on an operator
surface missing, blocked, or undecided, grep the v3 pack for it — at least four spellings, and read
the region. It is an 11,358-line file and it contains far more than any one session has read.
Worked example, 2026-08-23: the command palette and six "unreachable" surfaces were about to be
scoped as a blocker; the pack carries 115 `summon` references, 24 `palette`, 3 `⌘K`, Calendar ×33,
Compose ×52, Integrations ×18. None of it was missing. **Something the pack already solves is prior
art to read before inventing a fourth variant (§18/§30) — never a blocker, and never an order.**

---

## UI AUTHORITY — see root `CLAUDE.md` §00. Flow-by-Flow, then Impeccable.

> **"Flow by Flow, then Impeccable. Impeccable is your priority when it comes to my user
> interface."** — Antonio, 2026-09-22

The full rule is root `CLAUDE.md` **§00**, which loads on every run and overrides every section
below it. The short form, because this file loads whenever a session touches `src/operator/`:

- **CC owns the interface — design and engineering both.** Flow-by-Flow decides what is built and
  which flows must work; Impeccable decides how it looks and behaves; the owner approves before
  production.
- **Impeccable's craft floor is binding**, not advisory. Read `reference/craft-floor.md`
  immediately before any UI edit, and treat its refuse-list as a real constraint.
- **A measurement is still a measurement.** Contrast, type sizes, grid tracks, a 404ing control, a
  surface that does not render — facts about whether it WORKS. CC reports them AND decides what to
  do about them.
- **A weak surface is CC's to raise and CC's to fix.** Bring the better design rather than waiting
  to be told.
- **Existing packs and prototypes are reference, not authority.** Read them before inventing a
  fourth variant of something already solved (§18/§30); they no longer outrank CC's judgement.
- **Subagents may judge the interface** against Impeccable's craft floor, and are expected to.

**Reversed 2026-09-22 by owner ruling (§58).** This block previously read "ZERO input on design"
and made Claude Design the deciding authority. The owner removed Claude Design from the loop.

An earlier version of this very section said CC "reports it, with a frame and a measurement, and
lets CD rule." That was still input, and it was corrected the same day. Zero means zero.

---

## "IS THIS THING A PLACE?" — the default answer is NO

CC has modelled the same mistake three times, and each time it arrived looking like a routing
question.

**In this shell, SIX SLOTS ARE PLACES. Almost nothing else is.** A capability that is not one of
the six is, by default, a **state** or a **surface** — something that changes what you are looking
at or what scope you are in — not an address you can navigate to, bookmark, or link.

**The three that turned out not to be places:**

| Modelled as | Actually is |
|---|---|
| `act-as` a tenant | a SCOPE CHANGE — the operator's session enters a tenant; the address does not become the tenant |
| agent runs | a SURFACE — work streams where you already are |
| **Paige** (`/operator/paige`) | **the SPINE.** A reference to her is not a route; it is an action that opens the spine and focuses the command bar — she is present in every surface. |

**The pack having no address for something is evidence worth weighing.** When no route exists for a
capability, the first hypothesis is that the capability is not a place — not that a route is
missing.

**The tell, and CC must watch for it in its own work:** if a later session finds itself wanting
`/operator/paige`, she has been modelled as a place again. Generalised — **if you are reaching for a
new top-level operator route to reach a capability, stop.** That reach is the symptom. A new slot
is an owner ruling (see `operatorIA.ts`).

**A control to a place that does not exist gets REMOVED, not repointed.** Not disabled, not left
dead, not pointed somewhere plausible: a control that opens an empty spine asserts a capability
that isn't there. Same reasoning as collapsing an empty spine to 0 —
applied to the control instead of the track. When the capability is genuinely wired, it returns as
a control (expand the spine, focus the command bar), never as a URL.

---

## VALUES ARE DATA — never a fixture

**Never comes over from any reference** — the pack's invented figures, tenant names (`Meridian`, `Ashford`,
`Harbor & Vine`), fake chat titles, token counts, timestamps, and written-in prose. Those are
fixtures. They render from a real read, or they render as an honest absence (`—`, or a stated gap).
Never a fabricated number or a real-sounding name (§13, §63).

An empty card is **not** the design. A stand-in paragraph where a surface belongs is **not**
the design. Both have already been shipped once and rejected.

---

## THE FOUR WAYS THIS HAS ACTUALLY GONE WRONG

Each of these shipped. Each was caught by the owner, not by us. Do not repeat them.

1. **The registry emitted one empty "not connected" card for all 78 tabs.** Everything typechecked,
   every test passed, every tab resolved a spec — and every screen was blank. *Counting keys proves
   the tree is addressed and proves nothing about what anyone sees.* Assert on rendered CONTENT.

2. **Components were imported and never rendered.** Six purpose-built surfaces (`CalendarMonth`,
   `SupportThread`, `ComposeSurface`, `MarketplaceReview`, `CalendarWeek`, `IntegrationsGrid`) were
   imported by `OperatorApp` and referenced nowhere, so those tabs showed the generic stand-in. An
   unused import still typechecks and still lints. `bespokeSlots.test.tsx` now pins the dispatch by
   name and RENDERS each panel — keep it that way.

3. **A picture of a working capability replaced the working capability (§58).** The pack draws a
   chat; the platform HAS a chat (voice, artifacts, thread history, streaming). Shipping the pack's
   static markup gave a beautiful dead surface.

4. **…so the next pass mounted the old component inside the pack's shell — and never stripped its
   wrapper (§30).** That is where the duplicate "New chat" button, the "Your Paige" hero card and the
   nested chat list came from. Nothing designed those; they are leftovers from a wrapper that should
   have been removed. The tell is exactly what §30 says: the surface *"feels like it's laying on top
   of the old design."*

**(3) and (4) are the same false choice made twice, in opposite directions.** The job is never
*the drawing OR the working engine.* It is **the designed surface RENDERED BY the working
engine** — build it as components and drive it from real state.
That is more work than either shortcut. It is the work.

---

## THE PACK HAS BEEN READ IN FULL — `docs/design-references/PACK-INVENTORY-v3.md`

**Owner instruction, 2026-08-23:** *"grep everything… let me know once you get to 100%"* ·
*"don't miss a single file"* · *"I want all of your findings, every single line of your
findings, inside of my code."*

All 18 pack files (3,678,312 bytes / 20,978 lines) are now read and inventoried in
`docs/design-references/PACK-INVENTORY-v3.md`. **Before claiming anything about this pack —
what it contains, what it omits, what is ported — read that file.** It carries:

- every one of the shell's **183 render blocks** and **249 `sc-for` collections**, in order;
- all **49 surface builders** with pack line counts and a measured port percentage
  (**442 of 1,774 authored strings present in `src/operator/` — 25%**);
- the full `renderVals` dispatch table, so every surface's guard is known;
- all **96 `paige-ia.js` catalogues** with exact item counts (evaluated, not estimated);
- the **13-rule fidelity contract**, CD's **18-round install plan**, and rulings **R1–R7**;
- **seven pack self-contradictions**, recorded (CC resolves them under Impeccable, §00).

Two facts from it that change how a session starts:

1. **`tenant-redesign-stage2-design-package.md` no longer carries a token set — CD stripped it
   at source (delivery 9, 2026-08-23), and the file was renamed at the same time.** §§1–3 are
   now one line pointing at `design-system-port.md`; §4's behavioural timings stay because they
   are spec, not a restatement. Port tokens from `design-system-port.md` or the shell itself.
2. **`PAIGE Platform Operator - standalone.html` is the same design, compiled.** Proven by
   unpacking its blobs and diffing. Screenshot target only; never a source.

---

## CROSS-REFERENCE IT FIRST. `npm run pack:keys <builder>` — before you port anything.

Reading a builder tells you what the pack **computes**. It does not tell you what the pack
**draws**, and those are not the same set. Porting Layer 5 I read `mindVals`, found `scratchBody`
— two fully authored ceiling arms sitting right beside the code keys — and drew it on the Code
face. The pack draws a tokenized editor there. `scratchBody` is rendered at NO site in the 11,358
lines, and neither is `sandboxActs`. An unrendered key became a shipped surface for an afternoon.

```
npm run pack:keys codeVals              which of its keys the markup actually renders
npm run pack:keys setupVals --verbose   every key, rendered or not
npm run pack:keys -- --all              every builder, dead keys only
npm run pack:keys -- --orphans          markup keys NO builder produces
```

- **DEAD** = computed, drawn nowhere. Do not port it blindly — a cut key, or a block that lost its
  markup — and never a licence to invent the surface it looks like it wants.
- **ORPHAN** = drawn, produced by nothing. It renders as empty. Never filled with invented figures
  (§13); the copy is CC's to write under Impeccable. The pass finds exactly `emptyLine`/`storeEmpty`
  — pack finding #9, which had been found by hand.
- **0 of N rendered** = almost certainly a HELPER whose return another builder consumes, not a
  dead surface. `kindMark` is the example.
- **Duplicate declarations are reported.** `alertVals` is declared twice and BUILD-ORDER says port
  the SECOND; `componentDidUpdate` is declared twice, which is finding #11 — the first is dead
  code, so the artifact never sticks the chat to its newest turn even though its own comment says
  it must.

`src/operator/packKeyXref.test.ts` pins the tool against both hand-found findings, and against
every false-positive class it had while being written. **Run it before a port, not after.**

## DRIVE IT. `npm run dev-loop` — every pass, not every other pass.

**Owner, 2026-08-23:** *"You're going to always need this tool, my friend. You're going to always
have to keep looping back and forth because if not, then you're just strictly working from memory,
and that never works out too well."*

```
npm run dev-loop                                        both sides, dark, 1600
node scripts/live-drive/dev-loop.mjs --at /operator/settings --theme light --w 900
node scripts/live-drive/dev-loop.mjs --ref-only         CD's reference alone
```

It shoots **the pack's reference render and our build side by side**, same viewport, same theme, and prints
measured geometry: grid tracks, rail width, spine width, which faces are showing, whether a
document scrollbar appeared, and any page errors. Ours needs `npm run dev` on 127.0.0.1:5199;
the reference needs nothing — `PAIGE Platform Operator - standalone.html` drives from `file://`
with every script and font inlined, offline, in any sandbox. It is a compiled artifact; never edit
it.

**Why this is a rule and not a convenience.** Every defect this console has been rejected for
passed `tsc`, `eslint` and the whole suite first: 78 tabs rendering one empty card; six purpose-
built surfaces imported and never rendered; four v3 ports reachable only from their own tests; a
spine collapsed to 0 with all its chrome built. **A green suite and a working screen are different
claims** (§32), and only one of them is what the owner opens.

- **A change to an operator surface is not done until it has been driven.** Not "should be" —
  is not.
- **The reference is the other half.** Two frames, one command, and the geometry line at the bottom
  does the compare.
- **It measures; CC judges.** Tracks, widths, faces, errors, whether a surface rendered at all are
  facts. Whether it is good enough is CC's call against Impeccable's craft floor (§00), and the
  owner approves what he sees.
- **Frames land in `scripts/live-drive/artifacts/`**, which is gitignored. They are evidence for
  a conversation, not a committed artifact.

---

## BEFORE YOU TOUCH AN OPERATOR SURFACE

1. **Flow-by-Flow, then Impeccable (§00).** Read the pack's block for that surface as reference
   evidence, not as an order.
2. **Wire the values to a real read** — or render the honest absence. Never a fixture.
3. **If a capability already exists, a drawing of it is the SKIN, never the replacement.** Strip the
   old wrapper (§30) rather than nesting it; compose the designed shell around the real engine.
4. **No duplicate chrome.** One "New chat", one chat list, one home per capability (§18/§21). If the
   pack's rail owns the list, the pane does not also draw one.
5. **Every control is real or honestly inert.** A control that silently does nothing is a defect —
   either wire it or have it say what it needs. (A `<span>` styled as an avatar with no menu behind
   it is how the operator ended up unable to sign out.)

## STILL BINDING

The constraints CC designs within (§00):

- **§13 honesty** — no invented figure or name, ever, including ones the pack itself contains.
- **§11 gold discipline** — gold is spent on the primary act only; never a resting border or tint.
- **§23 light AND dark** — token-only, AA in both. The owner runs light mode; check it there too.
- **§9/§51/§53** — what a surface may READ is decided by the server, never by the design. A reference
  may show a God-tier view; a scoped `platform_admin` still only sees what RLS permits.
- **§58** — never silently drop a shipped capability to make a surface match a drawing.

**The test, every time (§00):** *"Did I run Flow-by-Flow, then Impeccable — values real, absences
honest — and can the owner SEE and approve this before it ships?"*
