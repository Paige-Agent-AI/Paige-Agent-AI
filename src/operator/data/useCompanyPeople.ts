import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CompanyPerson {
  user_id: string;
  name: string;
  email: string | null;
  business_name: string | null;
  industry: string | null;
  team_size: string | null;
  enrollment_state: string;
  enrolled_at: string | null;
  tenant_id: string | null;
  workspace_name: string | null;
  has_workspace: boolean;
  reference_id: string;
}

export interface CompanyPeopleSummary {
  total: number;
  with_workspace: number;
  fulfilled: number;
  in_progress: number;
}

export interface CompanyPeopleData {
  summary: CompanyPeopleSummary;
  people: CompanyPerson[];
}

export function useCompanyPeople() {
  const [data, setData] = useState<CompanyPeopleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: result, error: rpcError } = await supabase.rpc("operator_company_people");
      if (cancelled) return;
      if (rpcError) { setError(rpcError.message); setLoading(false); return; }
      setData(result as unknown as CompanyPeopleData);
      setError(null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return { data, error, loading };
}
