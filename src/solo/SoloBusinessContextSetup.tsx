import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  CheckCircle2,
  Mail,
  MessageSquareText,
  Mic,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useConfirm } from "@/hooks/useConfirm";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { registerAccountSwitchGuard } from "@/lib/auth/accountSwitchGuard";
import { useSoloBusinessContext } from "./data/useSoloBusinessContext";
import {
  cleanSoloBusinessOwners,
  applySetupProposal,
  prepareOwnerConfirmedBrief,
  setupSourceLabel,
  validateSoloBusinessOwners,
  validateSoloSetupBrief,
  type SetupSourceDecision,
  type SetupFactProvenance,
  type SoloBusinessOwner,
  type SoloSetupBrief,
  type SoloSetupTextField,
} from "./settings-setup-contract";
import {
  EMPTY_PAIGE_PROFILE,
  SOLO_PAIGE_PROFILE_FIELDS,
  SOLO_SETUP_TABS,
  SOLO_SETUP_TAB_LABELS,
  validateKnowledgeSource,
  validateManagedEmailLocalPart,
  type SetupKnowledgeSource,
  type SetupVoiceExample,
  type SoloPaigeProfile,
  type SoloPaigeProfileField,
  type SoloSetupTab,
} from "./settings-business-context-contract";
import "./settings-setup.css";
import { RepresentativePhonePicker } from "./setup-representative-phone";
import { resolveSetupSubtabRoute, setupSubtabPath } from "./setup-subtab-route";
import { settingsScrollOwner } from "./settings-scroll-owner";
import { PeopleEmailPreferences } from "./settings-people-email-preferences";
import { SettingsPublicPresence } from "./settings-public-presence";
import {
  ADDRESS_AUTOCOMPLETE,
  COUNTRY_OPTIONS,
  ENTITY_TYPE_OPTIONS,
  REGISTRATION_IDENTIFIER_OPTIONS,
  REPRESENTATIVE_POSITION_OPTIONS,
  US_STATE_OPTIONS,
  lookupUsZip,
  type AddressOption,
  type ZipPlace,
} from "./setup-address-options";

type EditableField = SoloSetupTextField | "businessRegistrationNumber";

type RouteDraftSnapshot = {
  changes: Partial<Record<EditableField, string>>;
  email: string;
};
type RouteSnapshotProps = {
  route: string;
  tenant: string | null;
  capture: () => RouteDraftSnapshot | null;
  apply: (snapshot: RouteDraftSnapshot) => void;
  children: ReactNode;
};
/** React's before-mutation lifecycle captures outgoing native autofill even when
 * BrowserRouter commits synchronously before a later popstate listener can run.
 * Only this mounted tenant draft is retained; nothing is written to browser storage. */
class SetupRouteSnapshot extends Component<
  RouteSnapshotProps,
  Record<string, never>,
  RouteDraftSnapshot | null
> {
  getSnapshotBeforeUpdate(previous: RouteSnapshotProps) {
    return previous.tenant === this.props.tenant &&
      previous.route !== this.props.route
      ? this.props.capture()
      : null;
  }
  componentDidUpdate(
    _previous: RouteSnapshotProps,
    _state: Record<string, never>,
    snapshot: RouteDraftSnapshot | null,
  ) {
    if (snapshot) this.props.apply(snapshot);
  }
  render() {
    return this.props.children;
  }
}
type Field = {
  key: EditableField;
  label: string;
  hint?: string;
  wide?: boolean;
  multiline?: boolean;
  options?: Array<string | AddressOption>;
};
const profileFields: Field[] = [
  { key: "legalName", label: "Legal business name" },
  { key: "publicName", label: "Public business name" },
  { key: "dbaName", label: "Doing business as" },
  { key: "industry", label: "Industry" },
  { key: "sicCode", label: "SIC code" },
  {
    key: "regionsOfOperation",
    label: "Regions of operation",
    hint: "USA_AND_CANADA, AFRICA, ASIA, EUROPE, or LATIN_AMERICA; separate regions with commas.",
  },
  { key: "website", label: "Business website" },
  { key: "phone", label: "Business phone" },
  {
    key: "entityType",
    label: "Entity type",
    options: [...ENTITY_TYPE_OPTIONS],
  },
  {
    key: "stateOfFormation",
    label: "Formation jurisdiction",
    hint: "State, province, territory, or country. Non-U.S. entities are supported.",
  },
  {
    key: "businessRegistrationIdentifier",
    label: "Registration identifier",
    options: [...REGISTRATION_IDENTIFIER_OPTIONS],
  },
  {
    key: "businessRegistrationNumber",
    label: "Tax or registration number",
    hint: "Stored in the protected Vault boundary and masked after save.",
  },
];
const addressFields: Field[] = [
  { key: "registeredStreet", label: "Street address" },
  { key: "registeredStreetSecondary", label: "Suite / address line 2" },
  { key: "registeredCity", label: "City" },
  { key: "registeredRegion", label: "State, province, territory, or region" },
  { key: "registeredPostalCode", label: "Postal code" },
  {
    key: "registeredIsoCountry",
    label: "Country",
    options: COUNTRY_OPTIONS,
  },
];
const directionFields: Field[] = [
  { key: "offers", label: "Offers and services", multiline: true },
  { key: "deliveryModel", label: "How work is delivered", multiline: true },
  { key: "idealCustomer", label: "Ideal customer", multiline: true },
  { key: "customerSegments", label: "Customer segments", multiline: true },
  { key: "serviceArea", label: "Geography and service area", multiline: true },
  { key: "currentPriority", label: "Current priority", multiline: true },
  { key: "goals90Day", label: "90-day goals", multiline: true },
  { key: "annualDirection", label: "Annual direction", multiline: true },
  { key: "successDefinition", label: "What success means", multiline: true },
  {
    key: "constraints",
    label: "Business constraints",
    multiline: true,
    wide: true,
  },
];
const ownerOnlyFields = new Set<EditableField>([
  ...profileFields.concat(addressFields).map((field) => field.key),
  "naicsCode",
  "address",
  "authorizedRepresentativePhone",
  "authorizedRepresentativeJobPosition",
]);
const representativePhoneField: Field = {
  key: "authorizedRepresentativePhone",
  label: "Representative phone",
  hint: "Include + and the country code.",
};
const representativeFields: Field[] = [
  {
    key: "authorizedRepresentativeJobPosition",
    label: "Representative position",
    options: [...REPRESENTATIVE_POSITION_OPTIONS],
  },
];
const legacyVoiceFields: Field[] = [
  { key: "brandVoice", label: "Existing brand voice", multiline: true },
  {
    key: "operatingPreferences",
    label: "Existing operating preferences",
    multiline: true,
  },
  {
    key: "doNotAssume",
    label: "Existing do-not-assume boundaries",
    multiline: true,
  },
];
const profileLabels: Record<
  SoloPaigeProfileField,
  { title: string; hint: string }
> = {
  voiceCharacter: {
    title: "Voice character",
    hint: "Tone, personality, energy, and how people should feel.",
  },
  audienceRelationship: {
    title: "Audience relationship",
    hint: "How the business relates to customers, clients, and partners.",
  },
  messageStructure: {
    title: "Message structure",
    hint: "How messages begin, build trust, and end with a next step.",
  },
  useMoreOften: {
    title: "Use more often",
    hint: "Preferred words, phrases, themes, and proof patterns.",
  },
  avoid: {
    title: "Avoid",
    hint: "Tones, claims, clichés, promises, and language that never fits.",
  },
  channelDifferences: {
    title: "Channel differences",
    hint: "How website, email, social, sales, and support should differ.",
  },
  workingStyleBoundaries: {
    title: "Working style & boundaries",
    hint: "How Paige should collaborate, handle uncertainty, and defer decisions.",
  },
};

