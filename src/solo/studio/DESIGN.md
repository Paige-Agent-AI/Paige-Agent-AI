---
name: "Vibe Studio — incumbent ink workspace"
description: "Scoped record of Studio chrome, canonical NEXUS identity and tenant-branded working stage."
colors:
  ink: "#0A0818"
  ink-2: "#110E24"
  panel: "rgba(255, 255, 255, .045)"
  panel-2: "rgba(255, 255, 255, .07)"
  line: "rgba(255, 255, 255, .12)"
  line-soft: "rgba(255, 255, 255, .08)"
  text: "#EDEAF7"
  dim: "#A49FC0"
  faint: "#8E89AD"
  violet: "#6549DB"
  violet-soft: "rgba(101, 73, 219, .18)"
  violet-line: "rgba(140, 115, 255, .55)"
  link: "#B9A8FF"
  good: "#4CC48C"
  bad: "#EB576B"
  gold: "var(--gold-bright, #F5C266)"
  gold-ink: "#2A1C00"
  nexus: "var(--pg-agent-nexus-fill, #c46dbd)"
  sheet: "#F6F5F1"
  sheet-ink: "#1B1A22"
  sheet-hint: "#6E6A80"
  sheet-line: "#D9D6CE"
  pop: "#161230"
  inspector: "#120F26"
typography:
  display:
    fontFamily: "Geist, Söhne, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(26px, 3.2vw, 38px)"
    letterSpacing: "-0.04em"
  identity:
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  compact-identity:
    fontSize: "12.5px"
  composer:
    fontSize: "15px"
    lineHeight: 1.55
  body:
    fontSize: "13.2px"
    lineHeight: 1.6
  control:
    fontSize: "12.8px"
  label:
    fontSize: "12px"
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11.6px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  context: "8px"
  control: "9px"
  segment: "10px"
  message: "12px"
  container: "14px"
  sheet: "16px"
  composer: "18px"
spacing:
  tight: "6px"
  compact: "8px"
  row: "12px"
  group: "14px"
  inset: "16px"
  stage: "24px"
components:
  button-secondary:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    typography: "{typography.control}"
  button-violet:
    backgroundColor: "{colors.violet}"
    textColor: "#fff"
    rounded: "{rounded.control}"
    padding: "0 12px"
  button-publish:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.gold-ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
  context-field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.context}"
    padding: "8px 10px"
---

# Design System: Vibe Studio — incumbent ink workspace

## Overview

**Creative North Star: "The incumbent Studio ink world"**

Studio is a working desk: quiet violet-black chrome surrounds a lit, tenant-branded artifact. NEXUS retains its original specialist identity while the conversation, saved work and version history share one workspace. This records the established system rather than choosing a new world.

This file applies to the Studio window rendered through `src/solo/vibe.tsx` and the Home, Session, Stage and inspector components in this directory. The repository root DESIGN.md explicitly excludes Studio. This scoped record does not govern Team Hub handoff surfaces, other SOLO departments, public marketing, or a tenant's published page design. PRODUCT.md supplies durable mobile, keyboard and reduced-motion commitments; its public Twilight identity is not Studio chrome authority.

**Key Characteristics:**
- Ink layers, translucent panels and hairline seams.
- Violet working states; gold publication authority.
- Canonical NEXUS glyph and agent color, separate from tenant branding.
- Bounded scroll regions and responsive panels around the real artifact.

## Colors

Warm pale text sits on cool ink; violet distinguishes working state, while tenant color belongs to the work itself. Frontmatter preserves the authored CSS values, including inherited color variables.

### Primary
- **Gold:** publication actions use the inherited gold-bright token with Studio's fallback. The live-with-no-pending-changes top action returns to the ordinary secondary treatment. Copy, export and domain guidance stay quiet.

### Secondary
- **Violet / violet-soft / violet-line / link:** build requests, choices, current versions, working indicators and links. Focus normally uses the source's lighter violet outline; conversion controls have a scoped link-colored outline.
- **NEXUS:** the existing agent fill variable colors the canonical Megaphone mark and name. Preserve theme inheritance rather than substituting Studio violet.

