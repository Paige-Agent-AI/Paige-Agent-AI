export type SetupFactSource = "owner_confirmed" | "connection_sourced" | "needs_confirmation";
export type SetupFactConfidence = "confirmed" | "observed" | "unknown";
export type SetupAccessScope = "owner_full" | "admin_operational" | "read_only";
export type SetupSourceDecision = "adopt" | "override";

/** A reviewed selection is input, never authority. The original native Setup
 * transaction must resolve the actor, lock/revalidate Knowledge and save by CAS.
 * This additive contract does not alter ordinary manual Setup provenance. */
export const REVIEWED_SETUP_FACT_FIELDS = [
  "legalName", "publicName", "dbaName", "website", "address", "phone", "industry", "naicsCode", "sicCode",
  "offers", "deliveryModel", "idealCustomer", "customerSegments", "serviceArea", "currentPriority", "goals90Day",
  "annualDirection", "successDefinition", "constraints", "brandVoice", "operatingPreferences", "doNotAssume",
] as const;
export type ReviewedSetupFactField = (typeof REVIEWED_SETUP_FACT_FIELDS)[number];
export type ReviewedSetupFact = {
  field: ReviewedSetupFactField;
  value: string;
  reference: { contractVersion: 1; tenantId: string; documentId: string; revision: number; contentSha256: string };
  excerpts: { start: number; end: number; text: string }[];
  /** Explicit original provenance choice; source review alone never overrides it. */
  sourceDecision?: SetupSourceDecision;
};
export type ReviewedSetupSelection = {
  schemaVersion: 1;
  actorId: string;
  tenantId: string;
  reviewId: string;
  expectedUpdatedAt: string | null;
  expectedContextRevision: number;
  facts: ReviewedSetupFact[];
};

/** Reject, never repair, evidence. Offsets use the original Knowledge UTF16
 * convention. Literal matching and current source/permission are server duties.
 * A detached deep copy prevents mutation while an original RPC is awaiting. */
