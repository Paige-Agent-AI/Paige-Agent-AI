// _shared/growth-blocks.ts — the ONE GrowthBlock contract for the Growth OS edge functions.
//
// Why this file exists (§12/§13 — extract, never fork): the 19-type block union is enforced
// in three places that must never drift apart:
//   1. SQL  — public.growth_validate_blocks(jsonb)  (migration 20260714091000), which BOTH
//             growth_page_upsert and growth_page_edit_blocks call. This is the hard gate: a
//             block that fails it can never be persisted.
//   2. TS   — validateBlock() below: the generator/editor-side cleaner. STRICTER than the SQL
//             gate on purpose (it also enforces per-variant required fields and length caps),
//             so TS-valid ⊆ SQL-valid — anything this returns is guaranteed to survive the
//             upsert. A revision we hand back that the save would reject is worse than no
//             revision at all.
//   3. PROMPT — GROWTH_BLOCK_SPEC below: the exact same 19 variants, in the shape the model
//             must emit. Shared so a new block type is added in ONE place, not three.
//
// Callers: growth-block-edit (today). FOLLOW-UP: growth-page-draft/index.ts still carries a
// verbatim private copy of validateBlock + the block spec; it should be migrated to import
// from here so the two can never diverge. (It was owned by another agent when this was
// extracted, so it was left untouched rather than edited concurrently.)
//
// Doctrine: §2 (no finance/credit in platform defaults) · §13 (tenant-safe, structured,
// no swallowed generics) · §15 (never fabricate a URL, a date, or a fact).

// ── Primitives ───────────────────────────────────────────────────────────────
export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const trimStr = (v: unknown, max: number): string => str(v).trim().slice(0, max);

/**
 * URL-bearing fields must be a real https URL. Returns "" for anything else (a placeholder
 * token like "[PASTE_VIDEO_URL]", an http url, a relative path) so the caller OMITS the
 * value/block rather than emitting a dead or unsafe link (§13/§15, blueprint B6).
 */
export const httpsUrl = (v: unknown, max = 600): string => {
  const s = trimStr(v, max);
  return /^https:\/\//i.test(s) ? s : "";
};

export function slugify(s: string, fallback: string): string {
  const out = String(s || "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return out || fallback;
}

/** Pull the first JSON object out of a model reply (tolerates ```json fences and preamble). */
export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model output");
  return JSON.parse(raw.slice(start, end + 1));
}

// ── The 19-type union ────────────────────────────────────────────────────────
// Kept in lockstep with src/lib/growth.ts (the renderer) and the SQL type list in
// public.growth_validate_blocks. Adding a type means touching all three, deliberately.
export const GROWTH_BLOCK_TYPES = [
  "hero", "hero_scene", "phase_cards", "feature_grid", "cta", "rich_text", "embedded_form",
  "social_proof", "testimonial", "pricing", "faq", "media", "stats", "countdown",
  "two_column", "image", "gallery", "steps", "chatbot",
] as const;

export type GrowthBlockType = (typeof GROWTH_BLOCK_TYPES)[number];

export function isGrowthBlockType(t: unknown): t is GrowthBlockType {
  return typeof t === "string" && (GROWTH_BLOCK_TYPES as readonly string[]).includes(t);
}

/**
 * Validate one candidate against the GrowthBlock union (src/lib/growth.ts). Returns a cleaned
 * block, or null if it doesn't satisfy its variant's required fields. Optional fields are only
 * carried through when present & non-empty (keeps the payload tight and stops an empty-string
 * CTA rendering as a dead button).
 *
 * NOTE — rich_text is capped at 20000 chars, matching the hard SQL limit in
 * growth_validate_blocks and the documented block spec. (growth-page-draft's private copy caps
 * at 6000, which silently truncates legitimate long-form copy well under the real ceiling; the
 * limit here is the contract-correct one and should carry over when that file is migrated.)
 */
