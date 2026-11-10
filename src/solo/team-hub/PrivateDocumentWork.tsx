import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { OriginalDocumentWork } from "@/components/chat/OriginalDocumentWork";
import {
  clearPrivateDocumentWork,
  parsePrivateDocumentWork,
  PRIVATE_DOCUMENT_WORK_CHANGED,
  privateDocumentWorkSnapshot,
} from "@/lib/privateDocumentWorkHandoff";

function subscribe(changed: () => void) {
  window.addEventListener(PRIVATE_DOCUMENT_WORK_CHANGED, changed);
  return () => window.removeEventListener(PRIVATE_DOCUMENT_WORK_CHANGED, changed);
}

export function PrivateDocumentWork({ actorId, tenantId }: { actorId: string; tenantId: string }) {
  const snapshot = useSyncExternalStore(subscribe, () => privateDocumentWorkSnapshot(actorId, tenantId));
  const reference = parsePrivateDocumentWork(snapshot);
  const [open, setOpen] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  const summary = useRef<HTMLElement>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  return (
    <details className="th-group group" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary ref={summary} className="th-btn w-full text-left">
        <Lock aria-hidden="true" size={14} />
        <span className="flex-1">Saved PAIGE work</span>
        <ChevronDown aria-hidden="true" size={14} className="group-open:rotate-180" />
      </summary>
      <div className="min-w-0 px-2 py-2">
        <p className="th-note">
          Saved references stay in this tab. Access is checked when you reopen them.
        </p>
        {open && (snapshot && reference ? (
          <>
            <OriginalDocumentWork
              key={snapshot}
              reference={reference}
              actorId={actorId}
              tenantId={tenantId}
              current={() => mounted.current && privateDocumentWorkSnapshot(actorId, tenantId) === snapshot}
              artifacts={[]}
            />
            <button
              type="button"
              className="th-btn mt-2"
              onClick={() => {
                const removed = clearPrivateDocumentWork(actorId, tenantId, snapshot);
                setRemoveFailed(!removed);
                if (removed) summary.current?.focus();
              }}
            >
              Remove saved reference
            </button>
            {removeFailed && <p className="th-note" role="status">The saved reference could not be removed. Try again.</p>}
          </>
        ) : <p className="th-note">In PAIGE Chat, check an original document job and choose Keep in Team Hub.</p>)}
      </div>
    </details>
  );
}
