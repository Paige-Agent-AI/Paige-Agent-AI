// ConversationsRichComposer — the scope-agnostic dense composer (§18 one home). It wraps the
// shared MessageComposer atom (the textarea + the ONE gold Send act) and injects the tenant's
// full affordance cluster through the atom's header/toolbar slots, EACH gated by an adapter
// capability flag. A scope with a flag off simply does not render that affordance — no fork,
// no scope branch. The operator SMS composer passes { canDraftWithPaige:false, canSchedule:false,
// hasTemplates:false, hasSignature:false, hasAttachments:false } and renders down to the bare
// textarea + Send; the tenant email composer passes them all on and renders the full row.
//
// This composer owns only TRANSIENT UI state (the Draft-with-Paige guide popover, the schedule
// popover open state). The substantive values (body, subject, scheduledFor, attachments,
// drafting status, draft flags) are the container's, passed in — so the container keeps driving
// its existing send/draft/schedule seams unchanged (§13/§37 zero regression).
//
// §11: gold ONLY on the atom's Send; every affordance here is neutral/indigo utility; token-only,
// motion-safe.
import { useRef, useState } from "react";
import {
  Loader2, Paperclip, Sparkles, Clock, ChevronDown, X, Pencil, AlertTriangle, Plus,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CHANNEL_ICON, CHANNEL_LABEL } from "../inbox-shared";
import { MessageComposer } from "../MessageComposer";
import { AttachmentChip } from "../AttachmentChip";
import { DictationMicButton } from "@/components/voice/DictationMicButton";
import { appendDictation } from "@/lib/voice/useDictation";
import type { ConversationsComposerModel, DraftTone } from "./conversationsAdapter";

