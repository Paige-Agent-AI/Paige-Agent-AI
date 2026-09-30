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
const CUSTOMER_SELECT: string = `id,first_name,last_name,entity_name,lifecycle_stage,created_at,${CLIENT_CONTACT_METHODS_EMBED}`;

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
  /** When provided, renders a persistent "＋ Create new contact" item at the top of the
   *  list (used by the Conversations compose-new modal). The current search term is handed
   *  back as `seedTerm` so the create flow can pre-fill the name/email/phone the user already
   *  typed (§36 — never make them retype it). Omitted callers (e.g. PaigeSidebar) see no
   *  create affordance — fully backward-compatible. */
  onRequestCreate?: (seedTerm?: string) => void;
}

export function CustomerSelector({ onSelect, onRequestCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    if (!open) return;
    const id = ++reqId.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      // §58 — narrow the picker toward what the server will actually accept. `paige-ai-chat`
      // authorizes a focused client by TENANT EQUALITY and excludes `tenant_id IS NULL`, and the
      // `clients` `tenant_isolation` policy admits NULL-tenant rows to ANY authenticated user
      // with no NOT NULL constraint on the column, so such a row would be pickable here and
      // silently unusable in chat. Zero exist in production today; this stops them drifting.
      //
      // HONEST LIMIT (§13): this closes the NULL-tenant case ONLY. The assignment policies
      // (`clients_coaches_assigned`, `clients_cs_rep_assigned_full`, `clients_sales_rep_assigned_full`)
      // grant visibility with NO tenant predicate, so a row in ANOTHER tenant can still be
      // offered here and still be refused by the guard. Closing that needs the caller's tenant,
      // which this component does not currently hold — tracked, not silently fixed.
      //
      // §37 — this component is also the contact picker in the Conversations compose dialog
      // (`src/pages/admin/conversations/ComposeThreadDialog.tsx`), so the filter narrows that
      // surface too. Intended: an unowned client row is not a valid conversation target either.
      const t = sanitize(term);
      const readClients = (filter: (query: ReturnType<typeof clientsQuery>) => ReturnType<typeof clientsQuery>) =>
        filter(clientsQuery()).then(({ data }) => (data ?? []) as unknown as ClientQueryRow[]);

      // A search matches a name or company on the contact row, or ANY of the contact's email
      // addresses (not only the primary), which live in its contact methods.
      const [byName, byEmail] = await Promise.all([
        readClients((query) => (t ? query.or(`first_name.ilike.%${t}%,last_name.ilike.%${t}%,entity_name.ilike.%${t}%`) : query)),
        t
          ? clientContactMethodsTable().select("client_id").eq("kind", "email").ilike("value", `%${t}%`).limit(50)
            .then(({ data }) => [...new Set(((data ?? []) as { client_id: string }[]).map((row) => row.client_id))])
          : Promise.resolve([] as string[]),
      ]);
      const seen = new Set(byName.map((row) => row.id));
      const emailOnly = byEmail.filter((clientId) => !seen.has(clientId));
      const extra = emailOnly.length ? await readClients((query) => query.in("id", emailOnly)) : [];
      const merged = [...byName, ...extra]
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, 50)
        .map(toClientRow);

      // Ignore stale responses so the latest keystroke always wins.
      if (id !== reqId.current) return;
      setRows(merged);
      setLoading(false);
    }, 250);

    return () => clearTimeout(handle);
  }, [term, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
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
            onValueChange={setTerm}
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
            ) : (
              <CommandEmpty>
                <div className="p-2 text-center text-sm text-muted-foreground">
                  No one by that name.
                </div>
              </CommandEmpty>
            )}
            {!loading && rows.length > 0 && (
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
