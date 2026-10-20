/* eslint-disable @typescript-eslint/no-explicit-any -- pre-existing legacy `any` debt in this
   file (untyped Supabase reads, stale generated types). The E09 Customer Portal identity change
   (CURA, never PAIGE, on customer surfaces) only edited copy here and introduced ZERO new `any`s;
   retyping is tracked separately (#234). */
import { useState, useEffect } from "react";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle2, AlertTriangle, XCircle, Globe, Info,
  ExternalLink, Sparkles, Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PublicPresenceSectionProps {
  businessId: string;
  userId: string;
  onCompletionChange: (pct: number) => void;
}

interface FoundationIdentity {
  legal_name: string;
  address: string;
  phone: string;
  complete: boolean;
}

interface ListingItem {
  key: string;
  label: string;
  urlField: string;
  nameField: string;
  addressField: string;
  phoneField: string;
  createUrl?: string;
  note?: string;
}

const LISTINGS: ListingItem[] = [
  {
    key: "website", label: "Website",
    urlField: "website_url", nameField: "website_name_match", addressField: "website_address_match", phoneField: "website_phone_match",
    note: "A professional website with your business name in the domain is one of the first things lenders verify.",
  },
  {
    key: "google", label: "Google Business Profile",
    urlField: "google_business_url", nameField: "google_name_match", addressField: "google_address_match", phoneField: "google_phone_match",
    createUrl: "https://business.google.com",
  },
  {
    key: "yelp", label: "Yelp Business Listing",
    urlField: "yelp_url", nameField: "yelp_name_match", addressField: "yelp_address_match", phoneField: "yelp_phone_match",
    createUrl: "https://biz.yelp.com",
  },
  {
    key: "linkedin", label: "LinkedIn Company Page",
    urlField: "linkedin_url", nameField: "linkedin_name_match", addressField: "linkedin_address_match", phoneField: "linkedin_phone_match",
    createUrl: "https://linkedin.com/company/setup/new",
  },
  {
    key: "facebook", label: "Facebook Business Page",
    urlField: "facebook_url", nameField: "facebook_name_match", addressField: "facebook_address_match", phoneField: "facebook_phone_match",
    createUrl: "https://facebook.com/pages/creation",
  },
  {
    key: "other1", label: "Other Listing 1",
    urlField: "other1_url", nameField: "other1_name_match", addressField: "other1_address_match", phoneField: "other1_phone_match",
  },
  {
    key: "other2", label: "Other Listing 2",
    urlField: "other2_url", nameField: "other2_name_match", addressField: "other2_address_match", phoneField: "other2_phone_match",
  },
];

type PresenceRow = Record<string, any>;

