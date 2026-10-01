import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Download,
  FileCheck2,
  FileLock2,
  FileText,
  FolderKanban,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useTenantFeature } from "@/hooks/useTenantFeature";
import {
  buildVaultContractMutation,
  summarizeContinuityPulse,
  validateVaultUpload,
  type VaultFact,
  type VaultContract,
  type VaultHandlingMode,
  type VaultObligation,
  type VaultRecord,
} from "./vault/vault-contract";
import { useBusinessVault } from "./vault/useBusinessVault";
import { SecureBrowserConnectedAccounts } from "./vault/SecureBrowserConnectedAccounts";
import "./vault.css";

const TABS = [
  ["overview", "Overview"],
  ["business_core", "Business Core"],
  ["contracts", "Contracts"],
  ["obligations", "Obligations"],
  ["library", "Library"],
  ["relationships", "Relationships"],
  ["intake", "Intake & Review"],
  ["security", "Access & Security"],
  ["connected_accounts", "Connected Accounts"],
  ["archive", "Archive"],
] as const;
type Tab = (typeof TABS)[number][0];

function keepFocusInside(event: KeyboardEvent, root: HTMLElement | null) {
  if (event.key !== "Tab" || !root) return;
  const focusable = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])',
    ),
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function Status({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "gold" | "violet" | "good" | "bad";
}) {
  return <span className={`bv-status bv-status--${tone}`}>{children}</span>;
}

function Empty({
  icon: Icon = FileLock2,
  title,
  copy,
  action,
}: {
  icon?: typeof FileLock2;
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <div className="bv-empty">
      <span className="bv-empty__icon">
        <Icon size={21} />
      </span>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

function ModalFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnRef = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    const returnTarget = returnRef.current;
    const background = document.querySelector<HTMLElement>(".solo-settings--vault");
    if (background) {
      background.inert = true;
      background.setAttribute("aria-hidden", "true");
    }
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      keepFocusInside(event, dialogRef.current);
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      if (background) {
        background.inert = false;
        background.removeAttribute("aria-hidden");
      }
      (returnTarget as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div
      className="bv-modal-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="bv-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bv-modal-title"
      >
        <header>
          <h2 id="bv-modal-title">{title}</h2>
          <button
            ref={closeRef}
            className="bv-icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}

function UploadDialog({
  onClose,
  onUpload,
  replaceRecord,
  canUseOwnerOnly,
}: {
  onClose: () => void;
  onUpload: (body: FormData, signal?: AbortSignal) => Promise<unknown>;
  replaceRecord?: VaultRecord | null;
  canUseOwnerOnly: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(replaceRecord?.title || "");
  const [section, setSection] = useState(replaceRecord?.section || "library");
  const [recordType, setRecordType] = useState(
    replaceRecord?.recordType || "Operational record",
  );
  const [visibility, setVisibility] = useState<
    "owner_only" | "owner_admin"
  >(
    replaceRecord?.visibility || "owner_admin",
  );
  const [mode, setMode] = useState<VaultHandlingMode>(
    replaceRecord?.handlingMode || "store_only",
  );
  const [attested, setAttested] = useState(false);
  const [state, setState] = useState<"idle" | "uploading" | "failed" | "done">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  const validation = file
    ? validateVaultUpload(file, attested)
    : "Choose a supported file.";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || validation || !title.trim()) return;
    setState("uploading");
    setMessage(null);
    const body = new FormData();
    body.set("file", file);
    body.set("title", title.trim());
    body.set("section", section);
    body.set("record_type", recordType.trim());
    body.set("visibility", visibility);
    body.set("handling_mode", mode);
    body.set("no_secrets_attested", "true");
    if (replaceRecord) body.set("replace_record_id", replaceRecord.id);
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      await onUpload(body, controller.signal);
      setState("done");
    } catch {
      setState("failed");
      setMessage(
        controller.signal.aborted
          ? "The upload was interrupted. Its storage outcome is unconfirmed; refresh the Vault before retrying. Reserved bytes are eligible for bounded reconciliation."
          : "The file was not confirmed in private quarantine. Check your connection and retry.",
      );
    } finally {
      uploadController.current = null;
    }
  }

  return (
    <ModalFrame
      title={
        replaceRecord ? "Replace source version" : "Add to the Business Vault"
      }
      onClose={() => {
        if (state === "uploading") {
          uploadController.current?.abort();
          setMessage("Cancellation requested. Waiting for the upload boundary to settle…");
          return;
        }
        onClose();
      }}
    >
      {state === "done" ? (
        <div className="bv-modal__body">
          <Empty
            icon={CheckCircle2}
            title="Quarantine confirmed"
            copy="The private source is awaiting mandatory inspection. No Vault record or download is available, and Paige has not indexed, remembered, shared, or acted on it."
            action={
              <button className="bv-button bv-button--gold" onClick={onClose}>
                Return to Vault
              </button>
            }
          />
        </div>
      ) : (
        <form onSubmit={submit} className="bv-form">
          <label
            className="bv-drop"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const next = event.dataTransfer.files[0];
              if (next) {
                setFile(next);
                setTitle(title || next.name.replace(/\.[^.]+$/, ""));
              }
            }}
          >
            <UploadCloud size={24} />
            <strong>{file ? file.name : "Drop a document here"}</strong>
            <span>or browse PDF, JPG, PNG, or WEBP · 15 MB maximum</span>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={(event) => {
                const next = event.target.files?.[0] || null;
                setFile(next);
                if (next && !title) setTitle(next.name.replace(/\.[^.]+$/, ""));
              }}
            />
          </label>
          <div className="bv-form__grid">
            <label>
              Title
              <input
                required
                disabled={!!replaceRecord}
                value={title}
                maxLength={180}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              Record type
              <input
                required
                disabled={!!replaceRecord}
                value={recordType}
                maxLength={80}
                onChange={(event) => setRecordType(event.target.value)}
              />
            </label>
            <label>
              Vault section
              <select
                disabled={!!replaceRecord}
                value={section}
                onChange={(event) => setSection(event.target.value)}
              >
                <option value="business_core">Business Core</option>
                <option value="contracts">Contracts</option>
                <option value="obligations">Obligations</option>
                <option value="library">Library</option>
              </select>
            </label>
            <label>
              Visibility
              <select
                disabled={!!replaceRecord}
                value={visibility}
                onChange={(event) =>
                  setVisibility(
                    event.target.value === "owner_only"
                      ? "owner_only"
                      : "owner_admin",
                  )
                }
              >
                <option value="owner_admin">Owner and administrators</option>
                <option value="owner_only" disabled={!canUseOwnerOnly}>
                  Owner only{canUseOwnerOnly ? "" : " — owner required"}
                </option>
              </select>
            </label>
          </div>
          <label>
            Related organization or person
            <input
              disabled
              value=""
              placeholder="Canonical relationship linking unavailable in this slice"
            />
          </label>
          <fieldset className="bv-modes">
            <legend>How may Paige handle this source?</legend>
            {(
              [
                [
                  "store_only",
                  "Store only",
                  "Stored as evidence. Paige cannot use it for business context.",
                ],
                [
                  "classify",
                  "Paige may classify",
                  "Classification is requested, but interpretation is unavailable in this phase and nothing becomes trusted.",
                ],
                [
                  "approved_context",
                  "Eligible for approved context",
                  "You may later enter and approve bounded facts. Upload alone approves nothing.",
                ],
              ] as const
            ).map(([value, label, copy]) => (
              <label
                key={value}
                className={mode === value ? "is-selected" : ""}
              >
                <input
                  type="radio"
                  disabled={!!replaceRecord}
                  name="mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <span>
                  <strong>{label}</strong>
                  <small>{copy}</small>
                </span>
              </label>
            ))}
          </fieldset>
          {replaceRecord && (
            <div className="bv-callout">
              <RefreshCw size={16} />
              <span>
                Replacement preserves this record’s title, section, access, and
                Paige-use setting. Prior approved facts retire and dependent
                obligations return to review only after inspection passes and
                the replacement is promoted.
              </span>
            </div>
          )}
          <label className="bv-check">
            <input
              type="checkbox"
              checked={attested}
              onChange={(event) => setAttested(event.target.checked)}
            />
            <span>
              I confirm this file contains no passwords, API keys, recovery
              codes, banking secrets, authentication cookies, or provider
              tokens.
            </span>
          </label>
          <div aria-live="polite">
          {(message || (file && validation)) && (
            <div className="bv-callout bv-callout--bad" role="alert">
              <CircleAlert size={16} />
              {message || validation}
            </div>
          )}
          </div>
          <div className="bv-callout">
            <ShieldCheck size={16} />
            <span>
              File content and instructions inside it are treated as untrusted.
              Mandatory OCR and sensitive-content inspection must pass before
              normal Vault access. Your attestation is a secondary warning,
              never inspection evidence.
            </span>
          </div>
          <footer>
            <button
              type="button"
              className="bv-button"
              onClick={() => {
                if (state === "uploading") {
                  uploadController.current?.abort();
                  setMessage("Cancellation requested. Waiting for the upload boundary to settle…");
                } else {
                  onClose();
                }
              }}
            >
              {state === "uploading" ? "Cancel upload" : "Cancel"}
            </button>
            <button
              className="bv-button bv-button--gold"
              disabled={
                !file || !!validation || !title.trim() || state === "uploading"
              }
            >
              {state === "uploading" ? (
                <>
                  <LoaderCircle className="bv-spin" size={16} />
                  Uploading…
                </>
              ) : state === "failed" ? (
                "Retry upload"
              ) : (
                "Send to private quarantine"
              )}
            </button>
          </footer>
        </form>
      )}
    </ModalFrame>
  );
}

