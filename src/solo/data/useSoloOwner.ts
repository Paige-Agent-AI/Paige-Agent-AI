/**
 * useSoloOwner — the Solo Setup › Owner adapter (§18: composes the EXISTING
 * `profiles` own-row seam, never a new query family).
 *
 * READS the caller's OWN `profiles` row (`.eq("user_id", uid)`): full_name,
 * avatar_url, website_url — plus the auth-user email/name as an honest fallback (the
 * useCommandCenter firstToken pattern). Email and phone are the caller's OWN contact methods
 * (`user_contact_methods`, via useUserContactMethods): `email`/`phone` below are their primaries. There is NO title /
 * pronouns / owner-since / signature / bio / continuity storage in this schema, so
 * those stay Preview and are NOT sourced here (§31/§13).
 *
 * WRITES name and website via the plain own-row update:
 *   supabase.from("profiles").update({ full_name, website_url }).eq("user_id", uid)
 * and every email and phone through `contact.save` (`set_user_contact_methods`).
 * §9: the write keys on the caller's OWN uid (from the verified session) — NO
 * client-supplied id — and RLS gates the row. Every field is present-guarded; a
 * null renders as an em-dash upstream, never "undefined".
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { useUserContactMethods, type UserContactMethods } from "@/components/contact-methods/useUserContactMethods";
import { primaryValue } from "@/lib/contact-methods";

export interface SoloOwner {
  /** Display name (profiles.full_name → auth metadata full_name/name → null). */
  name: string | null;
  /** Primary email (contact methods → auth email → null). */
  email: string | null;
  /** Primary phone (contact methods → null). */
  phone: string | null;
  website: string | null;
  avatarUrl: string | null;
}

/** The editable profile subset — name and website. Emails and phones are `contact`. */
export type SoloOwnerPatch = Partial<{
  full_name: string;
  website_url: string;
}>;

export interface SoloOwnerData {
  loading: boolean;
  error: string | null;
  saving: boolean;
  owner: SoloOwner;
  /** Every email and phone the owner uses; the editor saves through this. */
  contact: UserContactMethods;
  saveOwner: (patch: SoloOwnerPatch) => Promise<{ ok: boolean; error?: string }>;
  refresh: () => void;
}

const EMPTY_OWNER: SoloOwner = {
  name: null,
  email: null,
  phone: null,
  website: null,
  avatarUrl: null,
};

/** Present-guard to a trimmed string, else null (§13). */
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

export function useSoloOwner(): SoloOwnerData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [profile, setProfile] = useState<SoloOwner>(EMPTY_OWNER);
  const contact = useUserContactMethods(uid);
  const refreshContact = contact.refresh;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      const userId = user?.id ?? null;
      setUid(userId);
      if (!userId) {
        setProfile(EMPTY_OWNER);
        return;
      }
      const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
      const authName = str(meta.full_name) ?? str(meta.name);
      const authEmail = str(user?.email);

      const { data, error: profErr } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, website_url")
        .eq("user_id", userId)
        .maybeSingle();
      if (profErr) throw profErr;

      setProfile({
        name: str(data?.full_name) ?? authName,
        email: authEmail,
        phone: null,
        website: str(data?.website_url),
        avatarUrl: str(data?.avatar_url),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveOwner = useCallback(
    async (patch: SoloOwnerPatch): Promise<{ ok: boolean; error?: string }> => {
      if (!uid) return { ok: false, error: "You're not signed in." };
      setSaving(true);
      try {
        // Only send the keys the caller actually edited; empty string clears to null.
        const update: TablesUpdate<"profiles"> = {};
        (["full_name", "website_url"] as const).forEach((k) => {
          if (k in patch) {
            const v = patch[k];
            update[k] = typeof v === "string" && v.trim() ? v.trim() : null;
          }
        });
        const { error: upErr } = await supabase.from("profiles").update(update).eq("user_id", uid);
        if (upErr) throw upErr;
        await load();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Couldn't save your changes." };
      } finally {
        setSaving(false);
      }
    },
    [uid, load],
  );

  const refresh = useCallback(() => {
    void load();
    void refreshContact();
  }, [load, refreshContact]);

  const owner: SoloOwner = {
    ...profile,
    email: primaryValue(contact.methods, "email") ?? profile.email,
    phone: primaryValue(contact.methods, "phone"),
  };

  return { loading: loading || contact.loading, error: error ?? contact.error, saving, owner, contact, saveOwner, refresh };
}
