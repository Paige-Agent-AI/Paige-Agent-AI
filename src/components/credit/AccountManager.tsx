import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables, TablesUpdate } from "@/integrations/supabase/types";
import { Card } from "@/components/ui/card";
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
  AlertTriangle, Check, Edit2, Flag, Loader2, Merge, Search,
  Trash2, X, XCircle,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

// credit_accounts carries no masked number column; the read tolerates one if a row has it.
type CreditAccountRow = Tables<"credit_accounts"> & { account_number_masked?: string | null };

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
  bureau_source?: string;
  account_number_masked?: string | null;
}

interface AccountManagerProps {
  isOpen: boolean;
  onClose: () => void;
  userRole?: "client" | "admin";
  targetUserId?: string;
  initialMergeIds?: string[];
}

const ACCOUNT_TYPES = [
  "credit_card", "auto_loan", "personal_loan", "mortgage",
  "student_loan", "collections", "other",
];

const BUREAUS = ["Experian", "TransUnion", "Equifax"];

export function AccountManager({ isOpen, onClose, userRole = "client", targetUserId, initialMergeIds }: AccountManagerProps) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<AccountRecord>>({});
  const [notMineDialogId, setNotMineDialogId] = useState<string | null>(null);

  // Merge mode state
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialMergeIds || []));
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false);

  // Fetch all accounts
  const { data: allAccounts, isLoading } = useQuery({
    queryKey: ["account-manager", targetUserId],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = targetUserId || session?.user?.id;
      if (!uid) return [];

      const [{ data: creditAccounts }, { data: negItems }] = await Promise.all([
        supabase.from("credit_accounts").select("*").eq("user_id", uid).is("duplicate_of_id", null).order("creditor"),
        supabase.from("credit_negative_items").select("*").eq("user_id", uid).is("duplicate_of_id", null).neq("status", "removed").order("creditor_name"),
      ]);

      const records: AccountRecord[] = [];
      (creditAccounts || []).forEach((a: CreditAccountRow) => {
        records.push({
          id: a.id, creditor: a.creditor, type: a.type,
          amount: a.balance ?? a.current_balance, balance: a.balance,
          credit_limit: a.credit_limit ?? a.limit_amount, status: a.status,
          is_open: a.is_open, is_authorized_user: a.is_authorized_user,
          duplicate_of_id: a.duplicate_of_id, is_disputed_ownership: a.is_disputed_ownership,
          table_source: "credit_accounts", account_number_masked: a.account_number_masked,
        });
      });
      (negItems || []).forEach((n: Tables<"credit_negative_items">) => {
        records.push({
          id: n.id, creditor: n.creditor_name || "Unknown", type: n.item_type,
          bureau: n.bureau, amount: n.amount, status: n.status,
          duplicate_of_id: n.duplicate_of_id, is_disputed_ownership: n.is_disputed_ownership,
          table_source: "credit_negative_items", item_type: n.item_type,
          account_number_masked: n.account_number_masked,
        });
      });
      return records;
    },
    enabled: isOpen,
  });

  const filteredAccounts = useMemo(() => {
    if (!allAccounts) return [];
    const term = searchTerm.toLowerCase();
    return allAccounts.filter(a =>
      !a.is_disputed_ownership &&
      (a.creditor.toLowerCase().includes(term) || (a.type || "").toLowerCase().includes(term))
    );
  }, [allAccounts, searchTerm]);

  const disputedAccounts = useMemo(() => {
    return (allAccounts || []).filter(a => a.is_disputed_ownership);
  }, [allAccounts]);

  // Selected accounts for merge preview
  const selectedAccounts = useMemo(() => {
    return filteredAccounts.filter(a => selectedIds.has(a.id));
  }, [filteredAccounts, selectedIds]);

  // Merge preview
  const mergePreview = useMemo(() => {
    if (selectedAccounts.length < 2) return null;
    // Pick the one with most data as primary
    const sorted = [...selectedAccounts].sort((a, b) => {
      const scoreA = (a.creditor ? 1 : 0) + (a.amount ? 1 : 0) + (a.credit_limit ? 1 : 0) + (a.account_number_masked ? 1 : 0) + (a.status ? 1 : 0);
      const scoreB = (b.creditor ? 1 : 0) + (b.amount ? 1 : 0) + (b.credit_limit ? 1 : 0) + (b.account_number_masked ? 1 : 0) + (b.status ? 1 : 0);
      return scoreB - scoreA;
    });
    const primary = sorted[0];
    const bureaus = new Set(selectedAccounts.map(a => a.bureau).filter(Boolean));
    const highestAmount = Math.max(...selectedAccounts.map(a => a.amount ?? a.credit_limit ?? a.balance ?? 0));
    const bestAcctNum = selectedAccounts.find(a => a.account_number_masked && !/^[xX0]+$/.test(a.account_number_masked.replace(/[^a-zA-Z0-9]/g, "")))?.account_number_masked || primary.account_number_masked;
    const mostRecentStatus = selectedAccounts[0].status;

    return {
      primaryId: primary.id,
      creditor: primary.creditor,
      bureaus: Array.from(bureaus),
      bureauCount: bureaus.size,
      accountNumber: bestAcctNum,
      highestAmount,
      status: mostRecentStatus,
      duplicateIds: sorted.slice(1).map(a => a.id),
    };
  }, [selectedAccounts]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const enterMergeMode = () => {
    setMergeMode(true);
    setSelectedIds(new Set(initialMergeIds || []));
  };

  const exitMergeMode = () => {
    setMergeMode(false);
    setSelectedIds(new Set());
  };

  // Edit mutation
  const editMutation = useMutation({
    mutationFn: async ({ record, updates }: { record: AccountRecord; updates: Partial<AccountRecord> }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const table = record.table_source;
      const prevValues: Record<string, Json | undefined> = {};
      const newValues: Record<string, Json | undefined> = {};

      if (table === "credit_accounts") {
        const updatePayload: TablesUpdate<"credit_accounts"> = {};
        if (updates.creditor !== undefined) { prevValues.creditor = record.creditor; newValues.creditor = updates.creditor; updatePayload.creditor = updates.creditor; }
        if (updates.type !== undefined) { prevValues.type = record.type; newValues.type = updates.type; updatePayload.type = updates.type as TablesUpdate<"credit_accounts">["type"]; }
        if (updates.status !== undefined) { prevValues.status = record.status; newValues.status = updates.status; updatePayload.status = updates.status; }
        if (updates.credit_limit !== undefined) { prevValues.credit_limit = record.credit_limit; newValues.credit_limit = updates.credit_limit; updatePayload.credit_limit = updates.credit_limit; }
        updatePayload.updated_at = new Date().toISOString();
        await supabase.from("credit_accounts").update(updatePayload).eq("id", record.id);
      } else {
        const updatePayload: TablesUpdate<"credit_negative_items"> = {};
        if (updates.creditor !== undefined) { prevValues.creditor_name = record.creditor; newValues.creditor_name = updates.creditor; updatePayload.creditor_name = updates.creditor; }
        if (updates.type !== undefined) { prevValues.item_type = record.type; newValues.item_type = updates.type; updatePayload.item_type = updates.type; }
        if (updates.bureau !== undefined) { prevValues.bureau = record.bureau; newValues.bureau = updates.bureau; updatePayload.bureau = updates.bureau; }
        if (updates.amount !== undefined) { prevValues.amount = record.amount; newValues.amount = updates.amount; updatePayload.amount = updates.amount; }
        if (updates.status !== undefined) { prevValues.status = record.status; newValues.status = updates.status; updatePayload.status = updates.status; }
        updatePayload.updated_at = new Date().toISOString();
        await supabase.from("credit_negative_items").update(updatePayload).eq("id", record.id);

      }

      await supabase.from("audit_logs").insert({
        user_id: session.user.id, entity: "account_modification", action: "edit", entity_id: record.id,
        data: { previous_value: prevValues, new_value: newValues, table, source: userRole === "admin" ? "admin_ui" : "client_ui" },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-manager"] });
      queryClient.invalidateQueries({ queryKey: ["credit-accounts-health"] });
      queryClient.invalidateQueries({ queryKey: ["credit-negatives-health"] });
      // Negative item changes shift the recency-weighted penalty.
      queryClient.invalidateQueries({ queryKey: ["three-fundability-inputs"] });
      queryClient.invalidateQueries({ queryKey: ["funding-readiness-supplemental"] });
      setEditingId(null);
      setEditValues({});
      toast({ title: "Account updated", description: "Changes saved and audit logged." });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  // Mark not mine
  const markNotMineMutation = useMutation({
    mutationFn: async (record: AccountRecord) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const table = record.table_source;
      if (table === "credit_negative_items") {
        await supabase.from("credit_negative_items").update({ is_disputed_ownership: true, status: "disputed" }).eq("id", record.id);
      } else {
        await supabase.from("credit_accounts").update({ is_disputed_ownership: true, status: "disputed_ownership" }).eq("id", record.id);
      }
      await supabase.from("audit_logs").insert({
        user_id: session.user.id, entity: "account_modification", action: "mark_not_mine", entity_id: record.id,
        data: { creditor: record.creditor, table, source: userRole === "admin" ? "admin_ui" : "client_ui" },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-manager"] });
      queryClient.invalidateQueries({ queryKey: ["credit-accounts-health"] });
      queryClient.invalidateQueries({ queryKey: ["credit-negatives-health"] });
      queryClient.invalidateQueries({ queryKey: ["three-fundability-inputs"] });
      queryClient.invalidateQueries({ queryKey: ["funding-readiness-supplemental"] });
      setNotMineDialogId(null);
      toast({ title: "Flagged as Not Mine", description: "Account excluded from scoring and assessments." });
    },
  });

  // Merge selected mutation
  const mergeMutation = useMutation({
    mutationFn: async () => {
      if (!mergePreview) throw new Error("No merge preview");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      for (const dupId of mergePreview.duplicateIds) {
        const record = allAccounts?.find(a => a.id === dupId);
        if (!record) continue;
        const table = record.table_source;
        if (table === "credit_negative_items") {
          await supabase.from("credit_negative_items").update({ duplicate_of_id: mergePreview.primaryId, status: "removed" }).eq("id", dupId);
        } else {
          await supabase.from("credit_accounts").update({ duplicate_of_id: mergePreview.primaryId }).eq("id", dupId);
        }

        await supabase.from("audit_logs").insert({
          user_id: session.user.id, entity: "account_modification", action: "merge",
          entity_id: dupId,
          data: {
            merged_into: mergePreview.primaryId, creditor: record.creditor, table,
            merged_accounts: selectedAccounts.map(a => a.creditor).join(", "),
            source: userRole === "admin" ? "admin_ui" : "client_ui",
          },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-manager"] });
      queryClient.invalidateQueries({ queryKey: ["credit-accounts-health"] });
      queryClient.invalidateQueries({ queryKey: ["credit-negatives-health"] });
      queryClient.invalidateQueries({ queryKey: ["three-fundability-inputs"] });
      queryClient.invalidateQueries({ queryKey: ["funding-readiness-supplemental"] });
      setMergeConfirmOpen(false);
      exitMergeMode();
      toast({ title: "Accounts merged", description: `${selectedAccounts.length} accounts merged into one record.` });
    },
    onError: (err: Error) => {
      toast({ title: "Merge failed", description: err.message, variant: "destructive" });
    },
  });

  // Delete (admin only)
  const deleteMutation = useMutation({
    mutationFn: async (record: AccountRecord) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      if (record.table_source === "credit_negative_items") {
        await supabase.from("credit_negative_items").update({ status: "removed" }).eq("id", record.id);
      } else {
        await supabase.from("credit_accounts").delete().eq("id", record.id);
      }
      await supabase.from("audit_logs").insert({
        user_id: session.user.id, entity: "account_modification", action: "delete", entity_id: record.id,
        data: { creditor: record.creditor, type: record.type, table: record.table_source, source: "admin_ui" },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-manager"] });
      queryClient.invalidateQueries({ queryKey: ["credit-accounts-health"] });
      queryClient.invalidateQueries({ queryKey: ["credit-negatives-health"] });
      queryClient.invalidateQueries({ queryKey: ["three-fundability-inputs"] });
      queryClient.invalidateQueries({ queryKey: ["funding-readiness-supplemental"] });
      toast({ title: "Account deleted", description: "Record removed and audit logged." });
    },
  });

  const startEdit = (record: AccountRecord) => {
    setEditingId(record.id);
    setEditValues({
      creditor: record.creditor, type: record.type, bureau: record.bureau,
      amount: record.amount, status: record.status, credit_limit: record.credit_limit,
    });
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[calc(100dvh-2rem)] sm:max-h-[85vh] overflow-y-auto p-3 sm:p-6">
        <DialogHeader>
          <DialogTitle>Account Manager</DialogTitle>
          <DialogDescription>View, edit, merge, and flag account records extracted from credit reports.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search accounts..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9" />
          </div>
          {!mergeMode ? (
            <Button variant="outline" size="sm" onClick={enterMergeMode} className="gap-1.5">
              <Merge className="w-4 h-4" /> Merge Accounts
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={exitMergeMode} className="gap-1.5">
              <X className="w-4 h-4" /> Cancel Merge
            </Button>
          )}
        </div>

        {/* Merge Mode Banner */}
        {mergeMode && (
          <div className="mb-4 p-3 rounded-lg border border-accent/40 bg-accent/5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-foreground">
                <Merge className="w-4 h-4 inline mr-1.5 text-accent" />
                Select 2 or more accounts to merge. Click accounts to select them.
                {selectedIds.size > 0 && <span className="ml-2 font-medium text-accent">{selectedIds.size} selected</span>}
              </p>
              {selectedIds.size >= 2 && (
                <Button size="sm" onClick={() => setMergeConfirmOpen(true)} className="bg-gradient-gold hover:opacity-90 gap-1.5">
                  <Merge className="w-3.5 h-3.5" /> Merge Selected
                </Button>
              )}
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
          </div>
        ) : (
          <div className="flex gap-4">
            {/* Main Table */}
            <div className={`overflow-x-auto ${mergeMode && selectedIds.size >= 2 ? "flex-1" : "w-full"}`}>
              <Table>
                <TableHeader>
                  <TableRow>
                    {mergeMode && <TableHead className="w-10"></TableHead>}
                    <TableHead>Creditor</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Bureau</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    {!mergeMode && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts.map(record => {
                    const isSelected = selectedIds.has(record.id);
                    return (
                      <TableRow
                        key={record.id}
                        className={`${mergeMode ? "cursor-pointer" : ""} ${isSelected ? "bg-accent/10 border-accent/30" : ""}`}
                        onClick={mergeMode ? () => toggleSelect(record.id) : undefined}
                      >
                        {mergeMode && (
                          <TableCell className="w-10 pr-0">
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? "border-accent bg-accent" : "border-muted-foreground/30"}`}>
                              {isSelected && <Check className="w-3 h-3 text-accent-foreground" />}
                            </div>
                          </TableCell>
                        )}
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
                          ) : (
                            <span className="text-xs">{(record.type || "").replace(/_/g, " ")}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {editingId === record.id && record.table_source === "credit_negative_items" ? (
                            <Select value={editValues.bureau || ""} onValueChange={v => setEditValues(vals => ({ ...vals, bureau: v }))}>
                              <SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
                              <SelectContent>{BUREAUS.map(b => <SelectItem key={b} value={b.toLowerCase()}>{b}</SelectItem>)}</SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs capitalize">{record.bureau || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {editingId === record.id ? (
                            <Input type="number" value={editValues.amount ?? ""} onChange={e => setEditValues(v => ({ ...v, amount: e.target.value ? Number(e.target.value) : null }))} className="h-8 text-sm w-24" />
                          ) : (
                            <span className="text-sm">{record.amount != null || record.credit_limit != null ? `$${(record.amount ?? record.credit_limit ?? 0).toLocaleString()}` : "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {editingId === record.id ? (
                            <Input value={editValues.status || ""} onChange={e => setEditValues(v => ({ ...v, status: e.target.value }))} className="h-8 text-xs w-24" />
                          ) : (
                            <Badge variant="outline" className="text-[10px]">{record.status || "active"}</Badge>
                          )}
                        </TableCell>
                        {!mergeMode && (
                          <TableCell className="text-right">
                            {editingId === record.id ? (
                              <div className="flex gap-1 justify-end">
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => editMutation.mutate({ record, updates: editValues })}>
                                  <Check className="w-3.5 h-3.5 text-fundability-excellent" />
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
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Not My Account" onClick={() => setNotMineDialogId(record.id)}>
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
                        )}
                      </TableRow>
                    );
                  })}
                  {filteredAccounts.length === 0 && (
                    <TableRow><TableCell colSpan={mergeMode ? 6 : 7} className="text-center text-muted-foreground py-8">No accounts found</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Merge Preview Panel */}
            {mergeMode && mergePreview && (
              <div className="w-64 shrink-0 border border-accent/30 rounded-lg p-4 bg-accent/5 space-y-3 self-start sticky top-0">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Merge className="w-4 h-4 text-accent" /> Merge Preview
                </h4>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Creditor:</span>
                    <p className="font-medium">{mergePreview.creditor}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Bureaus:</span>
                    <p className="font-medium">
                      {mergePreview.bureauCount > 0 ? `Reported by ${mergePreview.bureauCount} of 3 bureaus` : "Bureau TBD"}
                    </p>
                    {mergePreview.bureaus.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {mergePreview.bureaus.map(b => (
                          <Badge key={b} variant="outline" className="text-[9px] capitalize">{b}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {mergePreview.accountNumber && (
                    <div>
                      <span className="text-muted-foreground">Account #:</span>
                      <p className="font-medium font-mono">{mergePreview.accountNumber}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Highest Amount:</span>
                    <p className="font-medium">${mergePreview.highestAmount.toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <p className="font-medium">{mergePreview.status || "active"}</p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  The account with the most complete data ({mergePreview.creditor}) will be kept. {mergePreview.duplicateIds.length} record(s) will be merged into it.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Disputed Ownership Section */}
        {disputedAccounts.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <XCircle className="w-4 h-4 text-amber-500" /> Not My Accounts ({disputedAccounts.length})
            </h3>
            <div className="space-y-2">
              {disputedAccounts.map(a => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2">
                  <div>
                    <span className="text-sm font-medium">{a.creditor}</span>
                    <span className="text-xs text-muted-foreground ml-2">({a.type?.replace(/_/g, " ")})</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">Disputed Ownership</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Not Mine Confirmation Dialog */}
        <Dialog open={!!notMineDialogId} onOpenChange={() => setNotMineDialogId(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Flag as Not My Account</DialogTitle>
              <DialogDescription>
                This will exclude the account from all scoring, comparable credit calculations, and file health assessments. Are you sure this account does not belong to you?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNotMineDialogId(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const record = allAccounts?.find(a => a.id === notMineDialogId);
                  if (record) markNotMineMutation.mutate(record);
                }}
                disabled={markNotMineMutation.isPending}
              >
                {markNotMineMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Confirm — Not My Account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Merge Confirmation Dialog */}
        <Dialog open={mergeConfirmOpen} onOpenChange={setMergeConfirmOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Confirm Merge</DialogTitle>
              <DialogDescription>
                Merge these {selectedIds.size} accounts into one record? This combines {selectedAccounts.map(a => a.creditor).join(", ")} into a single entry. The account with the most complete data will be kept.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMergeConfirmOpen(false)}>Cancel</Button>
              <Button
                onClick={() => mergeMutation.mutate()}
                disabled={mergeMutation.isPending}
                className="bg-gradient-gold hover:opacity-90"
              >
                {mergeMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Confirm Merge
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
