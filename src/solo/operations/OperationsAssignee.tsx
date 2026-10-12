import { UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { memberVisibleIdentity, type TeamMemberRecord } from "@/solo/team-workspace-contract";

export function OperationsAssignee({ member, compact = false }: {
  member?: TeamMemberRecord | null;
  compact?: boolean;
}) {
  const name = member ? memberVisibleIdentity(member).primary : "Unassigned";
  const initials = member?.full_name?.trim().split(/\s+/)
    .filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase()
    || member?.email?.trim().slice(0, 1).toUpperCase();
  return <span className="ops-assignee" title={compact ? name : undefined}>
    <Avatar key={`${member?.user_id ?? "unassigned"}:${member?.avatar_url ?? ""}`}
      className="ops-assignee-avatar" aria-hidden="true">
      {member?.avatar_url && <AvatarImage src={member.avatar_url} alt="" className="object-cover"
        referrerPolicy="no-referrer" />}
      <AvatarFallback className="ops-assignee-fallback">
        {initials || <UserRound size={16} />}
      </AvatarFallback>
    </Avatar>
    <span className={compact ? "sr-only" : "ops-assignee-name"}>{name}</span>
  </span>;
}
