// Comms C-2s-B-1 — Number marketplace. Extends the CommunicationsAdmin hub as its
// "Numbers" tab (§18: one home per capability — the tenant comms hub already exists
// at /admin/communications; no redundant /app/settings/comms route is scaffolded).
//
// A coach searches an area code, sees real numbers priced at the retail rate (§38 Paige-held
// rail, resale platform #150 — the Twilio wholesale cost plus a flat $0.05 platform fee, from
// platform_number_pricing), sees each number's capabilities as neutral icons (never a
// pre-filter, §36 bug #149), and clicks Buy — without ever hearing the word "Twilio" (§36).
//
// §9: the search + purchase run through the comms-search-numbers / comms-purchase-number
// edge fns, which derive the tenant server-side and resolve the tenant's OWN subaccount
// creds — this client never supplies a tenant/subaccount. tenant_phone_numbers is not in
// the generated types, so its read goes through (supabase as any) (§13 honest typing).
// §13: purchased state is only ever shown on a real edge-fn success (a real Twilio SID);
// a missing subaccount degrades to an honest needs_config state, never a fake number.
import { useCallback, useEffect, useState } from "react";
import { PhoneCall, Search, Hash, SquarePen, MessageSquare, Phone, Image, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  SectionCard,
  DataTableShell,
  EmptyState,
  Toolbar,
  StatePill,
} from "@/components/ui/page";
import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---- Contracts the backend lane ships (matched exactly, §37) -----------------
// comms-search-numbers  ← { area_code? }   (sms_enabled is headless-only; the UI never sends it — #149)
//                       → { numbers: SearchNumber[]; needs_config?: boolean }
// comms-purchase-number ← { phone_number }
//                       → { purchased|already_owned: true; phone_number; twilio_sid } | { error }
type RawCapabilities = Record<string, boolean>;
/** Retail price (§38, #150): the Twilio wholesale cost plus a flat $0.05 platform fee. */
interface RetailPrice {
  monthly_cents: number;
  onetime_cents: number | null;
  currency: string;
}
interface SearchNumber {
  phone_number: string; // E.164, +1XXXXXXXXXX
  capabilities: RawCapabilities;
  retail_price: RetailPrice | null;
}
interface OwnedNumber {
  id: string;
  phone_number: string;
  capabilities: RawCapabilities;
  status: string;
  source: string;
  friendly_name: string | null;
}

type Capability = "sms" | "mms" | "voice";
// Capabilities render as neutral lucide icons (DISPLAY, never a pre-filter — §36 bug #149).
// Each carries an accessible label so the meaning is never icon-only. Domain-plain wording
// (§36): what the line can do, not Twilio jargon.
const CAP_META: Record<Capability, { Icon: LucideIcon; label: string }> = {
  sms: { Icon: MessageSquare, label: "Texts (SMS)" },
  mms: { Icon: Image, label: "Picture messages (MMS)" },
  voice: { Icon: Phone, label: "Calls (voice)" },
};

/** Case-tolerant read of a Twilio capability flag ({sms} or {SMS}). */
const hasCap = (c: RawCapabilities | null | undefined, cap: Capability): boolean => {
  if (!c) return false;
  const lower = (c as Record<string, boolean | undefined>)[cap];
  const upper = (c as Record<string, boolean | undefined>)[cap.toUpperCase()];
  return Boolean(lower ?? upper);
};

const fmtE164 = (raw: string): string => {
  // +14702003444 → +1 (470) 200-3444, US 10-digit; anything else shown as-is.
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(raw);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : raw;
};

const fmtPrice = (p: RetailPrice): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (p.currency || "usd").toUpperCase(),
  }).format(p.monthly_cents / 100);

const AREA_CODE_RE = /^\d{3}$/;

const OWNED_COLS = [
  { key: "number", header: "Number" },
  { key: "caps", header: "Handles" },
  { key: "status", header: "Status" },
];
const RESULT_COLS = [
  { key: "number", header: "Number" },
  { key: "caps", header: "Handles" },
  { key: "price", header: "Price" },
  { key: "buy", header: "", className: "w-28 text-right" },
];

