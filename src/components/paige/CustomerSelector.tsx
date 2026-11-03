// The rail's customer selector (cc-spec §2.a, closes B2). Reuses the shadcn
// Popover + Command SHELL from NewDealDialog, but the data path is a debounced
// SERVER-side ilike search on `clients` (limit 50, shouldFilter={false}) so it
// reaches ANY customer — not the old truncated 500-row client-side filter. RLS
// tenant-scopes the query. Emits a FocusedClient; resting state and selected
// state (mini-card) live one level up in PaigeSidebar.
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { ChevronsUpDown, Loader2, UserPlus } from "lucide-react";
import type { FocusedClient } from "./commandCenterTypes";
import { CLIENT_CONTACT_METHODS_EMBED, primaryAddressesOf, type WithClientContactMethods } from "@/lib/contact-methods";
import { clientContactMethodsTable } from "@/lib/contacts";

interface ClientRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  entity_name: string | null;
  /** The contact's primary email. */
  email: string | null;
  lifecycle_stage: string | null;
}

interface ClientQueryRow extends WithClientContactMethods {
  id: string;
  tenant_id?: string | null;
  first_name: string | null;
  last_name: string | null;
  entity_name: string | null;
  lifecycle_stage: string | null;
  created_at: string | null;
}

const toClientRow = (row: ClientQueryRow): ClientRow => ({
  id: row.id,
  first_name: row.first_name,
  last_name: row.last_name,
  entity_name: row.entity_name,
  email: primaryAddressesOf(row.client_contact_methods).email,
  lifecycle_stage: row.lifecycle_stage,
});

// Widened to string: the generated types do not know the contact-methods embed yet.
const CUSTOMER_SELECT: string = `id,tenant_id,first_name,last_name,entity_name,lifecycle_stage,created_at,${CLIENT_CONTACT_METHODS_EMBED}`;

