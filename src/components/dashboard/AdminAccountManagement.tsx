import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables, TablesUpdate } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle, Check, Copy, Edit2, Flag, Loader2, Merge, Search,
  Trash2, X, XCircle, Database, Clock, Download, Bell, Eye, FileText,
} from "lucide-react";
import { toast } from "sonner";

/* ─── Types ─── */
interface AccountRecord {
  id: string;
  creditor: string;
  type: string;
  bureau?: string;
  amount?: number | null;
  balance?: number | null;
  credit_limit?: number | null;
  status?: string | null;
  is_open?: boolean | null;
  is_authorized_user?: boolean | null;
  duplicate_of_id?: string | null;
  is_disputed_ownership?: boolean | null;
  table_source: "credit_accounts" | "credit_negative_items";
  item_type?: string;
  account_number_masked?: string | null;
  updated_at?: string | null;
}

interface AuditEntry {
  id: string;
  account_id: string | null;
  modification_type: string;
  modification_source: string;
  modified_by_user_id: string;
  previous_value: Json;
  new_value: Json;
  notes: string | null;
  created_at: string;
  modifier_name?: string;
}

interface MergeSuggestion {
  primary: AccountRecord;
  duplicate: AccountRecord;
  reason: string;
  similarity: number;
}

type FilterKey = "all" | "negatives" | "good_standing" | "disputed" | "duplicates" | "paige" | "client";

interface AdminAccountManagementProps {
  clientUserId: string;
  clientId?: string; // internal client id
  userRole: "admin" | "member";
}

// The stored label for an edit made by a staff member who is not an admin. 'coach_ui' is the value the
// modification-log CHECK constraint accepts; it is a data label, not a role.
const STAFF_UI_SOURCE = "coach_ui";

const ACCOUNT_TYPES = ["credit_card", "auto_loan", "personal_loan", "mortgage", "student_loan", "collections", "other"];
const BUREAUS = ["Experian", "TransUnion", "Equifax"];

function fuzzyMatch(a: string, b: string): number {
  const la = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const lb = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (la === lb) return 1;
  if (la.includes(lb) || lb.includes(la)) return 0.9;
  const bigramsA = new Set<string>();
  for (let i = 0; i < la.length - 1; i++) bigramsA.add(la.slice(i, i + 2));
  const bigramsB = new Set<string>();
  for (let i = 0; i < lb.length - 1; i++) bigramsB.add(lb.slice(i, i + 2));
  let shared = 0;
  bigramsA.forEach(bg => { if (bigramsB.has(bg)) shared++; });
  return bigramsA.size + bigramsB.size === 0 ? 0 : (2 * shared) / (bigramsA.size + bigramsB.size);
}