function ContextFactPanel({
  record,
  facts,
  onPropose,
  onReview,
  canApprove,
}: {
  record: VaultRecord;
  facts: VaultFact[];
  onPropose: (input: Record<string, unknown>) => Promise<unknown>;
  onReview: (
    factId: string,
    decision: "approved" | "rejected" | "revoked",
  ) => Promise<unknown>;
  canApprove: boolean;
}) {
  const [factKey, setFactKey] = useState("business_legal_name");
  const [factValue, setFactValue] = useState("");
  const [freshUntil, setFreshUntil] = useState("");
  const [saving, setSaving] = useState(false);
  async function propose(event: FormEvent) {
    event.preventDefault();
    if (!factValue.trim() || !record.versionId) return;
    setSaving(true);
    try {
      await onPropose({
        recordId: record.id,
        versionId: record.versionId,
        factKey,
        factValue: factValue.trim(),
        freshUntil,
      });
      setFactValue("");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="bv-context">
      <h3>Bounded Paige context</h3>
      <p className="bv-copy">
        Enter one fact, then review it separately. The source document itself is
        never promoted.
      </p>
      {facts.map((fact) => (
        <div className="bv-context__fact" key={fact.id}>
          <span>
            <strong>{fact.factKey.replace(/_/g, " ")}</strong>
            <small>
              {String(fact.factValue)} · {fact.provenance.replace(/_/g, " ")}
              {fact.freshUntil
                ? ` · fresh through ${new Date(fact.freshUntil).toLocaleDateString()}`
                : " · no freshness limit entered"}
            </small>
          </span>
          <Status tone={fact.state === "approved" ? "good" : "violet"}>
            {fact.state}
          </Status>
          <div>
            {fact.state === "proposed" ? (
              <>
                <button
                  disabled={!canApprove}
                  title={canApprove ? "Approve sourced context" : "Workspace owner approval required"}
                  onClick={() => void onReview(fact.id, "approved")}
                >
                  {canApprove ? "Approve" : "Owner approval required"}
                </button>
                <button onClick={() => void onReview(fact.id, "rejected")}>
                  Reject
                </button>
              </>
            ) : (
              <button disabled={!canApprove} onClick={() => void onReview(fact.id, "revoked")}>
                Revoke
              </button>
            )}
          </div>
        </div>
      ))}
      <form onSubmit={propose} className="bv-context__form">
        <select
          value={factKey}
          onChange={(event) => setFactKey(event.target.value)}
        >
          <option value="business_legal_name">Business legal name</option>
          <option value="business_registration_state">
            Registration state
          </option>
          <option value="business_license_status">License status</option>
          <option value="insurance_coverage_status">
            Insurance coverage status
          </option>
          <option value="operating_region">Operating region</option>
          <option value="policy_status">Policy status</option>
        </select>
        <input
          required
          value={factValue}
          maxLength={240}
          placeholder="Owner-entered value"
          onChange={(event) => setFactValue(event.target.value)}
        />
        <input
          type="date"
          value={freshUntil}
          aria-label="Fresh until"
          onChange={(event) => setFreshUntil(event.target.value)}
        />
        <button className="bv-button" disabled={saving}>
          {saving ? "Saving…" : "Propose for review"}
        </button>
      </form>
    </section>
  );
}

function RecordDrawer({
  record,
  facts,
  onClose,
  onArchive,
  onReplace,
  onProposeFact,
  onReviewFact,
  canArchive,
  canUpload,
}: {
  record: VaultRecord;
  facts: VaultFact[];
  onClose: () => void;
  onArchive: () => Promise<unknown>;
  onReplace: () => void;
  onProposeFact: (input: Record<string, unknown>) => Promise<unknown>;
  onReviewFact: (
    factId: string,
    decision: "approved" | "rejected" | "revoked",
  ) => Promise<unknown>;
  canArchive: boolean;
  canUpload: boolean;
}) {
  const { activeTenantId } = useTenantContext();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const returnRef = useRef<Element | null>(document.activeElement);
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const returnTarget = returnRef.current;
    const background = document.querySelector<HTMLElement>(".solo-settings--vault");
    if (background) {
      background.inert = true;
      background.setAttribute("aria-hidden", "true");
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      keepFocusInside(event, drawerRef.current);
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      if (background) {
        background.inert = false;
        background.removeAttribute("aria-hidden");
      }
      (returnTarget as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);
  async function download() {
    setDownloadError(null);
    if (!record.versionId || !activeTenantId) {
      setDownloadError("The attachment is unavailable in this workspace.");
      return;
    }
    const { data: session } = await supabase.auth.getSession();
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/business-vault-download`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session?.access_token || ""}`,
        },
        body: JSON.stringify({
          version_id: record.versionId,
          expected_tenant: activeTenantId,
        }),
      },
    );
    if (!response.ok) {
      setDownloadError("The attachment could not be downloaded. No file details were returned.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = record.originalFilename || "vault-record";
    link.click();
    URL.revokeObjectURL(url);
  }
  return createPortal(
    <div
      className="bv-drawer-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className="bv-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bv-record-title"
      >
        <header>
          <div>
            <Status
              tone={record.truthState === "approved_fact" ? "good" : "neutral"}
            >
              {record.truthState.replace(/_/g, " ")}
            </Status>
            <h2 id="bv-record-title">{record.title}</h2>
            <p>{record.recordType}</p>
          </div>
          <button
            className="bv-icon-button"
            autoFocus
            onClick={onClose}
            aria-label="Close record"
          >
            <X size={18} />
          </button>
        </header>
        <div className="bv-drawer__body">
          <section className="bv-preview">
            <FileText size={34} />
            <strong>Safe preview unavailable</strong>
            <p>
              {record.inspectionState === "passed"
                ? "This source passed mandatory inspection but has not been interpreted. Download returns an attachment only."
                : "Inline preview is unavailable. Uninspected sources cannot enter normal Vault access."}
            </p>
          </section>
          <dl className="bv-facts">
            <div>
              <dt>Source</dt>
              <dd>
                Manual upload ·{" "}
                {record.originalFilename || "No file name returned"}
              </dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>
                {record.visibility === "owner_only"
                  ? "Owner only"
                  : "Owner and administrators"}
              </dd>
            </div>
            <div>
              <dt>Paige use</dt>
              <dd>{record.handlingMode.replace(/_/g, " ")}</dd>
            </div>
            <div>
              <dt>Source state</dt>
              <dd>{record.sourceState}</dd>
            </div>
            <div>
              <dt>Validation</dt>
              <dd>{record.validationState || "Unavailable"}</dd>
            </div>
            <div>
              <dt>Inspection</dt>
              <dd>
                {record.inspectionState === "passed" && record.inspectedAt
                  ? `Passed ${new Date(record.inspectedAt).toLocaleDateString()}`
                  : "Unavailable"}
              </dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>Current source version · lineage retained</dd>
            </div>
            <div>
              <dt>Retention</dt>
              <dd>
                {record.retentionUntil
                  ? `Retain through ${new Date(record.retentionUntil).toLocaleDateString()}`
                  : "No deletion schedule · archive retains the source"}
              </dd>
            </div>
          </dl>
          {record.handlingMode !== "store_only" && (
            <div className="bv-callout bv-callout--violet">
              <Sparkles size={16} />
              <span>
                Document interpretation is unavailable. No proposed facts or
                classifications were created.
              </span>
            </div>
          )}
          <section>
            <h3>Governed evidence boundary</h3>
            <p className="bv-copy">
              Approved bounded facts can later be projected with source and
              freshness. This record is not automatically copied to Mind,
              retrieved in chat, sent to Rail, or used to change Systems Check.
            </p>
          </section>
          {record.handlingMode === "approved_context" && record.versionId && (
            <ContextFactPanel
              record={record}
              facts={facts}
              onPropose={onProposeFact}
              onReview={onReviewFact}
              canApprove={canArchive}
            />
          )}
          <div className="bv-drawer__actions">
            {downloadError && <div className="bv-callout bv-callout--bad" role="alert">{downloadError}</div>}
            <button
              className="bv-button"
              onClick={download}
              disabled={!record.versionId || record.validationState !== "ready" || record.inspectionState !== "passed"}
            >
              <Download size={16} />
              Download attachment
            </button>
            <button
              className="bv-button"
              onClick={onReplace}
              disabled={!record.versionId || !canUpload}
              title={!canUpload ? "Replacement is unavailable until mandatory inspection is configured" : undefined}
            >
              <RefreshCw size={16} />
              Replace source version {!canUpload && <Status tone="violet">Unavailable</Status>}
            </button>
            <button className="bv-button" disabled>
              <Link2 size={16} />
              Link relationship <Status tone="violet">Unavailable</Status>
            </button>
            <button
              className="bv-button bv-button--danger"
              disabled={!canArchive}
              title={
                canArchive
                  ? "Archive this record and retire current facts"
                  : "Only the workspace owner may archive records"
              }
              onClick={() => void onArchive()}
            >
              <Archive size={16} />
              {canArchive
                ? "Archive record"
                : "Owner approval required to archive"}
            </button>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function MetadataDialog({
  kind,
  records,
  onClose,
  onSave,
  initial,
}: {
  kind: "contract" | "obligation";
  records: VaultRecord[];
  onClose: () => void;
  onSave: (input: Record<string, unknown>) => Promise<unknown>;
  initial?: VaultContract | VaultObligation | null;
}) {
  const eligible = records.filter(
    (record) =>
      record.lifecycleState === "active" &&
      (kind === "obligation" || record.section === "contracts"),
  );
  const [recordId, setRecordId] = useState(
    initial && "recordId" in initial
      ? initial.recordId
      : initial && "sourceRecordId" in initial
        ? initial.sourceRecordId || ""
        : eligible[0]?.id || "",
  );
  const [title, setTitle] = useState(
    initial && "title" in initial ? initial.title : "",
  );
  const [category, setCategory] = useState(
    initial && "contractType" in initial
      ? initial.contractType
      : initial && "category" in initial
        ? initial.category
        : kind === "contract"
          ? "Service agreement"
          : "Renewal",
  );
  const [counterparty, setCounterparty] = useState(
    initial && "counterpartyName" in initial
      ? initial.counterpartyName || ""
      : "",
  );
  const [effectiveDate, setEffectiveDate] = useState(
    initial && "effectiveDate" in initial ? initial.effectiveDate || "" : "",
  );
  const [endDate, setEndDate] = useState(
    initial && "endDate" in initial ? initial.endDate || "" : "",
  );
  const [paymentTerms, setPaymentTerms] = useState(
    initial && "paymentTerms" in initial ? initial.paymentTerms || "" : "",
  );
  const [date, setDate] = useState(
    initial && "renewalDate" in initial
      ? initial.renewalDate || ""
      : initial && "dueAt" in initial && initial.dueAt
        ? initial.dueAt.slice(0, 16)
        : "",
  );
  const [noticeDays, setNoticeDays] = useState(
    initial?.noticeDays == null ? "" : String(initial.noticeDays),
  );
  const [nextAction, setNextAction] = useState(
    initial && "nextAction" in initial ? initial.nextAction || "" : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (kind === "contract")
        await onSave(buildVaultContractMutation(
          initial && "contractType" in initial ? initial : null,
          {
          recordId,
          contractType: category,
          counterpartyName: counterparty,
          effectiveDate,
          endDate,
          renewalDate: date,
          noticeDays,
          paymentTerms,
          },
        ));
      else
        await onSave({
          id: initial?.id || "",
          sourceRecordId: recordId,
          contractId:
            initial && "contractId" in initial ? initial.contractId || "" : "",
          category,
          title,
          dueAt: date ? new Date(date).toISOString() : "",
          cadence: initial && "cadence" in initial ? initial.cadence || "" : "",
          timezone:
            initial && "timezone" in initial
              ? initial.timezone || ""
              : Intl.DateTimeFormat().resolvedOptions().timeZone,
          noticeDays,
          state: initial && "title" in initial ? initial.state : "proposed",
          nextAction,
        });
      onClose();
    } catch {
      setError(
        "The metadata was not confirmed as saved. Nothing was marked complete.",
      );
      setSaving(false);
    }
  }
  return (
    <ModalFrame
      title={
        initial
          ? kind === "contract"
            ? "Edit contract details"
            : "Edit obligation"
          : kind === "contract"
            ? "Add contract details"
            : "Add an obligation"
      }
      onClose={onClose}
    >
      <form className="bv-form" onSubmit={submit}>
        {kind === "contract" && eligible.length === 0 ? (
          <div className="bv-callout bv-callout--violet">
            <CircleAlert size={16} />
            <span>
              Upload a source into Contracts before adding contract details.
            </span>
          </div>
        ) : (
          <>
            <div className="bv-form__grid">
              {kind === "obligation" && (
                <label>
                  Obligation title
                  <input
                    required
                    value={title}
                    maxLength={160}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
              )}
              {kind === "contract" && (
                <>
                  <label>
                    Effective date
                    <input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
                  </label>
                  <label>
                    End date
                    <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                  </label>
                  <label>
                    Payment terms
                    <input value={paymentTerms} maxLength={500} onChange={(event) => setPaymentTerms(event.target.value)} />
                  </label>
                </>
              )}
              <label>
                {kind === "contract" ? "Contract type" : "Category"}
                <input
                  required
                  value={category}
                  maxLength={80}
                  onChange={(event) => setCategory(event.target.value)}
                />
              </label>
              <label>
                Source record
                <select
                  value={recordId}
                  onChange={(event) => setRecordId(event.target.value)}
                >
                  <option value="">No source available</option>
                  {eligible.map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.title}
                    </option>
                  ))}
                </select>
              </label>
              {kind === "contract" && (
                <label>
                  Counterparty name
                  <input
                    value={counterparty}
                    maxLength={180}
                    onChange={(event) => setCounterparty(event.target.value)}
                  />
                </label>
              )}
              <label>
                {kind === "contract" ? "Renewal date" : "Due date"}
                <input
                  type={kind === "contract" ? "date" : "datetime-local"}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label>
                Notice window, days
                <input
                  type="number"
                  min="0"
                  max="3650"
                  value={noticeDays}
                  onChange={(event) => setNoticeDays(event.target.value)}
                />
              </label>
              {kind === "obligation" && (
                <label>
                  Next required action
                  <input
                    value={nextAction}
                    maxLength={240}
                    onChange={(event) => setNextAction(event.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="bv-callout">
              <FileCheck2 size={16} />
              <span>
                These are owner-entered fields. Paige has not extracted,
                verified, filed, renewed, paid, or completed anything.
              </span>
            </div>
            {error && (
              <div className="bv-callout bv-callout--bad" role="alert">
                <CircleAlert size={16} />
                {error}
              </div>
            )}
          </>
        )}
        <footer>
          <button type="button" className="bv-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="bv-button bv-button--gold"
            disabled={saving || (kind === "contract" && !recordId)}
          >
            {saving ? "Saving…" : "Save owner-entered metadata"}
          </button>
        </footer>
      </form>
    </ModalFrame>
  );
}

function VaultWorkspace({ openPaige }: { openPaige?: () => void }) {
  const vault = useBusinessVault();
  const [tab, setTab] = useState<Tab>("overview");
  const { enabled: secureBrowserEnabled, loading: secureBrowserFlagLoading } =
    useTenantFeature("secure_browser");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [replaceRecord, setReplaceRecord] = useState<VaultRecord | null>(null);
  const [selected, setSelected] = useState<VaultRecord | null>(null);
  const [metadata, setMetadata] = useState<{
    kind: "contract" | "obligation";
    initial?: VaultContract | VaultObligation;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const records = vault.snapshot?.records || [];
  const active = records.filter(
    (record) => !["archived", "retired", "superseded"].includes(record.lifecycleState),
  );
  const archived = records.filter(
    (record) => ["archived", "retired", "superseded"].includes(record.lifecycleState),
  );
  const pulse = useMemo(
    () => summarizeContinuityPulse(vault.snapshot?.obligations || []),
    [vault.snapshot],
  );
  const visibleTabs = useMemo(
    () => TABS.filter(([id]) => id !== "connected_accounts" || secureBrowserEnabled),
    [secureBrowserEnabled],
  );
  useEffect(() => {
    if (!secureBrowserFlagLoading && !secureBrowserEnabled && tab === "connected_accounts") {
      setTab("overview");
    }
  }, [secureBrowserEnabled, secureBrowserFlagLoading, tab]);

  if (vault.state === "loading")
    return (
      <div className="bv-boundary">
        <LoaderCircle className="bv-spin" size={22} />
        <h2>Checking Vault access…</h2>
        <p>No record details are loaded until authorization is confirmed.</p>
      </div>
    );
  if (vault.state === "denied")
    return (
      <div className="bv-boundary">
        <ShieldCheck size={24} />
        <h2>Business Vault access unavailable</h2>
        <p>
          This area is limited to the workspace owner and authorized
          administrators. No Vault metadata was returned.
        </p>
      </div>
    );
  if (vault.state === "error")
    return (
      <div className="bv-boundary">
        <CircleAlert size={24} />
        <h2>Vault unavailable</h2>
        <p>{vault.error}</p>
        <button className="bv-button" onClick={() => void vault.reload()}>
          <RefreshCw size={16} />
          Retry
        </button>
      </div>
    );

  const filtered =
    tab === "archive"
      ? archived
      : tab === "library"
        ? active.filter((r) => r.section === "library")
        : tab === "business_core"
          ? active.filter((r) => r.section === "business_core")
          : active;

  return (
    <div className="bv-shell">
      <header className="bv-head">
        <div>
          <span className="bv-eyebrow">Solo settings · Admin only</span>
          <h1>Business Vault</h1>
          <p>
            Evidence, obligations, and business continuity — governed and
            source-backed.
          </p>
        </div>
        <div className="bv-head__actions">
          <button className="bv-button" disabled title="Governed Vault retrieval is not configured">
            <Sparkles size={16} />
            Ask Paige <Status tone="violet">Unavailable</Status>
          </button>
          <button
            className="bv-button bv-button--gold"
            disabled={!vault.uploadAvailable}
            title={!vault.uploadAvailable ? "Binary upload is unavailable until mandatory inspection is configured" : undefined}
            onClick={() => setUploadOpen(true)}
          >
            <Plus size={17} />
            Add to Vault {!vault.uploadAvailable && <Status tone="violet">Unavailable</Status>}
          </button>
        </div>
      </header>
      <nav className="bv-tabs" aria-label="Business Vault sections">
        <select
          aria-label="Business Vault section"
          value={tab}
          onChange={(event) => setTab(event.target.value as Tab)}
        >
          {visibleTabs.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <div>
          {visibleTabs.map(([id, label]) => (
            <button
              key={id}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
      <main className="bv-main">
        {actionError && (
          <div className="bv-callout bv-callout--bad" role="alert">
            <CircleAlert size={16} />
            {actionError}
          </div>
        )}
        {tab === "overview" && (
          <div className="bv-overview">
            <section className="bv-pulse">
              <div className="bv-pulse__lead">
                <span className="bv-pulse__mark">
                  <CalendarClock size={22} />
                </span>
                <div>
                  <span className="bv-eyebrow">Business Continuity Pulse</span>
                  <h2>
                    {active.length
                      ? "Your current evidence is ready for review."
                      : "Your business core needs its first source."}
                  </h2>
                  <p>
                    {active.length
                      ? `${pulse.dueSoon} obligations are due soon. ${vault.snapshot?.awaitingReview || 0} records await review.`
                      : "Add a real business record to begin grounding continuity. No readiness claim is available yet."}
                  </p>
                </div>
              </div>
              <div className="bv-pulse__stats">
                <button onClick={() => setTab("obligations")}>
                  <strong>{pulse.dueSoon}</strong>
                  <span>Due soon</span>
                </button>
                <button onClick={() => setTab("obligations")}>
                  <strong>{pulse.withoutOwner}</strong>
                  <span>Without owner</span>
                </button>
                <button onClick={() => setTab("intake")}>
                  <strong>{vault.snapshot?.awaitingReview || 0}</strong>
                  <span>Await review</span>
                </button>
                <button onClick={() => setTab("archive")}>
                  <strong>{pulse.unavailable}</strong>
                  <span>Unavailable</span>
                </button>
              </div>
            </section>
            <div className="bv-grid">
              <section className="bv-card">
                <header>
                  <h2>Upcoming obligations</h2>
                  <button onClick={() => setTab("obligations")}>
                    View all
                  </button>
                </header>
                {(vault.snapshot?.obligations || []).length ? (
                  (vault.snapshot?.obligations || [])
                    .slice(0, 4)
                    .map((item) => (
                      <div className="bv-row" key={item.id}>
                        <CalendarClock size={16} />
                        <span>
                          <strong>{item.title}</strong>
                          <small>
                            {item.dueAt
                              ? new Date(item.dueAt).toLocaleDateString()
                              : "Due date unavailable"}
                          </small>
                        </span>
                        <Status
                          tone={
                            item.sourceState === "current"
                              ? "neutral"
                              : "violet"
                          }
                        >
                          {item.state.replace(/_/g, " ")}
                        </Status>
                      </div>
                    ))
                ) : (
                  <Empty
                    icon={CalendarClock}
                    title="No obligations yet"
                    copy="Add an owner-entered obligation and connect a source when one exists."
                  />
                )}
              </section>
              <section className="bv-card">
                <header>
                  <h2>Evidence desk</h2>
                  <button onClick={() => setTab("library")}>
                    Open library
                  </button>
                </header>
                {active.length ? (
                  active.slice(0, 4).map((record) => (
                    <button
                      className="bv-row bv-row--button"
                      key={record.id}
                      onClick={() => setSelected(record)}
                    >
                      <FileCheck2 size={16} />
                      <span>
                        <strong>{record.title}</strong>
                        <small>
                          {record.originalFilename || "Owner-entered record"}
                        </small>
                      </span>
                      <Status
                        tone={
                          record.handlingMode === "store_only"
                            ? "neutral"
                            : "violet"
                        }
                      >
                        {record.handlingMode.replace(/_/g, " ")}
                      </Status>
                    </button>
                  ))
                ) : (
                  <Empty
                    title="No evidence stored"
                    copy="Binary upload is unavailable until mandatory OCR and sensitive-content inspection are configured. Owner-entered obligations remain available."
                    action={
                      <button
                        className="bv-button bv-button--gold"
                        disabled={!vault.uploadAvailable}
                        title={!vault.uploadAvailable ? "Binary upload is unavailable until mandatory inspection is configured" : undefined}
                        onClick={() => setUploadOpen(true)}
                      >
                        Add first record
                      </button>
                    }
                  />
                )}
              </section>
            </div>
            <div className="bv-grid">
              <section className="bv-card">
                <header>
                  <h2>Mission dependencies</h2>
                </header>
                <Empty
                  icon={FolderKanban}
                  title="No sourced dependency available"
                  copy="Business Game Plan integration is not enabled in this Phase 2 slice."
                />
              </section>
              <section className="bv-card">
                <header>
                  <h2>Safe connection references</h2>
                </header>
                <Empty
                  icon={Link2}
                  title="Provider references unavailable"
                  copy="Connections and credentials remain in their owning systems. No provider access is claimed."
                />
              </section>
            </div>
          </div>
        )}
        {["library", "business_core", "archive"].includes(tab) && (
          <section className="bv-card bv-records">
            <header>
              <div>
                <h2>{TABS.find((item) => item[0] === tab)?.[1]}</h2>
                <p>
                  {tab === "archive"
                    ? "Historical sources and retired context."
                    : "Source records with explicit handling and access state."}
                </p>
              </div>
              {tab !== "archive" && (
                <button
                  className="bv-button bv-button--gold"
                  disabled={!vault.uploadAvailable}
                  title={!vault.uploadAvailable ? "Binary upload is unavailable until mandatory inspection is configured" : undefined}
                  onClick={() => setUploadOpen(true)}
                >
                  <Plus size={16} />
                  Add record {!vault.uploadAvailable && <Status tone="violet">Unavailable</Status>}
                </button>
              )}
            </header>
            {filtered.length ? (
              filtered.map((record) => (
                <button
                  className="bv-record"
                  key={record.id}
                  onClick={() => setSelected(record)}
                >
                  <span className="bv-record__icon">
                    <FileText size={18} />
                  </span>
                  <span>
                    <strong>{record.title}</strong>
                    <small>
                      {record.recordType} ·{" "}
                      {record.originalFilename || "Owner entry"}
                    </small>
                  </span>
                  <Status
                    tone={record.sourceState === "current" ? "good" : "violet"}
                  >
                    {record.sourceState}
                  </Status>
                  <Status>{record.handlingMode.replace(/_/g, " ")}</Status>
                </button>
              ))
            ) : (
              <Empty
                title={
                  tab === "archive"
                    ? "Archive is empty"
                    : "No records in this section"
                }
                copy={
                  tab === "archive"
                    ? "Archived sources appear here with their lineage intact."
                    : "Add a source manually. Nothing is inferred until an actual record exists."
                }
              />
            )}
          </section>
        )}
        {tab === "contracts" && (
          <section className="bv-card bv-records">
            <header>
              <div>
                <h2>Contracts</h2>
                <p>
                  Contract metadata remains visibly owner-entered; no legal
                  analysis is performed.
                </p>
              </div>
              <div className="bv-head__actions">
                <button
                  className="bv-button"
                  disabled={!vault.uploadAvailable}
                  title={!vault.uploadAvailable ? "Binary upload is unavailable until mandatory inspection is configured" : undefined}
                  onClick={() => setUploadOpen(true)}
                >
                  <UploadCloud size={16} />
                  Add source {!vault.uploadAvailable && <Status tone="violet">Unavailable</Status>}
                </button>
                <button
                  className="bv-button bv-button--gold"
                  onClick={() => setMetadata({ kind: "contract" })}
                >
                  <Plus size={16} />
                  Add details
                </button>
              </div>
            </header>
            {(vault.snapshot?.contracts || []).length ? (
              (vault.snapshot?.contracts || []).map((contract) => (
                <div className="bv-record" key={contract.id}>
                  <span className="bv-record__icon">
                    <FileText size={18} />
                  </span>
                  <span>
                    <strong>{contract.contractType}</strong>
                    <small>
                      {contract.counterpartyName || "Counterparty not entered"}{" "}
                      · {contract.renewalDate || "Renewal unavailable"}
                    </small>
                  </span>
                  <Status>{contract.reviewState.replace(/_/g, " ")}</Status>
                  <Status
                    tone={
                      ["renewing", "expiring"].includes(contract.state)
                        ? "gold"
                        : "neutral"
                    }
                  >
                    {contract.state}
                  </Status>
                  <span className="bv-record__actions">
                    <button
                      className="bv-button"
                      onClick={() => setMetadata({ kind: "contract", initial: contract })}
                    >
                      Edit
                    </button>
                    <button
                      className="bv-button bv-button--danger"
                      disabled={!vault.canArchive}
                      onClick={async () => {
                        if (!window.confirm("Archive these contract details? The source record remains retained.")) return;
                        setActionError(null);
                        try {
                          await vault.saveContract({
                            id: contract.id,
                            recordId: contract.recordId,
                            contractType: contract.contractType,
                            counterpartyName: contract.counterpartyName || "",
                            effectiveDate: contract.effectiveDate || "",
                            endDate: contract.endDate || "",
                            renewalDate: contract.renewalDate || "",
                            noticeDays: contract.noticeDays ?? "",
                            paymentTerms: contract.paymentTerms || "",
                            state: "archived",
                          });
                        } catch {
                          setActionError("The contract was not archived. No state was changed.");
                        }
                      }}
                    >
                      Archive
                    </button>
                  </span>
                </div>
              ))
            ) : (
              <Empty
                title="No contract records"
                copy="Upload a contract source first. Dates, terms, parties, and obligations are never fabricated."
              />
            )}
          </section>
        )}
        {tab === "obligations" && (
          <section className="bv-card bv-records">
            <header>
              <div>
                <h2>Obligations</h2>
                <p>
                  Durable owner-entered duties with explicit source and timing
                  state.
                </p>
              </div>
              <button
                className="bv-button bv-button--gold"
                onClick={() => setMetadata({ kind: "obligation" })}
              >
                <Plus size={16} />
                Add obligation
              </button>
            </header>
            {(vault.snapshot?.obligations || []).length ? (
              (vault.snapshot?.obligations || []).map((item) => (
                <div className="bv-record" key={item.id}>
                  <span className="bv-record__icon">
                    <CalendarClock size={18} />
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.category} ·{" "}
                      {item.dueAt
                        ? new Date(item.dueAt).toLocaleString()
                        : "Due date unavailable"}
                    </small>
                  </span>
                  <Status
                    tone={item.sourceState === "current" ? "good" : "violet"}
                  >
                    {item.sourceState}
                  </Status>
                  <Status tone={item.state === "overdue" ? "bad" : "neutral"}>
                    {item.state.replace(/_/g, " ")}
                  </Status>
                  <span className="bv-record__actions">
                    <button
                      className="bv-button"
                      onClick={() => setMetadata({ kind: "obligation", initial: item })}
                    >
                      Edit
                    </button>
                    <button
                      className="bv-button bv-button--danger"
                      disabled={!vault.canArchive}
                      onClick={async () => {
                        if (!window.confirm("Retire this obligation? It will leave the active timeline.")) return;
                        setActionError(null);
                        try {
                          await vault.saveObligation({
                            id: item.id,
                            sourceRecordId: item.sourceRecordId || "",
                            contractId: item.contractId || "",
                            category: item.category,
                            title: item.title,
                            dueAt: item.dueAt || "",
                            cadence: item.cadence || "",
                            timezone: item.timezone || "",
                            noticeDays: item.noticeDays ?? "",
                            state: "retired",
                            nextAction: item.nextAction || "",
                          });
                        } catch {
                          setActionError("The obligation was not retired. No state was changed.");
                        }
                      }}
                    >
                      Retire
                    </button>
                  </span>
                </div>
              ))
            ) : (
              <Empty
                icon={CalendarClock}
                title="No obligations recorded"
                copy="Nothing is due, renewed, completed, or compliant merely because this screen exists."
              />
            )}
          </section>
        )}
        {tab === "relationships" && (
          <section className="bv-card">
            <header>
              <h2>Relationships</h2>
              <Status tone="violet">Partial</Status>
            </header>
            <Empty
              icon={Link2}
              title="Canonical relationship linking is not yet available"
              copy="Vault will reference People and Client Engagement ownership; it will not create a shadow CRM. Existing relationship tables are not queried directly from the browser."
            />
          </section>
        )}
        {tab === "intake" && (
          <section className="bv-card">
            <header>
              <h2>Intake & Review</h2>
              <Status tone="violet">Interpretation unavailable</Status>
            </header>
            <Empty
              icon={Sparkles}
              title="No proposed classifications"
              copy="Binary intake is unavailable until mandatory inspection is configured. Paige classification, extraction, and automatic promotion are not enabled."
            />
          </section>
        )}
        {tab === "security" && (
          <div className="bv-grid">
            <section className="bv-card">
              <header>
                <h2>Access boundary</h2>
                <Status tone="good">Admin verified</Status>
              </header>
              <p className="bv-copy">
                Every read and mutation resolves the authenticated user’s active
                tenant on the server. Client-supplied tenant IDs and roles are
                not accepted.
              </p>
            </section>
            <section className="bv-card">
              <header>
                <h2>Storage posture</h2>
                <Status tone="violet">Proof owed</Status>
              </header>
              <p className="bv-copy">
                Private quarantine and ready-only attachment retrieval are
                defined. No inspection adapter is configured, so binary upload
                remains unavailable and no file can enter normal Vault access.
              </p>
            </section>
            <section className="bv-card">
              <header>
                <h2>Credentials</h2>
                <Status tone="violet">Unavailable</Status>
              </header>
              <p className="bv-copy">
                Passwords, API keys, recovery codes, cookies, provider tokens,
                and banking secrets are prohibited in ordinary Vault records.
              </p>
            </section>
            <section className="bv-card">
              <header>
                <h2>Client access</h2>
                <Status tone="violet">Unavailable</Status>
              </header>
              <p className="bv-copy">
                Clients have no direct Vault access. Client Portal artifact
                publishing is outside Phase 2.
              </p>
            </section>
          </div>
        )}
        {tab === "connected_accounts" && secureBrowserEnabled && <SecureBrowserConnectedAccounts />}
      </main>
      {uploadOpen && (
        <UploadDialog
          replaceRecord={replaceRecord}
          onClose={() => {
            setUploadOpen(false);
            setReplaceRecord(null);
          }}
          onUpload={vault.upload}
          canUseOwnerOnly={vault.canArchive}
        />
      )}
      {metadata && (
        <MetadataDialog
          kind={metadata.kind}
          initial={metadata.initial}
          records={active}
          onClose={() => setMetadata(null)}
          onSave={
            metadata.kind === "contract"
              ? vault.saveContract
              : vault.saveObligation
          }
        />
      )}
      {selected && (
        <RecordDrawer
          record={selected}
          facts={(vault.snapshot?.facts || []).filter(
            (fact) => fact.recordId === selected.id,
          )}
          canArchive={vault.canArchive}
          canUpload={vault.uploadAvailable}
          onClose={() => setSelected(null)}
          onReplace={() => {
            setReplaceRecord(selected);
            setSelected(null);
            setUploadOpen(true);
          }}
          onProposeFact={vault.proposeFact}
          onReviewFact={vault.reviewFact}
          onArchive={async () => {
            if (!window.confirm("Archive this record? Its source is retained, and proposed or approved facts will no longer be current.")) return;
            await vault.archiveRecord(selected.id);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

export function VaultView({ openPaige }: { openPaige?: () => void }) {
  const { activeTenantId } = useTenantContext();
  return (
    <VaultWorkspace
      key={activeTenantId || "no-active-workspace"}
      openPaige={openPaige}
    />
  );
}

export function VaultTile() {
  return (
    <section className="bv-card">
      <header>
        <h2>Business Vault</h2>
        <Status tone="violet">Admin only</Status>
      </header>
      <p className="bv-copy">
        Open Settings → Vault for governed business evidence and continuity.
      </p>
    </section>
  );
}
