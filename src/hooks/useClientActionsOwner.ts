import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type OwnerActionScope = { actor: string; tenant: string; contact: string };
export type OwnerActionResponse = { id: string; response_type: "accepted" | "declined" | "question" | "completed"; response_text: string | null; created_at: string };
export type OwnerCustomerAction = {
  id: string; action_type: "task" | "message" | "recommendation" | "nudge"; title: string; body: string | null;
  status: "proposed" | "customer_notified" | "customer_acted" | "customer_declined" | "expired";
  created_at: string; updated_at: string; expires_at: string; is_expired: boolean;
  responses: OwnerActionResponse[]; more_responses: boolean;
};
export type OwnerCustomerActions = {
  schema_version: 1; actor_id: string; tenant_id: string; contact_id: string;
  access_state: "open" | "paused" | "ended"; joined: boolean; shared_context_consent: boolean;
  actions: OwnerCustomerAction[]; more_actions: boolean;
};
type Phase = "loading" | "ready" | "refused" | "error";
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const uuid = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const date = (x: unknown): x is string => typeof x === "string" && Number.isFinite(Date.parse(x));
const nullableText = (x: unknown): x is string | null => x === null || typeof x === "string";
function keys(row: Record<string, unknown>, fields: string[]) {
  if (Object.keys(row).length !== fields.length || fields.some(key => !(key in row))) throw new Error("Invalid action projection");
}
/** Closed original-record projection. A mismatched/expanded response is never painted. */
export function parseOwnerCustomerActions(raw: unknown, scope: OwnerActionScope): OwnerCustomerActions {
  if (!object(raw)) throw new Error("Invalid action projection");
  keys(raw, ["schema_version", "actor_id", "tenant_id", "contact_id", "access_state", "joined", "shared_context_consent", "actions", "more_actions"]);
  if (raw.schema_version !== 1 || raw.actor_id !== scope.actor || raw.tenant_id !== scope.tenant || raw.contact_id !== scope.contact
      || !["open", "paused", "ended"].includes(String(raw.access_state)) || typeof raw.joined !== "boolean"
      || typeof raw.shared_context_consent !== "boolean" || typeof raw.more_actions !== "boolean"
      || !Array.isArray(raw.actions) || raw.actions.length > 100) throw new Error("Invalid action scope");
  const ids = new Set<string>();
  for (const item of raw.actions) {
    if (!object(item)) throw new Error("Invalid action");
    keys(item, ["id", "action_type", "title", "body", "status", "created_at", "updated_at", "expires_at", "is_expired", "responses", "more_responses"]);
    if (!uuid(item.id) || ids.has(item.id) || typeof item.title !== "string" || !nullableText(item.body)
        || !["task", "message", "recommendation", "nudge"].includes(String(item.action_type))
        || !["proposed", "customer_notified", "customer_acted", "customer_declined", "expired"].includes(String(item.status))
        || !date(item.created_at) || !date(item.updated_at) || !date(item.expires_at) || typeof item.is_expired !== "boolean"
        || typeof item.more_responses !== "boolean" || !Array.isArray(item.responses) || item.responses.length > 100) throw new Error("Invalid action");
    ids.add(item.id);
    const responses = new Set<string>();
    for (const response of item.responses) {
      if (!object(response)) throw new Error("Invalid response");
      keys(response, ["id", "response_type", "response_text", "created_at"]);
      if (!uuid(response.id) || responses.has(response.id) || !date(response.created_at) || !nullableText(response.response_text)
          || !["accepted", "declined", "question", "completed"].includes(String(response.response_type))) throw new Error("Invalid response");
      responses.add(response.id);
    }
  }
  return raw as unknown as OwnerCustomerActions;
}
async function bounded<T>(request: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve(request), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Read timeout")), 20_000); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Called from a keyed original People record; no second history, writer or auth registry. */
export function useClientActionsOwner(scope: OwnerActionScope) {
  const { actor, tenant, contact } = scope;
  const [phase, setPhase] = useState<Phase>("loading"), [data, setData] = useState<OwnerCustomerActions | null>(null);
  const life = useRef({ alive: false, read: 0 });
  const refresh = useCallback(async () => {
    const currentLife = life.current, read = ++currentLife.read;
    const current = () => currentLife.alive && currentLife.read === read;
    setPhase("loading"); setData(null);
    try {
      const user = await bounded(supabase.auth.getUser());
      if (!current()) return;
      if (user.error || user.data.user?.id !== actor) { setPhase("refused"); return; }
      const result = await bounded(supabase.rpc("list_pending_customer_actions", {
        _expected_actor_id: actor, _expected_tenant_id: tenant, _contact_id: contact,
      } as never));
      if (!current()) return;
      if (result.error?.code === "42501") { setPhase("refused"); return; }
      if (result.error) throw new Error("Read unavailable");
      const parsed = parseOwnerCustomerActions(result.data, { actor, tenant, contact });
      const final = await bounded(supabase.auth.getUser());
      if (!current()) return;
      if (final.error || final.data.user?.id !== actor) { setPhase("refused"); return; }
      setData(parsed); setPhase("ready");
    } catch { if (current()) { setData(null); setPhase("error"); } }
  }, [actor, tenant, contact]);
  useEffect(() => {
    const currentLife = life.current; currentLife.alive = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (currentLife.alive && (event === "SIGNED_OUT" || session?.user.id !== actor)) {
        ++currentLife.read; setData(null); setPhase("refused");
      }
    });
    void refresh();
    return () => { currentLife.alive = false; ++currentLife.read; subscription.unsubscribe(); };
  }, [refresh, actor]);
  return { phase, data, refresh };
}