export function AdminAccountManagement({ clientUserId, clientId, userRole }: AdminAccountManagementProps) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<AccountRecord>>({});
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeSuggestions, setMergeSuggestions] = useState<MergeSuggestion[]>([]);
  const [markDupDialogId, setMarkDupDialogId] = useState<string | null>(null);
  const [selectedDupTarget, setSelectedDupTarget] = useState("");
  const [notMineDialogId, setNotMineDialogId] = useState<string | null>(null);
  const disputedRef = useRef<HTMLDivElement>(null);

  // ─── Fetch all accounts (including duplicates for admin view) ───
  const { data: allAccounts = [], isLoading } = useQuery({
    queryKey: ["admin-account-mgmt", clientUserId],
    queryFn: async () => {
      const [{ data: creditAccounts }, { data: negItems }] = await Promise.all([
        supabase.from("credit_accounts").select("*").eq("user_id", clientUserId).order("creditor"),
        supabase.from("credit_negative_items").select("*").eq("user_id", clientUserId).neq("status", "removed").order("creditor_name"),
      ]);

      const records: AccountRecord[] = [];
      (creditAccounts || []).forEach((a: Tables<"credit_accounts">) => {
        records.push({
          id: a.id, creditor: a.creditor, type: a.type,
          amount: a.balance ?? a.current_balance, balance: a.balance,
          credit_limit: a.credit_limit ?? a.limit_amount, status: a.status,
          is_open: a.is_open, is_authorized_user: a.is_authorized_user,
          duplicate_of_id: a.duplicate_of_id, is_disputed_ownership: a.is_disputed_ownership,
          table_source: "credit_accounts", account_number_masked: null, updated_at: a.updated_at,
        });
      });
      (negItems || []).forEach((n: Tables<"credit_negative_items">) => {
        records.push({
          id: n.id, creditor: n.creditor_name || "Unknown", type: n.item_type,
          bureau: n.bureau, amount: n.amount, status: n.status,
          duplicate_of_id: n.duplicate_of_id, is_disputed_ownership: n.is_disputed_ownership,
          table_source: "credit_negative_items", item_type: n.item_type,
          account_number_masked: n.account_number_masked, updated_at: n.updated_at,
        });
      });
      return records;
    },
  });

  // ─── Fetch audit log ───
  const { data: auditLog = [], isLoading: auditLoading } = useQuery({
    queryKey: ["admin-audit-log", clientUserId],
    queryFn: async () => {
      const { data } = await supabase
        .from("account_modifications")
        .select("*")
        .eq("user_id", clientUserId)
        .order("created_at", { ascending: false })
        .limit(200);

      // Resolve modifier names
      const entries = data || [];
      const modifierIds = [...new Set(entries.map(e => e.modified_by_user_id).filter(Boolean))];
      const nameMap: Record<string, string> = {};
      if (modifierIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", modifierIds);
        (profiles || []).forEach((p) => { nameMap[p.user_id] = p.full_name || "Unknown"; });
      }

      return entries.map(e => ({
        ...e,
        modifier_name: e.modification_source === "paige_chat" ? "Paige AI" : (nameMap[e.modified_by_user_id] || "System"),
      })) as AuditEntry[];
    },
  });

  // ─── Computed stats ───
  const activeAccounts = useMemo(() => allAccounts.filter(a => !a.duplicate_of_id), [allAccounts]);
  const disputedAccounts = useMemo(() => activeAccounts.filter(a => a.is_disputed_ownership), [activeAccounts]);
  const duplicateAccounts = useMemo(() => allAccounts.filter(a => a.duplicate_of_id), [allAccounts]);

  const potentialDuplicates = useMemo(() => {
    const sug: MergeSuggestion[] = [];
    const active = activeAccounts.filter(a => !a.is_disputed_ownership);
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        const sim = fuzzyMatch(a.creditor, b.creditor);
        if (sim < 0.8) continue;
        const amtA = a.amount ?? a.balance ?? 0;
        const amtB = b.amount ?? b.balance ?? 0;
        const maxAmt = Math.max(amtA, amtB);
        const amtClose = maxAmt === 0 || Math.abs(amtA - amtB) / maxAmt <= 0.1;
        if (sim >= 0.8 && (a.type === b.type || amtClose)) {
          const reasons: string[] = [];
          if (sim >= 0.95) reasons.push("Exact name match");
          else reasons.push(`${Math.round(sim * 100)}% name similarity`);
          if (amtClose && maxAmt > 0) reasons.push("Amounts within 10%");
          if (a.type === b.type) reasons.push("Same account type");
          sug.push({ primary: a, duplicate: b, reason: reasons.join(", "), similarity: sim });
        }
      }
    }
    return sug.sort((a, b) => b.similarity - a.similarity);
  }, [activeAccounts]);

  // Modified-by-paige filter
  const paigeModifiedIds = useMemo(() => {
    return new Set(auditLog.filter(a => a.modification_source === "paige_chat").map(a => a.account_id));
  }, [auditLog]);
  const clientModifiedIds = useMemo(() => {
    return new Set(auditLog.filter(a => a.modification_source === "client_ui").map(a => a.account_id));
  }, [auditLog]);

  // Last modification info per account
  const lastModMap = useMemo(() => {
    const map: Record<string, { by: string; at: string }> = {};
    auditLog.forEach(e => {
      if (e.account_id && !map[e.account_id]) {
        map[e.account_id] = { by: e.modifier_name || "System", at: e.created_at };
      }
    });
    return map;
  }, [auditLog]);

  // ─── Filtered view ───
  const filteredAccounts = useMemo(() => {
    let list = activeAccounts;
    const term = searchTerm.toLowerCase();
    if (term) list = list.filter(a => a.creditor.toLowerCase().includes(term) || (a.type || "").toLowerCase().includes(term));

    switch (filter) {
      case "negatives": return list.filter(a => a.table_source === "credit_negative_items" && !a.is_disputed_ownership);
      case "good_standing": return list.filter(a => a.table_source === "credit_accounts" && !a.is_disputed_ownership);
      case "disputed": return list.filter(a => a.is_disputed_ownership);
      case "duplicates": return allAccounts.filter(a => a.duplicate_of_id);
      case "paige": return list.filter(a => paigeModifiedIds.has(a.id));
      case "client": return list.filter(a => clientModifiedIds.has(a.id));
      default: return list.filter(a => !a.is_disputed_ownership);
    }
  }, [activeAccounts, allAccounts, searchTerm, filter, paigeModifiedIds, clientModifiedIds]);

  // ─── Mutations ───
  const editMutation = useMutation({
    mutationFn: async ({ record, updates }: { record: AccountRecord; updates: Partial<AccountRecord> }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const prev: Record<string, Json | undefined> = {};
      const next: Record<string, Json | undefined> = {};

      if (record.table_source === "credit_accounts") {
        const payload: TablesUpdate<"credit_accounts"> = { updated_at: new Date().toISOString() };
        if (updates.creditor !== undefined) { prev.creditor = record.creditor; next.creditor = updates.creditor; payload.creditor = updates.creditor; }
        if (updates.type !== undefined) { prev.type = record.type; next.type = updates.type; payload.type = updates.type as TablesUpdate<"credit_accounts">["type"]; }
        if (updates.status !== undefined) { prev.status = record.status; next.status = updates.status; payload.status = updates.status; }
        if (updates.credit_limit !== undefined) { prev.credit_limit = record.credit_limit; next.credit_limit = updates.credit_limit; payload.credit_limit = updates.credit_limit; }
        await supabase.from("credit_accounts").update(payload).eq("id", record.id);
      } else {
        const payload: TablesUpdate<"credit_negative_items"> = { updated_at: new Date().toISOString() };
        if (updates.creditor !== undefined) { prev.creditor_name = record.creditor; next.creditor_name = updates.creditor; payload.creditor_name = updates.creditor; }
        if (updates.type !== undefined) { prev.item_type = record.type; next.item_type = updates.type; payload.item_type = updates.type; }
        if (updates.bureau !== undefined) { prev.bureau = record.bureau; next.bureau = updates.bureau; payload.bureau = updates.bureau; }
        if (updates.amount !== undefined) { prev.amount = record.amount; next.amount = updates.amount; payload.amount = updates.amount; }
        if (updates.status !== undefined) { prev.status = record.status; next.status = updates.status; payload.status = updates.status; }
        await supabase.from("credit_negative_items").update(payload).eq("id", record.id);

      }

      await supabase.from("account_modifications").insert({
        account_id: record.id, account_table: record.table_source,
        user_id: clientUserId, client_id: clientId || null,
        modified_by_user_id: session.user.id,
        modification_type: "edit", modification_source: userRole === "admin" ? "admin_ui" : STAFF_UI_SOURCE,
        previous_value: prev, new_value: next,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-account-mgmt"] });
      queryClient.invalidateQueries({ queryKey: ["admin-audit-log"] });
      // Admin-side edits to a client's accounts must also refresh that
      // client's fundability inputs.
      queryClient.invalidateQueries({ queryKey: ["three-fundability-inputs"] });
      queryClient.invalidateQueries({ queryKey: ["funding-readiness-supplemental"] });
      setEditingId(null);
      setEditValues({});
      toast.success("Account updated and audit logged.");
    },
    onError: (err: Error) => toast.error("Update failed", { description: err.message }),
  });

  const markNotMineMutation = useMutation({
    mutationFn: async (record: AccountRecord) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      if (record.table_source === "credit_negative_items") {
        await supabase.from("credit_negative_items").update({ is_disputed_ownership: true, status: "disputed" }).eq("id", record.id);
      } else {
        await supabase.from("credit_accounts").update({ is_disputed_ownership: true, status: "disputed_ownership" }).eq("id", record.id);
      }
      await supabase.from("account_modifications").insert({
        account_id: record.id, account_table: record.table_source,
        user_id: clientUserId, client_id: clientId || null,
        modified_by_user_id: session.user.id,
        modification_type: "mark_not_mine", modification_source: userRole === "admin" ? "admin_ui" : STAFF_UI_SOURCE,
        previous_value: { status: record.status }, new_value: { is_disputed_ownership: true },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-account-mgmt"] });
      queryClient.invalidateQueries({ queryKey: ["admin-audit-log"] });
      queryClient.invalidateQueries({ queryKey: ["three-fundability-inputs"] });
      queryClient.invalidateQueries({ queryKey: ["funding-readiness-supplemental"] });
      setNotMineDialogId(null);
      toast.success("Flagged as Not Mine — excluded from scoring.");
    },
  });

  const markDuplicateMutation = useMutation({
    mutationFn: async ({ duplicateId, primaryId }: { duplicateId: string; primaryId: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const record = allAccounts.find(a => a.id === duplicateId);
      if (!record) throw new Error("Account not found");
      if (record.table_source === "credit_negative_items") {
        await supabase.from("credit_negative_items").update({ duplicate_of_id: primaryId, status: "removed" }).eq("id", duplicateId);
      } else {
        await supabase.from("credit_accounts").update({ duplicate_of_id: primaryId }).eq("id", duplicateId);
      }
      await supabase.from("account_modifications").insert({
        account_id: duplicateId, account_table: record.table_source,
        user_id: clientUserId, client_id: clientId || null,
        modified_by_user_id: session.user.id,
        modification_type: "merge", modification_source: userRole === "admin" ? "admin_ui" : STAFF_UI_SOURCE,
        previous_value: { creditor: record.creditor }, new_value: { duplicate_of_id: primaryId },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-account-mgmt"] });
      queryClient.invalidateQueries({ queryKey: ["admin-audit-log"] });
      queryClient.invalidateQueries({ queryKey: ["three-fundability-inputs"] });
      queryClient.invalidateQueries({ queryKey: ["funding-readiness-supplemental"] });
      setMarkDupDialogId(null);
      setSelectedDupTarget("");
      toast.success("Duplicate merged.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (record: AccountRecord) => {
      if (userRole !== "admin") throw new Error("Only admins can delete accounts");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      if (record.table_source === "credit_negative_items") {
        await supabase.from("credit_negative_items").update({ status: "removed" }).eq("id", record.id);
      } else {
        await supabase.from("credit_accounts").delete().eq("id", record.id);
      }
      await supabase.from("account_modifications").insert({
        account_id: record.id, account_table: record.table_source,
        user_id: clientUserId, client_id: clientId || null,
        modified_by_user_id: session.user.id,
        modification_type: "delete", modification_source: "admin_ui",
        previous_value: { creditor: record.creditor, type: record.type }, new_value: null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-account-mgmt"] });
      queryClient.invalidateQueries({ queryKey: ["admin-audit-log"] });
      queryClient.invalidateQueries({ queryKey: ["three-fundability-inputs"] });
      queryClient.invalidateQueries({ queryKey: ["funding-readiness-supplemental"] });
      toast.success("Account deleted and audit logged.");
    },
  });

  // ─── Export audit CSV ───
  const exportAuditCsv = () => {
    if (!auditLog.length) return;
    const headers = ["Timestamp", "Modified By", "Source", "Type", "Account ID", "Previous Value", "New Value", "Notes"];
    const rows = auditLog.map(e => [
      new Date(e.created_at).toLocaleString(),
      e.modifier_name || "Unknown",
      e.modification_source,
      e.modification_type,
      e.account_id || "",
      JSON.stringify(e.previous_value || {}),
      JSON.stringify(e.new_value || {}),
      e.notes || "",
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `audit-log-${clientUserId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startEdit = (record: AccountRecord) => {
    setEditingId(record.id);
    setEditValues({ creditor: record.creditor, type: record.type, bureau: record.bureau, amount: record.amount, status: record.status, credit_limit: record.credit_limit });
  };

  const filterButtons: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All Accounts" },
    { key: "negatives", label: "Negative Items" },
    { key: "good_standing", label: "Good Standing" },
    { key: "disputed", label: "Disputed Ownership" },
    { key: "duplicates", label: "Duplicates" },
    { key: "paige", label: "Modified by Paige" },
    { key: "client", label: "Modified by Client" },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* SECTION 1 — Overview Header */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total Accounts</p>
                <p className="text-2xl font-bold text-foreground">{activeAccounts.filter(a => !a.is_disputed_ownership).length}</p>
              </div>
              <Database className="w-8 h-8 text-muted-foreground/40" />
            </div>
          </CardContent>
        </Card>

        <Card className={potentialDuplicates.length > 0 ? "border-amber-500/40" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Potential Duplicates</p>
                <p className="text-2xl font-bold text-foreground">{potentialDuplicates.length}</p>
              </div>
              {potentialDuplicates.length > 0 && (
                <Button size="sm" variant="gold" onClick={() => { setMergeSuggestions(potentialDuplicates); setMergeDialogOpen(true); }}>
                  Run Cleanup
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Disputed Ownership</p>
                <p className="text-2xl font-bold text-foreground">{disputedAccounts.length}</p>
              </div>
              {disputedAccounts.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => { setFilter("disputed"); disputedRef.current?.scrollIntoView({ behavior: "smooth" }); }}>
                  <Eye className="w-3 h-3 mr-1" /> View
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SECTION 2 — Account Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="w-5 h-5" /> Account Records
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filter bar */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {filterButtons.map(f => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? "default" : "outline"}
                className="text-xs h-7"
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </Button>
            ))}
          </div>

          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search accounts..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9" />
          </div>

          <div className="overflow-x-auto" ref={disputedRef}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Creditor</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Bureau</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Modified By</TableHead>
                  <TableHead>Mod Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAccounts.map(record => {
                  const mod = lastModMap[record.id];
                  return (
                    <TableRow key={record.id} className={record.is_disputed_ownership ? "bg-amber-500/5" : record.duplicate_of_id ? "bg-muted/30 opacity-60" : ""}>
                      <TableCell>
                        {editingId === record.id ? (
                          <Input value={editValues.creditor || ""} onChange={e => setEditValues(v => ({ ...v, creditor: e.target.value }))} className="h-8 text-sm" />
                        ) : (
                          <div>
                            <span className="font-medium text-sm">{record.creditor}</span>
                            {record.account_number_masked && <span className="text-xs text-muted-foreground ml-1">({record.account_number_masked})</span>}
                            <div className="flex gap-1 mt-0.5">
                              <Badge variant="outline" className="text-[9px] px-1 py-0">
                                {record.table_source === "credit_accounts" ? "Account" : "Negative"}
                              </Badge>
                              {record.is_authorized_user && <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-500/10 text-amber-400">AU</Badge>}
                              {record.is_disputed_ownership && <Badge variant="destructive" className="text-[9px] px-1 py-0">Disputed Ownership</Badge>}
                              {record.duplicate_of_id && <Badge variant="secondary" className="text-[9px] px-1 py-0">Duplicate</Badge>}
                            </div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingId === record.id ? (
                          <Select value={editValues.type || ""} onValueChange={v => setEditValues(vals => ({ ...vals, type: v }))}>
                            <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>{ACCOUNT_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : <span className="text-xs">{(record.type || "").replace(/_/g, " ")}</span>}
                      </TableCell>
                      <TableCell>
                        {editingId === record.id && record.table_source === "credit_negative_items" ? (
                          <Select value={editValues.bureau || ""} onValueChange={v => setEditValues(vals => ({ ...vals, bureau: v }))}>
                            <SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
                            <SelectContent>{BUREAUS.map(b => <SelectItem key={b} value={b.toLowerCase()}>{b}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : <span className="text-xs capitalize">{record.bureau || "—"}</span>}
                      </TableCell>
                      <TableCell>
                        {editingId === record.id ? (
                          <Input type="number" value={editValues.amount ?? ""} onChange={e => setEditValues(v => ({ ...v, amount: e.target.value ? Number(e.target.value) : null }))} className="h-8 text-sm w-24" />
                        ) : <span className="text-sm">{record.amount != null || record.credit_limit != null ? `$${(record.amount ?? record.credit_limit ?? 0).toLocaleString()}` : "—"}</span>}
                      </TableCell>
                      <TableCell>
                        {editingId === record.id ? (
                          <Input value={editValues.status || ""} onChange={e => setEditValues(v => ({ ...v, status: e.target.value }))} className="h-8 text-xs w-24" />
                        ) : <Badge variant="outline" className="text-[10px]">{record.status || "active"}</Badge>}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">{mod?.by || "—"}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">{mod?.at ? new Date(mod.at).toLocaleDateString() : (record.updated_at ? new Date(record.updated_at).toLocaleDateString() : "—")}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        {editingId === record.id ? (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => editMutation.mutate({ record, updates: editValues })}>
                              <Check className="w-3.5 h-3.5 text-green-500" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingId(null); setEditValues({}); }}>
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit" onClick={() => startEdit(record)}>
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Mark Duplicate" onClick={() => { setMarkDupDialogId(record.id); setSelectedDupTarget(""); }}>
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Not Mine" onClick={() => setNotMineDialogId(record.id)}>
                              <Flag className="w-3.5 h-3.5" />
                            </Button>
                            {userRole === "admin" && (
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" title="Delete" onClick={() => deleteMutation.mutate(record)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredAccounts.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No accounts match this filter</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 3 — Audit Log */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="w-5 h-5" /> Modification Audit Log
          </CardTitle>
          {userRole === "admin" && auditLog.length > 0 && (
            <Button size="sm" variant="outline" onClick={exportAuditCsv} className="gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {auditLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
          ) : auditLog.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No modifications recorded yet.</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {auditLog.map(entry => (
                <div key={entry.id} className="flex gap-3 p-3 rounded-lg border border-border/50 bg-muted/20">
                  <div className="flex-shrink-0 mt-1">
                    <div className={`w-2 h-2 rounded-full ${
                      entry.modification_type === "delete" ? "bg-destructive" :
                      entry.modification_type === "merge" ? "bg-amber-500" :
                      entry.modification_type === "mark_not_mine" ? "bg-orange-500" :
                      "bg-primary"
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{entry.modifier_name}</span>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">{entry.modification_type.replace(/_/g, " ")}</Badge>
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{entry.modification_source.replace(/_/g, " ")}</Badge>
                    </div>
                    {entry.previous_value && Object.keys(entry.previous_value).length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {Object.entries(entry.previous_value).map(([k, v]) => `${k}: ${v}`).join(", ")} → {Object.entries(entry.new_value || {}).map(([k, v]) => `${k}: ${v}`).join(", ")}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(entry.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* SECTION 4 — Duplicate Risk Panel */}
      {potentialDuplicates.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" /> Duplicate Risk Panel ({potentialDuplicates.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {potentialDuplicates.map((s, i) => (
                <div key={i} className="border border-amber-500/20 rounded-lg p-4 bg-amber-500/5">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-medium">Potential Duplicate</span>
                    <span className="text-xs text-muted-foreground">{s.reason}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div className="rounded-lg bg-muted/30 p-3">
                      <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Account A</p>
                      <p className="text-sm font-medium">{s.primary.creditor}</p>
                      <p className="text-xs text-muted-foreground">{s.primary.type?.replace(/_/g, " ")} · ${(s.primary.amount ?? 0).toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">{s.primary.bureau || "—"} · {s.primary.status || "active"}</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-3">
                      <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Account B</p>
                      <p className="text-sm font-medium">{s.duplicate.creditor}</p>
                      <p className="text-xs text-muted-foreground">{s.duplicate.type?.replace(/_/g, " ")} · ${(s.duplicate.amount ?? 0).toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">{s.duplicate.bureau || "—"} · {s.duplicate.status || "active"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="default" className="text-xs gap-1" onClick={() => markDuplicateMutation.mutate({ duplicateId: s.duplicate.id, primaryId: s.primary.id })} disabled={markDuplicateMutation.isPending}>
                      <Merge className="w-3 h-3" /> Merge These Accounts
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs">
                      Not Duplicates
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs gap-1" onClick={async () => {
                      const { data: { session } } = await supabase.auth.getSession();
                      if (!session) return;
                      await supabase.from("notifications").insert({
                        user_id: clientUserId,
                        type: "system" as const,
                        title: "Are these the same account?",
                        message: `Your advisor wants to know: Are "${s.primary.creditor}" and "${s.duplicate.creditor}" the same account? Please confirm in your Account Manager.`,
                        metadata: { primary_id: s.primary.id, duplicate_id: s.duplicate.id },
                      });
                      toast.success("Notification sent to client.");
                    }}>
                      <Bell className="w-3 h-3" /> Ask Client
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      <Dialog open={!!notMineDialogId} onOpenChange={() => setNotMineDialogId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Flag as Not My Account</DialogTitle>
            <DialogDescription>This excludes the account from scoring and assessments.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotMineDialogId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { const r = allAccounts.find(a => a.id === notMineDialogId); if (r) markNotMineMutation.mutate(r); }} disabled={markNotMineMutation.isPending}>
              {markNotMineMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!markDupDialogId} onOpenChange={() => setMarkDupDialogId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as Duplicate</DialogTitle>
            <DialogDescription>Select the primary account this is a duplicate of.</DialogDescription>
          </DialogHeader>
          <Select value={selectedDupTarget} onValueChange={setSelectedDupTarget}>
            <SelectTrigger><SelectValue placeholder="Select primary account..." /></SelectTrigger>
            <SelectContent>
              {activeAccounts.filter(a => a.id !== markDupDialogId && !a.is_disputed_ownership).map(a => (
                <SelectItem key={a.id} value={a.id}>{a.creditor} ({a.type?.replace(/_/g, " ")})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkDupDialogId(null)}>Cancel</Button>
            <Button disabled={!selectedDupTarget || markDuplicateMutation.isPending} onClick={() => { if (markDupDialogId && selectedDupTarget) markDuplicateMutation.mutate({ duplicateId: markDupDialogId, primaryId: selectedDupTarget }); }}>
              {markDuplicateMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Duplicate Detection Results</DialogTitle>
            <DialogDescription>{mergeSuggestions.length > 0 ? `Found ${mergeSuggestions.length} potential duplicate(s).` : "No duplicates detected."}</DialogDescription>
          </DialogHeader>
          {mergeSuggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Account list looks clean — no duplicates found.</p>
          ) : (
            <div className="space-y-4">
              {mergeSuggestions.map((s, i) => (
                <Card key={i} className="p-4 border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-xs text-muted-foreground mb-2">{s.reason}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded bg-muted/30 p-2">
                          <p className="text-[10px] text-muted-foreground mb-1">Primary</p>
                          <p className="text-xs font-medium">{s.primary.creditor}</p>
                          <p className="text-[10px]">{s.primary.type?.replace(/_/g, " ")} · ${(s.primary.amount ?? 0).toLocaleString()}</p>
                        </div>
                        <div className="rounded bg-muted/30 p-2">
                          <p className="text-[10px] text-muted-foreground mb-1">Duplicate</p>
                          <p className="text-xs font-medium">{s.duplicate.creditor}</p>
                          <p className="text-[10px]">{s.duplicate.type?.replace(/_/g, " ")} · ${(s.duplicate.amount ?? 0).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => markDuplicateMutation.mutate({ duplicateId: s.duplicate.id, primaryId: s.primary.id })} disabled={markDuplicateMutation.isPending}>
                      <Merge className="w-3 h-3" /> Merge
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
