// src/components/legal/RequiredConsentsModal.tsx
// Blocks the app when the signed-in user has outstanding required consents
// (e.g. after a version bump). User must accept everything or sign out.

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { recordAcceptances, type OutstandingConsent } from "@/lib/legal/useLegalDocuments";

interface Props {
  userId: string;
  outstanding: OutstandingConsent[];
  onAccepted: () => void;
}

export function RequiredConsentsModal({ userId, outstanding, onAccepted }: Props) {
  const [agree, setAgree] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  if (!outstanding.length) return null;

  const handleAccept = async () => {
    if (!agree) return;
    setSaving(true);
    const { error } = await recordAcceptances(
      userId,
      outstanding.map((o) => ({
        slug: o.slug,
        version: o.version,
        context: { source: "required_reconsent" },
      }))
    );
    setSaving(false);
    if (error) {
      toast({
        title: "Couldn't save your acceptance",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    onAccepted();
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.assign("/auth");
  };

  return (
    <Dialog open modal>
      <DialogContent
        className="max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Updated agreements</DialogTitle>
          <DialogDescription>
            We've updated the following {outstanding.length === 1 ? "document" : "documents"}. Please
            {/* customer-identity-exempt: platform legal entity — these are the platform's own Terms and policies */}
            review and accept to continue using PaigeAgent.ai.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 my-2">
          {outstanding.map((o) => (
            <li
              key={o.slug}
              className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border/60 bg-muted/30"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{o.title}</p>
                {o.summary && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{o.summary}</p>
                )}
                <p className="text-[11px] text-muted-foreground/70 mt-1">
                  Version {o.version} · Effective{" "}
                  {new Date(o.effective_date).toLocaleDateString()}
                </p>
              </div>
              <Link
                to={`/legal/${o.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent hover:underline shrink-0"
              >
                Read
              </Link>
            </li>
          ))}
        </ul>

        <label className="flex items-start gap-2.5 cursor-pointer mt-2">
          <Checkbox checked={agree} onCheckedChange={(v) => setAgree(!!v)} className="mt-0.5" />
          <span className="text-xs text-foreground/85 leading-relaxed">
            I have reviewed and agree to the updated documents listed above.
          </span>
        </label>

        <div className="flex items-center justify-between gap-2 mt-4">
          <Button variant="ghost" onClick={handleSignOut} disabled={saving}>
            Sign out
          </Button>
          <Button onClick={handleAccept} disabled={!agree || saving} className="gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Accept & continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