function CapPills({ caps }: { caps: RawCapabilities }) {
  const active = (["sms", "mms", "voice"] as Capability[]).filter((c) => hasCap(caps, c));
  if (active.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  // Capabilities are resting DISPLAY metadata, not the act — neutral/indigo icons only. Gold
  // is spent solely on the Buy button (§11 gold-only-on-act). Each icon has an accessible
  // label + title so it is never meaning-by-color or icon-only.
  return (
    <div className="flex items-center gap-2.5">
      {active.map((c) => {
        const { Icon, label } = CAP_META[c];
        return (
          <span
            key={c}
            role="img"
            aria-label={label}
            title={label}
            className="inline-flex items-center text-muted-foreground"
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        );
      })}
    </div>
  );
}

/**
 * Edge-function error codes are internal identifiers, not tenant copy.
 * `comms-purchase-number` returns machine codes and this surface used to render
 * them verbatim, so a tenant could be shown "inbound_webhook_secret_missing".
 * Unknown codes fall back to the generic line rather than leaking the raw value.
 */
function purchaseFailureCopy(code: string | undefined): string {
  switch (code) {
    case "twilio_subaccount_not_provisioned":
    case "twilio_subaccount_row_missing":
    case "inbound_webhook_secret_missing":
    case "voice_twiml_url_unavailable":
      return "Your business isn't set up to buy numbers yet. Once setup finishes you'll be able to grab one.";
    case "number_unavailable":
      return "That one just went to someone else. Pick another and try again.";
    case "number_purchase_failed":
      return "The provider couldn't complete that purchase. Try another number.";
    // Only reachable now that this lane sends the amount it displayed. The server refusing
    // to charge a price nobody was shown is the RIGHT outcome — but without these two, it
    // surfaced as "try another number", which is wrong and sends people in a loop.
    case "price_changed":
      return "That number's price changed while you were looking at it, so nothing was bought. Search again to see what it costs now.";
    case "price_unverifiable":
      return "We couldn't confirm this number's price, so nothing was bought. Try again shortly — no charge was made.";
    default:
      return "Try another — this one may have just been taken.";
  }
}

export function NumbersTab() {
  const { toast } = useToast();

  // Owned numbers (what the practice already runs on).
  const [owned, setOwned] = useState<OwnedNumber[]>([]);
  const [ownedLoading, setOwnedLoading] = useState(true);

  // Search state. No capability pre-filter — a coach searches an area code and sees ALL
  // numbers; capabilities are shown as icons per result, never pre-picked (§36 bug #149).
  const [areaCode, setAreaCode] = useState("");
  const [results, setResults] = useState<SearchNumber[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [needsConfig, setNeedsConfig] = useState(false);
  const [priceConfigured, setPriceConfigured] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);

  const loadOwned = useCallback(async () => {
    setOwnedLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("tenant_phone_numbers")
      .select("id, phone_number, capabilities, status, source, friendly_name")
      .order("created_at", { ascending: false });
    setOwned((data as OwnedNumber[]) ?? []);
    setOwnedLoading(false);
  }, []);

  useEffect(() => { void loadOwned(); }, [loadOwned]);

  const areaCodeValid = areaCode === "" || AREA_CODE_RE.test(areaCode);

  const runSearch = async () => {
    setSearchError(null);
    if (areaCode && !AREA_CODE_RE.test(areaCode)) {
      setSearchError("An area code is 3 digits — like 470 or 305.");
      return;
    }
    setSearching(true);
    setResults(null);
    setNeedsConfig(false);
    try {
      // Area code is the ONLY filter (§36 bug #149): we never send a channel flag, so the
      // fn returns ALL capability numbers and the coach never pre-picks SMS/MMS/Voice.
      const { data, error } = await supabase.functions.invoke("comms-search-numbers", {
        body: {
          area_code: areaCode || undefined,
        },
      });
      if (error) throw error;
      const payload = (data ?? {}) as { numbers?: SearchNumber[]; needs_config?: boolean; price_configured?: boolean };
      // needs_config = this practice CAN'T buy yet (no subaccount) — block with a setup nudge.
      // A missing operator PRICE row is NOT needs_config: the numbers still show (price "—")
      // with a quiet "pricing pending" note, so real numbers are never hidden (§13, S1 fix).
      if (payload.needs_config) {
        setNeedsConfig(true);
        setResults([]);
        return;
      }
      setPriceConfigured(payload.price_configured !== false);
      setResults(payload.numbers ?? []);
    } catch {
      setSearchError("Couldn't pull numbers just now. Give it another moment.");
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  const buy = async (n: SearchNumber) => {
    // This surface used to buy on a single click — `onClick={() => void buy(n)}`, no
    // confirmation of any kind — and renders the price as "—" when the operator has not
    // priced the type. One click could therefore start a recurring charge at an amount
    // nobody had been shown. The Solo lane already asks; this is the same question, worded
    // the same way, so the two read as one product rather than two.
    const priceLabel = n.retail_price ? fmtPrice(n.retail_price) + " a month" : "an unlisted monthly price";
    if (!window.confirm(
      `Buy ${fmtE164(n.phone_number)} for ${priceLabel}?\n\nThis charges your business and the number becomes yours immediately.`,
    )) return;

    setBuying(n.phone_number);
    try {
      const { data, error } = await supabase.functions.invoke("comms-purchase-number", {
        body: {
          phone_number: n.phone_number,
          // The amount the operator just agreed to. The server re-reads
          // `platform_number_pricing` and refuses with `price_changed` if it moved — a
          // check that was being SKIPPED entirely for this lane, because the guard reads
          // `if (agreedMonthlyCents !== null)` and this body never carried one.
          ...(n.retail_price ? { agreed_monthly_cents: n.retail_price.monthly_cents } : {}),
        },
      });
      if (error) throw error;
      const payload = (data ?? {}) as { phone_number?: string; twilio_sid?: string; error?: string };
      // §13: only treat it as bought when the edge fn returns a real Twilio SID.
      if (payload.error || !payload.twilio_sid) {
        toast({
          title: "That number didn't go through",
          description: purchaseFailureCopy(payload.error),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: `${fmtE164(payload.phone_number ?? n.phone_number)} is yours`,
        // §13 A2P honesty: a freshly bought number can take calls right away, but SMS sends
        // don't turn on until the practice's A2P messaging registration is approved.
        description: "It's on your practice now — Paige can take calls from it right away. Texting turns on once your practice is approved to send.",
      });
      // Drop it from the results and refresh the owned list from the source of truth.
      setResults((prev) => (prev ? prev.filter((r) => r.phone_number !== n.phone_number) : prev));
      await loadOwned();
    } catch {
      toast({
        title: "That number didn't go through",
        description: "Try another — this one may have just been taken.",
        variant: "destructive",
      });
    } finally {
      setBuying(null);
    }
  };

  const anySearched = results !== null;
  const noResults = anySearched && !needsConfig && (results?.length ?? 0) === 0;

  return (
    <div className="space-y-6">
      {/* What the practice already runs on. */}
      <SectionCard
        title="Your numbers"
        description="The lines Paige takes calls from — and texts from once messaging is approved — on your behalf."
      >
        <DataTableShell
          columns={OWNED_COLS}
          loading={ownedLoading}
          isEmpty={owned.length === 0}
          empty={
            <EmptyState
              icon={PhoneCall}
              title="No number on your practice yet"
              description="Grab one below and Paige starts texting and taking calls from it the moment it's yours."
            />
          }
        >
          {owned.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{fmtE164(row.phone_number)}</span>
                  {row.friendly_name && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <SquarePen className="h-3 w-3" />
                      {row.friendly_name}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell><CapPills caps={row.capabilities} /></TableCell>
              <TableCell>
                <StatePill state={row.status === "active" ? "success" : "pending"}>
                  {row.status === "active" ? "Live" : row.status}
                </StatePill>
              </TableCell>
            </TableRow>
          ))}
        </DataTableShell>
      </SectionCard>

      {/* Find + buy a number. */}
      <SectionCard
        title="Get a number"
        description="Enter an area code — Paige finds available numbers, shows what each can do, and you own it in one click."
      >
        <div className="space-y-4">
          <Toolbar className="items-end">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="nm-area">Area code</Label>
                <div className="relative">
                  <Hash className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="nm-area"
                    value={areaCode}
                    inputMode="numeric"
                    maxLength={3}
                    placeholder="470"
                    aria-invalid={!areaCodeValid}
                    className="w-28 pl-8 font-mono"
                    onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
                    onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Leave blank for any.</p>
              </div>
            </div>

            <Button onClick={() => void runSearch()} disabled={searching} className="shrink-0">
              <Search className="mr-1.5 h-4 w-4" />
              {searching ? "Finding…" : "Find numbers"}
            </Button>
          </Toolbar>

          {searchError && (
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{searchError}</div>
          )}

          {/* Results / states. Before the first search, a quiet prompt (not a bare blank). */}
          {!anySearched && !searching ? (
            <EmptyState
              icon={Search}
              title="Search to see what's available"
              description={
                areaCode
                  ? `Paige will pull available numbers in ${areaCode} and show what each one can do.`
                  : "Enter an area code (or leave it blank for any), then find numbers to buy."
              }
            />
          ) : needsConfig ? (
            <EmptyState
              icon={PhoneCall}
              title="Set up messaging for your practice first"
              description="Paige needs your practice's messaging set up before you can buy a number. It takes a minute — then come back and grab one."
            />
          ) : noResults ? (
            <EmptyState
              icon={Search}
              title="Nothing open in that area code"
              description="Try a nearby area code, or clear it to see what's available anywhere."
            />
          ) : (
            <>
            {!priceConfigured && (
              <div className="mb-3 rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
                Pricing for these numbers is still being set up — you can browse now; the monthly price shows once it's ready.
              </div>
            )}
            <DataTableShell
              columns={RESULT_COLS}
              loading={searching}
              isEmpty={false}
            >
              {(results ?? []).map((n) => (
                <TableRow key={n.phone_number}>
                  <TableCell className="font-mono text-sm">{fmtE164(n.phone_number)}</TableCell>
                  <TableCell><CapPills caps={n.capabilities} /></TableCell>
                  <TableCell>
                    {n.retail_price ? (
                      // §36/§38 honest: this is the retail price — Twilio wholesale plus a
                      // flat $0.05 platform fee (#150). The title states that on hover.
                      <span title="Wholesale + $0.05 platform fee">
                        <span className="font-semibold tabular-nums">{fmtPrice(n.retail_price)}</span>
                        <span className="text-xs text-muted-foreground">/mo</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {/* Gold is spent ONLY here — the buy/act moment (§11). */}
                    <Button
                      variant="gold"
                      size="sm"
                      disabled={buying !== null}
                      onClick={() => void buy(n)}
                    >
                      {buying === n.phone_number ? "Getting it…" : "Buy"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </DataTableShell>
            </>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
