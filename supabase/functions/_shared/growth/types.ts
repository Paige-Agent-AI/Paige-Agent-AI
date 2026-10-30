// The Growth domain's shared TYPES — the ONE home of the GrowthBlock union and GrowthPageTheme.
//
// They live HERE (not in src/lib/growth.ts) so the Deno side (the portable-export builder and,
// through it, the growth-hosting-command door) can import them without dragging the app module
// graph — src/lib/growth.ts value-imports the Supabase client and the visit-tracker, whose DOM
// globals fail Deno's type-check. The app re-exports these from src/lib/growth.ts verbatim, so
// every existing import path keeps working; this file is the definition and that is the alias.
//
// Pure types + this one const: no imports, no DOM, no npm — safe for both runtimes.

export interface GrowthCtaRef { cta_label?: string; cta_href?: string }

export type GrowthBlock =
  // — original six —
  | { type: "hero"; eyebrow?: string; title: string; subtitle?: string;
      cta_label?: string; cta_href?: string; image_url?: string;
      image_position?: "full" | "split"; quote?: string }
  // Animated brand-toned hero (#240) — same copy fields as hero, but the visual is a
  // motion-safe aurora scene instead of an image (no image_url). For a premium, tech-forward
  // opener when the brief has no hero photo to lean on.
  | { type: "hero_scene"; eyebrow?: string; title: string; subtitle?: string;
      cta_label?: string; cta_href?: string }
  | { type: "phase_cards"; title?: string;
      cards: { phase: string; title: string; body: string; outcome?: string }[] }
  | { type: "feature_grid"; title?: string; items: { title: string; body: string; icon?: string }[] }
  | { type: "cta"; title: string; body?: string; cta_label: string; cta_href: string }
  | { type: "rich_text"; html: string }
  | { type: "embedded_form"; form_slug: string; title?: string }
  // — expansion (Framer/Webflow-class landing surfaces) —
  | { type: "social_proof"; title?: string; logos: { name: string; image_url?: string }[] }
  | { type: "testimonial";
      items: { quote: string; author?: string; role?: string; avatar_url?: string; rating?: number }[] }
  | { type: "pricing"; title?: string;
      tiers: { name: string; price: string; period?: string; features: string[];
               cta_label?: string; cta_href?: string; featured?: boolean }[] }
  | { type: "faq"; title?: string; items: { question: string; answer: string }[] }
  | { type: "media"; provider: "youtube" | "vimeo" | "loom" | "mp4"; url: string;
      title?: string; caption?: string }
  | { type: "stats"; title?: string; items: { value: string; label: string }[] }
  | { type: "countdown"; title?: string; ends_at: string; subtitle?: string; expired_text?: string }
  | { type: "two_column"; heading?: string; body?: string; image_url?: string;
      image_side?: "left" | "right"; cta_label?: string; cta_href?: string }
  | { type: "image"; url: string; alt?: string; caption?: string }
  | { type: "gallery"; title?: string; images: { url: string; alt?: string; caption?: string }[] }
  | { type: "steps"; title?: string; items: { number?: string; title: string; body: string }[] }
  // — the tenant's own Paige, inline on the published site (per-site chatbot). tenant_id is
  //   NOT stored on the block — it's threaded via GrowthBlocks' `tenantId` prop, and the public
  //   endpoint resolves the tenant server-side from the page's public slug (never a stored id). —
  | { type: "chatbot"; title?: string; greeting?: string; placeholder?: string };

export type GrowthBlockType = GrowthBlock["type"];

/** Blocks that carry an outbound/media URL — the generator omits these entirely when it
 *  has no real https URL (never emitted with placeholder tokens), and the server validates
 *  the URL. Kept here so the UI, generator, and validator agree on the set. */
export const URL_BEARING_BLOCKS: readonly GrowthBlockType[] = [
  "media", "image", "gallery",
] as const;

export interface GrowthPageTheme {
  primary?: string;     // hex
  accent?: string;      // hex
  background?: string;  // hex
  text?: string;        // hex
  font?: string;
  logo_url?: string;
}