export function parseReviewedSetupSelection(input: unknown): ReviewedSetupSelection {
  const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
  const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => record(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
  const uuid = (v: unknown): v is string => typeof v === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
  const invalid = (): never => { throw new Error("SETUP_REVIEW_INVALID"); };
  if (!exact(input, ["schemaVersion", "actorId", "tenantId", "reviewId", "expectedUpdatedAt", "expectedContextRevision", "facts"])
    || input.schemaVersion !== 1 || !uuid(input.actorId) || !uuid(input.tenantId) || !uuid(input.reviewId)
    || !(input.expectedUpdatedAt === null || (typeof input.expectedUpdatedAt === "string"
      && input.expectedUpdatedAt.length < 64 && Number.isFinite(Date.parse(input.expectedUpdatedAt))))
    || !Number.isSafeInteger(input.expectedContextRevision) || Number(input.expectedContextRevision) < 0
    || !Array.isArray(input.facts) || input.facts.length < 1 || input.facts.length > REVIEWED_SETUP_FACT_FIELDS.length) return invalid();
  const fields = new Set<string>();
  let units = 0;
  for (const fact of input.facts) {
    const keys = ["field", "value", "reference", "excerpts"];
    if (record(fact) && Object.prototype.hasOwnProperty.call(fact, "sourceDecision")) keys.push("sourceDecision");
    if (!exact(fact, keys)
      || ("sourceDecision" in fact && fact.sourceDecision !== "adopt" && fact.sourceDecision !== "override")
      || typeof fact.field !== "string" || !REVIEWED_SETUP_FACT_FIELDS.includes(fact.field as ReviewedSetupFactField)
      || fields.has(fact.field) || typeof fact.value !== "string" || !fact.value || fact.value !== fact.value.trim()
      || fact.value.length > 4000 || !exact(fact.reference, ["contractVersion", "tenantId", "documentId", "revision", "contentSha256"])
      || fact.reference.contractVersion !== 1 || fact.reference.tenantId !== input.tenantId || !uuid(fact.reference.documentId)
      || !Number.isSafeInteger(fact.reference.revision) || Number(fact.reference.revision) < 1 || Number(fact.reference.revision) > 2147483647
      || typeof fact.reference.contentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(fact.reference.contentSha256)
      || !Array.isArray(fact.excerpts) || fact.excerpts.length < 1 || fact.excerpts.length > 20) return invalid();
    fields.add(fact.field);
    for (const excerpt of fact.excerpts) {
      if (!exact(excerpt, ["start", "end", "text"]) || !Number.isSafeInteger(excerpt.start) || !Number.isSafeInteger(excerpt.end)
        || Number(excerpt.start) < 0 || Number(excerpt.end) > 480000 || Number(excerpt.end) <= Number(excerpt.start)
        || typeof excerpt.text !== "string" || excerpt.text.length !== Number(excerpt.end) - Number(excerpt.start)) return invalid();
      units += excerpt.text.length;
      if (units > 12000) return invalid();
    }
  }
  return JSON.parse(JSON.stringify(input)) as ReviewedSetupSelection;
}

export type SoloBusinessOwner = {
  id: string;
  ownerKind: "individual" | "company" | "trust" | "other_legal_person";
  legalName: string;
  displayName: string;
  ownershipInterest: string;
  effectiveDate: string;
  status: "active" | "former" | "pending" | "other";
  representativeUserId: string;
  provenance?: Partial<Record<"ownerKind" | "legalName" | "displayName" | "ownershipInterest" | "effectiveDate" | "status" | "representativeUserId", SetupFactProvenance>>;
  sourceDecision?: SetupSourceDecision;
  deleteRequested?: boolean;
};

export type SetupFactProvenance = {
  source: SetupFactSource;
  confidence: SetupFactConfidence;
  confirmedAt?: string;
};

export const SOLO_SETUP_TEXT_FIELDS = [
  "legalName",
  "publicName",
  "dbaName",
  "website",
  "address",
  "phone",
  "industry",
  "naicsCode",
  "sicCode",
  "entityType",
  "stateOfFormation",
  "businessRegistrationIdentifier",
  "regionsOfOperation",
  "registeredStreet",
  "registeredStreetSecondary",
  "registeredCity",
  "registeredRegion",
  "registeredPostalCode",
  "registeredIsoCountry",
  "authorizedRepresentativePhone",
  "authorizedRepresentativeJobPosition",
  "offers",
  "deliveryModel",
  "idealCustomer",
  "customerSegments",
  "serviceArea",
  "currentPriority",
  "goals90Day",
  "annualDirection",
  "successDefinition",
  "constraints",
  "brandVoice",
  "operatingPreferences",
  "doNotAssume",
] as const;

export type SoloSetupTextField = (typeof SOLO_SETUP_TEXT_FIELDS)[number];

export type SoloSetupBrief = Record<SoloSetupTextField, string> & {
  /** Write-only. The server removes this before saving the business brief and stores it in Vault. */
  businessRegistrationNumber: string;
  /** Read-only masked state returned by the Setup identity seam. */
  businessRegistrationNumberLast4: string;
  representativeUserIds: string[];
  authorizedRepresentativeUserId: string;
  provenance: Partial<Record<SoloSetupTextField | "representatives" | "authorizedRepresentative", SetupFactProvenance>>;
  updatedAt?: string;
};

export type SoloSetupProposal = {
  id: string;
  reason: string;
  proposedAt: string;
  patch: Partial<SoloSetupBrief>;
};

export const EMPTY_SOLO_SETUP_BRIEF: SoloSetupBrief = {
  legalName: "",
  publicName: "",
  dbaName: "",
  website: "",
  address: "",
  phone: "",
  industry: "",
  naicsCode: "",
  sicCode: "",
  entityType: "",
  stateOfFormation: "",
  businessRegistrationIdentifier: "",
  businessRegistrationNumber: "",
  businessRegistrationNumberLast4: "",
  regionsOfOperation: "",
  registeredStreet: "",
  registeredStreetSecondary: "",
  registeredCity: "",
  registeredRegion: "",
  registeredPostalCode: "",
  registeredIsoCountry: "",
  authorizedRepresentativePhone: "",
  authorizedRepresentativeJobPosition: "",
  offers: "",
  deliveryModel: "",
  idealCustomer: "",
  customerSegments: "",
  serviceArea: "",
  currentPriority: "",
  goals90Day: "",
  annualDirection: "",
  successDefinition: "",
  constraints: "",
  brandVoice: "",
  operatingPreferences: "",
  doNotAssume: "",
  representativeUserIds: [],
  authorizedRepresentativeUserId: "",
  provenance: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function cleanSoloSetupBrief(value: unknown, fallbackName = ""): SoloSetupBrief {
  const source = isRecord(value) ? value : {};
  const provenanceSource = isRecord(source.provenance) ? source.provenance : {};
  const brief = { ...EMPTY_SOLO_SETUP_BRIEF, provenance: {} } as SoloSetupBrief;
  for (const field of SOLO_SETUP_TEXT_FIELDS) {
    const raw = source[field];
    brief[field] = typeof raw === "string" ? raw.trim() : EMPTY_SOLO_SETUP_BRIEF[field];
    const p = provenanceSource[field];
    if (isRecord(p) && ["owner_confirmed", "connection_sourced", "needs_confirmation"].includes(String(p.source))) {
      brief.provenance[field] = {
        source: p.source as SetupFactSource,
        confidence: ["confirmed", "observed", "unknown"].includes(String(p.confidence))
          ? (p.confidence as SetupFactConfidence)
          : "unknown",
        ...(typeof p.confirmedAt === "string" ? { confirmedAt: p.confirmedAt } : {}),
      };
    }
  }
  if (!brief.publicName) brief.publicName = fallbackName.trim();
  brief.businessRegistrationNumber = "";
  brief.businessRegistrationNumberLast4 = typeof source.businessRegistrationNumberLast4 === "string"
    ? source.businessRegistrationNumberLast4.trim().slice(-4)
    : "";
  brief.representativeUserIds = Array.isArray(source.representativeUserIds)
    ? Array.from(new Set(source.representativeUserIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim())))
    : [];
  brief.authorizedRepresentativeUserId = typeof source.authorizedRepresentativeUserId === "string"
    ? source.authorizedRepresentativeUserId.trim()
    : "";
  for (const key of ["representatives", "authorizedRepresentative"] as const) {
    const p = provenanceSource[key];
    if (isRecord(p) && ["owner_confirmed", "needs_confirmation"].includes(String(p.source))) {
      brief.provenance[key] = {
        source: p.source as SetupFactSource,
        confidence: p.confidence === "confirmed" ? "confirmed" : "unknown",
        ...(typeof p.confirmedAt === "string" ? { confirmedAt: p.confirmedAt } : {}),
      };
    }
  }
  if (typeof source.updatedAt === "string") brief.updatedAt = source.updatedAt;
  return brief;
}

export function validateSoloSetupBrief(
  brief: SoloSetupBrief,
  legalSenderExists = false,
): Partial<Record<SoloSetupTextField | "businessRegistrationNumber" | "authorizedRepresentativeUserId", string>> {
  const errors: Partial<Record<SoloSetupTextField | "businessRegistrationNumber" | "authorizedRepresentativeUserId", string>> = {};
  if (![brief.legalName, brief.publicName, brief.dbaName].some((value) => value.trim())) {
    errors.publicName = "Add at least one legal, public, or doing-business-as business name.";
  }
  const hasLegalSenderContext = Boolean(
    brief.businessRegistrationNumberLast4 || brief.businessRegistrationNumber ||
    ["entityType", "stateOfFormation", "businessRegistrationIdentifier", "regionsOfOperation",
      "registeredStreet", "registeredStreetSecondary", "registeredCity", "registeredRegion",
      "registeredPostalCode", "registeredIsoCountry", "authorizedRepresentativePhone",
      "authorizedRepresentativeJobPosition", "authorizedRepresentativeUserId"]
      .some((field) => String(brief[field as keyof SoloSetupBrief] ?? "").trim()),
  );
  if ((hasLegalSenderContext || legalSenderExists) && !brief.legalName.trim()) {
    errors.legalName = "Add the legal business name before saving legal sender details.";
  }
  if (brief.website.trim()) {
    try {
      const url = new URL(brief.website.trim());
      if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("protocol");
    } catch {
      errors.website = "Use a complete http:// or https:// business website.";
    }
  }
  if (brief.naicsCode.trim() && !/^\d{2,6}$/.test(brief.naicsCode.trim())) {
    errors.naicsCode = "NAICS codes use 2–6 digits. Leave blank if the owner has not confirmed one.";
  }
  if (brief.sicCode.trim() && !/^\d{4}$/.test(brief.sicCode.trim())) {
    errors.sicCode = "SIC codes use 4 digits. Leave blank if the owner has not confirmed one.";
  }
  if (brief.businessRegistrationIdentifier === "EIN" && (brief.businessRegistrationNumber ?? "").trim()) {
    const digits = (brief.businessRegistrationNumber ?? "").replace(/\D/g, "");
    if (!/^\d{9}$/.test(digits)) errors.businessRegistrationNumber = "An EIN must contain exactly 9 digits.";
  }
  if ((brief.authorizedRepresentativePhone ?? "").trim() && !/^\+[1-9]\d{7,14}$/.test((brief.authorizedRepresentativePhone ?? "").trim())) {
    errors.authorizedRepresentativePhone = "Use a complete E.164 phone number, including + and country code.";
  }
  if ((brief.registeredRegion ?? "").trim() && (brief.registeredRegion ?? "").trim().length > 120) {
    errors.registeredRegion = "Use a state, province, territory, or region no longer than 120 characters.";
  }
  if ((brief.registeredIsoCountry ?? "").trim() && !/^[A-Za-z]{2}$/.test((brief.registeredIsoCountry ?? "").trim())) {
    errors.registeredIsoCountry = "Use a two-letter ISO country code.";
  }
  if (brief.authorizedRepresentativeUserId && !(brief.representativeUserIds ?? []).includes(brief.authorizedRepresentativeUserId)) {
    errors.authorizedRepresentativeUserId = "Choose an authorized representative from the confirmed business representatives.";
  }
  return errors;
}

export function prepareOwnerConfirmedBrief(
  brief: SoloSetupBrief,
  confirmedAt = new Date().toISOString(),
  original?: SoloSetupBrief,
  sourceDecisions: Partial<Record<SoloSetupTextField, SetupSourceDecision>> = {},
): SoloSetupBrief & { sourceDecisions?: Partial<Record<SoloSetupTextField, SetupSourceDecision>> } {
  const cleaned = cleanSoloSetupBrief(brief);
  cleaned.businessRegistrationNumber = (brief.businessRegistrationNumber ?? "").trim();
  const provenance: SoloSetupBrief["provenance"] = {};
  for (const field of SOLO_SETUP_TEXT_FIELDS) {
    if (!cleaned[field]) continue;
    const prior = original?.provenance[field];
    const unchanged = original ? cleaned[field] === original[field] : false;
    if (unchanged && prior && sourceDecisions[field] !== "adopt") {
      provenance[field] = prior;
    } else {
      provenance[field] = { source: "owner_confirmed", confidence: "confirmed", confirmedAt };
    }
  }
  if (cleaned.representativeUserIds.length) {
    provenance.representatives = { source: "owner_confirmed", confidence: "confirmed", confirmedAt };
  }
  if (cleaned.authorizedRepresentativeUserId) {
    provenance.authorizedRepresentative = { source: "owner_confirmed", confidence: "confirmed", confirmedAt };
  }
  return {
    ...cleaned,
    provenance,
    ...(Object.keys(sourceDecisions).length ? { sourceDecisions } : {}),
  };
}

export function cleanSoloBusinessOwners(value: unknown): SoloBusinessOwner[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SoloBusinessOwner[] => {
    if (!isRecord(item)) return [];
    const ownerKind = String(item.ownerKind ?? "");
    const status = String(item.status ?? "active");
    if (!["individual", "company", "trust", "other_legal_person"].includes(ownerKind)) return [];
    if (!["active", "former", "pending", "other"].includes(status)) return [];
    return [{
      id: typeof item.id === "string" ? item.id : "",
      ownerKind: ownerKind as SoloBusinessOwner["ownerKind"],
      legalName: typeof item.legalName === "string" ? item.legalName.trim() : "",
      displayName: typeof item.displayName === "string" ? item.displayName.trim() : "",
      ownershipInterest: item.ownershipInterest == null ? "" : String(item.ownershipInterest),
      effectiveDate: typeof item.effectiveDate === "string" ? item.effectiveDate : "",
      status: status as SoloBusinessOwner["status"],
      representativeUserId: typeof item.representativeUserId === "string" ? item.representativeUserId : "",
      provenance: isRecord(item.provenance) ? item.provenance as SoloBusinessOwner["provenance"] : {},
      ...((item.sourceDecision === "adopt" || item.sourceDecision === "override") ? { sourceDecision: item.sourceDecision } : {}),
      ...(item.deleteRequested === true ? { deleteRequested: true } : {}),
    }];
  });
}