export function validateBlock(b: any): any | null {
  if (!b || typeof b !== "object") return null;
  switch (b.type) {
    case "hero": {
      const title = trimStr(b.title, 160);
      if (!title) return null;
      const block: any = { type: "hero", title };
      const eyebrow = trimStr(b.eyebrow, 80); if (eyebrow) block.eyebrow = eyebrow;
      const subtitle = trimStr(b.subtitle, 400); if (subtitle) block.subtitle = subtitle;
      const ctaLabel = trimStr(b.cta_label, 60); if (ctaLabel) block.cta_label = ctaLabel;
      const ctaHref = trimStr(b.cta_href, 400); if (ctaHref) block.cta_href = ctaHref;
      const imageUrl = httpsUrl(b.image_url); if (imageUrl) block.image_url = imageUrl;
      const quote = trimStr(b.quote, 400); if (quote) block.quote = quote;
      const imgPos = trimStr(b.image_position, 8);
      if (imageUrl && (imgPos === "full" || imgPos === "split")) block.image_position = imgPos;
      return block;
    }
    case "hero_scene": {
      // Animated brand-toned hero — same copy contract as hero, minus the image (the scene
      // IS the visual). Only a title is required; everything else is optional and cleaned.
      const title = trimStr(b.title, 160);
      if (!title) return null;
      const block: any = { type: "hero_scene", title };
      const eyebrow = trimStr(b.eyebrow, 80); if (eyebrow) block.eyebrow = eyebrow;
      const subtitle = trimStr(b.subtitle, 400); if (subtitle) block.subtitle = subtitle;
      const ctaLabel = trimStr(b.cta_label, 60); if (ctaLabel) block.cta_label = ctaLabel;
      const ctaHref = trimStr(b.cta_href, 400); if (ctaHref) block.cta_href = ctaHref;
      return block;
    }
    case "phase_cards": {
      const cards = Array.isArray(b.cards) ? b.cards.map((c: any) => {
        const title = trimStr(c?.title, 120); const body = trimStr(c?.body, 400);
        if (!title || !body) return null;
        const card: any = { phase: trimStr(c?.phase, 40), title, body };
        const outcome = trimStr(c?.outcome, 200); if (outcome) card.outcome = outcome;
        return card;
      }).filter(Boolean) : [];
      if (!cards.length) return null;
      return { type: "phase_cards", cards: cards.slice(0, 8) };
    }
    case "feature_grid": {
      const items = Array.isArray(b.items) ? b.items.map((it: any) => {
        const title = trimStr(it?.title, 120); const body = trimStr(it?.body, 400);
        if (!title || !body) return null;
        return { title, body };
      }).filter(Boolean) : [];
      if (!items.length) return null;
      const block: any = { type: "feature_grid", items: items.slice(0, 9) };
      const title = trimStr(b.title, 160); if (title) block.title = title;
      return block;
    }
    case "cta": {
      const title = trimStr(b.title, 160);
      const ctaLabel = trimStr(b.cta_label, 60);
      const ctaHref = trimStr(b.cta_href, 400);
      if (!title || !ctaLabel || !ctaHref) return null;
      const block: any = { type: "cta", title, cta_label: ctaLabel, cta_href: ctaHref };
      const body = trimStr(b.body, 400); if (body) block.body = body;
      return block;
    }
    case "rich_text": {
      const html = trimStr(b.html, 20000);
      if (!html) return null;
      return { type: "rich_text", html };
    }
    case "embedded_form": {
      const formSlug = slugify(b.form_slug, "");
      if (!formSlug) return null;
      return { type: "embedded_form", form_slug: formSlug };
    }
    case "social_proof": {
      const logos = Array.isArray(b.logos) ? b.logos.map((l: any) => {
        const name = trimStr(l?.name, 80);
        if (!name) return null;
        const logo: any = { name };
        const img = httpsUrl(l?.image_url); if (img) logo.image_url = img;
        return logo;
      }).filter(Boolean) : [];
      if (!logos.length) return null;
      const block: any = { type: "social_proof", logos: logos.slice(0, 12) };
      const title = trimStr(b.title, 160); if (title) block.title = title;
      return block;
    }
    case "testimonial": {
      const items = Array.isArray(b.items) ? b.items.map((it: any) => {
        const quote = trimStr(it?.quote, 600);
        if (!quote) return null;
        const t: any = { quote };
        const author = trimStr(it?.author, 80); if (author) t.author = author;
        const role = trimStr(it?.role, 120); if (role) t.role = role;
        const avatar = httpsUrl(it?.avatar_url); if (avatar) t.avatar_url = avatar;
        const rating = Number(it?.rating);
        if (Number.isFinite(rating) && rating >= 1 && rating <= 5) t.rating = Math.round(rating);
        return t;
      }).filter(Boolean) : [];
      if (!items.length) return null;
      return { type: "testimonial", items: items.slice(0, 12) };
    }
    case "pricing": {
      const tiers = Array.isArray(b.tiers) ? b.tiers.map((t: any) => {
        const name = trimStr(t?.name, 80);
        const price = trimStr(t?.price, 40);
        const features = Array.isArray(t?.features)
          ? t.features.map((f: any) => trimStr(f, 160)).filter(Boolean) : [];
        if (!name || !price || !features.length) return null;
        const tier: any = { name, price, features: features.slice(0, 12) };
        const period = trimStr(t?.period, 40); if (period) tier.period = period;
        const ctaLabel = trimStr(t?.cta_label, 60); if (ctaLabel) tier.cta_label = ctaLabel;
        const ctaHref = trimStr(t?.cta_href, 400); if (ctaHref) tier.cta_href = ctaHref;
        if (t?.featured === true) tier.featured = true;
        return tier;
      }).filter(Boolean) : [];
      if (!tiers.length) return null;
      const block: any = { type: "pricing", tiers: tiers.slice(0, 6) };
      const title = trimStr(b.title, 160); if (title) block.title = title;
      return block;
    }
    case "faq": {
      const items = Array.isArray(b.items) ? b.items.map((it: any) => {
        const question = trimStr(it?.question, 300);
        const answer = trimStr(it?.answer, 1500);
        if (!question || !answer) return null;
        return { question, answer };
      }).filter(Boolean) : [];
      if (!items.length) return null;
      const block: any = { type: "faq", items: items.slice(0, 20) };
      const title = trimStr(b.title, 160); if (title) block.title = title;
      return block;
    }
    case "media": {
      // URL-bearing: omit entirely without an allowlisted provider AND a real https url (B6).
      const provider = trimStr(b.provider, 20).toLowerCase();
      const url = httpsUrl(b.url);
      if (!["youtube", "vimeo", "loom", "mp4"].includes(provider) || !url) return null;
      const block: any = { type: "media", provider, url };
      const title = trimStr(b.title, 160); if (title) block.title = title;
      const caption = trimStr(b.caption, 300); if (caption) block.caption = caption;
      return block;
    }
    case "stats": {
      const items = Array.isArray(b.items) ? b.items.map((it: any) => {
        const value = trimStr(it?.value, 40);
        const label = trimStr(it?.label, 120);
        if (!value || !label) return null;
        return { value, label };
      }).filter(Boolean) : [];
      if (!items.length) return null;
      const block: any = { type: "stats", items: items.slice(0, 8) };
      const title = trimStr(b.title, 160); if (title) block.title = title;
      return block;
    }
    case "countdown": {
      // Never invent a date (§15) — require a real, parseable timestamp; omit otherwise.
      const endsAt = trimStr(b.ends_at, 40);
      if (!endsAt || Number.isNaN(Date.parse(endsAt))) return null;
      const block: any = { type: "countdown", ends_at: endsAt };
      const title = trimStr(b.title, 160); if (title) block.title = title;
      const subtitle = trimStr(b.subtitle, 300); if (subtitle) block.subtitle = subtitle;
      const expired = trimStr(b.expired_text, 120); if (expired) block.expired_text = expired;
      return block;
    }
    case "two_column": {
      const heading = trimStr(b.heading, 160);
      const body = trimStr(b.body, 1500);
      if (!heading && !body) return null;
      const block: any = { type: "two_column" };
      if (heading) block.heading = heading;
      if (body) block.body = body;
      const img = httpsUrl(b.image_url); if (img) block.image_url = img;
      const side = trimStr(b.image_side, 8);
      if (side === "left" || side === "right") block.image_side = side;
      const ctaLabel = trimStr(b.cta_label, 60); if (ctaLabel) block.cta_label = ctaLabel;
      const ctaHref = trimStr(b.cta_href, 400); if (ctaHref) block.cta_href = ctaHref;
      return block;
    }
    case "image": {
      // URL-bearing: omit entirely without a real https url (B6).
      const url = httpsUrl(b.url);
      if (!url) return null;
      const block: any = { type: "image", url };
      const alt = trimStr(b.alt, 200); if (alt) block.alt = alt;
      const caption = trimStr(b.caption, 300); if (caption) block.caption = caption;
      return block;
    }
    case "gallery": {
      // URL-bearing: keep only images with a real https url; omit the block if none survive (B6).
      const images = Array.isArray(b.images) ? b.images.map((im: any) => {
        const url = httpsUrl(im?.url);
        if (!url) return null;
        const g: any = { url };
        const alt = trimStr(im?.alt, 200); if (alt) g.alt = alt;
        const caption = trimStr(im?.caption, 300); if (caption) g.caption = caption;
        return g;
      }).filter(Boolean) : [];
      if (!images.length) return null;
      const block: any = { type: "gallery", images: images.slice(0, 12) };
      const title = trimStr(b.title, 160); if (title) block.title = title;
      return block;
    }
    case "steps": {
      const items = Array.isArray(b.items) ? b.items.map((it: any) => {
        const title = trimStr(it?.title, 120);
        const body = trimStr(it?.body, 400);
        if (!title || !body) return null;
        const s: any = { title, body };
        const number = trimStr(it?.number, 8); if (number) s.number = number;
        return s;
      }).filter(Boolean) : [];
      if (!items.length) return null;
      const block: any = { type: "steps", items: items.slice(0, 10) };
      const title = trimStr(b.title, 160); if (title) block.title = title;
      return block;
    }
    // The per-site Paige chatbot. Config-as-data only (§10): no required fields — the tenant_id is
    // threaded by the renderer, never stored on the block. All strings optional; the renderer
    // provides brand-safe defaults so an empty {type:"chatbot"} still renders.
    case "chatbot": {
      const block: any = { type: "chatbot" };
      const title = trimStr(b.title, 120); if (title) block.title = title;
      const greeting = trimStr(b.greeting, 400); if (greeting) block.greeting = greeting;
      const placeholder = trimStr(b.placeholder, 120); if (placeholder) block.placeholder = placeholder;
      return block;
    }
    default:
      return null;
  }
}

