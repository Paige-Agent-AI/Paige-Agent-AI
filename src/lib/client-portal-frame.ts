import {readClientPortalSelfProfile, type ClientPortalSelfProfile} from "./client-portal-self-profile";
import {normalizePortalConfig, type ClientPortalConfig} from "@/hooks/useClientPortalConfig";

/** Closed presentation projection; the native relationship owns authority. */
export interface ClientPortalFrame {
  actorId: string;
  profile: ClientPortalSelfProfile;
  brand: {
    tenant_id: string;
    tenant_name: string;
    tenant_slug: string | null;
    logo_url: string | null;
    primary_color: string | null;
    support_email: string | null;
  };
  config: ClientPortalConfig;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const brandKeys = ["tenant_id", "tenant_name", "tenant_slug", "logo_url", "primary_color", "support_email"];
export function readClientPortalFrame(value: unknown, actorId: string): ClientPortalFrame | null {
  if (!record(value) || !exact(value, ["actor_id", "profile", "brand", "config"]) || value.actor_id !== actorId) return null;
  const profile = readClientPortalSelfProfile(value.profile, actorId);
  const brand = value.brand;
  if (!profile || !record(brand) || !exact(brand, brandKeys)
    || brand.tenant_id !== profile.tenant_id || typeof brand.tenant_name !== "string" || !brand.tenant_name.trim()
    || ["tenant_slug", "logo_url", "primary_color", "support_email"].some(key => brand[key] !== null && typeof brand[key] !== "string")
    || !record(value.config)) return null;
  return {
    actorId, profile,
    brand: {
      tenant_id: profile.tenant_id, tenant_name: brand.tenant_name,
      tenant_slug: brand.tenant_slug as string | null, logo_url: brand.logo_url as string | null,
      primary_color: brand.primary_color as string | null, support_email: brand.support_email as string | null,
    },
    config: normalizePortalConfig(value.config),
  };
}
export const sameClientPortalFrame = (a: ClientPortalFrame, b: ClientPortalFrame) =>
  a.actorId === b.actorId && a.profile.id === b.profile.id && a.profile.tenant_id === b.profile.tenant_id;