export function validateSoloBusinessOwners(owners: SoloBusinessOwner[]): Record<string, string> {
  const errors: Record<string, string> = {};
  owners.forEach((owner, index) => {
    if (owner.deleteRequested) return;
    if (!owner.legalName.trim()) errors[`${index}.legalName`] = "Add the legal name for this business owner.";
    if (owner.ownershipInterest.trim()) {
      const value = Number(owner.ownershipInterest);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        errors[`${index}.ownershipInterest`] = "Enter a percentage from 0 to 100, or leave it blank.";
      }
    }
  });
  return errors;
}

export function applySetupProposal(current: SoloSetupBrief, proposal: SoloSetupProposal): SoloSetupBrief {
  const next = { ...current };
  for (const field of SOLO_SETUP_TEXT_FIELDS) {
    const value = proposal.patch[field];
    if (typeof value === "string") next[field] = value;
  }
  if (Array.isArray(proposal.patch.representativeUserIds)) {
    next.representativeUserIds = proposal.patch.representativeUserIds;
  }
  // PAIGE proposals never carry the full registration number or choose the legal
  // representative. Those are direct owner-confirmation fields.
  next.businessRegistrationNumber = current.businessRegistrationNumber;
  next.authorizedRepresentativeUserId = current.authorizedRepresentativeUserId;
  return cleanSoloSetupBrief(next);
}

export function setupSourceLabel(source: SetupFactSource | undefined) {
  if (source === "owner_confirmed") return "Owner-confirmed";
  if (source === "connection_sourced") return "Connection-sourced";
  return "Needs confirmation";
}