// §58 — see the effect below for why a NULL-tenant row is excluded.
const clientsQuery = () =>
  supabase
    .from("clients")
    .select(CUSTOMER_SELECT)
    .not("tenant_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);

function toFocused(c: ClientRow): FocusedClient {
  const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || (c.entity_name ?? "Unnamed");
  return {
    id: c.id,
    name,
    entity: c.entity_name ?? null,
    email: c.email ?? null,
    stage: c.lifecycle_stage ?? null,
  };
}

// Strip characters that would break the PostgREST `.or()` / ilike expression.
const sanitize = (s: string) => s.replace(/[,()%*]/g, " ").trim();

interface Props {
  onSelect: (client: FocusedClient) => void;
  /** Optional current-workspace fence. Explicit null withholds all reads;
   * undefined preserves legacy callers until their owning integration binds it. */
  tenantId?: string | null;
  /** View reset only, never authority. Bind the verified actor so a same-workspace
   * sign-in change cannot retain another actor's picker results or search. */
  scopeKey?: string;
  /** When provided, renders a persistent "＋ Create new contact" item at the top of the
   *  list (used by the Conversations compose-new modal). The current search term is handed
   *  back as `seedTerm` so the create flow can pre-fill the name/email/phone the user already
   *  typed (§36 — never make them retype it). Omitted callers (e.g. PaigeSidebar) see no
   *  create affordance — fully backward-compatible. */
  onRequestCreate?: (seedTerm?: string) => void;
}

export function CustomerSelector(props: Props) {
  // Remount on scope changes, including A→B→A. No retained result or continuation
  // can become current again merely because the same account name reappears.
  return <CustomerSelectorContent key={JSON.stringify([props.tenantId === undefined ? "legacy" : props.tenantId, props.scopeKey ?? null])} {...props} />;
}

function CustomerSelectorContent({ onSelect, onRequestCreate, tenantId }: Props) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const reqId = useRef(0);

  useEffect(() => {
    if (!open || tenantId === null) return;
    const id = ++reqId.current;
    const current = () => id === reqId.current;
    setLoading(true);
    setFailed(false);
    const handle = setTimeout(async () => {
      try {
      // §58 — narrow the picker toward what the server will actually accept. `paige-ai-chat`
      // authorizes a focused client by TENANT EQUALITY and excludes `tenant_id IS NULL`, and the
      // `clients` `tenant_isolation` policy admits NULL-tenant rows to ANY authenticated user
      // with no NOT NULL constraint on the column, so such a row would be pickable here and
      // silently unusable in chat. Zero exist in production today; this stops them drifting.
      //
      // HONEST LIMIT (§13): this closes the NULL-tenant case ONLY. The assignment policies
      // (`clients_coaches_assigned`, `clients_cs_rep_assigned_full`, `clients_sales_rep_assigned_full`)
      // grant visibility with NO tenant predicate, so a row in ANOTHER tenant can still be
      // offered by an UNBOUND legacy caller. New scoped consumers filter every
      // name/address/id read and recheck actual workspace before releasing results.
      //
      // §37 — this component is also the contact picker in the Conversations compose dialog
      // (`src/pages/admin/conversations/ComposeThreadDialog.tsx`), so the filter narrows that
      // surface too. Intended: an unowned client row is not a valid conversation target either.
      const t = sanitize(term);
      const assertWorkspace = async () => {
        if (!current()) throw Error("picker_retired");
        if (tenantId === undefined) return;
        const rpc = supabase as unknown as { rpc(name: "get_paige_persona_context"): PromiseLike<{ data: unknown; error: unknown }> };
        const result = await rpc.rpc("get_paige_persona_context");
        const data = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!current() || result.error || !data || typeof data !== "object"
          || (data as Record<string, unknown>).tenant_id !== tenantId) throw Error("picker_scope_unavailable");
      };
      await assertWorkspace();
      const readClients = (filter: (query: ReturnType<typeof clientsQuery>) => ReturnType<typeof clientsQuery>) =>
        filter(tenantId === undefined ? clientsQuery() : clientsQuery().eq("tenant_id", tenantId)).then(({ data, error }) => {
          if (error || !Array.isArray(data)) throw Error("picker_unavailable");
          const rows = data as unknown as ClientQueryRow[];
          if (tenantId !== undefined && rows.some(row => row.tenant_id !== tenantId)) throw Error("picker_scope_unavailable");
          return rows;
        });
      const methodQuery = clientContactMethodsTable().select("client_id,tenant_id").eq("kind", "email");
      const methods = tenantId === undefined ? methodQuery : methodQuery.eq("tenant_id", tenantId);

      // A search matches a name or company on the contact row, or ANY of the contact's email
      // addresses (not only the primary), which live in its contact methods.
      const [byName, byEmail] = await Promise.all([
        readClients((query) => (t ? query.or(`first_name.ilike.%${t}%,last_name.ilike.%${t}%,entity_name.ilike.%${t}%`) : query)),
        t
          ? methods.ilike("value", `%${t}%`).limit(50)
            .then(({ data, error }) => {
              if (error || !Array.isArray(data)) throw Error("picker_unavailable");
              const rows = data as unknown as { client_id: string; tenant_id?: string }[];
              if (tenantId !== undefined && rows.some(row => row.tenant_id !== tenantId)) throw Error("picker_scope_unavailable");
              return [...new Set(rows.map(row => row.client_id))];
            })
          : Promise.resolve([] as string[]),
      ]);
      if (!current()) return;
      const seen = new Set(byName.map((row) => row.id));
      const emailOnly = byEmail.filter((clientId) => !seen.has(clientId));
      const extra = emailOnly.length ? await readClients((query) => query.in("id", emailOnly)) : [];
      await assertWorkspace();
      const merged = [...byName, ...extra]
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, 50)
        .map(toClientRow);

      // Ignore stale responses so the latest keystroke always wins.
      if (!current()) return;
      setRows(merged);
      setLoading(false);
      } catch {
        if (!current()) return;
        setRows([]); setFailed(true); setLoading(false);
      }
    }, 250);

    return () => { clearTimeout(handle); reqId.current++; };
  }, [term, open, tenantId, retry]);

  return (
    <Popover open={open && tenantId !== null} onOpenChange={value => { reqId.current++; setOpen(value); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={tenantId === null}
          className="w-full justify-between font-normal"
        >
          <span className="truncate text-muted-foreground">Select a customer…</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        {/* shouldFilter={false}: render exactly what the server returns (B2). */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name, business, email…"
            value={term}
            onValueChange={value => { reqId.current++; setRows([]); setLoading(true); setTerm(value); }}
          />
          <CommandList>
            {onRequestCreate && (
              <CommandGroup>
                <CommandItem
                  value="__create_new_contact__"
                  onSelect={() => {
                    onRequestCreate(term.trim() || undefined);
                    setOpen(false);
                    setTerm("");
                  }}
                >
                  <UserPlus className="mr-2 h-4 w-4 text-muted-foreground" />
                  Create new contact
                </CommandItem>
              </CommandGroup>
            )}
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            ) : failed ? (
              <div className="p-3 text-sm text-muted-foreground" role="status">
                Couldn’t load contacts. <button type="button" className="underline underline-offset-4" onClick={() => setRetry(value => value + 1)}>Try again</button>
              </div>
            ) : (
              <CommandEmpty>
                <div className="p-2 text-center text-sm text-muted-foreground">
                  No one by that name.
                </div>
              </CommandEmpty>
            )}
            {!loading && !failed && rows.length > 0 && (
              <CommandGroup>
                {rows.map((c) => {
                  const f = toFocused(c);
                  return (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      onSelect={() => {
                        onSelect(f);
                        setOpen(false);
                        setTerm("");
                      }}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">
                          {f.name}
                          {f.entity && f.entity !== f.name && (
                            <span className="text-muted-foreground"> · {f.entity}</span>
                          )}
                        </span>
                        {f.email && <span className="text-xs text-muted-foreground truncate">{f.email}</span>}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