/** Human-readable "what this variant needs" line, used to explain a 422 instead of a shrug. */
export const BLOCK_REQUIREMENTS: Record<string, string> = {
  hero: "a non-empty title",
  hero_scene: "a non-empty title",
  phase_cards: "at least one card with a title and a body",
  feature_grid: "at least one item with a title and a body",
  cta: "a title, a cta_label and a cta_href",
  rich_text: "non-empty html (max 20000 chars)",
  embedded_form: "a non-empty form_slug",
  social_proof: "at least one logo with a name",
  testimonial: "at least one item with a quote",
  pricing: "at least one tier with a name, a price and at least one feature",
  faq: "at least one item with a question and an answer",
  media: "a provider of youtube|vimeo|loom|mp4 and a real https:// url",
  stats: "at least one item with a value and a label",
  countdown: "a real, parseable ends_at timestamp",
  two_column: "a heading or a body",
  image: "a real https:// url",
  gallery: "at least one image with a real https:// url",
  steps: "at least one item with a title and a body",
  chatbot: "nothing required — optional title, greeting and placeholder",
};

// ── Placeholder tokens (§15) ─────────────────────────────────────────────────
// growth_page_publish HARD-REFUSES a page carrying an unresolved editable token, so anything
// that authors a block has to treat a placeholder as debt. Mirrors the SQL guard in migration
// 20260713090000 (growth_page_publish), which catches BOTH shapes without false-positiving on
// innocuous bracketed caps like [USA] or [2024]:
//   (a) a bracketed token CONTAINING an underscore → [ADD_WEBINAR_DATE], [PASTE_LINK]
//   (b) a bracket containing an editing action word → [Add webinar date], [Your name]
const PLACEHOLDER_UNDERSCORE = /^\[[A-Za-z0-9]*_[A-Za-z0-9_]*\]$/;
const PLACEHOLDER_ACTION_WORD = /\b(add|paste|insert|enter|fill|tbd|placeholder|replace|example|your)\b/i;

