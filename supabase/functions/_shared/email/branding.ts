// Per-tenant email branding + sender + provider resolution.
//
// Resolves the branding tokens ("fill in the blank" values) and the sending
// identity/provider for a given tenant. The platform default is Paige Agent AI
// (gold + indigo, doctrine §6) — platform-originated mail (tenantId=null) wears
// the platform brand. A tenant that HAS set its own brand overrides these
// tokens; a tenant that HASN'T inherits the platform look but is still stamped
// with ITS OWN name ("brand it with their name" — owner directive), so it never
// reads as a generic system email. No tenant is hardcoded (doctrine §7/§200):
// each tenant is just a row in `tenants.brand`.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildProvider, type EmailProvider, type TenantEmailProviderConfig } from "./providers.ts";

export type EmailBranding = {
  brandName: string; // e.g. "Paige Agent AI", "Acme Coaching"
  wordmark: string; // short uppercase mark shown in the header band
  tagline: string | null; // sub-line under the wordmark / footer
  logoUrl: string | null; // optional hosted logo; shell falls back to wordmark
  primaryColor: string; // header/footer ground (dark)
  accentColor: string; // CTA + rule (brand accent)
  onAccentColor: string; // text color that sits on the accent (button label)
  bgColor: string; // outer canvas
  supportEmail: string | null;
  siteUrl: string;
  from: string; // "Display Name <local@domain>"
};

// PLATFORM DEFAULT — Paige Agent AI's own brand (gold + indigo, doctrine §6).
// This is what platform-originated mail wears, and the look a tenant inherits
// until it sets its own brand tokens (its NAME is still merged in below).
// `from` is injected by the resolver (platformDefaultFrom / tenant domain), so
// it's deliberately omitted from the const.
export const PLATFORM_DEFAULT_BRANDING: Omit<EmailBranding, "from"> = {
  brandName: "Paige Agent AI",
  wordmark: "PAIGE",
  tagline: null,
  logoUrl: null,
  primaryColor: "#1B1230", // deep indigo (header/footer band)
  accentColor: "#EBB94C", // gold (CTA + rule + wordmark)
  onAccentColor: "#1B1230", // dark text on the gold button
  bgColor: "#0B0912", // near-black canvas
  supportEmail: null,
  siteUrl: "https://paigeagent.ai",
};

function platformDefaultFrom(): string {
  return Deno.env.get("PLATFORM_DEFAULT_EMAIL_FROM") ?? "Paige Agent AI <team@paigeagent.ai>";
}

// --- Tenant-value hardening -------------------------------------------------
// Brand tokens come from tenant-controlled `tenants.brand` jsonb and are
// interpolated RAW into HTML style attributes by the shell. A tenant must never
// be able to break out of a style/attr context (phishing markup under OUR
// sending domain), so colors are validated against a strict hex allowlist and
// anything else falls back to the platform value.
function isHexColor(v: string | undefined): v is string {
  return !!v && /^#[0-9a-fA-F]{3,8}$/.test(v.trim());
}
function safeColor(v: string | undefined, fallback: string): string {
  return isHexColor(v) ? v.trim() : fallback;
}
// Relative luminance (WCAG) of a #hex color → pick a legible on-color so a
// tenant that sets an accent but no on-accent never gets dark-on-dark text.
function hexLuminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length < 6) return 0.5;
  const ch = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(2)) + 0.0722 * lin(ch(4));
}
function readableOn(bg: string): string {
  return hexLuminance(bg) > 0.5 ? "#1B1230" : "#FFFFFF";
}

