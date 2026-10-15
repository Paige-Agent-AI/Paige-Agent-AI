---
name: "Paige SOLO — sampled workspace system"
description: "Existing Obsidian and Mineral controls, extracted from SOLO source and the prepared weekly extension."
colors:
  obsidian-canvas: "#100e14"
  obsidian-workspace: "#16131a"
  obsidian-surface: "#19161e"
  obsidian-raised: "#211d27"
  obsidian-ink: "#f6f2ea"
  obsidian-muted: "#aca69d"
  obsidian-line: "rgba(244,237,222,.195)"
  obsidian-violet: "#9b8de0"
  obsidian-gold-core: "#fff0cf"
  obsidian-gold: "#ead5aa"
  mineral-canvas: "#fbf9f5"
  mineral-workspace: "#f7f4ee"
  mineral-surface: "#f5f2ec"
  mineral-raised: "#fffdf8"
  mineral-ink: "#201e23"
  mineral-muted: "#67616b"
  mineral-line: "rgba(45,40,50,.185)"
  mineral-violet: "#655a96"
  mineral-gold-core: "#6f5636"
  mineral-gold: "#8b7049"
typography:
  title:
    fontFamily: "Schibsted Grotesk, Segoe UI Variable Display, SF Pro Display, system-ui, sans-serif"
    fontSize: "21px"
  lead:
    fontFamily: "Schibsted Grotesk, Segoe UI Variable Display, SF Pro Display, system-ui, sans-serif"
    fontSize: "16px"
  body:
    fontFamily: "Schibsted Grotesk, Segoe UI Variable Text, SF Pro Text, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "-0.002em"
  compact-body:
    fontSize: "13px"
  label:
    fontSize: "11px"
  weekly-heading:
    fontSize: "20px"
    fontWeight: 650
    letterSpacing: "-0.02em"
  weekly-section:
    fontSize: "16px"
    fontWeight: 600
  weekly-schedule:
    fontSize: "18px"
    fontWeight: 550
  weekly-label:
    fontSize: "12px"
rounded:
  plate: "13px"
  chip: "9px"
  seal: "11px"
  pill: "999px"
  weekly-control: "8px"
  weekly-field: "6px"
  weekly-state: "5px"
spacing:
  tight: "4px"
  compact: "8px"
  row: "12px"
  group: "16px"
  section: "24px"
components:
  weekly-primary-obsidian:
    backgroundColor: "{colors.obsidian-ink}"
    textColor: "{colors.obsidian-canvas}"
    rounded: "{rounded.weekly-control}"
    padding: "8px 12px"
  weekly-primary-mineral:
    backgroundColor: "{colors.mineral-ink}"
    textColor: "{colors.mineral-canvas}"
    rounded: "{rounded.weekly-control}"
    padding: "8px 12px"
  weekly-field-obsidian:
    backgroundColor: "{colors.obsidian-canvas}"
    textColor: "{colors.obsidian-ink}"
    rounded: "{rounded.weekly-field}"
    padding: "8px"
---

# Design System: Paige SOLO — sampled workspace system

## Overview

**Creative North Star: "The existing SOLO workspace"**

This is an extraction of the incumbent Obsidian and Mineral workspace, not a new visual identity. Its boundary is the sampled native Chat, Calendar, Operations and weekly responsibility UI. It supplies no design authority for unseen product areas, the public site, Studio or other shells.

Schibsted Grotesk, warm ink, quiet tonal layers and compact controls keep the working surface readable. The weekly extension fits this language with plain divided rows, a familiar right sheet and explicit status text. The existing direction contract supplies the identity; no new metaphor or branding has been chosen.

**Key Characteristics:**
- Two separately authored themes, selected through the existing theme root.
- Tonal workspace depth and restrained seams.
- Compact working controls with visible keyboard focus.
- Original work stays in its existing native surface.

## Colors

Obsidian uses warm ink over violet-black layers; Mineral uses dark ink over warm paper. The frontmatter preserves the canonical hex and rgba values from `src/index.css`.

### Primary
- **Champagne / bronze:** the existing gold family carries native link and authority accents; it is not the weekly proposal button fill.

### Secondary
- **Violet:** the shared focus and supporting accent family. Native Operations uses it for focus.

### Neutral
- **Canvas / workspace / surface / raised:** distinct layers for working context and elevated controls.
- **Ink / muted:** primary reading and secondary context.
- **Line:** theme-specific translucent divider and control edge.

### Named Rules
**The Theme Root Rule.** Resolve component color through the existing `--pg-*` theme root; preserve each theme's authored roles.

## Typography

**Display Font:** Schibsted Grotesk with the existing platform fallbacks.
**Body Font:** Schibsted Grotesk with the existing text fallbacks.