export function ConversationsRichComposer(model: ConversationsComposerModel) {
  const {
    capabilities: caps,
    value, onChange, onSend, sending, disabled, sendDisabled, sendOnEnter, placeholder, note, sendLabel, rows, textareaClassName,
    actions, checking,
    identities, identityId, onIdentityChange, showIdentity = true,
    showSubject = false, subject = "", onSubjectChange,
    attachments = [], uploading = false, onAttachFiles, onRemoveAttachment, attachmentsLocked = false,
    showDraftWithPaige = false, onDraftWithPaige, drafting = false, draftReadingDoc = false,
    draftFlags = [], canDraft = true,
    templates = [], onApplyTemplate, snippets = [], onApplySnippet, showCombinedInsert = false,
    signatureAvailable = false, appendSignature = true, onToggleSignature,
    scheduledFor, onSchedule,
    showDictation, dictationScopeEpoch, onDictate, onDictateError,
    editingDraft = false, onCancelEdit, onSaveDraft, savingDraft = false, saveUnconfirmed = false, draftSaveDisabled = false, draftSaveNote,
    dragOver = false, onDropFiles, onDragOverZone, onDragLeaveZone,
  } = model;

  // transient UI-only state owned by the composer
  const [draftGuideOpen, setDraftGuideOpen] = useState(false);
  const [draftGuide, setDraftGuide] = useState("");
  const [draftTone, setDraftTone] = useState<DraftTone>("professional");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dictationActivity, setDictationActivity] = useState({
    epoch: dictationScopeEpoch,
    active: false,
  });
  const dictationActive =
    dictationActivity.epoch === dictationScopeEpoch && dictationActivity.active;

  const fireDraft = () => onDraftWithPaige?.({ guide: draftGuide.trim(), tone: draftTone });

  const renderDraft = caps.canDraftWithPaige && showDraftWithPaige && !!onDraftWithPaige;
  const renderTemplates = caps.hasTemplates && templates.length > 0 && !!onApplyTemplate;
  const renderSnippets = snippets.length > 0 && !!onApplySnippet;
  const renderInsert = showCombinedInsert && (renderSnippets || renderTemplates);
  const renderSignature = caps.hasSignature && signatureAvailable && !!onToggleSignature;
  const renderAttach = caps.hasAttachments && !!onAttachFiles;
  const renderSchedule = caps.canSchedule && !!onSchedule;

  const header = (
    <div className="space-y-2">
      {editingDraft && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Pencil className="h-3 w-3" /> {showSubject ? "Editing the saved email — review before sending." : "Editing Paige's draft — Send replaces and delivers it."}
          {onCancelEdit && (
            <button type="button" className="ml-1 underline hover:text-foreground disabled:opacity-50" disabled={disabled || sending || checking || savingDraft || saveUnconfirmed} onClick={onCancelEdit}>
              Cancel
            </button>
          )}
          {onSaveDraft && <Button type="button" variant="ghost" size="sm" disabled={draftSaveDisabled || savingDraft} aria-busy={savingDraft} onClick={onSaveDraft}>
            {savingDraft ? "Saving…" : saveUnconfirmed ? "Check save status" : "Save draft"}
          </Button>}
          {draftSaveNote && <span>{draftSaveNote}</span>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {showIdentity && identities.length > 0 && (
          <Select value={identityId} onValueChange={onIdentityChange} disabled={disabled}>
            <SelectTrigger className="h-9 min-w-[220px]">
              <SelectValue placeholder="Sending address" />
            </SelectTrigger>
            <SelectContent>
              {identities.map((idn) => {
                const Icon = CHANNEL_ICON[idn.channel];
                return (
                  <SelectItem key={idn.id} value={idn.id}>
                    <span className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5" />
                      <span>
                        {idn.label || CHANNEL_LABEL[idn.channel]}
                        {idn.sublabel ? <span className="ml-1.5 text-xs text-muted-foreground">· {idn.sublabel}</span> : null}
                      </span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}
        {showSubject && (
          <Input
            value={subject}
            onChange={(e) => onSubjectChange?.(e.target.value)}
            disabled={disabled}
            placeholder="Subject"
            className="h-9 flex-1 min-w-[180px]"
          />
        )}
      </div>

      {/* Attachment chip row */}
      {renderAttach && attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <AttachmentChip key={a.url} a={a} disabled={disabled || attachmentsLocked} onRemove={() => a.url && onRemoveAttachment?.(a)} />
          ))}
        </div>
      )}

      {/* Compliance flags from Paige's draft — tokened, not raw amber (§11). */}
      {renderDraft && draftFlags.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-md border border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.08)] px-2.5 py-1.5 text-[11px] text-[hsl(var(--warning))]">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span><span className="font-medium">Check before sending:</span> {draftFlags.join(" · ")}</span>
        </div>
      )}
    </div>
  );

  const toolbar = (
    <>
      {renderAttach && (
        <>
          <input
            ref={fileInputRef} type="file" multiple hidden disabled={disabled}
            onChange={(e) => { if (e.target.files?.length) onAttachFiles?.(e.target.files); e.target.value = ""; }}
          />
          {/* Attach — leads the cluster; neutral/indigo utility (gold is Send, §11). */}
          <Button variant="outline" size="sm" className="h-8"
            onClick={() => fileInputRef.current?.click()} disabled={disabled || uploading}>
            {uploading
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <Paperclip className="mr-1.5 h-3.5 w-3.5" />}
            Attach
          </Button>
        </>
      )}

      {/* Tap-to-dictate — neutral utility; dictated text feeds THROUGH the container's
          snippet-expanding onChange (via onDictate + a live ref) so expansion still runs. */}
      {showDictation && (
        <DictationMicButton
          scopeEpoch={dictationScopeEpoch}
          onText={(seg) => (onDictate ? onDictate(seg) : onChange(appendDictation(value, seg)))}
          onActiveChange={(active) => setDictationActivity({ epoch: dictationScopeEpoch, active })}
          onError={(msg) => onDictateError?.(msg)}
          disabled={disabled || sending || drafting || uploading}
          variant="outline"
          size="sm"
          label="Dictate"
          activeLabel="Listening…"
          className="h-8 border-[hsl(var(--primary)/0.4)]"
        />
      )}

      {/* Draft with Paige — the headline assist. Indigo-tinted (NOT gold, §11); one-click
          primary + optional guide popover. */}
      {renderDraft && (
        <div className="inline-flex items-center">
          <Button
            variant="outline" size="sm"
            className="h-8 min-w-[8.5rem] justify-center rounded-r-none border-r-0 border-[hsl(var(--primary)/0.4)]"
            onClick={fireDraft}
            disabled={disabled || drafting || sending || uploading || !canDraft}
            aria-busy={drafting}
            title={!canDraft ? "Add a recipient to draft a reply" : undefined}
          >
            {drafting
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <Sparkles className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />}
            {drafting
              ? (draftReadingDoc ? "Reading attachment…" : "Paige is drafting…")
              : "Draft with Paige"}
          </Button>
          <Popover open={draftGuideOpen} onOpenChange={setDraftGuideOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline" size="sm"
                className="h-8 rounded-l-none border-[hsl(var(--primary)/0.4)] px-2"
                aria-label="Guide Paige's draft" disabled={disabled || drafting}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-2 p-3">
              <label htmlFor="draft-guide" className="block text-[11px] font-medium text-muted-foreground">
                Optional — tell Paige the angle &amp; tone
              </label>
              <Textarea
                id="draft-guide" rows={2} value={draftGuide}
                onChange={(e) => setDraftGuide(e.target.value)}
                disabled={disabled}
                placeholder="e.g. Confirm the Thursday call and ask for their intake form"
                className="resize-none text-sm"
              />
              <Select value={draftTone} onValueChange={(v) => setDraftTone(v as DraftTone)} disabled={disabled}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="friendly">Friendly</SelectItem>
                  <SelectItem value="warm">Warm</SelectItem>
                  <SelectItem value="direct">Direct</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-8 w-full"
                onClick={() => { fireDraft(); setDraftGuideOpen(false); }} disabled={disabled || drafting}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" /> Draft it
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* One discoverable snippets/templates utility. Radix Popover owns Escape dismissal and
          trigger-focus restoration; choosing content only inserts editable text and never sends. */}
      {renderInsert && (
        <Popover open={insertOpen} onOpenChange={setInsertOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8" disabled={disabled}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Insert
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-72 w-72 overflow-y-auto p-2" aria-label="Insert a snippet or template">
            {renderSnippets && (
              <div>
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Snippets</p>
                {snippets.map((snippet) => (
                  <button key={snippet.id} type="button" className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    onClick={() => { onApplySnippet?.(snippet.id); setInsertOpen(false); }}>
                    <span className="block text-xs font-medium">{snippet.name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{snippet.trigger} · {snippet.body}</span>
                  </button>
                ))}
              </div>
            )}
            {renderTemplates && (
              <div className={cn(renderSnippets && "mt-2 border-t border-border pt-2")}>
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Email templates</p>
                {templates.map((template) => (
                  <button key={template.template_key} type="button" className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    onClick={() => { onApplyTemplate?.(template.template_key); setInsertOpen(false); }}>
                    <span className="block text-xs font-medium">{template.subject}</span>
                    <span className="block text-[10px] text-muted-foreground">{template.category}</span>
                  </button>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}

      {/* Preserve the established non-Solo template control unless a scope explicitly opts into
          the combined picker above. */}
      {renderTemplates && !showCombinedInsert && (
        <Select onValueChange={(key) => onApplyTemplate?.(key)} disabled={disabled}>
          <SelectTrigger className="h-8 w-[190px]">
            <SelectValue placeholder="Insert template…" />
          </SelectTrigger>
          <SelectContent>
            {templates.map((template) => (
              <SelectItem key={template.template_key} value={template.template_key}>
                <span className="mr-1.5 text-xs text-muted-foreground">[{template.category}]</span>{template.subject}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {renderSignature && (
        <Button
          variant="outline" size="sm" className="h-8"
          aria-pressed={appendSignature}
          disabled={disabled}
          data-state={appendSignature ? "on" : "off"}
          onClick={onToggleSignature}
        >
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Signature {appendSignature ? "on" : "off"}
        </Button>
      )}

      {renderSchedule && (
        <>
          <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8" disabled={disabled}>
                <Clock className="mr-1.5 h-3.5 w-3.5" />
                {scheduledFor ? "Scheduled" : "Schedule"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 space-y-1 p-2">
              <button type="button"
                className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => { onSchedule?.(new Date(Date.now() + 3600_000).toISOString()); setScheduleOpen(false); }}>
                In 1 hour
              </button>
              <button type="button"
                className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
                  onSchedule?.(d.toISOString()); setScheduleOpen(false);
                }}>
                Tomorrow, 9:00 AM
              </button>
              <div className="px-2 pt-1">
                <label className="text-[11px] text-muted-foreground">Custom</label>
                <Input
                  type="datetime-local"
                  className="mt-1 h-9"
                  // A governed email can be set no sooner than two minutes ahead (the door's own window).
                  min={new Date(Date.now() + 2 * 60_000).toISOString().slice(0, 16)}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const d = new Date(e.target.value);
                    if (d.getTime() > Date.now()) { onSchedule?.(d.toISOString()); setScheduleOpen(false); }
                  }}
                />
              </div>
            </PopoverContent>
          </Popover>

          {scheduledFor && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground">
              <Clock className="h-3 w-3 text-muted-foreground" />
              {new Date(scheduledFor).toLocaleString()}
              <button type="button" onClick={() => onSchedule?.(null)}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                aria-label="Clear schedule">
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </>
      )}
    </>
  );

  // Only render the header/toolbar slots when they hold something (an all-flags-off scope,
  // e.g. operator SMS today, renders the bare atom — identical to the shipped operator composer).
  const hasHeader = editingDraft
    || (showIdentity && identities.length > 0)
    || showSubject
    || (renderAttach && attachments.length > 0)
    || (renderDraft && draftFlags.length > 0);
  const hasToolbar = renderAttach || showDictation || renderDraft || renderInsert || renderTemplates || renderSignature || renderSchedule;

  return (
    <MessageComposer
      value={value}
      onChange={onChange}
      onSend={onSend}
      sending={sending}
      disabled={disabled}
      sendDisabled={sendDisabled || dictationActive}
      sendOnEnter={sendOnEnter}
      placeholder={placeholder}
      note={note}
      sendLabel={sendLabel}
      rows={rows}
      header={hasHeader ? header : undefined}
      toolbar={hasToolbar ? toolbar : undefined}
      actions={actions}
      checking={checking}
      textareaClassName={cn(textareaClassName, renderAttach && dragOver && "ring-2 ring-[hsl(var(--ring))]")}
      onDrop={renderAttach && !disabled ? (e) => {
        e.preventDefault(); onDragLeaveZone?.();
        if (e.dataTransfer.files?.length) onDropFiles?.(e.dataTransfer.files);
      } : undefined}
      onDragOver={renderAttach && !disabled ? (e) => { e.preventDefault(); onDragOverZone?.(); } : undefined}
      onDragLeave={renderAttach && !disabled ? () => onDragLeaveZone?.() : undefined}
    />
  );
}