### Tertiary
- **Good / bad:** status and validation colors accompany words. A working step stays violet rather than claiming completion green.

### Neutral
- **Ink / ink-2 / panel / panel-2:** base chrome and progressively legible translucent surfaces.
- **Text / dim / faint:** primary reading, supporting context and secondary metadata.
- **Line / line-soft:** control boundaries and quieter structural divisions.
- **Sheet family:** lit form/build material, dark artifact ink and neutral field edges.
- **Pop / inspector:** opaque overlays that keep underlying work from competing with panel content.

### Named Rules
**The Publication Act Rule.** Spend gold on publication authority; keep convenience copies, domain guidance and ordinary editing controls quiet. Existing paid-media approval also uses gold for its explicit spending act.

**The Brand Boundary Rule.** Studio chrome keeps its ink world; the artifact renders with the selected business brand and saved page theme.

## Typography

**Display Font:** Geist with the inherited Söhne and platform fallbacks from `src/solo/solo-tokens.css`.
**Body Font:** the same inherited `--font` stack.
**Data Font:** the local monospace stack for code wells; step timestamps use the shorter `ui-monospace, monospace` stack.

**Character:** compact sans typography keeps the controls subordinate to the work. Source comments naming Geist match the inherited token; the separate root SOLO design record's Schibsted roles do not replace Studio's stack.

### Hierarchy
- **Display:** fluid Home heading with tight tracking; it is not repeated on every panel.
- **Identity:** persistent Studio title; compact Session identity uses the smaller role. The canonical NEXUS name remains agent attribution, not a generic eyebrow pattern.
- **Composer:** larger Home request text; Session input uses body-sized text with a 1.5 line height.
- **Body:** formatted conversation at the body role; ordinary messages also use 13px with 1.55–1.6 line height.
- **Control / label:** compact action and field hierarchy, with section headings at 14.5px and panel headings at 13.4px.
- **Data:** code and timestamp content only. Tenant artifact typography is a separate authored layer.

## Layout

The fixed Studio window fills its host viewport and owns overflow. Home pairs a 248px rail with a scrolling main area. The centered Home request region has a 760px maximum; saved-work sections have a 1080px maximum and an auto-fill grid with 220px minimum cards.

Session uses a content-sized top bar with a 54px minimum, a flexible body and an auto-height version strip. Chat is 352px beside the flexible stage. Context is capped at 45% of chat; the conversation and stage scroll independently. The original project title and save status stay grouped. Version cards scroll horizontally. The stage uses 24px/28px/40px insets, with a 600px maximum form sheet and a 1080px maximum page frame. This is the implemented composition, not a promised fixed 112px timeline.

At 980px and below, Home's rail becomes a compact two-row header that retains the full canonical Studio/NEXUS identity. Session's header reorganizes into identity, project/status and action rows. Chat becomes a left overlay (`min(380px, 92vw)`); the closed panel is hidden from interaction. Inspector becomes a right overlay (`min(340px, 92vw)`) instead of the desktop 320px inset panel. At 600px and below the compact Session identity hides its Studio label while retaining NEXUS and its glyph; Home retains both identity labels. Restore respects the bottom safe area.

Business context fields stack below a 400px container or a 600px viewport. Context choices gain a 44px minimum on coarse pointers. Top-bar actions and conversion controls already use 44px targets; compact legacy controls elsewhere are not evidence for extending smaller targets. Conversion header/footer stay sticky within the inspector. Its mobile height is bounded to the stage; validation focuses without scrolling ancestors and reveals fields through that inspector alone. Publish panels cap height to `calc(100dvh - 62px)` and scroll internally for short viewports and zoom.

## Elevation & Depth

Fine borders and translucent fills distinguish normal chrome. Soft shadows lift the lit sheet, publication panel, mobile chat and restore control. The stage's subtle 18px dot grid and Home's radial ink lighting are native Studio materials, not reasons to add decoration to every container. Exact shadow and motion vocabulary lives in the sidecar.

## Shapes

