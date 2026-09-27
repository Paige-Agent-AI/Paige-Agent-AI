// Render-harness stand-in for "@/integrations/supabase/client". It answers the one read the Team
// screen makes on mount with a synthetic workspace, and refuses everything else, so a screenshot
// can never show a write that the harness pretended succeeded. Synthetic names only.
const member = (over: Record<string, unknown>) => ({
  membership_id: `m-${String(over.user_id)}`, avatar_url: null, status: "active", is_owner: false,
  responsibilities: null, last_sign_in_at: null, ...over,
});

export const TEAM_FIXTURE = {
  tenant_id: "tenant-render", tenant_name: "Northside Fitness", viewer_permission: "owner",
  can_manage_profiles: true, can_manage_invitations: true, can_change_permissions: true,
  total_members: 4,
  members: [
    member({ user_id: "u-owner", full_name: "Morgan Lee", email: "morgan@northside.example", permission: "owner", is_owner: true, job_title: "Founder", responsibilities: "Runs the business." }),
    member({ user_id: "u-trainer", full_name: "Sam Rivera", email: "sam@northside.example", permission: "member", job_title: "Head Trainer", responsibilities: "Runs the morning classes and new-client assessments." }),
    member({ user_id: "u-desk", full_name: "Priya Shah", email: "priya@northside.example", permission: "admin", job_title: "Front Desk", responsibilities: "Bookings, payments and first-visit welcomes." }),
    member({ user_id: "u-new", full_name: "Alex Kim", email: "alex@northside.example", permission: "member", job_title: null, responsibilities: null }),
  ],
  invitations: [],
};

const refused = async () => ({ data: null, error: { message: "render harness: writes are not performed" } });

export const supabase = {
  rpc: async (name: string) =>
    name === "get_solo_team_workspace" ? { data: TEAM_FIXTURE, error: null } : refused(),
  functions: { invoke: refused },
};
