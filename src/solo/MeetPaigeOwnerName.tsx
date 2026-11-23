import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSoloOwner } from "./data/useSoloOwner";

export const MEET_PAIGE_NAME_QUESTION = "What is your name so I know what to call you?";

export function MeetPaigeOwnerName() {
  const field = useId();
  const { loading, error: profileError, saving, savedName, saveOwner } = useSoloOwner();
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [skipped, setSkipped] = useState(false);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.trim();
    if (saving || !name || name.length > 120 || savedName) return;
    setError(false);
    setSubmitted(null);
    const result = await saveOwner({ full_name: name });
    if (result.ok) setSubmitted(name);
    else setError(true);
  };

  if (skipped || loading || profileError) return null;
  if (savedName) return submitted === savedName
    ? <p className="plc-film-feedback" role="status">I’ll call you {savedName}.</p>
    : null;

  return <form className="plc-film-name" onSubmit={save} aria-busy={saving}>
    <label htmlFor={field}>{MEET_PAIGE_NAME_QUESTION}</label>
    <Input id={field} autoComplete="nickname" value={draft} maxLength={120} required
      onChange={(event) => setDraft(event.target.value)} />
    {(error || submitted) && <p className="plc-film-feedback" role="alert">I couldn’t confirm that your name was saved. Try again.</p>}
    <div className="plc-film-name__actions">
      <Button type="submit" variant="outline" size="sm" disabled={!draft.trim() || saving}>Save name</Button>
      <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setSkipped(true)}>Skip for now</Button>
    </div>
  </form>;
}
