// Every operator-facing string in the Vibe Studio, in one file.
//
// This ships to EVERY tenant by default, so it is the most doctrine-exposed surface in the
// Studio and it lives alone so the §2/§3 audit has exactly one place to read.
//
//   §2  — the audience is client-based service businesses: coaches AND consultants, agencies,
//         advisors, thought leaders. The seed briefs are written so each of them sees
//         themselves. ZERO credit / funding / lending / financing wording — a tenant may
//         CHOOSE to author a funding page, but the platform default must never suggest one.
//   §3  — direct, confident, mogul-founder. Never "AI-powered", "streamline", "seamless",
//         "empower".
//   §11 — no backend codes, table names, or function names ever reach the operator. The error
//         map below is what converts a raw server raise into a sentence they can act on.
//   §15 — the seed briefs are REAL, usable briefs. Not lorem, not [PLACEHOLDER].
import type { GrowthBlock } from "@/lib/growth";
import type {
  ClarifyingQuestion,
  GenerationPhase,
  IntentChip,
  StudioErrorCode,
  StudioMode,
} from "./studio-types";

/** The mode switcher's words. One studio, four outputs. */
export const MODE_LABELS: Record<StudioMode, string> = {
  page: "Page",
  funnel: "Funnel",
  form: "Form",
  image: "Image",
};

/** The rail's heading + one-liner per mode. §3 voice, §2-clean. */
export const MODE_RAIL: Record<StudioMode, { heading: string; description: string }> = {
  page: {
    heading: "Describe the page",
    description: "One brief. Paige drafts the whole page in front of you.",
  },
  funnel: {
    heading: "Describe the funnel",
    description: "Chain a page to a form. Paige wires the flow end to end.",
  },
  form: {
    heading: "Describe the form",
    description: "Pick the questions, name it, and it's live-ready in one move.",
  },
  image: {
    heading: "Describe the image",
    description: "Say what you need. Paige creates it and files it in your library.",
  },
};

/** The §8/§14 moat line — verbatim from the original composer footer. */
export const TEAM_LINE =
  "Paige runs a team — a brand, design, and quality agent build every page with her.";

/**
 * The pre-generation clarifying step (§15) — a thin or questionnaire-signaling brief gets
 * grounded in a few real specifics before Paige spends a model call, instead of guessing
 * them or shipping the generic 3-field questionnaire nobody asked for. Fixed `id`s so an
 * answer keyed against one survives the fold into the brief (studio.ts's composeBrief).
 */
export const CLARIFYING_RAIL = {
  heading: "A few quick questions.",
  description: "A little more detail gets a sharper first draft — answer once, Paige builds.",
};

/** "Building from: '…'" recap banner label — the operator's own words, verbatim (§15). */
export const CLARIFYING_RECAP_LABEL = "Building from:";

export const CLARIFYING_QUESTIONS: ClarifyingQuestion[] = [
  {
    id: "offer",
    question: "What's the offer, and what's the one result someone gets from it?",
    placeholder: "e.g. A 6-week program that gets consultants their first repeatable client process.",
    // Coaching-generic offer shapes (§2: no finance/credit defaults) — a one-tap starting point
    // the operator can refine in the field.
    options: [
      "A group coaching program",
      "A 1:1 coaching or consulting engagement",
      "An online course or cohort",
      "A done-for-you service",
      "A free masterclass or webinar",
      "A paid workshop or intensive",
    ],
  },
  {
    id: "audience",
    question: "Who exactly is this page for?",
    placeholder: "e.g. Consultants and agency owners who are booked out but still doing every piece of delivery themselves.",
    options: [
      "Coaches growing their practice",
      "Consultants who are booked out",
      "Agency owners scaling delivery",
      "Course creators and educators",
      "Advisors and thought leaders",
      "Service pros and freelancers",
    ],
  },
  {
    id: "action",
    question: "What's the one action you want them to take, and what happens right after?",
    placeholder: "e.g. Apply for the program — I personally review every application.",
    options: [
      "Book a discovery call",
      "Register for the webinar",
      "Apply to work with me",
      "Start a free trial",
      "Download the free guide",
      "Join the waitlist",
    ],
  },
];

/** Only appended to the clarifying step when the brief itself signals a real questionnaire
 *  (FORM_SIGNAL_RE in studio.ts) — the answer travels to the server as questionnaire_answer,
 *  never folded into the brief prose, so the model sees it once, in its own turn (§4). */
export const QUESTIONNAIRE_FIELDS_QUESTION_ID = "questionnaire_fields";