export function PublicPresenceSection({ businessId, userId, onCompletionChange }: PublicPresenceSectionProps) {
  // The customer's agent (Cura, or the business's own name for it), never PAIGE, the owner's COO.
  const { agentName } = useCustomerIdentity();
  const [foundation, setFoundation] = useState<FoundationIdentity>({ legal_name: "", address: "", phone: "", complete: false });
  const [data, setData] = useState<PresenceRow>({});
  const [rowId, setRowId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [insightText, setInsightText] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);

  useEffect(() => {
    if (businessId) {
      loadFoundation();
      loadPresence();
    }
  }, [businessId]);

  const loadFoundation = async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .select("legal_name, business_street_address, business_city, business_state, business_zip, business_phone")
      .eq("id", businessId)
      .maybeSingle();
    if (!biz) return;
    const addr = [biz.business_street_address, biz.business_city, biz.business_state, biz.business_zip].filter(Boolean).join(", ");
    const complete = !!(biz.legal_name && biz.business_street_address && biz.business_phone);
    setFoundation({ legal_name: biz.legal_name || "", address: addr, phone: biz.business_phone || "", complete });
  };

  const loadPresence = async () => {
    const { data: row } = await supabase
      .from("business_public_presence")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle();
    if (row) {
      setData(row);
      setRowId(row.id);
    }
    calcCompletion(row || {});
  };

  const getStatus = (listing: ListingItem, d: PresenceRow): "complete" | "inconsistent" | "missing" => {
    const url = d[listing.urlField];
    if (!url) return "missing";
    const nameOk = d[listing.nameField] === true;
    const addrOk = d[listing.addressField] === true;
    const phoneOk = d[listing.phoneField] === true;
    return (nameOk && addrOk && phoneOk) ? "complete" : "inconsistent";
  };

  const calcCompletion = (d: PresenceRow) => {
    const complete = LISTINGS.filter(l => getStatus(l, d) === "complete").length;
    onCompletionChange(Math.round((complete / 7) * 100));
  };

  const update = (field: string, value: any) => {
    setData(prev => {
      const next = { ...prev, [field]: value };
      calcCompletion(next);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const payload: Record<string, any> = {
      business_id: businessId,
      user_id: userId,
    };
    LISTINGS.forEach(l => {
      payload[l.urlField] = data[l.urlField] || null;
      payload[l.nameField] = data[l.nameField] || false;
      payload[l.addressField] = data[l.addressField] || false;
      payload[l.phoneField] = data[l.phoneField] || false;
    });
    // labels
    payload.other1_label = data.other1_label || null;
    payload.other2_label = data.other2_label || null;
    // legacy fields
    payload.official_name = foundation.legal_name;
    payload.official_address = foundation.address;
    payload.official_phone = foundation.phone;

    let error;
    if (rowId) {
      ({ error } = await supabase.from("business_public_presence").update(payload as any).eq("id", rowId));
    } else {
      const res = await supabase.from("business_public_presence").insert(payload as any).select("id").single();
      error = res.error;
      if (res.data) setRowId(res.data.id);
    }
    if (error) toast.error("Failed to save"); else toast.success("Public Presence saved");
    setSaving(false);
  };

  const fetchInsight = async () => {
    setInsightLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const completeCount = LISTINGS.filter(l => getStatus(l, data) === "complete").length;
      const inconsistentCount = LISTINGS.filter(l => getStatus(l, data) === "inconsistent").length;
      const missingCount = LISTINGS.filter(l => getStatus(l, data) === "missing").length;
      const res = await supabase.functions.invoke("paige-ai-chat", {
        body: {
          message: `The client's public presence status: ${completeCount}/7 listings complete, ${inconsistentCount} inconsistent, ${missingCount} missing. Give a concise 2-3 sentence coaching insight about what this means for lender verification and the single most important next action. Do not use markdown.`,
          sessionId: `presence-insight-${Date.now()}`,
          userId: user.id,
          skipMemory: true,
        }
      });
      setInsightText(res.data?.reply || res.data?.message || "Focus on getting all listings to match your official business identity exactly.");
    } catch {
      setInsightText("Ensure every listing matches your official business identity for the strongest lender verification outcome.");
    } finally {
      setInsightLoading(false);
    }
  };

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === "complete") return <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
    if (status === "inconsistent") return <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />;
    return <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />;
  };

  const statusLabel = (s: string) => s === "complete" ? "Complete" : s === "inconsistent" ? "Listed — Inconsistent" : "Not Listed";
  const statusColor = (s: string) => s === "complete" ? "bg-emerald-500/20 text-emerald-600 border-emerald-500/30" : s === "inconsistent" ? "bg-amber-500/20 text-amber-600 border-amber-500/30" : "";

  // Consistency audit data
  const auditRows = LISTINGS.filter(l => data[l.urlField]).map(l => {
    const nm = data[l.nameField] === true;
    const am = data[l.addressField] === true;
    const pm = data[l.phoneField] === true;
    const score = [nm, am, pm].filter(Boolean).length;
    const mismatches: string[] = [];
    if (!nm) mismatches.push("Name");
    if (!am) mismatches.push("Address");
    if (!pm) mismatches.push("Phone");
    return { label: l.key === "other1" ? (data.other1_label || "Other 1") : l.key === "other2" ? (data.other2_label || "Other 2") : l.label, url: data[l.urlField], score, mismatches };
  });

  return (
    <div className="space-y-5">
      {/* Section 1: Consistency Standard */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-4">
          <h3 className="text-sm font-semibold text-foreground mb-1">Your Official Business Identity</h3>
          <p className="text-xs text-muted-foreground mb-3">All public listings must match this exactly.</p>
          {!foundation.complete ? (
            <Alert className="border-amber-500/30 bg-amber-500/10">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-700">
                Complete your Foundation tab first to establish your official business identity before building public presence.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-xs text-muted-foreground block">Legal Name</span>
                <span className="font-medium">{foundation.legal_name}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Address</span>
                <span className="font-medium">{foundation.address || "—"}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Phone</span>
                <span className="font-medium">{foundation.phone || "—"}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resource: ListYourself.net */}
      <Card className="border-accent/30 bg-accent/5">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Globe className="w-4 h-4 text-accent-foreground" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
                Set Up Your Public Presence with ListYourself.net
                <Badge variant="outline" className="text-[10px]">Recommended</Badge>
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                ListYourself.net feeds data into LexisNexis and other business identity verification services that lenders use when underwriting business applications. A listing here with your exact legal business name, registered address, and dedicated business phone number strengthens your business identity footprint and improves your chances of passing automated verification checks.
              </p>
              <a
                href="https://www.listyourself.net"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="sm" variant="outline" className="gap-1.5">
                  <ExternalLink className="w-3 h-3" />
                  Go to ListYourself.net
                </Button>
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Checklist */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="w-4 h-4" /> Public Presence Checklist
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {LISTINGS.map(listing => {
            const status = getStatus(listing, data);
            const isOther = listing.key === "other1" || listing.key === "other2";
            return (
              <div key={listing.key} className={`p-3 border rounded-lg space-y-2 ${status === "complete" ? "border-emerald-500/20 bg-emerald-500/5" : status === "inconsistent" ? "border-amber-500/20 bg-amber-500/5" : "border-border"}`}>
                <div className="flex items-center gap-2">
                  <StatusIcon status={status} />
                  <span className="text-sm font-medium flex-1">
                    {isOther ? (
                      <Input
                        value={data[listing.key === "other1" ? "other1_label" : "other2_label"] || ""}
                        onChange={e => update(listing.key === "other1" ? "other1_label" : "other2_label", e.target.value)}
                        placeholder={listing.label}
                        className="text-sm h-7 w-48 inline-block"
                      />
                    ) : listing.label}
                  </span>
                  <Badge variant="outline" className={`text-[10px] ${statusColor(status)}`}>{statusLabel(status)}</Badge>
                </div>

                {listing.note && <p className="text-xs text-muted-foreground ml-6">{listing.note}</p>}

                <div className="ml-6 space-y-2">
                  <Input
                    value={data[listing.urlField] || ""}
                    onChange={e => update(listing.urlField, e.target.value)}
                    placeholder="https://..."
                    className="text-sm h-8"
                  />

                  {status === "missing" && listing.createUrl && (
                    <a href={listing.createUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      Create listing <ExternalLink className="w-3 h-3" />
                    </a>
                  )}

                  {data[listing.urlField] && (
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-1.5 text-xs">
                        <Checkbox checked={data[listing.nameField] === true} onCheckedChange={v => update(listing.nameField, !!v)} />
                        Name matches
                      </label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <Checkbox checked={data[listing.addressField] === true} onCheckedChange={v => update(listing.addressField, !!v)} />
                        Address matches
                      </label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <Checkbox checked={data[listing.phoneField] === true} onCheckedChange={v => update(listing.phoneField, !!v)} />
                        Phone matches
                      </label>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Section 3: Consistency Audit */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="w-4 h-4" /> Consistency Audit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            LexisNexis and other lender verification services build a business identity profile by scanning all your public listings.
            Any discrepancy between listings — a different address on Google versus your state filing, a slightly different business name on Yelp versus LinkedIn — creates a verification failure that can result in automatic decline.
            This audit helps you find and fix those inconsistencies before a lender does.
          </p>

          {auditRows.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2">No listings entered yet. Add URLs above to see your consistency audit.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium">Listing</th>
                    <th className="text-center px-3 py-2 text-xs font-medium">Score</th>
                    <th className="text-left px-3 py-2 text-xs font-medium">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map(row => (
                    <tr key={row.label} className={`border-t ${row.score < 3 ? "bg-amber-500/5" : ""}`}>
                      <td className="px-3 py-2 text-xs font-medium">{row.label}</td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant="outline" className={`text-[10px] ${row.score === 3 ? "bg-emerald-500/20 text-emerald-600 border-emerald-500/30" : "bg-amber-500/20 text-amber-600 border-amber-500/30"}`}>
                          {row.score}/3
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {row.score === 3 ? "✓ All data points match" : `Mismatch: ${row.mismatches.join(", ")}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* The customer's agent's insight */}
          {insightText ? (
            <div className="border border-primary/20 bg-primary/5 rounded-lg p-4 flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs font-semibold text-primary mb-1">{agentName}'s insight</p>
                <p className="text-sm text-foreground">{insightText}</p>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={fetchInsight} disabled={insightLoading}>
              {insightLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
              Get {agentName}'s assessment
            </Button>
          )}
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  );
}
