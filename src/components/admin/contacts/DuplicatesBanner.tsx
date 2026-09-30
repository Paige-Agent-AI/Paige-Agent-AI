import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { findDuplicates, type DuplicateContact } from "@/lib/contacts";

type Props = {
  contactId: string;
  email: string | null;
  phone: string | null;
};

export function DuplicatesBanner({ contactId, email, phone }: Props) {
  const navigate = useNavigate();
  const [dupes, setDupes] = useState<DuplicateContact[]>([]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        // Matches on every address this contact holds; `email`/`phone` (its primaries) re-run
        // the check when an edit changes them.
        const rows = await findDuplicates({ id: contactId });
        if (!cancel) setDupes(rows);
      } catch { /* silent */ }
    })();
    return () => { cancel = true; };
  }, [contactId, email, phone]);

  if (dupes.length === 0) return null;

  return (
    <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-3">
      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
      <div className="flex-1 text-sm">
        <div className="font-medium text-amber-900 dark:text-amber-200">
          Possible duplicate{dupes.length === 1 ? "" : "s"} found
        </div>
        <div className="text-amber-800/80 dark:text-amber-200/80 mt-1 space-y-1">
          {dupes.map((d) => (
            <div key={d.id} className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{d.first_name} {d.last_name}</span>
              {d.email && <span className="opacity-70">· {d.email}</span>}
              {d.entity_name && <span className="opacity-70">· {d.entity_name}</span>}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => navigate("/choose-account")}
              >
                Open
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