export const QUESTIONNAIRE_FIELDS_QUESTION: ClarifyingQuestion = {
  id: QUESTIONNAIRE_FIELDS_QUESTION_ID,
  question:
    "What should the questionnaire actually ask? List the real questions, in order — and note which ones are required.",
  placeholder: "1) Business name (required) 2) How long in business? (required, dropdown) …",
};

/** Crafted empty-canvas copy per mode. Never a bare blank (§11). */
export const MODE_EMPTY: Record<StudioMode, { title: string; description: string }> = {
  page: {
    title: "Your page shows up here",
    description:
      "Describe the page on the left. Paige drafts it in front of you — every section is the real thing, not a mockup.",
  },
  funnel: {
    title: "Your funnel takes shape here",
    description: "Chain a page to a form and Paige wires the flow — entry, capture, thank-you.",
  },
  form: {
    title: "Your form previews here",
    description: "Pick a template on the left and you'll see every question before it's created.",
  },
  image: {
    title: "Your image appears here",
    description:
      "Describe what you need — a promo graphic, a social visual, an ad image — and Paige creates it.",
  },
};

/** The narration for each phase of a run. Every line names work that actually happens —
 *  the phase ticker is not decoration, it is a report (§13). It reads as Paige's TEAM at
 *  work (§8/§14): you're not watching one chatbot spin, you're watching a crew build the
 *  page. Each line stays honest — the named agent maps to real work the seam performs
 *  (brand resolve, the model draft, the block validator, the staged reveal). */
export const GENERATION_NOTES: Record<Exclude<GenerationPhase, "idle">, string> = {
  brief: "Paige is reading your brief.",
  brand: "Pulling your brand — colors, type, logo.",
  drafting: "Laying out the page, section by section.",
  validating: "Checking every section holds up.",
  composing: "Bringing it onto the canvas.",
  done: "Done — the whole team signed off.",
  error: "That didn't land.",
};

/**
 * The full-frame "building" narration for the single-call artifact type (image). Unlike the page
 * path — a streamed run with real phases — this is ONE non-streamed model call with no measurable
 * phases, so the building screen runs INDETERMINATE: a real elapsed clock, no fabricated progress
 * bar (§13). Each line names the teammate on Paige's crew who actually does the work (§8/§14). §3
 * voice (no "AI-powered"/"streamline"), §2-clean.
 */
export const BUILDING_NOTES: Record<"image", { agent: string; note: string }> = {
  image: { agent: "Design agent", note: "Paige is rendering your image." },
};

/**
 * The AMBIENT narration rotation for the single-call type (image). The building screen cycles one
 * of these lines at a time off the wall-clock — never a checklist, never a check, no ordered
 * "step 1 of 5", because there ARE no measurable phases here (§13: nothing may imply a completion
 * the seam can't report). They read as a craftsperson at work, not a progress bar. First line
 * matches BUILDING_NOTES so the opening frame names the job plainly. §3 voice (no "AI-powered"/
 * "streamline"/"seamless"/"empower"), §2-clean.
 */
export const BUILDING_ROTATION: Record<"image", string[]> = {
  image: [
    "Paige is rendering your image.",
    "Composing the frame.",
    "Balancing the light and color.",
    "Sharpening the details.",
    "Bringing it into focus.",
  ],
};

/**
 * Who on Paige's team owns each phase (§8/§14). This is the attribution that sells the moat —
 * "you're hiring her entire team," not a single model. Each name is honest: the work behind it
 * genuinely happens in the seam. Paige herself conducts (brief), then hands to her specialists.
 */
export const PHASE_AGENTS: Record<Exclude<GenerationPhase, "idle" | "done" | "error">, string> = {
  brief: "Paige",
  brand: "Brand agent",
  drafting: "Design agent",
  validating: "Quality agent",
  composing: "Paige",
};

/**
 * Six starting briefs. Clicking one REPLACES the composer's text with the full brief, which
 * the operator then edits until it's theirs — there is no hidden template behind the chip.
 *
 * They are deliberately spread across the audience (§2): a coach running a masterclass, a
 * consultant selling calls, an agency owner giving away a checklist, a program operator, a
 * practice with a waitlist, a thought leader running a room. Each one models what a GOOD
 * brief looks like — the offer, who it's for, and the one action — because the quality of the
 * brief is the quality of the first draft.
 */