// Read the tenant brand jsonb defensively — any subset of keys may be present.
function mergeBrand(base: Omit<EmailBranding, "from">, brand: Record<string, unknown> | null | undefined): Omit<EmailBranding, "from"> {
  const b = brand ?? {};
  const str = (k: string) => (typeof b[k] === "string" && (b[k] as string).trim() ? (b[k] as string) : undefined);
  const brandName = str("brand_name") ?? str("display_name") ?? base.brandName;
  const accentColor = safeColor(str("accent_color"), base.accentColor);
  return {
    brandName,
    wordmark: str("wordmark") ?? brandName.toUpperCase().slice(0, 18),
    tagline: str("tagline") ?? base.tagline,
    logoUrl: str("logo_url") ?? base.logoUrl,
    primaryColor: safeColor(str("primary_color"), base.primaryColor),
    accentColor,
    // Explicit on-accent wins (if a valid hex); otherwise derive a legible one.
    onAccentColor: isHexColor(str("on_accent_color")) ? (str("on_accent_color") as string).trim() : readableOn(accentColor),
    bgColor: safeColor(str("bg_color"), base.bgColor),
    supportEmail: str("support_email") ?? base.supportEmail,
    siteUrl: str("site_url") ?? base.siteUrl,
  };
}

// A verified tenant domain proves DNS ownership of the DOMAIN, not that the
// display name / local-part are header-safe. Sanitize before building `From`.
function cleanDisplayName(v: unknown): string {
  return String(v ?? "").replace(/[\r\n]+/g, " ").replace(/[<>"]/g, "").trim();
}
function isEmailLocal(v: string): boolean {
  return /^[A-Za-z0-9._%+\-]+$/.test(v);
}
function isHostname(v: string): boolean {
  return /^[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(v);
}

export type EmailContext = {
  branding: EmailBranding;
  provider: EmailProvider;
  tenantId: string | null;
};

/**
 * Resolve branding + sender + provider for a tenant. Pass tenantId=null (or an
 * unresolved user) to get the Paige Agent AI platform default. `provider` is the
 * tenant's bring-your-own seam (providers.ts), which does not send today; callers
 * read `branding` only, and PAIGE's own email goes through platform-sendgrid.ts.
 */
export async function resolveTenantEmailContext(
  admin: SupabaseClient,
  tenantId: string | null,
): Promise<EmailContext> {
  const platformFrom = platformDefaultFrom();
  const base: EmailBranding = { ...PLATFORM_DEFAULT_BRANDING, from: platformFrom };
  if (!tenantId) {
    return { branding: base, provider: buildProvider(null), tenantId: null };
  }

  const [{ data: tenant }, { data: domain }] = await Promise.all([
    admin.from("tenants").select("name, brand").eq("id", tenantId).maybeSingle(),
    admin
      .from("tenant_email_domains")
      .select("domain, from_name, from_email_local, status, is_default, verified_at")
      .eq("tenant_id", tenantId)
      .eq("is_default", true)
      .maybeSingle(),
  ]);

  const brand = ((tenant?.brand as Record<string, unknown> | null) ?? null);
  // Fall the tenant display name back to the tenants.name column when brand has
  // none — so even an unbranded tenant is stamped with its own name.
  const withName = mergeBrand(base, {
    ...(brand ?? {}),
    display_name: (brand?.display_name as string) ?? (brand?.brand_name as string) ?? tenant?.name,
  });

  // Sending identity: a VERIFIED default tenant domain, else platform default.
  // Sanitize every part — a verified domain proves DNS ownership, not that the
  // display name / local-part are free of header-injection or null values.
  let from = base.from;
  if (domain && domain.status === "verified" && domain.verified_at) {
    const fromName = cleanDisplayName(domain.from_name);
    const local = String(domain.from_email_local ?? "").trim();
    const dom = String(domain.domain ?? "").trim().toLowerCase();
    if (fromName && isEmailLocal(local) && isHostname(dom)) {
      from = `${fromName} <${local}@${dom}>`;
    }
  }

  const providerConfig = (brand?.email_provider as TenantEmailProviderConfig | undefined) ?? null;

  return {
    branding: { ...withName, from },
    provider: buildProvider(providerConfig),
    tenantId,
  };
}
