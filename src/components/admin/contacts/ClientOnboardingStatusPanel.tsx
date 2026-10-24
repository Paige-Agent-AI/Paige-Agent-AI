import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Circle, Clock, PauseCircle, ShieldOff } from "lucide-react";
import { format } from "date-fns";
import { useClientOnboardingStatus } from "@/hooks/useClientOnboardingStatus";
import { Badge } from "@/components/ui/badge";

function Row({
  done,
  title,
  when,
  pendingHint,
}: {
  done: boolean;
  title: string;
  when: string | null;
  pendingHint: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      {done ? (
        <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
      ) : (
        <Circle className="h-5 w-5 text-muted-foreground/40 mt-0.5 shrink-0" />
      )}
      <div className="flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">
          {done && when ? format(new Date(when), "MMM d, yyyy h:mm a") : pendingHint}
        </div>
      </div>
    </div>
  );
}

export function ClientOnboardingStatusPanel({ contactId }: { contactId: string }) {
  const { status, loading } = useClientOnboardingStatus(contactId);
  // E09 Slice 7: a paused link still exists and an ended one is cleared, so the link alone no longer
  // says whether the client can get in. The business's access decision is named first.
  const access = status?.portal_access_state ?? "open";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Client intake</CardTitle>
          {loading ? (
            <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> Loading</Badge>
          ) : access === "paused" ? (
            <Badge variant="outline" className="gap-1"><PauseCircle className="h-3 w-3" /> Access paused</Badge>
          ) : access === "ended" ? (
            <Badge variant="outline" className="gap-1"><ShieldOff className="h-3 w-3" /> Access ended</Badge>
          ) : status?.ready ? (
            <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">Ready</Badge>
          ) : (
            <Badge variant="outline">In progress</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <Row
          done={!!status?.linked_user_id}
          title="Invite accepted & password set"
          when={status?.invite_accepted_at ?? null}
          pendingHint={access === "ended" ? "Their portal access ended. A new invitation brings them back." : "Waiting for client to accept invite"}
        />
        <Row
          done={!!status?.agreement_signed_at}
          title="Agreement signed"
          when={status?.agreement_signed_at ?? null}
          pendingHint={status?.linked_user_id ? "Awaiting signature" : "Locked until invite accepted"}
        />
        {access === "paused" ? (
          <div className="mt-3 text-xs text-muted-foreground border-t pt-3">
            Their portal access is paused, so client view is closed until it’s restored.
          </div>
        ) : !status?.ready && (
          <div className="mt-3 text-xs text-muted-foreground border-t pt-3">
            Client view unlocks once intake is complete — invite accepted and agreement signed.
          </div>
        )}


      </CardContent>
    </Card>
  );
}