export const INTENT_CHIPS: IntentChip[] = [
  {
    id: "webinar-registration",
    label: "Webinar registration",
    seed:
      "A registration page for a live 60-minute masterclass I'm teaching for founders and " +
      "operators whose client follow-up keeps falling through the cracks. Say what they walk " +
      "away with, the three things we work through live, and why I'm the one teaching it. One " +
      "action: save a seat — name and email. I'll drop in the date and time before it goes out.",
  },
  {
    id: "strategy-call",
    label: "Strategy call",
    seed:
      "A page that books strategy calls with me. It's for consultants and agency owners who are " +
      "booked out but still doing every piece of delivery themselves. Cover what the call " +
      "actually covers, who it's for, who it isn't for, and what happens after it. One action: " +
      "request a call — name, email, and what they're working on right now.",
  },
  {
    id: "lead-magnet",
    label: "Lead magnet",
    seed:
      "A download page for my client-onboarding checklist — the exact steps my team runs in the " +
      "first two weeks of a new engagement. It's for practice and agency owners whose onboarding " +
      "comes out different every single time. Say what's inside, why it works, and who it's for. " +
      "One action: get the checklist — name and email.",
  },
  {
    id: "program-sales",
    label: "Program sales page",
    seed:
      "A sales page for my 12-week group program for coaches and advisors who want a repeatable " +
      "client process instead of running the whole practice on instinct. Cover the outcome, the " +
      "week-by-week arc, who it's for, what's included, and the pricing. Answer the three " +
      "objections I get every time. One action: apply.",
  },
  {
    id: "client-waitlist",
    label: "Client waitlist",
    seed:
      "A waitlist page for my next intake. I take a handful of clients at a time and the next " +
      "group opens soon, so make the scarcity honest — no fake countdown. Say what working with " +
      "me actually looks like week to week and who I do my best work with. One action: join the " +
      "waitlist — name, email, and what they need help with.",
  },
  {
    id: "workshop-event",
    label: "Workshop or event",
    seed:
      "An event page for a half-day in-person workshop, one small room of operators and advisors. " +
      "Cover the agenda, what they leave with, how small the room is, and why it's worth a day " +
      "away from the business. One action: request an invite — name, email, and company. I'll add " +
      "the venue and the date before I publish.",
  },
];

/**
 * The Studio HOME composer's starter briefs (Slice 2). Same discipline as INTENT_CHIPS: each
 * chip drops a REAL, editable brief into the one composer — no hidden template (§15). Spread
 * across the whole audience (§2: coaches, consultants, agencies, advisors, thought leaders) and
 * across artifact SHAPES (a page, a form, a nurture sequence, a results page) so the home models
 * "describe anything, Paige works out the shape" — never a type-picker (§18). ZERO credit /
 * funding / lending wording — that is a tenant's own opt-in offer, never a platform default.
 */
export const STUDIO_HOME_CHIPS: IntentChip[] = [
  {
    id: "home-masterclass",
    label: "Masterclass landing page",
    seed:
      "A landing page for my next live masterclass. It's for founders and operators who keep " +
      "losing clients to slow follow-up. Say what they walk away with, the three things we cover " +
      "live, and why I'm the one teaching it. One action: save a seat — name and email. I'll add " +
      "the date before it goes out.",
  },
  {
    id: "home-discovery-intake",
    label: "Discovery-call intake",
    seed:
      "An intake questionnaire for new discovery calls, so I walk in already knowing who I'm " +
      "talking to. Ask their business and role, what they're trying to fix, what they've already " +
      "tried, their timeline, and the best email to reach them. Keep it short enough that a busy " +
      "consultant will actually finish it.",
  },
  {
    id: "home-welcome-sequence",
    label: "New-client welcome",
    seed:
      "A welcome message for a client who just signed. Set the tone for how we work together, " +
      "tell them exactly what happens in the first week, and give them the one thing to do before " +
      "our first session. Warm, confident, zero fluff.",
  },
  {
    id: "home-results-page",
    label: "Results & proof page",
    seed:
      "A page that shows the results my clients get, built around one real client story. Cover " +
      "where they started, what we did together, and the outcome — then invite the reader to see " +
      "if they're a fit. One action: book a call.",
  },
  {
    id: "home-waitlist",
    label: "Waitlist for next intake",
    seed:
      "A waitlist page for my next intake. I take a handful of clients at a time and the next " +
      "group opens soon — keep the scarcity honest, no fake countdown. Say what working with me " +
      "looks like week to week and who I do my best work with. One action: join the waitlist — " +
      "name, email, and what they need help with.",
  },
];

