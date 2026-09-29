import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  USER_CONTACT_METHODS_SELECT,
  contactMethodErrorFor,
  orderContactMethods,
  toContactMethodsPayload,
  validateContactMethods,
  type ContactMethod,
  type ContactMethodRow,
} from "@/lib/contact-methods";

export interface UserContactMethods {
  loading: boolean;
  /** The read failed. Not the same as "none recorded": RLS hides rows the caller may not read. */
  error: string | null;
  methods: ContactMethod[];
  saving: boolean;
  /** Replaces the person's whole list through `set_user_contact_methods` and reads back what it stored. */
  save: (next: ContactMethod[]) => Promise<{ ok: true; methods: ContactMethod[] } | { ok: false; error: string }>;
  refresh: () => Promise<void>;
}

/**
 * One person's own emails and phones (`user_contact_methods`). Reads go through RLS
 * (`can_read_user_contact_methods`: yourself, or an owner/admin of your current workspace reading a
 * member of it). Writes go through `set_user_contact_methods`, which re-checks the same authority in
 * its body and refuses an admin editing the owner. The screen never decides authority; it only
 * decides what to offer.
 */
export function useUserContactMethods(userId: string | null | undefined): UserContactMethods {
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState<string | null>(null);
  const [methods, setMethods] = useState<ContactMethod[]>([]);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    if (!userId) {
      setMethods([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table awaits generated types
    const { data, error: readError } = await (supabase as any)
      .from("user_contact_methods")
      .select(USER_CONTACT_METHODS_SELECT)
      .eq("user_id", userId);
    if (mine !== seq.current) return;
    if (readError) {
      setError(readError.message || "Couldn't load contact details.");
      setMethods([]);
    } else {
      setMethods(orderContactMethods(data as ContactMethodRow[] | null));
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
    return () => { seq.current += 1; };
  }, [load]);

  const save = useCallback(async (next: ContactMethod[]) => {
    if (!userId) return { ok: false as const, error: "You're not signed in." };
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC awaits generated types
      const { data, error: saveError } = await (supabase as any).rpc("set_user_contact_methods", {
        p_user_id: userId,
        p_methods: toContactMethodsPayload(next),
      });
      if (saveError) return { ok: false as const, error: saveError.message || "Couldn't save contact details." };
      // The RPC answers with what it stored, row ids included: the screen shows that, never its draft.
      const stored = orderContactMethods(Array.isArray(data) ? (data as ContactMethodRow[]) : []);
      setMethods(stored);
      return { ok: true as const, methods: stored };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't save contact details." };
    } finally {
      setSaving(false);
    }
  }, [userId]);

  return { loading, error, methods, saving, save, refresh: load };
}

/** The server's refusal codes for a person's own list, in words a person can act on. */
export function userContactMethodsRefusal(message: string): string {
  if (/USER_CONTACT_METHODS_FORBIDDEN/.test(message)) return "You can't change this person's contact details from this workspace.";
  if (/CONTACT_METHODS_TOO_MANY/.test(message)) return "That's more than 20 of one kind. Remove one and save again.";
  if (/CONTACT_METHOD_BAD_LABEL/.test(message)) return "One of the labels is too long. Choose one from the list.";
  if (/^CONTACT_METHODS?_|USER_CONTACT_METHODS_/.test(message)) return "Those contact details couldn't be saved. Check each address and try again.";
  return message;
}

export interface ContactMethodsDraft {
  draft: ContactMethod[];
  setDraft: (next: ContactMethod[]) => void;
  /** Row errors to hand the editor: local ones once a save was attempted, and a server refusal on
   *  the row it names until that row's value changes. */
  errors: Record<string, string>;
  dirty: boolean;
  reset: () => void;
  /** Validates, saves if changed, and on a refusal puts it on its row and focuses it. `error` is set
   *  only for a refusal that belongs to no row. */
  submit: () => Promise<{ ok: boolean; error?: string }>;
}

const sameList = (a: ContactMethod[], b: ContactMethod[]) =>
  JSON.stringify(toContactMethodsPayload(a)) === JSON.stringify(toContactMethodsPayload(b));

const focusRow = (id: string) => window.setTimeout(() => document.getElementById(`ctm-value-${id}`)?.focus(), 0);

/** The editing state over one person's stored list: seeded from what is stored, re-seeded after
 *  every save or reload, never while the person is typing. */
export function useContactMethodsDraft(stored: UserContactMethods, editable: boolean): ContactMethodsDraft {
  const [draft, setDraftState] = useState<ContactMethod[]>([]);
  const [shown, setShown] = useState(false);
  const [serverError, setServerError] = useState<{ id: string; text: string } | null>(null);
  const erroredValues = useRef<Map<string, string>>(new Map());
  const seededFrom = useRef<ContactMethod[] | null>(null);

  useEffect(() => {
    if (stored.loading || seededFrom.current === stored.methods) return;
    seededFrom.current = stored.methods;
    setDraftState(stored.methods);
  }, [stored.loading, stored.methods]);

  const localErrors = validateContactMethods(draft);
  const errors: Record<string, string> = shown ? { ...localErrors } : {};
  if (serverError && draft.some((m) => m.id === serverError.id && m.value === erroredValues.current.get(m.id))) {
    errors[serverError.id] = serverError.text;
  }
  const dirty = editable && !stored.loading && !stored.error && !sameList(draft, stored.methods);

  const reset = () => { setDraftState(stored.methods); setServerError(null); setShown(false); };

  const submit = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!dirty) return { ok: true };
    const firstBad = draft.find((m) => localErrors[m.id]);
    if (firstBad) {
      setShown(true);
      focusRow(firstBad.id);
      return { ok: false };
    }
    const result = await stored.save(draft);
    if (result.ok === false) {
      const onRow = contactMethodErrorFor(draft, result.error);
      if (onRow) {
        erroredValues.current = new Map(draft.map((m) => [m.id, m.value]));
        setServerError(onRow);
        focusRow(onRow.id);
        return { ok: false };
      }
      return { ok: false, error: userContactMethodsRefusal(result.error) };
    }
    setServerError(null);
    setShown(false);
    return { ok: true };
  };

  return { draft, setDraft: setDraftState, errors, dirty, reset, submit };
}
