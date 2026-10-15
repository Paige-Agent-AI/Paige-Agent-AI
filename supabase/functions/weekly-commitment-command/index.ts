import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createWeeklyDraftCommand } from "../_shared/paige-orchestration/weekly-draft-command.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createWeeklyDraftCommand({ admin, caller: authorization => createClient(url, anon, {
  global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
}) }));