// ── KB-tailored home chips (#310 Slice C) ────────────────────────────────────────────────
// The brain's READ direction on the home composer: STUDIO_HOME_CHIPS above is the generic
// fallback; when the tenant's own knowledge base has material, loadKbSuggestionChips() maps each
// doc through these two pure helpers into a real, editable IntentChip. Everything here is derived
// ONLY from tenant-authored fields (title/summary/category) — no finance/credit default is ever
// injected (§2), and the brief a chip drops in is exactly what Paige is asked, no hidden template (§15).

/** A short chip label for a KB-derived suggestion. Leads with the doc's TITLE (trimmed to keep the
 *  dock row compact, §11) because it names the SPECIFIC thing each chip builds — several docs sharing
 *  a category (e.g. three "Offer" docs) would otherwise collide on one indistinguishable label. Only
 *  falls back to the category when a doc has no usable title. */
export function kbChipLabel({ title, category }: { title: string; category: string | null }): string {
  const t = title.trim();
  if (t) return t.length <= 28 ? t : `${t.slice(0, 27).trimEnd()}…`;
  const cat = (category ?? "").trim();
  if (cat && cat.toLowerCase() !== "studio" && cat.length <= 24) {
    return cat.replace(/\b\w/g, (m) => m.toUpperCase());
  }
  return "Start from your knowledge";
}

/** Turn one KB doc into a real, editable direct-response brief the tenant can drop in and refine.
 *  Grounds the ask in THEIR material (title + a clipped summary) and always ends on one clear
 *  action — the direct-response bar the generators expect. Returns "" if there's nothing to seed. */
export function briefFromKbDoc({
  title,
  summary,
  category,
}: {
  title: string;
  summary: string | null;
  category: string | null;
}): string {
  const t = title.trim();
  if (!t) return "";
  const ctx = (summary ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
  const noun = (category ?? "").trim().toLowerCase() === "program" ? "program" : "offer";
  const lead = `A landing page for ${t}.`;
  const body = ctx
    ? ` Here's what it's about, in my own words: ${ctx}`
    : ` Pull the details from what you already know about my ${noun}.`;
  return `${lead}${body} Speak in my voice, use the specifics above, and end on one clear action for the reader.`;
}

/** The human name for every block type. The operator never sees a backend type string (§11).
 *  Covers all 19 variants — TypeScript enforces that here. */
export const BLOCK_LABELS: Record<GrowthBlock["type"], string> = {
  hero: "Hero",
  hero_scene: "Animated hero",
  phase_cards: "Phases",
  feature_grid: "Features",
  cta: "Call to action",
  rich_text: "Text",
  embedded_form: "Signup form",
  social_proof: "Logos",
  testimonial: "Testimonials",
  pricing: "Pricing",
  faq: "FAQ",
  media: "Video",
  stats: "Stats",
  countdown: "Countdown",
  two_column: "Split section",
  image: "Image",
  gallery: "Gallery",
  steps: "Steps",
  chatbot: "Chatbot",
  conversion: "Form or booking",
};

/**
 * The translation layer between the server and the operator.
 *
 * The publish RPC raises hard, specific errors — unresolved placeholders, a signup section
 * with no live form behind it, a workspace with no public address. Those raises are precise
 * and they are ALSO full of machinery the operator must never see. Every one of them lands
 * here and leaves as a sentence that says what happened and what to do next (§11/§13).
 */
export const STUDIO_ERROR_COPY: Record<StudioErrorCode, string> = {
  NO_TENANT: "Pick a workspace first.",
  NO_TENANT_SLUG:
    "This workspace has no public web address yet. Set one in your brand settings, then publish.",
  EMPTY_BRIEF:
    "Tell Paige what the page is for — the offer, who it's for, and the action you want.",
  GENERATION_FAILED:
    "Paige couldn't draft the page. Try again, or add a little more detail to the brief.",
  GENERATION_CANCELLED: "Stopped. Nothing was changed.",
  INVALID_BLOCKS:
    "One of the sections didn't hold up. Regenerate, or edit that section and try again.",
  NO_DRAFT: "Save the page before publishing it.",
  UNRESOLVED_PLACEHOLDER: "Some sections still have blanks to fill in. Fill them, then publish.",
  FORM_MISSING:
    "The signup form on this page isn't set up yet. Save the page — Paige will build it — then publish.",
  INVALID_SLUG: "Give the page a web address (letters, numbers and dashes).",
  NOT_FOUND: "This page isn't in your workspace.",
  FORBIDDEN: "You don't have access to publish pages here.",
  SAVE_FAILED: "Couldn't save the draft. Try again.",
  PUBLISH_FAILED: "Couldn't publish. Try again.",
  EDIT_FAILED: "Couldn't apply that change. Try rewording it.",
  UNKNOWN: "Something went wrong. Try again.",
};
