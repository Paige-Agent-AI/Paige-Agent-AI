import { useEffect, useId, useRef } from "react";
import { SectionCard } from "@/components/ui/page/SectionCard";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ASSISTANT_TEXT_LIMITS, type AssistantFields } from "@/lib/portal/assistantSettings";

export function CustomerAssistantSettings({ value, onChange, focusRequest = 0 }: { value: AssistantFields; onChange: (next: AssistantFields) => void; focusRequest?: number }) {
  const id = useId();
  const name = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusRequest > 0) name.current?.focus(); }, [focusRequest]);
  return <SectionCard title="Customer agent" description="How your AI client success agent introduces itself and supports your clients.">
    <fieldset className="space-y-4" aria-label="Customer agent settings">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={`${id}-enabled`} className="inline-flex min-h-[44px] flex-1 items-center text-sm font-medium">Available in the portal</label>
        <Switch id={`${id}-enabled`} checked={value.enabled} onCheckedChange={enabled => onChange({ ...value, enabled })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">Agent name</label>
          <Input ref={name} id={`${id}-name`} value={value.display_name} maxLength={ASSISTANT_TEXT_LIMITS.display_name} placeholder="Cura" className="min-h-[44px] text-base md:text-sm" onChange={e => onChange({ ...value, display_name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-tone`} className="text-sm font-medium">Tone</label>
          <Input id={`${id}-tone`} value={value.tone} maxLength={ASSISTANT_TEXT_LIMITS.tone} placeholder="Warm, clear and professional" className="min-h-[44px] text-base md:text-sm" onChange={e => onChange({ ...value, tone: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-scope`} className="text-sm font-medium">What it helps with</label>
        <Textarea id={`${id}-scope`} value={value.service_scope} maxLength={ASSISTANT_TEXT_LIMITS.service_scope} rows={3} placeholder="Describe the services and guidance you offer clients." className="text-base md:text-sm" aria-describedby={`${id}-scope-help`} onChange={e => onChange({ ...value, service_scope: e.target.value })} />
        <p id={`${id}-scope-help`} className="text-sm text-muted-foreground">Use client-facing details. This does not share your internal documents or expand access.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-handoff`} className="text-sm font-medium">When to contact a person</label>
        <Textarea id={`${id}-handoff`} value={value.human_handoff} maxLength={ASSISTANT_TEXT_LIMITS.human_handoff} rows={2} placeholder="Tell clients when to contact your team and how." className="text-base md:text-sm" onChange={e => onChange({ ...value, human_handoff: e.target.value })} />
      </div>
      <p className="text-sm text-muted-foreground">Clients are told they are speaking with AI. Their private AI conversation stays separate from messages they send to your business.</p>
    </fieldset>
  </SectionCard>;
}
