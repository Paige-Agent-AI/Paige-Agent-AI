import {useEffect, useId, useRef, type ReactNode} from "react";
import {Check, FileText, Loader2, Paperclip, X} from "lucide-react";
import {Button} from "@/components/ui/button";
import {CUSTOMER_CHAT_FILE_LIMIT, type CustomerChatFileSelection} from "@/lib/customer-chat-files";
import type {CustomerAttachmentDraft} from "@/hooks/useCustomerChatAttachments";

type Props = {
  enabled: boolean;
  locked?: boolean;
  files: readonly CustomerAttachmentDraft[];
  issues: CustomerChatFileSelection["issues"];
  busy: boolean;
  notice: string;
  upload: {id: string | null; kind: string};
  onSelect: (files: File[]) => void;
  onRemove: (id: string) => void;
  onCheck: (id: string) => void;
  onResume: (id: string) => void;
  onStop: () => void;
  secondaryAction?: ReactNode;
};
const NO_FILES: readonly CustomerAttachmentDraft[] = [];

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Presentation only: the original private file consumer owns all upload and
 * recovery authority. Selection is not a message, an upload or a model read.
 */
export function CustomerChatAttachments(props: Props) {
  const input = useRef<HTMLInputElement>(null), help = useId();
  const add = useRef<HTMLButtonElement>(null), actions = useRef(new Map<string, HTMLButtonElement>());
  const recoveryFocus = useRef<{id:string;from:HTMLElement}|null>(null);
  const removal = useRef<{id: string; next: string | null; from: HTMLButtonElement} | null>(null);
  const files = props.enabled ? props.files : NO_FILES;
  const uncertain = files.some(file => file.phase === "check");
  useEffect(() => {
    if (!props.enabled) {removal.current = null; return;}
    const recovering=recoveryFocus.current;
    if(recovering&&props.enabled&&!props.busy){
      recoveryFocus.current=null;
      if(document.activeElement===document.body||document.activeElement===recovering.from){
        const target=actions.current.get(recovering.id);if(target&&!target.disabled)target.focus();
      }
    }
    const pending = removal.current;
    // A requested removal may be refused by the original controller. Move focus
    // only after the actual local selection no longer contains that file.
    if (!pending || files.some(file => file.id === pending.id)) return;
    removal.current = null;
    if (document.activeElement !== document.body && document.activeElement !== pending.from) return;
    const target = (pending.next ? actions.current.get(pending.next) : null) ?? add.current;
    if (target && !target.disabled) target.focus();
  }, [files, props.enabled, props.busy]);
  return <section aria-label="Files for this message" aria-busy={props.enabled && props.busy} className="min-w-0 space-y-1.5">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
      <Button ref={add} type="button" variant="ghost" className="min-h-11 shrink-0 gap-2 px-2 text-sm"
        disabled={!props.enabled || props.locked || props.busy || uncertain || files.length >= CUSTOMER_CHAT_FILE_LIMIT}
        aria-describedby={help} onClick={() => input.current?.click()}>
        <Paperclip aria-hidden="true" className="h-4 w-4"/>Add files
      </Button>
      {props.secondaryAction}
      </div>
      {files.length > 0 && <span className="text-xs text-muted-foreground">{files.length} of {CUSTOMER_CHAT_FILE_LIMIT} files</span>}
      <input ref={input} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.docx" tabIndex={-1}
        aria-label="Choose private files for this message" className="sr-only"
        disabled={!props.enabled || props.locked || props.busy || uncertain || files.length >= CUSTOMER_CHAT_FILE_LIMIT}
        onChange={event => {
          const selected = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (props.enabled && !props.locked && !props.busy && !uncertain && selected.length) props.onSelect(selected);
        }}/>
    </div>
    {files.length > 0 && <ul className="max-h-32 overflow-y-auto overscroll-contain rounded-lg border border-border bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label="Selected private files" tabIndex={0}>
      {files.map(file => {
        const checking = file.phase === "check";
        const canResume = checking && props.upload.id === file.id && ["retry", "finish"].includes(props.upload.kind);
        const name = file.file.name, tail = name.length > 32 ? name.slice(-12) : "";
        return <li key={file.id} className="flex min-w-0 flex-wrap items-center gap-x-2 border-b border-border px-2 py-1 last:border-0">
          {file.phase === "saved" ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-foreground"/>
            : file.phase === "saving" ? <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 motion-safe:animate-spin"/>
              : <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground"/>}
          <div className="min-w-0 flex-1 py-1">
            <p className="flex min-w-0 text-sm text-foreground" title={name}>
              <span className="min-w-0 truncate">{tail ? name.slice(0, -12) : name}</span>{tail && <span className="shrink-0">{tail}</span>}
            </p>
            <p className="text-xs text-muted-foreground">{size(file.file.size)} · {file.phase === "saved" ? "Saved privately"
              : file.phase === "saving" ? "Saving…" : checking ? "Needs a status check" : "Ready to attach"}</p>
          </div>
          {checking ? <div className="flex w-full shrink-0 flex-wrap justify-end gap-1 pb-1">
            <Button ref={node => {if (node) actions.current.set(file.id, node); else actions.current.delete(file.id);}}
              type="button" variant="outline" className="min-h-11 px-2 text-sm" disabled={props.busy || props.locked}
              aria-label={`Check upload of ${file.file.name}`} onClick={() => props.onCheck(file.id)}>Check upload</Button>
            {canResume && <Button type="button" variant="secondary" className="min-h-11 px-2 text-sm" disabled={props.busy || props.locked}
              aria-label={`Resume upload of ${file.file.name}`} onClick={event => {recoveryFocus.current={id:file.id,from:event.currentTarget};props.onResume(file.id);}}>Resume</Button>}
          </div> : <Button ref={node => {if (node) actions.current.set(file.id, node); else actions.current.delete(file.id);}}
            type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0"
            disabled={props.locked || props.busy || file.phase === "saving"} aria-label={`Remove ${file.file.name} from message`}
            onClick={event => {
              const index = files.findIndex(candidate => candidate.id === file.id);
              removal.current = {id: file.id, next: files[index + 1]?.id ?? files[index - 1]?.id ?? null, from: event.currentTarget};
              props.onRemove(file.id);
            }}><X aria-hidden="true" className="h-4 w-4"/></Button>}
        </li>;
      })}
    </ul>}
    <p id={help} className="text-xs text-muted-foreground">{files.length ? "Files stay private. Saving a file does not send your message."
      : "PDF, JPG, PNG or Word · up to 5 files, 20 MB total"}</p>
    {props.enabled && props.issues.length > 0 && <ul role="status" className="space-y-1 text-sm text-foreground">
      {props.issues.map((issue, index) => <li key={index} className="break-words [overflow-wrap:anywhere]">
        {issue.filename ? `${issue.filename}: ` : ""}{issue.message}
      </li>)}
    </ul>}
    {props.enabled && props.notice && <p role="status" className="break-words text-sm text-foreground">{props.notice}</p>}
    {props.enabled && props.busy && <Button type="button" variant="outline" className="min-h-11 text-sm" onClick={props.onStop}>Stop waiting</Button>}
  </section>;
}
