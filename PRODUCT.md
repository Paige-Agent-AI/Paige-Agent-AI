# Product

<!-- impeccable:product-schema 1 -->

> Design-tool record for the public site. Product truth itself lives in
> `docs/PAIGE-MASTER-PROJECT-REFERENCE.md` (§0: one source of truth); this file carries only what
> interface work needs and points there for everything else.

## Platform

web

## Users

Owners of client-service businesses — coaches, consultants, agencies, advisors, thought leaders,
anyone who sells their expertise to clients (CLAUDE.md §2: never narrowed to "coaching", never
"practice"). They run the business themselves, usually alone or with a small team, and lose their
week to the work between client sessions. On the public site they are first-time visitors who have
never heard of Paige, most often on a phone, often on poor signal. Inside the signed-in Solo
workspace they are daily users at desk and on phone, with the teammates they invite (admins and
members); their own clients reach the business only through a separate, client-scoped portal.

## Product Purpose

Paige is an AI chief operating officer for people who run client-service businesses. She does the
operational work — drafting the reply, the follow-up, the document, the social post, updating the
client record, booking the meeting — and the owner decides what goes out. Success: the owner gets
their week back without giving up control.

## Positioning

Not a dashboard, a workspace, or an assistant. An operator who works the seams between the tools a
business already pays for — the lead that never got a proposal, the proposal that never got a
follow-up, the client who signed and was never onboarded. Tools don't do work; a person does, and
Paige is that person. Cancelling subscriptions is a consequence, never the pitch. Competitors are
never named; only categories ("your CRM", "your scheduler", "your proposal tool").

## Operating Context

- One public offer: **Paige Solo — 30-day trial, then $74.50/month**, cancel before the first paid
  renewal. Enrollment runs `/` → `/auth` (signup) → `/onboarding` → Stripe checkout → `/welcome`,
  with `/pricing` checking the offer server-side. Login and Solo enrollment must never break.
- Agency, sub-account and enterprise accounts are not open; the Agency page is a waitlist only.
- Public host `paigeagent.ai`; app host `app.paigeagent.ai` (split currently off, same deployment).

## Capabilities and Constraints

Honesty line as of 2026-09-28 (grounded in master reference §4/§5 and the binding ledger; no
surface is yet customer-release-proven, so "live" below means deployed and usable by a Solo
customer today):

- **Live today:** Paige drafts email and follow-ups in the owner's brand voice and sends only
  after the owner approves; drafts documents and social copy (copy-ready, not posted); creates and
  updates contacts, notes and tasks; runs booking pages and books meetings; builds landing pages,
  funnels and lead forms in Vibe Studio and publishes them to a live link on the owner's say; gives
  growth advice from the owner's setup, pipeline and knowledge; keeps the Game Plan and week-to-year
  plans with milestones; researches the web with cited sources; reads the sales funnel from the
  owner's pipeline; connects Google Calendar, sending email and MCP servers; builds and runs n8n
  workflows with approval; turns form submissions into contacts, deals and alerts; Marketplace
  browsing. The public-site source of truth is `src/marketing/capabilities.ts`.
- **In build:** reading the owner's inbox directly; PDF export and signatures; posting and
  scheduling social; Studio image generation and on-page editing; marketing/campaign analytics and
  profit/retention tracking; actions inside MCP-connected tools; the secure browser session on
  vendor portals under the owner's own login; payments and invoicing through the owner's own
  processor; Marketplace installs; the visible specialist team she delegates to.
- **Not offered and never on the public site:** funding or credit (CLAUDE.md §2 — platform
  defaults never carry finance wording).

## Brand Commitments

- Name: **Paige Agent AI** (product: Paige). The **Command Mark** — champagne parallelogram slash
  plus detached orb, geometry fixed in `docs/brand/paige-brand-identity.md` — is approved for the
  public site and is the one constant across every page. Its current 3D rendering is not sacred;
  the mark must be unmistakable in half a second.
- Wordmark `PAIGE`, all caps, tracking 0.42em, never tighter.
- Mark motion: Dormant → Charged → Executed; Executed fires once, on a completed act, never as
  ambience.
- Headline positioning: the AI chief operating officer line leads. "RUN EVERYTHING" is the mark's
  motion payoff and the hero's second beat. "The command layer for modern business" is a category
  line for footer, about and investor contexts — never the first sentence.
- Champagne is spent on the act, never on surfaces (§11). The public site is one committed world,
  **Twilight** — deep navy lit with violet (owner ruling 2026-09-28, chosen over Midnight and
  Indigo). The app's Obsidian/Mineral pair is the dashboard's, not the site's.
- The Command Mark is the site's cursor: it types the hero headline and the closing run of
  commands, and executes when a line is written (`src/marketing/Command.tsx`).
- Voice (§3): direct, confident, mogul-founder. Never "AI-powered", "streamline", "seamless",
  "empower". Control is stated once, as a trust promise — the owner decides in the Trust Compass
  what she does on her own; anything sent to a customer, published, or changed in a connected tool
  waits for the owner's yes. Paige does far more than write: never frame her as a drafting tool.
- Paige has a non-human presence: a mark, a motion signature, a way she appears when working. No
  face, no avatar, no human stand-in.
- Trademark hygiene (§50): no pop-culture AI names anywhere.

## Evidence on Hand

- One real human face is permitted: Antonio Cook, founder, Atlanta — Freedom Writer, bestselling
  co-author — on the About page, from real photography he supplies. **Not yet supplied; the space
  stays empty until it is.**
- Testimonials: **none on hand.** No testimonial may be written or implied until Antonio supplies a
  real, named one.
- No customer counts, benchmarks, time-saved figures or logos exist. Nothing of the kind may be
  invented; illustrative visuals must read unmistakably as illustrative.
- No stock photography and no generated stand-in for it. Every visual is a real product surface,
  purpose-built motion or illustration, or typography.

## Product Principles

1. Work done, not work prepared. Paige's output is the deliverable; approval is the owner's control.
2. Sell the seam, not the seats.
3. Vision-forward, truth-bound: show the whole company's scope and label what is in build.
4. The owner is always in charge — stated once, credibly.
5. Fast on a phone on bad signal, or it doesn't exist.

## Accessibility & Inclusion

WCAG AA contrast on every token (one theme); full keyboard paths; every visual works with motion off and
honors `prefers-reduced-motion`; mobile-first.