/**
 * Every unresolved placeholder token inside a block (or any JSON value), normalized (lowercased,
 * whitespace-collapsed) so a cosmetic case change isn't mistaken for a brand-new placeholder.
 */
export function placeholderTokens(value: unknown): Set<string> {
  const out = new Set<string>();
  // Each STRING VALUE on its own (Migration F, 2026-10-04), never the serialized JSON: serialized, a
  // string array's own brackets read as a token — ["Your weekly call","Add-on support"] was
  // "a new placeholder" and the edit was refused. Object keys are structure, not copy.
  const seen = new Set<unknown>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      for (const m of v.matchAll(/\[[^\][]*\]/g)) {
        const token = m[0];
        if (PLACEHOLDER_UNDERSCORE.test(token) || PLACEHOLDER_ACTION_WORD.test(token)) {
          out.add(token.toLowerCase().replace(/\s+/g, " "));
        }
      }
      return;
    }
    if (v === null || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    for (const child of Array.isArray(v) ? v : Object.values(v)) walk(child);
  };
  walk(value);
  return out;
}

/** Placeholders present in `revised` that were NOT already in `original` — i.e. new debt. */
export function newPlaceholders(original: unknown, revised: unknown): string[] {
  const before = placeholderTokens(original);
  return [...placeholderTokens(revised)].filter((t) => !before.has(t));
}

