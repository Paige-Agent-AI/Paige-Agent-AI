import { useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/page/SectionCard";
import { normalizePortalSupportEmail } from "@/lib/portal/supportContact";
import type { useBrandKit } from "@/hooks/useBrandKit";

type Props = {
  brand: Pick<ReturnType<typeof useBrandKit>, "state" | "save" | "refetch">;
  onStateChange: (state: { dirty: boolean; busy: boolean }) => void;
};

/** Mounted inside the original actor/business-keyed PortalStudio. One field,
 * original brand writer, exact readback; a lost acknowledgment offers a read. */
export function PortalSupportEmail({ brand, onStateChange }: Props) {
  const stored = brand.state?.own.support_email;
  const saved = typeof stored === "string" ? stored : "";
  const [draft, setDraft] = useState(saved);
  const [phase, setPhase] = useState<"idle" | "saving" | "unknown">("idle");
  const [notice, setNotice] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [checked, setChecked] = useState(false);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const focusDraft = useRef(false);
  const busy = phase === "saving";
  const dirty = draft.trim() !== saved.trim();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onStateChange({dirty: dirty || phase === "unknown", busy}); }, [dirty, busy, phase, onStateChange]);
  useEffect(() => { if (phase === "idle" && focusDraft.current) {focusDraft.current = false; input.current?.focus();} }, [phase]);
  const priorSaved = useRef(saved);
  useEffect(() => {
    if (phase === "idle" && draft.trim() === priorSaved.current.trim()) setDraft(saved);
    priorSaved.current = saved;
  }, [saved, phase, draft]);

  const check = async (expected: string) => {
    const result = await brand.refetch();
    if (!mounted.current) return;
    if (result.error || !result.data) throw new Error("Readback unavailable");
    const actual = result.data.own.support_email ?? "";
    if (typeof actual !== "string") throw new Error("Saved contact is invalid");
    if (actual.trim() !== expected) {
      setPhase("unknown"); setChecked(true);
      setNotice("The saved email differs from your draft. Review your draft or discard it before saving again.");
      return;
    }
    setDraft(actual); setPhase("idle"); setChecked(false);
    setNotice("Support email saved and checked.");
  };
  const save = async () => {
    const next = draft.trim();
    if (next && !normalizePortalSupportEmail(draft)) {
      setInvalid(true); input.current?.focus(); return;
    }
    setPhase("saving"); setNotice(""); setChecked(false);
    try {
      await brand.save({support_email: next});
      if (mounted.current) await check(next);
    } catch {
      if (!mounted.current) return;
      setPhase("unknown");
      setNotice("We couldn't confirm the save. Check the saved email before trying again.");
    }
  };
  const reread = async () => {
    setPhase("saving"); setChecked(false);
    try { await check(draft.trim()); }
    catch { if (mounted.current) {setPhase("unknown"); setNotice("The saved email is unavailable. Your draft is kept; try checking again.");} }
  };
  return <SectionCard icon={Mail} title="Business support" description="The contact your clients see in their portal.">
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="portal-support-email" className="text-sm font-medium">Support email</label>
        <Input ref={input} id="portal-support-email" type="email" inputMode="email" autoComplete="email" maxLength={254}
          value={draft} disabled={phase !== "idle"} aria-invalid={invalid || undefined}
          aria-describedby={`portal-support-hint${invalid ? " portal-support-error" : ""}`}
          placeholder="help@yourbusiness.com"
          onChange={e => {setDraft(e.target.value); setInvalid(false); setNotice("");}} />
        <p id="portal-support-hint" className="text-sm text-muted-foreground">Use your business support inbox. Leave blank to use an available public business contact or your dedicated business email. Clients can always message your business in the portal. This brand contact may also receive business email replies.</p>
        {invalid && <p id="portal-support-error" role="alert" className="text-sm text-destructive">Enter one complete business email address. PAIGE’s platform support address belongs to your business account, not your clients’ portal.</p>}
      </div>
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {phase === "unknown" && checked && <p className="text-sm break-words">Saved email: {saved || "No explicit support email"}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {phase === "unknown" ? <>
          <Button variant="outline" className="min-h-11" onClick={() => void reread()}>Check saved email</Button>
          {checked && <Button variant="ghost" className="min-h-11" onClick={() => {focusDraft.current = true;setPhase("idle");setChecked(false);setNotice("");}}>Review draft</Button>}
        </> : <Button variant="outline" className="min-h-11" disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Checking support email…" : "Save support email"}</Button>}
        {dirty && phase === "idle" && <Button variant="ghost" className="min-h-11" onClick={() => {setDraft(saved);setInvalid(false);setNotice("");}}>Discard changes</Button>}
        {dirty && <span className="text-xs text-muted-foreground">Unsaved support email</span>}
      </div>
    </div>
  </SectionCard>;
}