function SourceBadge({
  source,
}: {
  source?: "owner_confirmed" | "connection_sourced" | "needs_confirmation";
}) {
  const value = source ?? "needs_confirmation";
  return (
    <span className="setup-source" data-source={value}>
      {setupSourceLabel(value)}
    </span>
  );
}
function ReadValue({ children }: { children?: string | null }) {
  return (
    <span
      className={
        children
          ? "setup-read-value"
          : "setup-read-value setup-read-value--empty"
      }
    >
      {children || "Not provided"}
    </span>
  );
}
function Section({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="setup-section">
      <header className="setup-section__head">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}
function Drawer({
  label,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  label: string;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const before = document.body.style.overflow;
    const opener = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    dialog.current
      ?.querySelector<HTMLElement>("button,input,textarea,select")
      ?.focus();
    return () => {
      document.body.style.overflow = before;
      if (opener?.isConnected) opener.focus();
      else
        queueMicrotask(() =>
          document
            .querySelector<HTMLElement>('.setup-tabs [aria-selected="true"]')
            ?.focus(),
        );
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('[role="alertdialog"]')) return;
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab" && dialog.current) {
        const nodes = Array.from(
          dialog.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]',
          ),
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !dialog.current.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !dialog.current.contains(document.activeElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return createPortal(
    <div
      className="setup-paige-drawer__backdrop"
      data-pg={resolvedTheme === "light" ? "light" : "dark"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="setup-paige-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <header className="setup-paige-drawer__head">
          <div>
            <span>Settings · Setup</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button
            type="button"
            aria-label="Close and return to Setup"
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </header>
        <button
          type="button"
          className="setup-paige-drawer__back"
          onClick={onClose}
        >
          ← Back to Setup
        </button>
        {children}
        {footer && (
          <footer className="setup-paige-drawer__footer">{footer}</footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Fields({
  fields,
  draft,
  editing,
  disabled,
  errors,
  onChange,
  sourceDecisions,
  onDecision,
}: {
  fields: Field[];
  draft: SoloSetupBrief;
  editing: boolean;
  disabled: (key: EditableField) => boolean;
  errors: Record<string, string | undefined>;
  onChange: (key: EditableField, value: string) => void;
  sourceDecisions: Partial<Record<SoloSetupTextField, SetupSourceDecision>>;
  onDecision: (key: SoloSetupTextField, value: SetupSourceDecision) => void;
}) {
  return (
    <div className="setup-fields">
      {fields.map((field) => {
        const locked = disabled(field.key);
        const source =
          field.key !== "businessRegistrationNumber"
            ? draft.provenance[field.key]?.source
            : undefined;
        const sourceLocked =
          source === "connection_sourced" &&
          sourceDecisions[field.key as SoloSetupTextField] !== "override";
        const displayOption = field.options?.find(
          (option) =>
            typeof option !== "string" && option.value === draft[field.key],
        );
        return (
          <div
            className={`setup-field${field.wide ? " setup-field--wide" : ""}`}
            key={field.key}
          >
            <div className="setup-field__label">
              <label htmlFor={`setup-${field.key}`}>{field.label}</label>
              <SourceBadge source={source} />
            </div>
            {editing && !locked ? (
              field.multiline ? (
                <textarea
                  id={`setup-${field.key}`}
                  name={field.key}
                  value={draft[field.key]}
                  disabled={sourceLocked}
                  onBlur={(e) => onChange(field.key, e.target.value)}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  aria-invalid={Boolean(errors[field.key])}
                />
              ) : field.options ? (
                <select
                  id={`setup-${field.key}`}
                  name={field.key}
                  value={draft[field.key]}
                  disabled={sourceLocked}
                  autoComplete={ADDRESS_AUTOCOMPLETE[field.key]}
                  onChange={(e) => onChange(field.key, e.target.value)}
                >
                  {!field.options.includes("") && (
                    <option value="">Choose</option>
                  )}
                  {Boolean(draft[field.key]) &&
                    !field.options.some(
                      (option) =>
                        (typeof option === "string" ? option : option.value) ===
                        draft[field.key],
                    ) && (
                      <option value={draft[field.key]}>
                        {draft[field.key] || "Choose"}
                      </option>
                    )}
                  {field.options.map((option) => (
                    <option
                      key={typeof option === "string" ? option : option.value}
                      value={typeof option === "string" ? option : option.value}
                    >
                      {(typeof option === "string" ? option : option.label) ||
                        "Choose"}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`setup-${field.key}`}
                  name={field.key}
                  type={
                    field.key === "businessRegistrationNumber"
                      ? "password"
                      : "text"
                  }
                  autoComplete={
                    field.key === "businessRegistrationNumber"
                      ? "off"
                      : ADDRESS_AUTOCOMPLETE[field.key]
                  }
                  value={draft[field.key]}
                  disabled={sourceLocked}
                  onBlur={(e) => onChange(field.key, e.target.value)}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  aria-invalid={Boolean(errors[field.key])}
                />
              )
            ) : (
              <ReadValue>
                {field.key === "businessRegistrationNumber"
                  ? draft.businessRegistrationNumberLast4
                    ? `Stored securely · ending in ${draft.businessRegistrationNumberLast4}`
                    : null
                  : displayOption && typeof displayOption !== "string"
                    ? displayOption.label
                    : draft[field.key]}
              </ReadValue>
            )}
            {editing && !locked && source === "connection_sourced" && (
              <div className="setup-source-actions">
                <span>
                  Keep the connected fact, adopt it, or explicitly override it.
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onDecision(field.key as SoloSetupTextField, "adopt")
                  }
                >
                  Adopt
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onDecision(field.key as SoloSetupTextField, "override")
                  }
                >
                  Override
                </button>
                {sourceDecisions[field.key as SoloSetupTextField] && (
                  <strong>
                    {sourceDecisions[field.key as SoloSetupTextField] ===
                    "adopt"
                      ? "Will adopt"
                      : "Override authorized"}
                  </strong>
                )}
              </div>
            )}
            {field.hint && <small>{field.hint}</small>}
            {errors[field.key] && (
              <small
                className="setup-field__error"
                id={`setup-${field.key}-error`}
              >
                {errors[field.key]}
              </small>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SoloBusinessContextSetup({ account, openPaige }: { account: string; openPaige?: () => void }) {
  const data = useSoloBusinessContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [inlineTab, setInlineTab] = useState<SoloSetupTab>("business-profile");
  const route = resolveSetupSubtabRoute(location.pathname, account);
  const urlDriven = route.kind !== "outside";
  const tab =
    route.kind === "tab"
      ? route.tab
      : urlDriven
        ? "business-profile"
        : inlineTab;
  const tabPath = (value: SoloSetupTab) =>
    setupSubtabPath(account, value) + location.search;
  const setTab = (value: SoloSetupTab) => {
    if (urlDriven) {
      if (location.pathname !== setupSubtabPath(account, value))
        navigate(tabPath(value), { state: location.state });
    } else setInlineTab(value);
  };
  useEffect(() => {
    if (route.kind === "index")
      navigate(setupSubtabPath(account, "business-profile") + location.search, {
        replace: true,
        state: location.state,
      });
  }, [route.kind, account, location.search, location.state, navigate]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.brief);
  const [owners, setOwners] = useState<SoloBusinessOwner[]>([]);
  const [email, setEmail] = useState("");
  const [emailDecision, setEmailDecision] =
    useState<SetupSourceDecision | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [drawerDirty, setDrawerDirty] = useState(false);
  const saveInFlight = useRef(false);
  const currentTenant = useRef(data.activeTenantId);
  currentTenant.current = data.activeTenantId;
  const errorSummary = useRef<HTMLDivElement>(null);
  const formSurface = useRef<HTMLFieldSetElement>(null);
  const [sources, setSources] = useState<SetupKnowledgeSource[]>([]);
  const [profile, setProfile] = useState<SoloPaigeProfile>(EMPTY_PAIGE_PROFILE);
  const [examples, setExamples] = useState<SetupVoiceExample[]>([]);
  const [decisions, setDecisions] = useState<
    Partial<Record<SoloSetupTextField, SetupSourceDecision>>
  >({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [notice, setNotice] = useState<{
    tone: "ok" | "bad";
    text: string;
  } | null>(null);
  const [recovery, setRecovery] = useState<
    "failed" | "conflict" | "stale" | null
  >(null);
  const [knowledgeEditor, setKnowledgeEditor] = useState<number | null>(null);
  const [emailEditor, setEmailEditor] = useState(false);
  const [paigeGuide, setPaigeGuide] = useState(false);
  const [exampleEditor, setExampleEditor] = useState<number | null>(null);
  const hasDrawer =
    knowledgeEditor !== null ||
    emailEditor ||
    paigeGuide ||
    exampleEditor !== null;
  const drawerOrigin = useRef<{
    pathname: string;
    search: string;
    state: unknown;
    tenant: string | null;
  } | null>(null);
  useLayoutEffect(() => {
    if (hasDrawer && !drawerOrigin.current) {
      drawerOrigin.current = {
        pathname: location.pathname,
        search: location.search,
        state: location.state,
        tenant: data.activeTenantId,
      };
    } else if (!hasDrawer && drawerOrigin.current) {
      const origin = drawerOrigin.current;
      drawerOrigin.current = null;
      // Sibling history may change the underlying area without abandoning the
      // modal draft. Explicitly closing/applying returns to its original area.
      if (
        origin.tenant === data.activeTenantId &&
        origin.pathname !== location.pathname &&
        resolveSetupSubtabRoute(location.pathname, account).kind === "tab"
      )
        navigate(origin.pathname + origin.search, { state: origin.state });
    }
  }, [
    hasDrawer,
    location.pathname,
    location.search,
    location.state,
    data.activeTenantId,
    account,
    navigate,
  ]);
  const priorTenant = useRef(data.activeTenantId);
  const persisted = useMemo(
    () =>
      JSON.stringify({
        brief: data.brief,
        owners: data.businessOwners,
        email: data.primaryBusinessEmail,
        sources: data.knowledgeSources,
        profile: data.paigeProfile,
        examples: data.voiceExamples,
      }),
    [
      data.brief,
      data.businessOwners,
      data.knowledgeSources,
      data.paigeProfile,
      data.primaryBusinessEmail,
      data.voiceExamples,
    ],
  );
  const dirty =
    (editing &&
      JSON.stringify({
        brief: draft,
        owners,
        email,
        sources,
        profile,
        examples,
      }) !== persisted) ||
    (editing && (Object.keys(decisions).length > 0 || Boolean(emailDecision)));
  useBeforeUnloadGuard(dirty || drawerDirty || data.saving);
  const reset = useCallback(() => {
    setDraft(data.brief);
    setOwners(cleanSoloBusinessOwners(data.businessOwners));
    setEmail(data.primaryBusinessEmail);
    setSources(data.knowledgeSources);
    setProfile(data.paigeProfile);
    setExamples(data.voiceExamples);
    setDecisions({});
    setErrors({});
    setEmailDecision(null);
    setProposalId(null);
  }, [
    data.brief,
    data.businessOwners,
    data.knowledgeSources,
    data.paigeProfile,
    data.primaryBusinessEmail,
    data.voiceExamples,
  ]);
  useEffect(() => {
    if (!editing) reset();
  }, [editing, reset]);
  useEffect(() => {
    if (priorTenant.current && priorTenant.current !== data.activeTenantId) {
      setEditing(false);
      setInlineTab("business-profile");
      setKnowledgeEditor(null);
      setEmailEditor(false);
      setPaigeGuide(false);
      setExampleEditor(null);
      setDrawerDirty(false);
      setRecovery(null);
      setNotice({
        tone: "bad",
        text: "The account changed. The prior workspace draft was discarded, and no stale result was applied.",
      });
    }
    priorTenant.current = data.activeTenantId;
  }, [data.activeTenantId]);
  useEffect(() => {
    if (!dirty && !drawerDirty && !data.saving) return;
    return registerAccountSwitchGuard(async ({ toTenantName }) => {
      if (data.saving) {
        setNotice({
          tone: "bad",
          text: "Wait for this durable save to finish before switching accounts.",
        });
        return false;
      }
      return confirm({
        title: "Discard Setup changes and switch accounts?",
        description: `Unsaved changes in this workspace will be discarded before opening ${toTenantName}.`,
        actionLabel: "Discard and switch",
        cancelLabel: "Stay here",
        destructive: true,
      });
    });
  }, [confirm, data.saving, dirty, drawerDirty]);
  useEffect(() => {
    if (!dirty && !drawerDirty && !data.saving) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, drawerDirty, data.saving]);
  useEffect(() => {
    if (!dirty && !drawerDirty && !data.saving) return;
    const leave = async (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
        "a[href]",
      );
      if (!link || link.target === "_blank" || link.hasAttribute("download"))
        return;
      const target = new URL(link.href, window.location.href);
      if (
        target.origin !== window.location.origin ||
        (target.pathname === window.location.pathname &&
          target.search === window.location.search)
      )
        return;
      // A sibling address keeps this exact Setup draft mounted. It is not an exit.
      const targetSetup = resolveSetupSubtabRoute(target.pathname, account);
      if (targetSetup.kind === "tab" || targetSetup.kind === "index") return;
      event.preventDefault();
      event.stopPropagation();
      if (data.saving) {
        setNotice({
          tone: "bad",
          text: "Wait for the durable write to finish before leaving Setup.",
        });
        return;
      }
      if (
        await confirm({
          title: "Discard changes and leave Setup?",
          description:
            "Unsaved Setup and drawer changes will be discarded. The durable record remains unchanged.",
          actionLabel: "Discard and leave",
          cancelLabel: "Keep working",
          destructive: true,
        })
      )
        navigate(target.pathname + target.search + target.hash);
    };
    document.addEventListener("click", leave, true);
    return () => document.removeEventListener("click", leave, true);
  }, [dirty, drawerDirty, data.saving, confirm, navigate, account]);
  const confirmDrawerDiscard = useCallback(
    () =>
      confirm({
        title: "Discard this unfinished draft?",
        description:
          "The saved context and the main Setup draft will remain unchanged.",
        actionLabel: "Discard draft",
        cancelLabel: "Keep working",
        destructive: true,
      }),
    [confirm],
  );
  const cancel = async () => {
    if (data.saving) return;
    const captured = captureMountedDraft();
    const hasAutofill =
      Object.keys(captured.changes).length > 0 || captured.email !== email;
    if (
      (dirty || hasAutofill) &&
      !(await confirm({
        title: "Discard unsaved Setup changes?",
        description: "The durable workspace record will remain unchanged.",
        actionLabel: "Discard changes",
        cancelLabel: "Keep editing",
        destructive: true,
      }))
    )
      return;
    reset();
    setEditing(false);
  };
  const change = (key: EditableField, value: string) => {
    if (data.saving || !editing) return;
    if (
      key !== "businessRegistrationNumber" &&
      draft.provenance[key]?.source === "connection_sourced" &&
      decisions[key] !== "override"
    )
      return;
    const captured = captureMountedDraft();
    setDraft((now) => ({ ...now, ...captured.changes, [key]: value }));
    setEmail(captured.email);
    setErrors((now) => ({ ...now, [key]: undefined }));
  };
  const beginEdit = () => {
    if (!data.canEdit || data.saving) return false;
    if (!editing) reset();
    else reconcileMountedDraft();
    setEditing(true);
    setNotice(null);
    return true;
  };
  const chooseNaics = async (value: string) => {
    if (data.accessScope !== "owner_full" || data.saving) return;
    const tenantAtStart = data.activeTenantId;
    const replacing =
      draft.provenance.naicsCode?.source === "connection_sourced";
    if (
      replacing &&
      !(await confirm({
        title: "Replace the connected industry code?",
        description:
          "This saves your chosen code as owner-confirmed business context. It does not change the provider record.",
        actionLabel: "Use selected code",
        cancelLabel: "Keep connected code",
      }))
    )
      return;
    if (currentTenant.current !== tenantAtStart || !beginEdit()) return;
    setDraft((now) => ({ ...now, naicsCode: value }));
    if (replacing) setDecisions((now) => ({ ...now, naicsCode: "override" }));
    setNotice({
      tone: "ok",
      text: `NAICS ${value} selected. Save business context to keep it.`,
    });
  };
  const decide = (key: SoloSetupTextField, value: SetupSourceDecision) => {
    if (data.saving || !editing) return;
    if (value === "adopt")
      setDraft((now) => ({ ...now, [key]: data.brief[key] }));
    setDecisions((now) => ({ ...now, [key]: value }));
  };
  function captureMountedDraft() {
    // Browsers can autofill a native control without dispatching React's change event.
    // Reconcile only mounted, enabled, explicitly authorized brief fields at commit.
    const submitted = { ...draft };
    const changes: Partial<Record<EditableField, string>> = {};
    const allowedFields = new Set<string>(
      [
        ...profileFields,
        ...addressFields,
        ...directionFields,
        representativePhoneField,
        ...representativeFields,
        ...legacyVoiceFields,
      ].map((field) => field.key),
    );
    allowedFields.add("naicsCode");
    formSurface.current
      ?.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("input[name],textarea[name],select[name]")
      .forEach((control) => {
        const key = control.name as EditableField;
        if (
          !allowedFields.has(key) ||
          control.disabled ||
          (data.accessScope !== "owner_full" && ownerOnlyFields.has(key))
        )
          return;
        if (
          key !== "businessRegistrationNumber" &&
          draft.provenance[key]?.source === "connection_sourced" &&
          decisions[key] !== "override"
        )
          return;
        if (submitted[key] !== control.value) changes[key] = control.value;
        submitted[key] = control.value;
      });
    const emailControl = formSurface.current?.querySelector<HTMLInputElement>(
      'input[name="primaryBusinessEmail"]',
    );
    return {
      brief: submitted,
      changes,
      email:
        data.accessScope === "owner_full" &&
        emailDecision === "override" &&
        emailControl &&
        !emailControl.disabled
          ? emailControl.value
          : email,
    };
  }
  function reconcileMountedDraft() {
    if (!editing || !data.canEdit || data.saving) return;
    const captured = captureMountedDraft();
    if (Object.keys(captured.changes).length)
      setDraft((now) => ({ ...now, ...captured.changes }));
    if (captured.email !== email) setEmail(captured.email);
  }
  const drawerOpen = useRef(false);
  drawerOpen.current =
    knowledgeEditor !== null ||
    emailEditor ||
    paigeGuide ||
    exampleEditor !== null;
  useLayoutEffect(() => {
    const surface = formSurface.current;
    const scrollOwner = settingsScrollOwner(surface);
    if (scrollOwner) scrollOwner.scrollTop = 0;
    if (!surface || drawerOpen.current) return;
    // Keyboard tab navigation owns its own focus; history/direct entry must not
    // leave focus on a control that disappeared with the previous area.
    if (
      document.activeElement === document.body ||
      !document.activeElement?.isConnected
    ) {
      surface
        .querySelector<HTMLElement>('[role="tabpanel"]')
        ?.focus({ preventScroll: true });
    }
  }, [location.pathname, tab, data.loading]);
  const switchTab = (value: SoloSetupTab) => {
    if (data.saving) return;
    reconcileMountedDraft();
    setTab(value);
  };
  const save = async () => {
    if (
      !editing ||
      !data.canEdit ||
      data.saving ||
      saveInFlight.current ||
      drawerDirty
    )
      return;
    const captured = captureMountedDraft();
    const submitted = captured.brief;
    setDraft(submitted);
    setEmail(captured.email);
    const tenantAtStart = data.activeTenantId;
    const fieldErrors = validateSoloSetupBrief(
      submitted,
      Boolean(data.brief.legalName.trim()),
    );
    const ownerErrors = data.canEditLegal
      ? validateSoloBusinessOwners(owners)
      : {};
    const allowedErrors =
      data.accessScope === "admin_operational"
        ? Object.fromEntries(
            Object.entries(fieldErrors).filter(([key]) =>
              [...directionFields, ...legacyVoiceFields].some(
                (field) => field.key === key,
              ),
            ),
          )
        : fieldErrors;
    if (Object.keys(allowedErrors).length || Object.keys(ownerErrors).length) {
      setErrors({ ...allowedErrors, ...ownerErrors });
      setNotice({
        tone: "bad",
        text: "Fix the highlighted business-context details before saving.",
      });
      setTab(
        Object.keys(ownerErrors).length ||
          fieldErrors.authorizedRepresentativeUserId
          ? "people-email"
          : Object.keys(allowedErrors).some((key) =>
                directionFields.some((field) => field.key === key),
              )
            ? "direction"
            : "business-profile",
      );
      queueMicrotask(() => errorSummary.current?.focus());
      return;
    }
    saveInFlight.current = true;
    const result = await data.save({
      brief: prepareOwnerConfirmedBrief(
        submitted,
        new Date().toISOString(),
        data.brief,
        decisions,
      ),
      businessOwners: owners,
      primaryBusinessEmail: captured.email,
      primaryBusinessEmailDecision: emailDecision,
      knowledgeSources: sources,
      paigeProfile: profile,
      voiceExamples: examples,
      proposalId,
    });
    saveInFlight.current = false;
    if (currentTenant.current !== tenantAtStart) return;
    if (result.ok === false) {
      setRecovery(result.kind);
      setNotice({ tone: "bad", text: result.error });
      return;
    }
    setEditing(false);
    setProposalId(null);
    setRecovery(null);
    setNotice({
      tone: "ok",
      text: "Saved and verified from the durable workspace record.",
    });
  };
  if (data.loading)
    return (
      <div className="setup-state">
        <RefreshCw aria-hidden />
        Loading this workspace’s business context…
      </div>
    );
  if (data.error)
    return (
      <div className="setup-state setup-state--error" role="alert">
        <span>
          <strong>Setup could not load safely.</strong>
          {data.error}
        </span>
        <button className="setup-button" onClick={data.refresh}>
          Retry
        </button>
      </div>
    );
  const owner = data.accessScope === "owner_full";
  const disabled = (key: EditableField) =>
    data.saving ||
    !editing ||
    (data.accessScope === "admin_operational" && ownerOnlyFields.has(key));
  return (
    <SetupRouteSnapshot
      route={`${location.pathname}:${tab}`}
      tenant={data.activeTenantId}
      capture={() =>
        editing && data.canEdit && !data.saving ? captureMountedDraft() : null
      }
      apply={(snapshot) => {
        if (Object.keys(snapshot.changes).length)
          setDraft((now) => ({ ...now, ...snapshot.changes }));
        if (snapshot.email !== email) setEmail(snapshot.email);
      }}
    >
      <fieldset
        ref={formSurface}
        className="setup-brief"
        onInput={reconcileMountedDraft}
        onClickCapture={reconcileMountedDraft}
        disabled={data.saving}
        aria-busy={data.saving}
        style={{ border: 0, padding: "0 0 32px", margin: 0, minWidth: 0 }}
      >
        {!data.canEdit && (
          <div className="setup-notice" data-tone="bad">
            This workspace is read-only for Setup. Owner access is required for
            legal, ownership, email, knowledge, and Paige voice context.
          </div>
        )}
        {data.accessScope === "admin_operational" && (
          <div className="setup-notice">
            Admin editing is limited to the non-legal operating direction
            supported by current policy.
          </div>
        )}
        {notice && (
          <div
            ref={errorSummary}
            tabIndex={-1}
            className="setup-notice"
            data-tone={notice.tone}
            role={notice.tone === "bad" ? "alert" : "status"}
          >
            <CheckCircle2 aria-hidden />
            {notice.text}
            {recovery === "failed" && (
              <button className="setup-button" onClick={() => void save()}>
                Retry save
              </button>
            )}
            {recovery && recovery !== "failed" && (
              <button
                className="setup-button"
                onClick={async () => {
                  if (data.saving) return;
                  if (
                    dirty &&
                    !(await confirm({
                      title: "Load stored version and discard this draft?",
                      description:
                        "The newer durable record will replace your unsaved draft.",
                      actionLabel: "Load stored version",
                      cancelLabel: "Keep my draft",
                      destructive: true,
                    }))
                  )
                    return;
                  setEditing(false);
                  setRecovery(null);
                  setNotice(null);
                  data.refresh();
                }}
              >
                Load stored version
              </button>
            )}
          </div>
        )}
        {data.pendingProposal && !proposalId && owner && (
          <aside className="setup-proposal">
            <div>
              <span>Paige suggestion · not saved</span>
              <h3>Review a proposed brief update</h3>
              <p>{data.pendingProposal.reason}</p>
            </div>
            <div>
              <button
                className="setup-button"
                onClick={async () => {
                  const result = await data.dismissProposal(
                    data.pendingProposal!.id,
                  );
                  setNotice(
                    result.ok
                      ? {
                          tone: "ok",
                          text: "Suggestion dismissed. Business context is unchanged.",
                        }
                      : {
                          tone: "bad",
                          text:
                            result.error ||
                            "The suggestion could not be dismissed.",
                        },
                  );
                }}
              >
                Dismiss
              </button>
              <button
                className="setup-button"
                onClick={async () => {
                  if (
                    dirty &&
                    !(await confirm({
                      title: "Replace your unsaved draft with this suggestion?",
                      description:
                        "Your saved record is unchanged until you review and save.",
                      actionLabel: "Review suggestion",
                      cancelLabel: "Keep draft",
                    }))
                  )
                    return;
                  reset();
                  setDraft(
                    applySetupProposal(data.brief, data.pendingProposal!),
                  );
                  setProposalId(data.pendingProposal!.id);
                  setEditing(true);
                }}
              >
                Review in draft
              </button>
            </div>
          </aside>
        )}
        <div className="setup-source-legend">
          <SourceBadge source="owner_confirmed" />
          <span>saved by an authorized owner</span>
          <SourceBadge source="connection_sourced" />
          <span>read from a connected record</span>
          <SourceBadge />
          <span>missing or awaiting confirmation</span>
        </div>
        <div
          className="setup-tabs"
          role="tablist"
          aria-label="Setup business context"
        >
          {SOLO_SETUP_TABS.map((value) => (
            <Link
              key={value}
              to={
                urlDriven ? tabPath(value) : location.pathname + location.search
              }
              state={location.state}
              role="tab"
              aria-selected={route.kind !== "invalid" && tab === value}
              aria-current={
                route.kind !== "invalid" && tab === value ? "page" : undefined
              }
              aria-disabled={data.saving}
              aria-controls={`setup-panel-${value}`}
              id={`setup-tab-${value}`}
              tabIndex={tab === value ? 0 : -1}
              onClick={(event) => {
                if (data.saving) {
                  event.preventDefault();
                  return;
                }
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                switchTab(value);
              }}
              onAuxClick={(event) => {
                if (data.saving) event.preventDefault();
              }}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const index = SOLO_SETUP_TABS.indexOf(value);
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? SOLO_SETUP_TABS.length - 1
                      : (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          SOLO_SETUP_TABS.length) %
                        SOLO_SETUP_TABS.length;
                switchTab(SOLO_SETUP_TABS[next]);
                queueMicrotask(() =>
                  document
                    .getElementById(`setup-tab-${SOLO_SETUP_TABS[next]}`)
                    ?.focus(),
                );
              }}
            >
              {SOLO_SETUP_TAB_LABELS[value]}
            </Link>
          ))}
        </div>
        {(tab !== "public-presence" || editing) && (
          <div className="setup-context-actions" aria-label="Business context actions">
            <span>
              {editing
                ? "Business context draft open"
                : "Business Profile is the edit home for approved facts"}
            </span>
            <div>
              {editing && (
                <button
                  className="setup-button"
                  disabled={data.saving}
                  onClick={() => void cancel()}
                >
                  Cancel
                </button>
              )}
              <button
                className="setup-button setup-button--primary"
                disabled={!data.canEdit || data.saving}
                onClick={editing ? () => void save() : () => void beginEdit()}
              >
                {data.saving
                  ? "Saving durable record…"
                  : editing
                    ? "Save business context"
                    : "Edit business context"}
              </button>
            </div>
          </div>
        )}
        {route.kind === "invalid" ? (
          <section className="setup-state" role="alert">
            <h3>Setup area not found</h3>
            <p>
              Choose a Setup area above to continue. Your unsaved business
              context has not been discarded.
            </p>
          </section>
        ) : (
          <div
            role="tabpanel"
            tabIndex={-1}
            id={`setup-panel-${tab}`}
            aria-labelledby={`setup-tab-${tab}`}
          >
            {tab === "business-profile" && (
              <BusinessProfile
                key={data.activeTenantId}
                draft={draft}
                email={email}
                editing={editing}
                owner={owner}
                disabled={disabled}
                errors={errors}
                decisions={decisions}
                onChange={change}
                onDecision={decide}
                onEmail={(value) => {
                  reconcileMountedDraft();
                  setEmail(value);
                }}
                emailDecision={emailDecision}
                emailProvenance={data.primaryBusinessEmailProvenance}
                onEmailDecision={(value) => {
                  if (value === "adopt") setEmail(data.primaryBusinessEmail);
                  setEmailDecision(value);
                }}
                onNaics={(value) => void chooseNaics(value)}
                searchNaics={data.searchNaics}
              />
            )}{" "}
            {tab === "public-presence" && (
              <SettingsPublicPresence
                brief={data.brief}
                activeTenantId={data.activeTenantId}
                primaryBusinessEmail={data.primaryBusinessEmail}
                primaryBusinessEmailProvenance={
                  data.primaryBusinessEmailProvenance
                }
                onReviewBusinessProfile={() => switchTab("business-profile")}
                onOpenPaige={openPaige}
              />
            )}{" "}
            {tab === "people-email" && (
              <>
              <PeopleEmail
                account={account}
                draft={draft}
                owners={owners}
                editing={editing}
                owner={owner}
                errors={errors}
                representativeError={data.representativesError}
                storedOwners={data.businessOwners}
                fields={
                  <>
                    {editing && !disabled("authorizedRepresentativePhone") ? (
                      <RepresentativePhonePicker
                        account={account}
                        userId={draft.authorizedRepresentativeUserId}
                        personName={
                          data.representatives.find(
                            (person) =>
                              person.id === draft.authorizedRepresentativeUserId,
                          )?.name ?? null
                        }
                        value={draft.authorizedRepresentativePhone}
                        onChange={(next) =>
                          change("authorizedRepresentativePhone", next)
                        }
                        locked={
                          draft.provenance.authorizedRepresentativePhone
                            ?.source === "connection_sourced" &&
                          decisions.authorizedRepresentativePhone !== "override"
                        }
                        error={errors.authorizedRepresentativePhone}
                      />
                    ) : (
                      <Fields
                        fields={[representativePhoneField]}
                        draft={draft}
                        editing={editing}
                        disabled={disabled}
                        errors={errors}
                        onChange={change}
                        sourceDecisions={decisions}
                        onDecision={decide}
                      />
                    )}
                    <Fields
                      fields={representativeFields}
                      draft={draft}
                      editing={editing}
                      disabled={disabled}
                      errors={errors}
                      onChange={change}
                      sourceDecisions={decisions}
                      onDecision={decide}
                    />
                  </>
                }
                representatives={data.representatives}
                managedEmail={data.managedEmail?.address ?? ""}
                registrationAvailable={
                  data.managedEmail?.registrationAvailable === true
                }
                onDraft={setDraft}
                onOwners={setOwners}
                onOpenEmail={() => setEmailEditor(true)}
              />
              <div className="mt-6">
                <PeopleEmailPreferences />
              </div>
              </>
            )}{" "}
            {tab === "knowledge-bucket" && (
              <KnowledgeBucket
                sources={sources}
                owner={owner}
                editing={editing}
                onAdd={() => {
                  if (beginEdit()) setKnowledgeEditor(sources.length);
                }}
                onEdit={(index) => {
                  if (beginEdit()) setKnowledgeEditor(index);
                }}
                onRemove={(index) =>
                  setSources((now) => now.filter((_, i) => i !== index))
                }
              />
            )}{" "}
            {tab === "direction" && (
              <Section
                eyebrow="Direction and goals"
                title="What the business is working toward"
                description="Keep the offer model, customers, priorities, goals, success measures, and constraints as structured owner-confirmed context."
              >
                <Fields
                  fields={directionFields}
                  draft={draft}
                  editing={editing}
                  disabled={disabled}
                  errors={errors}
                  onChange={change}
                  sourceDecisions={decisions}
                  onDecision={decide}
                />
              </Section>
            )}{" "}
            {tab === "paige-brief" && (
              <>
                <PaigeContext
                  profile={profile}
                  examples={examples}
                  owner={owner}
                  editing={editing}
                  saving={data.saving}
                  onSave={() => void save()}
                  onCancel={() => void cancel()}
                  onKnowledge={() => switchTab("knowledge-bucket")}
                  onGuide={() => {
                    if (owner && beginEdit()) setPaigeGuide(true);
                  }}
                  onExample={() => {
                    if (owner && beginEdit()) setExampleEditor(examples.length);
                  }}
                  onEditExample={(index) => {
                    if (owner && beginEdit()) setExampleEditor(index);
                  }}
                  onRemoveExample={(index) =>
                    setExamples((now) => now.filter((_, i) => i !== index))
                  }
                />
                <Section
                  eyebrow="Existing operating context"
                  title="Preserved business brief"
                  description="Your previously saved voice and operating guidance stays editable. Review it while building the richer profile above; nothing is silently replaced."
                >
                  <Fields
                    fields={legacyVoiceFields}
                    draft={draft}
                    editing={editing}
                    disabled={disabled}
                    errors={errors}
                    onChange={change}
                    sourceDecisions={decisions}
                    onDecision={decide}
                  />
                </Section>
              </>
            )}
          </div>
        )}
        {knowledgeEditor !== null && (
          <KnowledgeEditor
            source={sources[knowledgeEditor] ?? newSource()}
            onDirtyChange={setDrawerDirty}
            confirmDiscard={confirmDrawerDiscard}
            onChange={(value) => {
              setSources((now) =>
                knowledgeEditor === now.length
                  ? [...now, value]
                  : now.map((item, index) =>
                      index === knowledgeEditor ? value : item,
                    ),
              );
              setNotice({
                tone: "ok",
                text: "Knowledge added to your draft. Save business context to keep it.",
              });
            }}
            onClose={() => {
              setKnowledgeEditor(null);
              setDrawerDirty(false);
            }}
          />
        )}{" "}
        {emailEditor && (
          <EmailEditor
            current={data.managedEmail?.localPart ?? ""}
            domain={data.managedEmail?.domain ?? "mail.paigeagent.ai"}
            check={data.checkManagedEmail}
            register={data.registerManagedEmail}
            onDirtyChange={setDrawerDirty}
            confirmDiscard={confirmDrawerDiscard}
            onClose={() => {
              setEmailEditor(false);
              setDrawerDirty(false);
            }}
          />
        )}{" "}
        {paigeGuide && (
          <PaigeGuide
            profile={profile}
            onDirtyChange={setDrawerDirty}
            confirmDiscard={confirmDrawerDiscard}
            onApply={(value) => {
              setProfile(value);
              setEditing(true);
              setPaigeGuide(false);
              setDrawerDirty(false);
              setNotice({
                tone: "ok",
                text: "Paige profile added to the Setup draft. Save business context to make it durable.",
              });
            }}
            onClose={() => {
              setPaigeGuide(false);
              setDrawerDirty(false);
            }}
          />
        )}{" "}
        {exampleEditor !== null && (
          <ExampleEditor
            value={examples[exampleEditor] ?? newExample()}
            existing={exampleEditor < examples.length}
            onDirtyChange={setDrawerDirty}
            confirmDiscard={confirmDrawerDiscard}
            onChange={(value) => {
              setExamples((now) =>
                exampleEditor === now.length
                  ? [...now, value]
                  : now.map((item, index) =>
                      index === exampleEditor ? value : item,
                    ),
              );
              setNotice({
                tone: "ok",
                text: "Example kept in your draft. Save business context to keep the changes.",
              });
            }}
            onClose={() => {
              setExampleEditor(null);
              setDrawerDirty(false);
            }}
          />
        )}{" "}
        {confirmDialog}
      </fieldset>
    </SetupRouteSnapshot>
  );
}

const newSource = (): SetupKnowledgeSource => ({
  id: "",
  sourceType: "link",
  title: "",
  category: "business",
  sourceUrl: "",
  reference: "",
  notes: "",
  reviewStatus: "needs_review",
  provenance: { source: "owner_confirmed", confidence: "confirmed" },
});
const newExample = (): SetupVoiceExample => ({
  id: "",
  channel: "general",
  kind: "sounds_like",
  example: "",
  note: "",
  provenance: { source: "owner_confirmed", confidence: "confirmed" },
});

function BusinessProfile({
  draft,
  email,
  editing,
  owner,
  disabled,
  errors,
  decisions,
  onChange,
  onDecision,
  onEmail,
  emailDecision,
  emailProvenance,
  onEmailDecision,
  onNaics,
  searchNaics,
}: {
  draft: SoloSetupBrief;
  email: string;
  editing: boolean;
  owner: boolean;
  disabled: (key: EditableField) => boolean;
  errors: Record<string, string | undefined>;
  decisions: Partial<Record<SoloSetupTextField, SetupSourceDecision>>;
  onChange: (key: EditableField, value: string) => void;
  onDecision: (key: SoloSetupTextField, value: SetupSourceDecision) => void;
  onEmail: (value: string) => void;
  emailDecision: SetupSourceDecision | null;
  emailProvenance?: SetupFactProvenance;
  onEmailDecision: (value: SetupSourceDecision) => void;
  onNaics: (value: string) => void;
  searchNaics: (
    query: string,
  ) => Promise<Array<{ code: string; title: string }>>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Array<{ code: string; title: string }>
  >([]);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const searchEpoch = useRef(0);
  useEffect(
    () => () => {
      searchEpoch.current += 1;
    },
    [],
  );
  const run = useCallback(async () => {
    clearTimeout(searchTimer.current);
    if (query.trim().length < 2) return;
    const epoch = ++searchEpoch.current;
    setSearching(true);
    setSearchError("");
    try {
      const found = await searchNaics(query);
      if (epoch === searchEpoch.current) {
        setResults(found);
        setSearched(true);
      }
    } catch (error) {
      if (epoch === searchEpoch.current)
        setSearchError(
          error instanceof Error ? error.message : "Search failed.",
        );
    } finally {
      if (epoch === searchEpoch.current) setSearching(false);
    }
  }, [query, searchNaics]);
  useEffect(() => {
    if (query.trim().length < 2) return;
    searchTimer.current = setTimeout(() => void run(), 350);
    return () => clearTimeout(searchTimer.current);
  }, [query, run]);
  return (
    <div className="setup-tab-stack">
      <Section
        eyebrow="Business identity"
        title="Business profile"
        description="One record for the business. Connections reuses these facts for carrier registration instead of asking again."
      >
        <div className="setup-boundary">
          <ShieldCheck aria-hidden />
          <div>
            <strong>Sensitive registration numbers stay sealed</strong>
            <span>
              The browser receives only a masked value. Tax identifiers, exact
              addresses, and private contact data do not enter PAIGE, Mind,
              Spine, or Rail.
            </span>
          </div>
        </div>
        <Fields
          fields={profileFields}
          draft={draft}
          editing={editing}
          disabled={disabled}
          errors={errors}
          onChange={onChange}
          sourceDecisions={decisions}
          onDecision={onDecision}
        />
        <div className="setup-field setup-field--wide">
          <div className="setup-field__label">
            <label htmlFor="setup-primary-email">Primary business email</label>
            <SourceBadge source={emailProvenance?.source} />
          </div>
          {editing && owner ? (
            <input
              id="setup-primary-email"
              name="primaryBusinessEmail"
              disabled={emailDecision !== "override"}
              value={email}
              type="email"
              onBlur={(e) => onEmail(e.target.value)}
              onChange={(e) => onEmail(e.target.value)}
            />
          ) : (
            <ReadValue>{email}</ReadValue>
          )}
          {editing && owner && (
            <div className="setup-source-actions">
              <span>
                Explicitly adopt the connected value or authorize an override.
              </span>
              <button onClick={() => onEmailDecision("adopt")}>
                Adopt email
              </button>
              <button onClick={() => onEmailDecision("override")}>
                Override email
              </button>
              {emailDecision && (
                <strong>
                  {emailDecision === "adopt"
                    ? "Will adopt on save"
                    : "Override authorized"}
                </strong>
              )}
            </div>
          )}
          <small>
            Editing here explicitly adopts or overrides the current connected
            contact value. Provider configuration remains in Connections.
          </small>
        </div>
      </Section>
      <Section
        eyebrow="Business address"
        title="Business address"
        description="Where your business is based."
      >
        {draft.address && (
          <div className="setup-boundary">
            <div>
              <strong>Previously saved address</strong>
              <span>{draft.address}</span>
              <small>
                Your earlier address is kept for reference. Review the fields
                below before saving.
              </small>
            </div>
          </div>
        )}
        <Fields
          fields={addressFields.map((field) =>
            field.key === "registeredRegion" &&
            draft.registeredIsoCountry.toUpperCase() === "US"
              ? { ...field, label: "State", options: US_STATE_OPTIONS }
              : field,
          )}
          draft={draft}
          editing={editing}
          disabled={disabled}
          errors={errors}
          onChange={onChange}
          sourceDecisions={decisions}
          onDecision={onDecision}
        />
        {editing && owner && (
          <ZipLookup
            draft={draft}
            onChange={onChange}
            disabled={
              disabled("registeredCity") ||
              disabled("registeredRegion") ||
              ["registeredCity", "registeredRegion"].some(
                (key) =>
                  draft.provenance[key as SoloSetupTextField]?.source ===
                    "connection_sourced" &&
                  decisions[key as SoloSetupTextField] !== "override",
              )
            }
          />
        )}
      </Section>
      <Section
        eyebrow="Industry reference"
        title="Find the official NAICS description"
        description="Search by code or business activity, then confirm the classification that fits this business."
      >
        <div className="setup-search">
          <input
            aria-label="Search NAICS by code or business activity"
            value={query}
            onChange={(e) => {
              searchEpoch.current += 1;
              setSearching(false);
              setResults([]);
              setSearchError("");
              setSearched(false);
              setQuery(e.target.value);
            }}
            placeholder="Try management consulting or 541611"
          />
          <button
            className="setup-button"
            onClick={() => void run()}
            disabled={query.trim().length < 2 || searching}
          >
            <Search aria-hidden />
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        <span role="status">
          {searching
            ? "Searching industry codes…"
            : searched && !results.length && !searchError
              ? "No matching codes. Try another business activity or code."
              : ""}
        </span>
        {searchError && (
          <div className="setup-notice" data-tone="bad">
            {searchError}
          </div>
        )}
        <div className="setup-result-list">
          {results.map((result) => (
            <button
              key={result.code}
              aria-pressed={draft.naicsCode === result.code}
              onClick={() => onNaics(result.code)}
              disabled={!owner}
            >
              <strong>{result.code}</strong>
              <span>{result.title}</span>
              {draft.naicsCode === result.code && <span>Selected</span>}
            </button>
          ))}
        </div>
        <div className="setup-field">
          <div className="setup-field__label">
            <label htmlFor="setup-naicsCode">Confirmed NAICS code</label>
            <SourceBadge source={draft.provenance.naicsCode?.source} />
          </div>
          {editing && owner ? (
            <input
              id="setup-naicsCode"
              name="naicsCode"
              value={draft.naicsCode}
              disabled={
                disabled("naicsCode") ||
                (draft.provenance.naicsCode?.source === "connection_sourced" &&
                  decisions.naicsCode !== "override")
              }
              onChange={(e) => onChange("naicsCode", e.target.value)}
            />
          ) : (
            <ReadValue>{draft.naicsCode}</ReadValue>
          )}
          <small>
            {editing &&
              owner &&
              draft.provenance.naicsCode?.source === "connection_sourced" && (
                <span className="setup-source-actions">
                  <button onClick={() => onDecision("naicsCode", "adopt")}>
                    Adopt NAICS
                  </button>
                  <button onClick={() => onDecision("naicsCode", "override")}>
                    Override NAICS
                  </button>
                  <span>
                    {decisions.naicsCode === "override"
                      ? "Override authorized"
                      : "Connected value is protected."}
                  </span>
                </span>
              )}
            {errors.naicsCode && <span role="alert">{errors.naicsCode}</span>}
            Reference assistance only; Setup does not provide legal
            classification advice.
          </small>
        </div>
      </Section>
    </div>
  );
}

function ZipLookup({
  draft,
  onChange,
  disabled,
}: {
  draft: SoloSetupBrief;
  onChange: (key: EditableField, value: string) => void;
  disabled: boolean;
}) {
  const [places, setPlaces] = useState<ZipPlace[]>([]);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const zip = draft.registeredPostalCode.trim();
  const country = draft.registeredIsoCountry.toUpperCase();
  useEffect(() => {
    setPlaces([]);
    setMessage("");
    if (country !== "US" || !/^\d{5}(?:-\d{4})?$/.test(zip)) return;
    let active = true;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    const timer = setTimeout(() => {
      setMessage("Finding city and state…");
      timeout = setTimeout(() => controller.abort(), 6000);
      void lookupUsZip(zip.slice(0, 5), controller.signal)
        .then((found) => {
          if (!active) return;
          setPlaces(found);
          setMessage(
            found.length
              ? "Choose your city and state, then save your address."
              : "No ZIP match found. You can enter your city and state manually.",
          );
        })
        .catch(() => {
          if (active)
            setMessage(
              "ZIP lookup is unavailable. Enter your city and state, or try again.",
            );
        })
        .finally(() => clearTimeout(timeout));
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [zip, country, retry]);
  if (country !== "US") return null;
  return (
    <div className="setup-zip-lookup">
      <small>
        Enter a ZIP code for city and state suggestions. Only the ZIP is sent to
        Zippopotam.us; suggestions are not address verification.
      </small>
      <p role="status">{message}</p>
      {places.map((place) => (
        <button
          type="button"
          className="setup-button"
          key={`${place.city}-${place.region}`}
          disabled={disabled}
          onClick={() => {
            onChange("registeredCity", place.city);
            onChange("registeredRegion", place.region);
            setMessage(
              "City and state added to your draft. Review and save your address.",
            );
          }}
        >
          Use {place.city}, {place.region}
        </button>
      ))}
      {places.length > 0 && disabled && (
        <small>
          Choose Override on the connected city or state before replacing it.
        </small>
      )}
      {message.includes("unavailable") && (
        <button
          type="button"
          className="setup-button"
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry ZIP lookup
        </button>
      )}
    </div>
  );
}

function PeopleEmail({
  account,
  draft,
  owners,
  editing,
  owner,
  representatives,
  managedEmail,
  registrationAvailable,
  onDraft,
  onOwners,
  onOpenEmail,
  errors,
  representativeError,
  fields,
  storedOwners,
}: {
  account: string;
  draft: SoloSetupBrief;
  owners: SoloBusinessOwner[];
  editing: boolean;
  owner: boolean;
  representatives: Array<{
    id: string;
    name: string;
    role: string;
    email: string;
    status: string;
  }>;
  managedEmail: string;
  registrationAvailable: boolean;
  onDraft: (value: SoloSetupBrief) => void;
  onOwners: (value: SoloBusinessOwner[]) => void;
  onOpenEmail: () => void;
  errors: Record<string, string | undefined>;
  representativeError: string | null;
  fields: ReactNode;
  storedOwners: SoloBusinessOwner[];
}) {
  return (
    <div className="setup-tab-stack">
      <Section
        eyebrow="People & email"
        title="Who represents this business"
        description="Business representation is Setup context. Team remains the source of truth for invitations, access, and roles."
      >
        <div className="setup-boundary">
          <Users aria-hidden />
          <div>
            <strong>Business facts do not grant platform access</strong>
            <span>
              Select only active Team people. Adding an owner or representative
              here never creates a member, invite, or role change.
            </span>
          </div>
        </div>
        {representativeError && (
          <div role="alert" className="setup-notice">
            The active Team roster could not be loaded. Representative changes
            are unavailable; stored selections remain unchanged.
          </div>
        )}
        <fieldset
          className="setup-people"
          disabled={Boolean(representativeError)}
        >
          <legend>Business representatives</legend>
          {representatives.map((person) => (
            <label key={person.id}>
              <input
                type="checkbox"
                value={person.id}
                disabled={!editing || !owner}
                checked={draft.representativeUserIds.includes(person.id)}
                onChange={(event) =>
                  onDraft({
                    ...draft,
                    authorizedRepresentativeUserId:
                      !event.target.checked &&
                      draft.authorizedRepresentativeUserId === person.id
                        ? ""
                        : draft.authorizedRepresentativeUserId,
                    representativeUserIds: event.target.checked
                      ? [
                          ...new Set([
                            ...draft.representativeUserIds,
                            person.id,
                          ]),
                        ]
                      : draft.representativeUserIds.filter(
                          (id) => id !== person.id,
                        ),
                  })
                }
              />
              <span>
                <strong>{person.name}</strong>
                <small>
                  {person.role} · {person.status} · {person.email}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="setup-field">
          <label htmlFor="setup-authorized-representative">
            A2P authorized representative
          </label>
          <SourceBadge
            source={draft.provenance.authorizedRepresentative?.source}
          />
          {editing && owner ? (
            <select
              name="authorizedRepresentativeUserId"
              id="setup-authorized-representative"
              disabled={Boolean(representativeError)}
              value={draft.authorizedRepresentativeUserId}
              onChange={(event) =>
                onDraft({
                  ...draft,
                  authorizedRepresentativeUserId: event.target.value,
                })
              }
            >
              <option value="">Choose a confirmed representative</option>
              {representatives
                .filter((person) =>
                  draft.representativeUserIds.includes(person.id),
                )
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.role}
                  </option>
                ))}
            </select>
          ) : (
            <ReadValue>
              {
                representatives.find(
                  (person) =>
                    person.id === draft.authorizedRepresentativeUserId,
                )?.name
              }
            </ReadValue>
          )}
          {errors.authorizedRepresentativeUserId && (
            <small role="alert">{errors.authorizedRepresentativeUserId}</small>
          )}
        </div>
        {fields}
        <Ownership
          errors={errors}
          storedOwners={storedOwners}
          representativesUnavailable={Boolean(representativeError)}
          owners={owners}
          editing={editing}
          owner={owner}
          representatives={representatives}
          onChange={onOwners}
        />
      </Section>
      <Section
        eyebrow="Business email"
        title="Addresses this workspace can use"
        description="Register the Paige-managed address here. Custom provider configuration remains in Connections."
      >
        <div className="setup-email-grid">
          <div>
            <Mail aria-hidden />
            <span>Platform-assigned sending email</span>
            <ReadValue>{managedEmail}</ReadValue>
            <SourceBadge source="connection_sourced" />
            {owner && (
              <button
                className="setup-button"
                disabled={!registrationAvailable}
                onClick={onOpenEmail}
              >
                Check or change address
              </button>
            )}
            {!registrationAvailable && (
              <small>
                Registration unavailable — sender lifecycle update required.
              </small>
            )}
          </div>
        </div>
        <div className="setup-handoff">
          <div>
            <strong>
              Connections owns custom email and provider configuration
            </strong>
            <span>
              Setup can register the Paige-managed local address; it does not
              duplicate provider setup.
            </span>
          </div>
          <Link
            to={`/solo/${account}/settings/connections?segment=communications`}
          >
            Open Connections →
          </Link>
        </div>
      </Section>
    </div>
  );
}

function Ownership({
  owners,
  editing,
  owner,
  representatives,
  onChange,
  errors,
  storedOwners,
  representativesUnavailable,
}: {
  owners: SoloBusinessOwner[];
  editing: boolean;
  owner: boolean;
  representatives: Array<{ id: string; name: string; role: string }>;
  onChange: (value: SoloBusinessOwner[]) => void;
  errors: Record<string, string | undefined>;
  storedOwners: SoloBusinessOwner[];
  representativesUnavailable: boolean;
}) {
  const update = (index: number, patch: Partial<SoloBusinessOwner>) =>
    onChange(
      owners.map((item, i) => {
        if (i !== index) return item;
        if (patch.sourceDecision === "adopt")
          return {
            ...(storedOwners.find(
              (stored) => stored.id && stored.id === item.id,
            ) ?? item),
            sourceDecision: "adopt",
          };
        if (
          Object.values(item.provenance ?? {}).some(
            (fact) => fact?.source === "connection_sourced",
          ) &&
          item.sourceDecision !== "override" &&
          !patch.sourceDecision
        )
          return item;
        return { ...item, ...patch };
      }),
    );
  return (
    <div className="setup-ownership">
      <div className="setup-ownership__head">
        <div>
          <h3>Business ownership</h3>
          <p>
            Owner-provided facts only. Percentages are not claimed to total 100%
            unless the records prove it.
          </p>
        </div>
        {editing && owner && (
          <button
            className="setup-button"
            onClick={() =>
              onChange([
                ...owners,
                {
                  id: "",
                  ownerKind: "individual",
                  legalName: "",
                  displayName: "",
                  ownershipInterest: "",
                  effectiveDate: "",
                  status: "active",
                  representativeUserId: "",
                },
              ])
            }
          >
            <Plus aria-hidden />
            Add business owner
          </button>
        )}
      </div>
      {owners.every((item) => item.deleteRequested) ? (
        <p className="setup-ownership__empty">
          No business ownership record has been confirmed.
        </p>
      ) : (
        owners.map((item, index) =>
          item.deleteRequested ? null : (
            <div className="setup-owner-card" key={item.id || index}>
              {editing && owner ? (
                <>
                  {Object.values(item.provenance ?? {}).some(
                    (fact) => fact?.source === "connection_sourced",
                  ) && (
                    <div className="setup-source-actions">
                      <span>
                        Connected ownership facts require an explicit decision.
                      </span>
                      <button
                        onClick={() =>
                          update(index, { sourceDecision: "adopt" })
                        }
                      >
                        Adopt owner record
                      </button>
                      <button
                        onClick={() =>
                          update(index, { sourceDecision: "override" })
                        }
                      >
                        Override owner record
                      </button>
                    </div>
                  )}
                  {Object.entries(errors)
                    .filter(
                      ([key, message]) =>
                        key.startsWith(`${index}.`) && message,
                    )
                    .map(([key, message]) => (
                      <p className="setup-field__error" role="alert" key={key}>
                        {message}
                      </p>
                    ))}
                  <label>
                    Owner type{" "}
                    <SourceBadge source={item.provenance?.ownerKind?.source} />
                    <select
                      value={item.ownerKind}
                      onChange={(e) =>
                        update(index, {
                          ownerKind: e.target
                            .value as SoloBusinessOwner["ownerKind"],
                        })
                      }
                    >
                      <option value="individual">Individual</option>
                      <option value="company">Corporation / company</option>
                      <option value="trust">Trust</option>
                      <option value="other_legal_person">
                        Other legal person
                      </option>
                    </select>
                  </label>
                  <label>
                    Legal name{" "}
                    <SourceBadge source={item.provenance?.legalName?.source} />
                    <input
                      value={item.legalName}
                      onChange={(e) =>
                        update(index, { legalName: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Display name{" "}
                    <SourceBadge
                      source={item.provenance?.displayName?.source}
                    />
                    <input
                      value={item.displayName}
                      onChange={(e) =>
                        update(index, { displayName: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Ownership interest %{" "}
                    <SourceBadge
                      source={item.provenance?.ownershipInterest?.source}
                    />
                    <input
                      inputMode="decimal"
                      value={item.ownershipInterest}
                      onChange={(e) =>
                        update(index, { ownershipInterest: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Effective date{" "}
                    <SourceBadge
                      source={item.provenance?.effectiveDate?.source}
                    />
                    <input
                      type="date"
                      value={item.effectiveDate}
                      onChange={(e) =>
                        update(index, { effectiveDate: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Ownership status
                    <SourceBadge source={item.provenance?.status?.source} />
                    <select
                      value={item.status}
                      onChange={(event) =>
                        update(index, {
                          status: event.target
                            .value as SoloBusinessOwner["status"],
                        })
                      }
                    >
                      <option value="active">Active</option>
                      <option value="former">Former</option>
                      <option value="pending">Pending</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label>
                    Designated human representative{" "}
                    <SourceBadge
                      source={item.provenance?.representativeUserId?.source}
                    />
                    <select
                      value={item.representativeUserId}
                      disabled={representativesUnavailable}
                      onChange={(e) =>
                        update(index, { representativeUserId: e.target.value })
                      }
                    >
                      <option value="">None selected</option>
                      {representatives.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name} · {person.role}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="setup-owner-card__remove"
                    onClick={() =>
                      onChange(
                        owners.flatMap((candidate, i) =>
                          i !== index
                            ? [candidate]
                            : Object.values(candidate.provenance ?? {}).some(
                                  (fact) =>
                                    fact?.source === "connection_sourced",
                                )
                              ? [
                                  {
                                    ...candidate,
                                    sourceDecision: "override" as const,
                                    deleteRequested: true,
                                  },
                                ]
                              : [],
                        ),
                      )
                    }
                  >
                    <Trash2 aria-hidden />
                    {Object.values(item.provenance ?? {}).some(
                      (fact) => fact?.source === "connection_sourced",
                    )
                      ? "Override and remove record"
                      : "Remove record"}
                  </button>
                </>
              ) : (
                <>
                  <strong>{item.displayName || item.legalName}</strong>
                  <span>
                    {item.ownerKind} ·{" "}
                    {item.ownershipInterest
                      ? `${item.ownershipInterest}% owner-provided interest`
                      : "interest not provided"}
                  </span>
                  <small>
                    Status: {item.status}
                    {item.effectiveDate
                      ? ` · Effective ${item.effectiveDate}`
                      : ""}
                    . Designated representative:{" "}
                    {representatives.find(
                      (person) => person.id === item.representativeUserId,
                    )?.name ||
                      (item.representativeUserId
                        ? "Stored Team selection (roster unavailable)"
                        : "Not selected")}
                  </small>
                </>
              )}
            </div>
          ),
        )
      )}
      <small className="setup-ownership__legal">
        Setup does not validate legal ownership or provide legal advice.
        Workspace ownership transfer remains a separate Team workstream.
      </small>
    </div>
  );
}

function KnowledgeBucket({
  sources,
  owner,
  editing,
  onAdd,
  onEdit,
  onRemove,
}: {
  sources: SetupKnowledgeSource[];
  owner: boolean;
  editing: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const ready = sources.filter(
    (source) => source.reviewStatus === "ready",
  ).length;
  return (
    <Section
      eyebrow="Business knowledge"
      title="Knowledge bucket"
      description="Add trusted links, document references, notes, and catalog references about the business and its people."
    >
      <div className="setup-metrics">
        <div>
          <strong>{ready}</strong>
          <span>trusted sources</span>
        </div>
        <div>
          <strong>{sources.length - ready}</strong>
          <span>needs review</span>
        </div>
        <div>
          <strong>NOT CONNECTED</strong>
          <span>PAIGE / Spine / Mind / Rail</span>
        </div>
      </div>
      <div className="setup-boundary">
        <ShieldCheck aria-hidden />
        <div>
          <strong>Safe handoff boundary</strong>
          <span>
            Setup stores source records only. It does not fetch URLs, upload
            content, index documents, share across tenants, or feed any model
            runtime.
          </span>
        </div>
      </div>
      {owner && (
        <button
          className="setup-button setup-button--primary setup-add"
          onClick={onAdd}
        >
          <Plus aria-hidden />
          Add knowledge
        </button>
      )}
      <RecordList
        emptyIcon={<BookOpen aria-hidden />}
        emptyTitle="No trusted sources yet"
        emptyText="Add the first link, note, document reference, or catalog reference."
        items={sources.map((source, index) => ({
          key: source.id || String(index),
          title: source.title || "Untitled source",
          text: [
            source.sourceType,
            source.category,
            source.reviewStatus === "ready" ? "Owner reviewed" : "Needs review",
            source.sourceUrl,
            source.reference,
            source.notes,
          ]
            .filter(Boolean)
            .join(" · "),
          source: source.provenance.source,
          actions: (
            <>
              {source.sourceUrl &&
                !validateKnowledgeSource(source).sourceUrl && (
                  <a
                    className="setup-button"
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    Open link
                  </a>
                )}
              {owner ? (
                <>
                  <button
                    className="setup-button"
                    onClick={() => onEdit(index)}
                  >
                    Edit
                  </button>
                  {editing && (
                    <button
                      className="setup-button"
                      onClick={() => onRemove(index)}
                    >
                      Remove
                    </button>
                  )}
                </>
              ) : null}
            </>
          ),
        }))}
      />
    </Section>
  );
}
function RecordList({
  emptyIcon,
  emptyTitle,
  emptyText,
  items,
}: {
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptyText: string;
  items: Array<{
    key: string;
    title: string;
    text: string;
    source: "owner_confirmed" | "connection_sourced" | "needs_confirmation";
    actions: ReactNode;
  }>;
}) {
  return (
    <div className="setup-knowledge-list">
      {items.length === 0 ? (
        <div className="setup-empty">
          {emptyIcon}
          <strong>{emptyTitle}</strong>
          <span>{emptyText}</span>
        </div>
      ) : (
        items.map((item) => (
          <article key={item.key}>
            <div>
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </div>
            <SourceBadge source={item.source} />
            {item.actions && <div>{item.actions}</div>}
          </article>
        ))
      )}
    </div>
  );
}

function PaigeContext({
  profile,
  examples,
  owner,
  editing,
  saving,
  onSave,
  onCancel,
  onKnowledge,
  onGuide,
  onExample,
  onEditExample,
  onRemoveExample,
}: {
  profile: SoloPaigeProfile;
  examples: SetupVoiceExample[];
  owner: boolean;
  editing: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  onKnowledge: () => void;
  onGuide: () => void;
  onExample: () => void;
  onEditExample: (index: number) => void;
  onRemoveExample: (index: number) => void;
}) {
  return (
    <Section
      eyebrow="Paige brief"
      title="Teach Paige how this business sounds and works"
      description="Talk it through, type it out, or add real examples. You review every detail before it becomes trusted Setup context."
    >
      <div className="setup-boundary">
        <ShieldCheck aria-hidden />
        <div>
          <strong>Conversation creates a draft, not an instruction</strong>
          <span>
            Paige cannot confirm this context, expand her authority, or change
            how she operates without explicit owner review and a durable Setup
            save.
          </span>
        </div>
        <span className="setup-truth">PROPOSED</span>
      </div>
      <div className="setup-paige-brief__actions">
        <button
          className="setup-button setup-button--primary"
          disabled={!owner || saving}
          onClick={onGuide}
        >
          <MessageSquareText aria-hidden />
          Teach Paige
        </button>
        <button
          className="setup-button"
          disabled={!owner || saving}
          onClick={onExample}
        >
          <Plus aria-hidden />
          Add an example
        </button>
        <button
          className="setup-button"
          disabled={saving}
          onClick={onKnowledge}
        >
          Links &amp; documents
        </button>
        {editing && owner && (
          <>
            <button
              className="setup-button"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="setup-button setup-button--primary"
              disabled={saving}
              onClick={onSave}
            >
              {saving ? "Saving durable record…" : "Save business context"}
            </button>
          </>
        )}
      </div>
      <div className="setup-paige-brief__grid">
        {SOLO_PAIGE_PROFILE_FIELDS.map((field) => (
          <article
            key={field}
            className={`setup-paige-brief__card${field === "workingStyleBoundaries" ? " setup-paige-brief__card--wide" : ""}`}
          >
            <div>
              <h3>{profileLabels[field].title}</h3>
              <SourceBadge source={profile.provenance[field]?.source} />
            </div>
            <ReadValue>{profile[field]}</ReadValue>
            <small>{profileLabels[field].hint}</small>
          </article>
        ))}
      </div>
      <div className="setup-boundary">
        <Mic aria-hidden />
        <div>
          <strong>Talk with Paige is proposed</strong>
          <span>
            Voice conversation and model extraction are not connected. The
            guided editor creates an owner-reviewed draft locally.
          </span>
        </div>
      </div>
      <RecordList
        emptyIcon={<MessageSquareText aria-hidden />}
        emptyTitle="No examples yet"
        emptyText="Add copy that sounds like the business—or language Paige should avoid."
        items={examples.map((example, index) => ({
          key: example.id || String(index),
          title: `${example.kind === "sounds_like" ? "Sounds like us" : "Avoid this"} · ${example.channel}`,
          text: example.example,
          source: example.provenance.source,
          actions: owner ? (
            <>
              <button
                className="setup-button"
                onClick={() => onEditExample(index)}
              >
                Edit
              </button>
              {editing && (
                <button
                  className="setup-button"
                  onClick={() => onRemoveExample(index)}
                >
                  Remove
                </button>
              )}
            </>
          ) : null,
        }))}
      />
    </Section>
  );
}

type DrawerDraftProps = {
  onDirtyChange: (dirty: boolean) => void;
  confirmDiscard: () => Promise<boolean>;
};
function useDrawerDraft<T>(
  initial: T,
  onDirtyChange: DrawerDraftProps["onDirtyChange"],
  confirmDiscard: DrawerDraftProps["confirmDiscard"],
  onClose: () => void,
) {
  const [value, setValue] = useState(initial);
  const baseline = useRef(JSON.stringify(initial));
  const dirty = JSON.stringify(value) !== baseline.current;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  const close = async () => {
    if (dirty && !(await confirmDiscard())) return;
    onDirtyChange(false);
    onClose();
  };
  return { value, setValue, close };
}
function KnowledgeEditor({
  source: initial,
  onChange: onCommit,
  onClose,
  onDirtyChange,
  confirmDiscard,
}: {
  source: SetupKnowledgeSource;
  onChange: (value: SetupKnowledgeSource) => void;
  onClose: () => void;
} & DrawerDraftProps) {
  const {
    value: source,
    setValue: onChange,
    close,
  } = useDrawerDraft(initial, onDirtyChange, confirmDiscard, onClose);
  const errors = validateKnowledgeSource(source);
  return (
    <Drawer
      label="Add business knowledge"
      title={source.id ? "Edit knowledge source" : "Add knowledge source"}
      description="Create a tenant-owned Setup reference. No URL is fetched and no content is sent to Paige."
      onClose={() => void close()}
      footer={
        <button
          className="setup-button setup-button--primary"
          disabled={Object.keys(errors).length > 0}
          onClick={() => {
            onCommit(source);
            onClose();
          }}
        >
          Keep in Setup draft
        </button>
      }
    >
      <div className="setup-paige-drawer__fields">
        <label>
          <span>Source type</span>
          <select
            value={source.sourceType}
            onChange={(e) =>
              onChange({
                ...source,
                sourceType: e.target
                  .value as SetupKnowledgeSource["sourceType"],
              })
            }
          >
            <option value="link">Website link</option>
            <option value="document">Document reference</option>
            <option value="catalog">Catalog reference</option>
            <option value="note">Business note</option>
          </select>
        </label>
        <label>
          <span>Title</span>
          <input
            value={source.title}
            onChange={(e) => onChange({ ...source, title: e.target.value })}
          />
          {errors.title && <em>{errors.title}</em>}
        </label>
        <label>
          <span>About</span>
          <select
            value={source.category}
            onChange={(e) =>
              onChange({
                ...source,
                category: e.target.value as SetupKnowledgeSource["category"],
              })
            }
          >
            {[
              "business",
              "owners",
              "coaches",
              "consultants",
              "representatives",
              "offers",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        {["link", "document", "catalog"].includes(source.sourceType) && (
          <label>
            <span>
              {source.sourceType === "link"
                ? "HTTPS link"
                : "Document or catalog link (optional)"}
            </span>
            <input
              value={source.sourceUrl}
              onChange={(e) =>
                onChange({ ...source, sourceUrl: e.target.value })
              }
            />
            {errors.sourceUrl && <em>{errors.sourceUrl}</em>}
          </label>
        )}
        <label>
          <span>Reference</span>
          <input
            value={source.reference}
            onChange={(e) => onChange({ ...source, reference: e.target.value })}
          />
          {errors.reference && <em>{errors.reference}</em>}
        </label>
        <label>
          <span>What should an operator know?</span>
          <textarea
            value={source.notes}
            onChange={(e) => onChange({ ...source, notes: e.target.value })}
          />
          {errors.notes && <em>{errors.notes}</em>}
        </label>
        <label>
          <span>Review state</span>
          <select
            value={source.reviewStatus}
            onChange={(e) =>
              onChange({
                ...source,
                reviewStatus: e.target
                  .value as SetupKnowledgeSource["reviewStatus"],
              })
            }
          >
            <option value="needs_review">Needs review</option>
            <option value="ready">Ready / owner-confirmed</option>
          </select>
        </label>
      </div>
    </Drawer>
  );
}
function EmailEditor({
  current,
  domain,
  check,
  register,
  onClose,
  onDirtyChange,
  confirmDiscard,
}: {
  current: string;
  domain: string;
  check: (
    value: string,
  ) => Promise<{ available: boolean | null; address: string } | null>;
  register: (value: string) => Promise<unknown>;
  onClose: () => void;
} & DrawerDraftProps) {
  const [local, setLocal] = useState(current);
  const [status, setStatus] = useState<{
    tone: "ok" | "bad";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState(current);
  const checkEpoch = useRef(0);
  useEffect(
    () => onDirtyChange(local !== registered),
    [local, registered, onDirtyChange],
  );
  const close = async () => {
    if (busy) return;
    if (local !== registered && !(await confirmDiscard())) return;
    onClose();
  };
  const localError = validateManagedEmailLocalPart(local);
  const checkNow = async () => {
    const epoch = ++checkEpoch.current;
    setBusy(true);
    try {
      const result = await check(local);
      if (epoch !== checkEpoch.current) return;
      setStatus(
        result?.available &&
          result.address.toLowerCase() ===
            `${local.trim().toLowerCase()}@${domain.toLowerCase()}`
          ? { tone: "ok", text: `${result.address} is available.` }
          : { tone: "bad", text: "That address is not available." },
      );
    } catch (error) {
      setStatus({
        tone: "bad",
        text:
          error instanceof Error ? error.message : "Availability check failed.",
      });
    } finally {
      setBusy(false);
    }
  };
  const registerNow = async () => {
    setBusy(true);
    try {
      await register(local);
      setRegistered(local.trim().toLowerCase());
      setLocal(local.trim().toLowerCase());
      onDirtyChange(false);
      setStatus({
        tone: "ok",
        text: `${local.trim().toLowerCase()}@${domain} is registered to this workspace.`,
      });
    } catch (error) {
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : "Registration failed.",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      label="Register Paige-managed email"
      title="Choose the platform-provided business email"
      description="Availability is checked globally. Registration changes only this Solo workspace’s managed sender identity."
      onClose={() => void close()}
    >
      <div className="setup-paige-drawer__fields">
        <label>
          <span>Managed email</span>
          <div className="setup-email-composer">
            <input
              disabled={busy}
              value={local}
              onChange={(e) => {
                setLocal(e.target.value.toLowerCase());
                checkEpoch.current += 1;
                setStatus(null);
              }}
            />
            <strong>@{domain}</strong>
          </div>
          {localError && <em>{localError}</em>}
        </label>
      </div>
      {status && (
        <div className="setup-notice" data-tone={status.tone}>
          {status.text}
        </div>
      )}
      <div className="setup-paige-drawer__footer">
        <button
          className="setup-button"
          disabled={busy || Boolean(localError)}
          onClick={() => void checkNow()}
        >
          {busy ? "Checking…" : "Check availability"}
        </button>
        <button
          className="setup-button setup-button--primary"
          disabled={busy || Boolean(localError) || status?.tone !== "ok"}
          onClick={() => void registerNow()}
        >
          Register address
        </button>
      </div>
    </Drawer>
  );
}
function PaigeGuide({
  profile,
  onApply,
  onClose,
  onDirtyChange,
  confirmDiscard,
}: {
  profile: SoloPaigeProfile;
  onApply: (value: SoloPaigeProfile) => void;
  onClose: () => void;
} & DrawerDraftProps) {
  const {
    value: draft,
    setValue: setDraft,
    close,
  } = useDrawerDraft(profile, onDirtyChange, confirmDiscard, onClose);
  const mark = (field: SoloPaigeProfileField, value: string) =>
    setDraft((now) => ({
      ...now,
      [field]: value,
      provenance: {
        ...now.provenance,
        [field]: {
          source: "owner_confirmed",
          confidence: "confirmed",
          confirmedAt: new Date().toISOString(),
        },
      },
    }));
  return (
    <Drawer
      label="Teach Paige this business"
      title="Teach Paige how this business sounds and works"
      description="Use the guided prompts to build a structured draft. Nothing is sent to a model or made authoritative here."
      onClose={() => void close()}
      footer={
        <>
          <button className="setup-button" onClick={() => void close()}>
            Cancel
          </button>
          <button
            className="setup-button setup-button--primary"
            disabled={SOLO_PAIGE_PROFILE_FIELDS.some(
              (field) => draft[field].length > 4000,
            )}
            onClick={() => onApply(draft)}
          >
            Apply to Setup draft
          </button>
        </>
      }
    >
      <div className="setup-paige-drawer__notice">
        <Mic aria-hidden />
        <div>
          <strong>Guided conversation now; live voice later</strong>
          <span>
            This owner-reviewed draft is the safe MVP path. “Talk with Paige”
            remains proposed until its governed adapter exists.
          </span>
        </div>
      </div>
      <div className="setup-paige-drawer__fields">
        {SOLO_PAIGE_PROFILE_FIELDS.map((field) => (
          <label key={field}>
            <span>{profileLabels[field].title}</span>
            <small>{profileLabels[field].hint}</small>
            <textarea
              name={field}
              value={draft[field]}
              maxLength={4000}
              aria-invalid={draft[field].length > 4000 || undefined}
              onChange={(e) => mark(field, e.target.value)}
            />
            <small>
              {draft[field].length.toLocaleString()} / 4,000 characters
            </small>
          </label>
        ))}
      </div>
    </Drawer>
  );
}
function ExampleEditor({
  value: initial,
  existing,
  onChange: onCommit,
  onClose,
  onDirtyChange,
  confirmDiscard,
}: {
  value: SetupVoiceExample;
  existing: boolean;
  onChange: (value: SetupVoiceExample) => void;
  onClose: () => void;
} & DrawerDraftProps) {
  const {
    value,
    setValue: onChange,
    close,
  } = useDrawerDraft(initial, onDirtyChange, confirmDiscard, onClose);
  return (
    <Drawer
      label={existing ? "Edit a voice example" : "Add a voice example"}
      title={existing ? "Edit this example" : "Add a real example"}
      description="Examples remain owner-confirmed Setup records and are not indexed or sent to Paige."
      onClose={() => void close()}
      footer={
        <>
          <button className="setup-button" onClick={() => void close()}>
            Cancel
          </button>
          <button
            className="setup-button setup-button--primary"
            disabled={
              !value.example.trim() ||
              value.example.length > 8000 ||
              value.note.length > 1000
            }
            onClick={() => {
              onCommit(value);
              onClose();
            }}
          >
            Keep in Setup draft
          </button>
        </>
      }
    >
      <div className="setup-paige-drawer__fields">
        <label>
          <span>Example type</span>
          <select
            value={value.kind}
            onChange={(e) =>
              onChange({
                ...value,
                kind: e.target.value as SetupVoiceExample["kind"],
              })
            }
          >
            <option value="sounds_like">Sounds like us</option>
            <option value="avoid">Avoid this</option>
          </select>
        </label>
        <label>
          <span>Channel</span>
          <select
            value={value.channel}
            onChange={(e) =>
              onChange({
                ...value,
                channel: e.target.value as SetupVoiceExample["channel"],
              })
            }
          >
            {["general", "website", "email", "social", "sales", "support"].map(
              (channel) => (
                <option key={channel}>{channel}</option>
              ),
            )}
          </select>
        </label>
        <label>
          <span>Example</span>
          <textarea
            value={value.example}
            maxLength={8000}
            aria-invalid={value.example.length > 8000 || undefined}
            onChange={(e) =>
              onChange({
                ...value,
                example: e.target.value,
                provenance: {
                  source: "owner_confirmed",
                  confidence: "confirmed",
                  confirmedAt: new Date().toISOString(),
                },
              })
            }
          />
          <small>
            {value.example.length.toLocaleString()} / 8,000 characters
          </small>
        </label>
        <label>
          <span>Why it fits or does not fit</span>
          <textarea
            value={value.note}
            maxLength={1000}
            aria-invalid={value.note.length > 1000 || undefined}
            onChange={(e) => onChange({ ...value, note: e.target.value })}
          />
          <small>{value.note.length.toLocaleString()} / 1,000 characters</small>
        </label>
      </div>
    </Drawer>
  );
}