// ── The block spec the model is held to ──────────────────────────────────────
// One source of truth for every Growth OS prompt that emits blocks.
export const GROWTH_BLOCK_SPEC = `GrowthBlock variants — 19 types (use the exact "type" strings and field names):
- { "type": "hero", "eyebrow"?: string, "title": string, "subtitle"?: string, "cta_label"?: string, "cta_href"?: string, "image_url"?: https-string, "image_position"?: "full"|"split", "quote"?: string }
- { "type": "hero_scene", "eyebrow"?: string, "title": string, "subtitle"?: string, "cta_label"?: string, "cta_href"?: string }   // an ANIMATED, brand-toned hero with a premium motion backdrop and NO image. Prefer this over "hero" as the opening block when you have NO real hero image/photo to use — it looks intentional and high-end instead of a flat color. Use "hero" (with image_url) only when there's a real image. Max ONE hero-type block, first.
- { "type": "feature_grid", "title"?: string, "items": [{ "title": string, "body": string }] }
- { "type": "phase_cards", "cards": [{ "phase": string, "title": string, "body": string, "outcome"?: string }] }
- { "type": "cta", "title": string, "body"?: string, "cta_label": string, "cta_href": string }
- { "type": "rich_text", "html": string }   // max 20000 chars
- { "type": "embedded_form", "form_slug": string }
- { "type": "social_proof", "title"?: string, "logos": [{ "name": string, "image_url"?: https-string }] }
- { "type": "testimonial", "items": [{ "quote": string, "author"?: string, "role"?: string, "avatar_url"?: https-string, "rating"?: 1-5 }] }
- { "type": "pricing", "title"?: string, "tiers": [{ "name": string, "price": string, "period"?: string, "features": [string], "cta_label"?: string, "cta_href"?: string, "featured"?: boolean }] }
- { "type": "faq", "title"?: string, "items": [{ "question": string, "answer": string }] }
- { "type": "media", "provider": "youtube"|"vimeo"|"loom"|"mp4", "url": https-string, "title"?: string, "caption"?: string }
- { "type": "stats", "title"?: string, "items": [{ "value": string, "label": string }] }
- { "type": "countdown", "title"?: string, "ends_at": ISO-8601-timestamp, "subtitle"?: string, "expired_text"?: string }
- { "type": "two_column", "heading"?: string, "body"?: string, "image_url"?: https-string, "image_side"?: "left"|"right", "cta_label"?: string, "cta_href"?: string }
- { "type": "image", "url": https-string, "alt"?: string, "caption"?: string }
- { "type": "gallery", "title"?: string, "images": [{ "url": https-string, "alt"?: string, "caption"?: string }] }
- { "type": "steps", "title"?: string, "items": [{ "number"?: string, "title": string, "body": string }] }
- { "type": "chatbot", "title"?: string, "greeting"?: string, "placeholder"?: string }   // the tenant's own Paige, answering visitors live on the published page. Add ONE, near the end, only when the brief wants a live chat/assistant on the page. No other fields — the tenant is wired automatically.`;