**Character:** One face connects headers, controls and prose. The shared label/body/lead/title tokens coexist with local component sizes; the record does not pretend every existing surface follows one exclusive ladder.

### Hierarchy
- **Title:** shared title token for surface headings; weekly headings use the scoped weekly-heading role.
- **Lead:** shared lead and weekly-section roles establish section hierarchy.
- **Body:** root reading style; compact-body supports dense native controls and Operations detail.
- **Label:** shared small labels; weekly-label is the larger scoped status/freshness role.
- **Schedule:** weekly-schedule emphasizes a readable schedule within the inspection panel.

### Named Rules
**The Prose Figures Rule.** Keep tabular numerals on figures rather than prose; the global stylesheet explicitly records why full-width punctuation must not spread into sentences.

## Layout

The shell bounds the workspace. Calendar gives its grid, rail and drawer explicit scroll ownership; Operations scrolls its body and inspector. The weekly sheet uses a bounded width of `min(100%,600px)` and vertical overflow. The shared sheet supplies 16px padding below its 640px breakpoint and 24px above it.

Weekly facts pair a 115px label column with a flexible value column, then stack below 480px. Action rows wrap. The proposal form uses two flexible columns and a full-width zone field. Paragraphs have a 70ch maximum; receipt values wrap anywhere. A chat-header container query at 360px hides the entry label while retaining its accessible name and a 44px square action. Operations adapts below 600px and gives very short viewports a whole-department scroll owner.

The reused spacing rhythm groups related content tightly and separates sections with the larger section step. These are observed patterns, not a new universal grid.

## Elevation & Depth

The incumbent system combines tonal layers, fine edges and soft offset shadows. Its shared elevation vocabulary remains in `src/index.css`; the sidecar extracts the sampled low elevation and sheet shadow. The weekly article itself uses a divider, with no invented floating card. In Mineral, artifact paper and a raised surface share a fill; source comments establish that edge and elevation distinguish them.

### Named Rules
**The Existing Depth Rule.** Select the incumbent layer or elevation needed by the component; do not invent a new palette to distinguish a native sheet or menu.

## Shapes

Shared plate, chip, seal and pill tokens remain available to native controls. The weekly extension uses its scoped control, field and state radii from the frontmatter. Divided article rows preserve the open workspace form. Library SVG icons share the existing interface stroke language; text arrows in navigation remain text, not substitute icons.

## Components

### Buttons
- Weekly primary buttons use inverse ink/canvas colors. Hover retains both colors and reduces opacity to .85. Secondary buttons use a transparent fill, a line edge and raised hover fill.
- Weekly controls have a 40px minimum height; the narrow chat entry has a 44px minimum. Disabled controls use .6 opacity and a not-allowed cursor.
- Native Calendar controls use the shared chip shape and compact body role; Operations controls use their established local shape. Their existence does not make every action gold.

### Chips
- The weekly state label uses a quiet line edge, compact padding and readable text. It reports state through words; it does not invent a new semantic color mapping.

### Cards / Containers
- Weekly responsibilities are open article rows divided by the theme line. Notices use a raised fill and the local control radius.
- The native right sheet contains long evidence. Keep scroll ownership inside the bounded sheet.

### Inputs / Fields
- Weekly fields use canvas fill, ink text and a muted token border; they retain browser-native time/select behavior and inherited color scheme.
- Fields have a 44px minimum height. Weekly keyboard focus uses a 2px ink outline with 3px offset; this is a scoped exception to the shared violet focus rule.

### Navigation
- Weekly source navigation is underlined with a 3px underline offset and wraps with the action row. It opens native Calendar and Operations routes.
- Sampled Operations navigation uses a raised selected fill and line edge. No replacement shell or additional primary navigation is established here.

## Do's and Don'ts

### Do:
- **Do** inherit the existing theme, face and layer vocabulary.
- **Do** preserve readable state words, wrapping identifiers and explicit scroll ownership.
- **Do** preserve the native library icons and visible focus treatment.
- **Do** keep local weekly sizes and shapes scoped to that component family.

### Don't:
- **Don't** apply this sampled record as authority for unseen product areas.
- **Don't** turn an inspection or proposal control into a gold completion signal merely for decoration.
- **Don't** promote pre-existing contrast, focus or typography drift into a reusable rule.

Not canonized: Calendar's local gold focus, root-wide tabular numerals and 10px note text diverge from the shared source guidance; the broader public-site PRODUCT.md record is not SOLO visual authority. These pre-existing differences are reported without source repairs. The sidecar's synthesized tonal strips are preview metadata, not additional authored palette tokens. This record certifies no authenticated behavior, activation, owner acceptance or independent source review.