Controls use gently rounded corners, while composers, saved-work cards and lit sheets get more generous curves. Segmented controls inset rounded selections inside a shared outline. Status uses a small circular dot with readable state text. Library SVG icons retain their stroke language; canonical NEXUS uses `AgentGlyph agent="nexus"`, whose source maps to Lucide Megaphone. Do not replace it with a character glyph or a newly drawn mark.

## Components

### Buttons
- Ordinary controls use translucent fill and a hairline edge; hover brightens the fill. Quiet controls are transparent with dim text.
- Violet controls carry building and editing actions; hover uses the source's brighter violet. Gold publication controls increase brightness on hover. Disabled controls reduce opacity and stop inviting interaction.
- Visible focus normally uses a 2px lighter-violet outline with 2px offset. Conversion controls use the link token with 3px offset; restore retains its agent-colored treatment.

### Chips
- Prompt chips have the control radius and panel fill. Selected choices and current versions use violet-soft fill and violet-line edges. Status remains readable as text.

### Cards / Containers
- Saved-work cards use ink-2, rounded container corners and a violet-line hover edge. Their image is a real image, saved-work render or honest empty sheet.
- The conversation brief and saved context use compact disclosures rather than new dashboard chrome. The brief uses a Lucide chevron; open state rotates it and reduced motion removes the transition.
- Version cards show current state with violet. The publish panel carries readiness, confirmation and receipts without inventing success states.

### Inputs / Fields
- Home's large translucent request composer and Session's smaller chat box use transparent textareas within a bounded border.
- Context fields use panel fill, ink text and inherited font; conversion fields use panel-2, a 44px minimum and a visible focus outline. Invalid fields use the bad token and accompanying error text.
- Context source values wrap anywhere. Conversion help, errors and receipts wrap rather than widening their panel.

### Navigation
- Rail items use transparent rest, panel hover and panel-2 current state. Device choices use `aria-pressed`; versions use `aria-current`.
- Minimize retains the same mounted project and exposes a labeled Restore Studio action. Window closure/minimize returns focus to a valid original launcher. Hidden panels must stay outside keyboard reach.

### Branded Stage and NEXUS Arrival
- Render saved forms and pages with the selected brand floor and actual page theme through the existing Stage/LivePreview path. Keep an unsaved preview visibly distinct from saved work.
- The short NEXUS arrival uses a 240ms fade/4px rise and resolves into persistent identity. Source state consumes it after the first arrival; restore must not restart it.
- Build drawing, light sweeps, pulse, spinner, toggle and chat-slide motion are enabled only when motion is welcome. Reduced motion retains static work and status; arrival and brief transitions explicitly turn off.

## Do's and Don'ts

### Do:
- **Do** preserve the canonical NEXUS Megaphone and inherited agent color.
- **Do** keep the original project title, save status and truthful receipt states readable.
- **Do** preserve panel scroll ownership, wrapping, visible focus and reduced-motion alternatives.
- **Do** render the selected business brand on the artifact through the existing preview path.

### Don't:
- **Don't** use gold for export, copy, domain guidance or routine editing.
- **Don't** apply this scoped record to other SOLO departments or tenant page styling.
- **Don't** replace the established identity with invented glyphs or decorative kickers.
- **Don't** turn a preview, source capture or static component sample into authenticated publication evidence.

Source record: `studio.css`, `studio-business-context.css`, `PageConversionSettings.css`, `NexusIdentity.tsx`, `StudioHome.tsx`, `StudioSession.tsx`, `StudioStage.tsx`, `StudioWindowHost.tsx`, `../vibe.tsx`, `../solo-tokens.css` and `../team-hub/TeamHubAgents.tsx`, reconciled with both repository surface briefs. The scoped sidecar extends this frontmatter; generated tonal strips are preview metadata, not new authored colors. No global config, root design record or UI source is changed by this record.

Not canonized or repaired: legacy miniature preview text and compact controls, optional brief-field focus suppression, and any incidental uppercase teaser/eyebrow styling remain source-level craft/legibility debt, not reusable system rules. This source extraction adds no new browser, authenticated, deployment or owner-acceptance proof.
